"""
ATOM Runtime — FastAPI deployment controller.

Endpoints:
  POST /runtime/deploy              — kick off k8s rollout (from atom-studio after HITL approval)
  POST /runtime/rollback/{dep_id}   — restore previous image
  GET  /healthz                     — liveness probe
"""

import asyncio
import json
import logging
import os
from contextlib import asynccontextmanager

import httpx
from fastapi import FastAPI, BackgroundTasks
from kubernetes.client.exceptions import ApiException
from pydantic import BaseModel

from .config import get_settings
from .database import close_pool, get_conn, init_pool
from .k8s_client import get_k8s_clients
from .manifest_builder import (
    build_deployment,
    build_jwt_secret,
    build_network_policy,
    build_service,
    cluster_service_dns,
    resource_name,
)

logger = logging.getLogger(__name__)


def _setup_otel(app: FastAPI) -> None:
    endpoint = os.environ.get("OTEL_EXPORTER_OTLP_ENDPOINT", "").rstrip("/")
    if not endpoint:
        return
    try:
        import json  # noqa: PLC0415
        from opentelemetry import trace  # noqa: PLC0415
        from opentelemetry.exporter.otlp.proto.http.trace_exporter import OTLPSpanExporter  # noqa: PLC0415
        from opentelemetry.instrumentation.fastapi import FastAPIInstrumentor  # noqa: PLC0415
        from opentelemetry.sdk.resources import Resource  # noqa: PLC0415
        from opentelemetry.sdk.trace import TracerProvider  # noqa: PLC0415
        from opentelemetry.sdk.trace.export import BatchSpanProcessor  # noqa: PLC0415
        from opentelemetry.semconv.resource import ResourceAttributes  # noqa: PLC0415

        service_name = os.environ.get("OTEL_SERVICE_NAME", "atom-runtime")
        resource = Resource.create({ResourceAttributes.SERVICE_NAME: service_name})
        provider = TracerProvider(resource=resource)
        exporter = OTLPSpanExporter(endpoint=f"{endpoint}/v1/traces")
        provider.add_span_processor(BatchSpanProcessor(exporter))
        trace.set_tracer_provider(provider)
        FastAPIInstrumentor.instrument_app(app)

        class _JsonFmt(logging.Formatter):
            def format(self, record: logging.LogRecord) -> str:
                try:
                    ctx = trace.get_current_span().get_span_context()
                    tid = format(ctx.trace_id, "032x") if ctx and ctx.is_valid else ""
                except Exception:
                    tid = ""
                obj: dict = {
                    "time": self.formatTime(record, "%Y-%m-%dT%H:%M:%S"),
                    "level": record.levelname,
                    "logger": record.name,
                    "msg": record.getMessage(),
                    "service": service_name,
                }
                if tid:
                    obj["trace_id"] = tid
                if record.exc_info:
                    obj["error"] = self.formatException(record.exc_info)[:1000]
                return json.dumps(obj)

        handler = logging.StreamHandler()
        handler.setFormatter(_JsonFmt())
        logging.root.handlers = [handler]
        logging.root.setLevel(logging.INFO)

        logger.info("OTEL tracing enabled → %s (service=%s)", endpoint, service_name)
    except ImportError:
        logger.warning("opentelemetry packages not installed — OTEL tracing disabled")
    except Exception as exc:
        logger.warning("OTEL setup failed (%s) — tracing disabled", exc)


# ── Startup registration ──────────────────────────────────────────────────────


async def _register_with_studio() -> None:
    settings = get_settings()
    try:
        async with httpx.AsyncClient(timeout=10) as client:
            resp = await client.post(
                f"{settings.atom_studio_api_url}/api/runtime/register",
                json={"url": settings.atom_runtime_self_url},
            )
            resp.raise_for_status()
            logger.info("Registered with atom-studio at %s", settings.atom_studio_api_url)
    except Exception as exc:
        logger.warning("Could not register with atom-studio (will retry on next deploy): %s", exc)


