"""
NEXUS Analytics — Metrics Router

Platform analytics and business intelligence endpoints.

Endpoints:
  GET /metrics/overview              — Platform overview (users, transactions, revenue)
  GET /metrics/campus/{campus_id}    — Per-campus breakdown
  GET /metrics/module/{module}       — Per-module stats (bazaar, rides, skills, food)
  GET /metrics/timeseries            — Time series data with interval parameter
  GET /metrics/trust                 — Trust score distribution histogram
  GET /metrics/fraud                 — Fraud detection stats and trends
  GET /metrics/revenue               — Revenue analytics
  GET /metrics/engagement            — User engagement metrics
"""

import logging
from datetime import datetime, timedelta
from enum import Enum
from typing import Any

from fastapi import APIRouter, Depends, HTTPException, Header, Query
from pydantic import BaseModel, Field

logger = logging.getLogger("analytics.routers.metrics")
router = APIRouter(prefix="/metrics", tags=["Analytics Metrics"])


# ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
# Models
# ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

class TimeInterval(str, Enum):
    HOUR = "hour"
    DAY = "day"
    WEEK = "week"
    MONTH = "month"


class TimePeriod(str, Enum):
    TODAY = "today"
    WEEK = "week"
    MONTH = "month"
    QUARTER = "quarter"
    YEAR = "year"
    ALL = "all"


class NexusModule(str, Enum):
    BAZAAR = "bazaar"
    RIDES = "rides"
    SKILLS = "skills"
    FOOD = "food"
    ERRAND = "errand"


class OverviewMetrics(BaseModel):
    total_users: int = 0
    active_users_today: int = 0
    active_users_week: int = 0
    total_transactions: int = 0
    transactions_today: int = 0
    transactions_week: int = 0
    total_revenue_paise: int = 0
    revenue_today_paise: int = 0
    revenue_week_paise: int = 0
    total_listings: int = 0
    active_listings: int = 0
    total_rides: int = 0
    rides_today: int = 0
    avg_trust_score: float = 3.0
    platform_health: str = "healthy"


class CampusMetrics(BaseModel):
    campus_id: str
    campus_name: str | None = None
    total_users: int = 0
    active_users_week: int = 0
    total_transactions: int = 0
    transactions_week: int = 0
    revenue_week_paise: int = 0
    active_listings: int = 0
    avg_trust_score: float = 3.0
    top_categories: list[dict[str, Any]] = []


class ModuleMetrics(BaseModel):
    module: str
    total_transactions: int = 0
    transactions_today: int = 0
    transactions_week: int = 0
    revenue_today_paise: int = 0
    revenue_week_paise: int = 0
    unique_users_week: int = 0
    avg_transaction_value_paise: int = 0
    growth_rate_week: float = 0.0


class TimeSeriesPoint(BaseModel):
    timestamp: str
    value: float
    label: str | None = None


class TimeSeriesResponse(BaseModel):
    metric: str
    interval: str
    period: str
    data: list[TimeSeriesPoint]
    total: float = 0.0
    avg: float = 0.0
    min_val: float = 0.0
    max_val: float = 0.0


class TrustDistribution(BaseModel):
    tier: str
    score_range: str
    count: int
    percentage: float


class TrustMetrics(BaseModel):
    distribution: list[TrustDistribution]
    total_users: int
    avg_score: float
    median_score: float
    elite_count: int
    new_count: int


class FraudMetrics(BaseModel):
    total_scored: int = 0
    scored_today: int = 0
    blocked_count: int = 0
    blocked_today: int = 0
    monitoring_count: int = 0
    selfie_required_count: int = 0
    avg_score: float = 0.0
    false_positive_rate: float | None = None
    active_flags: int = 0
    auto_suspended: int = 0


class RevenueMetrics(BaseModel):
    total_paise: int = 0
    today_paise: int = 0
    week_paise: int = 0
    month_paise: int = 0
    by_module: list[dict[str, Any]] = []
    growth_rate_week: float = 0.0
    growth_rate_month: float = 0.0
    avg_transaction_paise: int = 0


class EngagementMetrics(BaseModel):
    dau: int = 0
    wau: int = 0
    mau: int = 0
    dau_wau_ratio: float = 0.0
    avg_session_minutes: float = 0.0
    listings_created_today: int = 0
    messages_sent_today: int = 0
    reviews_submitted_today: int = 0
    retention_7d: float = 0.0
    retention_30d: float = 0.0


# ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
# Security
# ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

async def verify_admin_or_internal(
    x_internal_secret: str | None = Header(None, alias="X-Internal-Secret"),
    x_user_roles: str | None = Header(None, alias="X-User-Roles"),
) -> bool:
    """Allow admin users or internal service calls."""
    from app.config import get_settings
    settings = get_settings()

    if x_internal_secret and x_internal_secret == settings.INTERNAL_SERVICE_SECRET:
        return True

    if x_user_roles:
        roles = [r.strip() for r in x_user_roles.split(",")]
        if any(r in ["super_admin", "campus_admin", "analytics_viewer"] for r in roles):
            return True

    raise HTTPException(status_code=403, detail="Admin or internal access required")


# ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
# Helper: get DB pool from app state
# ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

def _get_db(request):
    """Get the DB pool from FastAPI app state."""
    pool = getattr(request.app.state, "db_pool", None)
    if pool is None:
        raise HTTPException(status_code=503, detail="Database not available")
    return pool


# ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
# Endpoints
# ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

@router.get("/overview", response_model=OverviewMetrics)
async def get_overview(
    request: Any,
    _auth: bool = Depends(verify_admin_or_internal),
) -> OverviewMetrics:
    """Platform-wide overview: users, transactions, revenue, listings."""
    pool = _get_db(request)

    async with pool.acquire() as conn:
        # Total users
        total_users = await conn.fetchval("SELECT COUNT(*) FROM users WHERE status = 'active'") or 0

        # Active users today
        active_today = await conn.fetchval(
            "SELECT COUNT(DISTINCT user_id) FROM user_sessions WHERE created_at >= CURRENT_DATE"
        ) or 0

        # Active users this week
        active_week = await conn.fetchval(
            "SELECT COUNT(DISTINCT user_id) FROM user_sessions WHERE created_at >= CURRENT_DATE - INTERVAL '7 days'"
        ) or 0

        # Transactions
        tx_total = await conn.fetchval("SELECT COUNT(*) FROM transactions WHERE status = 'completed'") or 0
        tx_today = await conn.fetchval(
            "SELECT COUNT(*) FROM transactions WHERE status = 'completed' AND created_at >= CURRENT_DATE"
        ) or 0
        tx_week = await conn.fetchval(
            "SELECT COUNT(*) FROM transactions WHERE status = 'completed' AND created_at >= CURRENT_DATE - INTERVAL '7 days'"
        ) or 0

        # Revenue
        rev_total = await conn.fetchval(
            "SELECT COALESCE(SUM(amount), 0) FROM transactions WHERE status = 'completed'"
        ) or 0
        rev_today = await conn.fetchval(
            "SELECT COALESCE(SUM(amount), 0) FROM transactions WHERE status = 'completed' AND created_at >= CURRENT_DATE"
        ) or 0
        rev_week = await conn.fetchval(
            "SELECT COALESCE(SUM(amount), 0) FROM transactions WHERE status = 'completed' AND created_at >= CURRENT_DATE - INTERVAL '7 days'"
        ) or 0

        # Listings
        total_listings = await conn.fetchval("SELECT COUNT(*) FROM listings") or 0
        active_listings = await conn.fetchval("SELECT COUNT(*) FROM listings WHERE status = 'active'") or 0

        # Trust
        avg_trust = await conn.fetchval("SELECT COALESCE(AVG(trust_score), 3.0) FROM student_profiles") or 3.0

    return OverviewMetrics(
        total_users=total_users,
        active_users_today=active_today,
        active_users_week=active_week,
        total_transactions=tx_total,
        transactions_today=tx_today,
        transactions_week=tx_week,
        total_revenue_paise=rev_total,
        revenue_today_paise=rev_today,
        revenue_week_paise=rev_week,
        total_listings=total_listings,
        active_listings=active_listings,
        avg_trust_score=round(float(avg_trust), 2),
        platform_health="healthy",
    )


