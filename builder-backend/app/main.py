"""ATOM Agent Platform — Builder Backend."""

from contextlib import asynccontextmanager

from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware
from app.routes import specs, agents, registry, studio, auth, deployments, tools, sessions, files, command_center, domains, compliance
from app.core.observability import setup
from app.core.seed import seed_tools


@asynccontextmanager
async def lifespan(app: FastAPI):
    seed_tools()
    yield


app = FastAPI(
    title="ATOM Agent Platform — Agent Builder",
    version="1.0.0",
    description="Validates, generates, compiles, and deploys agents.",
    lifespan=lifespan,
)

app.include_router(auth.router)
app.include_router(specs.router)
app.include_router(agents.router)
app.include_router(registry.router)
app.include_router(studio.router)
app.include_router(deployments.router)
app.include_router(tools.router)
app.include_router(sessions.router)
app.include_router(files.router)
app.include_router(command_center.router)
app.include_router(domains.router)
app.include_router(compliance.router)


@app.get("/health")
def health():
    return {"status": "ok", "service": "builder-backend"}


# setup() adds OTEL + AccessLog middleware (LIFO — they become inner layers).
# CORSMiddleware must be added LAST so it is the outermost layer and handles
# OPTIONS preflights before any other middleware can interfere.
setup(app, "builder-backend")

app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_methods=["*"],
    allow_headers=["*"],
    expose_headers=["*"],
)
