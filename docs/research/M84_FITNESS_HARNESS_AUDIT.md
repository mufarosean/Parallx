---
Status: Audit Complete (Research Agent, 2026-05-23)
Milestone: M84 / SR-4: System Fitness Harness — research gate
Branch: systems-redesign-planning
Created: 2026-05-23
Conductor: Systems Redesign Conductor
Manifest: docs/PARALLX_MANIFEST.md (§14 sequential handoffs, §22 verification contract)
Predecessor artifacts: docs/research/baselines/workbench-baseline.md, docs/architecture/SYSTEM_ATLAS.md, docs/architecture/WORKBENCH_INTERACTION_MODEL.md
---

# M84 / SR-4 — Fitness Harness Research Audit

Answers the five questions in [Parallx_Milestone_84.md §6](docs/Parallx_Milestone_84.md) and the external comparison in §7. Findings drive the Slice A scope.

## 1. Existing Timing Instrumentation in `src/**` and `electron/**`

Catalogued every `performance.now()`, `console.time`, `Date.now()`, and explicit duration counter in production code.

### 1.1 `src/**` timing call-sites (representative)

| Location | What it times | Output | Reusable for harness? |
|---|---|---|---|
| [src/commands/commandRegistry.ts L139–L142](src/commands/commandRegistry.ts) | Command execution duration | Emits `commandService.command.executed` event with `durationMs` | **Yes** — Slice C (cross-tool) subscribes to this event |
| [src/tools/toolActivator.ts L141, L172, L195, L205, L248, L284, L293, L329, L384](src/tools/toolActivator.ts) | Per-tool activation phases (init, activate, configure) | `console.log` + `observabilityService` events | **Yes** — Slice E (extension activation failure) reads these events |
| [src/services/embeddingService.ts L312, L324](src/services/embeddingService.ts) | Embedding batch duration | Logged | No — not in M84 scope |
| [src/services/indexingPipeline.ts L531, L562, L663, L676, L683, L694, L700](src/services/indexingPipeline.ts) | Indexing batch + tick timings | Event-based | No — out of M84 scope |

**Verdict:** `commandRegistry` and `toolActivator` already emit structured timing events. The harness should consume these events rather than re-instrument the same lines.

### 1.2 `electron/**` timing

| Location | What it times | Notes |
|---|---|---|
| [electron/main.cjs L1856–L1872](electron/main.cjs) `timedDbHandler` | Every DB IPC handler (`database:run`, `database:get`, `database:all`, `database:runTransaction`) | Dev-mode only (`if (app.isPackaged) return handler;`). 50 ms slow-log threshold via `IPC_SLOW_LOG_MS`. |
| [electron/doclingBridge.cjs L365–L367](electron/doclingBridge.cjs) | Docling health probe | Out of M84 scope |

**Verdict for IPC baseline (Slice B):** the existing `timedDbHandler` is the right anchor. The harness needs to **upgrade the slow-log to a structured counter** rather than a `console.warn`. The cleanest path that does not touch the anti-list is:
- Leave `timedDbHandler` source alone.
- In `tests/fitness/ipc.fitness.ts`, run the workflow under `PARALLX_FITNESS=1`, drain `console.warn` lines matching the `[IPC slow]` format, and aggregate.
- For p50/p95/p99 across all IPC calls (not just slow ones), add a **renderer-side counter** by wrapping the renderer's IPC bridge call surface in a `tests/fitness/_shared/ipcCounter.ts` Playwright `addInitScript`.

This keeps the entire harness layer out of `electron/preload.cjs` and `electron/main.cjs`.

## 2. IPC Handlers Exposing Call Count / Duration

Only the four DB handlers above expose duration today (and only above 50 ms). The remaining ~80 IPC channels exposed by `electron/preload.cjs` are not timed.

**Decision:** Slice B uses a Playwright `addInitScript` to wrap `window.parallx.*` and `window.databaseAPI.*` in the renderer, recording `{ channel, args_summary, start_ms, end_ms }` for every call during the cross-tool workflow. Aggregated to p50/p95/p99 and total count. Zero source modification required.

## 3. Existing Test Coverage That Already Measures M84 Targets

