from observability import setup
"""Incoming transfer queue mock — ATS workflow steps 1 and 9."""
from fastapi import FastAPI, HTTPException
from datetime import datetime, timezone
import uuid

app = FastAPI(title="Incoming Queue", version="0.1.0")

# In-memory store. Resets on restart — fine for demo.
TRANSFERS: dict = {}


@app.get("/health")
def health():
    return {"status": "ok", "queued": len(TRANSFERS)}


@app.post("/transfers")
def queue_transfer(payload: dict):
    transfer_id = payload.get("transfer_id", f"XFER-{uuid.uuid4().hex[:8].upper()}")
    now = datetime.now(timezone.utc).isoformat()
    rec = {
        "transfer_id": transfer_id,
        "customer_id": payload.get("customer_id"),
        "amount_usd": payload.get("amount_usd"),
        "status": "QUEUED",
        "queued_at": now,
        "completed_at": None,
        "final_decision": None,
    }
    TRANSFERS[transfer_id] = rec
    return {
        "receipt": {
            "id": f"REC-{uuid.uuid4().hex[:8].upper()}",
            "transfer_id": transfer_id,
            "queued_at": now,
            "status": "QUEUED",
        }
    }


@app.get("/transfers/{transfer_id}")
def get_transfer(transfer_id: str):
    rec = TRANSFERS.get(transfer_id)
    if not rec:
        raise HTTPException(404, f"transfer {transfer_id} not found")
    return rec


@app.post("/transfers/{transfer_id}/complete")
def complete_transfer(transfer_id: str, payload: dict):
    rec = TRANSFERS.get(transfer_id)
    if not rec:
        # Accept unknown IDs gracefully — workflow may call before queue_transfer
        rec = {"transfer_id": transfer_id, "status": "QUEUED"}
        TRANSFERS[transfer_id] = rec
    rec["status"] = "COMPLETED"
    rec["completed_at"] = datetime.now(timezone.utc).isoformat()
    rec["final_decision"] = payload.get("final_decision")
    rec["swift_result"] = payload.get("swift_result")
    return {"status": "completed", "transfer_id": transfer_id}

setup(app, "incoming-queue")
