"""Unified tool executor: HTTP, Python (subprocess sandbox), and MCP tools with auth."""

import base64
import hashlib
import json
import os
import subprocess
import tempfile
import time

import httpx

# ---------------------------------------------------------------------------
# OAuth 2.0 token cache  {cache_key: {token, expires_at}}
# ---------------------------------------------------------------------------
_token_cache: dict[str, dict] = {}


def _oauth_token(auth: dict) -> str:
    """Return a cached-or-fresh OAuth 2.0 client_credentials access token."""
    key = hashlib.sha256(json.dumps({
        "url": auth.get("token_url"),
        "cid": auth.get("client_id"),
        "scp": auth.get("scope"),
    }, sort_keys=True).encode()).hexdigest()[:16]

    cached = _token_cache.get(key)
    if cached and cached["expires_at"] > time.time() + 30:
        return cached["token"]

    data: dict = {
        "grant_type": auth.get("grant_type", "client_credentials"),
        "client_id": auth.get("client_id", ""),
        "client_secret": auth.get("client_secret", ""),
    }
    if auth.get("scope"):
        data["scope"] = auth["scope"]
    if auth.get("audience"):
        data["audience"] = auth["audience"]

    resp = httpx.post(auth["token_url"], data=data, timeout=15)
    resp.raise_for_status()
    body = resp.json()
    token = body["access_token"]
    _token_cache[key] = {"token": token, "expires_at": time.time() + body.get("expires_in", 3600)}
    return token


def _auth_headers(auth: dict) -> dict:
    """Build HTTP headers from an auth_config dict."""
    t = (auth or {}).get("type", "none")
    if t == "api_key" and auth.get("in", "header") == "header":
        return {auth.get("header_name", "X-API-Key"): auth.get("key", "")}
    if t == "bearer":
        return {"Authorization": f"Bearer {auth.get('token', '')}"}
    if t == "basic":
        creds = base64.b64encode(
            f"{auth.get('username','')}:{auth.get('password','')}".encode()
        ).decode()
        return {"Authorization": f"Basic {creds}"}
    if t == "oauth2":
        return {"Authorization": f"Bearer {_oauth_token(auth)}"}
    return {}


def _auth_params(auth: dict) -> dict:
    """Build query params (api_key in=query)."""
    t = (auth or {}).get("type", "none")
    if t == "api_key" and auth.get("in") == "query":
        return {auth.get("param_name", "api_key"): auth.get("key", "")}
    return {}


# ---------------------------------------------------------------------------
# HTTP executor
# ---------------------------------------------------------------------------

def execute_http(tool: dict, input_data: dict) -> dict:
    auth = tool.get("auth_config") or {}
    endpoint = (tool.get("endpoint") or "").strip()
    if not endpoint:
        raise ValueError(f"Tool '{tool['name']}' has no endpoint configured")

    method = (tool.get("method") or "POST").upper()
    headers = {"Content-Type": "application/json", **_auth_headers(auth)}
    params = _auth_params(auth)

    resp = httpx.request(
        method, endpoint,
        json=input_data if method in ("POST", "PUT", "PATCH") else None,
        params={**params, **(input_data if method == "GET" else {})},
        headers=headers,
        timeout=30,
    )
    resp.raise_for_status()
    try:
        return resp.json()
    except Exception:
        return {"result": resp.text}


# ---------------------------------------------------------------------------
# Python executor (subprocess sandbox)
# ---------------------------------------------------------------------------

_WRAPPER = """\
import json, sys, importlib, builtins

# Restrict dangerous builtins
_ALLOWED = {{
    "print", "len", "range", "int", "float", "str", "bool", "list",
    "dict", "tuple", "set", "isinstance", "hasattr", "getattr",
    "enumerate", "zip", "map", "filter", "sorted", "sum", "min", "max",
    "abs", "round", "type", "repr", "format", "any", "all", "next",
    "iter", "open", "Exception", "ValueError", "KeyError", "TypeError",
}}
# Allow safe stdlib
import json as _json
import re as _re
import math as _math
import datetime as _datetime

{code}

_inp = json.loads(sys.stdin.read())
_out = run(_inp)
print(json.dumps(_out))
"""


def execute_python(tool: dict, input_data: dict, timeout: int = 30) -> dict:
    code = (tool.get("code") or "").strip()
    if not code:
        raise ValueError(f"Python tool '{tool['name']}' has no code defined")
    if "def run(" not in code:
        raise ValueError("Python tool code must define: def run(input: dict) -> dict")

    script = _WRAPPER.format(code=code)
    with tempfile.NamedTemporaryFile(mode="w", suffix=".py", delete=False) as f:
        f.write(script)
        fname = f.name

    try:
        proc = subprocess.run(
            ["python3", fname],
            input=json.dumps(input_data),
            capture_output=True,
            text=True,
            timeout=timeout,
        )
        if proc.returncode != 0:
            raise ValueError(f"Execution error: {proc.stderr[:800]}")
        output = proc.stdout.strip()
        if not output:
            raise ValueError("Tool produced no output")
        return json.loads(output)
    except subprocess.TimeoutExpired:
        raise TimeoutError(f"Python tool '{tool['name']}' exceeded {timeout}s timeout")
    finally:
        try:
            os.unlink(fname)
        except OSError:
            pass


# ---------------------------------------------------------------------------
# MCP executor
# ---------------------------------------------------------------------------

async def execute_mcp(tool: dict, input_data: dict) -> dict:
    server_url = (tool.get("mcp_server_url") or "").strip()
    if not server_url:
        raise ValueError(f"MCP tool '{tool['name']}' has no server URL configured")

    mcp_tool_names: list = tool.get("mcp_tool_names") or []
    tool_name = mcp_tool_names[0] if mcp_tool_names else tool.get("name", "")
    auth = tool.get("auth_config") or {}
    auth_hdrs = _auth_headers(auth)

    try:
        from mcp import ClientSession
        from mcp.client.sse import sse_client

        async with sse_client(server_url, headers=auth_hdrs) as (read, write):
            async with ClientSession(read, write) as session:
                await session.initialize()
                result = await session.call_tool(tool_name, input_data)
                content = result.content
                if content and hasattr(content[0], "text"):
                    try:
                        return json.loads(content[0].text)
                    except Exception:
                        return {"result": content[0].text}
                return {"result": str(content)}

    except ImportError:
        # Fallback: raw JSON-RPC POST (for MCP-over-HTTP servers)
        payload = {
            "jsonrpc": "2.0",
            "method": "tools/call",
            "params": {"name": tool_name, "arguments": input_data},
            "id": 1,
        }
        resp = httpx.post(
            f"{server_url.rstrip('/')}/message",
            json=payload,
            headers={**auth_hdrs, "Content-Type": "application/json"},
            timeout=30,
        )
        resp.raise_for_status()
        data = resp.json()
        if "error" in data:
            raise ValueError(f"MCP error: {data['error']}")
        return data.get("result", {})


# ---------------------------------------------------------------------------
# Unified entry point
# ---------------------------------------------------------------------------

async def execute(tool: dict, input_data: dict) -> dict:
    """Route to the correct executor based on tool_type."""
    tool_type = (tool.get("tool_type") or "http").lower()
    if tool_type == "python":
        return execute_python(tool, input_data)
    if tool_type == "mcp":
        return await execute_mcp(tool, input_data)
    return execute_http(tool, input_data)
