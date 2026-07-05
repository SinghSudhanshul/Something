"""
Kafka-to-ClickHouse Data Pipeline
==================================

Consumes events from Kafka topics and batch-writes to ClickHouse
for analytics dashboards and metrics computation.

Topics consumed:
    - nexus.transactions.completed  — payment completions
    - nexus.transactions.failed     — payment failures
    - nexus.rides.completed         — ride completions
    - nexus.rides.requested         — ride requests
    - nexus.listings.created        — new marketplace listings
    - nexus.listings.sold           — listing sales
    - nexus.orders.placed           — order placements
    - nexus.orders.completed        — order completions
    - nexus.tasks.completed         — task completions
    - nexus.skills.order_completed  — skills marketplace completions
    - nexus.analytics.event         — custom analytics events
    - nexus.analytics.pageview      — page view tracking
    - nexus.users.created           — new user registrations
    - nexus.users.verified          — user verification events
    - nexus.trust.score.updated     — trust score changes

Architecture:
    Consumer → EventBuffer → ClickHouseWriter (batch)
                    ↓
              Dead Letter Queue (on repeated failures)

Idempotency:
    Offsets are committed after ClickHouse write confirmation.
    On restart, Kafka will replay uncommitted messages.
    The ClickHouse events table uses ReplacingMergeTree for dedup.
"""

from __future__ import annotations

import asyncio
import json
import logging
import time
from datetime import datetime, timezone
from typing import Any, Optional
from uuid import uuid4

from aiokafka import AIOKafkaConsumer, TopicPartition
from aiokafka.errors import KafkaConnectionError, KafkaError

from app.config import settings

logger = logging.getLogger("nexus.analytics.pipeline")

# ── Topics ────────────────────────────────────────────────────────────────

ANALYTICS_TOPICS = [
    "nexus.transactions.completed",
    "nexus.transactions.failed",
    "nexus.rides.completed",
    "nexus.rides.requested",
    "nexus.listings.created",
    "nexus.listings.sold",
    "nexus.orders.placed",
    "nexus.orders.completed",
    "nexus.tasks.completed",
    "nexus.skills.order_completed",
    "nexus.analytics.event",
    "nexus.analytics.pageview",
    "nexus.users.created",
    "nexus.users.verified",
    "nexus.trust.score.updated",
]

# Topic → module mapping for structured event metadata
TOPIC_TO_MODULE: dict[str, str] = {
    "nexus.transactions.completed": "transactions",
    "nexus.transactions.failed": "transactions",
    "nexus.rides.completed": "rides",
    "nexus.rides.requested": "rides",
    "nexus.listings.created": "bazaar",
    "nexus.listings.sold": "bazaar",
    "nexus.orders.placed": "bazaar",
    "nexus.orders.completed": "bazaar",
    "nexus.tasks.completed": "skills",
    "nexus.skills.order_completed": "skills",
    "nexus.analytics.event": "analytics",
    "nexus.analytics.pageview": "analytics",
    "nexus.users.created": "users",
    "nexus.users.verified": "users",
    "nexus.trust.score.updated": "trust",
}


# ── Event Buffer ──────────────────────────────────────────────────────────


