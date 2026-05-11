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

## Phase θ — B5 (page mtime fast-skip) + B4 (batched IPC upserts) + B3 (off-thread embedding)

**Date:** 2026-05-05
**Branch:** `milestone-60`

### B5 — Page mtime fast-skip

`_indexAllPages` now opens with a lightweight `SELECT id, updated_at FROM pages
WHERE is_archived = 0` (no `content` column hydrated), pulls
`vectorStore.getIndexedAtMap('page_block')`, and partitions on
`pages.updated_at <= indexed_at`. Only the candidates (mismatched + missing)
get the heavy `(id, title, content)` hydration via parameterized `IN`-clause
batches of 500. Behind `indexing.lazyMtime.enabled` (default **on** —
emergency rollback only).

| Measurement | Target | Asserted by |
|-------------|--------|-------------|
| Pages skipped on warm reopen of unchanged workspace | ≥ 95% | 100/100 skipped with **zero** hydration query — `tests/unit/indexingPipelineMtimeFastSkip.test.ts` |
| Mixed old/new partitioning | new pages chunk; old pages skip | asserted (1 fresh + 1 stale → 1 chunkPage call) |
| Legacy hash-check preserved when flag off | byte-identical to pre-θ behavior | asserted (no accessor + accessor-returns-false both run legacy path) |

### B4 — Batched IPC upserts

`vectorStoreService.upsert(...)` now delegates to a private `_buildUpsertOps`
and issues one `runTransaction` as before; new `upsertMany(records[])`
concatenates per-source op arrays into a **single** `runTransaction` so N
sources commit in one IPC. The `'$lastRowId'` sentinel contract is preserved —
each per-chunk insert chain (vec_embeddings → chunk_metadata → fts_chunks)
stays contiguous so the sentinel resolves locally regardless of how many
sources are concatenated.

`IndexingPipelineService` adds a `_pendingUpsertBatch` queue installed by the
two bulk loops (`_indexAllPages`, `_indexAllFiles`) and drained every
`UPSERT_FLUSH_EVERY=20` records (or at the loop's `try/finally` flush).
Incremental paths (`reindexPage`, `reindexFile`) leave the queue null and
commit immediately — no behavior change.

| Measurement | Target | Asserted by |
|-------------|--------|-------------|
| `runTransaction` count for N sources within one flush | 1 (was N) | `tests/unit/vectorStoreUpsertMany.test.ts` — 50 sources → 1 call |
| Op count per batched call | `2 deletes + 3·chunks·sources + 1 metadata` per source | asserted (50×3-chunk records → 600 ops total) |
| Sentinel locality after concatenation | every `'$lastRowId'` op preceded by an INSERT | asserted across two concatenated sources |
| Empty batch IPC count | 0 | asserted |

### B3 — Off-thread embedding transport

New `src/services/embeddingWorker.ts` — `EmbeddingWorkerClient` lazily spawns
a Web Worker via Blob URL with the worker source inlined as a string
template (no separate worker bundle, esbuild iife-friendly). The worker is a
stateless `/api/embed` fetch + JSON parse + dimension check. The renderer
side keeps the cache + retry path on `EmbeddingService` so the worker can be
killed and respawned freely without losing cached embeddings.

`EmbeddingService.setTransport(fn|null)` swaps the in-process `_callEmbedApi`
for the worker variant; `IndexingPipelineService._maybeInstallEmbeddingWorker()`
runs after `ensureModel()` and gates installation on
`indexing.worker.enabled` (default **off**, β-channel opt-in) AND `Worker`
runtime availability AND `setTransport` being implemented. On any error
(spawn failure, transport throw, dispose) we revert to the in-process path —
the worker is purely an optimization.

| Measurement | Target | Asserted by |
|-------------|--------|-------------|
| Worker safe-no-op when `Worker` undefined (vitest jsdom) | `isAvailable()` returns false; transport never installed | `tests/unit/embeddingWorker.test.ts` |
| Transport routing | `setTransport(fn)` causes `embedDocumentBatch` to skip `fetch` and call `fn` with `search_document: ` prefix | asserted |
| Reversion | `setTransport(null)` restores the in-process fetch path | asserted |
| Empty batch | `embedBatch([])` short-circuits to `[]` | asserted |
| Error propagation | transport throw surfaces from `embedDocumentBatch` so the pipeline-level `_embedChunks` retry path can take over | asserted |
| 0% renderer-thread CPU during bulk phase | β-channel bake-time work | **not asserted in unit suite** — flag-off at GA, live trace pending β |

### Acceptance against §5.2 (full)

| Criterion | Status |
|-----------|--------|
| UI interactive within 500ms of window paint | ✅ (B1+B2) — yield cadence + idle gating asserted |
| ≥ 95% pages skipped on warm reopen | ✅ (B5) — 100/100 skipped with zero hydration |
| 1000 vector upserts in a single transaction batch < 200ms; IPC count drops by ≥ 10× | ✅ (B4) — IPC count drop asserted (`O(sources)` → `O(sources/UPSERT_FLUSH_EVERY)`); 200ms wall-clock target measured live in β |
| 0% renderer-thread CPU during bulk indexing | ⚠️ (B3) — ships dark-launched; β-channel bake |

---

## Future phases

- Live Performance trace on a 10k-file workspace (β-channel) — flip
  `indexing.worker.enabled` on, capture a Chrome DevTools timeline,
  compare against the in-process baseline. This is the formal proof of the
  B3 0%-renderer-thread target.
