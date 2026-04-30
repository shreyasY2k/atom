# ATOM Developer Guide

How to build an agent, test locally (docker-compose) and in production (kind k8s),
add tools, and write Rego policies.

---

## 1. Build Your First Agent

### Prerequisites
- All sessions SESSION-00 through SESSION-10 complete.
- `atom` CLI installed (`make cli-install`).
- Stack running (`make dev-up` or kind cluster up).

### Steps

```bash
# 1. Log in to atom-studio
# k8s:           atom login --studio http://api.atom.local:8088
# docker-compose: atom login --studio http://localhost:3001

# 2. In atom-studio: create a domain, then create an agent
#    Copy the one-time token shown after creation

# 3. Scaffold the project
atom create agent eyJhbGciOiJSUzI1NiIsInR5cCI6IkpXVCJ9...
cd my-agent/

# 4. Validate
atom validate   # should exit 0

# 5. Edit agent.py to add your logic
# 6. Build and deploy
atom deploy
# Approve in atom-studio HITL queue
# Agent goes live at /domain/{did}/agent/{aid}
```

---

## 2. Agent Code Patterns

### Minimal agent with LLM call

```python
# agent.py
import os
from agentscope.agents import DialogAgent
from agentscope.models import AtomModelWrapper

def main():
    atom_agent = DialogAgent(
        name="my-agent",
        model_config_name="atom-default",
        sys_prompt="You are a helpful BFSI assistant.",
    )

    response = atom_agent({"role": "user", "content": "Summarise my account."})
    print(response.content)

if __name__ == "__main__":
    main()
```

### Agent with memory

```python
from agentscope.hitl import MemoryManager

memory = MemoryManager()  # reads config from ATOM env vars

# Store a fact
memory.remember("Customer 4821 credit limit is 75000")

# Recall relevant memories before LLM call
memories = memory.recall("credit limit", top_k=3)
context = "\n".join(m["content"] for m in memories)
```

### Agent with HITL pause

```python
from agentscope.hitl import request_human_decision

def approve_large_transaction(amount: float) -> bool:
    if amount > 50_000:
        decision = request_human_decision(
            payload={"action": "approve_transfer", "amount": amount},
            timeout_s=300,
        )
        return decision["approved"]
    return True
```

---

## 3. Testing Locally Against docker-compose

```bash
# Start the stack
make dev-up

# Run migrations
make migrate-up

# Run your agent locally (not in k8s) — uses .env for credentials
source .env
python agent.py

# Or point atom-sdk at the local GATE
ATOM_GATE_URL=http://localhost:8080 \
ATOM_AGENT_JWT=<token> \
python agent.py
```

---

## 4. Add a New Tool

A tool is an HTTP endpoint that an agent can call via GATE.

```bash
# 1. Implement the tool as a service (any language, any framework)
#    Expose POST /invoke with JSON body and response

# 2. Register it in atom-studio: Tools → New Tool
#    Name: lookup-customer
#    Endpoint: http://my-tool-service.atom-system.svc:8080/invoke
#    Schema: (paste JSON Schema for the input body)

# 3. Provision it to agents: Agent detail → Edit → add tool

# 4. In your agent code, call it via GATE (atom-sdk handles routing):
result = atom_agent.use_tool("lookup-customer", {"customer_id": "4821"})
```

---

## 5. Write a Rego Policy

```bash
# 1. Create the file
cat > policies/base/my_rule.rego << 'EOF'
package atom.authz
import future.keywords.if

deny[{"reason": "example deny"}] if {
    input.request.method == "DELETE"
    input.token.role != "admin"
}
EOF

# 2. Write a test
cat > policies/tests/my_rule_test.rego << 'EOF'
package atom.authz_test
import future.keywords.if

test_deny_delete_non_admin if {
    deny[{"reason": "example deny"}] with input as {
        "request": {"method": "DELETE"},
        "token": {"role": "developer"},
    }
}
EOF

# 3. Test it
make policy-test

# 4. Hot-reload: GATE watches policies/ and reloads within 5s
#    No restart needed in dev.
```

---

## 6. Local Dev vs Prod Mode

| Feature | docker-compose (`make dev-up`) | Kubernetes (`make k8s-deploy` + `make ingress-up`) |
|---------|-------------------------------|------------------------------|
| Studio login | http://localhost:3000 — admin@atom.local / **admin123** | http://studio.atom.local:8088 — admin@atom.local / **admin123** |
| GATE URL | http://localhost:8080 | http://gate.atom.local:8088 |
| Studio API | http://localhost:3001 | http://api.atom.local:8088 |
| Grafana | http://localhost:3005 — admin/**admin** | http://grafana.atom.local:8088 — admin/**atom-grafana-dev** |
| MinIO | http://localhost:9001 — minioadmin/**changeme** | http://minio-ui.atom.local:8088 — minioadmin/**changeme** |
| Postgres | localhost:5432 — atom/**changeme** | localhost:5432 (TCP via ingress) — atom/**changeme** |
| Agent pods | Docker containers (atom-runtime docker backend) | Kubernetes pods in `atom-agents` ns |

**Deploy to k8s:**
```bash
make ingress-up   # exposes all services at *.atom.local:8088

# Login, create domain + agent in Studio, then:
bin/atom deploy \
  --agent-id <uuid> \
  --skip-build \
  --image <your-image> \
  --message "initial deploy"
# Approve at http://studio.atom.local:8088/hitl
```

---

## 7. Commit Convention

All commits must follow [Conventional Commits](https://www.conventionalcommits.org/):

```
feat(gate):    add rate-limit headers to 429 responses
fix(atom-sdk): correct JWT header name in AtomModelWrapper
chore(infra):  bump postgres helm chart to 14.0.1
test(policies): add cross-domain denial test case
docs(sessions): clarify SESSION-05 acceptance criteria
```

Allowed types: `feat`, `fix`, `chore`, `docs`, `test`, `refactor`, `perf`, `ci`, `build`, `revert`
Allowed scopes: `gate`, `atom-llm`, `atom-sdk`, `atom-runtime`, `atom-memory`, `atom-studio`, `atom-cli`, `policies`, `infra`, `migrations`, `docs`, `sessions`, `deps`, `all`