| Target | Existing test | Action |
|---|---|---|
| Startup (cold) | [tests/e2e/fixtures.ts L87–L102](tests/e2e/fixtures.ts) launches Electron + waits for `[data-part-id="workbench.parts.titlebar"]` selector | Reuse the launch path; add `performance.now()` deltas around launch → titlebar visible → first editor visible. **No new launcher needed.** |
| IPC count/duration | [tests/unit/mediaOrganizerFtsRebuild.test.ts L61](tests/unit/mediaOrganizerFtsRebuild.test.ts) uses `IPC_LATENCY_MS = 0.5` mock | Mock is for unit-test FTS rebuild; not reusable for real-IPC baseline. Slice B is net-new. |
| Cross-tool workflow | None measures timing end-to-end | Slice C is net-new. |
| Canvas mixed-op | [tests/unit/mediaOrganizerFtsRebuild.test.ts L408–L449](tests/unit/mediaOrganizerFtsRebuild.test.ts) measures rebuild × concurrent save | Different surface (media-organizer FTS, not canvas pages). Slice D is net-new for canvas. |
| Extension activation failure | [tests/unit/extensionActivationSync.test.ts](tests/unit/extensionActivationSync.test.ts) — M82 baseline, sync proxy only | Reuse the harness shape (warmup + N iters + ns/call). Extend to: real `ContributionRegistry` with a deliberately-failing processor, assert isolation preserved, measure overhead. **Slice E builds directly on this file's pattern.** |
| Persistence / workspace switch | [tests/e2e/24-workspace-chat-isolation.spec.ts L476–L479](tests/e2e/24-workspace-chat-isolation.spec.ts) uses `Date.now()` deltas around workspace switch | Slice F adapts this pattern. |
| File watcher latency (informational) | [tests/e2e/32-mo-watcher-latency.spec.ts L260–L290](tests/e2e/32-mo-watcher-latency.spec.ts) measures `T0 → T3` for fs.watch | Out of M84 baseline list, but the timestamp-pattern is the model for how harness modules collect timings. |

**Verdict:** four of six slices have a direct prior-art pattern to adapt. Two (cross-tool and canvas mixed-op) are net-new.

## 4. Existing Fixtures for Populated Workspaces

| Fixture | Provides | Reusable for |
|---|---|---|
| [tests/e2e/fixtures.ts createTestWorkspace](tests/e2e/fixtures.ts) | Temp workspace dir with sample files + Electron launch with `PARALLX_TEST_MODE=1` | **All e2e fitness slices** (A startup, B IPC, C cross-tool, D canvas mixed-op, F persistence) |
| [tests/ai-eval/fixtures.ts](tests/ai-eval/fixtures.ts) | AI-eval workspace + model preload | Not reused (ai-eval already has its own pipeline) |
| [tests/eval/harness/launcher.ts](tests/eval/harness/launcher.ts) L76 (cold-start comment) | Documents "empty model list on cold start" behaviour | Reference only |

**Decision:** the harness reuses `createTestWorkspace` + `electron.launch(...)` verbatim. The harness directory `tests/fitness/_shared/launcher.ts` is a thin wrapper that re-exports the e2e fixture's launch helper plus a `performance.now()` capture wrapper.

For Slice D (canvas mixed-op), the fixture must include a pre-populated canvas page with N blocks (10 / 100 / 1000). This is a new fixture: `tests/fitness/_fixtures/canvas-N-blocks.json`. Generated once and committed.

For Slice F (persistence recovery), the fixture is a workspace with 5 editors saved in layout + 3 chat sessions + 2 canvas pages, exercising the M81 restore path. Generated once and committed.

## 5. Is the M82 H15 Extension-Activation Test Reusable for Slice E?

**Question:** Is [tests/unit/extensionActivationSync.test.ts](tests/unit/extensionActivationSync.test.ts) directly reusable as the extension-activation-failure baseline, or does it need a parallel deliberately-failing-manifest variant?

**Answer: needs a parallel variant.**

The M82 test measures the **happy-path** synchronous cost (`makeNoopProcessor()`). Slice E's purpose is different: assert that **per-processor try/catch isolation in `ContributionRegistry` survives** under deliberately throwing processors, and quantify the overhead cost of the error path.

