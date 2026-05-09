from observability import setup
"""KYC mock service. Customer profiles, documents, external screening."""
from datetime import date
from fastapi import FastAPI, HTTPException

app = FastAPI(title="KYC Service", version="0.1.0")

# Three demo customers — match the three demo paths
CUSTOMERS = {
    # Routine customer — clean profile
    "CUST-100442": {
        "customer_id": "CUST-100442", "name": "Margaret Wong",
        "address": "210 Pine St, San Francisco CA 94109",
        "tax_id": "***-**-4421", "risk_category": "LOW",
        "last_kyc_date": "2026-01-01",
    },
    # High-value customer — clean profile, used for high-value path
    "CUST-200119": {
        "customer_id": "CUST-200119", "name": "David Eisenberg",
        "address": "9 Park Ave, New York NY 10016",
        "tax_id": "***-**-9883", "risk_category": "MEDIUM",
        "last_kyc_date": "2025-08-04",
    },
    # Stale-doc customer — KYC agent should return low confidence
    "CUST-300577": {
        "customer_id": "CUST-300577", "name": "Aaron Patel",
        "address": "47 Market St, Boston MA 02109",
        "tax_id": "***-**-2244", "risk_category": "MEDIUM",
        "last_kyc_date": "2023-01-10",  # > 730 days stale
    },
}

DOCUMENTS = {
    "CUST-100442": [{"doc_type": "PASSPORT", "issue_date": "2024-06-01",
                      "expiry": "2034-06-01", "verified": True}],
    "CUST-200119": [{"doc_type": "DRIVERS_LICENSE", "issue_date": "2025-02-15",
                      "expiry": "2030-02-15", "verified": True}],
    "CUST-300577": [{"doc_type": "PASSPORT", "issue_date": "2018-04-22",
                      "expiry": "2028-04-22", "verified": True}],
}

SCREENING = {
    "CUST-100442": {"adverse_media": False, "pep": False, "details": "Clean."},
    "CUST-200119": {"adverse_media": False, "pep": False, "details": "Clean."},
    "CUST-300577": {"adverse_media": False, "pep": False, "details": "Clean."},
}

@app.get("/health")
def health(): return {"status": "ok"}

@app.get("/profile/{customer_id}")
def get_profile(customer_id: str):
    p = CUSTOMERS.get(customer_id)
    if not p: raise HTTPException(404, f"customer {customer_id} not found")
    today = date.today()
    last = date.fromisoformat(p["last_kyc_date"])
    age_days = (today - last).days
    return {**p, "kyc_age_days": age_days, "is_stale": age_days > 730}

@app.get("/documents/{customer_id}")
def get_documents(customer_id: str):
    if customer_id not in CUSTOMERS: raise HTTPException(404)
    return {"customer_id": customer_id, "documents": DOCUMENTS.get(customer_id, [])}

@app.post("/screening")
def get_screening(payload: dict):
    cid = payload.get("customer_id")
    if cid not in CUSTOMERS: raise HTTPException(404)
    return SCREENING[cid]

setup(app, "kyc-svc")
