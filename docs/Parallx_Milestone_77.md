# Milestone 77 — Canvas Reliability Hardening

> **Status:** Implemented. All 11 phases shipped, including round-2 / round-3
> audit follow-ups. Phase 10.1 (AI page-write revision bump) verified at
> `pageTools.ts:712`; Phase 11.5 (friendly save-error toast) at
> `canvas/main.ts:325`.

## Why

Canvas is the primary note-taking surface in Parallx, modelled after Notion.
The user reports it feels fragile in routine use:

- Sidebar drag-and-drop sometimes moves pages, sometimes doesn't.
- Block movement within a page is similarly flaky.
- Creating a subpage doesn't always add the page-block to the parent.
- Page blocks vanish from a parent's content while the sidebar still shows
  the child page.
- "Add cover" button typically needs to be clicked twice.

An audit traced these symptoms to three architectural patterns rather than
unrelated bugs:

1. **Dual sources of truth for page hierarchy.** Parent-child is stored in
   both the DB `parent_id` column AND embedded `pageBlock` nodes inside
   the parent's content. The two can drift.
2. **Fire-and-forget async without reconciliation.** UI updates optimistically,
   persistence happens later, errors are logged but neither surfaced nor
   rolled back. Multi-step operations that partially fail leave the UI
   past the point of recovery.
3. **Stale positions and closures.** Tiptap transactions operate on
   positions that earlier operations made invalid. DOM event handlers
   hold references to elements that get re-rendered out from under them.

## Scope

All three audit tiers, plus the recommended code-quality refactor.

In scope:
- Atomic hierarchy operations (single transaction for move + content update)
- Reconciliation on page load
- Surfaced async errors with rollback / retry
- Sidebar drag event queue + tree snapshot
- Block movement position safety
- Cover button feedback
- Idempotent pageBlock helpers
- DnD state machine extraction (cleanup)

Out of scope:
- New block types (separate milestone if desired).
- Full Tiptap upgrade or replacement.
- Switching to Option A (page blocks derived from `parent_id` on render).
  That's a larger refactor; we're taking Option B (keep the cache, but
  make all writes atomic and add reconciliation).

## Phases

### Phase 1 — Atomic hierarchy operations + reconciliation

**The foundation fix.** All hierarchy operations go through new atomic
helpers on `CanvasDataService`:

- `movePageWithBlocks({ pageId, oldParentId, newParentId, afterSiblingId })`
- `createChildPageWithBlock({ parentId, title, ... })`
- `deletePageWithBlocks(pageId)` (already needs cleanup too)

Each helper:
1. Reads the affected parents and the moved/new page in one snapshot
2. Computes new content for both old and new parent
3. Performs DB writes (page row + parent content updates) in a single transaction
4. Only after all writes succeed, fires the change events

Plus a reconciliation pass that runs on page load: scans the doc for
`pageBlock` nodes, verifies each one points to a real child, repairs
drift (removes blocks for missing children, inserts blocks for children
that have no representation).

**Verification:**
- Move a page repeatedly: DB and content stay in sync
- Reconciliation called manually on a deliberately-drifted page repairs it
- A failed DB write rolls back cleanly (no half-applied state)

### Phase 2 — Surfaced async errors

Replace silent `.catch(err => console.error(...))` patterns with:
- An error event the UI can listen to
- A small toast / inline error affordance in the sidebar
- Operation retry logic where appropriate

**Verification:**
- Simulate a DB write failure: user sees an error message, not a silent
  no-op
- Retry succeeds when the underlying cause is transient

### Phase 3 — Sidebar drag event queue + tree snapshot

Replace the `_refreshDeferredByDrag` flag with an explicit event queue:
- Tree-refresh events that fire during drag enqueue
- `_onDragEnd` drains the queue

Snapshot the tree at `dragstart`; validate drop targets against the
snapshot, not the live tree.

**Verification:**
- Concurrent DB events during drag don't disrupt the drag
- Dropping on a deleted target shows an error instead of silently moving
  to nowhere

### Phase 4 — Block movement position safety

In `blockMovement.ts`:
- Validate positions both before and after each Tiptap transaction
- Remap all references after every delete
- Stop using probe transactions for decisions; do real transactions in a
  single batch
- Surface dispatch failures instead of always returning `moved: true`

**Verification:**
- Rapid keyboard moves don't drop blocks
- Column boundary moves work correctly even with intermediate transforms

### Phase 5 — Cover button + UI feedback

- Add disabled state during update
- Wait for `syncPageChange` before re-rendering affordances
- Same pattern for other "single-click" UI affordances

