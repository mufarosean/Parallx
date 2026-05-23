---
Status: Draft
Author: Baseline and Metrics Agent (subagent invocation)
Branch: systems-redesign-planning
Commit: acd1ead
Created: 2026-05-23
Atlas: docs/architecture/SYSTEM_ATLAS.md
Research: docs/research/WORKBENCH_CURRENT_CODE_RESEARCH_BRIEF.md
---

# Workbench Baseline Scorecard

## 1. Primary Workflow Decomposition

The target workflow (from PARALLX_MANIFEST §5) is:

**User opens workspace → browses Explorer → opens editors → asks AI chat → AI references workspace → creates Canvas pages/artifacts → reopens workspace.**

Decomposed into measurable hops:

| Hop | Surface(s) | Code Anchor | Metric | Current Source |
|-----|-----------|-----------|--------|-----------------|
| **H1: Workspace Open (Cold)** | Workbench, Workspace | [src/workbench/workbench.ts](src/workbench/workbench.ts#L400-L750) | Time from app launch to interactive shell (ms) | None; missing instrumentation |
| **H2: Workspace Open (Warm)** | Workbench, Workspace | [src/workspace/workspaceLoader.ts](src/workspace/workspaceLoader.ts#L23-L60) | Time from `Workspace` instance to `onDidInitialize` event (ms) | None; missing instrumentation |
| **H3: Explorer Render** | Explorer, Tree | [src/built-in/explorer/main.ts](src/built-in/explorer/main.ts#L500-L600) | Time from tree data available to first file visible (ms) | None; missing instrumentation |
| **H4: File Selection → Editor Open** | Explorer, Editor | [src/services/editorService.ts](src/services/editorService.ts#L50-L120) | Time from selection to editor pane visible (ms) | None; missing instrumentation |
| **H5: Editor Open per Filetype** | Editor, PDF/Canvas | [src/editor/editorInputDeserializer.ts](src/editor/editorInputDeserializer.ts#L1-L50); [src/built-in/editor/pdfEditorPane.ts](src/built-in/editor/pdfEditorPane.ts#L162-L250) | Time from EditorService.openEditor() to content rendered (ms) | None; missing instrumentation |
| **H6: Explorer → Chat Attachment** | Explorer, Chat | [src/built-in/chat/input/chatContextAttachments.ts](src/built-in/chat/input/chatContextAttachments.ts#L25-L80) | Time from selection to chat context resolved (ms) | None; missing instrumentation |
| **H7: Chat Turn Response** | Chat, OpenClaw | [src/openclaw/openclawAttempt.ts](src/openclaw/openclawAttempt.ts#L18-L100) | Time from user input to first token (TTFT) and turn latency (ms) | [tests/ai-eval/ollamaRecorder.ts](tests/ai-eval/ollamaRecorder.ts#L16-L125); latency measured per turn |
| **H8: Canvas Page Open** | Canvas | [src/built-in/canvas/canvasEditorProvider.ts](src/built-in/canvas/canvasEditorProvider.ts#L102-L200); [src/built-in/canvas/canvasDataService.ts](src/built-in/canvas/canvasDataService.ts#L82-L150) | Time from page ID to rendered blocks (ms) | None; missing instrumentation |
| **H9: Canvas Page Save** | Canvas | [src/built-in/canvas/canvasDataService.ts](src/built-in/canvas/canvasDataService.ts#L200-L350) | Time from local edit to DB commit (ms) | None; missing instrumentation |
| **H10: Workspace Restore on Reopen** | Workbench, Editor, Persistence | [src/workbench/workbench.ts](src/workbench/workbench.ts#L500-L650) + [src/workspace/workspaceLoader.ts](src/workspace/workspaceLoader.ts#L23-L60) | Time from restart to editors/layout restored (ms) | None; missing instrumentation |
| **H11: IPC Bridge Round-Trip (DB ops)** | IPC, Database | [electron/main.cjs](electron/main.cjs#L1904-L1963) | Latency distribution for database:run, database:get, database:all, database:runTransaction (ms) | [electron/main.cjs](electron/main.cjs#L1847-L1880) — `timedDbHandler` (dev mode only; IPC_SLOW_LOG_MS = 50) |
| **H12: Persistence Migration** | Database, Migration | [electron/database.cjs](electron/database.cjs#L200+) | Time to run all pending migrations on upgrade (ms) | None; missing instrumentation |
| **H13: FTS Index Rebuild (cold index)** | Database, Media-Organizer ext | [ext/media-organizer/main.js](ext/media-organizer/main.js) + [src/services/indexingPipeline.ts](src/services/indexingPipeline.ts) | Time to rebuild FTS on activation; concurrent save latency during rebuild (ms) | [tests/unit/mediaOrganizerFtsRebuild.test.ts](tests/unit/mediaOrganizerFtsRebuild.test.ts#L1-L450) — measures both rebuild duration and max concurrent save latency |
| **H14: Indexing Pipeline (initial)** | Indexing, Embedding | [src/services/indexingPipeline.ts](src/services/indexingPipeline.ts#L1-L100) | Time from workspace open to `onDidCompleteInitialIndex` event (ms); IPC call count for embeddings | [tests/unit/indexingPipeline.perf.test.ts](tests/unit/indexingPipeline.perf.test.ts#L1-L50) — verifies yielding behavior |
| **H15: Extension Activation** | Tools | [src/tools/toolActivator.ts](src/tools/toolActivator.ts#L100-L200) | Time to activate all built-in tools; count of IPC calls; timeout behavior | None; missing instrumentation |
| **H16: File Watcher Pickup** | FileService, Explorer | [src/services/fileService.ts](src/services/fileService.ts#L468+) | Latency from disk write to tree refresh; fs.watch event volume (events/sec) | [tests/e2e/32-mo-watcher-latency.spec.ts](tests/e2e/32-mo-watcher-latency.spec.ts#L1-L100) — diagnostic; measures T0→T1→T2→T3 pickup timing |

---

## 2. Current Baseline Numbers (where available)

Searched repo for existing tests, instrumentation, and measurement sources.

| Hop | Metric | Current Number | Source | Confidence | Notes |
|-----|--------|-----------------|--------|------------|--------|
| H11 | IPC slow-log threshold | 50 ms | [electron/main.cjs:L1856](electron/main.cjs#L1856) | High | timedDbHandler wraps DB handlers; fires when `elapsed >= 50ms` in dev mode (disabled in prod) |
| H11 | IPC latency model (mock) | 0.5 ms per round-trip | [tests/unit/mediaOrganizerFtsRebuild.test.ts:L61](tests/unit/mediaOrganizerFtsRebuild.test.ts#L61) | High | IPC_LATENCY_MS constant models renderer↔main overhead in characterization test |
| H13 | FTS rebuild (OLD per-row, 2500 rows) | ≥ 5000 ms | [tests/unit/mediaOrganizerFtsRebuild.test.ts:L408](tests/unit/mediaOrganizerFtsRebuild.test.ts#L408) | High | Per-row await pattern (commit d4feeca behavior) — measured on 2000 photos + 500 videos |
| H13 | FTS rebuild (NEW transactional, 2500 rows) | < 2000 ms | [tests/unit/mediaOrganizerFtsRebuild.test.ts:L420](tests/unit/mediaOrganizerFtsRebuild.test.ts#L420) | High | Single transaction; M64 fix commit pending |
| H13 | FTS rebuild (CHUNKED 500-row batches, 10K photos) | Variable | [tests/unit/mediaOrganizerFtsRebuild.test.ts:L440-L449](tests/unit/mediaOrganizerFtsRebuild.test.ts#L440-L449) | High | Shipped current state; max concurrent save latency stays ≪ rebuild duration |
| H13 | Max concurrent save latency (during chunked rebuild, 10K library) | Not quantified in test | [tests/unit/mediaOrganizerFtsRebuild.test.ts:L425](tests/unit/mediaOrganizerFtsRebuild.test.ts#L425) | Medium | Test asserts property ("saves can interleave") but does not assert max ms |
| H14 | Initial indexing yield interval | 0 ms (yields between iterations) | [src/services/indexingPipeline.ts:L406, L545](src/services/indexingPipeline.ts#L406) | High | Uses `await setTimeout(_, 0)` and `requestIdleCallback` (B3 embedding worker flag) |
| H14 | First analysis (proactive suggestions) defer | requestIdleCallback + 3s fallback | [src/services/proactiveSuggestionsService.ts:L144-L174](src/services/proactiveSuggestionsService.ts#L144-L174) | High | M78 Phase 7: first run deferred behind idle gate; subsequent runs use 5-min cooldown |
| H15 | File watcher coalesce window | 50 ms | [src/services/fileService.ts:L468](src/services/fileService.ts#L468) | High | _COALESCE_WINDOW_MS = 50; M78 Phase 6; slides when new events arrive for same path |
| Database PRAGMA: journal_mode | WAL | [electron/database.cjs:L61](electron/database.cjs#L61) | High | M78 Phase 2; writers don't block readers; fsync only on checkpoint |
| Database PRAGMA: synchronous | NORMAL | [electron/database.cjs:L62](electron/database.cjs#L62) | High | M78 Phase 2; safe with WAL; cuts fsync count; accepts tiny durability window |
| Database PRAGMA: wal_autocheckpoint | 1000 | [electron/database.cjs:L63](electron/database.cjs#L63) | High | M78 Phase 2; keeps WAL bounded on long sessions |
| Database PRAGMA: temp_store | MEMORY | [electron/database.cjs:L64](electron/database.cjs#L64) | High | M78 Phase 2; keeps sort/group/CTE data in RAM |
| H7 | Chat turn latency (ai-eval, median) | Measured per run | [tests/ai-eval/aggregate.mjs:L135-L144](tests/ai-eval/aggregate.mjs#L135-L144) | Medium | Latency extracted from turn records; reported as median in ai-eval aggregator |
| H1 | Launch → first window (p50/p95) | 967.5 / 1127.4 ms | [tests/fitness/startup.fitness.ts](tests/fitness/startup.fitness.ts) (M84 Slice A; commit 6499cfbf) | High | 4 cold launches (5 runs, first discarded). Tolerance band p95 × 1.25 = 1409.3 ms. Reported in `data/fitness-reports/<ISO>.json` |
| H1 | Launch → workbench-ready (titlebar selector visible) (p50/p95) | 1829.1 / 2459.4 ms | [tests/fitness/startup.fitness.ts](tests/fitness/startup.fitness.ts) (M84 Slice A) | High | Anchored on `[data-part-id="workbench.parts.titlebar"]`. Tolerance p95 × 1.25 = 3074.3 ms |
| H1 | Launch → first editor pane visible (p50/p95) | 1887.2 / 2512.9 ms | [tests/fitness/startup.fitness.ts](tests/fitness/startup.fitness.ts) (M84 Slice A) | High | Anchored on `[data-part-id="workbench.parts.editor"]`. Tolerance p95 × 1.25 = 3141.1 ms. Workspace = empty `parallx-fitness-*` temp dir |
| H11 | IPC total calls per cold-start workflow (p50/p95) | 278 / 278 | [tests/fitness/ipc.fitness.ts](tests/fitness/ipc.fitness.ts) (M84 Slice B) | High | 4 cold launches (5 runs, first discarded). Counter attaches via `electronApp.evaluate()` after launch; boot IPC excluded by design. Settle = 3s post workbench-ready. Tolerance p95 × 1.25 = 347.5 |
| H11 | IPC cumulative duration per cold-start workflow (p50/p95) | 667 / 689 ms | [tests/fitness/ipc.fitness.ts](tests/fitness/ipc.fitness.ts) (M84 Slice B) | High | Sum of all handler durations across all channels. Tolerance p95 × 1.25 = 861.3 ms |
| H11 | Distinct IPC channels per cold-start workflow (p50/p95) | 29 / 29 | [tests/fitness/ipc.fitness.ts](tests/fitness/ipc.fitness.ts) (M84 Slice B) | High | Top consumers by total time: fs:readdir (54×, 259ms total), docling:start (1×, 169ms), database:all (55×, 49ms), fs:readFile (18×, 41ms), tools:scan-directory (3×, 29ms). Tolerance p95 × 1.25 = 36.3 |

---

## 3. Missing-Measurement Inventory

Metrics in §1 with no current baseline, instrumentation, or test source:

| Hop(s) | What to Measure | Where to Add | How to Collect | Suitable For |
|--------|-----------------|--------------|-----------------|----------------|
| H1, H2 | **Workspace cold-start time** (app launch to interactive) | [src/workbench/workbench.ts](src/workbench/workbench.ts#L200-L750) `initialize()` | Add `performance.mark/measure` around each phase (Services, Layout, Parts, WorkspaceRestore, Ready); report via `observabilityService` event | CI assertion (< 5s for baseline workspace); regression tracking |
| H1, H2 | **Warm workspace open time** | [src/workspace/workspaceLoader.ts](src/workspace/workspaceLoader.ts#L23-L60) | Measure `load()` → callback; emit event with duration | Regression tracking only (highly dependent on workspace state) |
| H3 | **Explorer tree population latency** | [src/built-in/explorer/main.ts](src/built-in/explorer/main.ts#L500-L600) | Measure tree view data → first render | One-time diagnostic (part of H1 warm path) |
| H4 | **File selection → editor open latency** | [src/services/editorService.ts](src/services/editorService.ts#L50-L120) + [src/services/selectionActionDispatcher.ts](src/services/selectionActionDispatcher.ts#L16-L60) | Measure selection dispatch → editor group attachment | One-time baseline; likely <50ms for text, <200ms for PDF |
| H5 | **Editor open latency per filetype** (text, PDF, EPUB, Canvas, diagram, etc.) | [src/editor/editorInputDeserializer.ts](src/editor/editorInputDeserializer.ts#L1-L50) | Measure input creation → pane visible | CI characterization test per type |
| H6 | **Chat attachment context resolution time** | [src/built-in/chat/input/chatContextAttachments.ts](src/built-in/chat/input/chatContextAttachments.ts#L25-L80) | Measure selection → attachment array returned | Likely <5ms; one-time if fast |
| H8, H9 | **Canvas page load time** (from page ID to blocks rendered) | [src/built-in/canvas/canvasDataService.ts](src/built-in/canvas/canvasDataService.ts#L82-L150) | Measure data load → block tree constructed | One-time baseline per page size (10 blocks, 100 blocks, 1000 blocks) |
| H8, H9 | **Canvas page save round-trip time** | [src/built-in/canvas/canvasDataService.ts](src/built-in/canvas/canvasDataService.ts#L200-L350) | Measure local edit → DB commit returned | CI characterization test; assert <100ms for typical edits |
| H9 | **Canvas block mutation latency** (add/delete/move a block) | [src/built-in/canvas/config/blockRegistry.ts](src/built-in/canvas/config/blockRegistry.ts#L1-L80) | Measure mutation → renderer re-render | E2E test per operation type |
| H10 | **Workspace restore time** (editors, layout, state) | [src/workspace/workspaceLoader.ts](src/workspace/workspaceLoader.ts#L23-L60) → [src/workbench/workbench.ts](src/workbench/workbench.ts#L500-L650) | Measure deserialization + restoration → all editors visible | Regression tracking; dependency on editor count and chat session size |
| H10 | **Chat session restore time** (recover N sessions with M messages each) | [src/services/chatService.ts](src/services/chatService.ts) (if exists; search for `restoreSessions`) | Measure sessions load → all messages rendered | One-time; likely O(N*M) DB calls pre-fix (see Future_Improvements.md §162) |
| H10 | **Editor restoration parallelism** | [src/workbench/workbench.ts](src/workbench/workbench.ts#L640+) | Profile sequential vs. concurrent `openEditor()` calls; measure total time | One-time baseline; likely sequential today (regression risk if made concurrent without IPC tuning) |
| H11 | **IPC latency distribution** (p50, p95, p99) for database operations | [electron/main.cjs](electron/main.cjs#L1904-L1963) `timedDbHandler` | Enable dev-mode logging by default in CI; collect logs from test runs; compute percentiles | CI trend tracking; catch regressions early |
| H12 | **Migration execution time** per migration | [electron/database.cjs](electron/database.cjs#L200+) | Emit timing event per migration step | One-time baseline on fresh DB; important for upgrade flow |
| H13 | **FTS rebuild max concurrent save latency** (quantified) | [tests/unit/mediaOrganizerFtsRebuild.test.ts](tests/unit/mediaOrganizerFtsRebuild.test.ts#L425) | Add assertion for `maxSaveMs < rebuildMs * 0.5` or similar; baseline chunking | CI regression check |
| H14 | **Indexing pipeline p99 frame drop time** during initial index | [src/services/indexingPipeline.ts](src/services/indexingPipeline.ts) + E2E | E2E: measure renderer requestAnimationFrame callback delay during indexing | One-time; detect if yielding is effective |
| H14 | **Embedding call batch size and IPC count** during initial index | [src/services/indexingPipeline.ts](src/services/indexingPipeline.ts#L406, L545) | Log batch sizes and IPC call count for `/api/embed` calls | One-time; verify batching is working (B3 fix) |
| H15 | **Per-tool activation time** (Explorer, Chat, Canvas, etc.) | [src/tools/toolActivator.ts](src/tools/toolActivator.ts#L100-L200) | Measure `toolActivator.activate()` per tool; report duration | CI characterization; catch slow extension activations |
| H15 | **Total built-in tool activation time** (all 12 tools in parallel) | [src/workbench/workbench.ts](src/workbench/workbench.ts#L650+) `fireStartupFinished` | Measure `Promise.allSettled()` resolution time | CI baseline; regression check |
| H15 | **Extension activation timeout behavior** | [src/tools/toolActivator.ts](src/tools/toolActivator.ts) | Test activation timeout; verify workbench continues after timeout | CI characterization; preserve failure isolation |
| H16 | **fs.watch → explorer tree update latency** (drag-drop scenario) | [tests/e2e/32-mo-watcher-latency.spec.ts](tests/e2e/32-mo-watcher-latency.spec.ts#L1-L100) | Measure T0 (write) → T3 (grid updated) for single-file write | E2E diagnostic; target <500ms for perception |
| H16 | **fs.watch → explorer tree update latency** (browser Save As scenario) | [tests/e2e/32-mo-watcher-latency.spec.ts](tests/e2e/32-mo-watcher-latency.spec.ts#L1-L100) | Measure T0 (rename) → T3 (grid updated) for temp-file rename pattern | E2E diagnostic; informational (may be blocked by Windows fs.watch bug) |

---

## 4. Proposed Characterization Tests

Tests that would lock in current behavior so redesign slices cannot regress silently.

### Workspace and Restore

| Test Name | Location | Asserts | Behavior Locked In | Status |
|-----------|----------|---------|-------------------|--------|
| **Workspace open (cold, baseline)** | `tests/unit/workspaceOpenCold.test.ts` | Time to `onDidInitialize` < 3s on fresh workspace | Startup interactivity floor | **Proposed — not yet implemented** |
| **Workspace open (warm, 10 editors, 5 chat sessions)** | `tests/unit/workspaceOpenWarm.test.ts` | Time to editors visible + chat restored < 4s | Restore determinism & speed | **Proposed — not yet implemented** |
| **Workspace switch & teardown** | `tests/unit/workspaceSwitchFreeze.test.ts` (exists; check status) | No renderer freeze > 100ms during switch | Preservation: switch smoothness | **Exists** [tests/unit/workspaceSwitchFreeze.test.ts](tests/unit/workspaceSwitchFreeze.test.ts) — verify it runs |
| **Workspace restore recovery (interrupted save)** | `tests/unit/workspaceRecovery.test.ts` | Restart after crash returns to consistent state | Preservation: not losing edits | **Proposed — not yet implemented** |

### Editor Open

| Test Name | Location | Asserts | Behavior Locked In | Status |
|-----------|----------|---------|-------------------|--------|
| **Editor open: text file** | `tests/unit/editorOpenText.test.ts` | Time < 100ms; no IPC hangs | Text edit latency floor | **Proposed — not yet implemented** |
| **Editor open: PDF (5 MB file)** | `tests/unit/editorOpenPdf.test.ts` | Time < 500ms; extraction doesn't block UI | PDF rendering not to starve renderer | **Proposed — not yet implemented** |
| **Editor open: Canvas (100-block page)** | `tests/unit/editorOpenCanvas.test.ts` | Time < 300ms; all blocks rendered | Canvas block tree rendering speed | **Proposed — not yet implemented** |
| **Multiple editors open concurrently** | `tests/e2e/editorsConcurrent.spec.ts` | Open 5 tabs in parallel; all visible < 1s | Parallelism working | **Proposed — not yet implemented** |

### Explorer and Selection

| Test Name | Location | Asserts | Behavior Locked In | Status |
|-----------|----------|---------|-------------------|--------|
| **Explorer tree rendering (1000 files)** | `tests/unit/explorerTreeRender.test.ts` | Tree visible < 200ms | Explorer responsiveness | **Proposed — not yet implemented** |
| **File selection → chat attachment** | `tests/unit/selectionToChatAttach.test.ts` | Attachment resolved < 10ms | Selection dispatch speed | **Proposed — not yet implemented** |
| **Explorer file change (watcher coalesce)** | `tests/unit/fileWatcherCoalesce.test.ts` | 50 changes coalesced into 1 event | Preservation: watcher coalescence behavior | **Proposed — not yet implemented** |

### Chat → Canvas → Cross-Tool

| Test Name | Location | Asserts | Behavior Locked In | Status |
|-----------|----------|---------|-------------------|--------|
| **Chat turn latency** (ai-eval, logged) | [tests/ai-eval/ollamaRecorder.ts](tests/ai-eval/ollamaRecorder.ts) | Median turn < 5s; p95 < 15s | Baseline for AI performance regression | **Exists** — ai-eval harness |
| **Canvas artifact creation from chat** | `tests/e2e/chatToCanvasArtifact.spec.ts` | Artifact created + visible < 1s | Cross-tool workflow speed | **Proposed — not yet implemented** |
| **Canvas page + chat session persist & restore** | `tests/e2e/canvasChatPersist.spec.ts` | Restart: page + session both available; graph intact | Preservation: artifact provenance | **Proposed — not yet implemented** |

### IPC and Database

| Test Name | Location | Asserts | Behavior Locked In | Status |
|-----------|----------|---------|-------------------|--------|
| **Database query latency under load** | `tests/unit/dbQueryLatencyUnderLoad.test.ts` | 1000 concurrent reads; p99 < 50ms | DB responsiveness under contention | **Proposed — not yet implemented** |
| **FTS rebuild concurrent write safety** | [tests/unit/mediaOrganizerFtsRebuild.test.ts](tests/unit/mediaOrganizerFtsRebuild.test.ts) (exists) | Chunked rebuild; max concurrent save < rebuild duration | Preservation: concurrent write interleaving | **Exists** — verify `CHUNKED rebuild` test passes |
| **IPC slow-log detection** (dev mode) | `tests/unit/ipcSlowLog.test.ts` | Slow IPC call fires warning in dev console | Instrumentation: catch regressions in dev | **Proposed — not yet implemented** |
| **Migration rollback** | `tests/unit/migrationRollback.test.ts` | Apply + rollback migration; DB state unchanged | Preservation: rollback path for migrations | **Proposed — not yet implemented** |

### Extension Activation and Lifecycle

| Test Name | Location | Asserts | Behavior Locked In | Status |
|-----------|----------|---------|-------------------|--------|
| **Extension activation isolation** | `tests/unit/extensionActivationIsolation.test.ts` | Slow ext timeout; workbench continues | Preservation: extension failure doesn't crash app | **Proposed — not yet implemented** |
| **Tool activation race (parallel built-ins)** | `tests/unit/toolActivationRace.test.ts` | All 12 tools activate in parallel; no deadlock | Preservation: activation ordering | **Proposed — not yet implemented** |
| **Extension API bridge contract** | `tests/unit/extensionApiBridgeContract.test.ts` | Verify all API methods have type signatures and error handling | Preservation: extension API stability | **Proposed — not yet implemented** |

### Persistence and Migration

| Test Name | Location | Asserts | Behavior Locked In | Status |
|-----------|----------|---------|-------------------|--------|
| **Workspace state serialization round-trip** | `tests/unit/workspaceStateSerialization.test.ts` | Save + load state; no information loss | Preservation: workspace state fidelity | **Proposed — not yet implemented** |
| **Canvas page graph integrity** | `tests/unit/canvasPageGraphIntegrity.test.ts` | Create complex link structure; restart; graph unchanged | Preservation: block graph invariants | **Proposed — not yet implemented** |
| **Chat session message ordering** | `tests/unit/chatSessionOrdering.test.ts` | Restore N sessions; message order preserved | Preservation: chat history | **Proposed — not yet implemented** |

---

## 5. Performance Hot Paths Already Identified

From repo memory and M78 implementation. **Redesign slices must not silently undo these optimizations.**

| Hot Path | File:Line | What It Protects Against | How | Current Status |
|----------|-----------|--------------------------|-----|-----------------|
| **timedDbHandler** (IPC instrumentation) | [electron/main.cjs:L1856](electron/main.cjs#L1856) | Slow IPC calls hide in production; dev-mode logging surfaces regressions | Wraps database handlers; logs calls > 50ms to console; disabled in packaged build | M78 Phase 1; development aid only |
| **Database WAL + synchronous=NORMAL** | [electron/database.cjs:L50-L67](electron/database.cjs#L50-L67) | SQLite fsync() per commit freezes on slow disks (USB, network); writers block readers | WAL mode: checkpoint async; readers never blocked; synchronous=NORMAL trades tiny durability window for throughput | M78 Phase 2; verified by pragma comments |
| **File watcher coalescing** (50 ms window) | [src/services/fileService.ts:L468+](src/services/fileService.ts#L468) | Build tools write 50+ files → 50 IPC events → watcher pipeline fans out to every consumer → tree refresh/indexing/semantic graph all fire 50× → long task on renderer | Buffer events; deduplicate by path+type; emit one event per window | M78 Phase 6; sliding window on new events for same path |
| **Embedding worker flag** (off-thread transport) | [src/services/indexingPipeline.ts:L406, L545](src/services/indexingPipeline.ts#L406) | `/api/embed` on renderer thread blocks during startup indexing; startup "freezes" | M60 B3 fix: route embeddings to worker when flag `indexing.worker.enabled` is true (default OFF for bake time); still yields between iterations | M60 Phase θ B3; gated by feature flag |
| **Autonomy event log buffering** | [src/services/autonomyEventLog.ts](src/services/autonomyEventLog.ts) (search for buffering/batch) | Each autonomy action fires IPC to persist log entry → serial overhead on agentic workflows | Buffer events; flush periodically or on threshold | Not yet found in repo; likely M78 Phase or later |
| **Indexing pipeline yielding** (requestIdleCallback + setTimeout) | [src/services/indexingPipeline.ts:L622-L650](src/services/indexingPipeline.ts#L622-L650) | Initial page indexing holds renderer event loop; user cannot click anything until index completes | Yield between batch iterations using `requestIdleCallback` with fallback timeout | M60 Phase β (B1 + B2) |
| **Proactive suggestions idle-defer** | [src/services/proactiveSuggestionsService.ts:L144-L174](src/services/proactiveSuggestionsService.ts#L144-L174) | First analysis (clustering 50+ pages) runs immediately after indexing; user sees "frozen" state; subsequent analyses use 5-min cooldown | M78 Phase 7: defer first run behind `requestIdleCallback` (3s timeout fallback); preserves 5-min cooldown for subsequent runs | M78 Phase 7; production |
| **Canvas page save payload optimization** | [src/built-in/canvas/canvasTypes.ts](src/built-in/canvas/canvasTypes.ts) (search for PageSaveEvent) | Full page serialization on every edit → large IPC payloads → slow persistence | Payload: incremental delta (not full page) or similar optimization | Not yet found; likely M78 Phase or future |

**Preservation Rule:** If a redesign slice touches any of these paths, it must retain the optimization intent. Benchmark before/after and include numbers in PR description.

---

## 6. AI-Eval Considerations

`npm run test:ai-eval` is expensive (calls Ollama/local LLM; slow e2e tests) and gated to specific milestones.

| Scenario | When Required | When Not Required | Notes |
|----------|---------------|------------------|-------|
| **Chat turn latency regression** | Slice changes OpenClaw, chat UI rendering, or IPC bridge | Slice only touches documentation or non-chat systems | Baseline is median + p95 from prior run |
| **Cross-tool workflow (chat → canvas → save)** | Slice changes chat context attachment or canvas artifact creation | Slice only touches Explorer or preferences | E2E; verifies end-to-end provenance |
| **Agent autonomy performance** | Slice changes autonomy event logging, task queueing, or background execution | Slice only touches extension contribution registry | Expensive; run only if autonomy path touched |
| **Extension-assisted workflows** | Slice adds or removes extension APIs | Slice only refactors internal services | Verifies external extensions still work |

**Gate:** Include `[ai-eval: skip]` in PR title if the slice does not touch chat/autonomy/extension APIs. Include `[ai-eval: required]` otherwise.

---

## 7. Verification Commands

From `package.json` scripts. What each verifies and does NOT verify:

| Command | What It Verifies | What It Does NOT Verify | Typical Runtime |
|---------|------------------|------------------------|--------------------|
| `npm run build` | TypeScript compilation; no type errors; bundler output size | Runtime behavior; test pass rate; performance | ~30–60s |
| `npm run test:unit` | Unit test assertions via Vitest; mocked services; single-file logic | E2E workflows; IPC; real Electron window; performance under load | ~60–120s |
| `npm run test:e2e` | Cross-feature workflows in real Electron; file I/O; watcher events; multiple editors; chat + canvas; persistence | LLM chat quality (uses mock); large library performance (fixture-dependent) | ~10–30 min |
| `npm run test:ai-eval` | Chat quality + turn latency against local LLM (Ollama); multi-turn conversations; tool invocation | Anything not related to OpenClaw or cross-tool workflows; extension ecosystem | ~30–60 min per eval run |
| `npm run dev` | App launches; no crashes on startup; basic UI interactivity; workspace open | Comprehensive feature testing; performance profiling; edge case error handling | ~5s to interactive shell |

**Stop Rule:** If `npm run build` fails (type errors), stop and require fix before any review. If `npm run test:unit` fails, debug before merging. E2E failures on the branch require investigation; they may indicate real regressions or flaky tests.

---

## 8. Missing Measurement Catalog

Summary table of all metrics from §3 that need instrumentation. Redesign slices depend on these baselines.

| ID | Metric | Category | Owner | Target Implementation |
|----|--------|----------|-------|----------------------|
| **M1** | Workspace cold-start time (app launch to interactive) | Startup | Workbench | Add `observabilityService` events; report in console + telemetry |
| **M2** | Workspace warm open time | Startup | Workspace | Add timing to `workspaceLoader.load()` |
| **M3** | Explorer tree population latency | Startup | Explorer | Measure tree view render; part of H1 profile |
| **M4** | File selection → editor open latency | Interaction | Selection/Editor | Measure dispatch → pane visible |
| **M5** | Editor open latency per filetype | Interaction | Editor | Profile text, PDF, EPUB, Canvas per type |
| **M6** | Chat attachment context resolution | Interaction | Chat | Measure selection → attachment array |
| **M7** | Canvas page load time | Interaction | Canvas | Measure data load → blocks rendered |
| **M8** | Canvas page save round-trip | Interaction | Canvas | Measure edit → DB commit |
| **M9** | Canvas block mutation latency | Interaction | Canvas | Profile add/delete/move operations |
| **M10** | Workspace restore time (editors + layout + state) | Startup | Workspace | Measure deserialization + restoration |
| **M11** | Chat session restore (N sessions, M messages) | Startup | Chat | Profile DB queries; likely O(N*M) today |
| **M12** | Editor restoration parallelism analysis | Startup | Editor | Profile sequential vs. concurrent openEditor() |
| **M13** | IPC latency distribution (p50, p95, p99) | Infrastructure | IPC | Enable timedDbHandler in CI; collect stats |
| **M14** | Migration execution time | Startup | Database | Emit timing per migration step |
| **M15** | FTS rebuild max concurrent save latency | Background | Media-Organizer | Add assertion to characterization test |
| **M16** | Indexing pipeline p99 frame drop time | Startup | Indexing | E2E: measure RAF callback delay during index |
| **M17** | Embedding batch size + IPC count | Startup | Indexing | Log during initial index; verify batching (B3) |
| **M18** | Per-tool activation time | Startup | Tools | Measure toolActivator.activate() per tool |
| **M19** | Total built-in tool activation time | Startup | Tools | Measure `Promise.allSettled()` for all 12 tools |
| **M20** | Extension activation timeout behavior | Reliability | Tools | Test timeout; verify workbench continues |
| **M21** | fs.watch → explorer pickup latency (drag-drop) | Interaction | FileService | E2E; measure T0→T3 single-file scenario |
| **M22** | fs.watch → explorer pickup latency (Save As) | Interaction | FileService | E2E diagnostic; may be blocked by OS bug |

---

## 9. Stop-Rule Triggers

Conditions under which a redesign slice must NOT proceed:

### Stop: Missing Baseline

- A slice changes a hot-path file (from §5) without a baseline number for that path.
- A slice claims "better startup" without a cold-start time measurement on the same workspace size before/after.
- A slice removes an existing optimization (e.g., coalescing, WAL pragma, yielding) without a replacement that has been measured.

### Stop: Ambiguous Preservation

- A slice breaks an existing characterization test (from §4) without an explicit plan to update the test AND an explanation of why the behavior change is necessary.
- A slice claims "no regression" but has not run `npm run test:unit` and `npm run test:e2e` on the branch.
- A slice touches Canvas or chat but has not run `npm run test:ai-eval` or provided `[ai-eval: skip]` justification.

### Stop: Unverified Claim

- A slice is described as "cleaner" or "better organized" without pointing to a characterization test or metric from §1–§3.
- A slice claims "composability improvement" without documenting which one-off bridge it removes or which shared primitive it introduces.
- A slice changes IPC contracts without verifying that the change is backward-compatible or has a migration plan.

### Stop: Rollback Blocked

- A slice does not include a clear rollback path (commit ID to revert to, migration reversal, or feature flag).
- A slice involves a schema change or data migration without a tested rollback procedure.

---

## 10. Test Inventory Summary

| Test Type | Count | Where | Status | Next Step |
|-----------|-------|-------|--------|-----------|
| **Unit perf/timing** | 3 (indexingPipeline, mediaOrganizerFtsRebuild, others) | `tests/unit/*.perf.test.ts` | Partial; active | Complete inventory; verify all pass |
| **E2E diagnostic** | 1 (media-organizer watcher latency) | [tests/e2e/32-mo-watcher-latency.spec.ts](tests/e2e/32-mo-watcher-latency.spec.ts) | Diagnostic only | Add assertions for CI baseline |
| **AI-eval** | 1 (chat turn recorder + aggregate) | [tests/ai-eval/](tests/ai-eval/) | Integrated | Document baseline numbers per eval run |
| **Characterization (proposed)** | ~20 | `tests/unit/`, `tests/e2e/` | Not yet written | Create per §4 priority |

---

## 11. Dependencies and Risks

| Risk | Likelihood | Mitigation |
|------|-----------|-----------|
| **Instrumentation adds overhead** | Medium | Instrumentation is off by default in production; dev-mode only. Verify zero overhead in packaged build via code inspection. |
| **Baseline numbers vary with hardware** | High | Baseline runs must be on a fixed machine (CI) or a representative local dev setup. Document machine specs (CPU, RAM, disk type) with numbers. |
| **Characterization tests become flaky** | High | Add retry logic and generous timeouts (e.g., 2× expected time) for CI. Mark flaky tests explicitly. |
| **M11 (chat restore) is O(N*M)** | High | Pre-fix: expect slow restore on large chat histories. Post-fix should batch DB queries (see Manifest §16). Plan batching before characterizing. |
| **ai-eval is slow** | High | Gate ai-eval to slices that touch OpenClaw, chat, or autonomy. Use `[ai-eval: skip]` for other slices. |
| **Windows fs.watch unreliability (H16 Scenario B)** | High | 32-mo-watcher-latency.spec.ts is diagnostic; do not assert on Browser Save As scenario. Document known limitation. |

---

## Conclusion

This scorecard defines measurable baselines for the primary Parallx workflow and identifies missing instrumentation. Before any redesign slice proceeds, it must answer:

1. **What metric does it improve?** (From §1 Hop list or §2 existing numbers)
2. **What is the before number?** (From §2 or a new characterization test from §4)
3. **What is the after number?** (Measured after the slice is implemented)
4. **What behavior does it lock in?** (Which characterization test passes)
5. **What hot path does it preserve?** (From §5; verify optimization still works)

Redesign work that cannot answer these questions should be stopped and redirected to research or planning, not implementation.

---

## 5. M82 Extension-Activation Baseline (added 2026-05-23)

Per [Parallx_Milestone_82.md �8](../../Parallx_Milestone_82.md), M82 must record an H15 baseline before Slice A. The [M82 Contribution Audit �B1-B5](../M82_CONTRIBUTION_AUDIT.md) (and the parallel Baseline-Agent investigation) found:

- Per-tool activation time IS already instrumented at [toolActivator.ts:L160-L242](../../../src/tools/toolActivator.ts#L160) via `performance.now()` pairs and the `onDidActivate` event `{ toolId, success, durationMs }`.
- There is **no workbench-level aggregate** ('total time from first activate to chat-default participant ready').
- M81 Phase 5 characterization tests (workspaceOpenCold, editorOpenCanvas, etc.) **do not exist** � they are aspirational rows in �1 above. The only working performance characterization is [mediaOrganizerFtsRebuild.test.ts](../../../tests/unit/mediaOrganizerFtsRebuild.test.ts).

### Recommended approach (Option B from baseline investigation)

Create `tests/unit/extensionActivationSync.test.ts` measuring the **synchronous portion only** (`ContributionRegistry.processContributions()` iteration cost). Honest proxy; does NOT measure async `tool.activate()` execution.

| Metric | Pre-M82 baseline | Post-M82 budget | Source |
|---|---|---|---|
| H15-sync: `processContributions()` for 14 built-in tools | **83 ns/call** (200 iters x 14 tools = 0.23 ms total; measured 2026-05-23 on the pre-Slice-B commit) | baseline x 1.05 = 87 ns/call ceiling | `tests/unit/extensionActivationSync.test.ts` |
| H15-full (true wall-clock activation) | **Not measurable from vitest** | n/a | Requires Electron probe at [workbench.ts:L2899](../../../src/workbench/workbench.ts#L2899) |

### Caveats locked in

- The sync proxy is **not** the full H15. M82 closeout language must say 'no observable regression in synchronous contribution processing within 5%' � not 'no H15 regression'.
- Tests for the full H15 are out of M82 scope and remain on the missing-measurements list above (rows H1, H2, H10).
- If the synchronous proxy exceeds baseline � 1.05 during Slice A or Slice B, the Surgical Executor stops per M82 �16 escalation conditions.
