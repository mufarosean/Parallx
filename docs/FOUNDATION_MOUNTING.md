# Mounting the tree — the map before the surgery

The companion to FOUNDATION.md, written before migration step 3 (mount the
SurfaceTree, delete the Parts) is attempted. Everything below was verified
against the code on 2026-08-24; file references are to the working tree at
that date. The foundation layer (src/surfaces/) is complete, tested and
INERT — nothing in src/ imports it yet. This document records what the
mounting step must replace, the couplings it must break, and the decisions
that have to be made deliberately rather than discovered mid-rewrite.

## What the workbench actually is today

Not one grid, and not even two. The outer workbench is a FLEX COLUMN
(`#workbench`) containing three live Grid instances plus three parts mounted
outside any grid:

```
#workbench                      flex column          (workbench.css:64)
├─ titlebar                     appended directly    (layout.ts:209)
├─ .workbench-middle            flex row             (layout.ts:194)
│  ├─ activity bar              appended directly    (layout.ts:199)
│  └─ _hGrid  Horizontal        Grid #1              (layout.ts:184)
│     ├─ sidebar (Part)
│     ├─ _editorColumnAdapter   hand-rolled IGridView (layout.ts:237-267)
│     │  └─ _vGrid  Vertical    Grid #2              (layout.ts:172)
│     │     ├─ editor (EditorPart)
│     │     │  └─ EditorPart._grid  Grid #3          (editorPart.ts:150)
│     │     └─ panel (Part)
│     └─ auxiliary bar (Part, on demand)
└─ status bar                   appended directly    (layout.ts:215)
```

`_editorColumnAdapter` exists only because two grids must be nested by hand.
In the one-grid model it disappears, along with every index-hardcoded sash
special case in `_wireGridHandlers` (layout.ts:311-424: sidebar is sash 0 of
hGrid, aux is `childCount - 2`, panel is sash 0 of vGrid).

`Part` already implements both `IPart` and `IGridView` (part.ts:19) — that
dual identity is the natural bridge onto `ViewSurface`/`SurfaceGridView`.
`PartPosition` (partTypes.ts:27) encodes positions but NOTHING reads it;
placement is the call order in `_initializeLayout`. It was always decorative.

## The finding that shrinks the risk: editor layout is not persisted

`EditorPart.serializeGroups()` has zero callers. What persists is a FLAT
snapshot — groups as ordered lists of editors (`workspaceTypes.ts:144-169`),
no orientation, no sizes, no tree — and restore rebuilds every group as
`addGroup(prev, GroupDirection.Right)` (workbench.ts:1619): a vertical split
is silently lost across restarts TODAY. `SerializedLayoutState.editorGrid`
is written by nobody and read by nobody. The `layout` field itself is
regenerated from `createDefaultLayoutState()` on every save
(workbench.ts:1735) — the live outer grid is never serialized either.

Consequence: deleting EditorPart's grid loses nothing that survives a
restart now, and arrangements are strictly more faithful than what exists.
The persistence to replace is one flat snapshot, not a serializer.
`LayoutRenderer` (layoutRenderer.ts) is dead code from the same aspiration —
constructed once, never called; its `_clearContainer` would wipe the real
container if used as-is.

## The couplings the mount must break, in full

1. **`Layout`'s protected part fields** (`_sidebar`, `_panel`, `_editor`, …
   layout.ts:86-92) — read throughout workbench.ts.
2. **`WorkbenchContributionHandler`** (workbenchContributionHandler.ts:33-42)
   — the densest one: holds live parts, four container maps keyed by region,
   casts to `AuxiliaryBarPart` for `viewContainerSlot`, dispatches on
   location strings ('sidebar' | 'panel' | 'auxiliaryBar'), and
   `layoutContainers` takes one positional argument PER REGION.
3. **`WorkbenchLike`** (structuralCommandTypes.ts:14-72) — the command
   layer's contract exposes `_hGrid`, `_vGrid`, `_sidebar`,
   `_sidebarContainer` etc. as public API; `layout.reset` calls
   `w._hGrid.addView(w._sidebar, 202)` directly (structuralCommands.ts:88).
