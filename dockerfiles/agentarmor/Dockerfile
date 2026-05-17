# Build AgentArmor from source.
# Runs as a guardrail proxy server on port 8400.
#
# Note: a conflicting PyPI package named "agentarmor" exists and is pulled in
# as a transitive dependency of the [all] extras. We uninstall it after the
# source install so that "import agentarmor" always resolves to the source tree.
# The proxy is started via uvicorn directly to avoid the CLI entry-point issue.

FROM python:3.11-slim

RUN apt-get update && apt-get install -y --no-install-recommends \
    git build-essential curl ca-certificates \
    && rm -rf /var/lib/apt/lists/*

WORKDIR /app

RUN git clone --depth 1 \
    https://github.com/Agastya910/agentarmor.git /src

RUN pip install --no-cache-dir --upgrade pip setuptools wheel && \
    pip install --no-cache-dir -e "/src[all]" && \
    # Remove the conflicting PyPI "agentarmor" package that shadows the source
    pip uninstall -y agentarmor || true

# Optional: install CPU-only PyTorch + transformers to enable L1 D3/D4
# ML-based injection detection sub-layers.  Off by default — adds ~900 MB
# and enables HuggingFace-based detectors that may over-fire on
# domain-specific language.  Enable with:
#   docker compose build --build-arg INSTALL_ML_DEPS=true agentarmor
ARG INSTALL_ML_DEPS=false
RUN if [ "$INSTALL_ML_DEPS" = "true" ]; then \
    pip install --no-cache-dir torch --index-url https://download.pytorch.org/whl/cpu && \
    pip install --no-cache-dir transformers; \
fi

# Our custom server (works around FastAPI 0.136 + Pydantic v2 lazy-import bug
# in the upstream proxy). Copied into the image; the volume-mounted config.yaml
# is loaded at runtime.
COPY server.py /app/server.py

# Default config — overridden via volume mount in compose.
COPY config.yaml /app/config.yaml

EXPOSE 8400

HEALTHCHECK --interval=10s --timeout=5s --retries=5 --start-period=20s \
    CMD python3 -c "import socket; s=socket.socket(); s.settimeout(2); s.connect(('localhost',8400)); s.close()" || exit 1

CMD ["python3", "/app/server.py"]
