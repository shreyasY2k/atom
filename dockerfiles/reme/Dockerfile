# Build ReMe (Memory Management Kit for Agents) from source.
# Pin via REME_GIT_REF (default: v0.3.1.8).

FROM python:3.11-slim

ARG REME_GIT_REF=v0.3.1.8

RUN apt-get update && apt-get install -y --no-install-recommends \
    git \
    build-essential \
    curl \
    ca-certificates \
    && rm -rf /var/lib/apt/lists/*

WORKDIR /src
RUN git clone --depth 1 --branch ${REME_GIT_REF} \
    https://github.com/agentscope-ai/ReMe.git . || \
    git clone --depth 1 https://github.com/agentscope-ai/ReMe.git .

RUN pip install --no-cache-dir --upgrade pip setuptools wheel
RUN pip install --no-cache-dir -e .
RUN pip install --no-cache-dir flowllm

WORKDIR /app

ENV PYTHONUNBUFFERED=1
EXPOSE 8002

# ReMe service entry. Verify the actual CLI in the cloned repo —
# may be `reme service --port 8002` or `python -m reme.service`.
CMD ["reme", "service", "--config", "/app/config.yaml", "--host", "0.0.0.0", "--port", "8002"]
