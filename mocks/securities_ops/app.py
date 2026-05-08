"""
Securities Operations mock.
Backs the asset-recon agent's three tools:
  get_customer_positions(transfer_id) -> GET /positions/{transfer_id}
  get_security_master(cusip)          -> GET /security-master/{cusip}
  check_position_lots(customer_id, cusip) -> POST /position-lots

Demo data aligns with the three ATS demo paths:
  XFER-100442-001  CUST-100442  routine $40K    40 units UST_2Y   clean recon
  XFER-200119-001  CUST-200119  high-value $1.2M 1240 units UST_10Y  clean recon
  XFER-300577-001  CUST-300577  stale KYC       50 units UST_2Y   clean recon
"""

from fastapi import FastAPI, HTTPException

app = FastAPI(title="Securities Operations Service", version="0.1.0")

# ---------------------------------------------------------------------------
# Seeded data
# ---------------------------------------------------------------------------

SECURITY_MASTER = {
    "912828ZQ6": {
        "cusip": "912828ZQ6",
        "description": "US Treasury Note 4.250% due 2026-07-31",
        "type": "UST_2Y",
        "face_value_usd": 1000,
        "coupon_rate": 0.0425,
        "maturity_date": "2026-07-31",
        "currency": "USD",
        "exchange": "OTC",
        "rating": "AAA",
        "hqla_level": "L1",
    },
    "912810RW0": {
        "cusip": "912810RW0",
        "description": "US Treasury Note 4.000% due 2034-02-15",
        "type": "UST_10Y",
        "face_value_usd": 1000,
        "coupon_rate": 0.0400,
        "maturity_date": "2034-02-15",
        "currency": "USD",
        "exchange": "OTC",
        "rating": "AAA",
        "hqla_level": "L1",
    },
}

# Current customer positions (what they hold in their account)
CUSTOMER_POSITIONS = {
    "CUST-100442": [
        {
            "cusip": "912828ZQ6",
            "security_type": "UST_2Y",
            "quantity": 40,
            "unit_price_usd": 987.50,
            "market_value_usd": 39500.00,
            "accrued_interest_usd": 212.50,
            "total_value_usd": 39712.50,
        }
    ],
    "CUST-200119": [
        {
            "cusip": "912810RW0",
            "security_type": "UST_10Y",
            "quantity": 1240,
            "unit_price_usd": 968.00,
            "market_value_usd": 1200320.00,
            "accrued_interest_usd": 4133.33,
            "total_value_usd": 1204453.33,
        }
    ],
    "CUST-300577": [
        {
            "cusip": "912828ZQ6",
            "security_type": "UST_2Y",
            "quantity": 50,
            "unit_price_usd": 987.50,
            "market_value_usd": 49375.00,
            "accrued_interest_usd": 265.63,
            "total_value_usd": 49640.63,
        }
    ],
}

# Incoming transfers (what the counterparty claims to be sending)
TRANSFERS = {
    "XFER-100442-001": {
        "transfer_id": "XFER-100442-001",
        "customer_id": "CUST-100442",
        "direction": "INBOUND",
        "cusip": "912828ZQ6",
        "quantity": 40,
        "claimed_unit_price_usd": 987.50,
        "claimed_amount_usd": 39500.00,
        "counterparty": "JPMorgan Chase & Co.",
        "settlement_date": "2026-05-09",
        "instructions_ref": "MT103-XFER-100442-001",
    },
    "XFER-200119-001": {
        "transfer_id": "XFER-200119-001",
        "customer_id": "CUST-200119",
        "direction": "INBOUND",
        "cusip": "912810RW0",
        "quantity": 1240,
        "claimed_unit_price_usd": 968.00,
        "claimed_amount_usd": 1200320.00,
        "counterparty": "Goldman Sachs & Co.",
        "settlement_date": "2026-05-09",
        "instructions_ref": "MT103-XFER-200119-001",
    },
    "XFER-300577-001": {
        "transfer_id": "XFER-300577-001",
        "customer_id": "CUST-300577",
        "direction": "INBOUND",
        "cusip": "912828ZQ6",
        "quantity": 50,
        "claimed_unit_price_usd": 987.50,
        "claimed_amount_usd": 49375.00,
        "counterparty": "Citibank N.A.",
        "settlement_date": "2026-05-09",
        "instructions_ref": "MT103-XFER-300577-001",
    },
}

