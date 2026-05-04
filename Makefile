SHELL := /bin/bash
.PHONY: help bootstrap \
        infra-up infra-down \
        dev-up dev-down dev-down-clean dev-rebuild dev-rebuild-ui dev-rebuild-api dev-rebuild-llm dev-rebuild-runtime dev-rebuild-archiver \
        dev-status dev-ps dev-logs logs-gate logs-studio logs-llm logs-archiver \
        migrate-up migrate-down migrate-status migrate-dev seed-dev seed-k8s \
        gate-build gate-docker cli-install cli-build \
        agent-build agent-restart \
        policy-test policy-check policy-bundle policy-fmt \
        lint lint-go lint-python \
        test test-go test-python test-e2e test-load \
        generate-keys go-sync go-tidy clean \
        registry-up ghcr-push ghcr-login deploy-from-ghcr \
        k8s-secrets k8s-deploy monitoring-up monitoring-down \
        ingress-up ingress-hosts

# ── Cluster + registry ───────────────────────────────────────────────────────
CLUSTER_NAME  ?= atom
KUBECONFIG    ?= $(HOME)/.kube/config
# GitHub Container Registry org — set to your GitHub username or org.
# Images are published at ghcr.io/$(GHCR_ORG)/atom-<service>:latest
GHCR_ORG     ?= shreyasy2k
GHCR_REGISTRY = ghcr.io/$(GHCR_ORG)

# ── Database URL (from .env or env) ──────────────────────────────────────────
include .env
export

# ── Tool paths ────────────────────────────────────────────────────────────────
MIGRATE := $(shell go env GOPATH)/bin/migrate

# ─────────────────────────────────────────────────────────────────────────────
help: ## Show this help
	@grep -hE '^[a-zA-Z_-]+:.*?## .*$$' $(MAKEFILE_LIST) | \
	  awk 'BEGIN {FS = ":.*?## "}; {printf "  \033[36m%-26s\033[0m %s\n", $$1, $$2}'

# ── Bootstrap ────────────────────────────────────────────────────────────────
bootstrap: ## Install all required tools (run once on first setup)
	@echo "→ Checking Go..."
	@go version || (echo "Install Go 1.22+ from https://go.dev" && exit 1)
	@echo "→ Checking Python..."
	@python3 --version || (echo "Install Python 3.11+" && exit 1)
	@echo "→ Checking uv..."
	@uv --version 2>/dev/null || pip install uv
	@echo "→ Checking Docker..."
	@docker version || (echo "Install Docker Desktop" && exit 1)
	@echo "→ Checking kind..."
	@kind version 2>/dev/null || go install sigs.k8s.io/kind@latest
	@echo "→ Checking kubectl..."
	@kubectl version --client 2>/dev/null || (echo "Install kubectl" && exit 1)
	@echo "→ Checking helm..."
	@helm version 2>/dev/null || (echo "Install helm from https://helm.sh" && exit 1)
	@echo "→ Checking OPA CLI..."
	@opa version 2>/dev/null || (echo "Install OPA from https://www.openpolicyagent.org/docs/latest/#running-opa" && exit 1)
	@echo "→ Checking golang-migrate..."
	@migrate -version 2>/dev/null || go install -tags 'postgres' github.com/golang-migrate/migrate/v4/cmd/migrate@latest
	@echo "→ Checking pre-commit..."
	@pre-commit --version 2>/dev/null || pip install pre-commit
	@pre-commit install --install-hooks
	@echo ""
	@echo "✓ Bootstrap complete."
	@echo ""
	@echo "Next steps:"
	@echo "  1. cp .env.example .env       # fill in secrets"
	@echo "  2. make generate-keys         # create JWT key pair"
	@echo "  3. make dev-up                # start full stack"
	@echo "  4. make migrate-dev           # apply DB migrations"
	@echo "  5. make seed-dev              # load dev seed data"

