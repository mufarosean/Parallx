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

M76 inherits this constraint and refines it: **LLM-based edge construction
(lineage classification, concept labelling) only runs when the user clicks
the "Refresh mind map" button.** Never autonomous, never on a cron schedule,
never on the graph render path. The user pressing the button is consent that
the operation will use the chat model and take time.

Free-signal edges (references, co-occurrence, metadata) compute at indexing
time alongside existing M68 work and add no new render-path cost.

## LLM strategy: chat model, not a dedicated small model

LLM-based passes (lineage classification, concept labelling) use the **active
chat model**, not a separate small classifier. Rationale:

- **Quality.** Three-way classification of dense technical text
  (`extends | refutes | none`) is exactly the kind of task where small models
  hallucinate. Concept labelling quality also drops sharply with small
  models — they tend to produce generic labels like "Documents" or "Various
  Topics" while chat-class models pick specific, useful ones.
- **One model.** No separate classifier to ship, configure, or maintain.
- **Already warm.** If the user has had a chat session in the workspace, the
  model is loaded.
- **The constraint was about the render path.** "Don't make chat worse" means
  don't fire LLM calls when the user opens the graph. A button press is
  consent — the user has chosen to spend the compute.

Honest tradeoffs:

- **First refresh of a session pays a model-load cost** if the chat model
  isn't already loaded. Subsequent refreshes are fast.
- **If the user has configured a remote chat provider (Claude API, OpenAI),
  the mind-map refresh inherits that.** For some users this means cloud
  calls on workspace content. The refresh UI must surface this clearly so
  the user is not surprised. Local-only users get local-only refreshes;
  remote-configured users get whatever they configured.
- **A 5–10 minute refresh needs progress feedback and a cancel button.**
  M68's silent background work pattern does not apply.

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
| `extends` | Active chat model determines B builds on A's framework or results | Directed (A → B) | Chat-model call per candidate pair | Only when user clicks "Refresh mind map" |
| `refutes` | Active chat model determines B argues against A | Directed (A → B) | Same as extends | Same as extends |

**Critical bound on LLM-based edges:** the lineage classifier runs *only* on
pairs that have already been surfaced by at least one free signal (similarity,
references, or co-occurrence). It never operates on all pairs. Combined with
incremental refresh (only sources whose content hash changed since the last
refresh are reprocessed), a typical refresh touches a small handful of pairs
per changed source — minutes of work, not hours.

The user can cancel an in-progress refresh at any time. Cancellation is
clean: edges classified so far are persisted; the rest stay marked as
"pending" so the next refresh picks up where the cancel happened.

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

Construction trigger: the "Refresh mind map" button in the Workspace Graph
settings panel. No cron. No autonomy on indexing changes. The same button
also drives the lineage classifier pass — one user action covers both.

Incremental refresh is the default and the only mode. The refresh button
identifies what's changed since the last refresh (new sources, deleted
sources, sources whose content hash changed) and only processes the delta.
Concept clustering is incremental too: existing clusters keep their IDs
unless their membership shifts past the carry-over threshold; new sources
are assigned to existing clusters if they fit, and new clusters are formed
only when several new sources don't fit anywhere existing.

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

### Phase 3 — Refresh infrastructure (~1 week)

The user-initiated "Refresh mind map" workflow that Phases 4 and 5 plug into.

- Track per-source `last_processed_content_hash` so the system can identify
  what's new, changed, or deleted since the last refresh.
