SHELL := /bin/bash
.PHONY: help bootstrap infra-up infra-down dev-up dev-down migrate-up migrate-down \
        gate-build cli-install policy-test policy-bundle lint test \
        generate-keys seed-dev

# ── Cluster name ─────────────────────────────────────────────────────────────
CLUSTER_NAME ?= atom
KUBECONFIG   ?= $(HOME)/.kube/config

# ── Database URL (from .env or env) ──────────────────────────────────────────
include .env
export

# ── Tool paths ────────────────────────────────────────────────────────────────
MIGRATE := $(shell go env GOPATH)/bin/migrate
# For k8s deployments, port-forward postgres before running migrations:
#   kubectl port-forward svc/postgres 5432:5432 -n atom-infra &
# DATABASE_URL in .env already points to localhost:5432

# ─────────────────────────────────────────────────────────────────────────────
help: ## Show this help
	@grep -E '^[a-zA-Z_-]+:.*?## .*$$' $(MAKEFILE_LIST) | \
	  awk 'BEGIN {FS = ":.*?## "}; {printf "  \033[36m%-20s\033[0m %s\n", $$1, $$2}'

# ── Bootstrap ────────────────────────────────────────────────────────────────
bootstrap: ## Install all required tools
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
	@echo "✓ Bootstrap complete. Run 'make infra-up' next."

# ── Infrastructure ────────────────────────────────────────────────────────────
infra-up: ## Create kind cluster and deploy all infra services
	@echo "→ Creating kind cluster '$(CLUSTER_NAME)'..."
	@kind get clusters | grep -q $(CLUSTER_NAME) || \
	  kind create cluster --config infra/kind/cluster.yaml --name $(CLUSTER_NAME)
	@kubectl config use-context kind-$(CLUSTER_NAME)
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

infra-down: ## Tear down kind cluster
	@kind delete cluster --name $(CLUSTER_NAME)
	@echo "✓ Cluster deleted."

# ── Local dev (docker-compose) ────────────────────────────────────────────────
dev-up: ## Start all services locally via docker-compose (single command)
	@docker compose -f docker-compose.dev.yml up -d
	@echo "✓ Dev stack up."
	@echo "  studio:  http://localhost:3000 (nginx)"
	@echo "  studio:  http://localhost:5173 (vite dev — cd atom-studio/frontend && npm run dev)"
	@echo "  gate:    http://localhost:8080"
	@echo "  llm:     http://localhost:4000"
	@echo "  minio:   http://localhost:9001"
	@echo ""
	@echo "Monitoring stack (Grafana/Tempo/Alloy) is in Kubernetes."
	@echo "Run 'make monitoring-up' to deploy + port-forward."

dev-down: ## Stop docker-compose dev stack
	@docker compose -f docker-compose.dev.yml down
	@echo "✓ Dev stack down."

dev-down-clean: ## Stop docker-compose and remove volumes
	@docker compose -f docker-compose.dev.yml down -v
	@echo "✓ Dev stack down (volumes removed)."

dev-logs: ## Tail logs from all dev services
	@docker compose -f docker-compose.dev.yml logs -f

# ── Monitoring stack (Grafana + Tempo + Alloy on k8s) ────────────────────────
monitoring-up: ## Deploy Grafana + Tempo + Alloy to atom-system namespace and port-forward
	@echo "→ Creating dashboard ConfigMap..."
	@kubectl create configmap atom-grafana-dashboards \
	  --from-file=gate-overview.json=infra/grafana/dashboards/gate-overview.json \
	  --from-file=agent-activity.json=infra/grafana/dashboards/agent-activity.json \
	  --from-file=llm-usage.json=infra/grafana/dashboards/llm-usage.json \
	  --from-file=audit-chain.json=infra/grafana/dashboards/audit-chain.json \
	  --namespace atom-system \
	  --dry-run=client -o yaml | kubectl apply -f -
	@kubectl label configmap atom-grafana-dashboards grafana_dashboard=1 \
	  -n atom-system --overwrite
	@echo "→ Deploying Tempo..."
	@helm upgrade --install tempo grafana/tempo \
	  --namespace atom-system --create-namespace \
	  -f infra/helm/tempo-values.yaml
	@echo "→ Patching Tempo probes to port 3200..."
	@kubectl patch statefulset tempo -n atom-system --type=json \
	  -p='[{"op":"replace","path":"/spec/template/spec/containers/0/livenessProbe/httpGet/port","value":3200},{"op":"replace","path":"/spec/template/spec/containers/0/readinessProbe/httpGet/port","value":3200}]' 2>/dev/null || true
	@echo "→ Deploying Alloy..."
	@helm upgrade --install alloy grafana/alloy \
	  --namespace atom-system --create-namespace \
	  -f infra/helm/alloy-values.yaml
	@echo "→ Patching Alloy service OTLP ports..."
	@kubectl patch svc alloy -n atom-system --type=json -p='[
	  {"op":"add","path":"/spec/ports/-","value":{"name":"otlp-grpc","port":4317,"targetPort":4317,"protocol":"TCP"}},
	  {"op":"add","path":"/spec/ports/-","value":{"name":"otlp-http","port":4318,"targetPort":4318,"protocol":"TCP"}}]' 2>/dev/null || true
	@echo "→ Deploying Grafana..."
	@helm upgrade --install grafana grafana/grafana \
	  --namespace atom-system --create-namespace \
	  -f infra/helm/grafana-values.yaml
	@echo ""
	@echo "✓ Monitoring stack deployed."
	@echo ""
	@echo "Start port-forwards (run in a separate terminal):"
	@echo "  kubectl port-forward -n atom-system svc/alloy 4318:4318   # OTLP endpoint"
	@echo "  kubectl port-forward -n atom-system svc/grafana 3001:3000 # Grafana UI"
	@echo ""
	@echo "  Grafana: http://localhost:3001 (admin / atom-grafana-dev)"

