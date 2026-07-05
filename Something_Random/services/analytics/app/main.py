"""
NEXUS Analytics Service — FastAPI Application
==============================================

Real-time analytics, fraud detection, and event processing for the
NEXUS campus super-app.

Lifecycle:
    Startup:
        1. Configure structured logging
        2. Create asyncpg connection pool
        3. Initialize ClickHouse writer (if enabled)
        4. Load fraud prediction model
        5. Start Kafka analytics pipeline in background
    Shutdown:
        1. Stop Kafka consumer (flush pending events)
        2. Close ClickHouse writer
        3. Close asyncpg pool
        4. Cancel background tasks

Routers:
    /health          — liveness & readiness probes
    /predict         — fraud prediction endpoints
    /metrics/*       — analytics metrics endpoints
    /admin/*         — admin operations (train, status)
"""

from __future__ import annotations

import asyncio
import logging
import sys
import time
import uuid
from contextlib import asynccontextmanager
from typing import AsyncGenerator, Optional

from fastapi import FastAPI, Request, Response
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import JSONResponse

from app.config import settings

logger = logging.getLogger("nexus.analytics")


# ── Structured Logging Setup ─────────────────────────────────────────────


def configure_logging() -> None:
    """
    Configure structured logging for the analytics service.

    Sets up a unified log format with timestamps, level, logger name,
    and message. Adjusts uvicorn access/error loggers to use the same
    format for consistency.
    """
    log_level = getattr(logging, settings.log_level.upper(), logging.INFO)

    log_format = (
        "%(asctime)s [%(name)s] %(levelname)s: %(message)s"
    )
    date_format = "%Y-%m-%dT%H:%M:%S%z"

    # Root handler
    root_logger = logging.getLogger()
    root_logger.setLevel(log_level)

    # Clear existing handlers to avoid duplicate logs on reload
    root_logger.handlers.clear()

    handler = logging.StreamHandler(sys.stdout)
    handler.setLevel(log_level)
    handler.setFormatter(logging.Formatter(fmt=log_format, datefmt=date_format))
    root_logger.addHandler(handler)

    # Quiet down noisy libraries
    logging.getLogger("aiokafka").setLevel(logging.WARNING)
    logging.getLogger("kafka").setLevel(logging.WARNING)
    logging.getLogger("httpx").setLevel(logging.WARNING)
    logging.getLogger("httpcore").setLevel(logging.WARNING)
    logging.getLogger("uvicorn.access").setLevel(logging.WARNING)
    logging.getLogger("clickhouse_connect").setLevel(logging.WARNING)

    logger.info(
        "Logging configured: level=%s, env=%s",
        settings.log_level,
        settings.env,
    )


# ── Application State ────────────────────────────────────────────────────


class AppState:
    """
    Holds shared application state accessible via request.app.state.

    Attributes:
        db_pool: asyncpg connection pool for PostgreSQL.
        clickhouse_writer: ClickHouseWriter instance (or None if disabled).
        pipeline: Kafka analytics pipeline.
        pipeline_task: asyncio.Task running the pipeline consumer loop.
        start_time: Unix timestamp when the service started.
        is_ready: Whether all subsystems have been initialized.
    """

    def __init__(self) -> None:
        self.db_pool: Optional[object] = None
        self.clickhouse_writer: Optional[object] = None
        self.pipeline: Optional[object] = None
        self.pipeline_task: Optional[asyncio.Task] = None  # type: ignore[type-arg]
        self.start_time: float = time.time()
        self.is_ready: bool = False


app_state = AppState()


# ── Database Pool ─────────────────────────────────────────────────────────


async def init_db_pool() -> Optional[object]:
    """
    Create an asyncpg connection pool for PostgreSQL.

    Returns:
        The asyncpg pool instance, or None if the connection fails.
        Failure is non-fatal: the service can still serve predictions
        using fallback features, but DB-enriched features will be unavailable.
    """
    try:
        import asyncpg

        # Convert postgres:// to postgresql:// for asyncpg compatibility
        dsn = settings.database_url
        if dsn.startswith("postgres://"):
            dsn = dsn.replace("postgres://", "postgresql://", 1)

        pool = await asyncpg.create_pool(
            dsn=dsn,
            min_size=settings.db_pool_min_size,
            max_size=settings.db_pool_max_size,
            command_timeout=30.0,
            server_settings={"application_name": settings.app_name},
        )
        logger.info(
            "PostgreSQL pool created: min=%d, max=%d",
            settings.db_pool_min_size,
            settings.db_pool_max_size,
        )
        return pool
    except ImportError:
        logger.warning(
            "asyncpg not installed — PostgreSQL features will be unavailable. "
            "Install with: pip install asyncpg"
        )
        return None
    except Exception as exc:
        logger.error(
            "Failed to create PostgreSQL pool: %s. "
            "DB-enriched features will be unavailable.",
            exc,
        )
        return None


