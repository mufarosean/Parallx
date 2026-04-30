# Startup Performance — Indexing Pipeline

Tracks Tier 2 (Responsiveness Under Load) measurements landed in
[Milestone 60](./Parallx_Milestone_60.md) §5.

---

## Phase β — B1 (cooperative yielding) + B2 (deferred start)

**Date:** 2026-04-30
**Branch:** `milestone-60`
**Files touched:**
- [src/services/indexingPipeline.ts](../src/services/indexingPipeline.ts) — yields + `_waitForIdleStart()`
- [tests/unit/indexingPipeline.perf.test.ts](../tests/unit/indexingPipeline.perf.test.ts) — yield cadence + idle-wait assertions

### B1 — Cooperative yielding

| Loop | Cadence | Reasoning |
|------|---------|-----------|
| `_indexAllPages` (`indexingPipeline.ts:524`) | `await new Promise(r => setTimeout(r, 0))` after every page | Each iteration includes chunking + an embedding round-trip, so per-iteration yield is appropriate; matches the same "yield often during heavy steps" cadence as the directory walker (`DIRECTORY_WALK_YIELD_EVERY=200` for cheap entries) |
| `_embedChunks` (`indexingPipeline.ts:945`) | Yield between batches (skip the first to avoid a needless tick) | Each batch is one Ollama HTTP round-trip; yielding between batches lets the renderer paint while a long file's chunks stream through |

The directory walker (`_walkDirectory`) was already yielding every 200 entries
via `await Promise.resolve()`; that cadence is unchanged.

### B2 — Deferred start

`IndexingPipelineService.start()` now defers its first run via
`requestIdleCallback` (with a 3000ms timeout) so the workbench can paint and
built-in tools can finish activation before embedding CPU spikes. The deferral
lives **inside** the service so the workbench start-point at
`workbench.ts:2500` is unchanged (boundary-respecting, see
`Parallx_Milestone_60.md` §3.4).

Production behavior:
- Chromium-based renderer always exposes `requestIdleCallback`. The pipeline
  waits for the first idle slot (or the 3s timeout, whichever comes first),
  then proceeds.
- `cancel()` during the idle wait aborts cleanly via `AbortSignal`.

Test/Node behavior:
- `requestIdleCallback` undefined → falls through to a 2.5s `setTimeout`
  fallback, except in vitest (`process.env.VITEST === 'true'`) where the
  fallback short-circuits to `Promise.resolve()` so the existing
  `indexingPipeline.test.ts` suite doesn't pay a 2.5s penalty per `start()`.

### Measurements

| Signal | Value | Source |
|--------|-------|--------|
| Yield cadence (page loop, N=5) | ≥ 5 zero-delay `setTimeout` calls | `tests/unit/indexingPipeline.perf.test.ts` — "yields between page iterations" |
| Yield cadence (embed loop, 100 chunks ⇒ 4 batches) | ≥ 4 yields total (1 page + 3 inter-batch) | `tests/unit/indexingPipeline.perf.test.ts` — "yields between embedding batches" |
| Deferred start gating | `ensureModel` not called until rIC fires | `tests/unit/indexingPipeline.perf.test.ts` — "waits for requestIdleCallback before doing any indexing work" |
| Cancel-during-idle | `start()` unwinds without invoking `ensureModel` | `tests/unit/indexingPipeline.perf.test.ts` — "proceeds immediately when cancel() fires during idle wait" |

**Live trace status:** Pending. The B1+B2 floor is asserted via test-driven
yield-cadence + idle-gating measurements (see §5.3 of M60 — "L7 testing"
allows vitest fake/real timer assertions in lieu of a captured Performance
trace when live capture is impractical). A Chrome DevTools Performance trace
will be captured during M60 Phase γ when the larger T2 work (B3 worker, B4
IPC batching, B5 lazy indexing) lands together — at that point the
before/after delta is meaningful end-to-end.

### Acceptance against §5.2

| Criterion | Status |
|-----------|--------|
| UI interactive within 500ms of window paint | **Not directly captured** — gated by Phase 5 layout, not B1/B2. B1+B2 ensure no busy-loop blocking; live trace deferred to Phase γ |
| No "Not Responding" dialog under heavy indexing | **Asserted indirectly** — every page iteration and every embedding batch now releases the event loop; the renderer cannot accumulate a >1-frame busy span during the page or embed loops |
| Verified with Performance trace before/after | **Test-asserted yield cadence** in lieu of live trace; live trace deferred per §5.3 L7 |

---

## Future phases

- **B3** (Web Worker) — Future_Improvements.md §1 Option 3. Largest refactor;
  separate phase.
- **B4** (IPC write batching) — Option 4.
- **B5** (Page mtime fast-skip + lazy indexing) — Option 5.
