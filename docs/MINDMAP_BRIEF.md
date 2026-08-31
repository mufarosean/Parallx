# Mindmap Brief — the AI drafts it, you shape it

Written 2026-08-30. The goal in Mufaro's words: mindmaps *the AI can
create and the user can easily edit* — and connecting **ideas, not
files**. The canonical example: Taylor's stochastic reserving models
drawn as a map, with the two over-dispersed models visibly sitting
inside the EDF family. A picture of an argument sticks where a stack of
paragraphs does not. This is deliberately NOT the semantic workspace
graph (M68), which connects documents.

---

## Where it lives — the candidate homes, measured

The instinct was to reuse the dashboard rather than force this into
canvas. Measured against the code:

**(a) Mindmap elements ON the dashboard, with arrows between them.**
Grounded fact: the dashboard is a 12-column grid —
`DASHBOARD_GRID_COLS = 12`, `WidgetPlacement` is `col`/`colSpan`, drags
snap to cells. Free arrows between grid seats means replacing the
dashboard's layout engine, and a mindmap arranged on a 12-column lattice
is not a mindmap. This is a rebuild wearing a reuse costume — not an
add-on.

**(b) The whole mindmap inside ONE dashboard widget.** Fits today's
model (a widget can span all 12 columns), but dashboard widgets are
`cachedOutput` + refresh-policy consumers — presentation cells, not
editable documents. Editing a map inside a card is the cramped version
of the thing.

**(c) A canvas block.** Printable via the custom-block snapshot contract
(CUSTOM_BLOCK_BRIEF.md), but a large map fights the page column, and the
point of a map is room.

**(d) The database pattern.** Its own document type with its own
full-pane editor, embeddable in a canvas page as an inline card, and
surfaceable on the dashboard as a widget. This is the app's established
answer for exactly this shape of content — databases already live this
triple life (full editor pane / inline canvas card / dashboard
presence).

**Recommendation: (d).** The dashboard instinct survives as the third
face of it — a map CAN sit on your dashboard — without rebuilding the
dashboard's grid. And the canvas gets the map as an embedded card with a
print snapshot, without the map being trapped in a page.

**Decided 2026-08-30: the mindmap is its own editor.** The inline canvas
card and the dashboard widget follow as later faces, per D1.

---

## The contract

- **Data model:** nodes (rich-text label, optional reference to a page /
  block / flashcard / database row), typed edges (`is-a`, `part-of`,
  `leads-to`, untyped), positions, per-map styling. Workspace SQLite,
  same citizenship as pages.
- **The AI drafts, the human shapes.** AI tools write nodes and edges;
  **layout belongs to the user.** Auto-layout runs on the first draft
  only (radial/tree); after that a regenerate may add, relabel, or
  re-link, but must never move what you placed — the same
  refresh-without-clobbering rule as the custom block.
- **Easy editing is the bar**, and it is outliner keys, not palette
  ceremony: double-click to edit a node, `Tab` adds a child, `Enter`
  adds a sibling, drag a node to re-parent, drag empty space to pan,
  wheel to zoom. If making a five-node map takes longer than typing five
  bullets, the feature failed.
- **Nodes can point at real content.** A node holding a reference gets
  click-through and hover preview; a node can be promoted to a
  flashcard (page-grounded, like canvas capture). Connecting ideas does
  not preclude anchoring an idea to its source.
- **Print/export:** every map renders to an SVG snapshot. The canvas
  inline card shows the snapshot (custom-block contract); PDF export and
  markdown export consume it.

## Built on the shared node canvas

See WORKFLOWS_BRIEF.md, *One canvas, two tenants*: one pan/zoom
node-canvas primitive in core UI, no domain knowledge, used by this
editor and by the workflow editor. **The mindmap ships first** — it is
the cheaper tenant (no ports, no runner, no arbiter) and it debugs the
canvas so the workflow editor doesn't debut on the app's most ambitious
feature.

## Later, explicitly not v1

- **Recall mode** — hide the labels, re-place them from memory, grade
  the topology. Turns the map into a study mechanic. Parked until the
  editor is loved.
- Multi-map transclusion (a node that is another map).
- Workflow integration: a workflow action node that writes a draft map
  for tomorrow's topic.

## Decisions (Mufaro's)

**Status (2026-08-30): D1–D3 decided — recommendations accepted.**

**Face 1 SHIPPED 2026-08-30 (same day):** the full-pane editor
(`mindmap/mindmapEditorPane.ts` over `ui/nodeCanvas.ts`), the data layer
(migration 014, `mindmapDataService.ts` — a mindmap IS a page), both AI
doors (`ai/mindmapTools.ts`: mindmap_create/add/read + the Draft With AI
button over the inline provider), the `/mindmap` slash command, sidebar
and pageBlock-card routing, and the SVG snapshot renderer (Copy As SVG;
`mindmapSvg.ts` is what the inline card will consume). 47 behavioural
pins across model/canvas/service/pane suites. Verified by tests, tsc and
build only — the eyes-on pass is owed. Faces 2 (inline canvas card) and
3 (dashboard widget) remain.


**D1 — v1 scope.** Recommendation: the full-pane editor + AI draft tools
first; the canvas inline card second; the dashboard widget third. Each
face ships alone.

**D2 — Edge types.** Start with a small fixed set plus untyped, or
free-text labels? Recommendation: free-text labels rendered on the edge,
with no schema — maps are for thinking, and a type picker is ceremony.

**D3 — Where AI drafting lives.** A chat tool ("map this page / these
models"), a button in the editor, or both? Recommendation: both doors,
one implementation.
