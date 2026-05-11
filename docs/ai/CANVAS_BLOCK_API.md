# Canvas Block API — M60 Phase δ (T3)

**Date:** 2026-04-30  
**Status:** Shipped (Phase δ)  
**Source of truth:** `docs/archive/milestones/Parallx_Milestone_60.md` §6 (Tier 3 — Canvas Depth).

Block-level addressing and queryable property substrate for the Parallx
canvas. The agent can:

- Query pages by multiple property filters (AND), with optional sort and
  group.
- Read, replace, and insert blocks by stable `blockId`.
- Cross-link blocks across pages.
- Render a live filtered list of pages inside a canvas page (dataview block).

This document is the L6 artifact for Phase δ. Implementation lives in:

- `src/built-in/chat/tools/blockApi.ts` — pure helpers.
- `src/built-in/chat/tools/blockTools.ts` — 5 chat tools.
- `src/built-in/canvas/extensions/dataviewNode.ts` — TipTap dataview node.
- `src/built-in/canvas/config/tiptapExtensions.ts` — `UNIQUE_ID_BLOCK_TYPES`
  drives stable `blockId` persistence on every block.

---

## 1. Block IDs

Every block-level node in a canvas page carries an immutable `attrs.id`
populated by [`@tiptap/extension-unique-id`][1] and persisted in the
schema-versioned `pages.content` JSON envelope.

The set of node types receiving an id is exported as
`UNIQUE_ID_BLOCK_TYPES` from `src/built-in/canvas/config/tiptapExtensions.ts`
and pinned by `tests/unit/canvasUniqueIdContract.test.ts`. Inline-only
types (`text`, `hardBreak`, `inlineMath`) intentionally do **not** receive
ids.

[1]: https://tiptap.dev/api/extensions/unique-id

### Round-trip guarantee

Block IDs survive:
- Document save → load (envelope encode/decode, see
  `tests/unit/blockApi.test.ts` "100 docs" round-trip).
- Edit cycles via `edit_block` and `insert_block_after` tools.
- Renderer reload (`canvasDataService.decodePageContentForEditor`).

### Failure mode

If the doc is corrupted (invalid JSON or non-doc shape), the renderer
auto-heals to an empty paragraph (`contentSchema.ts → emptyDoc()`).
External writers (chat tools) treat undecodable content as a hard error
rather than overwriting.

### Feature flag

`canvas.blockIds.enabled` (default **on**) — registered in
`AutonomyFeatureFlagsService` (M60 §3.8). Currently a tracking flag for
emergency rollback; the UniqueID extension itself is unconditional in the
extension list. A future toggle would require gating in
`tiptapExtensions.ts`.

---

## 2. Property query API (C1)

### Tool: `query_pages_by_property`

Permission: **always-allowed** (read-only).

```json
{
  "filter": [
    { "prop": "status", "op": "equals", "value": "Draft" },
    { "prop": "tag",    "op": "contains", "value": "research" }
  ],
  "sort":  { "by": "title", "dir": "asc" },
  "group": "tag",
  "limit": 50
}
```

Filters combine with **AND** (SQL `INTERSECT`).

| Op             | Notes                                                           |
|----------------|-----------------------------------------------------------------|
| `equals`       | Strict JSON-equals on serialized value.                         |
| `not_equals`   | Inverse of `equals`.                                            |
| `contains`     | Case-sensitive `LIKE`; `\`, `%`, `_` are escaped.               |
| `is_empty`     | Matches null / "null" / "" / [].                                |
| `is_not_empty` | Inverse.                                                        |
| `greater_than` | `CAST(value AS REAL) > ?`.                                      |
| `less_than`    | `CAST(value AS REAL) < ?`.                                      |

Sort `by` accepts `title`, `updated_at`, `created_at`, or any property
name. Limit defaults to 50, capped at 200.

The legacy single-property tool `find_pages_by_property` remains in place
for backward compatibility.

---

## 3. Block tools (C3)

### `read_block` (always-allowed)
```
{ "pageId": "<uuid>", "blockId": "<uniqueId>" }
```
Returns the block's JSON node and a plaintext rendering. Errors if the
page or block isn't found.

### `edit_block` (requires-approval)
```
{ "pageId":   "<uuid>",
  "blockId":  "<uniqueId>",
  "newContent": "...plain text...",
  "idempotencyKey": "<optional>" }
```
Replaces the block at `blockId` with a paragraph node carrying the same
`blockId`. Bumps `pages.revision` so the renderer's
`_knownRevisions` map detects the external write on next reload. The
optional `idempotencyKey` is echoed in the result for capture by the
autonomy event log (M60 §3.7).

> **Concurrency note**: `edit_block` does not coordinate with the
> renderer's optimistic-concurrency gate (`canvasDataService.updatePage`).
> If the user is actively editing the target page when an agent issues
> `edit_block`, the next renderer save can fail with
> `Revision conflict for page "<pageId>"`, and the user's draft is
> preserved. The agent should re-read the block before retrying.

### `insert_block_after` (requires-approval)
```
{ "pageId": "<uuid>",
  "anchorBlockId": "<uniqueId>",
  "content": "...plain text...",
  "idempotencyKey": "<optional>" }
