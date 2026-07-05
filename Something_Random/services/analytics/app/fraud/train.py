"""
Fraud Model Training Pipeline
==============================

Full offline training pipeline for the NEXUS fraud detection model.

NOT imported by the HTTP service — training and inference are fully
decoupled. Run standalone as:

    python -m app.fraud.train

Pipeline stages:
    1. Data loading from PostgreSQL (or synthetic fallback)
    2. Feature engineering matching features.py schema
    3. Train/test split with stratified sampling
    4. GradientBoostingClassifier training
    5. Cross-validation with ROC AUC scoring
    6. Holdout evaluation (precision, recall, F1, AUC)
    7. Model serialization with joblib/pickle
    8. S3 upload with versioned keys
    9. Training history persistence

The pipeline produces:
    - model.pkl — serialized sklearn model
    - model_metadata.json — version, metrics, feature importance
    - training_history.json — append-only log of all training runs
"""

from __future__ import annotations

import json
import logging
import os
import pickle
import sys
import time
from datetime import datetime, timezone
from pathlib import Path
from typing import Any, Optional
from uuid import uuid4

import numpy as np

logger = logging.getLogger("nexus.analytics.fraud.train")
logging.basicConfig(
    level=logging.INFO,
    format="%(asctime)s [%(name)s] %(levelname)s: %(message)s",
)

# Feature names — MUST match features.py field ordering exactly
FEATURE_NAMES = [
    "user_account_age_days",
    "verification_level",
    "trust_score",
    "transaction_amount",
    "price_deviation_pct",
    "seller_listing_age_hours",
    "buyer_prior_disputes",
    "seller_prior_disputes",
    "is_first_txn_between_pair",
    "device_fingerprint_age_days",
    "time_of_day_risk",
]


# ── Data Loading ──────────────────────────────────────────────────────────


