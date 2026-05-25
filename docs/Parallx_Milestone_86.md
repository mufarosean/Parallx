# Parallx Milestone 86 — Systemic Redesign Roadmap

**Status:** in progress
**Branch:** `systems-redesign-planning`
**Predecessors:** M83 (workbench hardening), M85 (contention/timer audit)
**Owner:** workbench platform

## Purpose

M83 and M85 closed individual regressions and timer-anti-patterns. The
underlying observation from both milestones is the same: every bug-class
that bit us (W1 startup latency, W2 fail-closed allowlist, W5
diagnostics polling, F1 graph polling, F2 IPC allowlist gap, F3 read
ordering) is a **symptom of a missing structural contract**. Comments
and per-site fixes only paper over the absence.

This milestone catalogs the twelve structural redesigns that, if shipped,
would make the M83/M85 bug-classes impossible by construction instead of
relying on reviewer vigilance. Each work item has goal, design,
acceptance criteria, blast-radius classification, and execution status.

The honest scope read: **of the twelve, five are session-feasible
(W1, W2, W3, W4, W5). Seven are roadmap items requiring multi-day or
multi-week effort (W6–W12).** Roadmap items get full design specs so the
next slice can begin without re-discovery.

## Conventions

- **Blast radius** = `core` (preservation surface, requires §13a
  approval or `degraded-mode:` framing) | `platform` (new files in
  `src/platform/`, no migrations forced on callers) | `ext`
  (extension-only) | `infra` (build/test/CI).
- **Session-feasible** = can ship working code + tests + clean tsc in
  this conversation.
- **Roadmap** = design only; execution deferred.

---

## Work Items

### W1 — Structured logger with categories and ring buffer

- **Status:** session-feasible
- **Blast radius:** platform (new file) + opt-in migration of callers
- **Goal:** Replace ad-hoc `console.warn`/`console.error` with a typed
  category-routed logger. Provide a ring buffer dumpable from the
  diagnostics panel so future M85-style audits are self-service.

**Design**

- New file `src/platform/log.ts`. Exports:
  - `type LogCategory = 'perf' | 'ipc' | 'storage' | 'ext' | 'ai' | 'ui' | 'workbench'`
  - `type LogLevel = 'debug' | 'info' | 'warn' | 'error'`
  - `interface ILogger { debug/info/warn/error(category, message, data?): void }`
  - `interface ILogSink { append(record: LogRecord): void }`
  - Default sink: ring buffer (last 2000 records) + console mirror at
    `warn`+.
  - `getLogger()` global accessor for callers that don't have DI.
  - `getLogBuffer()` returns a snapshot for the diagnostics panel.
- Per-category level overrides via storage key
  `parallx.log.levels.<category>`. Defaults: `warn`.
- No structural migration forced. Callers opt in as they touch sites.

**Acceptance**

- File exists with full type contract.
- Three unit tests: emits at level, suppresses below level, ring buffer
  caps at 2000.
- One real migration site so the API is exercised. Use a logger call
  next to one of the M85-era `console.warn` calls touched in F1/F2.

---

### W2 — Phase-graph startup contract helper

- **Status:** session-feasible
- **Blast radius:** core (workbench.ts is preservation; degraded-mode)
- **Goal:** Make the "all Phase 1 reads must be parallel-warmed"
  invariant from M85-F3 a structural property, not a comment.

**Design**

- New file `src/workbench/startupPhases.ts`. Exports:
  - `interface IStartupPhase<T> { name: string; warmups: Array<() => Promise<unknown>>; body(): Promise<T>; }`
  - `runPhase<T>(phase): Promise<T>` — `await Promise.all(warmups); return phase.body();`
  - `combinePhases(phases): Promise<void>` — sequential runner with
    timing instrumentation that emits to the W1 logger (`perf`
    category).
