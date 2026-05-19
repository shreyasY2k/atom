"""Routes: agent registry — list, get, delete."""

import os
import httpx
import yaml
from fastapi import APIRouter, HTTPException
from pathlib import Path

from app.core import audit, identity, registry_db
from app.core.container import LocalDeployManager, WORK_DIR

router = APIRouter(prefix="/agents", tags=["registry"])

SPECS_PATH = Path(os.environ.get("SPECS_PATH", "/app/specs"))


def _backfill_role_name(agents: list[dict]) -> list[dict]:
    """For any agent missing agent_role_name, read the spec and fill it in lazily."""
    updated = []
    for a in agents:
        if not a.get("agent_role_name"):
            spec_path = SPECS_PATH / "agents" / f"{a['name']}.yaml"
            try:
                spec_dict = yaml.safe_load(spec_path.read_text())
                role_name = spec_dict.get("spec", {}).get("agents", [{}])[0].get("name")
                if role_name:
                    a = {**a, "agent_role_name": role_name}
                    registry_db.set_agent_role_name(a["name"], role_name)
            except Exception:
                pass
        updated.append(a)
    return updated


@router.get("")
def list_agents(
    domain: str | None = None,
    subdomain: str | None = None,
    status: str | None = None,
):
    """List agents with optional domain/subdomain/status filters."""
    agents = _backfill_role_name(registry_db.list_agents(domain=domain, subdomain=subdomain))
    if status:
        agents = [a for a in agents if a.get("status") == status]
    return {"agents": agents}


@router.get("/{name}")
def get_agent(name: str):
    rec = registry_db.get(name)
    if not rec:
        raise HTTPException(404, f"agent {name!r} not found")
    result = _backfill_role_name([rec])
    return result[0]


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
