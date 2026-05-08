# Task 07 — Rehearsal, Fallback, Leave-Behind

## Goal

Demo is rehearsed cold at least 5 times. Pre-recorded fallback exists. Demo script is in muscle memory. Q&A doc covers the 20 most likely questions. One-page leave-behind PDF is printed.

## The demo script (memorize this — 12 minutes total)

### 0:00–1:00 — Frame
*"BFSI organizations have processes that are mostly mechanical, with a few human judgment calls scattered through them. The mechanical parts shouldn't need a human; the judgment parts should. We help banks remove the routine human work without removing humans. One audit trail across every step. Let me show you with an actual asset transfer workflow."*

### 1:00–3:00 — Show the "before"
- Open Workflow Composer on `ats-asset-transfer (current state)`
- All 9 nodes are red `human_task` blocks
- Point: "This is the current process. 90 minutes per transfer. Two thirds of that is people clicking through reviews on transfers that don't need review."

### 3:00–5:00 — Build the agents (Mode A)
- Switch to Agent Builder
- "Build an agent that refreshes KYC for a customer using our KYC service. Confidence-scored, falls back to human if uncertain."
- Click Generate → spec + skill appear
- (Acknowledge: skip reading the spec aloud; "we won't read every line, but it's all here, version-controlled, reviewable by your compliance team")
- Click Deploy → service-account ID appears
- Repeat with Asset Reconciliation agent (faster — show the gesture, don't reread)
- Optional: switch to Mode B briefly. Open a terminal, run `atom agent scaffold loan-eligibility`. Don't deploy. "Same workflow, different surface — your developers can stay in their editor."

### 5:00–7:00 — Compose
- Back to Workflow Composer
- Click the KYC node → Inspector → Replace with agent → kyc-refresh
- Click the asset-recon node → Replace with agent → asset-recon
- Two purple nodes, two service-account ID badges visible
- "We just removed 60 of 90 minutes of routine human work. Compliance review and final approval stay human."

### 7:00–9:00 — Run, routine path
- Click Run → routine $40K
- Watch nodes light up
- KYC agent finishes in 3 sec; click into the trace; show the agent's tool calls
- Decision node branches to routine
- Asset-recon finishes
- SWIFT instruction submitted
- Workflow pauses at final-accept
- Switch to Tasks pane → click Accept
- Workflow completes

### 9:00–10:30 — Run, high-value path
- Same workflow, $1.2M input
- KYC fires (same agent, same identity)
- Decision branches differently — to compliance review
- "Same workflow. Same agents. The judgment-call humans now see only the high-value transfer. Routine ones don't bother them."
- Resolve compliance review and final accept
- Workflow completes

### 10:30–11:30 — Audit
- Switch to Audit pane
- Filter by run ID
- Point: "Three actor types in one timeline. The agents have their own service accounts — `svc-acct-kyc-refresh-...`. The humans have their bank IDs. The system has its own. Every LLM call, every tool call, every external call, every human decision."
- Optional killer move: open a terminal, `docker compose exec minio mc rm local/audit-logs/<some-file>`, watch it fail with a retention error. **Don't explain.** Move on. The point lands.

### 11:30–12:00 — Close
*"This is what we mean when we say we help banks remove routine human work. Same audit trail. Same humans on the calls that need them. Built on Temporal, AgentScope, and a single LiteLLM gateway. We can take any workflow you have and walk through how this would map. What's a workflow you'd want to see this on?"*

— That last line is the conversion ask. Not "let's set up a follow-up", but "what's the workflow you want to see next" — which is itself a follow-up commitment.

## Q&A doc (top 20 questions, prepared answers)

Maintain at `docs/qa-prep.md`. Sample (not exhaustive):

1. **"What if the agent makes a mistake?"** Threshold-based routing → human review. Plus the audit trail makes every decision reviewable. We can also pin agents to deterministic mode for high-stakes paths.
2. **"What about prompt injection?"** Tool allowlist enforced at three layers (spec, runtime, gateway). Agent can't call tools it isn't authorized for, no matter what its input says.
3. **"What about model drift?"** Pinned model snapshots; behavioral test suite (golden cases); regen + diff on schedule.
4. **"How is this different from RPA?"** RPA scripts a fixed sequence on a UI; the agent reasons over data and makes judgment calls within bounds. Different problem.
5. **"What does deployment to our environment look like?"** Phase 2 conversation. Six-week sprint to ship one workflow with two agents, integrated with your KYC and SWIFT systems, deployed to your tenant. *(This is where you need a real number.)*
6. **"What about SR 11-7?"** Spec is the model definition. Skill is the methodology document. Generation is reproducible. Output is golden-case-tested. We can map specifically.
7. **"Which LLM?"** Gemini 3.1 Pro for reasoning, Gemini 3 Flash for routine. We can swap to Claude/OpenAI under the same architecture; LiteLLM abstracts it.
8. **"What about data egress?"** Phase 2 deployment is in your tenant; LLM calls go to your provider account; data never leaves your VPC except to the model provider, on your existing data agreement.
9. **"What about identity for production?"** Service-account IDs map to your IAM (Okta, Azure AD). Issued via your IDP at agent deploy. Revoked on undeploy.
10. **"What about the human task queue in production?"** Replace the demo's in-memory queue with your task system (ServiceNow, Pega, custom). The workflow engine doesn't care.

(Add 10 more covering: cost, training data, hallucination detection, regulatory reporting, change management, vendor lock-in, what we own vs what's open source, our team's BFSI experience, similar deployments at other banks, timeline to first value.)

## Pre-recorded fallback

Before TechShift week:
- Run all three demo paths through to completion
- Record the screen with audio voiceover
- Save as `docs/demo-fallback.mp4` and on a USB stick
- Test playback on the venue's display the day before

If anything goes sideways live: switch to the recording. Frame: "to keep us on time, here's a recorded run of this exact workflow."

## Leave-behind one-pager

PDF, printed, sized for letter or A4. Contents:

- Top: "Mphasis Agent Platform — BFSI Workflow Automation"
- Headline: "Remove routine human work from existing workflows. Keep humans on the calls that matter. One audit trail."
- 4 bullets: two-surface platform, real workflow engine (Temporal), per-agent identity + audit, sprint-priced engagement
- One screenshot of the Composer canvas with ATS workflow
- One screenshot of the Audit pane showing three actor types
- Bottom: contact + QR code to a one-pager landing page

Print 50. Hand them out. The point is not the document; the point is having something to give that survives the conversation.

## Rehearsal log

Maintain `docs/rehearsal-log.md`. After every rehearsal:

| Date | Rehearser | Path A | Path B | Path C | Notes |
|---|---|---|---|---|---|
| YYYY-MM-DD | name | ✓/✗ | ✓/✗ | ✓/✗ | what broke; what was fixed |

Goal: 5 consecutive green rehearsals before the demo. If you can't get there, the live demo is dropped and you run the recording.

## Definition of Done

- [ ] Demo script written and printed
- [ ] 20-question Q&A doc complete
- [ ] Pre-recorded fallback at `docs/demo-fallback.mp4`, tested on a venue-spec display
- [ ] Leave-behind one-pager designed, printed (50 copies)
- [ ] 5 consecutive successful rehearsals logged
- [ ] Two team members can deliver the demo solo
- [ ] Backup laptop with full stack pre-warmed and tested
- [ ] Network fallback: if TechShift wifi fails, demo runs from local machine without external calls *(except Gemini API — have a hotspot ready)*

## What can go wrong on the day

| Risk | Mitigation |
|---|---|
| Wifi flaky | Hotspot ready; Gemini calls are the only external dependency |
| Laptop dies | Backup laptop pre-warmed, both sync'd to git |
| Demo runner blanks | Second team member co-presenting and ready to step in |
| Audience asks a hostile question | Q&A prep covered it; if not, "let me make sure I get that right and follow up by EOD" — don't bluff |
| Live demo breaks twice | Switch to recording. Don't try a third time. |
