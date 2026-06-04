# Milestone 84 — The Living Document: PDF ↔ Canvas Partnership

> **Status:** Built (tsc + build green). Branch: continues PDF-viewer work in
> `src/built-in/editor/pdfEditorPane.ts` + `src/built-in/canvas/main.ts`.
> Extends the M-PDF improvements (highlights, notes, zoom, night, print,
> capture) into a deeper, two-way relationship between the PDF reader and the
> Canvas note system.
>
> **Boundary:** Editor + canvas built-ins only. The one new core touch is
> injecting the existing `ICommandService` into `PdfEditorPane` (mirrors the
> existing `setGlobalStorage` injection) so the reader can call the chat
> extension's inline-AI provider and the canvas capture command. No new IPC,
> preload, or main-process changes.

## Why

A person studying for an actuarial fellowship exam does not read a PDF, then
stop, switch to a notes app, type, switch back, lose their place, and repeat.
That context-switch tax is where focus and flow die. Today Parallx makes the
reader leave the document for almost everything worth doing with it: to take a
real note, to ask the AI a question, to capture a passage. Each round-trip to
the chat sidebar or a canvas page is a small eviction from the material.

**The thesis of M84: the document is the workspace.** The more a reader can
do *without leaving the page they are reading*, the deeper they stay in the
material, and the more their tools feel like one instrument instead of a
drawer of separate apps. Reading, annotating, questioning, and capturing
should all happen *on the page*, anchored to the exact passage that prompted
them.

This is also what turns a pile of PDFs into a **reviewable knowledge base**.
Months later, when the reader returns to a chapter, every highlight should
still carry what they thought about it: the note they wrote, the questions
they asked the AI, the answers they got, and the canvas pages they sent it to.
The highlight is the permanent anchor; everything else hangs off it.

## The model: the highlight is the hub

A **highlight** is the durable object. It is created by selecting text and is
stored per-file in PDF user-space (rotation/scale independent, M-PDF). Onto
that anchor we attach everything a reader produces about that passage:

- a **note** — free text the reader writes (already shipped);
- an **AI discussion** — the *saved transcript* of what was asked and answered
  about this specific passage. Not a live resumable session: a review record.
  Each question + answer is appended and persisted on the highlight;
- **canvas links** — the canvas page(s) this passage was captured to, so the
  reader can jump from the highlight to the note page it became.

All of it surfaces through one affordance already in place: the **small
clickable icon at the start of the highlight** (the margin tab). Its icon
reflects state — plain highlight, has-note, has-discussion, has-canvas-link —
so during review the reader can see at a glance which passages they engaged
with, and click to revisit the whole record in place.

### Why "persist" means transcript, not session

The reader explicitly does **not** want an always-on chat that they resume
forever. They want a **record**: "here is what I asked about this passage and
what the AI said," bound to the highlight. So the AI discussion is stored as an
ordered list of `{ role, text, at }` turns on the highlight. Opening the
review panel replays that transcript and lets the reader ask a *new* question,
which appends to the same record. Follow-up questions feed the prior turns back
as context so the thread stays coherent on revisit (continuous understanding of
that one passage) — but the durable artifact is always just the saved
transcript.

## Data model

`PdfHighlight` (in `pdfEditorPane.ts`) gains two fields (back-compatible —
absent on old stored highlights, defaulted on load):

```ts
interface PdfHighlightThreadTurn {
  role: 'user' | 'ai';
  text: string;
  at: number;            // epoch ms
}

interface PdfHighlightCanvasLink {
  pageId: string;
  title: string;
  at: number;
}

interface PdfHighlight {
  id: string;
  page: number;                       // 1-based
  color: string;                      // HIGHLIGHT_COLORS key
  rects: PdfHighlightRect[];          // PDF user-space
  text: string;                       // captured passage
  note: string;                       // reader's note
  thread?: PdfHighlightThreadTurn[];  // M84: saved AI discussion
  canvasLinks?: PdfHighlightCanvasLink[]; // M84: pages this became
  createdAt: number;
}
```

Storage key is unchanged (`parallx.pdfHighlights:<fsPath>`, debounced save).
New fields ride along in the same JSON.

## Surfaces

### 1. Capture becomes a command (bidirectional links)

The fire-and-forget `parallx:capture-to-canvas` window event is replaced by a
real canvas command, `canvas.captureSelection`, that does the same page
pick/create + append and then **returns `{ pageId, title } | null`**. The PDF
side awaits it so it can:

- record a `canvasLink` on the originating highlight, and
- **auto-create a highlight** at the selection if one did not already exist, so
  every capture leaves a visible, clickable anchor on the page.

The review panel then lists canvas links with an **"Open in Canvas → {title}"**
action (calls the existing `openPageInEditor`).

### 2. Inline AI on the page (no sidebar trip)

A new selection action, **"Ask AI"**, and a button inside the review panel,
open an AI conversation **anchored to the highlight**, inside the PDF. It uses
the chat extension's existing inline provider (`chat.getInlineAIProvider` →
`{ sendChatRequest, retrieveContext }`) — the very same provider Canvas already
consumes — so there is no new model wiring. The selected passage is the system
context; `retrieveContext` grounds answers in the workspace. Each exchange is
appended to `highlight.thread` and saved. The reader can **send any answer (or
the note) to Canvas** from the panel, closing the read → ask → annotate →
export loop without leaving the document.

"Add Selection to Chat" stays for when the reader *does* want the full sidebar.

### 3. The review panel (upgraded highlight popover)

The existing highlight popover grows into a compact review panel:

- color swatches (unchanged),
- note textarea (unchanged),
- **canvas links** list with Open-in-Canvas,
- **AI discussion** transcript + an Ask-AI input that streams a reply and
  appends to the thread,
- **send to canvas** + delete.

### 4. Margin-icon state

The margin tab icon encodes engagement: highlighter (plain) → note → chat
bubble (has discussion), with a small dot when the passage has canvas links.
This makes a re-read scannable: the reader sees where they did their thinking.

## Plan / build order

1. **Doc + data model** — ✅ this file; extended `PdfHighlight` with `thread`
   + `canvasLinks`; injected `ICommandService` into `PdfEditorPane`.
2. **Capture-as-command** — ✅ `canvas.captureSelection` returns `{pageId,title}`;
   PDF stores `canvasLinks`, auto-creates a highlight on capture (text + region).
3. **Review panel** — ✅ canvas-links section + Open-in-Canvas (`canvas.openPage`);
   AI discussion transcript + Ask-AI streaming via `chat.getInlineAIProvider`;
   every turn persisted to `hl.thread`.
4. **Margin-icon state + CSS** — ✅ engagement-aware icon (chat > note > highlighter);
   `.has-discussion` / `.has-canvas-link` accents; panel/badge styles.
5. **Verify** — ✅ `tsc --noEmit` clean + `node scripts/build.mjs` green. Manual
   smoke of capture→link→reopen and ask-AI→save→reopen still recommended.


## Non-goals (this milestone)

- Clickable **Canvas → PDF** backlinks (canvas editor only opens http/https
  inline links today). The attribution text + stored `sourceUri` make this a
  clean phase-2 follow-up; deferred.
- Live, resumable global chat sessions. We persist transcripts, not sessions.
- Math-OCR / text→LaTeX recovery. Formula capture stays image-based (M-PDF
  "Capture Region as Image").
