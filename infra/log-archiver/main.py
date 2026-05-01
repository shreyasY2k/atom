"""
infra/log-archiver/main.py

Subscribes to all four ATOM Kafka topics as consumer group "log-archiver",
batches messages (≤100 or ≤30 s), and archives JSON lines to MinIO at:
  atom-audit/{topic}/{yyyy}/{mm}/{dd}/{hh}/batch-{uuid}.jsonl
"""

import asyncio
import json
import logging
import os
import uuid
from collections import defaultdict
from datetime import datetime, timezone

import boto3
from aiokafka import AIOKafkaConsumer

KAFKA_BROKERS = os.environ.get("KAFKA_BROKERS", "localhost:9092")
MINIO_ENDPOINT = os.environ.get("MINIO_ENDPOINT", "http://localhost:9000")
MINIO_ACCESS_KEY = os.environ.get("MINIO_ACCESS_KEY", "minioadmin")
MINIO_SECRET_KEY = os.environ.get("MINIO_SECRET_KEY", "changeme")
MINIO_BUCKET = os.environ.get("MINIO_BUCKET", "atom-audit")

TOPICS = ["atom.audit", "atom.llm", "atom.agent.logs", "atom.deployments"]
CONSUMER_GROUP = "log-archiver"
BATCH_SIZE = 100
FLUSH_INTERVAL_SECS = 30

logging.basicConfig(
    level=logging.INFO,
    format="%(asctime)s %(levelname)s [%(name)s] %(message)s",
)
log = logging.getLogger("log-archiver")


def _s3():
    return boto3.client(
        "s3",
        endpoint_url=MINIO_ENDPOINT,
        aws_access_key_id=MINIO_ACCESS_KEY,
        aws_secret_access_key=MINIO_SECRET_KEY,
        region_name="us-east-1",
    )


def _minio_key(topic: str, dt: datetime, batch_id: str) -> str:
    return (
        f"{topic}/{dt.year:04d}/{dt.month:02d}/{dt.day:02d}"
        f"/{dt.hour:02d}/batch-{batch_id}.jsonl"
    )


async def _flush(s3, topic: str, messages: list[bytes]) -> None:
    if not messages:
        return
    dt = datetime.now(timezone.utc)
    batch_id = str(uuid.uuid4())
    key = _minio_key(topic, dt, batch_id)
    body = b"\n".join(messages) + b"\n"
    loop = asyncio.get_event_loop()
    await loop.run_in_executor(
        None,
        lambda: s3.put_object(
            Bucket=MINIO_BUCKET,
            Key=key,
            Body=body,
            ContentType="application/x-ndjson",
        ),
    )
    log.info("archived %d msg(s) → s3://%s/%s", len(messages), MINIO_BUCKET, key)


def _ensure_bucket(s3) -> None:
    """Create the MinIO bucket if it doesn't exist yet."""
    try:
        s3.head_bucket(Bucket=MINIO_BUCKET)
    except Exception:
        s3.create_bucket(Bucket=MINIO_BUCKET)
        log.info("created MinIO bucket: %s", MINIO_BUCKET)


async def run() -> None:
    s3 = _s3()
    _ensure_bucket(s3)
    log.info(
        "connecting to Kafka brokers=%s topics=%s group=%s",
        KAFKA_BROKERS,
        TOPICS,
        CONSUMER_GROUP,
    )
    consumer = AIOKafkaConsumer(
        *TOPICS,
        bootstrap_servers=KAFKA_BROKERS,
        group_id=CONSUMER_GROUP,
        auto_offset_reset="earliest",
        enable_auto_commit=True,
        value_deserializer=lambda b: b,  # keep raw bytes; we write as-is
    )
    await consumer.start()
    log.info("log-archiver ready")

    batches: dict[str, list[bytes]] = defaultdict(list)
    last_flush = asyncio.get_event_loop().time()

    try:
        while True:
            # Use timeout_ms so aiokafka handles the poll timeout internally;
            # avoids CancelledError from asyncio.wait_for cancelling the coroutine.
            records = await consumer.getmany(max_records=50, timeout_ms=5000)

            for tp, msgs in records.items():
                for msg in msgs:
                    raw = msg.value
                    try:
                        obj = json.loads(raw)
                        batches[tp.topic].append(json.dumps(obj).encode())
                    except Exception:
                        batches[tp.topic].append(raw)

            now = asyncio.get_event_loop().time()
            time_due = (now - last_flush) >= FLUSH_INTERVAL_SECS

            flush_tasks = []
            for topic in list(batches.keys()):
                if len(batches[topic]) >= BATCH_SIZE or (time_due and batches[topic]):
                    flush_tasks.append(_flush(s3, topic, batches.pop(topic)))

            if flush_tasks:
                await asyncio.gather(*flush_tasks)

            if time_due:
                last_flush = now

    except asyncio.CancelledError:
        log.info("log-archiver cancelled — flushing remaining batches")
        flush_tasks = [_flush(s3, t, msgs) for t, msgs in batches.items() if msgs]
        if flush_tasks:
            await asyncio.gather(*flush_tasks, return_exceptions=True)
    except Exception as exc:
        log.error("log-archiver fatal error: %s", exc, exc_info=True)
        raise
    finally:
        await consumer.stop()
        log.info("log-archiver stopped")


if __name__ == "__main__":
    asyncio.run(run())
