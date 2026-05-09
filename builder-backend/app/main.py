"""ATOM Agent Platform — Builder Backend."""

from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware
from app.routes import specs, agents, registry, studio
from app.core.observability import setup

app = FastAPI(
    title="ATOM Agent Platform — Agent Builder",
    version="1.0.0",
    description="Validates, generates, compiles, and deploys BFSI agents.",
)

app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_methods=["*"],
    allow_headers=["*"],
)

app.include_router(specs.router)
app.include_router(agents.router)
app.include_router(registry.router)
app.include_router(studio.router)


@app.get("/health")
def health():
    return {"status": "ok", "service": "builder-backend"}


setup(app, "builder-backend")
