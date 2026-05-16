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
never on the graph render path.

Free-signal edges (references, co-occurrence, metadata) compute at indexing
time alongside existing M68 work and add no new render-path cost.

## Verified codebase facts

Confirmed before Phase 1 by reading the actual code. Use these as the contract.

**Semantic graph (M68) infrastructure ready to extend:**

- Edge upsert is at `src/services/semanticGraphService.ts:523` in `_replaceSourceEdges()`. Current `kind` is hardcoded `'semantic'`. Migration renames to `'similar-to'`.
- Per-source recompute is `_recomputeSource()` at line 374. Already uses content-hash skip (lines 386-392) — Phase 3 incremental refresh has a working foundation here.
- Deletion pruning at `_deleteSourceCache()` line 569 already removes edges on source disappearance.
- Recompute is triggered by `indexingPipeline.onDidIndexSource` (line 136).
- Extension reads via the public `getCachedEdges()` API at line 197; no SQL leakage to extensions.
- Edge canonicalisation via `canonicalizeSemanticEdgePair()` line 89. **Important for Phase 1:** only canonicalise undirected edges. Directed edges (`forward`) must preserve their (source, target) ordering.

**Clustering library decision (Phase 5):**

- No clustering library in `package.json` today.
- HDBSCAN has no usable pure-JS implementation in the npm ecosystem. M76 will use **DBSCAN** via the `density-clustering` package (~50KB, pure JS, no native bindings). DBSCAN handles variable-density clusters reasonably well; the loss vs HDBSCAN is automatic noise classification, which we get by treating un-clustered sources as "unassigned" anyway.

**Text parsing (Phase 2):**

- Indexing pipeline does **not** currently extract markdown links, `parallx://` URIs, or footnotes. Phase 2 adds extraction in a new module, not by reusing existing extraction.
- No NLP libraries are in `package.json`. Noun-phrase extraction for co-occurrence will be regex-based (capitalised n-grams + workspace-distinctive terms via inverse document frequency over chunk text). No new dependencies required.
- Content chunks already carry `contextPrefix` metadata (e.g. `[Page: Title | Section: Heading]`) at `chunkingService.ts` lines 62-67. Phase 4 lineage prompts can use this for compact context without re-fetching full documents.

**UI surfaces (Phase 3):**

- The existing indexing progress indicator lives in `src/built-in/indexing-log/main.ts` and listens to `IIndexingPipelineService.onDidChangeProgress`. The pattern is: service emits → built-in tool listens → status updates throttled at 250ms.
- For M76, the simplest approach is for the workspace-graph extension to register its own listener against `SemanticGraphService.onDidChangeEdges` (line 101) and emit a refresh-progress event the workspace-graph view can subscribe to. No modification to the indexing-log built-in needed.

**Rendering (Phase 1 + Phase 4 visual):**

- The workspace-graph extension renders via **Canvas 2D**, not d3-force-3d. The edge drawing loop is in `drawGraph()` at `ext/workspace-graph/main.js:876-1022`.
- Current visual distinction is dashed lines for semantic edges, solid for structural. M76 will extend this with per-kind colour + style.
- Directed edges (arrowheads) are not currently supported but the cost is ~50 lines of canvas geometry at the end of the per-edge draw — no library change required.

## AI architecture facts M76 builds against

Parallx is **local-only on Ollama** (`src/built-in/chat/providers/ollamaProvider.ts`).
There is one provider implementation. There are no remote provider hooks,
no multi-provider abstractions to plumb through, no Claude API or OpenAI
code paths to consider. The `ILanguageModelProvider` interface exists in
type form but only Ollama is registered.

Key invariants M76 must respect:

- **Backend LLM calls use `sendChatRequestForModel(modelId, …)`**
  (`src/services/languageModelsService.ts:349`). This is the established
  pattern that heartbeat, cron, and subagent runners already use. It does
  not mutate the user's active-model selection and does not fire UI events,
  so backend work stays invisible to the chat surface.

- **Chat input is never disabled while the model is busy.** When a chat
  response is streaming, the textarea stays enabled and user messages
  queue (`session.pendingRequests`). The only state that disables input
  is Ollama being offline entirely. M76 must follow this convention —
  refresh does not block chat.

- **The chat model and embedding model share one Ollama instance.** Chat
  uses the user-configured model (e.g. `qwen2.5:32b`); indexing uses
  `nomic-embed-text` (hard-coded in `src/services/embeddingService.ts`).
  Both share the GPU. Indexing and chat already coexist concurrently
  today; M76 refresh just adds another concurrent caller of the same
  shape as heartbeat.