@router.get("/campus/{campus_id}", response_model=CampusMetrics)
async def get_campus_metrics(
    request: Any,
    campus_id: str,
    _auth: bool = Depends(verify_admin_or_internal),
) -> CampusMetrics:
    """Per-campus analytics breakdown."""
    pool = _get_db(request)

    async with pool.acquire() as conn:
        total_users = await conn.fetchval(
            "SELECT COUNT(*) FROM student_profiles WHERE campus_id = $1", campus_id
        ) or 0

        active_week = await conn.fetchval(
            """SELECT COUNT(DISTINCT sp.user_id) FROM student_profiles sp
               JOIN user_sessions us ON us.user_id = sp.user_id
               WHERE sp.campus_id = $1 AND us.created_at >= CURRENT_DATE - INTERVAL '7 days'""",
            campus_id,
        ) or 0

        tx_total = await conn.fetchval(
            """SELECT COUNT(*) FROM transactions t
               JOIN student_profiles sp ON sp.user_id = t.buyer_id
               WHERE sp.campus_id = $1 AND t.status = 'completed'""",
            campus_id,
        ) or 0

        avg_trust = await conn.fetchval(
            "SELECT COALESCE(AVG(trust_score), 3.0) FROM student_profiles WHERE campus_id = $1",
            campus_id,
        ) or 3.0

    return CampusMetrics(
        campus_id=campus_id,
        total_users=total_users,
        active_users_week=active_week,
        total_transactions=tx_total,
        avg_trust_score=round(float(avg_trust), 2),
    )


@router.get("/module/{module}", response_model=ModuleMetrics)
async def get_module_metrics(
    request: Any,
    module: NexusModule,
    _auth: bool = Depends(verify_admin_or_internal),
) -> ModuleMetrics:
    """Per-module (bazaar, rides, skills, food, errand) analytics."""
    pool = _get_db(request)

    async with pool.acquire() as conn:
        tx_total = await conn.fetchval(
            "SELECT COUNT(*) FROM transactions WHERE module = $1 AND status = 'completed'",
            module.value,
        ) or 0

        tx_today = await conn.fetchval(
            "SELECT COUNT(*) FROM transactions WHERE module = $1 AND status = 'completed' AND created_at >= CURRENT_DATE",
            module.value,
        ) or 0

        tx_week = await conn.fetchval(
            "SELECT COUNT(*) FROM transactions WHERE module = $1 AND status = 'completed' AND created_at >= CURRENT_DATE - INTERVAL '7 days'",
            module.value,
        ) or 0

        rev_today = await conn.fetchval(
            "SELECT COALESCE(SUM(amount), 0) FROM transactions WHERE module = $1 AND status = 'completed' AND created_at >= CURRENT_DATE",
            module.value,
        ) or 0

        rev_week = await conn.fetchval(
            "SELECT COALESCE(SUM(amount), 0) FROM transactions WHERE module = $1 AND status = 'completed' AND created_at >= CURRENT_DATE - INTERVAL '7 days'",
            module.value,
        ) or 0

        unique_users = await conn.fetchval(
            "SELECT COUNT(DISTINCT buyer_id) FROM transactions WHERE module = $1 AND created_at >= CURRENT_DATE - INTERVAL '7 days'",
            module.value,
        ) or 0

        avg_value = await conn.fetchval(
            "SELECT COALESCE(AVG(amount), 0) FROM transactions WHERE module = $1 AND status = 'completed'",
            module.value,
        ) or 0

    return ModuleMetrics(
        module=module.value,
        total_transactions=tx_total,
        transactions_today=tx_today,
        transactions_week=tx_week,
        revenue_today_paise=rev_today,
        revenue_week_paise=rev_week,
        unique_users_week=unique_users,
        avg_transaction_value_paise=int(avg_value),
    )


