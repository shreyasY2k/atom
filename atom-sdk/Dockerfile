FROM python:3.11-slim
WORKDIR /app

RUN apt-get update && apt-get install -y --no-install-recommends git && \
    rm -rf /var/lib/apt/lists/*

# Install atom-sdk and its core dependencies
COPY . /atom-sdk-src
RUN pip install --no-cache-dir /atom-sdk-src

# Verify install
RUN python -c "import agentscope; print('atom-sdk OK')"