- `workbench.ts` is **not refactored to use it in this slice**. The
  helper ships standalone with full tests; migrating
  `_initializeServices` to declare a `PhaseOne` and `PhaseFour` is a
  separate slice. This keeps blast radius small while still putting the
  contract into the codebase.

**Acceptance**

- File exists.
- Three unit tests: warmups run in parallel, body awaits all warmups,
  timing is reported.
- workbench.ts unchanged in this slice (the M85-F3 comment is the
  bridge until a future slice migrates).

---

### W3 — Scope and typed event bus

- **Status:** session-feasible
- **Blast radius:** platform (new file, opt-in)
- **Goal:** Give callers a primitive that automatically enforces the
  M85-F1 consumer-ref-count pattern (lazy-start when first consumer
  appears, stop when last consumer departs). Today every author has to
  reinvent the pattern; M85-F1 had to.

**Design**

- New file `src/platform/scope.ts`. Exports:
  - `class Scope extends DisposableStore` — every child registered is
    auto-disposed when the parent disposes; supports nested child scopes.
  - `class RefCountedResource<T>` — wraps a factory `() => T (with
    dispose)`. On `acquire()` instantiates lazily; on last `release()`
    disposes. Returns IDisposable tokens.
  - `class TypedEventBus<TEvents extends Record<string, unknown>>` —
    thin typed wrapper over `Emitter`. Each `on(eventName, listener)`
    accepts a Scope; the subscription auto-disposes with the scope.
- No callers migrated in this slice. Ships with full unit tests so
  future extension authors have a vetted primitive.

**Acceptance**

- File exists.
- Five unit tests covering Scope nesting/disposal, RefCountedResource
  acquire/release/lazy-instantiate, TypedEventBus typing + scope
  auto-cleanup.

---

### W4 — Migration framework wrapper

- **Status:** session-feasible
- **Blast radius:** core (electron/database.cjs is preservation;
  degraded-mode)
- **Goal:** Bake the M64 lesson ("chunk + yield long migrations or
  starve the watcher") into the runner so future migration authors
  don't have to know about SQLite write-lock contention.

**Design**

- Extract migration loop from `electron/database.cjs` (lines 140–170
  and 460–480) into `electron/migrationRunner.cjs`.
- New per-migration metadata header parsed from the SQL file comment:
  ```sql
  -- @parallx:migration { "id": "021", "chunked": false, "blocksWriters": true }
  ```
  Default if header absent: `chunked: false, blocksWriters: true` (matches
  current behavior).
- Runner instruments timing per migration; logs to a known sink
  (console for now; W1 logger when wired).
- If `chunked: true`, migration body is expected to be re-entrant and is
  invoked in 500-row batches with a `setImmediate` yield between
  batches — matching the M64 pattern.
- No existing migration file is changed; they all default to the legacy
  (non-chunked, blocks-writers) path. New migrations can opt in.

**Acceptance**

- New `electron/migrationRunner.cjs` exists with `runMigrations(db,
  migrationsDir, logger)` signature.
- `electron/database.cjs` calls the runner for both migration phases.
- One new unit test under `tests/unit/migrationRunner.test.ts` covering
  header parsing and the chunked yield path against an in-memory
  `node:sqlite` DB.
- Renderer & electron tests still pass.

---

### W5 — Tiered test runner

- **Status:** session-feasible
- **Blast radius:** infra (config + docs only)
- **Goal:** Stop paying the full test cost on every commit. Three vitest
  configs: `tier0` (pure unit, no jsdom), `tier1` (jsdom + storage
  mock), `tier2` (e2e/Playwright stays as-is).

**Design**

- Today: all unit tests run under one `vitest.config.ts` with `pool:
  'forks'` and `globals: true`. No tagging.
- New: `vitest.tier0.config.ts` selects tests via filename suffix
  `*.tier0.test.ts` or by glob `tests/unit/platform/**`. Tier0 runs
  without jsdom (`environment: 'node'`).
- New: `vitest.tier1.config.ts` — current behavior; renamed include
  glob to exclude tier0 files.
- New npm scripts: `test:tier0`, `test:tier1`, `test` (runs both,
  tier0 first).
- Doc note in `docs/PARALLX_MANIFEST.md` describing the tier conventions.
- **No tests are moved or retagged in this slice.** The infrastructure
  ships empty (tier0 has no tests yet) so the contract exists for
  authors to opt new tests into.

**Acceptance**

- Both configs exist; `npm run test:tier0` exits 0 (no tests found is
  valid).
- `npm run test:tier1` matches current full unit count (552 files,
  7479 tests).
- One example test added under `tests/unit/platform/` to exercise the
  tier0 path. Use the W1 logger's ring buffer test (logger is
  pure-node, no DOM needed).

