# Milestone 37 — Workspace Expert Remodel

> Scope note
>
> Milestone 37 is not a patch milestone.
> It is a redesign milestone for the core Ask-mode knowledge contract.
>
> If Milestone 36 was about lane clarity and trust surfaces, Milestone 37 is
> about changing Parallx from a snippet-RAG assistant into a trustworthy
> workspace expert that can:
>
> 1. answer targeted questions precisely;
> 2. process file sets deterministically when full coverage is required;
> 3. fail closed when coverage is incomplete;
> 4. remain locally grounded and inspectable.

---

## Table of Contents

1. Problem Statement
2. Research Inputs
3. Current Parallx State
4. External Reference Patterns
5. Core Architectural Diagnosis
6. Milestone 37 Product Contract
7. Remodel Decision
8. Target Runtime Architecture
9. Execution Plan
10. Exact File Map
11. Success Criteria
12. Non-Goals

---

## Problem Statement

Parallx currently behaves too much like a general snippet-retrieval assistant in
Ask mode.

That is acceptable for:

1. targeted workspace questions;
2. specific fact lookup;
3. narrow, citation-backed grounded answers.

It is not acceptable for the core second-brain and researcher workflows that
matter most to this product:

1. summarizing every file in a folder;
2. comparing multiple papers or guides;
3. extracting consistent commentary across a corpus;
4. answering as a true expert on the workspace contents.

The current failure mode is severe:

1. the system retrieves representative chunks rather than guaranteeing corpus
   coverage;
2. the model is still allowed to answer in exhaustive formats;
3. source chips and retrieved snippets create a false sense of completeness;
4. Ask mode remains too trust-fragile for serious knowledge work.

Milestone 37 exists to correct that at the architectural level.

---

## Research Inputs

### Internal code and design review

Primary audited runtime files:

1. `src/built-in/chat/participants/defaultParticipant.ts`
2. `src/built-in/chat/utilities/chatTurnPrelude.ts`
3. `src/built-in/chat/utilities/chatTurnRouter.ts`
4. `src/built-in/chat/utilities/chatContextPlanner.ts`
5. `src/built-in/chat/utilities/chatTurnContextPreparation.ts`
6. `src/built-in/chat/utilities/chatContextAssembly.ts`
7. `src/built-in/chat/utilities/chatUserContentComposer.ts`
8. `src/built-in/chat/config/chatSystemPrompts.ts`
9. `src/services/retrievalService.ts`
10. `src/services/vectorStoreService.ts`
11. `src/services/chunkingService.ts`
12. `src/built-in/chat/data/chatDataService.ts`
13. `src/built-in/chat/tools/fileTools.ts`
14. `src/services/languageModelToolsService.ts`

Primary internal research reviewed:

1. `docs/Parallx_Milestone_36.md`
2. `docs/ai/RAG_ARCHITECTURE_COMPARISON.md`
3. `docs/ai/RAG_RETRIEVAL_HARDENING_RESEARCH.md`
4. `docs/ai/RETRIEVAL_PERFORMANCE_FIX_PLAN.md`

### External reference research

Reviewed external references:

1. OpenAI Projects in ChatGPT help documentation
2. OpenAI Retrieval API guide
3. Claude Projects help documentation
4. OpenClaw repository docs and source excerpts around memory, sessions,
   tool-first recall, and workspace handling

---

## Current Parallx State

### What Parallx already has

Parallx is not missing the raw ingredients.

It already has:

1. chunked and embedded workspace indexing;
2. hybrid vector + keyword retrieval;
3. file-backed canonical memory layers;
4. transcript recall lane and explicit tools;
5. read-only Ask-mode tools;
6. prompt layering and workspace-aware chat routing.

### What the current Ask-mode runtime actually does

The Ask-mode pipeline today is still primarily:

1. parse request;
2. classify route;
3. generate retrieval plan;
4. run semantic retrieval and related context loading;
5. pack selected context into the prompt;
6. let the model decide whether to use read-only tools;
7. synthesize the answer.

This means that even though Ask mode can use read-only tools, it still behaves
as a retrieval-first system, not a deterministic workspace-processing system.

### Verified current constraints

1. `defaultParticipant.ts` still treats Ask mode as a model-centered synthesis
   pass after retrieval context assembly.
2. `chatTurnPrelude.ts` and `chatContextPlanner.ts` classify intent, but they do
   not yet change the execution substrate deeply enough.
3. `retrievalService.ts` is optimized for finding good chunks, not proving file
   set coverage.
4. `chatDataService.ts:listFolderFiles()` truncates file reads, caps file count,
   and is best-effort rather than coverage-accounted.
5. `fileTools.ts:read_file` explicitly nudges the model to trust retrieved
   context and avoid re-reading files unless necessary.