- **Model lifecycle is lazy + warm.** The provider preloads the chat model
  on first availability detection. Each chat call sends `keep_alive: '30m'`
  so the model stays in VRAM. By the time the user clicks refresh, the
  model is almost always already warm.

## LLM strategy: chat model via the heartbeat pattern

LLM-based passes (lineage classification, concept labelling) use the **active
chat model**, called via the same `sendChatRequestForModel()` path that
heartbeat and cron already use. Rationale:

- **Quality.** Three-way classification of dense technical text
  (`extends | refutes | none`) is exactly the task where small models
  hallucinate. Concept labelling quality also drops sharply with small
  models — they produce generic labels ("Documents", "Various Topics")
  while chat-class models pick specific, useful ones.
- **One model.** No separate classifier to ship, configure, or maintain.
- **Established pattern.** `sendChatRequestForModel()` is built for exactly
  this — backend, isolated, doesn't touch chat UI state. Heartbeat does
  this today; refresh is the same shape of operation.

## Interaction with chat during a refresh

A refresh fires LLM requests through `sendChatRequestForModel()`, the same
isolated path heartbeat uses. The user-facing impact is therefore the same
as having heartbeat run during a chat session:

- **Chat keeps working.** Input stays enabled, messages can be submitted
  and queue normally. The chat UI is never blocked.
- **Both share the GPU at the Ollama layer.** Ollama interleaves
  inference for concurrent requests on one GPU, so chat token streaming
  may feel slightly slower during a refresh. This is the same dynamic
  as chatting while indexing runs.
- **Status surface, not a modal.** Refresh progress lives in a non-blocking
  status indicator (spinner + "Refreshing mind map: pair 12 of 38") in
  the Workspace Graph view or the existing context bar. No banner blocks
  the chat surface. A cancel button is exposed in the same status surface.
- **First refresh after app launch may briefly wait for model preload.**
  The provider preloads on availability; if the user clicks refresh
  before preload completes (rare), the first LLM call waits a few seconds.
  Subsequent calls hit warm VRAM.

The honest user-facing tradeoff: chat feels slightly slower while refresh
is running, same as it does while indexing is running. Nothing breaks.

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

