#!/usr/bin/env python3
"""
ATOM Example Agent Provisioner
===============================
Provisions 4 example agents in atom-studio and deploys them.

Usage:
    # Docker Compose (default)
    python examples/provision.py

    # Kubernetes (kind cluster)
    python examples/provision.py --mode k8s

    # Custom studio URL
    python examples/provision.py --studio http://localhost:3001

What this script does:
    1. Logs in to atom-studio as admin
    2. Creates an "examples" domain
    3. Creates 4 agents (financial-assistant, summarizer, risk-checker, support-bot)
    4. Builds Docker images for each agent
    5. Loads images into the cluster (k8s) or local daemon (docker)
    6. Submits deployments and auto-approves HITL
    7. Waits for all agents to be ready
    8. Prints curl commands to chat with each agent

Requirements:
    pip install httpx

Environment:
    ATOM_STUDIO_URL   atom-studio API URL (default: http://localhost:3001)
    ATOM_GATE_URL     GATE URL (default: http://localhost:8080)
    ADMIN_EMAIL       admin email (default: admin@atom.local)
    ADMIN_PASSWORD    admin password (default: admin123)
    GEMINI_API_KEY    required for agents to call the LLM
"""

import argparse
import json
import os
import subprocess
import sys
import time
from pathlib import Path

import httpx

# ── Configuration ─────────────────────────────────────────────────────────────

EXAMPLES_DIR = Path(__file__).parent
AGENTS_DIR   = EXAMPLES_DIR / "agents"

AGENTS = [
    {
        "key":         "financial-assistant",
        "name":        "Financial Assistant",
        "description": "BFSI compliance and regulatory Q&A — RBI, SEBI, DPDP, PCI-DSS",
        "models":      ["gemini-2.5-flash"],
        "rpm_limit":   30,
    },
    {
        "key":         "summarizer",
        "name":        "Document Summarizer",
        "description": "Produces executive summaries, key points, and action items",
        "models":      ["gemini-2.5-flash"],
        "rpm_limit":   30,
    },
    {
        "key":         "risk-checker",
        "name":        "Risk Checker",
        "description": "Assesses financial risk level and recommends controls",
        "models":      ["gemini-2.5-flash"],
        "rpm_limit":   20,
    },
    {
        "key":         "support-bot",
        "name":        "Customer Support Bot",
        "description": "Handles customer queries for an Indian fintech",
        "models":      ["gemini-2.5-flash"],
        "rpm_limit":   60,
    },
]

SAMPLE_MESSAGES = {
    "financial-assistant": "What are the KYC requirements under RBI Master Direction 2016?",
    "summarizer":          "Summarise this: The Reserve Bank of India today announced a 25 basis point cut to the repo rate, bringing it to 6.25%. The Monetary Policy Committee voted 4-2 in favour of the cut, citing easing inflation and the need to support growth.",
    "risk-checker":        "Transaction: Customer is sending Rs 50 lakh overseas to a new beneficiary in a high-risk jurisdiction. Assess the risk.",
    "support-bot":         "I have not received my debit card after 10 days of ordering it. What should I do?",
}


# ── Helpers ───────────────────────────────────────────────────────────────────

def run(cmd: list[str], check=True, capture=False) -> subprocess.CompletedProcess:
    kwargs = {"capture_output": capture, "text": True}
    if check:
        kwargs["check"] = True
    return subprocess.run(cmd, **kwargs)


def banner(text: str):
    print(f"\n{'─' * 60}")
    print(f"  {text}")
    print(f"{'─' * 60}")


def ok(msg: str):
    print(f"  ✓ {msg}")


def info(msg: str):
    print(f"  → {msg}")


def fail(msg: str):
    print(f"  ✗ {msg}")
    sys.exit(1)


# ── Studio API client ─────────────────────────────────────────────────────────

