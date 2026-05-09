from observability import setup
"""
FNOL / Policy mock service.

Backs the insurance OCR use case. Policies and claim history are seeded
deterministically — the policy numbers in the sample documents match
specific records here that contain the planted issues for the demo.

Demo planted issues:
  POL-882-447-AC (Robert Chen, windshield invoice)
    - Has GLASS_DAMAGE exclusion -> Coverage Validator must catch this.

  POL-771-993-CL (Sandra Martinez, collision invoice)
    - Clean policy, but has 2 prior claims in last 18 months.
    - Demo wow comes from arithmetic mismatch in the invoice itself
      (line items sum != claimed total), which the Validator's
      verify_arithmetic check surfaces.

  POL-339-228-MD (James Okafor, medical bill)
    - Clean policy, no exclusions, no prior claims.
    - This is the BASELINE happy-path demo (used to show the standard flow).
"""

from datetime import date
from fastapi import FastAPI, HTTPException
from typing import Literal

app = FastAPI(title="FNOL & Policy Service", version="0.1.0")

# ============================================================
# SEEDED DATA
# ============================================================

POLICIES = {
    "POL-882-447-AC": {
        "policy_number": "POL-882-447-AC",
        "policyholder": {
            "name": "Robert Chen",
            "id": "PH-44829-CHEN",
            "address": "412 Maple St, Newark NJ 07105",
        },
        "type": "AUTO",
        "effective_date": "2025-08-01",
        "expiration_date": "2026-08-01",
        "deductible": 500.00,
        "limits": {"per_incident": 50000.00, "per_year": 100000.00},
        "coverages": ["COLLISION", "COMPREHENSIVE", "BODILY_INJURY"],
        "exclusions": ["GLASS_DAMAGE", "RACING", "COMMERCIAL_USE"],
        "vehicles": [{
            "vin": "4T1G11AK3NU012873",
            "year": 2022, "make": "Toyota", "model": "Camry XLE"
        }],
    },
    "POL-771-993-CL": {
        "policy_number": "POL-771-993-CL",
        "policyholder": {
            "name": "Sandra Martinez",
            "id": "PH-77291-MART",
            "address": "8829 Oak Ave, Houston TX 77029",
        },
        "type": "AUTO",
        "effective_date": "2024-11-15",
        "expiration_date": "2026-11-15",
        "deductible": 1000.00,
        "limits": {"per_incident": 75000.00, "per_year": 150000.00},
        "coverages": ["COLLISION", "COMPREHENSIVE", "BODILY_INJURY", "GLASS_DAMAGE"],
        "exclusions": ["RACING", "COMMERCIAL_USE"],
        "vehicles": [{
            "vin": "2HKRW2H56MH604718",
            "year": 2021, "make": "Honda", "model": "CR-V EX-L"
        }],
    },
    "POL-339-228-MD": {
        "policy_number": "POL-339-228-MD",
        "policyholder": {
            "name": "James Okafor",
            "id": "PH-33391-OKAF",
            "address": "2231 Lakeshore Dr, Chicago IL 60611",
        },
        "type": "HEALTH",
        "effective_date": "2025-01-01",
        "expiration_date": "2026-12-31",
        "deductible": 1500.00,
        "limits": {"per_incident": 50000.00, "per_year": 250000.00},
        "coverages": ["EMERGENCY_CARE", "HOSPITAL", "PRESCRIPTION", "DIAGNOSTIC"],
        "exclusions": ["COSMETIC", "EXPERIMENTAL"],
        "in_network_only": False,
    },
}

CLAIMS_HISTORY = {
    "POL-882-447-AC": [
        # No prior claims
    ],
    "POL-771-993-CL": [
        {"claim_id": "CLM-2025-09-0177",
         "date": "2025-09-12", "amount": 1820.00,
         "type": "COLLISION", "status": "PAID"},
        {"claim_id": "CLM-2025-12-0552",
         "date": "2025-12-03", "amount": 745.00,
         "type": "COMPREHENSIVE", "status": "PAID"},
    ],
    "POL-339-228-MD": [],
}

# Coverage rules — used by check_coverage tool.
COVERAGE_RULES = {
    "AUTO": {
        "windshield_repair": {
            "covered_under": ["COMPREHENSIVE", "GLASS_DAMAGE"],
            "blocked_by_exclusion": "GLASS_DAMAGE",  # if exclusion present, deny
            "min_deductible_applies": True,
        },
        "collision_damage": {
            "covered_under": ["COLLISION"],
            "blocked_by_exclusion": None,
            "min_deductible_applies": True,
        },
    },
    "HEALTH": {
        "emergency_visit": {
            "covered_under": ["EMERGENCY_CARE"],
            "blocked_by_exclusion": None,
            "min_deductible_applies": True,
        },
    },
}


# ============================================================
# ENDPOINTS
# ============================================================

@app.get("/health")
def health():
    return {"status": "ok"}


@app.get("/policies/{policy_number}")
def lookup_policy(policy_number: str):
    pol = POLICIES.get(policy_number)
    if not pol:
        raise HTTPException(status_code=404, detail=f"policy {policy_number} not found")
    return pol


