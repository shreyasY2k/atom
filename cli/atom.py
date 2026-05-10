"""
ATOM Agent Platform CLI — `atom` command.

Usage:
  atom login --as builder|approver|admin
  atom whoami
  atom logout

  atom agent scaffold <name> [--domain <d>]
  atom agent list
  atom agent validate <path>
  atom agent deploy <name>          # role-aware: builder→request, approver/admin→direct
  atom agent history <name>         # deployment history

  atom workflow init <name>
  atom workflow validate <path>
  atom workflow register <name>     # role-aware
  atom workflow history <name>      # deployment history
  atom workflow run <name> --input <json>

  atom deployments list [--status pending] [--requester me]
  atom deployments get <id>
  atom deployments approve <id> [--note <text>]
  atom deployments reject <id> --reason <text>
  atom deployments request-changes <id> --comments <text>

Install: pip install -e .
"""
import json
import os
import sys
import urllib.error
import urllib.parse
import urllib.request
from pathlib import Path
from typing import Optional

import click
import yaml

# ── Constants ────────────────────────────────────────────────────────────────

REPO_ROOT    = Path(__file__).resolve().parent.parent
SESSION_FILE = Path.home() / ".atom" / "session.json"

BUILDER_URL  = os.environ.get("ATOM_BUILDER_URL",  "http://localhost:8080")
WORKFLOW_URL = os.environ.get("ATOM_WORKFLOW_URL", "http://localhost:8081")

# ── Session helpers ──────────────────────────────────────────────────────────

def _load_session() -> Optional[dict]:
    try:
        return json.loads(SESSION_FILE.read_text())
    except Exception:
        return None


def _save_session(data: dict) -> None:
    SESSION_FILE.parent.mkdir(parents=True, exist_ok=True)
    SESSION_FILE.write_text(json.dumps(data, indent=2))


def _clear_session() -> None:
    try:
        SESSION_FILE.unlink()
    except FileNotFoundError:
        pass


def _get_actor() -> str:
    s = _load_session()
    return s["identity"] if s and s.get("identity") else "user:builder@atom.demo"


def _get_role() -> Optional[str]:
    s = _load_session()
    return s.get("role") if s else None


def _require_session() -> dict:
    s = _load_session()
    if not s:
        click.echo("Not logged in. Run: atom login --as builder|approver|admin", err=True)
        sys.exit(1)
    return s

# ── HTTP helper ──────────────────────────────────────────────────────────────

def _api(method: str, url: str, data: Optional[dict] = None, actor: Optional[str] = None) -> dict:
    """Make an API call. Returns parsed JSON or exits with error."""
    headers = {"Content-Type": "application/json", "X-Atom-Actor": actor or _get_actor()}
    body = json.dumps(data).encode() if data is not None else None
    req = urllib.request.Request(url, data=body, headers=headers, method=method)
    try:
        with urllib.request.urlopen(req, timeout=120) as resp:
            return json.loads(resp.read())
    except urllib.error.HTTPError as e:
        body = e.read().decode()
        try:
            detail = json.loads(body).get("detail", body)
        except Exception:
            detail = body
        click.echo(f"API error {e.code}: {detail}", err=True)
        sys.exit(1)
    except urllib.error.URLError as e:
        click.echo(f"Connection error: {e.reason}", err=True)
        click.echo(f"  Is the platform running? (ATOM_BUILDER_URL={BUILDER_URL})", err=True)
        sys.exit(1)


def _fmt_ts(ts: Optional[str]) -> str:
    return (ts or "")[:16].replace("T", " ")


def _fmt_dep(r: dict) -> str:
    return (
        f"  {r['deployment_id']}  "
        f"{r['target_type']:8s} {r['target_name']:30s} v{r['target_version']:<8s}  "
        f"{r['approval_status']:18s}  {r['deploy_status']:10s}  "
        f"{_fmt_ts(r['requested_at'])}"
    )

# ── Templates ────────────────────────────────────────────────────────────────