def load_data_from_postgres(
    database_url: str,
    min_samples: int = 1000,
) -> tuple[np.ndarray, np.ndarray] | None:
    """
    Load labeled transaction data from PostgreSQL for training.

    Queries the transactions table joined with fraud_labels to build
    the training dataset. Falls back to None if the database is
    unreachable or has insufficient labeled data.

    Args:
        database_url: PostgreSQL connection string.
        min_samples: Minimum number of labeled samples required.

    Returns:
        Tuple of (X, y) numpy arrays, or None if loading failed.
    """
    try:
        import psycopg2
        import psycopg2.extras
    except ImportError:
        logger.warning(
            "psycopg2 not installed — cannot load data from PostgreSQL. "
            "Install with: pip install psycopg2-binary"
        )
        return None

    # Normalize scheme for psycopg2
    dsn = database_url
    if dsn.startswith("postgres://"):
        dsn = dsn.replace("postgres://", "postgresql://", 1)

    try:
        conn = psycopg2.connect(dsn)
        cur = conn.cursor(cursor_factory=psycopg2.extras.DictCursor)

        # Check labeled data count
        cur.execute(
            """
            SELECT COUNT(*) AS cnt
            FROM transactions t
            INNER JOIN fraud_labels fl ON fl.transaction_id = t.id
            WHERE fl.label IS NOT NULL
            """
        )
        row = cur.fetchone()
        count = int(row["cnt"]) if row else 0

        if count < min_samples:
            logger.warning(
                "Only %d labeled samples in database (minimum: %d) — "
                "falling back to synthetic data",
                count,
                min_samples,
            )
            cur.close()
            conn.close()
            return None

        logger.info("Loading %d labeled transactions from PostgreSQL", count)

        cur.execute(
            """
            SELECT
                EXTRACT(EPOCH FROM t.created_at - u.created_at) / 86400.0
                    AS user_account_age_days,
                COALESCE(sp.verification_level, 0) AS verification_level,
                COALESCE(sp.trust_score, 2.5) AS trust_score,
                t.amount_in_paise / 100.0 AS transaction_amount,
                COALESCE(
                    (t.amount_in_paise - cat_avg.avg_price) / NULLIF(cat_avg.avg_price, 0),
                    0.0
                ) AS price_deviation_pct,
                COALESCE(
                    EXTRACT(EPOCH FROM t.created_at - l.created_at) / 3600.0,
                    0.0
                ) AS seller_listing_age_hours,
                COALESCE(bd.dispute_count, 0) AS buyer_prior_disputes,
                COALESCE(sd.dispute_count, 0) AS seller_prior_disputes,
                CASE WHEN prior_txn.cnt = 0 THEN 1 ELSE 0 END
                    AS is_first_txn_between_pair,
                COALESCE(
                    EXTRACT(EPOCH FROM t.created_at - dfl.created_at) / 86400.0,
                    30.0
                ) AS device_fingerprint_age_days,
                0.0 AS time_of_day_risk,
                fl.label AS is_fraud
            FROM transactions t
            INNER JOIN fraud_labels fl ON fl.transaction_id = t.id
            LEFT JOIN users u ON u.id = t.buyer_id
            LEFT JOIN student_profiles sp ON sp.user_id = t.buyer_id
            LEFT JOIN listings l ON l.id = t.listing_id
            LEFT JOIN LATERAL (
                SELECT AVG(price_in_paise) AS avg_price
                FROM listings l2
                WHERE l2.category = l.category AND l2.status = 'active'
            ) cat_avg ON TRUE
            LEFT JOIN LATERAL (
                SELECT COUNT(*) AS dispute_count
                FROM disputes d WHERE d.user_id = t.buyer_id
                AND d.created_at < t.created_at
            ) bd ON TRUE
            LEFT JOIN LATERAL (
                SELECT COUNT(*) AS dispute_count
                FROM disputes d WHERE d.user_id = t.seller_id
                AND d.created_at < t.created_at
            ) sd ON TRUE
            LEFT JOIN LATERAL (
                SELECT COUNT(*) AS cnt
                FROM transactions t2
                WHERE t2.buyer_id = t.buyer_id
                  AND t2.seller_id = t.seller_id
                  AND t2.id != t.id
                  AND t2.created_at < t.created_at
            ) prior_txn ON TRUE
            LEFT JOIN device_fingerprints dfl
                ON dfl.user_id = t.buyer_id
            WHERE fl.label IS NOT NULL
            ORDER BY t.created_at
            """
        )

        rows = cur.fetchall()
        cur.close()
        conn.close()

        if not rows:
            logger.warning("Query returned 0 rows — falling back to synthetic data")
            return None

        X = np.zeros((len(rows), len(FEATURE_NAMES)), dtype=np.float64)
        y = np.zeros(len(rows), dtype=int)

        for i, row in enumerate(rows):
            for j, feat_name in enumerate(FEATURE_NAMES):
                val = row.get(feat_name, 0.0)
                X[i, j] = float(val) if val is not None else 0.0

            # Compute time-of-day risk from the hour
            # (simplified — production would use the full cosine function)
            y[i] = 1 if row.get("is_fraud") else 0

        logger.info(
            "Loaded %d samples from PostgreSQL (%d fraud, %.1f%%)",
            len(y),
            int(np.sum(y)),
            float(np.mean(y)) * 100,
        )
        return X, y

    except Exception as exc:
        logger.error("PostgreSQL data loading failed: %s", exc)
        return None


