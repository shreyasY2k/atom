FROM python:3.11-slim
WORKDIR /app

# git is required to pip-install atom-platform-sdk from GitHub
RUN apt-get update && apt-get install -y --no-install-recommends git \
    && rm -rf /var/lib/apt/lists/*

# Install all dependencies — includes atom-platform-sdk declared in requirements.txt
COPY requirements.txt .
RUN pip install --no-cache-dir -r requirements.txt

COPY . .
EXPOSE 8080

HEALTHCHECK --interval=10s --timeout=3s --retries=3 \
  CMD python -c "import urllib.request; urllib.request.urlopen('http://localhost:8080/healthz')"

CMD ["uvicorn", "server:app", "--host", "0.0.0.0", "--port", "8080"]
