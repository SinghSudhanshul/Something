"""
Analytics Service — Configuration
=================================

Pydantic-settings based configuration loaded from environment variables.
All settings are validated on startup; missing required variables cause
an immediate, descriptive startup failure rather than a cryptic runtime error.

Environment Variable Resolution Order:
    1. Explicit environment variables
    2. .env file in the service root
    3. Defaults defined below

Usage:
    from app.config import settings
    print(settings.database_url)
"""

from __future__ import annotations

import logging
import sys
from typing import Optional

from pydantic import Field, field_validator, model_validator
from pydantic_settings import BaseSettings, SettingsConfigDict

logger = logging.getLogger("nexus.analytics.config")


class Settings(BaseSettings):
    """
    Application settings loaded from environment variables.

    Required variables will cause a startup validation error if absent.
    Optional variables have sensible defaults for local development.
    """

    model_config = SettingsConfigDict(
        env_prefix="",
        case_sensitive=False,
        env_file=".env",
        env_file_encoding="utf-8",
        extra="ignore",
    )

    # ── Core Application ──────────────────────────────────────────────────

    app_name: str = Field(
        default="nexus-analytics",
        description="Human-readable service name used in logs and health checks.",
    )

    env: str = Field(
        default="development",
        description="Deployment environment: development | staging | production.",
    )

    port: int = Field(
        default=3012,
        ge=1,
        le=65535,
        description="HTTP port the FastAPI server listens on.",
    )

    log_level: str = Field(
        default="INFO",
        description="Logging level: DEBUG | INFO | WARNING | ERROR | CRITICAL.",
    )

    version: str = Field(
        default="0.1.0",
        description="Semantic version of the analytics service.",
    )

    # ── Database (PostgreSQL) — REQUIRED ──────────────────────────────────

    database_url: str = Field(
        default="postgres://nexus:nexus_dev_secret@localhost:5432/nexus_dev",
        description=(
            "PostgreSQL connection string.  "
            "In production this MUST be set via the DATABASE_URL env var."
        ),
    )

    db_pool_min_size: int = Field(
        default=2,
        ge=1,
        description="Minimum number of connections in the asyncpg pool.",
    )

    db_pool_max_size: int = Field(
        default=10,
        ge=1,
        description="Maximum number of connections in the asyncpg pool.",
    )

    # ── MongoDB ───────────────────────────────────────────────────────────

    mongodb_url: str = Field(
        default="mongodb://nexus:nexus_dev_secret@localhost:27017/nexus_dev?authSource=admin",
        description="MongoDB connection string for document storage.",
    )

    # ── Redis ─────────────────────────────────────────────────────────────

    redis_url: str = Field(
        default="redis://localhost:6379",
        description="Redis connection URL for caching and pub/sub.",
    )

    redis_key_prefix: str = Field(
        default="nexus:analytics:",
        description="Key prefix for all Redis keys owned by this service.",
    )

    redis_cache_ttl_seconds: int = Field(
        default=300,
        ge=0,
        description="Default TTL for cached analytics results in seconds.",
    )

    # ── Kafka — REQUIRED ─────────────────────────────────────────────────

    kafka_brokers: str = Field(
        default="localhost:9092",
        description=(
            "Comma-separated list of Kafka broker addresses.  "
            "In production this MUST be set via the KAFKA_BROKERS env var."
        ),
    )

    kafka_consumer_group: str = Field(
        default="nexus-analytics-pipeline",
        description="Kafka consumer group ID for the analytics pipeline.",
    )

    kafka_auto_offset_reset: str = Field(
        default="latest",
        description="Kafka auto-offset reset policy: earliest | latest.",
    )

    kafka_max_poll_interval_ms: int = Field(
        default=300_000,
        ge=1000,
        description="Maximum interval between Kafka poll() calls in milliseconds.",
    )

    kafka_session_timeout_ms: int = Field(
        default=30_000,
        ge=6000,
        description="Kafka consumer session timeout in milliseconds.",
    )

    # ── ClickHouse (Optional — analytics warehouse) ──────────────────────

    clickhouse_url: Optional[str] = Field(
        default="http://localhost:8123",
        description=(
            "ClickHouse HTTP interface URL.  "
            "Set to None or empty string to disable ClickHouse writes."
        ),
    )

    clickhouse_database: str = Field(
        default="nexus_analytics",
        description="ClickHouse database name.",
    )

    clickhouse_batch_size: int = Field(
        default=1000,
        ge=1,
        le=100_000,
        description="Number of events to buffer before flushing to ClickHouse.",
    )

    clickhouse_flush_interval_secs: float = Field(
        default=5.0,
        ge=0.5,
        le=300.0,
        description="Maximum seconds between ClickHouse batch flushes.",
    )

    clickhouse_write_timeout_secs: float = Field(
        default=10.0,
        ge=1.0,
        description="HTTP timeout for ClickHouse write requests.",
    )

    clickhouse_max_retries: int = Field(
        default=3,
        ge=0,
        le=10,
        description="Maximum retry attempts for failed ClickHouse writes.",
    )

    # ── Fraud Model ──────────────────────────────────────────────────────

    fraud_model_path: str = Field(
        default="models/fraud_model.pkl",
        description="Local filesystem path to the serialized fraud model.",
    )

    fraud_feature_version: str = Field(
        default="v1",
        description="Feature schema version used by the fraud model.",
    )

    fraud_score_allow_threshold: int = Field(
        default=20,
        ge=0,
        le=100,
        description="Fraud score below which transactions are auto-allowed.",
    )

    fraud_score_monitor_threshold: int = Field(
        default=50,
        ge=0,
        le=100,
        description="Fraud score above which transactions are allowed with monitoring.",
    )

    fraud_score_selfie_threshold: int = Field(
        default=75,
        ge=0,
        le=100,
        description="Fraud score above which selfie verification is required.",
    )

    # ── AWS / S3 ─────────────────────────────────────────────────────────

    aws_s3_analytics_bucket: Optional[str] = Field(
        default=None,
        description="S3 bucket for analytics artifacts (models, reports, exports).",
    )

    model_s3_key: str = Field(
        default="models/fraud/latest.pkl",
        description="S3 object key for the latest fraud model artifact.",
    )

    aws_region: str = Field(
        default="ap-south-1",
        description="AWS region for S3 and other AWS service calls.",
    )

    # ── Model Training ───────────────────────────────────────────────────

    model_retrain_cron: str = Field(
        default="0 3 * * 0",
        description=(
            "Cron expression for automatic model retraining.  "
            "Default: every Sunday at 03:00 UTC."
        ),
    )

    training_min_samples: int = Field(
        default=1000,
        ge=100,
        description="Minimum number of labeled samples required to trigger training.",
    )

    training_test_split: float = Field(
        default=0.20,
        ge=0.05,
        le=0.50,
        description="Fraction of data held out for test evaluation.",
    )

    training_cross_validation_folds: int = Field(
        default=5,
        ge=2,
        le=20,
        description="Number of folds for cross-validation during training.",
    )

    # ── Internal Authentication ──────────────────────────────────────────

    internal_service_secret: str = Field(
        default="dev-internal-secret-change-in-production",
        description=(
            "Shared secret for service-to-service authentication via "
            "X-Internal-Secret header.  MUST be changed in production."
        ),
    )

    # ── CORS ─────────────────────────────────────────────────────────────

    cors_origins: str = Field(
        default="http://localhost:3000,http://localhost:3100",
        description="Comma-separated list of allowed CORS origins.",
    )

    # ── Rate Limiting ────────────────────────────────────────────────────

    rate_limit_predict_rpm: int = Field(
        default=600,
        ge=1,
        description="Maximum prediction requests per minute per client.",
    )

    rate_limit_metrics_rpm: int = Field(
        default=300,
        ge=1,
        description="Maximum metrics requests per minute per client.",
    )

    # ── Computed Properties ───────────────────────────────────────────────

    @property
    def enable_clickhouse(self) -> bool:
        """Whether ClickHouse integration is enabled based on URL presence."""
        return bool(self.clickhouse_url and self.clickhouse_url.strip())

    @property
    def kafka_brokers_list(self) -> list[str]:
        """Kafka brokers as a list, split from the comma-separated string."""
        return [b.strip() for b in self.kafka_brokers.split(",") if b.strip()]

    @property
    def cors_origins_list(self) -> list[str]:
        """CORS origins as a list, split from the comma-separated string."""
        return [o.strip() for o in self.cors_origins.split(",") if o.strip()]

    @property
    def is_production(self) -> bool:
        """Check if the service is running in production mode."""
        return self.env.lower() == "production"

    @property
    def is_development(self) -> bool:
        """Check if the service is running in development mode."""
        return self.env.lower() == "development"

    # ── Validators ───────────────────────────────────────────────────────

    @field_validator("log_level")
    @classmethod
    def validate_log_level(cls, v: str) -> str:
        """Ensure log_level is a valid Python logging level name."""
        valid_levels = {"DEBUG", "INFO", "WARNING", "ERROR", "CRITICAL"}
        normalized = v.upper().strip()
        if normalized not in valid_levels:
            raise ValueError(
                f"Invalid log_level '{v}'. Must be one of: {', '.join(sorted(valid_levels))}"
            )
        return normalized

    @field_validator("env")
    @classmethod
    def validate_env(cls, v: str) -> str:
        """Normalize and validate the deployment environment."""
        valid_envs = {"development", "staging", "production", "test"}
        normalized = v.lower().strip()
        if normalized not in valid_envs:
            raise ValueError(
                f"Invalid env '{v}'. Must be one of: {', '.join(sorted(valid_envs))}"
            )
        return normalized

    @field_validator("database_url")
    @classmethod
    def validate_database_url(cls, v: str) -> str:
        """Ensure database_url is not empty and has a valid scheme."""
        if not v or not v.strip():
            raise ValueError("DATABASE_URL is required and cannot be empty.")
        stripped = v.strip()
        if not stripped.startswith(("postgres://", "postgresql://", "postgresql+asyncpg://")):
            raise ValueError(
                f"DATABASE_URL must start with postgres:// or postgresql://. Got: {stripped[:30]}..."
            )
        return stripped

    @field_validator("kafka_brokers")
    @classmethod
    def validate_kafka_brokers(cls, v: str) -> str:
        """Ensure kafka_brokers is not empty."""
        if not v or not v.strip():
            raise ValueError("KAFKA_BROKERS is required and cannot be empty.")
        return v.strip()

    @model_validator(mode="after")
    def validate_thresholds(self) -> "Settings":
        """Ensure fraud score thresholds are monotonically increasing."""
        if not (
            self.fraud_score_allow_threshold
            < self.fraud_score_monitor_threshold
            < self.fraud_score_selfie_threshold
        ):
            raise ValueError(
                "Fraud score thresholds must be strictly increasing: "
                f"allow ({self.fraud_score_allow_threshold}) "
                f"< monitor ({self.fraud_score_monitor_threshold}) "
                f"< selfie ({self.fraud_score_selfie_threshold})"
            )
        return self

    @model_validator(mode="after")
    def warn_production_defaults(self) -> "Settings":
        """Emit warnings when production is using insecure defaults."""
        if self.is_production:
            if self.internal_service_secret == "dev-internal-secret-change-in-production":
                logger.critical(
                    "INTERNAL_SERVICE_SECRET is set to the default value in production! "
                    "This is a critical security issue."
                )
                raise ValueError(
                    "INTERNAL_SERVICE_SECRET must be changed from the default in production."
                )
        return self

    @model_validator(mode="after")
    def validate_pool_sizes(self) -> "Settings":
        """Ensure db_pool_min_size <= db_pool_max_size."""
        if self.db_pool_min_size > self.db_pool_max_size:
            raise ValueError(
                f"db_pool_min_size ({self.db_pool_min_size}) must be <= "
                f"db_pool_max_size ({self.db_pool_max_size})"
            )
        return self

    def summary(self) -> dict:
        """
        Return a safe-to-log summary of current configuration.

        Secrets and connection strings are redacted to prevent leaking
        credentials into log files or monitoring dashboards.
        """
        return {
            "app_name": self.app_name,
            "env": self.env,
            "port": self.port,
            "log_level": self.log_level,
            "version": self.version,
            "database_url": _redact_url(self.database_url),
            "mongodb_url": _redact_url(self.mongodb_url),
            "redis_url": _redact_url(self.redis_url),
            "kafka_brokers": self.kafka_brokers,
            "clickhouse_enabled": self.enable_clickhouse,
            "clickhouse_url": _redact_url(self.clickhouse_url) if self.clickhouse_url else None,
            "clickhouse_batch_size": self.clickhouse_batch_size,
            "clickhouse_flush_interval_secs": self.clickhouse_flush_interval_secs,
            "fraud_model_path": self.fraud_model_path,
            "fraud_feature_version": self.fraud_feature_version,
            "aws_s3_analytics_bucket": self.aws_s3_analytics_bucket,
            "model_s3_key": self.model_s3_key,
            "model_retrain_cron": self.model_retrain_cron,
            "cors_origins": self.cors_origins_list,
            "is_production": self.is_production,
            "internal_secret_set": self.internal_service_secret != "dev-internal-secret-change-in-production",
        }