AGENT_SPEC_TEMPLATE = """\
apiVersion: atom.platform/v1
kind: AgentDeployment

metadata:
  name: {name}
  domain: {domain}
  version: 0.1.0
  description: TODO short description
  owner: TODO-your-team-or-email

spec:
  agents:
    - name: {name}-analyst
      role: standalone
      agent_role_file: agent-roles/{domain}/{name}.role.md
      model: gemini-3.1-pro
      temperature: 1.0
      reasoning_effort: medium
      max_iterations: 6
      tools:
        - TODO_FIRST_TOOL

  flow:
    type: standalone

  audit:
    log_to: minio://audit-logs/agent/{name}
    retention_days: 90

  deployment:
    runtime: agentscope
    sandbox: base
    replicas: 1
"""

SKILL_TEMPLATE = """\
---
name: {name}
description: |
  TODO: one-paragraph description of what this agent does.
trigger: |
  TODO trigger phrase
---

# {title}

You are an agent in an ATOM Platform workflow. TODO: your role.

## Process

1. **Call `TODO_FIRST_TOOL`** — capture: TODO.
2. **Compose the JSON output below.**

## Output format (must be valid JSON)

```json
{{
  "TODO_FIELD": "...",
  "confidence": 0.0,
  "recommendation": "PASS | REVIEW | ESCALATE"
}}
```

## Critical rules

- Output is a single JSON object, no markdown wrapping
- Do not invent values
"""

WORKFLOW_SPEC_TEMPLATE = """\
apiVersion: atom.platform/v1
kind: WorkflowDeployment

metadata:
  name: {name}
  domain: TODO-FILL-ME-IN
  version: 0.1.0
  description: TODO
  owner: TODO

spec:
  input_schema:
    type: object
    required: []
    properties: {{}}

  nodes:
    - id: receive-input
      label: "Receive request"
      type: http
      method: POST
      url_template: "http://TODO-incoming:8099/start"
      output_capture: receive_result
      next: final-accept

    - id: final-accept
      label: "Final accept / override"
      type: human_task
      assignee_group: ops
      task_template:
        title: "Final approval needed"
        description: "Review and accept/reject."
        actions: [accept, reject]
      sla_seconds: 1800
      output_capture: final_decision
      next: null

  audit:
    log_to: minio://audit-logs/workflow/{name}
    retention_days: 90

  deployment:
    runtime: temporal
    task_queue: {name}-task-queue
"""

# ── Root group ───────────────────────────────────────────────────────────────

@click.group()
def cli():
    """ATOM Agent Platform CLI."""


# ── Auth commands ─────────────────────────────────────────────────────────────

@cli.command("login")
@click.option("--as", "role", required=True,
              type=click.Choice(["builder", "approver", "admin"]),
              help="Role to log in as.")
def login_cmd(role):
    """Log in as a demo role. Saves session to ~/.atom/session.json."""
    # Map 'admin' → 'platform_admin' for the API
    api_role = "platform_admin" if role == "admin" else role
    data = _api("POST", f"{BUILDER_URL}/auth/login", {"role": api_role})
    _save_session({"role": data["role"], "identity": data["identity"],
                   "display_name": data["display_name"]})
    click.echo(f"Logged in as {data['display_name']} ({data['identity']})")


@cli.command("whoami")
def whoami():
    """Print the current session role and identity."""
    s = _load_session()
    if not s:
        click.echo("Not logged in.")
    else:
        click.echo(f"{s['display_name']} — {s['identity']}")


@cli.command("logout")
def logout():
    """Clear the local session."""
    _clear_session()
    click.echo("Logged out.")


# ── agent group ───────────────────────────────────────────────────────────────

@cli.group()
def agent():
    """Agent commands."""


