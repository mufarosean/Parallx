# Milestone 32 — Markdown-Backed Layered Memory Remodel

> Authoritative scope notice
>
> This document is the single source of truth for Milestone 32.
> All work that audits Parallx memory, verifies the current OpenClaw memory
> model, and transitions Parallx from database-centric memory toward a
> markdown-backed layered memory architecture must conform to the findings,
> constraints, and execution plan defined here.

---

## Table of Contents

1. Problem Statement
2. Product Goal
3. Current State Audit
4. Verified OpenClaw Findings
5. Research Conclusions
6. Scope and Non-Goals
7. Target Architecture
8. Execution Plan
9. Task Tracker
10. Verification Checklist
11. Risks and Open Questions
12. References

---

## Problem Statement

Parallx currently treats AI memory as a database feature first and a user-facing
knowledge surface second.

That is the wrong architectural center for the product we want.

Today, memory is primarily stored in SQLite tables and vector-index rows, then
recalled as formatted prompt text. The user does not have a canonical,
human-readable memory surface in the workspace that they can directly inspect,
edit, diff, and version control.

That creates five product problems:

1. the database is the source of truth instead of the workspace;
2. memory is opaque and hard to trust because users cannot see the canonical
   state as ordinary files;
3. recovery is weak because corruption or drift in the database cannot be fixed
   by rebuilding from markdown memory files;
4. the current memory layers are implicit implementation buckets
   (session summaries, concepts, preferences) rather than explicit product
   layers with clear semantics;
5. runtime memory behavior is coupled to chat orchestration in ways that make it
   hard to reason about, disable, or evolve safely.

Milestone 32 treats this as a remodel, not a polish pass.

The goal is not to preserve the current system and add small improvements.
The goal is to replace the current source-of-truth model with an OpenClaw-like
memory architecture where markdown files in the workspace are canonical and the
index is derived.

---

## Product Goal

Parallx memory should become:

1. file-backed,
2. layered,
3. inspectable,
4. rebuildable,
5. explicit in runtime semantics.

Concretely, the target product contract is:

1. `.parallx/memory/MEMORY.md` stores curated durable memory;
2. `.parallx/memory/YYYY-MM-DD.md` stores day-to-day logs and running context;
3. session transcripts are stored separately and can be optionally indexed for
   recall;
4. semantic search is a derived capability over those files, not the canonical
   store itself;
5. users can read, edit, and version-control memory directly from the workspace;
6. if the index is lost or corrupted, it can be rebuilt from workspace files.

---

## Current State Audit

### Persistence model today

Parallx memory is currently implemented in
`src/services/memoryService.ts`.

The canonical persisted state is split across SQLite tables and the vector
store:

1. `conversation_memories`
   - stores one summary row per chat session;
2. `learning_concepts`
   - stores concept summaries, encounter counts, struggle counts, and decay
     metadata;
3. `user_preferences`
   - stores extracted preference key-value pairs;
4. vector chunks with `source_type='memory'`
   - store embedded session summaries;
5. vector chunks with `source_type='concept'`
   - store embedded concept summaries.

This means Parallx memory is database-native, not workspace-native.

There is no canonical markdown memory file that the system rebuilds from.

### Retrieval model today

Conversation memory recall is hybrid search over the vector store filtered to
`source_type='memory'`, followed by metadata lookup and decay-weighted
re-ranking.

Concept recall is a similar vector-backed lookup filtered to
`source_type='concept'`.

The recalled results are then converted into prompt blocks:

1. `[Conversation Memory]` blocks via `formatMemoryContext(...)`;
2. `[Prior knowledge — concepts the user has studied before]` blocks via
   `formatConceptContext(...)`.

This is useful as an implementation technique, but it means the model sees a
derived textual view of database rows rather than recalling directly from a
workspace memory corpus.

### Runtime integration today

