# Task 07 — Rehearsal, Fallback, Leave-Behind

> **Updated** for the current platform shape:
> - Demo arc now includes both *agent build live* AND *workflow build
>   live* — the second is the payoff of 04b's visual builder
> - Q&A coverage extended for skills/roles, reasoning modes, free-text
>   chat, runtime deployment, web search/file fetch capability
> - Demo script timing rebalanced; expanded to 14 minutes; explicit
>   compression points marked

## Goal

Demo is rehearsed cold at least 5 times. Pre-recorded fallback exists.
Demo script is in muscle memory. Q&A doc covers the 25 most likely
questions. One-page leave-behind PDF is printed.

## The demo script — 14 minutes total

### 0:00–1:30 — Frame

> "BFSI organizations have processes that are mostly mechanical, with
> a few human judgment calls scattered through them. The mechanical
> parts shouldn't need a human; the judgment parts should. We help
> banks remove the routine human work without removing humans. One
> audit trail across every step.
>
> Two surfaces: a builder for agents, a composer for workflows. Same
> spec-driven approach in both. Today I'll build both, live, then
> wire them into an actual asset transfer workflow."

### 1:30–4:00 — Build an agent (Mode A)

- Switch to Agent Builder
- Select "AI Builder" tile
- Type: "Build an agent that refreshes KYC for a customer using our
  KYC service. Confidence-scored, falls back to human if uncertain."
- Click Generate → spec + role appear in side-by-side review
- "We won't read every line, but it's all here, version-controlled,
  reviewable by your compliance team. Notice the reasoning mode is
  set to *prescribed* — meaning the agent follows a defined process,
  not free-form reasoning. That's deliberate for production-critical
  BFSI ops."
- Click Deploy → service-account ID appears prominently
- "That's a non-human identity, just issued. Every call this agent
  makes is logged under that identity, separate from any human user."
- Repeat with Asset Reconciliation (faster — show the gesture, don't
  reread)

