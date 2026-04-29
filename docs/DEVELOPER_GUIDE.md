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
atom login --studio http://localhost:3000

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

| Feature | docker-compose (`make dev-up`) | kind k8s (`make k8s-deploy`) |
|---------|-------------------------------|------------------------------|
| GATE URL | `http://localhost:8080` | port-forward `svc/gate 8080:8080` |
| Studio URL | `http://localhost:3001` | port-forward `svc/atom-studio-api 3001:3001` |
| Agent JWT | issued by studio at agent creation | same — RS256 RS4096 key pair |
| Agent pods | docker containers via atom-runtime docker backend | Kubernetes pods in `atom-agents` ns |
| ATOM_MODE env | `development` (no k8s RBAC needed) | `production` (full NetworkPolicy enforcement) |
| LiteLLM DB | local Postgres | in-cluster Postgres (atom-infra) |

**Set prod mode in your agent project:**
```bash
export ATOM_MODE=prod
export ATOM_GATE_URL=http://localhost:8080   # via port-forward
export ATOM_AGENT_JWT=<token-from-studio>
atom validate    # must exit 0
atom deploy      # submits to k8s via HITL
```

**Useful port-forwards for k8s dev:**
```bash
kubectl port-forward svc/gate            8080:8080 -n atom-system &
kubectl port-forward svc/atom-studio-api 3001:3001 -n atom-system &
kubectl port-forward svc/atom-llm        4000:4000 -n atom-system &
kubectl port-forward svc/postgres        5432:5432 -n atom-infra  &
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
