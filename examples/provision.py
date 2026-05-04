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


def trigger_ci_build(provider: str, repo_url: str, branch: str, token: str, agent_key: str) -> str:
    """Trigger a GitHub Actions or GitLab CI build and return the pushed image reference."""
    import urllib.request, urllib.error  # noqa: E401, PLC0415
    import json as _json  # noqa: PLC0415

    headers_base = {"Content-Type": "application/json"}

    if provider == "github":
        # Parse owner/repo from URL
        path = repo_url.rstrip("/").removeprefix("https://github.com/").removesuffix(".git")
        owner, repo = path.split("/", 1)
        image_tag = "latest"
        image_ref = f"ghcr.io/{owner.lower()}/{repo.lower()}:{image_tag}"

        # Trigger workflow_dispatch
        api_url = f"https://api.github.com/repos/{owner}/{repo}/actions/workflows/atom-build.yml/dispatches"
        body = _json.dumps({"ref": branch, "inputs": {"image_tag": image_tag}}).encode()
        req = urllib.request.Request(api_url, data=body, headers={
            **headers_base,
            "Authorization": f"Bearer {token}",
            "Accept": "application/vnd.github+json",
        })
        try:
            urllib.request.urlopen(req)
        except urllib.error.HTTPError as e:
            fail(f"GitHub API error {e.code}: {e.read().decode()}")

        info(f"GitHub Actions triggered for {repo_url} — waiting up to 20 min…")
        import time  # noqa: PLC0415
        time.sleep(8)

        for _ in range(80):
            runs_url = f"https://api.github.com/repos/{owner}/{repo}/actions/workflows/atom-build.yml/runs?branch={branch}&per_page=1"
            req = urllib.request.Request(runs_url, headers={
                "Authorization": f"Bearer {token}",
                "Accept": "application/vnd.github+json",
            })
            data = _json.loads(urllib.request.urlopen(req).read())
            runs = data.get("workflow_runs", [])
            if runs:
                run_status = runs[0]["status"]
                conclusion = runs[0].get("conclusion")
                if run_status == "completed":
                    if conclusion == "success":
                        ok(f"GitHub Actions build succeeded → {image_ref}")
                        return image_ref
                    fail(f"GitHub Actions build finished with conclusion: {conclusion}")
                info(f"  workflow {run_status}…")
            time.sleep(15)
        fail("Timed out waiting for GitHub Actions workflow")

    elif provider == "gitlab":
        from urllib.parse import quote  # noqa: PLC0415
        # Parse host/project from URL
        url_stripped = repo_url.rstrip("/").removesuffix(".git")
        if url_stripped.startswith("https://"):
            url_stripped = url_stripped[8:]
        host, project_path = url_stripped.split("/", 1)
        encoded = quote(project_path, safe="")
        image_tag = "latest"
        image_ref = f"registry.{host}/{project_path.lower()}:{image_tag}"

        # Trigger pipeline
        api_url = f"https://{host}/api/v4/projects/{encoded}/pipeline"
        body = _json.dumps({"ref": branch, "variables": [{"key": "IMAGE_TAG", "value": image_tag}]}).encode()
        req = urllib.request.Request(api_url, data=body, headers={
            **headers_base,
            "Authorization": f"Bearer {token}",
        })
        data = _json.loads(urllib.request.urlopen(req).read())
        pipeline_id = data["id"]
        info(f"GitLab pipeline {pipeline_id} triggered — waiting up to 20 min…")

        import time  # noqa: PLC0415
        for _ in range(80):
            status_url = f"https://{host}/api/v4/projects/{encoded}/pipelines/{pipeline_id}"
            req = urllib.request.Request(status_url, headers={"Authorization": f"Bearer {token}"})
            status_data = _json.loads(urllib.request.urlopen(req).read())
            pipeline_status = status_data["status"]
            if pipeline_status == "success":
                ok(f"GitLab pipeline succeeded → {image_ref}")
                return image_ref
            if pipeline_status in ("failed", "canceled", "skipped"):
                fail(f"GitLab pipeline finished with status: {pipeline_status}")
            info(f"  pipeline {pipeline_status}…")
            time.sleep(15)
        fail("Timed out waiting for GitLab CI pipeline")

    return ""  # unreachable


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
    parser.add_argument("--ci", choices=["local", "github", "gitlab"], default="local",
                        help="CI provider for building images (default: local docker build)")
    parser.add_argument("--repo", default=None,
                        help="Repository URL for CI builds (required when --ci github|gitlab)")
    parser.add_argument("--branch", default="main",
                        help="Branch to build from in CI mode (default: main)")
    parser.add_argument("--ci-token", default=os.environ.get("GITHUB_TOKEN") or os.environ.get("GITLAB_TOKEN"),
                        help="CI API token (reads GITHUB_TOKEN or GITLAB_TOKEN from env)")
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
        if args.ci == "local":
            banner("Step 4/5 — Building Docker images (local)")
            for p in provisioned:
                build_image(p["key"], p["image"])
                if args.mode == "k8s":
                    load_image_k8s(p["image"], args.cluster)
        elif args.ci in ("github", "gitlab"):
            banner(f"Step 4/5 — Triggering {args.ci.title()} CI build")
            if not args.repo:
                fail(f"--repo is required when using --ci {args.ci}")
            if not args.ci_token:
                fail(f"CI token required: set {'GITHUB_TOKEN' if args.ci=='github' else 'GITLAB_TOKEN'} or pass --ci-token")
            for p in provisioned:
                p["image"] = trigger_ci_build(args.ci, args.repo, args.branch, args.ci_token, p["key"])
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
