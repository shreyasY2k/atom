"""
OCR mock service — Tesseract-backed text extraction for the insurance OCR demo.

Endpoints:
  GET  /health                              -> liveness
  GET  /samples                             -> list of pre-staged sample documents
  POST /ocr/extract                         -> upload image/PDF, get extracted text
  POST /ocr/extract-by-sample-id            -> extract from a pre-staged sample (demo path)

Why two extract endpoints?
  Real Tesseract on synthetic demo images is reliable but not perfect. For
  rehearsal-grade demos, the team can pre-stage sample documents at known
  filenames and use the "by-sample-id" endpoint, which still runs Tesseract
  on the *actual file* but reads from a known-good location, eliminating the
  upload roundtrip and any user-supplied weirdness.
"""

import os
from io import BytesIO
from pathlib import Path
from typing import Optional

from fastapi import FastAPI, File, UploadFile, HTTPException
from fastapi.responses import JSONResponse
from PIL import Image
import pytesseract
from pdf2image import convert_from_bytes

app = FastAPI(title="OCR Service (Tesseract)", version="0.1.0")

SAMPLES_DIR = Path(os.environ.get("SAMPLES_DIR", "/app/samples"))


@app.get("/health")
def health():
    return {"status": "ok", "tesseract_version": str(pytesseract.get_tesseract_version())}


@app.get("/samples")
def list_samples():
    """Return metadata for all pre-staged sample documents."""
    if not SAMPLES_DIR.exists():
        return {"samples": []}
    samples = []
    for p in sorted(SAMPLES_DIR.glob("*")):
        if p.suffix.lower() in {".png", ".jpg", ".jpeg", ".pdf", ".tiff"}:
            samples.append({
                "sample_id": p.stem,
                "filename": p.name,
                "size_bytes": p.stat().st_size,
                "kind": _infer_kind(p.stem),
            })
    return {"samples": samples}


def _infer_kind(stem: str) -> str:
    s = stem.lower()
    if "repair" in s or "auto" in s or "vehicle" in s:
        return "auto-repair-invoice"
    if "medical" in s or "hospital" in s or "clinic" in s:
        return "medical-bill"
    if "contractor" in s or "property" in s or "home" in s:
        return "contractor-estimate"
    return "unknown"


@app.post("/ocr/extract")
async def extract(file: UploadFile = File(...)):
    """Run Tesseract on the uploaded image or PDF."""
    content = await file.read()
    return _extract_text(content, file.filename or "upload")


@app.post("/ocr/extract-by-sample-id")
def extract_by_sample(sample_id: str):
    """Extract from a pre-staged sample document. Demo-friendly path."""
    matches = list(SAMPLES_DIR.glob(f"{sample_id}.*"))
    if not matches:
        raise HTTPException(status_code=404, detail=f"sample {sample_id} not found")
    p = matches[0]
    with open(p, "rb") as f:
        return _extract_text(f.read(), p.name)


def _extract_text(data: bytes, filename: str) -> dict:
    """Common extraction logic for both endpoints."""
    suffix = Path(filename).suffix.lower()
    pages = []

    try:
        if suffix == ".pdf":
            images = convert_from_bytes(data, dpi=300)
            for i, img in enumerate(images):
                text = pytesseract.image_to_string(img)
                pages.append({"page": i + 1, "text": text})
        else:
            img = Image.open(BytesIO(data))
            text = pytesseract.image_to_string(img)
            pages.append({"page": 1, "text": text})
    except Exception as e:
        raise HTTPException(status_code=500, detail=f"OCR failed: {e}")

    full_text = "\n\n".join(p["text"] for p in pages)
    return {
        "filename": filename,
        "page_count": len(pages),
        "text": full_text,
        "pages": pages,
        "char_count": len(full_text),
    }
