FROM python:3.12-slim

WORKDIR /app

# Install atom-sdk (ATOM's agentscope fork) from local copy.
# atom deploy copies the sdk into .atom-sdk/ before building.
COPY .atom-sdk /tmp/atom-sdk
RUN pip install --no-cache-dir /tmp/atom-sdk && rm -rf /tmp/atom-sdk

COPY requirements.txt .
RUN pip install --no-cache-dir -r requirements.txt

COPY . .

EXPOSE 8080

HEALTHCHECK --interval=10s --timeout=3s --retries=3 \
  CMD python -c "import urllib.request; urllib.request.urlopen('http://localhost:8080/healthz')"

CMD ["uvicorn", "server:app", "--host", "0.0.0.0", "--port", "8080"]
