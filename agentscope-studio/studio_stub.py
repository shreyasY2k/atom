"""
Minimal agentscope-studio stub server.

Accepts the tRPC calls that agentscope.init(studio_url=...) sends and stores
runs + messages in memory. Serves a simple HTML trace viewer at /.

Endpoints expected by agentscope library:
  POST /trpc/registerRun   — agent registers a new conversation run
  POST /trpc/pushMessage   — agent pushes a message to a run
  GET  /                   — minimal web UI listing stored runs
"""

import json
import logging
from collections import defaultdict
from datetime import datetime, timezone

from fastapi import FastAPI, Request
from fastapi.responses import HTMLResponse

logging.basicConfig(level=logging.INFO, format="%(asctime)s %(levelname)s %(message)s")
log = logging.getLogger("agentscope-studio")

app = FastAPI(title="agentscope-studio-stub", version="1.0.0")

_runs: dict[str, dict] = {}           # run_id → metadata
_messages: dict[str, list] = defaultdict(list)  # run_id → [messages]


@app.post("/trpc/registerRun")
async def register_run(request: Request):
    try:
        body = await request.json()
    except Exception:
        body = {}
    run_id = body.get("run_id") or body.get("id") or f"run-{len(_runs)+1}"
    _runs[run_id] = {
        "id": run_id,
        "name": body.get("name", run_id),
        "timestamp": datetime.now(timezone.utc).isoformat(),
        "meta": body,
    }
    log.info("registerRun: %s", run_id)
    return {"success": True, "run_id": run_id}


@app.post("/trpc/pushMessage")
async def push_message(request: Request):
    try:
        body = await request.json()
    except Exception:
        body = {}
    run_id = body.get("run_id", "unknown")
    _messages[run_id].append({
        "timestamp": datetime.now(timezone.utc).isoformat(),
        **body,
    })
    log.info("pushMessage run=%s role=%s", run_id, body.get("role", "?"))
    return {"success": True}


@app.post("/v1/traces")
async def otel_traces(request: Request):
    return {"success": True}


@app.get("/", response_class=HTMLResponse)
async def index():
    rows = ""
    for run_id, meta in _runs.items():
        msgs = _messages.get(run_id, [])
        rows += f"""
        <tr>
          <td style="font-family:monospace;font-size:12px">{run_id[:20]}</td>
          <td>{meta.get('name','')}</td>
          <td>{meta.get('timestamp','')[:19]}</td>
          <td>{len(msgs)}</td>
          <td><a href="/run/{run_id}">view</a></td>
        </tr>"""
    if not rows:
        rows = '<tr><td colspan="5" style="color:#888;text-align:center">No runs yet. Agents connect via agentscope.init(studio_url="http://localhost:3002")</td></tr>'

    return f"""<!DOCTYPE html>
<html>
<head><title>agentscope-studio</title>
<style>
  body{{font-family:system-ui,sans-serif;margin:2rem;background:#0f172a;color:#e2e8f0}}
  h1{{font-size:1.5rem;margin-bottom:1rem}}
  table{{width:100%;border-collapse:collapse}}
  th,td{{text-align:left;padding:.5rem .75rem;border-bottom:1px solid #1e293b}}
  th{{color:#94a3b8;font-size:.75rem;text-transform:uppercase}}
  a{{color:#60a5fa;text-decoration:none}}
</style>
</head>
<body>
<h1>agentscope-studio <span style="font-size:.8rem;color:#94a3b8">stub</span></h1>
<table>
  <thead><tr><th>Run ID</th><th>Name</th><th>Started</th><th>Messages</th><th></th></tr></thead>
  <tbody>{rows}</tbody>
</table>
</body>
</html>"""


@app.get("/run/{run_id}", response_class=HTMLResponse)
async def run_detail(run_id: str):
    msgs = _messages.get(run_id, [])
    rows = ""
    for m in msgs:
        rows += f"""<tr>
          <td style="font-size:11px;color:#64748b">{m.get('timestamp','')[:19]}</td>
          <td><b>{m.get('role','')}</b></td>
          <td><pre style="margin:0;white-space:pre-wrap">{m.get('content','')}</pre></td>
        </tr>"""
    return f"""<!DOCTYPE html>
<html>
<head><title>{run_id}</title>
<style>
  body{{font-family:system-ui,sans-serif;margin:2rem;background:#0f172a;color:#e2e8f0}}
  a{{color:#60a5fa}} pre{{font-family:monospace;font-size:12px}}
  table{{width:100%;border-collapse:collapse}}
  td{{padding:.5rem;border-bottom:1px solid #1e293b;vertical-align:top}}
</style>
</head>
<body>
<p><a href="/">&larr; Back</a></p>
<h2 style="font-size:1.1rem">{run_id}</h2>
<table><tbody>{rows or '<tr><td colspan=3 style="color:#888">No messages</td></tr>'}</tbody></table>
</body>
</html>"""


if __name__ == "__main__":
    import uvicorn
    uvicorn.run(app, host="0.0.0.0", port=3002)