def _redact_url(url: str) -> str:
    """
    Redact passwords from database/service URLs for safe logging.

    Transforms:
        postgres://user:secretpass@host:5432/db
    Into:
        postgres://user:***@host:5432/db
    """
    if not url:
        return ""
    try:
        from urllib.parse import urlparse, urlunparse

        parsed = urlparse(url)
        if parsed.password:
            # Replace password with ***
            netloc = f"{parsed.username}:***@{parsed.hostname}"
            if parsed.port:
                netloc += f":{parsed.port}"
            return urlunparse(parsed._replace(netloc=netloc))
        return url
    except Exception:
        # If parsing fails, redact everything after ://
        if "://" in url:
            scheme = url.split("://")[0]
            return f"{scheme}://***"
        return "***"


def load_settings() -> Settings:
    """
    Load and validate application settings.

    Catches validation errors and logs a human-readable message before
    exiting with a non-zero code. This prevents the service from starting
    with an invalid configuration.

    Returns:
        Validated Settings instance.

    Raises:
        SystemExit: If settings validation fails.
    """
    try:
        return Settings()
    except Exception as exc:
        print(
            f"\n{'=' * 60}\n"
            f"FATAL: Analytics Service configuration is invalid.\n"
            f"{'=' * 60}\n"
            f"{exc}\n"
            f"{'=' * 60}\n",
            file=sys.stderr,
        )
        sys.exit(1)


# ── Module-level singleton ────────────────────────────────────────────────

settings: Settings = load_settings()
