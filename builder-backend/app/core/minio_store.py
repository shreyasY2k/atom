"""MinIO-backed storage for agent specs and role markdowns."""

import os

import boto3
from fastapi import HTTPException


def _s3():
    return boto3.client(
        "s3",
        endpoint_url=f"http://{os.environ.get('MINIO_ENDPOINT', 'minio:9000')}",
        aws_access_key_id=os.environ.get("MINIO_ACCESS_KEY", "minioadmin"),
        aws_secret_access_key=os.environ.get("MINIO_SECRET_KEY", "minioadmin"),
        region_name="us-east-1",
    )


_BUCKET = "specs"


def _put(key: str, body: str, content_type: str = "text/plain") -> None:
    _s3().put_object(
        Bucket=_BUCKET,
        Key=key,
        Body=body.encode("utf-8"),
        ContentType=content_type,
    )


def _get(key: str) -> str:
    obj = _s3().get_object(Bucket=_BUCKET, Key=key)
    return obj["Body"].read().decode("utf-8")


def _exists(key: str) -> bool:
    try:
        _s3().head_object(Bucket=_BUCKET, Key=key)
        return True
    except Exception:
        return False


# ---------------------------------------------------------------------------
# Draft (mutable) operations
# ---------------------------------------------------------------------------

def write_draft_spec(name: str, spec_yaml: str) -> None:
    """Write spec YAML to specs/agents/{name}/draft/spec.yaml."""
    _put(f"agents/{name}/draft/spec.yaml", spec_yaml, "text/yaml")


def write_draft_role(name: str, role_md: str) -> None:
    """Write role markdown to specs/agents/{name}/draft/role.md."""
    _put(f"agents/{name}/draft/role.md", role_md, "text/markdown")


def read_draft_spec(name: str) -> str:
    """Read draft spec YAML. Raises HTTPException 404 if missing."""
    key = f"agents/{name}/draft/spec.yaml"
    try:
        return _get(key)
    except Exception:
        raise HTTPException(404, f"No draft spec found for agent '{name}'. Run /generate first.")


def read_draft_role(name: str) -> str | None:
    """Read draft role markdown. Returns None if missing."""
    key = f"agents/{name}/draft/role.md"
    try:
        return _get(key)
    except Exception:
        return None


def draft_exists(name: str) -> bool:
    """Return True if a draft spec exists for this agent."""
    return _exists(f"agents/{name}/draft/spec.yaml")


# ---------------------------------------------------------------------------
# Versioned (immutable on deploy) operations
# ---------------------------------------------------------------------------

def write_versioned(name: str, version: int, spec_yaml: str, role_md: str | None) -> None:
    """Write immutable versioned copies to specs/agents/{name}/versions/{version}/."""
    _put(f"agents/{name}/versions/{version}/spec.yaml", spec_yaml, "text/yaml")
    if role_md is not None:
        _put(f"agents/{name}/versions/{version}/role.md", role_md, "text/markdown")


def read_versioned_spec(name: str, version: int) -> str:
    """Read versioned spec YAML. Raises HTTPException 404 if missing."""
    key = f"agents/{name}/versions/{version}/spec.yaml"
    try:
        return _get(key)
    except Exception:
        raise HTTPException(404, f"No versioned spec found for agent '{name}' version {version}.")


def read_versioned_role(name: str, version: int) -> str:
    """Read versioned role markdown. Raises HTTPException 404 if missing."""
    key = f"agents/{name}/versions/{version}/role.md"
    try:
        return _get(key)
    except Exception:
        raise HTTPException(404, f"No versioned role found for agent '{name}' version {version}.")
