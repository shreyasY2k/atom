# Session 10 — Domain/Subdomain Framework + Compliance Reports

**Date**: 2026-05-19  
**Branch**: production

---

## Problem Statement

1. **Tools are confusing** — 13 registered tools span 5 domains (banking-kyc, banking-fraud, banking-treasury, payments, general) but they appear as a flat unsorted list. Users can't tell which tools belong to which domain or when to use them together.

2. **No domain taxonomy** — Domain lives only in the spec YAML (`metadata.domain`). It's not in the agents DB table, not queryable, not filterable anywhere.

3. **No subdomain** — The spec only has one domain string (e.g., `banking-kyc`). There's no hierarchical `domain > subdomain` structure to group related concerns.

4. **Zero filtering** — Agent List, Tool Registry, Command Center, and Audit Events have no domain/subdomain filters.

5. **No compliance report** — No way to generate a per-agent compliance report from the audit trail.

---

## Domain / Subdomain Taxonomy

| Domain | Subdomain | Example agents |
|---|---|---|
| `banking` | `kyc` | kyc-refresh, kyc-document-extractor |
| `banking` | `fraud` | transaction-anomaly-triage |
| `banking` | `treasury` | treasury-liquidity-briefing |
| `banking` | `securities` | asset-recon |
| `payments` | `risk` | transaction-risk-analyzer |
| `payments` | `compliance` | ofac-screening-agent |
| `insurance` | `claims` | insurance-claim-ocr, medical-claim-classifier |
| `general` | `qa` | customer-qa-agent |
| `general` | `risk` | — |

Domains and subdomains are stored as free text (no closed enum) but the UI offers autocomplete from known values.

---

## Data Model Changes

### `agents` table — add columns
```sql
ALTER TABLE agents ADD COLUMN IF NOT EXISTS domain TEXT DEFAULT '';
ALTER TABLE agents ADD COLUMN IF NOT EXISTS subdomain TEXT DEFAULT '';
```

### `tools` table — add columns
```sql
ALTER TABLE tools ADD COLUMN IF NOT EXISTS domain TEXT DEFAULT '';
ALTER TABLE tools ADD COLUMN IF NOT EXISTS subdomain TEXT DEFAULT '';
```

### `compliance_reports` table (new)
```sql
CREATE TABLE IF NOT EXISTS compliance_reports (
    id             SERIAL PRIMARY KEY,
    report_id      TEXT NOT NULL UNIQUE,
    agent_name     TEXT NOT NULL,
    generated_by   TEXT NOT NULL,
    period_start   TIMESTAMPTZ,
    period_end     TIMESTAMPTZ,
    status         TEXT NOT NULL DEFAULT 'generating',
    report_md      TEXT,
    created_at     TIMESTAMPTZ DEFAULT NOW()
);
```

---

## API Changes

### New endpoints
- `GET /domains` — list all known domains + subdomains from the agents+tools tables
- `GET /agents?domain=banking&subdomain=kyc` — filter by domain/subdomain
- `GET /tools?domain=banking&subdomain=kyc` — filter by domain/subdomain
- `POST /agents/{name}/compliance-report` — kick off report generation (async)
- `GET /agents/{name}/compliance-report/{report_id}` — poll status + get report

### Compliance report content (LLM-generated via Gemini Flash)
Reads from: platform-db (llm_call_events, guardrail_events, agents, agent_runs), MinIO audit logs.

Sections:
1. Agent Identity & Deployment Summary
2. Activity Period & Volume (calls, sessions, tool invocations)
3. Guardrail Events (L1 blocks, L2 PII redactions, total vs period)
4. Data Handling (PII types detected, redaction rate)
5. Tool Usage (which tools called, frequency)
6. Audit Chain Integrity (HMAC-signed events in MinIO)
7. Risk Assessment & Recommendations

---

## UI Changes

### Builder Step 1 — domain/subdomain fields
- Domain: autocomplete dropdown (free text, shows known values)
- Subdomain: autocomplete, filtered by selected domain

### Agent List — filter bar
- Domain chip filter, Subdomain chip filter, Status filter (already implied)
- Show domain+subdomain as a `banking / kyc` badge on each agent card

### Tool Registry — filter + grouping
- Group tools by domain (accordions: General, Banking, Payments, Insurance)
- Within group: list tools with subdomain chip
- Filter bar at top

### Agent Detail — Compliance Report tab (new tab)
- "Generate Report" button with date range picker
- Shows report status (generating / done)
- Renders Markdown report inline
- Download as PDF/Markdown button

### Command Center — domain filter
- Top bar: domain/subdomain filter that narrows all panels

### Audit Events — domain filter
- Add domain/subdomain filter alongside existing actor_type filter

---

## Files Changed

### New
- `builder-backend/app/routes/domains.py`
- `builder-backend/app/routes/compliance.py`
- `frontend/src/pages/agents/ComplianceReport.tsx`

### Modified
- `builder-backend/app/core/registry_db.py` — new columns + query helpers
- `builder-backend/app/routes/registry.py` — GET /agents with domain filter
- `builder-backend/app/routes/tools.py` — GET /tools with domain filter
- `builder-backend/app/routes/agents.py` — domain/subdomain in deploy flow + generate
- `builder-backend/app/main.py` — register new routers
- `builder-backend/app/core/seed.py` — add domain/subdomain to seeded tools
- `frontend/src/api/builder.ts` — new API calls
- `frontend/src/pages/agents/Builder.tsx` — domain/subdomain step 1
- `frontend/src/pages/agents/List.tsx` — domain filter
- `frontend/src/pages/agents/Detail.tsx` — compliance report tab
- `frontend/src/pages/tools/Registry.tsx` — grouped + filtered
- `frontend/src/pages/CommandCenter.tsx` — domain filter
- `frontend/src/pages/audit/Events.tsx` — domain filter
- `frontend/src/App.tsx` — route

---

## DoD Checklist

- [ ] `agents` table has `domain` + `subdomain` columns, populated on deploy
- [ ] `tools` table has `domain` + `subdomain` columns, seeded tools updated
- [ ] `GET /agents?domain=banking` returns only banking agents
- [ ] `GET /tools?domain=banking&subdomain=kyc` returns only KYC tools
- [ ] `GET /domains` returns known taxonomy from DB
- [ ] Builder step 1: domain + subdomain fields with autocomplete
- [ ] Agent List: filter chips for domain/subdomain, badge on each row
- [ ] Tool Registry: grouped by domain accordion, subdomain chips
- [ ] Agent Detail: Compliance Report tab with generate + view
- [ ] Command Center: domain filter narrows all panels
- [ ] Audit Events: domain filter
- [ ] Compliance report generates in <30s with all required sections
