"""
NEXUS Analytics — Predict Router

Fraud prediction API endpoints with batch support, model management,
and real-time scoring.

Endpoints:
  POST /predict          — Single transaction fraud prediction
  POST /predict/batch    — Batch fraud prediction (up to 100)
  GET  /model/info       — Current model metadata and stats
  POST /model/reload     — Hot-reload model from S3 or local
  GET  /predict/explain/:scoring_id — Get prediction explanation
"""

import time
import uuid
import logging
from typing import Any

from fastapi import APIRouter, Depends, HTTPException, Header, Request
from pydantic import BaseModel, Field, field_validator

logger = logging.getLogger("analytics.routers.predict")
router = APIRouter(tags=["Fraud Prediction"])


# ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
# Request/Response Models
# ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

class FraudPredictionRequest(BaseModel):
    """Single fraud prediction request."""
    user_id: str = Field(..., min_length=1, max_length=100)
    transaction_id: str = Field(..., min_length=1, max_length=100)
    amount: float = Field(..., gt=0, le=10_000_000)
    recipient_id: str = Field(..., min_length=1, max_length=100)
    module: str = Field(..., pattern=r"^(bazaar|rides|skills|food|errand)$")
    user_trust_score: float = Field(default=3.0, ge=0.0, le=5.0)
    user_age_days: int = Field(default=30, ge=0)
    transactions_last_24h: int = Field(default=0, ge=0)
    transactions_last_7d: int = Field(default=0, ge=0)
    unique_recipients_last_7d: int = Field(default=0, ge=0)
    is_new_recipient: bool = Field(default=True)
    listing_price: float = Field(default=0, ge=0)
    device_fingerprint: str | None = Field(default=None, max_length=255)
    ip_address: str | None = Field(default=None, max_length=45)

    @field_validator("amount")
    @classmethod
    def validate_amount(cls, v: float) -> float:
        if v <= 0:
            raise ValueError("Amount must be positive")
        return round(v, 2)


class FraudPredictionResponse(BaseModel):
    """Single fraud prediction response."""
    scoring_id: str
    score: float = Field(ge=0.0, le=100.0)
    action: str
    model_available: bool
    model_version: str | None = None
    features: dict[str, Any] = {}
    confidence: float = Field(ge=0.0, le=1.0, default=0.0)
    latency_ms: float
    rule_scores: dict[str, float] = {}
    explanation: str = ""


class BatchPredictionRequest(BaseModel):
    """Batch fraud prediction request."""
    transactions: list[FraudPredictionRequest] = Field(..., min_length=1, max_length=100)


class BatchPredictionResponse(BaseModel):
    """Batch fraud prediction response."""
    results: list[FraudPredictionResponse]
    total: int
    avg_score: float
    max_score: float
    blocked_count: int
    latency_ms: float


class ModelInfo(BaseModel):
    """Model metadata response."""
    model_version: str | None
    model_type: str
    feature_count: int
    feature_names: list[str]
    training_date: str | None
    training_samples: int | None
    auc_score: float | None
    precision: float | None
    recall: float | None
    is_loaded: bool
    model_source: str
    predictions_served: int
    avg_latency_ms: float
    uptime_seconds: float


class ReloadResponse(BaseModel):
    """Model reload response."""
    status: str
    previous_version: str | None
    new_version: str | None
    load_time_ms: float


# ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
# Security
# ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

async def verify_internal_secret(
    x_internal_secret: str | None = Header(None, alias="X-Internal-Secret"),
) -> str:
    """Verify the internal service secret for service-to-service calls."""
    from app.config import get_settings
    settings = get_settings()

    if not x_internal_secret:
        raise HTTPException(status_code=401, detail="Internal secret required")
    if x_internal_secret != settings.INTERNAL_SERVICE_SECRET:
        raise HTTPException(status_code=403, detail="Invalid internal secret")
    return x_internal_secret


# ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
# Fraud Scoring Engine
# ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

