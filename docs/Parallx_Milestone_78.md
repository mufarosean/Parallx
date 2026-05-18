# Milestone 78 — Performance Hardening

> **Status:** Planning + execution underway.

## Why

The whole-app responsiveness audit (post-M77) traced periodic app freezes
to a single architectural fact: `better-sqlite3` runs synchronously inside
the Electron main process. The `async` IPC handlers in `electron/main.cjs`
are cosmetic — every `db.run()` blocks the main thread until the OS reports
the write durable. The main process serializes all IPC, so one slow query
stalls window controls, menus, every other tool, and the renderer's await
chain. On slow disks (USB, networked drives), per-commit fsync latency can
reach 50–200 ms, and many subsystems issue more IPC than necessary per user
action.

The structural fix — moving SQLite into a `worker_thread` — is large and
needs its own milestone. M78 ships everything we can do **without** that
refactor: stop adding load, coalesce existing churn, and make the disk
faster when it is on the critical path. Each change is Pareto-improving:
faster with no behavior change the user could notice as a regression.

## Scope

In scope: nine independent phases that each ship on their own and never
trade UX for performance.

Out of scope (deferred to a future milestone):
- Moving SQLite to a Node `worker_thread` (the structural fix).
- Streaming Tiptap doc encode / image extraction to side store. Risk of
  edge cases in encode/decode.
- Lazy tool activation at startup. Users would see "loading…" indicators
  for some tool surfaces; counts as a UX trade.

## UX contract

Every phase in M78 must satisfy this guardrail:

> **The user must not be able to tell anything changed except that the
> app is faster.** No new spinners. No new "loading…" states. No delays
> longer than the existing perception window for any operation that
> previously felt instant. No stale UI that doesn't recover within the
> next user action.

Each phase below has an explicit *UX impact* section documenting what
the user could possibly notice and why it doesn't violate the guardrail.

## Phases

### Phase 1 — IPC timing instrumentation (dev mode)

Baseline measurement. Adds a small wrapper around the `database:*` and
heavy `fs:*` IPC handlers that records duration and logs anything > 50 ms
in dev mode. The wrapper is a no-op in production so the user never pays
for it.

**Why first:** every subsequent phase claims a perf improvement. Without
a baseline we can't tell whether we actually helped. The logging output
gives us a before/after for each change.

**UX impact:** zero. Dev-mode only.

**Verification:** invoke a canvas save in dev mode; see one timing line
per IPC; observe the absence of those lines in a production build.

### Phase 2 — SQLite PRAGMAs

Verify (and set, if missing) the following PRAGMAs on workspace database
open:

- `journal_mode = WAL` — already the better-sqlite3 default but worth
  asserting. WAL means writers don't block readers, and fsync only
  happens on checkpoint (not per commit), which is a substantial win
  on slow disks.
- `synchronous = NORMAL` — safe with WAL. Cuts fsync count by trading
  the (already small) durability window. Crash recovery is unaffected;
  only an OS-level crash within ~milliseconds of the commit could lose
  the most recent transactions, and we already accept that risk via
  the autosave debounce.
- `wal_autocheckpoint = 1000` — explicit value so the WAL doesn't
  grow unbounded on long sessions.
- `temp_store = MEMORY` — keep intermediate sort/group/cte data in
  memory instead of spilling to disk on the workspace volume.

**UX impact:** zero. No behavior changes; saves are just faster.

**Verification:** run an UPDATE in dev mode and confirm the IPC-timing
instrumentation reports a substantial improvement on a slow-disk
workspace.

### Phase 3 — Embedding worker default on

The embedding worker module already exists, has tests, and works. It is
gated behind a config flag `indexing.worker.enabled` that defaults to
**false**. The default flips to **true** in M78. Users with the flag
explicitly set keep their preference.

**UX impact:** indexing no longer blocks the renderer during embed
batches. The user-visible behavior is identical except that the rest of
the app stays responsive while indexing runs.

**Verification:** open a fresh workspace with ≥100 files; observe that
the indexing progress indicator updates while the user can still scroll,
type, and click. Compare to the pre-flag state.

### Phase 4 — Canvas save fan-out reduction

