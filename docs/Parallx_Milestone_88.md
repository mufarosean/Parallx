# Milestone 88 — The Mind Map That Means It

**Status: APPROVED 2026-07-20 ("do all tiers") — implementation in progress.**

**Verdict driving this milestone (Mufaro, 2026-07-20):** "the mind map is not
useful because it fails to draw meaningful connections and it cannot make
connections between different file types. It also has redundancies and
duplication and needs to be overhauled."

---

## 1. Diagnosis (code-verified, 2026-07-20)

M68 + all seven M76 phases SHIPPED — edge kinds, lineage classifier, DBSCAN
concept nodes, curation UI. The machinery exists; integration faults throttle
it before it reaches the screen:

1. **Uniform read filter kills meaning edges.** The provider reads with
   `minScore: 0.72` (calibrated for cosine) applied to EVERY kind.
   Lineage edges are accepted from confidence 0.55 and written with
   score = confidence → everything in [0.55, 0.72) is paid for (~30s LLM
   per source) then invisibly discarded. Co-occurrence scores
   `log2(1+shared)/log2(11)` → needs ≥5 shared terms to survive; 2–3
   shared terms (a real link) = 0.46–0.58, filtered.
2. **Meaning kinds default OFF** (extends/refutes/member-of/co-occurrence)
   and their producer is a button in the settings panel.
3. **File-explorer costume.** Every file+folder to depth 3 becomes a node
   (configs, code, JSON) + hierarchy edges; semantic edges are a ≤500-edge
   faint overlay. Concept nodes (the natural mindmap skeleton) hidden
   behind the off-by-default member-of toggle.
4. **Whole-doc centroids smear topics.** One averaged vector per source;
   a chapter-level connection between two long texts dies in the average.
5. **Cross-type edges starved.** PDFs/docx/images DO index (100MB cap,
   OCR) but cross-type edges only arrive via diluted cosine or
   `parallx://` references (which PDFs cannot contain). No markdown-link
   extraction, no title-mention matching.
6. **Duplication.** String-exact node-id dedup across four collectors +
   the semantic provider's self-supplied placeholders; the code itself
   documents the fragility (memory-collector comment).

## 2. Design principles

- **Keep the data layer** (schema, incremental builder, hash skips,
  clustering, lineage) — the overhaul is read-path, defaults, signals,
  and composition.
- **M68 perf contract stands:** no model calls from graph paths; KNN only;
  incremental; caps. LLM lane stays behind the explicit Refresh action.
- **Meaning edges are the product.** Anything that hides one is a bug.
- Headless acceptance tests per slice; no visible app launches.

## 3. Slices

### S1 — Read-path integrity (Tier 1)
- Per-kind min-score floors in `getCachedEdges` (service-side, SQL):
  `similar-to` 0.72 · `co-occurrence` 0.45 (=2 shared terms) ·
  `extends`/`refutes` 0.55 (mirrors classifier accept) · structural kinds
  (`references`/`member-of`/`same-folder`/…) 0 — deterministic producers,
  no score semantics.
- Provider stops sending the flat `minScore` and trusts service floors.
- Defaults: extends/refutes/member-of/co-occurrence ON (+ one-time
  migration flag for existing workspaces, same pattern as
  `crossToolEdgesDefaulted`). `same-folder` stays opt-in (duplicates
  structure).
- Tests: per-kind floor filtering; defaults migration.

### S2 — Segment-level similarity (Tier 1)
- `getSourceChunkVectors(sourceType, sourceId, limit)` on the vector store
  (evenly sampled, capped 12).
- `_recomputeSource` scores a candidate target as
  max(centroid-KNN score, best chunk-level hit) — chapter-level overlap
  between long texts now connects. Same threshold, same top-K caps, same
  incremental/debounce path; ≤13 KNN calls per source (was 1).
- Tests: two sources dissimilar by centroid but sharing one strong topic
  segment produce a similar-to edge; caps respected.

### S3 — Cross-type free signals (Tier 2)
- `referenceExtractor` grows markdown links (`[x](path)`, images excluded)
  and wiki-links (`[[Page Title]]`) → `references` edges for file/page
  sources.
- Title-mention matching: at recompute, source text is scanned for the
  titles of OTHER indexed sources (titles ≥ 6 chars, word-boundary,
  capped title list) → forward `references` edge ("cites"). This is the
  PDF↔PDF / PDF↔page bridge that needs no LLM.
- Tests: extraction pure-function suites + recompute wiring.

### S4 — Mind-map mode + dedup + reachability (Tier 2)
- **View mode toggle** `workspace | mindmap` (persisted). Mindmap mode:
  concept nodes as hubs + content nodes ONLY (canvas pages + indexed
  files); no directory scaffolding, no sessions; meaning edges all-on;
  layout tuned (hubs heavier).
- "Refresh mind map" action moves onto the graph toolbar (settings panel
  keeps its copy).
- Node-id normalization at the provider dedup boundary (case/separator
  tolerant) so placeholder vs collector duplicates die without a DB
  migration.
- Tests: normalization; mode node-set composition (pure builder parts).

## 7. Non-goals

- No autonomous LLM passes (Refresh stays manual — M76 constraint).
- No new clustering library; DBSCAN stays.
- No DB migration of stored node ids (normalization is read-side).
