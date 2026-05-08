from fastapi import FastAPI

app = FastAPI(title="Workflow Backend", version="0.0.1-stub")


@app.get("/health")
def health():
    return {"status": "ok", "service": "workflow-backend"}
