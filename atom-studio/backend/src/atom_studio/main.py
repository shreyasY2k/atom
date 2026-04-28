"""
atom-studio backend — FastAPI management portal for ATOM.

Implements (across SESSION-07, 08, 09):
  - JWT authentication (human users)
  - Domain and agent management
  - Agent token provisioning (one-time RS256 JWT issuance)
  - HITL decision queue with WebSocket real-time push
  - Deployment approval workflow
  - Audit log viewer

All endpoints are async. Postgres via asyncpg.
WebSocket for HITL real-time notifications.

Run locally:
  uvicorn atom_studio.main:app --reload --port 3001

Or via docker-compose / k8s (see infra/).
"""

# TODO: implement in SESSION-07
# from fastapi import FastAPI
# from .auth.router import router as auth_router
# from .domains.router import router as domains_router
# ...
raise NotImplementedError("Implement in SESSION-07 — see sessions/SESSION-07.md")