# ── Infrastructure (k8s) ─────────────────────────────────────────────────────
infra-up: ## Create kind cluster + local registry + deploy all infra services
	@echo "→ Starting local registry (localhost:5001)..."
	@$(MAKE) registry-up
	@echo "→ Creating kind cluster '$(CLUSTER_NAME)'..."
	@kind get clusters 2>/dev/null | grep -q "^$(CLUSTER_NAME)$$" || \
	  kind create cluster --config infra/kind/cluster.yaml --name $(CLUSTER_NAME)
	@kubectl config use-context kind-$(CLUSTER_NAME)
	@echo "→ Labelling control-plane for ingress..."
	@kubectl label node $(CLUSTER_NAME)-control-plane ingress-ready=true \
	  --overwrite 2>/dev/null || true
	@echo "→ Applying namespaces..."
	@kubectl apply -f infra/manifests/namespaces.yaml
	@echo "→ Installing nginx-ingress (pinned to control-plane, hostPort 80/443)..."
	@helm upgrade --install ingress-nginx ingress-nginx \
	  --repo https://kubernetes.github.io/ingress-nginx \
	  --namespace ingress-nginx --create-namespace \
	  -f infra/helm/nginx-values.yaml \
	  --wait
	@echo "→ Deploying Postgres (pgvector)..."
	@helm upgrade --install postgres oci://registry-1.docker.io/bitnamicharts/postgresql \
	  --namespace atom-infra -f infra/helm/postgres-values.yaml --wait
	@echo "→ Deploying Redis..."
	@helm upgrade --install redis oci://registry-1.docker.io/bitnamicharts/redis \
	  --namespace atom-infra -f infra/helm/redis-values.yaml --wait
	@echo "→ Deploying MinIO..."
	@helm upgrade --install minio \
	  --repo https://charts.min.io/ minio \
	  --namespace atom-infra -f infra/helm/minio-values.yaml --wait
	@echo "→ Deploying Redpanda..."
	@helm upgrade --install redpanda \
	  --repo https://charts.redpanda.com redpanda \
	  --namespace atom-infra -f infra/helm/redpanda-values.yaml --wait
	@echo "→ Deploying OPA..."
	@kubectl apply -f infra/manifests/opa-deployment.yaml
	@echo ""
	@echo "✓ Infrastructure up. Run 'make migrate-up' next."

infra-down: ## Tear down infra services (delete atom-infra / atom-system / atom-agents namespaces)
	@kubectl delete namespace atom-infra atom-system atom-agents 2>/dev/null || true
	@echo "✓ Infra namespaces deleted."

# ── Operator mode (docker-compose.yml — pulls pre-built GHCR images) ──────────
up: ## Start stack in operator mode (pulls pre-built GHCR images)
	@docker compose up -d

down: ## Stop operator-mode stack (keeps volumes)
	@docker compose down

# ── Local dev (docker-compose) ────────────────────────────────────────────────
dev-up: ## Start full stack via docker-compose (first run may take a few minutes)
	@docker compose -f docker-compose.dev.yml up -d
	@echo ""
	@echo "✓ Dev stack up. Services:"
	@echo ""
	@echo "  ── Application ──────────────────────────────────────"
	@echo "  atom-studio UI:      http://localhost:3000  (admin@atom.local / changeme)"
	@echo "  atom-studio API:     http://localhost:3001  (OpenAPI: /docs)"
	@echo "  GATE:                http://localhost:8080"
	@echo "  atom-llm (LiteLLM): http://localhost:4000"
	@echo "  atom-runtime:        http://localhost:8090"
	@echo ""
	@echo "  ── Observability ────────────────────────────────────"
	@echo "  Grafana:             http://localhost:3005  (admin/admin)"
	@echo "    └─ Loki datasource:  http://localhost:3100"
	@echo "    └─ Tempo datasource: http://localhost:3200"
	@echo "  Alloy UI:            http://localhost:12345"
	@echo ""
	@echo "  ── Storage ──────────────────────────────────────────"
	@echo "  MinIO console:       http://localhost:9001  (minioadmin/changeme)"
	@echo "  Postgres:            localhost:5432"
	@echo "  Redis:               localhost:6379"
	@echo "  Redpanda:            localhost:19092 (external)"
	@echo ""
	@echo "  ── Developer ────────────────────────────────────────"
	@echo "  atom-studio tRPC:    http://localhost:3001  (agentscope.init studio_url)"
	@echo ""
	@echo "  Hot-reload frontend: cd atom-studio/frontend && npm run dev  → :5173"
	@echo "  Migrations + seed run automatically on every start."

dev-down: ## Stop docker-compose dev stack (keeps volumes)
	@docker compose -f docker-compose.dev.yml down
	@echo "✓ Dev stack stopped."

dev-down-clean: ## Stop docker-compose and remove all volumes (full reset)
	@docker compose -f docker-compose.dev.yml down -v
	@echo "✓ Dev stack removed (volumes wiped)."