@app.get("/claims-history/{policy_number}")
def get_claims_history(policy_number: str, lookback_days: int = 730):
    if policy_number not in POLICIES:
        raise HTTPException(status_code=404, detail=f"policy {policy_number} not found")
    return {
        "policy_number": policy_number,
        "lookback_days": lookback_days,
        "claims": CLAIMS_HISTORY.get(policy_number, []),
        "claim_count": len(CLAIMS_HISTORY.get(policy_number, [])),
    }


@app.post("/coverage-check")
def check_coverage(payload: dict):
    """
    Apply coverage rules. Input:
      {
        "policy_number": "POL-...",
        "claim_type": "windshield_repair" | "collision_damage" | "emergency_visit",
        "claim_amount": float
      }
    Returns coverage decision + payable amount + reason.
    """
    pol_num = payload.get("policy_number")
    claim_type = payload.get("claim_type")
    amount = float(payload.get("claim_amount", 0))

    pol = POLICIES.get(pol_num)
    if not pol:
        raise HTTPException(status_code=404, detail=f"policy {pol_num} not found")

    rules = COVERAGE_RULES.get(pol["type"], {}).get(claim_type)
    if not rules:
        return {
            "decision": "REVIEW_REQUIRED",
            "reason": f"No automated rule for claim_type={claim_type} on {pol['type']} policy",
        }

    # Check exclusion first
    if rules["blocked_by_exclusion"] and rules["blocked_by_exclusion"] in pol["exclusions"]:
        return {
            "decision": "DENIED",
            "reason": f"Policy excludes {rules['blocked_by_exclusion']}",
            "exclusion_code": rules["blocked_by_exclusion"],
            "claimed_amount": amount,
            "payable_amount": 0.00,
        }

    # Check coverage presence
    has_coverage = any(c in pol["coverages"] for c in rules["covered_under"])
    if not has_coverage:
        return {
            "decision": "DENIED",
            "reason": f"Policy lacks required coverage. Need one of: {rules['covered_under']}",
            "claimed_amount": amount,
            "payable_amount": 0.00,
        }

    # Apply deductible
    deductible = pol["deductible"] if rules["min_deductible_applies"] else 0
    payable = max(0, amount - deductible)
    payable = min(payable, pol["limits"]["per_incident"])

    return {
        "decision": "APPROVED",
        "reason": f"Covered under {rules['covered_under']}",
        "claimed_amount": amount,
        "deductible": deductible,
        "payable_amount": payable,
        "coverage_used": rules["covered_under"],
    }


@app.post("/red-flag-signals")
def get_red_flag_signals(payload: dict):
    """
    Produce fraud-pattern signals for a claim.
    Input: { "policy_number": ..., "claim_amount": ..., "loss_date": "YYYY-MM-DD" }
    """
    pol_num = payload.get("policy_number")
    pol = POLICIES.get(pol_num)
    if not pol:
        raise HTTPException(status_code=404, detail=f"policy {pol_num} not found")

    claims = CLAIMS_HISTORY.get(pol_num, [])
    flags = []

    # Pattern 1: multiple claims in the last 18 months
    if len(claims) >= 2:
        flags.append({
            "code": "FREQUENT_CLAIMS",
            "severity": "MEDIUM",
            "detail": f"{len(claims)} prior claims in lookback window",
            "evidence": [c["claim_id"] for c in claims],
        })

    # Pattern 2: claim within 30 days of policy effective
    eff = pol["effective_date"]
    loss = payload.get("loss_date")
    if loss:
        from datetime import datetime
        eff_d = datetime.strptime(eff, "%Y-%m-%d").date()
        loss_d = datetime.strptime(loss, "%Y-%m-%d").date()
        if (loss_d - eff_d).days <= 30:
            flags.append({
                "code": "FRESH_POLICY",
                "severity": "HIGH",
                "detail": f"Loss occurred {(loss_d - eff_d).days} days after policy effective date",
            })

    # Pattern 3: amount close to limit
    amt = float(payload.get("claim_amount", 0))
    limit = pol["limits"]["per_incident"]
    if amt > 0 and amt / limit > 0.7:
        flags.append({
            "code": "NEAR_LIMIT",
            "severity": "LOW",
            "detail": f"Claim amount is {amt/limit*100:.1f}% of per-incident limit",
        })

    return {
        "policy_number": pol_num,
        "flag_count": len(flags),
        "flags": flags,
    }


@app.post("/verify-arithmetic")
def verify_arithmetic(payload: dict):
    """
    Independently verify that line item amounts sum to the claimed total.
    Tolerance: 1 cent.

    Input: { "line_items": [{"description": str, "amount": float}], "claimed_total": float }
    """
    items = payload.get("line_items", [])
    claimed = float(payload.get("claimed_total", 0))
    computed = sum(float(i.get("amount", 0)) for i in items)
    diff = round(claimed - computed, 2)

    return {
        "computed_total": round(computed, 2),
        "claimed_total": round(claimed, 2),
        "difference": diff,
        "match": abs(diff) < 0.01,
        "item_count": len(items),
    }

setup(app, "fnol-svc")