- "Refresh mind map" button in the Workspace Graph settings panel.
- Refresh UI: progress bar showing current step ("Classifying lineage:
  pair 12 of 38"), a cancel button, and an "estimated time remaining" hint
  based on candidate count + observed chat-model throughput.
- Surface the active chat model and its provider (local vs remote) on the
  refresh confirmation so users with remote providers see clearly that the
  refresh will use that provider on workspace content.
- Cancellation is clean: edges/clusters processed so far are persisted; the
  delta the next refresh picks up reflects the cancel point.
- Refresh history: a small log of recent refreshes (timestamp, source delta
  counts, edges added/changed, cancelled or completed) accessible from the
  same panel.

**Verification:**
- Refresh button identifies new and changed sources correctly via content
  hashes
- Cancel mid-refresh leaves the cache in a consistent state
- Progress bar updates per candidate pair, not per phase
- No refresh runs without a button press

### Phase 4 — Chat-model lineage classifier (~1 week)

- `lineageClassifierService`: takes a candidate pair surfaced by similarity,
  references, or co-occurrence. Composes a focused prompt for the **active
  chat model** asking three-way: `extends | refutes | none` with an optional
  confidence score.
- Driven by the Phase 3 refresh button. Only candidates involving new or
  changed sources are reclassified — previously-classified pairs whose
  source content hashes are unchanged are skipped.
- Results cached in `semantic_graph_edges` with `kind = 'extends'` or
  `kind = 'refutes'` and `direction = 'forward'`.
- The classifier honours the refresh cancellation signal and stops at the
  next pair boundary.
- Uses the same provider plumbing the chat surface uses, so a user configured
  for remote chat gets remote classification with no extra setup.

**Verification:**
- Lineage pass never runs on the render path
- Lineage pass never runs without an explicit refresh button press
- Two papers where one extends the other (per test fixture) produce a
  `kind: 'extends'` directed edge
- A refresh that touches 3 changed sources runs lineage only on candidate
  pairs involving those 3, not the entire workspace
- Cancelling mid-classification leaves already-classified pairs persisted

### Phase 5 — Concept nodes with incremental clustering (~1–2 weeks)

- `conceptNodeService`: HDBSCAN clustering over stored source centroids on
  first run; subsequent refreshes use an incremental strategy:
  - For each new source, assign to the nearest existing cluster if the
    centroid distance is below threshold; otherwise mark as unclustered
  - When N unclustered sources accumulate, run a small clustering pass over
    just those to spawn new clusters
  - For changed sources, recheck their cluster assignment; reassign if the
    centroid moved enough to be closer to a different cluster
  - Apply the 70% carry-over rule on existing clusters: if ≥70% of an
    existing cluster's members are still grouped, the cluster keeps its ID
    and label; otherwise the cluster fractures and the pieces get fresh IDs
- Concept labelling uses the **active chat model**, the same one used for
  lineage. Only new clusters and clusters that lost their stable identity get
  relabelled — most refreshes will relabel zero clusters.
- Persist concept nodes and member lists; emit `member-of` edges; compute
  cross-concept `similar-to` edges from cluster centroid similarity.
- Concept nodes contribute as graph nodes via the workspace graph provider.
- Distinct visual treatment (larger, different shape/colour).

**Verification:**
- First refresh on a fresh workspace produces clusters with stable IDs
- Subsequent refresh with one added document either places the document in
  an existing cluster (no relabelling) or leaves it unclustered until N
  unclustered docs accumulate
- Replacing 5 of 10 cluster members triggers carry-over rule fracture
- No clustering pass runs without an explicit refresh button press
- Cluster labelling never fires for clusters whose membership didn't change
  past threshold

### Phase 6 — Concept node curation UI (~3-5 days)

- Concept nodes panel in the Workspace Graph settings (or as its own view)
- Rename concept: sets `user_renamed = 1`; future LLM labelling respects this
- Merge concepts: pick two, combine members, choose surviving label
- Delete concept: sets `user_deleted = 1`; the member set is remembered as
  "do not re-cluster these together" so the deletion is sticky
- "Force full re-cluster" action (separate from the normal refresh button)
  for cases where incremental drift has accumulated enough that the user
  wants a clean restart of the clustering — confirmation dialog warns this
  is expensive
- "Last refreshed" timestamp display

**Verification:**
- Renaming persists across refreshes
- Deletion prevents the same cluster from reappearing
- Merging combines edges correctly
- The curation UI does not block the graph render thread

### Phase 7 — Bake and tune (~1 week)

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

~6–7 weeks of focused work across the seven phases. Phases ship independently:
Phase 1 is a non-breaking schema migration; Phase 2 is additive edge kinds;
Phase 3 builds the refresh UI; Phases 4–6 each add a real feature on top of
the refresh infrastructure.

## Existing pieces to build on

| Piece | Location |
|---|---|
| Cached edge schema | `semantic_graph_edges` table (M68) |
| Source centroid helper | `IVectorStoreService.getSourceCentroid` (M68) |
| Vector KNN | `IVectorStoreService.vectorSearch` (M68) |
| Workspace graph provider API | `parallx.workspaceGraph.registerProvider()` |
| Edge styling and toggle UI | `ext/workspace-graph/main.js` settings panel |
| Indexing event hook | `IIndexingPipelineService.onDidIndexSource` |
| Chat model invocation | Existing chat surface — same path used by conversation summarisation |
| Active chat model selection | Current AI settings (used as-is, no new config) |
| Canvas page metadata | Existing canvas service (for author / folder / date) |

## Success criteria

- Two CAS Exam 7 papers where one builds on another show a directed `extends`
  edge — even when their cosine similarity is below the M68 threshold
- A workspace containing five existentialism books shows an `Existentialism`
  concept node connecting all five, regardless of author vocabulary variance
- Renaming a concept node persists across refreshes
- Deleting a concept node prevents the same cluster from re-emerging
- Edge-kind filter checkboxes work independently and cumulatively
- Graph open / pan / zoom latency unchanged from M68
- No LLM calls fired from the graph render path
- All LLM-based work runs only when the user clicks "Refresh mind map" —
  never on indexing events, never on a schedule, never autonomously
- The second refresh on an unchanged workspace completes in seconds (no LLM
  work, only delta detection finds nothing to do)
- Adding 3 documents and clicking refresh processes only the candidates
  involving those 3 documents, not the whole workspace

## Risks

- **Refresh duration on large workspaces.** A first-ever refresh on a
  workspace with hundreds of sources can hit thousands of candidate pairs.
  Mitigation: incremental is the only mode after the first refresh; the
  first refresh shows an honest time estimate before the user commits;
  cancellation is always available; the user can refresh selectively (e.g.
  "refresh just this folder") if we expose that affordance.
- **First refresh of a session pays a model-load cost.** If the user just
  opened the app and hasn't used chat yet, clicking refresh triggers a
  model load. Mitigation: the progress UI shows "Loading model…" as a
  distinct first step so the user knows what they're waiting for.
- **Remote chat providers send workspace content to the cloud.** A user
  who has configured Claude API or OpenAI as their chat model gets the
  same provider for mind-map refresh. Mitigation: the refresh confirmation
  dialog states the active provider explicitly. Users who don't want this
  can switch to a local model before refreshing.
- **Cluster jitter despite the carry-over rule.** Edge cases where cluster
  composition swings around the 70% threshold could still cause label churn.
  Mitigation: bias toward stability — once a cluster is named, it takes
  meaningful turnover to relabel; user can manually rename to lock the label.
- **LLM labelling quality on small clusters.** A 2-document cluster may be
  hard for any model to name well even at chat-model quality. Mitigation:
  minimum cluster size of 3 by default; smaller clusters get `null` label
  and render as "Unlabelled cluster" until the user names them.
- **Reference extraction false positives.** Citation regex may match strings
  that aren't actually references. Mitigation: only emit an edge when the
  matched ID resolves to a real workspace item.
- **HDBSCAN parameter sensitivity.** Bad min-cluster-size leads to too many
  tiny clusters or one giant cluster. Mitigation: Phase 7 bake on real
  workspaces; expose `minClusterSize` as a setting if defaults can't be
  found.
- **Incremental drift over time.** Incremental clustering can accumulate
  assignment errors over many refreshes — a source that drifted into a
  poor-fit cluster early stays there. Mitigation: the curation UI's
  "Force full re-cluster" action provides an explicit reset; suggest it in
  the UI when the count of unclustered sources or single-member clusters
  crosses a heuristic threshold.
