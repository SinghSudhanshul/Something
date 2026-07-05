"""
Analytics Service — Health Route

GET /health returns service status, version, and uptime.
"""

import time
from fastapi import APIRouter

router = APIRouter()

_start_time = time.time()


@router.get("/health")
async def health_check():
    """Return current service health status."""
    return {
        "status": "ok",
        "service": "analytics",
        "version": "0.1.0",
        "timestamp": time.strftime("%Y-%m-%dT%H:%M:%SZ", time.gmtime()),
        "uptime": int(time.time() - _start_time),
    }
