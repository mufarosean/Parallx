---
Status: Independent fitness review (KEEP verdict)
Reviewer: Verification Agent (subagent, distinct from implementer)
Branch: systems-redesign-planning
Reviewed commit: 6deec742
Created: 2026-05-23
Reviews: docs/Parallx_Milestone_81.md 4 Slice A
Per: docs/PARALLX_MANIFEST.md 13 (Fitness and Review Agent)
---
## Fitness Review — M81 Slice A (commit 6deec742)

### Verdict: KEEP

### Evidence

#### A. Manifest compliance
- **A.1: PASS** — Single commit `6deec742` with clear feat() subject; body explains intent, scope, and includes `Rollback: git revert HEAD.` (verified via `git show --stat 6deec742`).
- **A.2: PASS** — Anti-list (per [docs/Parallx_Milestone_81.md](docs/Parallx_Milestone_81.md#L144-L153)) checked against `git diff --stat HEAD~1`: none of `canvasDataService.ts`, `canvasEditorProvider.ts`, `chatDataService.ts`, `explorerService.ts`, `electron/database.cjs`, `electron/main.cjs`, or `ext/**` appear in the 9-file diff.
- **A.3: PASS** — Deferred / NO-CHANGE list (lines 137-142) honored: no diff against `src/workspace/workspace.ts`, `src/workspace/recentWorkspaces.ts`, `src/parts/editorPart.ts`, `src/parts/explorerPart.ts`, `src/built-in/chat/input/chatContextAttachments.ts`, `src/built-in/canvas/canvasSidebar.ts`. `resourceRegistry.ts` and `selectionBridge.ts` do not exist (`file_search` confirms).
- **A.4: PASS** — `registerHandler(handler: ISelectionActionHandler): IDisposable` signature unchanged in [selectionActionDispatcher.ts](src/services/selectionActionDispatcher.ts#L65) and [selectionActionTypes.ts](src/services/selectionActionTypes.ts#L152); the new constructor parameter is `selectionService?` (optional), so the existing call `new SelectionActionDispatcher()` at [src/built-in/chat/main.ts:2558](src/built-in/chat/main.ts#L2558) still compiles. `tsc --noEmit` exits 0.
- **A.5: PASS** — No workspace schema change (no `electron/database.cjs` diff, no migration file), no IPC signature change (no `main.cjs` diff), no extension API break (no `ext/` or `src/api/` diff), no keybinding/command-ID change (no `package.json` or contribution-file diff).

> **Minor deviation worth noting** (not a fail): The §4 "Files touched" list in the rescoped milestone (lines 124-132) enumerated 7 files; the commit touches 9. The extras are `src/services/selectionActionTypes.ts` (adds `ISelection` interface next to the existing `ISelectionSource`) and `src/services/serviceTypes.ts` (adds `ISelectionChangeEvent`, `ISelectionService`, and the `createServiceIdentifier(ISelectionService)` registration). Both are pure additions and architecturally correct — `serviceTypes.ts` is the canonical home of every other service identifier in the codebase, and `ISelection` is more cohesive alongside `ISelectionSource` than in a third types file. Defensible.

#### B. Code quality and correctness
- **B.1: PASS** — [selectionService.ts](src/services/selectionService.ts) implements `setSelection(surfaceId, selection|undefined)` (L29), `getSelection(surfaceId?)` (L65) with most-recent fallback when no arg, `onDidChangeSelection` event (L27) carrying `{ surfaceId, selection, previous }` (L56-L60), is multi-subscriber via `Emitter`, and is `Disposable`.
- **B.2: PASS** — Dispatcher diff is strictly additive: a new `_selectionService` private field, optional constructor parameter, and a pre-handler broadcast block ([selectionActionDispatcher.ts:88-101](src/services/selectionActionDispatcher.ts#L88-L101)). No existing method removed/renamed; the existing `chat/main.ts` call site continues to work unchanged.
- **B.3: PASS** — `WorkbenchContextManager.trackSelectionService()` ([workbenchContext.ts:285-294](src/context/workbenchContext.ts#L285-L294)) sets the key to `service.hasAnySelection()` (map-size check, returns true iff ≥1 surface has a non-undefined selection). The test at [selectionContextKey.test.ts:52-72](tests/unit/selectionContextKey.test.ts#L52-L72) covers two-surface set, partial-clear (stays true), and full-clear (flips false). No double-counting (per-surface keyed `Map`).
- **B.4: PASS** — `SelectionService.dispose()` clears `_perSurface`, resets `_mostRecentSurfaceId`, and calls `super.dispose()` which disposes the registered `Emitter`; the `Disposable` base then disposes the inner store ([lifecycle.ts:381-391](src/platform/lifecycle.ts#L381-L391)). Listeners (each returned `IDisposable` from `onDidChangeSelection`) can dispose independently — verified by test "disposing a subscriber stops further notifications to it" ([selectionService.test.ts:142-153](tests/unit/selectionService.test.ts#L142-L153)).
- **B.5: CONCERN (acceptable)** — The module-level `_activeSelectionService` singleton ([selectionActionDispatcher.ts:23](src/services/selectionActionDispatcher.ts#L23)) is fine for production (single Electron renderer; one bootstrap calls `setActiveSelectionService` exactly once at [workbenchServices.ts:84](src/workbench/workbenchServices.ts#L84)). Nothing clears it on shutdown — acceptable because process death does. For tests, the new test files don't go through workbench bootstrap so they get isolated state; the `setActiveSelectionService(undefined)` capability is documented for future cleanup. Hot-reload in dev would leak a stale reference but Parallx doesn't do live module reload in renderer. Defensible.
- **B.6: PASS (with one minor gap)** — Tests are behavioral, not tautological: event payload structure (previous/current), no-op identity skip, clear-empty no-op, per-surface get, most-recent fallback after clear, multi-subscriber fan-out, subscriber dispose, service dispose-after-set quiescence. **Gap**: no test for subscribing *after* `dispose()` (the `Emitter` will be disposed; behavior is "no callbacks ever fire"). Minor — the produced `IDisposable` is harmless. Not a blocker.
- **B.7: PASS** — File header banner present (`// selectionService.ts — …`), imports ordered (platform → service types → cross-module types), naming matches existing service conventions (`ISelectionService` identifier exported alongside the interface — same shape as `IContextKeyService` on [serviceTypes.ts:783](src/services/serviceTypes.ts#L783)). The mid-file `import type { ISelection }` in [serviceTypes.ts](src/services/serviceTypes.ts#L786) is unusual style but consistent with the existing `import type { IToolDescription }` already in that file.

#### C. Slice purpose
- **C.1: PASS** — End-to-end trace verified: a Slice B caller can `services.get(ISelectionService)` ([workbenchServices.ts:81-83](src/workbench/workbenchServices.ts#L81-L83)), call `onDidChangeSelection(...)`, and `setSelection('editor', sel)` → `Emitter.fire(...)` → `WorkbenchContextManager._selectionExists.set(true)` ([workbenchContext.ts:288-292](src/context/workbenchContext.ts#L288-L292)) → context-key registry updated. No handler registration required. Path is exercised by `selectionContextKey.test.ts`.
- **C.2: PASS** — `export type IContextKeyRegistry = WorkbenchContextManager;` ([workbenchContext.ts:303](src/context/workbenchContext.ts#L303)) gives Slice B a stable type alias to depend on. Importing from `src/context/workbenchContext` is the same place every existing `CTX_*` key already lives, so discovery is trivial.

#### D. Regression evidence
- **D.1: PASS** — `npx tsc --noEmit` → exit 0.
- **D.2: PASS** — `npx vitest run` → `Test Files 206 passed (206)` / `Tests 3166 passed | 1 skipped (3167)` / `EXIT=0` / duration 79.17s. Targeted re-run of the new files: 16/16 pass in 252ms.
- **D.3: PASS** — Existing handler-registration site at [src/built-in/chat/main.ts:2558,2571](src/built-in/chat/main.ts#L2558-L2571) unchanged: `new SelectionActionDispatcher()` (no arg) still constructs; `registerHandler()` still returns `IDisposable`; `dispatch()` still routes to the registered handler. The added broadcast block runs *before* the handler lookup (intentional per the source comment) and is wrapped in try/catch, so a SelectionService failure cannot break handler execution.

### Required changes before close-out
(none — KEEP)

### Risks for future slices

1. **Sticky context key in production wiring.** The dispatcher's `setSelection` call (in the new broadcast block) only ever **sets**; nothing in Slice A ever calls `setSelection(surfaceId, undefined)`. In the current wiring, once any user action fires for any surface, `selectionExists` flips to `true` and never returns to `false`. Slice A's unit test only proves the *service* clears correctly via direct `setSelection(_, undefined)` calls. **Slice B must** wire real surface adapters (editor blur/clear, explorer deselect, PDF selection-collapse) that call `setSelection(_, undefined)`, otherwise `when: selectionExists` clauses will be unusable. This is acceptable scope-wise (Slice A delivers the *primitive*; surface integration is Slice B/D per the milestone doc lines 141-142), but it MUST be explicit in Slice B's contract.

2. **Spurious event fan-out.** The dispatcher constructs a **fresh `ISelection` object on every dispatch** ([selectionActionDispatcher.ts:93-97](src/services/selectionActionDispatcher.ts#L93-L97)). `SelectionService.setSelection` uses **reference equality** for the no-op skip — so identical-content selections from successive menu actions (e.g., "add to chat" then "send to canvas" on the same selection) both fire `onDidChangeSelection`. Subscribers that perform expensive work on selection change MUST guard with content comparison. Document this in Slice B's subscriber contract or upgrade `setSelection` to deep-compare `selectedText + source.filePath`.

3. **Order-of-eviction in most-recent fallback.** When the most-recent surface clears, the fallback ([selectionService.ts:48-52](src/services/selectionService.ts#L48-L52)) iterates `_perSurface.keys()` and sets `_mostRecentSurfaceId = id` for *every* iteration — so the final value is the **last-inserted** remaining key, not the **second-most-recently-set**. With JS `Map` insertion-order semantics this happens to coincide for the simple test case, but it's not what the doc comment claims ("most-recently-set first remaining"). If Slice B/D consumers rely on "give me the previously-active selection when the current one is cleared", this will subtly mis-order across ≥3 surfaces. Not exercised by the test suite. Consider tracking a recency stack instead of relying on Map iteration order. Low priority — flag for Slice B.

4. **Module-level singleton has no test reset hook.** Test files that import `setActiveSelectionService` could leak state across files. Not currently exercised, but if Slice B adds dispatcher integration tests, they should `setActiveSelectionService(undefined)` in `afterEach`.