@asynccontextmanager
async def lifespan(app: FastAPI):
    await init_pool()
    asyncio.create_task(_register_with_studio())
    yield
    await close_pool()


# ── App ───────────────────────────────────────────────────────────────────────

app = FastAPI(title="ATOM Runtime", version="0.1.0", lifespan=lifespan)
_setup_otel(app)


# ── Request / response models ─────────────────────────────────────────────────


class DeployRequest(BaseModel):
    deployment_id: str
    agent_id: str
    domain_id: str
    image: str
    memory_config_id: str | None = None
    agent_jwt: str  # issued by atom-studio; stored in k8s Secret


# ── Endpoints ─────────────────────────────────────────────────────────────────


@app.get("/healthz")
async def health():
    return {"status": "ok"}


@app.post("/runtime/deploy", status_code=202)
async def deploy(req: DeployRequest, background_tasks: BackgroundTasks):
    settings = get_settings()
    if settings.runtime_backend == "docker":
        background_tasks.add_task(run_deployment_docker, req)
    else:
        background_tasks.add_task(run_deployment, req)
    return {"deployment_id": req.deployment_id, "accepted": True}


@app.post("/runtime/rollback/{deployment_id}", status_code=202)
async def rollback(deployment_id: str, background_tasks: BackgroundTasks):
    settings = get_settings()
    if settings.runtime_backend == "docker":
        background_tasks.add_task(run_rollback_docker, deployment_id)
    else:
        background_tasks.add_task(run_rollback, deployment_id)
    return {"deployment_id": deployment_id, "accepted": True}


# ── Background tasks ──────────────────────────────────────────────────────────


async def run_deployment(req: DeployRequest) -> None:
    settings = get_settings()
    namespace = settings.agent_namespace
    gate_namespace = settings.gate_namespace

    try:
        apps_v1, core_v1, networking_v1 = get_k8s_clients()

        # Adjust resource sizing based on memory config
        cpu_req, cpu_lim = "100m", "500m"
        mem_req, mem_lim = "256Mi", "512Mi"
        if req.memory_config_id:
            try:
                async with get_conn() as conn:
                    mc = await conn.fetchrow(
                        "SELECT max_vectors FROM memory_configs WHERE id=$1",
                        req.memory_config_id,
                    )
                if mc and mc["max_vectors"] > 500_000:
                    mem_req, mem_lim = "512Mi", "1Gi"
            except Exception:
                pass

        # 1. JWT Secret — create or replace
        secret = build_jwt_secret(req.agent_id, req.agent_jwt, namespace)
        _apply_or_replace_secret(core_v1, namespace, secret)

        # 2. Deployment — create or replace
        dep_manifest = build_deployment(
            agent_id=req.agent_id,
            domain_id=req.domain_id,
            deployment_id=req.deployment_id,
            image=req.image,
            gate_url=settings.atom_gate_cluster_url,
            namespace=namespace,
            cpu_request=cpu_req,
            cpu_limit=cpu_lim,
            mem_request=mem_req,
            mem_limit=mem_lim,
            image_pull_secret=settings.image_pull_secret_name or None,
        )
        name = resource_name(req.agent_id)
        try:
            apps_v1.create_namespaced_deployment(namespace, dep_manifest)
        except ApiException as e:
            if e.status == 409:  # already exists — replace
                apps_v1.replace_namespaced_deployment(name, namespace, dep_manifest)
            else:
                raise

        # 3. Service — create once (ClusterIP never needs updating for a single agent)
        svc = build_service(req.agent_id, namespace)
        try:
            core_v1.create_namespaced_service(namespace, svc)
        except ApiException as e:
            if e.status != 409:
                raise

        # 4. NetworkPolicy — create once
        netpol = build_network_policy(req.agent_id, namespace, gate_namespace)
        try:
            networking_v1.create_namespaced_network_policy(namespace, netpol)
        except ApiException as e:
            if e.status != 409:
                raise

        # 5. Poll pod readiness
        ready = await _poll_pod_ready(
            core_v1,
            namespace,
            agent_id=req.agent_id,
            timeout=settings.pod_ready_timeout_s,
            interval=settings.pod_poll_interval_s,
        )

        # 6. Update Postgres
        svc_name = cluster_service_dns(req.agent_id, namespace)
        status = "deployed" if ready else "failed"
        async with get_conn() as conn:
            await conn.execute(
                "UPDATE deployments SET status=$1, deployed_at=now() WHERE id=$2",
                status,
                req.deployment_id,
            )
            if ready:
                await conn.execute(
                    """
                    UPDATE agents
                    SET status='deployed', cluster_service_name=$1, updated_at=now()
                    WHERE id=$2
                    """,
                    svc_name,
                    req.agent_id,
                )

        # 7. Notify studio
        error = None if ready else "Pod did not become Ready within timeout"
        await _notify_studio(req.deployment_id, status, error)

    except Exception as exc:
        logger.exception("Deployment %s failed: %s", req.deployment_id, exc)
        try:
            async with get_conn() as conn:
                await conn.execute(
                    "UPDATE deployments SET status='failed' WHERE id=$1",
                    req.deployment_id,
                )
        except Exception:
            pass
        await _notify_studio(req.deployment_id, "failed", str(exc))


