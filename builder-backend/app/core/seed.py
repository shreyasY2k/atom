"""Seed the tool registry with demo tools on startup.

Idempotent: each tool is only inserted when no tool with that name exists yet,
so user edits made after first boot are preserved.

All tool names match the callable function names in tools/registry.py so that
generated agent.py code can load them via get_tool_by_name(name).
"""

import uuid
from datetime import datetime, timezone

from app.core import registry_db

_NS = uuid.UUID("6ba7b810-9dad-11d1-80b4-00c04fd430c8")


def _stable_id(name: str) -> str:
    return str(uuid.uuid5(_NS, f"atom-seed-tool-{name}"))


# ---------------------------------------------------------------------------
# Domain / subdomain taxonomy used for tagging tools and agents.
# ---------------------------------------------------------------------------

# Maps tool_name → (domain, subdomain) for all seeded tools.
_TOOL_DOMAIN: dict[str, tuple[str, str]] = {
    "calculate_risk":          ("general",  "risk"),
    "get_customer_profile":    ("banking",  "kyc"),
    "get_kyc_documents":       ("banking",  "kyc"),
    "get_external_screening":  ("banking",  "kyc"),
    "get_kyc_profile":         ("payments", "compliance"),
    "screen_ofac_sanctions":   ("payments", "compliance"),
    "get_transaction_history": ("banking",  "fraud"),
    "get_fraud_signals":       ("banking",  "fraud"),
    "get_customer_positions":  ("banking",  "securities"),
    "get_security_master":     ("banking",  "securities"),
    "check_position_lots":     ("banking",  "securities"),
    "get_overnight_positions": ("banking",  "treasury"),
    "get_market_data":         ("banking",  "treasury"),
    "compute_lcr":             ("banking",  "treasury"),
    "get_trailing_metrics":    ("banking",  "treasury"),
    "validate_hqla_composition": ("banking", "treasury"),
}


# ---------------------------------------------------------------------------
# Tool definitions — names MUST match tools/registry.py function names exactly
# so get_tool_by_name(name) can resolve them in generated agent code.
# ---------------------------------------------------------------------------

