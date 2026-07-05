"""
Fraud Detection — Model Prediction
===================================

Loads an sklearn GradientBoostingClassifier model and returns fraud
score (0-100) with an action recommendation.

The predictor supports multiple model sources:
    1. Local file (default): loads from ``fraud_model_path``
    2. S3: downloads from ``aws_s3_analytics_bucket / model_s3_key``

If the model is unavailable or prediction fails, the predictor falls
back to rule-based heuristics (fail-open: action = "allow").

Score Thresholds (configurable via Settings):
    score <  20  →  action = "allow"
    score <  50  →  action = "allow_with_monitoring"
    score <  75  →  action = "require_selfie_verification"
    score >= 75  →  action = "block_pending_review"

Usage:
    predictor = get_predictor("/path/to/model.pkl")
    result = predictor.predict_from_features(features)
    # result = {"score": 42, "action": "allow_with_monitoring", ...}
"""

from __future__ import annotations

import hashlib
import json
import logging
import os
import pickle
import tempfile
import threading
import time
from dataclasses import dataclass, field
from datetime import datetime, timezone
from pathlib import Path
from typing import Any, Optional

import numpy as np

from app.fraud.features import FraudFeatures

logger = logging.getLogger("nexus.analytics.fraud.predict")

# Action thresholds (defaults — can be overridden via Settings)
SCORE_ALLOW = 20
SCORE_MONITOR = 50
SCORE_SELFIE = 75


# ── Data Models ───────────────────────────────────────────────────────────


@dataclass
class ModelMetadata:
    """
    Metadata about the loaded fraud model.

    Tracks versioning, provenance, and performance metrics so operators
    can determine which model is serving and when it was trained.
    """

    version: str = "unknown"
    trained_at: str = ""
    model_type: str = "GradientBoostingClassifier"
    feature_version: str = "v1"
    feature_count: int = 11
    source: str = "local"
    file_path: str = ""
    file_hash: str = ""
    loaded_at: str = ""
    training_metrics: dict[str, Any] = field(default_factory=dict)

    def to_dict(self) -> dict[str, Any]:
        """Serialize metadata to a JSON-safe dictionary."""
        return {
            "version": self.version,
            "trained_at": self.trained_at,
            "model_type": self.model_type,
            "feature_version": self.feature_version,
            "feature_count": self.feature_count,
            "source": self.source,
            "file_path": self.file_path,
            "file_hash": self.file_hash,
            "loaded_at": self.loaded_at,
            "training_metrics": self.training_metrics,
        }


@dataclass
class PredictionResult:
    """
    Structured result from a fraud prediction.

    Includes the raw score, recommended action, model availability,
    confidence interval bounds, and feature contributions.
    """

    score: int
    action: str
    model_available: bool
    fraud_probability: float
    model_version: str = "unknown"
    confidence_lower: float = 0.0
    confidence_upper: float = 1.0
    features_used: dict[str, float] = field(default_factory=dict)
    prediction_source: str = "model"

    def to_dict(self) -> dict[str, Any]:
        """Serialize to a JSON-safe dictionary."""
        return {
            "score": self.score,
            "action": self.action,
            "model_available": self.model_available,
            "fraud_probability": round(self.fraud_probability, 6),
            "model_version": self.model_version,
            "confidence_lower": round(self.confidence_lower, 6),
            "confidence_upper": round(self.confidence_upper, 6),
            "features_used": self.features_used,
            "prediction_source": self.prediction_source,
        }


# ── Feature Normalization ─────────────────────────────────────────────────