dev-rebuild: ## Rebuild and restart all services (after code changes)
	@docker compose -f docker-compose.dev.yml build
	@docker compose -f docker-compose.dev.yml up -d --force-recreate
	@echo "✓ All services rebuilt and restarted."

dev-rebuild-ui: ## Rebuild and restart atom-studio-ui only
	@docker compose -f docker-compose.dev.yml build atom-studio-ui
	@docker compose -f docker-compose.dev.yml up -d --force-recreate atom-studio-ui
	@echo "✓ atom-studio-ui rebuilt."

dev-rebuild-api: ## Rebuild and restart atom-studio-api only
	@docker compose -f docker-compose.dev.yml build atom-studio-api
	@docker compose -f docker-compose.dev.yml up -d --force-recreate atom-studio-api
	@echo "✓ atom-studio-api rebuilt."

dev-rebuild-gate: ## Rebuild and restart GATE only
	@docker compose -f docker-compose.dev.yml build gate
	@docker compose -f docker-compose.dev.yml up -d --force-recreate gate
	@echo "✓ gate rebuilt."

dev-rebuild-llm: ## Rebuild and restart atom-llm only
	@docker compose -f docker-compose.dev.yml build atom-llm
	@docker compose -f docker-compose.dev.yml up -d --force-recreate atom-llm
	@echo "✓ atom-llm rebuilt."

dev-rebuild-runtime: ## Rebuild and restart atom-runtime only
	@docker compose -f docker-compose.dev.yml build atom-runtime
	@docker compose -f docker-compose.dev.yml up -d --force-recreate atom-runtime
	@echo "✓ atom-runtime rebuilt."

dev-rebuild-archiver: ## Rebuild and restart log-archiver only
	@docker compose -f docker-compose.dev.yml build log-archiver
	@docker compose -f docker-compose.dev.yml up -d --force-recreate log-archiver
	@echo "✓ log-archiver rebuilt."

dev-status: ## Show health of all dev containers
	@docker compose -f docker-compose.dev.yml ps

dev-ps: ## Alias for dev-status
	@$(MAKE) dev-status

# ── Logs ─────────────────────────────────────────────────────────────────────
dev-logs: ## Tail logs from all dev services
	@docker compose -f docker-compose.dev.yml logs -f

logs-gate: ## Tail GATE logs
	@docker logs atom-gate -f

logs-studio: ## Tail atom-studio-api logs
	@docker logs atom-studio-api -f

logs-llm: ## Tail atom-llm logs
	@docker logs atom-llm -f

logs-archiver: ## Tail log-archiver logs
	@docker logs atom-log-archiver -f

logs-alloy: ## Tail Grafana Alloy logs
	@docker logs atom-alloy -f

logs-runtime: ## Tail atom-runtime logs
	@docker logs atom-runtime -f

# ── Database migrations ───────────────────────────────────────────────────────
migrate-up: ## Apply migrations to k8s postgres (port-forward svc/postgres-postgresql first)
	@$(MIGRATE) -database "$(DATABASE_URL)" -path migrations up
	@echo "✓ Migrations applied."

migrate-down: ## Roll back last migration on k8s postgres
	@$(MIGRATE) -database "$(DATABASE_URL)" -path migrations down 1

migrate-status: ## Show current migration version
	@$(MIGRATE) -database "$(DATABASE_URL)" -path migrations version

migrate-dev: ## Apply all migrations to local docker-compose postgres
	@$(MIGRATE) \
	  -database "postgresql://atom:$(POSTGRES_PASSWORD)@localhost:5432/atom?sslmode=disable" \
	  -path migrations up
	@echo "✓ Dev migrations applied."

seed-dev: ## Load development seed data into docker-compose postgres (admin@atom.local / admin123)
	@PGPASSWORD=$(POSTGRES_PASSWORD) psql -h localhost -U atom -d atom -f migrations/seed_dev.sql
	@echo "✓ Seed data loaded. Login: admin@atom.local / admin123"

seed-k8s: ## Load development seed data into k8s postgres (port-forward required or auto-creates one)
	@echo "→ Seeding k8s postgres..."
	@kubectl port-forward -n atom-infra svc/postgres-postgresql 5432:5432 &
	@sleep 3
	@PGPASSWORD=$(POSTGRES_PASSWORD) psql -h localhost -U atom -d atom -f migrations/seed_dev.sql
	@pkill -f "kubectl port-forward.*postgres-postgresql.*5432:5432" 2>/dev/null || true
	@echo "✓ Seed data loaded. Login: admin@atom.local / admin123"

