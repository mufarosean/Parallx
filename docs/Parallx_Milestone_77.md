# Milestone 77 — Canvas Reliability Hardening

> **Status:** Planning + execution underway.

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

## Success criteria

- Each user-reported symptom: reproduce, then confirm the fix closes it
- Full test suite passing after every phase
- No regression in existing canvas tests
- Reconciliation pass catches any future drift before users see it