def generate_synthetic_data(
    n_samples: int = 5000,
    fraud_rate: float = 0.08,
    random_seed: int = 42,
) -> tuple[np.ndarray, np.ndarray]:
    """
    Generate synthetic training data for development and testing.

    Produces realistic feature distributions that mirror the NEXUS
    campus marketplace domain. Fraudulent transactions exhibit
    characteristic patterns: newer accounts, lower verification,
    higher amounts, and unusual timing.

    In production, replace this with load_data_from_postgres().

    Args:
        n_samples: Total number of samples to generate.
        fraud_rate: Fraction of samples that are fraudulent (0.0 - 1.0).
        random_seed: Random seed for reproducibility.

    Returns:
        Tuple of (X, y):
            X: (n_samples, 11) feature array
            y: (n_samples,) label array (0=legitimate, 1=fraud)
    """
    rng = np.random.default_rng(random_seed)

    X = np.zeros((n_samples, len(FEATURE_NAMES)), dtype=np.float64)
    y = np.zeros(n_samples, dtype=int)

    for i in range(n_samples):
        is_fraud = rng.random() < fraud_rate

        if is_fraud:
            X[i] = [
                rng.uniform(0, 30),         # new account
                rng.integers(0, 2),          # low verification
                rng.uniform(0.0, 2.0),       # low trust
                rng.uniform(500, 10000),     # higher amount
                rng.uniform(0.3, 2.0),       # high price deviation
                rng.uniform(0, 24),          # recent listing
                rng.integers(0, 5),          # buyer disputes
                rng.integers(0, 3),          # seller disputes
                1 if rng.random() < 0.7 else 0,  # likely first txn
                rng.uniform(0, 7),           # new device
                rng.uniform(0.5, 1.0),       # late night
            ]
            y[i] = 1
        else:
            X[i] = [
                rng.uniform(30, 730),        # established account
                rng.integers(1, 5),          # verified
                rng.uniform(2.5, 5.0),       # decent trust
                rng.uniform(10, 5000),       # normal amount
                rng.uniform(-0.3, 0.3),      # normal price
                rng.uniform(24, 8760),       # aged listing
                rng.integers(0, 2),          # few disputes
                rng.integers(0, 1),          # seller clean
                1 if rng.random() < 0.3 else 0,  # maybe first txn
                rng.uniform(30, 365),        # established device
                rng.uniform(0.0, 0.5),       # daytime
            ]
            y[i] = 0

    fraud_count = int(np.sum(y))
    logger.info(
        "Generated %d synthetic samples (%d fraud, %.1f%%)",
        n_samples,
        fraud_count,
        fraud_count / n_samples * 100,
    )

    return X, y


# ── Feature Engineering ───────────────────────────────────────────────────


def engineer_features(X: np.ndarray) -> np.ndarray:
    """
    Apply feature engineering transformations to raw features.

    Adds derived features that capture interaction effects and
    non-linear patterns the tree model can exploit more effectively.

    Current transformations are in-place (no new columns) to maintain
    compatibility with the 11-feature schema used by features.py.

    Future versions may add polynomial interactions as extra columns
    (requires features.py schema v2).

    Args:
        X: Raw feature array of shape (n_samples, 11).

    Returns:
        Transformed feature array (same shape).
    """
    X_eng = X.copy()

    # Log-transform highly skewed features (account age, amount)
    # Use log1p to handle zeros safely
    X_eng[:, 0] = np.log1p(X_eng[:, 0])  # user_account_age_days
    X_eng[:, 3] = np.log1p(X_eng[:, 3])  # transaction_amount
    X_eng[:, 5] = np.log1p(X_eng[:, 5])  # seller_listing_age_hours
    X_eng[:, 9] = np.log1p(X_eng[:, 9])  # device_fingerprint_age_days

    return X_eng