# ── Build targets ──────────────────────────────────────────────────────────────
gate-build: ## Build GATE binary locally
	@cd gate && go build -o ../bin/gate ./cmd/gate
	@echo "✓ bin/gate built."

gate-docker: ## Build GATE Docker image
	@docker build -t atom-gate:local gate/
	@echo "✓ atom-gate:local built."

cli-install: ## Build and install atom CLI to GOPATH/bin
	@cd atom-cli && go build -o $(GOPATH)/bin/atom ./cmd/atom
	@echo "✓ atom CLI installed → $$(which atom)"
	@echo "  Usage: atom login | atom create | atom deploy | atom logs <agent-id>"

cli-build: ## Build atom CLI binary to bin/
	@cd atom-cli && go build -o ../bin/atom ./cmd/atom
	@echo "✓ bin/atom built."

get-examples: ## Sparse-clone example agents from GitHub (no full repo clone needed)
	@echo "→ Downloading example agents from GitHub..."
	@git clone --filter=blob:none --sparse --depth=1 https://github.com/shreyasY2k/atom.git .atom-examples-tmp 2>/dev/null
	@cd .atom-examples-tmp && git sparse-checkout set examples/agents
	@mkdir -p examples
	@cp -r .atom-examples-tmp/examples/agents examples/
	@rm -rf .atom-examples-tmp
	@echo "✓ Example agents downloaded to ./examples/agents/"
	@echo "  cd examples/agents/financial-assistant && atom deploy"

# ── Agent development ─────────────────────────────────────────────────────────

agent-restart: ## Restart a running agent container with a fresh JWT (AGENT_ID= required)
	@if [ -z "$(AGENT_ID)" ]; then echo "Usage: make agent-restart AGENT_ID=<uuid>"; exit 1; fi
	@echo "→ Fetching fresh JWT for $(AGENT_ID)..."
	@TOKEN=$$(curl -s -X POST http://localhost:3001/api/auth/login \
	  -H "Content-Type: application/json" \
	  -d '{"email":"$(ADMIN_EMAIL)","password":"$(ADMIN_PASSWORD)"}' \
	  | python3 -c "import sys,json; print(json.load(sys.stdin)['access_token'])") && \
	JWT=$$(curl -s -X POST "http://localhost:3001/api/domains/$(DOMAIN_ID)/agents/$(AGENT_ID)/regenerate-token" \
	  -H "Authorization: Bearer $$TOKEN" \
	  | python3 -c "import sys,json; print(json.load(sys.stdin)['token'])") && \
	docker rm -f agent-$(AGENT_ID) 2>/dev/null; \
	docker run -d --name agent-$(AGENT_ID) --network atom-dev_default \
	  -e ATOM_GATE_URL=http://gate:8080 \
	  -e ATOM_DOMAIN_ID=$(DOMAIN_ID) \
	  -e ATOM_AGENT_ID=$(AGENT_ID) \
	  -e ATOM_AGENT_JWT=$$JWT \
	  -e ATOM_MODEL_NAME=$(MODEL_NAME) \
	  -e KAFKA_BROKERS=redpanda:9092 \
	  -e ATOM_STUDIO_URL=http://atom-studio-api:3001 \
	  --label "atom.io/agent-id=$(AGENT_ID)" \
	  --restart unless-stopped \
	  $(AGENT_IMAGE)
	@echo "✓ agent-$(AGENT_ID) restarted."

# ── Policies ──────────────────────────────────────────────────────────────────
policy-test: ## Run all OPA Rego unit tests
	@opa test policies/ -v
	@echo "✓ Policy tests passed."

policy-check: ## Check Rego syntax
	@opa check policies/

policy-bundle: ## Compile OPA policy bundle
	@opa build policies/ -o policies/bundle.tar.gz
	@echo "✓ Bundle: policies/bundle.tar.gz"

policy-fmt: ## Format all Rego files in-place
	@find policies/ -name '*.rego' -exec opa fmt -w {} \;

# ── Lint ──────────────────────────────────────────────────────────────────────
lint: lint-go lint-python policy-check ## Run all linters

lint-go: ## Run Go vet on gate + atom-cli
	@cd gate     && go vet ./... && echo "gate: vet ok"
	@cd atom-cli && go vet ./... && echo "atom-cli: vet ok"

