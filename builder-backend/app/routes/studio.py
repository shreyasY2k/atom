"""Proxy routes for AgentScope Studio tRPC API.

The browser cannot call Studio (port 3000) directly due to CORS restrictions.
These endpoints forward requests to Studio server-to-server and return the result.
"""

import os
import httpx
from fastapi import APIRouter, HTTPException, Request

router = APIRouter(prefix="/studio", tags=["studio"])

STUDIO_URL = os.environ.get("STUDIO_URL", "http://studio:3000")


@router.get("/trpc/{procedure}")
async def proxy_studio_query(procedure: str, request: Request):
    """Forward a tRPC query to Studio and return the result."""
    input_param = request.query_params.get("input", "")
    try:
        url = f"{STUDIO_URL}/trpc/{procedure}"
        params = {}
        if input_param:
            params["input"] = input_param
        async with httpx.AsyncClient(timeout=10) as client:
            r = await client.get(url, params=params)
        return r.json()
    except httpx.ConnectError:
        raise HTTPException(503, "Studio is not reachable. Is it running on port 3000?")
    except Exception as e:
        raise HTTPException(502, f"Studio proxy error: {e}")


@router.post("/trpc/{procedure}")
async def proxy_studio_mutation(procedure: str, request: Request):
    """Forward a tRPC mutation to Studio and return the result."""
    try:
        body = await request.json()
        url = f"{STUDIO_URL}/trpc/{procedure}"
        async with httpx.AsyncClient(timeout=10) as client:
            r = await client.post(url, json=body, headers={"Content-Type": "application/json"})
        return r.json()
    except httpx.ConnectError:
        raise HTTPException(503, "Studio is not reachable.")
    except Exception as e:
        raise HTTPException(502, f"Studio proxy error: {e}")
