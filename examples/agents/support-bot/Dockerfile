FROM python:3.12-slim
WORKDIR /app

# atom-sdk is copied to .atom-sdk/ by the provision script before docker build
COPY .atom-sdk /tmp/atom-sdk
RUN pip install --no-cache-dir /tmp/atom-sdk && rm -rf /tmp/atom-sdk

COPY requirements.txt .
RUN pip install --no-cache-dir -r requirements.txt

COPY . .
EXPOSE 8080

HEALTHCHECK --interval=10s --timeout=3s --retries=3 \
  CMD python -c "import urllib.request; urllib.request.urlopen('http://localhost:8080/healthz')"

CMD ["uvicorn", "server:app", "--host", "0.0.0.0", "--port", "8080"]