# Lot-level position breakdown
POSITION_LOTS = {
    "CUST-100442": {
        "912828ZQ6": [
            {
                "lot_id": "LOT-100442-001",
                "quantity": 40,
                "acquisition_date": "2024-09-15",
                "cost_basis_per_unit_usd": 987.50,
                "total_cost_basis_usd": 39500.00,
                "unrealized_pnl_usd": 0.00,
            }
        ]
    },
    "CUST-200119": {
        "912810RW0": [
            {
                "lot_id": "LOT-200119-001",
                "quantity": 500,
                "acquisition_date": "2024-06-10",
                "cost_basis_per_unit_usd": 968.00,
                "total_cost_basis_usd": 484000.00,
                "unrealized_pnl_usd": 0.00,
            },
            {
                "lot_id": "LOT-200119-002",
                "quantity": 400,
                "acquisition_date": "2024-09-22",
                "cost_basis_per_unit_usd": 971.50,
                "total_cost_basis_usd": 388600.00,
                "unrealized_pnl_usd": -1400.00,
            },
            {
                "lot_id": "LOT-200119-003",
                "quantity": 340,
                "acquisition_date": "2025-01-08",
                "cost_basis_per_unit_usd": 975.20,
                "total_cost_basis_usd": 331568.00,
                "unrealized_pnl_usd": -2448.00,
            },
        ]
    },
    "CUST-300577": {
        "912828ZQ6": [
            {
                "lot_id": "LOT-300577-001",
                "quantity": 50,
                "acquisition_date": "2023-03-20",
                "cost_basis_per_unit_usd": 982.00,
                "total_cost_basis_usd": 49100.00,
                "unrealized_pnl_usd": 275.00,
            }
        ]
    },
}


# ---------------------------------------------------------------------------
# Helper
# ---------------------------------------------------------------------------

def _reconcile(transfer: dict, positions: list) -> dict:
    """Simple reconciliation: compare transfer cusip/qty against holdings."""
    cusip = transfer["cusip"]
    qty_in = transfer["quantity"]
    match = next((p for p in positions if p["cusip"] == cusip), None)

    discrepancies = []
    if match is None:
        discrepancies.append({
            "field": "cusip",
            "expected": cusip,
            "found": "not in portfolio",
            "severity": "HIGH",
        })
    else:
        if match["quantity"] != qty_in:
            discrepancies.append({
                "field": "quantity",
                "expected": qty_in,
                "found": match["quantity"],
                "severity": "MEDIUM" if abs(match["quantity"] - qty_in) <= 5 else "HIGH",
            })
        price_diff = abs(match["unit_price_usd"] - transfer["claimed_unit_price_usd"])
        if price_diff > 1.00:
            discrepancies.append({
                "field": "unit_price_usd",
                "expected": transfer["claimed_unit_price_usd"],
                "found": match["unit_price_usd"],
                "severity": "LOW",
            })

    return {
        "match": len(discrepancies) == 0,
        "discrepancy_count": len(discrepancies),
        "discrepancies": discrepancies,
    }


# ---------------------------------------------------------------------------
# Endpoints
# ---------------------------------------------------------------------------

@app.get("/health")
def health():
    return {"status": "ok"}


@app.get("/positions/{transfer_id}")
def get_positions(transfer_id: str):
    """
    Return transfer details + current customer holdings for reconciliation.
    This is the primary endpoint for the asset-recon agent's
    get_customer_positions() tool.
    """
    xfer = TRANSFERS.get(transfer_id)
    if not xfer:
        raise HTTPException(404, f"transfer {transfer_id} not found")

    cid = xfer["customer_id"]
    holdings = CUSTOMER_POSITIONS.get(cid, [])
    recon = _reconcile(xfer, holdings)

    return {
        "transfer_id": transfer_id,
        "customer_id": cid,
        "transfer_details": xfer,
        "current_holdings": holdings,
        "reconciliation_summary": recon,
    }


@app.get("/security-master/{cusip}")
def get_security_master(cusip: str):
    """Reference data for a security. Used by get_security_master() tool."""
    sec = SECURITY_MASTER.get(cusip)
    if not sec:
        raise HTTPException(404, f"CUSIP {cusip} not found in security master")
    return sec


@app.post("/position-lots")
def get_position_lots(payload: dict):
    """
    Lot-level breakdown for a customer's holding in a given CUSIP.
    Used by check_position_lots() tool.
    Body: {"customer_id": str, "cusip": str}
    """
    cid = payload.get("customer_id")
    cusip = payload.get("cusip")
    if not cid or not cusip:
        raise HTTPException(400, "customer_id and cusip required")

    lots = POSITION_LOTS.get(cid, {}).get(cusip, [])
    return {
        "customer_id": cid,
        "cusip": cusip,
        "lot_count": len(lots),
        "lots": lots,
        "total_quantity": sum(lot["quantity"] for lot in lots),
        "total_cost_basis_usd": sum(lot["total_cost_basis_usd"] for lot in lots),
    }
