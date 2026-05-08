# Build AgentScope Runtime sandbox server from source.
# Pin via AGENTSCOPE_RUNTIME_GIT_REF (default: main).
# We build the base sandbox; the GUI/browser/filesystem variants are heavier
# and not needed for our two BFSI use cases.

FROM python:3.11-slim

ARG AGENTSCOPE_RUNTIME_GIT_REF=main

RUN apt-get update && apt-get install -y --no-install-recommends \
    git \
    build-essential \
    curl \
    ca-certificates \
    docker.io \
    && rm -rf /var/lib/apt/lists/*

WORKDIR /src
RUN git clone --depth 1 --branch ${AGENTSCOPE_RUNTIME_GIT_REF} \
    https://github.com/agentscope-ai/agentscope-runtime.git .

# Init submodules if present (the repo uses git submodules per docs)
RUN git submodule update --init --recursive || true

RUN pip install --no-cache-dir --upgrade pip setuptools wheel
RUN pip install --no-cache-dir -e .

ENV PYTHONUNBUFFERED=1
ENV CONTAINER_DEPLOYMENT=docker
ENV HOST=0.0.0.0

EXPOSE 8000

CMD ["runtime-sandbox-server"]