@router.get("/timeseries", response_model=TimeSeriesResponse)
async def get_timeseries(
    request: Any,
    metric: str = Query("transactions", description="Metric: transactions, revenue, users, listings"),
    interval: TimeInterval = Query(TimeInterval.DAY),
    period: TimePeriod = Query(TimePeriod.MONTH),
    campus_id: str | None = Query(None),
    module: str | None = Query(None),
    _auth: bool = Depends(verify_admin_or_internal),
) -> TimeSeriesResponse:
    """Time series analytics data with configurable interval and period."""
    pool = _get_db(request)

    # Calculate date range
    now = datetime.utcnow()
    period_map = {
        TimePeriod.TODAY: timedelta(days=1),
        TimePeriod.WEEK: timedelta(weeks=1),
        TimePeriod.MONTH: timedelta(days=30),
        TimePeriod.QUARTER: timedelta(days=90),
        TimePeriod.YEAR: timedelta(days=365),
        TimePeriod.ALL: timedelta(days=3650),
    }
    start_date = now - period_map[period]

    # Map interval to PostgreSQL date_trunc
    trunc_map = {
        TimeInterval.HOUR: "hour",
        TimeInterval.DAY: "day",
        TimeInterval.WEEK: "week",
        TimeInterval.MONTH: "month",
    }
    trunc = trunc_map[interval]

    # Build query based on metric
    metric_queries = {
        "transactions": f"""
            SELECT date_trunc('{trunc}', created_at) AS ts, COUNT(*) AS val
            FROM transactions WHERE status = 'completed' AND created_at >= $1
            {'AND module = $2' if module else ''}
            GROUP BY ts ORDER BY ts
        """,
        "revenue": f"""
            SELECT date_trunc('{trunc}', created_at) AS ts, COALESCE(SUM(amount), 0) AS val
            FROM transactions WHERE status = 'completed' AND created_at >= $1
            {'AND module = $2' if module else ''}
            GROUP BY ts ORDER BY ts
        """,
        "users": f"""
            SELECT date_trunc('{trunc}', created_at) AS ts, COUNT(*) AS val
            FROM users WHERE created_at >= $1
            GROUP BY ts ORDER BY ts
        """,
        "listings": f"""
            SELECT date_trunc('{trunc}', created_at) AS ts, COUNT(*) AS val
            FROM listings WHERE created_at >= $1
            GROUP BY ts ORDER BY ts
        """,
    }

    query = metric_queries.get(metric)
    if not query:
        raise HTTPException(status_code=400, detail=f"Unknown metric: {metric}")

    async with pool.acquire() as conn:
        params: list[Any] = [start_date]
        if module:
            params.append(module)
        rows = await conn.fetch(query, *params)

    data = [
        TimeSeriesPoint(
            timestamp=row["ts"].isoformat() if row["ts"] else "",
            value=float(row["val"]),
        )
        for row in rows
    ]

    values = [p.value for p in data]

    return TimeSeriesResponse(
        metric=metric,
        interval=interval.value,
        period=period.value,
        data=data,
        total=sum(values) if values else 0,
        avg=round(sum(values) / len(values), 2) if values else 0,
        min_val=min(values) if values else 0,
        max_val=max(values) if values else 0,
    )


@router.get("/trust", response_model=TrustMetrics)
async def get_trust_metrics(
    request: Any,
    campus_id: str | None = Query(None),
    _auth: bool = Depends(verify_admin_or_internal),
) -> TrustMetrics:
    """Trust score distribution and analytics."""
    pool = _get_db(request)
    campus_filter = "AND campus_id = $1" if campus_id else ""
    params: list[Any] = [campus_id] if campus_id else []

    async with pool.acquire() as conn:
        # Distribution by tier
        tiers = [
            {"tier": "new", "range": "0.00-1.49", "min": 0, "max": 1.49},
            {"tier": "building", "range": "1.50-2.49", "min": 1.50, "max": 2.49},
            {"tier": "trusted", "range": "2.50-3.49", "min": 2.50, "max": 3.49},
            {"tier": "verified", "range": "3.50-4.24", "min": 3.50, "max": 4.24},
            {"tier": "elite", "range": "4.25-5.00", "min": 4.25, "max": 5.00},
        ]

        distribution = []
        total_users = 0

        for t in tiers:
            if campus_id:
                count = await conn.fetchval(
                    f"SELECT COUNT(*) FROM student_profiles WHERE trust_score >= $1 AND trust_score <= $2 {campus_filter}",
                    t["min"], t["max"], *params,
                ) or 0
            else:
                count = await conn.fetchval(
                    "SELECT COUNT(*) FROM student_profiles WHERE trust_score >= $1 AND trust_score <= $2",
                    t["min"], t["max"],
                ) or 0
            total_users += count
            distribution.append(TrustDistribution(
                tier=t["tier"],
                score_range=t["range"],
                count=count,
                percentage=0.0,  # Calculate after
            ))

        # Update percentages
        for d in distribution:
            d.percentage = round(d.count / total_users * 100, 1) if total_users > 0 else 0.0

        # Stats
        if campus_id:
            avg_score = await conn.fetchval(
                f"SELECT COALESCE(AVG(trust_score), 3.0) FROM student_profiles WHERE 1=1 {campus_filter}",
                *params,
            ) or 3.0
        else:
            avg_score = await conn.fetchval(
                "SELECT COALESCE(AVG(trust_score), 3.0) FROM student_profiles"
            ) or 3.0

    return TrustMetrics(
        distribution=distribution,
        total_users=total_users,
        avg_score=round(float(avg_score), 2),
        median_score=3.0,  # Would need percentile query
        elite_count=distribution[4].count if len(distribution) > 4 else 0,
        new_count=distribution[0].count if distribution else 0,
    )