---

### W6 — Typed IPC contract layer (ROADMAP)

- **Status:** roadmap, not executed this session
- **Blast radius:** core (every IPC handler + preload)
- **Goal:** Single registry for all IPC handlers with zod-validated
  input/output, generated preload bindings, generated renderer types,
  central allowlist policy. Eliminates the W2/F2 bug class
  ("allowlist forgotten on this handler") by construction.

**Design sketch**

- New `electron/ipc/registry.cjs` with `defineHandler({ name, input,
  output, policy, handler })`.
- `policy` is a typed value: `'public' | 'allowlistRead' |
  'allowlistWrite' | 'workspaceOnly'`. The registry, not each handler,
  enforces it.
- Build-time codegen emits two artifacts:
  - `electron/preload.generated.cjs` — bindings on `parallxElectron.*`.
  - `src/main.ts` window type fragment — generated, not hand-edited.
- Migration plan: move `fs:*` family first (10 handlers), then
  `storage:*`, then the long tail. Estimated 4–6 slices per family.

**Why not session-feasible**

- 2400 lines of `electron/main.cjs` + tightly-coupled preload.
- Requires choice of validation library (zod vs valibot vs hand-rolled).
- Build pipeline changes (codegen step in esbuild config).
- Every renderer call site updates with the new signature.

**Acceptance (when shipped)**

- All IPC handlers go through the registry.
- Renderer type for `parallxElectron` is generated from the registry,
  not hand-maintained.
- Adding a handler without a `policy` is a compile error.

---

### W7 — Unified sync-warm storage cache (ROADMAP)

- **Status:** roadmap
- **Blast radius:** core (replaces `IGlobalStorageService` /
  `IWorkspaceStorageService` consumers) + ext sites that touch
  `localStorage`
- **Goal:** Single storage abstraction with declared warm-on-startup
  reads. Kills M85-F8 (canvas `localStorage` portability gap) and
  makes M85-F3 (Phase 1 warm contract) structurally enforced.

**Design sketch**

- New `ISyncCachedStorage<T>` interface: async write, sync read after
  warm. Each caller declares its warm set during phase 1 (via W2's
  startup-phase helper).
- Backend stays file-backed via IPC; renderer cache is the warmed
  Map<string, T>.
- Migrate canvasMenuRegistry recent-colors and propertyBar collapse to
  this surface. localStorage usage in `src/platform/storage.ts` and
  `src/platform/storageMigration.ts` is the migration codepath itself
  and stays as-is.

**Why not session-feasible**

- Touching every storage-consumer in workbench.ts (preservation, many
  call sites).
- Cross-workspace portability test matrix.

---

### W8 — Sidecar AI runtime (ROADMAP)

- **Status:** roadmap (multi-week)
- **Blast radius:** core (`src/openclaw/**` is large)
- **Goal:** Move openclaw + MCP clients + cron into a child process so
  chat streams cannot starve the renderer event loop. Makes M85-F4
  (ollama health-poll on renderer) structurally non-applicable.

**Design sketch**

- Spawn `openclawHost.cjs` as a utility process at app startup
  (Electron `utilityProcess.fork`).
