# Task 06 — CLI & Mode B polish

## Goal

`atom` CLI is installable, scaffolds work end-to-end, and Mode B (manual workflow + manual/scaffolded agents) is demoable as a developer-experience story alongside the UI.

## Steps

1. **Install CLI in editable mode.**
   ```bash
   cd cli/
   pip install -e .
   atom --help
   ```

2. **Scaffold a new agent end-to-end.**
   ```bash
   atom agent scaffold demo-agent --domain banking-kyc
   # Verify: specs/agents/demo-agent.yaml created
   #         skills/banking-kyc/demo-agent.skill.md created
   ```
   Both files must contain TODO markers; refuse to overwrite if present.

3. **Validate it.**
   ```bash
   atom agent validate specs/agents/demo-agent.yaml
   # Stub for now; actual validation is via builder-backend
   ```

4. **List agents.**
   ```bash
   atom agent list
   # Should show all specs in the repo
   ```

5. **Init a workflow.**
   ```bash
   atom workflow init demo-workflow
   # Verify: specs/workflows/demo-workflow.yaml created
   ```

6. **Wire validate / run to call backends.**
   `atom agent validate <path>` should POST the file to `builder-backend:8080/specs/agent/validate` and pretty-print the response.
   `atom workflow validate <path>` similarly to `workflow-backend:8081/specs/workflow/validate`.
   `atom workflow run <name> --input '{...}'` should POST to `workflow-backend:8081/workflows/<name>/runs` and stream events from `/runs/<run_id>/events`.

7. **Add `atom status` command.**
   ```bash
   atom status
   ```
   Hits `/health` on every service in the stack. Output:
   ```
   ✓ litellm           4000   ok
   ✓ builder-backend   8080   ok
   ✓ workflow-backend  8081   ok
   ✓ temporal          7233   ok
   ✓ minio             9000   ok
   ✓ kyc-svc           8095   ok
   ...
   ```
   Useful before every rehearsal.

8. **Demo the CLI flow.**
   In rehearsal, do this once with the CLI alongside the UI flow:
   ```bash
   atom agent scaffold loan-eligibility --domain banking-credit
   # Show the generated stub in the editor
   # Edit the skill file with a focused prompt
   # atom agent validate specs/agents/loan-eligibility.yaml
   # atom agent deploy loan-eligibility
   # The agent appears in the UI's agent list
   ```
   This sells Mode B as the realistic developer experience: "you don't have to use our UI, but if you do, here's what it looks like."

## Definition of Done

- [ ] `pip install -e .` succeeds
- [ ] `atom --help` shows all commands
- [ ] `atom agent scaffold` creates both spec + skill files
- [ ] `atom workflow init` creates a workflow stub
- [ ] `atom agent list` shows all specs
- [ ] `atom agent validate` calls the backend and pretty-prints
- [ ] `atom workflow validate` calls the backend
- [ ] `atom workflow run` triggers a run and streams events
- [ ] `atom status` checks all 14+ services
- [ ] CLI demo flow rehearsed at least 3 times

## What this session does NOT do

- No Mode C (NL → workflow generation) — that's part of `workflow-backend` if pursued
- No CLI-side caching or offline mode
- No fancy TUI; click output is fine

## Cut criteria

If task 04 (frontend) is dragging and only one of Mode A or Mode B can be in the demo: keep Mode A in the live demo, mention Mode B as a slide ("for developers who prefer their own editor"). Don't cut the CLI from the codebase — it's a backstop.
