# Identity and Audit

This is the load-bearing document for the security/audit talk track. Every claim in the demo about "audit" or "identity" should map back to something in here.

## The core principle

**Every action the platform takes is performed by an identifiable actor.** Three actor types exist. They are recorded uniformly in audit logs. They are governed by the same controls. This is what makes the platform's audit story symmetric across human and non-human actors — which is what enterprise compliance frameworks (SOC 2, ISO 27001, NIST CSF) increasingly require.

## The three actor types

```
┌──────────┬───────────────────────────────┬──────────────────────────────┐
│ type     │ examples                      │ how identity is established   │
├──────────┼───────────────────────────────┼──────────────────────────────┤
│ human    │ user:demo@atom.demo         │ login session                │
│          │ user:ops-rachel@bigbank.com   │ (in production: Okta/AAD)    │
├──────────┼───────────────────────────────┼──────────────────────────────┤
│ agent    │ svc-acct-kyc-refresh-001      │ issued by builder-backend at │
│          │ svc-acct-asset-recon-001      │ deploy time; backed by a     │
│          │                               │ LiteLLM virtual key           │
├──────────┼───────────────────────────────┼──────────────────────────────┤
│ system   │ system:workflow-engine        │ static; assigned by the      │
│          │ system:builder-backend        │ platform                      │
│          │ system:audit-pipeline         │                              │
└──────────┴───────────────────────────────┴──────────────────────────────┘
```

## Agent identity (the non-human identity, NHI)

When `POST /agents/{name}/deploy` is called:

1. **Generate identity**:
   `service_account_id = "svc-acct-{name}-{version-hash[:8]}"`
   e.g. `svc-acct-kyc-refresh-a3f9b2c1`

2. **Issue LiteLLM virtual key** for that ID, with:
   - Tool allowlist matching the agent's spec
   - Daily token budget (configurable per spec)
   - Tag: `actor_type=agent`, `agent_name=<name>`, `version=<v>`, `owner=<creator>`

3. **Inject the virtual key** into the deployed agent container as `LITELLM_API_KEY`. The agent uses this for every LLM and tool call.

4. **Record in agent registry**:
   ```json
   {
     "agent_name": "kyc-refresh",
     "version": "1.0.0",
     "service_account_id": "svc-acct-kyc-refresh-a3f9b2c1",
     "owner": "user:demo@atom.demo",
     "deployed_at": "2026-05-08T...",
     "deployed_by": "user:demo@atom.demo",
     "endpoint": "http://agent-kyc-refresh-1-0-0:8100",
     "spec_hash": "...",
     "code_hash": "...",
     "litellm_virtual_key_id": "..."
   }
   ```

5. **Emit deploy audit event** (actor_type=system, recording the deploy action).

## "Owner" is metadata, not identity

For the demo, the human user who creates an agent is recorded as `owner`. **This is metadata for accountability, not identity for audit.** When the deployed agent runs and makes an LLM call, the audit log records the agent's service account, not the owner. The owner appears separately, on the agent's record.

This distinction matters in the talk track:
- "Who created this agent?" → owner field
- "Who made this LLM call?" → service-account ID (the agent itself)
- "Who approved the agent's output?" → human user from the workflow's human_task resolution

In V1 (Task 05b+), the owner is the `X-Atom-Actor` header value sent by the frontend for the logged-in role (e.g. `user:builder@atom.demo`). In Phase 2, this maps to the bank's IAM identity, and an approval workflow gates the deploy action.

## Workflow execution identity

Each node in a workflow run is logged with the appropriate actor type:

| Node type | Actor type | Actor ID |
|---|---|---|
| `agent` | agent | the agent's service-account ID |
| `http` | system | `system:workflow-engine` (V1); per-integration in Phase 2 |
| `decision` | system | `system:workflow-engine` |
| `human_task` (when resolved) | human | the resolving user's ID |

The workflow execution itself (start, pause, resume, complete) logs as `actor_type=system, actor_id=system:workflow-{run-id}`. This gives you a trace where every event has an actor.

## What's logged where

| Event | Logger | Bucket path | Actor recorded | Retention |
|---|---|---|---|---|
| LLM call | LiteLLM s3 callback | `audit-logs/llm/{date}/{vk-id}/...` | agent (via virtual key) | 90d locked |
| Tool / MCP call | LiteLLM s3 callback | `audit-logs/tool/{date}/{vk-id}/...` | agent | 90d locked |
| ReMe op (read/write) | LiteLLM (ReMe routes through it) | `audit-logs/llm/...` (embeds) | agent | 90d locked |
| Agent generation | builder-backend | `audit-logs/build/{date}/{user}/...` | human (creator) | 90d locked |
| Agent deployment + identity issuance | builder-backend | `audit-logs/deploy/{date}/{agent}/...` | system | 90d locked |
| Workflow generation | workflow-backend | `audit-logs/workflow-build/{date}/{user}/...` | human (creator) | 90d locked |
| Workflow execution events (per node) | workflow-backend | `audit-logs/workflow-run/{date}/{run-id}/...` | varies | 90d locked |
| Human task resolution | workflow-backend | `audit-logs/human-task/{date}/{run-id}/...` | human | 90d locked |
| Object lock retention check | MinIO daily | (intrinsic) | system | n/a |

