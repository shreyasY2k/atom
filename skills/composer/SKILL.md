---
name: workflow-composer
description: |
  Compiles a natural-language description of a BFSI workflow into a
  Atom Workflow Composer workflow-spec.yaml. Used by Mode C
  (full natural-language workflow generation). Output is a single YAML
  file conforming to the workflow-spec schema, using only the four
  allowed node types and referencing only existing agents.
trigger: |
  Generate workflow-spec from this description (use this skill)
---

# Workflow Composer Skill

You are compiling a natural-language description of a BFSI process into a `workflow-spec.yaml`. Your output is parsed by the workflow-backend; deviations break the build.

## Hard rules — never violate

1. **Only four node types are allowed**: `agent`, `http`, `decision`, `human_task`. No others.
2. **No loops, no parallel forks, no sub-workflows.** If the user describes one, decompose it into the closest sequential equivalent and add a comment in the YAML noting what was simplified.
3. **Agent nodes can only reference agents that exist in the registry.** You will be given the registry as a list. If the user describes a step that needs an agent that doesn't exist, do NOT invent one — emit a `human_task` node with a `notes` field saying "Agent for this step does not yet exist; build it via Agent Builder and replace this node."
4. **Every state-changing external call** (anything writing to a real system: SWIFT, DTC, payment rails, CRM mutations) **must be followed by a `human_task` node**, OR be preceded by one. The validator enforces this; build it in.
5. **Output is a single YAML document** in a fenced ```yaml``` block. No prose.
6. **Use `confidence_threshold` on every agent node** unless the user explicitly says "always trust the agent." Default threshold: 0.85. Set `fallback_node` to a `human_task`.
7. **Decision nodes use simple Python expressions only** — comparison + boolean ops, no function calls, no attribute access beyond `ctx.*`.

## Input you receive

1. The user's natural-language description of the workflow
2. The list of registered agents (name, version, what it does, expected inputs/outputs)
3. The list of registered HTTP services (name, base URL, what they do)
4. The list of valid `assignee_group` values for human tasks

## Output you produce

A single `workflow-spec.yaml` as a fenced YAML block. Exact schema in `docs/workflow-spec-format.md`.

## Process

1. **Parse the description** into a sequence of steps. Identify each step's category: data fetch, agent decision, rule branch, external write, human review.
2. **Map each step to a node type:**
   - Data fetch from external system → `http`
   - Agent decision (judgment, drafting, classification) → `agent`
   - Rule-based branch → `decision`
   - Human review or final approval → `human_task`
3. **Assign IDs** in kebab-case based on step purpose.
4. **Wire `next` and `branches`** for sequential flow and decision branching.
5. **Add `confidence_threshold` and `fallback_node`** to every agent node.
6. **Verify the BFSI invariant**: every state-changing `http` call has a `human_task` neighbor.
7. **Emit YAML.**

## Common rationalizations to reject

- "The user asked for a parallel fork; I'll add it" — **NO.** V1 has no parallel forks. Sequentialize, comment.
- "The agent for step X doesn't exist; I'll define what it should do inline" — **NO.** Emit a `human_task` with a note. The user must build the agent first.
- "The user said 'just trust the agent'; I'll skip the threshold" — **NO.** Default threshold is 0.85. If they explicitly demand no threshold, set it to 0.0 (effectively always passing) and add a comment flagging the deviation.

## Output now

When you receive the description and registry, output the `workflow-spec.yaml` as one fenced YAML block. Nothing before or after.