6. `chatTurnContextPreparation.ts` assembles evidence for answering, but not a
   ledger of what requested sources were fully processed.
7. provenance currently reports considered or visible sources, but does not
   certify per-file completion.

### Bottom line

Parallx already has a decent retrieval assistant.
It does not yet have a trustworthy workspace expert runtime.

---

## External Reference Patterns

### ChatGPT Projects pattern

What matters from the OpenAI product reference is not hidden implementation
details, but the product contract:

1. project-contained context;
2. uploaded files as first-class project knowledge;
3. project memory and instructions scoped to the project;
4. optional external connectors and tools when needed.

What matters from the OpenAI retrieval reference:

1. retrieval returns scored chunks tied to file identity;
2. vector store files can carry attributes for filtering;
3. synthesis is explicitly a second step after search, not a claim of full
   corpus coverage;
4. chunking, ranking, query rewriting, and filtering are first-class controls.

### Claude Projects pattern

Claude's public product contract is also project-first:

1. self-contained project workspaces;
2. project knowledge as a dedicated knowledge base;
3. project instructions scoped to that knowledge base;
4. automatic RAG scaling when project knowledge exceeds raw context limits.

This matters because the user expectation becomes:

1. “Claude knows the contents of this project,” not
2. “Claude may have seen some representative chunks from this project.”

### OpenClaw pattern

OpenClaw is the most directly relevant architectural reference.

Its key pattern is not “better embeddings.”
Its key pattern is **search is separate from read**.

Observed OpenClaw-aligned properties:

1. explicit `memory_search` and `memory_get` separation;
2. session/session-history access as explicit tools;
3. search returns snippets, not a false promise of full-file understanding;
4. file and tool operations are treated as the actual execution substrate;
5. index status and source counts are inspectable.

### External comparison conclusion

Parallx is currently closest to a retrieval-centric IDE assistant.

The target state is closer to a hybrid of:

1. ChatGPT/Claude project knowledge behavior for user expectation and project
   containment;
2. OpenClaw's explicit search-then-read discipline for trustworthy execution.

---

## Core Architectural Diagnosis

The main problem is not that retrieval is weak in isolation.

The main problem is that Parallx is using one runtime shape for two different
classes of tasks.

### Task class A — Retrieval questions

Examples:

1. “What does my policy say about collision coverage?”
2. “Where is the concept recall code?”
3. “What changed in Milestone 36?”

These are well-served by:

1. retrieval planning;
2. top-k chunk selection;
3. grounded synthesis;
4. citations.

### Task class B — Coverage jobs

Examples:

1. “Read each file in this folder and summarize each one.”
2. “Compare all research papers in this directory.”
3. “Build a table of each document's thesis, method, and conclusions.”

These are **not** normal retrieval questions.
They are corpus-processing jobs.

They require:

1. target enumeration;
2. deterministic reads or coverage-aware extraction;
3. per-source state tracking;
4. fail-closed completion logic;
5. per-item grounding.

### Present failure

Parallx currently lets class B tasks fall through a class A pipeline.

That is the fundamental defect Milestone 37 must remove.

---

## Milestone 37 Product Contract

After Milestone 37, Ask mode should satisfy this contract:

1. Parallx can distinguish between a retrieval question and a coverage job.
2. For coverage jobs, Parallx enumerates the target corpus explicitly.
3. Parallx tracks which requested sources were actually processed.
4. Parallx never produces a complete-looking exhaustive answer from partial
   evidence.
5. Every per-file or per-document claim is bound to that source's evidence, not
   to a nearby chunk from another source.
6. If coverage is incomplete, the answer says so plainly and structurally.
7. Source surfaces distinguish:
   - searched candidates
   - read sources
   - summarized sources
   - unsatisfied targets
8. Ask mode is trustworthy enough for a researcher or second-brain workflow.

---

## Remodel Decision

Milestone 37 will redesign Ask mode around **two execution substrates**.

### Substrate 1 — Grounded retrieval answering

Used for:

1. targeted questions;
2. exact lookups;
3. narrow grounded explanation.

Pipeline:

1. classify;
2. retrieve;
3. optionally refine;
4. answer with citations.

### Substrate 2 — Deterministic workspace knowledge jobs

Used for:

1. summarize-each;
2. compare-across-set;
3. build structured views over a set of files/documents;
4. audit or survey a corpus.

Pipeline:

1. classify as coverage job;
2. enumerate target source set;
3. establish coverage plan;
4. read or extract source content deterministically;
5. build per-source evidence records;
6. synthesize only from completed records;
7. report completion metrics and gaps.

This is the central Milestone 37 decision.

---

## Target Runtime Architecture

### 1. Knowledge task classifier

Introduce an explicit task taxonomy in Ask mode:

1. conversational
2. targeted-grounded
3. exact-lookup
4. coverage-review
5. comparison-review
6. memory-recall
7. transcript-recall

