# Milestone 38 — Planned Evidence Engine

> Scope note
>
> Milestone 38 is a design-and-architecture milestone.
> It defines the remodel from single-stage RAG to a planned evidence engine.
>
> Milestone 37 established the workspace-expert contract and identified the
> two execution substrates (retrieval answering vs deterministic coverage).
> Milestone 38 builds on that by defining the full evidence engine: scope
> resolution, entity resolution, composite workflow planning, typed evidence,
> coverage tracking, and answer validation — all grounded in the actual
> codebase as it exists today.

---

## Table of Contents

1. Problem Statement
2. Research Inputs
3. Current Parallx State
4. Core Architectural Diagnosis
5. Milestone 38 Product Contract
6. Target Architecture
7. Canonical Internal Objects
8. Execution Plan
9. Exact File Map
10. Success Criteria
11. Non-Goals
12. Identified Gaps and Resolution Policy

---

## 1. Problem Statement

Parallx treats all grounded queries as a single retrieval problem.

The current pipeline is:

**user query → regex classify → global RAG → flat context injection → model answers**

This breaks down because user requests are not one kind of task. Some ask about
workspace structure, some ask about document content, some require exhaustive
file-by-file reading, and many require a combination. When the engine treats all
of them as one broad retrieval problem, it retrieves wrong evidence, mixes
scopes, and local models confidently answer from polluted context.

### Concrete failure

User asks: *"How many files are in the RF Guides folder?"*

What the engine does:

1. `determineChatTurnRoute()` in `chatTurnRouter.ts` (L159) classifies this as
   `kind: 'grounded'` with `coverageMode: 'enumeration'`.
2. `createChatContextPlan()` in `chatContextPlanner.ts` (L56) suppresses RAG
   for enumeration mode (`needsRetrieval: false`).
3. But `loadChatContextSources()` in `chatContextSourceLoader.ts` (L49) takes a
   plain query string — `retrieveContext(userText)` at L59 — with **no** path
   scoping. If RAG were enabled, it would search the entire workspace.
4. The model must use `list_files` and `read_file` tools to answer, but:
   - No scope object tells the model which folder to look at.
   - No entity resolver maps "RF Guides" to its actual workspace path.
   - `inferExhaustiveFolderPath()` in `chatTurnPrelude.ts` (L13) is a single
     regex that may fail on informal names.
5. The model guesses, calls tools on the wrong path, and hallucinates.

This is especially damaging because Parallx relies on local models that are much
weaker at retrieval planning than frontier models. A local model can synthesize
from good context, but it cannot reliably decide:

- what kind of information is needed
- what scope to search in
- whether retrieval should be structural or semantic
- whether coverage is sufficient
- whether the answer matches the request

The remodel moves these responsibilities out of the model and into the engine.

---

## 2. Research Inputs

### Internal

| Source | Key finding |
|--------|-------------|
| Milestone 37 doc | Defined workspace-expert contract, two execution substrates, coverage-job concept. Most of M37 remains unimplemented beyond `coverageMode` scaffolding. |
| Session debugging (M38 origin) | Root-caused "RF Guides" contamination: global RAG returns wrong-folder chunks; system prompt told model to trust them. |
| `docs/ai/RAG_ARCHITECTURE_COMPARISON.md` | Compared ChatGPT, Claude, OpenClaw context handling patterns. |
| `docs/ai/RAG_RETRIEVAL_HARDENING_RESEARCH.md` | Detailed retrieval failure modes and hardening strategies. |
| `docs/ai/RETRIEVAL_PERFORMANCE_FIX_PLAN.md` | Identified specific RAG pipeline bottlenecks. |

### External

| Source | Key finding |
|--------|-------------|
| OpenClaw architecture | Zero RAG. Fixed bootstrap injection + tool-driven knowledge. Model calls `memory_search`, `memory_get`, `read`, `exec` for everything. No embeddings, no vector DB. |
| ChatGPT Projects | Project-scoped knowledge, file-identity-aware retrieval, scored chunks with source attribution. |
| Claude Projects | Project-first knowledge base with automatic RAG scaling. User expectation: "Claude knows this project." |

### Agreed architectural direction

**Not** copying OpenClaw's zero-RAG approach. RAG is genuinely valuable for
local models answering knowledge questions. The fix is **scoped retrieval** —
the RAG query should carry a scope. Structural questions should bypass RAG
entirely. Search-knowledge remains available as a fallback tool.

---

## 3. Current Parallx State

### What Parallx already has

The raw ingredients exist:

1. Chunked and embedded workspace indexing (nomic-embed-text v1.5, sqlite-vec).
2. Hybrid vector + FTS5 BM25 retrieval merged via RRF (k=60).
3. File-backed canonical memory layers (workspace memory + session transcripts).
4. Transcript recall lane and explicit tools.
5. Read-only Ask-mode tools (`list_files`, `read_file`, `search_files`,
   `search_knowledge`).
6. Prompt layering and workspace-aware chat routing.
7. Answer repair pipeline for domain-specific fixups.
8. `coverageMode` field on routes and retrieval plans (M37 scaffolding).
9. `sourceFilter` (type-level) and `sourceIds` (explicit source set) in
   `RetrievalOptions` — though `sourceIds` is only used internally by the
   ad-hoc "according to [book]" heuristic, not exposed to the chat pipeline.

