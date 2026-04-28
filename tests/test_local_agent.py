"""
tests/test_local_agent.py

End-to-end smoke test: atom-sdk → GATE → atom-llm → Gemini.

Prerequisites:
  1. docker compose -f docker-compose.dev.yml up -d gate atom-llm
  2. GEMINI_API_KEY set in .env and loaded
  3. seed_dev.sql applied (make seed-dev)

Run:
  cd atom-sdk && python3.11 -m pip install -e . -q && cd ..
  python3.11 tests/test_local_agent.py
"""

import asyncio
import datetime
import os
import sys

# ── Generate a short-lived agent JWT using the dev private key ─────────────
def make_agent_jwt(agent_id: str, domain_id: str, key_path: str) -> str:
    try:
        import jwt  # PyJWT
    except ImportError:
        print("Install PyJWT: pip3 install PyJWT cryptography")
        sys.exit(1)

    with open(key_path) as f:
        private_key = f.read()

    payload = {
        "sub": f"agent-{agent_id}",
        "type": "agent",
        "agent_id": agent_id,
        "domain_id": domain_id,
        "iss": "atom-studio",
        "iat": datetime.datetime.utcnow(),
        "exp": datetime.datetime.utcnow() + datetime.timedelta(hours=8),
    }
    return jwt.encode(payload, private_key, algorithm="RS256")


# ── ATOM identity (matches seed_dev.sql) ──────────────────────────────────
AGENT_ID   = "00000000-0000-0000-0000-000000000100"
DOMAIN_ID  = "00000000-0000-0000-0000-000000000010"
GATE_URL   = os.getenv("ATOM_GATE_URL", "http://localhost:8080")
KEY_PATH   = os.getenv("JWT_PRIVATE_KEY_PATH", ".keys/jwt_private.pem")
MODEL_NAME = os.getenv("ATOM_MODEL_NAME", "gemini-2.0-flash")

# Generate JWT and inject env vars before importing atom-sdk
jwt_token = make_agent_jwt(AGENT_ID, DOMAIN_ID, KEY_PATH)
os.environ["ATOM_GATE_URL"]   = GATE_URL
os.environ["ATOM_AGENT_ID"]   = AGENT_ID
os.environ["ATOM_DOMAIN_ID"]  = DOMAIN_ID
os.environ["ATOM_AGENT_JWT"]  = jwt_token

# ── Import atom-sdk (must come after env vars are set) ────────────────────
sys.path.insert(0, "atom-sdk/src")
try:
    from agentscope.model import AtomChatModel
    from agentscope.message import Msg
except ImportError as e:
    print(f"atom-sdk not installed. Run: cd atom-sdk && pip3.11 install -e .\nError: {e}")
    sys.exit(1)


async def main() -> None:
    print(f"\nATOM local agent test")
    print(f"  GATE:   {GATE_URL}")
    print(f"  Agent:  {AGENT_ID}")
    print(f"  Domain: {DOMAIN_ID}")
    print(f"  Model:  {MODEL_NAME}")
    print(f"  Route:  {GATE_URL}/domain/{DOMAIN_ID}/agent/{AGENT_ID}/v1/chat/completions")
    print()

    model = AtomChatModel(
        model_name=MODEL_NAME,
        stream=False,
        generate_kwargs={"temperature": 0.3},
    )

    messages = [
        {"role": "system", "content": "You are a concise assistant."},
        {"role": "user",   "content": "Say hello in exactly 5 words."},
    ]

    print("Sending request through GATE → atom-llm → Gemini...")
    try:
        response = await model(messages=messages)
        print(f"\n✓ Response: {response.text}")
        print(f"  Model used: {getattr(response, 'model', MODEL_NAME)}")
    except Exception as e:
        print(f"\n✗ Request failed: {e}")
        raise


if __name__ == "__main__":
    asyncio.run(main())