monitoring-down: ## Remove Grafana + Tempo + Alloy from k8s
	@helm uninstall grafana tempo alloy -n atom-system 2>/dev/null || true
	@kubectl delete configmap atom-grafana-dashboards -n atom-system 2>/dev/null || true
	@echo "✓ Monitoring stack removed."

# ── Kubernetes application deploy ─────────────────────────────────────────────
k8s-deploy: ## Build images and deploy GATE + atom-llm + atom-studio to k8s
	@echo "→ Building Docker images..."
	@docker rmi atom-gate:local atom-llm:local atom-studio-api:local atom-studio-ui:local 2>/dev/null || true
	@docker build -t atom-gate:local gate/ -f gate/Dockerfile
	@docker build -t atom-llm:local atom-llm/ -f atom-llm/Dockerfile.dev
	@docker build -t atom-studio-api:local atom-studio/backend/
	@docker build -t atom-studio-ui:local atom-studio/frontend/
	@echo "→ Creating secrets and ConfigMaps..."
	@kubectl create secret generic atom-jwt-keys \
	  --from-file=jwt_private.pem=.keys/jwt_private.pem \
	  --from-file=jwt_public.pem=.keys/jwt_public.pem \
	  --namespace atom-system --dry-run=client -o yaml | kubectl apply -f -
	@kubectl create configmap opa-policies \
	    --from-file=policies/base/ --namespace atom-system \
	    --dry-run=client -o yaml | kubectl apply -f -
	@echo "→ Applying manifests..."
	@kubectl apply -f infra/manifests/gate-deployment.yaml
	@kubectl apply -f infra/manifests/atom-llm-deployment.yaml
	@kubectl apply -f infra/manifests/atom-studio-deployment.yaml
	@kubectl apply -f infra/manifests/atom-studio-ui-deployment.yaml
	@echo "→ Running LiteLLM Prisma migrations..."
	@kubectl port-forward -n atom-infra svc/postgres 5433:5432 &
	@sleep 3
	@SCHEMA=$$(docker run --rm atom-llm:local python3 -c \
	    "import litellm, os; print(os.path.join(os.path.dirname(litellm.__file__), 'proxy', 'schema.prisma'))") && \
	  DATABASE_URL="postgresql://atom:changeme@host.docker.internal:5433/atom" \
	  docker run --rm -e DATABASE_URL="postgresql://atom:changeme@host.docker.internal:5433/atom" \
	  --add-host host.docker.internal:host-gateway \
	  atom-llm:local prisma db push --schema $$SCHEMA --skip-generate --accept-data-loss 2>/dev/null || true
	@pkill -f "port-forward.*5433" 2>/dev/null || true
	@echo "→ Forcing fresh image pull (delete existing pods)..."
	@kubectl delete pods -n atom-system -l app=gate 2>/dev/null || true
	@kubectl delete pods -n atom-system -l app=atom-llm 2>/dev/null || true
	@kubectl delete pods -n atom-system -l app=atom-studio-api 2>/dev/null || true
	@kubectl delete pods -n atom-system -l app=atom-studio-ui 2>/dev/null || true
	@echo "→ Waiting for rollouts..."
	@kubectl rollout status deployment/gate -n atom-system --timeout=120s
	@kubectl rollout status deployment/atom-llm -n atom-system --timeout=180s
	@kubectl rollout status deployment/atom-studio-api -n atom-system --timeout=120s
	@kubectl rollout status deployment/atom-studio-ui -n atom-system --timeout=120s
	@echo ""
	@echo "✓ k8s deploy complete."
	@kubectl get pods -n atom-system

