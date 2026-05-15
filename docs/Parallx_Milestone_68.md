# Milestone 68 - Semantic Workspace Graph

> **Status:** Planning - MVP scoped. This milestone is reserved for cached
> semantic links in Workspace Graph. M67 remains the separate security/data
> leakage hardening plan.

## Why

Workspace Graph currently shows structural relationships: workspace files,
Canvas page hierarchy, sessions, and extension-provided graph items. That is
useful, but it misses the "second brain" shape the user wants: two notes can be
conceptually connected even when they do not live near each other in the page
tree or filesystem.

The goal of M68 is to add **conceptual links** between existing Workspace Graph
nodes using Parallx's existing local embedding/vector index. The feature should
feel like a lightweight semantic layer over the graph, not a new AI subsystem.

Hard constraint from the user:

> Workspace Graph must not consume local-model VRAM or make chat worse. Parallx
> runs local models only; if graph rendering wakes Ollama or competes with the
> main chat model, the feature has failed.

Therefore M68 is designed around cached semantic edges:

- Background services may use already-stored vector data.
- Workspace Graph itself reads cached edges only.
- Workspace Graph must not call `IEmbeddingService`, Ollama, or any live model
  path while opening, refreshing, panning, filtering, or rendering.

## Scope

In scope for MVP:

- Semantic links between **Canvas pages**.
- Semantic links between **workspace files**.
- Semantic links between Canvas pages and workspace files.
- Cached edge table with scores and source metadata.
- Workspace Graph provider that contributes semantic edges from cache.
- Toggleable display in Workspace Graph, rendered differently from structural
  edges.
- Incremental recompute after indexing updates.
- Aggressive caps to keep graph density and CPU work small.

Out of scope for MVP:

- Displaying page blocks as graph nodes.
- Displaying page content in graph nodes.
- Full all-pairs similarity scans.
- LLM-generated labels, summaries, or explanations.
- Live semantic recompute when the graph opens.
- Semantic links for chat sessions, budget, media, or arbitrary extension nodes.
- Replacing structural edges; conceptual edges are an overlay.

## Existing pieces we can build on

| Piece | Current state |
|---|---|
| Canvas graph nodes | `ext/workspace-graph/main.js` creates `page:<pageId>` nodes from `api.workspace.getCanvasPageTree()` |
| File graph nodes | `ext/workspace-graph/main.js` creates `file:<uri>` nodes while walking workspace files |
| Provider API | `parallx.workspaceGraph.registerProvider()` already lets extensions contribute nodes/edges |
| Embedding service | `src/services/embeddingService.ts` uses local Ollama embeddings; M68 must not call it from graph paths |
| Vector store | `src/services/vectorStoreService.ts` stores `page_block` and `file_chunk` vectors in sqlite-vec |
| Indexing pipeline | `src/services/indexingPipeline.ts` already indexes Canvas pages and workspace files |
| Related content | `src/services/relatedContentService.ts` proves the semantic ranking shape, but it embeds page text as a query and should be treated as inspiration, not the graph implementation |

Important node id conventions:

| Indexed source | Graph node id |
|---|---|
| Canvas page `pageId` | `page:<pageId>` |
| Workspace file `relative/path.md` | `file:<workspaceRootUri>/relative/path.md` |

The file mapping is the first real implementation wrinkle: the vector index
stores workspace-relative paths, while Workspace Graph nodes use full workspace
URIs. M68 needs one canonical mapper so cached semantic edges point at the same
node ids the graph renders.

## Performance contract

This milestone has a stricter performance contract than a normal feature:

1. **No model calls from Workspace Graph.**
   - Graph provider snapshots only read cached rows.
   - Opening the graph must not call `IEmbeddingService.embedQuery`,
     `embedDocument`, `embedDocumentBatch`, or any Ollama endpoint.

2. **Core AI approval gate.**
   - Any change to core embedding behavior, Ollama transport/configuration,
     local model loading, chat model routing, or AI system prompts is out of
     scope unless the user explicitly approves it first.
   - M68 implementation should prefer additive helpers around stored vector
     data. Do not modify the embedding model, embedding prefixes, Ollama
     endpoints, chat model lifecycle, or AI settings defaults as an incidental
     part of this work.

3. **No all-pairs comparison.**
   - Do not compare every source to every other source.
   - For a changed source, compute one source centroid from stored vectors,
     run vector KNN, then collapse candidates into source-level edges.

4. **Incremental first.**
   - Recompute only sources whose indexed content hash changed.
   - Full rebuild is allowed only as an explicit maintenance operation or first
     cache build after M68 lands.

5. **Single low-priority worker loop.**
   - Concurrency: 1.
   - Debounced after indexing updates.
   - Use idle/yield slices so renderer work stays responsive.
   - Pause or defer while indexing is actively running.

6. **Aggressive caps.**
   - Default top semantic links per source: 3.
   - Default minimum similarity threshold: TBD, initial target 0.72.
   - Default max semantic edges contributed to graph: 500.
   - Overfetch candidates from vector search, then collapse/dedupe.