Chat integration currently flows through
`src/built-in/chat/data/chatDataService.ts`,
`src/built-in/chat/utilities/chatContextPlanner.ts`,
`src/built-in/chat/utilities/chatContextSourceLoader.ts`, and
`src/built-in/chat/utilities/chatTurnSynthesis.ts`.

The important current behavior is:

1. grounded turns automatically enable memory recall and concept recall;
2. explicit `memory-recall` turns enable memory recall without retrieval;
3. conversational turns disable both retrieval and memory recall;
4. memory recall is application-driven context assembly, not a first-class
   user-visible memory tool contract;
5. memory write-back runs as a best-effort post-response background side effect.

### Write-back model today

`src/built-in/chat/utilities/chatMemoryWriteBack.ts` shows the current
write-back contract.

After a turn, Parallx may:

1. extract preferences from the current request text;
2. generate a deterministic fallback session summary and immediately store it;
3. optionally call the model again to produce a richer summary and concept list;
4. overwrite the stored memory summary with the richer version when available;
5. store extracted concepts as database records and vector entries.

This path is intentionally best-effort and swallows failures.

That keeps chat responsive, but it also means memory persistence is neither
auditable nor strongly visible to the user.

### UI/config state today

Parallx exposes memory through the AI settings UI and unified config:

1. memory can be browsed and deleted in the AI Settings Memory section;
2. unified config exposes `memory.memoryEnabled`;
3. the current memory UI shows stored summaries, concepts, and preferences.

However, this is still management of database-backed records, not editing of a
workspace memory corpus.

### Structural problems in the current model

The current system is misaligned with the target product for these reasons:

1. it has no file-backed canonical memory layer;
2. it stores abstractions of conversations instead of preserving transparent,
   user-readable memory documents as the primary artifact;
3. the vector index is not clearly a derived cache because the underlying truth
   also lives in the database;
4. preferences, concepts, and session memory are implementation categories,
   not explicit product layers the user understands;
5. the memory toggle currently gates write-back, but the broader recall model is
   still structurally embedded in the chat runtime rather than expressed as a
   clear layer policy;
6. disaster recovery is weak because there is no markdown corpus to rebuild
   from;
7. version control and human review of memory are effectively absent.

### Bottom-line audit

Parallx memory is currently useful as a retrieval subsystem, but not acceptable
as the final product architecture.

It is database-centric, opaque, and only partially controllable.

---

## Verified OpenClaw Findings

### Source correction

Older Parallx notes referenced `microsoft/OpenClaw`.

That is stale.

The current upstream repository is `openclaw/openclaw`, and current memory
behavior is documented there.

### Canonical memory model

OpenClaw's current memory docs explicitly state:

1. memory is plain markdown in the agent workspace;
2. the files are the source of truth;
3. the model only remembers what gets written to disk.

This is the most important verified result for Milestone 32.

OpenClaw is not treating the vector database as the canonical memory store.

### Default memory layers

OpenClaw's default workspace memory layout uses two primary markdown layers:

1. `memory/YYYY-MM-DD.md`
   - append-only daily log;
   - today and yesterday are read at session start;
2. `MEMORY.md`
   - curated long-term memory;
   - loaded only in the main private session, not in group contexts.

This verifies the core of the layered-memory idea in your notes.

For Parallx, we intentionally choose a different placement for workspace
cleanliness, but we keep the same layered semantics.

### Agent-facing memory tools

OpenClaw exposes explicit memory tools:

1. `memory_search`
   - semantic recall over indexed snippets;
2. `memory_get`
   - targeted read of a specific markdown file or line range.

This is a major product difference from Parallx.

OpenClaw treats memory access as a first-class runtime/tool contract over
workspace files, not just automatic background prompt assembly over database
rows.

### When memory is written

OpenClaw's memory docs state:

1. decisions, preferences, and durable facts go to `MEMORY.md`;
2. day-to-day notes and running context go to `memory/YYYY-MM-DD.md`;
3. if a user says "remember this," the bot should write it down rather than
   keep it in RAM.

