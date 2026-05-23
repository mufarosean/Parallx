---
Status: planning — drafted 2026-05-23 by Systems Redesign Conductor; not yet user-accepted
Milestone: M82 / SR-2: Extension Contribution Model (Canvas Block Types & Chat Participants)
Branch: systems-redesign-planning
Created: 2026-05-23
Parent baseline: master @ 9b9a243 (checkpoint-pre-systems-redesign-2026-05-23)
Predecessor: M81 / SR-1 (implemented-verified 2026-05-23)
Supersedes: None
Manifest: docs/PARALLX_MANIFEST.md (§5, §10, §11, §14, §17, §22)
Interaction model: docs/architecture/WORKBENCH_INTERACTION_MODEL.md (§2.8 Contribution, §3.3 deferred scope, Q8)
Review: docs/research/WORKBENCH_INTERACTION_MODEL_REVIEW.md (§III §9 extension-point assessment)
Baseline: docs/research/baselines/workbench-baseline.md (extension-activation H15)
Atlas: docs/architecture/SYSTEM_ATLAS.md (§2 system ownership, §4 bridges)
Governance: docs/research/git/BRANCH_GOVERNANCE.md
Conductor: Systems Redesign Conductor
---

# Parallx Milestone 82 / SR-2: Extension Contribution Model

## 1. Goal

Open two narrow, well-bounded extension points so third-party extensions can extend the two surfaces that today are closed:

1. **Canvas block types.** Today every block type lives in [src/built-in/canvas/config/blockRegistry.ts](src/built-in/canvas/config/blockRegistry.ts) — a closed, hand-authored TypeScript table. No extension API permits adding a block.
2. **Chat participants.** Today [`IChatAgentService.registerAgent(participant)`](src/services/chatTypes.ts) is internal and only the built-in chat extension calls it (registering `parallx.chat.default` at [src/built-in/chat/main.ts:L574](src/built-in/chat/main.ts)). No `api.chat.registerParticipant` surface exists.

M82 / SR-2 ships **just enough contribution wiring** to let one external extension prove each surface end-to-end, without rewriting either registry. This is the explicit M81 deferral target ([Parallx_Milestone_81.md L39](docs/Parallx_Milestone_81.md) — "extension point support … deferred to M82+ (WORKBENCH_INTERACTION_MODEL.md §3.3, Q8 decision)") and the Review's §III §9 future-work pointer ([WORKBENCH_INTERACTION_MODEL_REVIEW.md L70-L71](docs/research/WORKBENCH_INTERACTION_MODEL_REVIEW.md)).

## 2. User Workflows Protected