async def close_db_pool(pool: Optional[object]) -> None:
    """
    Gracefully close the asyncpg connection pool.

    Args:
        pool: The asyncpg pool to close (may be None).
    """
    if pool is None:
        return
    try:
        await pool.close()  # type: ignore[union-attr]
        logger.info("PostgreSQL pool closed")
    except Exception as exc:
        logger.error("Error closing PostgreSQL pool: %s", exc)


# ── ClickHouse Initialization ─────────────────────────────────────────────


async def init_clickhouse() -> Optional[object]:
    """
    Initialize the ClickHouse writer if ClickHouse integration is enabled.

    Returns:
        ClickHouseWriter instance, or None if disabled or initialization fails.
    """
    if not settings.enable_clickhouse:
        logger.info("ClickHouse integration disabled (no CLICKHOUSE_URL)")
        return None

    try:
        from app.pipeline.clickhouse_writer import ClickHouseWriter

        writer = ClickHouseWriter(url=settings.clickhouse_url)
        success = await writer.initialize()
        if success:
            logger.info("ClickHouse writer initialized successfully")
            return writer
        else:
            logger.warning(
                "ClickHouse writer initialization returned False — writes will be skipped"
            )
            return None
    except Exception as exc:
        logger.error("Failed to initialize ClickHouse writer: %s", exc)
        return None


# ── Fraud Model Loading ──────────────────────────────────────────────────


def load_fraud_model() -> None:
    """
    Pre-load the fraud prediction model on startup.

    This triggers the lazy-load inside FraudPredictor so the first
    prediction request doesn't incur model-load latency.
    """
    try:
        from app.fraud.predict import get_predictor

        predictor = get_predictor(settings.fraud_model_path)
        if predictor.is_available:
            logger.info("Fraud model pre-loaded from %s", settings.fraud_model_path)
        else:
            logger.warning(
                "Fraud model not available at %s — running in fail-open mode",
                settings.fraud_model_path,
            )
    except Exception as exc:
        logger.error("Error pre-loading fraud model: %s — fail-open mode active", exc)


# ── Kafka Pipeline ────────────────────────────────────────────────────────


async def start_pipeline() -> tuple[Optional[object], Optional[asyncio.Task]]:  # type: ignore[type-arg]
    """
    Start the Kafka analytics pipeline in the background.

    Returns:
        Tuple of (AnalyticsPipeline instance, asyncio.Task running start()).
    """
    try:
        from app.pipeline.kafka_consumer import get_pipeline

        pipeline = get_pipeline()
        task = asyncio.create_task(pipeline.start(), name="analytics-pipeline")
        logger.info("Kafka analytics pipeline starting in background")
        return pipeline, task
    except Exception as exc:
        logger.error("Failed to start Kafka pipeline: %s", exc)
        return None, None


async def stop_pipeline(
    pipeline: Optional[object],
    task: Optional[asyncio.Task],  # type: ignore[type-arg]
) -> None:
    """
    Gracefully stop the Kafka pipeline and cancel its background task.

    Args:
        pipeline: The AnalyticsPipeline instance.
        task: The asyncio.Task running the pipeline.
    """
    if pipeline is not None:
        try:
            await pipeline.stop()  # type: ignore[union-attr]
            logger.info("Kafka pipeline stopped")
        except Exception as exc:
            logger.error("Error stopping Kafka pipeline: %s", exc)

    if task is not None:
        task.cancel()
        try:
            await task
        except asyncio.CancelledError:
            pass
        except Exception as exc:
            logger.error("Error cancelling pipeline task: %s", exc)


# ── Lifespan Context Manager ─────────────────────────────────────────────


@asynccontextmanager
async def lifespan(app: FastAPI) -> AsyncGenerator[None, None]:
    """
    Manage the full application lifecycle: startup and shutdown.

    Startup sequence:
        1. Configure logging
        2. Log configuration summary
        3. Initialize PostgreSQL pool
        4. Initialize ClickHouse writer
        5. Pre-load fraud model
        6. Start Kafka pipeline

    Shutdown sequence:
        1. Stop Kafka pipeline (flush pending events)
        2. Close ClickHouse writer
        3. Close PostgreSQL pool
        4. Log shutdown complete
    """
    # ── Startup ───────────────────────────────────────────────────────
    configure_logging()

    logger.info("=" * 60)
    logger.info("NEXUS Analytics Service starting")
    logger.info("  Port:    %d", settings.port)
    logger.info("  Env:     %s", settings.env)
    logger.info("  Version: %s", settings.version)
    logger.info("=" * 60)

    # Log redacted config summary
    config_summary = settings.summary()
    for key, value in config_summary.items():
        logger.debug("  config.%s = %s", key, value)

    # Initialize subsystems
    app_state.db_pool = await init_db_pool()
    app_state.clickhouse_writer = await init_clickhouse()
    load_fraud_model()

    # Start pipeline
    app_state.pipeline, app_state.pipeline_task = await start_pipeline()
    app_state.start_time = time.time()
    app_state.is_ready = True

    logger.info("NEXUS Analytics Service ready — accepting requests")

    yield

    # ── Shutdown ──────────────────────────────────────────────────────
    logger.info("NEXUS Analytics Service shutting down...")
    app_state.is_ready = False

    await stop_pipeline(app_state.pipeline, app_state.pipeline_task)

    if app_state.clickhouse_writer is not None:
        try:
            await app_state.clickhouse_writer.close()  # type: ignore[union-attr]
            logger.info("ClickHouse writer closed")
        except Exception as exc:
            logger.error("Error closing ClickHouse writer: %s", exc)

    await close_db_pool(app_state.db_pool)

    uptime = int(time.time() - app_state.start_time)
    logger.info("NEXUS Analytics Service stopped (uptime: %ds)", uptime)


