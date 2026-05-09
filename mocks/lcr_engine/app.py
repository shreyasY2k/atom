from observability import setup
from fastapi import FastAPI
app = FastAPI(title="LCR Engine", version="0.1.0")
@app.get("/health")
def health(): return {"status": "ok"}
@app.post("/calculate")
def calculate(payload: dict):
    hqla = payload.get("hqla_total", 1_650_000_000)
    outflows = payload.get("outflows_30d", 980_000_000)
    ratio = hqla / outflows if outflows else 0
    return {"lcr_ratio": round(ratio, 3), "regulatory_minimum": 1.0,
            "status": "PASS" if ratio >= 1.0 else "FAIL"}

setup(app, "lcr-engine")