**(Compression point**: if running long, skip the second agent build
verbally; say "we built another one earlier, asset-reconciliation, and
it's in the registry now.")

### 4:00–5:30 — Show the second-mode capability (~90 sec)

- "Quick aside — agents can be built in two reasoning modes. Prescribed
  is what you just saw, for compliance-critical paths. Guided is for
  investigation work."
- Open the Test panel for `transaction-anomaly-triage` (the guided
  example agent, deployed earlier)
- Type a free-text prompt: "Look into transaction TXN-77432, it
  triggered a fraud alert"
- Watch agent reason — it makes its own decisions about which tools
  to call (different runs may call different tools)
- "Same platform. Different mode for different problem. Plus this
  one uses web search via AgentScope's upstream skills library — so
  if it sees a merchant name it doesn't recognize, it goes and looks
  it up."

**(Compression point**: this whole section is optional. If short on
time, drop it entirely; mention as a slide.)

### 5:30–8:00 — Build the workflow (live)

- Switch to Workflow Composer
- Click "Empty Canvas" tile
- Drag nodes from palette: HTTP (receive-request), Agent (KYC),
  HTTP (OFAC), Decision (amount > 250K), Agent (recon), HTTP (SWIFT),
  Human task (final accept)
- Configure each in the inspector — quickly, this is showing the
  *feel* not the depth
- Connect them with edges
- Click Validate → all green
- "We just composed a workflow that integrates two agents we built,
  three external system calls, a decision branch, and a human
  approval. Took two minutes. Now let's run it."

**(Compression point**: instead of building from empty, open a
half-built one ("I started this earlier") and finish the last 2–3
nodes. Saves ~90 sec.)

### 8:00–10:00 — Run, routine path

- Click Test Run → drawer opens
- Click "Routine $40K" sample input button → form fills
- Click Run
- Watch nodes light up live on the canvas:
  - HTTP receive (240ms)
  - KYC agent (3.4s — click for trace; show 3 tool calls + reasoning)
  - OFAC HTTP (clean)
  - Decision branches to recon
  - Recon agent runs
  - SWIFT submit (instruction ID returned)
  - Workflow pauses at final-accept (orange clock badge on node)
- Switch to Tasks tab → one open task
- "This is what humans see when the workflow needs them. They get
  the full agent draft to review."
- Click Accept
- Switch back to Composer → workflow completes (green checks
  everywhere)

### 10:00–11:30 — Run, high-value path

- Same workflow, "$1.2M" sample input
- KYC fires (same agent, same identity)
- Decision branches differently — to compliance review (human)
- "Same workflow. Same agents. The judgment-call humans now see only
  the high-value transfer. Routine ones don't bother them."
- Resolve compliance review and final accept
- Workflow completes

### 11:30–12:30 — Audit

- Switch to Audit pane
- Filter by run ID
- "Three actor types in one timeline. The agents have their own
  service accounts — `svc-acct-kyc-refresh-...`. The humans have
  their bank IDs. The system has its own. Every LLM call, every
  tool call, every external call, every human decision."

### 12:30–13:00 — The killer move

- Open a terminal alongside the UI
- `docker compose exec minio mc rm local/audit-logs/<some-file>`
- It fails with a retention error
- **Don't explain.** Move the terminal away.

### 13:00–14:00 — Close

> "What you saw: built two agents and a workflow, integrated them,
> ran two scenarios end-to-end, with full audit and human-in-the-loop
> at the right places. Built on AgentScope, Temporal, and a single
> LiteLLM gateway with per-agent identities.
>
> The platform isn't ATS-specific. We can take any workflow you have
> and walk through how it would map. What's a workflow you'd want to
> see this on?"

That last line is the conversion ask. Not "let's set up a follow-up";
"what's the workflow you want to see next" — itself a follow-up
commitment.

## Q&A doc — 25 questions, prepared answers

Maintain at `docs/qa-prep.md`. Coverage areas:

### Capability and architecture (Q1–Q8)

1. **"What if the agent makes a mistake?"** → Threshold-based routing
   to human review. Audit trail makes every decision reviewable. We
   can pin agents to deterministic mode for high-stakes paths.
2. **"What about prompt injection?"** → Tool allowlist enforced at
   three layers (spec, runtime, gateway). Agent can't call
   unauthorized tools no matter what its input says.
3. **"What about model drift?"** → Pinned model snapshots; behavioral
   test suite (golden cases); regen + diff on schedule.
4. **"How is this different from RPA?"** → RPA scripts a fixed
   sequence on a UI; the agent reasons over data and makes judgment
   calls within bounds. Different problem.
5. **"Which LLM?"** → Gemini 3.1 Pro for reasoning, Gemini 3 Flash
   for routine. Swappable to Claude/OpenAI under the same
   architecture; LiteLLM abstracts it.
6. **"Are you using AgentScope's skills library?"** → Yes, as the
   upstream capability layer. Pinned dependency. Our agent roles
   compose upstream skills with domain tools and instructions. We
   didn't reinvent. The triage agent we showed used `web_search`
   from upstream.
7. **"Does the agent decide what to do, or follow a script?"** →
   Both, per agent. ATS production agents are prescribed for
   auditable BFSI ops. The triage agent we just demoed is guided.
   You choose per agent.
8. **"How do I add a new capability not in your tool list?"** → Two
   ways. Generic capability → install the corresponding AgentScope
   skill (web search, document parsing, file fetch, etc.). Bank-
   specific integration → register a tool with the platform; 10-line
   change plus a guardrail entry.

### Compliance and risk (Q9–Q14)

9. **"What about SR 11-7 (model risk management)?"** → Spec is the
   documented model definition. Skill/role files are the methodology
   documentation. Generation is reproducible. Output is golden-case
   tested. We can map specifically to your model risk framework.
10. **"What about SOC 2?"** → AC-2 (account management — service
    accounts for agents). AU-2 (audit events — every LLM, tool,
    HTTP, human decision). AU-9 (audit log protection — MinIO
    object lock COMPLIANCE 90d, what you saw fail to delete).
    SI-12 (retention). AC-6 (least privilege — three-layer tool
    allowlist).
11. **"What about data egress?"** → Phase 2 deployment is in your
    tenant; LLM calls go to your provider account; data never
    leaves your VPC except to the model provider on your existing
    data agreement.
12. **"What about identity for production?"** → Service-account IDs
    map to your IAM (Okta, Azure AD). Issued via your IDP at agent
    deploy. Revoked on undeploy. Today's hardcoded "demo user" is
    placeholder.
13. **"What about the human task queue in production?"** → Replace
    the demo's in-memory queue with your task system (ServiceNow,
    Pega, custom). The workflow engine is integration-agnostic.
