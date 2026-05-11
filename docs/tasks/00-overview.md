# Task Overview — Session Map

Each task file is one Claude Code session. Sessions are sequenced; later sessions depend on earlier ones. **Do not skip ahead.**

## Sequence

| # | Session | Depends on | Approx duration | Definition of Done |
|---|---|---|---|---|
| 01 | Infrastructure & gateways | — | 1 day | LiteLLM, MinIO, Studio, OTEL, Temporal all healthy. Gemini call traceable to MinIO. Object lock COMPLIANCE 90d set. |
| 02 | Mock services (BFSI + ATS) | 01 | 1.5 days | All 9 mocks serve seeded data. KYC service returns the three demo profiles. SWIFT gateway accepts instructions. Task queue accepts and resolves tasks. |
| 03a | Builder backend (agents) | 01, 02 | 2 days | `/specs/agent/validate` + `/specs/agent/generate` work. Service-account ID issued at deploy via LiteLLM virtual key. |
| 03b | Workflow backend + Temporal worker | 03a | 2 days | `/specs/workflow/validate` + `/workflows/<n>/runs` work. Worker can interpret the ATS workflow spec. Human task pause/resume via task queue works. |
| 04 | Frontend (Builder + Composer + Audit + Tasks) | 03a, 03b | 3 days | All four surfaces in one SPA. Composer canvas (React Flow) renders ATS workflow. "Replace with agent" gesture works. |
| 05 | ATS workflow end-to-end | 02, 03b, 04 | 1.5 days | Full happy-path demo runs. Three demo paths (routine, high-value, KYC low-confidence) all reliable. Audit pane shows all three actor types. |
| 06 | CLI + Mode B polish | 03a, 03b | 0.5 day | `atom agent scaffold` and `atom workflow init` work end-to-end. Demoable as a "CLI-first developer experience" alongside the UI. |
| 07 | Rehearsal + fallback | 05, 06 | 1 day | 5+ end-to-end rehearsals. Pre-recorded fallback. Demo script. Q&A doc. Leave-behind. |

**Total**: ~12 days for one developer; ~7–8 days with two in parallel after task 02.

## Parallelization

After task 02 (mocks done):
- Developer A: 03a → 03b → 05 → 07
- Developer B: 04 → (joins 05) → 06 → 07

## Critical path

01 → 02 → 03a → 03b → 05 → 07.

Task 04 (frontend) is on the demo's *visual* critical path but not on the *function* critical path. If frontend slips, the demo can be run via API calls and a static screen recording, but it loses substantial impact.

Task 06 (CLI) is off-critical. If time runs short, drop it from the active demo (Mode B becomes a slide).

## Cut criteria

- If by end of week 3, ATS end-to-end isn't running cleanly, **drop the live "build agent" gesture** in the demo and use pre-built agents. The workflow story can carry it.
- If by end of week 4, the frontend Composer canvas is buggy, **fall back to a YAML-only Composer** (Monaco editor only, no React Flow). Less impressive but reliable.
- Mode C (AI workflow generation from prose) is always optional. Demo with a feature flag; disable if it misbehaves in any rehearsal.

## Universal session protocol

Every session starts with:

1. Read `CLAUDE.md` (root)
2. Read this file
3. Read the specific task file
4. Read any SKILL.md the task references
5. Confirm the previous session's "Definition of Done" was actually met

Every session ends with:

1. DoD checklist verified
2. Note appended to `docs/tasks/_session-log.md`: what was done, what's broken, what next
3. Commit; PR-style review even if solo
