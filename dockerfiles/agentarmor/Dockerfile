# Build AgentArmor from source.
# Runs as a guardrail proxy server on port 8400.

FROM python:3.11-slim

ARG AGENTARMOR_GIT_REF=main

RUN apt-get update && apt-get install -y --no-install-recommends \
    git build-essential curl ca-certificates \
    && rm -rf /var/lib/apt/lists/*

WORKDIR /app

RUN git clone --depth 1 \
    https://github.com/Agastya910/agentarmor.git /src

RUN pip install --no-cache-dir --upgrade pip setuptools wheel && \
    pip install --no-cache-dir -e "/src[all]"

# Default config — overridden via volume mount in compose.
COPY config.yaml /app/config.yaml

EXPOSE 8400

HEALTHCHECK --interval=10s --timeout=5s --retries=5 --start-period=20s \
    CMD python3 -c "import socket; s=socket.socket(); s.settimeout(2); s.connect(('localhost',8400)); s.close()" || exit 1

CMD ["agentarmor", "serve", "--host", "0.0.0.0", "--port", "8400"]