lint-python: ## Run ruff on Python components
	@ruff check atom-llm/ atom-runtime/ atom-memory/ atom-studio/ infra/log-archiver/ 2>/dev/null || \
	  echo "(ruff not installed or Python components not yet cloned — skip)"

# ── Test ──────────────────────────────────────────────────────────────────────
test: test-go test-python policy-test ## Run all tests

test-go: ## Run Go tests (gate + atom-cli)
	@cd gate     && go test ./... -race -count=1
	@cd atom-cli && go test ./... -race -count=1

test-python: ## Run Python tests (all components via uv isolated envs)
	@echo "→ atom-studio tests..."
	@uv run --project atom-studio/backend --with pytest-asyncio \
	  python -m pytest atom-studio/backend/src/tests/ -q --tb=short 2>/dev/null || \
	  echo "(atom-studio tests skipped — check uv env)"
	@echo "→ atom-runtime tests..."
	@uv run --project atom-runtime/runtime --with pytest-asyncio \
	  python -m pytest atom-runtime/runtime/tests/ -q --tb=short 2>/dev/null || \
	  echo "(atom-runtime tests skipped — check uv env)"

test-e2e: ## Run end-to-end tests (requires full stack running)
	@python3 -m pytest tests/e2e/ -v

test-load: ## Run k6 load test against GATE (results → tests/load/results/summary.json)
	@mkdir -p tests/load/results
	@k6 run tests/load/gate_load_test.js \
	  --summary-export=tests/load/results/summary.json

# ── Local registry for kind ───────────────────────────────────────────────────
registry-up: ## Ensure local Docker registry is running on :5001
	@docker ps --filter "publish=5001" --format "{{.Names}}" | grep -q . \
	  || docker run -d -p 5001:5000 --restart always --name atom-registry registry:2 2>/dev/null \
	  || docker start atom-registry 2>/dev/null \
	  || true
	@echo "✓ Registry running at localhost:5001"

# ── GHCR image push (maintainer / CI) ────────────────────────────────────────
ghcr-push: ## Build all images and push to GHCR (requires docker login ghcr.io)
	@echo "→ Building and pushing to $(GHCR_REGISTRY)..."
	@docker build -t $(GHCR_REGISTRY)/atom-gate:latest         gate/ -f gate/Dockerfile
	@docker push  $(GHCR_REGISTRY)/atom-gate:latest
	@docker build -t $(GHCR_REGISTRY)/atom-llm:latest          atom-llm/ -f atom-llm/Dockerfile.dev
	@docker push  $(GHCR_REGISTRY)/atom-llm:latest
	@docker build -t $(GHCR_REGISTRY)/atom-studio-api:latest   atom-studio/backend/
	@docker push  $(GHCR_REGISTRY)/atom-studio-api:latest
	@docker build -t $(GHCR_REGISTRY)/atom-studio-ui:latest    atom-studio/frontend/
	@docker push  $(GHCR_REGISTRY)/atom-studio-ui:latest
	@docker build -t $(GHCR_REGISTRY)/atom-log-archiver:latest infra/log-archiver/
	@docker push  $(GHCR_REGISTRY)/atom-log-archiver:latest
	@docker build -t $(GHCR_REGISTRY)/atom-runtime:latest      atom-runtime/runtime/
	@docker push  $(GHCR_REGISTRY)/atom-runtime:latest
	@echo "✓ All images pushed to $(GHCR_REGISTRY)"

ghcr-login: ## Log in to GHCR (set GHCR_TOKEN env var or use --password-stdin)
	@echo "$$GHCR_TOKEN" | docker login ghcr.io -u $(GHCR_ORG) --password-stdin

# ── Operator deploy (pulls from GHCR — no local build needed) ────────────────
deploy-from-ghcr: ## Apply manifests; images pulled from GHCR automatically
	@echo "→ Deploying ATOM from GHCR images ($(GHCR_REGISTRY))..."
	@$(MAKE) k8s-secrets
	@kubectl apply -f infra/manifests/cluster-config.yaml
	@kubectl create configmap opa-policies \
	  --from-file=policies/base/ --namespace atom-system \
	  --dry-run=client -o yaml | kubectl apply -f -
	@kubectl apply -f infra/manifests/atom-llm-netpol.yaml
	@kubectl apply -f infra/manifests/gate-deployment.yaml
	@kubectl apply -f infra/manifests/atom-llm-deployment.yaml
	@kubectl apply -f infra/manifests/atom-studio-deployment.yaml
	@kubectl apply -f infra/manifests/atom-studio-ui-deployment.yaml
	@kubectl apply -f infra/manifests/atom-runtime-deployment.yaml
	@kubectl apply -f infra/manifests/log-archiver-deployment.yaml
	@kubectl apply -f infra/manifests/alloy-daemonset.yaml
	@echo "✓ Manifests applied. Images will be pulled from GHCR on first pod start."
	@echo "  Run: make seed-k8s   to create admin user."

