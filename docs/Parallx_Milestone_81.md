---
Status: implemented-verified — Slices A, B, C, D all resolved 2026-05-23. Slice A shipped SelectionService event broadcast. Slice B shipped ContributionRegistry orchestrator. Slice C: 4 items CLOSED in-place + Canvas page provenance SHIPPED. Slice D shipped canvas link-resolver self-registration. §22 promised tests physicalized 2026-05-24 (commits 00d4ce48, 1253d803, eec372ee, dedfbf36, 328d539c).
Milestone: M81 / SR-1: Workbench Unification, Slice 1 (Primitives & Event Routing)
Branch: systems-redesign-planning
Created: 2026-05-23
Activated: 2026-05-23
Supersedes: None explicitly; carries forward planning from M66, M69, M71, M72, M76, M80
Carries forward: See §3
Manifest: docs/PARALLX_MANIFEST.md (§5, §11, §12, §17, §20, §22)
Interaction model: docs/architecture/WORKBENCH_INTERACTION_MODEL.md
Review: docs/research/WORKBENCH_INTERACTION_MODEL_REVIEW.md (§9 acceptance conditions, §10 slice recommendation)
Baseline: docs/research/baselines/workbench-baseline.md (§1 workflow decomposition, §4 characterization tests)
Atlas: docs/architecture/SYSTEM_ATLAS.md (§1–§3 entry points and system ownership)
Triage: docs/research/MILESTONE_DOC_TRIAGE.md
Governance: docs/research/git/BRANCH_GOVERNANCE.md
---

# Parallx Milestone 81 / SR-1: Workbench Unification

## 1. Goal

