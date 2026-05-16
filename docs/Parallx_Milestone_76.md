# Milestone 76 — Mind Map Workspace Graph

> **Status:** Planning. Depends on M68 cached-edge infrastructure remaining
> intact. Sequenced after M70–72 in the roadmap.

## Why

M68 added "conceptual links" to the Workspace Graph but the underlying signal
is purely cosine similarity between text embeddings. That measures topical
vocabulary overlap, not semantic relationship. As a result the conceptual
links the user sees do not feel like the connections their brain actually
makes between ideas.

Concrete failures of the current model:

- **Lineage is invisible.** A CAS Exam 7 study paper that builds on the
  results of an earlier one may score *lower* on cosine similarity than two
  unrelated papers that happen to share vocabulary — because the second paper
  uses its predecessor's terms tersely as background and spends its tokens on
  new material.
- **Citations don't matter.** A book explicitly references another. The
  similarity score doesn't reflect this at all.
- **Refutation looks identical to agreement.** Two philosophers arguing
  opposite positions on the same topic cluster together because they use the
  same vocabulary.
- **Membership in a theme is unrepresentable.** Five existentialism books by
  different authors using their own vocabularies may not cluster cleanly
  under cosine similarity. There is no "Existentialism" abstraction the graph
  can point to — only the pairwise scores between the books themselves.
- **Asymmetry is unrepresentable.** The M68 schema canonicalises undirected
  pairs at line 161-162. "Builds on" has no direction; "references" has no
  direction; everything is symmetric.

M76 stops pretending cosine similarity is the same as conceptual relationship.
It adds multiple edge kinds from multiple signals, introduces concept nodes
that anchor groups of related documents, and surfaces all of this with edge
filtering and concept curation so the graph becomes a real second-brain mind
map.

## Hard constraint from user (carried from M68)

> Workspace Graph must not consume local-model VRAM or make chat worse. If
> graph rendering wakes Ollama or competes with the main chat model, the
> feature has failed.

M76 inherits this constraint and extends it: **LLM-based edge construction
(lineage classification, concept labelling) must be deliberate and scheduled,
never autonomous, never on the graph render path.** Free-signal edges
(references, co-occurrence, metadata) compute at indexing time alongside
existing M68 work and add no new render-path cost.

## Scope

**In scope:**

- Multiple edge kinds with distinct construction signals
- Directed edges (current schema is undirected only)
- Concept nodes: a new node type representing AI-discovered thematic clusters
- Stable concept identity across re-clustering passes
- Concept curation UI: rename, merge, delete
- Edge-kind filtering in the Workspace Graph settings panel
- Visual distinction between edge kinds in rendering
- Migration of existing M68 edges to the new schema

**Out of scope for M76:**

- Cross-workspace concept linking
- Sharing or exporting concept maps
- Concept hierarchies (concepts of concepts)
- Time-based / chronological edges
- LLM-generated edge labels beyond the lineage/extends/refutes classification
- Replacing M68's `similar-to` signal — it stays as one signal among several

## Architecture

### Edge kinds

| Kind | Construction signal | Direction | Cost | When computed |
|---|---|---|---|---|
| `similar-to` | Cosine of source centroids (current M68 behaviour) | Undirected | Already cached | Existing M68 incremental builder |
| `references` | Explicit links/citations/footnotes extracted from text that resolve to workspace items | Directed (A → B = A references B) | Cheap text scan | Indexing time |
| `co-occurrence` | Distinctive named entities or technical terms shared across docs (TF-IDF style: terms common to both but rare in workspace) | Undirected | Cheap; uses existing chunks | Indexing time |
| `same-author`, `same-folder`, `same-date-range` | Metadata | Undirected | Free | Indexing time |
| `extends` | LLM determines B builds on A's framework or results | Directed (A → B) | Bounded local-LLM pass | Scheduled / on-demand only |
| `refutes` | LLM determines B argues against A | Directed (A → B) | Same as extends | Same as extends |

**Critical bound on LLM-based edges:** the lineage classifier runs *only* on
pairs that have already been surfaced by at least one free signal (similarity,
references, or co-occurrence). It never operates on all pairs. Default cap:
50 candidate pairs evaluated per workspace per scheduled run.