```
Inserts a new paragraph block immediately after `anchorBlockId`. Returns
the freshly minted `blockId` of the new block. Cannot insert after the
document root.

### `link_block` (requires-approval)
```
{ "fromPageId":  "<uuid>",
  "fromBlockId": "<uniqueId>",
  "toPageId":    "<uuid>",
  "toBlockId":   "<uniqueId>",
  "label":       "<optional display text>" }
```
Appends a paragraph block with a markdown-style link of the form
`→ [<label>](page://<toPageId>#<toBlockId>)` immediately after the source
block. The source block itself is unchanged. Both target page and target
block are validated before write.

### Idempotency contract (M60 §3.7)

Mutating tools (`edit_block`, `insert_block_after`) accept an
`idempotencyKey`. The chat tool stamps it into the result; deduplication
across retries is owned by the chat runner / autonomy event log, not by
the tool itself.

### Budgets (M60 §3.6)

Each tool call counts as **one disk-write op** against the 100-ops/turn
cap. Read-only `read_block` and `query_pages_by_property` count as zero.

---

## 4. Dataview block (C4)

A leaf TipTap node that renders a live, filtered list of pages.

### Schema
```json
{
  "type": "dataview",
  "attrs": { "id": "<uniqueId>", "query": "<JSON-encoded IPropertyQuery>" }
}
```

`query` is a stringified `IPropertyQuery` matching the
`query_pages_by_property` shape (filter array + optional sort + optional
limit; group is honored by the chat tool but not rendered by the node).

### Insertion paths

- **Agent**: `insert_block_after` with a `dataview` node payload (custom
  agents can pass an arbitrary `content` as JSON; current first cut
  inserts a paragraph — see §6 below for the upgrade path).
- **UI**: deferred — a slash-menu entry will be added in T4 (settings UI
  surface).

### Live update contract

The current first cut re-runs the query when the editor mounts the node
view (initial render) and on `attrs.query` change. PropertyDataService
event subscriptions (re-render on `set/removed/definition deleted`) are
deferred to a follow-up; the canvas editor reload path covers most user
flows in M60.

### Feature flag

`canvas.dataview.enabled` (default **on**) — gating mechanism for
emergency rollback. The extension is unconditionally loaded; future
toggle work would gate registration in `tiptapExtensions.ts`.

### Styling

Pure `--vscode-*` token theming via `canvas.css` (`.canvas-dataview`,
`.canvas-dataview-list`, `.canvas-dataview-row`, `.canvas-dataview-empty`).
No inline styles.

---

## 5. Tests

| Path | Coverage |
|------|----------|
| `tests/unit/blockApi.test.ts` | 15 tests — encode/decode, walk, replaceAt/insertAfter, 100-doc round-trip (M60 §13 risk) |
| `tests/unit/blockTools.test.ts` | 10 tests — all 5 chat tools end-to-end against mock DB |
| `tests/unit/canvasUniqueIdContract.test.ts` | 3 tests — pins `UNIQUE_ID_BLOCK_TYPES` against drift |
| `tests/unit/dataviewNode.test.ts` | 10 tests — node config, query parser, SQL builder, render |
| `tests/unit/builtInTools.test.ts` (updated) | tool count 34 → 39, sorted name list |
| `tests/unit/chatGateCompliance.test.ts` (updated) | adds `tools/blockApi.ts` + `tools/blockTools.ts` |
| `tests/unit/gateCompliance.test.ts` (updated) | adds `extensions/dataviewNode.ts` |
| `tests/unit/autonomyFeatureFlags.test.ts` | unchanged — defaults snapshot still passes |

**Autonomy eval scenarios** (T6 runner ships in §11.3 follow-up):

| File | Tool exercised |
|------|----------------|
| `tests/autonomy-eval/canvas-query-by-property.scenario.json` | `query_pages_by_property` |
| `tests/autonomy-eval/canvas-read-block.scenario.json` | `read_block` |
| `tests/autonomy-eval/canvas-edit-block.scenario.json` | `edit_block` |
| `tests/autonomy-eval/canvas-insert-block-after.scenario.json` | `insert_block_after` |
| `tests/autonomy-eval/canvas-link-block.scenario.json` | `link_block` |

Each scenario carries `_runner_status: "TODO — runner from T6"`.

---

## 6. Known gaps (deferred)

- Slash-menu UI for inserting a dataview block (T4).
- PropertyDataService event subscription for live dataview re-render
  without page reload.
- Agent-driven dataview insertion takes the `insert_block_after` paragraph
  path; a typed `insert_block_after_dataview` variant would let agents
  compose a query attribute directly. Workaround for M60: insert a
  paragraph, then `edit_block` to swap shape — not ideal; revisit in M61.
- Multi-block `edit_block_atomic` for the "replace 3 paragraphs as one
  unit" use case. Current single-block edits are sufficient for M60 §6.3
  acceptance.

---

## 7. References

- M55 — page properties baseline (`docs/archive/milestones/Parallx_Milestone_55.md`).
- M60 §6 — Tier 3 plan.
- M60 §3.6 — budgets (100 disk ops/turn).
- M60 §3.7 — idempotency keys.
- M60 §3.8 — feature flags (`canvas.blockIds.enabled`,
  `canvas.dataview.enabled`).
- M60 §13 — round-trip risk mitigation.
