"""
atom-llm entry point.

Starts the LiteLLM proxy server and mounts ATOM-specific extension routers.
No source patching — extensions are registered via FastAPI include_router()
before uvicorn starts, so all routes are available from the first request.

Config loading: LiteLLM reads CONFIG_FILE_PATH (or WORKER_CONFIG) env var
during its lifespan startup event. Set CONFIG_FILE_PATH to the YAML path.
"""

import os

from dotenv import load_dotenv

load_dotenv()

# Must be set before importing the proxy app so the lifespan startup event
# sees it when it calls proxy_config.load_config().
os.environ.setdefault("CONFIG_FILE_PATH", "/app/config.dev.yaml")

from litellm.proxy.proxy_server import app  # noqa: E402

from atom_extensions.provision import router as provision_router  # noqa: E402
from atom_extensions.tools_skills import atom_tools_router  # noqa: E402

# Mount ATOM routers — must happen before uvicorn starts.
app.include_router(provision_router)
app.include_router(atom_tools_router)

# Register Kafka audit callback if KAFKA_BROKERS is configured.
if os.environ.get("KAFKA_BROKERS"):
    import litellm
    from atom_extensions.kafka_audit import KafkaAuditLogger

    litellm.callbacks.append(KafkaAuditLogger())

# Register OTEL tracing callback if OTEL_EXPORTER_OTLP_ENDPOINT is configured.
if os.environ.get("OTEL_EXPORTER_OTLP_ENDPOINT"):
    import litellm  # noqa: F811 — safe reimport
    from atom_extensions.otel import OTELLogger

    litellm.callbacks.append(OTELLogger())

if __name__ == "__main__":
    import uvicorn

    uvicorn.run(app, host="0.0.0.0", port=int(os.environ.get("PORT", "4000")))