That is the right product contract for explicit memory.

### Automatic memory flush before compaction

OpenClaw also includes an automatic memory flush mechanism near compaction.

When the session approaches auto-compaction, it can trigger a silent agentic
turn that reminds the model to store durable memory before context is compacted.

Important product lesson:

1. durable memory write-back is explicit and file-oriented;
2. memory persistence is tied to the canonical markdown corpus;
3. compaction does not mean "trust the model to remember later".

### Vector search is derived, not canonical

OpenClaw documents vector memory search over `MEMORY.md` and `memory/*.md`.

Important verified details:

1. memory search is enabled over markdown memory files;
2. OpenClaw watches those files for changes;
3. sqlite-vec is used when available to accelerate vector search in SQLite;
4. an experimental QMD backend still keeps markdown as the source of truth and
   treats retrieval infrastructure as derived.

This directly matches the architecture Parallx should move toward.

### Session transcripts are a separate, optional indexed layer

Your note about session transcripts being optionally indexed is substantially
correct, but it needs one refinement.

Verified OpenClaw behavior is:

1. session transcripts are stored as `.jsonl` files;
2. transcript text is sanitized into user/assistant lines for memory indexing;
3. transcript indexing is an optional QMD-backed capability rather than the
   default primary memory layer.

So the right conclusion is:

1. daily log + curated durable memory are the default core layers;
2. session transcripts are a distinct optional recall layer.

### Research note direction inside OpenClaw

OpenClaw's own memory research note reinforces the same direction:

1. markdown remains canonical and reviewable;
2. richer recall comes from a derived index;
3. layered memory should distinguish daily logs, durable memory, entity or bank
   pages, and reflective summaries;
4. the index should always be rebuildable from markdown.

---

## Research Conclusions

### What your notes got right

The following parts of your notes are confirmed by current upstream OpenClaw
sources:

1. markdown files in the workspace are the source of truth for memory;
2. semantic/vector search is layered on top of those files;
3. users can directly inspect and edit memory as human-readable text;
4. a layered memory system is the right model;
5. session transcripts can exist as a separate recall layer instead of being the
   same thing as durable memory.

### What needed correction or refinement

The following points needed correction:

1. the current upstream repo is `openclaw/openclaw`, not `microsoft/OpenClaw`;
2. OpenClaw's default core memory layers are daily logs plus `MEMORY.md`, while
   transcript indexing is optional rather than the primary default memory model;
3. current OpenClaw memory is not just "manual memory via AGENTS.md" as older
   Parallx notes suggested.

### Design conclusion for Parallx

Parallx should adopt the OpenClaw memory direction, not the current Parallx
database-centric model.

That means:

1. markdown memory files must become canonical;
2. the index must become derived and rebuildable;
3. explicit product layers must replace implicit database buckets;
4. runtime memory access should be expressed through clear memory-layer
   semantics and tools, not only background prompt injection.

---

## Scope and Non-Goals

### In scope

1. document the current Parallx memory architecture and its problems;
2. verify the current OpenClaw memory model using current upstream sources;
3. define a target markdown-backed layered memory architecture for Parallx;
4. plan the migration away from database-centric canonical memory;
5. define the transitional execution phases for Milestone 32.

### Not in scope

1. building full autonomous reflection and self-curation loops;
2. solving all future memory-bank/entity-page features in this milestone;
3. preserving the current memory service API exactly as-is if it conflicts with
   the target architecture;
4. keeping database-first memory behavior for backward compatibility beyond what
   is necessary for migration.

---

## Target Architecture

### New invariant

Workspace files are the source of truth for memory.

Indexes, embeddings, and retrieval caches are derived artifacts.

### Canonical memory layers for Parallx

Parallx should adopt the following memory layers:

1. `.parallx/memory/MEMORY.md`
   - curated durable memory;
   - stores important decisions, preferences, project conventions, and durable
     facts;
