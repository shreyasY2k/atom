# Helm Values

All Helm chart value override files live here. Created during **SESSION-01** and **SESSION-13**.

| File | Chart | Session |
|---|---|---|
| `postgres-values.yaml` | bitnami/postgresql | SESSION-01 |
| `redis-values.yaml` | bitnami/redis | SESSION-01 |
| `minio-values.yaml` | minio/minio | SESSION-01 |
| `redpanda-values.yaml` | redpanda/redpanda | SESSION-01 |
| `nginx-values.yaml` | ingress-nginx/ingress-nginx | SESSION-01 |
| `grafana-values.yaml` | grafana/grafana | SESSION-13 |
| `tempo-values.yaml` | grafana/tempo | SESSION-13 |
| `alloy-values.yaml` | grafana/alloy | SESSION-13 |

## Usage

```bash
helm upgrade --install <release> <chart-repo>/<chart> \
  --namespace atom-infra \
  -f infra/helm/<name>-values.yaml \
  --wait
```
