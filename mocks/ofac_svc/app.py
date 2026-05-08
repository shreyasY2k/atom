"""OFAC sanctions screening mock."""
from fastapi import FastAPI

app = FastAPI(title="OFAC Screening Service", version="0.1.0")

@app.get("/health")
def health(): return {"status": "ok"}

@app.post("/screen")
def screen(payload: dict):
    # Stub: no demo customer is on a sanctions list
    return {
        "customer_id": payload.get("customer_id"),
        "screening_id": "OFAC-DEMO-RUN",
        "hit": False,
        "lists_checked": ["SDN", "Non-SDN", "EU Consolidated"],
        "details": "No matches found in any list.",
    }
