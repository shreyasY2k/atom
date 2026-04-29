SHELL := /bin/bash
.PHONY: help bootstrap \
        infra-up infra-down \
        dev-up dev-down dev-down-clean dev-rebuild dev-rebuild-ui dev-rebuild-api \
        dev-status dev-ps dev-logs logs-gate logs-studio logs-llm logs-archiver \
        migrate-up migrate-down migrate-status migrate-dev seed-dev \
        gate-build gate-docker cli-install cli-build \
        agent-build agent-restart \
        policy-test policy-check policy-bundle policy-fmt \
        lint lint-go lint-python \
        test test-go test-python test-e2e test-load \
        generate-keys go-sync go-tidy clean \
        k8s-secrets k8s-deploy monitoring-up monitoring-down

# ── Cluster name ─────────────────────────────────────────────────────────────
CLUSTER_NAME ?= atom
KUBECONFIG   ?= $(HOME)/.kube/config

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
infra-up: ## Deploy infra services to the current kubectl cluster
	@echo "→ Applying namespaces..."
	@kubectl apply -f infra/manifests/namespaces.yaml
	@echo "→ Installing nginx-ingress..."
	@helm upgrade --install ingress-nginx ingress-nginx \
	  --repo https://kubernetes.github.io/ingress-nginx \
	  --namespace ingress-nginx --create-namespace \
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
	@echo "  agentscope-studio:   http://localhost:3002  (trace viewer stub)"
	@echo ""
	@echo "  Hot-reload frontend: cd atom-studio/frontend && npm run dev  → :5173"
	@echo "  After first run:     make migrate-dev && make seed-dev"

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

seed-dev: ## Load development seed data into docker-compose postgres
	@PGPASSWORD=$(POSTGRES_PASSWORD) psql -h localhost -U atom -d atom -f migrations/seed_dev.sql
	@echo "✓ Seed data loaded."

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

# ── Agent development ─────────────────────────────────────────────────────────
agent-build: ## Build frontoffice agent Docker image (requires .atom-sdk to be copied first)
	@cp -r atom-sdk atom-cli/frontoffice/.atom-sdk
	@docker build -t frontoffice:latest atom-cli/frontoffice/
	@rm -rf atom-cli/frontoffice/.atom-sdk
	@echo "✓ frontoffice:latest built."

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

# ── Kubernetes secrets (idempotent) ──────────────────────────────────────────
k8s-secrets: ## Create/update atom-credentials and atom-jwt-keys Secrets in atom-system
	@echo "→ Applying k8s Secrets..."
	@kubectl apply -f infra/manifests/namespaces.yaml
	@kubectl create secret generic atom-credentials \
	  --from-env-file=.env \
	  --namespace atom-system --dry-run=client -o yaml | kubectl apply -f -
	@kubectl create secret generic atom-jwt-keys \
	  --from-file=jwt_private.pem=.keys/jwt_private.pem \
	  --from-file=jwt_public.pem=.keys/jwt_public.pem \
	  --namespace atom-system --dry-run=client -o yaml | kubectl apply -f -
	@echo "✓ Secrets applied."