- Define a typed message protocol over `MessageChannelMain` (reuses
  W6's registry pattern). Streaming responses use `ReadableStream`
  semantics across the channel.
- Renderer keeps a thin `OpenclawProxy` that mirrors the existing
  `IOpenclawService` interface so callers don't change.
- MCP clients move into the host; only token-stream events cross the
  channel.

**Why not session-feasible**

- Three weeks of work minimum.
- Touches every chat call site for stream-cancellation semantics.
- Requires designing back-pressure across the channel.

---

### W9 — Webview-per-extension isolation (ROADMAP)

- **Status:** roadmap (multi-week)
- **Blast radius:** core + every `ext/**`
- **Goal:** Each extension runs in its own webview process. A runaway
  setInterval in one ext (the exact M85-F1 case) cannot freeze the
  workbench shell.

**Design sketch**

- Shell becomes a coordinator only: surfaces (sidebar items, editor
  panes, status bar entries) are slots that the shell fills with
  `<webview>` elements pointing at ext-owned bundles.
- Each ext bundles to its own HTML+JS via esbuild output config.
- IPC between ext and shell goes through W6's registry.
- Loss-of-extension recovery: if a webview crashes, the shell shows a
  placeholder and offers reload.

**Why not session-feasible**

- Every existing extension would need rebundling.
- Latency model for cross-webview events needs design (debounce vs
  direct).

---

### W10 — Typed extension SDK (ROADMAP)

- **Status:** roadmap (depends on W6 + W9)
- **Blast radius:** ext (every extension)
- **Goal:** Ship `parallx.d.ts` describing the contract every ext uses.
  Force exts through TypeScript. Catch shell-refactor breakage at
  compile time instead of runtime.

**Design sketch**

- Single `parallx.d.ts` at repo root with the full namespace tree
  (`parallx.workspace`, `parallx.storage`, `parallx.ui`, etc.).
- Each ext gets a `tsconfig.json` extending a shared
  `tsconfig.extension.json`.
- esbuild config compiles ext sources from `ext/<name>/src/**.ts` to
  `ext/<name>/main.js`.
- Versioning: `declare namespace parallx { export const version:
  '1.0.0'; }` and each ext declares its `engines.parallx` in its
  manifest.

**Why not session-feasible**

- Every ext (~10) needs a tsconfig + source-tree migration.
- Type contract must be exhaustive before flipping the switch (a
  half-typed surface is worse than none).

---

### W11 — Preservation-slice repair (ROADMAP)

- **Status:** roadmap (investigation + 9 e2e fixes)
- **Blast radius:** depends on root cause
- **Goal:** Get the `preserve:slice` gate back to green so the
  `degraded-mode:` escape hatch returns to being an exception, not the
  norm. Today M83/M85 commits all went degraded.

**Design sketch**

- Inventory the nine failing tests:
  - `tests/e2e/02-explorer.spec.ts:30,98`
  - `tests/e2e/08-workspaces.spec.ts:96,142,273,399`
  - `tests/e2e/09-canvas.spec.ts:132,153,196`
- For each: read the test, reproduce locally with `npx playwright test
  --headed --debug`, classify root cause as (a) genuine regression we
  missed, (b) test brittleness, or (c) environment flake.
- Fix (a) properly; rewrite (b); quarantine (c) with a tracking issue.

**Why not session-feasible**

- Nine independent investigations, each needing Playwright debug
  cycles.

---

### W12 — HMR for renderer (ROADMAP)

- **Status:** roadmap
- **Blast radius:** infra (build config) + workbench (lifecycle)
- **Goal:** Cut the inner dev loop from full-rebuild to module-level
  HMR. As a side effect, surfaces state-resurrection bugs (F2-style
  "what survives a reload?") much earlier.

**Design sketch**

- Replace esbuild bundle-on-save with Vite for the renderer (electron
  main stays esbuild).
- Workbench needs `import.meta.hot.accept` hooks at module boundaries.
- Extensions stay bundled per-W9-design — HMR is shell-only.

**Why not session-feasible**

- Vite migration is its own milestone.
- Workbench is not currently structured for HMR boundaries.

---

## Execution log

| ID | Title | Status | Commit |
|----|-------|--------|--------|
| W1 | Structured logger | shipped | `691e5f83` |
| W2 | Phase-graph startup helper | shipped (helper only; `workbench.ts` migration deferred) | `691e5f83` |
| W3 | Scope + typed event bus | shipped | `691e5f83` |
| W4 | Migration framework wrapper | shipped (degraded-mode commit) | `1838676b` |
| W5 | Tiered test runner | shipped | `cc517ee8` |
| W6 | Typed IPC contract layer | roadmap | — |
| W7 | Unified sync-warm storage cache | roadmap | — |
| W8 | Sidecar AI runtime | roadmap | — |
| W9 | Webview-per-extension isolation | roadmap | — |
| W10 | Typed extension SDK | roadmap | — |
| W11 | Preservation-slice repair | roadmap | — |
| W12 | HMR for renderer | roadmap | — |

### Closure notes

- **W1/W2/W3 (`691e5f83`)** landed as new files only — no preservation surface touched, clean commit. Tier-0 + tier-1 green.
- **W5 (`cc517ee8`)** added `vitest.tier0.config.ts`, excluded tier-0 globs from `vitest.config.ts`, split `npm run test:unit` into `test:unit:tier0` + `test:unit:tier1`, moved `tests/unit/log.test.ts` → `tests/unit/platform/log.test.ts` as the seed. Manifest §22 updated.
- **W4 (`1838676b`)** required a `--no-verify` commit with `degraded-mode:` body tag because it modified `electron/database.cjs` and `electron/main.cjs`. Pre-commit gate fired as designed; commit body documents the reason (preservation-surface change without a fresh e2e refresh, out of scope for this slice). The 9 pre-existing e2e failures verified at `faf3e801` are unchanged.
- **W2 caveat:** `runPhase` is shipped and tested but `workbench.ts._initializeServices` was NOT migrated to use it. The M85-F3 inline comment still bridges the invariant. A future slice should migrate the call sites — that slice will be preservation surface and will need a degraded-mode commit or a fresh slice-closure.
- **Future-proofing:** W4's chunked-migration header is opt-in and defaults to historic behavior, so no existing migration changes shape. Authors who add a large-rebuild migration in the future can simply add `-- @parallx:migration { "chunked": true }` and `-- @parallx:chunk` markers, and the runner will yield the SQLite write lock between chunks (M64 lesson).

### Verification at closure HEAD `1838676b`

- `npx tsc -p tsconfig.json --noEmit` → exit 0
- `npm run test:unit:tier0` → 24/24 in ~210ms (2 files: log, migrationRunner)
- `npm run test:unit:tier1` → 554/7494/1 skipped in 78.66s

### Reusable patterns recorded

These primitives are now available for future milestones:

- `Logger` + `RingBufferSink` (`src/platform/log.ts`) for any new categorized perf/lifecycle logging without ad-hoc `console.warn`.
- `Scope` + `RefCountedResource` + `TypedEventBus` (`src/platform/scope.ts`) for any new feature that needs M85-F1-style consumer ref-counting or scope-bound event subscriptions.
- `runPhase` / `runPhasesSequential` (`src/workbench/startupPhases.ts`) for any phased async initialization where Phase N's warmups must complete before Phase N's body.
- Migration runner header (`-- @parallx:migration { "chunked": true }`) for any future migration that does large in-place rebuilds and shouldn't block the watcher hot path.
- Tier-0 test convention (`tests/unit/platform/**` or `*.tier0.test.ts`) for pure-Node tests that don't need jsdom.
