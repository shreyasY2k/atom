from observability import setup
"""SWIFT/DTC gateway mock — accepts transfer instructions."""
from fastapi import FastAPI
import uuid

app = FastAPI(title="SWIFT/DTC Gateway", version="0.1.0")

@app.get("/health")
def health(): return {"status": "ok"}

@app.post("/instructions")
def submit(payload: dict):
    instr_id = f"SWIFT-{uuid.uuid4().hex[:12].upper()}"
    return {
        "instruction_id": instr_id,
        "transfer_id": payload.get("transfer_id"),
        "status": "ACCEPTED",
        "submitted_at": "2026-05-08T10:00:00Z",
        "message": "MT103 instruction accepted; settlement T+1.",
    }

setup(app, "swift-gw")
