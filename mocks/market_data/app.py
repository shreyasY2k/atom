from observability import setup
from fastapi import FastAPI
app = FastAPI(title="Market Data", version="0.1.0")
@app.get("/health")
def health(): return {"status": "ok"}
@app.get("/rates")
def rates():
    return {"as_of": "2026-05-08", "sofr": 4.31, "fed_funds": 4.50,
            "ust_2y": 4.18, "ust_10y": 4.62}
@app.get("/fx")
def fx():
    return {"as_of": "2026-05-08", "EURUSD": 1.082, "USDJPY": 152.40, "GBPUSD": 1.265}

setup(app, "market-data")