def validate_data(X: np.ndarray, y: np.ndarray) -> bool:
    """
    Validate training data for common issues.

    Checks for NaN/Inf values, minimum sample count, class balance,
    and feature dimensionality.

    Args:
        X: Feature array.
        y: Label array.

    Returns:
        True if data passes all validation checks.
    """
    issues: list[str] = []

    if X.shape[0] == 0:
        issues.append("Empty dataset (0 samples)")

    if X.shape[1] != len(FEATURE_NAMES):
        issues.append(
            f"Expected {len(FEATURE_NAMES)} features, got {X.shape[1]}"
        )

    if X.shape[0] != y.shape[0]:
        issues.append(
            f"X has {X.shape[0]} rows but y has {y.shape[0]} elements"
        )

    nan_count = int(np.isnan(X).sum())
    if nan_count > 0:
        issues.append(f"Found {nan_count} NaN values in features")

    inf_count = int(np.isinf(X).sum())
    if inf_count > 0:
        issues.append(f"Found {inf_count} Inf values in features")

    unique_labels = set(np.unique(y))
    if unique_labels != {0, 1}:
        issues.append(f"Expected labels {{0, 1}}, got {unique_labels}")

    fraud_rate = float(np.mean(y))
    if fraud_rate < 0.001:
        issues.append(f"Fraud rate too low ({fraud_rate:.4f}) — model will not learn")
    if fraud_rate > 0.5:
        issues.append(
            f"Fraud rate suspiciously high ({fraud_rate:.4f}) — check label quality"
        )

    if issues:
        for issue in issues:
            logger.error("Data validation failed: %s", issue)
        return False

    logger.info(
        "Data validation passed: %d samples, %d features, %.1f%% fraud rate",
        X.shape[0],
        X.shape[1],
        fraud_rate * 100,
    )
    return True


# ── Training ──────────────────────────────────────────────────────────────


