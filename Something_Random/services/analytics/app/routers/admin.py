"""
NEXUS Analytics — Admin Router

Administrative endpoints for model management, pipeline status,
and training operations.

Endpoints:
  POST /admin/train                  — Trigger model retraining
  GET  /admin/training-history       — Past training runs
  GET  /admin/pipeline/status        — Kafka consumer + ClickHouse writer status
  POST /admin/pipeline/flush         — Force flush ClickHouse buffer
  GET  /admin/system                 — System resource usage
"""

import time
import logging
import os
import asyncio
from typing import Any

from fastapi import APIRouter, Depends, HTTPException, Header, BackgroundTasks
from pydantic import BaseModel, Field

logger = logging.getLogger("analytics.routers.admin")
router = APIRouter(prefix="/admin", tags=["Admin"])


# ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
# Models
# ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

class TrainRequest(BaseModel):
    """Model retraining request parameters."""
    min_samples: int = Field(default=100, ge=10, le=1_000_000)
    test_size: float = Field(default=0.2, ge=0.1, le=0.5)
    n_estimators: int = Field(default=200, ge=50, le=1000)
    max_depth: int = Field(default=6, ge=2, le=15)
    learning_rate: float = Field(default=0.1, ge=0.01, le=1.0)
    upload_to_s3: bool = Field(default=True)


class TrainResponse(BaseModel):
    status: str
    message: str
    job_id: str | None = None


class TrainingRun(BaseModel):
    run_id: str
    started_at: str
    completed_at: str | None = None
    status: str
    samples_count: int = 0
    auc_score: float | None = None
    precision: float | None = None
    recall: float | None = None
    f1_score: float | None = None
    model_version: str | None = None
    duration_seconds: float | None = None
    error: str | None = None


class TrainingHistoryResponse(BaseModel):
    runs: list[TrainingRun]
    total: int


class PipelineStatus(BaseModel):
    kafka_consumer: dict[str, Any]
    clickhouse_writer: dict[str, Any]
    overall_status: str


class SystemInfo(BaseModel):
    cpu_percent: float
    memory_rss_mb: float
    memory_heap_mb: float
    uptime_seconds: float
    python_version: str
    pid: int
    open_connections: int


class FlushResponse(BaseModel):
    status: str
    flushed_count: int
    latency_ms: float


# ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
# Security
# ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

async def verify_admin(
    x_internal_secret: str | None = Header(None, alias="X-Internal-Secret"),
    x_user_roles: str | None = Header(None, alias="X-User-Roles"),
) -> bool:
    """Only super_admin or internal service calls."""
    from app.config import get_settings
    settings = get_settings()

    if x_internal_secret and x_internal_secret == settings.INTERNAL_SERVICE_SECRET:
        return True

    if x_user_roles:
        roles = [r.strip() for r in x_user_roles.split(",")]
        if "super_admin" in roles:
            return True

    raise HTTPException(status_code=403, detail="Super admin or internal access required")


# ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
# Training state
# ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

_training_history: list[dict[str, Any]] = []
_training_in_progress = False
_start_time = time.time()


# ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
# Endpoints
# ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

@router.post("/train", response_model=TrainResponse)
async def trigger_training(
    request: Any,
    body: TrainRequest,
    background_tasks: BackgroundTasks,
    _auth: bool = Depends(verify_admin),
) -> TrainResponse:
    """
    Trigger fraud model retraining.
    Runs in background and uploads to S3 when complete.
    """
    global _training_in_progress

    if _training_in_progress:
        raise HTTPException(status_code=409, detail="Training already in progress")

    import uuid
    job_id = str(uuid.uuid4())

    async def run_training() -> None:
        global _training_in_progress
        _training_in_progress = True
        run_record: dict[str, Any] = {
            "run_id": job_id,
            "started_at": time.strftime("%Y-%m-%dT%H:%M:%SZ", time.gmtime()),
            "status": "running",
            "samples_count": 0,
        }
        _training_history.append(run_record)

        try:
            start = time.time()
            from app.fraud.train import FraudModelTrainer

            pool = getattr(request.app.state, "db_pool", None)
            trainer = FraudModelTrainer(pool)

            result = await asyncio.to_thread(
                trainer.train,
                min_samples=body.min_samples,
                test_size=body.test_size,
                n_estimators=body.n_estimators,
                max_depth=body.max_depth,
                learning_rate=body.learning_rate,
            )

            duration = time.time() - start
            run_record.update({
                "completed_at": time.strftime("%Y-%m-%dT%H:%M:%SZ", time.gmtime()),
                "status": "completed",
                "samples_count": result.get("samples", 0),
                "auc_score": result.get("auc", None),
                "precision": result.get("precision", None),
                "recall": result.get("recall", None),
                "f1_score": result.get("f1", None),
                "model_version": result.get("version", None),
                "duration_seconds": round(duration, 2),
            })

            # Reload model in predictor
            predictor = getattr(request.app.state, "fraud_predictor", None)
            if predictor:
                predictor.load_model()

            logger.info(f"Training completed: {job_id} in {duration:.1f}s AUC={result.get('auc')}")

        except Exception as e:
            run_record.update({
                "completed_at": time.strftime("%Y-%m-%dT%H:%M:%SZ", time.gmtime()),
                "status": "failed",
                "error": str(e),
            })
            logger.error(f"Training failed: {job_id} — {e}")
        finally:
            _training_in_progress = False

    background_tasks.add_task(run_training)

    return TrainResponse(
        status="started",
        message="Model retraining initiated in background",
        job_id=job_id,
    )


