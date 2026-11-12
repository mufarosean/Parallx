# Read Anything

How Parallx reads documents: PDFs, Word files, and scans or photos of pages.
The queue of what is still to build is in `docs/MASTER_LIST.md`; this file is
the record of what exists and why it is built the way it is.

## What it does

- **Every rich document is read with its structure.** Headings, paragraphs,
  tables as grids, reading order. Before this, with no reader set up, PDFs were
  read as plain text and a scan gave nothing.
- **A scan has text.** A scanned PDF, or a page of one, is read from its
  pixels. Its text is found by search and by the chat, a quote is located on
  its page, and in the PDF view Find, selection and a citation's highlight work
  on it as on any PDF.
- **Nothing leaves the computer**, and nothing is fetched after set-up.

## The reader's engine

The reader is Docling, with PP-OCRv6 (through RapidOCR) for pages read from
their pixels. It runs in an engine Parallx sets up itself, a tool runtime like
Enhance's (`electron/runtimeBridge.cjs`, `docs/ENHANCE.md`):

- its own Python, inside `data/runtimes/docling`, apart from any Python on the
  machine;
- its packages from `tools/docling-bridge/requirements-win.lock`, every one by
  hash;
- its models as 23 files, each by SHA-256 from a fixed revision
  (`tools/docling-bridge/models.json`, written by `make_models_manifest.py`);
- a self-test at the end of set-up that reads a page it draws itself.

Set-up is the command **Set Up Document Reader…**. It downloads about 7 GB once
and keeps about 8 GB on disk, for every workspace. A Docling installed in the
machine's own Python is still used when there is no engine.

To upgrade Docling: change the lock, run Docling's own model download into a
folder, run `make_models_manifest.py` on it, and check the revisions in that
script against what the new Docling asks for.

## Where it runs, and why

Measured on the machine this was built on (RTX 5090, 2026-11-12):

| | Ordinary PDF | Scanned page | Graphics memory |
|---|---|---|---|
| On the processor | 0.6 to 0.9 s a page | about 3 s a page | none |
| On the card | about 0.2 s a page | about 3 s a page | 3 to 5 GB |

- **The reader stays on the processor unless a call asks for the card.** Three
  to five gigabytes taken in the background could push a loaded chat model off
  the card, and a model that loads with less room than it needs stays slow for
  the session.
- **Formulas are not turned into LaTeX in the background.** The small vision
  model that does it takes about 4 seconds a formula even on the card (34
  formulas, 127 seconds). A formula's place on the page is kept; decoding is a
  request (`formulas: true`), not the default.
- **One document at a time**, at below-normal priority, on half the processor's
  threads (at most 8). A single document is given up after 25 minutes.

## The reading

Beside a document's Markdown the reader returns a **reading**
(`src/services/documentReading.ts`): each page's size; for a page read from its
pixels, every line with its box; every block with its page and box; every table
as a grid of cells with their boxes. No reader gives a box for each word, so the
line is the smallest unit.

The main process keeps one reading per document under `data/readings`
(`electron/doclingReadings.cjs`) and hands it out by path for as long as the
document's size and modified time are the ones it was read at. The index gets
only the Markdown.

What uses it:

- **Page text for a scan** (`FileService._pageTexts`): a PDF page with no text
  of its own carries the reader's text, so `read_file`, the chat's source
  reading and the quote locator see it. A picture of a page is addressed as one
  page.
- **The PDF view's text layer** (`pdfReadingTextLayer.ts`): a page with no text
  reports the reader's lines to pdf.js as its text, placed by their boxes. Find,
  selection, selection actions and a citation's highlight are pdf.js's own; no
  second mechanism draws over the page.

## Background reading

Two rules (`src/services/readerPolicy.ts`):

1. A document the basic readers read before the reader was set up is read
   again, once. One the reader tried and could not read is left alone.
2. Pictures are not read in the background: a workspace can hold a photo
   library. A picture of a page is read when it is asked for.

The indexer reads each document as its turn comes and writes to the index a few
at a time, so the first pass over a large library can be stopped and carries on
near where it was.

## Checks

- Unit: `documentReading`, `pdfReadingTextLayer`, `doclingRuntime`,
  `doclingReadings`, `readerPolicy`, `fileLocator`, `pdfFindQueue`.
- In a hidden copy of the app: `tests/probes/read-anything-probe.mjs` makes a
  scan, has it read, opens it, and checks the text layer sits on the printed
  lines, Find highlights a phrase and a quote is located on its page. It needs
  the engine set up on the machine. Run it from Bash, not from a PowerShell
  pipeline.

## Found on the way

- Pressing Enter straight after typing in Find, on the first find in any PDF,
  made pdf.js log "There can only be one pending page". Finds now go to pdf.js
  one at a time (`pdfFindQueue.ts`).