@router.get("/fraud", response_model=FraudMetrics)
async def get_fraud_metrics(
    request: Any,
    _auth: bool = Depends(verify_admin_or_internal),
) -> FraudMetrics:
    """Fraud detection statistics and trends."""
    pool = _get_db(request)

    async with pool.acquire() as conn:
        # Fraud flags
        active_flags = await conn.fetchval(
            "SELECT COUNT(*) FROM fraud_flags WHERE resolved = false"
        ) or 0

        auto_suspended = await conn.fetchval(
            "SELECT COUNT(*) FROM student_profiles WHERE is_suspended = true"
        ) or 0

    return FraudMetrics(
        active_flags=active_flags,
        auto_suspended=auto_suspended,
    )


@router.get("/revenue", response_model=RevenueMetrics)
async def get_revenue_metrics(
    request: Any,
    _auth: bool = Depends(verify_admin_or_internal),
) -> RevenueMetrics:
    """Revenue analytics breakdown by module."""
    pool = _get_db(request)

    async with pool.acquire() as conn:
        total = await conn.fetchval(
            "SELECT COALESCE(SUM(amount), 0) FROM transactions WHERE status = 'completed'"
        ) or 0

        today = await conn.fetchval(
            "SELECT COALESCE(SUM(amount), 0) FROM transactions WHERE status = 'completed' AND created_at >= CURRENT_DATE"
        ) or 0

        week = await conn.fetchval(
            "SELECT COALESCE(SUM(amount), 0) FROM transactions WHERE status = 'completed' AND created_at >= CURRENT_DATE - INTERVAL '7 days'"
        ) or 0

        month = await conn.fetchval(
            "SELECT COALESCE(SUM(amount), 0) FROM transactions WHERE status = 'completed' AND created_at >= CURRENT_DATE - INTERVAL '30 days'"
        ) or 0

        # By module
        rows = await conn.fetch(
            """SELECT module, COALESCE(SUM(amount), 0) AS revenue, COUNT(*) AS tx_count
               FROM transactions WHERE status = 'completed' AND created_at >= CURRENT_DATE - INTERVAL '30 days'
               GROUP BY module ORDER BY revenue DESC"""
        )

        by_module = [
            {"module": row["module"], "revenue_paise": int(row["revenue"]), "transactions": int(row["tx_count"])}
            for row in rows
        ]

    return RevenueMetrics(
        total_paise=total,
        today_paise=today,
        week_paise=week,
        month_paise=month,
        by_module=by_module,
    )


@router.get("/engagement", response_model=EngagementMetrics)
async def get_engagement_metrics(
    request: Any,
    _auth: bool = Depends(verify_admin_or_internal),
) -> EngagementMetrics:
    """User engagement metrics: DAU/WAU/MAU, retention."""
    pool = _get_db(request)

    async with pool.acquire() as conn:
        dau = await conn.fetchval(
            "SELECT COUNT(DISTINCT user_id) FROM user_sessions WHERE created_at >= CURRENT_DATE"
        ) or 0

        wau = await conn.fetchval(
            "SELECT COUNT(DISTINCT user_id) FROM user_sessions WHERE created_at >= CURRENT_DATE - INTERVAL '7 days'"
        ) or 0

        mau = await conn.fetchval(
            "SELECT COUNT(DISTINCT user_id) FROM user_sessions WHERE created_at >= CURRENT_DATE - INTERVAL '30 days'"
        ) or 0

        listings_today = await conn.fetchval(
            "SELECT COUNT(*) FROM listings WHERE created_at >= CURRENT_DATE"
        ) or 0

    dau_wau_ratio = round(dau / wau, 3) if wau > 0 else 0.0

    return EngagementMetrics(
        dau=dau,
        wau=wau,
        mau=mau,
        dau_wau_ratio=dau_wau_ratio,
        listings_created_today=listings_today,
    )