2. `.parallx/memory/YYYY-MM-DD.md`
   - append-oriented daily log;
   - stores day-to-day work context, running notes, and recent events;
3. session transcripts
   - separate from durable memory;
   - optionally indexed for recall;
   - not the same thing as durable memory or daily logs.

### Initial workspace placement

For Milestone 32, Parallx chooses a cleaner workspace layout while preserving an
OpenClaw-like memory model.

The canonical Parallx layout should be:

1. `.parallx/memory/MEMORY.md`;
2. `.parallx/memory/YYYY-MM-DD.md`;
3. transcript storage in a clearly separate path.

The transcript path can be finalized during implementation, but it must remain a
distinct layer and not silently merge into curated memory.

This is a deliberate divergence from OpenClaw's root-level placement. It is not
a problem as long as Parallx makes `.parallx/memory/` a first-class memory
surface in the runtime.

That means the architecture must guarantee all of the following:

1. the AI knows `.parallx/memory/` is canonical memory;
2. memory indexing explicitly includes `.parallx/memory/` even though `.parallx`
   is otherwise treated as internal storage;
3. memory tools resolve reads and searches against `.parallx/memory/` without
   requiring the model to guess hidden paths;
4. users can still inspect and edit the memory files normally when hidden files
   are shown.

### Derived index model

Parallx should maintain a rebuildable derived index over the canonical files:

1. markdown file parsing;
2. lexical indexing;
3. vector indexing;
4. optional transcript indexing.

If the derived store is deleted, the system must be able to rebuild it from the
workspace corpus.

### Runtime memory semantics

Parallx should separate four runtime memory behaviors:

1. always-loaded durable memory policy;
2. recent daily-log context policy;
3. tool-driven semantic memory recall;
4. explicit write-back policy.

This is stronger than the current Parallx model where memory is mostly a
database recall side effect inside chat context assembly.

### AI discoverability requirement

Because Parallx is choosing `.parallx/memory/` instead of OpenClaw's visible
root-level files, discoverability must be engineered explicitly.

The runtime must provide at least three guarantees:

1. system/prompt guidance clearly tells the AI where canonical memory lives;
2. memory tools and loaders target `.parallx/memory/` directly rather than
   depending on generic workspace search behavior;
3. indexing and recall treat `.parallx/memory/` as an allowlisted canonical
   memory source even though most of `.parallx/` remains internal.

### Transitional compatibility principle

The existing `MemoryService` should not remain the architectural owner of
canonical memory.

Instead, Parallx should move toward:

1. a file-backed canonical memory layer;
2. an indexing layer built from those files;
3. adapters that preserve enough compatibility for chat runtime migration;
4. eventual removal or shrinking of DB-first memory tables.

---

## Execution Plan

### Phase A — Canonical file layer

- [x] Define the exact Parallx workspace memory layout.
- [x] Create file-backed memory primitives for `.parallx/memory/MEMORY.md` and
   `.parallx/memory/YYYY-MM-DD.md`.
- [ ] Create a transcript storage/export strategy as a separate layer.
- [x] Add read/write utilities that treat memory files as canonical.
- [x] Define the single canonical path contract so the AI never has to infer
   where memory lives.

### Phase B — Derived indexing

- [x] Build an initial canonical-memory search layer over indexed memory files.
- [x] Support lexical plus vector recall over canonical memory files.
- [x] Ensure the canonical memory index is rebuildable from the workspace corpus.
- [x] Keep provider/index implementation behind a smaller memory search
   contract.
- [x] Explicitly allowlist `.parallx/memory/` while keeping the rest of
   `.parallx/` internal by default.

### Phase C — Runtime migration

- [x] Replace DB-first recall paths with file-backed memory recall.
- [ ] Split runtime policy between durable-memory injection, daily-log loading,
      and tool-driven recall.
