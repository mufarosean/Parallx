# Parallx Claw Target Architecture

**Status:** Planning complete  
**Date:** 2026-03-24  
**Purpose:** Define the Parallx-native claw runtime architecture that replaces
the current monolithic orchestration path.

---

## 1. Executive Summary

The target architecture is a **Parallx-native in-process claw runtime**.

It keeps the current user-facing chat shell and keeps the proven Parallx AI
substrate, but it replaces the current chat orchestration path with explicit
runtime services and explicit runtime contracts.

The architecture exists to ensure that Parallx does not replace one confusing
runtime path with another renamed monolith.

High-level result:

- the chat UI stays stable,
- the substrate stays stable,
- the orchestration layer changes,
- prompt authority becomes singular,
- skill loading becomes file-first,
- runtime execution becomes explicit and testable.

---

## 2. Architectural Goals

The redesign must produce the following properties:

1. **One prompt authority**
   No competing prompt-construction paths should remain active in the final
   design.
2. **One skill contract**
   Bundled and workspace skills must follow the same visible contract.
3. **One execution contract**
   Tool use, approvals, aborts, retries, checkpoints, and finalization must run
   through one explicit runtime flow.
4. **One runtime ownership boundary**
   UI, retrieval, persistence, and tools are collaborators of the runtime, not
   alternate places where runtime logic can accumulate.
5. **Preserved substrate**
   Retrieval, indexing, vector storage, model transport, memory storage, and
   session persistence remain foundational services.
6. **Stable user-facing shell**
   The chat UI remains the workbench surface while runtime internals change.

---

## 3. Architectural Non-Negotiables

1. `defaultParticipant.ts` must stop being the runtime owner.
2. `chatDataService.ts` must stop mixing orchestration and adapter concerns.
3. Prompt assembly must be centralized under one contract.
4. Retrieval and memory remain consumed services rather than inline business
   logic inside one participant.
5. Approval and trace emission must be runtime features, not UI-only side
   effects.
6. Temporary migration bridges are allowed only if named and tracked for
   removal.

---

## 4. Legacy-To-Target Mapping

| Legacy area | Current role | Target role |
|-------------|--------------|-------------|
| `src/built-in/chat/participants/defaultParticipant.ts` | Main orchestration owner | Temporary bridge that packages requests for the new runtime |
| `src/built-in/chat/data/chatDataService.ts` | Mixed adapter/orchestration bundle | Narrow adapters consumed by runtime services |
| `src/built-in/chat/utilities/chatTurnRouter.ts` | Front-door workflow authority | Bounded request interpretation and route/participant detection |
| `src/built-in/chat/utilities/chatTurnPrelude.ts` | Mixed early flow preparation | Narrow preprocessing or retirement |
| `src/built-in/chat/utilities/chatSystemPromptComposer.ts` | One of multiple prompt seams | Replaced by canonical prompt assembly service |

The target architecture is not an incremental cleanup of these files. It is a
reassignment of ownership away from them.

---

## 5. Preserved Foundation Services

The new runtime consumes, rather than replaces, these Parallx foundations:

- `src/services/languageModelsService.ts`
- `src/services/retrievalService.ts`
- `src/services/indexingPipeline.ts`
- `src/services/vectorStoreService.ts`
- `src/services/chatService.ts`
- `src/services/chatSessionPersistence.ts`
- existing memory services and approval/trace foundations where still valid

These services stay responsible for substrate behavior. The runtime adds a
clearer orchestration layer above them.

---

## 6. Runtime Component Model

### 6.1 Request parser

Responsibility:
- normalize structured syntax and explicit directives.

Must not own:
- whole-turn execution policy,
- tool orchestration,
- memory write-back.

### 6.2 Route and participant detector

Responsibility:
- make bounded routing decisions about who should handle the turn and under what
  broad runtime mode.

Must not own:
- deep execution planning,
- prompt assembly,
- tool execution.

### 6.3 Skill registry

Responsibility:
- discover, validate, enable, and expose bundled and workspace skills under one
  contract.

Must not own:
- execution control flow,
- persistence.

### 6.4 Prompt assembly service

Responsibility:
- build the final prompt from one canonical layer order.

Must not own:
- participant routing,
- tool execution,
- UI rendering.

### 6.5 Runtime session manager

Responsibility:
- issue session/run identities,
- track state transitions,
- define checkpoint boundaries,
- manage timeout and abort state.

