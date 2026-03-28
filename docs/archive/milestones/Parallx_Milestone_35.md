# Milestone 35 — Canonical Memory Normalization And AI Settings Cleanup

> Authoritative scope notice
>
> This document is the single source of truth for Milestone 35.
> All work that completes the transition to canonical markdown-backed memory,
> verifies legacy-workspace migration behavior, and removes stale memory content
> management from AI Settings must conform to the contract and execution plan
> defined here.

---

## Table of Contents

1. Problem Statement
2. What Is Already Proven
3. Remaining Product Gap
4. Product Goal
5. Target Contract
6. Execution Plan
7. Verification Checklist
8. Risks And Open Questions

---

## Problem Statement

Milestone 32 established canonical markdown memory under `.parallx/memory/`.
Milestone 33 aligned invocation and transcript separation more closely with
 OpenClaw.

However, Parallx still has a product-level split-brain problem.

Today:

1. canonical workspace memory exists in markdown files;
2. legacy DB-backed memory is imported forward into those markdown files;
3. runtime uses canonical memory in important paths;
4. but some user-facing surfaces, especially AI Settings, still expose the old
   DB-era memory model as if it were the primary truth.

This creates four user-facing failures:

1. users cannot tell whether memory really lives in workspace files or in the
   database;
2. old workspaces may be migrated in principle, but there is no strong product
   verification path proving the migration is complete for that workspace;
3. AI Settings mixes global AI configuration with workspace-specific memory
   content, which is architecturally wrong;
4. memory CRUD in AI Settings risks mutating stale implementation-era records
   instead of the canonical markdown corpus.

Milestone 35 resolves the normalization gap.

---

## What Is Already Proven

The current codebase already proves the following:

1. legacy conversation memories are loaded from `conversation_memories` via
   `MemoryService.getAllMemories()`;
2. workbench startup reads legacy memories, preferences, and concepts and feeds
   them into `WorkspaceMemoryService.importLegacySnapshot(...)`;
3. canonical import writes session summaries into daily markdown files and
   writes preferences and concepts into durable memory;
4. import is guarded by a `## Legacy Import` marker so it does not run twice;
5. these behaviors are covered by focused unit tests in
   `tests/unit/workspaceMemoryService.test.ts`.

This means Parallx does have a real bridge for old workspaces.

What is not yet proven for a given real workspace is whether its migration is
complete and whether any user-facing surface still depends on stale DB-era
records.

---

## Remaining Product Gap

The main remaining issues are:

1. AI Settings still includes a Memory section backed by `IMemoryService`
   database-era APIs rather than canonical markdown memory;
2. there is no dedicated migration verification path that can state whether a
   workspace's legacy DB memory has been normalized into canonical markdown;
3. some fallback/runtime code still tolerates DB-first memory behavior,
   weakening the clarity of the product contract;
4. there is no single user-facing story explaining that memory content belongs
   in workspace files, not in AI Settings.

---

## Product Goal

After Milestone 35:

1. markdown files under `.parallx/memory/` are the only canonical user-facing
   memory surface;
2. old workspaces receive the same benefit as new workspaces through a verified
   legacy-to-markdown migration path;
3. AI Settings contains settings only, not workspace memory content;
4. remaining DB-memory behavior is either migration-only, fallback-only, or
   explicitly marked for later retirement.

---

## Target Contract

### 1. Canonical memory contract

1. `.parallx/memory/MEMORY.md` is the durable memory source of truth;
2. `.parallx/memory/YYYY-MM-DD.md` files are the daily memory source of truth;
3. transcript files remain a separate layer from memory;
4. semantic search and retrieval are derived from canonical files, not the
   primary store.

### 2. Legacy-workspace contract

1. old DB-backed memories, preferences, and concepts are imported into canonical
   markdown exactly once;
2. the system can determine whether a workspace has already been normalized;
3. migration success is testable and diagnosable, not implicit.

### 3. AI Settings contract

1. AI Settings must not show or mutate workspace memory content;
2. global and preset-driven AI configuration remains in AI Settings;
3. workspace memory content is managed through files, not through the settings
   panel.

### 4. Transitional compatibility contract

1. DB memory tables may continue to exist temporarily for migration and
   fallback;
2. no user-facing product surface should present them as canonical;
3. follow-up work may retire remaining DB-era dependencies after migration
   normalization is complete.

---

## Execution Plan

### Phase A — Migration proof and verification

- [ ] Audit all legacy DB memory sources that are intended to migrate into
      canonical markdown.
- [x] Add or strengthen a migration verification path that can detect whether a
      workspace has successfully normalized legacy memory into markdown.
- [x] Add focused tests covering startup import behavior, idempotence, and
      representative legacy-workspace scenarios.

### Phase B — AI Settings cleanup