A single canvas autosave currently does ~7 IPC round-trips:
1. `UPDATE pages` (the actual save)
2. `SELECT pages` (refresh `_knownRevisions`)
3. `UPDATE properties` (write `modified` timestamp)
4. `SELECT pages` (sidebar refresh — main tree)
5. `SELECT pages` (sidebar refresh — favorites)
6. `SELECT pages` (sidebar refresh — archived)
7. `SELECT pages` (sidebar refresh — recents)

The Phase 4 changes:

- **Filter `content` / `contentSchemaVersion` out of
  `doesPageChangeAffectSidebar`.** The sidebar doesn't render content;
  refreshing on content saves is pure waste. Title / icon / archive /
  favorite / hierarchy changes still trigger refreshes.
- **Drop the `modified`-property write on save.** The `pages.updated_at`
  column is already updated by the page UPDATE. The property bar is
  pointed at `pages.updated_at` instead.
- **Trust `updatePage`'s return value.** The post-update `SELECT pages`
  in `updatePage` is a defensive re-read that we can replace with the
  in-memory state we already know (the UPDATE returned the new revision
  via `RETURNING` / explicit re-read inside the same transaction).

Net: 7 IPC → 2 IPC per save.

**UX impact:** the sidebar tree and Recents section still react to
every user-visible state change (rename, add subpage, archive, restore,
move, favorite, icon change). The `modified` timestamp shown in the
property bar still updates after every save — it's just sourced from
the column that was always being written anyway. The auto-save
indicator pill still ticks Pending → Flushing → Saved on every save.

**Risk:** if any subsystem subscribes to `onDidChangePage` and assumed
content changes triggered it, those subsystems would stop receiving
the event. Indexing pipeline already subscribes via
`onDidSavePage`, not `onDidChangePage`, so it's unaffected.
Search and Workspace Graph receive content via their own indexing
listeners. Cross-checked in code: no other consumer relies on
`onDidChangePage` to know about content edits.

**Verification:** rename a page → sidebar shows new title. Add a
subpage → sidebar shows new node. Edit content for 30 s → sidebar does
not flicker, modified timestamp updates in the property bar, save
indicator cycles through Saving → Saved.

### Phase 5 — Autonomy event log append-only

Current behavior ([autonomyEventLog.ts:285-306](../src/services/autonomyEventLog.ts)):
every event reads the entire day's log file, appends one line in memory,
then writes the entire file back. The file grows over a day; by end of
day each event is rewriting megabytes. Per event: 2 IPC + 1 whole-file
read + 1 whole-file write.

New behavior:
- Use the file service's append mode if available, or fall back to a
  short read-then-write of just the new tail.
- Buffer events in memory and flush every 200 ms or 16 events, whichever
  fires first. Flush on app exit (`window.beforeunload` / dispose path).
- The log file format is unchanged. Existing files still parse correctly.

**UX impact:** autonomy turns no longer pin the main process during
event logging. The user sees the same event timeline in the autonomy
log view; events appear with at most 200 ms latency vs. the previous
sync write.

**Risk:** an app crash within 200 ms of an event could lose up to 16
buffered events. Acceptable for an event log (not user content). The
flush-on-dispose path catches normal exits.

**Verification:** run an agent turn with 10 tool calls. Confirm all
events land in the log file within 200 ms of the turn completing.
Confirm a normal app close flushes pending events.

### Phase 6 — File watcher event coalescing

OS file-change events fire one IPC callback per event with no
deduplication ([fileService.ts](../src/services/fileService.ts)). A
build tool writing 50 files produces 50 callbacks, each of which fans
out to indexing pipeline + semantic graph + tree refresh listeners.

New behavior:
- The file service buffers events in a 50 ms window keyed by `(path,
  changeType)`. The window slides if more events arrive for the same
  path during the window.
- After the window closes, listeners receive a deduplicated batch in
  one event emission.

**UX impact:** the file tree updates feel snappier under bulk
operations. A 50 ms coalescing window is below the human perception
threshold for "instant" feedback — the tree still appears to react
instantly to user-initiated file operations. Background changes (build
tools, AI writes) are now batched into one refresh instead of fifty.