_DEMO_TOOLS = [
    # ── General purpose ──────────────────────────────────────────────────────
    {
        "tool_id": _stable_id("calculate_risk"),
        "name": "calculate_risk",
        "display_name": "Calculate Risk",
        "description": "Calculate transaction risk score (LOW/MEDIUM/HIGH) from amount and country code. Pure Python — no service call.",
        "scope": "global",
        "tool_type": "python",
        "tags": ["general", "risk", "payments"],
        "input_schema": {
            "type": "object",
            "properties": {
                "amount":  {"type": "number",  "description": "Transaction amount in USD"},
                "country": {"type": "string",  "description": "ISO-3166-1 alpha-2 country code"},
            },
            "required": ["amount"],
        },
        "output_schema": {
            "type": "object",
            "properties": {
                "risk_score": {"type": "number", "minimum": 0, "maximum": 1},
                "band":       {"type": "string", "enum": ["LOW", "MEDIUM", "HIGH"]},
            },
        },
    },

    # ── KYC (banking-kyc domain) ─────────────────────────────────────────────
    {
        "tool_id": _stable_id("get_customer_profile"),
        "name": "get_customer_profile",
        "display_name": "Get Customer Profile",
        "description": "Pull the current KYC profile for a customer, including identity verification status and staleness flags.",
        "scope": "global",
        "tool_type": "python",
        "tags": ["banking-kyc", "kyc", "banking"],
        "input_schema": {
            "type": "object",
            "properties": {
                "customer_id": {"type": "string", "description": "Bank customer identifier, e.g. CUST-100442"},
            },
            "required": ["customer_id"],
        },
        "output_schema": {
            "type": "object",
            "properties": {
                "customer_id":   {"type": "string"},
                "name":          {"type": "string"},
                "risk_category": {"type": "string", "enum": ["LOW", "MEDIUM", "HIGH"]},
                "kyc_age_days":  {"type": "integer"},
                "is_stale":      {"type": "boolean"},
            },
        },
    },
    {
        "tool_id": _stable_id("get_kyc_documents"),
        "name": "get_kyc_documents",
        "display_name": "Get KYC Documents",
        "description": "Pull the KYC documents on file for a customer.",
        "scope": "global",
        "tool_type": "python",
        "tags": ["banking-kyc", "kyc", "banking"],
        "input_schema": {
            "type": "object",
            "properties": {
                "customer_id": {"type": "string", "description": "Bank customer identifier"},
            },
            "required": ["customer_id"],
        },
        "output_schema": {"type": "object"},
    },
    {
        "tool_id": _stable_id("get_external_screening"),
        "name": "get_external_screening",
        "display_name": "External Screening",
        "description": "Run adverse-media and PEP screening for a customer.",
        "scope": "global",
        "tool_type": "python",
        "tags": ["banking-kyc", "kyc", "screening", "banking"],
        "input_schema": {
            "type": "object",
            "properties": {
                "customer_id": {"type": "string"},
                "name":        {"type": "string", "description": "Customer full name (optional)"},
                "address":     {"type": "string", "description": "Customer address (optional)"},
            },
            "required": ["customer_id"],
        },
        "output_schema": {"type": "object"},
    },

    # ── Payments / Fraud ─────────────────────────────────────────────────────
    {
        "tool_id": _stable_id("get_kyc_profile"),
        "name": "get_kyc_profile",
        "display_name": "KYC Profile (Payments)",
        "description": "Get the KYC profile status for a customer or merchant.",
        "scope": "global",
        "tool_type": "python",
        "tags": ["payments", "kyc", "general"],
        "input_schema": {
            "type": "object",
            "properties": {
                "customer_id": {"type": "string", "description": "Customer or merchant identifier"},
            },
            "required": ["customer_id"],
        },
        "output_schema": {"type": "object"},
    },
    {
        "tool_id": _stable_id("screen_ofac_sanctions"),
        "name": "screen_ofac_sanctions",
        "display_name": "OFAC Sanctions Screen",
        "description": "Screen a customer against the OFAC sanctions list.",
        "scope": "global",
        "tool_type": "python",
        "tags": ["payments", "compliance", "general"],
        "input_schema": {
            "type": "object",
            "properties": {
                "customer_id": {"type": "string"},
                "amount_usd":  {"type": "number", "description": "Transaction amount for threshold checks"},
            },
            "required": ["customer_id"],
        },
        "output_schema": {"type": "object"},
    },
    {
        "tool_id": _stable_id("get_transaction_history"),
        "name": "get_transaction_history",
        "display_name": "Transaction History",
        "description": "Get recent transaction history for a customer including any flagged transactions.",
        "scope": "global",
        "tool_type": "python",
        "tags": ["banking-fraud", "payments", "general"],
        "input_schema": {
            "type": "object",
            "properties": {
                "customer_id": {"type": "string"},
                "limit":       {"type": "integer", "description": "Max transactions to return (default 10)"},
            },
            "required": ["customer_id"],
        },
        "output_schema": {"type": "object"},
    },
    {
        "tool_id": _stable_id("get_fraud_signals"),
        "name": "get_fraud_signals",
        "display_name": "Fraud Signals",
        "description": "Get fraud transaction history, spending baseline, and peer segment for a customer.",
        "scope": "global",
        "tool_type": "python",
        "tags": ["payments", "banking-fraud", "general"],
        "input_schema": {
            "type": "object",
            "properties": {
                "customer_id": {"type": "string"},
            },
            "required": ["customer_id"],
        },
        "output_schema": {"type": "object"},
    },

    # ── Securities / Asset recon ──────────────────────────────────────────────
    {
        "tool_id": _stable_id("get_customer_positions"),
        "name": "get_customer_positions",
        "display_name": "Customer Positions",
        "description": "Get incoming transfer details and current customer holdings for reconciliation.",
        "scope": "global",
        "tool_type": "python",
        "tags": ["banking-securities-ops", "banking"],
        "input_schema": {
            "type": "object",
            "properties": {
                "transfer_id": {"type": "string", "description": "Transfer identifier, e.g. XFER-100442-001"},
            },
            "required": ["transfer_id"],
        },
        "output_schema": {"type": "object"},
    },
    {
        "tool_id": _stable_id("get_security_master"),
        "name": "get_security_master",
        "display_name": "Security Master",
        "description": "Get reference data for a security from the security master.",
        "scope": "global",
        "tool_type": "python",
        "tags": ["banking-securities-ops", "banking"],
        "input_schema": {
            "type": "object",
            "properties": {
                "cusip": {"type": "string", "description": "CUSIP identifier, e.g. 912828ZQ6"},
            },
            "required": ["cusip"],
        },
        "output_schema": {"type": "object"},
    },

    # ── Treasury ─────────────────────────────────────────────────────────────
    {
        "tool_id": _stable_id("get_overnight_positions"),
        "name": "get_overnight_positions",
        "display_name": "Overnight Positions",
        "description": "Get overnight liquidity positions from the treasury data warehouse.",
        "scope": "global",
        "tool_type": "python",
        "tags": ["banking-treasury", "banking"],
        "input_schema": {"type": "object", "properties": {}},
        "output_schema": {"type": "object"},
    },
    {
        "tool_id": _stable_id("get_market_data"),
        "name": "get_market_data",
        "display_name": "Market Data",
        "description": "Get current rates and FX data from market data service.",
        "scope": "global",
        "tool_type": "python",
        "tags": ["banking-treasury", "banking"],
        "input_schema": {"type": "object", "properties": {}},
        "output_schema": {"type": "object"},
    },
    {
        "tool_id": _stable_id("compute_lcr"),
        "name": "compute_lcr",
        "display_name": "Compute LCR",
        "description": "Compute the Liquidity Coverage Ratio from HQLA and 30-day outflows.",
        "scope": "global",
        "tool_type": "python",
        "tags": ["banking-treasury", "banking"],
        "input_schema": {
            "type": "object",
            "properties": {
                "hqla_total":    {"type": "number"},
                "outflows_30d":  {"type": "number"},
            },
            "required": ["hqla_total", "outflows_30d"],
        },
        "output_schema": {"type": "object"},
    },
]