# Action thresholds
ACTION_THRESHOLDS = {
    "allow": (0, 20),
    "allow_with_monitoring": (20, 50),
    "require_selfie_verification": (50, 75),
    "block_pending_review": (75, 100),
}


def determine_action(score: float) -> str:
    """Determine fraud action based on score thresholds."""
    if score < 20:
        return "allow"
    elif score < 50:
        return "allow_with_monitoring"
    elif score < 75:
        return "require_selfie_verification"
    else:
        return "block_pending_review"


def generate_explanation(score: float, action: str, rule_scores: dict[str, float]) -> str:
    """Generate human-readable explanation for fraud scoring."""
    parts = []
    if score < 20:
        parts.append("Transaction appears legitimate.")
    elif score < 50:
        parts.append("Some risk indicators detected.")
    elif score < 75:
        parts.append("Significant risk indicators found.")
    else:
        parts.append("High-risk transaction flagged.")

    # Top contributing rules
    sorted_rules = sorted(rule_scores.items(), key=lambda x: abs(x[1]), reverse=True)
    if sorted_rules:
        top_rules = sorted_rules[:3]
        rule_strs = [f"{name}={val:.1f}" for name, val in top_rules]
        parts.append(f"Top factors: {', '.join(rule_strs)}.")

    return " ".join(parts)


# ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
# Rule-Based Scoring
# ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

def compute_rule_scores(req: FraudPredictionRequest) -> dict[str, float]:
    """
    Compute individual rule-based fraud scores.
    Each rule returns a score from 0-100 representing risk.
    """
    scores: dict[str, float] = {}

    # Rule 1: New account with high-value transaction
    if req.user_age_days < 3 and req.amount > 200000:  # ₹2000+
        scores["new_account_high_value"] = 85.0
    elif req.user_age_days < 7 and req.amount > 500000:  # ₹5000+
        scores["new_account_high_value"] = 70.0
    elif req.user_age_days < 14 and req.amount > 1000000:  # ₹10000+
        scores["new_account_high_value"] = 55.0
    else:
        scores["new_account_high_value"] = 0.0

    # Rule 2: Velocity — too many transactions in 24h
    if req.transactions_last_24h > 15:
        scores["velocity_24h"] = 90.0
    elif req.transactions_last_24h > 10:
        scores["velocity_24h"] = 60.0
    elif req.transactions_last_24h > 5:
        scores["velocity_24h"] = 30.0
    else:
        scores["velocity_24h"] = 0.0

    # Rule 3: Velocity — too many transactions in 7d
    if req.transactions_last_7d > 50:
        scores["velocity_7d"] = 75.0
    elif req.transactions_last_7d > 30:
        scores["velocity_7d"] = 45.0
    else:
        scores["velocity_7d"] = 0.0

    # Rule 4: Too many unique recipients (money laundering indicator)
    if req.unique_recipients_last_7d > 10:
        scores["many_recipients"] = 70.0
    elif req.unique_recipients_last_7d > 5:
        scores["many_recipients"] = 35.0
    else:
        scores["many_recipients"] = 0.0

    # Rule 5: Low trust score with high value
    if req.user_trust_score < 1.5 and req.amount > 100000:
        scores["low_trust_high_value"] = 65.0
    elif req.user_trust_score < 2.5 and req.amount > 500000:
        scores["low_trust_high_value"] = 50.0
    else:
        scores["low_trust_high_value"] = 0.0

    # Rule 6: Price mismatch (transaction amount vs listing price)
    if req.listing_price > 0:
        ratio = req.amount / req.listing_price
        if ratio > 3.0 or ratio < 0.3:
            scores["price_mismatch"] = 80.0
        elif ratio > 2.0 or ratio < 0.5:
            scores["price_mismatch"] = 40.0
        else:
            scores["price_mismatch"] = 0.0
    else:
        scores["price_mismatch"] = 0.0

    # Rule 7: New recipient
    if req.is_new_recipient and req.amount > 300000:
        scores["new_recipient_high_value"] = 45.0
    else:
        scores["new_recipient_high_value"] = 0.0

    # Rule 8: Amount exactly round numbers (social engineering indicator)
    amount_rupees = req.amount / 100
    if amount_rupees > 1000 and amount_rupees == round(amount_rupees, -2):
        scores["round_amount"] = 15.0
    else:
        scores["round_amount"] = 0.0

    return scores


