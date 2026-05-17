"""Seed the tool registry with demo tools on startup.

Idempotent: each tool is only inserted when no tool with that name exists yet,
so user edits made after first boot are preserved.
"""

import uuid
from datetime import datetime, timezone

from app.core import registry_db

# Stable deterministic UUIDs so re-seeding never creates duplicates even if
# the name check is somehow bypassed.
_NS = uuid.UUID("6ba7b810-9dad-11d1-80b4-00c04fd430c8")  # uuid.NAMESPACE_URL


def _stable_id(name: str) -> str:
    return str(uuid.uuid5(_NS, f"atom-seed-tool-{name}"))


_DEMO_TOOLS = [
    {
        "tool_id": _stable_id("kyc-lookup"),
        "name": "kyc-lookup",
        "display_name": "KYC Lookup",
        "description": "Get KYC profile for a customer from the KYC mock service",
        "scope": "global",
        "tool_type": "http",
        "endpoint": "http://kyc-svc:8095/profile/CUST-100442",
        "method": "GET",
        "auth_type": "api_key",
        "auth_config": {
            "type": "api_key",
            "header_name": "X-API-Key",
            "key": "demo-key-123",
            "in": "header",
            "param_name": "api_key",
            "token": "",
            "username": "",
            "password": "",
            "grant_type": "client_credentials",
            "token_url": "",
            "client_id": "",
            "client_secret": "",
            "scope": "",
            "audience": "",
        },
        "input_schema": {},
        "output_schema": {
            "type": "object",
            "properties": {
                "customer_id": {"type": "string"},
                "name": {"type": "string"},
                "risk_category": {"type": "string", "enum": ["LOW", "MEDIUM", "HIGH"]},
                "kyc_age_days": {"type": "integer"},
                "is_stale": {"type": "boolean"},
            },
        },
        "tags": ["demo", "kyc", "banking"],
        "created_by": "system:seed",
    },
    {
        "tool_id": _stable_id("calculate-risk"),
        "name": "calculate-risk",
        "display_name": "Calculate Risk",
        "description": "Calculate transaction risk score from amount and country code",
        "scope": "global",
        "tool_type": "python",
        "code": (
            "def run(input: dict) -> dict:\n"
            "    amount = float(input.get('amount', 0))\n"
            "    country = input.get('country', 'US')\n"
            "    high_risk = ['IR', 'KP', 'SY', 'CU']\n"
            "    base = min(1.0, amount / 50000)\n"
            "    risk = base * 2.0 if country in high_risk else base\n"
            "    risk = min(1.0, risk)\n"
            "    band = 'HIGH' if risk > 0.7 else 'MEDIUM' if risk > 0.3 else 'LOW'\n"
            "    return {'risk_score': round(risk, 3), 'band': band}"
        ),
        "input_schema": {
            "type": "object",
            "properties": {
                "amount": {"type": "number", "description": "Transaction amount in USD"},
                "country": {"type": "string", "description": "ISO-3166-1 alpha-2 country code"},
            },
            "required": ["amount"],
        },
        "output_schema": {
            "type": "object",
            "properties": {
                "risk_score": {"type": "number", "minimum": 0, "maximum": 1},
                "band": {"type": "string", "enum": ["LOW", "MEDIUM", "HIGH"]},
            },
        },
        "tags": ["demo", "risk", "banking"],
        "created_by": "system:seed",
    },
]


def seed_tools() -> None:
    """Insert demo tools that don't already exist in the registry."""
    existing_names = {t["name"] for t in registry_db.list_tools()}
    now = datetime.now(timezone.utc).isoformat()

    for tool in _DEMO_TOOLS:
        if tool["name"] in existing_names:
            continue
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
        })
        print(f"[seed] registered tool: {tool['name']}")
