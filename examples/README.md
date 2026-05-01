# ATOM Example Agents

Four ready-to-run agents that demonstrate ATOM's capabilities.

## Agents

| Agent | Purpose | Sample question |
|-------|---------|-----------------|
| **financial-assistant** | BFSI compliance Q&A (RBI, SEBI, DPDP, PCI-DSS) | "What are RBI KYC requirements?" |
| **summarizer** | Document summariser — exec summary + key points | "Summarise: ..." |
| **risk-checker** | Financial risk assessment + recommended controls | "Assess this transaction..." |
| **support-bot** | Customer support for an Indian fintech | "My card hasn't arrived..." |

## Quick provision (one command)

```bash
# Docker Compose (default — stack must be running)
pip install httpx
python examples/provision.py

# Kubernetes (kind cluster must be running)
python examples/provision.py --mode k8s

# Custom studio URL
python examples/provision.py --studio http://api.atom.local
```

The script will:
1. Login to atom-studio as admin
2. Create an `examples` domain
3. Create all 4 agents (prints one-time JWT tokens)
4. Build Docker images for each agent
5. Submit deployments and **auto-approve** HITL
6. Wait for agents to be ready
7. Print `curl` commands to chat with each agent

## Manual workflow (alternative)

If you prefer step-by-step control:

```bash
# 1. Start the stack
docker compose up -d               # or: make k8s-deploy
make migrate-dev && make seed-dev  # first run only

# 2. Create agent in UI
open http://localhost:3000         # Studio UI
# Domains → New → "examples"
# Agents → New → fill wizard → copy the JWT token shown once

# 3. CLI workflow
make cli-build                     # builds bin/atom
bin/atom login                     # enter studio URL + admin credentials
bin/atom create                    # interactive wizard → creates project dir
cd <project-dir>
# Edit .env: set ATOM_AGENT_JWT=<token from step 2>
bin/atom deploy                    # build + submit deployment
# Back in Studio: HITL queue → Approve

# 4. Chat
curl -X POST http://localhost:8080/domain/<domain-id>/agent/<agent-id>/run \
  -H "Authorization: Bearer <agent-jwt>" \
  -H "Content-Type: application/json" \
  -d '{"message": "Hello!"}'
```

## Chat examples after provision

```bash
# Financial Assistant
curl -s -X POST http://localhost:8080/domain/<did>/agent/<aid>/run \
  -H "Authorization: Bearer <jwt>" \
  -H "Content-Type: application/json" \
  -d '{"message": "What are the KYC requirements under RBI Master Direction 2016?"}' \
  | python3 -m json.tool

# Risk Checker
curl -s -X POST http://localhost:8080/domain/<did>/agent/<aid>/run \
  -H "Authorization: Bearer <jwt>" \
  -H "Content-Type: application/json" \
  -d '{"message": "Customer sending Rs 50 lakh overseas to new beneficiary in high-risk jurisdiction. Assess risk."}' \
  | python3 -m json.tool
```

> The provision script prints the exact curl commands with real IDs and tokens at the end.