## The SOC 2 talk track (memorize)

When asked about audit posture, the talk track is:

1. **AC-2 (account management)** — Service accounts are issued for every agent at deploy time; revoked when the agent is undeployed. The same lifecycle pattern as human accounts.
2. **AU-2 (audit events)** — Every model call, tool call, deploy action, workflow node execution, and human task resolution generates an audit event with timestamp, actor, action, and result.
3. **AU-9 (protection of audit information)** — Audit logs are written to MinIO with **object lock in COMPLIANCE mode for 90 days**. Cannot be deleted or modified during retention, even by the bucket owner. (Show this live with `mc retention info` if challenged.)
4. **SI-12 (information handling and retention)** — 90-day default; per-record retention can be extended via a separate process (Phase 2).
5. **AC-6 (least privilege)** — Tool allowlists are enforced at three layers: spec validation (cannot reference unregistered tools), runtime registration (agent code can't import non-allowlisted tools), and gateway guardrails (LiteLLM rejects calls to non-allowlisted tools at the wire). Three layers because banks expect defense in depth.

If the audience pushes harder ("we're under SR 11-7 model risk management"):

- Spec is the documented model definition
- Generation is reproducible (same spec + skill = behaviorally equivalent agent)
- Skill files are reviewable by domain experts as part of model documentation
- Output is testable against golden cases (Phase 2 deliverable)
- Drift detection: compare current behavior against golden cases on a schedule

## V1 Security Boundary — read before rehearsal Q&A

> **This section must be understood by everyone who runs the demo.**

The V1 auth model is deliberately minimal:

1. **Role-button login** — clicking Builder / Approver / Platform Admin sets a session cookie and populates `X-Atom-Actor` header in all API calls. There is no password, no JWT, no signature.

2. **Backends trust `X-Atom-Actor` unconditionally.** The header is read and recorded as the audit `actor_id`. No signature verification. No gateway enforcement. Anyone who can reach the API with a crafted header can claim any identity.

3. **This is intentional for the demo.** The platform runs on a single host with no public access. The threat model for a conference demo is not the same as production. The attack surface is zero because there is no real network perimeter to attack.

4. **In production, Phase 2 adds:** API gateway enforcement (the gateway validates the IDP token before forwarding; `X-Atom-Actor` is set by the gateway, not the client), IDP integration (Okta / Azure AD; the role-button login is replaced with real SSO), and audit log correlation with IDP session IDs.

**What to say in rehearsal Q&A if someone asks "is this secure?":**
> "V1 is a governance demo, not a production deployment. The role-button login shows the UX pattern — Builder submits, Approver reviews, deploy proceeds with both identities recorded. In production, those roles map to your IDP groups and the header is set by the gateway after validating your session token. The audit trail shape is identical; the enforcement layer is added in Phase 2."

**What NOT to say:**
- "Yes, the audit is secured" (without clarifying V1 vs production)
- "The header is validated" (it is not, in V1)

---

## What this is NOT

- **Not an identity provider.** We do not authenticate humans. In V1, role-button login sets a session cookie; in Phase 2, integrate with the bank's IDP.
- **Not a key vault.** LiteLLM virtual keys are stored in LiteLLM's Postgres. In Phase 2, integrate with HashiCorp Vault or AWS Secrets Manager.
- **Not a SIEM.** Audit logs are stored; analyzing them at scale is downstream tooling. We can stream to Splunk/Elastic in Phase 2.

## What to verify in rehearsal

Before the demo:

- [ ] Deploy an agent via Builder. Note its service-account ID.
- [ ] Trigger a workflow that uses that agent.
- [ ] Open the audit pane. Confirm at least three distinct actor types appear (`agent`, `human`, `system`).
- [ ] Click on an LLM call entry. Confirm `actor_id` is the agent's service-account, not the human creator.
- [ ] Click on a human task resolution entry. Confirm `actor_id` is the human user.
- [ ] Run `docker compose exec minio mc retention info local/audit-logs/`. Confirm COMPLIANCE 90d.
- [ ] Try to delete an audit log object via `mc rm`. Confirm it fails with a retention error.

That last step is the demo's killer move. Live, in front of the audience, try to delete an audit log. The deletion fails. Move on. The point lands without you saying anything else.