def train_model(
    X: np.ndarray,
    y: np.ndarray,
    n_estimators: int = 200,
    max_depth: int = 4,
    learning_rate: float = 0.05,
    cv_folds: int = 5,
    apply_feature_engineering: bool = True,
) -> dict[str, Any]:
    """
    Train a GradientBoostingClassifier and evaluate on holdout + cross-validation.

    Performs stratified train/test split to preserve class ratios, runs
    k-fold cross-validation for robust AUC estimation, then trains a
    final model on the full training set for deployment.

    Args:
        X: Feature array (n_samples, n_features).
        y: Label array (n_samples,).
        n_estimators: Number of boosting stages.
        max_depth: Maximum tree depth per stage.
        learning_rate: Shrinkage applied to each tree.
        cv_folds: Number of cross-validation folds.
        apply_feature_engineering: Whether to apply feature transforms.

    Returns:
        Dictionary containing:
            model: Trained sklearn model
            metrics: Evaluation metrics dict
            feature_importances: Sorted list of (name, importance) tuples
            cv_scores: Cross-validation AUC scores
    """
    from sklearn.ensemble import GradientBoostingClassifier
    from sklearn.model_selection import (
        StratifiedKFold,
        cross_val_score,
        train_test_split,
    )
    from sklearn.metrics import (
        classification_report,
        confusion_matrix,
        f1_score,
        precision_recall_curve,
        precision_score,
        recall_score,
        roc_auc_score,
    )

    # Optionally apply feature engineering
    if apply_feature_engineering:
        X = engineer_features(X)

    # Validate data
    if not validate_data(X, y):
        raise ValueError("Training data validation failed — see logs for details")

    # Stratified train/test split
    X_train, X_test, y_train, y_test = train_test_split(
        X, y, test_size=0.20, random_state=42, stratify=y,
    )

    logger.info(
        "Training set: %d samples (%d fraud, %.1f%%)",
        len(y_train),
        int(np.sum(y_train)),
        float(np.mean(y_train)) * 100,
    )
    logger.info(
        "Test set: %d samples (%d fraud, %.1f%%)",
        len(y_test),
        int(np.sum(y_test)),
        float(np.mean(y_test)) * 100,
    )

    # Initialize model
    model = GradientBoostingClassifier(
        n_estimators=n_estimators,
        max_depth=max_depth,
        learning_rate=learning_rate,
        min_samples_split=10,
        min_samples_leaf=5,
        subsample=0.8,
        max_features="sqrt",
        random_state=42,
    )

    # Cross-validation on training set
    logger.info(
        "Running %d-fold stratified cross-validation...", cv_folds
    )
    cv = StratifiedKFold(n_splits=cv_folds, shuffle=True, random_state=42)
    cv_scores = cross_val_score(
        model, X_train, y_train, cv=cv, scoring="roc_auc", n_jobs=-1,
    )
    logger.info(
        "Cross-validation AUC: %.4f ± %.4f (folds: %s)",
        float(np.mean(cv_scores)),
        float(np.std(cv_scores)),
        ", ".join(f"{s:.4f}" for s in cv_scores),
    )

    # Train final model on full training set
    logger.info(
        "Training GradientBoostingClassifier "
        "(n_estimators=%d, max_depth=%d, lr=%.3f)...",
        n_estimators,
        max_depth,
        learning_rate,
    )
    train_start = time.time()
    model.fit(X_train, y_train)
    train_duration = time.time() - train_start
    logger.info("Training completed in %.1f seconds", train_duration)

    # Holdout evaluation
    y_pred = model.predict(X_test)
    y_prob = model.predict_proba(X_test)[:, 1]

    precision = float(precision_score(y_test, y_pred, zero_division=0))
    recall = float(recall_score(y_test, y_pred, zero_division=0))
    f1 = float(f1_score(y_test, y_pred, zero_division=0))
    auc_roc = float(roc_auc_score(y_test, y_prob))

    # Confusion matrix
    cm = confusion_matrix(y_test, y_pred)
    tn, fp, fn, tp = cm.ravel()

    # Optimal threshold analysis
    precisions, recalls, thresholds = precision_recall_curve(y_test, y_prob)
    f1_scores = 2 * (precisions * recalls) / (precisions + recalls + 1e-8)
    optimal_threshold_idx = int(np.argmax(f1_scores))
    optimal_threshold = float(thresholds[optimal_threshold_idx]) if optimal_threshold_idx < len(thresholds) else 0.5

    metrics = {
        "precision": round(precision, 4),
        "recall": round(recall, 4),
        "f1": round(f1, 4),
        "auc_roc": round(auc_roc, 4),
        "cv_auc_mean": round(float(np.mean(cv_scores)), 4),
        "cv_auc_std": round(float(np.std(cv_scores)), 4),
        "train_samples": len(y_train),
        "test_samples": len(y_test),
        "fraud_rate": round(float(np.mean(y)), 4),
        "true_positives": int(tp),
        "true_negatives": int(tn),
        "false_positives": int(fp),
        "false_negatives": int(fn),
        "optimal_threshold": round(optimal_threshold, 4),
        "train_duration_seconds": round(train_duration, 2),
        "n_estimators": n_estimators,
        "max_depth": max_depth,
        "learning_rate": learning_rate,
    }

    # Log results
    logger.info("=" * 60)
    logger.info("Model Evaluation Results:")
    logger.info("  Precision:         %.4f", precision)
    logger.info("  Recall:            %.4f", recall)
    logger.info("  F1:                %.4f", f1)
    logger.info("  AUC-ROC:           %.4f", auc_roc)
    logger.info("  CV AUC:            %.4f ± %.4f", float(np.mean(cv_scores)), float(np.std(cv_scores)))
    logger.info("  Optimal threshold: %.4f", optimal_threshold)
    logger.info("  Confusion Matrix:  TP=%d TN=%d FP=%d FN=%d", tp, tn, fp, fn)
    logger.info("  Train duration:    %.1fs", train_duration)
    logger.info("=" * 60)

    report = classification_report(
        y_test, y_pred, target_names=["legitimate", "fraud"]
    )
    logger.info("\n%s", report)

    # Feature importance
    importances = sorted(
        zip(FEATURE_NAMES, model.feature_importances_),
        key=lambda x: x[1],
        reverse=True,
    )
    logger.info("Feature Importance:")
    for name, importance in importances:
        logger.info("  %-30s %.4f", name, importance)

    return {
        "model": model,
        "metrics": metrics,
        "feature_importances": importances,
        "cv_scores": [round(float(s), 4) for s in cv_scores],
    }


# ── Model Persistence ─────────────────────────────────────────────────────