M81 / SR-1 implements the first phase of the Workbench Interaction Model (WORKBENCH_INTERACTION_MODEL.md §1–§5) by introducing unified primitives and event-driven routing for cross-tool interaction. Specifically, M81 introduces the **Resource, Workspace, SelectionService, SurfaceRegistry, and ContextService** primitives and replaces the hard-coded SelectionActionDispatcher with typed event subscriptions. This enables the workflow hop from [PARALLX_MANIFEST.md §5](docs/PARALLX_MANIFEST.md#5-core-product-workflow):

> "User browses files in Explorer → opens documents in editors → asks AI chat about those documents → AI references the same workspace resources → creates Canvas pages/artifacts → reopens workspace."

specifically the **Selection → Chat** and **Selection → Canvas** bridges, which today (SYSTEM_ATLAS.md §4.1) are hard-coded one-off routes. M81 replaces these with a centralized SelectionService that emits typed events, enabling any surface to subscribe without modifying core dispatcher code. Secondary outcome: establishes the measurement baseline for workspace cold-start, editor open, and selection routing latency, enabling future slices to prove improvements without regression.

---

## 2. Non-Goals

M81 explicitly does NOT implement:

- Redesign of AI chat internals, OpenClaw runtime, or turn execution. Chat remains independent; M81 only clarifies how chat observes cross-tool events (WORKBENCH_INTERACTION_MODEL.md §1.2, §7.3).
- Changes to Canvas content model, block types, or persistence schema. Canvas ownership and auto-save behavior are unchanged (WORKBENCH_INTERACTION_MODEL.md §2.12, §5).
- Changes to Explorer file-watching, tree rendering, or file-system interaction. FileService behavior preserved (SYSTEM_ATLAS.md §2).
- Removal of extension APIs, settings, keybindings, or commands. All existing manifests remain valid (WORKBENCH_INTERACTION_MODEL.md §7.1 compatibility table, §7.3).
- Changes to database schema, migrations, or durable state format beyond additive fields (SYSTEM_ATLAS.md §1.2).
- Per the review acceptance condition 9 (WORKBENCH_INTERACTION_MODEL_REVIEW.md §9), extension point support (e.g., third-party Canvas block types, Chat participants) — deferred to M82+ (WORKBENCH_INTERACTION_MODEL.md §3.3, Q8 decision).
- TaskService implementation or autonomy refactor. Autonomy remains independent; TaskService integration is Slice C (WORKBENCH_INTERACTION_MODEL.md §6.3, Q7 decision, deferred).
- Capability and Artifact/Provenance primitives. Those are Slices C–D (WORKBENCH_INTERACTION_MODEL_REVIEW.md §10).

Per [WORKBENCH_INTERACTION_MODEL.md §8 (Out of Scope)](docs/architecture/WORKBENCH_INTERACTION_MODEL.md#8-out-of-scope): storage abstraction (FileBackedStorage, FileBackedWorkspaceStorage) unchanged; IPC handler categories not reorganized; extension host isolation not modified; no visual/UI redesign.

---

## 3. Carried Forward / Superseded

### 3.1 Carried Forward

These planning milestones have designs that M81 integrates or extends:

| Milestone | Title | M81 carries forward | Status |
|---|---|---|---|
| **M66** | Unified linking, citations, AI self-awareness | LinkResolverService design (WORKBENCH_INTERACTION_MODEL.md §2.2 Resource, §4 Bridge 7; not implemented in M81 but foundation laid for M82) | *Planning (M81 extends but does not implement)* |
| **M69** | AI Node Inspector | Node content bridge (WORKBENCH_INTERACTION_MODEL.md §2.11 Event) and provenance framework design (deferred to M83) | *Planning (design preserved; implementation deferred)* |
| **M71** | Configurable Dashboard | Cell refresh scheduling will use TaskService background queuing (Slice C; M81 does not implement) | *Planning (design preserved; TaskService not ready)* |
| **M72** | AI Ecosystem Cohesion | Phase 1 (cleanup) is independent; Phase 2+ (config / SOUL architecture) depends on Workspace canonical ownership (M81 Slice A establishes this) | *Planning (Phase 1 can proceed independently; Phase 2+ depends on M81 Slice A)* |
| **M76** | Mind Map Workspace Graph | Depends on M68 cached-edge table (SYSTEM_ATLAS.md §2, Workspace Graph); M81 does not change graph architecture | *Planning (design preserved; no architecture change in M81)* |
| **M80** | Budget Sync as a Skill+Tools Agent | Extension activation and tool registry changes (Slice B, M82+); M80 design accepted but implementation deferred pending M81 foundation | *Planning (design accepted; execution deferred pending M81)* |

### 3.2 Superseded

M81 does NOT supersede any shipped milestone. All shipped milestones (M64–M79) retain their implementations:

| Milestone | Status | Why retained |
|---|---|---|
| M64–M65, M73–M75, M77–M78 | `implemented-verified` | Shipped functionality; M81 is additive (new primitives), not a rewrite. These implement Explorer, editors, Canvas, chat, reliability hardening, performance hardening; M81 only clarifies how they communicate. |
| M67 | `partial` | Security hardening phase 1–2 complete; phase 1.3 (gmail-mcp integration) carries forward independently. M81 does not change extension capability model. |
| M68 | `implemented-unverified` | Semantic graph MVP shipped; M81 does not change graph data model or ownership. |
| M70 | `implemented-verified` | Command opt-in shipped; M81 will use CommandRegistry (already exists; M81 adds types/ownership clarity). |

### 3.3 Untouched (Preservation Required)

These implemented milestones' behavior must NOT regress:

- **M64** (Budget UX consolidation): [Parallx_Milestone_64.md](docs/Parallx_Milestone_64.md#6-acceptance-criteria), verification section lists 6 test procedures. M81 must preserve sidebar count, command accessibility, budget data integrity.
- **M65** (Web Research Extension): [Parallx_Milestone_65.md](docs/Parallx_Milestone_65.md#6-acceptance-criteria), Regression Sentinel 10/10 checks. M81 must preserve extension activation, tool invocation, workspace isolation.
- **M70** (App Command Control): [Parallx_Milestone_70.md](docs/Parallx_Milestone_70.md#5-acceptance-criteria), command registry opt-in behavior. M81 CommandRegistry changes must not break existing command dispatch.
- **M73–M75** (EPUB reader): [Parallx_Milestone_73.md](docs/Parallx_Milestone_73.md#5-verification-commands), EPUB extraction and rendering. M81 must preserve editor provider registration.
- **M77–M78** (Reliability + Performance hardening): [Parallx_Milestone_77.md](docs/Parallx_Milestone_77.md) and [Parallx_Milestone_78.md](docs/Parallx_Milestone_78.md) document critical hot paths (FTS rebuild chunking, WAL pragmas, file-watcher coalescing, embedding worker flag, indexing yield). M81 must not undo these optimizations (Baseline §5).

All preservation checks run via `npm run test:unit`, `npm run test:e2e`, and characterization tests from Baseline §4.

---

## 4. Slices

M81 delivers four slices, recommended by WORKBENCH_INTERACTION_MODEL_REVIEW.md §10 and gated by Baseline §4 characterization tests. Slices are sequential; later slices depend on prior slices completing.

### Slice A: Unified Primitives and Event Routing (SelectionService + Resource + Workspace canonical ownership)

> **2026-05-23 rescope:** Reality audit ([M81_SLICE_A_AUDIT.md](research/M81_SLICE_A_AUDIT.md), commit `2a9daf6`) verified the original scope against the actual source. Three of four claimed pain points DO NOT EXIST in current code:
> - Selection handlers are already registry-based (`SelectionActionDispatcher.registerHandler(handler) -> IDisposable`); built-ins register at activation, extensions can register custom handlers at any time. No hard-coded routing.
> - `Workspace` already canonically owns folders+state with `onDidChangeFolders` and `onDidChangeState` events. `RecentWorkspaces.add(workspace)` is snapshot-only — it never mutates back. No dual update exists.
> - A central context-key registry already exists as `WorkbenchContextManager` ([src/context/workbenchContext.ts](src/context/workbenchContext.ts)), exporting ~26 `CTX_*` constants created in its constructor and reused across the workbench.
>
> The audit's recommendation is reflected below: Slice A is reduced to the one genuinely missing primitive (`SelectionService` event broadcast + minimal migration of the two existing built-in handlers to subscribe to it) plus formalisation work on `WorkbenchContextManager`. `ResourceRegistry` is deferred to a later slice pending a concrete consumer (no current call-site needs URI→Resource resolution beyond what `editorResolverService` and `linkContractRegistry` already provide). The compatibility shim around `SelectionActionDispatcher` is retained so all current `registerHandler` callers keep working unchanged.

**Workflow hop it serves:**
[PARALLX_MANIFEST.md §5](docs/PARALLX_MANIFEST.md#5-core-product-workflow), specifically:
> "User browses files in Explorer → opens documents in editors → asks AI chat about those documents."

**Current pain point (audit-corrected against actual code):**
- Selection dispatch is **action-shaped** (handler invoked for a named action: `addSelectionToChat`, `sendSelectionToCanvas`) but the redesign wants it **state-shaped** (current selection broadcast as an event other surfaces and context keys can subscribe to). There is no `selectionExists` context key today; there is no way for an extension contribution's `when:` clause to react to the user's current selection because there is no central place that emits "selection changed". Slice B (Command + Tool registry with `when:` clauses) needs this event channel to evaluate menu/keybinding availability.
- `WorkbenchContextManager` works but its key set is hardcoded in its constructor. Slice B needs extensions to be able to read context keys without coupling to that file. The fix is to expose the existing service through a stable surface and document it as the canonical registry — no new service, no duplication.

**Interaction-model section that defines the target:**
[WORKBENCH_INTERACTION_MODEL.md §2 Unified Primitives](docs/architecture/WORKBENCH_INTERACTION_MODEL.md#2-unified-primitives):
- §2.5 Context (centralized context keys; enables conditional UI) — **already implemented as `WorkbenchContextManager`; formalise.**
- §2.6 Selection (part of Context; emitted as events) — **add event broadcast on top of existing action dispatcher.**

§2.1 (Workspace canonical ownership), §2.2 (Resource registry), §4 (bridge replacement), and §5 (duplicate-contract resolution) are addressed elsewhere:
- §2.1 is **already shipped** in `src/workspace/workspace.ts` (M53 D4.6 enforces single-folder canonical ownership; `onDidChangeFolders`, `onDidChangeState`, `onDidRename` events fire).
- §2.2 is **deferred** — no current consumer; revisit when Slice C (Artifact, Provenance) needs cross-surface URI resolution.
- §4/§5 — the only live duplicate the audit found was the false-positive `RecentWorkspaces` claim. Real bridge replacement (`SelectionActionDispatcher` → `SelectionService` event) is the next-slice work, not Slice A.

**Atlas anchor (what exists today, verified by audit):**
- `SelectionActionDispatcher` (registry-based, `registerHandler -> IDisposable`): [src/services/selectionActionDispatcher.ts](src/services/selectionActionDispatcher.ts)
- Built-in handler registration: [src/built-in/chat/main.ts:L2571](src/built-in/chat/main.ts) (`context.subscriptions.push(_selectionDispatcher.registerHandler(handler))`)
- Handlers: [src/services/selectionActionHandlers.ts](src/services/selectionActionHandlers.ts) (`AddSelectionToChatHandler`, `SendSelectionToCanvasHandler`, `createBuiltInActionHandlers()` factory)
- `Workspace` (canonical owner, single-folder enforced): [src/workspace/workspace.ts:L35-L48](src/workspace/workspace.ts)
- `RecentWorkspaces` (snapshot-only — `add(workspace)` takes one snapshot, never re-reads): [src/workspace/recentWorkspaces.ts:L35-L70](src/workspace/recentWorkspaces.ts)
- `WorkbenchContextManager` (central context-key holder, ~26 `CTX_*` constants): [src/context/workbenchContext.ts](src/context/workbenchContext.ts)
- `ContextKeyService` (the underlying registry primitive): [src/context/contextKey.ts](src/context/contextKey.ts)

**Files touched** (rescoped — exhaustive list, every file the Surgical Executor may modify in this slice):
- `src/services/selectionService.ts` *(NEW)* — `SelectionService` with `setSelection(surfaceId, selection)` / `getSelection(surfaceId?)` / `onDidChangeSelection` event. Owns the current selection state per surface and broadcasts changes.
- `src/services/selectionActionDispatcher.ts` *(MODIFY — additive only)* — accept an optional `SelectionService` in the constructor; when an action fires, also publish through the selection service so existing handler-registration callers keep working unchanged. No removals.
- `src/context/workbenchContext.ts` *(MODIFY)* — add a `selectionExists` context key, wired to `SelectionService.onDidChangeSelection`. Re-export `WorkbenchContextManager` as the canonical `IContextKeyRegistry` for Slice B consumers (interface-only, no new file).
- `src/workbench/workbench.ts` *(MODIFY)* — instantiate `SelectionService` in Phase 1; pass it to `SelectionActionDispatcher`; wire it to `WorkbenchContextManager` for the new context key.
- `src/services/serviceCollection.ts` *or `src/workbench/workbenchServices.ts` *(MODIFY)* — register `SelectionService` in the DI container so future surfaces can `services.get(ISelectionService)`. Pick whichever file currently registers `SelectionActionDispatcher`.
- `tests/unit/selectionService.test.ts` *(NEW — characterization test)* — verify event emission, per-surface query, multi-subscriber correctness, disposal.
- `tests/unit/selectionContextKey.test.ts` *(NEW — characterization test)* — verify `selectionExists` flips on/off via the service.

**Deferred to later slices (with explicit audit reasons):**
- `src/services/resourceRegistry.ts` — **DEFERRED to Slice C.** No current consumer; `editorResolverService` and `linkContractRegistry` cover existing URI→content resolution. Build when Slice C's Artifact/Provenance primitives need it.
- `src/api/bridges/selectionBridge.ts` — **DEFERRED to Slice B.** Extension API surface for selection events ships with the extension contribution model (when-clauses, menu contributions) so the bridge is defined alongside its consumers.
- `src/workspace/workspace.ts` — **NO CHANGE.** Audit confirmed canonical ownership and event surface already exist.
- `src/workspace/recentWorkspaces.ts` — **NO CHANGE.** Audit confirmed snapshot-only pattern; no dual update to fix.
- `src/parts/editorPart.ts`, `src/parts/explorerPart.ts` — **NO CHANGE in Slice A.** Migration to `SelectionService.onDidChangeSelection` (away from direct dispatcher calls) happens when there is a real menu/keybinding contribution that needs it.
- `src/built-in/chat/input/chatContextAttachments.ts`, `src/built-in/canvas/canvasSidebar.ts` — **NO CHANGE in Slice A.** They continue to register through `SelectionActionDispatcher`; the shim publishes to both channels so behavior is identical.

**Files NOT touched** (anti-list — high-risk neighbors that must remain untouched):
- `src/built-in/canvas/canvasDataService.ts` (Canvas persistence ownership unchanged)
- `src/built-in/canvas/canvasEditorProvider.ts` (Canvas editing workflow unchanged)
- `src/built-in/chat/data/chatDataService.ts` (Chat persistence ownership unchanged)
- `src/built-in/explorer/explorerService.ts` (Explorer tree behavior unchanged; only selection dispatch changes)
- `electron/database.cjs` (Database schema, WAL pragmas unchanged)
- `electron/main.cjs` (IPC handler signatures unchanged; only content changes)
- `ext/` (Extension implementations; only manifest parsing for `when` clauses added in Slice B)

**Files NOT touched** (anti-list — high-risk neighbors that must remain untouched):
- `src/built-in/canvas/canvasDataService.ts` (Canvas persistence ownership unchanged)
- `src/built-in/canvas/canvasEditorProvider.ts` (Canvas editing workflow unchanged)
- `src/built-in/chat/data/chatDataService.ts` (Chat persistence ownership unchanged)
- `src/built-in/explorer/explorerService.ts` (Explorer tree behavior unchanged; only selection dispatch changes)
- `electron/database.cjs` (Database schema, WAL pragmas unchanged)
- `electron/main.cjs` (IPC handler signatures unchanged; only content changes)
- `ext/` (Extension implementations; only manifest parsing for `when` clauses added in Slice B)

**Characterization tests that must pass BEFORE the slice starts:**
(These establish baseline behavior to ensure no regression.)

From [Baseline §4](docs/research/baselines/workbench-baseline.md#4-proposed-characterization-tests):
- `tests/unit/workspaceStateSerialization.test.ts` — Workspace save/load round-trip (no information loss)
- `tests/unit/explorerTreeRender.test.ts` — Explorer tree population latency (< 200ms for 1000 files)
- `tests/unit/selectionToChatAttach.test.ts` — Selection dispatch speed (< 10ms)
- `tests/unit/fileWatcherCoalesce.test.ts` — Watcher coalescing behavior (50ms window preserved)
- Current unit tests: `npm run test:unit` all pass on baseline

**Characterization tests added during the slice:**
- `tests/unit/selectionEventRouting.test.ts` — Verify SelectionService event emission and subscription (replaces hard-coded handler routing)
- `tests/unit/workspaceFolderCanonicalOwnership.test.ts` — Verify `Workspace.folders` is single source of truth; RecentWorkspaces observes via event
- `tests/unit/contextKeyDiscovery.test.ts` — Verify context keys are centrally discoverable (IDE autocomplete enabled)
- `tests/unit/surfaceFocusContext.test.ts` — Verify context changes when active surface changes
- `tests/e2e/selectionToChat.spec.ts` — E2E: select file in Explorer → message in chat → chat references correct file
- `tests/e2e/selectionToCanvas.spec.ts` — E2E: select file in Explorer → send to canvas → canvas artifact created with correct reference

All tests must pass before merge.

**Measurement that proves "better":**

Slice A introduces no user-visible performance change; measurement is on composability and maintainability:
- **Composability:** Baseline §1 H6 (Chat attachment context resolution) remains < 5ms. New E2E tests (selectionToChat, selectionToCanvas) measure end-to-end latency; target < 100ms from selection dispatch to chat/canvas reaction.
- **Maintainability:** Code review: `SelectionActionDispatcher` is deprecated (shim only); no new hand-coded handlers can be added. Future surfaces subscribe to `SelectionService.onDidChangeSelection` without modifying core code. Line count in `selectionActionHandlers.ts` does not grow.
- **Debuggability:** Logs: SelectionService emits named events (onDidChangeSelection, onDidClearSelection). Traces correlate selection→chat/canvas via event subscriber names in debug logs.

**Stop-rule triggers specific to this slice:**
- If `npm run test:unit` or `npm run test:e2e` fail on baseline before slice A starts, **stop**. Baseline must be clean.
- If `workspaceFolderCanonicalOwnership.test.ts` or `selectionEventRouting.test.ts` fail after slice A completes, **stop and rollback**. Core primitives must be correct before later slices.
- If any existing handler in `selectionActionHandlers.ts` cannot be shimmed to call SelectionService, **stop**. Backward compatibility is non-negotiable.
- If Workspace state methods conflict with existing extension API, **stop and revise**. Check against [WORKBENCH_INTERACTION_MODEL.md §7.1 Compatibility Table](docs/architecture/WORKBENCH_INTERACTION_MODEL.md#71-compatibility-table-existing-public-apis--new-primitives).

**Rollback path:**
```bash
git revert <sha-of-slice-a-commit>
```

This restores:
- SelectionActionDispatcher to full implementation (no shim).
- Workspace.folders as string array (no WorkspaceFolder type).
- RecentWorkspaces dual update behavior (no event subscription).
- All context keys scattered (no ContextKeyRegistry).
- No SelectionService (return to handler dispatch).

Rollback restores the app to commit 9b9a243 (checkpoint-pre-systems-redesign-2026-05-23) and all M64–M80 tests pass.

**Dependency on prior slices:**
None. Slice A is the root. Slices B, C, D depend on Slice A completing successfully.

**Estimated commit count:**
1 commit:
- `feat(workbench): introduce SelectionService, Resource, Workspace canonical ownership, ContextKeyRegistry (M81 Slice A)`
  - Includes all files listed above (new code, shims, tests, API bridges).
  - Commit body includes acceptance criteria checklist and rollback note.

### Slice B: Command and Tool Registry with Contribution Support

> **2026-05-23 rescope:** Reality audit ([M81_SLICE_B_AUDIT.md](research/M81_SLICE_B_AUDIT.md), commit `977e660`) verified the original scope against the actual source. Two of the three claimed pain points are already shipped:
> - "Commands are registered scattered" — **REFUTED.** `CommandService` at [src/commands/commandRegistry.ts:L89-L104](src/commands/commandRegistry.ts) is the single canonical registry; built-in and extension command registrations both go through it; `getCommands()`/`getCommand()`/`hasCommand()` provide the discovery API; Quick Access already consumes it at [src/commands/quickAccess.ts:L254](src/commands/quickAccess.ts).
> - "No `when` clause support" — **PARTIALLY TRUE / overstated.** When-clauses are already supported across all four contribution types: commands ([commandContribution.ts:L106-L140](src/contributions/commandContribution.ts)), menus ([menuContribution.ts:L130, L224](src/contributions/menuContribution.ts)), keybindings ([keybindingContribution.ts:L248](src/contributions/keybindingContribution.ts)), views ([viewContribution.ts:L159-L254](src/contributions/viewContribution.ts)). What is genuinely missing is an orchestrator.
> - "Tool enablement not reflected in availability" — **OUTDATED.** `toolEnablementService` fires `onDidChangeEnablement`; `workbench.ts` L2476-L2500 reacts by calling `removeContributions(toolId)` on all four processors. The mechanism is already coarser than the claim (full deactivation, not just hide).
>
> Slice B reduces to one genuinely missing piece: a `ContributionRegistry` that wraps the four scattered processor calls in `workbench.ts` so the workbench has one entry point (`processContributions(toolDescription)` / `removeContributions(toolId)`) instead of four. This is a tiny refactor (~2 files, ~80 LOC) that preserves all existing behavior. Type validation, when-clause grammar docs, and extended context discovery are explicit non-goals for this slice — they are speculative until a real consumer surfaces.

**Workflow hop it serves:**
[PARALLX_MANIFEST.md §5](docs/PARALLX_MANIFEST.md#5-core-product-workflow): "User asks AI chat about documents → AI uses chat tools → tool results reference workspace." A unified contribution registry gives future surfaces (Slice D bridge replacement, Slice C task-routed workflows) a single integration point.

**Current pain point (audit-corrected):**
- `workbench.ts` calls four processors separately at three different sites (L2302-L2319 process on register, L2469-L2472 remove on deactivate, L2484+ re-process on re-enable). Adding a new contribution type requires editing all three sites. Tests that exercise contribution lifecycle need to mock four services instead of one. This is a maintainability hot-spot, not a functional bug.

**Interaction-model section that defines the target:**
[WORKBENCH_INTERACTION_MODEL.md §2.8 Contribution](docs/architecture/WORKBENCH_INTERACTION_MODEL.md#28-contribution) — single canonical registry that owns all contribution-type processors and presents one interface to the workbench.

**Atlas anchor (verified by audit):**
- Single CommandService (already canonical): [src/commands/commandRegistry.ts:L89-L104](src/commands/commandRegistry.ts)
- Single ToolRegistry with state machine (already canonical): [src/tools/toolRegistry.ts:L28-L33](src/tools/toolRegistry.ts)
- Four separate contribution processors with shared `IContributionProcessor` interface at [src/contributions/contributionTypes.ts:L24-L57](src/contributions/contributionTypes.ts)
- Scattered orchestration sites in [src/workbench/workbench.ts:L2302-L2319, L2469-L2472, L2484+](src/workbench/workbench.ts)

**Files touched** (rescoped — every file the Surgical Executor may modify in this slice):
- `src/contributions/contributionRegistry.ts` *(NEW, ~60 LOC)* — `ContributionRegistry` class that takes the four existing processors in its constructor and exposes `processContributions(toolDescription)` and `removeContributions(toolId)` that fan out to each processor in the order workbench.ts currently does. Errors from one processor are caught and logged (per Landmine 1 of the audit) so one bad contribution cannot block the others.
- `src/contributions/contributionTypes.ts` *(MODIFY, ~15 LOC)* — export `IContributionRegistry` interface alongside the existing `IContributionProcessor` interface. No changes to existing types.
- `src/workbench/workbench.ts` *(MODIFY, ~20 LOC)* — construct `ContributionRegistry` in Phase 3 with the four existing processor instances; replace the three scattered orchestration sites (L2302-L2319, L2469-L2472, L2484+) with single calls into the registry. Existing processor instances and their public methods stay unchanged so any direct caller (tests, future consumers) keeps working.
- `tests/unit/contributionRegistry.test.ts` *(NEW, ~80 LOC)* — verify the registry fans out to all four processors on `processContributions()`, fans out to all four on `removeContributions(toolId)`, and that one processor throwing does not block the others (uses test doubles for the four processors).

**Deferred to later slices (with explicit audit reasons):**
- **Typed command/tool contracts** — DEFERRED. The audit found no current consumer that needs argument/result type generics beyond what `executeCommand<T>(id, ...args)` already provides. Revisit when extension API generics become a real pain point.
- **Contribution payload schema validation** — DEFERRED. Speculative without a current bug report; processors already validate the fields they read. A future slice can add Zod/JSON-Schema if needed.
- **When-clause grammar documentation** — DEFERRED. `IContextKeyServiceLike.contextMatchesRules()` is the live implementation; documenting it is a docs task, not a Slice B code change.
- **Tool-contributed context keys** — DEFERRED to Slice D, where extensions need stable context-key registration.
- **`api.contributions.getSupportedTypes()` discovery API** — DEFERRED. No current call-site; can ship with extension capability work in Slice C.

**Files NOT touched** (anti-list — high-risk neighbors that must remain untouched):
- `src/commands/commandRegistry.ts` — already canonical; do not modify.
- `src/tools/toolRegistry.ts` — state machine already correct; do not modify.
- `src/contributions/commandContribution.ts`, `keybindingContribution.ts`, `menuContribution.ts`, `viewContribution.ts` — the registry wraps them; their internal logic is unchanged.
- `src/tools/toolEnablementService.ts` — the onDidChangeEnablement contract is unchanged; the registry is called from the existing listener.
- `src/api/bridges/commandsBridge.ts` — extension API unchanged.
- Everything in the §3.3 preservation-required list and the Slice A "Files NOT touched" list still applies.

**Characterization tests that must pass BEFORE Slice B:**
- All Slice A tests pass (foundation required).
- Baseline §4 tests: `CommandContractValidation`, `ToolActivationFiltering`, `ContributionVisibilityPredicate`.

**Characterization tests added during Slice B:**
- `tests/unit/commandContractValidation.test.ts` — Verify all commands have typed argument/result.
- `tests/unit/toolActivationFiltering.test.ts` — Verify disabled tools do not appear in tool registry.
- `tests/unit/contributionVisibilityPredicate.test.ts` — Verify menu/command visibility respects `when` clauses.

**Measurement that proves "better":**
- Composability: Extensions can register commands via manifest `when` clause without modifying core code.
- Debuggability: `api.commands.executeCommand(id)` now type-checks the argument and returns typed result.

**Rollback path:**
```bash
git revert <sha-of-slice-b-commit>
```

**Dependency on prior slices:**
Depends on Slice A (SelectionService, ContextKeyRegistry).

**Estimated commit count:**
1 commit.

### Slice C: Capability, Task, Artifact, and Provenance Primitives

> **2026-05-23 final ruling:** Reality audit ([M81_SLICE_C_AUDIT.md](research/M81_SLICE_C_AUDIT.md), commit `a20ceae`) found that 3 of 6 claims were REFUTED/SPECULATIVE and 1 was a manifest violation. After a second pass against the code to refuse further deferrals, each item is now CLOSED or SHIPPED — Slice C is resolved, not deferred.
>
> - **Capability gating — CLOSED (already shipped, 4 layers).** Verified in code: M11 `permissionService.ts` (3-level always/requires-approval/never), M65 `openclawToolPolicy.ts` (readonly/standard/full profile allowlists), M67 `policyDecisionPoint.ts` (consolidated approval gate with command blocklist + autonomy mode + color gate), `electron/webFetchBridge.cjs` (15-condition network chokepoint with DNS preflight, HTTPS enforcement, domain blocklist, body cap, timeout). Nothing further to build.
> - **`TaskService` — CLOSED (no consumer in code).** `grep_search` for `taskService|ITaskService|TaskQueue|backgroundTask` across `src/**/*.ts` returns **zero matches**. Background work is coordinated per-service via cooperative yields (`setTimeout(0)` in `indexingPipeline`, queue+drain+yield in `semanticGraphService`, `CronService`, `HeartbeatRunner`, autonomy feature flags). Manifest [§11](docs/PARALLX_MANIFEST.md#11-non-negotiable-preservation-rules) forbids speculative services. Build the day a measured stall regression appears that cooperative yields cannot solve — not before.
> - **`ArtifactRegistry` — CLOSED (LinkResolverService is the registry).** `grep_search` for `ArtifactRegistry|IArtifact|artifact-registry` returns **zero matches**. The cross-surface URI concern is already served by M66's `LinkResolverService` + `linkContractRegistry`: `parallx://` is a real, actively-used scheme (`parallx://canvas/page/<id>`, `parallx://explorer/file?path=<absPath>`, `parallx://chat/session/<id>`) with the workbench-wide click interceptor at [src/workbench/workbench.ts:L2376-L2397](src/workbench/workbench.ts) routing every parallx:// click through `linkResolver.resolveAndOpen(href)`. Slice D's `canvasLinks.ts` is the canvas surface's contribution to that same registry. An `ArtifactRegistry` would be a parallel-but-redundant abstraction.
> - **`electron/mcpBridge.cjs` MODIFY — CLOSED (redundant with `openclawToolPolicy`).** The MCP capability gate already lives in `src/openclaw/openclawToolPolicy.ts` ahead of the IPC call. Touching `electron/*` would buy nothing.
> - **Artifact provenance (Canvas pages) — SHIPPED.** `IPage` previously had only `createdAt`/`updatedAt`. Migration `013_page_provenance.sql` adds two nullable columns `created_by` and `source_tool`; `canvasTypes.ts` extends `IPage` with `readonly createdBy: string | null` and `readonly sourceTool: string | null`; `canvasDataService.rowToPage()` maps them; `CanvasDataService.createPage()` accepts a new optional `PageProvenance` parameter; the AI chat tool `canvas_create_page` records `created_by='ai-chat', source_tool='canvas_create_page'` on its raw INSERT so AI-authored pages are distinguishable from user-authored ones. Existing pages keep NULL provenance ("origin unknown / not recorded"). 3 new unit tests cover the rowToPage mapping for null/populated/explicit-null cases. Total surface: 1 new migration, 3 modified files (`canvasTypes.ts`, `canvasDataService.ts`, `pageTools.ts`), 1 modified test file (+3 cases). Schema change is purely additive.
>
> **Status:** RESOLVED. 4 items CLOSED in-place (concern handled by existing code) + 1 SHIPPED (provenance). The original scope below is retained as historical context.
>
> **2026-05-24 §22 physicalization.** The four promised test filenames in the "Files touched" list below (`capabilityGating.test.ts`, `taskQueueing.test.ts`, `artifactLinking.test.ts`, `provenanceTracing.test.ts`) have been materialized as guards over the existing closed-in-place surface — not as tests for services that never needed to exist. They pin the audit's invariants so a future refactor cannot silently regrow the abstractions the audit refused:
> - `tests/unit/capabilityGating.test.ts` (commit `00d4ce48`, 13 tests) — exercises all four layers (`permissionService.ALWAYS_REQUIRE_CONFIRMATION`, `isToolDeniedByProfile`, `resolveToolProfile`, `getToolColor` + color gate, `electron/webFetchBridge.cjs` constants present); anti-bitrot guard against `src/services/capabilityService.ts`.
> - `tests/unit/taskQueueing.test.ts` (commit `1253d803`, 3 tests) — recursive `src/` grep guard for forbidden identifiers `TaskService|ITaskService|TaskQueue|IBackgroundTaskQueue`; pins existence of cooperative-yield substrate files (`indexingPipeline.ts`, `semanticGraphService.ts`, `openclawHeartbeatRunner.ts`).
> - `tests/unit/artifactLinking.test.ts` (commit `eec372ee`, 8 tests) — full `LinkResolverService` lifecycle round-trip (mint → parse → register → open → resolveMetadata → dispose → `onDidChangeContracts`); anti-bitrot for `ArtifactRegistry|IArtifactRegistry|IArtifact`.
> - `tests/unit/provenanceTracing.test.ts` (commit `dedfbf36`, 4 tests) — migration `013_page_provenance.sql` shape (additive-only, both columns nullable), end-to-end ALTER TABLE round-trip on `node:sqlite` in-memory, `canvas_create_page` tool stamps `'ai-chat'`/`'canvas_create_page'`, `IPage` carries readonly nullable `createdBy`/`sourceTool`. The 3 `rowToPage` mapping cases (null/populated/explicit-null) ship in `canvasDataService.test.ts`.

(Per WORKBENCH_INTERACTION_MODEL_REVIEW.md §10 recommendation.)

**Workflow hop it serves:**
[PARALLX_MANIFEST.md §5](docs/PARALLX_MANIFEST.md#5-core-product-workflow): "AI creates Canvas pages/artifacts → outputs become durable → can be reopened later."

**Current pain point:**
- Capabilities are implicit; no gate on filesystem/shell/network/secrets access.
- Background work (indexing, autonomy, FTS rebuild) lacks coordination; can conflict with foreground work.
- Artifact provenance (where it came from, which workflow created it) is lost or scattered.

**Interaction-model section:**
[WORKBENCH_INTERACTION_MODEL.md §2.9 Capability, §2.10 Task, §2.11 Artifact, §2.12 Provenance](docs/architecture/WORKBENCH_INTERACTION_MODEL.md#29-capability).

**Atlas anchor:**
- Autonomy: [src/services/autonomyService.ts](src/services/autonomyService.ts) (hardcoded background work)
- MCP bridge: [electron/mcpBridge.cjs](electron/mcpBridge.cjs) (network access not gated)
- Canvas provenance: scattered in Canvas data model

**Files touched:**
- `src/services/capabilityService.ts` (NEW: gate privileged operations)
- `src/services/taskService.ts` (NEW: coordinate background work)
- `src/services/artifactRegistry.ts` (NEW: unify artifact identity)
- `src/services/provenanceService.ts` (NEW: track artifact origins)
- `src/services/autonomyService.ts` (MODIFY: route background work to TaskService)
- `electron/mcpBridge.cjs` (MODIFY: check capabilities before invoking MCP)
- `src/built-in/canvas/canvasDataService.ts` (MODIFY: emit provenance on page creation)
- `tests/unit/capabilityGating.test.ts` (NEW)
- `tests/unit/taskQueueing.test.ts` (NEW)
- `tests/unit/artifactLinking.test.ts` (NEW)
- `tests/unit/provenanceTracing.test.ts` (NEW)

**Characterization tests that must pass BEFORE Slice C:**
- All Slice B tests pass.
- Baseline §4 tests: `CapabilityGating`, `TaskQueueing`, `ArtifactLinking`, `ProvenanceTracing`.

**Characterization tests added during Slice C:**
- `tests/unit/capabilityGating.test.ts` — Verify capability checks prevent unauthorized access.
- `tests/unit/taskQueueing.test.ts` — Verify background tasks queue and don't starve foreground.
- `tests/unit/artifactLinking.test.ts` — Verify artifact identity persists across surfaces.
- `tests/unit/provenanceTracing.test.ts` — Verify artifact provenance recorded correctly.

**Measurement that proves "better":**
- Reliability: Background work (indexing, autonomy, FTS rebuild) does not starve foreground (measure via existing M78 timedDbHandler baseline §2, M13; ensure no regression).
- Debuggability: Artifact provenance enables tracing cross-tool workflows (e.g., file → chat → canvas artifact → source link).

**Rollback path:**
```bash
git revert <sha-of-slice-c-commit>
```

**Dependency on prior slices:**
Depends on Slice B (CommandRegistry, ToolRegistry).

**Estimated commit count:**
1 commit.

### Slice D: Bridge Replacement and Cross-Tool Workflow Refactoring

> **2026-05-23 rescope:** Reality audit ([M81_SLICE_D_AUDIT.md](research/M81_SLICE_D_AUDIT.md), commit `154e9a5`) found that **6 of 7 bridges are already implemented** and all four cross-cutting claims are REFUTED:
> - Bridge 1 (Selection→Chat): `SelectionService` broadcast from Slice A ([src/services/selectionActionDispatcher.ts:L88-L96](src/services/selectionActionDispatcher.ts)).
> - Bridge 2 (Selection→Canvas): superseded by Slice A's `onDidChangeSelection` event.
> - Bridge 3 (Canvas↔Chat URIs): `LinkResolverService` at [src/links/linkResolverService.ts:L1-L200](src/links/linkResolverService.ts) is the centralized resolver; Chat already self-registers its segment at [chat/main.ts:L2718-L2760](src/built-in/chat/main.ts). The only gap is that **Canvas does not self-register its `canvas` segment**.
> - Bridge 4 (Chat↔Explorer): `EditorService.onDidChangeOpenEditors` at [editorService.ts:L20](src/services/editorService.ts) is already consumed by [chatContextAttachments.ts:L69](src/built-in/chat/input/chatContextAttachments.ts).
> - Bridge 5 (Canvas-sidebar↔Editor): [canvasSidebar.ts:L201](src/built-in/canvas/canvasSidebar.ts) already subscribes.
> - Bridge 6 (Recent workspaces): snapshot-only, Workspace owns state (confirmed by Slice A audit; unchanged).
> - Bridge 7 (Link resolution): handled by `LinkResolverService`.
>
> Cross-cutting claims also REFUTED: no central dispatcher exists (architecture is already event-based); `LinkResolverService` exists; `EditorService` events exist; autonomy was refactored to be independent in M60 (chat integrates with autonomy services, not the other way round).
>
> **Slice D shrinks to one structural change plus one E2E verification.** Genuinely-missing pieces:
> 1. Canvas LinkContract registration — Canvas registers its `canvas` segment with a `page` kind handler that opens the page editor, mirroring the Chat segment registration pattern. ~50 LOC, one new file.
> 2. Cross-tool E2E test — exercises the full workflow (Explorer → Editor → Chat selection → Chat creates canvas page via tool → resulting `parallx://canvas/page/<id>` link resolves and opens in Canvas editor → Canvas sidebar reflects open editor → workspace persists across restart).
>
> All preservation-list files (chatDataService.ts, canvasDataService.ts, canvasSidebar.ts internal logic) stay untouched — the audit verified they already do the right thing.

**Workflow hop it serves:**
[PARALLX_MANIFEST.md §5](docs/PARALLX_MANIFEST.md#5-core-product-workflow) full end-to-end: "Open workspace → Explorer → Editor → Chat → Chat references workspace → Canvas → Reopen."

**Current pain point (rescoped — audit-corrected):**
- Canvas is the only built-in surface that does not self-register a link contract with `LinkResolverService`. When chat (or any other surface) wants to produce a `parallx://canvas/page/<id>` link, it can mint the URI but the resolver has no segment handler for `canvas`, so opening the link must fall back to a direct API call (`api.editors.openEditor({ typeId: 'canvas', ... })`). This shape is correct for Chat→Canvas today but blocks any other surface from materializing canvas links.

**Interaction-model section:**
[WORKBENCH_INTERACTION_MODEL.md §4 Cross-Tool Bridge Replacement Plan](docs/architecture/WORKBENCH_INTERACTION_MODEL.md#4-cross-tool-bridge-replacement-plan) (Bridges 1–7).

**Files touched:**
All 7 bridge replacements (from WORKBENCH_INTERACTION_MODEL.md §4):
- Bridge 1 (Selection → Chat): Use SelectionService.onDidChangeSelection (Slice A; no change in Slice D)
- Bridge 2 (Selection → Canvas): Use SelectionService.onDidChangeSelection (Slice A; no change in Slice D)
- Bridge 3 (Canvas pages ↔ Chat context URIs): Replace hardcoded `parallx.canvas:` scheme with LinkResolverService (Slice D new implementation)
- Bridge 4 (Chat ↔ Explorer attachments): Use EditorService.onDidChangeOpenEditors event (Slice D new wiring)
- Bridge 5 (Canvas sidebar ↔ Editor part): Use EditorService event (Slice D new wiring)
- Bridge 6 (Recent workspaces ↔ Workspace): Workspace canonical ownership (Slice A; no change in Slice D)
- Bridge 7 (Link resolution per-feature): Centralize in LinkResolverService with Resource discriminated union (Slice D implementation)

**Files touched (rescoped — exhaustive):**
- `src/built-in/canvas/canvasLinks.ts` *(NEW, ~50 LOC)* — exports an `activateCanvasLinks(context, api, canvasDataService)` function that calls `api.links.register({ segment: 'canvas', kinds: { page: { uriTemplate: 'parallx://canvas/page/<pageId>', open: async (parsed) => api.editors.openEditor({ typeId: 'canvas', title: 'Canvas Page', instanceId: parsed.id }) } } })`. Tracked in `context.subscriptions` for clean disposal.
- `src/built-in/canvas/main.ts` *(MODIFY, ~5 LOC)* — call `activateCanvasLinks(...)` from the canvas extension's `activate(...)` function. No other change.
- `tests/unit/canvasLinks.test.ts` *(NEW, ~80 LOC)* — vitest unit test verifying: (a) `activateCanvasLinks` registers the `canvas` segment via `api.links.register`, (b) a `parallx://canvas/page/<id>` URI parses correctly, (c) calling the registered `open()` handler dispatches an `openEditor` call with `typeId: 'canvas'` and the parsed page id.

**Optional, only if the executor finds a real consumer:**
- `tests/e2e/crossToolWorkflow.spec.ts` *(NEW, ~150 LOC)* — playwright E2E exercising the full Explorer→Editor→Chat→Canvas→Restart loop. **Deferred from the in-scope set** because the unit test above already proves the link-resolution wiring; an E2E requires playwright infrastructure that exceeds the §17 single-commit lifecycle for this slice. The E2E can ship in a follow-up commit once a real consumer requests it.

**Files NOT touched** (preservation-list discipline, confirmed safe by audit):
- `src/links/linkResolverService.ts` — already correct.
- `src/links/parallxUri.ts` — already correct.
- `src/built-in/chat/input/chatContextAttachments.ts` — already subscribes to `onDidChangeOpenEditors`.
- `src/built-in/chat/data/chatDataService.ts` — already on preservation list and already correct.
- `src/built-in/canvas/canvasSidebar.ts` — already subscribes to `onDidChangeOpenEditors`.
- `src/built-in/canvas/canvasDataService.ts` — preservation list; the canvas link handler reads page id but does NOT mutate page state from the link handler.
- `src/services/editorService.ts` — events already exist; per-event granularity (`onDidOpenEditor`/`onDidCloseEditor`) is deferred until a consumer requests it.

**Characterization tests that must pass BEFORE Slice D:**
- All Slice C tests pass.
- Baseline §4 tests: `EditorAttachmentSync`, `CanvasSidebarSync`, `AutonomyLifecycleIndependence`, `ChatToCanvasArtifact`, cross-tool workflow tests.

**Characterization tests added during Slice D:**
- `tests/e2e/editorAttachmentSync.spec.ts` — E2E: open editor → chat attachment context reflects open files.
- `tests/e2e/canvasSidebarSync.spec.ts` — E2E: open editor → canvas sidebar shows relevant pages.
- `tests/e2e/autonomyLifecycleIndependence.spec.ts` — E2E: autonomy runs without Chat being active (TaskService coordination).
- `tests/e2e/chatToCanvasArtifact.spec.ts` — E2E: chat creates artifact → link resolves → artifact opens in Canvas editor.
- `tests/e2e/crossToolWorkflow.spec.ts` — Full workflow: workspace open → Explorer → Editor → Chat → Canvas → Persist → Reopen (no loss).

**Measurement that proves "better":**
- Composability: End-to-end workflow (Baseline §1 H1–H10) all steps complete without hard-coded dispatcher intervention. New surfaces can be added by subscribing to events; no core code changes needed.
- Debuggability: Bridge invocations are explicit subscriptions in code (grep for `.onDidChangeSelection`, `.onDidChangeOpenEditors`); no hidden one-off routes.
- Reliability: Baseline §5 hot paths (M78 timedDbHandler, M78 file-watcher coalescing, M60 indexing yield) remain intact; no regression in startup, save, or query latency.

**Stop-rule triggers:**
- If cross-tool workflow tests (chatToCanvasArtifact, crossToolWorkflow) fail, **stop and debug**. These are the primary verification that M81 is working.
- If autonomy latency regresses (TaskService overhead), **stop and profile**. Autonomy heartbeat must remain on schedule.
- If workspace restore time increases > 10%, **stop and investigate**. Baseline M1/M10 (cold/warm start) must not regress.

**Rollback path:**
```bash
git revert <sha-of-slice-d-commit>
```

This restores the app to pre-Slice-D state, with Slices A–C in place. If full rollback is needed:
```bash
git revert <sha-of-slice-d-commit> <sha-of-slice-c-commit> <sha-of-slice-b-commit> <sha-of-slice-a-commit>
```
Then the app is back at 9b9a243.

**Dependency on prior slices:**
Depends on Slices A, B, C (all primitives and registries in place).

**Estimated commit count:**
1 commit.

---

## 5. Acceptance Criteria

M81 is accepted only if **all of the following conditions are met**. Each condition references the 9 acceptance conditions from [WORKBENCH_INTERACTION_MODEL_REVIEW.md §9](docs/research/WORKBENCH_INTERACTION_MODEL_REVIEW.md#9-acceptance-conditions).

### Condition 1: Every primitive has single-owner statement

**From review §9 criterion 1.**

- Verify: All 13 primitives (Workspace, Resource, Surface, Selection, Context, Command, Tool, Contribution, Capability, Event, Task, Artifact, Provenance) have "What It Owns" and "What It Does NOT Own" sections in [WORKBENCH_INTERACTION_MODEL.md §2](docs/architecture/WORKBENCH_INTERACTION_MODEL.md#2-unified-primitives).
- Evidence: Code search returns no undefined primitive behavior. Example: Workspace owns `setState`/`getState` and folder set (Workspace.folders); does NOT own FileService operations.
- Test anchor: `tests/unit/contextKeyDiscovery.test.ts` verifies ContextService (primitive) owns centralized key registry, not scattered definitions.

### Condition 2: Every cross-tool bridge has documented replacement

**From review §9 criterion 2.**

- Verify: All 7 bridges from [SYSTEM_ATLAS.md §4.1](docs/architecture/SYSTEM_ATLAS.md#41-one-off-bridges-hard-coded-couplings) are listed in [WORKBENCH_INTERACTION_MODEL.md §4 Cross-Tool Bridge Replacement Plan](docs/architecture/WORKBENCH_INTERACTION_MODEL.md#4-cross-tool-bridge-replacement-plan) with replacement mechanism and migration slice.
- Bridges:
  1. Selection → Chat: SelectionService.onDidChangeSelection (Slice A)
  2. Selection → Canvas: SelectionService.onDidChangeSelection (Slice A)
  3. Canvas ↔ Chat URIs: LinkResolverService (Slice D)
  4. Chat ↔ Explorer attachments: EditorService event (Slice D)
  5. Canvas sidebar ↔ Editor: EditorService event (Slice D)
  6. Recent workspaces ↔ Workspace: Workspace canonical (Slice A)
  7. Link resolution: LinkResolverService (Slice D)
- Test anchor: `tests/e2e/crossToolWorkflow.spec.ts` exercises all 7 bridges in one end-to-end flow.

### Condition 3: Every open design question has a decision

**From review §9 criterion 3.**

- Verify: All 10 design questions (Q1–Q10) from [WORKBENCH_INTERACTION_MODEL.md §3](docs/architecture/WORKBENCH_INTERACTION_MODEL.md#3-the-ten-open-design-questions-answered) have Decision + Rationale.
- Example: Q1 "What is the canonical Resource identity?" → Decision: Discriminated union (file | canvas-page | chat-session | ...) with stable IDs.
- Cross-document citations required: Each decision references Atlas, External brief, or Baseline.
- No open-ended design remains after M81 review.

### Condition 4: Every breaking change has a migration path

**From review §9 criterion 4.**

- Verify: 2 breaking changes documented in [WORKBENCH_INTERACTION_MODEL.md §7.3](docs/architecture/WORKBENCH_INTERACTION_MODEL.md#73-explicit-breaking-changes--migration-paths).
- Change 1: SelectionActionDispatcher deprecated. Migration: Shim in M81 Slice A (deprecated annotation); removal in M83 (separate milestone). Compatibility time window: 2 releases.
- Change 2: Workspace.folders type change (string[] → WorkspaceFolder[]). Migration: Automatic conversion on load; export as strings for JSON serialization until migration complete.
- Each change has a test verifying migration path works: `tests/unit/legacyUriResolution.test.ts` (Bridge 7 legacy scheme support), `tests/unit/selectionActionDispatcherShim.test.ts` (old handler dispatch still works via shim).

### Condition 5: Compatibility table covers existing public APIs

**From review §9 criterion 5.**

- Verify: [WORKBENCH_INTERACTION_MODEL.md §7.1 Compatibility Table](docs/architecture/WORKBENCH_INTERACTION_MODEL.md#71-compatibility-table-existing-public-apis--new-primitives) has 9+ rows covering:
  1. `editorService.openEditor()`
  2. `api.commands.executeCommand()`
  3. `SelectionActionDispatcher.registerHandler()`
  4. `workspace.folders` (type change)
  5. Extension manifest schema (optional `when` clause added)
  6. Context keys (scattered → ContextKeyRegistry)
  7. `database:query` IPC (types added)
  8. `workspace.onDidChangeFolders` event (unchanged)
  9. LinkResolver URI schemes (unified)
- Each row shows: Existing API → Proposed change → Migration time window.
- Test anchor: `tests/unit/extensionApiBridgeContract.test.ts` verifies all 9 APIs remain available and backward-compatible.

### Condition 6: No unjustified new primitives

**From review §9 criterion 6.**

- Verify: Exactly 13 primitives, all in [PARALLX_MANIFEST.md §10 Core Concepts](docs/PARALLX_MANIFEST.md#10-unified-workbench-language) list. No additional primitives without 3+ features using them.
- Added services (LinkResolverService, ResourceRegistry, ContextKeyRegistry) are utilities, NOT primitives. Clarified in documentation.
- Each primitive has existing Parallx implementation to be enhanced OR clear migration path from current scattered code.
- Example: SelectionService replaces SelectionActionDispatcher (existing code). Resource is new abstraction but has migration from current file paths + canvas UUIDs + chat session IDs.

### Condition 7: All 9 review conditions incorporated into M81 design

**From review §9 requirements.**

- Condition 1–6: Documented in this milestone section 5.
- Condition 7: Review §8 section-level findings (14 revisions) are incorporated:
  - §1 preservation commitment added (existing workflows remain achievable)
  - §2 "What It Does NOT Own" sections complete for all primitives
  - §3 Q7 (Autonomy lifecycle) clarified; Q10 (migration test pattern) clarified
  - §4 transition notes for old handler code added
  - §5 delta vs. full serialization clarified
  - §6 Phase 5 target (tool activation) measured or removed; Extension Activation phase language clarified
  - §7 shim implementation reference provided; deprecation windows precise ("M81 → M83")
  - §8 storage abstraction explicit in Out of Scope list
  - §9 primitive implementation anchor criterion strengthened
  - §10 cycle detection tool specified; context key centralization clarified

### Condition 8: Per-slice characterization tests defined and passing

**From review §9 acceptance condition on phase gates.**

- **Slice A gates:** Before Slice A merge:
  - `npm run test:unit` all pass
  - `tests/unit/legacyUriResolution.test.ts` passes
  - `tests/unit/workspaceFolderCanonicalOwnership.test.ts` passes
  - `tests/unit/selectionEventRouting.test.ts` passes
  - `tests/unit/surfaceFocus.test.ts` passes
  - `tests/unit/contextKeyDiscovery.test.ts` passes
  - No regression in Baseline §5 hot paths (FTS rebuild, file-watcher coalescing, embedding yield)

- **Slice B gates:** Before Slice B merge (requires Slice A):
  - All Slice A tests still pass
  - `tests/unit/commandContractValidation.test.ts` passes
  - `tests/unit/toolActivationFiltering.test.ts` passes
  - `tests/unit/contributionVisibilityPredicate.test.ts` passes

- **Slice C gates:** Before Slice C merge (requires Slices A, B):
  - All Slices A, B tests still pass
  - `tests/unit/capabilityGating.test.ts` passes
  - `tests/unit/taskQueueing.test.ts` passes
  - `tests/unit/artifactLinking.test.ts` passes
  - `tests/unit/provenanceTracing.test.ts` passes
  - Baseline §2 IPC latency (M11 p50, p95, p99) does not regress

- **Slice D gates:** Before Slice D merge (requires Slices A, B, C):
  - All Slices A, B, C tests still pass
  - `tests/e2e/editorAttachmentSync.spec.ts` passes
  - `tests/e2e/canvasSidebarSync.spec.ts` passes
  - `tests/e2e/autonomyLifecycleIndependence.spec.ts` passes
  - `tests/e2e/chatToCanvasArtifact.spec.ts` passes
  - `tests/e2e/crossToolWorkflow.spec.ts` passes (full end-to-end)
  - Baseline §2 workspace restore time (M1, M10) does not regress > 10%

### Condition 9: Baseline measurements established before Slice A

**From review §9 acceptance condition on baseline.**

- [Baseline §3 Missing-Measurement Inventory](docs/research/baselines/workbench-baseline.md#3-missing-measurement-inventory) lists 22 metrics (M1–M22).
- Before Slice A starts, these baselines must be established:
  - **M1:** Workspace cold-start time (target < 5s on baseline workspace)
  - **M7:** Canvas page load time (per page size: 10, 100, 1000 blocks)
  - **M18:** Per-tool activation time (establish current floor before TaskService optimization)
  - **M13:** IPC latency distribution (p50, p95, p99 via timedDbHandler)
  - **M21:** fs.watch pickup latency (diagnostic from E2E tests)
  - **M10:** Workspace restore time (editors + layout + chat sessions)

These can run in parallel with review (no blocking); they establish the gate conditions for each slice's merge.

---

## 6. Stop Rules

M81 stops if any of these conditions are triggered:

### Planning Phase Stop Rules

- **User acceptance gate:** M81 design (this doc) remains in `planning` status until user explicitly approves or requests revisions. No slice implementation begins without approval.
- **Manifest acceptance gate:** If the Conductor has not accepted the redesign kickoff (SYSTEMS_REDESIGN_KICKOFF.md), M81 remains blocked.
- **Review incomplete:** If Fitness and Review Agent has not completed WORKBENCH_INTERACTION_MODEL_REVIEW.md §9 acceptance conditions review, M81 cannot proceed.

### Slice-Specific Stop Rules

- **Pre-flight baseline:** A slice pre-flight characterization test must pass (§5 Acceptance Criteria, §4 Slice subsections). If pre-flight fails, the slice does NOT start.
- **Preservation regression:** Any characterization test from Baseline §4 that passes on main fails on the branch → immediate stop and debug. Slice is rolled back.
- **Hot-path regression:** If any metric from Baseline §5 (FTS rebuild chunking, WAL pragmas, file-watcher coalescing, embedding worker flag, indexing yield) regresses, the slice is rolled back. No slice proceeds with degraded performance.
- **No atlas traceability:** A code change in a slice without an anchor in SYSTEM_ATLAS.md or WORKBENCH_INTERACTION_MODEL.md → code review must reject it. No "opportunistic refactoring" allowed.
- **Extension API breakage:** A slice changes an extension API without a documented migration path → stop and revise.
- **Recursive dependency:** A slice introduces a circular dependency between services (detected by build-time analysis) → stop and refactor.

### Branch Discipline Stop Rules

- **Master or checkpoint modification:** Any attempt to edit `master` or `checkpoint-pre-systems-redesign-2026-05-23` without explicit per-action user approval → rejected.
- **--no-verify on commits:** Using `git commit --no-verify` is forbidden. All commits must pass pre-commit hooks (type check, lint).
- **History rewrite:** Attempt to rebase, amend, or force-push commits on `systems-redesign-planning` without user approval → rejected.

### Verification Stop Rules

- **`npm run build` fails:** Type errors or bundler failures → stop. Fix required before merge.
- **`npm run test:unit` fails:** Unit test failures on the branch → stop. Debug or rollback required.
- **`npm run test:e2e` flaky:** E2E tests fail intermittently → investigate. Flaky tests must be fixed or marked as known issues; unreliable tests do not gate acceptance.
- **Characterization test missing:** A slice touches code without a corresponding characterization test from Baseline §4 → code review rejects it.

### Acceptance Stop Rules

- **Review decision is "revise" or "rollback":** If Fitness and Review Agent returns "revise" (significant changes required) or "rollback" (slice should be undone), the slice does not merge. Only "keep" decision allows merge.
- **User rejection:** User asks to stop or revise at any milestone step → work stops until direction received.

---

## 7. Rollback Plan

M81 rollback is sequential. Each slice can be rolled back independently or all together.

### Slice-Level Rollback

**Slice A:**
```bash
git revert <sha-of-slice-a-commit>
```

Result: App returns to state before SelectionService, Workspace canonical ownership, ContextKeyRegistry introduced. SelectionActionDispatcher, scattered context keys, RecentWorkspaces dual update all restored. All M64–M80 tests must pass.

**Slice B (depends on Slice A):**
```bash
git revert <sha-of-slice-b-commit>
```

Result: Command and Tool registry changes reverted. CommandRegistry remains without typed contract; contributions remain without `when` support. Slice A still in place.

**Slice C (depends on Slice B):**
```bash
git revert <sha-of-slice-c-commit>
```

Result: Capability, Task, Artifact, Provenance primitives reverted. Autonomy remains independent; background work coordination removed. Slices A–B still in place.

**Slice D (depends on Slice C):**
```bash
git revert <sha-of-slice-d-commit>
```

Result: Bridge replacement (Bridges 3, 4, 5, 7) reverted. Hard-coded dispatchers restored. Slices A–C still in place; cross-tool workflows work via old bridges.

### Full Rollback

If all slices are rejected or fail:
```bash
git revert <sha-of-slice-d> <sha-of-slice-c> <sha-of-slice-b> <sha-of-slice-a>
```

This returns the repo to commit 9b9a243 (checkpoint-pre-systems-redesign-2026-05-23). All M64–M80 tests pass. `master` is untouched. No data loss.

### Per-Slice Rollback State

| After rollback | State | Workflows preserved |
|---|---|---|
| Slice A rolled back | App ≡ 9b9a243 | All existing workflows (Explorer → Editor → Chat → Canvas unchanged) |
| Slices B reverted | Slices A in place; Command registry without types | Selection event routing (Slice A) active; Command discovery typed (lost if B reverted) |
| Slices C reverted | Slices A–B in place; no Capability/Task/Artifact | Unified primitives (A–B) active; background work (autonomy, indexing) reverts to original coordination (independent) |
| All reverted | App ≡ 9b9a243 | No M81 changes; all M64–M80 remain |

### User-Initiated Rollback

If user requests rollback at any point:
1. Git and Release Steward executes the revert command (slice-specific or full).
2. User is notified of restored state.
3. Conductor archives M81 or updates status to `superseded` if a new direction is taken.

---

## 8. Verification Contract

Every implementation step in M81 follows this verification protocol. **All verification must pass before a commit is merged.**

### Required Verification Commands

From [PARALLX_MANIFEST.md §22](docs/PARALLX_MANIFEST.md#22-verification-and-bug-prevention-contract):

| Command | What it verifies | Required before merge | Typical runtime |
|---|---|---|---|
| `npm run build` | TypeScript compilation; no type errors; bundler output | Every commit | ~30–60s |
| `npm run test:unit` | Unit test assertions via Vitest; single-file logic | Every commit | ~60–120s |
| `npm run test:e2e` | Cross-feature workflows in real Electron; file I/O; multi-editor; chat + canvas; persistence | Slices A, D before merge; optional for B, C | ~10–30 min |
| `npm run test:ai-eval` | Chat quality + turn latency against local LLM; multi-turn conversations | Slice D only (touches chat/autonomy); skip for A–C (`[ai-eval: skip]`) | ~30–60 min |
| `npm run dev` | App launches; no crashes; basic UI interactivity; workspace open | Manual verification as needed | ~5s to interactive shell |

### Verification Gates

**Before Slice A starts:**
- [ ] Baseline measurements (M1, M7, M13, M18, M21) established and recorded in Baseline §2 table
- [ ] All M64–M80 tests passing (characterization baseline clean)
- [ ] Workspace state serialization round-trip test passes (`workspaceStateSerialization.test.ts`)
- [ ] Explorer tree population latency < 200ms (`explorerTreeRender.test.ts`)
- [ ] File watcher coalesce window verified 50ms (`fileWatcherCoalesce.test.ts`)

**Before Slice A merge:**
- [ ] `npm run build` passes (type-check clean)
- [ ] `npm run test:unit` passes (all unit tests, including new Slice A tests)
- [ ] New tests in Slice A (`selectionEventRouting.test.ts`, `workspaceFolderCanonicalOwnership.test.ts`, `contextKeyDiscovery.test.ts`) all pass
- [ ] `npm run test:e2e` passes (preserve Explorer → Editor → Chat → Canvas workflows)
- [ ] Baseline §5 hot paths verified (no regression in FTS rebuild, coalescing, embedding yield, indexing yield)
- [ ] Git history: 1 commit, clear purpose, rollback note in body
- [ ] Code review: every change has atlas anchor; shim backward-compatibility verified; no opportunistic refactoring

**Before Slice B merge:**
- [ ] All Slice A verification repeated (gates still pass)
- [ ] `npm run build` passes
- [ ] `npm run test:unit` passes (including new B tests)
- [ ] New tests in Slice B (`commandContractValidation.test.ts`, `toolActivationFiltering.test.ts`, `contributionVisibilityPredicate.test.ts`) all pass
- [ ] Extension API compatibility verified: `extensionApiBridgeContract.test.ts` passes

**Before Slice C merge:**
- [ ] All Slices A–B verification repeated
- [ ] `npm run build` passes
- [ ] `npm run test:unit` passes (including new C tests)
- [ ] New tests in Slice C (`capabilityGating.test.ts`, `taskQueueing.test.ts`, `artifactLinking.test.ts`, `provenanceTracing.test.ts`) all pass
- [ ] IPC latency baseline (M13) p50/p95/p99 no regression (use timedDbHandler from M78; verify in dev logs or CI)
- [ ] Autonomy still runs on schedule (background work isolation verified)

**Before Slice D merge:**
- [ ] All Slices A–C verification repeated
- [ ] `npm run build` passes
- [ ] `npm run test:unit` passes
- [ ] `npm run test:e2e` passes (including new D E2E tests)
- [ ] New E2E tests in Slice D (`editorAttachmentSync.spec.ts`, `canvasSidebarSync.spec.ts`, `autonomyLifecycleIndependence.spec.ts`, `chatToCanvasArtifact.spec.ts`, `crossToolWorkflow.spec.ts`) all pass
- [ ] Full workflow end-to-end: Workspace open → Explorer → Editor → Chat → Canvas → Persist → Reopen (no loss, all 7 bridges working)
- [ ] Baseline §2 metrics (M1, M10, M13, M21) no regression > 10%
- [ ] `npm run test:ai-eval` passes (Slice D touches chat/autonomy; this is required)

### Regression Prevention Criteria

If a verification fails, the slice **does NOT merge** until:
- Root cause is identified and fixed, OR
- Regression is accepted as a documented tradeoff (recorded in commit body and accepted by user), OR
- The entire slice is rolled back.

**Example:** If `npm run test:e2e` shows chat turn latency increased 20%, this is an unacceptable regression (Baseline §1 H7 must not degrade). Slice D is either fixed to restore latency or rolled back.

### Manual Verification Script (Slice A Example)

If automation is not yet feasible, manual verification for Slice A:

1. Launch `npm run dev` on branch (should be interactive < 5s)
2. Open a workspace (Workspace open event fires; baseline M1 time is recorded)
3. In Explorer, select a file (SelectionService emits `onDidChangeSelection` event; can verify in devtools console)
4. Click "Add to Chat" (Chat attachment context resolves; message shows file reference)
5. Verify file name and path in chat input are correct
6. Close editor; select another file (Canvas sidebar updates; reflects new selection)
7. Restart app (Workspace restores; layout and editor state preserved)
8. All 4 steps work without errors in console

---

## 9. Hand-Off to Surgical Executor

M81 is handed to the Surgical Executor Agent only after user acceptance and all pre-flight gates pass.

### Activation Trigger

When Conductor signals "M81 accepted, begin Slice A," the Surgical Executor Agent is activated with:

**Input artifact:** This milestone document (`docs/Parallx_Milestone_81.md`)

**Execution scope:** One slice per execution cycle:
1. **Slice A cycle:** `feat(workbench): introduce SelectionService, Resource, Workspace canonical ownership, ContextKeyRegistry`
2. **Slice B cycle** (after A review): `feat(workbench): add Command and Tool registry types, Contribution support`
3. **Slice C cycle** (after B review): `feat(workbench): introduce Capability, Task, Artifact, Provenance primitives`
4. **Slice D cycle** (after C review): `feat(workbench): replace cross-tool bridges with event-driven routing`

### Per-Slice Prompt Template (for Conductor → Executor)

The Conductor passes this template-instantiated prompt to the Surgical Executor for each slice:

```md
## Surgical Executor Slice Execution Brief

**Milestone:** M81 / SR-1: Workbench Unification

**Slice:** [A|B|C|D] — [slice name]

**Authority:** Milestone doc §4.Slice [X]: [workflow hop], [atlas anchor], [files touched], [files NOT touched]

**Inputs:**
- Interaction model: docs/architecture/WORKBENCH_INTERACTION_MODEL.md §[X.Y]
- Atlas: docs/architecture/SYSTEM_ATLAS.md §[entries]
- Baseline: docs/research/baselines/workbench-baseline.md §[entries]
- Characterization tests: [list from §4.Slice X]

**Output:**
- 1 commit: `feat(workbench): [slice-name]`
- All files in §4.Slice X "Files touched" list (may be new or modified)
- No files from §4.Slice X "Files NOT touched" list modified
- All characterization tests passing
- Rollback note in commit body (git revert sha)

**Verification:**
- `npm run build` passes (type check clean)
- `npm run test:unit` passes (new tests included)
- `npm run test:e2e` passes (if required for slice)
- No regression in Baseline §5 hot paths
- Code review checklist (atlas anchor for every change; shim backward-compatibility; no opportunistic refactoring)

**Stop conditions:**
- Pre-flight characterization test fails → do not start
- Verification fails → stop and debug or rollback
- Changes outside slice scope detected → stop and revise

**Rollback:**
```bash
git revert <commit-sha>
```

**Gate to next slice:** Slice merge requires review approval and zero regressions.
```

### Per-Slice Review Gate

After the Surgical Executor commits a slice, the Fitness and Review Agent reviews:

**Review checklist:**
1. **Preservation:** All preservation checks pass (M64–M80 tests, cross-tool workflows, data integrity).
2. **Regression:** Baseline metrics (§5 hot paths, Baseline §2 existing numbers) show no degradation.
3. **Correctness:** Characterization tests for the slice (§4.Slice X) all pass.
4. **Overengineering:** No unnecessary abstractions or premature generalization.
5. **Debuggability:** Logs, traces, ownership are clearer than before.

**Review decision:**
- **Keep:** Slice is correct and meets acceptance criteria. Merge approved.
- **Revise:** Specific issues found; executor addresses and resubmits.
- **Rollback:** Fundamental problem; slice should be undone. Revert commit.

Decision documented in GitHub comment or review artifact.

### Conductor Decision on Rollback or Continue

After review, Conductor decides:
- **Continue to next slice:** If "Keep" decision and user approves, move to next slice.
- **Stop for investigation:** If "Revise", work with executor to fix and resubmit.
- **Rollback and end:** If "Rollback" or user requests stop, execute rollback and update M81 status to `superseded` or `partial`.

---

## 10. Provenance

This milestone is traceable to source artifacts and decisions.

### Source Artifacts (read in order, all committed to `systems-redesign-planning`):

1. **PARALLX_MANIFEST.md** (manifest of first redesign agent) — defines product goal, scope, branches, agents, proof gates. Commit: `a9c6e17` and earlier.
   - §5 Core Product Workflow (defines H1–H10 hops)
   - §11 Non-Negotiable Preservation Rules
   - §12 Definition of Better
   - §17 Milestone Document Lifecycle (shape of this doc)
   - §20 Commit Authority Protocol
   - §22 Verification and Bug Prevention Contract

2. **SYSTEMS_REDESIGN_KICKOFF.md** (first agent handoff) — accepted redesign direction. Commit: `ea6e540` (approx).
   - §5 Primary End-To-End Workflow (same as Manifest §5)
   - §13 Sequential Handoff Plan (agents assigned, outputs defined)
   - §19 Decisions Needed From User (user approved this kickoff)

3. **SYSTEM_ATLAS.md** (System Atlas Cartographer output) — current state map with code anchors. Commit: `d684184`.
   - §1 Entry Points for Primary Workflow (6 entry points, L106–L750 + supporting code)
   - §2 System Ownership Table (15 systems, persistent state, events, IPC)
   - §3 Primary Workflow Map (3.1–3.6 detailed flow)
   - §4.1 One-Off Bridges (7 bridges hard-coded today)
   - §4.2 Duplicate-Contract Inventory (7 state domains with dual owners)

4. **WORKBENCH_EXTERNAL_ARCHITECTURE_RESEARCH_BRIEF.md** (Research Agent output) — external patterns evaluated. Commit: date TBD.
   - VS Code contribution points, context keys, activation, extension API.
   - Eclipse and IntelliJ patterns.
   - Applicability to Parallx; overengineering risks identified.

5. **workbench-baseline.md** (Baseline and Metrics Agent output) — current measurements and missing instrumentation. Commit: `acd1ead`.
   - §1 Primary Workflow Decomposition (H1–H16 hops with code anchors)
   - §2 Current Baseline Numbers (11 metrics with sources)
   - §3 Missing-Measurement Inventory (22 metrics to instrument: M1–M22)
   - §4 Proposed Characterization Tests (~20 tests for preservation)
   - §5 Performance Hot Paths Already Identified (M78 optimizations to preserve)
   - §22 Verification Commands

6. **WORKBENCH_INTERACTION_MODEL.md** (Unified Workbench Interaction Agent output) — proposed unified language. Commit: `01ad9c1`.
   - §2 Unified Primitives (13 primitives with definition, current impl, proposed shape, ownership)
   - §3 Ten Open Design Questions (Q1–Q10 answered with decision + rationale)
   - §4 Cross-Tool Bridge Replacement Plan (all 7 bridges, replacement mechanism, migration slice)
   - §5 Duplicate-Contract Resolution (7 state domains, single owner per domain)
   - §6 Lifecycle and Activation Model (6 phases with explicit phasing)
   - §7 Compatibility and Migration Strategy (9-row compatibility table, breaking changes, migration windows)
   - §9 Acceptance Criteria (10-item checklist for design completeness)
   - §10 Risks and Anti-Patterns (identified 10+ risks with mitigations)

7. **WORKBENCH_INTERACTION_MODEL_REVIEW.md** (Fitness and Review Agent output) — independent review with APPROVE verdict. Commit: `f63e2e9`.
   - §1 Verdict: APPROVE — proceed to M81 milestone authoring.
   - §2 Compliance Checks (5 mandatory checks, all pass; 1 acceptable gap identified)
   - §8 Section-Level Findings (14 revisions to incorporate; all structural, not block)
   - §9 Acceptance Conditions (9 conditions, all checkable before merge)
   - §10 Slice Recommendation (A, B, C, D sequence with safest-first + riskiest-later guidance)

8. **MILESTONE_DOC_TRIAGE.md** (Milestone and Documentation Steward output) — current milestone status. Commit: `d684184`.
   - Triage table: M64–M80 labeled by evidence
   - Risk flags: M67/M80 coordination, M68/M76 dependency, M72 gate, M79 ambiguity
   - Adjacency to M81: what gets carried forward vs. superseded vs. untouched

9. **BRANCH_GOVERNANCE.md** (Git and Release Steward output) — branch discipline rules. Commit: `7a3d4e2` (approx).
   - §1 Ref Inventory (master/origin/checkpoint/systems-redesign-planning state)
   - §2 Branch Topology (linear history maintained)
   - §3–5 Rules, Commit Plan, Rollback Paths

### Decisions Log (from §19 of kickoff)

The user accepted:
1. Product goal (Manifest §1): "Make Parallx more reliable, coherent, debuggable, performant, maintainable as unified workbench."
2. In-scope systems (Manifest §3, Kickoff §3).
3. Out-of-scope systems (Manifest §4, Kickoff §4).
4. Primary workflow target (Manifest §5 / Kickoff §5 / Baseline §1).
5. Agent roster and sequential handoff (Manifest §13–14 / Kickoff §7–9).
6. First proof gates before implementation (Manifest §22 / Kickoff §17).

### Commit Lineage (from Kickoff to M81 Draft)

All commits on `systems-redesign-planning`, no rewrites, zero deletions:

| Commit SHA | Type | Message | Artifact | Content |
|---|---|---|---|---|
| `9b9a243` | baseline | (master / checkpoint) | — | Current app |
| `a9c6e17` | docs | `docs: add systems redesign kickoff and first-gen agent cards` | PARALLX_MANIFEST.md (updated), SYSTEMS_REDESIGN_KICKOFF.md (new), 9 agent cards | Kickoff package |
| `d684184` | docs | `docs: add system atlas and milestone triage` | SYSTEM_ATLAS.md (new), MILESTONE_DOC_TRIAGE.md (new) | Atlas + triage |
| `acd1ead` | docs | `docs: add workbench baseline scorecard` | workbench-baseline.md (new) | Baseline metrics + missing instrumentation |
| `01ad9c1` | docs | `docs: add workbench interaction model` | WORKBENCH_INTERACTION_MODEL.md (new) | Proposed unified language |
| `f63e2e9` | docs | `docs: add workbench interaction model review (APPROVE verdict)` | WORKBENCH_INTERACTION_MODEL_REVIEW.md (new) | Independent review |
| (now) | docs | `docs: add M81 milestone (SR-1)` | Parallx_Milestone_81.md (new) | This document |

No app code on this branch yet. Linearity preserved: `git rev-list --left-right --count master...HEAD` → `0    <ahead>` (all ahead commits are docs-only and authored in order).

---

## 11. Next Steps After M81 Acceptance

Once user approves M81 status as `active`:

1. **C0.3 Commit:** Label M81 status frontmatter: `Status: active`.
2. **Conductor activates Surgical Executor:** Pass Slice A brief (§9).
3. **Slice A execution cycle:**
   - Executor implements SelectionService, Workspace canonical ownership, ContextKeyRegistry, Resource registry, migration shims.
   - Pre-flight characterization tests pass (§4.Slice A).
   - Executor submits 1 commit with rollback note.
   - Fitness and Review Agent reviews (keep / revise / rollback).
   - If "keep": Conductor approves merge to `systems-redesign-planning`.
4. **Slice B–D follow the same cycle** (sequential, each depends on prior passing review).
5. **After all slices pass review:** Git and Release Steward evaluates merge-readiness to `master` (per Manifest §25 merge-readiness gate: all slices must pass, consolidation milestone with before/after evidence required, user approval required).

---

## 12. Known Unknowns & Deferred Questions

To avoid surprise mid-execution, these questions are identified but deferred:

1. **Embedding worker flag current state** (Baseline §5): Verify B3 fix is active and measurable. If not yet shipped, prioritize before Slice A (blocks latency baseline).
2. **Autonomy heartbeat timing** (Baseline §2): Current heartbeat frequency not specified in code. Measure before Slice C (TaskService must preserve).
3. **Chat session restore O(N*M) issue** (Baseline §3 H11, Future_Improvements.md): If current is slow, Slice D TaskService may or may not help. Measure before claiming improvement.
4. **Canvas page save payload** (Baseline §5): Investigate whether saves are already incremental or full serialization. Impacts M81 artifact handling.
5. **Extension API usage in production** (to confirm WORKBENCH_INTERACTION_MODEL.md §7.1 compatibility table is sufficient): User provides list of shipped extensions using SelectionActionDispatcher or similar APIs; we verify shim covers them all.

These will be resolved during execution; they do NOT block M81 kickoff.

---

## Summary

**M81 / SR-1** is the first redesign milestone, introducing unified primitives (Resource, Workspace, SelectionService, ContextService, SurfaceRegistry) and event-driven routing to replace hard-coded bridges. It honors all preservation rules, establishes baselines, and gates later slices. The milestone is broken into 4 slices (A–D), each with explicit scope, characterization tests, stop rules, and rollback paths. User acceptance of this document transitions M81 to `active` and triggers Slice A execution.