@router.get("/training-history", response_model=TrainingHistoryResponse)
async def get_training_history(
    limit: int = 20,
    _auth: bool = Depends(verify_admin),
) -> TrainingHistoryResponse:
    """Get past training runs with metrics."""
    runs = _training_history[-limit:]
    runs.reverse()
    return TrainingHistoryResponse(
        runs=[TrainingRun(**r) for r in runs],
        total=len(_training_history),
    )


@router.get("/pipeline/status", response_model=PipelineStatus)
async def get_pipeline_status(
    request: Any,
    _auth: bool = Depends(verify_admin),
) -> PipelineStatus:
    """Get Kafka consumer and ClickHouse writer status."""
    kafka_status: dict[str, Any] = {"status": "unknown"}
    ch_status: dict[str, Any] = {"status": "unknown"}

    # Kafka consumer status
    consumer = getattr(request.app.state, "kafka_consumer", None)
    if consumer:
        kafka_status = {
            "status": "running",
            "topics": getattr(consumer, "_subscribed_topics", []),
            "messages_processed": getattr(consumer, "_processed_count", 0),
            "errors": getattr(consumer, "_error_count", 0),
        }
    else:
        kafka_status = {"status": "not_initialized"}

    # ClickHouse writer status
    ch_writer = getattr(request.app.state, "clickhouse_writer", None)
    if ch_writer:
        ch_status = {
            "status": "running" if getattr(ch_writer, "_enabled", False) else "disabled",
            "buffer_size": getattr(ch_writer, "_buffer_size", 0),
            "total_written": getattr(ch_writer, "_total_written", 0),
            "write_errors": getattr(ch_writer, "_write_errors", 0),
            "last_flush": getattr(ch_writer, "_last_flush", None),
        }
    else:
        ch_status = {"status": "not_initialized"}

    overall = "healthy"
    if kafka_status.get("status") != "running":
        overall = "degraded"
    if ch_status.get("status") == "disabled":
        overall = "degraded"

    return PipelineStatus(
        kafka_consumer=kafka_status,
        clickhouse_writer=ch_status,
        overall_status=overall,
    )


@router.post("/pipeline/flush", response_model=FlushResponse)
async def flush_pipeline(
    request: Any,
    _auth: bool = Depends(verify_admin),
) -> FlushResponse:
    """Force flush the ClickHouse write buffer."""
    start = time.time()
    ch_writer = getattr(request.app.state, "clickhouse_writer", None)

    if ch_writer is None:
        raise HTTPException(status_code=503, detail="ClickHouse writer not initialized")

    try:
        flushed = await asyncio.to_thread(ch_writer.flush)
        latency = round((time.time() - start) * 1000, 2)
        return FlushResponse(status="flushed", flushed_count=flushed or 0, latency_ms=latency)
    except Exception as e:
        raise HTTPException(status_code=500, detail=f"Flush failed: {str(e)}")


@router.get("/system", response_model=SystemInfo)
async def get_system_info(
    _auth: bool = Depends(verify_admin),
) -> SystemInfo:
    """System resource usage information."""
    import sys
    import resource

    rusage = resource.getrusage(resource.RUSAGE_SELF)

    # Memory from /proc or rusage
    rss_mb = rusage.ru_maxrss / 1024  # macOS reports in bytes, Linux in KB
    if sys.platform == "linux":
        rss_mb = rusage.ru_maxrss / 1024

    return SystemInfo(
        cpu_percent=0.0,  # Would need psutil for accurate CPU
        memory_rss_mb=round(rss_mb, 2),
        memory_heap_mb=0.0,
        uptime_seconds=round(time.time() - _start_time, 1),
        python_version=sys.version,
        pid=os.getpid(),
        open_connections=0,
    )
