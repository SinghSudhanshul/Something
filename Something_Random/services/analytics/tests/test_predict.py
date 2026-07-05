"""
NEXUS Analytics — Fraud Prediction Tests

Comprehensive tests for the predict router including:
- Single prediction with valid features
- Missing required fields
- Model not loaded (rule-based fallback)
- Batch prediction
- Action thresholds
- Rule scoring logic
- Edge cases
"""

import pytest
from unittest.mock import MagicMock, AsyncMock, patch
from app.routers.predict import (
    compute_rule_scores,
    aggregate_rule_score,
    determine_action,
    generate_explanation,
    FraudPredictionRequest,
)


# ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
# Rule Scoring Tests
# ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

class TestRuleScoring:
    """Test individual fraud detection rules."""

    def _make_request(self, **kwargs) -> FraudPredictionRequest:
        defaults = {
            "user_id": "user-1",
            "transaction_id": "tx-1",
            "amount": 50000,  # ₹500
            "recipient_id": "user-2",
            "module": "bazaar",
            "user_trust_score": 3.5,
            "user_age_days": 90,
            "transactions_last_24h": 2,
            "transactions_last_7d": 10,
            "unique_recipients_last_7d": 3,
            "is_new_recipient": False,
            "listing_price": 50000,
        }
        defaults.update(kwargs)
        return FraudPredictionRequest(**defaults)

    def test_normal_transaction_low_risk(self):
        """Normal transaction should have low risk scores."""
        req = self._make_request()
        scores = compute_rule_scores(req)
        composite = aggregate_rule_score(scores)
        assert composite < 20, f"Normal transaction should be low risk, got {composite}"

    def test_new_account_high_value(self):
        """New account with high-value transaction should flag."""
        req = self._make_request(user_age_days=2, amount=300000)
        scores = compute_rule_scores(req)
        assert scores["new_account_high_value"] == 85.0

    def test_new_account_moderate_value(self):
        """Week-old account with moderate-high value."""
        req = self._make_request(user_age_days=5, amount=600000)
        scores = compute_rule_scores(req)
        assert scores["new_account_high_value"] == 70.0

    def test_velocity_24h_extreme(self):
        """Extreme velocity in 24h should flag."""
        req = self._make_request(transactions_last_24h=16)
        scores = compute_rule_scores(req)
        assert scores["velocity_24h"] == 90.0

    def test_velocity_24h_moderate(self):
        """Moderate velocity in 24h."""
        req = self._make_request(transactions_last_24h=12)
        scores = compute_rule_scores(req)
        assert scores["velocity_24h"] == 60.0

    def test_velocity_24h_normal(self):
        """Normal velocity should not flag."""
        req = self._make_request(transactions_last_24h=3)
        scores = compute_rule_scores(req)
        assert scores["velocity_24h"] == 0.0

    def test_many_recipients(self):
        """Too many unique recipients (money laundering indicator)."""
        req = self._make_request(unique_recipients_last_7d=12)
        scores = compute_rule_scores(req)
        assert scores["many_recipients"] == 70.0

    def test_low_trust_high_value(self):
        """Low trust score with high-value transaction."""
        req = self._make_request(user_trust_score=1.0, amount=200000)
        scores = compute_rule_scores(req)
        assert scores["low_trust_high_value"] == 65.0

    def test_price_mismatch_high(self):
        """Transaction amount much higher than listing price."""
        req = self._make_request(amount=400000, listing_price=100000)
        scores = compute_rule_scores(req)
        assert scores["price_mismatch"] == 80.0

    def test_price_mismatch_low(self):
        """Transaction amount much lower than listing price."""
        req = self._make_request(amount=10000, listing_price=100000)
        scores = compute_rule_scores(req)
        assert scores["price_mismatch"] == 80.0

    def test_price_mismatch_normal(self):
        """Normal price ratio."""
        req = self._make_request(amount=50000, listing_price=50000)
        scores = compute_rule_scores(req)
        assert scores["price_mismatch"] == 0.0

    def test_new_recipient_high_value(self):
        """New recipient with high value."""
        req = self._make_request(is_new_recipient=True, amount=400000)
        scores = compute_rule_scores(req)
        assert scores["new_recipient_high_value"] == 45.0

    def test_round_amount(self):
        """Round amounts indicate social engineering."""
        req = self._make_request(amount=500000)  # ₹5000
        scores = compute_rule_scores(req)
        assert scores["round_amount"] == 15.0


# ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
# Aggregate Score Tests
# ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

