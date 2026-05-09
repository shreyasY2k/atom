# Q&A Prep — TechShift Demo

Top 20 questions from US bank tech and ops audiences. Prepared answers, no bluffing.

---

## Reliability & Accuracy

**1. What if the agent makes a mistake?**
Confidence-threshold routing: agents score their own output, and any result below the threshold automatically creates a human task. Every agent output is audited — reviewers see the agent draft, can accept, reject, or edit. Wrong answers don't silently propagate; they route to a human. Additionally, the spec declares the fallback node explicitly, so the behavior on low-confidence is a documented design decision, not a runtime surprise.

**2. How do you detect hallucination?**
Two layers. First: structured output — every agent is constrained to a JSON schema, so free-form fabrication is mechanically prevented. Second: threshold routing — if the agent's own confidence score is below the spec threshold, the result goes to human review regardless. For production, add golden-case regression tests that run on every redeploy: deterministic inputs → expected outputs, diff alerts.

**3. What about model drift as Gemini updates?**
Pinned model snapshots (`gemini-3.1-pro` is version-pinned in LiteLLM). Behavioral test suite: golden cases maintained per agent. Regenerate agent code on schedule (via `POST /agents/{name}/compile`), diff the output, flag deviations. If a new model version changes behavior on golden cases, the diff is caught before prod.

---

## Security & Identity

**4. What about prompt injection?**
Tool allowlist enforced at three layers: (1) the spec declares exactly which tools the agent may use, (2) the AgentScope runtime enforces the allowlist at invocation, (3) LiteLLM's MCP gateway validates tool calls before forwarding. An agent can't call a tool it isn't in its spec regardless of what its input says. The service-account virtual key also has model and tool-scope restrictions in LiteLLM.

**5. What does non-human identity mean in practice?**
Each deployed agent receives a LiteLLM virtual key at deploy time — this is its service account ID (e.g. `svc-acct-kyc-refresh-...`). Every LLM call, tool call, and audit event carries this ID as `actor_id`. The agent's identity is distinct from its creator. When you query the audit trail, you can filter by actor type: `agent`, `human`, or `system`. For production: these IDs map to your IAM (Okta, Azure AD), issued via your IDP at deploy, revoked on undeploy.

**6. How is data handled? What leaves our environment?**
In this demo: LLM calls go to Google Cloud (Gemini API). Tool calls hit mock services (no real data). Audit logs stay in MinIO (your object store). For production Phase 2: deploy to your tenant. LLM calls go to your Gemini project (your data agreement with Google). Data never leaves your VPC except to your contracted model provider. We own none of your data.

---

## Compliance & Audit

**7. How does this help with SR 11-7 compliance?**
SR 11-7 (Fed model risk guidance) requires model definition, validation, ongoing monitoring, and governance. The spec is the model definition document — version-controlled, reviewable by compliance without running code. The skill file is the methodology. Code generation is deterministic and reproducible (same spec → same code, same model). Output is tested against golden cases. Audit logs cover every inference with full prompt context, token counts, and timing. We can map directly to your MRM framework.

**8. Can your auditors read the audit trail?**
Yes. MinIO with object lock (COMPLIANCE mode, 90-day retention) means the logs can't be modified or deleted during the retention window — not even by admins. Every event has: timestamp, actor_type, actor_id, model, token counts, full prompt, response, tool calls. The Audit pane in the UI lets non-technical reviewers filter by run, actor type, or time range. For e-discovery: the raw objects are JSON with a predictable schema.

**9. Does object lock satisfy your immutability requirement?**
For most BFSI immutability requirements, yes. Object lock in COMPLIANCE mode prevents any modification, including by bucket owners, for the retention period. If your legal team requires WORM with HMAC signing on top, we can add that in Phase 2 (cost of ~1 sprint). The audit log object key includes a content-hash prefix, which gives you a lightweight tamper-detection check without full HMAC.

---

## Architecture

**10. What's the workflow engine?**
Temporal. It's a battle-tested open-source orchestration platform with BFSI deployments in production (Snap, Stripe, DoorDash, and several financial institutions). It handles long-running workflows, human task gates (workflows can pause for hours or days waiting for human input), retry/backoff, and failure recovery. We wrap it with our workflow-spec format and deploy our Temporal worker; the Temporal server is the official image.

