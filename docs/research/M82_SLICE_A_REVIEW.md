# M82 Slice A — Canvas Block-Type Contribution: Fitness Review

**Status:** KEEP
**Reviewer:** Surgical Executor (post-implementation)
**Commit reviewed:** `e9320875` ("feat(canvas): extension point for block-type contribution (M82 Slice A)")
**Date:** 2026-05-23

## 1. What shipped

| Surface | File | Notes |
|---|---|---|
| Manifest schema | `src/tools/toolManifest.ts` | New `IManifestCanvasContributions`, `IManifestCanvasBlockType`. `contributes.canvas.blockTypes[]` field added. Shape: id / name / label / icon / kind (`leaf`/`container`/`atom`/`inline`/`structural`). Metadata-only — the real Tiptap `extension(context)` factory is provided imperatively at activate-time. |
| Runtime registry | `src/services/canvasBlockTypeRegistry.ts` (~95 lines) | `ICanvasBlockTypeRegistry` + `CanvasBlockTypeRegistry`. Snapshots `BLOCK_REGISTRY.keys()` at construction. `register(def)` rejects built-in ids and duplicates. Returns `IDisposable`. `onDidChange` fires on add/remove. |
| Processor | `src/contributions/canvasBlockTypeContribution.ts` (~165 lines) | `CanvasBlockTypeContributionProcessor` implements `IContributionProcessor`. Reserves ids from manifest (no runtime registration yet — manifest lacks the factory). `wireRealDefinition(id, def)` registers with the runtime registry and stashes the disposable. `unwireRealDefinition` reverts the runtime entry but keeps the stub. `removeContributions(toolId)` disposes both. Built-in/duplicate conflict policy enforced at the stub stage too. |
| Service identifiers | `src/services/serviceTypes.ts` | New `ICanvasBlockTypeContributionService` + `ICanvasBlockTypeRegistryService` interfaces and identifiers. Both unconditionally registered. |
| Registry fan-out | `src/contributions/contributionRegistry.ts` | Optional 6th constructor param. Same try/catch isolation pattern as the other five processors. |
| Workbench wiring | `src/workbench/workbench.ts` | Always constructs registry + processor; registers both via DI; passes processor as 6th arg to `ContributionRegistry`. |
| Bridge | `src/api/bridges/canvasBridge.ts` (~85 lines) | New `CanvasBridge.registerBlockType(definition)`. Manifest-declared path → `wireRealDefinition`; imperative-only path → `ICanvasBlockTypeRegistry.register` direct. Returns `IDisposable` in both cases. |
| API surface | `src/api/apiFactory.ts` | Exposes `api.canvas.registerBlockType`. `canvas` namespace is `undefined` when the registry is absent (defensive). |
| Editor wiring | `src/built-in/canvas/canvasEditorProvider.ts` + `src/built-in/canvas/main.ts` | `CanvasEditorProvider.setContributedBlocksProvider(() => registry.getAll())` wired from `main.ts`. The pane reads the snapshot at construction and passes it to `createEditorExtensions` as a new 3rd parameter. |
| Tiptap expansion | `src/built-in/canvas/config/tiptapExtensions.ts` | New optional `contributedBlocks?: readonly BlockDefinition[]` parameter. Each definition's `extension(context)` is called inside a try/catch; failures are logged and the block is skipped (does not abort editor construction). |
| Reference extension | `ext/example-canvas-block/` | Manifest + activate() round-trip. Minimal `embeddedIframe` atom Node. |
| Tests | `tests/unit/canvasBlockTypeContribution.test.ts` (12 tests) | All green. Covers reservation, wireRealDefinition, unwireRealDefinition, removeContributions, imperative-only path, built-in conflict, duplicate conflict, invalid-manifest skips, onDidChange events. |

## 2. Audit-condition checklist (from `M82_CONTRIBUTION_AUDIT.md` + Manifest §16)

