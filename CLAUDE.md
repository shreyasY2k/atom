# CLAUDE.md — Mphasis Agent Platform

> **Read this first, every session.** Defines what we're building, the constraints, and where to find the rest.

## Mission

Build a TechShift demo platform with **two surfaces**:

1. **Agent Builder** — produces audited, deployable agents from a versioned spec.
2. **Workflow Composer** — loads existing BFSI processes as graphs; specific human-decision nodes are replaced with agents; humans retained at decision boundaries.

The pitch: **"We don't sell agents. We help you remove routine human work from your existing processes — keeping humans on the calls that matter, with one audit trail across every step."**

Demo audience: **US bank tech and ops teams** at TechShift. The flagship use case is **Asset Transfer Service (ATS)** — an existing 9-step workflow where two routine human steps are replaced with agents we build live.

The demo must be:

- Domain-credible (real ATS-shaped process, validated by a Mphasis BFSI consultant before TechShift)
- Visibly two-surface (Builder for agents, Composer for the workflow)
- Audit-visible across both surfaces (humans, agents, HTTP calls — one timeline)
- Non-human-identity-aware (every agent has its own service account, distinct from its creator)
- Defensibly architected (Temporal under the hood, branded honestly)

## Hard invariants — never violate

1. **Every LLM call goes through LiteLLM** at `http://litellm:4000`.
2. **Every tool call goes through LiteLLM's MCP gateway or a registered Python tool.**
3. **Gemini-only stack** (`gemini-3.1-pro` for reasoning, `gemini-3-flash` for light, `gemini-embedding-2` for ReMe). No Anthropic, no OpenAI.
4. **Temperature is 1.0 for Gemini 3.** Determinism via pinned models + structured output + reasoning_effort.
5. **Every agent has a non-human service-account identity** issued at deploy time. The identity is a LiteLLM virtual key. Every audit log entry records `actor_type` (`agent`|`human`|`system`) and `actor_id`. For demo, the human user who created the agent is recorded as `owner` in metadata, but the agent's identity in audit is its own service account.
6. **Every agent and every workflow is built from a spec.** `agent-spec.yaml` for agents; `workflow-spec.yaml` for workflows. Specs are version-controlled and reviewable. Visual UIs are UX over specs.
7. **Workflow has exactly four node types**: `agent`, `http` (or `mcp`), `decision` (rule-based, no LLM), `human_task`. No loops, parallel forks, or sub-workflows in V1.
8. **Audit logs go to MinIO with object lock**, 90-day compliance retention.
9. **Humans retain final accept/override.** Workflows must have a `human_task` node before any state-changing external call (or immediately after if the call is reversible).
10. **Synthetic data only.** All external system calls hit mock services.
11. **Build from source** for AgentScope, AgentScope Runtime, AgentScope Studio, ReMe. Temporal can use the official image (CNCF, not vendor-branded).

## Tech stack (locked)