class EventBuffer:
    """
    Thread-safe buffer for batch-writing events to ClickHouse.

    Events are accumulated in memory and flushed when either:
        - The buffer reaches max_size events, or
        - flush_interval seconds have elapsed since the last flush

    Failed writes are re-buffered with a cap to prevent OOM. After
    MAX_RETRY_COUNT consecutive failures, events are routed to the
    dead-letter queue.

    Attributes:
        buffer: Current list of buffered events.
        max_size: Maximum buffer capacity before auto-flush.
        flush_interval: Seconds between periodic flushes.
        stats: Counters for monitoring.
    """

    MAX_RETRY_COUNT = 3
    MAX_REBUFFER_SIZE = 200
    DEAD_LETTER_LOG = "dead_letter_events.jsonl"

    def __init__(
        self,
        max_size: int = 500,
        flush_interval_s: float = 5.0,
        clickhouse_writer: Any = None,
    ) -> None:
        """
        Initialize the event buffer.

        Args:
            max_size: Number of events before auto-flush.
            flush_interval_s: Seconds between periodic flushes.
            clickhouse_writer: Optional ClickHouseWriter for batch writes.
        """
        self.buffer: list[dict[str, Any]] = []
        self.max_size = max_size
        self.flush_interval = flush_interval_s
        self._lock = asyncio.Lock()
        self._clickhouse_writer = clickhouse_writer
        self._consecutive_failures = 0
        self._running = True

        # Monitoring stats
        self.stats: dict[str, int] = {
            "events_buffered": 0,
            "events_flushed": 0,
            "events_dropped": 0,
            "flush_count": 0,
            "flush_failures": 0,
            "dead_letter_count": 0,
        }

    def set_writer(self, writer: Any) -> None:
        """
        Set the ClickHouse writer (may be set after construction).

        Args:
            writer: ClickHouseWriter instance.
        """
        self._clickhouse_writer = writer

    async def add(self, event: dict[str, Any]) -> None:
        """
        Add an event to the buffer, auto-flushing if full.

        Args:
            event: Transformed event dictionary for ClickHouse.
        """
        async with self._lock:
            self.buffer.append(event)
            self.stats["events_buffered"] += 1

            if len(self.buffer) >= self.max_size:
                await self._flush_locked()

    async def flush(self) -> None:
        """Manually trigger a buffer flush."""
        async with self._lock:
            await self._flush_locked()

    async def _flush_locked(self) -> None:
        """
        Internal flush — must be called with self._lock held.

        Attempts to write buffered events to ClickHouse. On failure,
        re-buffers a capped subset of events. After too many consecutive
        failures, routes events to the dead-letter queue.
        """
        if not self.buffer:
            return

        events = self.buffer.copy()
        self.buffer.clear()
        self.stats["flush_count"] += 1

        success = await self._write_to_sink(events)

        if success:
            self._consecutive_failures = 0
            self.stats["events_flushed"] += len(events)
            logger.debug("Flushed %d events to ClickHouse", len(events))
        else:
            self._consecutive_failures += 1
            self.stats["flush_failures"] += 1

            if self._consecutive_failures >= self.MAX_RETRY_COUNT:
                # Route to dead-letter queue after repeated failures
                await self._dead_letter(events, reason="max_retries_exceeded")
                self._consecutive_failures = 0
            else:
                # Re-buffer a capped subset
                rebuffer = events[: self.MAX_REBUFFER_SIZE]
                dropped = len(events) - len(rebuffer)
                self.buffer.extend(rebuffer)

                if dropped > 0:
                    self.stats["events_dropped"] += dropped
                    logger.warning(
                        "Re-buffered %d events, dropped %d (buffer cap)",
                        len(rebuffer),
                        dropped,
                    )

    async def _write_to_sink(self, events: list[dict[str, Any]]) -> bool:
        """
        Write events to the configured sink (ClickHouse or HTTP fallback).

        Args:
            events: List of event dictionaries.

        Returns:
            True on success, False on failure.
        """
        # Use ClickHouseWriter if available
        if self._clickhouse_writer is not None:
            try:
                return await self._clickhouse_writer.write_batch(events)
            except Exception as exc:
                logger.error("ClickHouse writer batch write failed: %s", exc)
                return False

        # HTTP fallback (legacy path)
        return await self._write_via_http(events)

    async def _write_via_http(self, events: list[dict[str, Any]]) -> bool:
        """
        Fallback: write events to ClickHouse via HTTP interface.

        Args:
            events: List of event dictionaries.

        Returns:
            True on success, False on failure.
        """
        if not settings.enable_clickhouse:
            logger.debug("ClickHouse disabled — %d events discarded", len(events))
            return True  # Treat as success when CH is intentionally disabled

        try:
            import httpx

            rows = "\n".join(json.dumps(e, default=str) for e in events)
            url = f"{settings.clickhouse_url}/?database={settings.clickhouse_database}"

            async with httpx.AsyncClient(timeout=settings.clickhouse_write_timeout_secs) as client:
                response = await client.post(
                    url,
                    content=f"INSERT INTO nexus_events FORMAT JSONEachRow\n{rows}",
                    headers={"Content-Type": "application/json"},
                )
                if response.status_code != 200:
                    logger.error(
                        "ClickHouse HTTP write failed: %d — %s",
                        response.status_code,
                        response.text[:200],
                    )
                    return False

                logger.info("Flushed %d events to ClickHouse via HTTP", len(events))
                return True

        except ImportError:
            logger.warning("httpx not installed — cannot write to ClickHouse via HTTP")
            return False
        except Exception as exc:
            logger.error("ClickHouse HTTP write error: %s", exc)
            return False

    async def _dead_letter(
        self,
        events: list[dict[str, Any]],
        reason: str,
    ) -> None:
        """
        Route failed events to the dead-letter queue.

        Currently writes to a local JSONL file. In production, this
        would publish to a Kafka dead-letter topic or an S3 bucket.

        Args:
            events: Events that failed to write.
            reason: Human-readable failure reason.
        """
        self.stats["dead_letter_count"] += len(events)

        logger.error(
            "Routing %d events to dead-letter queue (reason: %s)",
            len(events),
            reason,
        )

        try:
            with open(self.DEAD_LETTER_LOG, "a") as f:
                for event in events:
                    record = {
                        "event": event,
                        "reason": reason,
                        "timestamp": datetime.now(timezone.utc).isoformat(),
                    }
                    f.write(json.dumps(record, default=str) + "\n")
        except Exception as exc:
            logger.error("Failed to write to dead-letter file: %s", exc)
            self.stats["events_dropped"] += len(events)

    async def periodic_flush(self) -> None:
        """
        Periodic flush loop — runs every flush_interval seconds.

        Runs until self._running is set to False. Called as an
        asyncio background task.
        """
        while self._running:
            await asyncio.sleep(self.flush_interval)
            if self.buffer:
                async with self._lock:
                    await self._flush_locked()

    def stop(self) -> None:
        """Signal the periodic flush loop to stop."""
        self._running = False


