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

## Progress, and a resequencing decision (2026-08-24)

**Done — the outer surgery:**

1. The body is ONE grid (`42b84b82`). `Layout` owns a `SurfaceTree`; sidebar,
   editor column and panel are positions in its grid; the default shape is
   data (`defaultLayoutState`); toggles, zen, reset, restore and
   `part.resize` are re-cut over view ids via `Grid.resizeView`. The
   editor-column adapter, the second grid and every sash index are gone.
   Two latent defects fixed along the way: bare `layout()` rescales all
   children proportionally (showing the aux bar used to squeeze the
   sidebar), and the size tracker raced programmatic mutations (restoring
   a maximized panel was a silent no-op in the old code too).
   First-ever unit coverage for this layer: `workbenchLayout.test.ts`.
2. Part positions persist and move (`23e0e18d`). The saver writes the real
   body tree; restore validates strictly (old saves fall through to the
   legacy path); `movePartToEdge` + seven palette commands put the sidebar
   on either edge and the panel anywhere. Drag-and-drop for the same moves
   is deferred to an eyes-on session — commands are the capability, the
   drag is polish.

**Deferred, deliberately — the editor dissolution.** Reading EditorPart in
full changed the cost/benefit: its group coordination (merge targets,
auto-close, cross-group drops, watermark) is sound and grid-agnostic, and
the payoff of moving groups into the body tree only truly lands when TABS
become surfaces — while the surgery risks exactly the flows that cannot be
verified without opening the app (pane chrome CSS keyed to the part class,
drop overlays, flat-snapshot restore). It stays a separate, eyes-on step.

**Design decided for that step, recorded now:** once groups live in the
body tree, "the editor area" must survive as an ADDRESSABLE position — the
panel splits below it, resize flexes it, drops can target it empty — but
canonical-tree rules collapse one-child branches. The answer is a generic
tree feature, not a typed slot: NAMED, KEEP-ALIVE BRANCHES. A region is a
branch with an identity that survives having one (or zero) children; the
grid's collapse rules skip it, arrangements serialize it, and any region
can use it. `resizeWithFixedViews` and `splitView` learn to target branch
ids. That keeps Decision 3 honest — one tree, no special cases — while
giving regions a name.

## Phase A design — containers are citizens, rails are stacks (2026-08-24)

Decided in use, not in theory: moving the primary sidebar moved a SHELL,
and the shell owned every tool inside it. The shell was never the thing
the user meant. These are the decisions, made by Mufaro:

- **The unit of dragging is the VIEW CONTAINER** — Explorer as a whole,
  Search as a whole, an extension's sidebar UI as a whole. Views inside a
  container stay its internal business.
- **A container lives in one of three places:** docked in the LEFT rail,
  docked in the RIGHT rail, or DETACHED as a free box in the body grid.
  The rails keep today's convenience: many tools, one slot, one showing.
- **Icons follow the rail.** A right-docked container's icon lives in a
  RIGHT activity bar — clicking the left ribbon for a right sidebar is
  awkward, so the ribbon is part of the rail, not global chrome. Detached
  (middle) containers keep their icon in the PRIMARY (left) ribbon, which
  acts as reveal/focus.
- **The icon IS a handle.** Dragging an icon to the other ribbon moves the
  container to that rail. Dragging the container's window does the same;
  both gestures are the same move.
- **Panel tabs detach too.** The panel is the same kind of stack with tab
  chrome; a tab dragged out becomes a box like any other.

The stack concept this implies is the same one the editor area needs
(groups = stacks of documents with tab chrome); phase B folds the editor
into it. Phase A ships the container layer: rails as stacks of container
surfaces, dual ribbons, detach/dock by drag, all persisted with the body
tree.

## Phase A shipped (2026-08-24)

All three slices, each a working app:

1. **Rails and ribbons** (`ae88e2cd^^`): a right activity bar flanks the
   grid; icons live in the ribbon of the rail their container is docked
   in; dragging an icon to the other ribbon moves the container itself —
   DOM, icon, active-state bookkeeping and builtin-origin all travel.
   Chat gets a right-ribbon icon; the aux bar stops being an unswitchable
   chat cubby. `WorkspaceState.containerRails` persists placement, applied
   pending-style to containers whose tools activate after restore.
2. **Floating boxes** (`78353203`): a container dragged into the grid
   becomes a box (header = title + grip + dock-back), stable id
   `container:<id>` riding the body-tree persistence. Waiting shells keep
   a restored box's place until its tool arrives; a box whose leaf did
   not survive a tree restore re-docks its container. Center-drop on a
   rail card means JOIN; the floating icon stays on the primary ribbon as
   reveal.
3. **Panel tabs detach** (`ae88e2cd`): a panel view floats wrapped as
   `panelview:<id>` through the same pipeline; docking back returns it to
   the panel strip.

Still open for phase B: the editor area as a stack of the same citizens
(the deferred eyes-on step), rail-dock for detached panel views, a
context-menu route for every drag gesture, and folding container
placement into arrangements proper when surfaces and containers merge.

