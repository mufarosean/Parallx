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
4. [Architecture Reference Fit](#architecture-reference-fit)
5. [External Benchmark Research](#external-benchmark-research)
6. [Vision](#vision)
7. [Scope](#scope)
8. [Guiding Principles](#guiding-principles)
9. [Target Architecture](#target-architecture)
10. [Subsystem Contracts](#subsystem-contracts)
11. [Phase Plan](#phase-plan)
12. [Implementation Sequence](#implementation-sequence)
13. [Migration and Compatibility](#migration-and-compatibility)
14. [Evaluation Strategy](#evaluation-strategy)
15. [Task Tracker](#task-tracker)
16. [Verification Checklist](#verification-checklist)
17. [Risk Register](#risk-register)

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

## Architecture Reference Fit

The existing Parallx architecture documents were reviewed as reference points,
but they are not the source of truth for this milestone. The source of truth
remains the live code paths listed at the top of this document.

### What `ARCHITECTURE.md` contributes

`ARCHITECTURE.md` is still valuable because it reinforces a repo-wide design
discipline that the AI runtime should follow:

- explicit module responsibility,
- gate-like boundaries instead of cross-reach imports,
- source-owned dependencies,
- and a strong bias against tangled orchestration.

That document is centered on the canvas gate architecture, not on AI runtime
internals, so it should be treated as a structural style guide rather than an
AI blueprint.

### What Milestone 24 contributes

`docs/Parallx_Milestone_24.md` is much more directly relevant to the AI target
state because it already defines several principles that a reliable runtime
needs:

- services over monoliths,
- explicit task lifecycle,
- explicit approval and policy handling,
- workspace-bounded execution,
- resumability,
- and inspectable traces.

Those principles support the M26 direction rather than competing with it.

### What this means for M26

M26 should treat the repo's architecture guidance as a constraint on how the
AI runtime is decomposed:

- the chat runtime should adopt the same boundary discipline the repo already
   expects elsewhere,
- the delegated-task path should lean on the stronger service model already
   established in M24,
- and the refactor should avoid creating a new AI monolith under a different
   name.

---

## External Benchmark Research

This section records the external patterns gathered while assessing what a
more reliable Parallx AI architecture should look like.

### OpenClaw patterns that matter

The OpenClaw codebase consistently separates concerns that Parallx currently
mixes together:

1. runtime configuration is explicit,
2. system-prompt assembly has a fixed section structure,
3. skills are loaded through a workspace skill snapshot rather than by ad hoc
    prompt concatenation,
4. sandbox policy is modeled separately from prompt content,
5. approvals are represented as runtime objects rather than only prose,
6. memory flush and session handling are separate runtime concerns,
7. prompt stability and runtime behavior are tested directly.

The important lesson is not that Parallx should copy OpenClaw feature-for-
feature. The lesson is that reliability comes from explicit runtime contracts:

- stable prompt assembly,
- stable tool policy,
- stable skill loading,
- stable session/memory handling,
- stable approval and sandbox semantics.

The deeper runtime research reinforces four additional points that matter for
Parallx:

1. the agent loop is treated as an authoritative runtime path,
2. runs are serialized per session and optionally through a global queue to
   prevent races,
3. lifecycle, assistant, and tool events are emitted as distinct streams,
4. timeout, abort, queue, and follow-up behavior are explicit runtime features
   rather than emergent prompt behavior.

That is especially relevant because Parallx currently blends answer generation,
task semantics, and post-hoc repair in one path, whereas OpenClaw treats run
control as a separate system.

### CopilotKit patterns that matter

CopilotKit is a useful comparison because it treats the agent, runtime, and UI
as distinct systems connected by typed events and explicit tool lifecycles.

The most relevant architectural patterns are:

1. a runtime-side agent runner abstraction,
2. evented execution stages rather than opaque one-shot replies,
3. shared state as an explicit contract,
4. human-in-the-loop as a paused tool state with clear status transitions,
5. renderable tool and activity traces in the UI.

The lesson for Parallx is that inspectability should not be an afterthought.
Reliable agent products make run state visible as structured runtime data,
not just as model narration.

### LangGraph patterns that matter

LangGraph is useful because it formalizes several runtime properties that many
agent products implement informally.

The most relevant patterns are:

1. durable execution requires explicit persistence and thread identity,
2. resume does not continue from the same source line and therefore demands
   deterministic replay boundaries,
3. human-in-the-loop is modeled as an interrupt/resume contract rather than as
   free-form chat handling,
4. short-term state, long-term memory, and checkpoint state are separated,
5. concurrency, pending tasks, interrupts, and next-step state are all
   inspectable runtime values.

The main lesson for Parallx is that resumability is not just a storage feature.
It is a control-flow contract. If a runtime can pause and resume, it must make
side effects, approval boundaries, and replay semantics explicit.

### Cua patterns that matter

Cua is a different product class, but it reinforces two reliability patterns
that matter for Parallx:

1. isolate execution environments instead of trusting ambient machine state,
2. build the evaluation harness into the product architecture.

Its benchmark stack, sandbox model, health checks, and loop-testing harnesses
show that reliability is not only a runtime-design problem. It is also a
reproducibility and measurement problem.

For Parallx, this translates into:

- stronger workspace-bounded execution contracts,
- better run-health visibility,
- and architecture-specific evals that prove routing, approvals, and handoff
   behavior remain stable.

### E2B patterns that matter

E2B reinforces the sandbox side of the architecture problem.

The most relevant patterns are:

1. sandbox lifecycle is explicit: create, inspect, extend timeout, pause,
   resume, kill,
2. sandbox state is treated as durable runtime state rather than temporary
   process state,
3. runtime metadata such as sandbox identity and expiry are queryable,
4. the execution environment is a first-class product primitive, not an
   implementation detail.

Parallx is not trying to become a cloud sandbox platform, but the product
lesson is still useful: execution boundaries become more reliable when they are
modeled explicitly and surfaced to the runtime.

### Temporal patterns that matter

Temporal is useful because it makes durable execution constraints painfully
explicit instead of hiding them behind convenience APIs.

The most relevant patterns are:

1. resumable execution is grounded in event history and replay rather than in
   "continue where we left off" intuition,
2. workflows need stable workflow identity and per-run identity,
3. state transitions are explicit progress units that can be counted,
   inspected, and reasoned about,
4. long-running execution needs versioning discipline because code changes can
   invalidate replay expectations,
5. mutable metadata is useful for inspection, but core execution state must not
   be hidden in side channels.

The lesson for Parallx is not to copy Temporal's programming model. The lesson
is that approval pauses, retries, resume, and step boundaries need explicit run
identity and state-transition semantics if they are going to remain reliable as
the runtime evolves.

### OpenAI Agents SDK patterns that matter

The OpenAI Agents SDK is useful because it treats handoffs and tracing as core
runtime primitives instead of optional diagnostics.

The most relevant patterns are:

1. handoffs are explicit runtime actions with a destination and optional
   structured metadata,
2. handoff input can be filtered so the receiving specialist does not inherit
   the entire unshaped transcript by default,
3. traces and spans are modeled per workflow, agent run, generation, tool call,
   guardrail, and handoff,
4. run grouping and metadata are first-class parts of observability,
5. sensitive trace payloads are configurable rather than accidentally leaked by
   debug logging.

The lesson for Parallx is that delegated-task handoff should carry a typed
payload, explicit history-shaping rules, and trace metadata. Inspectability is
stronger when the runtime records what was handed off, why it was handed off,
and which execution span now owns the work.

### External-research conclusion

Across OpenClaw, CopilotKit, and Cua, the same pattern appears repeatedly:

reliable AI products are built around a control plane, not just a model loop.

Temporal and the OpenAI Agents SDK reinforce the same conclusion from two more
angles:

- resumability only stays correct when run identity, replay boundaries, and
  state transitions are explicit,
- delegation only stays explainable when handoffs and traces are structured
  runtime objects rather than prose side effects.

That control plane usually includes:

- explicit runtime state,
- explicit policy enforcement,
- explicit capability registration,
- explicit concurrency and run-lane control,
- explicit interrupt/resume semantics,
- explicit execution traces,
- and explicit evaluation harnesses.

Parallx should adopt those patterns in a workspace-local way rather than keep
expanding a single mixed participant handler.

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

8. **Treat reliability as a control-plane property**
   - policy, routing, traceability, approvals, and run-state visibility must
     be modeled explicitly rather than left inside prompt prose.

9. **Make execution inspectable by default**
   - the runtime should be able to explain which route was chosen, which
     context sources were allowed, which executor ran, and why validation or
     repair occurred.

10. **Benchmark the architecture, not only the answers**
   - validation must prove the staged runtime behaves consistently under
     routing, policy, and handoff pressure.

11. **Model replay and resume semantics deliberately**
    - if a turn, task, or approval can be resumed, the architecture must define
       what is replayed, what is persisted, and which side effects are allowed to
       happen before a resumable boundary.

12. **Control concurrency explicitly**
    - session-level serialization, delegated-task handoff, and background work
       should run under explicit queue or lane rules so one run cannot corrupt or
       confuse another.

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

### Cross-Cutting Runtime Control Plane

The staged pipeline should be supported by a small set of explicit cross-
cutting contracts.

#### 1. Run Record

Each turn should produce an inspectable run record containing at minimum:

- route,
- context plan,
- assembled context sources,
- executor path,
- validator outcomes,
- memory-write eligibility.

This gives Parallx a stable debugging and evaluation surface.

#### 2. Capability Registry

Tool, retrieval, memory, prompt-file, and delegated-task capabilities should
be treated as registered runtime capabilities rather than as incidental access
through a broad service bundle.

This does not require inventing a plugin framework for M26. It requires making
capability availability explicit and inspectable per turn.

#### 3. Policy and Approval Gate

Approval and workspace-boundary decisions should be represented as policy
checks that the executor consumes, not as scattered conditionals inside answer
generation.

This aligns the chat runtime more closely with the stronger agent-service model
already present in Parallx and with the external products studied during this
assessment.

#### 4. Trace Surface

The runtime should emit structured trace data that the existing task cards,
debug surfaces, and future eval tooling can consume without depending on model
wording.

That is the key step from "smart chat" to "reliable agent runtime."

#### 5. Concurrency and Resume Semantics

The runtime should define, at architecture level:

- which turn paths are serialized per chat session,
- which delegated-task operations may continue asynchronously,
- how approvals pause and resume work,
- and which write paths must be idempotent across retries or resumes.

This is one of the clearest lessons from the external systems reviewed:
reliable agents do not rely on informal assumptions about replay or overlap.

#### 6. Boundary Runtime Metadata

When execution is bounded by workspace, approval policy, or a task runtime, the
runtime should expose the relevant metadata explicitly.

Examples:

- active workspace root,
- effective approval mode,
- delegated task/run identifier,
- pending blocked state,
- timeout or expiry metadata for long-running work.

This keeps the product explainable without relying on the model to restate the
state correctly.

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

### Reliability-specific success criteria

The milestone should also be judged against the reliability patterns observed
in external systems:

1. prompt assembly is stable enough to snapshot and regression-test;
2. runtime route and context-plan decisions are observable without reading
   model output;
3. approval and policy decisions are explainable from runtime state rather
   than reconstructed from prose;
4. delegated-task handoff behaves like a clear runtime transition, not a
   hidden branch in normal chat execution;
5. architecture-level evals can detect regressions in route selection,
   citation policy, and task handoff even when answer wording changes.
6. resumable or approval-paused flows do not duplicate side effects across
   retries or restarts.
7. session-level concurrency rules prevent overlapping runs from corrupting
   chat state, memory state, or delegated-task state.

---

## Task Tracker

### Phase A — Runtime Mapping and Interface Extraction
- [x] A1. Define turn-route types and route metadata contract ✅ Implemented in `chatTypes.ts` with `IChatTurnRoute`, `ChatTurnRouteKind`, and runtime trace wiring.
- [x] A2. Define context-plan types and context-source policy contract ✅ Implemented in `chatTypes.ts` and `chatContextPlanner.ts` with explicit retrieval, memory, current-page, and citation policy decisions.
- [ ] A3. Define prompt-assembly contract and merge order
- [ ] A4. Define response-executor and validator interfaces

### Phase B — Turn Router and Context Planner
- [x] B1. Extract turn-router module from `defaultParticipant.ts` ✅ Implemented in `chatTurnRouter.ts` and wired through the participant entry path.
- [x] B2. Extract context-planner module from `defaultParticipant.ts` ✅ Implemented in `chatContextPlanner.ts` and used by the participant runtime.
- [x] B3. Add focused unit tests for route and plan behavior ✅ Covered in `chatRuntimePlanning.test.ts`.

### Phase C — Response Path Decomposition
- [x] C1. Extract deterministic product-semantics handler ✅ Product-semantics, off-topic, memory-recall, and unsupported-specific-coverage direct answers now flow through deterministic selector/executor modules.
- [x] C2. Extract conversational/model-only executor ✅ No-tool Ask/Edit turns now run through `chatModelOnlyExecutor.ts`, leaving the participant loop focused on tool-enabled execution.
- [x] C3. Extract grounded/tool-enabled executor ✅ Tool-loop execution and no-markdown fallback synthesis now run through `chatGroundedExecutor.ts`.
- [x] C4. Extract delegated-task handoff executor ✅ Code-first audit confirmed the default participant no longer owns delegated-task handoff; task approval/continue transitions are already exposed through `ChatDataService` and the task rail adapter layer.

### Phase D — Validation and Memory Isolation
- [x] D1. Extract response validator and answer-repair coordinator ✅ Final markdown repair and fallback-vs-debug reporting now run through `chatResponseValidator.ts`.
- [x] D2. Extract citation-policy enforcement from the main participant body ✅ Citation remapping, footer enforcement, and `setCitations(...)` now run through `chatResponseValidator.ts`.
- [x] D3. Extract memory write-back coordinator from the main participant body ✅ Preference extraction and session summary/concept write-back now run through `chatMemoryWriteBack.ts`.

### Phase E — `ChatDataService` Narrowing and Final Migration
- [ ] E1. Reduce `ChatDataService` service-bundle width
- [ ] E2. Separate adapter responsibilities from orchestration responsibilities
- [ ] E3. Remove dead branches and legacy orchestration paths

---

## Implementation Progress

### Completed slices as of 2026-03-09

1. Turn routing moved out of `defaultParticipant.ts` into `chatTurnRouter.ts`.
2. Context planning and runtime trace shape moved into `chatContextPlanner.ts`
   and `chatTypes.ts`.
3. Deterministic direct-answer helpers moved into
   `chatDeterministicExecutors.ts`.
4. Deterministic answer dispatch moved into
   `chatDeterministicAnswerSelector.ts`.
5. `ChatDataService` now exposes runtime-trace snapshots for tests and evals.
6. Parallel context-source loading moved into
   `chatContextSourceLoader.ts`, narrowing `defaultParticipant.ts` to
   orchestration and post-load processing.
7. Post-load context assembly moved into `chatContextAssembly.ts`, including
   retrieve-again retry, memory/concept/attachment shaping, context-pill
   reporting, and excluded-pill filtering.
8. No-tool conversational and edit execution moved into
   `chatModelOnlyExecutor.ts`, leaving `defaultParticipant.ts` to select
   between model-only and tool-enabled execution paths.
9. Tool-enabled looping and post-loop fallback synthesis moved into
   `chatGroundedExecutor.ts`, narrowing `defaultParticipant.ts` to execution
   selection plus post-response validation and write-back.
10. Final response repair, citation remapping/footer enforcement, and
    fallback-vs-debug reporting moved into `chatResponseValidator.ts`,
    narrowing `defaultParticipant.ts` to validator wiring plus memory/write-back.
11. Post-response preference extraction and session summary/concept write-back
   moved into `chatMemoryWriteBack.ts`, narrowing `defaultParticipant.ts` to
   execution and response finalization.
12. Delegated-task approval/continue transitions are no longer part of the
   default participant surface; they already live in `ChatDataService` and the
   task-rail adapter layer.
13. Agent-task widget adapter wiring moved out of `ChatDataService` into
   `chatAgentTaskWidgetAdapter.ts`, starting `E1` by narrowing the widget/task
   rail service-bundle surface.

### Validation completed for these slices

- focused route/plan tests in `chatRuntimePlanning.test.ts`
- deterministic executor tests in `chatDeterministicExecutors.test.ts`
- deterministic selector tests in `chatDeterministicAnswerSelector.test.ts`
- context-source loader tests in `chatContextSourceLoader.test.ts`
- context assembly tests in `chatContextAssembly.test.ts`
- model-only executor tests in `chatModelOnlyExecutor.test.ts`
- grounded executor tests in `chatGroundedExecutor.test.ts`
- response validator tests in `chatResponseValidator.test.ts`
- memory write-back tests in `chatMemoryWriteBack.test.ts`
- agent-task widget adapter tests in `chatAgentTaskWidgetAdapter.test.ts`
- existing participant-loop regression coverage in `agenticLoop.test.ts`
- broader behavior regression coverage in `chatService.test.ts`
- chat data/compliance regressions in `chatGateCompliance.test.ts`,
  `chatWorkspaceSwitch.test.ts`, and `chatIndexingUI.test.ts`

### What remains next

The next high-value cut remains `ChatDataService` narrowing: split additional
widget-facing adapter surfaces from chat orchestration so `E1` can retire more
service-bundle width without changing runtime behavior.

---

## Explicit Tasks Against The Current Architecture

The backlog above is the architectural shape. The work below maps that shape to
the actual Parallx files and function clusters that currently carry too much
responsibility.

### 1. `src/built-in/chat/participants/defaultParticipant.ts`

This file is still the main orchestration hotspot. Milestone 26 should treat it
as a composition root, not the place where routing, planning, execution,
validation, and memory persistence are decided inline.

Explicit tasks:

- extract a `TurnRouter` from the current turn-classification helpers such as
   conversational-turn checks, explicit-memory-recall checks, and off-topic
   checks;
- move direct-answer helpers for off-topic redirects, product-semantics answers,
   and memory-recall answers behind deterministic executors rather than leaving
   them as ad hoc branches in the participant body;
- extract a `ContextPlanner` that decides when to use retrieval, memory recall,
   current-page context, prompt overlays, or no external context at all;
- move evidence sufficiency checks, retrieve-again query generation, and
   response-repair helpers into a narrow validator layer so the primary execution
   path stops mixing generation with repair;
- move tool-call extraction and narration stripping into the grounded/tool
   execution path so the participant body no longer performs late cleanup on
   mixed model output;
- reduce `createDefaultParticipant(...)` to wiring, executor selection, and
   stream emission rather than full inline orchestration.

Deliverable for this file:

- `defaultParticipant.ts` becomes materially smaller and mostly delegates to
   router, planner, executor, validator, and write-back modules.

### 2. `src/built-in/chat/data/chatDataService.ts`

`ChatDataService` currently behaves like both an adapter bundle and an
orchestration surface. Milestone 26 should narrow it into explicit dependency
facets instead of letting the chat runtime depend on one oversized service.

Explicit tasks:

- split retrieval-facing methods such as context retrieval and citation-source
   shaping into a dedicated retrieval adapter contract;
- split memory-facing methods such as recall, session-summary persistence,
   concept persistence, preference extraction, and prompt-preference formatting
   into a memory adapter contract;
- split prompt-related methods such as prompt overlay resolution, system-prompt
   assembly inputs, and workspace-digest access into a prompt-context adapter
   contract;
- split page/file/workspace reads into a workspace-context adapter contract so
   execution stages ask for specific context rather than a catch-all service;
- stop using `ChatDataService` as the place where orchestration policy is
   hidden; route and context decisions should live in runtime modules, not in the
   adapter layer;
- preserve existing retrieval, memory, and file behavior unless a narrower
   contract requires a behavior fix.

Deliverable for this file:

- chat runtime modules depend on smaller interfaces for retrieval, memory,
   prompt context, and workspace context rather than the full
   `ChatDataService` surface.

### 3. `src/services/agentSessionService.ts`

This service already has better state-transition boundaries than the main chat
path. Milestone 26 should align delegated-task handoff with these existing
contracts rather than recreating agent-task logic in the participant runtime.

Explicit tasks:

- make delegated-task creation an explicit runtime route that hands off through
   task/session APIs instead of appearing as a hidden branch of normal answer
   generation;
- define a task-handoff payload that includes route type, originating turn,
   approval requirement, plan seed, handoff reason, and runtime metadata needed
   for traceability;
- define what transcript/history subset is forwarded into delegated-task
   execution so task runs do not inherit unbounded or poorly shaped chat history;
- align approval-blocked flows with existing approval queue and resolution
   methods so approval state is inspectable without reading assistant prose;
- ensure continue, redirect, stop-after-step, and approval-resolution flows are
   surfaced as runtime state transitions that the chat UI can explain directly;
- define what task status, blocker reason, plan-step state, and artifact summary
   the chat surface must read back after handoff.

Deliverable for this file:

- delegated-task work becomes a clean runtime transition into the task system,
   with approval and paused states explained from service state rather than model
   narration.

### 4. `src/services/agentExecutionService.ts`

This service is the right place to model bounded step execution, pause/resume,
and artifact recording. Milestone 26 should reuse that structure when the chat
runtime hands off autonomous work.

Explicit tasks:

- align delegated-task execution with the existing runnable-step selection,
   step-boundary pause behavior, and artifact-recording lifecycle;
- require a stable run identifier and step identifier model so retries, resume,
   and approval-paused flows do not duplicate side effects silently;
- make pause-after-step and approval-paused boundaries visible in runtime trace
   data, not just in user-facing text;
- define which execution events the chat surface receives during task handoff,
   task progress, artifact creation, pause, resume, and completion;
- add tests for repeated resume or stop/continue flows so execution semantics
   stay deterministic even when wording changes.

Deliverable for this file:

- Parallx has an explicit execution-boundary contract for autonomous work rather
   than a loosely coupled handoff from chat text to task state.

### 5. Cross-Cutting Control-Plane Tasks

These tasks do not belong to one file, but they are required if the new module
boundaries are going to behave like a real runtime instead of a cleaned-up chat
loop.

Explicit tasks:

- introduce session-scoped run serialization so overlapping turns cannot corrupt
   chat history, memory write-back, or delegated-task state;
- define stable session identifiers, run identifiers, and step identifiers so
   pause, resume, retry, and follow-up behavior can be traced without ambiguity;
- define route-decision, context-plan, executor-selection, and approval-state
   trace objects that can be logged, tested, and shown in debug views;
- define explicit state-transition records for task handoff, step start,
   approval block, resume, completion, failure, and cancellation;
- define citation policy as data on the context plan so citation behavior is
   decided before response synthesis;
- define memory write-back as a post-response stage with its own failure policy,
   telemetry, and best-effort retry semantics;
- snapshot prompt assembly inputs so prompt behavior can be regression-tested
   without depending on exact final wording from the model;
- add architecture-level eval fixtures that detect regressions in route choice,
   context-source choice, delegated-task handoff, and approval/pause behavior.

### 6. Migration Matrix

The current runtime responsibilities should move as follows:

- turn heuristics in `defaultParticipant.ts` -> `TurnRouter`
- context-source selection in `defaultParticipant.ts` -> `ContextPlanner`
- direct product/off-topic/memory answers in `defaultParticipant.ts` ->
   deterministic executors
- grounded synthesis and tool handling in `defaultParticipant.ts` -> grounded
   executor
- evidence checks and answer repair in `defaultParticipant.ts` -> validator
   layer
- memory persistence triggered from the participant path -> memory write-back
   coordinator
- retrieval, memory, prompt, and workspace helper aggregation in
   `ChatDataService` -> smaller adapter contracts
- delegated-task branching in chat flow -> explicit handoff into
   `AgentSessionService`
- bounded autonomous execution semantics -> `AgentExecutionService`

This matrix is the practical definition of the milestone. If a change does not
move one of these responsibilities to a cleaner boundary, it is probably not
Milestone 26 work.

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