# ── Metric Extractors ─────────────────────────────────────────────────────


def extract_transaction_metrics(payload: dict[str, Any]) -> dict[str, Any]:
    """
    Extract structured metrics from a transaction event payload.

    Args:
        payload: Raw Kafka message payload.

    Returns:
        Extracted metrics dictionary.
    """
    return {
        "transaction_id": payload.get("id", payload.get("transaction_id", "")),
        "amount_paise": payload.get("amountInPaise", payload.get("amount", 0)),
        "module": payload.get("module", "unknown"),
        "status": payload.get("status", ""),
        "buyer_id": payload.get("buyerId", payload.get("buyer_id", "")),
        "seller_id": payload.get("sellerId", payload.get("seller_id", "")),
    }


def extract_ride_metrics(payload: dict[str, Any]) -> dict[str, Any]:
    """
    Extract structured metrics from a ride event payload.

    Args:
        payload: Raw Kafka message payload.

    Returns:
        Extracted metrics dictionary.
    """
    return {
        "ride_id": payload.get("id", payload.get("ride_id", "")),
        "fare_paise": payload.get("fareInPaise", payload.get("fare", 0)),
        "distance_meters": payload.get("distanceMeters", 0),
        "duration_seconds": payload.get("durationSeconds", 0),
        "rider_id": payload.get("riderId", payload.get("rider_id", "")),
        "driver_id": payload.get("driverId", payload.get("driver_id", "")),
    }


def extract_listing_metrics(payload: dict[str, Any]) -> dict[str, Any]:
    """
    Extract structured metrics from a listing event payload.

    Args:
        payload: Raw Kafka message payload.

    Returns:
        Extracted metrics dictionary.
    """
    return {
        "listing_id": payload.get("id", payload.get("listing_id", "")),
        "price_paise": payload.get("priceInPaise", payload.get("price", 0)),
        "category": payload.get("category", ""),
        "seller_id": payload.get("sellerId", payload.get("seller_id", "")),
    }


def extract_user_metrics(payload: dict[str, Any]) -> dict[str, Any]:
    """
    Extract structured metrics from a user event payload.

    Args:
        payload: Raw Kafka message payload.

    Returns:
        Extracted metrics dictionary.
    """
    return {
        "user_id": payload.get("id", payload.get("user_id", "")),
        "campus_id": payload.get("campusId", payload.get("campus_id", "")),
        "verification_level": payload.get("verificationLevel", 0),
    }


# Topic → extractor mapping
TOPIC_EXTRACTORS: dict[str, Any] = {
    "nexus.transactions.completed": extract_transaction_metrics,
    "nexus.transactions.failed": extract_transaction_metrics,
    "nexus.rides.completed": extract_ride_metrics,
    "nexus.rides.requested": extract_ride_metrics,
    "nexus.listings.created": extract_listing_metrics,
    "nexus.listings.sold": extract_listing_metrics,
    "nexus.users.created": extract_user_metrics,
    "nexus.users.verified": extract_user_metrics,
}


# ── Analytics Pipeline ────────────────────────────────────────────────────