### 6.6 Execution engine

Responsibility:
- coordinate a turn from prepared request through synthesis and finalization.

Must not own:
- raw substrate access outside declared adapters,
- direct UI logic.

### 6.7 Tool executor

Responsibility:
- validate, approve, invoke, and feed back tool results.

### 6.8 Approval and policy service

Responsibility:
- evaluate approval rules,
- create approval objects,
- emit approval audit events,
- feed approval outcome back into execution.

### 6.9 Retrieval and context bridge

Responsibility:
- translate runtime context requests into calls to preserved retrieval and
  indexing services.

### 6.10 Memory write-back service

Responsibility:
- write memory side effects only at approved runtime boundaries.

### 6.11 Transcript and trace service

Responsibility:
- emit structured runtime events,
- record provenance,
- preserve explainability.

### 6.12 Chat UI bridge

Responsibility:
- adapt runtime output to the existing chat UI model.

Must not become:
- alternate orchestration logic.

---

## 7. End-To-End Turn Lifecycle

The target runtime processes a turn in this order:

1. User submits a turn through the existing chat UI.
2. The request parser normalizes explicit structure.
3. The route and participant detector makes a bounded decision.
4. The runtime session manager creates or binds session and run identity.
5. The retrieval/context bridge gathers required contextual inputs through
   preserved services.
6. The prompt assembly service builds one canonical prompt.
7. The execution engine starts the turn under one runtime contract.
8. The tool executor validates and runs tool calls when needed.
9. The approval service gates restricted behavior and records the result.
10. The transcript/trace service emits structured runtime events.
11. The execution engine finalizes the response.
12. Session/run/checkpoint persistence occurs at defined boundaries.
13. Memory write-back occurs only after allowed finalization boundaries.
14. The chat UI bridge presents the result using the existing workbench chat
    surface.

No runtime-important side effect should depend on implicit ordering inside one
participant closure.

---

## 8. Prompt Authority Contract

The target architecture has one canonical prompt-layer order:

1. immutable Parallx runtime instructions,
2. bundled prompt layers if the runtime defines them,
3. workspace/root prompt files,
4. rule overlays,
5. runtime-generated context,
6. user turn content.

Rules:

- later layers may refine lower layers only where the contract permits,
- no alternate hidden prompt path may bypass the canonical assembly service,
- the runtime must be able to explain which layers influenced a turn.

---

## 9. Skill Contract

The architecture assumes one manifest-driven skill model.

Rules:

- bundled and workspace skills follow the same visible contract,
- skill discovery is deterministic,
- invalid skills fail visibly rather than silently mutating runtime behavior,
- skill metadata visible to the model is controlled by the runtime contract,
- runtime-only control data remains separate from model-visible metadata.

---

## 10. Execution Contract

The execution engine owns:

- turn lifecycle,
- tool-loop coordination,
- response shaping,
- finalization boundaries,
- interaction with approval and trace services.

The execution engine does not own substrate-specific storage or UI behavior.

This prevents orchestration logic from leaking back into unrelated layers.

---

## 11. Session, Run, And Checkpoint Model

The target architecture defines three distinct identities:

- **Session**: durable conversation continuity boundary,
- **Run**: one execution attempt for one user turn,
- **Checkpoint**: an explicit persisted boundary inside a run.

Checkpoint examples:

- after request normalization,
- after context assembly,
- before approval wait,
- after tool completion,
- after response finalization.

The architecture does not require full deterministic replay in the first cut,
but it does require enough checkpoint discipline to explain execution state and
support debugging.

---

## 12. Compatibility Bridge

During migration, the existing chat entry path remains as a compatibility bridge
only.

That bridge should:

- collect the turn,
- hand it to the new runtime,
- map output back to existing UI/session models.

That bridge should not remain a permanent second orchestration layer.

---

## 13. Explicit Exclusions

The first-cut architecture explicitly excludes:

- standalone gateway mode,
- browser control plane,
- multi-channel ingress,
- Docker/OpenShell execution,
- Python blueprint orchestration,
- cloud-first provider routing.

---

## 14. Architecture Validation Criteria

The target architecture is ready for implementation only when:

1. each component has a clear responsibility boundary,
2. prompt authority is singular,
3. runtime ownership is singular,
4. preserved substrate responsibilities remain intact,
5. no unresolved overlap remains between compatibility bridge logic and target
   runtime logic.

This document defines that target clearly enough for implementation planning.