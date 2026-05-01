# ADR-007 — agentscope Fork Strategy

**Status:** Amended (original decision was based on incorrect assumptions about agentscope-studio)
**Date:** 2025-01-01
**Amended:** 2025-06-01

---

## Context

ATOM builds on agentscope components. When this ADR was first written, agentscope-studio was
assumed to be a full-stack Python/FastAPI application we could extend with ATOM management APIs.
That assumption was wrong.

**What agentscope-studio actually is:** A pure Node.js visualization toolkit. It receives
WebSocket pushes from agents via `agentscope.init(studio_url=...)` and displays conversations,
traces, and token usage in a browser. It has no Python backend, no auth, no database, no
management APIs. It is a developer debugging and observability dashboard.

---

## Decision

### Components forked and modified

**`atom-sdk`** (from agentscope core)
- SESSION-06: Remove all provider wrappers, add AtomChatWrapper + AtomEmbeddingWrapper
  that route through GATE via base_url pattern, add HITL hooks

**`atom-memory`** (from agentscope-reme)
- SESSION-12: Add pgvector backend (long-term), Redis backend (short-term)

**`atom-runtime`** (from agentscope-runtime)
- SESSION-11: Add deploy webhook + k8s manifest builder

### Components cloned but NOT modified

**`agentscope-studio`** — cloned in SESSION-00, runs as-is.

Role in ATOM: observability only. Developers point agents at it during development to
watch live conversations and traces. Runs as a separate pod. Never touched.

### Components built from scratch

**`atom-studio`** — new service, not a fork (see ADR-015).

The ATOM management portal: auth, domains, agents, HITL queue, deployment approvals.

---

## Revised Monorepo Layout

```
atom-sdk/           ← fork of agentscope (SDK, modified)
atom-memory/        ← fork of agentscope-reme (modified)
atom-runtime/       ← fork of agentscope-runtime (modified)
agentscope-studio/  ← clone of agentscope-studio (NOT modified)
atom-studio/        ← built from scratch
  backend/          ← FastAPI (Python)
  frontend/         ← React + Vite + shadcn/ui
```

---

## Consequences

**Positive:** atom-studio is clean FastAPI (consistent with all other Python services).
agentscope-studio stays pristine with zero merge risk. Clear separation of concerns:
observability (agentscope-studio) vs management (atom-studio).

**Negative:** atom-studio frontend is built from scratch (more work than reusing a fork).
Developers need to know two URLs. Mitigated by linking from atom-studio dashboard to the
agentscope-studio trace viewer.
