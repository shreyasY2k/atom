"""
atom-runtime entry point.

Run locally:
  uvicorn atom_runtime.main:app --reload --port 8090
"""

from .deploy_webhook import app  # re-export the FastAPI app

__all__ = ["app"]
