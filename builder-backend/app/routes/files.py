"""Routes: file upload, retrieval, and content extraction."""

import os
import uuid
from datetime import datetime, timezone

import boto3
from fastapi import APIRouter, HTTPException, Request, UploadFile, File
from fastapi.responses import StreamingResponse

from app.core import file_processor

router = APIRouter(prefix="/files", tags=["files"])

BUCKET = "uploaded-documents"
MAX_SIZE = 50 * 1024 * 1024  # 50 MB


def _s3():
    return boto3.client(
        "s3",
        endpoint_url=f"http://{os.environ.get('MINIO_ENDPOINT', 'minio:9000')}",
        aws_access_key_id=os.environ.get("MINIO_ACCESS_KEY", "minioadmin"),
        aws_secret_access_key=os.environ.get("MINIO_SECRET_KEY", "minioadmin"),
        region_name="us-east-1",
    )


# ---------------------------------------------------------------------------
# POST /files/upload
# ---------------------------------------------------------------------------

@router.post("/upload")
async def upload_file(request: Request, file: UploadFile = File(...)):
    """Upload a file to MinIO. Returns file_id + metadata."""
    data = await file.read()
    if len(data) > MAX_SIZE:
        raise HTTPException(413, f"File too large — max {MAX_SIZE // 1024 // 1024} MB")

    file_id = str(uuid.uuid4())
    content_type = file.content_type or "application/octet-stream"
    filename = file.filename or "upload"
    now = datetime.now(timezone.utc).isoformat()
    key = f"{file_id}/{filename}"

    metadata = {
        "file_id": file_id,
        "original_name": filename,
        "content_type": content_type,
        "size": len(data),
        "uploaded_at": now,
        "uploaded_by": request.headers.get("X-Atom-Actor", "user:unknown"),
        "minio_key": key,   # stored in sidecar so extract can look up the file
    }

    s3 = _s3()
    # Store file
    s3.put_object(
        Bucket=BUCKET, Key=key, Body=data,
        ContentType=content_type,
        Metadata={k: str(v) for k, v in metadata.items()},
    )
    # Store metadata sidecar
    import json
    s3.put_object(
        Bucket=BUCKET, Key=f"{file_id}/_meta.json",
        Body=json.dumps(metadata).encode(),
        ContentType="application/json",
    )

    return {**metadata, "minio_key": key}


# ---------------------------------------------------------------------------
# GET /files/{file_id}
# ---------------------------------------------------------------------------

@router.get("/{file_id}")
def get_file_meta(file_id: str):
    """Get file metadata."""
    import json
    try:
        obj = _s3().get_object(Bucket=BUCKET, Key=f"{file_id}/_meta.json")
        return json.loads(obj["Body"].read())
    except Exception:
        raise HTTPException(404, f"File '{file_id}' not found")


# ---------------------------------------------------------------------------
# POST /files/{file_id}/extract
# ---------------------------------------------------------------------------

@router.post("/{file_id}/extract")
def extract_file_content(file_id: str):
    """Extract text/structured content from a previously uploaded file."""
    import json
    s3 = _s3()

    # Load metadata
    try:
        meta_obj = s3.get_object(Bucket=BUCKET, Key=f"{file_id}/_meta.json")
        meta = json.loads(meta_obj["Body"].read())
    except Exception:
        raise HTTPException(404, f"File '{file_id}' not found")

    # Load file data
    try:
        file_obj = s3.get_object(Bucket=BUCKET, Key=meta["minio_key"])
        data = file_obj["Body"].read()
    except Exception:
        raise HTTPException(404, "File data not found")

    result = file_processor.extract(data, meta["content_type"], meta["original_name"])
    return {
        "file_id": file_id,
        "name": meta["original_name"],
        "content_type": meta["content_type"],
        "size": meta["size"],
        **result,
    }


# ---------------------------------------------------------------------------
# POST /files/extract-url
# ---------------------------------------------------------------------------

@router.post("/extract-url")
def extract_url_content(body: dict):
    """Fetch and extract text content from a URL."""
    url = (body or {}).get("url", "").strip()
    if not url:
        raise HTTPException(422, "url field required")
    if not url.startswith(("http://", "https://")):
        raise HTTPException(422, "URL must start with http:// or https://")
    result = file_processor.extract_url(url)
    return {"url": url, **result}
