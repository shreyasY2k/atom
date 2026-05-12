"""
Domain tool registry.
Each tool is a thin httpx wrapper around a mock service endpoint.
resolve_tools(domain, names) returns the requested callables.

This file is also COPIED into deployed agent containers so that
generated agent.py can import from tools.registry.
"""

import os
import httpx

# ---------------------------------------------------------------------------
# Banking — KYC
# ---------------------------------------------------------------------------

def get_customer_profile(customer_id: str) -> dict:
    """Pull the current KYC profile for a customer, including staleness flags.

    Args:
        customer_id: Bank customer identifier, e.g. CUST-100442.
    """
    url = f"{os.environ['KYC_SVC_URL']}/profile/{customer_id}"
    return httpx.get(url, timeout=10).json()


def get_kyc_documents(customer_id: str) -> dict:
    """Pull the KYC documents on file for a customer.

    Args:
        customer_id: Bank customer identifier.
    """
    url = f"{os.environ['KYC_SVC_URL']}/documents/{customer_id}"
    return httpx.get(url, timeout=10).json()


def get_external_screening(customer_id: str, name: str = "", address: str = "") -> dict:
    """Run adverse-media and PEP screening for a customer.

    Args:
        customer_id: Bank customer identifier.
        name: Customer full name (optional, used for cross-matching).
        address: Customer address (optional).
    """
    url = f"{os.environ['KYC_SVC_URL']}/screening"
    return httpx.post(url, json={"customer_id": customer_id, "name": name, "address": address}, timeout=10).json()


# ---------------------------------------------------------------------------
# Banking — Securities Operations (asset-recon)
# ---------------------------------------------------------------------------

def get_customer_positions(transfer_id: str) -> dict:
    """Get the incoming transfer details and current customer holdings for reconciliation.

    Args:
        transfer_id: Transfer identifier, e.g. XFER-100442-001.
    """
    url = f"{os.environ['SECURITIES_OPS_URL']}/positions/{transfer_id}"
    return httpx.get(url, timeout=10).json()


def get_security_master(cusip: str) -> dict:
    """Get reference data for a security from the security master.

    Args:
        cusip: CUSIP identifier, e.g. 912828ZQ6.
    """
    url = f"{os.environ['SECURITIES_OPS_URL']}/security-master/{cusip}"
    return httpx.get(url, timeout=10).json()


def check_position_lots(customer_id: str, cusip: str) -> dict:
    """Get lot-level breakdown of a customer's position in a given security.

    Args:
        customer_id: Bank customer identifier.
        cusip: CUSIP of the security.
    """
    url = f"{os.environ['SECURITIES_OPS_URL']}/position-lots"
    return httpx.post(url, json={"customer_id": customer_id, "cusip": cusip}, timeout=10).json()


# ---------------------------------------------------------------------------
# Banking — Treasury
# ---------------------------------------------------------------------------

def get_overnight_positions() -> dict:
    """Get overnight liquidity positions from the treasury data warehouse."""
    url = f"{os.environ['TREASURY_DW_URL']}/positions"
    return httpx.get(url, timeout=10).json()


def get_market_data() -> dict:
    """Get current rates and FX data from market data service."""
    rates = httpx.get(f"{os.environ['MARKET_DATA_URL']}/rates", timeout=10).json()
    fx    = httpx.get(f"{os.environ['MARKET_DATA_URL']}/fx", timeout=10).json()
    return {**rates, "fx": fx}


def compute_lcr(hqla_total: float, outflows_30d: float) -> dict:
    """Compute the Liquidity Coverage Ratio.

    Args:
        hqla_total: Total high-quality liquid assets in USD.
        outflows_30d: Net cash outflows over 30 days in USD.
    """
    url = f"{os.environ['LCR_ENGINE_URL']}/calculate"
    return httpx.post(url, json={"hqla_total": hqla_total, "outflows_30d": outflows_30d}, timeout=10).json()


def get_trailing_metrics() -> dict:
    """Get trailing LCR and liquidity metrics (stub — returns synthetic data)."""
    return {
        "lcr_30d_avg": 1.28,
        "lcr_90d_avg": 1.31,
        "hqla_trend": "stable",
        "note": "Trailing metrics are synthetic for V1 demo.",
    }


def validate_hqla_composition(positions: dict) -> dict:
    """Validate HQLA composition against regulatory caps (checker-exclusive tool).

    Args:
        positions: Dict with keys hqla_l1_usd, hqla_l2_usd, total_assets_usd.
    """
    l1 = float(positions.get("hqla_l1_usd", 0))
    l2 = float(positions.get("hqla_l2_usd", 0))
    total = float(positions.get("total_assets_usd", 1))
    l2_cap_pct = l2 / (l1 + l2) if (l1 + l2) > 0 else 0
    return {
        "l1_usd": l1,
        "l2_usd": l2,
        "l2_pct_of_hqla": round(l2_cap_pct * 100, 2),
        "l2_cap_regulatory_pct": 40.0,
        "l2_cap_breach": l2_cap_pct > 0.40,
        "verdict": "FAIL" if l2_cap_pct > 0.40 else "PASS",
    }