## Field directives — called out 2026-08-24, queued (NOT started)

Mufaro called these out from live use; documented verbatim-in-spirit
before any design. A separate feature discussion comes first; the work
session after it runs WITHOUT Playwright (no visible probes while the
machine is in use for gaming — the standing no-visible-probes rule, no
exception window tonight).

1. **Saved layouts, switchable in Settings.** The user can save the
   current layout under a name and switch between saved layouts from
   Settings. This is the arrangements story (FOUNDATION.md decision 4:
   arrangements are first-class) finally surfacing as UX: the
   ArrangementStore exists and is inert; what is missing is capture/apply
   wired to the LIVE body tree (which now includes container boxes and
   rails, not just surfaces) and a Settings surface to manage them.
   Design questions to settle when work starts: what an arrangement
   captures today (body tree + rails + hidden-area memory?), collision
   with the workspace's own layout persistence, and whether switching is
   also offered outside Settings (the palette carries commands anyway,
   but Settings is the required home).

2. **Right ribbon is a mirror, not a copy.** The right activity bar's
   active-icon ACCENT must sit on the RIGHT side (flipped from the left
   ribbon), and a visible border must separate the right ribbon from the
   sidebar content it flanks. Chrome polish, but it is the difference
   between "a second ribbon" and "the same ribbon reflected".

3. **A part stacked into a rail area gets a ribbon icon.** When the
   PANEL moves into the secondary sidebar area (stacked with it), an
   icon for it appears in the right ribbon; same for the primary
   sidebar side. Today only view containers have ribbon icons — parts
   that join a rail's column are invisible from the ribbon. Wants a
   design pass: what the icon reveals/toggles (the part's slot in that
   stack), what happens on click-when-visible (collapse like a
   container icon?), and how it keys off areaOf so the icon appears
   from GEOMETRY (the part occupying the rail's area), not from which
   gesture put it there.

4. **BUG: one-axis resize dirties BOTH axes of container content.**
   Seen on several surfaces (screenshots: the Activity box spilling well
   past its slot, over the panel row and status bar). Resizing along one
   axis changes the container's size on the OTHER axis too, and content
   spills outside its cell; resizing the other axis afterwards settles
   it, which smells like one layout path writing a stale cross-axis size
   (or skipping cross-axis reclamp) that only heals when that axis gets
   its own pass. NOT limited to the window being resized: ADJACENT
   windows spill too — a neighbour's content breaks from someone else's
   drag, so the bad write happens wherever the layout pass touches, not
   just at the drag target. Suspects to check when work starts:
   _doLayout's measured-vs-handed sizes during sash drags, ContainerBox.layout
   pinning both dimensions while the ViewContainer inside self-measures,
   and _distributeWithFlex normalization only running on the dragged
   axis. Reproduce with a window resize + a floated box before touching
   anything.

## Feature: workbench widgets — the smallest citizen (decided 2026-08-24)

Dashboards work, but in the mounted foundation they read as a container
inside a container. The step further: WIDGETS AS WORKBENCH CITIZENS —
the app's own form becomes user-composable. Dashboards stay exactly as
they are for now; the redundancy dissolves later on its own once a
dashboard is just one host of many.

**Architecture (agreed):**
- ONE widget system, MANY hosts. The dashboard's registry (widget types,
  renderers, look/border customization, the AI refresh runner with the
  ephemeral-rail invariants) IS the widget system; the workbench becomes
  its second host. No forked renderers — a clock renders identically in
  a dashboard cell and the sidebar.
- One INSTANCE, many possible seats. A widget instance (type + config +
  look) lives in a workspace store independent of placement. Seats:
  (a) standalone grid cell — `widget:<instanceId>` leaf riding the same
  validation/factory path `container:` leaves use, so seams, drag zones,
  edge stamps, area toggles, saved layouts, and body-tree persistence
  all apply with no new layout machinery; (b) inline in a container —
  wrapped as a view/section in a stacked sidebar container. Moving
  between seats RE-SEATS the same instance; never re-instantiate (the
  idempotent-createElement law). Delete removes instance + seat.
- Drag vocabulary gains WIDGET_DRAG_TYPE; drops reuse the existing zone
  machinery.

**Decisions made by Mufaro:**
1. Creation: ALL THREE routes — drag a widget out of a dashboard onto
   the workbench; "Add Widget" in the right-click placement menus; a
   palette command.
2. Standalone chrome: CHROMELESS card — the widget in a seam-respecting
   card wearing its own look/border customization, with a hover-revealed
   grip strip + ⋯ menu for drag/placement/delete. No 35px header.
3. V1 scope: ALL registered widget types (clock, images, AI widgets,
   contributed) — renderers and refresh runner are reused, and features
   ship complete, not as MVPs.

**Invariants to honour:** widget look customization is kept; AI-widget
refresh goes through the SAME runner (sendRequest never rejects —
inspect errorDetails; session.origin set; timeout + model stamping;
scheduler backoff); tokens only, no hex; Title Case labels; one
dropdown.