- **Agent framework**: AgentScope + AgentScope Runtime (built from source)
- **Workflow engine**: **Temporal** (official image, branded \"Atom Workflow Composer\" in the UI)
- **LLM gateway**: LiteLLM (Gemini-only, MCP gateway, virtual keys = service-account identities, S3 callback)
- **Memory**: ReMe (built from source)
- **Audit / artifacts**: MinIO with object lock
- **Observability**: AgentScope Studio (built from source) + OTEL collector
- **Builder backend**: FastAPI + Pydantic + structured-output code-gen
- **Workflow backend**: FastAPI + Temporal Python SDK + workflow-spec validator + worker
- **Frontend**: React + Vite + Tailwind + Monaco editor + React Flow (for the Composer canvas)
- **Mocks**: FastAPI per service
- **CLI**: `atom` Click-based CLI for `agent scaffold`, `workflow init`

## Build modes (three)

| Mode | Agent build | Workflow build | When to use |
|---|---|---|---|
| **A. Visual + AI** | Builder UI generates spec + skill from prose | Composer UI, drag-and-drop nodes, agents picked from registry | Fast prototyping; demo path 1 |
| **B. CLI scaffold + manual** | `atom agent scaffold <name>` produces stub spec + stub skill in repo; developer fills in | Composer UI or `atom workflow init` produces stub `workflow-spec.yaml` | Realistic dev workflow; demo path 2 |
| **C. Full natural-language** | Same as A | Composer also generates from prose | Demo-optional wow; off the critical path. Disable cleanly if it misbehaves. |

## Where to find things

- `docs/architecture.md` — system design, data flow, deployment, identity model
- `docs/agent-spec-format.md` — agent YAML schema
- `docs/workflow-spec-format.md` — workflow YAML schema
- `docs/identity-and-audit.md` — how agents get identities, what's logged where
- `docs/tasks/00-overview.md` — session map
- `docs/tasks/0N-*.md` — per-session task files
- `skills/builder/SKILL.md` — meta-skill: spec → AgentScope code
- `skills/composer/SKILL.md` — meta-skill: prose → workflow-spec
- `skills/<domain>/*.skill.md` — domain skills
- `specs/agents/*.yaml` — agent specs
- `specs/workflows/*.yaml` — workflow specs
- `litellm/config.yaml` — gateway config + virtual key templates
- `temporal/` — worker code, activity definitions
- `dockerfiles/` — build-from-source Dockerfiles
- `samples/` — sample data
- `cli/` — `atom` CLI source

## Working agreements for Claude Code

- **One task file per session.** Don't skip ahead.
- **Read the relevant SKILL.md before writing code.**
- **Spec wins over UI; invariant wins over spec.**
- **Don't expand node types.** Four is the rule. Loops/forks belong in Phase 2.
- **Don't build a workflow engine.** Temporal does this. Wrap it cleanly.
- **Don't bypass identity.** Every agent invocation must carry its service-account ID; every workflow execution must record actor identity per node.
- **First-time `docker compose build` is 10–15 minutes** (AS + Studio + ReMe from source).

## Definition of demo-ready

- `docker compose up` brings everything healthy in <90 sec after build
- Agent Builder produces a working agent from prose in <60 sec
- Workflow Composer renders the ATS workflow with all 9 nodes
- Live demo: 2 nodes in ATS replaced with agents, workflow runs end-to-end with both routine and high-value paths
- Audit pane shows agent service-account IDs distinct from human user IDs
- Pre-recorded fallback at `docs/demo-fallback.mp4`
- 5+ rehearsals logged

## Out of scope

- HMAC signing of audit logs (object lock is enough)
- HiClaw, A2A registry
- Real user auth — hardcoded demo user
- Multi-tenancy
- K8s deployment — Phase 2+
- Insurance OCR use case — kept in codebase as a "skill library breadth" talking point, not in active demo
- Anthropic / OpenAI — Gemini only
- Loops, parallel forks, sub-workflows in workflow engine
- Building a workflow engine from scratch — Temporal does this

## Decision log

| Decision | Why |
|---|---|
| Temporal over n8n / Camunda / build-from-scratch | BFSI deployments exist, handles long-running workflows with human gates, hire-able engineers, audit story is solid. |
| Drop OCR insurance from active demo | Two depth use cases (treasury + ATS workflow) is enough. OCR stays in code as breadth. |
| Mode C (AI workflow gen) off critical path | Meta-agent designing agents + workflow is high-variance on Gemini at 1.0. Disable cleanly if it misbehaves. |
| Service-account identity at deploy time | Banks audit non-human identities (NHIs) separately from humans. Required for SOC 2 / ISO 27001 talk track. |
| ATS as flagship workflow | Validated BFSI process, real human-replaceable steps, clean wow moment (time compression + audit unification). |
| Two-layer skill model: AgentScope skills (capability) + agent roles (domain) | "AgentScope skill" already means a reusable tool in the upstream community. "Agent role" disambiguates what we build — purpose, constraints, output contract — without colliding with that term. Positions us as composing AgentScope, not reinventing it. |
| `reasoning_mode` field per agent (prescribed \| guided) | Makes the prescribed-vs-guided trade-off an explicit, auditable spec field rather than implicit in role prose. Prescribed = auditable deterministic path (BFSI story). Guided = flexible reasoning for less-structured tasks (platform flexibility story). Validators can enforce mode-appropriate patterns. |
| Free-text input adapter on every agent's /invoke | Enables Builder Test panel (chat) and Studio chat compatibility without changing the workflow's structured invocation contract. The extraction step (Gemini Flash) runs only on the chat path — workflow nodes always send structured JSON. |
| Studio reused as engineer surface, not embedded for prospects | Studio's chrome (project list, model config) confuses non-technical demo audiences. We reimplement the UX patterns (chat bubbles, collapsible traces) in our own UI and link to Studio for engineers. Not iframed — avoids CORS complexity and keeps the demo surface branded. |