- [x] Stop treating session-summary rows as the primary durable memory artifact.
- [x] Move memory access toward explicit tool contracts and stable layer rules.
- [x] Teach prompt/system layers and memory tools that canonical memory lives in
   `.parallx/memory/`.

### Phase D — Write-back remodel

- [x] Replace summary-first database persistence with file-backed write-back.
- [ ] Define exactly when to write to `MEMORY.md` versus daily logs.
- [x] Define the initial write split: durable preferences in `MEMORY.md`, session summaries in daily logs.
- [ ] Keep transcript storage distinct from curated memory.
- [x] Make memory writes inspectable and user-recoverable.

### Phase E — Legacy migration and removal

- [x] Add a one-time importer from legacy DB memories, concepts, and
   preferences into canonical markdown memory files.
- [x] Treat legacy DB memory as migration input, not ongoing source of truth.
- [x] Remove or sharply reduce DB-first canonical memory logic.
- [x] Validate rebuild, recovery, and user edit workflows.

---

## Task Tracker

- [x] Audit current Parallx memory architecture against live code
- [x] Research current upstream OpenClaw memory docs and source
- [x] Correct stale `microsoft/OpenClaw` assumption with current upstream repo
- [x] Write Milestone 32 document
- [x] Define canonical Parallx memory file layout
- [x] Implement file-backed memory primitives
- [x] Implement initial `.parallx/memory/` indexing allowlist
- [x] Implement initial explicit memory tools (`memory_get`, `memory_search`)
- [x] Teach the base system prompt where canonical memory lives
- [x] Add focused unit tests for canonical memory tools and path primitives
- [x] Add a Playwright AI-eval spec for canonical memory layer access
- [x] Migrate runtime recall to prefer canonical markdown memory before legacy DB fallback
- [x] Migrate initial write-back so session summaries and learned preferences land in canonical markdown memory
- [x] Migrate prompt preference loading to canonical durable markdown first
- [x] Add a dedicated canonical memory search service over indexed `.parallx/memory` files
- [x] Implement derived memory indexing over canonical files
- [x] Migrate runtime memory recall to canonical-file architecture
- [x] Remodel initial memory write-back around explicit memory layers
- [x] Import legacy DB memory into canonical markdown files
- [x] Validate rebuildability, transparency, and editability end to end

---

## Implementation Log

### 2026-03-12 — Phase A slice completed

Completed implementation work in this session:

1. added a dedicated `WorkspaceMemoryService` for canonical `.parallx/memory/`
   paths and file-backed primitives;
2. registered `IWorkspaceMemoryService` in the workbench facade once workspace
   and file services are available;
3. auto-seeded the `.parallx/memory/` scaffold plus `MEMORY.md` on service
   registration as a best-effort startup action;
4. added base system-prompt guidance telling the AI that canonical memory lives
   in `.parallx/memory/`;
5. updated indexing traversal so `.parallx/memory/` is allowlisted while the
   rest of `.parallx/` stays effectively internal by default;
6. added focused unit coverage for canonical path resolution, scaffold creation,
   and daily-log append behavior.
7. added explicit built-in memory tools: `memory_get` and `memory_search`.
8. updated the base chat system prompt to tell the AI to prefer those memory
   tools for canonical workspace memory.
9. added focused unit coverage for memory tool registration and behavior.
10. added a real-model Playwright AI-eval spec for durable vs daily memory-layer
    access using the existing Electron + Ollama harness.
11. migrated `ChatDataService.recallMemories()` to prefer canonical markdown
   memory, then direct canonical layer reads, and only then legacy DB fallback.
12. fixed hidden `.parallx/...` path normalization so direct canonical memory
   reads and writes do not strip the leading dot segment.
13. migrated `storeSessionMemory()` so session summaries are written into the
   canonical daily memory log, with idempotent per-session updates.
14. migrated extracted preference write-back so durable preferences sync into a
   dedicated `## Preferences` section in `MEMORY.md`.