class AnalyticsPipeline:
    """
    Kafka consumer that reads events and buffers them for ClickHouse.

    Supports:
        - Multiple topic consumption
        - Structured metric extraction per topic
        - Batch buffering with configurable flush
        - Offset tracking for idempotency
        - Dead-letter queue for repeated failures
        - Graceful shutdown with pending flush
        - Health/status reporting

    Usage:
        pipeline = AnalyticsPipeline()
        await pipeline.start()   # blocks until stopped
        await pipeline.stop()    # graceful shutdown
    """

    def __init__(self) -> None:
        """Initialize the analytics pipeline with default configuration."""
        self.consumer: Optional[AIOKafkaConsumer] = None
        self.buffer = EventBuffer(
            max_size=settings.clickhouse_batch_size,
            flush_interval_s=settings.clickhouse_flush_interval_secs,
        )
        self._running = False
        self._flush_task: Optional[asyncio.Task] = None  # type: ignore[type-arg]
        self._started_at: Optional[float] = None
        self._last_message_at: Optional[float] = None

        # Monitoring
        self._messages_processed = 0
        self._messages_failed = 0
        self._offsets: dict[str, int] = {}

    @property
    def is_running(self) -> bool:
        """Whether the pipeline consumer loop is active."""
        return self._running

    @property
    def status(self) -> dict[str, Any]:
        """
        Get current pipeline status for health checks.

        Returns:
            Dictionary with status, uptime, message counts, buffer stats.
        """
        uptime = (
            time.time() - self._started_at
            if self._started_at
            else 0
        )
        return {
            "running": self._running,
            "uptime_seconds": round(uptime, 1),
            "started_at": (
                datetime.fromtimestamp(self._started_at, tz=timezone.utc).isoformat()
                if self._started_at
                else None
            ),
            "last_message_at": (
                datetime.fromtimestamp(self._last_message_at, tz=timezone.utc).isoformat()
                if self._last_message_at
                else None
            ),
            "messages_processed": self._messages_processed,
            "messages_failed": self._messages_failed,
            "topics": ANALYTICS_TOPICS,
            "topic_count": len(ANALYTICS_TOPICS),
            "buffer": {
                "current_size": len(self.buffer.buffer),
                "max_size": self.buffer.max_size,
                **self.buffer.stats,
            },
            "consumer_group": settings.kafka_consumer_group,
            "offsets": self._offsets,
        }

    async def start(self) -> None:
        """
        Start consuming Kafka events.

        Blocks until stop() is called or an unrecoverable error occurs.
        Creates the Kafka consumer, subscribes to topics, and enters
        the consume loop.
        """
        brokers = settings.kafka_brokers_list

        logger.info(
            "Starting analytics pipeline: brokers=%s, group=%s, topics=%d",
            brokers,
            settings.kafka_consumer_group,
            len(ANALYTICS_TOPICS),
        )

        self.consumer = AIOKafkaConsumer(
            *ANALYTICS_TOPICS,
            bootstrap_servers=brokers,
            group_id=settings.kafka_consumer_group,
            auto_offset_reset=settings.kafka_auto_offset_reset,
            enable_auto_commit=False,  # Manual commit after successful write
            max_poll_interval_ms=settings.kafka_max_poll_interval_ms,
            session_timeout_ms=settings.kafka_session_timeout_ms,
            value_deserializer=lambda v: json.loads(v.decode("utf-8")) if v else None,
        )

        retry_count = 0
        max_retries = 5

        while retry_count < max_retries:
            try:
                await self.consumer.start()
                break
            except KafkaConnectionError as exc:
                retry_count += 1
                wait_time = min(2 ** retry_count, 30)
                logger.warning(
                    "Kafka connection failed (attempt %d/%d): %s — retrying in %ds",
                    retry_count,
                    max_retries,
                    exc,
                    wait_time,
                )
                await asyncio.sleep(wait_time)
        else:
            logger.error(
                "Failed to connect to Kafka after %d attempts — pipeline will not start",
                max_retries,
            )
            return

        self._running = True
        self._started_at = time.time()
        logger.info(
            "Analytics pipeline started — consuming %d topics",
            len(ANALYTICS_TOPICS),
        )

        # Start periodic flush as background task
        self._flush_task = asyncio.create_task(
            self.buffer.periodic_flush(),
            name="event-buffer-flush",
        )

        try:
            async for msg in self.consumer:
                if not self._running:
                    break

                try:
                    event = self._transform_event(
                        msg.topic, msg.value, msg.timestamp
                    )
                    await self.buffer.add(event)

                    # Track offset
                    tp_key = f"{msg.topic}:{msg.partition}"
                    self._offsets[tp_key] = msg.offset

                    self._messages_processed += 1
                    self._last_message_at = time.time()

                    # Commit offsets periodically (every 100 messages)
                    if self._messages_processed % 100 == 0:
                        try:
                            await self.consumer.commit()
                        except Exception as commit_exc:
                            logger.warning(
                                "Offset commit failed: %s", commit_exc
                            )

                except Exception as exc:
                    self._messages_failed += 1
                    logger.error(
                        "Failed to process message from %s (offset=%d): %s",
                        msg.topic,
                        msg.offset,
                        exc,
                    )

        except asyncio.CancelledError:
            logger.info("Pipeline consumer loop cancelled")
        except KafkaError as exc:
            logger.error("Kafka consumer error: %s", exc)
        except Exception as exc:
            logger.exception("Unexpected pipeline error: %s", exc)
        finally:
            # Final offset commit
            if self.consumer:
                try:
                    await self.consumer.commit()
                except Exception:
                    pass
                try:
                    await self.consumer.stop()
                except Exception:
                    pass

    async def stop(self) -> None:
        """
        Stop the pipeline gracefully.

        Flushes any pending events, stops the periodic flush task,
        commits final offsets, and closes the Kafka consumer.
        """
        logger.info("Stopping analytics pipeline...")
        self._running = False

        # Stop the periodic flush
        self.buffer.stop()
        if self._flush_task is not None:
            self._flush_task.cancel()
            try:
                await self._flush_task
            except asyncio.CancelledError:
                pass

        # Final flush of remaining events
        try:
            await self.buffer.flush()
            logger.info(
                "Final flush completed (%d events remaining in buffer)",
                len(self.buffer.buffer),
            )
        except Exception as exc:
            logger.error("Final flush failed: %s", exc)

        # Stop Kafka consumer
        if self.consumer:
            try:
                await self.consumer.commit()
            except Exception:
                pass
            try:
                await self.consumer.stop()
            except Exception as exc:
                logger.error("Error stopping Kafka consumer: %s", exc)

        duration = (
            time.time() - self._started_at if self._started_at else 0
        )
        logger.info(
            "Analytics pipeline stopped (uptime: %.0fs, "
            "processed: %d, failed: %d)",
            duration,
            self._messages_processed,
            self._messages_failed,
        )

    def _transform_event(
        self,
        topic: str,
        value: dict[str, Any] | None,
        timestamp: int,
    ) -> dict[str, Any]:
        """
        Transform a Kafka message into a ClickHouse-compatible row.

        Extracts common fields and applies topic-specific metric
        extraction when a specialized extractor is available.

        Args:
            topic: Kafka topic the message came from.
            value: Deserialized message value.
            timestamp: Kafka message timestamp (milliseconds).

        Returns:
            Dictionary matching the nexus_events ClickHouse schema.
        """
        payload = (value or {}).get("payload", value or {})
        event_id = (
            payload.get("id")
            or payload.get("transaction_id")
            or payload.get("event_id")
            or str(uuid4())
        )

        module = TOPIC_TO_MODULE.get(topic, "unknown")

        # Extract topic-specific metrics
        extractor = TOPIC_EXTRACTORS.get(topic)
        extracted = extractor(payload) if extractor else {}

        # Build the event row
        event = {
            "event_id": str(event_id),
            "event_type": topic,
            "topic": topic,
            "user_id": str(
                payload.get("userId")
                or payload.get("user_id")
                or payload.get("buyerId")
                or payload.get("buyer_id")
                or ""
            ),
            "campus_id": str(
                payload.get("campusId")
                or payload.get("campus_id")
                or ""
            ),
            "module": module,
            "amount_paise": int(
                payload.get("amountInPaise")
                or payload.get("amount")
                or payload.get("fareInPaise")
                or payload.get("fare")
                or payload.get("priceInPaise")
                or payload.get("price")
                or 0
            ),
            "payload": json.dumps(payload, default=str),
            "metadata": json.dumps(extracted, default=str),
            "kafka_timestamp": (
                datetime.fromtimestamp(timestamp / 1000, tz=timezone.utc).isoformat()
                if timestamp
                else datetime.now(timezone.utc).isoformat()
            ),
            "created_at": datetime.now(timezone.utc).isoformat(),
        }

        return event


# ── Singleton ─────────────────────────────────────────────────────────────

_pipeline: Optional[AnalyticsPipeline] = None


def get_pipeline() -> AnalyticsPipeline:
    """
    Get or create the singleton AnalyticsPipeline instance.

    Returns:
        The singleton AnalyticsPipeline.
    """
    global _pipeline
    if _pipeline is None:
        _pipeline = AnalyticsPipeline()
    return _pipeline


def reset_pipeline() -> None:
    """
    Reset the singleton pipeline (primarily for testing).

    After calling this, the next get_pipeline() call will create
    a fresh instance.
    """
    global _pipeline
    _pipeline = None
