"""
tests/test_local_agent.py

End-to-end smoke test: atom-sdk → GATE → atom-llm → Gemini.

Prerequisites:
  1. docker compose -f docker-compose.dev.yml up -d --build gate atom-llm
  2. GEMINI_API_KEY set in .env
  3. make seed-dev  (seeds dev-agent with litellm_virtual_key)

Run:
  cd atom-sdk && python3.11 -m pip install -e . -q && cd ..
  pip3.11 install PyJWT cryptography -q
  python3.11 tests/test_local_agent.py

How model-level validation works:
  AtomChatModel(model_name="gemini-2.0-flash")
    → GATE reads agents.litellm_virtual_key from Postgres
    → atom-llm: checks key.models contains "gemini-2.0-flash"   ← enforcement
    → Gemini

  In dev, litellm_virtual_key = LITELLM_MASTER_KEY (no model restriction).
  In production, atom-studio calls POST /atom/provision_agent with
  allowed_models=[...] which creates a scoped key stored per-agent.
"""

import asyncio
import datetime
import os
import sys
from datetime import timezone


def _make_agent_jwt(agent_id: str, domain_id: str, key_path: str) -> str:
    """Generate a short-lived RS256 agent JWT for local testing."""
    try:
        import jwt  # PyJWT  # noqa: PLC0415
    except ImportError:
        print("Install: pip3 install PyJWT cryptography")
        sys.exit(1)

    with open(key_path, encoding="utf-8") as f:
        private_key = f.read()

    now = datetime.datetime.now(timezone.utc)
    payload = {
        "sub": f"agent-{agent_id}",
        "type": "agent",
        "agent_id": agent_id,
        "domain_id": domain_id,
        "iss": "atom-studio",
        "iat": now,
        "exp": now + datetime.timedelta(hours=8),
    }
    return jwt.encode(payload, private_key, algorithm="RS256")


# ── ATOM identity (matches seed_dev.sql) ──────────────────────────────────
AGENT_ID   = "00000000-0000-0000-0000-000000000100"
DOMAIN_ID  = "00000000-0000-0000-0000-000000000010"
GATE_URL   = os.getenv("ATOM_GATE_URL", "http://localhost:8080")
KEY_PATH   = os.getenv("JWT_PRIVATE_KEY_PATH", ".keys/jwt_private.pem")
MODEL_NAME = os.getenv("ATOM_MODEL_NAME", "gemini-2.0-flash")

# Inject env vars before importing atom-sdk (AtomChatModel reads them at init)
os.environ.update({
    "ATOM_GATE_URL":  GATE_URL,
    "ATOM_AGENT_ID":  AGENT_ID,
    "ATOM_DOMAIN_ID": DOMAIN_ID,
    "ATOM_AGENT_JWT": _make_agent_jwt(AGENT_ID, DOMAIN_ID, KEY_PATH),
})

# ── Import atom-sdk ────────────────────────────────────────────────────────
sys.path.insert(0, "atom-sdk/src")
try:
    from agentscope.model import AtomChatModel
except ImportError as e:
    print(f"atom-sdk not installed. Run: cd atom-sdk && pip3.11 install -e .\nError: {e}")
    sys.exit(1)


async def main() -> None:
    """Send a test message through the full ATOM stack and print the response."""
    route = f"{GATE_URL}/domain/{DOMAIN_ID}/agent/{AGENT_ID}/v1/chat/completions"
    print(f"\nATOM local agent smoke test")
    print(f"  Model:  {MODEL_NAME}")
    print(f"  Route:  {route}")
    print()

    # AtomChatModel reads ATOM_GATE_URL, ATOM_DOMAIN_ID, ATOM_AGENT_ID,
    # ATOM_AGENT_JWT from env — do not pass api_key or base_url here.
    model = AtomChatModel(
        model_name=MODEL_NAME,
        stream=False,
        generate_kwargs={"temperature": 0.3},
    )

    messages = [
        {"role": "system", "content": "You are a concise assistant."},
        {"role": "user",   "content": "Say hello in exactly 5 words."},
    ]

    print("Sending: atom-sdk → GATE → atom-llm → Gemini ...")
    response = await model(messages=messages)
    # ChatResponse.content is a list of TextBlock/ToolUseBlock dicts
    text_parts = []
    for block in response.content:
        if isinstance(block, dict) and block.get("type") == "text":
            text_parts.append(block["text"])
        elif hasattr(block, "text"):
            text_parts.append(block.text)
    reply = " ".join(text_parts) or str(response.content)
    print(f"\n✓ Response: {reply}")


if __name__ == "__main__":
    asyncio.run(main())