**Verification:**
- First click on Add Cover applies the cover
- Button is briefly disabled with visual indication during update

### Phase 6 — Idempotent pageBlock helpers

- `removePageBlockFromParent` and `ensurePageBlockOnParent` get revision
  checks (or move into the atomic helpers from Phase 1, deprecating
  direct use)
- Double-calls are safe no-ops

**Verification:**
- Calling `ensurePageBlockOnParent` twice doesn't produce duplicate blocks
- Calling `removePageBlockFromParent` twice doesn't error

### Phase 7 — DnD state machine extraction

Split `canvasSidebar.ts` (~1,300 lines) by extracting the drag-and-drop
state machine into a focused module (`canvasSidebarDragState.ts` or
similar). The sidebar holds the state machine; the state machine owns
drag tracking, drop validation, and event queue management.

Pure refactor — no behaviour change beyond what the prior phases
established. Improves long-term maintainability.

**Verification:**
- All tests still pass
- canvasSidebar.ts shrinks to a manageable size

### Phase 8 — Editor pane lifecycle hardening (round-2 audit)

Round-2 audit found four issues in the editor pane's save/load lifecycle
that the M77 Phases 1–7 didn't touch.

- **8.1 — Flush pending saves on dispose.** The debounce timer can hold
  unsaved keystrokes for up to `_autoSaveMs`; closing a tab inside that
  window dropped them. Dispose now invokes `flushPendingSaves()` for the
  pane's page before destroying the editor.
- **8.2 — `_suppressUpdate` exception leak.** In `slashMenu._execute`,
  `_slashRecents.record()` ran AFTER the flag flip but BEFORE the
  try/finally, so a throw there left the flag stuck on and silently
  swallowed every subsequent user edit. Reordered so `record()` runs
  before the flip, and the flip itself is inside the try block.
- **8.3 — `_loadContent` reload race.** Two concurrent reloads could
  interleave so the slower load's `setContent` landed last, reverting
  the editor to stale content. Added a monotonic `_loadGeneration`
  token; each await re-checks against the live generation and bails
  if a newer load has started.
- **8.4 — `_pageBlockIds` snapshot races.** Subsumed by 8.3 — the
  snapshot is updated atomically inside the same critical section as
  `setContent` while `_suppressUpdate` is true, so no transaction can
  observe an empty snapshot, and 8.3's generation token prevents a
  concurrent load from clobbering it mid-write.

### Phase 9 — Data service hardening (round-2 audit)

- **9.1 — Auto-save refreshes `expectedRevision` at fire time.** The
  debounce timer captured `expectedRevision` at schedule time. Between
  schedule and fire (up to `_autoSaveMs`), another writer (title/icon
  reconciler, AI tool) could bump the page revision; the captured
  value was now stale and the auto-save failed with a spurious
  conflict. Both `scheduleContentSave`'s timer callback and
  `flushPendingSaves` now read `_knownRevisions.get(pageId)` at fire
  time instead of trusting the captured value.
- **9.2 — `restorePage` N+1 elimination.** The cascade issued one
  `getPage` per descendant (twice — once for the Updated emit and once
  to look up the parent) plus per-parent lookups for re-attachment.
  Replaced with two batched `SELECT … WHERE id IN (…)` queries: one
  for the restored subtree, one for any external parents.
- **9.3 — Coalesce includes schema version.** `scheduleContentSave`
  compared only `storedContent` strings when deciding to drop a
  schedule. If content was identical but the schema version had
  changed (a migration hot-path), the schedule was dropped silently.
  Equality now compares both content and `schemaVersion`.
- **9.4 — Restore cascade surfaces failures.** Per-child re-attachment
  failures used to throw on the first one and strand the rest of the
  subtree. Now each child is wrapped in its own try; failures are
  collected and rethrown as a single descriptive error at the end so
  the rest of the cascade completes.

### Phase 10 — AI write tooling (round-2 audit)

- **10.1 — AI page-write tools bump revision.** `compose_page` and
  `set_page_style` issued raw `UPDATE pages SET … WHERE id = ?` without
  incrementing `revision`. The canvas data service's optimistic-
  concurrency tracking saw the page's revision unchanged, so a user's
  pending auto-save (captured with the pre-AI revision) silently
  succeeded and overwrote the AI's content. Both tools now append
  `revision = revision + 1` to their UPDATE so the data service notices
  the external write and a concurrent user save surfaces as a conflict
  (the correct co-authoring outcome). `edit_block` / `insert_block_after` /
  `link_block` already did this.

### Phase 11 — UX (round-3 user-experience audit)

