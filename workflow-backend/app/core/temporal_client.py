"""Async Temporal client wrapper."""

import os
from temporalio.client import Client, WorkflowHandle

_TEMPORAL_HOST = os.environ.get("TEMPORAL_HOST", "temporal:7233")
_TEMPORAL_NS   = os.environ.get("TEMPORAL_NAMESPACE", "default")

_client: Client | None = None


async def get_client() -> Client:
    global _client
    if _client is None:
        _client = await Client.connect(_TEMPORAL_HOST, namespace=_TEMPORAL_NS)
    return _client


async def start_workflow(workflow_id: str, workflow_cls, args: dict,
                         task_queue: str) -> WorkflowHandle:
    client = await get_client()
    return await client.start_workflow(
        workflow_cls.run,
        args,
        id=workflow_id,
        task_queue=task_queue,
    )


async def get_workflow_handle(workflow_id: str) -> WorkflowHandle:
    client = await get_client()
    return client.get_workflow_handle(workflow_id)


async def describe_workflow(workflow_id: str) -> dict:
    handle = await get_workflow_handle(workflow_id)
    desc = await handle.describe()
    return {
        "workflow_id": workflow_id,
        "status": str(desc.status),
        "start_time": desc.start_time.isoformat() if desc.start_time else None,
        "close_time": desc.close_time.isoformat() if desc.close_time else None,
    }


async def cancel_workflow(workflow_id: str) -> None:
    handle = await get_workflow_handle(workflow_id)
    await handle.cancel()
