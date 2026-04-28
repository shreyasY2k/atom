# ADR-015 — atom-studio Architecture (FastAPI + React)

**Status:** Accepted
**Date:** 2025-06-01

---

## Context

ATOM needs a management portal that provides:
- Human user authentication (login, sessions, roles)
- Domain and agent lifecycle management
- Agent token provisioning (one-time JWT issuance)
- HITL decision queue with real-time push
- Deployment approval workflow
- Audit log viewer

The original plan was to extend agentscope-studio. That was based on the wrong assumption
that agentscope-studio had a Python backend. It does not — it is a Node.js visualization tool.

---

## Decision

Build `atom-studio` as a new service from scratch:

**Backend:** Python + FastAPI
**Frontend:** React + Vite + shadcn/ui

### Backend (`atom-studio/backend/`)

```
atom-studio/backend/
  src/atom_studio/
    main.py           ← FastAPI app, mounts all routers
    config.py         ← Pydantic Settings from env vars
    database.py       ← asyncpg connection pool
    auth/             ← JWT login, refresh, middleware
    domains/          ← domain CRUD
    agents/           ← agent provisioning, token issuance
    tools/            ← tool registration
    skills/           ← skill registration
    hitl/             ← HITL queue, WebSocket push
    deployments/      ← deployment approval, runtime webhook
    audit/            ← audit log viewer
    ws/               ← WebSocket manager (shared)
  pyproject.toml
  Dockerfile
```

Tech choices:
- **FastAPI** — consistent with atom-llm, atom-runtime, atom-memory; async native
- **asyncpg** — async Postgres driver; all endpoints are async
- **passlib + bcrypt** — password hashing
- **python-jose** — RS256 JWT generation and validation
- **WebSockets** — FastAPI native; used for HITL real-time push

### Frontend (`atom-studio/frontend/`)

```
atom-studio/frontend/
  src/
    components/ui/    ← shadcn/ui primitives
    components/app/   ← ATOM-specific components
    pages/            ← Login, Dashboard, Domains, Agents, HITL, Audit
    lib/              ← API client, auth state, WebSocket hook
    App.tsx
    main.tsx
  package.json        ← Vite + React + TypeScript + shadcn/ui + TanStack Query
  Dockerfile
```

Tech choices:
- **Vite + React + TypeScript** — fast dev server, SPA
- **shadcn/ui** — composable, accessible component library (no runtime dependency)
- **TanStack Query** — data fetching, cache, optimistic updates
- **TanStack Router** — file-based routing
- **Zustand** — lightweight auth state store

### Runtime topology

```
Browser → atom-studio/frontend (Vite dev / nginx prod, port 3000)
        → atom-studio/backend  (FastAPI, port 3001)
        → GATE                 (for HITL WebSocket relay, port 8080)

agentscope-studio (Node.js, port 3002) ← agents push traces here
```

In production (k8s), the React build is served as static files by nginx in the frontend pod.
The backend pod runs FastAPI via Uvicorn.

### Key invariant

atom-studio backend uses the same RS256 JWT key pair as GATE:
- Signs JWTs with the platform private key
- GATE validates them with the platform public key
- Single key pair, single trust root — no additional key management

---

## Rationale

- FastAPI is already the stack for three other ATOM services — no new language in the backend
- React + shadcn/ui gives a professional management portal UI in the least amount of code
- Building from scratch means no upstream merge burden and no confusion with agentscope-studio's purpose
- Keeping agentscope-studio separate means ATOM gets battle-tested agent visualization for free

## Alternatives Considered

**Extend agentscope-studio (Node.js backend):** Rejected — Node.js backend inconsistent with
all other ATOM Python services. Auth, DB ORM, and JWT handling would need separate Node.js
libraries. Upstream merge would be high risk.

**Use agentscope-studio frontend, add FastAPI backend:** Rejected — agentscope-studio's
frontend is tightly coupled to its own server protocol. Grafting a FastAPI backend onto it
would require significant reverse-engineering.
