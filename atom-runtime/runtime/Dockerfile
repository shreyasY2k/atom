FROM python:3.11-slim

WORKDIR /app

# Copy source first so editable install creates correct .pth pointer
COPY pyproject.toml .
COPY src/ src/
RUN pip install --no-cache-dir -e .

EXPOSE 8090

CMD ["uvicorn", "atom_runtime.main:app", "--host", "0.0.0.0", "--port", "8090"]
