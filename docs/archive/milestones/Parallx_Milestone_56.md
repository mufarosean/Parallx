# Milestone 56 — Workspace Graph Extension + Canvas API Surface

**Date:** 2026-04-11  
**Status:** In Progress  
**Branch:** `canvas-properties`

## Vision

A force-directed workspace graph that visualizes connections across all major
data domains — files, canvas pages, AI sessions, and RAG embeddings — as an
interactive, physics-driven visualization. Users see a compact mini-graph in
the primary sidebar (after Open Editors) and can open a full-featured graph
editor with search, inspector, legend, clustering, and zoom/pan controls.

The graph is powered by the existing `tools/graph-v2` force-directed engine
(HTML5 Canvas, physics simulation), repurposed as a proper Parallx extension.

## Foundation

- **graph-v2/index.html** — Force-directed rendering with physics engine
  (repel/attract/rest/damp/grav/cpull), curved edges with arrows, cluster
  halos, search/filter, inspector panel, legend, drag/pin, zoom/pan
- **graph-v2/graph-server.mjs** — File scanner with import/export parsing,
  live updates via fs.watch
- **graph-v3/graph-server.mjs** — Variant targeting chat directory, adds
  lineCount and health badges

## Architecture

### Part 1: Core API Surface (Canvas Pages)

Extensions currently have **no way to enumerate canvas pages**. The workspace
graph needs page metadata to build the canvas domain of the graph. Rather than
having the extension query SQLite directly (fragile, schema-coupled), we add
a read-only canvas page API to the existing `parallx.workspace` namespace.

#### Core Files Changed

| File | Change | Risk |
|------|--------|------|
| `src/api/parallx.d.ts` | Add `CanvasPageInfo`, `CanvasPageTreeNode`, `CanvasPageChangeEvent` types; add `getCanvasPages()`, `getCanvasPageTree()`, `onDidChangeCanvasPages` to `workspace` namespace | Low — additive types only |
| `src/api/bridges/workspaceBridge.ts` | Accept optional canvas data service interface; implement 3 new methods that delegate to it | Low — additive, existing methods untouched |
| `src/api/apiFactory.ts` | Add `canvasDataService?` to `ApiFactoryDependencies`; pass to `WorkspaceBridge`; wire into frozen `workspace` object | Low — additive wiring |
| `src/built-in/canvas/main.ts` | Register the existing `CanvasDataService` instance on the DI `ServiceCollection` so the API factory can pick it up | Medium — touches canvas composition root |

#### API Design

```typescript
// Read-only lightweight page descriptor (no content, no revision)
interface CanvasPageInfo {
  readonly id: string;
  readonly parentId: string | null;
  readonly title: string;
  readonly icon: string | null;
  readonly isFavorited: boolean;
  readonly isArchived: boolean;
  readonly createdAt: string;
  readonly updatedAt: string;
}

interface CanvasPageTreeNode extends CanvasPageInfo {
  readonly children: CanvasPageTreeNode[];
}

interface CanvasPageChangeEvent {
  readonly kind: 'Created' | 'Updated' | 'Deleted' | 'Moved' | 'Reordered';
  readonly pageId: string;
  readonly page?: CanvasPageInfo;
}

// Added to parallx.workspace namespace:
function getCanvasPages(): Promise<CanvasPageInfo[]>;
function getCanvasPageTree(): Promise<CanvasPageTreeNode[]>;
const onDidChangeCanvasPages: Event<CanvasPageChangeEvent>;
```

**Constraints:**
- Read-only — no mutations exposed. Extensions cannot create/update/delete pages.
- No content field — page bodies are never serialized across the API boundary.
- Lightweight — only metadata needed for graph nodes and tree rendering.

### Part 2: Workspace Graph Extension

Lives entirely in `ext/workspace-graph/`. No core changes required.

| File | Purpose |
|------|---------|
| `parallx-manifest.json` | Declares view in explorer-container (order 200), editor type, commands |
| `main.js` | Extension entry point — registers sidebar view + editor provider |
| `graphDataService.js` | Collects nodes/edges from 4 data domains via `parallx.workspace` API |
| `graphPhysics.js` | Force-directed physics engine (ported from graph-v2) |
| `graphRenderer.js` | HTML5 Canvas rendering — nodes, edges, cluster halos, labels |
| `graphEditor.js` | Full editor pane: inspector, search, legend, controls |
| `graphSidebar.js` | Compact mini-graph for sidebar view |

#### Data Domains

| Domain | Source | Node Type | Edge Logic |
|--------|--------|-----------|------------|
| Files | `parallx.workspace.fs.readdir()` recursive | File nodes colored by extension | Directory containment edges |
| Canvas Pages | `parallx.workspace.getCanvasPageTree()` | Page nodes with emoji icons | Parent-child hierarchy edges |
| AI Sessions | `.parallx/sessions/` file scan | Session nodes | Session-to-page links (if referenced) |
| RAG Embeddings | Future `parallx.rag` API (deferred) | Chunk nodes | Chunk-to-source-file edges |

#### Sidebar View

- Registered in `explorer-container` at order **200** (after Open Editors @ 100)
- Compact force-directed canvas showing top-level workspace structure
- Click node → opens relevant item (file in editor, page in canvas, session in chat)
- Toolbar icon → opens full graph editor pane

#### Full Editor Pane

- Opened via `parallx.editors.openEditor({ typeId: 'workspace-graph' })`
- Full physics simulation with all controls from graph-v2
- Inspector panel: click node to see details, connections, metadata
- Search/filter: find nodes by name, type, domain
- Legend: color-coded by domain + file type
- Cluster mode: group nodes by domain or directory

## Deferred

- RAG domain (needs `parallx.rag` API — separate milestone)
- Canvas page content analysis (cross-page link detection from Tiptap content)
- Saved graph layouts / bookmarks
- Graph-based navigation (replace sidebar tree with graph-first UX)