@agent.command("scaffold")
@click.argument("name")
@click.option("--domain", default="general", help="Domain for the role folder.")
def agent_scaffold(name, domain):
    """Create stub agent-spec.yaml + role.md for <name>."""
    spec_path = REPO_ROOT / "specs" / "agents" / f"{name}.yaml"
    role_path = REPO_ROOT / "agent-roles" / domain / f"{name}.role.md"

    for p in (spec_path, role_path):
        if p.exists():
            click.echo(f"ERROR: {p} already exists.", err=True)
            sys.exit(1)

    role_path.parent.mkdir(parents=True, exist_ok=True)
    spec_path.parent.mkdir(parents=True, exist_ok=True)
    spec_path.write_text(AGENT_SPEC_TEMPLATE.format(name=name, domain=domain))
    role_path.write_text(SKILL_TEMPLATE.format(
        name=name, title=name.replace("-", " ").title()))

    click.echo(f"Created {spec_path.relative_to(REPO_ROOT)}")
    click.echo(f"Created {role_path.relative_to(REPO_ROOT)}")
    click.echo(f"\nNext: edit the TODO sections, then run: atom agent deploy {name}")


@agent.command("list")
def agent_list():
    """List deployed agents from the registry."""
    data = _api("GET", f"{BUILDER_URL}/agents")
    agents = data.get("agents", [])
    if not agents:
        click.echo("No agents registered.")
        return
    click.echo(f"{'NAME':30s} {'VERSION':8s} {'STATUS':12s} {'SERVICE ACCOUNT':40s}")
    click.echo("-" * 94)
    for a in agents:
        click.echo(f"{a['name']:30s} {a['version']:8s} {a['status']:12s} {a.get('service_account_id','—')}")


@agent.command("validate")
@click.argument("path", type=click.Path(exists=True))
def agent_validate(path):
    """Validate an agent spec against the schema."""
    yaml_text = Path(path).read_text()
    data = _api("POST", f"{BUILDER_URL}/specs/agent/validate", {"yaml_text": yaml_text})
    if data.get("valid"):
        click.echo(f"Valid — {data['name']} v{data['version']} ({data['agent_count']} agent(s))")
    else:
        click.echo(f"Invalid: {data}", err=True)
        sys.exit(1)


@agent.command("deploy")
@click.argument("name")
@click.option("--note", default="", help="Optional note for the approver.")
def agent_deploy(name, note):
    """Deploy agent <name>. Role-aware: Builder submits for approval; Approver/Admin deploys directly."""
    role = _get_role()

    if role == "builder":
        data = _api("POST", f"{BUILDER_URL}/agents/{name}/deploy-request",
                    {"notes": note})
        click.echo(f"Submitted deployment request {data['deployment_id']} for agent {name} v{data['target_version']}")
        click.echo(f"Status: waiting for approval")
        click.echo(f"Track with: atom deployments get {data['deployment_id']}")
    elif role == "platform_admin":
        data = _api("POST", f"{BUILDER_URL}/agents/{name}/deploy-direct",
                    {"notes": note})
        click.echo(f"Bypass deploy submitted: {data['deployment_id']} (admin bypass)")
        click.echo(f"Deploy status: {data['deploy_status']} — check with: atom deployments get {data['deployment_id']}")
    else:
        # approver or no session — direct deploy
        data = _api("POST", f"{BUILDER_URL}/agents/{name}/deploy")
        click.echo(f"Deployed {data['name']} v{data['version']}")
        click.echo(f"Service account: {data['service_account_id']}")
        click.echo(f"Endpoint:        {data['endpoint']}")


@agent.command("history")
@click.argument("name")
def agent_history(name):
    """Deployment history for agent <name>."""
    data = _api("GET", f"{BUILDER_URL}/agents/{name}/deployments")
    records = data.get("deployments", [])
    if not records:
        click.echo(f"No deployment history for {name}.")
        return
    click.echo(f"Deployment history for {name}:")
    click.echo(_dep_header())
    for r in records:
        click.echo(_fmt_dep(r))


# ── workflow group ────────────────────────────────────────────────────────────

@cli.group()
def workflow():
    """Workflow commands."""


