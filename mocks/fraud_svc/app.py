from observability import setup
"""Mock fraud-detection data service — transaction history, customer baseline, peer segments."""

from fastapi import FastAPI, HTTPException
from fastapi.middleware.cors import CORSMiddleware

app = FastAPI(title="fraud-svc mock", version="1.0.0")
app.add_middleware(CORSMiddleware, allow_origins=["*"], allow_methods=["*"], allow_headers=["*"])

# ── Seeded transaction history ─────────────────────────────────────────────────

_TRANSACTIONS: dict[str, list[dict]] = {
    "CUST-100442": [
        {"id": "TXN-CUST100442-001", "merchant": "Zephyr Digital LLC", "amount": 4800.00, "channel": "online", "date": "2026-05-07", "flagged": True},
        {"id": "TXN-CUST100442-002", "merchant": "Shell Gas Station", "amount": 52.10, "channel": "in-store", "date": "2026-05-06", "flagged": False},
        {"id": "TXN-CUST100442-003", "merchant": "Whole Foods Market", "amount": 138.40, "channel": "in-store", "date": "2026-05-05", "flagged": False},
        {"id": "TXN-CUST100442-004", "merchant": "Amazon.com", "amount": 299.00, "channel": "online", "date": "2026-05-03", "flagged": False},
        {"id": "TXN-CUST100442-005", "merchant": "ATM Withdrawal", "amount": 500.00, "channel": "ATM", "date": "2026-05-01", "flagged": False},
    ],
    "CUST-200119": [
        {"id": "TXN-CUST200119-001", "merchant": "FX Wire Transfer", "amount": 12000.00, "channel": "online", "date": "2026-05-07", "flagged": True},
        {"id": "TXN-CUST200119-002", "merchant": "Nordstrom", "amount": 1250.00, "channel": "in-store", "date": "2026-05-04", "flagged": False},
        {"id": "TXN-CUST200119-003", "merchant": "Equinox Fitness", "amount": 210.00, "channel": "online", "date": "2026-05-01", "flagged": False},
    ],
    "CUST-300577": [
        {"id": "TXN-CUST300577-001", "merchant": "QuickBit Exchange", "amount": 95.00, "channel": "online", "date": "2026-05-07", "flagged": True},
        {"id": "TXN-CUST300577-002", "merchant": "Walgreens", "amount": 34.20, "channel": "in-store", "date": "2026-05-05", "flagged": False},
        {"id": "TXN-CUST300577-003", "merchant": "Dunkin Donuts", "amount": 8.50, "channel": "in-store", "date": "2026-05-04", "flagged": False},
    ],
}

_BASELINES: dict[str, dict] = {
    "CUST-100442": {
        "customer_id": "CUST-100442",
        "avg_monthly_spend": 2400.00,
        "avg_transaction_amount": 180.00,
        "typical_channels": ["in-store", "online"],
        "typical_merchant_categories": ["grocery", "gas", "e-commerce"],
        "risk_tier": "LOW",
        "account_age_months": 84,
        "prior_fraud_flags": 0,
    },
    "CUST-200119": {
        "customer_id": "CUST-200119",
        "avg_monthly_spend": 8500.00,
        "avg_transaction_amount": 650.00,
        "typical_channels": ["in-store", "online"],
        "typical_merchant_categories": ["luxury-retail", "fitness", "travel"],
        "risk_tier": "MEDIUM",
        "account_age_months": 36,
        "prior_fraud_flags": 1,
    },
    "CUST-300577": {
        "customer_id": "CUST-300577",
        "avg_monthly_spend": 900.00,
        "avg_transaction_amount": 45.00,
        "typical_channels": ["in-store"],
        "typical_merchant_categories": ["pharmacy", "food", "grocery"],
        "risk_tier": "LOW",
        "account_age_months": 12,
        "prior_fraud_flags": 0,
    },
}

_PEER_SEGMENTS: dict[str, dict] = {
    "CUST-100442": {
        "segment": "mass_affluent",
        "avg_balance": 85000,
        "avg_monthly_spend": 2200.00,
        "p95_single_transaction": 3500.00,
        "online_txn_pct": 0.35,
        "crypto_exchange_exposure_pct": 0.02,
        "segment_fraud_rate_pct": 0.8,
    },
    "CUST-200119": {
        "segment": "high_net_worth",
        "avg_balance": 450000,
        "avg_monthly_spend": 9000.00,
        "p95_single_transaction": 15000.00,
        "online_txn_pct": 0.55,
        "crypto_exchange_exposure_pct": 0.04,
        "segment_fraud_rate_pct": 1.1,
    },
    "CUST-300577": {
        "segment": "emerging",
        "avg_balance": 8500,
        "avg_monthly_spend": 850.00,
        "p95_single_transaction": 500.00,
        "online_txn_pct": 0.20,
        "crypto_exchange_exposure_pct": 0.01,
        "segment_fraud_rate_pct": 2.3,
    },
}


@app.get("/health")
def health():
    return {"status": "ok", "service": "fraud-svc"}


@app.get("/transactions")
def get_transactions(customer_id: str, limit: int = 10):
    txns = _TRANSACTIONS.get(customer_id)
    if txns is None:
        raise HTTPException(404, f"customer {customer_id!r} not found")
    return {"customer_id": customer_id, "transactions": txns[:limit]}


@app.get("/customer-baseline")
def get_customer_baseline(customer_id: str):
    baseline = _BASELINES.get(customer_id)
    if baseline is None:
        raise HTTPException(404, f"customer {customer_id!r} not found")
    return baseline


@app.get("/peer-segment")
def get_peer_segment(customer_id: str):
    seg = _PEER_SEGMENTS.get(customer_id)
    if seg is None:
        raise HTTPException(404, f"customer {customer_id!r} not found")
    return {"customer_id": customer_id, **seg}

setup(app, "fraud-svc")