class StudioClient:
    def __init__(self, base_url: str, email: str, password: str):
        self.base = base_url.rstrip("/")
        self.token: str | None = None
        self._login(email, password)

    def _login(self, email: str, password: str):
        resp = httpx.post(
            f"{self.base}/api/auth/login",
            json={"email": email, "password": password},
            timeout=10,
        )
        if resp.status_code != 200:
            fail(f"Login failed ({resp.status_code}): {resp.text[:200]}")
        self.token = resp.json()["access_token"]
        ok(f"Logged in as {email}")

    def _h(self):
        return {"Authorization": f"Bearer {self.token}"}

    def create_domain(self, name: str, description: str) -> dict:
        resp = httpx.post(
            f"{self.base}/api/domains/",
            json={"name": name, "description": description},
            headers=self._h(), timeout=30,
        )
        if resp.status_code == 201:
            return resp.json()
        # Already exists? Find it
        if resp.status_code in (409, 400):
            domains = httpx.get(f"{self.base}/api/domains/", headers=self._h(), timeout=10).json()
            for d in domains:
                if d["name"] == name:
                    return d
        fail(f"create_domain failed: {resp.status_code} {resp.text[:200]}")

    def create_agent(self, domain_id: str, payload: dict) -> tuple[dict, str]:
        resp = httpx.post(
            f"{self.base}/api/domains/{domain_id}/agents/",
            json=payload, headers=self._h(), timeout=30,
        )
        if resp.status_code != 201:
            fail(f"create_agent failed: {resp.status_code} {resp.text[:200]}")
        data = resp.json()
        return data["agent"], data["token"]

    def submit_deployment(self, agent_id: str, image: str, message: str) -> dict:
        resp = httpx.post(
            f"{self.base}/api/deployments/{agent_id}",
            json={"image": image, "message": message},
            headers=self._h(), timeout=15,
        )
        if resp.status_code != 201:
            fail(f"submit_deployment failed: {resp.status_code} {resp.text[:200]}")
        return resp.json()

    def get_hitl_queue(self) -> list:
        resp = httpx.get(f"{self.base}/api/hitl/queue", headers=self._h(), timeout=10)
        return resp.json() if resp.status_code == 200 else []

    def approve_hitl(self, hitl_id: str):
        httpx.post(
            f"{self.base}/api/hitl/{hitl_id}/decide",
            json={"approved": True, "note": "auto-approved by provision script"},
            headers=self._h(), timeout=10,
        )


# ── Build + load images ───────────────────────────────────────────────────────

def build_image(agent_key: str, image_tag: str):
    agent_dir = AGENTS_DIR / agent_key
    # Dockerfile installs atom-platform-sdk directly from GitHub — no local copy needed.
    info(f"Building {image_tag}...")
    run(["docker", "build", "-t", image_tag, str(agent_dir), "-q"])
    ok(f"Built {image_tag}")


def load_image_k8s(image_tag: str, cluster: str = "atom"):
    info(f"Loading {image_tag} into kind cluster '{cluster}'...")
    run(["kind", "load", "docker-image", image_tag, "--name", cluster])
    ok(f"Loaded into kind")


# ── Wait for k8s deployment ───────────────────────────────────────────────────

def wait_k8s_deployment(agent_id: str, timeout: int = 120):
    dep = f"agent-{agent_id}"
    info(f"Waiting for k8s deployment {dep}...")
    result = run(
        ["kubectl", "wait", f"deployment/{dep}",
         "--for=condition=available", "-n", "atom-agents",
         f"--timeout={timeout}s"],
        check=False, capture=True,
    )
    if result.returncode == 0:
        ok("Pod is running")
        return True
    info(f"Deployment not ready within {timeout}s (pod may still be pulling image)")
    return False


# ── Wait for docker deployment ────────────────────────────────────────────────

def wait_docker_container(agent_key: str, timeout: int = 60):
    container = f"agent-{agent_key}"
    info(f"Waiting for docker container {container}...")
    deadline = time.time() + timeout
    while time.time() < deadline:
        r = run(["docker", "inspect", container, "--format", "{{.State.Health.Status}}"],
                check=False, capture=True)
        status = r.stdout.strip()
        if status == "healthy":
            ok("Container healthy")
            return True
        if status not in ("starting", ""):
            info(f"Container status: {status}")
        time.sleep(3)
    info("Container not healthy within timeout")
    return False


# ── Main ──────────────────────────────────────────────────────────────────────