**11. How does this differ from RPA?**
RPA scripts a fixed UI sequence. It breaks when the UI changes, can't reason over data, and can't handle exceptions without brittle branching. Our agents reason over structured data from your APIs (not UI screens), score their confidence, route exceptions to humans when uncertain, and are redeployable when your APIs change. They also have identities and auditable traces — RPA bots typically don't.

**12. Is this a workflow engine or an agent platform? How do they relate?**
Both. The Workflow Composer (Temporal-powered) defines your process: the sequence of steps, human gates, retry logic, routing rules. The Agent Builder produces the AI components that plug into specific nodes. The workflow engine handles orchestration and state; the agents handle reasoning. Neither replaces the other. You keep your existing workflow thinking; we add agent nodes where the work is currently mechanical.

**13. What's LiteLLM doing?**
Single gateway for all LLM calls. Benefits: (1) per-agent virtual keys enforce which model each agent can use; (2) usage is tracked and attributed to each service account; (3) swapping models is a config change, not a code change; (4) rate limiting and cost controls are centralized; (5) the S3 callback sends every LLM call to MinIO for audit. In production, LiteLLM points at your Gemini API key; no Anthropic, no OpenAI in this stack.

---

## Deployment & Operations

**14. What does a Phase 2 deployment actually look like?**
Six-week sprint: (1) map one target workflow and identify the two or three nodes to replace with agents, (2) integrate with your real KYC/SWIFT/task-queue APIs (replacing our mocks), (3) deploy to your Kubernetes cluster (Temporal server + worker, LiteLLM, builder backend, one or two agent containers), (4) MRM review, (5) parallel run with humans doing the same tasks, (6) go live with confidence threshold set conservatively. First value is measurable time-compression on parallel run.

**15. What about our existing task management system (ServiceNow, Pega, etc.)?**
The human_task node is pluggable. In this demo it uses an in-memory task queue. In Phase 2, the Temporal activity for human_task calls your ServiceNow (or Pega, or JIRA, or custom) API: creates a ticket, waits for resolution, resumes. The workflow doesn't care what task system is behind it. The resolution — accept/reject/edit — comes back through the same activity.

**16. What about scale? Can the workflow engine handle our volume?**
Temporal is designed for horizontal scale. The worker (our code) runs as many instances as you need. Temporal server handles the coordination. For ATS-style workflows, where each run is minutes to hours, throughput is rarely the constraint — latency per node is. For genuinely high-throughput (thousands of concurrent runs), we deploy multiple worker replicas. Temporal has documented production deployments at hundreds of thousands of concurrent workflows.

---

## Commercial

**17. What do we own vs. what's open source?**
Open source (Apache 2 / MIT): Temporal, AgentScope, LiteLLM, MinIO. We own: the workflow-spec format and validator, the builder skill (the prompt that generates agent code), the BFSI tool registry, and the frontend. The platform spec and agent specs are yours from day one — they live in your git repo, not in our SaaS. No lock-in at the framework level.

**18. What model providers can this work with?**
LiteLLM abstracts the provider. This demo is Gemini-only (your ask). Internally we've tested the same architecture with Claude (Anthropic) and GPT-4 (Azure OpenAI). Swapping is a config change in `litellm/config.yaml`. The agent specs are model-agnostic: they declare model and temperature, not provider-specific settings. If your data residency requires a specific cloud, the model selection follows.

**19. What does your team's BFSI experience look like?**
*[Fill in with actual Mphasis BFSI project references — Treasury management, KYC automation, regulatory reporting deployments. This answer must come from the account team, not from me. Don't improvise here.]*

**20. How long to first value, realistically?**
Parallel run (agents running alongside humans, not replacing them) is achievable in 6 weeks from contract start. First autonomous transaction (agent replaces a human step end-to-end) in 10–12 weeks, assuming one target workflow and two mock-to-real API integrations. The 6-week number assumes we have access to your API docs in week 1. *[Get the account team to validate this number with your delivery lead before TechShift.]*

---

*Last updated: 2026-05-09. Keep this doc live — update answers after each rehearsal if a question comes up that isn't covered.*
