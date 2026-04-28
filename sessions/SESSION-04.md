# SESSION-04 — GATE + OPA Integration

**Prerequisites:** SESSION-03 complete (GATE core running)  
**Goal:** Wire OPA in-process into GATE and write the baseline Rego policy set.  
**Estimated time:** 1.5 days

---

## Tasks

1. **Add OPA Go SDK** to `gate/go.mod`  
   `github.com/open-policy-agent/opa v0.65+`

2. **OPA manager** (`gate/internal/policy/opa.go`)
   - Load policies from `policies/` at startup.
   - Hot-reload via `rego.PrepareForEval` on file-change watch (`fsnotify`).
   - Evaluate policy: `data.atom.authz.allow` — returns `{allow: bool, reason: string}`.

3. **OPA middleware** (`gate/internal/policy/middleware.go`)
   - Build OPA input from request context:
     ```json
     {
       "token": { "sub": "...", "type": "agent|human", "domain_id": "...", "agent_id": "..." },
       "request": { "method": "POST", "path": "/domain/.../agent/.../...", "headers": {...} },
       "agent": { "tools": [...], "skills": [...], "policies": [...] }
     }
     ```
   - Deny with `403 Forbidden` + `reason` if `allow == false`.
   - Append OPA decision to audit log event.

4. **Baseline Rego policies** in `policies/base/`:

   `agent_auth.rego`:
   ```rego
   package atom.authz
   import future.keywords.if
   import future.keywords.in

   default allow := false

   allow if {
     input.token.type == "agent"
     input.token.agent_id == path_agent_id
     not is_revoked
   }

   allow if {
     input.token.type == "human"
     input.token.role in {"admin", "developer"}
   }

   path_agent_id := agent_id if {
     parts := split(input.request.path, "/")
     agent_id := parts[4]  # /domain/{did}/agent/{aid}/...
   }

   is_revoked if {
     input.token.revoked == true
   }
   ```

   `domain_isolation.rego`:
   ```rego
   package atom.authz
   # Agent tokens can only call agents in their own domain
   deny[{"reason": "cross-domain access denied"}] if {
     input.token.type == "agent"
     input.token.domain_id != path_domain_id
   }

   path_domain_id := domain_id if {
     parts := split(input.request.path, "/")
     domain_id := parts[2]
   }
   ```

   `tool_access.rego`:
   ```rego
   package atom.authz
   # Agent can only call tools it has been provisioned with
   deny[{"reason": "tool not permitted for agent"}] if {
     startswith(input.request.path, "/tools/")
     tool_name := split(input.request.path, "/")[2]
     not tool_name in input.agent.tools
   }
   ```

   `PLACEHOLDER_bfsi_compliance.rego`:
   ```rego
   package atom.bfsi
   # Placeholder — SOC2/PCI-DSS/GDPR/ISO27001/DORA policies to be added here
   # when compliance requirements are formalised.
   default compliant := true
   ```

5. **Rego unit tests** (`policies/tests/`)
   - Test each policy with valid and invalid inputs using `opa test`.
   - Add `make policy-test` target.

6. **OPA bundle build** (`make policy-bundle`)  
   Compiles `policies/` to a signed bundle for production deployment.

7. **Integration test**: request with valid agent token but wrong domain returns 403.

---

## Technologies

| Technology | Rationale |
|---|---|
| OPA Go SDK (in-process) | No network hop for policy decisions; < 1ms eval time |
| fsnotify | File-watch for hot-reload without restart |
| Rego | Declarative, testable, BFSI policy community templates available |

---

## Acceptance Criteria

- [ ] Request with correct agent JWT + correct domain → 200 from upstream.
- [ ] Request with correct agent JWT + wrong domain_id in path → 403 with `"cross-domain access denied"`.
- [ ] Request for tool not in agent's tool list → 403 `"tool not permitted"`.
- [ ] `make policy-test` → `PASS` (all Rego unit tests).
- [ ] Editing a `.rego` file → GATE picks up change within 5 seconds without restart.
- [ ] OPA decision (allow/deny + reason) appears in `audit_log_chain` event JSON.

---

## Claude Code Starter Prompt

```
You are implementing SESSION-04 of ATOM — OPA policy engine integration in GATE.

Context: GATE (SESSION-03) is running. OPA is deployed in the kind cluster.
We are embedding OPA in-process inside GATE using github.com/open-policy-agent/opa.

Tasks:
1. Add github.com/open-policy-agent/opa to gate/go.mod
2. Create gate/internal/policy/opa.go:
   - OPAManager struct that loads policies from policies/ directory at startup
   - PrepareForEval on the `data.atom.authz.allow` query
   - Hot-reload via fsnotify watching policies/ directory
3. Create gate/internal/policy/middleware.go:
   - OPAPolicyMiddleware for Fiber
   - Build input object from JWT claims + request path + agent tools/skills from Postgres
   - Deny with 403 if allow == false, include reason in response
   - Append OPA decision to the audit event
4. Write policies/base/agent_auth.rego — allow agent tokens for their own agent_id
5. Write policies/base/domain_isolation.rego — deny cross-domain calls
6. Write policies/base/tool_access.rego — deny tools not in agent's provisioned list
7. Write policies/base/PLACEHOLDER_bfsi_compliance.rego — empty compliant := true placeholder
8. Write policies/tests/agent_auth_test.rego — OPA unit tests using opa test format

The OPA input schema should be:
{
  "token": { "sub", "type", "domain_id", "agent_id", "role", "revoked" },
  "request": { "method", "path", "headers" },
  "agent": { "tools": [...], "skills": [...] }
}

Run `make policy-test` after writing the Rego files.
```

---