async def run_rollback(deployment_id: str) -> None:
    settings = get_settings()
    namespace = settings.agent_namespace

    try:
        async with get_conn() as conn:
            dep = await conn.fetchrow(
                "SELECT agent_id, manifest_json FROM deployments WHERE id=$1",
                deployment_id,
            )
            if not dep:
                logger.error("Rollback: deployment %s not found", deployment_id)
                return

            agent_id = str(dep["agent_id"])
            prev = await conn.fetchrow(
                """
                SELECT id, manifest_json FROM deployments
                WHERE agent_id=$1 AND status='deployed' AND id != $2
                ORDER BY version DESC LIMIT 1
                """,
                agent_id,
                deployment_id,
            )

        if not prev:
            await _notify_studio(deployment_id, "failed", "No previous deployed version found")
            return

        prev_manifest = prev["manifest_json"]
        if isinstance(prev_manifest, str):
            prev_manifest = json.loads(prev_manifest)
        prev_image = prev_manifest.get("image")
        if not prev_image:
            await _notify_studio(deployment_id, "failed", "Previous manifest has no image")
            return

        # Patch deployment with previous image
        apps_v1, _, _ = get_k8s_clients()
        name = resource_name(agent_id)
        patch_body = {
            "spec": {"template": {"spec": {"containers": [{"name": "agent", "image": prev_image}]}}}
        }
        apps_v1.patch_namespaced_deployment(name, namespace, patch_body)

        async with get_conn() as conn:
            await conn.execute(
                "UPDATE deployments SET status='rolled_back' WHERE id=$1",
                deployment_id,
            )

        await _notify_studio(deployment_id, "rolled_back", None)

    except Exception as exc:
        logger.exception("Rollback %s failed: %s", deployment_id, exc)
        await _notify_studio(deployment_id, "failed", str(exc))


# ── Helpers ───────────────────────────────────────────────────────────────────


def _apply_or_replace_secret(core_v1, namespace: str, secret) -> None:
    name = secret.metadata.name
    try:
        core_v1.create_namespaced_secret(namespace, secret)
    except ApiException as e:
        if e.status == 409:
            core_v1.replace_namespaced_secret(name, namespace, secret)
        else:
            raise


async def _poll_pod_ready(
    core_v1,
    namespace: str,
    agent_id: str,
    timeout: int,
    interval: int,
) -> bool:
    label_selector = f"atom.io/agent-id={agent_id}"
    elapsed = 0
    while elapsed < timeout:
        try:
            pods = core_v1.list_namespaced_pod(namespace, label_selector=label_selector)
            for pod in pods.items:
                for cond in pod.status.conditions or []:
                    if cond.type == "Ready" and cond.status == "True":
                        logger.info("Pod for agent %s is Ready", agent_id)
                        return True
        except Exception as exc:
            logger.warning("Pod poll error: %s", exc)
        await asyncio.sleep(interval)
        elapsed += interval
    return False