14. **"Who owns the audit data?"** → You do. MinIO instance lives
    in your tenant. We provide the platform; you provide the
    storage backend.

### Platform usage (Q15–Q20)

15. **"Can I build my own workflows or is this only ATS?"** →
    Build any workflow. ATS is the demo example. (If asked, do a
    live 60-second build of a fictional 3-step workflow on the
    Composer.)
16. **"Can I chat with my agent without involving a workflow?"** →
    Yes — the Test panel is a chat surface; agents take free-text
    input. Engineers can also use Studio for the same conversation
    with deeper trace inspection.
17. **"How are agents actually deployed?"** → AgentScope Runtime
    spawns a containerized FastAPI service per agent. In Phase 2,
    same code deploys to Kubernetes via Kruise. Container is the
    Runtime's deployment unit, not a workaround.
18. **"Can workflows have loops or parallel forks?"** → Not in V1.
    Sequential nodes plus decision branches are the V1 primitives.
    Parallel forks and loops are Phase 2; we add them when we
    encounter a real workflow that needs them, with the appropriate
    governance model.
19. **"What if my workflow has 50 nodes?"** → Composer scales to
    that. The four node types stay the same; you just have more of
    them. The audit story is identical at any scale.
20. **"Can multiple workflows share an agent?"** → Yes. An agent is
    deployed once and referenced by `agent_ref.name` in any number
    of workflows.

### Commercial and engagement (Q21–Q25)

21. **"What does deployment to our environment look like?"** → Six-
    week sprint to ship one workflow with two agents, integrated
    with your KYC and SWIFT (or equivalent) systems, deployed to
    your tenant. *(Have a real number behind this — see commercial
    offer prep.)*
22. **"What's the cost?"** → Two components: services engagement
    (sprint-priced), platform license (per-workflow or per-agent,
    your call). Concrete pricing in the follow-up.
