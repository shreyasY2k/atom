"""Routes: agent registry — list, get, delete."""

import httpx
from fastapi import APIRouter, HTTPException

from app.core import audit, identity, registry_db
from app.core.container import LocalDeployManager, WORK_DIR

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

    # Stop container via LocalDeployManager
    try:
        deploy_mgr = LocalDeployManager(
            workdir=str(WORK_DIR / "agents" / f"{rec['name']}-{rec['version']}")
        )
        deploy_mgr.undeploy(name=rec["name"], version=rec["version"])
    except Exception:
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

    # Write tombstone to agent-artifacts so MinIO reflects current state
    audit.write_agent_tombstone(
        name=name,
        version=rec["version"],
        service_account_id=rec["service_account_id"],
    )

    return {"status": "undeployed", "name": name, "service_account_id": rec["service_account_id"]}
