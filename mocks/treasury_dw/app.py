from observability import setup
from fastapi import FastAPI
app = FastAPI(title="Treasury Data Warehouse", version="0.1.0")
@app.get("/health")
def health(): return {"status": "ok"}
@app.get("/positions")
def positions():
    return {"as_of": "2026-05-08", "total_assets_usd": 4_820_000_000,
            "hqla_l1_usd": 1_240_000_000, "hqla_l2_usd": 410_000_000,
            "outflows_30d_usd": 980_000_000}
@app.get("/securities")
def securities():
    return {"holdings": [
        {"cusip": "912828ZQ6", "qty": 50000000, "type": "UST_2Y"},
        {"cusip": "912810RW0", "qty": 30000000, "type": "UST_10Y"},
    ]}

setup(app, "treasury-dw")
