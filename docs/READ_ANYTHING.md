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

## A scan opened before it was read

A scanned PDF the reader has not read yet (the indexer has not reached it, or
it is not in the index) is read when it is opened (`pdfScanReading.ts`):

- The view looks at up to six pages, spread over the document. When most have
  no text of their own, it is a scan, and the reader is asked for it.
- One quiet line at the bottom of the view says so while it waits.
- When the reading arrives, the pages already on screen get their text: pdf.js
  hands out one object per page, so the pages it holds are patched, a page that
  was drawn is drawn again, and Find forgets the empty text it had gathered. The
  document is not loaded again and the place in it is kept.
- A document the reader has read before is never read again here, whatever it
  found. With no reader set up, nothing is started. A view that has moved on to
  another document is left alone when a late reading arrives.
- The reader still takes one document at a time, the indexer's included, on the
  processor. Measured (2026-11-13): four scanned pages in about 4 seconds with
  the reader running; 16 to 20 seconds for the first document after it starts.
- A picture of a page is not read when it is opened. It is read when it is
  quoted or handed to the chat, as before.

## A citation's place on the page

A citation in an answer is a link to a file and a page. Three things make it a
place that can be checked:

- **The link carries the words the sentence rests on.** When a citation checks
  out, the citation check (`openclawCitationCheck.ts`, `supportingPassage`)
  picks, from the block the model was shown, the line or pair of lines that
  best supports the sentence (its numbers count most) and writes it on the link
  as `quote`. A PDF block is a whole page, so before this a citation could only
  open its page.
- **The PDF view goes to those words** (`pdfLinkReveal.ts`): the page, and the
  words washed by pdf.js's own find. When the words sit in a table, or are a
  figure's caption, the table or figure gets a frame with its name ("Table 3"),
  its caption inside the frame; a line of ordinary text keeps the wash alone.
  The frame goes at the next press in the view.
- **A photo of a page lights up too** (`imageQuoteReveal.ts`): the lines the
  reader found the words on are washed over the picture, and follow its zoom.

Where things are comes from the reading, never from a model
(`readingLocate.ts`): the table that holds the quote (whole, or four fifths of
its words and numbers), the caption whose words were quoted, the lines of a
page read from its pixels. On a page with text of its own the place is the
text pdf.js reports.

### The card on a citation

Pointing at a citation, moving to it with the keyboard, or pressing it with a
finger shows a card (`chatCitationPeek.ts`): the file, the page, and the piece
of the page the sentence rests on with the words washed
(`services/pagePicture.ts`). A citation is judged without leaving the chat.

- The piece is the quote's lines with a little of the page round them, or the
  whole table or figure when the quote sits in one.
- It is sized to be read: a line of the page is shown about as tall as a line
  of the chat, as far as the room allows (540 by 420 pixels at most, less in a
  small window). The card takes the width of its piece.
- A table too tall for the room is shown as its heading rows and the rows the
  quote is in, with a dotted line where rows were left out. The cuts fall
  between rows: the reading has each cell's box and which cells are headings.
  A figure is shown whole, smaller.
- Only the piece is drawn (pdf.js draws the page moved so the piece fills the
  canvas), at twice the size it is shown. A document opened for a piece is kept
  45 seconds; a made piece is kept for the session (40 at most).
- Nothing is made until a card is asked for. A quote that cannot be found on
  the page gives the words in the card in place of a picture. A link whose file
  is gone has no card, and neither has a link with no quote (an answer written
  before this).
- With a mouse or the keyboard the link still opens the place and the card only
  describes. A finger's first press shows the card with Open At This Place on
  it; a second press on the link goes straight there.
- A screen reader is told the words at once ("Table 3. It rests on: …") as the
  link's description. The picture is for the eye.

## Checks

- Unit: `documentReading`, `pdfReadingTextLayer`, `pdfScanReading`,
  `doclingRuntime`, `doclingReadings`, `readerPolicy`, `fileLocator`,
  `pdfFindQueue`, `openclawCitationCheck`, `readingLocate`, `pdfLinkReveal`,
  `imageQuoteReveal`, `pagePicture`, `chatCitationPeek`.
- In a hidden copy of the app: `tests/probes/read-anything-probe.mjs` makes a
  scan, has it read, opens it, and checks the text layer sits on the printed
  lines, Find highlights a phrase and a quote is located on its page. Then it
  opens a second scan nobody has read and checks the view says it is being
  read, its text arrives on the open page, its last page has its text when
  scrolled to, and the reading is kept. Then a link to a row of a scanned
  table: the table framed and named, the frame following zoom and going at a
  press; and a link to a line on a photo of a page: the line washed. It needs
  the engine set up on the machine. Run it from Bash, not from a PowerShell
  pipeline.
- From a question to the place, hidden: `tests/probes/chat-citation-probe.mjs`.
  A stand-in answers in the chat model's place, in Ollama's wire format: it
  calls the app's own Read tool on a scanned page and answers citing the
  source label. The rest is the app's real path: the label becomes a link with
  its quote; the card shows the piece (for a scanned table, for a PDF with
  text of its own the reader never saw, and for a table that fills its page:
  heading and quoted rows); the keyboard shows it and Escape takes it away; a
  finger's press shows it with the way in; following the link opens the page
  with the table framed. Same needs as the probe above.

## Found on the way

- Pressing Enter straight after typing in Find, on the first find in any PDF,
  made pdf.js log "There can only be one pending page". Finds now go to pdf.js
  one at a time (`pdfFindQueue.ts`).
