## SESSION-17 — Persistence Hardening

### Problem
Migration state and Postgres data are lost on `docker compose down -v` or a container restart
because:
1. `dev-down` in the Makefile runs `down -v` which **destroys named volumes**.
2. Some environments have no persistent volume mount for the kind StatefulSet.
3. Migrations are not auto-applied on service startup — a manual `make migrate-up` step is required.

### Fixes

#### 1. Never auto-destroy volumes in dev teardown
```makefile
# Makefile  — before
dev-down:
	@docker compose -f docker-compose.dev.yml down -v   # destroys data ❌

# Makefile  — after
dev-down: ## Stop dev stack (preserves data volumes)
	@docker compose -f docker-compose.dev.yml down      # keeps volumes ✓

dev-down-clean: ## Stop dev stack AND wipe all data (destructive)
	@docker compose -f docker-compose.dev.yml down -v
	@echo "⚠ All data volumes removed."
```

#### 2. Auto-migrate on startup (atom-studio-api)
```python
# atom-studio/backend/main.py  — add before app startup
import subprocess, os

@app.on_event("startup")
async def run_migrations():
    db_url = os.environ["DATABASE_URL"]
    result = subprocess.run(
        ["migrate", "-database", db_url, "-path", "/migrations", "up"],
        capture_output=True, text=True
    )
    if result.returncode != 0:
        raise RuntimeError(f"Migration failed: {result.stderr}")
```
The `/migrations` directory is bind-mounted into the container from the monorepo root.

#### 3. docker-compose volume mount for migrations
```yaml
# docker-compose.dev.yml  — atom-studio-api service
volumes:
  - ./.keys:/etc/atom:ro
  - ./migrations:/migrations:ro   # ← add this
```

#### 4. Kind PVC storage class
Ensure `infra/helm/postgres-values.yaml` sets `persistence.storageClass: standard` (kind's default)
and `persistence.size: 10Gi` so the PVC survives pod restarts.

#### 5. Startup health-check gate
GATE and atom-studio-api already have `depends_on: postgres: condition: service_healthy`.
Add the same for atom-llm and atom-runtime so no service starts before migrations complete.

### Acceptance Criteria
- [ ] `make dev-up && make dev-down && make dev-up` — all data survives, no manual `migrate-up` needed
- [ ] `make dev-down-clean` documented as the only way to wipe state
- [ ] atom-studio-api logs `"Migrations: N applied, schema at version X"` on startup
- [ ] Kind cluster restart (pod eviction) does not lose Postgres data

---