def save_model(
    model: object,
    output_path: str,
    metrics: Optional[dict[str, Any]] = None,
    version: Optional[str] = None,
) -> dict[str, str]:
    """
    Serialize and save the trained model along with metadata.

    Creates two files:
        1. <output_path> — pickle-serialized model
        2. <output_path without .pkl>_metadata.json — training metadata

    Args:
        model: Trained sklearn model to serialize.
        output_path: Destination path for the .pkl file.
        metrics: Optional training metrics to include in metadata.
        version: Optional version string. If None, uses timestamp.

    Returns:
        Dictionary with paths: {"model": ..., "metadata": ...}
    """
    Path(output_path).parent.mkdir(parents=True, exist_ok=True)

    # Serialize model
    with open(output_path, "wb") as f:
        pickle.dump(model, f, protocol=pickle.HIGHEST_PROTOCOL)

    model_size = os.path.getsize(output_path)
    logger.info("Model saved to: %s (%.1f KB)", output_path, model_size / 1024)

    # Try joblib as well for better numpy array serialization
    joblib_path = output_path.replace(".pkl", ".joblib")
    try:
        import joblib
        joblib.dump(model, joblib_path, compress=3)
        joblib_size = os.path.getsize(joblib_path)
        logger.info(
            "Model also saved with joblib to: %s (%.1f KB)",
            joblib_path,
            joblib_size / 1024,
        )
    except ImportError:
        logger.debug("joblib not available — skipping joblib serialization")
    except Exception as exc:
        logger.warning("joblib serialization failed: %s", exc)

    # Save metadata
    version = version or datetime.now(timezone.utc).strftime("%Y%m%d_%H%M%S")
    metadata_path = output_path.replace(".pkl", "_metadata.json")
    metadata = {
        "version": version,
        "trained_at": datetime.now(timezone.utc).isoformat(),
        "model_type": type(model).__name__,
        "feature_version": "v1",
        "feature_names": FEATURE_NAMES,
        "feature_count": len(FEATURE_NAMES),
        "model_size_bytes": model_size,
        "python_version": sys.version,
        "metrics": metrics or {},
    }

    with open(metadata_path, "w") as f:
        json.dump(metadata, f, indent=2, default=str)
    logger.info("Metadata saved to: %s", metadata_path)

    return {"model": output_path, "metadata": metadata_path}


def upload_to_s3(
    local_path: str,
    bucket: str,
    key: str,
    versioned: bool = True,
) -> dict[str, Any]:
    """
    Upload model artifacts to Amazon S3.

    Optionally uploads both a "latest" key and a timestamped versioned
    key to support rollback.

    Args:
        local_path: Local file path to upload.
        bucket: S3 bucket name.
        key: S3 object key (e.g., "models/fraud/latest.pkl").
        versioned: Whether to also upload a timestamped copy.

    Returns:
        Dictionary with upload results: {"latest": ..., "versioned": ...}
    """
    result: dict[str, Any] = {"success": False, "latest_key": key}

    try:
        import boto3
        s3 = boto3.client("s3")

        # Upload to "latest" key
        s3.upload_file(local_path, bucket, key)
        logger.info("Model uploaded to s3://%s/%s", bucket, key)
        result["success"] = True

        # Upload versioned copy
        if versioned:
            ts = datetime.now(timezone.utc).strftime("%Y%m%d_%H%M%S")
            base, ext = os.path.splitext(key)
            versioned_key = f"{base}_{ts}{ext}"
            s3.upload_file(local_path, bucket, versioned_key)
            logger.info(
                "Versioned model uploaded to s3://%s/%s", bucket, versioned_key
            )
            result["versioned_key"] = versioned_key

        # Also upload metadata if it exists
        metadata_path = local_path.replace(".pkl", "_metadata.json")
        if os.path.exists(metadata_path):
            metadata_key = key.replace(".pkl", "_metadata.json")
            s3.upload_file(metadata_path, bucket, metadata_key)
            logger.info(
                "Metadata uploaded to s3://%s/%s", bucket, metadata_key
            )
            result["metadata_key"] = metadata_key

        return result

    except ImportError:
        logger.warning("boto3 not installed — skipping S3 upload")
        result["error"] = "boto3 not installed"
        return result
    except Exception as exc:
        logger.error("S3 upload failed: %s", exc)
        result["error"] = str(exc)
        return result