15. migrated prompt preference loading so `getPreferencesForPrompt()` reads the
   canonical durable markdown preferences block first and only uses DB rows as
   fallback.
16. migrated the chat memory opener to resolve and open the canonical daily
   markdown file containing a session summary, falling back to the old
   synthetic DB-backed viewer only when no canonical file exists yet.
17. added `CanonicalMemorySearchService` so canonical memory search is a
   dedicated service seam instead of repeated generic `file_chunk` filtering in
   tools and chat runtime code.
18. migrated the runtime recall path and `memory_search` tool to use that
   dedicated canonical memory search contract.
19. added focused indexing-pipeline proof tests showing that `.parallx/memory`
   files are indexed through the normal file pipeline and can rebuild their
   derived vector index from canonical markdown files alone.
20. added a one-time legacy importer that moves DB memories into daily markdown
   logs, DB preferences into the durable preferences section, and DB concepts
   into a durable concepts section, guarded by a legacy-import marker.
21. moved session-summary existence/count guards onto canonical daily markdown
   metadata and stopped dual-writing session summaries back into the legacy DB
   during normal workspace runtime.
22. moved preference extraction in workspace mode onto canonical durable
   markdown upserts, reusing the existing detection logic without DB writes.
23. moved concept storage and recall in workspace mode onto canonical durable
   markdown, preserving the existing concept-context block shape while
   removing DB concept dependence from normal runtime.
24. added an end-to-end live validation proving that direct user edits to
   canonical durable and daily memory files are picked up by file-based reindex
   and reflected in subsequent recall.

Files changed for this slice:

1. `src/services/workspaceMemoryService.ts`
2. `src/services/serviceTypes.ts`
3. `src/workbench/workbenchFacadeFactory.ts`
4. `src/built-in/chat/config/chatSystemPrompts.ts`
5. `src/services/indexingPipeline.ts`
6. `tests/unit/workspaceMemoryService.test.ts`
7. `src/built-in/chat/tools/memoryTools.ts`
8. `src/built-in/chat/tools/builtInTools.ts`
9. `tests/unit/builtInTools.test.ts`
10. `tests/ai-eval/memory-layers.spec.ts`
11. `tests/unit/chatDataServiceMemoryRecall.test.ts`
12. `tests/ai-eval/memory-layers.spec.ts`
13. `tests/unit/chatTurnMessageAssembly.test.ts`
14. `tests/unit/chatViewerOpeners.test.ts`
15. `src/services/canonicalMemorySearchService.ts`
16. `tests/unit/canonicalMemorySearchService.test.ts`
17. `tests/unit/indexingPipeline.test.ts`
18. `src/workbench/workbenchFacadeFactory.ts`
19. `tests/unit/chatDataServiceMemoryRecall.test.ts`
20. `tests/unit/memoryService.test.ts`
21. `tests/unit/workspaceMemoryService.test.ts`
22. `tests/ai-eval/memory-layers.spec.ts`

Focused validation completed:

