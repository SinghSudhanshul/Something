"""
Fraud Feature Extraction — 11-dimensional feature vector for transaction fraud scoring.

Features match the Phase 1 specification exactly. All features have safe defaults
for graceful degradation when upstream data is unavailable.
"""

import math
import logging
from dataclasses import dataclass, asdict
from datetime import datetime, timezone
from typing import Any

logger = logging.getLogger("nexus.analytics.fraud.features")


@dataclass
class FraudFeatures:
    """11-dimensional feature vector for fraud prediction."""
    user_account_age_days: float = 0.0
    verification_level: int = 0
    trust_score: float = 2.50
    transaction_amount: float = 0.0
    price_deviation_pct: float = 0.0
    seller_listing_age_hours: float = 0.0
    buyer_prior_disputes: int = 0
    seller_prior_disputes: int = 0
    is_first_txn_between_pair: int = 0
    device_fingerprint_age_days: float = 0.0
    time_of_day_risk: float = 0.0

    def to_vector(self) -> list[float]:
        """Convert to ordered float vector for model input."""
        return [
            self.user_account_age_days,
            float(self.verification_level),
            self.trust_score,
            self.transaction_amount,
            self.price_deviation_pct,
            self.seller_listing_age_hours,
            float(self.buyer_prior_disputes),
            float(self.seller_prior_disputes),
            float(self.is_first_txn_between_pair),
            self.device_fingerprint_age_days,
            self.time_of_day_risk,
        ]

    def to_dict(self) -> dict[str, Any]:
        return asdict(self)


def compute_time_of_day_risk(dt: datetime | None = None) -> float:
    """
    Sinusoidal risk score: peak at 03:00 IST (1.0), trough at 15:00 IST (0.0).

    Uses a cosine curve centered at 03:00 hours:
      risk = (cos((hour - 3) * π / 12) + 1) / 2

    This gives:
      03:00 → 1.0 (highest risk)
      09:00 → 0.5
      15:00 → 0.0 (lowest risk)
      21:00 → 0.5
    """
    if dt is None:
        dt = datetime.now(timezone.utc)

    # Convert to IST (UTC + 5:30)
    from datetime import timedelta
    ist = dt + timedelta(hours=5, minutes=30)
    hour = ist.hour + ist.minute / 60.0

    risk = (math.cos((hour - 3) * math.pi / 12) + 1) / 2
    return round(risk, 4)