def aggregate_rule_score(rule_scores: dict[str, float]) -> float:
    """
    Aggregate individual rule scores into a composite fraud score.
    Uses max-weighted approach: highest rule contributes 60%, average of rest 40%.
    """
    if not rule_scores:
        return 0.0

    values = [v for v in rule_scores.values() if v > 0]
    if not values:
        return 0.0

    max_score = max(values)
    if len(values) == 1:
        return max_score

    remaining_avg = sum(v for v in values if v < max_score) / max(len(values) - 1, 1)
    composite = max_score * 0.6 + remaining_avg * 0.4

    return min(round(composite, 2), 100.0)


# ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
# Global State
# ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

_prediction_count = 0
_total_latency_ms = 0.0
_start_time = time.time()


# ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
# Endpoints
# ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

@router.post("/predict", response_model=FraudPredictionResponse)
async def predict_fraud(
    request: Request,
    body: FraudPredictionRequest,
    _secret: str = Depends(verify_internal_secret),
) -> FraudPredictionResponse:
    """
    Score a single transaction for fraud risk.

    Returns a score (0-100) and recommended action:
    - allow (0-19): Transaction is safe
    - allow_with_monitoring (20-49): Watch but allow
    - require_selfie_verification (50-74): Require additional verification
    - block_pending_review (75-100): Block and flag for review
    """
    global _prediction_count, _total_latency_ms
    start = time.time()
    scoring_id = str(uuid.uuid4())

    # Step 1: Rule-based scoring
    rule_scores = compute_rule_scores(body)
    rule_composite = aggregate_rule_score(rule_scores)

    # Step 2: ML model prediction (if available)
    ml_score: float | None = None
    model_available = False
    model_version: str | None = None

    predictor = getattr(request.app.state, "fraud_predictor", None)
    if predictor is not None:
        try:
            from app.fraud.features import extract_features
            features = extract_features({
                "amount": body.amount,
                "user_trust_score": body.user_trust_score,
                "user_age_days": body.user_age_days,
                "transactions_last_24h": body.transactions_last_24h,
                "transactions_last_7d": body.transactions_last_7d,
                "unique_recipients_last_7d": body.unique_recipients_last_7d,
                "is_new_recipient": body.is_new_recipient,
                "listing_price": body.listing_price,
                "module": body.module,
            })
            result = predictor.predict(features)
            ml_score = result["score"]
            model_available = True
            model_version = result.get("model_version")
        except Exception as e:
            logger.warning(f"ML prediction failed: {e}")
            ml_score = None

    # Step 3: Ensemble — combine rule-based and ML
    if ml_score is not None:
        final_score = ml_score * 0.6 + rule_composite * 0.4
    else:
        final_score = rule_composite

    final_score = min(round(final_score, 2), 100.0)
    action = determine_action(final_score)
    confidence = 0.9 if model_available else 0.6

    latency_ms = round((time.time() - start) * 1000, 2)
    _prediction_count += 1
    _total_latency_ms += latency_ms

    explanation = generate_explanation(final_score, action, rule_scores)

    logger.info(
        f"Fraud scored: {scoring_id} user={body.user_id} tx={body.transaction_id} "
        f"score={final_score} action={action} ml={model_available} latency={latency_ms}ms"
    )

    return FraudPredictionResponse(
        scoring_id=scoring_id,
        score=final_score,
        action=action,
        model_available=model_available,
        model_version=model_version,
        features=rule_scores,
        confidence=confidence,
        latency_ms=latency_ms,
        rule_scores=rule_scores,
        explanation=explanation,
    )