1. `npm run test:unit -- workspaceMemoryService.test.ts` ✅
2. `npm run test:unit -- builtInTools.test.ts workspaceMemoryService.test.ts` ✅
3. `npx playwright test --config=playwright.ai-eval.config.ts tests/ai-eval/memory-layers.spec.ts` ✅
4. `npm run build:renderer` ✅
5. `npx playwright test --config=playwright.ai-eval.config.ts tests/ai-eval/memory-layers.spec.ts` ✅ (5 tests)
6. `npm run test:unit -- workspaceMemoryService.test.ts chatDataServiceMemoryRecall.test.ts builtInTools.test.ts chatContextIntegration.test.ts chatTurnMessageAssembly.test.ts` ✅
7. `npm run test:unit -- workspaceMemoryService.test.ts chatViewerOpeners.test.ts chatDataServiceMemoryRecall.test.ts chatTurnMessageAssembly.test.ts` ✅
8. `npm run test:unit -- canonicalMemorySearchService.test.ts builtInTools.test.ts chatDataServiceMemoryRecall.test.ts workspaceMemoryService.test.ts chatViewerOpeners.test.ts chatTurnMessageAssembly.test.ts` ✅
9. `npm run build:renderer` ✅
10. `npx playwright test --config=playwright.ai-eval.config.ts tests/ai-eval/memory-layers.spec.ts` ✅ (post canonical search refactor)
11. `npm run test:unit -- indexingPipeline.test.ts canonicalMemorySearchService.test.ts builtInTools.test.ts chatDataServiceMemoryRecall.test.ts workspaceMemoryService.test.ts` ✅
12. `npm run test:unit -- workspaceMemoryService.test.ts canonicalMemorySearchService.test.ts chatDataServiceMemoryRecall.test.ts indexingPipeline.test.ts` ✅
13. `npm run build:renderer` ✅
14. `npx playwright test --config=playwright.ai-eval.config.ts tests/ai-eval/memory-layers.spec.ts` ✅ (post legacy importer wiring)
15. `npm run test:unit -- workspaceMemoryService.test.ts chatDataServiceMemoryRecall.test.ts canonicalMemorySearchService.test.ts indexingPipeline.test.ts` ✅
16. `npm run build:renderer` ✅
17. `npx playwright test --config=playwright.ai-eval.config.ts tests/ai-eval/memory-layers.spec.ts` ✅ (post fallback reduction)
18. `npm run test:unit -- workspaceMemoryService.test.ts chatDataServiceMemoryRecall.test.ts memoryService.test.ts canonicalMemorySearchService.test.ts indexingPipeline.test.ts` ✅
19. `npm run build:renderer` ✅
20. `npx playwright test --config=playwright.ai-eval.config.ts tests/ai-eval/memory-layers.spec.ts` ✅ (post markdown-only preference extraction)
21. `npm run test:unit -- workspaceMemoryService.test.ts chatDataServiceMemoryRecall.test.ts memoryService.test.ts canonicalMemorySearchService.test.ts indexingPipeline.test.ts` ✅ (post canonical concept runtime)
22. `npm run build:renderer` ✅
23. `npx playwright test --config=playwright.ai-eval.config.ts tests/ai-eval/memory-layers.spec.ts` ✅ (post canonical concept runtime)
24. `npm run test:unit -- workspaceMemoryService.test.ts chatDataServiceMemoryRecall.test.ts canonicalMemorySearchService.test.ts indexingPipeline.test.ts` ✅ (closeout validation)
25. `npx playwright test --config=playwright.ai-eval.config.ts tests/ai-eval/memory-layers.spec.ts` ✅ (direct-edit rebuild/editability proof; 6 tests)

AI-eval result summary:

1. durable memory recall passed;
2. daily memory recall passed;
3. durable-vs-daily layer distinction passed.
4. explicit memory-recall route passed after canonical recall migration.
5. canonical markdown write-back for daily summaries and durable preferences passed.
6. canonical markdown-first preference injection change passed without regressing the live memory-layer suite.
7. canonical memory references can now open the real markdown file path instead of only a synthetic viewer.
8. canonical memory search now goes through a dedicated service seam and passed the existing live memory-layer suite unchanged.
9. canonical memory indexing is now explicitly covered as rebuildable from canonical markdown files in the unit suite.
10. a one-time legacy DB importer now exists and passed both focused unit validation and the live memory-layer regression suite.
11. session-summary runtime now uses canonical markdown metadata instead of legacy DB counters in normal workspace mode.
12. preference extraction now writes to canonical durable markdown directly in workspace mode instead of using DB preference rows.
13. concept storage and recall now run from canonical durable markdown in workspace mode instead of DB concept rows.
14. direct user edits to canonical memory files now have live end-to-end validation through file-based reindex and recall.