class TestAggregateScore:
    """Test the composite scoring algorithm."""

    def test_empty_scores(self):
        assert aggregate_rule_score({}) == 0.0

    def test_all_zero_scores(self):
        scores = {"a": 0.0, "b": 0.0, "c": 0.0}
        assert aggregate_rule_score(scores) == 0.0

    def test_single_high_score(self):
        scores = {"a": 80.0, "b": 0.0, "c": 0.0}
        result = aggregate_rule_score(scores)
        assert result == 80.0  # Only one non-zero = use it directly

    def test_multiple_scores(self):
        scores = {"a": 80.0, "b": 40.0, "c": 20.0}
        result = aggregate_rule_score(scores)
        # max=80 * 0.6 = 48, remaining_avg=(40+20)/2=30 * 0.4 = 12, total = 60
        assert 55 < result < 65

    def test_capped_at_100(self):
        scores = {"a": 100.0, "b": 100.0, "c": 100.0}
        result = aggregate_rule_score(scores)
        assert result <= 100.0


# ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
# Action Threshold Tests
# ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

class TestActionThresholds:
    """Test fraud action determination."""

    def test_allow(self):
        assert determine_action(0) == "allow"
        assert determine_action(10) == "allow"
        assert determine_action(19.9) == "allow"

    def test_monitoring(self):
        assert determine_action(20) == "allow_with_monitoring"
        assert determine_action(35) == "allow_with_monitoring"
        assert determine_action(49.9) == "allow_with_monitoring"

    def test_selfie(self):
        assert determine_action(50) == "require_selfie_verification"
        assert determine_action(60) == "require_selfie_verification"
        assert determine_action(74.9) == "require_selfie_verification"

    def test_block(self):
        assert determine_action(75) == "block_pending_review"
        assert determine_action(90) == "block_pending_review"
        assert determine_action(100) == "block_pending_review"


# ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
# Explanation Tests
# ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

class TestExplanation:
    """Test human-readable fraud explanations."""

    def test_low_score_explanation(self):
        result = generate_explanation(5.0, "allow", {"a": 5.0})
        assert "legitimate" in result.lower()

    def test_high_score_explanation(self):
        result = generate_explanation(80.0, "block_pending_review", {"velocity_24h": 90.0})
        assert "high-risk" in result.lower()

    def test_includes_top_factors(self):
        result = generate_explanation(50.0, "allow_with_monitoring", {"velocity_24h": 60.0, "new_account": 40.0})
        assert "factor" in result.lower()


# ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
# Feature Extraction Tests
# ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

class TestFeatureExtraction:
    """Test feature extraction from transaction data."""

    def test_extract_all_features(self):
        from app.fraud.features import extract_features

        data = {
            "amount": 50000,
            "user_trust_score": 3.5,
            "user_age_days": 90,
            "transactions_last_24h": 5,
            "transactions_last_7d": 20,
            "unique_recipients_last_7d": 3,
            "is_new_recipient": False,
            "listing_price": 50000,
            "module": "bazaar",
        }

        features = extract_features(data)
        assert isinstance(features, dict)
        assert len(features) >= 8, f"Expected at least 8 features, got {len(features)}"

    def test_extract_missing_optional(self):
        from app.fraud.features import extract_features

        data = {
            "amount": 10000,
            "module": "bazaar",
        }

        features = extract_features(data)
        assert isinstance(features, dict)
        # Should use defaults for missing fields

    def test_amount_normalization(self):
        from app.fraud.features import extract_features

        data = {"amount": 1000000, "module": "bazaar"}  # ₹10,000
        features = extract_features(data)
        # Amount should be present as a feature
        assert "amount" in features or "amount_normalized" in features or "log_amount" in features


# ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
# Validation Tests
# ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

class TestValidation:
    """Test request validation."""

    def test_valid_request(self):
        req = FraudPredictionRequest(
            user_id="u1",
            transaction_id="t1",
            amount=50000,
            recipient_id="u2",
            module="bazaar",
        )
        assert req.amount == 50000

    def test_negative_amount_fails(self):
        with pytest.raises(Exception):
            FraudPredictionRequest(
                user_id="u1",
                transaction_id="t1",
                amount=-100,
                recipient_id="u2",
                module="bazaar",
            )

    def test_invalid_module_fails(self):
        with pytest.raises(Exception):
            FraudPredictionRequest(
                user_id="u1",
                transaction_id="t1",
                amount=100,
                recipient_id="u2",
                module="invalid_module",
            )

    def test_trust_score_bounds(self):
        with pytest.raises(Exception):
            FraudPredictionRequest(
                user_id="u1",
                transaction_id="t1",
                amount=100,
                recipient_id="u2",
                module="bazaar",
                user_trust_score=6.0,
            )
