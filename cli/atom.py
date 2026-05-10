"""
ATOM Agent Platform CLI — `atom` command.

Usage:
  atom agent scaffold <name>          # produces stub agent-spec.yaml + role.md
  atom agent list                     # list registered agents
  atom workflow init <name>           # produces stub workflow-spec.yaml
  atom workflow validate <path>       # validate a workflow spec
  atom workflow run <name> --input ...# trigger a run

Install: pip install -e .
"""
import json
import sys
from pathlib import Path

import click
import yaml

REPO_ROOT = Path(__file__).resolve().parent.parent

AGENT_SPEC_TEMPLATE = """\
# Stub agent spec — fill in the marked sections.
apiVersion: atom.platform/v1
kind: AgentDeployment

metadata:
  name: {name}
  domain: TODO-FILL-ME-IN
  version: 0.1.0
  description: TODO short description
  owner: TODO-your-team-or-email

spec:
  agents:
    - name: {name}-analyst
      role: standalone           # or maker / checker
      agent_role_file: agent-roles/{domain}/{name}.role.md
      model: gemini-3.1-pro      # or gemini-3-flash for light work
      temperature: 1.0           # locked for Gemini 3
      reasoning_effort: medium   # low | medium | high
      max_iterations: 6
      tools:
        - TODO_FIRST_TOOL
        - TODO_SECOND_TOOL
      memory:
        type: short_term
        # cross_conversation:    # uncomment to enable ReMe
        #   enabled: true
        #   kind: task            # personal | task
        #   task_key: "{name}-patterns"

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
  TODO: one-paragraph description of what this agent does, what it
  consumes (inputs), what it produces (outputs), and what it MUST NOT
  do. The trigger phrasing below should match likely user prompts.
trigger: |
  TODO trigger phrase 1
  TODO trigger phrase 2
---

# {Title}

You are an agent in an ATOM Agent Platform workflow. TODO: your role.

## Your role and boundaries

- TODO: what you do
- TODO: what you don't do
- TODO: how your output is consumed downstream

## Process

1. **Call `TODO_FIRST_TOOL`** with `TODO`. Capture: TODO.
2. **Call `TODO_SECOND_TOOL`** with `TODO`. Capture: TODO.
3. **Compose the JSON output below.**

## Output format (must be valid JSON)

```json
{{
  "TODO_FIELD": "...",
  "confidence": 0.0,
  "recommendation": "PASS | REVIEW | ESCALATE",
  "notes_for_reviewer": "..."
}}
```

## Critical rules

- Confidence < 0.85 → recommendation cannot be PASS
- Output is a single JSON object, no markdown wrapping
- TODO any domain-specific binding rule

## What you must NOT do

- TODO
- Do not invent values
- Do not call any tool not in your allowlist

## Verification before responding

- [ ] Did I call all required tools?
- [ ] Is confidence consistent with issues found?
- [ ] Output is valid JSON, not markdown-wrapped?
"""

WORKFLOW_SPEC_TEMPLATE = """\
# Stub workflow spec. Fill in nodes; minimum 2 nodes for a valid workflow.
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
    required: [TODO_REQUIRED_INPUTS]
    properties:
      # TODO add input fields

  nodes:
    - id: receive-input
      label: "Receive request"
      type: http
      method: POST
      url_template: "http://TODO-incoming:8099/start"
      output_capture: receive_result
      next: TODO-NEXT-NODE

    # TODO: add agent / decision / human_task nodes

    - id: final-accept
      label: "Final accept / override"
      type: human_task
      assignee_group: ops
      task_template:
        title: "Final approval needed"
        description: "Workflow has executed. Review and accept/reject/edit."
        actions: [accept, reject, edit]
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


@click.group()
def cli():
    """ATOM Agent Platform CLI."""
    pass


@cli.group()
def agent():
    """Agent commands."""
    pass


@agent.command("scaffold")
@click.argument("name")
@click.option("--domain", default="general", help="Domain for the skill folder.")
def agent_scaffold(name, domain):
    """Create stub agent-spec.yaml + role.md for agent <name>."""
    spec_path = REPO_ROOT / "specs" / "agents" / f"{name}.yaml"
    role_path = REPO_ROOT / "agent-roles" / domain / f"{name}.role.md"

    if spec_path.exists():
        click.echo(f"ERROR: {spec_path} already exists. Refusing to overwrite.", err=True)
        sys.exit(1)
    if role_path.exists():
        click.echo(f"ERROR: {role_path} already exists. Refusing to overwrite.", err=True)
        sys.exit(1)

    role_path.parent.mkdir(parents=True, exist_ok=True)
    spec_path.parent.mkdir(parents=True, exist_ok=True)

    spec_path.write_text(AGENT_SPEC_TEMPLATE.format(name=name, domain=domain))
    role_path.write_text(SKILL_TEMPLATE.format(name=name, Title=name.replace("-", " ").title()))

    click.echo(f"✓ Created {spec_path.relative_to(REPO_ROOT)}")
    click.echo(f"✓ Created {role_path.relative_to(REPO_ROOT)}")
    click.echo("\nNext steps:")
    click.echo(f"  1. Edit {role_path.relative_to(REPO_ROOT)} — fill in the TODO sections")
    click.echo(f"  2. Edit {spec_path.relative_to(REPO_ROOT)} — set domain, tools, model")
    click.echo(f"  3. atom agent validate specs/agents/{name}.yaml")
    click.echo(f"  4. POST to builder-backend /agents/{name}/deploy")


@agent.command("list")
def agent_list():
    """List all agent specs in the repo."""
    for p in sorted((REPO_ROOT / "specs" / "agents").glob("*.yaml")):
        try:
            spec = yaml.safe_load(p.read_text())
            md = spec.get("metadata", {})
            click.echo(f"  {md.get('name'):30s} v{md.get('version'):8s} {md.get('domain')}")
        except Exception as e:
            click.echo(f"  {p.name} — parse error: {e}", err=True)


@agent.command("validate")
@click.argument("path", type=click.Path(exists=True))
def agent_validate(path):
    """Validate an agent spec against the schema."""
    # Stub — actual validation hits the builder-backend
    click.echo(f"Validation stub. POST to builder-backend /specs/agent/validate with this file.")


@cli.group()
def workflow():
    """Workflow commands."""
    pass


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
    click.echo(f"✓ Created {path.relative_to(REPO_ROOT)}")
    click.echo(f"\nNext: edit {path.relative_to(REPO_ROOT)} and add nodes.")


@workflow.command("validate")
@click.argument("path", type=click.Path(exists=True))
def workflow_validate(path):
    """Validate a workflow spec."""
    click.echo(f"Validation stub. POST to workflow-backend /specs/workflow/validate.")


@workflow.command("run")
@click.argument("name")
@click.option("--input", "input_json", required=True, help="JSON input for the workflow.")
def workflow_run(name, input_json):
    """Trigger a run of workflow <name>."""
    try:
        payload = json.loads(input_json)
    except json.JSONDecodeError as e:
        click.echo(f"ERROR: invalid JSON: {e}", err=True)
        sys.exit(1)
    click.echo(f"Trigger stub. POST {payload} to workflow-backend /workflows/{name}/runs.")


if __name__ == "__main__":
    cli()
