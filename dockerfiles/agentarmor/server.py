"""
Custom AgentArmor proxy server.

Works around a FastAPI 0.136 + Pydantic v2 incompatibility where
`request: Request` inside lazy-imported closures is treated as a query
parameter instead of the raw HTTP request object. We define proper Pydantic
request models for each endpoint instead.
"""

from __future__ import annotations
import io
import sys
from pathlib import Path

sys.path.insert(0, "/src/src")

# The L1 ingestion layer emits print()-to-stdout messages at import time when
# optional ML sub-detectors (D3=transformers, D4=torch) are not installed.
# Capture stdout during the agentarmor import, filter those lines, then
# re-emit anything else so real startup output is not silently swallowed.
_stdout_cap = io.StringIO()
_real_stdout = sys.stdout
sys.stdout = _stdout_cap

from typing import Any, Dict, Optional

import uvicorn
from fastapi import FastAPI
from fastapi.responses import JSONResponse
from pydantic import BaseModel

from agentarmor.core.config import ArmorConfig
from agentarmor.core.types import AgentEvent
from agentarmor.pipeline import AgentArmor

# Restore stdout; re-emit any captured lines that are NOT optional-dep skips.
sys.stdout = _real_stdout
_skip_tokens = ("skipped: No module named",)
for _line in _stdout_cap.getvalue().splitlines():
    if not any(tok in _line for tok in _skip_tokens):
        print(_line)

config_path = Path("/app/config.yaml")
config = ArmorConfig.from_yaml(config_path) if config_path.exists() else ArmorConfig()
armor = AgentArmor(config=config)

app = FastAPI(title="AgentArmor Proxy", version="0.1.0")


def _layer_dict(lr) -> dict:
    return {
        "layer": lr.layer,
        "verdict": lr.verdict.value if hasattr(lr.verdict, "value") else lr.verdict,
        "threat_level": lr.threat_level.value if hasattr(lr.threat_level, "value") else str(lr.threat_level),
        "message": lr.message or "",
    }


def _result_body(result, status_from_safe: bool = False) -> tuple[dict, int]:
    blocked_layers = [lr for lr in result.layer_results if lr.verdict.value != "allow"]
    blocked_by = result.blocked_by or (blocked_layers[0].layer if blocked_layers else None)
    body = {
        "verdict": result.final_verdict.value,
        "is_safe": result.is_safe,
        "threat_level": result.final_threat_level.value,
        "blocked_by": blocked_by,
        "processing_time_ms": round(result.total_processing_time_ms, 2),
        "layers": [_layer_dict(lr) for lr in result.layer_results],
    }
    code = 200 if (not status_from_safe or result.is_safe) else 403
    return body, code


# ── Pydantic request models ──────────────────────────────────────────────────

class ScanInputRequest(BaseModel):
    text: str
    agent_id: str = "default"
    context: Dict[str, Any] = {}

class ScanOutputRequest(BaseModel):
    text: str
    agent_id: str = "default"

class InterceptRequest(BaseModel):
    action: str
    params: Dict[str, Any] = {}
    agent_id: str = "default"
    context: Dict[str, Any] = {}
    input_data: Optional[Any] = None
    output_data: Optional[Any] = None


# ── Endpoints ────────────────────────────────────────────────────────────────

@app.get("/health")
async def health():
    return {"status": "healthy", "version": "0.1.0"}


@app.post("/v1/scan/input")
async def scan_input(body: ScanInputRequest):
    event = AgentEvent(
        agent_id=body.agent_id,
        event_type="scan",
        action="scan.input",
        input_data=body.text,
        context=body.context,
    )
    result = await armor.process(event)
    data, code = _result_body(result)
    return JSONResponse(content=data, status_code=code)


@app.post("/v1/scan/output")
async def scan_output(body: ScanOutputRequest):
    event = AgentEvent(
        agent_id=body.agent_id,
        event_type="scan",
        action="scan.output",
        output_data=body.text,
    )
    result = await armor.process(event)
    data, code = _result_body(result)
    return JSONResponse(content=data, status_code=code)


@app.post("/v1/intercept")
async def intercept(body: InterceptRequest):
    result = await armor.intercept(
        action=body.action,
        params=body.params,
        agent_id=body.agent_id,
        context=body.context,
        input_data=body.input_data,
        output_data=body.output_data,
    )
    data, code = _result_body(result, status_from_safe=True)
    return JSONResponse(content=data, status_code=code)


if __name__ == "__main__":
    uvicorn.run(app, host="0.0.0.0", port=8400, log_level="info")