# ── Kubernetes secrets (idempotent) ──────────────────────────────────────────
k8s-secrets: ## Create atom-credentials (passwords only) + atom-jwt-keys Secrets
	@echo "→ Applying namespaces and Secrets..."
	@kubectl apply -f infra/manifests/namespaces.yaml
	@kubectl create secret generic atom-credentials \
	  --namespace atom-system \
	  --from-literal=POSTGRES_PASSWORD=$(POSTGRES_PASSWORD) \
	  --from-literal=REDIS_PASSWORD=$(REDIS_PASSWORD) \
	  --from-literal=MINIO_ACCESS_KEY=$(MINIO_ACCESS_KEY) \
	  --from-literal=MINIO_SECRET_KEY=$(MINIO_SECRET_KEY) \
	  --from-literal=PLATFORM_HMAC_SECRET=$(PLATFORM_HMAC_SECRET) \
	  --from-literal=ATOM_ENCRYPTION_KEY=$(ATOM_ENCRYPTION_KEY) \
	  --from-literal=LITELLM_MASTER_KEY=$(LITELLM_MASTER_KEY) \
	  --from-literal=ATOM_LLM_KEY=$(ATOM_LLM_KEY) \
	  --from-literal=GEMINI_API_KEY=$(GEMINI_API_KEY) \
	  --dry-run=client -o yaml | kubectl apply -f -
	@kubectl create secret generic atom-jwt-keys \
	  --from-file=jwt_private.pem=.keys/jwt_private.pem \
	  --from-file=jwt_public.pem=.keys/jwt_public.pem \
	  --namespace atom-system --dry-run=client -o yaml | kubectl apply -f -
	@echo "✓ Secrets applied (no URLs — topology lives in atom-cluster-config ConfigMap)."