### What the current pipeline actually does

The Ask-mode pipeline is strictly linear with 10 stages:

```
handleChatTurn()                 — defaultParticipant.ts
 ├─ 1. determineChatTurnRoute()  — chatTurnRouter.ts      L159
 ├─ 2. prepareChatTurnPrelude()  — chatTurnPrelude.ts      L78
 │     └─ inferExhaustiveFolderPath()                      L13
 ├─ 3. createChatContextPlan()   — chatContextPlanner.ts   L56
 ├─ 4. buildRetrievalPlan()      — chatContextPlanner.ts   L8
 ├─ 5. loadChatContextSources()  — chatContextSourceLoader L49
 │     └─ retrieveContext(userText)  ← unscoped, plain string
 ├─ 6. assembleChatContext()     — chatContextAssembly.ts   L109
 ├─ 7. composeChatUserContent()  — chatUserContentComposer  L30
 ├─ 8. buildSystemPrompt()      — chatSystemPrompts.ts     L41
 ├─ 9. executePreparedChatTurn() — defaultParticipant.ts
 │     └─ agentic tool loop (model calls tools)
 └─10. answer repair pipeline    — chatAnswerRepairPipeline
```

### Verified current constraints (with locations)

| Constraint | File | Location |
|------------|------|----------|
| Route kinds are 6 flat values, no task taxonomy | `chatTypes.ts` | L189–195 |
| `coverageMode` is a flag on the grounded route, not a distinct execution substrate | `chatTypes.ts` | L186, L201 |
| Router is pure regex, no entity/scope resolution | `chatTurnRouter.ts` | L159 |
| Planner produces the same `IChatContextPlan` shape regardless of coverage mode | `chatContextPlanner.ts` | L56 |
| `inferExhaustiveFolderPath()` is a single regex — no entity resolution | `chatTurnPrelude.ts` | L13 |
| RAG call is unscoped: `retrieveContext(userText)` with no path/scope parameters | `chatContextSourceLoader.ts` | L13, L59 |
| Context assembly merges all sources into flat string parts | `chatContextAssembly.ts` | L109 |
| Coverage contracts are informal prompt text, not engine-enforced | `chatUserContentComposer.ts` | L30 |
| `listFolderFiles()` is flat, max 50 files, no recursion | `chatDataService.ts` | L1606 |
| `search_knowledge` has type-level `source_filter` only, no path scoping | `fileTools.ts` | L193, L244 |
| `sourceIds` exists in `RetrievalOptions` but is never passed by the chat pipeline | `retrievalService.ts` | L578 |
| System prompt has no dynamic per-turn execution plan injection | `chatSystemPrompts.ts` | L41 |
| No `chatKnowledgeTaskExecutor.ts` exists | — | — |
| No `CoverageManifest` or `SourceEvidenceRecord` types exist | — | — |
| Pipeline is strictly linear — no branching, no re-planning, no intermediate validation | `defaultParticipant.ts` | — |

### What M37 implemented vs proposed

| M37 artifact | Status |
|-------------|--------|
| `coverageMode` field on route + plan | Implemented |
| Exhaustive/enumeration routing heuristics | Implemented |
| RAG suppression for exhaustive/enumeration | Implemented |
| `sourceIds` in `RetrievalOptions` | Exists (pre-M37), unused by chat |
| Expanded route kind taxonomy (7+ kinds) | Not implemented |
| `CoverageManifest` / `SourceEvidenceRecord` | Not implemented |
| Execution substrate typing | Not implemented |
| `chatKnowledgeTaskExecutor.ts` | Not implemented |
| Source-scoped retrieval (path filters) | Not implemented |
| Per-source evidence records | Not implemented |
| Fail-closed coverage behavior | Not implemented |
| Provenance split (searched/read/summarized) | Not implemented |

### Bottom line

Parallx has a decent retrieval assistant with early M37 scaffolding. It does not
yet have a planned evidence engine. Everything beyond `coverageMode` routing and
RAG suppression remains to be built.

---

## 4. Core Architectural Diagnosis

The fundamental defect is that the engine uses one runtime shape for two
different task classes, and has no scope resolution for either.

### Task class A — Retrieval questions

Examples: "What does my policy say about collision coverage?"

Well-served by: retrieval planning → top-k chunk selection → grounded synthesis
→ citations.

**Current code path:** `chatTurnRouter` → `coverageMode: 'representative'` →
RAG enabled → `chatContextSourceLoader.retrieveContext(userText)` → flat context
assembly → model synthesis. This works acceptably today.

### Task class B — Coverage jobs

Examples: "Read each file in RF Guides and summarize each one."

Requires: target enumeration → deterministic reads → per-source state tracking
→ fail-closed completion → per-item grounding.

**Current code path:** `chatTurnRouter` → `coverageMode: 'exhaustive'` → RAG
suppressed → model must self-chain `list_files` + `read_file` tools without
scope guidance. No coverage manifest. No fail-closed logic.

### Task class C — Scope-dependent questions (new in M38)

Examples: "What do the RF Guides say about claim reporting?"

Requires: scope resolution → entity resolution → scoped retrieval → synthesis.

