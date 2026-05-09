FROM python:3.11-slim
WORKDIR /app
COPY requirements.txt .
RUN pip install --no-cache-dir -r requirements.txt
COPY app.py .
COPY observability.py .
EXPOSE 8102
CMD ["uvicorn", "app:app", "--host", "0.0.0.0", "--port", "8102"]