# ── FastAPI Application ──────────────────────────────────────────────────

app = FastAPI(
    title="NEXUS Analytics Service",
    description=(
        "Real-time analytics, fraud detection, and event processing "
        "for the NEXUS campus super-app."
    ),
    version=settings.version,
    docs_url="/docs" if settings.is_development else None,
    redoc_url="/redoc" if settings.is_development else None,
    openapi_url="/openapi.json" if settings.is_development else None,
    lifespan=lifespan,
)


# ── Middleware ────────────────────────────────────────────────────────────


# CORS middleware
app.add_middleware(
    CORSMiddleware,
    allow_origins=settings.cors_origins_list,
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
    expose_headers=["X-Request-ID"],
)


@app.middleware("http")
async def request_id_middleware(request: Request, call_next) -> Response:  # type: ignore[no-untyped-def]
    """
    Inject a unique X-Request-ID header into every request and response.

    If the caller provides an X-Request-ID header, it is preserved.
    Otherwise a new UUID4 is generated. The request ID is stored in
    request.state for downstream logging.
    """
    request_id = request.headers.get("X-Request-ID") or str(uuid.uuid4())
    request.state.request_id = request_id

    response = await call_next(request)
    response.headers["X-Request-ID"] = request_id
    return response


@app.middleware("http")
async def request_logging_middleware(request: Request, call_next) -> Response:  # type: ignore[no-untyped-def]
    """
    Log incoming requests and their response status + latency.

    Skips logging for health check endpoints to reduce noise.
    """
    # Skip health checks
    if request.url.path in ("/health", "/healthz", "/readyz"):
        return await call_next(request)

    start = time.monotonic()
    request_id = getattr(request.state, "request_id", "unknown")

    logger.info(
        "[%s] %s %s started",
        request_id[:8],
        request.method,
        request.url.path,
    )

    try:
        response = await call_next(request)
    except Exception as exc:
        elapsed_ms = (time.monotonic() - start) * 1000
        logger.error(
            "[%s] %s %s failed after %.1fms: %s",
            request_id[:8],
            request.method,
            request.url.path,
            elapsed_ms,
            exc,
        )
        raise

    elapsed_ms = (time.monotonic() - start) * 1000
    logger.info(
        "[%s] %s %s → %d (%.1fms)",
        request_id[:8],
        request.method,
        request.url.path,
        response.status_code,
        elapsed_ms,
    )

    return response


# ── Global Exception Handler ─────────────────────────────────────────────


@app.exception_handler(Exception)
async def global_exception_handler(request: Request, exc: Exception) -> JSONResponse:
    """
    Catch unhandled exceptions and return a structured JSON error.

    Logs the full traceback for debugging while returning a safe
    error message to the client (no internal details in production).
    """
    request_id = getattr(request.state, "request_id", "unknown")
    logger.exception(
        "[%s] Unhandled exception on %s %s",
        request_id[:8],
        request.method,
        request.url.path,
    )

    detail = "Internal server error"
    if settings.is_development:
        detail = f"Internal server error: {type(exc).__name__}: {exc}"

    return JSONResponse(
        status_code=500,
        content={
            "error": "internal_server_error",
            "detail": detail,
            "request_id": request_id,
        },
    )


# ── Router Registration ──────────────────────────────────────────────────

from app.routers import health  # noqa: E402
from app.routers.predict import router as predict_router  # noqa: E402
from app.routers.metrics import router as metrics_router  # noqa: E402
from app.routers.admin import router as admin_router  # noqa: E402

app.include_router(health.router, tags=["Health"])
app.include_router(predict_router)
app.include_router(metrics_router)
app.include_router(admin_router)


# ── Utility Accessors ────────────────────────────────────────────────────


def get_db_pool():  # type: ignore[no-untyped-def]
    """Get the asyncpg connection pool from application state."""
    return app_state.db_pool


def get_clickhouse_writer():  # type: ignore[no-untyped-def]
    """Get the ClickHouse writer from application state."""
    return app_state.clickhouse_writer


def get_app_state() -> AppState:
    """Get the global application state object."""
    return app_state