class FeatureNormalizer:
    """
    Normalizes raw feature values to consistent ranges.

    Each feature has known min/max bounds derived from the training data
    distribution. Normalization improves model stability and makes
    rule-based scoring more consistent.
    """

    # (min, max) bounds per feature — derived from training data
    FEATURE_BOUNDS: dict[str, tuple[float, float]] = {
        "user_account_age_days": (0.0, 1825.0),  # 0 to 5 years
        "verification_level": (0.0, 5.0),
        "trust_score": (0.0, 5.0),
        "transaction_amount": (0.0, 50000.0),  # in rupees
        "price_deviation_pct": (-1.0, 3.0),
        "seller_listing_age_hours": (0.0, 8760.0),  # up to 1 year
        "buyer_prior_disputes": (0.0, 20.0),
        "seller_prior_disputes": (0.0, 20.0),
        "is_first_txn_between_pair": (0.0, 1.0),
        "device_fingerprint_age_days": (0.0, 730.0),  # up to 2 years
        "time_of_day_risk": (0.0, 1.0),
    }

    @classmethod
    def normalize(cls, features: FraudFeatures) -> FraudFeatures:
        """
        Clamp feature values to valid ranges.

        Does not rescale (the model was trained on raw values), but
        prevents extreme outliers from causing erratic predictions.

        Args:
            features: Raw feature values.

        Returns:
            New FraudFeatures with clamped values.
        """
        clamped = FraudFeatures(
            user_account_age_days=cls._clamp(
                features.user_account_age_days, *cls.FEATURE_BOUNDS["user_account_age_days"]
            ),
            verification_level=int(
                cls._clamp(
                    float(features.verification_level), *cls.FEATURE_BOUNDS["verification_level"]
                )
            ),
            trust_score=cls._clamp(
                features.trust_score, *cls.FEATURE_BOUNDS["trust_score"]
            ),
            transaction_amount=cls._clamp(
                features.transaction_amount, *cls.FEATURE_BOUNDS["transaction_amount"]
            ),
            price_deviation_pct=cls._clamp(
                features.price_deviation_pct, *cls.FEATURE_BOUNDS["price_deviation_pct"]
            ),
            seller_listing_age_hours=cls._clamp(
                features.seller_listing_age_hours,
                *cls.FEATURE_BOUNDS["seller_listing_age_hours"],
            ),
            buyer_prior_disputes=int(
                cls._clamp(
                    float(features.buyer_prior_disputes),
                    *cls.FEATURE_BOUNDS["buyer_prior_disputes"],
                )
            ),
            seller_prior_disputes=int(
                cls._clamp(
                    float(features.seller_prior_disputes),
                    *cls.FEATURE_BOUNDS["seller_prior_disputes"],
                )
            ),
            is_first_txn_between_pair=int(
                cls._clamp(
                    float(features.is_first_txn_between_pair),
                    *cls.FEATURE_BOUNDS["is_first_txn_between_pair"],
                )
            ),
            device_fingerprint_age_days=cls._clamp(
                features.device_fingerprint_age_days,
                *cls.FEATURE_BOUNDS["device_fingerprint_age_days"],
            ),
            time_of_day_risk=cls._clamp(
                features.time_of_day_risk, *cls.FEATURE_BOUNDS["time_of_day_risk"]
            ),
        )
        return clamped

    @staticmethod
    def _clamp(value: float, min_val: float, max_val: float) -> float:
        """Clamp a numeric value to [min_val, max_val]."""
        return max(min_val, min(value, max_val))


# ── Fraud Predictor ───────────────────────────────────────────────────────