**Risk:** none meaningful. 50 ms is shorter than the smallest user
action latency we already accept (keystroke autosave debounce is 500 ms).

**Verification:** edit a single file → tree updates within 50–100 ms.
Trigger a build that writes 50 files → tree shows all of them within
one refresh, no flicker.

### Phase 7 — Defer proactive suggestions first run

`ProactiveSuggestionsService._scheduleAnalysis` is called immediately
after `onDidCompleteInitialIndex` with `delay = 0` because
`_lastAnalysisTime` starts at 0
([proactiveSuggestionsService.ts:143-152](../src/services/proactiveSuggestionsService.ts#L143-L152)).
The first analysis runs straight away on workspace open — exactly when
the user is trying to start working.

New behavior:
- The first analysis is scheduled behind an idle gate: wait for the
  renderer's `requestIdleCallback` (or a 3 s timeout) before running.
- Subsequent analyses continue to use the 5-minute cooldown as before.

**UX impact:** suggestions take a few seconds longer to first appear
after workspace open. In return, the app is interactive immediately
after indexing completes instead of hanging while clustering runs.
The user is far more likely to notice "the app froze for a second" than
"suggestions arrived 3 seconds later." The 5-minute cooldown is unchanged
so subsequent updates behave exactly as before.

**Risk:** none significant. The first batch of suggestions appears
within a small bounded delay; the suggestions surface itself doesn't
change.

**Verification:** open a fresh workspace; immediately after indexing
completes, the UI is responsive (scroll, type, switch tabs). Suggestions
appear ≤3 s later.

### Phase 8 — `onDidSavePage` carries the saved page (eliminates one IPC per save)

The canvas-side `onDidSavePage` listener used to do its own `getPage`
just to obtain the page object it then handed to the reindex scheduler.
That re-read was redundant — `updatePage` already had the fresh page
in hand when it fired the event. M78 Phase 8 widens the event payload
to carry the page object so the listener uses it directly.

The original plan for Phase 8 was vector-store batch upsert on the
incremental reindex path. After tracing it, the bigger win turned out
to be eliminating the redundant `getPage` IPC. The incremental reindex
path is already debounced 3 s per page, so its IPC pressure on real
workloads is modest; the per-save `getPage` happens on every autosave
debounce, which is far more frequent. Vector-store batching for the
incremental path remains a future improvement.

Changes:
- `onDidSavePage` now emits `PageSaveEvent = { pageId, page }` instead
  of just `pageId`. The shape is a strict superset for use-cases that
  only care about the id (`event.pageId` is identical).
- All three fire sites in `canvasDataService.ts` pass the page object
  that `updatePage` returned.
- The canvas main.ts listener uses `event.page` directly; the prior
  `getPage` IPC is removed.
- The editor pane's save-completion listener was destructured-rename
  only; behavior unchanged.

**UX impact:** zero. The reindex scheduler receives the same page data
it always did, just without an extra IPC.

**Verification:** save a canvas page; the page is still re-indexed
(check Workspace Graph reflects the new content). Property bar
modified timestamp still updates. No console errors.

### Phase 9 — Verification matrix

A docs-only phase that documents the manual UX-regression test plan
so future contributors can verify that no perf change has snuck a UX
cost in. Covers every flow touched by Phases 4–8:

- Canvas save: sidebar reacts to user-visible changes; modified
  timestamp updates; save indicator cycles
- Autonomy turn: events appear in log; close-and-reopen shows all
  events present
- File watcher: single edit feels instant; bulk write shows one
  consolidated refresh
- Suggestions: workspace open is responsive; suggestions arrive
  within ~3 s
- Reindex: search reflects edits within 3 s as before

## Success criteria

- IPC-timing instrumentation shows ≥50 % reduction in average
  per-save IPC time on a USB workspace.
- Verification matrix all passes manually.
- Full automated test suite green.
- No new "loading" affordances, no new spinners, no perceptibly delayed
  surfaces.

## Out of scope

- Worker-thread SQLite (deferred to a future structural milestone).
- Streaming Tiptap encode / image extraction.
- Lazy tool activation.
- Major Tiptap upgrade or replacement.