23. **"Who's used this?"** → *(Honest answer based on real
    deployments. Don't invent.)*
24. **"What's the implementation team look like?"** → 2 engineers,
    1 BFSI domain expert, 0.5 program manager for a six-week sprint.
    We absorb infra setup; you provide system access.
25. **"What's the timeline to first production value?"** → If we
    start the engagement at engagement kickoff +0, week 6 is
    production cutover for the first workflow. Subsequent workflows
    are 3–4 weeks each as the team familiarity compounds.

(Add 5–10 more covering: vendor lock-in, what we own vs open source,
training data, hallucination detection, your team's BFSI experience,
similar deployments, regulatory reporting, change management.)

## Pre-recorded fallback

Before launch week:
- Run all three demo paths through to completion
- Run the agent build (Mode A) and the workflow build (Mode A) demo
  segments
- Record the screen with audio voiceover
- Save as `docs/demo-fallback.mp4` and on a USB stick
- Test playback on the venue's display the day before

If anything goes sideways live: switch to the recording. Frame: "to
keep us on time, here's a recorded run of this exact build."

## Leave-behind one-pager

PDF, printed, sized for letter or A4. Contents:

- Top: "platform Agent Platform — BFSI Workflow Automation"
- Headline: "Remove routine human work from existing workflows. Keep
  humans on the calls that matter. One audit trail."
- 4 bullets:
  - Two surfaces: agents and workflows, both built visually or via CLI
  - Real workflow engine (Temporal); audit-ready by default
  - Per-agent identity + audit; SOC 2 mapped
  - Sprint-priced engagement; six weeks to first workflow in production
- One screenshot of the Composer canvas with ATS workflow mid-run
- One screenshot of the Audit pane showing three actor types
- Bottom: contact + QR code to a one-pager landing page

Print 50. Hand them out.

## Rehearsal log

Maintain `docs/rehearsal-log.md`. After every rehearsal:

| Date | Rehearser | Path A | Path B | Path C | Agent build | Workflow build | Notes |
|---|---|---|---|---|---|---|---|
| YYYY-MM-DD | name | ✓/✗ | ✓/✗ | ✓/✗ | ✓/✗ | ✓/✗ | what broke |

Goal: 5 consecutive green rehearsals (every column ✓) before the demo.
If you can't get there, the live demo is dropped and you run the
recording.

## Definition of Done

- [ ] Demo script written and printed
- [ ] 25-question Q&A doc complete
- [ ] Pre-recorded fallback at `docs/demo-fallback.mp4`, tested on a
      venue-spec display
- [ ] Leave-behind one-pager designed, printed (50 copies)
- [ ] 5 consecutive successful rehearsals logged (all columns ✓)
- [ ] Two team members can deliver the demo solo
- [ ] Backup laptop with full stack pre-warmed and tested
- [ ] Network fallback: hotspot ready (Gemini API is the only external
      dependency)
- [ ] `atom demo preflight` runs clean (all three paths) before the
      demo session

## What can go wrong on the day

| Risk | Mitigation |
|---|---|
| Wifi flaky | Hotspot ready; Gemini calls are the only external dependency |
| Laptop dies | Backup laptop pre-warmed, both sync'd to git |
| Demo runner blanks | Second team member co-presenting and ready to step in |
| Audience asks a hostile question | Q&A prep covered it; if not, "let me make sure I get that right and follow up by EOD" — don't bluff |
| Live demo breaks twice | Switch to recording. Don't try a third time. |
| Workflow build live takes too long | Compression point: open a half-built one and finish the last 2–3 nodes |
| Composer canvas misbehaves visually | Fall back to CLI: `atom workflow run --sample` while continuing voiceover |
| Agent's confidence drifts | Pin to deterministic mode pre-demo (mocked LLM response cached) |
| Human task UI doesn't update | Resolve via `atom tasks resolve <id>` from a terminal you have ready |

The general rule: **never debug live**. If something fails twice,
switch to the pre-recorded fallback. The audience would rather see a
recording than a platform person typing into a terminal.

Special case: the CLI is your secondary backstop. If the Composer UI
breaks, the demo can continue via `atom workflow run` and
`atom tasks resolve` while you talk through what's happening. Less
visual but functional. Practice this path in at least one rehearsal.

## Pre-demo day checklist

- [ ] `atom demo preflight` — all three paths green
- [ ] Pre-warm all agents (one invoke each — first call is always
      slowest)
- [ ] Verify MinIO retention COMPLIANCE 90d still set
- [ ] Verify Temporal Web UI loads (audience never sees this; you
      might need to glance at it if something hangs)
- [ ] Verify Studio loads (link from the Test panel)
- [ ] Test the killer-move command: `docker compose exec minio mc rm
      local/audit-logs/<file>` should fail
- [ ] Print backup demo script (paper, not on screen)
- [ ] Test microphone, screen mirroring, lighting on the venue stage
- [ ] Final commercial offer ready (the question I keep raising —
      whoever owns it confirmed it's done)