class FraudPredictor:
    """
    Loads and serves fraud predictions from a trained sklearn model.

    Supports:
        - Lazy loading from local file or S3
        - Hot-reload without service restart
        - Ensemble scoring: ML model + rule-based fallback
        - Confidence intervals via tree variance estimation
        - Thread-safe model access
        - Batch prediction for bulk scoring

    If the model is missing or fails to load, returns fail-open result:
        { score: 0, action: "allow", model_available: False }
    """

    def __init__(
        self,
        model_path: str | None = None,
        s3_bucket: str | None = None,
        s3_key: str | None = None,
    ) -> None:
        """
        Initialize the FraudPredictor.

        Args:
            model_path: Local path to the serialized model file.
            s3_bucket: Optional S3 bucket to download model from.
            s3_key: Optional S3 object key for the model.
        """
        self._model: Any = None
        self._model_path = model_path or os.environ.get(
            "FRAUD_MODEL_PATH",
            os.path.join(os.path.dirname(__file__), "model.pkl"),
        )
        self._s3_bucket = s3_bucket or os.environ.get("AWS_S3_ANALYTICS_BUCKET")
        self._s3_key = s3_key or os.environ.get("MODEL_S3_KEY", "models/fraud/latest.pkl")
        self._attempted_load = False
        self._metadata = ModelMetadata()
        self._lock = threading.Lock()
        self._prediction_count = 0
        self._error_count = 0
        self._last_prediction_at: Optional[str] = None

    # ── Model Loading ─────────────────────────────────────────────────

    def _ensure_loaded(self) -> None:
        """
        Lazy-load the model on first prediction attempt.

        Tries local file first, then falls back to S3 download.
        Thread-safe: uses a lock to prevent concurrent loads.
        """
        if self._attempted_load:
            return

        with self._lock:
            # Double-check after acquiring lock
            if self._attempted_load:
                return

            self._attempted_load = True

            # Try local file first
            if os.path.exists(self._model_path):
                self._load_from_file(self._model_path)
                return

            # Try S3 if configured
            if self._s3_bucket and self._s3_key:
                logger.info(
                    "Model not found locally at %s — attempting S3 download",
                    self._model_path,
                )
                self._load_from_s3(self._s3_bucket, self._s3_key)
                return

            logger.warning(
                "Fraud model not found at %s and no S3 fallback configured — "
                "using fail-open mode",
                self._model_path,
            )

    def _load_from_file(self, path: str) -> bool:
        """
        Load a serialized model from a local file.

        Args:
            path: Filesystem path to the .pkl file.

        Returns:
            True if the model was loaded successfully, False otherwise.
        """
        try:
            with open(path, "rb") as f:
                data = f.read()

            file_hash = hashlib.sha256(data).hexdigest()[:16]
            self._model = pickle.loads(data)

            # Try to load companion metadata
            metadata_path = path.replace(".pkl", "_metadata.json")
            training_metrics: dict[str, Any] = {}
            trained_at = ""
            version = file_hash[:8]

            if os.path.exists(metadata_path):
                try:
                    with open(metadata_path, "r") as mf:
                        meta = json.load(mf)
                    training_metrics = meta.get("metrics", {})
                    trained_at = meta.get("trained_at", "")
                    version = meta.get("version", version)
                except Exception as meta_exc:
                    logger.debug("Could not load model metadata: %s", meta_exc)

            self._metadata = ModelMetadata(
                version=version,
                trained_at=trained_at,
                model_type=type(self._model).__name__,
                feature_version="v1",
                feature_count=11,
                source="local",
                file_path=path,
                file_hash=file_hash,
                loaded_at=datetime.now(timezone.utc).isoformat(),
                training_metrics=training_metrics,
            )

            logger.info(
                "Fraud model loaded from %s (hash=%s, type=%s)",
                path,
                file_hash,
                type(self._model).__name__,
            )
            return True

        except Exception as exc:
            logger.error("Failed to load fraud model from %s: %s", path, exc)
            self._model = None
            return False

    def _load_from_s3(self, bucket: str, key: str) -> bool:
        """
        Download and load a model from Amazon S3.

        Downloads to a temporary file, validates, then moves to the
        configured model path.

        Args:
            bucket: S3 bucket name.
            key: S3 object key.

        Returns:
            True if the model was downloaded and loaded successfully.
        """
        try:
            import boto3

            s3 = boto3.client("s3")
            logger.info("Downloading model from s3://%s/%s", bucket, key)

            # Download to temp file first to avoid partial writes
            with tempfile.NamedTemporaryFile(
                suffix=".pkl", delete=False
            ) as tmp:
                s3.download_fileobj(bucket, tmp, tmp.name)
                tmp_path = tmp.name

            # Validate by loading
            success = self._load_from_file(tmp_path)
            if success:
                # Move to configured model path
                Path(self._model_path).parent.mkdir(parents=True, exist_ok=True)
                os.replace(tmp_path, self._model_path)
                self._metadata.source = "s3"
                self._metadata.file_path = self._model_path
                logger.info(
                    "Model downloaded from S3 and saved to %s",
                    self._model_path,
                )
            else:
                os.unlink(tmp_path)

            return success

        except ImportError:
            logger.warning("boto3 not installed — cannot download model from S3")
            return False
        except Exception as exc:
            logger.error("S3 model download failed: %s", exc)
            return False

    # ── Properties ────────────────────────────────────────────────────

    @property
    def is_available(self) -> bool:
        """Check whether the ML model is loaded and ready for predictions."""
        self._ensure_loaded()
        return self._model is not None

    @property
    def metadata(self) -> ModelMetadata:
        """Get metadata about the currently loaded model."""
        self._ensure_loaded()
        return self._metadata

    @property
    def stats(self) -> dict[str, Any]:
        """Get prediction statistics for monitoring."""
        return {
            "prediction_count": self._prediction_count,
            "error_count": self._error_count,
            "last_prediction_at": self._last_prediction_at,
            "model_available": self._model is not None,
            "model_version": self._metadata.version,
        }

    # ── Single Prediction ─────────────────────────────────────────────

    def predict_from_features(self, features: FraudFeatures) -> dict[str, Any]:
        """
        Predict fraud score from extracted features.

        Performs an ensemble prediction:
            1. If ML model is available, get model probability
            2. Always compute rule-based score
            3. Combine via weighted average (model=0.7, rules=0.3) when
               model is available; pure rules otherwise

        Args:
            features: Extracted 11-dimensional feature vector.

        Returns:
            Dictionary with keys:
                score (int): 0-100 fraud risk score
                action (str): Recommended action
                model_available (bool): Whether ML model was used
                fraud_probability (float): Raw probability
                model_version (str): Version of the model used
                confidence_lower (float): Lower bound of 95% CI
                confidence_upper (float): Upper bound of 95% CI
                features_used (dict): Feature values used for prediction
                prediction_source (str): "model", "rules", or "ensemble"
        """
        self._ensure_loaded()
        self._prediction_count += 1
        self._last_prediction_at = datetime.now(timezone.utc).isoformat()

        # Normalize features
        normalized = FeatureNormalizer.normalize(features)
        features_dict = normalized.to_dict()

        # Rule-based score (always computed)
        rule_result = self._rule_based_predict(normalized)

        if self._model is None:
            return PredictionResult(
                score=rule_result["score"],
                action=rule_result["action"],
                model_available=False,
                fraud_probability=rule_result["fraud_probability"],
                model_version="rules-only",
                confidence_lower=max(0.0, rule_result["fraud_probability"] - 0.15),
                confidence_upper=min(1.0, rule_result["fraud_probability"] + 0.15),
                features_used=features_dict,
                prediction_source="rules",
            ).to_dict()

        try:
            X = np.array([normalized.to_vector()])
            proba = self._model.predict_proba(X)[0]
            fraud_probability = float(proba[1]) if len(proba) > 1 else float(proba[0])

            # Compute confidence interval from tree variance
            ci_lower, ci_upper = self._compute_confidence_interval(X, fraud_probability)

            # Ensemble: blend model and rule scores
            rule_probability = rule_result["fraud_probability"]
            ensemble_probability = 0.7 * fraud_probability + 0.3 * rule_probability
            ensemble_score = int(ensemble_probability * 100)
            ensemble_score = max(0, min(ensemble_score, 100))

            return PredictionResult(
                score=ensemble_score,
                action=self._score_to_action(ensemble_score),
                model_available=True,
                fraud_probability=round(ensemble_probability, 6),
                model_version=self._metadata.version,
                confidence_lower=ci_lower,
                confidence_upper=ci_upper,
                features_used=features_dict,
                prediction_source="ensemble",
            ).to_dict()

        except Exception as exc:
            self._error_count += 1
            logger.error(
                "Model prediction failed: %s — falling back to rules",
                exc,
                exc_info=True,
            )
            return PredictionResult(
                score=rule_result["score"],
                action=rule_result["action"],
                model_available=False,
                fraud_probability=rule_result["fraud_probability"],
                model_version="fallback",
                confidence_lower=max(0.0, rule_result["fraud_probability"] - 0.15),
                confidence_upper=min(1.0, rule_result["fraud_probability"] + 0.15),
                features_used=features_dict,
                prediction_source="rules_fallback",
            ).to_dict()

    # ── Batch Prediction ──────────────────────────────────────────────

    def predict_batch(
        self, features_list: list[FraudFeatures]
    ) -> list[dict[str, Any]]:
        """
        Score multiple transactions in a single batch.

        Uses vectorized model inference when the ML model is available
        for better throughput on large batches.

        Args:
            features_list: List of feature vectors to score.

        Returns:
            List of prediction result dictionaries, one per input.
        """
        if not features_list:
            return []

        self._ensure_loaded()

        # If no model, fall back to per-item rule scoring
        if self._model is None:
            return [self.predict_from_features(f) for f in features_list]

        try:
            # Normalize all features
            normalized_list = [FeatureNormalizer.normalize(f) for f in features_list]
            X = np.array([n.to_vector() for n in normalized_list])

            # Vectorized model prediction
            probas = self._model.predict_proba(X)
            fraud_probabilities = (
                probas[:, 1] if probas.shape[1] > 1 else probas[:, 0]
            )

            results: list[dict[str, Any]] = []
            for i, (normalized, fraud_prob) in enumerate(
                zip(normalized_list, fraud_probabilities)
            ):
                fraud_prob_float = float(fraud_prob)
                features_dict = normalized.to_dict()

                # Compute rule score for ensemble
                rule_result = self._rule_based_predict(normalized)
                rule_probability = rule_result["fraud_probability"]

                # Ensemble blend
                ensemble_prob = 0.7 * fraud_prob_float + 0.3 * rule_probability
                ensemble_score = max(0, min(int(ensemble_prob * 100), 100))

                # Confidence interval
                ci_lower, ci_upper = self._compute_confidence_interval(
                    X[i : i + 1], fraud_prob_float
                )

                results.append(
                    PredictionResult(
                        score=ensemble_score,
                        action=self._score_to_action(ensemble_score),
                        model_available=True,
                        fraud_probability=round(ensemble_prob, 6),
                        model_version=self._metadata.version,
                        confidence_lower=ci_lower,
                        confidence_upper=ci_upper,
                        features_used=features_dict,
                        prediction_source="ensemble_batch",
                    ).to_dict()
                )

            self._prediction_count += len(results)
            self._last_prediction_at = datetime.now(timezone.utc).isoformat()
            logger.info("Batch prediction completed: %d items", len(results))
            return results

        except Exception as exc:
            self._error_count += 1
            logger.error(
                "Batch prediction failed: %s — falling back to individual scoring",
                exc,
            )
            return [self.predict_from_features(f) for f in features_list]

    # ── Confidence Intervals ──────────────────────────────────────────

    def _compute_confidence_interval(
        self, X: np.ndarray, point_estimate: float
    ) -> tuple[float, float]:
        """
        Estimate a 95% confidence interval for the fraud probability.

        For GradientBoosting: uses variance across individual tree
        predictions (staged predictions) as an uncertainty measure.
        For other models: uses a fixed ±0.1 heuristic.

        Args:
            X: Input features as 2D numpy array (1, n_features).
            point_estimate: The model's point probability estimate.

        Returns:
            Tuple of (lower_bound, upper_bound), each in [0, 1].
        """
        try:
            if hasattr(self._model, "staged_predict_proba"):
                # Collect predictions from each stage (boosting iteration)
                stage_preds = []
                for stage_proba in self._model.staged_predict_proba(X):
                    if stage_proba.shape[1] > 1:
                        stage_preds.append(float(stage_proba[0, 1]))
                    else:
                        stage_preds.append(float(stage_proba[0, 0]))

                if len(stage_preds) > 10:
                    # Use the last 50% of stages for variance estimation
                    # (early stages are unreliable)
                    tail = stage_preds[len(stage_preds) // 2 :]
                    std = float(np.std(tail))
                    ci_lower = max(0.0, point_estimate - 1.96 * std)
                    ci_upper = min(1.0, point_estimate + 1.96 * std)
                    return ci_lower, ci_upper

            # Fallback: fixed margin
            ci_lower = max(0.0, point_estimate - 0.10)
            ci_upper = min(1.0, point_estimate + 0.10)
            return ci_lower, ci_upper

        except Exception as exc:
            logger.debug("Confidence interval computation failed: %s", exc)
            return max(0.0, point_estimate - 0.10), min(1.0, point_estimate + 0.10)

    # ── Rule-Based Fallback ───────────────────────────────────────────

    def _rule_based_predict(self, features: FraudFeatures) -> dict[str, Any]:
        """
        Rule-based fallback when the ML model is unavailable.

        Applies heuristic scoring based on known fraud risk indicators
        from the NEXUS domain:
            - New accounts with high-value transactions
            - Low verification / trust scores
            - Large price deviations from market average
            - Dispute history
            - Late-night transactions
            - New device fingerprints
            - First-time buyer/seller pairs

        Args:
            features: Normalized feature vector.

        Returns:
            Dictionary matching PredictionResult schema.
        """
        score = 0

        # New account with high transaction amount
        if features.user_account_age_days < 3 and features.transaction_amount > 2000:
            score += 30
        elif features.user_account_age_days < 7 and features.transaction_amount > 5000:
            score += 20
        elif features.user_account_age_days < 14 and features.transaction_amount > 8000:
            score += 15

        # Low verification + high amount
        if features.verification_level < 2 and features.transaction_amount > 3000:
            score += 20
        elif features.verification_level < 3 and features.transaction_amount > 7000:
            score += 10

        # Low trust score
        if features.trust_score < 1.0:
            score += 20
        elif features.trust_score < 1.5:
            score += 15
        elif features.trust_score < 2.5:
            score += 5

        # High price deviation from market average
        if features.price_deviation_pct > 1.0:
            score += 25
        elif features.price_deviation_pct > 0.8:
            score += 20
        elif features.price_deviation_pct > 0.5:
            score += 10

        # Buyer disputes history
        if features.buyer_prior_disputes >= 5:
            score += 30
        elif features.buyer_prior_disputes >= 3:
            score += 25
        elif features.buyer_prior_disputes >= 1:
            score += 10

        # Seller disputes history
        if features.seller_prior_disputes >= 3:
            score += 20
        elif features.seller_prior_disputes >= 2:
            score += 15
        elif features.seller_prior_disputes >= 1:
            score += 5

        # Night time risk
        if features.time_of_day_risk > 0.9:
            score += 15
        elif features.time_of_day_risk > 0.8:
            score += 10
        elif features.time_of_day_risk > 0.7:
            score += 5

        # First transaction between pair + new account
        if features.is_first_txn_between_pair == 1 and features.user_account_age_days < 7:
            score += 15
        elif features.is_first_txn_between_pair == 1:
            score += 5

        # New device fingerprint
        if features.device_fingerprint_age_days < 0.5:
            score += 15
        elif features.device_fingerprint_age_days < 1:
            score += 10
        elif features.device_fingerprint_age_days < 3:
            score += 5

        # Very new listing + high value (potential scam listing)
        if features.seller_listing_age_hours < 2 and features.transaction_amount > 3000:
            score += 10

        score = max(0, min(score, 100))

        return {
            "score": score,
            "action": self._score_to_action(score),
            "model_available": False,
            "fraud_probability": score / 100.0,
        }

    # ── Score → Action Mapping ────────────────────────────────────────

    @staticmethod
    def _score_to_action(score: int) -> str:
        """
        Map a fraud score (0-100) to a recommended action.

        Args:
            score: Fraud risk score.

        Returns:
            Action string: "allow", "allow_with_monitoring",
            "require_selfie_verification", or "block_pending_review".
        """
        if score < SCORE_ALLOW:
            return "allow"
        if score < SCORE_MONITOR:
            return "allow_with_monitoring"
        if score < SCORE_SELFIE:
            return "require_selfie_verification"
        return "block_pending_review"

    # ── Hot Reload ────────────────────────────────────────────────────

    def reload_model(self, source: str = "auto") -> bool:
        """
        Hot-reload the model without restarting the service.

        Supports multiple reload sources:
            - "auto": try local file, then S3
            - "local": reload from local file only
            - "s3": download fresh from S3

        Args:
            source: Where to load the model from.

        Returns:
            True if the model was reloaded successfully.
        """
        logger.info("Model hot-reload requested (source=%s)", source)

        with self._lock:
            old_model = self._model
            old_metadata = self._metadata
            self._model = None
            self._attempted_load = False

            success = False

            if source in ("auto", "local"):
                if os.path.exists(self._model_path):
                    success = self._load_from_file(self._model_path)

            if not success and source in ("auto", "s3"):
                if self._s3_bucket and self._s3_key:
                    success = self._load_from_s3(self._s3_bucket, self._s3_key)

            if not success:
                # Restore previous model if reload failed
                logger.warning("Model reload failed — restoring previous model")
                self._model = old_model
                self._metadata = old_metadata
                self._attempted_load = True

            return success

    def reload_from_bytes(self, model_bytes: bytes, version: str = "uploaded") -> bool:
        """
        Load a model from raw bytes (e.g., from an HTTP upload).

        Args:
            model_bytes: Serialized model as bytes (pickle format).
            version: Version string for the loaded model.

        Returns:
            True if the model was loaded successfully.
        """
        with self._lock:
            try:
                model = pickle.loads(model_bytes)
                file_hash = hashlib.sha256(model_bytes).hexdigest()[:16]

                # Validate it has predict_proba
                if not hasattr(model, "predict_proba"):
                    logger.error("Uploaded model does not have predict_proba method")
                    return False

                self._model = model
                self._metadata = ModelMetadata(
                    version=version,
                    trained_at=datetime.now(timezone.utc).isoformat(),
                    model_type=type(model).__name__,
                    source="upload",
                    file_hash=file_hash,
                    loaded_at=datetime.now(timezone.utc).isoformat(),
                )
                self._attempted_load = True

                logger.info(
                    "Model loaded from upload (version=%s, hash=%s)",
                    version,
                    file_hash,
                )
                return True

            except Exception as exc:
                logger.error("Failed to load model from bytes: %s", exc)
                return False


# ── Module-level Singleton ────────────────────────────────────────────────

_predictor: FraudPredictor | None = None
_predictor_lock = threading.Lock()


def get_predictor(model_path: str | None = None) -> FraudPredictor:
    """
    Get or create the singleton FraudPredictor instance.

    Thread-safe: uses a lock to prevent multiple instances from being
    created during concurrent startup.

    Args:
        model_path: Optional override for the model file path.

    Returns:
        The singleton FraudPredictor instance.
    """
    global _predictor
    if _predictor is None:
        with _predictor_lock:
            if _predictor is None:
                _predictor = FraudPredictor(model_path=model_path)
    return _predictor


def reset_predictor() -> None:
    """
    Reset the singleton predictor (primarily for testing).

    After calling this, the next call to ``get_predictor()`` will
    create a fresh instance.
    """
    global _predictor
    with _predictor_lock:
        _predictor = None