Important limitation of this slice:

1. transcript/export separation is still unresolved and should remain distinct
   from curated memory.

---

## Verification Checklist

- [x] Current Parallx memory storage and runtime behavior documented from live
      code
- [x] Current OpenClaw memory model verified from current upstream docs/source
- [x] Milestone 32 document captures both systems and the transition direction
- [x] Canonical `.parallx/memory/` path contract exists in code
- [x] Focused unit coverage exists for file-backed memory primitives
- [x] Focused unit coverage exists for explicit canonical memory tools
- [x] Playwright AI-eval coverage exists for canonical memory-layer access
- [x] Runtime recall prefers canonical markdown memory before legacy DB fallback
- [x] Session summaries are written to canonical daily memory markdown
- [x] Learned preferences are synced into canonical durable memory markdown
- [x] Prompt preference injection reads canonical durable markdown first
- [x] Canonical memory files can be edited directly in the workspace
- [x] Canonical memory search is behind a dedicated service contract
- [x] Derived index can be rebuilt from canonical files only
- [x] Memory recall works without DB-first canonical storage
- [x] A one-time legacy DB import path exists for memories, preferences, and concepts
- [x] Session summary lifecycle no longer depends on DB memory rows in normal workspace runtime
- [x] Preference extraction no longer depends on DB preference rows in normal workspace runtime
- [x] Concept storage and recall no longer depend on DB concept rows in normal workspace runtime
- [x] Direct user edits to canonical memory files are reflected through the live recall path
- [ ] Transcript indexing remains optional and separate from durable memory
- [ ] `tsc --noEmit` passes after implementation
- [ ] focused tests pass after each phase
- [ ] full build and full test suite pass after milestone completion

---

## Risks and Open Questions

1. We need to decide whether Parallx should mirror OpenClaw's root-level naming
   exactly, or intentionally diverge by using `.parallx/memory/` for canonical
   memory in exchange for a cleaner root.
2. Parallx currently skips `.parallx/` during workspace indexing and only
   special-cases `.parallx/rules/` for prompt layering, so `.parallx/memory/`
   will need explicit first-class support.
3. We need a clean migration path from legacy concepts/preferences rows into
   markdown without creating a messy one-time dump that users cannot understand.
4. We need to define when memory should be auto-loaded versus retrieved by tool,
   so the new layered system improves transparency without losing useful recall.
5. We need to decide whether concepts remain a first-class explicit layer in
   markdown or become a later reflective/derived layer rather than a primary
   milestone requirement.
6. We should avoid preserving too much of the current DB-first API shape if that
   slows the architectural cutover.

---

## References

### Parallx sources audited

1. `src/services/memoryService.ts`
2. `src/built-in/chat/data/chatDataService.ts`
3. `src/built-in/chat/utilities/chatMemoryWriteBack.ts`
4. `src/built-in/chat/utilities/chatContextPlanner.ts`
5. `src/built-in/chat/utilities/chatContextSourceLoader.ts`
6. `src/built-in/chat/utilities/chatTurnExecutionConfig.ts`
7. `src/services/serviceTypes.ts`

### Verified upstream OpenClaw sources

1. https://github.com/openclaw/openclaw
2. https://raw.githubusercontent.com/openclaw/openclaw/main/docs/concepts/memory.md
3. https://raw.githubusercontent.com/openclaw/openclaw/main/docs/concepts/agent-workspace.md
4. https://raw.githubusercontent.com/openclaw/openclaw/main/docs/cli/memory.md
5. https://raw.githubusercontent.com/openclaw/openclaw/main/docs/experiments/research/memory.md
6. https://raw.githubusercontent.com/openclaw/openclaw/main/src/memory/session-files.ts
7. https://raw.githubusercontent.com/openclaw/openclaw/main/src/memory/search-manager.ts
8. https://raw.githubusercontent.com/openclaw/openclaw/main/src/memory/manager.ts