7. **Cheap graph snapshot.**
   - Provider snapshot should be a DB/cache read plus object mapping.
   - No text parsing, no embedding, no vector KNN, no file walking.

8. **User control.**
   - Workspace Graph gets a `Conceptual Links` toggle.
   - If cache is empty or stale, the graph still opens normally.

## Design

### 1. Semantic edge cache

Add a small cache table, likely through `IDatabaseService`:

```sql
CREATE TABLE IF NOT EXISTS semantic_graph_edges (
  source_node_id TEXT NOT NULL,
  target_node_id TEXT NOT NULL,
  source_type TEXT NOT NULL,
  source_id TEXT NOT NULL,
  target_type TEXT NOT NULL,
  target_id TEXT NOT NULL,
  score REAL NOT NULL,
  kind TEXT NOT NULL DEFAULT 'semantic',
  source_content_hash TEXT,
  target_content_hash TEXT,
  updated_at TEXT NOT NULL DEFAULT (datetime('now')),
  PRIMARY KEY (source_node_id, target_node_id)
);
```

Implementation detail: canonicalize undirected pairs before insert so
`page:A -> page:B` and `page:B -> page:A` do not create duplicate lines.

### 2. Source centroid from stored vectors

Add a vector-store helper that reads stored embeddings for one indexed source
and returns a normalized centroid:

```ts
getSourceCentroid(sourceType: 'page_block' | 'file_chunk', sourceId: string): Promise<number[] | undefined>
```

This avoids calling the embedding model. It uses vectors that already exist in
`vec_embeddings`.

### 3. Source-level semantic search

For a changed source:

1. Get its centroid from stored chunk embeddings.
2. Run `vectorSearch(centroid, overfetchK, sourceFilter?)`.
3. Exclude chunks from the same source.
4. Group candidate chunks by target source.
5. Aggregate score per target source.
6. Keep top N targets above threshold.
7. Convert source ids to graph node ids.
8. Upsert canonical semantic edges into the cache.

Initial candidate policy:

- Pages can link to pages and files.
- Files can link to pages and files.
- Ignore `_system` and non-indexed sources.
- Ignore target nodes that cannot be mapped.

### 4. Background service

Add a small `SemanticGraphService`:

```ts
interface ISemanticGraphService {
  readonly onDidChangeEdges: Event<void>;
  ensureCacheStarted(): void;
  scheduleSource(sourceType: 'page_block' | 'file_chunk', sourceId: string): void;
  rebuildChangedSources(): Promise<void>;
  getCachedEdges(options?: SemanticGraphEdgeOptions): Promise<SemanticGraphEdge[]>;
}
```

Suggested dependencies:

- `IDatabaseService`
- `IVectorStoreService`
- `IIndexingPipelineService`
- `IWorkspaceService`

Avoid dependency on:

- `IEmbeddingService`
- chat services
- language model services

The service listens to indexing/vector-store updates and schedules low-priority
edge recomputation:

- `IIndexingPipelineService.onDidIndexSource`
- or `IVectorStoreService.onDidUpdateIndex`
- plus initial cache pass after `isInitialIndexComplete`

### 5. Workspace Graph provider

Add a provider that contributes only semantic edges:

```ts
api.workspaceGraph.registerProvider({
  id: 'parallx.semantic-links',
  displayName: 'Conceptual Links',
  async snapshot() {
    return {
      nodes: maybeMissingFileNodes,
      edges: cachedEdges.map(edge => ({
        source: edge.sourceNodeId,
        target: edge.targetNodeId,
        kind: 'semantic'
      }))
    };
  }
});
```

Open design question: this provider can live inside `ext/workspace-graph` if
there is a cheap API to read cached semantic edges, or in a new built-in
semantic graph extension/service that registers with `workspaceGraph`.

Preferred direction:

- Core service owns cache and recompute.
- Workspace Graph extension owns rendering/toggle/styling.
- A small API/command bridge exposes cached semantic edges without exposing
  vector-store internals to ordinary extensions.

### 6. Graph rendering

Semantic edges should be visually distinct:

- Fainter than structural edges.
- Optional dashed line or different alpha.
- Lower force strength than structural edges so conceptual links do not
  violently rearrange the graph.
- Hidden when `Conceptual Links` is off.

Suggested edge metadata:

```ts
{
  source: 'page:...',
  target: 'file:...',
  kind: 'semantic',
  score: 0.82
}
```

`GraphProviderEdge` currently supports `kind` only. M68 may extend it with an
optional `score` or `weight` field if the renderer needs graded styling.

## Plan / sequencing

### Iteration A - Cache foundation

1. Add semantic edge DB schema.
2. Add source-id to graph-node-id mapper:
   - page: `page:<pageId>`
   - file: `file:<workspaceRootUri>/<relativePath>`
3. Add vector-store helper for stored source centroids.
4. Add `SemanticGraphService` with `getCachedEdges()` and no automatic
   recompute yet.

**Verification:**

- Unit test centroid calculation from fake stored embeddings.
- Unit test file/page node-id mapping.
- Unit test cache upsert dedupes canonical pairs.
- Test fake `IEmbeddingService` is never required.

### Iteration B - Incremental semantic edge builder