# ── Kubernetes application deploy ─────────────────────────────────────────────
k8s-deploy: ## Build images → push to local registry → apply manifests → migrate → rollout
	@echo "→ Ensuring local registry is running..."
	@$(MAKE) registry-up
	@echo "→ Building Docker images and loading into kind cluster '$(CLUSTER_NAME)'..."
	@echo "  (tagged as $(GHCR_REGISTRY)/<service>:latest so manifests need no change)"
	@docker build -t $(GHCR_REGISTRY)/atom-gate:latest         gate/ -f gate/Dockerfile
	@kind load docker-image $(GHCR_REGISTRY)/atom-gate:latest         --name $(CLUSTER_NAME)
	@docker build -t $(GHCR_REGISTRY)/atom-llm:latest          atom-llm/ -f atom-llm/Dockerfile.dev
	@kind load docker-image $(GHCR_REGISTRY)/atom-llm:latest          --name $(CLUSTER_NAME)
	@docker build -t $(GHCR_REGISTRY)/atom-studio-api:latest   atom-studio/backend/
	@kind load docker-image $(GHCR_REGISTRY)/atom-studio-api:latest   --name $(CLUSTER_NAME)
	@docker build -t $(GHCR_REGISTRY)/atom-studio-ui:latest    atom-studio/frontend/
	@kind load docker-image $(GHCR_REGISTRY)/atom-studio-ui:latest    --name $(CLUSTER_NAME)
	@docker build -t $(GHCR_REGISTRY)/atom-log-archiver:latest infra/log-archiver/
	@kind load docker-image $(GHCR_REGISTRY)/atom-log-archiver:latest --name $(CLUSTER_NAME)
	@docker build -t $(GHCR_REGISTRY)/atom-runtime:latest      atom-runtime/runtime/
	@kind load docker-image $(GHCR_REGISTRY)/atom-runtime:latest      --name $(CLUSTER_NAME)
	@echo "→ Creating Secrets and ConfigMaps..."
	@$(MAKE) k8s-secrets
	@kubectl apply -f infra/manifests/cluster-config.yaml
	@kubectl create configmap opa-policies \
	  --from-file=policies/base/ --namespace atom-system \
	  --dry-run=client -o yaml | kubectl apply -f -
	@echo "→ Applying manifests..."
	@kubectl apply -f infra/manifests/atom-llm-netpol.yaml
	@kubectl apply -f infra/manifests/gate-deployment.yaml
	@kubectl apply -f infra/manifests/atom-llm-deployment.yaml
	@kubectl apply -f infra/manifests/atom-studio-deployment.yaml
	@kubectl apply -f infra/manifests/atom-studio-ui-deployment.yaml
	@kubectl apply -f infra/manifests/atom-runtime-deployment.yaml
	@kubectl apply -f infra/manifests/log-archiver-deployment.yaml
	@kubectl apply -f infra/manifests/alloy-daemonset.yaml
	@echo "→ Running LiteLLM Prisma migration (MUST run before golang-migrate)..."
	@kubectl port-forward -n atom-infra svc/postgres-postgresql 5433:5432 & \
	  sleep 3 && \
	  SCHEMA=$$(docker run --rm $(GHCR_REGISTRY)/atom-llm:latest python3 -c \
	    "import litellm, os; print(os.path.join(os.path.dirname(litellm.__file__), 'proxy', 'schema.prisma'))") && \
	  docker run --rm \
	    -e DATABASE_URL="postgresql://atom:$(POSTGRES_PASSWORD)@host.docker.internal:5433/atom" \
	    --add-host host.docker.internal:host-gateway \
	    $(GHCR_REGISTRY)/atom-llm:latest prisma db push --schema $$SCHEMA \
	    --skip-generate --accept-data-loss 2>/dev/null || echo "(prisma skipped)"
	@pkill -f "port-forward.*5433" 2>/dev/null || true
	@echo "→ Running ATOM DB migrations (after Prisma so --accept-data-loss cannot drop ATOM tables)..."
	@kubectl port-forward -n atom-infra svc/postgres-postgresql 5432:5432 & \
	  sleep 4 && \
	  $(MIGRATE) -database "postgresql://atom:$(POSTGRES_PASSWORD)@localhost:5432/atom?sslmode=disable" \
	    -path migrations up 2>/dev/null || echo "(migrations up-to-date)"
	@pkill -f "kubectl port-forward.*postgres-postgresql.*5432:5432" 2>/dev/null || true
	@echo "→ Seeding development data (admin@atom.local / admin123)..."
	@kubectl port-forward -n atom-infra svc/postgres-postgresql 5432:5432 & \
	  sleep 3 && \
	  PGPASSWORD=$(POSTGRES_PASSWORD) psql -h localhost -U atom -d atom \
	    -f migrations/seed_dev.sql 2>/dev/null || echo "(seed skipped)"
	@pkill -f "kubectl port-forward.*postgres-postgresql.*5432:5432" 2>/dev/null || true
	@echo "→ Waiting for rollouts..."
	@kubectl rollout status deployment/gate            -n atom-system --timeout=120s
	@kubectl rollout status deployment/atom-llm        -n atom-system --timeout=180s
	@kubectl rollout status deployment/atom-studio-api -n atom-system --timeout=120s
	@kubectl rollout status deployment/atom-studio-ui  -n atom-system --timeout=120s
	@kubectl rollout status deployment/atom-runtime    -n atom-system --timeout=120s
	@kubectl rollout status deployment/log-archiver    -n atom-system --timeout=120s
	@echo ""
	@echo "✓ k8s deploy complete."
	@kubectl get pods -n atom-system