- [x] Remove the Memory section from the AI Settings panel.
- [x] Remove Memory-section wiring from the AI Settings built-in activation
      path.
- [ ] Ensure AI Settings navigation, layout, and search still behave correctly
      after section removal.
- [ ] Update any UI copy or docs that still imply memory content is managed
      through AI Settings.

### Phase C — Runtime normalization

- [x] Audit remaining user-facing consumers of `IMemoryService.getAllMemories()`,
      `getPreferences()`, and `getAllConcepts()`.
- [x] Reclassify each remaining DB-memory dependency as one of:
      migration-only, fallback-only, or must-be-reworked.
- [x] Prefer canonical markdown-backed reads in user-facing memory flows.

### Phase D — Product clarity

- [x] Add or update product documentation so it is explicit that workspace
      memory lives in markdown files.
- [x] Define whether any replacement affordance is needed for opening memory
      files or folders, without reintroducing memory CRUD inside AI Settings.

---

## Verification Checklist

- [ ] Legacy DB memories import into daily markdown files.
- [ ] Legacy preferences import into durable memory markdown.
- [ ] Legacy concepts import into durable memory markdown.
- [ ] Import does not duplicate when the marker already exists.
- [ ] AI Settings no longer contains a Memory section.
- [ ] No AI Settings code path depends on `IMemorySectionServices`.
- [ ] User-facing canonical memory behavior still works for existing workspaces.

---

## Risks And Open Questions

1. Some runtime fallback paths may still depend on old DB records longer than
   expected.
2. We must decide whether to expose a lightweight “open memory files” affordance
   elsewhere after removing the AI Settings Memory section.
3. We should verify whether any real workspaces have partial migration states
   that the current tests do not model.

---

## Implementation Log

### 2026-03-13 — Legacy-workspace normalization hardening

Completed in this slice:

1. changed canonical legacy import from a hard one-shot marker gate to an
   additive reconciliation path that can backfill missing markdown memory
   entries for older workspaces without duplicating existing canonical content;
2. updated workbench startup wiring so Parallx always feeds the real legacy DB
   snapshot through the canonical-memory normalization path instead of using an
   empty preflight gate;
3. added focused regression coverage proving both idempotence for identical
   snapshots and backfill behavior when a workspace has a legacy-import marker
   but is still missing canonical markdown entries.

Focused validation completed:

1. `npm run test:unit -- workspaceMemoryService.test.ts chatDataServiceMemoryRecall.test.ts` ✅

### 2026-03-13 — AI Settings memory-surface removal

Completed in this slice:

1. removed the Memory section from the AI Settings panel so workspace memory
   content is no longer presented as a configurable AI-settings surface;
2. removed the AI Settings activation wiring that adapted `IMemoryService`
   database-era APIs into the panel;
3. deleted the stale `MemorySection` implementation so AI Settings no longer
   implies memory CRUD belongs in the settings UI.

Focused validation completed:

1. `npm run test:unit -- workspaceMemoryService.test.ts chatDataServiceMemoryRecall.test.ts unifiedAIConfigService.test.ts` ✅

### 2026-03-13 — Runtime normalization audit and memory-viewer cleanup

Completed in this slice:

1. audited the remaining consumers of `IMemoryService.getAllMemories()`,
   `getPreferences()`, and `getAllConcepts()` and classified them as:
   migration-only in workbench startup, fallback-only in chat memory recall,
   and a user-facing rework target in the chat memory viewer opener;
2. updated the chat memory viewer opener so, when workspace memory is available,
   missing canonical session summaries are backfilled into markdown and opened
   from `.parallx/memory/` instead of showing a DB-era readonly memory view;
3. kept the readonly legacy viewer only as a compatibility fallback for older
   environments that do not have workspace memory services available.

Focused validation completed:

1. `npm run test:unit -- chatViewerOpeners.test.ts workspaceMemoryService.test.ts chatDataServiceMemoryRecall.test.ts` ✅

### 2026-03-13 — Canonical memory access commands

Completed in this slice:

1. added lightweight workbench commands to open canonical durable memory and
   today’s daily memory log directly in the editor;
2. added a small workspace-memory helper to ensure the daily log file exists
   before opening it, so users can land in a real markdown file even on a fresh
   day;
3. intentionally kept this as a command-based affordance instead of restoring a
   dedicated memory-management UI inside AI Settings.

### 2026-03-13 — Product documentation alignment

Completed in this slice:

1. updated the AI user guide to state explicitly that AI Settings no longer owns
   workspace memory content;
2. documented `.parallx/memory/MEMORY.md` and `.parallx/memory/YYYY-MM-DD.md`
   as the canonical user-facing memory files;
3. documented the new command-based access path for opening durable memory and
   today’s daily memory log directly from the command palette.