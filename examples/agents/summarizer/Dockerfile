FROM python:3.11-slim
WORKDIR /app

RUN apt-get update && apt-get install -y --no-install-recommends git \
    && rm -rf /var/lib/apt/lists/*

COPY requirements.txt .

RUN --mount=type=secret,id=github_token,required=false \
    TOKEN=$(cat /run/secrets/github_token 2>/dev/null || echo "") && \
    if [ -n "$TOKEN" ]; then \
      git config --global url."https://${TOKEN}@github.com/".insteadOf "https://github.com/"; \
    fi && \
    pip install --no-cache-dir -r requirements.txt && \
    rm -f /root/.gitconfig

COPY . .
EXPOSE 8080

HEALTHCHECK --interval=10s --timeout=3s --retries=3 \
  CMD python -c "import urllib.request; urllib.request.urlopen('http://localhost:8080/healthz')"

CMD ["uvicorn", "server:app", "--host", "0.0.0.0", "--port", "8080"]