1. **Cluster** the stored source centroids using DBSCAN (via the
   `density-clustering` npm package — pure JS, no native bindings; HDBSCAN
   has no usable pure-JS implementation). DBSCAN handles variable-density
   clusters and does not require K up front; documents that don't belong to
   any cluster are correctly left out (DBSCAN's "noise" class) rather than
   forced into a poor fit.
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

- `referenceExtractor`: new module (no existing pipeline parsing to reuse).
  Regex-extract markdown links, `parallx://` URIs, and footnote-style
  references from canvas page block text and file chunk text. Resolve each
  match to a workspace item ID; emit `references` edges only when the match
  resolves to a real item. Runs at indexing time, hooked into
  `IIndexingPipelineService.onDidIndexSource`.
- `entityCooccurrenceService`: regex-extract distinctive n-grams from chunk
  text (no NLP library needed — capitalised multi-word phrases plus
  acronyms). Compute inverse document frequency over the workspace; emit
  `co-occurrence` edges for pairs that share terms which are rare across the
  workspace (low IDF below the workspace's median).
- Metadata edges: same-folder from file paths; same-author from canvas
  `page_properties` (line 740-754 in indexingPipeline.ts already reads
  these); same-date-range from canvas `created_at` or file `mtime`.
- All three signals integrate with the existing M68 incremental rebuild path
  via `_replaceSourceEdges()`. New `kind` values: `'references'`,
  `'co-occurrence'`, `'same-folder'`, `'same-author'`, `'same-date'`.

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
- Non-blocking status surface: progress indicator in the Workspace Graph
  view (or the existing context bar) showing current step
  ("Refreshing mind map: pair 12 of 38") and a cancel button. **No modal,
  no banner over chat, no input disabling** — chat continues to work
  throughout, matching how indexing surfaces its state today.
- Refresh confirmation when the user clicks the button: a small inline
  prompt stating what will be processed (e.g. "3 new sources, 2 changed —
  estimated ~4 minutes") and the active chat model that will be used.
  Confirm with one click.
- Cancellation is clean: edges/clusters processed so far are persisted; the
  delta the next refresh picks up reflects the cancel point.
- Refresh history: a small log of recent refreshes (timestamp, source delta
  counts, edges added/changed, cancelled or completed) accessible from the
  same panel.
- LLM calls go through `sendChatRequestForModel()`
  (`src/services/languageModelsService.ts:349`) — the same isolated path
  heartbeat uses. No mutation of active-model state, no chat UI events.

**Verification:**
- Refresh button identifies new and changed sources correctly via content
  hashes
- Chat input stays enabled during a refresh; submitting a chat message
  while refresh runs produces a normal chat response (with possibly
  slower token streaming due to GPU contention)
- Cancel mid-refresh leaves the cache in a consistent state
- Progress indicator updates per candidate pair, not per phase
- No refresh runs without a button press

### Phase 4 — Chat-model lineage classifier (~1 week)

- `lineageClassifierService`: takes a candidate pair surfaced by similarity,
  references, or co-occurrence. Composes a focused prompt for the **active
  chat model** asking three-way: `extends | refutes | none` with an optional
  confidence score.
- LLM calls go through `LanguageModelsService.sendChatRequestForModel()`
  with the workspace's currently-selected chat model. This is the same path
  heartbeat and cron use today — fully isolated from the chat UI state.
- Driven by the Phase 3 refresh button. Only candidates involving new or
  changed sources are reclassified — previously-classified pairs whose
  source content hashes are unchanged are skipped.
- Results cached in `semantic_graph_edges` with `kind = 'extends'` or
  `kind = 'refutes'` and `direction = 'forward'`.
- The classifier honours the refresh cancellation signal and stops at the
  next pair boundary.

**Verification:**
- Lineage pass never runs on the render path
- Lineage pass never runs without an explicit refresh button press
- Two papers where one extends the other (per test fixture) produce a
  `kind: 'extends'` directed edge
- A refresh that touches 3 changed sources runs lineage only on candidate
  pairs involving those 3, not the entire workspace
- Cancelling mid-classification leaves already-classified pairs persisted

### Phase 5 — Concept nodes with incremental clustering (~1–2 weeks)

- `conceptNodeService`: **DBSCAN** clustering (via the `density-clustering`
  npm package — pure JS, no native bindings) over stored source centroids
  on first run; subsequent refreshes use an incremental strategy:
  - For each new source, assign to the nearest existing cluster if the
    centroid distance is below threshold; otherwise mark as unclustered
  - When N unclustered sources accumulate, run a small clustering pass over
    just those to spawn new clusters
  - For changed sources, recheck their cluster assignment; reassign if the
    centroid moved enough to be closer to a different cluster
  - Apply the 70% carry-over rule on existing clusters: if ≥70% of an
    existing cluster's members are still grouped, the cluster keeps its ID
    and label; otherwise the cluster fractures and the pieces get fresh IDs
- Concept labelling uses the **active chat model** via
  `sendChatRequestForModel()`, the same path Phase 4 uses. Only new
  clusters and clusters that lost their stable identity get relabelled —
  most refreshes will relabel zero clusters.
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
| Backend chat-model invocation | `LanguageModelsService.sendChatRequestForModel()` (`src/services/languageModelsService.ts:349`) — same isolated path used by heartbeat, cron, subagent runners |
| Reference pattern for backend LLM use | `src/openclaw/openclawHeartbeatExecutor.ts` — minimal example of one-shot LLM call from non-chat code |
| Active chat model selection | Current AI settings (used as-is, no new config) |
| Status indicator UI pattern | Existing indexing status / token bar in the chat surface — non-blocking, non-modal |
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
- **GPU contention during refresh.** Refresh and chat both use the same
  Ollama instance; while a refresh is running, chat token streaming will
  feel slower because the GPU is shared. Mitigation: this is the same
  dynamic that already exists between chat and background indexing, and
  is acceptable per the user's stated tolerance. The status indicator
  makes the contention visible so the user understands why chat feels
  slower. Refresh can be cancelled at any time.
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
- **DBSCAN parameter sensitivity.** Bad `epsilon` (neighborhood radius) or
  `minPoints` (cluster minimum size) parameters lead to too many tiny
  clusters or one giant cluster. DBSCAN is more sensitive to these than
  HDBSCAN would have been, but HDBSCAN has no usable pure-JS
  implementation. Mitigation: Phase 7 bake on real workspaces; expose
  `epsilon` and `minPoints` as settings if defaults can't be found.
- **Incremental drift over time.** Incremental clustering can accumulate
  assignment errors over many refreshes — a source that drifted into a
  poor-fit cluster early stays there. Mitigation: the curation UI's
  "Force full re-cluster" action provides an explicit reset; suggest it in
  the UI when the count of unclustered sources or single-member clusters
  crosses a heuristic threshold.
