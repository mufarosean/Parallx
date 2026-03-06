# Parallx Docling Bridge

Local FastAPI microservice that bridges Parallx (Electron/TypeScript) with
[Docling](https://github.com/docling-project/docling) (IBM Research) for
intelligent document ingestion.

## Prerequisites

- Python 3.10+
- pip

## Installation

```bash
cd tools/docling-bridge
pip install .
```

This installs Docling and its ML models (~1 GB on first run).

## Usage

```bash
# Start the bridge server (default port 7779)
parallx-docling

# Custom port
parallx-docling --port 8080
```

The server prints `PORT:<number>` to stdout on startup, then logs to stderr.

## Endpoints

| Method | Path | Description |
|--------|------|-------------|
| GET | `/health` | Service status and model readiness |
| POST | `/convert` | Convert a single document to Markdown |
| POST | `/convert/batch` | Convert multiple documents |

### POST /convert

```json
{
  "path": "/absolute/path/to/document.pdf",
  "ocr": false
}
```

Response:
```json
{
  "markdown": "# Document Title\n\n...",
  "page_count": 12,
  "tables_found": 3,
  "elapsed_ms": 2450,
  "diagnostics": ["Converted in 2450ms"]
}
```

## Security

- Binds to `127.0.0.1` only — no network exposure
- Managed by Electron main process as a child process
- No authentication required (localhost only)