# ---------------------------------------------------------------------------
# Insurance — Claims
# ---------------------------------------------------------------------------

def extract_document_text(sample_id: str) -> dict:
    """Extract text from a pre-staged claim document using OCR.

    Args:
        sample_id: Sample document identifier, e.g. auto-repair-windshield.
    """
    url = f"{os.environ['OCR_SVC_URL']}/ocr/extract-by-sample-id"
    return httpx.get(url, params={"sample_id": sample_id}, timeout=30).json()


def parse_repair_estimate(text: str) -> dict:
    """Parse a repair estimate text into structured line items (heuristic stub).

    Args:
        text: Raw OCR-extracted text from a repair invoice.
    """
    lines = [l.strip() for l in text.split("\n") if l.strip()]
    items = []
    total = 0.0
    for line in lines:
        parts = line.rsplit(" ", 1)
        if len(parts) == 2:
            try:
                amt = float(parts[1].replace("$", "").replace(",", ""))
                items.append({"description": parts[0], "amount": amt})
                total += amt
            except ValueError:
                pass
    return {"line_items": items, "parsed_total": round(total, 2)}


def lookup_policy(policy_number: str) -> dict:
    """Look up a policy by number.

    Args:
        policy_number: Policy identifier, e.g. POL-882-447-AC.
    """
    url = f"{os.environ['FNOL_SVC_URL']}/policies/{policy_number}"
    return httpx.get(url, timeout=10).json()


def get_claims_history(policy_number: str, lookback_days: int = 730) -> dict:
    """Get prior claims history for a policy.

    Args:
        policy_number: Policy identifier.
        lookback_days: How many days back to look (default 730 = 2 years).
    """
    url = f"{os.environ['FNOL_SVC_URL']}/claims-history/{policy_number}"
    return httpx.get(url, params={"lookback_days": lookback_days}, timeout=10).json()


def verify_arithmetic(line_items: list, claimed_total: float) -> dict:
    """Verify that invoice line items sum to the claimed total.

    Args:
        line_items: List of dicts with 'description' and 'amount' keys.
        claimed_total: The total amount stated on the invoice.
    """
    url = f"{os.environ['FNOL_SVC_URL']}/verify-arithmetic"
    return httpx.post(url, json={"line_items": line_items, "claimed_total": claimed_total}, timeout=10).json()


def check_coverage(policy_number: str, claim_type: str, claim_amount: float) -> dict:
    """Check whether a claim type and amount is covered under the policy.

    Args:
        policy_number: Policy identifier.
        claim_type: Type of claim, e.g. windshield_repair or collision_damage.
        claim_amount: Claimed amount in USD.
    """
    url = f"{os.environ['FNOL_SVC_URL']}/coverage-check"
    return httpx.post(url, json={"policy_number": policy_number, "claim_type": claim_type, "claim_amount": claim_amount}, timeout=10).json()


def get_red_flag_signals(policy_number: str, claim_amount: float, loss_date: str) -> dict:
    """Get fraud-pattern signals for a claim.

    Args:
        policy_number: Policy identifier.
        claim_amount: Claimed amount in USD.
        loss_date: Date of loss in YYYY-MM-DD format.
    """
    url = f"{os.environ['FNOL_SVC_URL']}/red-flag-signals"
    return httpx.post(url, json={"policy_number": policy_number, "claim_amount": claim_amount, "loss_date": loss_date}, timeout=10).json()


# ---------------------------------------------------------------------------
# Banking — Fraud (transaction-anomaly-triage)
# ---------------------------------------------------------------------------

def get_transaction_history(customer_id: str, limit: int = 10) -> dict:
    """Get recent transaction history for a customer including any flagged transactions.

    Args:
        customer_id: Bank customer identifier, e.g. CUST-100442.
        limit: Maximum number of transactions to return (default 10).
    """
    url = f"{os.environ['FRAUD_SVC_URL']}/transactions"
    return httpx.get(url, params={"customer_id": customer_id, "limit": limit}, timeout=10).json()


def get_customer_baseline(customer_id: str) -> dict:
    """Get spending baseline and risk tier for a customer.

    Args:
        customer_id: Bank customer identifier.
    """
    url = f"{os.environ['FRAUD_SVC_URL']}/customer-baseline"
    return httpx.get(url, params={"customer_id": customer_id}, timeout=10).json()


def get_peer_segment_stats(customer_id: str) -> dict:
    """Get peer segment statistics for comparison against the customer's behaviour.

    Args:
        customer_id: Bank customer identifier.
    """
    url = f"{os.environ['FRAUD_SVC_URL']}/peer-segment"
    return httpx.get(url, params={"customer_id": customer_id}, timeout=10).json()


# ---------------------------------------------------------------------------
# Payments — payout risk and compliance
# ---------------------------------------------------------------------------

