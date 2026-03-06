# parallx_docling — FastAPI bridge for Docling document conversion
#
# Runs as a local HTTP service managed by Electron. Accepts file paths,
# converts documents via Docling's ML pipeline, returns structured Markdown.
#
# Endpoints:
#   GET  /health         — service status + model readiness
#   POST /convert        — single document conversion
#   POST /convert/batch  — batch conversion (multiple files)
#
# Security: binds to 127.0.0.1 only. No network exposure.

from __future__ import annotations

import asyncio
import logging
import os
import sys
import time
import traceback
from pathlib import Path
from typing import Optional

import uvicorn
from fastapi import FastAPI, HTTPException
from pydantic import BaseModel, Field

# ── Logging ──────────────────────────────────────────────────────────────────

logging.basicConfig(
    level=logging.INFO,
    format="%(asctime)s [%(levelname)s] %(name)s: %(message)s",
    stream=sys.stderr,
)
logger = logging.getLogger("parallx_docling")

# ── Lazy Docling imports ─────────────────────────────────────────────────────
# Docling is heavy (~1 GB models). We import lazily so the server can start
# and respond to /health before models are loaded.

_converter = None
_docling_version: str | None = None
_models_ready = False
_models_loading = False


def _get_docling_version() -> str:
    """Return installed Docling version string."""
    global _docling_version
    if _docling_version is None:
        try:
            import importlib.metadata
            _docling_version = importlib.metadata.version("docling")
        except Exception:
            _docling_version = "unknown"
    return _docling_version


def _ensure_converter(ocr: bool = False):
    """
    Lazily create the Docling DocumentConverter with appropriate options.
    First call triggers model download if needed (can take minutes).
    """
    global _converter, _models_ready, _models_loading

    if _converter is not None:
        return _converter

    if _models_loading:
        raise RuntimeError("Docling models are still loading. Please wait.")

    _models_loading = True
    logger.info("Initializing Docling converter (this may download models on first run)...")

    try:
        from docling.document_converter import DocumentConverter, PdfFormatOption
        from docling.datamodel.pipeline_options import PdfPipelineOptions
        from docling.datamodel.base_models import InputFormat

        # Configure PDF pipeline with optional OCR
        pdf_pipeline_options = PdfPipelineOptions()
        pdf_pipeline_options.do_ocr = ocr

        format_options = {
            InputFormat.PDF: PdfFormatOption(pipeline_options=pdf_pipeline_options),
        }

        _converter = DocumentConverter(format_options=format_options)
        _models_ready = True
        logger.info("Docling converter ready (version %s)", _get_docling_version())
        return _converter

    except Exception as e:
        _models_loading = False
        logger.error("Failed to initialize Docling: %s", e)
        raise
    finally:
        _models_loading = False


def _convert_document(file_path: str, ocr: bool = False) -> dict:
    """
    Convert a single document to structured Markdown via Docling.

    Returns dict with: markdown, page_count, tables_found, diagnostics.
    """
    start = time.monotonic()
    path = Path(file_path)

    if not path.exists():
        raise FileNotFoundError(f"File not found: {file_path}")
    if not path.is_file():
        raise ValueError(f"Not a file: {file_path}")

    # Get or create converter — may need to recreate with different OCR setting
    global _converter, _models_ready
    converter = _ensure_converter(ocr=ocr)

    # Convert
    result = converter.convert(str(path))
    doc = result.document

    # Export to Markdown
    markdown = doc.export_to_markdown()

    # Gather metadata
    page_count = 0
    tables_found = 0
    diagnostics: list[str] = []

    try:
        # Count pages (if available in the document model)
        if hasattr(doc, 'pages') and doc.pages is not None:
            page_count = len(doc.pages)
    except Exception:
        pass

    try:
        # Count tables
        if hasattr(doc, 'tables') and doc.tables is not None:
            tables_found = len(doc.tables)
    except Exception:
        pass

    elapsed_ms = round((time.monotonic() - start) * 1000)
    diagnostics.append(f"Converted in {elapsed_ms}ms")

    if ocr:
        diagnostics.append("OCR enabled")

    return {
        "markdown": markdown,
        "page_count": page_count,
        "tables_found": tables_found,
        "elapsed_ms": elapsed_ms,
        "diagnostics": diagnostics,
    }


