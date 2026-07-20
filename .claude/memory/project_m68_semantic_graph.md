---
name: project-m68-semantic-graph
description: Milestone 68 - Semantic/conceptual edges in Workspace Graph using cached vector data
metadata:
  type: project
---

M68 adds conceptual (semantic) links to Workspace Graph using Parallx's existing local vector index. Status as of 2026-05-15: Iterations A–C complete, D in progress.

**M88 OVERHAUL (2026-07-20, complete — docs/Parallx_Milestone_88.md):** Mufaro's verdict "fails meaningful connections / no cross-file-type links / redundancies". Root causes found + fixed: (1) flat minScore 0.72 at read killed lineage (written at confidence ≥0.55) + co-occurrence edges → now per-kind floors (KIND_MIN_SCORE in semanticGraphService) + fair merge under the cap (per-kind quota, cosine can't crowd out lineage); caller minScore now tightens ONLY similar-to. (2) meaning kinds defaulted OFF → ON w/ sticky migration `meaningKindsDefaulted`. (3) whole-doc centroid smear → segment pass (getSourceChunkVectors ≤12 sampled, max-aggregated). (4) cross-type: references now = parallx URIs 1.0 + md links 1.0 (resolved vs linking file's folder) + [[wiki]] 0.9 + title MENTIONS 0.8 (getSourceTitles = ONE grouped query; page titles from chunk context prefixes). (5) mindmap viewMode (pages+concepts+connected files, no tree/sessions) + toolbar AI Refresh. (6) `_normalizeGraphNodeId` comparison-only dedup (Windows case/sep/encoding) — provider dupes become edge ALIASES; never rewrite stored ids. Ext-JS functions are testable via source-extraction pattern (workspaceGraphNodeDedup.test.ts, same as mediaOrganizerSelection).

**Why:** Workspace Graph shows structural relationships but misses conceptual similarity between notes. Hard constraint: graph must not consume VRAM or degrade chat — local Ollama only, so graph paths must never call IEmbeddingService.

**How to apply:** Any work touching Workspace Graph or semantic edges must respect the no-embedding-from-graph constraint. Provider reads cache only. Background recompute is single-queue, debounced, low-priority.

## Iteration status
| Iter | Status | Description |
|------|--------|-------------|
| A | complete (2026-05-15) | DB schema (`semantic_graph_edges`), source↔node mapper, vector-store centroid helper, SemanticGraphService with getCachedEdges() |
| B | complete (2026-05-15) | Incremental builder: listens to indexing updates, debounces, enqueues changed sources, stores top-3 edges above threshold, deletes stale |
| C | complete (2026-05-15) | Workspace Graph provider, `Conceptual Links` toggle, faint dashed semantic edges, weak force, rebuild command |
| D | in progress (2026-05-15) | Sticky node selection, connection inspector, semantic-cluster coloring; bake/tune ongoing |

## Key files
- `src/services/semanticGraphService.ts` — new service (cache + recompute)
- `src/services/vectorStoreService.ts` — added stored source centroid helper
- `src/services/serviceTypes.ts` — ISemanticGraphService types
- `src/workbench/workbenchServices.ts` — service registration
- `ext/workspace-graph/main.js` — provider, toggle, semantic styling
- Tests: `tests/unit/semanticGraphService.test.ts`, `tests/unit/vectorStoreService.test.ts`, `tests/unit/workspaceGraphSemanticProvider.test.ts`

## Performance contract
- No model calls from Workspace Graph paths
- No all-pairs comparison; use centroid + KNN
- Incremental only (skip unchanged content hashes)
- Concurrency: 1 worker loop, debounced, pauses while indexing runs
- Caps: top-3 per source, threshold ~0.72, max 500 edges total

## Node id conventions
- Canvas page → `page:<pageId>`
- Workspace file → `file:<workspaceRootUri>/<relativePath>`
- Central mapper handles relative-path ↔ full URI translation

## Open decisions (as of doc)
- Conceptual Links default: off during bake, then on
- Semantic edges: weak force (not overlay-only)
- Deep indexed files: contribute as provider nodes if in cached edges
- Settings knobs: constants first, diagnostics before exposing to user
- Edge labels: no (scores only for MVP)