@workflow.command("init")
@click.argument("name")
def workflow_init(name):
    """Create a stub workflow-spec.yaml for <name>."""
    path = REPO_ROOT / "specs" / "workflows" / f"{name}.yaml"
    if path.exists():
        click.echo(f"ERROR: {path} already exists.", err=True)
        sys.exit(1)
    path.parent.mkdir(parents=True, exist_ok=True)
    path.write_text(WORKFLOW_SPEC_TEMPLATE.format(name=name))
    click.echo(f"Created {path.relative_to(REPO_ROOT)}")
    click.echo(f"\nNext: edit nodes, then run: atom workflow register {name}")


@workflow.command("validate")
@click.argument("path", type=click.Path(exists=True))
def workflow_validate(path):
    """Validate a workflow spec."""
    yaml_text = Path(path).read_text()
    data = _api("POST", f"{WORKFLOW_URL}/specs/workflow/validate", {"yaml_text": yaml_text})
    if data.get("valid"):
        click.echo(f"Valid — {data['name']} ({data.get('node_count', '?')} nodes, queue: {data.get('task_queue', '?')})")
    else:
        errs = data.get("errors", [])
        for e in errs:
            click.echo(f"  [{e.get('node','?')}] {e.get('reason','')}", err=True)
        sys.exit(1)


@workflow.command("register")
@click.argument("name")
@click.option("--note", default="", help="Optional note for the approver.")
def workflow_register(name, note):
    """Register workflow <name>. Role-aware: Builder submits for approval; Approver/Admin registers directly."""
    role = _get_role()

    if role == "builder":
        data = _api("POST", f"{WORKFLOW_URL}/workflows/{name}/deploy-request",
                    {"notes": note})
        click.echo(f"Submitted deployment request {data['deployment_id']} for workflow {name} v{data['target_version']}")
        click.echo(f"Track with: atom deployments get {data['deployment_id']}")
    elif role == "platform_admin":
        data = _api("POST", f"{WORKFLOW_URL}/workflows/{name}/deploy-direct",
                    {"notes": note})
        click.echo(f"Bypass register submitted: {data['deployment_id']}")
    else:
        data = _api("POST", f"{WORKFLOW_URL}/workflows/{name}/register", {})
        click.echo(f"Registered {data['name']} v{data['version']} on queue {data['task_queue']}")
        if data.get("warnings"):
            for w in data["warnings"]:
                click.echo(f"  WARNING: {w.get('node','?')} — {w.get('reason','')}")


@workflow.command("history")
@click.argument("name")
def workflow_history(name):
    """Deployment history for workflow <name>."""
    data = _api("GET", f"{WORKFLOW_URL}/workflows/{name}/deployments")
    records = data.get("deployments", [])
    if not records:
        click.echo(f"No deployment history for {name}.")
        return
    click.echo(f"Deployment history for {name}:")
    click.echo(_dep_header())
    for r in records:
        click.echo(_fmt_dep(r))


@workflow.command("run")
@click.argument("name")
@click.option("--input", "input_json", required=True, help="JSON input payload.")
def workflow_run(name, input_json):
    """Trigger a workflow run."""
    try:
        payload = json.loads(input_json)
    except json.JSONDecodeError as e:
        click.echo(f"Invalid JSON: {e}", err=True)
        sys.exit(1)
    data = _api("POST", f"{WORKFLOW_URL}/workflows/{name}/runs", payload)
    click.echo(f"Run started: {data['run_id']}")
    click.echo(f"Status: {data.get('status', 'running')}")


# ── deployments group ─────────────────────────────────────────────────────────

@cli.group()
def deployments():
    """Deployment request commands."""


def _dep_header() -> str:
    return (
        f"  {'ID':14s}  {'TYPE':8s} {'NAME':30s} {'VER':8s}  "
        f"{'APPROVAL':18s}  {'DEPLOY':10s}  {'REQUESTED'}"
    )


