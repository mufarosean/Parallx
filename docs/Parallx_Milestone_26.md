# Milestone 26 — AI Runtime Refactor and Architecture Hardening

> **Authoritative Scope Notice**
>
> This document is the single source of truth for Milestone 26.
> All AI-runtime refactor work, chat-orchestration decomposition, prompt-layer
> consolidation, context-planning changes, and migration sequencing for this
> milestone must follow the architecture, priorities, and boundaries defined
> here.
>
> This milestone is based on a **code-first assessment of the current
> implementation**, not on older architecture documentation. The analysis in
> this document is grounded in the actual runtime paths now present in:
>
> - `src/built-in/chat/participants/defaultParticipant.ts`
> - `src/built-in/chat/data/chatDataService.ts`
> - `src/built-in/chat/config/chatSystemPrompts.ts`
> - `src/aiSettings/unifiedAIConfigService.ts`
> - `src/aiSettings/systemPromptGenerator.ts`
> - `src/services/retrievalService.ts`
> - `src/services/memoryService.ts`
> - `src/services/agentSessionService.ts`
> - `src/services/agentExecutionService.ts`
> - `src/workbench/workbenchFacadeFactory.ts`

---

## Table of Contents

1. [Problem Statement](#problem-statement)
2. [Code-First Current State Audit](#code-first-current-state-audit)
3. [Root Cause Analysis](#root-cause-analysis)
4. [Vision](#vision)
5. [Scope](#scope)
6. [Guiding Principles](#guiding-principles)
7. [Target Architecture](#target-architecture)
8. [Subsystem Contracts](#subsystem-contracts)
9. [Phase Plan](#phase-plan)
10. [Implementation Sequence](#implementation-sequence)
11. [Migration and Compatibility](#migration-and-compatibility)
12. [Evaluation Strategy](#evaluation-strategy)
13. [Task Tracker](#task-tracker)
14. [Verification Checklist](#verification-checklist)
15. [Risk Register](#risk-register)

---

## Problem Statement

Parallx now has strong local-first AI primitives:

- local chat inference through the language-model service,
- workspace retrieval and evidence assembly,
- session and concept memory,
- layered prompt files and AI settings,
- autonomous workspace task runtime,
- approval, trace, and artifact recording.

The problem is no longer the absence of capability.

The problem is that the main chat runtime path has become a **single,
overloaded orchestration surface** that mixes too many responsibilities in one
place. That design makes the product harder to reason about, harder to test,
harder to improve safely, and increasingly vulnerable to mode-confusion bugs.

The recent AIR behavior fixes proved that the system can be improved, but they
also exposed the deeper issue: many behavioral corrections currently require
adding more branching, gating, and post-hoc repair inside the same monolithic
path rather than strengthening the system through cleaner boundaries.

Today the user-visible consequences are clear:

1. **Mode confusion remains structurally likely**
   - conversational turns,
   - grounded evidence turns,
   - memory recall turns,
   - and delegated-task semantics
   all still converge through one main participant path.

2. **Prompt authority is fragmented**
   - behavior is shaped partly by chat-mode prompts,
   - partly by AI settings prompt generation,
   - partly by prompt file overlays,
   - and partly by runtime repair logic.

3. **Context assembly is too implicit**
   - the same request path decides when to inject page content, retrieval,
     memory, concepts, attachments, workspace digest context, and tools.

4. **Policy and product semantics are mixed with answer generation**
   - approval explanations,
   - workspace-boundary explanations,
   - artifact guidance,
   - and trace explanations
   are partly treated as product behavior and partly left to the model.

5. **Post-hoc repair is carrying too much runtime responsibility**
   - multiple answer repair stages exist because the architecture allows
     upstream ambiguity to survive too far into the pipeline.

6. **The current design slows future work**
   - every behavior improvement risks interacting with retrieval, memory,
     tools, citations, fallback synthesis, and summarization in the same file.

Milestone 26 exists to fix that architectural problem at the root.

---

## Code-First Current State Audit

This section records what the current code actually does, not what older docs
say it should do.

### 1. `defaultParticipant.ts` is the main architectural hotspot

The default participant currently performs or directly coordinates all of the
following:

- lightweight turn heuristics,
- off-topic routing,
- explicit memory-recall routing,
- product-semantics direct answers,
- system prompt construction inputs,
- current-page injection,
- retrieval gating,
- memory recall gating,
- concept recall gating,
- attachment/context fan-out,
- evidence sufficiency assessment,
- retrieve-again query shaping,
- tool availability decisions,
- tool-loop orchestration,
- fallback extractive synthesis,
- citation footer repair,
- grounded answer repair,
- session summarization triggering,
- concept extraction triggering,
- final response normalization.

That is too much responsibility for a single participant handler.

### 2. `ChatDataService` is a second oversized hotspot

`src/built-in/chat/data/chatDataService.ts` currently acts as more than a data
service. It also behaves as a broad orchestration adapter and service bundle.

It currently owns or exposes logic related to:

- language-model request dispatch,
- retrieval access,
- memory access,
- prompt-file access,
- workspace digest generation,
- file/content access,
- UI reporting helpers,
- participant service construction,
- agent-task surface integration.

This creates a second concentration point where cross-domain behavior becomes
hard to separate.

### 3. Prompt behavior is spread across multiple authorities

Prompt behavior is currently shaped by at least three layers:

1. `chatSystemPrompts.ts`
2. `systemPromptGenerator.ts` through unified AI settings
3. prompt file layers such as `SOUL.md`, `AGENTS.md`, `TOOLS.md`, and rules

This is powerful, but the current implementation does not enforce a single
clear contract for how these layers should combine. That leaves behavior split
between declarative instructions and imperative runtime logic.

### 4. Retrieval and memory are comparatively healthier than chat orchestration

`retrievalService.ts` and `memoryService.ts` are large, but they are still more
cohesive than the chat participant path. They have clearer domain ownership and
are good candidates to remain as domain services behind a stronger orchestration
boundary.

### 5. Agent runtime services are structurally stronger than the chat path

`AgentSessionService` and `AgentExecutionService` already express a more stable
service architecture:

- explicit task lifecycle,
- explicit approval state,
- explicit trace and artifact behavior,
- clearer state transitions.

That makes them a better substrate for delegated-task execution than the
current model-led participant loop.

### 6. Workbench wiring already supports service decomposition

`workbenchFacadeFactory.ts` shows that the runtime can already compose multiple
workspace-scoped services. That means the primary barrier is not DI or service
registration. The barrier is the current chat runtime design.

### Current-state conclusion

Parallx does not have an AI capability problem.

Parallx has an **AI runtime composition problem**.

---

## Root Cause Analysis

The recent behavior regressions were not isolated accidents. They were the
direct consequence of four structural flaws.

### Root Cause 1 — Monolithic orchestration

One participant path still decides:

- what kind of turn the user made,
- which context sources should be used,
- what prompt constraints should be injected,
- whether tools should be available,
- how to recover weak answers,
- and what should be remembered afterward.

That means routing, planning, execution, answer synthesis, and memory write-back
are not cleanly separated.

### Root Cause 2 — Too much model-led behavior in mixed-mode flows

The current path still leans on the model for tasks that should be determined
earlier and more explicitly, including:

- whether this is conversational vs grounded vs product-semantics,
- when evidence is sufficient to affirm a claim,
- when task-rail semantics should be explained directly,
- when a response should remain narrow and non-inferential.

### Root Cause 3 — No explicit context plan object with hard contracts

The system has pieces of this behavior, but not a first-class runtime contract
that says, for one request:

- which context sources are allowed,
- which are required,
- which are excluded,
- whether tools are enabled,
- whether citations are expected,
- whether the turn is eligible for memory write-back.

Without that contract, downstream code keeps re-deciding the same things.

### Root Cause 4 — Answer repair compensates for upstream ambiguity

Repair logic is useful and should remain, but it is currently compensating for
problems that should have been prevented earlier by cleaner routing,
context-planning, and response constraints.

---

## Vision

### Before M26

> Parallx has strong AI subsystems, but the main chat runtime path remains too
> monolithic. The system can be corrected, but behavior quality still depends
> too heavily on a central handler that mixes routing, context assembly, tool
> execution, and answer repair.

### After M26

> Parallx AI runs through an explicit, inspectable pipeline with stable service
> boundaries: route the turn, build a context plan, gather allowed context,
> execute the right answer path, validate the result, then write back memory.
> Product semantics and delegated-task behavior are handled intentionally rather
> than opportunistically.

### Product definition

After this milestone, Parallx AI should behave like a disciplined workspace
intelligence runtime, not a single large chat handler with accumulated fixes.

---

## Scope

### In scope

- decomposing the default chat runtime into explicit orchestration stages,
- introducing a first-class turn-routing layer,
- introducing a first-class context-planning layer,
- separating product-semantics responses from general model synthesis,
- separating answer synthesis from answer validation and repair,
- consolidating prompt authority into a single assembly contract,
- narrowing `ChatDataService` into cleaner service roles,
- preserving current retrieval, memory, and agent services behind better
  orchestration boundaries,
- updating tests to match the new architecture contract.

### Out of scope

- changing the model provider,
- replacing the retrieval engine,
- replacing the agent runtime service model,
- redesigning unrelated UI surfaces,
- cloud features or external SaaS dependencies,
- speculative new AI features unrelated to architecture hardening.

---

## Guiding Principles

1. **Separate decision phases explicitly**
   - routing, context planning, execution, validation, and memory write-back
     must be distinct stages.

2. **Move ambiguity earlier, not later**
   - determine allowed behavior before model synthesis where possible.

3. **Use deterministic product semantics for product questions**
   - approval-scope, workspace-boundary, artifact, and trace semantics should
     not depend on retrieval or generic model interpretation.

4. **Keep domain services domain-focused**
   - retrieval remains retrieval,
   - memory remains memory,
   - agent execution remains agent execution.

5. **Preserve local-first architecture**
   - all work continues to flow through local models and existing service
     boundaries.

6. **Prefer explicit contracts over hidden coupling**
   - new orchestration objects should be typed, inspectable, and testable.

7. **Do not replace working subsystems unnecessarily**
   - this milestone is a refactor and hardening effort, not a rewrite for its
     own sake.

---

## Target Architecture

Milestone 26 introduces a staged AI runtime pipeline.

### Stage 1 — Turn Router

Purpose:

- classify the user turn into a small explicit set of runtime intents.

Required output:

- `conversation`
- `grounded-question`
- `memory-recall`
- `product-semantics`
- `delegated-task-request`
- `off-topic`
- `command`

Responsibilities:

- no retrieval,
- no tool execution,
- no answer generation,
- only classification and route metadata.

### Stage 2 — Context Planner

Purpose:

- turn the route into an explicit context plan.

Required contract:

- whether current-page context is allowed,
- whether retrieval is allowed,
- whether session memory is allowed,
- whether concept memory is allowed,
- whether attachments are allowed,
- whether tools are allowed,
- whether citations are expected,
- whether a direct deterministic answer path should be used.

This becomes the authoritative per-turn execution contract.

### Stage 3 — Context Assembly

Purpose:

- collect only the context allowed by the context plan.

Responsibilities:

- page content,
- retrieval context,
- memory recall,
- concepts,
- attachments,
- prompt file layers,
- workspace digest inputs.

This stage does not decide policy. It only assembles the plan.

### Stage 4 — Response Executor

Purpose:

- select the correct response path.

Execution modes:

- deterministic direct response,
- model-only response,
- model-plus-tools response,
- delegated-task handoff.

This is where product semantics and off-topic redirects should branch away from
general model synthesis.

### Stage 5 — Response Validator

Purpose:

- validate answer quality against the context plan and evidence constraints.

Responsibilities:

- evidence sufficiency checks,
- citation consistency checks,
- targeted repair of known grounded-answer failure modes,
- narration stripping,
- normalization.

Repair remains here, but on a narrower scope.

### Stage 6 — Memory Write-Back

Purpose:

- persist conversation summaries and concepts only when the turn is eligible.

Responsibilities:

- deterministic fallback summary,
- optional model summarization,
- concept extraction,
- turn-eligibility checks.

This stage must never affect the answer that was already emitted.

---

## Subsystem Contracts

### A. Prompt Assembly Contract

Milestone 26 introduces a single prompt assembly contract with named layers:

1. product base prompt,
2. mode-specific prompt additions,
3. AI-settings persona/tone additions,
4. prompt-file layers,
5. runtime response constraints.

Each layer must have a defined purpose and merge order.

The runtime should stop treating prompt behavior as an informal mixture of
settings, files, and ad hoc message fragments.

### B. Product Semantics Contract

Questions about Parallx product behavior should not flow through generic
workspace retrieval unless the question explicitly asks for workspace evidence.

Examples:

- approval-scope explanations,
- blocked-task recovery guidance,
- artifact guidance,
- trace explanations,
- workspace-boundary semantics.

These should be backed by explicit product-semantics handlers.

### C. Delegated Task Contract

Delegated task creation should become a distinct route and handoff, not just a
side effect of a generic model/tool loop.

The agent runtime already has stronger service boundaries. Milestone 26 should
lean into those boundaries rather than reproduce them inside the chat runtime.

### D. Citation Contract

The runtime must know whether citations are expected based on the context plan.

- conversational turns: citations off
- product semantics: citations off
- memory recall direct answers: citations off unless explicit evidence is used
- grounded retrieval turns: citations on when retrieval evidence is actually used

This should be contractual, not inferred late.

---

## Phase Plan

### Phase A — Runtime Mapping and Interface Extraction

Goal: define the new orchestration interfaces and isolate the current hotspot
boundaries.

Outputs:

- route types,
- context-plan types,
- prompt-assembly contract,
- response-executor contract.

### Phase B — Turn Router and Context Planner

Goal: move intent and context decisions out of the main participant body.

Outputs:

- dedicated turn-router module,
- dedicated context-planner module,
- unit coverage for route classification and plan formation.

### Phase C — Response Path Decomposition

Goal: separate deterministic direct responses, grounded model synthesis, tool
execution, and delegated-task handoff.

Outputs:

- response executor modules,
- product-semantics handler,
- tool-enabled executor,
- delegated-task handoff path.

### Phase D — Validation and Memory Write-Back Isolation

Goal: reduce post-hoc repair to a narrow, explicit validation stage and isolate
memory persistence after answer emission.

Outputs:

- response validator,
- memory write-back coordinator,
- narrower repair surface.

### Phase E — `ChatDataService` Narrowing and Final Migration

Goal: reduce `ChatDataService` from broad orchestrator to a smaller set of
clear adapters.

Outputs:

- smaller service bundles,
- explicit runtime dependencies,
- removal of dead orchestration paths.

---

## Implementation Sequence

The sequence matters. This milestone should not begin by editing behavior in
five directions at once.

### Sequence 1 — Define types and contracts first

- extract route and context-plan types before moving logic.

### Sequence 2 — Move decision logic before moving execution logic

- turn routing and context planning come before tool-loop refactor.

### Sequence 3 — Carve out deterministic paths early

- product semantics,
- off-topic redirects,
- memory recall direct answers.

These should become explicit executors before broader model-loop changes.

### Sequence 4 — Split response generation from validation

- only after execution paths are explicit should repair and citation validation
  be narrowed.

### Sequence 5 — Narrow service composition last

- `ChatDataService` should be reduced after the new orchestration contracts are
  in use.

### Ordering constraints

1. Do **not** rewrite retrieval or memory internals first.
2. Do **not** collapse agent runtime services into the chat runtime.
3. Do **not** move prompt behavior without defining merge order first.
4. Do **not** delete repair logic until earlier stages enforce stronger
   constraints.

---

## Migration and Compatibility

Milestone 26 must preserve the following external behavior:

- local-only model execution through the existing language-model service,
- current retrieval service behavior unless explicitly improved,
- current memory service persistence behavior unless explicitly improved,
- current agent runtime service contracts,
- current chat UI contract for task rail, citations, and streamed markdown.

Migration strategy:

1. introduce new orchestration modules behind the existing participant entry,
2. move one decision stage at a time,
3. keep tests passing at each stage,
4. remove dead branches only after replacement coverage exists.

---

## Evaluation Strategy

This milestone is architectural, but it must still be validated as product
behavior.

### Required validation layers

1. unit tests for route classification and context planning,
2. unit tests for response executor selection,
3. unit tests for citation and evidence validation,
4. existing deterministic AIR Playwright coverage,
5. existing live-model AI eval coverage.

### Architecture-specific success criteria

The milestone succeeds when the following are true:

1. a single request no longer requires the main participant file to decide
   routing, context, execution, validation, and memory persistence inline;
2. prompt assembly has one explicit merge contract;
3. product-semantics answers no longer depend on incidental retrieval behavior;
4. conversational and grounded turns have explicit context plans;
5. delegated-task handoff is structurally clearer than the current mixed path;
6. existing AIR behavior quality is preserved or improved.

---

## Task Tracker

### Phase A — Runtime Mapping and Interface Extraction
- [ ] A1. Define turn-route types and route metadata contract
- [ ] A2. Define context-plan types and context-source policy contract
- [ ] A3. Define prompt-assembly contract and merge order
- [ ] A4. Define response-executor and validator interfaces

### Phase B — Turn Router and Context Planner
- [ ] B1. Extract turn-router module from `defaultParticipant.ts`
- [ ] B2. Extract context-planner module from `defaultParticipant.ts`
- [ ] B3. Add focused unit tests for route and plan behavior

### Phase C — Response Path Decomposition
- [ ] C1. Extract deterministic product-semantics handler
- [ ] C2. Extract conversational/model-only executor
- [ ] C3. Extract grounded/tool-enabled executor
- [ ] C4. Extract delegated-task handoff executor

### Phase D — Validation and Memory Isolation
- [ ] D1. Extract response validator and answer-repair coordinator
- [ ] D2. Extract citation-policy enforcement from the main participant body
- [ ] D3. Extract memory write-back coordinator from the main participant body

### Phase E — `ChatDataService` Narrowing and Final Migration
- [ ] E1. Reduce `ChatDataService` service-bundle width
- [ ] E2. Separate adapter responsibilities from orchestration responsibilities
- [ ] E3. Remove dead branches and legacy orchestration paths

---

## Verification Checklist

- [ ] Turn routing is explicit and unit-tested
- [ ] Context planning is explicit and unit-tested
- [ ] Conversational turns have a distinct execution contract
- [ ] Grounded turns have a distinct execution contract
- [ ] Memory-recall turns have a distinct execution contract
- [ ] Product-semantics turns have a distinct execution contract
- [ ] Delegated-task handoff is structurally separate from normal chat synthesis
- [ ] Prompt assembly has one documented merge order
- [ ] Citation policy is enforced from the context plan rather than inferred late
- [ ] Memory write-back runs after response emission and is independently testable
- [ ] Existing AIR Playwright behavior remains valid
- [ ] Existing live-model eval behavior remains valid or improves
- [ ] `defaultParticipant.ts` is materially smaller and less cross-domain
- [ ] `ChatDataService.ts` is materially narrower and less orchestration-heavy

---

## Risk Register

### Risk 1 — Refactor drift without behavioral gains

If the work becomes a purely structural cleanup, the repo may pay migration cost
without better product behavior.

Mitigation:

- keep AIR behavior tests and evals in the loop,
- make each extracted stage prove a user-visible benefit or risk reduction.

### Risk 2 — Over-refactoring stable domain services

Retrieval, memory, and agent runtime services are not the primary problem.

Mitigation:

- preserve those services unless there is clear evidence of a boundary problem,
- focus first on orchestration hotspots.

### Risk 3 — Prompt regressions during consolidation

If prompt layers are merged without a strict contract, subtle behavior changes
will be hard to diagnose.

Mitigation:

- define merge order before code movement,
- add snapshot-like tests for prompt assembly where practical.

### Risk 4 — Temporary duplication during migration

During extraction, some logic will exist in both old and new locations.

Mitigation:

- migrate one stage at a time,
- remove legacy branches only after replacement tests pass.

### Risk 5 — Repair logic removed too early

The current runtime still depends on targeted repair in some grounded cases.

Mitigation:

- keep repair logic until earlier routing and validation stages prove they
  prevent the same failures reliably.

### Risk 6 — Agent path regresses during separation

Delegated-task behavior already has stronger services and should not be made
less explicit by an over-eager chat refactor.

Mitigation:

- treat the agent runtime as a stable subsystem,
- refactor the chat handoff into it rather than around it.

---

## Milestone Conclusion

Milestone 25 improved AIR behavior quality and evaluation. Milestone 26 is the
follow-through: it turns those lessons into a runtime architecture that can
support serious product quality without accumulating more logic in one central
participant file.

The goal is not a rewrite.

The goal is a disciplined decomposition of the AI runtime so future behavior
work becomes cheaper, safer, and more defensible.