# ── Training History ──────────────────────────────────────────────────────


def load_training_history(history_path: str) -> list[dict[str, Any]]:
    """
    Load the training history log from disk.

    Args:
        history_path: Path to the JSON history file.

    Returns:
        List of past training run records.
    """
    if not os.path.exists(history_path):
        return []

    try:
        with open(history_path, "r") as f:
            return json.load(f)
    except Exception as exc:
        logger.warning("Failed to load training history: %s", exc)
        return []


def append_training_history(
    history_path: str,
    run_record: dict[str, Any],
) -> None:
    """
    Append a training run record to the history file.

    Creates the file if it doesn't exist. History is an append-only
    JSON array of run records.

    Args:
        history_path: Path to the JSON history file.
        run_record: Dictionary describing this training run.
    """
    history = load_training_history(history_path)
    history.append(run_record)

    # Keep last 100 runs
    if len(history) > 100:
        history = history[-100:]

    try:
        Path(history_path).parent.mkdir(parents=True, exist_ok=True)
        with open(history_path, "w") as f:
            json.dump(history, f, indent=2, default=str)
        logger.info("Training history updated (%d runs)", len(history))
    except Exception as exc:
        logger.error("Failed to save training history: %s", exc)


# ── Main Pipeline ─────────────────────────────────────────────────────────