@deployments.command("list")
@click.option("--status", default=None, help="Filter by approval_status (pending, approved, rejected, ...)")
@click.option("--requester", default=None, help="Filter by requester identity. Use 'me' for current session.")
@click.option("--type", "target_type", default=None, help="Filter by target type (agent|workflow)")
@click.option("--limit", default=50, show_default=True, help="Max results.")
def deployments_list(status, requester, target_type, limit):
    """List deployment requests."""
    s = _load_session()
    if requester == "me":
        requester = s["identity"] if s else None

    params: list[str] = [f"limit={limit}"]
    if status:
        params.append(f"approval_status={status}")
    if requester:
        params.append(f"requester={urllib.parse.quote(requester)}")
    if target_type:
        params.append(f"target_type={target_type}")

    qs = "&".join(params)
    data = _api("GET", f"{BUILDER_URL}/deployments?{qs}")
    records = data.get("deployments", [])

    if not records:
        click.echo("No deployment requests found.")
        return

    click.echo(f"{'':2}{data['total']} request(s):")
    click.echo(_dep_header())
    for r in records:
        click.echo(_fmt_dep(r))


@deployments.command("get")
@click.argument("deployment_id")
def deployments_get(deployment_id):
    """Show full details for a deployment request."""
    r = _api("GET", f"{BUILDER_URL}/deployments/{deployment_id}")
    click.echo(f"deployment_id:   {r['deployment_id']}")
    click.echo(f"target:          {r['target_type']} {r['target_name']} v{r['target_version']}")
    click.echo(f"requested_by:    {r['requested_by']}")
    click.echo(f"requested_at:    {_fmt_ts(r['requested_at'])}")
    click.echo(f"approval_status: {r['approval_status']}")
    click.echo(f"deploy_status:   {r['deploy_status']}")
    if r.get("approved_by"):
        click.echo(f"approved_by:     {r['approved_by']}")
        click.echo(f"approved_at:     {_fmt_ts(r['approved_at'])}")
    if r.get("service_account_id"):
        click.echo(f"service_account: {r['service_account_id']}")
    if r.get("deployed_at"):
        click.echo(f"deployed_at:     {_fmt_ts(r['deployed_at'])}")
    if r.get("notes"):
        click.echo(f"notes:           {r['notes']}")
    if r.get("deploy_error"):
        click.echo(f"error:           {r['deploy_error']}")
    if r.get("spec_hash"):
        click.echo(f"spec_hash:       {r['spec_hash'][:20]}...")


@deployments.command("approve")
@click.argument("deployment_id")
@click.option("--note", default="", help="Approval note.")
def deployments_approve(deployment_id, note):
    """Approve a deployment request (approver/admin only)."""
    r = _api("POST", f"{BUILDER_URL}/deployments/{deployment_id}/approve", {"notes": note})
    click.echo(f"Approved {deployment_id} — deploy_status: {r['deploy_status']}")
    click.echo(f"Deployment is running in background. Track with: atom deployments get {deployment_id}")


@deployments.command("reject")
@click.argument("deployment_id")
@click.option("--reason", required=True, help="Reason for rejection.")
def deployments_reject(deployment_id, reason):
    """Reject a deployment request (approver/admin only)."""
    r = _api("POST", f"{BUILDER_URL}/deployments/{deployment_id}/reject", {"reason": reason})
    click.echo(f"Rejected {deployment_id} — reason recorded: {r['notes']}")


@deployments.command("request-changes")
@click.argument("deployment_id")
@click.option("--comments", required=True, help="Comments for the requester.")
def deployments_request_changes(deployment_id, comments):
    """Send a deployment request back with change comments (approver/admin only)."""
    r = _api("POST", f"{BUILDER_URL}/deployments/{deployment_id}/request-changes",
             {"comments": comments})
    click.echo(f"Changes requested on {deployment_id} — requester notified.")
    click.echo(f"Comments: {r['notes']}")


if __name__ == "__main__":
    cli()
