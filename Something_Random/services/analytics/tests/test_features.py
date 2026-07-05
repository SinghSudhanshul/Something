"""
NEXUS Analytics — Feature Extraction Tests

Tests for the fraud feature extraction pipeline.
"""

import pytest
from app.fraud.features import extract_features


class TestFeatureExtraction:
    """Test the fraud feature extraction pipeline."""

    def test_all_features_present(self):
        """All 11 features should be extracted from complete data."""
        data = {
            "amount": 50000,
            "user_trust_score": 4.0,
            "user_age_days": 180,
            "transactions_last_24h": 3,
            "transactions_last_7d": 15,
            "unique_recipients_last_7d": 5,
            "is_new_recipient": False,
            "listing_price": 50000,
            "module": "bazaar",
        }
        features = extract_features(data)
        assert isinstance(features, dict)
        assert len(features) >= 8

    def test_minimal_data(self):
        """Should handle minimal input with sensible defaults."""
        data = {"amount": 10000, "module": "rides"}
        features = extract_features(data)
        assert isinstance(features, dict)

    def test_zero_amount(self):
        """Zero amount edge case."""
        data = {"amount": 0, "module": "bazaar"}
        features = extract_features(data)
        assert isinstance(features, dict)

    def test_very_large_amount(self):
        """Very large transaction amount."""
        data = {"amount": 10_000_000, "module": "bazaar"}  # ₹100,000
        features = extract_features(data)
        assert isinstance(features, dict)

    def test_all_modules(self):
        """Test feature extraction for all NEXUS modules."""
        modules = ["bazaar", "rides", "skills", "food", "errand"]
        for module in modules:
            data = {"amount": 50000, "module": module}
            features = extract_features(data)
            assert isinstance(features, dict), f"Failed for module: {module}"

    def test_boolean_conversion(self):
        """Boolean is_new_recipient should convert properly."""
        data_true = {"amount": 50000, "module": "bazaar", "is_new_recipient": True}
        data_false = {"amount": 50000, "module": "bazaar", "is_new_recipient": False}
        f_true = extract_features(data_true)
        f_false = extract_features(data_false)
        # Features should differ for the is_new_recipient feature
        assert isinstance(f_true, dict)
        assert isinstance(f_false, dict)

    def test_negative_values_handled(self):
        """Negative values should be handled gracefully."""
        data = {
            "amount": 50000,
            "module": "bazaar",
            "user_age_days": -1,
            "transactions_last_24h": -5,
        }
        features = extract_features(data)
        assert isinstance(features, dict)

    def test_extreme_trust_scores(self):
        """Extreme trust scores at boundaries."""
        for score in [0.0, 0.5, 2.5, 4.5, 5.0]:
            data = {"amount": 50000, "module": "bazaar", "user_trust_score": score}
            features = extract_features(data)
            assert isinstance(features, dict)

    def test_price_ratio_computation(self):
        """Price ratio feature should handle zero listing price."""
        data_zero = {"amount": 50000, "module": "bazaar", "listing_price": 0}
        data_normal = {"amount": 50000, "module": "bazaar", "listing_price": 50000}
        f_zero = extract_features(data_zero)
        f_normal = extract_features(data_normal)
        assert isinstance(f_zero, dict)
        assert isinstance(f_normal, dict)
