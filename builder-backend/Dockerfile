FROM python:3.11-slim
WORKDIR /app
COPY builder-backend/requirements.txt .
RUN pip install --no-cache-dir -r requirements.txt
# Install agentscope_skills for allowlist validation at build time
COPY packages/agentscope_skills /app/packages/agentscope_skills
RUN pip install --no-cache-dir /app/packages/agentscope_skills
COPY builder-backend/app/ ./app/
EXPOSE 8080
CMD ["uvicorn", "app.main:app", "--host", "0.0.0.0", "--port", "8080"]
