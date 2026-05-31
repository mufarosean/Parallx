# Canvas Robustness Audit (M85)

> Scope: the canvas note surface — block types, structural integrity, block
> movement, page linking, and properties/tagging. Goal: make canvas one of the
> strongest tools in the app — Notion-class reliability and a connected,
> relational feel. Findings are grounded in code (file:line). Fixes A and B
> follow this audit.

## What's already solid

- **Block movement is centralized.** All positional changes (keyboard + DnD)
  flow through one authority, `config/blockStateRegistry/` (blockMovement,
  blockNesting, crossPageMovement, dragSession, pageBlockDropRouting). This is
  the right shape — there isn't movement logic scattered across the codebase.
- **Columns are the gold standard.** columnList/column have *active* production
  normalization: [`columnAutoDissolve`](../src/built-in/canvas/plugins/columnAutoDissolve.ts)
  runs on every doc-changing transaction and dissolves degenerate (0/1-column)
  layouts; `columnInvariants` + `columnCreation` enforce shape on mutation.
  This is why columns behave when the others don't.
- **The property model is well-designed.** Property *definitions* are
  workspace-level with shared, colored `options`; `getPropertyUsage` and
  `findPagesByProperty` already exist ([propertyTypes.ts](../src/built-in/canvas/properties/propertyTypes.ts)).
- **The failure modes are already catalogued.** `validateCanvasStructuralInvariants`
  enumerates every structural break with a `suggestion` for each.

## Finding 1 — Composite blocks detect breakage but never repair it (P0)

`validateCanvasStructuralInvariants` knows every way the composite blocks go
wrong ([canvasStructuralInvariants.ts](../src/built-in/canvas/invariants/canvasStructuralInvariants.ts)):

| Code | Block | Break |
| --- | --- | --- |
| PX-COL-001..003 | columnList / column | <2 columns; non-column child; orphan column |
| PX-DET-001..005 | details | not exactly [detailsSummary, detailsContent]; orphan sub-nodes |
| PX-TGL-001..004 | toggleHeading | level ∉ [1..3]; not exactly [toggleHeadingText, detailsContent] |
| PX-CAL-001 | callout | empty (no block child) |
| PX-TBL-001..003 | table | no rows; first row not headers; non-row child |
| PX-PGB-001 | pageBlock | empty/missing pageId |

But the only consumer, [`structuralInvariantPlugin`](../src/built-in/canvas/plugins/structuralInvariantPlugin.ts#L21),
**bails in production** (`if (!isDevMode) return null`) and **never repairs**
(always `return null`). So outside columns, a drag/delete/paste/AI-edit that
produces an off-schema shape is *detected in theory* and *fixed never*. That is
the "use it in a way not configured and something breaks" report, exactly.

**Fix A:** a production `appendTransaction` normalizer modeled on
`columnAutoDissolve`, that turns each invariant's `suggestion` into an actual
repair: clamp toggle levels; ensure details/toggle have their required children
(dissolve to plain content when malformed, never dropping the text); insert a
paragraph into an empty callout; insert a row into an empty table; remove a
pageBlock with no target. Safe, content-preserving, runs everywhere.

## Finding 2 — Tags never join a shared vocabulary (P0)

The tag editor autocompletes from the definition's shared `options`
([propertyEditors.ts:256](../src/built-in/canvas/properties/propertyEditors.ts#L256)),
but typing a **new** tag only does `tags.push(raw)` on that page's value
([:296](../src/built-in/canvas/properties/propertyEditors.ts#L296)) — it is
**never promoted into the shared `options`**, and the default `tags` definition
ships with empty `config: {}`. So the autocomplete reads a list nothing fills:
every page's tags are an island. This is "each page does not know what tags
already exist."

**Fix B:** when a tag value is set, reconcile its entries into the `tags`
definition's `options` (assigning a stable color) so the vocabulary is shared
and autocomplete works workspace-wide; then surface the relational payoff —
"N pages tagged X → jump to them" — via the already-present `getPropertyUsage` /
`findPagesByProperty`. Tags become a connected system, not free text.

## Finding 3 — The dev-only guard should become the repair (P1, folded into A)

`structuralInvariantPlugin` stays valuable as a **dev-time assertion** (catch
regressions loudly), but the production path needs the *repairing* sibling from
Fix A. Keep detection in dev; add repair everywhere.

## Lower-priority observations (not in this pass)

- **pageBlock ↔ hierarchy:** `parent_id` is the page-tree edge; embedded
  `pageBlock` nodes mirror it. Past work closed several desync paths; Fix A's
  "remove targetless pageBlock" reduces one more. A periodic reconcile (DB
  parent_id ↔ embedded pageBlocks) is a candidate follow-up.
- **Leaf embeds** (bookmark, dataview, mathBlock, audio/video/fileAttachment,
  tableOfContents) are low structural risk — single nodes, not containers.

## Plan

1. **A — structural auto-repair** (production normalizer + dev assertion kept) — reliability.
2. **B — linked tags** (shared vocabulary + colors + cross-page navigation) — relational feel.

Both ship with unit tests.