4. **`ILayoutService`'s `LayoutHost`** names `_hGrid`/`_vGrid` in its
   interface (layoutService.ts:16-17). External consumer:
   `chat/main.ts:2915` asks `layout.isVisible('workbench.parts.auxiliarybar')`.
5. **`FOCUS_CYCLE_ORDER`** is a literal array of the seven PartIds
   (focusCommands.ts:17-24).
6. **Raw `'workbench.parts.*'` strings** in ten more files (viewsBridge:75,
   contextKey:110, whenClause:11, viewContribution:572, parallx.d.ts:161…).
7. **`WorkspaceSaver`** iterates the literal seven-part array
   (workbench.ts:1713, workspaceSaver.ts:165).
8. **`EditorGroupService` / `EditorService`** are constructed with the
   concrete EditorPart (workbench.ts:2351-2357).

## Hazards found by inspection, to be decided BEFORE mounting

- **M101 retention cap scope.** `MAX_RETAINED_PANES = 7` is per GROUP
  (editorGroupView.ts:56); three splits mean up to 21 live panes. When
  groups become tree nodes, "per group" stops meaning anything. Options: a
  global cap (regression for split-heavy use), per-node caps (unbounded), or
  a global budget scaled by visible leaves. Recommendation: retention moves
  up to the surface layer with ONE global budget (start at 15), never
  evicting visible or active surfaces — the eviction fallback maps onto
  `ISurface.saveState()`, which is what it already is under another name.
- **Chrome-math CSS coupling.** `_showActiveEditor` re-layouts revealed
  panes with constants (`PANE_CONTAINER_CHROME_X = 18`) that must match CSS
  selectors keyed to the part class `part-workbench-parts-editor`
  (editorGroupView.ts:41-48). When the editor stops being a Part that class
  disappears and panes silently clip. The pane container styling must move
  to a surface-scoped class in the same change, or the constants die with a
  measured layout.
- **Retention semantics line up already**: hide-not-dispose is exactly what
  `SurfaceGridView.setVisible` and `Grid.moveView` guarantee. No conflict in
  principle; only the cap scope and the CSS above.
- **Naming collision**: `src/workbench/surfaces/`, `src/services/surfaces/`,
  `surfaceRouterService.ts` and `openclawSurfacePlugin.ts` all use "surface"
  for the M58 openclaw delivery-channel concept, unrelated to
  `src/surfaces/`. Greps during the mount must exclude them.

## Persistence during and after the mount

Arrangements replace `WorkspaceState.layout` + `parts[]` + `editors`
wholesale; `views[]`/`viewContainers[]` survive only through the transition.
The store (arrangementStore.ts) writes through `IWorkspaceStorageService`
(the same file-backed `.parallx/workspace-state.json` mechanism as the
`'workbench'` key), keys `surfaces.arrangements` + `surfaces.activeArrangementId`.
The home arrangement (`HOME_ARRANGEMENT_ID`) is the deterministic landing
shape; a workspace without one falls back to last-shape, exactly as today.
Export/import mirrors `workspace.exportToFile` (workspaceCommands.ts:251):
save dialog, boundary check, pretty JSON.

## Order of the surgery

Small reviewable changes, each leaving a working app, roughly:

1. Introduce the tree MOUNTED BESIDE the parts, empty and hidden — plumbing
   and lifecycle only.
2. Move the editor area in: editor groups become surfaces (EditorPaneSurface
   exists), EditorPart's grid deleted, retention re-scoped per the decision
   above. The flat editor snapshot importer becomes an arrangement builder.
3. Sidebar/panel/aux content in: view containers become surfaces
   (ViewSurface exists); WorkbenchContributionHandler's region dispatch
   collapses to placement hints.
4. Delete the Parts, `_editorColumnAdapter`, `_wireGridHandlers`'s sash
   indices; `WorkbenchLike` and `LayoutHost` re-cut over the tree; focus
   cycle becomes tree order; toggles become arrangement operations.
5. Wire `SurfaceActivityTap` to the journal; arrangements get commands,
   the switcher, and home-on-launch.

Steps 2-4 cannot be fully verified without opening the app. They should
land when the app can actually be opened between them — which is exactly
why the foundation was built and reviewed inert first.