async def extract_features(
    transaction_data: dict[str, Any],
    pg_pool: Any = None,
) -> FraudFeatures:
    """
    Extract 11 fraud features from transaction data and PostgreSQL context.

    Handles missing data gracefully — never raises on a missing field, uses safe defaults.
    """
    features = FraudFeatures()

    # Direct fields from transaction payload
    features.transaction_amount = _safe_float(transaction_data.get("amount", 0)) / 100  # paise → rupees
    features.is_first_txn_between_pair = 1 if transaction_data.get("is_first_txn", False) else 0

    # Time-of-day risk
    created_str = transaction_data.get("created_at")
    if created_str:
        try:
            created_dt = datetime.fromisoformat(str(created_str).replace("Z", "+00:00"))
            features.time_of_day_risk = compute_time_of_day_risk(created_dt)
        except (ValueError, TypeError):
            features.time_of_day_risk = compute_time_of_day_risk()
    else:
        features.time_of_day_risk = compute_time_of_day_risk()

    # Database-enriched features
    if pg_pool is None:
        logger.debug("No PG pool — using default feature values")
        return features

    buyer_id = transaction_data.get("buyer_id")
    seller_id = transaction_data.get("seller_id")
    listing_id = transaction_data.get("listing_id")

    try:
        # Buyer profile features
        if buyer_id:
            row = await _query_one(pg_pool,
                """SELECT
                    EXTRACT(EPOCH FROM NOW() - u.created_at) / 86400.0 AS account_age_days,
                    sp.verification_level,
                    sp.trust_score,
                    COALESCE(sp.device_fingerprint_created_at, u.created_at) AS device_created_at
                FROM users u
                LEFT JOIN student_profiles sp ON sp.user_id = u.id
                WHERE u.id = $1""",
                buyer_id,
            )
            if row:
                features.user_account_age_days = _safe_float(row.get("account_age_days", 0))
                features.verification_level = int(row.get("verification_level", 0) or 0)
                features.trust_score = _safe_float(row.get("trust_score", 2.50))
                device_created = row.get("device_created_at")
                if device_created:
                    try:
                        age = (datetime.now(timezone.utc) - device_created).total_seconds() / 86400.0
                        features.device_fingerprint_age_days = max(0, age)
                    except (TypeError, AttributeError):
                        pass

        # Buyer disputes
        if buyer_id:
            disputes = await _query_one(pg_pool,
                "SELECT COUNT(*) AS cnt FROM disputes WHERE user_id = $1",
                buyer_id,
            )
            if disputes:
                features.buyer_prior_disputes = int(disputes.get("cnt", 0) or 0)

        # Seller disputes
        if seller_id:
            disputes = await _query_one(pg_pool,
                "SELECT COUNT(*) AS cnt FROM disputes WHERE user_id = $1",
                seller_id,
            )
            if disputes:
                features.seller_prior_disputes = int(disputes.get("cnt", 0) or 0)

        # Listing age & price deviation
        if listing_id:
            listing = await _query_one(pg_pool,
                """SELECT
                    EXTRACT(EPOCH FROM NOW() - created_at) / 3600.0 AS listing_age_hours,
                    price_in_paise,
                    category
                FROM listings WHERE id = $1""",
                listing_id,
            )
            if listing:
                features.seller_listing_age_hours = _safe_float(listing.get("listing_age_hours", 0))
                listing_price = _safe_float(listing.get("price_in_paise", 0))

                # Price deviation from category average
                if listing.get("category") and listing_price > 0:
                    avg = await _query_one(pg_pool,
                        "SELECT AVG(price_in_paise)::float AS avg_price FROM listings WHERE category = $1 AND status = 'active'",
                        listing["category"],
                    )
                    if avg and avg.get("avg_price"):
                        avg_price = _safe_float(avg["avg_price"])
                        if avg_price > 0:
                            features.price_deviation_pct = (listing_price - avg_price) / avg_price

        # First transaction between this pair
        if buyer_id and seller_id:
            prior = await _query_one(pg_pool,
                """SELECT COUNT(*) AS cnt FROM transactions
                WHERE buyer_id = $1 AND seller_id = $2
                AND id != COALESCE($3::uuid, '00000000-0000-0000-0000-000000000000'::uuid)""",
                buyer_id, seller_id, transaction_data.get("transaction_id"),
            )
            if prior:
                features.is_first_txn_between_pair = 1 if int(prior.get("cnt", 0) or 0) == 0 else 0

    except Exception as exc:
        logger.warning("Feature extraction partially failed (using defaults): %s", exc)

    return features


# ── Helpers ───────────────────────────────────────────────────────────────

def _safe_float(val: Any) -> float:
    """Safely convert a value to float, defaulting to 0.0."""
    try:
        return float(val) if val is not None else 0.0
    except (ValueError, TypeError):
        return 0.0


async def _query_one(pool: Any, sql: str, *args: Any) -> dict[str, Any] | None:
    """Execute a query and return the first row as a dict, or None."""
    try:
        # Support both asyncpg pool and pg.Pool
        if hasattr(pool, "fetchrow"):
            row = await pool.fetchrow(sql, *args)
            return dict(row) if row else None
        else:
            # Fallback for sync pg.Pool
            import asyncio
            loop = asyncio.get_event_loop()
            conn = pool.connect() if callable(getattr(pool, "connect", None)) else None
            if conn is None:
                return None
            # Synchronous fallback not recommended in prod
            return None
    except Exception as exc:
        logger.debug("Query failed: %s", exc)
        return None