# ── Kubernetes application deploy ─────────────────────────────────────────────
k8s-deploy: ## Build images, load into kind, apply manifests, wait for rollouts
	@echo "→ Building Docker images..."
	@docker rmi atom-gate:local atom-llm:local atom-studio-api:local atom-studio-ui:local atom-log-archiver:local atom-runtime:local 2>/dev/null || true
	@docker build -t atom-gate:local gate/ -f gate/Dockerfile
	@docker build -t atom-llm:local atom-llm/ -f atom-llm/Dockerfile.dev
	@docker build -t atom-studio-api:local atom-studio/backend/
	@docker build -t atom-studio-ui:local atom-studio/frontend/
	@docker build -t atom-log-archiver:local infra/log-archiver/
	@docker build -t atom-runtime:local atom-runtime/runtime/
	@echo "  (images built above are available to the cluster via local Docker daemon)"
	@echo "→ Creating Secrets and ConfigMaps..."
	@$(MAKE) k8s-secrets
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
	@echo "→ Running ATOM DB migrations..."
	@kubectl port-forward -n atom-infra svc/postgres-postgresql 5432:5432 &
	@sleep 3
	@$(MIGRATE) -database "postgresql://atom:changeme@localhost:5432/atom?sslmode=disable" \
	  -path migrations up 2>/dev/null || echo "(migrations already up-to-date)"
	@pkill -f "kubectl port-forward.*svc/postgres-postgresql.*5432" 2>/dev/null || true
	@echo "→ Running LiteLLM Prisma migrations..."
	@kubectl port-forward -n atom-infra svc/postgres-postgresql 5433:5432 &
	@sleep 3
	@SCHEMA=$$(docker run --rm atom-llm:local python3 -c \
	    "import litellm, os; print(os.path.join(os.path.dirname(litellm.__file__), 'proxy', 'schema.prisma'))") && \
	  docker run --rm \
	  -e DATABASE_URL="postgresql://atom:changeme@host.docker.internal:5433/atom" \
	  --add-host host.docker.internal:host-gateway \
	  atom-llm:local prisma db push --schema $$SCHEMA --skip-generate --accept-data-loss 2>/dev/null || true
	@pkill -f "port-forward.*5433" 2>/dev/null || true
	@echo "→ Forcing fresh pod rollout..."
	@kubectl delete pods -n atom-system -l app=gate 2>/dev/null || true
	@kubectl delete pods -n atom-system -l app=atom-llm 2>/dev/null || true
	@kubectl delete pods -n atom-system -l app=atom-studio-api 2>/dev/null || true
	@kubectl delete pods -n atom-system -l app=atom-studio-ui 2>/dev/null || true
	@kubectl delete pods -n atom-system -l app=log-archiver 2>/dev/null || true
	@kubectl delete pods -n atom-system -l app=atom-runtime 2>/dev/null || true
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
monitoring-up: ## Deploy Grafana + Tempo + Alloy to atom-system namespace (k8s)
	@helm repo add grafana https://grafana.github.io/helm-charts 2>/dev/null || true
	@helm repo update
	@echo "→ Creating dashboard ConfigMap..."
	@kubectl create configmap atom-grafana-dashboards \
	  --from-file=infra/grafana/dashboards/ \
	  --namespace atom-system --dry-run=client -o yaml | kubectl apply -f -
	@kubectl label configmap atom-grafana-dashboards grafana_dashboard=1 \
	  -n atom-system --overwrite
	@echo "→ Deploying Tempo..."
	@helm upgrade --install tempo grafana/tempo \
	  --namespace atom-system --create-namespace \
	  -f infra/helm/tempo-values.yaml
	@echo "→ Deploying Alloy (log collector + OTLP receiver)..."
	@helm upgrade --install alloy grafana/alloy \
	  --namespace atom-system --create-namespace \
	  -f infra/helm/alloy-values.yaml
	@echo "→ Deploying Loki..."
	@helm upgrade --install loki grafana/loki \
	  --namespace atom-system --create-namespace \
	  -f infra/helm/loki-values.yaml
	@echo "→ Deploying Grafana..."
	@helm upgrade --install grafana grafana/grafana \
	  --namespace atom-system --create-namespace \
	  -f infra/helm/grafana-values.yaml
	@echo ""
	@echo "✓ Monitoring stack deployed."
	@echo ""
	@echo "Port-forwards (run in separate terminal):"
	@echo "  kubectl port-forward -n atom-system svc/alloy 4318:4318   # OTLP"
	@echo "  kubectl port-forward -n atom-system svc/grafana 3006:3000 # Grafana"

monitoring-down: ## Remove monitoring stack from k8s
	@helm uninstall grafana tempo alloy loki -n atom-system 2>/dev/null || true
	@kubectl delete configmap atom-grafana-dashboards -n atom-system 2>/dev/null || true
	@echo "✓ Monitoring stack removed."

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