def seed_tools() -> None:
    """Insert demo tools that don't already exist in the registry."""
    existing_names = {t["name"] for t in registry_db.list_tools()}
    now = datetime.now(timezone.utc).isoformat()

    inserted = 0
    for tool in _DEMO_TOOLS:
        name = tool["name"]
        if name in existing_names:
            # Update domain/subdomain even on existing tools
            domain, subdomain = _TOOL_DOMAIN.get(name, ("", ""))
            if domain:
                try:
                    with registry_db._cursor() as cur:
                        cur.execute(
                            "UPDATE tools SET domain=%s, subdomain=%s WHERE name=%s",
                            (domain, subdomain, name),
                        )
                except Exception:
                    pass
            continue
        domain, subdomain = _TOOL_DOMAIN.get(name, ("", ""))
        registry_db.upsert_tool({
            **tool,
            "created_at": now,
            "updated_at": now,
            "endpoint": tool.get("endpoint"),
            "method": tool.get("method", "POST"),
            "code": tool.get("code"),
            "mcp_server_url": None,
            "mcp_transport": "sse",
            "mcp_tool_names": [],
            "owner_agent": None,
            "domain": domain,
            "subdomain": subdomain,
        })
        print(f"[seed] registered tool: {tool['name']}")
        inserted += 1

    if inserted:
        print(f"[seed] {inserted} tools registered")