@router.post("/predict/batch", response_model=BatchPredictionResponse)
async def predict_fraud_batch(
    request: Request,
    body: BatchPredictionRequest,
    _secret: str = Depends(verify_internal_secret),
) -> BatchPredictionResponse:
    """
    Score multiple transactions for fraud risk in a single request.
    Maximum 100 transactions per batch.
    """
    start = time.time()
    results: list[FraudPredictionResponse] = []

    for tx in body.transactions:
        # Reuse single prediction logic
        single_result = await predict_fraud(request, tx, _secret)
        results.append(single_result)

    scores = [r.score for r in results]
    blocked = sum(1 for r in results if r.action == "block_pending_review")
    latency_ms = round((time.time() - start) * 1000, 2)

    return BatchPredictionResponse(
        results=results,
        total=len(results),
        avg_score=round(sum(scores) / len(scores), 2) if scores else 0.0,
        max_score=max(scores) if scores else 0.0,
        blocked_count=blocked,
        latency_ms=latency_ms,
    )


@router.get("/model/info", response_model=ModelInfo)
async def get_model_info(request: Request) -> ModelInfo:
    """Get current fraud model metadata and performance stats."""
    global _prediction_count, _total_latency_ms, _start_time

    predictor = getattr(request.app.state, "fraud_predictor", None)

    avg_latency = _total_latency_ms / _prediction_count if _prediction_count > 0 else 0.0

    if predictor and predictor.model is not None:
        return ModelInfo(
            model_version=getattr(predictor, "model_version", "unknown"),
            model_type=type(predictor.model).__name__,
            feature_count=len(getattr(predictor, "feature_names", [])),
            feature_names=getattr(predictor, "feature_names", []),
            training_date=getattr(predictor, "training_date", None),
            training_samples=getattr(predictor, "training_samples", None),
            auc_score=getattr(predictor, "auc_score", None),
            precision=getattr(predictor, "precision_score", None),
            recall=getattr(predictor, "recall_score", None),
            is_loaded=True,
            model_source=getattr(predictor, "model_source", "unknown"),
            predictions_served=_prediction_count,
            avg_latency_ms=round(avg_latency, 2),
            uptime_seconds=round(time.time() - _start_time, 1),
        )

    return ModelInfo(
        model_version=None,
        model_type="rule_based_fallback",
        feature_count=11,
        feature_names=[
            "amount", "user_trust_score", "user_age_days",
            "transactions_last_24h", "transactions_last_7d",
            "unique_recipients_last_7d", "is_new_recipient",
            "listing_price", "module", "device_fingerprint", "ip_address",
        ],
        training_date=None,
        training_samples=None,
        auc_score=None,
        precision=None,
        recall=None,
        is_loaded=False,
        model_source="rule_based",
        predictions_served=_prediction_count,
        avg_latency_ms=round(avg_latency, 2),
        uptime_seconds=round(time.time() - _start_time, 1),
    )


@router.post("/model/reload", response_model=ReloadResponse)
async def reload_model(
    request: Request,
    _secret: str = Depends(verify_internal_secret),
) -> ReloadResponse:
    """Hot-reload the fraud prediction model from S3 or local file."""
    start = time.time()
    predictor = getattr(request.app.state, "fraud_predictor", None)

    if predictor is None:
        raise HTTPException(status_code=500, detail="Fraud predictor not initialized")

    previous_version = getattr(predictor, "model_version", None)

    try:
        predictor.load_model()
        new_version = getattr(predictor, "model_version", None)
        load_time_ms = round((time.time() - start) * 1000, 2)

        logger.info(f"Model reloaded: {previous_version} -> {new_version} in {load_time_ms}ms")

        return ReloadResponse(
            status="reloaded",
            previous_version=previous_version,
            new_version=new_version,
            load_time_ms=load_time_ms,
        )
    except Exception as e:
        logger.error(f"Model reload failed: {e}")
        raise HTTPException(status_code=500, detail=f"Model reload failed: {str(e)}")