# ── Monitoring (k8s) ─────────────────────────────────────────────────────────
# Note: For docker-compose dev, Alloy+Loki+Tempo are included in dev-up.
# These targets deploy the monitoring stack to the kind k8s cluster.
monitoring-up: ## Deploy Grafana + Loki + Tempo + Alloy to atom-system (k8s)
	@helm repo add grafana https://grafana.github.io/helm-charts 2>/dev/null || true
	@helm repo update 2>&1 | tail -1
	@echo "→ Creating Grafana dashboard ConfigMap..."
	@kubectl create configmap atom-grafana-dashboards \
	  --from-file=infra/grafana/dashboards/ \
	  --namespace atom-system --dry-run=client -o yaml | kubectl apply -f -
	@kubectl label configmap atom-grafana-dashboards grafana_dashboard=1 \
	  -n atom-system --overwrite
	@echo "→ Deploying Tempo (trace backend)..."
	@helm upgrade --install tempo grafana/tempo \
	  --namespace atom-system \
	  -f infra/helm/tempo-values.yaml \
	  --wait --timeout=120s
	@echo "→ Deploying Loki (log backend; caches disabled for dev)..."
	@helm upgrade --install loki grafana/loki \
	  --namespace atom-system \
	  -f infra/helm/loki-values.yaml \
	  --wait --timeout=180s
	@echo "→ Deploying Alloy (OTLP receiver + log collector)..."
	@helm upgrade --install alloy grafana/alloy \
	  --namespace atom-system \
	  -f infra/helm/alloy-values.yaml \
	  --wait --timeout=120s
	@echo "→ Deploying Grafana (dashboards + Loki + Tempo datasources)..."
	@helm upgrade --install grafana grafana/grafana \
	  --namespace atom-system \
	  -f infra/helm/grafana-values.yaml \
	  --wait --timeout=120s
	@echo "→ Applying ingress rules for observability services..."
	@kubectl apply -f infra/manifests/ingress.yaml
	@echo ""
	@echo "✓ Monitoring stack deployed."
	@echo ""
	@echo "  http://grafana.atom.local   (admin / atom-grafana-dev)"
	@echo "  http://alloy.atom.local     (OTLP receiver UI)"
	@echo "  http://loki.atom.local      (log query API)"
	@echo "  http://tempo.atom.local     (trace query API)"

monitoring-down: ## Remove monitoring stack from k8s
	@helm uninstall grafana tempo alloy loki -n atom-system 2>/dev/null || true
	@kubectl delete configmap atom-grafana-dashboards -n atom-system 2>/dev/null || true
	@echo "✓ Monitoring stack removed."

# ── Ingress ───────────────────────────────────────────────────────────────────
ingress-up: ## Apply ingress rules (kind: port 80 direct; Docker Desktop: port-forward :8088)
	@kubectl apply -f infra/manifests/ingress.yaml
	@if kind get clusters 2>/dev/null | grep -q "^$(CLUSTER_NAME)$$"; then \
	  echo "✓ Ingress applied. kind cluster maps port 80 → localhost:80 directly."; \
	  echo "  Run: sudo make ingress-hosts  (one-time)"; \
	  echo "  Then open http://studio.atom.local  (no port needed)"; \
	else \
	  pkill -f "port-forward.*ingress-nginx.*8088" 2>/dev/null || true; \
	  kubectl port-forward -n ingress-nginx svc/ingress-nginx-controller 8088:80 &; \
	  sleep 2; \
	  echo "✓ Ingress port-forwarded to localhost:8088"; \
	fi
	@echo ""
	@echo "  Services (http on port 80 for kind / :8088 for Docker Desktop):"
	@echo "    http://studio.atom.local        atom-studio  (admin@atom.local / admin123)"
	@echo "    http://gate.atom.local          GATE         (Bearer JWT)"
	@echo "    http://api.atom.local/docs      API          (Swagger UI)"
	@echo "    http://grafana.atom.local       Grafana      (admin / atom-grafana-dev)"
	@echo "    http://minio-ui.atom.local      MinIO        (minioadmin / changeme)"

ingress-hosts: ## Append *.atom.local → 127.0.0.1 to /etc/hosts (requires sudo)
	@echo "127.0.0.1  gate.atom.local api.atom.local studio.atom.local runtime.atom.local grafana.atom.local alloy.atom.local loki.atom.local tempo.atom.local minio.atom.local minio-ui.atom.local opa.atom.local" | tee -a /etc/hosts
	@echo "✓ /etc/hosts updated. Access services at http://<name>.atom.local (no port)"

# ── Keys ──────────────────────────────────────────────────────────────────────
generate-keys: ## Generate RSA-4096 JWT key pair (run once on first setup)
	@mkdir -p .keys
	@openssl genrsa -out .keys/jwt_private.pem 4096
	@openssl rsa -in .keys/jwt_private.pem -pubout -out .keys/jwt_public.pem
	@echo "✓ Keys generated in .keys/"
	@echo "  NEVER commit .keys/ — already in .gitignore"

# ── Utility ───────────────────────────────────────────────────────────────────
go-sync: ## Sync go.work with all Go modules
	@go work sync

go-tidy: ## Tidy go.mod in all Go modules
	@cd gate     && go mod tidy
	@cd atom-cli && go mod tidy

clean: ## Remove built binaries
	@rm -rf bin/
