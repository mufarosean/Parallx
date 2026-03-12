# Milestone 30 — Chat Context Provenance Refactor

> **Authoritative Scope Notice**
>
> This document is the single source of truth for Milestone 30.
> All work that restructures chat context layering, provenance ownership,
> thinking/source visibility, and pre-send context transparency must conform to
> the architecture, constraints, and task boundaries defined here.

---

## Table of Contents

1. [Problem Statement](#problem-statement)
2. [Current State Audit](#current-state-audit)
3. [Research Findings](#research-findings)
4. [Scope and Non-Goals](#scope-and-non-goals)
5. [Design](#design)
6. [Execution Plan](#execution-plan)
7. [Task Tracker](#task-tracker)
8. [Verification Checklist](#verification-checklist)
9. [Future Direction](#future-direction)

---

## Problem Statement

Parallx chat currently assembles context correctly more often than it explains
that context correctly.

The regression cluster fixed after Milestone 29 exposed the structural issue:

1. direct page and direct file context could reach the model even while
   indexing surfaces showed zero;
2. pills and thinking sources were built through different logic paths;
3. the thinking container had become the runtime owner of visible sources via
   side effects rather than a first-class provenance model;
4. small UI changes could remove trust surfaces without breaking the prompt,
   creating behavior that felt deceptive even when answers were grounded.

This milestone refactors chat context provenance into an explicit data model so
the code clearly answers four questions for every turn:

1. what context entered the prompt,
2. what provenance should be visible,
3. what can be excluded for the next turn,
4. which surfaces depend on which layer.

---

## Current State Audit

The current chat turn has several distinct layers:

1. **planning**
   - `src/built-in/chat/utilities/chatContextPlanner.ts`
   - decides whether current-page, retrieval, memory, and concept lanes are active.

2. **loading**
   - `src/built-in/chat/utilities/chatContextSourceLoader.ts`
   - loads page content, retrieval results, memory, concepts, and attachments.

3. **assembly**
   - `src/built-in/chat/utilities/chatContextAssembly.ts`
   - turns loaded sources into prompt blocks and UI-facing metadata.

4. **streaming / transcript state**
   - `src/services/chatService.ts`
   - folds progress and references into the thinking part.

5. **visibility surfaces**
   - `src/built-in/chat/input/chatContextPills.ts`
   - `src/built-in/chat/rendering/chatContentParts.ts`
   - `src/built-in/chat/widgets/chatTokenStatusBar.ts`

Before this refactor, provenance was not owned by a single first-class
structure. The same source could be represented as:

1. raw prompt text,
2. a reference callback into the response stream,
3. a separately synthesized pill,
4. an implicit exclusion rule based on string matching.

That duplication made the architecture hard to reason about and easy to break.

---

## Research Findings

### Internal research already completed in this repo

Existing Parallx research documents already identified the core problem from
different angles:

1. `docs/ai/CITATION_ATTRIBUTION_REDESIGN.md`
   - identified the disconnect between what the model uses and what the user is shown;
   - established that provenance and user trust are architecture problems, not
     just retrieval-score problems.

2. `docs/ai/CONVERSATIONAL_ROUTING_FIX_PLAN.md`
   - documented that multiple automatic context layers are active before the
     user sees any explanation of them.

3. `memories/repo/chat-rendering-notes.md`
   - captured the concrete regression lesson that deleting or collapsing the
     thinking container changes visible provenance behavior directly.

### Design conclusion from that research

Parallx needs a provenance model that is:

1. explicit,
2. stable across surfaces,
3. derived once per turn,
4. reused by pills and transcript rendering,
5. independent from future storage changes like markdown-backed memory.

---

## Scope and Non-Goals

### In scope

1. introduce a first-class provenance record for chat context;
2. refactor context assembly so provenance is produced once;
3. derive pills from that provenance rather than rebuilding them ad hoc;
4. render thinking/source UI from provenance rather than a separate raw
   reference shape;
5. move memory and concept recall into the same provenance contract;
6. make exclusions source-id based instead of string-matching prompt text;
7. add regression coverage for provenance generation and transcript storage.

### Not in scope

1. changing memory storage to markdown files;
2. redesigning indexing surfaces;
3. changing retrieval scoring or ranking;
4. replacing the chat planner with a larger routing rewrite.

---

## Design

### New invariant

Every turn-visible source should originate from a single provenance entry.

That entry can then drive:

1. transcript-visible source bubbles in the thinking panel,
2. pre-send context pills for the next turn,
3. exclusion identity and deduplication,
4. future provenance-oriented tooling.

### Provenance model

Add `IChatProvenanceEntry` in `src/services/chatTypes.ts` with:

1. stable identity,
2. label,
3. origin kind,
4. optional URI,
5. optional retrieval citation index,
6. estimated token contribution,
7. removability.

### Refactor boundary

`assembleChatContext(...)` becomes the primary constructor for per-turn
provenance. It returns:

1. prompt context parts,
2. retrieval sources,
3. evidence assessment,
4. provenance entries,
5. pills derived from provenance.

`chatService.ts` and `chatContentParts.ts` then consume that provenance instead
of carrying a second custom source shape.

Context exclusions should operate on provenance/source identity, not on whether
the rendered prompt text happens to contain a label string. This prevents
memory, concept, and future non-file context lanes from becoming special-case
exceptions.

---

## Execution Plan

### Phase A — Types and ownership

- [x] Add first-class provenance type.
- [x] Update thinking content to store provenance rather than raw references.
- [x] Extend the response stream with provenance support.

### Phase B — Assembly and derivation

- [x] Refactor `chatContextAssembly.ts` to return provenance entries.
- [x] Derive pills from provenance.
- [x] Bring memory and concept recall into provenance and pills.
- [x] Refactor exclusions to filter source-owned context blocks by source ID.
- [x] Preserve current UX semantics where page provenance is visible in the
      transcript but not duplicated into pills.

### Phase C — Rendering and transcript state

- [x] Update `chatService.ts` to persist provenance on the thinking part.
- [x] Update `chatContentParts.ts` to render thinking sources from provenance.
- [x] Extract turn-context preparation and provenance emission out of `defaultParticipant.ts` into a dedicated utility.
- [x] Extract final user-content composition out of `defaultParticipant.ts` into a dedicated utility.
- [x] Extract post-context execution, fallback handling, and response finalization out of `defaultParticipant.ts` into a dedicated utility.
- [x] Extract deterministic answer selection/emission out of `defaultParticipant.ts` into a dedicated utility.

### Phase D — Verification

- [x] Update unit tests for context assembly.
- [x] Update unit tests for transcript provenance storage.
- [x] Run focused tests and build.
- [x] Run full suite if focused verification is clean.

---

## Task Tracker

- [x] Research existing provenance and attribution docs
- [x] Write milestone document
- [x] Introduce first-class provenance type
- [x] Refactor context assembly to return provenance
- [x] Refactor thinking/source rendering to consume provenance
- [x] Extract participant turn-context preparation into its own utility seam
- [x] Extract participant user-content composition into its own utility seam
- [x] Extract participant synthesis/execution flow into its own utility seam
- [x] Extract participant deterministic response handling into its own utility seam
- [x] Update regression tests
- [x] Complete validation runs

---

## Verification Checklist

- [x] `tests/unit/chatContextAssembly.test.ts` passes
- [x] `tests/unit/chatService.test.ts` passes
- [x] `tsc --noEmit` passes
- [x] `npm run build` passes
- [x] full Vitest suite passes

Verification completed on 2026-03-12 with:

1. focused chat tests passing,
2. `npm run build` passing,
3. full Vitest suite passing (`118` files, `2216` tests),
4. memory and concept recall participating in the same provenance and exclusion contract,
5. participant turn-context preparation extracted into a dedicated tested utility seam,
6. final user-content composition extracted into a dedicated tested utility seam,
7. post-context execution, fallback handling, and response finalization extracted into a dedicated tested utility seam,
8. deterministic answer selection and emission extracted into a dedicated tested utility seam.

---

## Future Direction

This milestone intentionally stops at provenance refactoring.

The likely future direction is markdown-backed editable memory similar to the
OpenClaw-style model the user described. That future work should plug into this
refactored architecture by contributing provenance entries rather than by
introducing another special-case visibility path.

That separation is deliberate:

1. this milestone clarifies source ownership and dependency flow now;
2. the later memory-storage migration can change persistence without needing to
   rediscover how provenance should surface in chat.