def run_training_pipeline(
    database_url: Optional[str] = None,
    n_synthetic_samples: int = 10000,
    n_estimators: int = 200,
    max_depth: int = 4,
    learning_rate: float = 0.05,
    cv_folds: int = 5,
    output_dir: Optional[str] = None,
    s3_bucket: Optional[str] = None,
    s3_key: str = "models/fraud/latest.pkl",
) -> dict[str, Any]:
    """
    Execute the complete training pipeline end-to-end.

    This is the primary entry point for both CLI and programmatic training.

    Pipeline stages:
        1. Load data (PostgreSQL → synthetic fallback)
        2. Train + evaluate model
        3. Save model + metadata locally
        4. Upload to S3 (if configured)
        5. Update training history

    Args:
        database_url: PostgreSQL connection string (optional).
        n_synthetic_samples: Number of synthetic samples if DB unavailable.
        n_estimators: Number of boosting stages.
        max_depth: Maximum tree depth.
        learning_rate: Learning rate (shrinkage).
        cv_folds: Number of cross-validation folds.
        output_dir: Directory for model artifacts. Defaults to fraud module dir.
        s3_bucket: S3 bucket for upload (optional).
        s3_key: S3 key for the model artifact.

    Returns:
        Dictionary with training results and artifact paths.
    """
    run_id = str(uuid4())[:8]
    started_at = datetime.now(timezone.utc)

    logger.info("=" * 60)
    logger.info("NEXUS Fraud Model Training Pipeline")
    logger.info("  Run ID:  %s", run_id)
    logger.info("  Started: %s", started_at.isoformat())
    logger.info("=" * 60)

    pipeline_result: dict[str, Any] = {
        "run_id": run_id,
        "started_at": started_at.isoformat(),
        "status": "running",
    }

    try:
        # Stage 1: Load data
        X: Optional[np.ndarray] = None
        y: Optional[np.ndarray] = None
        data_source = "synthetic"

        if database_url:
            result = load_data_from_postgres(database_url)
            if result is not None:
                X, y = result
                data_source = "postgresql"

        if X is None:
            logger.info("Using synthetic training data (%d samples)", n_synthetic_samples)
            X, y = generate_synthetic_data(n_samples=n_synthetic_samples)

        pipeline_result["data_source"] = data_source
        pipeline_result["total_samples"] = int(X.shape[0])

        # Stage 2: Train
        train_result = train_model(
            X,
            y,
            n_estimators=n_estimators,
            max_depth=max_depth,
            learning_rate=learning_rate,
            cv_folds=cv_folds,
        )

        # Stage 3: Save locally
        if output_dir is None:
            output_dir = str(Path(__file__).parent)

        model_path = os.path.join(output_dir, "model.pkl")
        version = f"{run_id}_{started_at.strftime('%Y%m%d_%H%M%S')}"
        save_paths = save_model(
            train_result["model"],
            model_path,
            metrics=train_result["metrics"],
            version=version,
        )

        pipeline_result["model_path"] = save_paths["model"]
        pipeline_result["metadata_path"] = save_paths["metadata"]
        pipeline_result["metrics"] = train_result["metrics"]
        pipeline_result["feature_importances"] = [
            {"name": n, "importance": round(float(imp), 4)}
            for n, imp in train_result["feature_importances"]
        ]
        pipeline_result["cv_scores"] = train_result["cv_scores"]

        # Stage 4: Upload to S3
        s3_bucket = s3_bucket or os.environ.get("AWS_S3_ANALYTICS_BUCKET")
        if s3_bucket:
            upload_result = upload_to_s3(model_path, s3_bucket, s3_key)
            pipeline_result["s3_upload"] = upload_result
        else:
            logger.info("AWS_S3_ANALYTICS_BUCKET not set — skipping S3 upload")
            pipeline_result["s3_upload"] = None

        # Stage 5: Update training history
        history_path = os.path.join(output_dir, "training_history.json")
        finished_at = datetime.now(timezone.utc)
        run_record = {
            "run_id": run_id,
            "started_at": started_at.isoformat(),
            "finished_at": finished_at.isoformat(),
            "duration_seconds": round((finished_at - started_at).total_seconds(), 2),
            "data_source": data_source,
            "total_samples": int(X.shape[0]),
            "version": version,
            "metrics": train_result["metrics"],
            "status": "success",
        }
        append_training_history(history_path, run_record)

        pipeline_result["status"] = "success"
        pipeline_result["finished_at"] = finished_at.isoformat()
        pipeline_result["duration_seconds"] = round(
            (finished_at - started_at).total_seconds(), 2
        )

        logger.info("=" * 60)
        logger.info("Training pipeline completed successfully")
        logger.info("  Run ID:   %s", run_id)
        logger.info("  Duration: %.1fs", pipeline_result["duration_seconds"])
        logger.info("  AUC-ROC:  %.4f", train_result["metrics"]["auc_roc"])
        logger.info("  Model:    %s", model_path)
        logger.info("=" * 60)

        return pipeline_result

    except Exception as exc:
        logger.exception("Training pipeline failed: %s", exc)
        pipeline_result["status"] = "failed"
        pipeline_result["error"] = str(exc)
        pipeline_result["finished_at"] = datetime.now(timezone.utc).isoformat()
        return pipeline_result


def main() -> None:
    """CLI entry point for the training pipeline."""
    logger.info("=" * 60)
    logger.info("NEXUS Fraud Model Training Pipeline")
    logger.info("Started at: %s", datetime.now(timezone.utc).isoformat())
    logger.info("=" * 60)

    database_url = os.environ.get("DATABASE_URL")
    s3_bucket = os.environ.get("AWS_S3_ANALYTICS_BUCKET")
    s3_key = os.environ.get("MODEL_S3_KEY", "models/fraud/latest.pkl")

    result = run_training_pipeline(
        database_url=database_url,
        n_synthetic_samples=10000,
        s3_bucket=s3_bucket,
        s3_key=s3_key,
    )

    if result["status"] == "success":
        logger.info("Training complete! Metrics: %s", json.dumps(result.get("metrics", {}), indent=2))
        sys.exit(0)
    else:
        logger.error("Training failed: %s", result.get("error", "unknown"))
        sys.exit(1)


if __name__ == "__main__":
    main()