### Concept nodes

A new node type `concept:<stableId>` representing an AI-discovered thematic
cluster of documents. Concept nodes are first-class graph nodes — they appear
in the visualisation, they can be hovered, clicked, renamed, and deleted.

Construction pipeline:

1. **Cluster** the stored source centroids using HDBSCAN. HDBSCAN handles
   variable-density clusters and does not require K up front; documents that
   don't belong to any cluster are correctly left out rather than forced into
   a poor fit.
2. **Label** each cluster: pass the cluster members' titles plus a few
   distinctive keywords to a small local LLM (not the chat model). One task:
   "name this group of documents in 1-3 words." Receive `"Existentialism"`,
   `"Q3 budget review"`, `"Calculus exam prep"`, etc.
3. **Stable identity** — compute the cluster ID as a hash of the sorted
   member-source-ID set. To prevent IDs changing every time a single
   document is added or removed, apply a carry-over rule: if ≥70% of an
   existing cluster's members are still together in a new cluster, reuse the
   old cluster's ID and label rather than minting a fresh one.
4. **Topology** — each cluster member gets a `member-of` edge to the concept
   node. The concept node is rendered as a visible hub. Concept nodes can
   have `similar-to` edges to other concept nodes, computed from cluster
   centroid similarity.

Construction trigger: a deliberate "Rebuild concept map" command (in the
Workspace Graph settings panel) plus an optional cron schedule (default
daily, configurable, off by default). Never autonomous on indexing changes.

### Schema changes

Extend `semantic_graph_edges`:

```sql
ALTER TABLE semantic_graph_edges ADD COLUMN direction TEXT NOT NULL DEFAULT 'undirected';
-- 'undirected' | 'forward'  (forward means source → target)

-- `kind` column already exists; M68 always wrote 'semantic'. Migration: rename
-- all existing 'semantic' rows to 'similar-to' so the kind taxonomy is
-- consistent going forward.
UPDATE semantic_graph_edges SET kind = 'similar-to' WHERE kind = 'semantic';
```

New tables for concept nodes:

```sql
CREATE TABLE IF NOT EXISTS concept_nodes (
  stable_id TEXT PRIMARY KEY,        -- hash of sorted member set; stable across re-clustering
  label TEXT NOT NULL,                -- LLM-generated, user-editable
  member_count INTEGER NOT NULL,
  member_hash TEXT NOT NULL,          -- hash of current member set, for carry-over detection
  user_renamed INTEGER NOT NULL DEFAULT 0,   -- 1 if user manually renamed; prevents LLM relabelling
  user_deleted INTEGER NOT NULL DEFAULT 0,   -- soft-delete; cluster won't reappear on re-run
  last_clustered_at TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS concept_node_members (
  concept_id TEXT NOT NULL,
  source_type TEXT NOT NULL,          -- 'page_block' | 'file_chunk'
  source_id TEXT NOT NULL,
  PRIMARY KEY (concept_id, source_type, source_id),
  FOREIGN KEY (concept_id) REFERENCES concept_nodes(stable_id) ON DELETE CASCADE
);
```

`member-of` edges from documents to concept nodes are stored in the same
`semantic_graph_edges` table with `kind = 'member-of'` and
`direction = 'forward'`.

### Service layout

New services:

- `src/services/referenceExtractor.ts` — scans document content at indexing
  time, extracts explicit citations / links, resolves them to workspace item
  IDs, emits `references` edges.
- `src/services/entityCooccurrenceService.ts` — distinctive-entity extraction
  using TF-IDF over noun phrases. Emits `co-occurrence` edges.
- `src/services/lineageClassifierService.ts` — local-LLM pass over candidate
  pairs surfaced by other signals. Three-way classification:
  `extends | refutes | none`. Bounded throughput.
- `src/services/conceptNodeService.ts` — owns the clustering pass, the LLM
  labelling, the stable-ID carry-over rule, and concept node CRUD.

Existing `src/services/semanticGraphService.ts` extends to produce typed,
directional edges instead of a single `kind: 'semantic'` value.

### UI: edge filtering and concept curation