This classifier must drive execution mode, not just prompt wording.

### 2. Coverage-aware corpus executor

Add a deterministic Ask-mode executor that can:

1. enumerate the requested file set;
2. build a `CoverageManifest`;
3. read or extract each target source;
4. create a `SourceEvidenceRecord` per file;
5. mark a source as complete, partial, skipped, or failed;
6. feed only completed evidence into final synthesis.

### 3. Exact-lookup lane

Add a dedicated exact lookup contract for:

1. filenames;
2. identifiers;
3. config keys;
4. dates;
5. numeric thresholds;
6. policy values.

This should prefer file filters, keyword focus, and exact source constraints
before broad semantic retrieval.

### 4. Search-versus-read separation

Parallx must adopt OpenClaw's discipline more consistently:

1. search finds candidates;
2. read confirms source content;
3. synthesis occurs after confirmation.

Search results alone must not be treated as proof of full understanding for
coverage jobs.

### 5. Coverage accounting and fail-closed behavior

For any coverage job, Ask mode must know:

1. how many targets were requested;
2. how many were enumerated;
3. how many were actually read or extracted;
4. how many yielded usable evidence;
5. how many remain unresolved.

Final answers must expose that state.

### 6. Provenance split: searched, read, summarized

Current provenance is not enough.

Milestone 37 should distinguish at least:

1. candidate source
2. read source
3. summarized source
4. recalled memory
5. recalled transcript

### 7. Source-identity-preserving synthesis

Per-file summaries and comparisons must be constructed from a normalized
evidence object keyed by source identity, not from a pooled flat chunk set.

### 8. Retrieval storage improvements

Vector and keyword retrieval should support stronger source-level filtering:

1. file path filters;
2. file-set filters;
3. document-kind filters;
4. exact filename match bias;
5. candidate set audits.

---

## Execution Plan

### Phase 0 — Instrument the truth

Goal:
make the runtime able to tell the truth about what it did.

Tasks:

1. add coverage and source-processing telemetry to the Ask-mode pipeline;
2. distinguish retrieved candidates from direct reads;
3. expose enough debug state to support unit tests and AI evals.

### Phase 1 — Replace intent-only planning with execution-mode planning

Goal:
move from “what kind of answer is this?” to “what runtime should execute this?”

Tasks:

1. expand route and retrieval plan types to encode execution substrate;
2. classify coverage jobs explicitly;
3. classify exact lookups explicitly;
4. route them away from generic snippet-only answering.

### Phase 2 — Add deterministic Ask-mode corpus execution

Goal:
coverage jobs become real jobs, not optimistic prompts.

Tasks:

1. enumerate target file sets from folder/path/user scope;
2. build coverage manifests;
3. read target files deterministically with bounded batching;
4. construct per-source evidence records;
5. fail closed if coverage is incomplete.

### Phase 3 — Strengthen exact and source-filtered retrieval

Goal:
make exact asks and source-constrained asks reliable.

Tasks:

1. add source filters and file-set filters to retrieval calls;
2. strengthen filename and identifier exact-match bias;
3. preserve file identity across retrieval, reranking, and synthesis;
4. improve ranking/debug traces for exact asks.

### Phase 4 — Rebuild provenance and UI trust surfaces

Goal:
show the user what was searched, read, and completed.

Tasks:

1. update provenance types;
2. expose coverage completion in answer surfaces;
3. distinguish searched versus read versus summarized sources;
4. add fail-closed answer affordances when coverage is incomplete.

### Phase 5 — Evaluate against the real vision

Goal:
test researcher and second-brain scenarios directly.

Tasks:

1. establish the Books workspace AI eval harness as the primary Milestone 37
   acceptance benchmark for researcher-style corpus trust;
1. add AI evals for exhaustive summaries, corpus comparisons, exact lookups,
   and fail-closed behavior;
2. validate on mixed file types and messy workspaces;
3. verify no regression for ordinary grounded Q&A.

---

## Exact File Map

This section is the implementation map for Milestone 37.

### A. Request classification and execution contract

Primary files:

1. `src/built-in/chat/chatTypes.ts`
2. `src/built-in/chat/utilities/chatTurnRouter.ts`
3. `src/built-in/chat/utilities/chatContextPlanner.ts`
4. `src/built-in/chat/utilities/chatTurnPrelude.ts`

Required changes:

1. add execution-substrate typing;
2. add explicit coverage-review and exact-lookup task modes;
3. stop treating exhaustive jobs as ordinary grounded retrieval.

### B. Ask-mode runtime orchestration

Primary files:

1. `src/built-in/chat/participants/defaultParticipant.ts`
2. `src/built-in/chat/utilities/chatTurnExecutionConfig.ts`
3. `src/built-in/chat/utilities/chatTurnSynthesis.ts`
4. new file: `src/built-in/chat/utilities/chatKnowledgeTaskExecutor.ts`

