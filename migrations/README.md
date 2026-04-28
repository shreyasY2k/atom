# Migrations

Managed by [golang-migrate](https://github.com/golang-migrate/migrate).

Files are created in **SESSION-02**. Each migration has an `up` and `down` file.

## Commands

```bash
make migrate-up       # apply all pending migrations
make migrate-down     # roll back latest migration
make migrate-status   # show current version
make seed-dev         # load seed_dev.sql
```

## Naming convention

```
000001_users_domains.up.sql
000001_users_domains.down.sql
000002_agents_tokens.up.sql
000002_agents_tokens.down.sql
...
```

## Expected files (created in SESSION-02)

| # | Up file | Tables |
|---|---|---|
| 1 | `000001_users_domains.up.sql` | users, domains |
| 2 | `000002_agents_tokens.up.sql` | agents, agent_tokens |
| 3 | `000003_policies_tools_skills.up.sql` | policies, agent_policies, tools, agent_tools, skills, agent_skills |
| 4 | `000004_memory_configs.up.sql` | memory_configs |
| 5 | `000005_audit_chain.up.sql` | audit_log_chain |
| 6 | `000006_deployments_hitl.up.sql` | deployments, hitl_workflows |
| 7 | `000007_memory_vectors.up.sql` | memory_vectors (pgvector + HNSW index) |
