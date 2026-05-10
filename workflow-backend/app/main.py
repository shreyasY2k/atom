"""ATOM Agent Platform — Workflow Engine (FastAPI + embedded Temporal worker)."""

import asyncio
import logging
import os

from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware

from app.routes import audit, runs, specs, tasks, workflows, deployments as wf_deployments
from app.worker.activities import (
    decision_activity,
    http_call_activity,
    human_task_activity,
    invoke_agent_activity,
)
from app.worker.runner import AtomWorkflowRunner
from app.core.observability import setup

logger = logging.getLogger(__name__)

app = FastAPI(
    title="ATOM Agent Platform — Workflow Engine",
    version="1.0.0",
    description="Validates, registers, and executes BFSI workflows via Temporal.",
)

app.include_router(specs.router)
app.include_router(workflows.router)
app.include_router(runs.router)
app.include_router(audit.router)
app.include_router(tasks.router)
app.include_router(wf_deployments.router)


@app.get("/health")
def health():
    return {"status": "ok", "service": "workflow-backend"}


# setup() adds OTEL + AccessLog middleware (LIFO — they become inner layers).
# CORSMiddleware must be added LAST so it is the outermost layer.
setup(app, "workflow-backend")

app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_methods=["*"],
    allow_headers=["*"],
    expose_headers=["*"],
)


# ---------------------------------------------------------------------------
# Temporal worker — runs as a background task in the same process (V1)
# ---------------------------------------------------------------------------

_worker_task: asyncio.Task | None = None


async def _run_worker():
    from temporalio.client import Client
    from temporalio.worker import Worker

    host = os.environ.get("TEMPORAL_HOST", "temporal:7233")
    ns   = os.environ.get("TEMPORAL_NAMESPACE", "default")
    tq   = os.environ.get("TEMPORAL_TASK_QUEUE", "ats-task-queue")
    logger.info("Temporal worker connecting", extra={"host": host, "namespace": ns, "task_queue": tq})

    while True:
        try:
            client = await Client.connect(host, namespace=ns)
            worker = Worker(
                client,
                task_queue=tq,
                workflows=[AtomWorkflowRunner],
                activities=[
                    invoke_agent_activity,
                    http_call_activity,
                    decision_activity,
                    human_task_activity,
                ],
            )
            logger.info("Temporal worker started on task queue '%s'", tq)
            await worker.run()
        except Exception as e:
            logger.warning("Temporal worker error: %s — retrying in 5s", e)
            await asyncio.sleep(5)


@app.on_event("startup")
async def startup():
    global _worker_task
    _worker_task = asyncio.create_task(_run_worker())
    logger.info("Workflow backend started; Temporal worker launching in background")


@app.on_event("shutdown")
async def shutdown():
    if _worker_task:
        _worker_task.cancel()