After the round-2 code audit closed, a UX walk-through identified surfaces
where the canvas was technically correct but felt unfriendly to real
users — first-time, casual, student, and power workflows. Phase 11
ships nine targeted improvements. Touch / pointer-coarse handling
(item #9 in the round-3 list) was deliberately skipped — canvas is
desktop-only.

- **11.1 — Save indicator.** The data service was already firing
  `onDidChangeSaveState` (Pending/Flushing/Saved/Retrying/Failed) but
  nothing in the chrome consumed it; users had no feedback that their
  keystrokes had persisted. Added a subtle "Saving…/Saved" pill in
  the top ribbon, next to the "Edited Xm ago" label, that fades out
  1.5s after Saved. To allow chrome to subscribe through the
  interface, `SaveStateKind` and `SaveStateEvent` moved from
  `canvasDataService.ts` to `canvasTypes.ts` and `onDidChangeSaveState`
  joined `ICanvasDataService`.
- **11.2 — Sidebar quick-find.** Replaced "scroll the tree" with a
  pinned search input at the top of the sidebar. Matching pages are
  shown with their ancestor chain auto-expanded; Esc clears; Enter
  opens the first hit. Filtering is non-destructive — the user's
  saved expand state is restored when the filter clears.
- **11.3 — Recents section.** Added a collapsible "RECENT" section
  above Favorites driven by a new `ICanvasDataService.getRecentPages()`
  (single `SELECT … ORDER BY updated_at DESC LIMIT 5`). Hidden during
  active filtering and on empty workspaces so it never duplicates
  other surfaces.
- **11.4 — Page templates.** Three curated starter templates (Daily
  note, Meeting notes, Project brief) accessible via a modal opened
  by the new `canvas.showTemplatePicker` command and the empty-state
  hero button. Each template is just a TipTap doc skeleton — picking
  one creates a normal page and flushes the seed content.
- **11.5 — Friendly save-error toast.** The prior toast surfaced raw
  errors ("Revision conflict for page abc-123…"). For the common
  revision-conflict case the toast now reads "This page was changed
  elsewhere. Reload to see the latest version" with a primary
  Reload action that fires `fireContentReload`. Other failures get
  a generic "Couldn't save this page" message plus the raw detail in
  parens for debugability.
- **11.6 — Keyboard shortcut overlay.** New `Mod+/` shortcut
  registered via the editor's BlockKeyboardShortcuts extension opens
  a modal listing every keyboard interaction the canvas supports,
  grouped (Block actions, Text formatting, Insert blocks, Sidebar,
  Help). Also exposed as `canvas.showKeyboardShortcuts` command.
- **11.7 — Richer empty state.** Replaced bare "No pages yet" with a
  hero ("Start your knowledge base"), one-sentence explainer, two
  primary actions (Blank page / Use a template), and three hint
  rows ("/", "Ctrl+/", "Drag").
- **11.8 — Sidebar undo toast.** Move and rename operations now show
  a 5-second non-modal toast at the bottom of the sidebar with an
  Undo action that runs the reverse operation
  (`movePageWithBlocks` back / `updatePage({ title: prior })`).
  Reorder-within-same-parent is suppressed to avoid noise. Single
  toast at a time; a new operation replaces the prior toast.
- **11.9 — Type-to-find in sidebar.** Pressing a printable key while
  the tree has focus accumulates into a short buffer (resets after
  1s of inactivity or Esc) and jump-focuses the first matching page.
  Prefix matches win; falls back to contains. Modified keys are
  ignored so shortcuts still work.

### Round-2 audit corrections (no code change)

Two audit findings turned out to be false positives on closer reading:

- **"SlashMenu keydown listener never removed."** The handler is
  declared as `private readonly _handleKeydown = (e) => ...` — a class
  field with an arrow function, which is evaluated once in the
  constructor and produces a STABLE reference for every access.
  `removeEventListener` correctly matches. The cleanup path
  (`hideAll → hide → removeEventListener`) is invoked before
  `editor.destroy()` in pane dispose. No leak.
- **"No permission gates on AI-written content."** All AI page-mutating
  tools (`compose_page`, `set_page_style`, `create_page`, `edit_block`,
  `insert_block_after`, `link_block`) already carry
  `requiresConfirmation: true` + `permissionLevel: 'requires-approval'`.
  The real underlying concern was the revision-bump gap, addressed in
  10.1.

## Success criteria

- Each user-reported symptom: reproduce, then confirm the fix closes it
- Full test suite passing after every phase
- No regression in existing canvas tests
- Reconciliation pass catches any future drift before users see it
