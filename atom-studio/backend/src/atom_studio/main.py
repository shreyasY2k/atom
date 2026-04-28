"""
atom-studio backend — FastAPI management portal for ATOM.
Run locally:
  uvicorn atom_studio.main:app --reload --port 3001
"""

from contextlib import asynccontextmanager

from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware

from .agents.router import global_router as agents_global_router
from .agents.router import router as agents_router
from .auth.router import router as auth_router
from .auth.users_router import router as users_router
from .database import init_pool
from .domains.router import router as domains_router
from .skills.router import router as skills_router
from .tools.router import router as tools_router


@asynccontextmanager
async def lifespan(app: FastAPI):
    await init_pool()
    yield


app = FastAPI(title="ATOM Studio API", version="0.1.0", lifespan=lifespan)

app.add_middleware(
    CORSMiddleware,
    allow_origins=["http://localhost:3000", "http://localhost:5173"],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

app.include_router(auth_router, prefix="/api/auth", tags=["auth"])
app.include_router(users_router, prefix="/api/users", tags=["users"])
app.include_router(domains_router, prefix="/api/domains", tags=["domains"])
app.include_router(agents_global_router, prefix="/api/agents", tags=["agents"])
app.include_router(agents_router, prefix="/api/domains/{domain_id}/agents", tags=["agents"])
app.include_router(tools_router, prefix="/api/tools", tags=["tools"])
app.include_router(skills_router, prefix="/api/skills", tags=["skills"])


@app.get("/healthz")
async def health():
    return {"status": "ok"}