def main():
    parser = argparse.ArgumentParser(description="Provision ATOM example agents")
    parser.add_argument("--mode", choices=["docker", "k8s"], default="docker",
                        help="Deployment mode (default: docker)")
    parser.add_argument("--studio", default=os.environ.get("ATOM_STUDIO_URL", "http://localhost:3001"),
                        help="atom-studio API URL")
    parser.add_argument("--gate", default=os.environ.get("ATOM_GATE_URL", "http://localhost:8080"),
                        help="GATE URL (used in agent healthcheck)")
    parser.add_argument("--email", default=os.environ.get("ADMIN_EMAIL", "admin@atom.local"))
    parser.add_argument("--password", default=os.environ.get("ADMIN_PASSWORD", "admin123"))
    parser.add_argument("--cluster", default="atom", help="kind cluster name (k8s mode)")
    parser.add_argument("--skip-build", action="store_true", help="Skip docker build step")
    args = parser.parse_args()

    print(f"""
╔══════════════════════════════════════════════════════════════╗
║          ATOM Example Agent Provisioner                      ║
║  Mode: {args.mode:<10}  Studio: {args.studio:<28}║
╚══════════════════════════════════════════════════════════════╝
""")

    # ── Step 1: Login ─────────────────────────────────────────────────────────
    banner("Step 1/5 — Connecting to atom-studio")
    client = StudioClient(args.studio, args.email, args.password)

    # ── Step 2: Create domain ─────────────────────────────────────────────────
    banner("Step 2/5 — Creating 'examples' domain")
    domain = client.create_domain(
        name="examples",
        description="Example agents provisioned by examples/provision.py",
    )
    domain_id = domain["id"]
    ok(f"Domain id: {domain_id}")

    # ── Step 3: Create agents ─────────────────────────────────────────────────
    banner("Step 3/5 — Creating agents in Studio")
    provisioned = []
    for cfg in AGENTS:
        agent, jwt = client.create_agent(domain_id, {
            "name":        cfg["name"],
            "description": cfg["description"],
            "allowed_models": cfg["models"],
            "rpm_limit":   cfg["rpm_limit"],
        })
        agent_id = agent["id"]
        image_tag = f"atom-example-{cfg['key']}:latest"
        ok(f"{cfg['name']}  id={agent_id[:8]}…  image={image_tag}")
        provisioned.append({**cfg, "agent": agent, "jwt": jwt, "image": image_tag})

    # ── Step 4: Build + load images ───────────────────────────────────────────
    if not args.skip_build:
        banner("Step 4/5 — Building Docker images")
        for p in provisioned:
            build_image(p["key"], p["image"])
            if args.mode == "k8s":
                load_image_k8s(p["image"], args.cluster)
    else:
        banner("Step 4/5 — Skipping image build (--skip-build)")

    # ── Step 5: Deploy + approve ──────────────────────────────────────────────
    banner("Step 5/5 — Deploying agents + auto-approving HITL")
    for p in provisioned:
        agent_id = p["agent"]["id"]
        dep = client.submit_deployment(
            agent_id,
            image=p["image"],
            message=f"Initial deploy via provision.py ({args.mode} mode)",
        )
        ok(f"{p['name']}  deployment_id={dep['id'][:8]}…")
        time.sleep(0.5)

    # Approve all pending HITL workflows
    info("Approving HITL queue...")
    time.sleep(2)
    for _ in range(10):
        queue = client.get_hitl_queue()
        if not queue:
            break
        for item in queue:
            client.approve_hitl(str(item["id"]))
            info(f"  approved hitl {str(item['id'])[:8]}…")
        time.sleep(1)

    # Wait for deployments
    info("Waiting for agents to become ready...")
    for p in provisioned:
        agent_id = p["agent"]["id"]
        if args.mode == "k8s":
            wait_k8s_deployment(agent_id)
        else:
            wait_docker_container(p["key"])

    # ── Done — print chat instructions ────────────────────────────────────────
    gate = args.gate
    print(f"""
╔══════════════════════════════════════════════════════════════╗
║  🎉  All agents deployed! Chat with them:                    ║
╚══════════════════════════════════════════════════════════════╝
""")
    for p in provisioned:
        agent_id = p["agent"]["id"]
        jwt      = p["jwt"]
        sample   = SAMPLE_MESSAGES[p["key"]]
        print(f"  ── {p['name']} ──")
        print(f"  curl -s -X POST {gate}/domain/{domain_id}/agent/{agent_id}/run \\")
        print(f"       -H 'Authorization: Bearer {jwt[:40]}…' \\")
        print(f"       -H 'Content-Type: application/json' \\")
        print(f"       -d '{{\"message\": \"{sample[:60]}…\"}}' | python3 -m json.tool")
        print()

    print(f"  Studio:  {args.studio.replace('3001','3000').replace('/api','')}")
    print(f"  Grafana: {args.studio.replace(':3001', ':3005').replace('/api', '').replace('http://localhost','http://localhost')}")
    print()
    print("  Tokens are printed above — save them or regenerate in Studio → Agent → Regenerate Token")


if __name__ == "__main__":
    main()