The Workspace Graph settings panel currently has one `Conceptual Links`
boolean. Replace with a checkbox set:

```
Edge kinds:
  ☑ Similarity        ☐ References        ☐ Co-occurrence
  ☐ Lineage           ☐ Metadata          ☐ Concept membership
```

Each checkbox filters the graph independently. Different edge kinds render
with different colours and line styles. Directed edges (`references`,
`extends`, `refutes`, `member-of`) render with arrowheads.

Concept node curation panel (new view, or new section in the existing
settings panel):

- List all concept nodes with their member counts and labels
- Rename a concept (sets `user_renamed = 1`; future re-clustering won't relabel)
- Merge two concepts (combines members, keeps one label, hides the other)
- Delete a concept (`user_deleted = 1`; re-clustering won't reintroduce the
  same cluster — the deletion is sticky on the member set)
- "Rebuild concept map" button to trigger a fresh clustering pass
- "Last rebuilt" timestamp

## Phases

### Phase 1 — Schema and edge kind foundation (~1 week)

- Add `direction` column to `semantic_graph_edges` with migration
- Rename existing `'semantic'` rows to `'similar-to'`
- Update `SemanticGraphService` to support typed/directional edges
- Add `concept_nodes` and `concept_node_members` tables (empty for now)
- Extend `GraphProviderEdge` shape to expose `kind` and `direction` to the
  Workspace Graph extension
- Workspace Graph settings panel: replace single `Conceptual Links` boolean
  with a kind-filter checkbox set (only similarity active for now)
- Different rendering per edge kind (colours, line styles, arrowheads on
  directed edges)

**Verification:**
- Migration produces the expected row count and renames cleanly
- Existing M68 cached edges continue to render with no behaviour change
- Type-check + targeted unit tests for the new column and filter UI

### Phase 2 — Free-signal edges (~1 week)

- `referenceExtractor`: scan canvas page block text and file chunk text for
  explicit citations / links / footnotes that resolve to known workspace
  item IDs. Emit `references` edges at indexing time.
- `entityCooccurrenceService`: TF-IDF over distinctive noun phrases /
  technical terms. Emit `co-occurrence` edges for pairs that share
  workspace-rare terms.
- Metadata edges: same-folder, same-author (from canvas page metadata),
  same-date-range (within a configurable window). Computed at indexing time.
- All three signals integrate with the existing M68 incremental rebuild path.

**Verification:**
- A canvas page with an explicit `parallx://page/<id>` link emits a
  `references` edge to that page
- Two files in the same folder produce a `same-folder` edge
- Co-occurrence edge appears for two docs sharing a distinctive term; no
  edge for docs sharing only common words
- No new model calls introduced

### Phase 3 — Lineage classifier (~1 week)

- `lineageClassifierService`: takes a candidate pair surfaced by similarity,
  references, or co-occurrence. Composes a small prompt for a local LLM (not
  the chat model — a dedicated small classifier instance) asking three-way:
  `extends | refutes | none`.
- Bounded batch: default 50 candidate pairs per workspace per scheduled run
- Triggered by a "Refresh lineage" command and an optional cron (default off)
- Caches results in `semantic_graph_edges` with `kind = 'extends'` or
  `kind = 'refutes'` and `direction = 'forward'`
- Skip pairs already classified within a content-hash window

**Verification:**
- Lineage pass never runs on the render path
- Lineage pass never runs unprompted on indexing events
- Two papers where one explicitly extends the other (per test fixture)
  produce a `kind: 'extends'` directed edge
- Throughput cap respected: 51st candidate is deferred, not classified

### Phase 4 — Concept nodes (~1-2 weeks)

- `conceptNodeService`: HDBSCAN clustering over stored source centroids
- Cluster-set hashing with the 70% carry-over rule
- LLM labelling pass for new / changed clusters (small local model, batched)
- Persist concept nodes and member lists
- Emit `member-of` edges from members to concept nodes
- Compute `similar-to` edges between concept node centroids
- Concept nodes contribute as graph nodes via the workspace graph provider
- Distinct visual treatment (larger, different shape/colour)

**Verification:**
- Re-running clustering on the same content produces the same concept IDs
- Adding one document to a cluster of 10 keeps the cluster ID and label
- Replacing 5 of 10 cluster members triggers a fresh cluster ID
- Concept node renders as a hub with edges to its members
- Clustering pass never runs on the render path

### Phase 5 — Concept node curation UI (~3-5 days)

- Concept nodes panel in the Workspace Graph settings (or as its own view)
- Rename concept: sets `user_renamed = 1`; future LLM labelling respects this
- Merge concepts: pick two, combine members, choose surviving label
- Delete concept: sets `user_deleted = 1`; the member set is remembered as
  "do not re-cluster these together" so the deletion is sticky
- "Rebuild concept map" button: triggers fresh clustering
- "Last rebuilt" timestamp display

**Verification:**
- Renaming persists across rebuilds
- Deletion prevents the same cluster from reappearing
- Merging combines edges correctly
- The rebuild button does not block the UI

### Phase 6 — Bake and tune (~1 week)

- Tune HDBSCAN parameters on real workspaces
- Tune LLM labelling prompt (cluster size sensitivity)
- Tune lineage classifier prompt + accept/reject thresholds
- Tune edge-kind visual defaults
- Diagnostics: edge-kind counts, concept count, last-rebuild timestamp,
  lineage-batch progress in the existing context report (`/context` command)

**Verification:**
- Real workspace test: CAS Exam 7 papers produce visible `extends` lineage
  and group under an exam-related concept node
- Real workspace test: existentialism book collection groups under a
  concept node despite varied author vocabulary
- No regression in graph open / pan / filter latency

## Total scope

~6 weeks of focused work across the six phases. Phases ship independently —
Phase 1 is a non-breaking schema migration; Phase 2 is additive edge kinds;
Phases 3–5 each add a real feature on top.

## Existing pieces to build on

| Piece | Location |
|---|---|
| Cached edge schema | `semantic_graph_edges` table (M68) |
| Source centroid helper | `IVectorStoreService.getSourceCentroid` (M68) |
| Vector KNN | `IVectorStoreService.vectorSearch` (M68) |
| Workspace graph provider API | `parallx.workspaceGraph.registerProvider()` |
| Edge styling and toggle UI | `ext/workspace-graph/main.js` settings panel |
| Indexing event hook | `IIndexingPipelineService.onDidIndexSource` |
| Cron infrastructure | `ICronService` (for scheduled lineage / concept rebuilds) |
| Canvas page metadata | Existing canvas service (for author / folder / date) |

## Success criteria

- Two CAS Exam 7 papers where one builds on another show a directed `extends`
  edge — even when their cosine similarity is below the M68 threshold
- A workspace containing five existentialism books shows an `Existentialism`
  concept node connecting all five, regardless of author vocabulary variance
- Renaming a concept node persists across rebuilds
- Deleting a concept node prevents the same cluster from re-emerging
- Edge-kind filter checkboxes work independently and cumulatively
- Graph open / pan / zoom latency unchanged from M68
- No LLM calls fired from the graph render path
- Lineage and concept passes are user-triggered or scheduled, never
  autonomous on indexing

## Risks

- **LLM labelling quality on small clusters.** A 2-document cluster may be
  hard for any model to name well. Mitigation: minimum cluster size of 3 by
  default; smaller clusters get `null` label and render as "Unlabelled
  cluster" until the user names them.
- **Cluster jitter despite the carry-over rule.** Edge cases where cluster
  composition swings around the 70% threshold could still cause label churn.
  Mitigation: bias toward stability — once a cluster is named, it takes
  meaningful turnover to relabel.
- **Local LLM quality varies by model.** A 3B-class local model may struggle
  with the `extends | refutes | none` classification. Mitigation: surface
  confidence in the edge metadata; let the user filter low-confidence
  lineage edges out of the graph view.
- **Reference extraction false positives.** Citation regex may match strings
  that aren't actually references. Mitigation: only emit an edge when the
  matched ID resolves to a real workspace item.
- **HDBSCAN parameter sensitivity.** Bad min-cluster-size leads to too many
  tiny clusters or one giant cluster. Mitigation: Phase 6 bake on real
  workspaces; expose `minClusterSize` as a setting if defaults can't be
  found.
