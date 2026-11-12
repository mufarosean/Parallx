# parallx_docling — FastAPI bridge for Docling document conversion
#
# Runs as a local HTTP service managed by Electron. Accepts file paths,
# converts documents via Docling's ML pipeline, returns structured Markdown
# and where everything on the page is (the reading).
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

# One converter per way of reading: a born-digital file keeps its own text,
# a scan or a photo of a page is read from its pixels; on the processor or on
# the graphics card; with or without formulas turned into LaTeX.
_converters: dict[tuple[bool, bool, bool], object] = {}
_docling_version: str | None = None
_models_ready = False
_models_loading = False
_artifacts_path: str | None = None
_artifacts_checked = False

# One document at a time. Reading is background work: two at once would only
# fight over the same processor cores, and the models are not built to be
# shared between threads.
import threading
_reading_lock = threading.Lock()

# The longest one document may take. A very long book on the processor needs
# minutes; past this something is wrong with the file and it is given up.
DOCUMENT_TIMEOUT_S = 25 * 60


def _reader_threads() -> int:
    """How many processor threads the reader may use: half of them, at most 8, so the computer stays free for its user."""
    return max(2, min(8, (os.cpu_count() or 4) // 2))


def _yield_to_the_user() -> None:
    """Run below normal priority: whatever the user is doing comes first."""
    try:
        if sys.platform == "win32":
            import ctypes
            BELOW_NORMAL_PRIORITY_CLASS = 0x00004000
            ctypes.windll.kernel32.SetPriorityClass(ctypes.windll.kernel32.GetCurrentProcess(), BELOW_NORMAL_PRIORITY_CLASS)
        else:
            os.nice(10)
    except Exception as e:  # Not worth failing a start over.
        logger.warning("Could not lower the reader's priority: %s", e)


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


def lay_out_models() -> str | None:
    """
    In Parallx's own engine the models arrive as flat files, each checked
    against its SHA-256 (PARALLX_RUNTIME_FILES, listed in models.json). Lay
    them out at the paths Docling reads them from: hard links, so nothing is
    stored twice. Returns the folder, or None when Docling fetches its own
    models (a Docling in the user's own Python).
    """
    global _artifacts_path, _artifacts_checked
    if _artifacts_checked:
        return _artifacts_path
    _artifacts_checked = True
    files_dir = os.environ.get("PARALLX_RUNTIME_FILES")
    manifest = Path(__file__).resolve().parent.parent / "models.json"
    if not files_dir or not manifest.is_file():
        return None
    import json
    target = Path(files_dir).parent / "home" / "docling-models"
    for entry in json.loads(manifest.read_text(encoding="utf-8")).get("files", []):
        src = Path(files_dir) / entry["name"]
        dest = target / entry["path"]
        if not src.is_file():
            raise RuntimeError(f"A model file is missing: {entry['name']}. Set the document reader up again.")
        if dest.is_file() and dest.stat().st_size == src.stat().st_size:
            continue
        dest.parent.mkdir(parents=True, exist_ok=True)
        if dest.exists():
            dest.unlink()
        try:
            os.link(src, dest)
        except OSError:
            import shutil
            shutil.copyfile(src, dest)
    _artifacts_path = str(target)
    return _artifacts_path


def _ensure_converter(ocr: bool = False, card: bool = False, formulas: bool = False):
    """
    Lazily create the Docling DocumentConverter for one way of reading.
    `ocr` reads every page from its pixels (a scan, a photo of a page).
    `card` lets it use the graphics card; without it nothing touches the
    card, so a chat model loaded there is never crowded. `formulas` turns
    each formula into LaTeX with a small vision model: seconds per formula
    even on the card, so it is asked for, never the default.
    """
    global _models_ready, _models_loading

    key = (ocr, card, formulas)
    if key in _converters:
        return _converters[key]

    if _models_loading:
        raise RuntimeError("Docling models are still loading. Please wait.")

    _models_loading = True
    logger.info("Initializing Docling converter (ocr=%s)...", ocr)

    try:
        from docling.document_converter import DocumentConverter, ImageFormatOption, PdfFormatOption
        from docling.datamodel.accelerator_options import AcceleratorDevice, AcceleratorOptions
        from docling.datamodel.pipeline_options import PdfPipelineOptions, TableFormerMode
        from docling.datamodel.base_models import InputFormat

        opts = PdfPipelineOptions()
        opts.accelerator_options = AcceleratorOptions(
            device=AcceleratorDevice.AUTO if card else AcceleratorDevice.CPU,
            num_threads=_reader_threads(),
        )
        opts.document_timeout = DOCUMENT_TIMEOUT_S
        artifacts = lay_out_models()
        if artifacts:
            opts.artifacts_path = artifacts
        opts.do_ocr = ocr
        if ocr:
            from docling.datamodel.pipeline_options import RapidOcrOptions
            opts.ocr_options = RapidOcrOptions(force_full_page_ocr=True)
            # Keep each line the reader found, with its box: the viewer's text layer.
            opts.generate_parsed_pages = True
        opts.do_table_structure = True
        opts.table_structure_options.mode = TableFormerMode.ACCURATE
        # Formulas as LaTeX, when asked for and only where the model is on
        # disk already: it is never fetched from here.
        opts.do_formula_enrichment = formulas and bool(artifacts)

        converter = DocumentConverter(format_options={
            InputFormat.PDF: PdfFormatOption(pipeline_options=opts),
            InputFormat.IMAGE: ImageFormatOption(pipeline_options=opts),
        })
        _converters[key] = converter
        _models_ready = True
        logger.info("Docling converter ready (version %s)", _get_docling_version())
        return converter

    except Exception as e:
        logger.error("Failed to initialize Docling: %s", e)
        raise
    finally:
        _models_loading = False


def _box(bbox, page_height: float) -> list[float]:
    """A Docling box as [left, top, right, bottom] from the page's top-left corner, in page units."""
    try:
        b = bbox.to_top_left_origin(page_height=page_height)
    except Exception:
        b = bbox
    return [round(float(b.l), 2), round(float(b.t), 2), round(float(b.r), 2), round(float(b.b), 2)]


def build_reading(result, ocr: bool) -> dict:
    """
    Where everything on the page is: each page's size; for a page read from
    its pixels, every line with its box; every block (heading, paragraph,
    formula, table, picture) with its page and box; every table as a grid
    of cells, each with its box. Boxes are [left, top, right, bottom] from
    the page's top-left corner, in the page's own units.
    """
    doc = result.document
    sizes: dict[int, tuple[float, float]] = {}
    for no, page in (doc.pages or {}).items():
        sizes[int(no)] = (float(page.size.width), float(page.size.height))

    pages = []
    # Pages in order are pages 1, 2, 3...: the numbers the document's own items carry.
    for no, page in enumerate(result.pages, start=1):
        width, height = sizes.get(no, (0.0, 0.0))
        lines = []
        parsed = getattr(page, "parsed_page", None)
        if ocr and parsed is not None:
            for cell in parsed.textline_cells:
                text = (cell.text or "").strip()
                if not text:
                    continue
                lines.append({"text": text, "box": _box(cell.rect.to_bounding_box(), height)})
        pages.append({"page": no, "width": round(width, 2), "height": round(height, 2), "lines": lines})

    blocks = []
    for item, _level in doc.iterate_items():
        prov = getattr(item, "prov", None)
        if not prov:
            continue
        first = prov[0]
        _w, height = sizes.get(int(first.page_no), (0.0, 0.0))
        label = str(getattr(item.label, "value", item.label))
        block = {"label": label, "page": int(first.page_no), "box": _box(first.bbox, height)}
        text = getattr(item, "text", None)
        if isinstance(text, str) and text:
            block["text"] = text
        blocks.append(block)

    tables = []
    for table in doc.tables or []:
        if not table.prov:
            continue
        first = table.prov[0]
        _w, height = sizes.get(int(first.page_no), (0.0, 0.0))
        cells = []
        for cell in table.data.table_cells:
            entry = {
                "r": int(cell.start_row_offset_idx), "c": int(cell.start_col_offset_idx),
                "rs": int(cell.row_span), "cs": int(cell.col_span), "text": cell.text or "",
            }
            if cell.bbox is not None:
                entry["box"] = _box(cell.bbox, height)
            if cell.column_header or cell.row_header:
                entry["header"] = True
            cells.append(entry)
        tables.append({
            "page": int(first.page_no), "box": _box(first.bbox, height),
            "rows": int(table.data.num_rows), "cols": int(table.data.num_cols), "cells": cells,
        })

    return {"version": 1, "ocr": ocr, "pages": pages, "blocks": blocks, "tables": tables}


def _convert_document(file_path: str, ocr: bool = False, card: bool = False, formulas: bool = False) -> dict:
    """
    Convert a single document to structured Markdown via Docling.

    Returns dict with: markdown, page_count, tables_found, diagnostics, and
    `reading` (where everything on the page is; see build_reading).
    """
    start = time.monotonic()
    path = Path(file_path)

    if not path.exists():
        raise FileNotFoundError(f"File not found: {file_path}")
    if not path.is_file():
        raise ValueError(f"Not a file: {file_path}")

    with _reading_lock:
        converter = _ensure_converter(ocr=ocr, card=card, formulas=formulas)
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

    reading = None
    try:
        reading = build_reading(result, ocr)
    except Exception as e:  # The text is still good without the positions.
        logger.warning("No positions for %s: %s", file_path, e)
        diagnostics.append(f"No positions: {e}")

    elapsed_ms = round((time.monotonic() - start) * 1000)
    diagnostics.append(f"Converted in {elapsed_ms}ms")

    if ocr:
        diagnostics.append("OCR enabled")
    diagnostics.append("On the graphics card" if card else "On the processor")
    if formulas:
        diagnostics.append("Formulas as LaTeX")

    return {
        "markdown": markdown,
        "page_count": page_count,
        "tables_found": tables_found,
        "elapsed_ms": elapsed_ms,
        "diagnostics": diagnostics,
        "reading": reading,
    }


# ── FastAPI app ──────────────────────────────────────────────────────────────

app = FastAPI(
    title="Parallx Docling Bridge",
    version="0.2.0",
    docs_url=None,   # No need for Swagger UI in embedded service
    redoc_url=None,
)


# ── Request / Response models ────────────────────────────────────────────────

class ConvertRequest(BaseModel):
    path: str = Field(..., description="Absolute file path to convert")
    ocr: bool = Field(False, description="Read every page from its pixels (a scan, a photo of a page)")
    card: bool = Field(False, description="Let the reader use the graphics card; off, nothing touches it")
    formulas: bool = Field(False, description="Turn formulas into LaTeX (seconds per formula)")


class ConvertResponse(BaseModel):
    markdown: str = Field(..., description="Extracted structured Markdown")
    page_count: int = Field(0)
    tables_found: int = Field(0)
    elapsed_ms: int = Field(0)
    diagnostics: list[str] = Field(default_factory=list)
    reading: Optional[dict] = Field(None, description="Where everything on the page is: pages, lines, blocks, tables")


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
            None, _convert_document, req.path, req.ocr, req.card, req.formulas
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
                None, _convert_document, file_req.path, file_req.ocr, file_req.card, file_req.formulas
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
    _yield_to_the_user()

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