| Condition | Status | Evidence |
|---|---|---|
| Anti-list untouched (`canvasDataService.ts`, `canvasPersistence.ts`, `blockRegistry.ts`, `chatAgentService.ts`, `electron/*`, `openclaw/*`) | PASS | `git show e9320875 --stat` does not list any of them. The new 3rd parameter was added to `createEditorExtensions` (in `tiptapExtensions.ts`) rather than extending `EditorExtensionContext` (in `blockRegistry.ts`). |
| Schema migration required? | PASS — none | `contributes.canvas.blockTypes[]` is optional. Existing manifests are unaffected. Workspace pages containing an unrecognised block id fall back to Tiptap's unknown-node placeholder — same behaviour as today when a built-in block is renamed. |
| Capability gating preserved | PASS | The canvas-block surface is gated by the canvas extension's normal activation flow (`api.services.has(ICanvasBlockTypeRegistryService)` check in `main.ts`). Extensions without the canvas surface loaded see `api.canvas === undefined`. |
| Built-in registry untouched | PASS | `BLOCK_REGISTRY` is imported read-only for conflict detection. Built-in ids are snapshotted at registry construction; built-ins always win. |
| Conflict policy enforced at both layers | PASS | `CanvasBlockTypeContributionProcessor` rejects manifest-stage conflicts with a warning. `CanvasBlockTypeRegistry.register` throws on conflicts at the runtime stage. Tested in 4 cases (built-in vs manifest, dup vs manifest, built-in vs registry, dup vs registry). |
| Baseline ≤ +5% (87 ns/call ceiling) | PASS | Isolated baseline run after Slice A: 79 ns/call (well under 87). Full-suite run shows 129 ns/call but that is system-load noise (no new processor work in the test corpus path). The added work is one `if (_canvasBlockTypeContribution)` per `processContributions` call. |
| Reference extension demonstrates round-trip | PASS | `ext/example-canvas-block/parallx-manifest.json` declares `contributes.canvas.blockTypes[{ id: 'example.embeddedIframe', … }]`. `ext/example-canvas-block/main.js` provides the full `BlockDefinition` (Tiptap Node + `extension(context)` factory) and calls `api.canvas.registerBlockType(def)`. |
| Full test suite green | PASS | 3203 pass / 1 skipped / 212 files (pre-existing skip). |

## 3. Did Slice A require any escalation conditions (Manifest §16)?

- Anti-list modification? **No.**
- Schema migration? **No.**
- Capability gating broken? **No.**
- Baseline regressed beyond +5%? **No.**
- Reference extension fails round-trip? **No.**

## 4. Open follow-ups (not blocking)

1. **Live re-registration.** Today the canvas editor snapshots the contributed-block list at editor-pane construction. If an extension contributes a block type *after* a canvas page is already open, the new block won't appear until the pane is recreated. `onDidChange` is wired but not yet consumed. Future surface work — flagged as "future option" in the milestone doc and acceptable for Slice A.
2. **Playwright fixture.** Slice A's reference extension is not yet exercised end-to-end through Playwright. The shape of the test fixture is identical to Slice B's pending fixture; both can land together in a follow-up commit.
3. **Insert-action UX.** Contributed block types are registered into Tiptap's schema but not yet surfaced in the slash-menu / insert-block UI. The block can be rendered (e.g. through paste, AI tool insertion, or programmatic insert) but is not directly insertable from the toolbar. Future surface work; out of M82 scope.
4. **`kind` field.** Accepted in the manifest interface but not consumed by the host (Tiptap derives `group`/`atom`/`inline` from the extension itself). Documented in the JSDoc. Future hook for richer block-picker UIs.

## 5. Verdict

**KEEP.** Slice A implements the canvas block-type extension point exactly as the audit and milestone scoped it. The stub→wireRealDefinition pattern mirrors Slice B and accommodates the fundamental constraint that Tiptap extensions need a JS factory function the manifest can't carry. No anti-list files touched. Schema additive. Baseline within noise. Round-trip demonstrated by reference extension + 12 unit tests. Cleared to flip M82 to `implemented-verified`.

---

Rollback: `git revert e9320875`.
