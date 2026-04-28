# SESSION-13 — Monitoring Setup

**Prerequisites:** SESSION-03 complete (GATE running with OTEL)  
**Goal:** Deploy the full Grafana observability stack and instrument all services.  
**Estimated time:** 1 day

---

## Tasks

1. **Deploy Grafana stack** via Helm to `atom-system` namespace:
   ```bash
   helm upgrade --install grafana grafana/grafana -f infra/helm/grafana-values.yaml
   helm upgrade --install tempo grafana/tempo -f infra/helm/tempo-values.yaml
   helm upgrade --install alloy grafana/alloy -f infra/helm/alloy-values.yaml
   ```

2. **Grafana Alloy config** (`infra/helm/alloy-values.yaml`)
   - OTLP receiver on `0.0.0.0:4317` (gRPC) and `0.0.0.0:4318` (HTTP).
   - Forward traces to Tempo.
   - Forward metrics to Prometheus (built-in Grafana).

3. **OTEL instrumentation in GATE** (SESSION-03 started this — verify and extend)
   - Span attributes: `atom.domain_id`, `atom.agent_id`, `atom.token_type`, `atom.policy_decision`.
   - Metrics: `gate.requests.total` (counter), `gate.request.duration` (histogram),
     `gate.policy.denials.total` (counter).

4. **OTEL instrumentation in atom-llm** (`atom-llm/atom_extensions/otel.py`)
   - Span per LLM call with attributes: `llm.model`, `llm.agent_id`, `llm.prompt_tokens`.
   - Metric: `llm.tokens.total` (counter by model and agent).

5. **OTEL instrumentation in atom-studio** — FastAPI middleware for request traces.

6. **Grafana datasources** (provisioned via ConfigMap):
   - Tempo as trace datasource.
   - Prometheus as metrics datasource.

7. **Grafana dashboards** (JSON provisioned via ConfigMap in `infra/grafana/dashboards/`):
   - `gate-overview.json`: request rate, p50/p95/p99 latency, policy denial rate.
   - `agent-activity.json`: requests per agent, top agents by token usage.
   - `llm-usage.json`: tokens per model, per agent, per hour.
   - `audit-chain.json`: audit chain entry rate, chain validation status.

---

## Acceptance Criteria

- [ ] Grafana accessible at `http://localhost:3001`.
- [ ] Tempo datasource connected; traces visible for GATE requests.
- [ ] `gate-overview` dashboard shows request rate > 0 after a test request.
- [ ] Each GATE request appears as a trace with `atom.agent_id` attribute.
- [ ] `llm-usage` dashboard updates after an LLM call via atom-llm.

---

## Claude Code Starter Prompt

```
You are implementing SESSION-13 of ATOM — monitoring stack.

Context: GATE has OTEL SDK wired (SESSION-03). Alloy, Tempo, Grafana to be deployed via Helm.

Tasks:
1. Write infra/helm/alloy-values.yaml configuring OTLP receivers (4317/4318) and Tempo export
2. Write infra/helm/tempo-values.yaml for distributed trace storage
3. Write infra/helm/grafana-values.yaml with Tempo + Prometheus datasources provisioned
4. Deploy all three via helm upgrade --install to atom-system namespace
5. Verify GATE's OTEL instrumentation has span attributes: atom.domain_id, atom.agent_id
6. Add OTEL to atom-llm: span per LLM call with model + agent_id attributes
7. Add FastAPI OTEL middleware to atom-studio
8. Create four Grafana dashboard JSON files in infra/grafana/dashboards/ and provision via ConfigMap:
   - gate-overview: request rate, latency histogram, policy denial counter
   - agent-activity: per-agent request counts
   - llm-usage: token usage per model and agent
   - audit-chain: audit entry rate

After deployment, send 10 test requests through GATE and verify all appear in Tempo.
```

---

