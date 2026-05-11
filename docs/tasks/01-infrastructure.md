# Task 01 — Infrastructure & Gateways

## Goal

`docker compose up` brings up all infrastructure cleanly. End-to-end Gemini call traceable to MinIO. Temporal Web UI accessible. Object lock confirmed.

## Important

First-run `docker compose build` is **10–15 minutes** (AgentScope Studio, Runtime, ReMe from source). Subsequent rebuilds cached. Do not rebuild in front of an audience.

## Steps

1. **Set env.**
   ```bash
   cp .env.example .env
   # Set GEMINI_API_KEY (required). Other defaults are fine for demo.
   ```

2. **Build the from-source images.**
   ```bash
   docker compose build studio runtime-sandbox reme
   ```
   First time: 10–15 min. If a build fails, check the upstream repo's `pyproject.toml`/`package.json` for the correct entrypoint and adjust the Dockerfile CMD.

3. **Bring up Postgres instances + MinIO.**
   ```bash
   docker compose up -d litellm-db temporal-db reme-db minio minio-init
   docker compose ps
   ```
   All three Postgres instances and MinIO must be healthy. `minio-init` exits 0 after creating buckets.

4. **Bring up LiteLLM.**
   ```bash
   docker compose up -d litellm
   docker compose logs -f litellm
   ```
   Wait for `Application startup complete`. Test:
   ```bash
   curl -s http://localhost:4000/health -H "Authorization: Bearer $LITELLM_MASTER_KEY"
   ```

5. **Test a Gemini call.**
   ```bash
   curl http://localhost:4000/v1/chat/completions \
     -H "Authorization: Bearer $LITELLM_MASTER_KEY" \
     -H "Content-Type: application/json" \
     -d '{
       "model": "gemini-3.1-pro",
       "messages": [{"role": "user", "content": "say hello in 3 words"}],
       "reasoning_effort": "low"
     }'
   ```

6. **Verify MinIO audit log.**
   ```bash
   docker compose exec minio mc ls local/audit-logs/
   ```

7. **Bring up Temporal + UI.**
   ```bash
   docker compose up -d temporal temporal-ui
   open http://localhost:8233   # Temporal Web UI
   ```
   Confirm the default namespace is registered (`temporal` namespace; we use `default`).

8. **Bring up Studio, OTEL, Runtime.**
   ```bash
   docker compose up -d studio otel-collector runtime-sandbox
   open http://localhost:3000   # AgentScope Studio
   curl http://localhost:8001/health   # Runtime sandbox
   ```

9. **Bring up ReMe.**
   ```bash
   docker compose up -d reme
   curl http://localhost:8002/health
   ```

10. **Verify object lock.**
    ```bash
    docker compose exec minio mc retention info local/audit-logs/
    ```
    Should show COMPLIANCE / 90 days. **The audit talk track depends on this.**

## Issues you'll hit

- **Studio build fails on `npm ci`**: try `npm install`. Adjust Dockerfile.
- **Runtime sandbox needs Docker socket**: ensure `/var/run/docker.sock` is mounted. On Mac/Windows, check Docker Desktop settings.
- **ReMe `reme service` not found**: check the cloned repo's `pyproject.toml` console scripts. Adjust CMD.
- **Temporal-UI version mismatch**: pin `temporalio/ui` and `temporalio/auto-setup` to compatible tags. The compose file pins to known-good versions.
- **MinIO object lock can't be enabled retroactively**: must be set at bucket creation. If you got it wrong, `mc rb local/audit-logs --force` and recreate.
- **LiteLLM rejects Gemini call**: confirm `GEMINI_API_KEY` set in `.env` and reloaded (`docker compose up -d --force-recreate litellm`).

## Definition of Done

- [ ] All from-source images build cleanly
- [ ] `docker compose up -d` brings all 14 services healthy in <90 sec (after build)
- [ ] Gemini 3.1 Pro test call returns a valid response via LiteLLM
- [ ] Call appears in `minio://audit-logs/`
- [ ] Studio UI loads at `http://localhost:3000`
- [ ] Temporal Web UI loads at `http://localhost:8233`, shows `default` namespace
- [ ] ReMe responds to `/health`
- [ ] OTEL collector accepts a test trace
- [ ] Object lock retention is COMPLIANCE / 90d on `audit-logs`

## What this session does NOT do

- No mock services yet (next)
- No builder/workflow backends yet
- No agent code, no workflow registration yet
