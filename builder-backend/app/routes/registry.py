"""Routes: agent registry — list, get, delete."""

import httpx
from fastapi import APIRouter, HTTPException

from app.core import audit, identity, registry_db
from app.core.container import stop_and_remove

router = APIRouter(prefix="/agents", tags=["registry"])


@router.get("")
def list_agents():
    return {"agents": registry_db.list_all()}


@router.get("/{name}")
def get_agent(name: str):
    rec = registry_db.get(name)
    if not rec:
        raise HTTPException(404, f"agent {name!r} not found")
    return rec


@router.delete("/{name}")
def delete_agent(name: str):
    rec = registry_db.get(name)
    if not rec:
        raise HTTPException(404, f"agent {name!r} not found")

    # Stop container
    try:
        stop_and_remove(rec["name"], rec["version"])
    except Exception as e:
        pass  # log but don't block revocation

    # Revoke virtual key
    try:
        identity.revoke_identity(rec["virtual_key"])
    except Exception as e:
        raise HTTPException(502, f"Key revocation failed: {e}")

    registry_db.mark_undeployed(name)

    audit.emit_deploy(
        name=name,
        service_account_id=rec["service_account_id"],
        version=rec["version"],
        action="undeploy_agent",
    )

    return {"status": "undeployed", "name": name, "service_account_id": rec["service_account_id"]}