Primary protected workflow ([PARALLX_MANIFEST.md §5](docs/PARALLX_MANIFEST.md#5-core-product-workflow)):

> User opens a workspace → AI chat references workspace resources → user or AI creates Canvas pages/blocks → reopens workspace.

The two new contribution points participate in this workflow without rewriting it:

- An extension-contributed Canvas block must round-trip the same save/restore path as built-in blocks. (Canvas content invariant — Manifest §11.)
- An extension-contributed chat participant must coexist with `parallx.chat.default` and respect the same tool-policy / capability gating that already governs chat. (M65 `openclawToolPolicy` + M67 `policyDecisionPoint`.)

## 3. Scope

### In scope (this milestone)

- **API surface** (extension API, additive):
  - `api.canvas.registerBlockType(definition: BlockTypeDefinition): IDisposable`
  - `api.chat.registerParticipant(participant: ChatParticipantDefinition): IDisposable`
- **Internal wiring** (workbench, additive):
  - One new contribution processor file under `src/contributions/` that consumes block-type and participant manifest entries (re-using the `ContributionRegistry` orchestrator shipped in M81 Slice B, commit `01e261fe`).
  - One new manifest field per kind under `contributes.canvas.blockTypes[]` and `contributes.chat.participants[]`. Schema validated through the existing manifest loader; processors validate the fields they read.
- **Reference consumer**: one example external extension under `ext/example-canvas-block/` (or equivalent) that contributes a single trivial block type and a no-op chat participant. Purpose: characterization test fixture and authoring-doc example.
- **Tests**:
  - Unit test for each processor (load + register + dispose).
  - One characterization test that opens a workspace with the example extension installed, asserts the block round-trips through canvas save → reload, and asserts the participant appears in `IChatAgentService.getRegisteredParticipants()`.
- **Authoring docs**: extend [PARALLX_EXTENSION_AUTHORING_FOR_AI.md](docs/PARALLX_EXTENSION_AUTHORING_FOR_AI.md) with one section per contribution kind.

### Out of scope (explicitly deferred)

- Rewriting `blockRegistry.ts` or replacing the closed table with a fully data-driven runtime registry. M82 adds an *extension entry point*; built-in blocks continue to live in the closed table.
- Marketplace / signing / sandboxing of external extensions. (Manifest §8 out-of-scope. Lethal-trifecta concerns covered by M65 are *not* re-opened here.)
- Custom Tiptap node spec authoring API. Extensions contribute a block by referencing a registered ProseMirror node spec, not by defining one. The first iteration uses a generic "embedded webview" block kind; richer node-spec contribution is a separate future milestone.
- Custom chat panes, custom message renderers, or new chat surfaces. Participants invoke through the existing chat surface only.
- Touching `electron/*`, `src/openclaw/*`, or `src/services/chatService.ts`. The capability gate already lives in `openclawToolPolicy` + `policyDecisionPoint` (M81 Slice C ruling, commit `c3ea171f`).
- Performance work. M82 is composability, not speed. No claims about activation time without a baseline measurement.

## 4. Out Of Scope — Anti-List (cannot be touched without explicit user approval)

- `src/built-in/canvas/canvasDataService.ts` — preservation list (canvas hot path).
- `src/built-in/canvas/canvasPersistence.ts` — preservation list.
- `src/built-in/canvas/config/blockRegistry.ts` — read-only in M82. The new processor reads from it (to detect built-in id conflicts); it does not mutate it.
- `src/services/chatAgentService.ts` — implementation file. The new processor calls existing `registerAgent()`; it does not redesign the service.
- `electron/*`, `src/openclaw/*` — Manifest §11 preservation.

If any of these need to change mid-execution, the Surgical Executor must stop and surface to the user.

## 5. Agents Assigned

| Slice | Agent | Card |
|---|---|---|
| Plan acceptance | Systems Redesign Conductor | [docs/research/agents/systems-redesign-conductor.md](docs/research/agents/systems-redesign-conductor.md) |
| Current-code research (canvas block authoring path, chat participant lifecycle) | Research Agent → `docs/research/M82_CONTRIBUTION_AUDIT.md` | [docs/research/agents/research-agent.md](docs/research/agents/research-agent.md) |
| External pattern check (VS Code `contributes.languages` and `contributes.chatParticipants` for shape parity only — do NOT copy lifecycle) | Research Agent → appended to same audit doc | same |
| Baseline measurement (current extension-activation H15) | Baseline and Metrics Agent → `docs/research/baselines/workbench-baseline.md` extension-activation row | [docs/research/agents/baseline-and-metrics-agent.md](docs/research/agents/baseline-and-metrics-agent.md) |
| Slice A implementation (canvas block-type contribution) | Surgical Executor | [docs/research/agents/surgical-executor-agent.md](docs/research/agents/surgical-executor-agent.md) |
| Slice B implementation (chat participant contribution) | Surgical Executor | same |
| Per-slice fitness review | Fitness and Review Agent → `docs/research/M82_SLICE_<A\|B>_REVIEW.md` | [docs/research/agents/fitness-and-review-agent.md](docs/research/agents/fitness-and-review-agent.md) |
| Branch/commit/rollback bookkeeping | Git and Release Steward | [docs/research/agents/git-and-release-steward.md](docs/research/agents/git-and-release-steward.md) |

## 6. Current-State Research Required (before Slice A)

The Research Agent must produce `docs/research/M82_CONTRIBUTION_AUDIT.md` answering:

1. **Canvas authoring path.** Which functions in `blockRegistry.ts` actually need to be parameterised vs. left private? Trace every consumer of the exported `createEditorExtensions` / `PageChromeController` / `resolvePageIcon` / `ALL_PAGE_SELECTABLE_ICONS` symbols. List which symbols must remain canonical for built-ins. (Approx 5–10 anchors.)
2. **Canvas save/restore round-trip.** Where in `canvasDataService` is block content encoded for storage, and what is the contract for a block with extension-defined attributes? Cite the schema-version migration path so contributed blocks don't break workspace reload.
3. **Chat participant lifecycle.** Anchor every consumer of `IChatAgentService.getRegisteredParticipants()` and confirm the chat panel routes `@participant` references through the registry (not a hardcoded list). Cite [src/built-in/chat/main.ts](src/built-in/chat/main.ts) and the chat panel orchestration file.
4. **Manifest loader contract.** Where does the extension manifest get loaded and validated today? Confirm the additive fields `contributes.canvas.blockTypes[]` and `contributes.chat.participants[]` slot in without breaking existing manifests. Cite the loader file.
5. **Capability/policy gating.** Confirm that a participant contributed by extension X still passes through `openclawToolPolicy` and `policyDecisionPoint` for tool invocations exactly as `parallx.chat.default` does.

Each finding must include a file:line anchor and a one-line statement of what M82 may or may not assume from it. **Speculative recommendations without anchors are rejected.**

## 7. External Research Required (before Slice A)

Appended to `M82_CONTRIBUTION_AUDIT.md`:

- VS Code `contributes.chatParticipants` JSON shape. Confirm Parallx's `chat.participants[]` shape can match for cognitive parity. Cite source URL.
- VS Code `contributes.languages` / `contributes.grammars` JSON shape (as a precedent for "register a new schema-rich kind from an extension"). Same.
- Eclipse extension-point registry — *anti-pattern reference only*. Confirm Parallx does NOT adopt XML descriptors or `InvalidRegistryObjectException` patterns. (External review §III already covers this — re-affirm.)

External findings must connect to a Parallx workflow and to current code. Best-practice quotes alone are insufficient.

## 8. Baseline And Metrics Required (before Slice A)

The Baseline and Metrics Agent must:

1. Run the existing workbench characterization tests (M81 Phase 5 baseline rows) on the current `systems-redesign-planning` HEAD and record results in `workbench-baseline.md`.
2. Add one extension-activation measurement to `workbench-baseline.md` (H15, currently unmeasured per Review §I) — wall-clock time from `WorkbenchExtensionRegistry.onDidActivate` first fire to chat-default participant register. Record on current HEAD. M82 may not claim activation improvements without this baseline.

## 9. Workbench Concepts Involved

From [WORKBENCH_INTERACTION_MODEL.md §2](docs/architecture/WORKBENCH_INTERACTION_MODEL.md):

- §2.8 Contribution — primary concept. M82 adds two new contribution kinds.
- §2.6 Command — chat participants are addressable by `@<name>` and via `executeCommand('chat.participant.<id>.invoke', …)`.
- §2.10 Capability — participant tool invocations must remain capability-gated.
- §2.12 Artifact — canvas blocks produce durable artifacts; new block types must respect provenance fields (M81 Slice C, commit `dcec1a22`).
- §3.3 — the deferred scope this milestone implements.

## 10. Implementation Slices

### Slice A — Canvas block-type contribution

**Scope:**
- New file `src/contributions/canvasBlockTypeContribution.ts` (~120 lines target). Processor only; reads `contributes.canvas.blockTypes[]` from extension manifests and registers them with a new lightweight `ICanvasBlockTypeRegistry` (in-memory map, no DB).
- Minimal `ICanvasBlockTypeRegistry` service at `src/services/canvasBlockTypeRegistry.ts` (~80 lines). Single owner per id; rejects conflicts with built-in ids by reading the built-in list once at startup.
- Canvas editor reads `ICanvasBlockTypeRegistry.getAll()` once during editor extension assembly and merges the result with built-ins. (One narrow call in `canvasEditorProvider.ts` — does NOT modify `blockRegistry.ts`.)
- Reference extension at `ext/example-canvas-block/` (~50 lines) contributing one "embedded-iframe" block.
- Schema migration: none required. Block types are runtime registrations, not persistent rows. Workspace files that reference an unregistered block id fall back to a placeholder text node — same recovery path Tiptap already uses for unknown nodes.

**Files modified:** new processor, new service, new example extension, additive `canvasEditorProvider.ts` call site, additive `parallx-manifest.json` schema entry.
**Files NOT touched:** `canvasDataService.ts`, `canvasPersistence.ts`, `blockRegistry.ts`, any electron/*.

**Verification:**
- Unit: `tests/unit/canvasBlockTypeContribution.test.ts` — loads a manifest stub, registers, asserts `getAll()` returns it, disposes.
- Characterization: `tests/unit/canvasContributedBlockRoundtrip.test.ts` — write a page containing the example block, reload, assert the node survives.

**Commit message:** `feat(canvas): extension point for block-type contribution (M82 Slice A)`. Includes `Rollback: git revert HEAD.`

### Slice B — Chat participant contribution

**Scope:**
- New file `src/contributions/chatParticipantContribution.ts` (~120 lines). Processor reads `contributes.chat.participants[]` and calls the existing `IChatAgentService.registerAgent()` for each. No changes to `chatAgentService.ts`.
- Extend extension API surface: `api.chat.registerParticipant(definition)` returns the same `IDisposable` the internal call returns.
- Reference extension at `ext/example-chat-participant/` (~30 lines) contributing one echo participant.

**Files modified:** new processor, additive entry in extension `chat` API surface, additive `parallx-manifest.json` schema entry.
**Files NOT touched:** `chatAgentService.ts`, any electron/*, any openclaw/*.

**Verification:**
- Unit: `tests/unit/chatParticipantContribution.test.ts` — loads manifest stub, asserts `registerAgent` was called with parsed definition, asserts dispose unregisters.
- Characterization: `tests/unit/chatContributedParticipantInvoke.test.ts` — register example participant, dispatch invoke, assert echo result returns through standard agent invoke path.

**Commit message:** `feat(chat): extension point for participant contribution (M82 Slice B)`. Includes `Rollback: git revert HEAD.`

### Slice C (provisional, not authorised)

Authoring-doc + example-extension polish. Only proceed if Slices A+B pass review without revisions.

## 11. Verification Plan

Per Manifest §22 categories:

| Category | Check |
|---|---|
| Workflow preservation | The Manifest §5 workflow runs unchanged when no extension contributes a block type or participant. Test: existing canvas/chat unit suites pass unmodified. |
| Data preservation | Workspaces saved before M82 reopen identically. Test: open a fixture workspace from before M82, assert page content hash unchanged. |
| Cross-tool interaction | Contributed participant can call canvas tools (e.g., `canvas_create_page`) and capability gating still applies. Test: example participant attempts a tool call; assert it flows through `openclawToolPolicy`. |
| Failure behavior | A throwing block-type processor for one extension does not prevent another extension's contribution. Pattern reuses M81 Slice B's per-processor try/catch (commit `01e261fe`). |
| Performance | No new claim. Extension-activation baseline recorded before Slice A (Phase 8 above). M82 close-out asserts "no regression beyond +5% on H15"; if regression exceeds, revise or roll back. |
| Recovery | Workspace containing a block whose contributing extension is uninstalled falls back to a placeholder node (Tiptap's existing unknown-node behavior); page still opens. Test: simulate uninstalled extension; reload page; assert no exception. |
| Debuggability | Each processor logs `[CanvasBlockTypeContribution] registered <id> from <extId>` and `[ChatParticipantContribution] registered <id> from <extId>` matching the M81 Slice B logging style. |

## 12. Preservation Checklist

Per Manifest §11:

- [ ] Existing workspaces open.
- [ ] Canvas page content (existing built-in block types) renders identically.
- [ ] `parallx.chat.default` participant still registers and answers.
- [ ] No extension manifest entries break (additive fields only).
- [ ] No command IDs, keybindings, or settings keys removed.
- [ ] M65 capability gating still wraps every contributed participant's tool calls.
- [ ] M67 policy decision point unchanged.
- [ ] M81 Slice C provenance fields (`created_by` / `source_tool`) populated correctly for blocks created via contributed types (default `created_by` = `'extension:<extId>'`).

Each box flips green when its verification test passes.

## 13. Commit Plan

| Order | Commit | Scope |
|---|---|---|
| 1 | `docs(M82): plan SR-2 extension contribution model` | This file only. |
| 2 | Research/baseline commits (one per artifact) | `docs/research/M82_CONTRIBUTION_AUDIT.md`, `docs/research/baselines/workbench-baseline.md` row. |
| 3 | `feat(canvas): extension point for block-type contribution (M82 Slice A)` | Slice A code + tests + reference extension. |
| 4 | `docs(M82): record Slice A fitness review (KEEP \| REVISE \| ROLLBACK)` | `docs/research/M82_SLICE_A_REVIEW.md`. |
| 5 | `feat(chat): extension point for participant contribution (M82 Slice B)` | Slice B code + tests + reference extension. |
| 6 | `docs(M82): record Slice B fitness review` | `docs/research/M82_SLICE_B_REVIEW.md`. |
| 7 | `docs(M82): flip status to implemented-verified` | Status header. |

Each commit footer: `Rollback: git revert HEAD.`
No merge to `master` (Manifest §2, §19).

## 14. Rollback Plan

Per-slice rollback: `git revert <slice-commit>`. Because all M82 work is additive (new files + additive call sites + additive manifest fields), revert is clean. No schema migration required. No data file format change.

Full-milestone rollback: revert the seven commits in reverse order. Result is identical to `systems-redesign-planning` HEAD pre-M82.

## 15. Closeout Evidence

M82 closes only when:

- Conditions in §11 Verification all pass.
- Both fitness reviews returned KEEP.
- `docs/research/baselines/workbench-baseline.md` has the post-M82 row recorded and shows no regression beyond +5% on H15.
- `docs/README.md` "Most recently closed milestones" list is updated.
- The status header flips to `implemented-verified`.

## 16. Stop / Escalation Conditions

The Surgical Executor must stop and surface to the user if any of these occur:

- A preservation-list file (§4 anti-list) needs to be modified.
- A schema migration becomes necessary (e.g., to persist contributed-block attribute data).
- Capability gating cannot be preserved for a contributed participant without modifying `openclawToolPolicy`.
- Extension-activation H15 regresses by more than +5%.
- Either example extension cannot demonstrate the full round-trip in tests.

## 17. Status Trail

| Date | Status | Change | Commit |
|---|---|---|---|
| 2026-05-23 | `planning` | Drafted by Conductor as M81 successor. Pending user acceptance + research/baseline gates. | (this commit) |