Required changes:

1. insert a deterministic Ask-mode knowledge executor before generic model
   synthesis for coverage tasks;
2. allow Ask mode to use tools as the normal execution substrate for knowledge
   jobs, not merely as optional model behavior;
3. separate “job result synthesis” from “snippet RAG answer synthesis”.

### C. Context source loading and evidence packing

Primary files:

1. `src/built-in/chat/utilities/chatTurnContextPreparation.ts`
2. `src/built-in/chat/utilities/chatContextSourceLoader.ts`
3. `src/built-in/chat/utilities/chatContextAssembly.ts`

Required changes:

1. add evidence record structures keyed by source identity;
2. support manifests and source-completion metadata;
3. stop pooling partial multi-source context for per-file coverage jobs.

### D. File enumeration and read semantics

Primary files:

1. `src/built-in/chat/data/chatDataService.ts`
2. `src/built-in/chat/tools/fileTools.ts`
3. `src/services/languageModelToolsService.ts`

Required changes:

1. redesign `listFolderFiles()` around coverage jobs instead of convenience
   mention expansion;
2. add explicit bounded batch-read primitives or executor-level batching;
3. remove any prompt/tool messaging that over-discourages direct reads when the
   task requires them;
4. ensure Ask mode read-only tools are optimized for deterministic knowledge
   processing.

### E. Retrieval and vector-store capabilities

Primary files:

1. `src/services/retrievalService.ts`
2. `src/services/vectorStoreService.ts`
3. `src/services/serviceTypes.ts`
4. `src/services/chunkingService.ts`

Required changes:

1. add source-id and file-set filters to search contracts;
2. improve exact filename and identifier routing;
3. preserve and expose stronger file/document metadata;
4. add candidate-audit traces that can explain why a requested file was or was
   not surfaced;
5. evaluate whether chunking/index metadata should carry stronger file-level
   summary hooks for later deterministic processing.

### F. Prompt and synthesis contract

Primary files:

1. `src/built-in/chat/utilities/chatUserContentComposer.ts`
2. `src/built-in/chat/config/chatSystemPrompts.ts`
3. `src/built-in/chat/utilities/chatGroundedResponseHelpers.ts`

Required changes:

1. remove any remaining ambiguity between representative retrieval and
   exhaustive processing;
2. make fail-closed behavior mandatory for coverage jobs;
3. add structured synthesis contracts for per-source summaries and comparisons.

### G. Provenance and trust UI

Primary files:

1. `src/services/chatTypes.ts`
2. `src/built-in/chat/rendering/chatContentParts.ts`
3. `src/built-in/chat/input/chatContextPills.ts`
4. `src/built-in/chat/widgets/chatWidget.ts`

Required changes:

1. distinguish candidate/read/summarized source states;
2. expose coverage completion and unresolved targets;
3. make the UI reflect execution truth rather than raw source consideration.

### H. Evaluation and regression protection

Primary files:

1. `tests/unit/**/*.test.ts`
2. `tests/ai-eval/**`
3. `playwright.ai-eval.config.ts`

Required changes:

1. add unit coverage for execution mode selection;
2. add corpus-job tests for summary-each and compare-across-set;
3. add evals for exact lookup, fail-closed behavior, and no-cross-file
   contamination.

---

## Success Criteria

Milestone 37 is successful only if the following are true.

### Product criteria

1. Ask mode can reliably summarize every file in a requested folder without
   fabricating unread summaries.
2. Ask mode can compare a requested document set while preserving file identity.
3. Ask mode can fail closed when only partial coverage was achieved.
4. Exact asks about filenames, values, and identifiers are materially more
   reliable than today.
5. The user can tell which files were searched, which were read, and which were
   fully processed.

### Technical criteria

1. coverage jobs use a deterministic execution path;
2. generic snippet-RAG answering remains available for narrow questions;
3. provenance can represent coverage completion state;
4. retrieval supports source-scoped filtering needed by the new executor;
5. tests and evals catch file-set contamination and false-complete answers.

---

## Non-Goals

Milestone 37 is not trying to solve everything.

It does not aim to:

1. redesign autonomous Agent mode end-to-end;
2. build cloud-scale document processing;
3. replace local-first principles with hosted services;
4. make semantic retrieval obsolete.

Instead, it aims to put semantic retrieval in the correct place inside a more
trustworthy workspace-expert runtime.

---

## Final Decision

Milestone 37 should proceed under a simple rule:

**If the user asks for coverage, Parallx must execute for coverage.**

Not retrieve and hope.
Not synthesize and apologize.
Not cite “sources considered” as if that implies completion.

Execution for coverage is the remodel.