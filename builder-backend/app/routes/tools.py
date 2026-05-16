"""Routes: global tools registry — HTTP, Python, and MCP tools with auth."""

import uuid
from datetime import datetime, timezone
from typing import Any, Literal

from fastapi import APIRouter, HTTPException, Request
from pydantic import BaseModel

from app.core import registry_db, tool_executor

router = APIRouter(prefix="/tools", tags=["tools"])


# ---------------------------------------------------------------------------
# Auth config model
# ---------------------------------------------------------------------------

class AuthConfig(BaseModel):
    type: Literal["none", "api_key", "bearer", "basic", "oauth2"] = "none"
    # api_key
    header_name: str = "X-API-Key"
    key: str = ""
    in_: Literal["header", "query"] = "header"   # "in" is a Python keyword
    param_name: str = "api_key"
    # bearer
    token: str = ""
    # basic
    username: str = ""
    password: str = ""
    # oauth2
    grant_type: Literal["client_credentials", "authorization_code"] = "client_credentials"
    token_url: str = ""
    client_id: str = ""
    client_secret: str = ""
    scope: str = ""
    audience: str = ""

    def to_executor_dict(self) -> dict:
        """Serialize to the flat dict the executor expects."""
        d = self.model_dump()
        d["in"] = d.pop("in_")
        return d


# ---------------------------------------------------------------------------
# Tool body
# ---------------------------------------------------------------------------

class ToolBody(BaseModel):
    name: str
    display_name: str | None = None
    description: str = ""
    tool_type: Literal["http", "python", "mcp"] = "http"

    # HTTP
    endpoint: str | None = None
    method: str = "POST"

    # Python
    code: str | None = None

    # MCP
    mcp_server_url: str | None = None
    mcp_transport: Literal["sse", "stdio"] = "sse"
    mcp_tool_names: list[str] = []

    # Auth
    auth_config: AuthConfig = AuthConfig()

    # Schema
    input_schema: dict[str, Any] = {}
    output_schema: dict[str, Any] = {}
    tags: list[str] = []


class ExecuteBody(BaseModel):
    input: dict[str, Any] = {}


# ---------------------------------------------------------------------------
# Helpers
# ---------------------------------------------------------------------------

def _tool_from_body(body: ToolBody, actor: str, existing: dict | None = None) -> dict:
    now = datetime.now(timezone.utc).isoformat()
    base = existing or {}
    return {
        "tool_id": base.get("tool_id", str(uuid.uuid4())),
        "name": body.name,
        "display_name": body.display_name or body.name,
        "description": body.description,
        "scope": base.get("scope", "global"),
        "owner_agent": base.get("owner_agent"),
        "tool_type": body.tool_type,
        "endpoint": body.endpoint,
        "method": body.method,
        "code": body.code,
        "mcp_server_url": body.mcp_server_url,
        "mcp_transport": body.mcp_transport,
        "mcp_tool_names": body.mcp_tool_names,
        "auth_type": body.auth_config.type,
        "auth_config": body.auth_config.to_executor_dict(),
        "input_schema": body.input_schema,
        "output_schema": body.output_schema,
        "tags": body.tags,
        "created_by": base.get("created_by", actor),
        "created_at": base.get("created_at", now),
        "updated_at": now,
    }


# ---------------------------------------------------------------------------
# GET /tools
# ---------------------------------------------------------------------------

@router.get("")
def list_global_tools():
    return {"tools": registry_db.list_tools(scope="global")}


# ---------------------------------------------------------------------------
# POST /tools
# ---------------------------------------------------------------------------

@router.post("")
def create_global_tool(body: ToolBody, request: Request):
    actor = request.headers.get("X-Atom-Actor", "user:default@atom.io")
    tool = _tool_from_body(body, actor)
    registry_db.upsert_tool(tool)
    return registry_db.get_tool(tool["tool_id"])


# ---------------------------------------------------------------------------
# GET /tools/{tool_id}
# ---------------------------------------------------------------------------

@router.get("/{tool_id}")
def get_tool(tool_id: str):
    tool = registry_db.get_tool(tool_id)
    if not tool:
        raise HTTPException(404, f"Tool '{tool_id}' not found")
    return tool


# ---------------------------------------------------------------------------
# PUT /tools/{tool_id}
# ---------------------------------------------------------------------------

@router.put("/{tool_id}")
def update_tool(tool_id: str, body: ToolBody, request: Request):
    existing = registry_db.get_tool(tool_id)
    if not existing:
        raise HTTPException(404, f"Tool '{tool_id}' not found")
    actor = request.headers.get("X-Atom-Actor", "user:default@atom.io")
    updated = _tool_from_body(body, actor, existing)
    registry_db.upsert_tool(updated)
    return registry_db.get_tool(tool_id)


# ---------------------------------------------------------------------------
# DELETE /tools/{tool_id}
# ---------------------------------------------------------------------------

@router.delete("/{tool_id}")
def delete_tool(tool_id: str):
    if not registry_db.get_tool(tool_id):
        raise HTTPException(404, f"Tool '{tool_id}' not found")
    registry_db.delete_tool(tool_id)
    return {"deleted": tool_id}


# ---------------------------------------------------------------------------
# POST /tools/{tool_id}/execute
# ---------------------------------------------------------------------------

@router.post("/{tool_id}/execute")
async def execute_tool(tool_id: str, body: ExecuteBody, request: Request):
    """Execute a tool directly (for testing, agent invocation, etc.)."""
    tool = registry_db.get_tool(tool_id)
    if not tool:
        raise HTTPException(404, f"Tool '{tool_id}' not found")
    try:
        result = await tool_executor.execute(tool, body.input)
        return {"tool_id": tool_id, "tool_name": tool["name"], "result": result}
    except TimeoutError as e:
        raise HTTPException(408, str(e))
    except ValueError as e:
        raise HTTPException(422, str(e))
    except Exception as e:
        raise HTTPException(502, f"Tool execution failed: {e}")


# ---------------------------------------------------------------------------
# POST /tools/{tool_id}/validate-code  (Python tools only)
# ---------------------------------------------------------------------------

@router.post("/{tool_id}/validate-code")
def validate_python_code(tool_id: str):
    """Syntax-check a Python tool's code without executing it."""
    tool = registry_db.get_tool(tool_id)
    if not tool:
        raise HTTPException(404)
    if tool.get("tool_type") != "python":
        raise HTTPException(422, "Only python-type tools have code to validate")
    code = tool.get("code") or ""
    try:
        import ast
        ast.parse(code)
        has_run = "def run(" in code
        return {"valid": True, "has_run_function": has_run}
    except SyntaxError as e:
        return {"valid": False, "error": str(e)}
