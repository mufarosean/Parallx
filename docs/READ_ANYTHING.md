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
- **A citation is a place.** A citation in an answer carries the words it rests
  on. Following it frames the table or figure those words sit in, and resting
  on it shows that piece of the page in a card.
- **The reader's state has a place.** The reader itself is in Settings; how one
  document was read, and Read Again, are in the PDF view's panel.
- **A scan can become a page.** Open As Page makes a page of the app from what
  the reader read and opens it beside the scan, the two kept in step.
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

Set-up is in Settings, on the Document Reader panel (the command **Set Up
Document Reader…** opens it). It downloads about 7 GB once and keeps about
7.5 GB on disk, for every workspace. A Docling installed in the machine's own
Python is still used when there is no engine.

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

## Where the reader's state lives

Two places, each where it would be looked for.

**The reader itself, in Settings** (Settings, Document Reader;
`built-in/settings/documentReaderPanel.ts`). Whether it is set up, what it
takes on disk, where it runs, and one or two buttons for the state it is in:
Set Up, Carry On Setting Up, Stop, Start, Remove…, Check Again. A set-up shows
its step, a bar and the bytes in the panel, and carries on when Settings is
closed; it then says in one notice how it ended. Remove… asks first; what the
reader has already read is kept. The command **Set Up Document Reader…** opens
this panel and starts nothing.

**One document's reading, in the PDF view** (the side panel's third side,
Reading, beside Outline and Pages; `editor/panes/pdf/pdfReadingPanel.ts`):

- when it was read, how (from its own text, or from its pixels), its pages,
  tables, captioned figures and formulas;
- Read Again, which reads it the way it was read before. A document never read
  shows Read Now: from its pixels when it is a scan, from its own text
  otherwise. While a reading is under way, whoever asked for it, the side says
  so in one line. The command is **Read This Document Again**;
- the tables and captioned figures the reader found, each a link to its place:
  the page, the block framed. A picture with no caption is left out (on a scan
  the reader marks stamps and logos as pictures too);
- with no reader set up, what that means and the way to Settings.

Read Again replaces the reading the main process keeps. The index keeps its own
copy of a document's text and follows its own rules.

Both ask the same module, `services/documentReaderEngine.ts`: the one place
the app asks where the engine stands, changes it, and has it read a document.
Nothing in it runs until one of the two is shown. A reading it starts is known
by path, so a scan being read as it opens and the Reading side do not start two.

## Open As Page

A document the reader has read can be made into a page of the app. The PDF
view's Reading side has **Open As Page** (the command is Canvas: Open As
Page). The page opens in the group beside the document.

What the page is made of, block by block in the reader's order
(`built-in/canvas/scanPageDoc.ts`):

- a title or a section heading is a heading; text, captions and footnotes are
  paragraphs; list items that follow one another are one list; code is a code
  block;
- a table is a real table, with its heading cells and its spans. A place the
  reader left empty gets an empty cell; when two cells claim one place the
  first keeps it and takes in the other's words, so nothing read is lost;
- a figure is a picture cut from the document. A formula is a picture too:
  the reader turns formulas into LaTeX only when asked, and that is not
  offered yet;
- running heads and feet are left out;
- the first line names the file and links to it.

It is an ordinary page: edited, searched and linked like any other. A document
is made into a page once; asking again opens the page it became.

### The two kept in step

Every block made remembers where it came from: the document's page and its box
there. Each cell of a table remembers its own cell. The record is one small
file a page, in the workspace (`.parallx/page-sources/<page id>.json`), naming
the document by its path within the workspace, so it moves with the folder.
Nothing about it is in the page's own content.

While such a page is open, the two sides speak through
`services/scanPageLinks.ts` (the canvas's half is `built-in/canvas/scanPage.ts`,
the PDF view's is `editor/panes/pdf/pdfScanPageLink.ts`):

- the caret goes into a block, or a block is pressed: the document's view
  frames where it came from, and goes there only when the place is out of
  sight;
- a press on the document (not a selection): the block made from that spot is
  marked on the page for a moment, and framed on the document;
- either side scrolls: the other brings what was made from the same height to
  the same height (a quarter of the way down the view). A scroll made to follow
  is not sent back, so the two come to rest.

The mark on the page is drawn over the block, in the element that scrolls: the
page editor redraws a block whose own element is changed. Each side listens on
its own view only while such a page is open.

### What the products do

Read from their own pages on 2026-11-14:

- **ABBYY FineReader 16**, the OCR Editor (help.abbyy.com, user guide,
  "Checking recognized text" and "OCR Editor interface"): Text, Image and Zoom
  panes; a click on a word in the Text pane highlights its area in the Image
  pane, and the Zoom pane shows the line enlarged; low-confidence characters
  are highlighted, with next and previous; a Verification dialog offers
  Replace, Skip and Add to Dictionary.
- **Mathpix Snip** (mathpix.com, docs and its post of 2022-07-08): Editor and
  Preview panels; a reader mode that "syncs your reading position automatically
  with the original PDF". No checking of the result against the scan is
  described.
- **Adobe Acrobat**: its help page refused to be fetched. Not verified, and not
  relied on.

Against that: Parallx links both ways, block by block and cell by cell, and the
two scroll together. It does not mark unsure characters (the reading carries
no confidence for a character or a line), has no walk through them, and no
enlarged strip of the line being checked.

## Checks

- Unit: `documentReading`, `pdfReadingTextLayer`, `pdfScanReading`,
  `doclingRuntime`, `doclingReadings`, `readerPolicy`, `fileLocator`,
  `pdfFindQueue`, `openclawCitationCheck`, `readingLocate`, `pdfLinkReveal`,
  `imageQuoteReveal`, `pagePicture`, `chatCitationPeek`, `documentReaderEngine`,
  `documentReaderPanel`, `pdfReadingPanel`, `doclingCommands`, `scanPageDoc`,
  `scanPage`, `scanPageLinks`, `pdfScanPageLink`.
- In a hidden copy of the app: `tests/probes/read-anything-probe.mjs` makes a
  scan, has it read, opens it, and checks the text layer sits on the printed
  lines, Find highlights a phrase and a quote is located on its page. Then it
  opens a second scan nobody has read and checks the view says it is being
  read, its text arrives on the open page, its last page has its text when
  scrolled to, and the reading is kept. Then a link to a row of a scanned
  table: the table framed and named, the frame following zoom and going at a
  press; and a link to a line on a photo of a page: the line washed. Then the
  PDF view's Reading side (its facts, a found table as a link that frames it,
  Read Again, Read Now on a PDF with text of its own) and the reader in
  Settings (its state and size; Remove… is opened and cancelled, never
  confirmed). It needs the engine set up on the machine. Run it from Bash, not
  from a PowerShell pipeline.
- The reader in Settings through every state, hidden:
  `tests/probes/document-reader-probe.mjs`. In that hidden copy only, the main
  process's answers about the engine are replaced by a stand-in, so nothing is
  downloaded and no engine is touched: not set up, setting up with its
  progress, stopped, carried on with Settings closed (the notice), set up,
  removed after a yes, and the Reading side with no reader.
- Open As Page, hidden: `tests/probes/open-as-page-probe.mjs`. A four-page
  scan read by the real reader is made into a page from the Reading side. It
  checks the page (its first line, the order of its blocks, a real table), the
  record kept in the workspace, a press in a cell framing that very cell on
  the scan, a press on the scan marking its block on the page without touching
  the page's content, each side following the other's scroll and coming to
  rest, and that asking again opens the same page. Same needs as the probes
  above.
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
