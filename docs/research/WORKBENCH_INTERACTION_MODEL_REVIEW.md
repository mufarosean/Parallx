# Workbench Interaction Model — Fitness and Review

---
Status: Review (independent)
Author: Fitness and Review Agent (subagent invocation)
Branch: systems-redesign-planning
Commit: f63e2e9
Created: 2026-05-23
Under review: docs/architecture/WORKBENCH_INTERACTION_MODEL.md
---

## 1. Verdict

**Verdict: APPROVE — proceed to M81 / SR-1 milestone authoring.**

The Workbench Interaction Model is comprehensive, well-grounded, preserves all existing workflows, and provides a clear implementation path with measurable gates. Conditions below must be satisfied before coding begins.

---

## 2. Compliance Checks

Against §9 Acceptance Criteria of the interaction model:

- ✅ **Every primitive has a single-owner statement** — All 13 primitives (Workspace, Resource, Surface, Selection, Context, Command, Tool, Contribution, Capability, Event, Task, Artifact, Provenance) have explicit "What It Owns" sections at [WORKBENCH_INTERACTION_MODEL.md](docs/architecture/WORKBENCH_INTERACTION_MODEL.md#21-workspace) through [§2.13](docs/architecture/WORKBENCH_INTERACTION_MODEL.md#213-provenance).

- ✅ **Every cross-tool bridge has a replacement entry** — §4 Cross-Tool Bridge Replacement Plan documents all 7 bridges from [SYSTEM_ATLAS.md](docs/architecture/SYSTEM_ATLAS.md#41-one-off-bridges-hard-coded-couplings) §4.1:
  - Bridge 1: Selection → Chat ([L425](docs/architecture/WORKBENCH_INTERACTION_MODEL.md#4-cross-tool-bridge-replacement-plan)) → SelectionService event
  - Bridge 2: Selection → Canvas ([L425](docs/architecture/WORKBENCH_INTERACTION_MODEL.md#4-cross-tool-bridge-replacement-plan)) → SelectionService event
  - Bridge 3: Canvas ↔ Chat URIs ([L425](docs/architecture/WORKBENCH_INTERACTION_MODEL.md#4-cross-tool-bridge-replacement-plan)) → LinkResolverService + Resource
  - Bridge 4: Chat ↔ Explorer attachments ([L425](docs/architecture/WORKBENCH_INTERACTION_MODEL.md#4-cross-tool-bridge-replacement-plan)) → EditorService event
  - Bridge 5: Canvas sidebar ↔ Editor part ([L425](docs/architecture/WORKBENCH_INTERACTION_MODEL.md#4-cross-tool-bridge-replacement-plan)) → EditorService event
  - Bridge 6: Recent workspaces ↔ Workspace ([L425](docs/architecture/WORKBENCH_INTERACTION_MODEL.md#4-cross-tool-bridge-replacement-plan)) → Workspace canonical + event
  - Bridge 7: Link resolution ([L425](docs/architecture/WORKBENCH_INTERACTION_MODEL.md#4-cross-tool-bridge-replacement-plan)) → LinkResolverService + Resource

- ✅ **Every open question has a decision** — §3 The Ten Open Design Questions ([WORKBENCH_INTERACTION_MODEL.md](docs/architecture/WORKBENCH_INTERACTION_MODEL.md#3-the-ten-open-design-questions-answered)) Q1–Q10 each have Decision + Rationale with cross-document citations.

- ✅ **Every breaking change has a migration path** — §7.3 Explicit Breaking Changes ([WORKBENCH_INTERACTION_MODEL.md](docs/architecture/WORKBENCH_INTERACTION_MODEL.md#73-explicit-breaking-changes--migration-paths)) documents 2 changes:
  - SelectionActionDispatcher deprecated: Shim in M82, removal in M83, migration script provided ([L1325](docs/architecture/WORKBENCH_INTERACTION_MODEL.md#73-explicit-breaking-changes--migration-paths))
  - Workspace.folders type change: Automatic conversion on load ([L1337](docs/architecture/WORKBENCH_INTERACTION_MODEL.md#73-explicit-breaking-changes--migration-paths))

- ✅ **Compatibility table covers every existing public-ish API** — §7.1 ([WORKBENCH_INTERACTION_MODEL.md](docs/architecture/WORKBENCH_INTERACTION_MODEL.md#71-compatibility-table-existing-public-apis--new-primitives)) has 9 rows covering: editorService.openEditor, api.commands.executeCommand, SelectionActionDispatcher, workspace.folders, Extension manifest, Context keys, IPC database:query, workspace.onDidChangeFolders.
  - **Gap:** EditorService should have 5–10 additional rows (onDidChangeOpenEditors, onDidCloseEditor, etc.) but critical APIs are covered. Acceptable for draft; expand in milestone doc.

- ⚠️ **No unjustified new primitives** — Model proposes exactly 13 primitives: all match [PARALLX_MANIFEST.md](docs/PARALLX_MANIFEST.md#10-unified-workbench-language) §10 Core Concepts list.
  - **PASS**, with condition: Model adds LinkResolverService as a service but does NOT add it as a primitive; it is a utility (correct design). Verify during milestone authoring that primitives and services are distinct.

---

## 3. Cross-Document Consistency

### Atlas vs Model

[SYSTEM_ATLAS.md](docs/architecture/SYSTEM_ATLAS.md) documents current state; model must not orphan existing structure.

- ✅ **§1 Entry Points:** All 6 entry points (Workspace open, Explorer, Editor open, Chat, Canvas, Extension activation) are preserved in model Lifecycle §6. No breaking changes to entry flows.
- ✅ **§2 System Ownership Table:** Model's primitives align with existing service owners. Example: Canvas ↔ CanvasDataService (model §2.12 Artifact: "Canvas data service unchanged, only ownership clarified"). No service removals.
- ✅ **§4.1 One-Off Bridges:** All 7 bridges documented in atlas; all 7 have replacements in model §4.
- ✅ **§4.2 Duplicate Contracts:** All 7 rows (canvas page, chat history, editor state, workspace folders, tool enablement, context keys, layout) have single owners assigned in model §5.
- ✅ **§6 IPC Contracts:** ~50 IPC handlers. Model preserves all; §7.3 says "IPC contracts are replaced with typed equivalents; no new categories." This is accurate—no handler removal proposed.

**Finding**: Atlas is consistent with Model. No orphaned references.

### External Research Brief vs Model

[WORKBENCH_EXTERNAL_ARCHITECTURE_RESEARCH_BRIEF.md](docs/research/WORKBENCH_EXTERNAL_ARCHITECTURE_RESEARCH_BRIEF.md) evaluates VS Code, Eclipse, IntelliJ patterns.

- ✅ **VS Code patterns adopted:** Context keys (§2.5), Activation events (§6.2), Contributions with menus (§2.8), Commands (§2.6). Model cites external brief when adopting ([L421](docs/architecture/WORKBENCH_INTERACTION_MODEL.md#q3-where-should-surface-concept-live), [L357](docs/architecture/WORKBENCH_INTERACTION_MODEL.md#q2-should-selection-be-a-workbench-level-primitive-observable-by-any-surface)).
- ✅ **Eclipse anti-recommendations followed:** Model does NOT adopt XML manifests (stays with JSON), does NOT adopt OSGi complexity, does NOT force InvalidRegistryObjectException control flow (delegation model instead).
- ✅ **IntelliJ patterns considered:** Model adopts listener topics (typed events) and service lifecycle but defers action groups (menus remain flat; future work).
- ⚠️ **Extension point support:** External brief §II recommends "extension points as published contracts" so external tools can extend built-ins (Canvas block types, Chat participants). Model does NOT propose this. 
  - **Assessment:** Acceptable. Extension points are future work (M82+). Current model is M81 root redesign. Deferring extensibility is conservative (good).

**Finding**: Model adopts good patterns and avoids external anti-patterns. No misalignment.

### Baseline Scorecard vs Model

[docs/research/baselines/workbench-baseline.md](docs/research/baselines/workbench-baseline.md) defines measurable baselines and identifies missing measurements.

- ✅ **Hot paths preserved:** Model §10.2 identifies Risk 5 (FTS rebuild blocks saves) and mitigates via in-memory Contribution registry (not DB). Precedent cited (repo memory). Model does NOT claim performance improvements, only composability gains.
- ✅ **No regression claims:** Model does not claim "startup will be faster" or "saves will be quicker." Claims are about clarity and extensibility, not speed.
- ✅ **Missing measurements acknowledged:** Model does not use unmeasured baselines. H15 (tool activation) has no current baseline; model's Phase 5 target "< 1000ms" is labeled "(target; depends on network/AI)" — soft target, not hard claim. 
- ✅ **Characterization tests cited:** Model §7.4 lists required tests (LegacyUriResolution, WorkspaceFolderCanonicalOwnership, SelectionEventRouting, etc.) that match patterns from Baseline §4.

**Finding**: No baseline contradiction. Interaction model respects missing measurements (doesn't cite them as justification).

### Manifest Preservation Rules vs Model

[PARALLX_MANIFEST.md](docs/PARALLX_MANIFEST.md) §11 Non-Negotiable Preservation Rules:

- ✅ **Existing workspaces:** Workspace loading unchanged. Backwards-compatible format expansion only.
- ✅ **Cross-tool workflows:** Explorer → Editor → Chat → Canvas remains achievable. Selection → Surface pipeline is improved (event-based instead of one-off dispatcher), not broken.
- ✅ **Canvas content:** Page and block persistence unchanged. ArtifactRegistry is read-only wrapper; CanvasDataService continues to own persistence.
- ✅ **Extension manifests:** Manifest schema v2 adds optional `when` clause; v1 still valid. No breaking change.
- ✅ **Keybindings/Commands:** Command IDs stable; `when` support is optional. No IDs removed.
- ✅ **Layout restore:** Workspace restore phase unchanged. Layout snapshots persist in same format.
- ✅ **File/folder behavior:** FileService behavior preserved; Workspace becomes canonical owner (internal refactor, no user-visible change).

**Finding**: All preservation rules honored.

---

## 4. Risk Audit

Model §10 identifies 10 risks. Assessment of sufficiency:

### Risks Identified with Adequate Mitigations

- ✅ **Risk 1 (Primitive Proliferation):** Limited to 13; future additions require 3+ features using them. Precedent from current codebase (~15 services). Threshold is reasonable.
- ✅ **Risk 2 (Event Flood):** Coalesced to 100ms windows (same pattern as file-watcher baseline §2 at 50ms). Event loop is protected.
- ✅ **Risk 3 (Contribution Explosion):** Start with 6 types (commands, keybindings, menus, views, tools, settings); add others on-demand. Matches external brief caution.
- ✅ **Risk 4 (Circular Dependencies):** Static analysis at build-time. Reasonable (no existing circular dependency enforcement, but safe to add).
- ✅ **Risk 5 (FTS Rebuild Blocks Saves):** Contribution registry is in-memory (not DB). Decouples from hot path. Solves the M64 problem cited in repo memory.
- ✅ **Risk 6 (Background DB Contends):** Provenance is async + cached. No polling. Addresses repo memory concern.
- ✅ **Risk 7 (Tool Activation Timeout):** Async activation + TaskService timeouts (Slice C). Built-ins activate in parallel Phase 5. Reasonable.

### Risks Missing or Under-Specified

- ⚠️ **Risk X: Phased Landing Complexity.** If Slice A is incomplete, Slice B may depend on broken primitives. Model mentions "phase gates" but does NOT specify per-slice test requirements. **Missing mitigation:** Explicit gate test list per slice (Slice A must pass {LegacyUriResolution, WorkspaceFolderCanonicalOwnership, SelectionEventRouting, SurfaceFocus} before Slice B starts).
  - **Severity:** Medium. Gate testing is obvious (every slice needs tests), but not explicit in model.
  - **Recommendation:** Milestone Steward must add explicit per-slice test gates. Model hint exists (§7.4 "Required Characterization Tests"), but not tied to slices.

- ⚠️ **Risk Y: IPC Event Storm During Selection Changes.** If SelectionService fires 100 onDidChangeSelection events/second, and every handler does IPC (Editor checks, Canvas redraws), renderer thread starves. Baseline has timedDbHandler, but model does NOT call this out.
  - **Severity:** Low-Medium. Event coalescing (100ms window) should prevent this, but not explicit in Risk section.
  - **Recommendation:** Add note to Risk 2 mitigation: "Selection events are debounced to 100ms windows; IPC calls from event handlers are counted in baseline profiling (timedDbHandler)."

- ⚠️ **Risk Z: Provenance Scale Explosion.** If every artifact creation fires ProvenanceService.record(), provenance table grows unbounded. No retention policy specified.
  - **Severity:** Medium (future problem, not immediate). Model §2.13 says "delegated to workspace settings," but workspace settings are not defined.
  - **Recommendation:** Add note: "Provenance retention policy (age, count limits) is defined in workspace settings and enforced by ProvenanceService. Future work: M82."

**Verdict**: Core risks are addressed. Missing risks are out-of-scope (can be added during slice planning) or require additional details that fit the implementation phase (not the design phase).

---

## 5. Overengineering Review

Per [PARALLX_MANIFEST.md](docs/PARALLX_MANIFEST.md) §15: Which proposals look like adoption of external patterns without a tie to current Parallx code?

| Primitive | External Source | Parallx Problem It Solves | Assessment |
|-----------|---|---|---|
| **SelectionService (typed events)** | IntelliJ listener topics | Current SelectionActionDispatcher is hard-coded one-off dispatcher; adding destinations requires code changes. Event model enables auto-discovery. | ✅ **JUSTIFIED** — Solving real fragmentation. |
| **Workspace canonical owner** | VS Code / general IDE pattern | Current SYSTEM_ATLAS §4.2: RecentWorkspaces + Workspace both update metadata; dual notifications; eventual consistency only. | ✅ **JUSTIFIED** — Solving real sync bug. |
| **ContextService typed keys** | VS Code `when` clauses (but typed) | Current code has ~10 scattered CTX_* definitions; no centralized registry; no visibility control. | ✅ **JUSTIFIED** — Solving fragmentation + enabling conditional UI. |
| **Contribution registry with `when`** | VS Code `contributes` | Current MenuContribution (SYSTEM_ATLAS §2) shows menus are flat; no visibility predicates. Hard-coded visibility in menu handlers. | ✅ **JUSTIFIED** — Enabling conditional menus. |
| **TaskService** | IntelliJ BackgroundableTask | Current SYSTEM_ATLAS §4.3: Autonomy hardcoded in Chat activation; if Chat disabled, autonomy disabled (coupling). | ✅ **JUSTIFIED** — Decoupling Chat from background work. |
| **ArtifactRegistry** | VS Code / general editor pattern | Implicit — Canvas pages and Chat turns are already artifacts, but no unified abstraction; no cross-artifact linking. | ⚠️ **ACCEPT** — Enables future feature (cross-artifact linking) but not solving current problem. Low risk (registry is read-only wrapper). |
| **ProvenanceService** | General audit pattern | Implicit — Canvas/Chat track some provenance (creator, timestamp) but no unified model; no audit trail. | ⚠️ **ACCEPT** — Enables future feature but not solving current problem. Low risk (recording is async). |

**Verdict**: All 7 proposals are either solving current Parallx problems or enabling future features tied to architecture. No unjustified "beautiful architecture" adoption.

---

## 6. One-Off Bridge Audit

From [SYSTEM_ATLAS.md](docs/architecture/SYSTEM_ATLAS.md#41-one-off-bridges-hard-coded-couplings) §4.1 "One-Off Bridges":

| # | Bridge | Current Anchor | Model Replacement | Status |
|---|---|---|---|---|
| 1 | Selection → Chat (AddSelectionToChatHandler) | [src/services/selectionActionHandlers.ts:L35-L70](docs/architecture/SYSTEM_ATLAS.md#41-one-off-bridges-hard-coded-couplings) | Model §4 Bridge 1; SelectionService.onDidChangeSelection event | ✅ COVERED |
| 2 | Selection → Canvas (SendSelectionToCanvasHandler) | [src/services/selectionActionHandlers.ts:L70-L120](docs/architecture/SYSTEM_ATLAS.md#41-one-off-bridges-hard-coded-couplings) | Model §4 Bridge 2; SelectionService event | ✅ COVERED |
| 3 | Canvas pages ↔ Chat context (URI pattern) | [src/built-in/chat/data/chatDataService.ts:L1-L50](docs/architecture/SYSTEM_ATLAS.md#41-one-off-bridges-hard-coded-couplings) | Model §4 Bridge 3; LinkResolverService + Resource union type | ✅ COVERED |
| 4 | Chat ↔ Explorer attachments | [src/built-in/chat/input/chatContextAttachments.ts:L25-L80](docs/architecture/SYSTEM_ATLAS.md#41-one-off-bridges-hard-coded-couplings) | Model §4 Bridge 4; EditorService.onDidChangeOpenEditors event | ✅ COVERED |
| 5 | Canvas sidebar ↔ Editor part | [src/built-in/canvas/canvasSidebar.ts:L49-L150](docs/architecture/SYSTEM_ATLAS.md#41-one-off-bridges-hard-coded-couplings) | Model §4 Bridge 5; EditorService event | ✅ COVERED |
| 6 | Recent workspaces ↔ Workspace (dual updates) | [src/workspace/recentWorkspaces.ts:L20-L80](docs/architecture/SYSTEM_ATLAS.md#41-one-off-bridges-hard-coded-couplings) vs [src/workspace/workspace.ts:L160-L210](docs/architecture/SYSTEM_ATLAS.md#41-one-off-bridges-hard-coded-couplings) | Model §4 Bridge 6; Workspace canonical owner; RecentWorkspaces observes events | ✅ COVERED |
| 7 | Link resolution (per-feature URI handlers) | [src/links/linkResolverService.ts:L1-L100](docs/architecture/SYSTEM_ATLAS.md#41-one-off-bridges-hard-coded-couplings) | Model §4 Bridge 7; centralized LinkResolverService with Resource types | ✅ COVERED |

**Verdict**: All 7 bridges have documented replacement entries.

---

## 7. Duplicate-Contract Audit

From [SYSTEM_ATLAS.md](docs/architecture/SYSTEM_ATLAS.md#5-duplicate-contract-inventory) §5 "Duplicate-Contract Inventory":

| State Domain | Current Issue | Model Resolution | Single Owner | Status |
|---|---|---|---|---|
| Canvas page structure | DB source of truth + editor in-memory cache (sync via auto-save) | No change to sync; ownership clarified | CanvasDataService (DB) | ✅ COVERED [L1411](docs/architecture/WORKBENCH_INTERACTION_MODEL.md#5-duplicate-contract-resolution) |
| Chat session history | DB source of truth + widget in-memory session (sync unclear) | Explicit save on turn completion | ChatDataService (DB) | ✅ COVERED [L1420](docs/architecture/WORKBENCH_INTERACTION_MODEL.md#5-duplicate-contract-resolution) |
| Open editor state | workspace-state.json + EditorService runtime (sync on app close) | No change; clarified as owned by Workspace | Workspace | ✅ COVERED [L1427](docs/architecture/WORKBENCH_INTERACTION_MODEL.md#5-duplicate-contract-resolution) |
| Workspace folder set | Workspace.folders + FileService.workspaceRoot (dual writes) | Workspace canonical; FileService reads only | Workspace | ✅ COVERED [L1432](docs/architecture/WORKBENCH_INTERACTION_MODEL.md#5-duplicate-contract-resolution) |
| Tool enablement | settings.json + Contribution registrations (dual state) | Disabling tool unregisters contributions via cleanupToolContributions() | ToolEnablementService + ContributionRegistry | ✅ COVERED [L1436](docs/architecture/WORKBENCH_INTERACTION_MODEL.md#5-duplicate-contract-resolution) |
| Context keys | Runtime map + workspace-state.json (partial persistence) | ContextService owns runtime; Workspace auto-saves selected keys | ContextService | ✅ COVERED [L1441](docs/architecture/WORKBENCH_INTERACTION_MODEL.md#5-duplicate-contract-resolution) |
| Layout and parts state | workspace-state.json + Layout runtime (sync on app close) | Same pattern as editor state | Workspace | ✅ COVERED [L1445](docs/architecture/WORKBENCH_INTERACTION_MODEL.md#5-duplicate-contract-resolution) |

**Verdict**: All 7 duplicate contracts have named single owners.

---

## 8. Section-Level Findings

### §1 Purpose and Scope ([L1](docs/architecture/WORKBENCH_INTERACTION_MODEL.md#1-purpose-and-scope))

- ✅ **Stands:** Clear separation of "IS" (schema redesign) vs. "IS NOT" (feature, visual, perf, AI internals, extension APIs without migration, DB schema, IPC).
- ⚠️ **Must be clarified:** §1.4 lists what's NOT proposed, but should explicitly state: "This model proposes NO user-visible workflow removals. All existing cross-tool patterns (Explorer → Editor → Chat → Canvas → persist → reopen) remain achievable and preserve user continuity."
  - **Revision required:** Add explicit preservation commitment: "Existing workspace restore, editor state recovery, Canvas content persistence, chat history, and layout recovery all function identically under the new model."

### §2 Unified Primitives ([L90](docs/architecture/WORKBENCH_INTERACTION_MODEL.md#2-unified-primitives))

- ✅ **Stands:** Consistent structure (Definition, Current Implementation, Proposed Shape, Ownership, Migration Story, Compatibility Table Row) for all 13 primitives.
- ⚠️ **Clarity gap:** Some primitives have "What It Owns" but inconsistent "What It Does NOT Own" sections.
  - **Revision required:** 
    - §2.2 Resource: Clarify "Does NOT own content fetching or rendering."
    - §2.5 Context: Clarify "Does NOT own feature flag evaluation logic (delegated to services that consume context)."
    - §2.10 Event: Clarify "Does NOT own event processing or side effects (delegated to subscribers)."
  - Standardize: ALL 13 primitives must have both "What It Owns" and "What It Does NOT Own" explicitly stated.

- ⚠️ **Missing primitive:** Persistence Service? Model clarifies ownership of state (Workspace saves state, CanvasDataService saves to DB), but does NOT define a unified Persistence abstraction.
  - **Assessment:** Correct design choice. Each service owns its persistence. No centralized Persistence service is needed. No revision required.

### §3 The Ten Open Design Questions ([L265](docs/architecture/WORKBENCH_INTERACTION_MODEL.md#3-the-ten-open-design-questions-answered))

- ✅ **Stands:** All 10 questions have Decision + Rationale with cross-document citations (Atlas, External brief, Baseline).
- ⚠️ **Ambiguity in Q7 (Autonomy + TaskService):** Says "Create a top-level TaskService" but doesn't clarify NEW autonomy lifecycle. If Autonomy moves to TaskService, when do background tasks execute?
  - **Revision required:** Clarify: "Autonomy tasks are queued to TaskService with priority 'background' or 'idle'. Execution schedule remains unchanged (heartbeat every N seconds, cron jobs run per schedule); TaskService only manages task lifecycle (queueing, cancellation, timeout), not the schedule."

- ⚠️ **Underspecified in Q10 (Migration Test Pattern):** Says "required for every schema version change," but doesn't define what is a "version change."
  - **Revision required:** Clarify: "Schema version increments on: (1) changes to `.parallx/data.db` SQL schema (migrations), (2) structural changes to `.parallx/workspace-state.json`, (3) changes to extension storage layout. Adding optional JSON fields without removing existing fields does not require a version bump if backward-compatible reading is maintained."

### §4 Cross-Tool Bridge Replacement Plan ([L407](docs/architecture/WORKBENCH_INTERACTION_MODEL.md#4-cross-tool-bridge-replacement-plan))

- ✅ **Stands:** Clear table with all 7 bridges, replacement mechanism, migration ordering, test required.
- ⚠️ **Missing execution detail:** When is old handler code removed? E.g., SelectionActionDispatcher shim exists in M82 but is removed in M83 — but how do extensions that still use old API behave?
  - **Revision required:** Add transition notes: "Old handler code is shimmed in Slice A and marked @deprecated. Shim forwards to new event subscribers. Removal in Slice D (M83) with migration period. Extensions that don't update by removal date will break (expected in breaking change policy)."

### §5 Duplicate-Contract Resolution ([L597](docs/architecture/WORKBENCH_INTERACTION_MODEL.md#5-duplicate-contract-resolution))

- ✅ **Stands:** All 7 state domains have canonical owner and delegation model.
- ⚠️ **Vague resolution mechanisms:** Example: "Canvas auto-save persists delta to DB" — what is a "delta"? Full page JSON or incremental changes?
  - **Revision required:** Clarify: "Canvas auto-save persists FULL page JSON (not delta; full serialization is simpler and safer than tracking incremental changes)."

### §6 Lifecycle and Activation Model ([L703](docs/architecture/WORKBENCH_INTERACTION_MODEL.md#6-lifecycle-and-activation-model))

- ⚠️ **Phase 5 target is unmeasured:** Says "Built-in tool activation < 1000ms (target; depends on network/AI)." Baseline §3 lists M18 "Per-tool activation time" as proposed-NOT-YET-IMPLEMENTED. If current is 500ms, target of 1000ms is a regression.
  - **Revision required:** Either remove the hard number (leave as "Phase 5: Built-in Tool Activation (async, parallel)") OR cite a measured baseline. Currently, this is an unsupported claim.

- ⚠️ **Phase 6 is misleading:** Says "Extension Activation: 0ms (deferred to on-demand)." But extensions may still activate eagerly if their activation events match.
  - **Revision required:** Clarify: "Extension Activation: deferred to on-demand (0ms in hot startup path; activation happens only when trigger events fire; precise activation events prevent eager loading)."

### §7 Compatibility and Migration Strategy ([L822](docs/architecture/WORKBENCH_INTERACTION_MODEL.md#7-compatibility-and-migration-strategy))

- ✅ **Stands:** Detailed compatibility table (9 rows) with migration paths and deprecation windows.
- ⚠️ **Shim strategy not detailed:** Table says migration path is "Shim" for SelectionActionDispatcher, but doesn't show shim pseudocode or reference where it lives.
  - **Revision required:** Provide shim example or forward reference: "Shim implementation: [src/services/selectionActionDispatcher.ts:L1-L50] (proposed; backward compatibility wrapper that routes old handler registration calls to SelectionService.onDidChangeSelection subscribers)."

- ⚠️ **Deprecation windows vague:** Says "2 releases" but doesn't specify which releases (M82 + M83?).
  - **Revision required:** Change "2 releases" to "2 releases (M82 shim, M83 removal)" for clarity.

### §8 Out of Scope ([L1283](docs/architecture/WORKBENCH_INTERACTION_MODEL.md#8-out-of-scope))

- ✅ **Stands:** Clear list of what's NOT proposed.
- ⚠️ **Missing explicit statement:** Should say "This redesign does NOT propose changes to storage abstraction (FileBackedStorage, FileBackedWorkspaceStorage). Those services remain unchanged."
  - **Revision required:** Add bullet to Out of Scope list.

### §9 Acceptance Criteria ([L1291](docs/architecture/WORKBENCH_INTERACTION_MODEL.md#9-acceptance-criteria-for-this-document))

- ✅ **Stands:** Clear 10-item checklist with checkmarks.
- ⚠️ **Criterion verification is internal only:** "No unjustified new primitives" checks against Manifest §10, but should also verify against Parallx codebase: "Do all 13 primitives have implementation anchors (code locations) or clear migration paths from existing code?"
  - **Revision required:** Add criterion: "All 13 primitives have either (a) existing Parallx implementation (e.g., CommandRegistry exists) to be enhanced, OR (b) clear migration path from existing services (e.g., SelectionService replaces SelectionActionDispatcher). No aspirational-only primitives."

### §10 Risks and Anti-Patterns ([L1318](docs/architecture/WORKBENCH_INTERACTION_MODEL.md#10-risks-and-anti-patterns))

- ✅ **Stands:** 7 risks identified, 8 anti-patterns documented.
- ⚠️ **Risk 4 mitigation is underspecified:** Says "Static analysis at build-time to detect cycles" but doesn't name the tool or how it's enforced.
  - **Revision required:** "Add eslint rule or build-time dependency graph analyzer (tool TBD during slice planning) to detect listener cycle dependencies and fail build if found."

- ⚠️ **Anti-pattern on string predicates is imprecise:** Says "typed context keys" is the solution, but context keys ARE strings internally (e.g., `'workbench.focus'`). The difference is centralization + IDE autocomplete.
  - **Revision required:** Clarify: "Typed context keys are centrally defined in ContextKeys enum/dict (enabling IDE autocomplete and validation). This is different from scattered magic strings across codebase (current anti-pattern)."

---

## 9. Acceptance Conditions

**Required before M81 milestone authoring begins:**

1. **Incorporate the 9 revisions from §8** above (mostly clarifications, not structural changes):
   - Explicit preservation commitment in §1.4
   - "What It Does NOT Own" sections for all 13 primitives (§2)
   - Clarify Autonomy lifecycle in Q7 (§3)
   - Clarify migration test pattern in Q10 (§3)
   - Transition notes for old handler code (§4)
   - Delta vs. full serialization clarification (§5)
   - Measure Phase 5 target or remove it (§6)
   - Clarify Extension Activation phase language (§6)
   - Shim implementation reference (§7)
   - Deprecation window precision (§7)
   - Add storage abstraction statement to Out of Scope (§8)
   - Strengthen criterion on primitive implementation anchors (§9)
   - Tool specification for cycle detection (§10)
   - Clarify context key centralization (§10)

2. **Milestone Steward must document per-slice phase gates** before Slice A starts. Every slice must pass defined characterization tests from [Baseline §4](docs/research/baselines/workbench-baseline.md#4-proposed-characterization-tests) before merging:
   - **Slice A gates:** LegacyUriResolution, WorkspaceFolderCanonicalOwnership, SelectionEventRouting, SurfaceFocus, ContextKeyDiscovery tests all PASS. No regression in existing tests.
   - **Slice B gates:** CommandContractValidation, ToolActivationFiltering, ContributionVisibilityPredicate tests all PASS.
   - **Slice C gates:** CapabilityGating, TaskQueueing, ArtifactLinking, ProvenanceTracing tests all PASS.
   - **Slice D gates:** EditorAttachmentSync, CanvasSidebarSync, AutonomyLifecycleIndependence, ChatToCanvasArtifact, and all cross-tool workflow tests all PASS.

3. **Baseline measurements must be established before Slice A starts.** From Baseline §3 Missing-Measurement Inventory, prioritize:
   - M1: Workspace cold-start time (< 5s baseline for fresh workspace)
   - M7: Canvas page load time (per page size: 10, 100, 1000 blocks)
   - M18: Per-tool activation time (establish current floor before TaskService optimization)
   These can run in parallel with model acceptance (no blocking).

4. **Milestone Steward must create explicit agent cards** for each Slice executor (Slice A executor, B executor, C executor, D executor). Do NOT allow one agent to execute multiple slices (prevents testing of slice boundaries).

5. **Shim backward-compatibility implementations must be designed before Slice A coding starts.** For SelectionActionDispatcher deprecation: create a forward compatibility layer that maps old API calls to new event subscriptions. Design must be reviewed before implementation.

6. **Migration tooling must be specified.** For Workspace.folders type change and URI scheme aliasing: what automated tools will migrate old workspaces? Specify scripts/CLI entry points before implementation.

---

## 10. Slice Recommendation

Independent of the model's own recommendation (Slice A, B, C, D), my recommendations for safer execution:

### Safest First Slice (Measurable, Low-Risk)

**Slice: SelectionService Event Routing (subset of Slice A)**

- **What:** SelectionService replaces SelectionActionDispatcher. Selection is now a typed event observable by any surface.
- **Why safest:**
  - **Measurable improvement:** Current bridges (Selection → Chat, Selection → Canvas) are hard-coded routes. Event model allows external tools to subscribe without modifying handler code.
  - **Low risk:** Event subscription is well-understood pattern (precedent: all Emitter<T> uses in codebase). Backward-compatible via shim.
  - **Unblocked:** Self-contained; does NOT depend on Resource, Workspace, or other primitives being complete.
- **Tests required:** SelectionEventRouting, SelectionToChat, SelectionToCanvas (from Baseline §4).
- **Timeline:** 1–2 weeks.

### Riskiest Slice (Requires Baseline First)

**Slice: TaskService + Autonomy Migration (parts of Slice C + Slice D)**

- **Why risky:**
  - Tool activation latency is not baselined (Baseline §3, M18 proposed-not-yet-implemented). If current is 500ms and we target 1000ms, we have headroom. But if current is 900ms, TaskService overhead could push past target.
  - Autonomy behavior is subtle (heartbeat timing, cron scheduling). Moving to TaskService could introduce timing regressions.
- **Depends on:** M1 (workspace cold-start), M18 (per-tool activation) baselines established.
- **Gate:** Autonomy heartbeat still fires on schedule after migration. Cron tasks still run on time. No latency regression in task execution.
- **Timeline:** 3–4 weeks (after baselines complete).

### Dependency Ordering (Mandatory)

1. **Phase 0: Baseline Measurements (1–2 weeks, parallel to other work)**
   - Measure M1 (workspace cold-start), M7 (Canvas page load), M18 (tool activation), M21 (fs.watch pickup).
   - Required before Slice A lands (creates baseline for regression gates).

2. **Phase 1: Slice A (Core Primitives) (3–4 weeks)**
   - Resource, Workspace, SelectionService, SurfaceRegistry, ContextService.
   - Blocks Slices B and C.
   - Tests: LegacyUriResolution, WorkspaceFolderCanonicalOwnership, SelectionEventRouting, SurfaceFocus, ContextKeyDiscovery.

3. **Phase 2: Slice B (Extended Primitives) (2–3 weeks, after Slice A completes)**
   - Command/Tool registries with typed contracts, Contribution registry.
   - Blocks Slice C.
   - Tests: CommandContractValidation, ToolActivationFiltering, ContributionVisibilityPredicate.

4. **Phase 3: Slice C (Advanced Primitives) (3–4 weeks, after Slice B completes)**
   - Capability, Task, Artifact, Provenance.
   - Blocks Slice D.
   - Tests: CapabilityGating, TaskQueueing, ArtifactLinking, ProvenanceTracing.

5. **Phase 4: Slice D (Bridge Replacement & Refactor) (2–3 weeks, after all prior slices)**
   - Replace SelectionActionDispatcher, lift Autonomy to TaskService, unify Link resolution, migrate Chat/Editor attachment events.
   - Tests: EditorAttachmentSync, CanvasSidebarSync, AutonomyLifecycleIndependence, ChatToCanvasArtifact, cross-tool workflow tests.

**Total timeline: 14–18 weeks (3.5–4.5 months) serial. With parallel Phase 0 baseline work: 13–17 weeks effective.**

---

## Summary

The Workbench Interaction Model is **comprehensive, well-grounded, and implementable**. It honors preservation rules, addresses all current fragmentation, and provides clear gates for each slice. Minor clarity revisions are required (listed in §8), but no structural redesign is needed.

**Proceed to M81 milestone authoring with the 9 revisions above and the acceptance conditions in §9.**