Concrete design for Slice E:
1. Reuse the warmup + 200-iter pattern verbatim.
2. Define `makeThrowingProcessor(everyNth: number)` that throws on the Nth `processContributions` call.
3. Run two scenarios:
   - All processors healthy → baseline ns/call (should match M82's number within 5%).
   - One processor throws every call → measure ns/call again; assert other processors still receive their calls (isolation preserved).
4. Record both numbers in the fitness report.

The M82 file remains unchanged; Slice E adds a sibling file `tests/fitness/extension-activation-failure.fitness.ts`.

## 6. External Reference Patterns

### 6.1 VS Code (`vscode/test/`)

- `test/smoke/` runs the full app via a launcher that wraps `electron.launch()` and asserts UI selectors. Timing is collected via `performance.now()` snapshots between selector waits. **Adopt:** the selector-anchored timing pattern (start = launch, T1 = first part visible, T2 = first editor visible, T3 = workspace restored).
- `test/integration/browser/` runs in-process tests against the workbench. **Don't adopt:** Parallx's `tests/unit/` already covers this surface adequately.
- `test/automation/` exposes a typed driver. **Defer:** could be a future Slice; not in M84 scope.

### 6.2 Electron's perf APIs

- `performance.mark(name)` + `performance.measure(name, startMark, endMark)` is supported in both main and renderer. Output is the same Performance Timeline used by Chrome DevTools.
- `--enable-precise-memory-info` exposes per-process memory; **defer** — memory baseline is not in M84's six required baselines.
- Electron's `app.getMetrics()` returns per-process CPU and memory snapshots. **Adopt for Slice A** as the startup memory floor reference.

### 6.3 Obsidian-style fitness pipeline (comparable Electron workbench)

Obsidian's community has converged on a "boot timings" pattern: timestamped `console.log` lines emitted by the renderer, scraped by a Playwright harness. **Adopt:** the renderer emits `[fitness] mark=<name> t=<ms>` lines; the harness drains them after the run. This composes well with the existing `tests/e2e/32-mo-watcher-latency.spec.ts` console-scraping pattern.

### 6.4 Anti-patterns to avoid

- **Do not add a runtime telemetry service.** Out of scope for M84; would touch the renderer bundle.
- **Do not enable IPC slow-log in production.** Dev-mode-only is the existing contract; harness runs in dev mode by construction.
- **Do not regress to per-iteration `console.warn` for IPC counts.** Aggregate in-renderer, dump once at end.

## 7. JSON Report Schema (Baseline Methodology)

Required by [Parallx_Milestone_84.md §8](docs/Parallx_Milestone_84.md). Single schema across all six modules.

```jsonc
{
  "schemaVersion": 1,
  "milestone": "M84",
  "ranAt": "2026-05-23T18:34:21.000Z",
  "provenance": {
    "gitHead": "9bef4711",
    "nodeVersion": "v20.x",
    "electronVersion": "40.x",
    "hostOs": "win32 / 10.0.x"
  },
  "modules": [
    {
      "name": "startup",
      "status": "ok",
      "metrics": {
        "launchToFirstPaintMs": { "p50": 1234, "p95": 1450, "samples": 5 },
        "launchToWorkbenchReadyMs": { "p50": 2100, "p95": 2380, "samples": 5 },
        "launchToFirstEditorMs": { "p50": 2400, "p95": 2710, "samples": 5 }
      },
      "tolerances": { "launchToFirstPaintMs.p95": 1700, "launchToWorkbenchReadyMs.p95": 2700, "launchToFirstEditorMs.p95": 3100 },
      "notes": ["5 cold-start runs; first run discarded as warmup"]
    }
    // ipc, cross-tool, canvas-mixed, extension-activation-failure, persistence-recovery follow same shape
  ],
  "overallStatus": "ok"
}
```

**Tolerance policy.** Each metric carries a `tolerance` band. Default band is **+25%** over the recorded p95 for the first run; tightened per-slice during review if variance is low. Tolerance bands live in the JSON report so the diff script can flag regressions automatically.

**Sample count.** Five runs per module, first discarded. Lower than +5% (which M82 used) because cross-tool timings will have larger variance than synchronous in-process measurements.

**Stop-rule.** If any metric exceeds three consecutive runs of >50% variance, the slice cannot record a baseline and must be escalated per [Parallx_Milestone_84.md §16](docs/Parallx_Milestone_84.md).

## 8. Directory Layout

```
tests/fitness/
├── _shared/
│   ├── launcher.ts          # wraps tests/e2e/fixtures.ts electron.launch
│   ├── ipcCounter.ts        # Playwright addInitScript IPC wrapper
│   ├── reportWriter.ts      # JSON schema writer + provenance capture
│   └── timer.ts             # performance.now() helpers + mark/measure shim
├── _fixtures/
│   ├── canvas-N-blocks.json
│   └── persistence-restore-workspace.json
├── startup.fitness.ts
├── ipc.fitness.ts
├── cross-tool.fitness.ts
├── canvas-mixed.fitness.ts
├── extension-activation-failure.fitness.ts
├── persistence-recovery.fitness.ts
└── run-all.fitness.ts       # composes all six; entry point for npm script

data/fitness-reports/
└── <ISO-timestamp>.json     # output; gitignored
```

**Runner.** `npm run test:system-fitness` invokes a small node script (`scripts/run-fitness.mjs`, also new) that:
1. Sets `PARALLX_FITNESS=1` env.
2. Invokes `npx playwright test --config=playwright.fitness.config.ts` (new config; sequential, single worker).
3. Collects the per-module JSON files written under a tmp dir.
4. Composes them into one report under `data/fitness-reports/`.
5. Exits non-zero if any module's `status` is not `ok`.

## 9. Anti-List Compliance for Implementation

Verified by re-reading [Parallx_Milestone_84.md §4](docs/Parallx_Milestone_84.md):

| Anti-list file | Touched? | Why |
|---|---|---|
| `electron/main.cjs` | **No** | `timedDbHandler` observed via existing `console.warn` output; harness scrapes it. |
| `electron/preload.cjs` | **No** | Renderer-side wrap via Playwright `addInitScript`. |
| `electron/database.cjs` | **No** | Not relevant. |
| `src/openclaw/*` | **No** | Not relevant. |
| `src/built-in/canvas/canvasDataService.ts` | **No** | Canvas mixed-op fixture loads pages via the public surface only. |
| `src/built-in/canvas/canvasPersistence.ts` | **No** | Same. |
| `src/built-in/canvas/config/blockRegistry.ts` | **No** | Same. |
| `src/services/chatAgentService.ts` | **No** | Slice C observes chat through the existing extension-API surface. |
| `src/contributions/*` | **No** | Slice E uses the public `ContributionRegistry` constructor only. |

All harness code lives under `tests/fitness/` + `scripts/run-fitness.mjs` + `playwright.fitness.config.ts` + one `package.json` script entry. The Manifest §17 closeout-template amendment in Slice F lands in `docs/PARALLX_MANIFEST.md` and is a separate governance change, not an anti-list file.

## 10. Slice A Recommended Scope

The Surgical Executor should implement Slice A as follows:

1. Create `tests/fitness/_shared/timer.ts`, `reportWriter.ts`, `launcher.ts`.
2. Create `tests/fitness/startup.fitness.ts` exercising launch → first-paint → workbench-ready → first-editor.
3. Create `playwright.fitness.config.ts` (single worker, sequential, longer timeout, dedicated reporter that writes the per-module JSON to a tmp dir).
4. Create `scripts/run-fitness.mjs` (composer + exit-code propagator).
5. Add `"test:system-fitness": "node scripts/run-fitness.mjs"` to `package.json`.
6. Add `data/fitness-reports/` to `.gitignore` (verify present; if not, add).
7. Record the first startup numbers in `docs/research/baselines/workbench-baseline.md` §2 (append new rows).
8. Commit with the Slice A commit prefix from M84 §10.

**Slice A is closed when:** `npm run test:system-fitness -- --only startup` produces a valid JSON report; rerun stays within the recorded p95+25% tolerance band; full `npm run test:unit` remains green; no anti-list file modified.

## 11. Risks Surfaced by the Audit

| Risk | Mitigation |
|---|---|
| Playwright `electron.launch()` has its own warm-up cost (Chromium startup, CDP attach). First-run timings will be slower than steady-state. | Discard first run; report 4 samples. Document in §1.1 of `FITNESS_HARNESS.md`. |
| Windows fs.watch jitter ([memory: docs/research/baselines/workbench-baseline.md H16 notes](docs/research/baselines/workbench-baseline.md)) may dominate Slice F (persistence). | Slice F focuses on workspace-switch timing, not file-watch latency. fs.watch latency is *informational only* per workbench-baseline §3. |
| `console.warn` scraping for IPC slow-log is fragile (format drift). | Renderer-side IPC wrap (Slice B) does not depend on `console.warn`. The `timedDbHandler` `[IPC slow]` log is a redundant cross-check, not the primary source. |
| Canvas-mixed-op fixture (1000 blocks) may exceed reasonable test runtime. | Cap at 250 blocks for fitness; document that 1000-block stress test belongs in `tests/e2e/`. |
| Manifest §17 template amendment in Slice F may invalidate retroactive checks of M81–M83 closeout evidence. | The amendment applies prospectively (SR-4+); M81–M83 closeout language is grandfathered. State this explicitly in the Slice F commit body. |

## 12. Verdict

**Audit complete. Research gate may close.** All five §6 questions answered with file:line anchors. External research in §6 above answers §7. Baseline methodology in §7 above answers §8.

Slice A is unblocked. The harness can be built entirely outside the anti-list. The only governance change required is the Manifest §17 template amendment in Slice F, which is appropriately atomic with the policy it codifies.

## 13. Recommendations to the Conductor

1. **Open Slice A** immediately. Audit findings are unambiguous.
2. **Approve the JSON schema in §7** as the canonical fitness-report contract for SR-4+.
3. **Approve the directory layout in §8.**
4. **Approve +25% default tolerance band** (looser than M82's +5% because cross-tool variance is wider).
5. **Confirm Slice E plan in §5** matches the Conductor's expectation for "extension activation failure baseline" — i.e., that "failure" means "deliberately throwing processor under the M81 ContributionRegistry try/catch isolation", not "missing extension file".