async def _notify_studio(deployment_id: str, status: str, error: str | None) -> None:
    settings = get_settings()
    try:
        async with httpx.AsyncClient(timeout=10) as client:
            await client.post(
                f"{settings.atom_studio_api_url}/api/runtime/deploy-result",
                json={"deployment_id": deployment_id, "status": status, "error": error},
            )
    except Exception as exc:
        logger.warning("Could not notify studio for %s: %s", deployment_id, exc)


# ── Docker backend ────────────────────────────────────────────────────────────


async def run_deployment_docker(req: DeployRequest) -> None:
    from . import docker_backend  # noqa: PLC0415

    settings = get_settings()
    logger.info("Docker deploy: agent=%s image=%s", req.agent_id, req.image)

    try:
        ready, svc_addr = await docker_backend.deploy(
            agent_id=req.agent_id,
            domain_id=req.domain_id,
            image=req.image,
            agent_jwt=req.agent_jwt,
            gate_url=settings.docker_agent_gate_url,
            network=settings.docker_network,
        )

        status = "deployed" if ready else "failed"
        async with get_conn() as conn:
            await conn.execute(
                "UPDATE deployments SET status=$1, deployed_at=now() WHERE id=$2",
                status,
                req.deployment_id,
            )
            if ready:
                await conn.execute(
                    """
                    UPDATE agents
                    SET status='deployed', cluster_service_name=$1, updated_at=now()
                    WHERE id=$2
                    """,
                    svc_addr,
                    req.agent_id,
                )

        error = None if ready else "Container did not become healthy within timeout"
        await _notify_studio(req.deployment_id, status, error)

    except Exception as exc:
        logger.exception("Docker deployment %s failed: %s", req.deployment_id, exc)
        try:
            async with get_conn() as conn:
                await conn.execute(
                    "UPDATE deployments SET status='failed' WHERE id=$1", req.deployment_id
                )
        except Exception:
            pass
        await _notify_studio(req.deployment_id, "failed", str(exc))


async def run_rollback_docker(deployment_id: str) -> None:
    from . import docker_backend  # noqa: PLC0415

    settings = get_settings()
    try:
        async with get_conn() as conn:
            dep = await conn.fetchrow(
                "SELECT agent_id, manifest_json FROM deployments WHERE id=$1", deployment_id
            )
            if not dep:
                await _notify_studio(deployment_id, "failed", "Deployment not found")
                return

            agent_id = str(dep["agent_id"])
            prev = await conn.fetchrow(
                """
                SELECT manifest_json FROM deployments
                WHERE agent_id=$1 AND status='deployed' AND id != $2
                ORDER BY version DESC LIMIT 1
                """,
                agent_id,
                deployment_id,
            )
            if not prev:
                await _notify_studio(deployment_id, "failed", "No previous deployed version")
                return

            agent_row = await conn.fetchrow("SELECT domain_id FROM agents WHERE id=$1", agent_id)

        import json as _json  # noqa: PLC0415

        prev_manifest = prev["manifest_json"]
        if isinstance(prev_manifest, str):
            prev_manifest = _json.loads(prev_manifest)
        prev_image = prev_manifest.get("image")
        if not prev_image:
            await _notify_studio(deployment_id, "failed", "Previous manifest has no image")
            return

        ok = await docker_backend.rollback(
            agent_id=agent_id,
            prev_image=prev_image,
            domain_id=str(agent_row["domain_id"]) if agent_row else "",
            agent_jwt="",
            gate_url=settings.docker_agent_gate_url,
            network=settings.docker_network,
        )

        status = "rolled_back" if ok else "failed"
        async with get_conn() as conn:
            await conn.execute(
                "UPDATE deployments SET status=$1 WHERE id=$2", status, deployment_id
            )
        await _notify_studio(deployment_id, status, None if ok else "Docker rollback failed")

    except Exception as exc:
        logger.exception("Docker rollback %s failed: %s", deployment_id, exc)
        await _notify_studio(deployment_id, "failed", str(exc))