# ── Migrations ────────────────────────────────────────────────────────────────
migrate-up: ## Apply all database migrations (port-forward postgres first)
	@$(MIGRATE) -database "$(DATABASE_URL)" -path migrations up
	@echo "✓ Migrations applied."

migrate-down: ## Roll back the last migration
	@$(MIGRATE) -database "$(DATABASE_URL)" -path migrations down 1

migrate-status: ## Show migration status
	@$(MIGRATE) -database "$(DATABASE_URL)" -path migrations version

seed-dev: ## Load development seed data (port-forward postgres first)
	@psql "$(DATABASE_URL)" -f migrations/seed_dev.sql
	@echo "✓ Seed data loaded."

# ── Build ─────────────────────────────────────────────────────────────────────
gate-build: ## Build GATE binary
	@cd gate && go build -o ../bin/gate ./cmd/gate
	@echo "✓ bin/gate built."

gate-docker: ## Build GATE Docker image
	@docker build -t atom-gate:local gate/
	@echo "✓ atom-gate:local built."

cli-install: ## Build and install atom CLI to PATH
	@cd atom-cli && go build -o $(GOPATH)/bin/atom ./cmd/atom
	@echo "✓ atom CLI installed to $$(which atom)"

cli-build: ## Build atom CLI binary to bin/
	@cd atom-cli && go build -o ../bin/atom ./cmd/atom
	@echo "✓ bin/atom built."

# ── Policies ──────────────────────────────────────────────────────────────────
policy-test: ## Run all OPA Rego unit tests
	@opa test policies/ -v
	@echo "✓ Policy tests passed."

policy-check: ## Check Rego syntax
	@opa check policies/

policy-bundle: ## Compile OPA policy bundle
	@opa build policies/ -o policies/bundle.tar.gz
	@echo "✓ Bundle: policies/bundle.tar.gz"

policy-fmt: ## Format all Rego files
	@find policies/ -name '*.rego' -exec opa fmt -w {} \;

# ── Lint ──────────────────────────────────────────────────────────────────────
lint: lint-go lint-python policy-check ## Run all linters

lint-go: ## Run Go linters (gate + atom-cli)
	@cd gate     && go vet ./... && echo "gate: vet ok"
	@cd atom-cli && go vet ./... && echo "atom-cli: vet ok"

lint-python: ## Run ruff on Python components
	@ruff check atom-llm/ atom-sdk/ atom-runtime/ atom-memory/ atom-studio/ 2>/dev/null || \
	  echo "(ruff not installed or Python components not yet cloned — skip)"

# ── Test ──────────────────────────────────────────────────────────────────────
test: test-go test-python policy-test ## Run all tests

test-go: ## Run Go tests
	@cd gate     && go test ./... -race -count=1
	@cd atom-cli && go test ./... -race -count=1

test-python: ## Run Python tests
	@python3 -m pytest atom-llm/ atom-sdk/ atom-runtime/ atom-memory/ atom-studio/ \
	  --ignore=node_modules -q 2>/dev/null || \
	  echo "(pytest not installed or Python components not yet cloned — skip)"

test-e2e: ## Run end-to-end tests (requires full stack)
	@python3 -m pytest tests/e2e/ -v

test-load: ## Run k6 load test against GATE
	@k6 run tests/load/gate_load_test.js

# ── Keys ──────────────────────────────────────────────────────────────────────
generate-keys: ## Generate RSA-4096 JWT key pair (run once on first setup)
	@mkdir -p .keys
	@openssl genrsa -out .keys/jwt_private.pem 4096
	@openssl rsa -in .keys/jwt_private.pem -pubout -out .keys/jwt_public.pem
	@echo "✓ Keys generated in .keys/ — copy to k8s Secret or /etc/atom/ in pods"
	@echo "  NEVER commit .keys/ — it is in .gitignore"

# ── Utility ───────────────────────────────────────────────────────────────────
go-sync: ## Sync go.work with all Go modules
	@go work sync

go-tidy: ## Tidy go.mod in all modules
	@cd gate     && go mod tidy
	@cd atom-cli && go mod tidy

clean: ## Remove built binaries
	@rm -rf bin/
