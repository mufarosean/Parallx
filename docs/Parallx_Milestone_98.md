# Parallx Milestone 98 — Flashcards Intelligence

> **Status: IN PROGRESS** (started 2026-08-10, branch `m98-flashcards-intelligence`)
> Concurrency note: a separate session may work on ext/media-organizer. This milestone
> touches NOTHING under ext/media-organizer; commits stage explicit paths only.

Upgrades the flashcards extension from a solid SM-2 study tool into the study organ
of the workbench: modern scheduling aimed at a deadline, source-grounded cards,
frictionless capture, a feedback loop on failing cards, and connectivity to the
planner and dashboard.

## Slices

### A. FSRS-6 scheduler + exam-date scheduling — IN PROGRESS
- Hand-implemented FSRS-6 (no npm dep; verified formulas + default weights from
  py-fsrs). Pure function `fcScheduleFsrs(card, rating, now)`; `fcSchedule`
  (SM-2) retained for the replay migration + historical tests.
- Migration `flashcards_003_m98.sql`: fc_cards + `stability REAL`, `difficulty REAL`,
  `last_reviewed_at INTEGER`, `card_type TEXT DEFAULT 'basic'`,
  `note_group TEXT DEFAULT ''`, `cloze_index INTEGER DEFAULT 0`,
  `source_page INTEGER DEFAULT 0`; fc_decks + `exam_date INTEGER DEFAULT 0`,
  `desired_retention REAL DEFAULT 0.9`. (Slice B/F columns ride along so later
  slices are additive-only.)
- SM-2 → FSRS state conversion: REPLAY each card's `fc_reviews` rows through
  FSRS-6 in order (elapsed = gap between consecutive reviews). Cards with no
  reviews stay new. One-shot heal on activate, guarded by
  `reps > 0 AND stability = 0`.
- Exam-date layer (generic deadline, not exam-specific): when a deck has
  `exam_date`, `interval = min(fsrs_interval, max(1, ceil(days_left / 2)))`
  so at least one more review lands pre-deadline; cap ignored once the date
  passes. Deck context menu gets "Set Exam Date"; deck card shows days-left chip.
- `fcIntervalPreview` and grade buttons preview FSRS-derived intervals.
- Learning steps ([1,10] min) retained for intra-day queueing; FSRS short-term
  formula updates S/D on same-day reviews (py-fsrs model).
- Tests: FSRS vectors hand-derived from the formulas + property pins
  (Easy ≥ Good ≥ Hard interval, lapse shrinks S, R(S,S)=0.9, replay trace).

### B. Source grounding + dedup
- Generation on PDF sources keeps `pageTexts` (extractor already returns it;
  Create view currently discards it): material built as `[Page N]` tagged blocks;
  prompt asks for per-card `"page"`; parser reads it (extra keys currently
  dropped at fcExtractCardsJson). `source_page` persisted per card.
- `fcCreateCardsBulk` accepts per-card provenance overrides; insert path moves to
  `api.database.runTransaction` (atomic — removes the compensating-DELETE whose
  key per-card provenance would break).
- Study view: source chip under the answer (label + p.N); click opens the source.
- Dedup at insert: `IEmbeddingService` via `api.services` escape hatch
  (workspace-graph precedent), lazy `fc_card_embeddings` vec0 table (created in
  code, try/catch — NOT in migration), cosine KNN per deck, threshold flags not
  silent drops. Same `note_group` exempt. Degrade: /api/version ping first; if
  Ollama absent, trigram-overlap fallback in JS. Embeddings backfill lazily.
- LM stall guard `fcStreamWithStall` around all extension LM streams (extension
  API has no AbortSignal; a hung Ollama currently spins forever).

### C. Capture (canvas parity; PDF exists)
- PDF "Create Flashcard from Selection" already ships (M48 dispatcher,
  fcCaptureSelection). Upgrade: route `pageNumber` into `source_page`.
- Canvas: extend `BubbleMenuHost` with page identity (provider knows pageId;
  bubble menu currently hardcodes `filePath:'canvas'` — un-navigable), add
  "Make Flashcard" button dispatching `create-flashcard` with
  `parallx://canvas/page/<id>` provenance. Page-level anchoring (block spans
  shift on edit; out of scope).
- Markdown/text editor selection menus get the same item (they already dispatch
  add-to-chat; file path provenance).

### D. Leech loop + Explain This
- Leech = lapses ≥ `flashcards.leechThreshold` (default 5): tagged, surfaced in
  browse + stats, chip in study with "Rewrite with AI" → alternatives generated
  from the card's source text (fallback: card text), user picks/edits, scheduling
  state preserved.
- "Explain This" in study: `chat.show` + `chat.addSelectionContext` (structured
  card + source payload) + `chat.submitPrompt`. NEVER `chat.focus` (blind toggle
  can hide the panel).

### E. Planner forecast + widget enrichment
- New GENERIC planner seam: `PlannerRegistry.registerDayLoadProvider` (module map
  like `_syncProviders`), lazy getter on `PlannerEditorApi` (cron precedent),
  month-cell badge + week header chip; pane subscribes provider.onDidChange.
  Any extension can contribute day loads — not flashcards-specific.
- Flashcards provider: per-day scheduled review counts (honest labeling:
  scheduled minimum, since FSRS reshuffles after every review; overdue rolls
  into today; respects daily caps).
- Existing due widget gains streak + 7-day forecast sparkline.

### F. Cloze + reverse cards (image occlusion CUT — see below)
- `card_type` 'basic' | 'cloze' | 'reverse'; siblings share `note_group`
  (uuid), cloze rows carry `cloze_index`. Creating cloze text {{c1::..}}..{{cN}}
  yields N scheduled sibling rows; reverse checkbox yields 2. Editing one
  sibling updates the group's text.
- Study render: active cloze blanked to [...] on front, revealed on back;
  processed before KaTeX.
- Anki cloze imports stay pre-rendered basic pairs (worker already renders
  ordinals) — no regression.
- **Image occlusion is explicitly out of this milestone**: extensions have no
  binary fs/media pipeline (utf-8-only api.workspace.fs, Anki media dropped at
  import, no blob rendering). Needs a media sub-milestone first.

## Key recon facts (verified 2026-08-10)
- Ext DB = per-extension SQLite at `.parallx/extensions/flashcards/data.db`,
  raw SQL allowed, file-based `*.sql` migrations via `api.database.migrate`,
  sqlite-vec ALREADY loaded (database.cjs:386), blobs cross the bridge.
- `fc_reviews` per-review log already exists (append-only) — enables FSRS replay.
- Existing suite `tests/unit/flashcards.test.ts` pins fcSchedule/fcBuildQueue —
  Slice A rewrites the scheduler sections.
- FSRS-6: R(t,S)=(1+FACTOR·t/S)^DECAY, DECAY=-w20, FACTOR=0.9^(1/DECAY)-1;
  I(r,S)=(S/FACTOR)(r^(1/DECAY)-1); 21 default params (py-fsrs verified).
- Dashboard bridge BUILT (M86); flashcards `parallx-community.flashcards.due`
  widget ships; planner has NO decoration seam (new, this milestone).
- `chat.addSelectionContext` + `chat.submitPrompt` are the chat handoff;
  selection-action CustomEvent listener drops extra fields.
- LM extension API: no AbortSignal, no timeout (hung request = stuck spinner).