def screen_ofac_sanctions(customer_id: str, amount_usd: float = 0) -> dict:
    """Screen a customer against the OFAC sanctions list.

    Args:
        customer_id: Customer or merchant identifier.
        amount_usd: Transaction amount in USD (used for threshold checks).
    """
    url = f"{os.environ.get('OFAC_SVC_URL', 'http://ofac-svc:8096')}/screen"
    return httpx.post(url, json={"customer_id": customer_id, "amount_usd": amount_usd}, timeout=10).json()


def get_kyc_profile(customer_id: str) -> dict:
    """Get the KYC profile status for a customer or merchant.

    Args:
        customer_id: Customer or merchant identifier, e.g. CUST-100442.
    """
    url = f"{os.environ.get('KYC_SVC_URL', 'http://kyc-svc:8095')}/profile/{customer_id}"
    return httpx.get(url, timeout=10).json()


def get_fraud_signals(customer_id: str) -> dict:
    """Get fraud transaction history, spending baseline, and peer segment for a customer.

    Args:
        customer_id: Customer or merchant identifier.
    """
    fraud_url = os.environ.get("FRAUD_SVC_URL", "http://fraud-svc:8102")
    history  = httpx.get(f"{fraud_url}/transactions",    params={"customer_id": customer_id, "limit": 10}, timeout=10).json()
    baseline = httpx.get(f"{fraud_url}/customer-baseline", params={"customer_id": customer_id}, timeout=10).json()
    segment  = httpx.get(f"{fraud_url}/peer-segment",    params={"customer_id": customer_id}, timeout=10).json()
    return {"transaction_history": history, "baseline": baseline, "peer_segment": segment}


# ---------------------------------------------------------------------------
# Tool name aliases (must be defined BEFORE DOMAIN_TOOLS)
# ---------------------------------------------------------------------------

def _alias(fn, name: str):
    """Create a function alias with a different __name__ so resolve_tools finds it."""
    import functools
    @functools.wraps(fn)
    def wrapper(*args, **kwargs):
        return fn(*args, **kwargs)
    wrapper.__name__ = name
    wrapper.__qualname__ = name
    return wrapper


# Common Gemini-generated name variants for payments domain tools.
_PAYMENTS_ALIASES = [
    _alias(get_customer_baseline,   "get_risk_baseline"),
    _alias(get_customer_baseline,   "get_customer_risk_baseline"),
    _alias(get_customer_baseline,   "get_risk_profile"),
    _alias(get_kyc_profile,         "get_kyc_status"),
    _alias(get_kyc_profile,         "check_kyc_profile"),
    _alias(get_kyc_profile,         "get_kyc_data"),
    _alias(screen_ofac_sanctions,   "check_ofac_sanctions"),
    _alias(screen_ofac_sanctions,   "screen_ofac"),
    _alias(screen_ofac_sanctions,   "ofac_screen"),
    _alias(screen_ofac_sanctions,   "get_ofac_screening"),
    _alias(get_transaction_history, "get_fraud_history"),
    _alias(get_transaction_history, "get_transaction_data"),
    _alias(get_fraud_signals,       "get_risk_signals"),
    _alias(get_fraud_signals,       "get_fraud_data"),
]


# ---------------------------------------------------------------------------
# Domain registry
# ---------------------------------------------------------------------------

DOMAIN_TOOLS: dict[str, list] = {
    "banking-kyc": [
        get_customer_profile,
        get_kyc_documents,
        get_external_screening,
    ],
    "banking-securities-ops": [
        get_customer_positions,
        get_security_master,
        check_position_lots,
    ],
    "banking-treasury": [
        get_overnight_positions,
        get_market_data,
        compute_lcr,
        get_trailing_metrics,
        validate_hqla_composition,
    ],
    "insurance-claims": [
        extract_document_text,
        parse_repair_estimate,
        lookup_policy,
        get_claims_history,
        verify_arithmetic,
        check_coverage,
        get_red_flag_signals,
    ],
    "banking-fraud": [
        get_transaction_history,
        get_customer_baseline,
        get_peer_segment_stats,
    ],
    "payments": [
        # Canonical names
        get_fraud_signals,
        get_kyc_profile,
        screen_ofac_sanctions,
        get_transaction_history,
        get_customer_baseline,
        get_peer_segment_stats,
        get_customer_profile,
        get_external_screening,
        # Aliases — Gemini frequently generates these name variants
        *_PAYMENTS_ALIASES,
    ],
}


def resolve_tools(domain: str, names: list[str]) -> list:
    """Return the callable tool functions for the given domain and name list.
    Unrecognised names are printed as a warning — silent drops caused hard-to-debug
    FunctionNotFoundError at runtime when Gemini generated a variant tool name.
    """
    import sys
    available = {fn.__name__: fn for fn in DOMAIN_TOOLS.get(domain, [])}
    result = []
    for n in names:
        if n in available:
            result.append(available[n])
        else:
            print(f"[tools.registry] WARNING: tool '{n}' not found in domain '{domain}'. "
                  f"Available: {sorted(available)}", file=sys.stderr)
    return result