**Current code path:** Identical to task class A. No scope resolution occurs.
`retrieveContext(userText)` searches the entire workspace. Chunks from
semantically similar but wrong-scope documents contaminate the context.

### What must change

1. Scope resolution must happen before retrieval.
2. Entity resolution must map natural references to workspace paths.
3. The planner must produce typed multi-step execution plans.
4. Evidence must carry source identity through the entire pipeline.
5. Coverage must be tracked and enforced, not assumed.
6. Retrieval must accept scope constraints (path filters).
7. The model is the synthesizer — the engine governs the workflow.

---

## 5. Milestone 38 Product Contract

After Milestone 38, the Ask-mode engine should satisfy:

1. The engine can resolve natural entity references ("RF Guides", "the Claims
   Guide") to actual workspace paths before retrieval.
2. The engine can scope retrieval to a folder or document set instead of
   searching the entire workspace.
3. Structural questions (list, count, enumerate) are answered from deterministic
   workspace data without semantic retrieval.
4. Scoped topic questions use folder/document-scoped retrieval, not global RAG.
5. Coverage jobs track which sources were enumerated, read, and represented.
6. If coverage is incomplete, the answer says so structurally.
7. The pipeline produces typed execution plans, not just context flags.
8. Evidence from different sources remains labeled until synthesis time.
9. The model synthesizes from engine-gathered, scope-verified evidence.
10. No regression for ordinary grounded Q&A (task class A).

---

## 6. Target Architecture

### 6.1. Atomic modes

The engine needs primitive operations that can be composed into workflows.

#### A. Resolution modes

These run first and produce a canonical scope object.

| Mode | What it does | Current state |
|------|-------------|---------------|
| **Scope resolution** | Maps request to workspace/folder/document/tab/selection | `inferExhaustiveFolderPath()` (L13, chatTurnPrelude.ts) — single regex, exhaustive only |
| **Entity resolution** | Maps "RF Guides", "Claims Guide" to actual paths | Not implemented. Only @mentions work. |
| **Ambiguity detection** | Determines if reference is resolved or needs fallback | Not implemented. |

**Where this lives:** New `resolveQueryScope()` function in `chatTurnPrelude.ts`
or a new `chatScopeResolver.ts`, called before `createChatContextPlan()`.

#### B. Evidence modes

These gather information within a resolved scope.

| Mode | What it does | Current state |
|------|-------------|---------------|
| **Structural inspection** | List files, count docs, inspect folders | `list_files` tool (L35, fileTools.ts), `listFolderFiles()` (L1606, chatDataService.ts) — model-driven, not engine-driven |
| **Metadata retrieval** | File names, types, dates, sizes, index state | Partial: `list_files` returns name/type/size |
| **Scoped semantic retrieval** | RAG within a scope (folder, document set) | Not implemented. `retrieveContext()` is always workspace-wide. `sourceIds` exists in `RetrievalOptions` (L578) but unused by chat. |
| **Exhaustive read** | Full-coverage reading of a source set | Model self-chains `read_file` — no engine batching |
| **Parser-specific read** | Type-aware extraction (PDF sections, spreadsheet sheets) | `read_file` supports rich docs via Docling (L66, fileTools.ts) but no type-aware strategies |

**Where scoped retrieval lives:** `sourceIds` on `RetrievalOptions` (L578,
retrievalService.ts) already exists. The chat pipeline must start passing it.
New `pathPrefixes` filter needed in `RetrievalService._collectCandidates()`.

#### C. Transformation modes

These operate on gathered evidence. Currently the model handles all of these
implicitly. M38 does not add engine-level transformation — the model remains the
synthesizer. But evidence must be **structured** so the model can transform it
correctly.

| Mode | What it does | Current state |
|------|-------------|---------------|
| **Aggregation** | Combine multi-source evidence | Model does this from flat context |
| **Compression** | Shrink to target format | Model does this from prompt contracts |
| **Comparative synthesis** | Keep sources distinct during comparison | Not enforced — sources are pooled flat in `chatContextAssembly.ts` |
| **Extraction** | Pull structured facts from evidence | Model-driven, no engine support |

#### D. Control modes

These govern execution quality.

| Mode | What it does | Current state |
|------|-------------|---------------|
| **Planning** | Build multi-step execution plan | Not implemented. `createChatContextPlan()` is a static switch-case. |
| **Fallback handling** | What to do when scoped search fails | One retry in `chatContextAssembly.ts` (L109). No structured fallback ladder. |
| **Coverage tracking** | Measure source-set coverage | Not implemented. |
| **Answer validation** | Check answer fits request + evidence + scope | Post-hoc repair pipeline (`chatAnswerRepairPipeline.ts`). Regex-based, not evidence-aware. |
| **Confidence gating** | Qualify claims when evidence is partial | Evidence assessment exists (sufficient/weak/insufficient) but not surfaced to user. |

### 6.2. Composite workflows

These are the workflow shapes the engine should support, composed from atomic
modes. Each maps to a concrete code path.

#### Workflow 1 — Structural Answer

*"How many files are in RF Guides?"*

```
resolve scope → structural inspection → answer
```

No semantic retrieval. Engine-answered where possible.

**Current path:** `coverageMode: 'enumeration'` → RAG suppressed → model must
call `list_files` → no scope provided to model. Partially working.

**M38 change:** Engine resolves "RF Guides" → path. Engine calls `list_files`
→ injects structural evidence → model formats the answer.

#### Workflow 2 — Scoped Topic Answer

*"What do the RF Guides say about claim reporting?"*

```
resolve scope → derive source set → scoped semantic retrieval → synthesize → validate
```

**Current path:** Falls through as generic `coverageMode: 'representative'` →
global RAG → wrong-scope contamination.

**M38 change:** Scope resolution produces `pathPrefixes: ['RF Guides/']`.
Retrieval filters to that folder. Model synthesizes from scoped evidence only.

#### Workflow 3 — Folder Summary

*"Summarize the files in RF Guides."*

```
resolve scope → enumerate files → choose strategy → build per-file
abstracts → aggregate → compress → validate coverage
```

**Current path:** `coverageMode: 'exhaustive'` → RAG suppressed → model
self-chains tools → no coverage tracking → may miss files.

**M38 change:** Engine enumerates file list, tracks per-file read status,
injects structured evidence with source labels, validates coverage before
synthesis.

#### Workflow 4 — Document Summary

*"Summarize the Claims Guide."*

```
resolve entity → choose full-read vs selective → summarize → validate
```

**Current path:** Generic grounded → global RAG returns chunks from Claims
Guide plus similar docs.

**M38 change:** Entity resolution maps "Claims Guide" → specific file. Engine
reads it directly or uses scoped retrieval. No cross-document contamination.

#### Workflow 5 — Comparative Analysis

*"Compare Claims Guide vs Quick Reference."*

```
resolve both entities → gather evidence separately → compare → validate
```

**Current path:** Generic grounded. Evidence from both sources is pooled flat
in `chatContextAssembly.ts`. Source identity lost during merging.

**M38 change:** Evidence gathered per-source, labeled, and presented to model
as distinct source blocks. Comparison synthesis preserves source identity.

#### Workflow 6 — Exhaustive Extraction

*"Find every deadline in RF Guides."*

```
resolve scope → enumerate source set → exhaustive read per source →
extract facts → aggregate → validate completeness
```

**Current path:** `coverageMode: 'exhaustive'` → model self-chains. No
guarantee all files are processed. No completeness validation.

**M38 change:** Engine enumerates files, reads each, passes to model for
extraction, tracks which files were processed, reports gaps.

#### Workflow 7 — Mixed Structural + Semantic

*"List the files in RF Guides and briefly explain what each is about."*

```
resolve scope → structural enumeration → per-file scoped evidence →
per-file synthesis → format → validate
```

**Current path:** Falls between enumeration and exhaustive. Model must figure
out the mixed strategy on its own.

**M38 change:** Workflow planner identifies the mixed nature. Engine handles
structural enumeration, provides per-file evidence, model synthesizes per-file
summaries.

### 6.3. Pipeline upgrade — target shape

```
handleChatTurn()
 ├─ 1. determineChatTurnRoute()       — classify intent + workflow type
 ├─ 2. resolveQueryScope()            — NEW: entity + scope resolution
 ├─ 3. buildExecutionPlan()           — NEW: typed multi-step plan
 ├─ 4. executeEvidenceGathering()     — NEW: scope-aware, per-source
 │     ├─ structural inspection       (when plan requires it)
 │     ├─ scoped retrieval            (when plan requires it)
 │     └─ deterministic reads         (when plan requires it)
 ├─ 5. assembleScopedEvidence()       — NEW: typed evidence, not flat string
 ├─ 6. composeChatUserContent()       — existing, adapted for typed evidence
 ├─ 7. buildSystemPrompt()            — existing, with plan-aware section
 ├─ 8. executePreparedChatTurn()      — existing model synthesis
 └─ 9. validateAnswer()               — NEW: coverage + scope validation
```

---

## 7. Canonical Internal Objects

These types define the data structures moving through the engine. They replace
implicit string blobs with typed, inspectable objects.

### A. Scope object

The mandatory scope passed through all downstream stages.

```ts
// Location: chatTypes.ts (alongside IRetrievalPlan at L181)

interface IQueryScope {
  readonly level: 'workspace' | 'folder' | 'document' | 'selection';
  readonly pathPrefixes?: string[];
  readonly documentIds?: string[];
  readonly derivedFrom: 'explicit-mention' | 'inferred' | 'contextual';
  readonly resolvedEntities?: IResolvedEntity[];
  readonly confidence: number;  // 0–1
}

interface IResolvedEntity {
  readonly naturalName: string;   // what the user said: "RF Guides"
  readonly resolvedPath: string;  // actual path: "RF Guides/"
  readonly kind: 'folder' | 'file' | 'page';
}
```

**Replaces:** The implicit `inferredFolder?: string` on `IChatTurnPrelude`
and the ad-hoc regex in `inferExhaustiveFolderPath()`.

**Used by:** Retrieval plan, context source loader, evidence gathering,
coverage tracking, answer validation.

### B. Execution plan object

The typed multi-step workflow plan.

```ts
// Location: chatTypes.ts (new, after IChatContextPlan at ~L203)

interface IExecutionPlan {
  readonly workflowType:
    | 'structural-answer'
    | 'scoped-topic'
    | 'folder-summary'
    | 'document-summary'
    | 'comparative'
    | 'exhaustive-extraction'
    | 'mixed-structural-semantic'
    | 'generic-grounded';
  readonly scope: IQueryScope;
  readonly steps: IExecutionStep[];
  readonly outputConstraints?: IOutputConstraints;
}

interface IExecutionStep {
  readonly mode: 'structural-inspect' | 'scoped-retrieve' | 'deterministic-read'
    | 'enumerate' | 'aggregate' | 'validate';
  readonly targetPaths?: string[];
  readonly description: string;
}

interface IOutputConstraints {
  readonly format?: 'paragraph' | 'bullets' | 'table' | 'per-source';
  readonly maxLength?: string;
}
```

**Replaces:** The `IChatContextPlan` flag-bag (L203, chatTypes.ts) which uses
booleans (`useRetrieval`, `useMemoryRecall`, etc.) instead of ordered steps.

**Note:** `IChatContextPlan` is not removed — it continues to serve as the
quick-path plan for generic grounded queries (task class A). `IExecutionPlan`
is used when the planner detects a non-trivial workflow.

### C. Evidence bundle

Source-keyed evidence that preserves identity through the pipeline.

```ts
// Location: chatTypes.ts (new)

interface IEvidenceBundle {
  readonly structural: IStructuralEvidence[];
  readonly semantic: ISemanticEvidence[];
  readonly exhaustive: IExhaustiveEvidence[];
}

interface IStructuralEvidence {
  readonly kind: 'file-list' | 'folder-metadata' | 'file-metadata';
  readonly sourcePath: string;
  readonly data: unknown;  // file list array, metadata record, etc.
}

interface ISemanticEvidence {
  readonly sourcePath: string;
  readonly sourceLabel: string;
  readonly chunks: readonly { text: string; score: number }[];
}

interface IExhaustiveEvidence {
  readonly sourcePath: string;
  readonly sourceLabel: string;
  readonly content: string;
  readonly readStatus: 'complete' | 'truncated' | 'failed';
}
```

**Replaces:** The flat `contextParts: string[]` in `chatContextAssembly.ts`
(L109) which pools all evidence into unlabeled strings.

### D. Coverage record

Tracks how much of the intended source set was represented.

```ts
// Location: chatTypes.ts (new)

interface ICoverageRecord {
  readonly totalTargets: number;
  readonly enumerated: number;
  readonly read: number;
  readonly represented: number;
  readonly skipped: number;
  readonly skippedReasons?: string[];
  readonly level: 'full' | 'partial' | 'minimal';
}
```

**Replaces:** The single binary evidence assessment (sufficient/weak/
insufficient) currently used in the grounded response helpers.

**Used by:** Answer validation, user-facing partiality messages, provenance
surfaces.

---

## 8. Execution Plan

### Phase 0 — Scope Resolution Foundation

**Goal:** The engine can resolve natural entity references to workspace paths
before any retrieval or tool use occurs.

**Files affected:**
- `chatTurnPrelude.ts` — expand `inferExhaustiveFolderPath()` into general scope resolution
- `chatTypes.ts` — add `IQueryScope`, `IResolvedEntity` types
- `chatDataService.ts` — provide workspace file/folder listing for entity matching

**Tasks:**

0.1. Define `IQueryScope` and `IResolvedEntity` in `chatTypes.ts`.

0.2. Implement `resolveQueryScope()` in `chatTurnPrelude.ts` (or new file
     `chatScopeResolver.ts`). This function:
     - Extracts natural entity references from the user message.
     - Matches them against the workspace file tree using fuzzy matching
       (already available via `search_files` patterns and workspace digest).
     - Attaches `@mentions` as explicit entities.
     - Falls back to `level: 'workspace'` when no scope is detectable.
     - Subsumes `inferExhaustiveFolderPath()` — that function becomes a
       special case of scope resolution.

0.3. Wire `resolveQueryScope()` into the pipeline between routing and planning
     (in `prepareChatTurnPrelude()` at L78 or `defaultParticipant.ts`).

0.4. Add unit tests for scope resolution: exact folder matches, fuzzy matches,
     file matches, page matches, no-match fallback, @mention passthrough.

### Phase 1 — Scoped Retrieval

**Goal:** The retrieval pipeline honors scope constraints. RAG searches within
the resolved scope instead of the entire workspace.

**Files affected:**
- `retrievalService.ts` — add `pathPrefixes` filter to `RetrievalOptions` and candidate collection
- `chatContextSourceLoader.ts` — pass scope through to retrieval calls
- `fileTools.ts` — add `folder_path` parameter to `search_knowledge`

**Tasks:**

1.1. Add `pathPrefixes?: string[]` to `RetrievalOptions` (L572).

1.2. In `RetrievalService._collectCandidates()`, filter candidates by
     `pathPrefixes` when present. This means adding a WHERE clause to the
     hybrid search SQL that matches `source_id LIKE ?` for each prefix.

1.3. Update `loadChatContextSources()` signature to accept `IQueryScope`.
     When scope has `pathPrefixes`, pass them as `RetrievalOptions.pathPrefixes`
     to `retrieveContext()`.

1.4. Update `createSearchKnowledgeTool()` (L193) to accept an optional
     `folder_path` parameter. When present, convert it to `pathPrefixes` in
     the retrieval call.

1.5. Add unit tests: scoped retrieval returns only in-scope results, global
     fallback works when scope returns insufficient results.

### Phase 2 — Workflow Planning

**Goal:** The planner identifies composite workflow types and produces typed
execution plans instead of flat boolean flags.

**Files affected:**
- `chatTypes.ts` — add `IExecutionPlan`, `IExecutionStep`, workflow types
- `chatTurnRouter.ts` — classify composite workflow types
- `chatContextPlanner.ts` — build execution plans from scope + route

**Tasks:**

2.1. Define `IExecutionPlan`, `IExecutionStep`, `IOutputConstraints` in
     `chatTypes.ts`.

2.2. Add workflow type detection to `determineChatTurnRoute()`. Current
     coverage mode detection (`isExhaustiveWorkspaceReviewTurn()`,
     `isFileEnumerationTurn()`) expands to also detect:
     - scoped-topic (entity reference + topic question)
     - folder-summary (entity reference + summary verb)
     - document-summary (single entity + summary verb)
     - comparative (two entities + comparison cue)
     - exhaustive-extraction (entity + "every"/"all" + extraction verb)
     - mixed (structural cue + semantic cue together)

2.3. Create `buildExecutionPlan()` function (new file
     `chatExecutionPlanner.ts` or extend `chatContextPlanner.ts`). This
     function takes the route + resolved scope and produces a typed
     `IExecutionPlan` with ordered steps.

2.4. For `workflowType: 'generic-grounded'`, the execution plan wraps the
     existing `IChatContextPlan` — no behavior change for task class A queries.

2.5. Add unit tests: each workflow type maps to the correct step sequence.

### Phase 3 — Evidence Gathering Engine

**Goal:** The engine gathers evidence according to the execution plan, producing
typed evidence bundles with source identity.

**Files affected:**
- `chatTypes.ts` — add `IEvidenceBundle`, evidence subtypes
- New file: `chatEvidenceGatherer.ts` — execute evidence-gathering steps
- `chatContextSourceLoader.ts` — refactor to support per-step loading
- `chatDataService.ts` — extend `listFolderFiles()` for coverage-aware enumeration

**Tasks:**

3.1. Define `IEvidenceBundle`, `IStructuralEvidence`, `ISemanticEvidence`,
     `IExhaustiveEvidence` in `chatTypes.ts`.

3.2. Create `chatEvidenceGatherer.ts` with function `gatherEvidence()` that
     takes an `IExecutionPlan` and produces an `IEvidenceBundle`:
     - For `'enumerate'` steps: calls `listFolderFiles()` on the scope path.
     - For `'structural-inspect'` steps: calls `list_files` equivalent.
     - For `'scoped-retrieve'` steps: calls scoped retrieval from Phase 1.
     - For `'deterministic-read'` steps: reads each target file via
       `chatDataService`.

3.3. Extend `listFolderFiles()` (L1606) to support recursive enumeration
     and return structured metadata (not just content strings).

3.4. Adapt `assembleChatContext()` (L109, chatContextAssembly.ts) to accept
     `IEvidenceBundle` and format evidence with source labels instead of
     flat pooling.

3.5. Add unit tests: evidence gathering produces correct types per step,
     source labels survive assembly.

### Phase 4 — Coverage Tracking and Validation

**Goal:** Coverage jobs track completion and fail closed when evidence is
incomplete.

**Files affected:**
- `chatTypes.ts` — add `ICoverageRecord`
- `chatEvidenceGatherer.ts` — compute coverage after gathering
- `chatUserContentComposer.ts` — inject coverage constraints
- `chatAnswerRepairPipeline.ts` — add coverage validation step

**Tasks:**

4.1. Define `ICoverageRecord` in `chatTypes.ts`.

4.2. After evidence gathering, compute a `ICoverageRecord` in
     `chatEvidenceGatherer.ts`: count targets vs read vs represented.

4.3. When `coverageRecord.level === 'partial' || 'minimal'`, inject a
     structured coverage note into the user message via
     `composeChatUserContent()` so the model knows to qualify its answer.

4.4. Add a post-synthesis validation step in
     `chatAnswerRepairPipeline.ts`: if coverage record shows gaps, ensure
     the answer doesn't claim completeness.

4.5. Add unit tests: partial coverage produces correct records, coverage
     notes appear in composed content, validation catches false completeness.

### Phase 5 — Pipeline Integration

**Goal:** Wire the new stages into `defaultParticipant.ts` so the full planned
evidence pipeline is active.

**Files affected:**
- `defaultParticipant.ts` — insert new stages into `handleChatTurn()`
- `chatSystemPrompts.ts` — add plan-aware prompt section

**Tasks:**

5.1. In `handleChatTurn()`, insert after routing and before context
     assembly:
     ```
     route → resolveQueryScope() → buildExecutionPlan() →
     gatherEvidence() → assembleScopedEvidence() → ...existing...
     ```

5.2. For `workflowType: 'generic-grounded'`, the new stages are no-ops —
     the existing path runs unchanged.

5.3. Add a dynamic execution plan section to `buildSystemPrompt()` (L41)
     so the model knows the scope and workflow constraints for this turn.

5.4. Integration tests: end-to-end test each workflow type with the demo
     workspace.

### Phase 6 — Evaluation

**Goal:** Validate against real researcher scenarios.

**Files affected:**
- `tests/ai-eval/` — new or expanded evaluation specs
- `tests/unit/` — regression tests for task class A

**Tasks:**

6.1. Add AI evals for: folder enumeration, scoped topic question, folder
     summary, document summary, comparative analysis, exhaustive extraction,
     mixed workflow.

6.2. Verify no regression for ordinary grounded Q&A (task class A) using
     existing Books AI eval harness.

6.3. Test with the demo workspace for scope resolution accuracy.

---

## 9. Exact File Map

### A. Types and contracts

| File | Changes |
|------|---------|
| `src/built-in/chat/chatTypes.ts` | Add `IQueryScope`, `IResolvedEntity`, `IExecutionPlan`, `IExecutionStep`, `IOutputConstraints`, `IEvidenceBundle`, `IStructuralEvidence`, `ISemanticEvidence`, `IExhaustiveEvidence`, `ICoverageRecord`. Extend `IChatRuntimeTrace` to carry scope and plan. |

### B. Scope resolution

| File | Changes |
|------|---------|
| `src/built-in/chat/utilities/chatTurnPrelude.ts` | Replace `inferExhaustiveFolderPath()` with `resolveQueryScope()`. Update `prepareChatTurnPrelude()` to return scope on prelude result. |
| *or* new `src/built-in/chat/utilities/chatScopeResolver.ts` | If scope resolution grows large enough to warrant its own file. Decision at implementation time. |

### C. Scoped retrieval

| File | Changes |
|------|---------|
| `src/services/retrievalService.ts` | Add `pathPrefixes` to `RetrievalOptions` (near L572). Filter candidates in `_collectCandidates()` by path prefix. |
| `src/built-in/chat/utilities/chatContextSourceLoader.ts` | Accept `IQueryScope`, pass `pathPrefixes` to `retrieveContext()`. |
| `src/built-in/chat/tools/fileTools.ts` | Add `folder_path` param to `search_knowledge` tool (L193). |

### D. Workflow planning

| File | Changes |
|------|---------|
| `src/built-in/chat/utilities/chatTurnRouter.ts` | Expand workflow type detection beyond exhaustive/enumeration. |
| `src/built-in/chat/utilities/chatContextPlanner.ts` | Add `buildExecutionPlan()` or new `chatExecutionPlanner.ts`. |

### E. Evidence gathering

| File | Changes |
|------|---------|
| New: `src/built-in/chat/utilities/chatEvidenceGatherer.ts` | `gatherEvidence()`: execute plan steps, produce `IEvidenceBundle`. |
| `src/built-in/chat/data/chatDataService.ts` | Extend `listFolderFiles()` for recursive enumeration and structured metadata. |
| `src/built-in/chat/utilities/chatContextAssembly.ts` | Accept `IEvidenceBundle`, format with source labels. |

### F. Coverage and validation

| File | Changes |
|------|---------|
| `src/built-in/chat/utilities/chatEvidenceGatherer.ts` | Compute `ICoverageRecord` after gathering. |
| `src/built-in/chat/utilities/chatUserContentComposer.ts` | Inject coverage constraints when coverage is partial. |
| `src/built-in/chat/utilities/chatAnswerRepairPipeline.ts` | Add coverage-aware validation step. |

### G. Pipeline integration

| File | Changes |
|------|---------|
| `src/built-in/chat/participants/defaultParticipant.ts` | Insert scope resolution, execution planning, evidence gathering into `handleChatTurn()`. |
| `src/built-in/chat/config/chatSystemPrompts.ts` | Add dynamic plan-aware section to system prompt. |

### H. Tests

| File | Changes |
|------|---------|
| `tests/unit/chatScopeResolver.test.ts` | Scope resolution unit tests. |
| `tests/unit/chatExecutionPlanner.test.ts` | Workflow type → plan mapping tests. |
| `tests/unit/chatEvidenceGatherer.test.ts` | Evidence gathering per step type. |
| `tests/unit/chatContextSourceLoader.test.ts` | Scoped retrieval passthrough. |
| `tests/unit/retrievalService.test.ts` | Path prefix filtering. |
| `tests/ai-eval/` | Evaluation specs for each workflow type. |

---

## 10. Success Criteria

### Product criteria

1. "How many files are in RF Guides?" returns the correct count from the
   correct folder, without hallucinating files from other directories.
2. "What does the Claims Guide say about liability?" returns evidence from
   the Claims Guide only, not from similar-sounding documents.
3. "Summarize each file in RF Guides" produces per-file summaries for every
   file in the folder, with no fabricated summaries for unread files.
4. "Compare Claims Guide vs Quick Reference" presents evidence labeled by
   source and does not blend them.
5. Partial-coverage answers include a visible note about which files were
   not processed.
6. Ordinary grounded Q&A ("What is collision coverage?") works at least as
   well as today — no regression.

### Technical criteria

1. `resolveQueryScope()` maps natural names to workspace paths with ≥80%
   accuracy on the demo workspace.
2. Scoped retrieval returns only in-scope chunks when `pathPrefixes` is set.
3. `IExecutionPlan` is constructed for every non-generic workflow.
4. `ICoverageRecord` is computed for every coverage job.
5. All existing unit tests pass with no regressions.
6. AI eval harness covers all 7 workflow types.

---

## 11. Non-Goals

Milestone 38 does not aim to:

1. Redesign autonomous Agent mode (agent mode has its own pipeline).
2. Build cloud-scale document processing.
3. Replace local-first principles with hosted services.
4. Make semantic retrieval obsolete — RAG remains the right choice for knowledge
   questions within scope.
5. Implement hierarchical summarization at scale (Phase 5 in M38 original
   vision). This milestone builds the planning and scoping foundation. Advanced
   summarization strategies can follow.
6. Add precomputed file abstracts or TOC maps. These are valuable accelerators
   but out of scope for the core M38 remodel.

---

## 12. Identified Gaps and Resolution Policy

### Gap 1 — Workflow triggering conditions

**Status:** Partially addressed by `isExhaustiveWorkspaceReviewTurn()` and
`isFileEnumerationTurn()` heuristics in `chatTurnRouter.ts`.

**Resolution:** Phase 2, Task 2.2 expands the router with explicit signal
detection for each workflow type: structural verbs, summary verbs, comparison
cues, exhaustive cues, scope cues.

### Gap 2 — Ambiguity policy

**Status:** Not implemented. `inferExhaustiveFolderPath()` is best-effort with
no fallback.

**Resolution:** Phase 0, Task 0.2 builds `resolveQueryScope()` with confidence
scoring. When confidence is low, the engine falls back to `level: 'workspace'`
and lets the model use tools. Explicit disambiguation (asking the user) is
deferred beyond M38.

### Gap 3 — Fallback policy

**Status:** One retry exists in `chatContextAssembly.ts`. No structured ladder.

**Resolution:** Phase 1, Task 1.5 adds scoped-to-global fallback: if scoped
retrieval returns insufficient results, the engine retries with workspace scope
and annotates the evidence as broadened. Structural workflows do not broaden
semantically. Coverage workflows stop rather than overclaim.

### Gap 4 — Coverage thresholds

**Status:** Evidence assessment is binary (sufficient/weak/insufficient).

**Resolution:** Phase 4 adds `ICoverageRecord` with explicit counts. Thresholds
for M38: structural answers require 100% enumeration. Folder summaries require
≥90% file representation. Scoped topic questions do not require coverage
guarantees (they use top-k retrieval within scope).

### Gap 5 — Precomputed intermediate artifacts

**Status:** Chunks and embeddings exist. No file abstracts, TOC maps, or
per-document topic vectors.

**Resolution:** Deferred beyond M38. The Phase 3 evidence gatherer reads files
directly. Precomputed abstracts are an optimization for a later milestone.

### Gap 6 — Intermediate memory and traceability

**Status:** `IChatRuntimeTrace` (chatTypes.ts) carries route and context plan.
No step outputs, coverage stats, or fallback events.

**Resolution:** Phase 5, Task 5.1 extends `IChatRuntimeTrace` to carry
`IExecutionPlan` and `ICoverageRecord`. Debug tracing of individual steps is
deferred to a later milestone.

### Gap 7 — Planning vs execution separation

**Status:** No planner exists.

**Resolution:** Phase 2 builds a deterministic planner. The planner cannot make
heuristic mid-execution revisions in M38. It produces a fixed plan from route +
scope, and the evidence gatherer executes it. Adaptive re-planning is deferred.

### Gap 8 — User-visible honesty behavior

**Status:** Evidence assessment influences prompt contracts but is not surfaced
to the user.

**Resolution:** Phase 4 injects coverage notes into the model's prompt when
coverage is partial. The model is instructed to include these in its response.
Full UI treatment (provenance badges, coverage meters) is deferred.

### Gap 9 — Source balancing

**Status:** Evidence role balancing exists in `retrievalService.ts`
(`_applyEvidenceRoleBalancing`) but it balances by domain-content role, not
by source identity.

**Resolution:** Phase 3 evidence assembly keeps evidence labeled by source.
For folder summaries, each file gets its own evidence section. The model
receives balanced per-source evidence instead of a pooled chunk set.

### Gap 10 — Failure mode taxonomy

The remodel addresses these failure modes:

| Failure mode | Fix |
|-------------|-----|
| Scope drift | Scope object preserves intent through pipeline |
| Structural/semantic confusion | Workflow classification separates them |
| Source blending | Source-labeled evidence bundles |
| Incomplete coverage masked as complete | Coverage records + fail-closed behavior |
| Silent fallback contamination | Annotated broadening in fallback |
| Ranking domination by irrelevant chunks | Path-prefix scoping removes them |

---

## Final Decision

Milestone 38 should proceed under a simple rule:

**The engine resolves scope and plans evidence gathering before the model sees
anything.**

Not retrieve globally and hope the model filters.
Not inject flat context and hope the model sorts it.
Not suppress RAG and hope the model chains tools correctly.

Scope first. Plan second. Evidence third. Model last.
