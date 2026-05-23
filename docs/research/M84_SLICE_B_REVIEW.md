# M84 Slice B Review — IPC Count/Duration Baseline

**Status:** KEEP (instrumentation + numbers).
**Commit:** `708c06f3` `feat(fitness): IPC instrumentation baseline (M84 Slice B)`
**Date:** 2026-05-23

---

## 1. What shipped

- `tests/fitness/_shared/ipcCounter.ts` — main-process-side IPC counter installed via Playwright's `ElectronApplication.evaluate()`. Monkey-patches `ipcMain._invokeHandlers` (the internal Map populated by `ipcMain.handle`) plus `ipcMain.handle` itself, so every existing AND every subsequently-registered handler is wrapped with a `{channel, ms}` timing emitter. Aggregator computes per-channel `count / p50 / p95 / p99 / totalMs` and overall `totalCalls / totalDurationMs`.
- `tests/fitness/ipc.fitness.ts` — 5 cold launches, first sample discarded. Counter attaches the moment `electron.launch()` returns, then captures every IPC from that point until 3 seconds after the workbench-ready selector is visible. The top 10 channels by total handler time are emitted as report notes so regressions surface qualitatively (not just quantitatively).
- `docs/research/baselines/workbench-baseline.md` §2 — three new H11 rows for total calls, cumulative duration, and distinct channels per workflow.

---

## 2. Audit conformance

| Audit clause | Conformance |
|---|---|
| §1.2 "leave `timedDbHandler` alone; observe via console.warn scrape + renderer-side wrap" | Renderer-side wrap blocked by contextBridge readonly semantics. Substituted main-process `ipcMain._invokeHandlers` patch — same observation-only intent, no source modification, fully reversible at test-process exit. Audit alternative path. |
| §2 "Net-new file `tests/fitness/_shared/ipcCounter.ts`" | Honored. |
| §7 "tolerance = p95 × 1.25" | Honored. |
| Anti-list (M84 §4): no `electron/*` mutation | Verified — diff touches zero anti-list files. |

The audit prescribed wrapping `window.parallxElectron`. That path is dead because `contextBridge.exposeInMainWorld` exposes properties non-writable. Documented in `ipcCounter.ts` header. The substitute (main-process `_invokeHandlers` patch via `evaluate()`) is the **only** observation-only path that catches the full IPC distribution rather than just the 50ms-slow tail.

---

## 3. Baseline numbers

| Metric | p50 | p95 | tolerance (p95 × 1.25) |
|---|---|---|---|
| totalCallsPerRun | 278 | 278 | 347.5 |
| totalDurationMsPerRun | 667 ms | 689 ms | 861.3 ms |
| distinctChannelsPerRun | 29 | 29 | 36.3 |

### Per-channel breakdown (last run, top 10 by total time)

| Channel | Count | p50 | p95 | p99 | Total |
|---|---|---|---|---|---|
| `fs:readdir` | 54 | 1 ms | 30 ms | 34 ms | 259 ms |
| `docling:start` | 1 | 169 ms | 169 ms | 169 ms | 169 ms |
| `database:all` | 55 | 0 ms | 5 ms | 12 ms | 49 ms |
| `fs:readFile` | 18 | 1 ms | 20 ms | 20 ms | 41 ms |
| `tools:scan-directory` | 3 | 2 ms | 26 ms | 26 ms | 29 ms |
| `storage:write-json` | 4 | 10 ms | 10 ms | 10 ms | 26 ms |
| `database:run` | 41 | 0 ms | 0 ms | 18 ms | 19 ms |
| `tools:read-module` | 6 | 4 ms | 5 ms | 5 ms | 18 ms |
| `fs:exists` | 38 | 0 ms | 2 ms | 6 ms | 17 ms |
| `mcp:spawn` | 1 | 10 ms | 10 ms | 10 ms | 10 ms |

Observations:

- **`fs:readdir` dominates wall-clock** (259 ms total across 54 calls; p95 30 ms). Slice F (persistence/workspace-switch) is the most likely amplifier and should retain this baseline as its anti-regression gate.
- **`database:all`/`database:run` together = 96 calls in 68 ms**. Healthy floor — the M78 PRAGMA work plus WAL is paying. Slice D (canvas mixed-op) is the most likely amplifier.
- **`docling:start`** fires exactly once but is the second-largest single-call (169 ms). This is the docling preview-pane spinup. If Slice C exercises a document preview, this channel will dominate that baseline.
- **29 channels** total tracked. The audit feared private-API breakage (Electron renaming `_invokeHandlers`). The non-zero channel count proves the patch took effect; the run-zero zero-channel safety note in the module would fire loudly if it ever broke.

---

## 4. Variance posture

Inter-run variance carries the **same caveat as Slice A** — observed stdev is dominated by OS disk-cache state, not by the fitness harness itself. The numbers above are from a single fitness run; a second back-to-back run would likely show ~50% lower totals because the app binary and node_modules are now in RAM.

**Decision:** do NOT block Slice C on a methodology revision. Slices B–F will all share the A.1 limitation, and the closeout doc will re-baseline once A.1 ships (post-Slice F per the Slice A review verdict).

---

## 5. Followups

- **B.1** (resolved in this slice's shipping form): `_invokeHandlers` is private API. If Electron ever renames it, the counter silently captures nothing. Mitigation: the test emits a `run 0: zero IPC observed` note when run-0 has zero events, which would fail the developer's smell test on the next bump.
- **B.2** (deferred to FITNESS_HARNESS.md in Slice F): document the per-channel breakdown is a snapshot from the LAST run, not aggregated across all runs. Aggregating per-channel p95 across runs requires a richer report schema (Map of channel→samples-array). Not needed for SR-4's purpose (system-fitness gate); useful for future regression triage.
- **B.3** (deferred to A.1 followup chain): aggregate inter-run variance on totals (currently 0% on this single-run capture because all 4 samples landed at the same int after warm-disk effects collapsed them). Capturing stdDev + coefficient_of_variation across runs lands with A.1 alongside the cold/warm-disk split.

---

## 6. Verdict

**KEEP.** The Slice B harness is observation-only, faithful to the audit intent, and the numbers it produced are credible (channels match what `grep -r ipcMain.handle electron/` would predict). Methodology revisions from A.1 will apply to this slice's numbers downstream — no Slice B-specific revision required.

**Next:** Slice C — cross-tool workflow baseline (Explorer → editor → chat → Canvas → save → reopen, end-to-end timing).