# ── FastAPI app ──────────────────────────────────────────────────────────────

app = FastAPI(
    title="Parallx Docling Bridge",
    version="0.1.0",
    docs_url=None,   # No need for Swagger UI in embedded service
    redoc_url=None,
)


# ── Request / Response models ────────────────────────────────────────────────

class ConvertRequest(BaseModel):
    path: str = Field(..., description="Absolute file path to convert")
    ocr: bool = Field(False, description="Enable OCR for scanned documents")


class ConvertResponse(BaseModel):
    markdown: str = Field(..., description="Extracted structured Markdown")
    page_count: int = Field(0)
    tables_found: int = Field(0)
    elapsed_ms: int = Field(0)
    diagnostics: list[str] = Field(default_factory=list)


class BatchConvertRequest(BaseModel):
    files: list[ConvertRequest] = Field(..., description="List of files to convert")


class BatchConvertResponse(BaseModel):
    results: list[ConvertResponse | dict] = Field(
        ..., description="Results in same order as input (may contain error dicts)"
    )


class HealthResponse(BaseModel):
    status: str
    docling_version: str
    models_ready: bool
    models_loading: bool


# ── Endpoints ────────────────────────────────────────────────────────────────

@app.get("/health", response_model=HealthResponse)
async def health():
    """Return service status and model readiness."""
    return HealthResponse(
        status="ok",
        docling_version=_get_docling_version(),
        models_ready=_models_ready,
        models_loading=_models_loading,
    )


@app.post("/convert", response_model=ConvertResponse)
async def convert(req: ConvertRequest):
    """Convert a single document to structured Markdown."""
    try:
        # Run in thread pool to avoid blocking the event loop
        loop = asyncio.get_event_loop()
        result = await loop.run_in_executor(
            None, _convert_document, req.path, req.ocr
        )
        return ConvertResponse(**result)
    except FileNotFoundError as e:
        raise HTTPException(status_code=404, detail=str(e))
    except Exception as e:
        logger.error("Conversion failed for %s: %s\n%s", req.path, e, traceback.format_exc())
        raise HTTPException(status_code=500, detail=str(e))


@app.post("/convert/batch", response_model=BatchConvertResponse)
async def convert_batch(req: BatchConvertRequest):
    """Convert multiple documents. Returns results in order; individual failures don't fail the batch."""
    results = []
    for file_req in req.files:
        try:
            loop = asyncio.get_event_loop()
            result = await loop.run_in_executor(
                None, _convert_document, file_req.path, file_req.ocr
            )
            results.append(ConvertResponse(**result))
        except Exception as e:
            logger.error("Batch item failed for %s: %s", file_req.path, e)
            results.append({
                "error": str(e),
                "path": file_req.path,
                "markdown": "",
                "page_count": 0,
                "tables_found": 0,
                "elapsed_ms": 0,
                "diagnostics": [f"Error: {e}"],
            })
    return BatchConvertResponse(results=results)


# ── Entrypoint ───────────────────────────────────────────────────────────────

def main():
    """Start the bridge server. Port is passed via --port or defaults to 7779."""
    import argparse

    parser = argparse.ArgumentParser(description="Parallx Docling Bridge")
    parser.add_argument("--port", type=int, default=7779, help="Port to listen on")
    parser.add_argument("--host", type=str, default="127.0.0.1", help="Host to bind to")
    args = parser.parse_args()

    logger.info("Starting Parallx Docling Bridge on %s:%d", args.host, args.port)

    # Write port to stdout for Electron to read (single line, then switch to stderr)
    print(f"PORT:{args.port}", flush=True)

    uvicorn.run(
        app,
        host=args.host,
        port=args.port,
        log_level="warning",  # Reduce noise; our logger handles info
        access_log=False,
    )


if __name__ == "__main__":
    main()