1. Listen to indexing updates.
2. Debounce and enqueue changed `page_block` / `file_chunk` sources.
3. For each changed source, compute top related sources from stored vectors.
4. Store top 3 edges above threshold.
5. Delete stale edges when a source disappears or no longer has vectors.

**Verification:**

- Unit test one changed source recomputes only its edges.
- Unit test self-matches are excluded.
- Unit test all-pairs scan is not used.
- Unit test source hash skip avoids recompute when unchanged.

### Iteration C - Workspace Graph integration

1. Register semantic edge provider.
2. Add Workspace Graph `Conceptual Links` toggle.
3. Read cached semantic edges only in provider snapshot.
4. Add semantic edge styling and lower force strength.
5. Add missing indexed file nodes if needed for files outside the current
   Workspace Graph file-walk depth.

**Verification:**

- Opening Workspace Graph with semantic links on does not call embedding APIs.
- Opening Workspace Graph with semantic links off produces current graph output.
- `node --check ext/workspace-graph/main.js`.
- Targeted unit tests for provider snapshot shape.

### Iteration D - Bake and tune

1. Tune threshold/top-N defaults on real workspaces.
2. Add lightweight diagnostics:
   - cached edge count
   - last build time
   - queued source count
   - skipped source count
3. Add a manual "Rebuild conceptual links" command.
4. Document the feature in `USER_GUIDE.md` if it stays enabled.

**Verification:**

- Manual: two related Canvas notes in different branches get a faint semantic
  edge.
- Manual: related file/page pair gets a faint semantic edge.
- Manual: graph remains responsive on a medium workspace.
- Manual: chat model performance does not degrade when graph opens.

## Acceptance criteria

M68 is complete when:

1. Workspace Graph can display semantic links for Canvas pages and workspace
   files.
2. Semantic links are optional and visually distinct from structural links.
3. The graph provider reads cached semantic edges only.
4. No Workspace Graph path calls `IEmbeddingService` or Ollama.
5. No core embedding, Ollama, chat model, or AI system behavior is changed
   without explicit user approval.
6. Recompute is debounced, incremental, and concurrency-limited.
7. Semantic edges are capped by threshold, per-node top-N, and max total graph
   edges.
8. Files and pages use stable node ids compatible with existing Workspace Graph
   nodes.
9. Tests prove self-links, duplicates, stale edges, and embedding-service calls
   are handled correctly.

## Risk register

| Risk | Mitigation |
|---|---|
| Graph opens slowly | Provider reads cache only; no vector search in snapshot |
| Ollama/VRAM contention | No `IEmbeddingService` dependency in graph/cache builder; use stored vectors |
| Visual spaghetti | Top 3 per source, threshold, max total edge cap, toggle |
| File node mismatch | Central mapper from indexed relative path to graph `file:<uri>` id |
| Deep files not visible | Provider may contribute lightweight missing file nodes for indexed files |
| Stale semantic links | Store source/target content hashes and recompute/delete after index updates |
| Renderer jank during rebuild | Single queue, idle/yield slices, debounce, pause while indexing |
| Duplicate undirected edges | Canonical pair key before insert |

## Open decisions

1. Should `Conceptual Links` default on or off during the first release? Lean:
   off for bake, then on once cache behavior is proven.
2. Should semantic edges affect force layout, or render as overlay-only lines?
   Lean: weak force, because conceptual proximity should gently shape the graph.
3. Should files deeper than Workspace Graph's current file-walk depth be added
   as provider nodes? Lean: yes for indexed files that participate in cached
   semantic edges.
4. Should settings expose threshold/top-N immediately, or keep constants for
   MVP? Lean: constants first, diagnostics before knobs.
5. Should edge labels/reasons exist in MVP? Lean: no. Scores are enough.

## Files to create / modify

| File | Action |
|---|---|
| `src/services/semanticGraphService.ts` | new cached semantic edge service |
| `src/services/serviceTypes.ts` | add `ISemanticGraphService` and vector-store helper types |
| `src/services/vectorStoreService.ts` | add stored source centroid / source vector helper |
| `src/workbench/workbenchServices.ts` | register semantic graph service |
| `src/api/apiFactory.ts` | expose a minimal cached semantic graph read bridge if Workspace Graph needs it |
| `src/api/parallx.d.ts` | type any new bridge surface |
| `src/api/bridges/workspaceGraphBridge.ts` | optionally extend edge shape with `score` / `weight` |
| `ext/workspace-graph/main.js` | provider integration, toggle, semantic styling |
| `tests/unit/semanticGraphService.test.ts` | new service tests |
| `tests/unit/vectorStoreService.test.ts` | centroid/helper coverage |
| `tests/unit/workspaceGraphSemanticProvider.test.ts` | provider snapshot/no-embedding guard |
| `docs/USER_GUIDE.md` | document after bake, if enabled |

## Progress tracker

| Iteration | Status | Verification | Notes |
|---|---|---|---|
| A - Cache foundation | pending | - | - |
| B - Incremental builder | pending | - | - |
| C - Workspace Graph integration | pending | - | - |
| D - Bake and tune | pending | - | - |
