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
        "description": "Get KYC profile for any customer. Pass customer_id (e.g. CUST-100442) to retrieve identity, risk category, and KYC staleness.",
        "scope": "global",
        "tool_type": "python",
        "code": (
            "def run(input: dict) -> dict:\n"
            "    import httpx\n"
            "    customer_id = input.get('customer_id', '').strip()\n"
            "    if not customer_id:\n"
            "        return {'error': 'customer_id is required'}\n"
            "    url = f'http://kyc-svc:8095/profile/{customer_id}'\n"
            "    try:\n"
            "        resp = httpx.get(url, headers={'X-API-Key': 'demo-key-123'}, timeout=10)\n"
            "        if resp.status_code == 404:\n"
            "            return {'error': f'Customer {customer_id} not found in KYC system'}\n"
            "        return resp.json()\n"
            "    except Exception as e:\n"
            "        return {'error': f'KYC service unavailable: {str(e)}'}\n"
        ),
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
    existing = {t["name"]: t for t in registry_db.list_tools()}
    now = datetime.now(timezone.utc).isoformat()

    for tool in _DEMO_TOOLS:
        existing_tool = existing.get(tool["name"])
        # Skip only if the correct tool_type is already present; re-seed if type changed.
        if existing_tool and existing_tool.get("tool_type") == tool.get("tool_type"):
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
