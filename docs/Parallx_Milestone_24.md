# Milestone 24 — Autonomous Workspace Agent

> **Authoritative Scope Notice**
>
> This document is the single source of truth for Milestone 24.
> All agent-autonomy, permissions, approval, task execution, working-memory,
> and UI-integration work for this milestone must conform to the architecture,
> constraints, and task boundaries defined here.
>
> Milestones 9–23 established the local-first chat system, retrieval pipeline,
> AI settings, unified configuration, workspace memory, retrieval diagnostics,
> and evidence-sufficient answering loop. This milestone does **not** treat
> autonomy as a vague prompt tweak. It defines the product and runtime layers
> required to turn Parallx into a **workspace-bounded autonomous agent** that
> can accept delegated goals, choose tools, act within user-controlled policy,
> persist progress, and remain inspectable and debuggable.

---

## Table of Contents

1. [Problem Statement](#problem-statement)
2. [Current State Audit](#current-state-audit)
3. [Vision](#vision)
4. [Scope](#scope)
5. [Guiding Principles](#guiding-principles)
6. [Non-Negotiable Safety Constraints](#non-negotiable-safety-constraints)
7. [Target Capabilities](#target-capabilities)
8. [Target Architecture](#target-architecture)
9. [Phase Plan](#phase-plan)
10. [Implementation Sequence](#implementation-sequence)
11. [Migration & Compatibility](#migration--compatibility)
12. [Evaluation Strategy](#evaluation-strategy)
13. [Task Tracker](#task-tracker)
14. [Verification Checklist](#verification-checklist)
15. [Risk Register](#risk-register)

---

## Problem Statement

Parallx now has a materially stronger retrieval and grounding stack, but the
current product still behaves primarily as a **chat assistant** rather than a
true autonomous workspace agent.

Today the system can:

- answer grounded questions with stronger evidence assembly,
- retrieve iteratively when evidence is thin,
- expose retrieval settings and diagnostics,
- run tools through the existing chat loop, and
- remain local-first through Ollama and workspace-scoped storage.

That is necessary, but it is **not sufficient for autonomy**.

The current limitations are structural:

1. **Delegation is still under-modeled**
   - the user can ask for work, but the runtime does not yet treat delegated
     work as a persistent task with explicit goal state, progress, blockers,
     and completion criteria.

2. **Permissions and approvals are too coarse for true autonomy**
   - the current tool loop can execute actions, but the product does not yet
     expose a strong, user-controlled policy layer that defines what the agent
     may do automatically, what requires confirmation, and what is forbidden.

3. **The workspace boundary is not yet a first-class agent contract**
   - Parallx is already workspace-oriented, but the next milestone requires the
     boundary to become an explicit invariant for every autonomous action,
     every tool invocation, and every path resolution.

4. **Task continuity is not yet a core runtime behavior**
   - the agent does not yet own a resumable task model that can survive across
     turns and sessions while remaining visible to the user.

5. **Working memory is not yet organized around execution**
   - existing memory and retrieval capabilities exist, but they are not yet
     integrated into a disciplined task-working-memory layer with clear user
     controls and inspection paths.

6. **Autonomous behavior is not yet inspectable enough**
   - users need to know what the agent planned, what it tried, why it stopped,
     why approval was requested, and what evidence or tool result drove a
     decision.

7. **The UI contract for autonomy is still too thin**
   - the current chat experience can display answers and tool output, but a
     true agent requires dedicated surfaces for delegation, approvals, task
     status, traces, blocked states, and resumption.

The result is a system that can be capable in one turn, but is still too
ephemeral, too opaque, and too weakly governed to behave like a reliable,
general-purpose autonomous agent.

Milestone 24 fixes that by redefining Parallx AI as:

> **a workspace-bounded autonomous agent with explicit user control**

rather than merely:

> **a chat assistant that sometimes calls tools**.

---

## Current State Audit

This audit is based on current runtime behavior after Milestone 23.

### What the current runtime already does well

1. **Grounded retrieval is materially stronger than before**
   - retrieval now supports query decomposition, evidence-role balancing,
     structured-document handling, and targeted late-interaction reranking.

2. **The chat loop can already execute tools**
   - the default participant can route through tool calls and integrate tool
     results back into the conversation loop.

3. **Evidence quality and diagnostics are now measurable**
   - retrieval traces, developer-facing diagnostics, and evaluation gates exist
     and provide a strong foundation for autonomy debugging.

4. **The system is already local-first**
   - chat uses Ollama, embeddings use Ollama, and the workspace remains the
     core unit of persistence and retrieval scope.

5. **Workspace-scoped state already exists in parts of the runtime**
   - the product already has workspace-bound data services, session handling,
     and storage patterns that can be extended rather than reinvented.

### What the current runtime still lacks

1. **No first-class agent task model**
   - there is no canonical runtime object for a delegated task with goal,
     plan, substeps, blockers, approvals, artifacts, and completion state.

2. **No policy engine for autonomous actions**
   - the runtime does not yet expose a stable service that can answer:
     - is this action allowed,
     - does it require approval,
     - is it denied,
     - why.

3. **No absolute workspace-boundary enforcement service**
   - path and tool safety currently rely too much on local checks and existing
     assumptions instead of a centralized, testable agent-boundary contract.

4. **No resumable execution loop**
   - there is no durable agent run that can pause, resume, continue after a
     user message, or recover from being blocked.

5. **No task-oriented working-memory layer**
   - memory exists, but not yet in the form required for agent execution:
     active objective memory, decision memory, blocker memory, and artifact
     memory tied to a specific delegated run.

6. **No dedicated approval or task-status UI**
   - the chat panel alone is not enough for a product that needs queued
     approvals, visible task state, and a readable action trace.

7. **No autonomy-focused evaluation harness**
   - current evaluation is strong for retrieval and answer quality, but it does
     not yet prove that the agent respects permissions, remains bounded to the
     workspace, recovers from tool failure, or produces stable task outcomes.

### Current-state conclusion

Parallx now has a strong evidence engine, but still lacks the orchestration,
policy, memory, and UI layers required for trustworthy autonomy.

That distinction is the reason this milestone exists.

---

## Vision

### Before M24

> Parallx can answer grounded questions and use tools, but autonomy is still
> conversational and ad hoc. The user must carry too much of the task state in
> their head, and the product does not yet expose a strong contract for what
> the AI may do automatically inside the workspace.

### After M24

> Parallx can accept delegated goals, break them into steps, choose tools,
> respect a user-owned permission envelope, remain strictly inside the active
> workspace, persist and resume task progress, and expose a readable trace of
> what happened and why.

### Product definition

Parallx AI becomes a **workspace operator**:

- bounded to the active workspace,
- capable of general delegated work,
- transparent about its decisions,
- stoppable and resumable,
- and always subordinate to user policy.

This milestone is inspired by the same product class as autonomous coding or
workspace agents, but it is **not** trying to copy a cloud-first or machine-
wide agent model. Parallx's defining constraint is that the agent operates
inside the workspace and nowhere else unless the user explicitly expands that
workspace.

---

## Scope

### In scope

- a general-purpose delegated task model for workspace work;
- explicit permissions and approval flows for autonomous actions;
- centralized workspace-boundary enforcement for path-bearing agent actions;
- resumable autonomous runs with visible status and blocker handling;
- task-oriented working memory tied to delegated execution;
- readable user-facing and developer-facing trace surfaces;
- autonomy-specific unit, integration, e2e, and evaluation coverage.

### Out of scope

- unrestricted machine-wide autonomy;
- access outside active workspace roots;
- hidden background agents that continue acting without a visible task run;
- internet or cloud-browsing autonomy outside supported local-first product constraints;
- multi-agent orchestration;
- automatic model-routing as a primary milestone theme;
- rewriting the full chat stack from scratch.

### Product boundary for this milestone

Milestone 24 is about making one bounded workspace agent trustworthy and
controllable. It is not about maximizing autonomous reach at the expense of
clarity, locality, or debuggability.

---

## Guiding Principles

1. **Workspace-bounded by default**
   - the workspace is the hard operating boundary for autonomous behavior.

2. **User-controlled autonomy**
   - the user defines the envelope; the agent chooses tactics inside it.

3. **General-purpose delegation, not hardcoded demos**
   - the milestone must support many forms of delegated workspace work rather
     than one narrow pre-authored agent loop.

4. **Services over monoliths**
   - planning, policy, execution, memory, and tracing must remain separated so
     the codebase stays debuggable and testable.

5. **Explainability is a runtime feature, not just a debug feature**
   - users must be able to inspect actions, blockers, approvals, and key
     decision points.

6. **Approval friction should be minimal but meaningful**
   - the product should bundle and classify approvals rather than interrupting
     the user for every small step.

7. **Safe degradation matters**
   - when the agent is blocked by policy, evidence, or tool failure, it must
     stop cleanly, explain why, and offer the next best action.

8. **Evaluation drives rollout**
   - autonomy must be held to milestone-owned tests for safety, control,
     boundedness, and task completion quality.

---

## Non-Negotiable Safety Constraints

These are hard product constraints for the milestone.

### 1. The workspace boundary is absolute

The agent may only read, search, modify, create, delete, or execute against
content that resolves inside the active workspace roots.

This includes:

- file reads,
- file writes,
- edits,
- deletes,
- search targets,
- command execution working directories,
- tool parameters that reference paths,
- memory or artifact persistence tied to the task.

If the user wants broader access, they expand the workspace.

### 2. No invisible privilege escalation

The agent may not silently access:

- parent directories above a workspace root,
- sibling folders not mounted into the workspace,
- arbitrary system paths,
- external network destinations beyond supported local-first constraints,
- or undeclared tools outside the active tool registry.

### 3. Permissions are product-visible

The user must be able to understand:

- what actions are auto-approved,
- what actions require approval,
- what actions are denied,
- and why a given action was classified that way.

### 4. Every agent action must be attributable

There must be a readable trace for:

- planned step,
- selected tool,
- approval outcome,
- execution result,
- failure or blocker reason,
- and task state transition.

### 5. Stopping the agent must always work

The user must be able to cancel or pause an active agent run without the system
continuing hidden background work.

---

## Target Capabilities

Milestone 24 is complete when Parallx supports the following capabilities.

### A. Delegated goal execution

The user can provide a goal such as:

- review this workspace and propose a cleanup plan,
- update the docs for the feature I just changed,
- find all config drift and patch the safe cases,
- inspect the workspace and prepare a migration checklist.

The agent should convert that into a managed task rather than a loose series of
chat turns.

### B. Policy-driven tool choice

The agent can decide which tools to use, but only from the set allowed by the
workspace, the user’s policy, and the current mode.

### C. Approval-aware execution

The system can:

- auto-approve safe actions,
- request approval for guarded actions,
- deny forbidden actions,
- bundle related approvals,
- and continue cleanly after approval is granted.

### D. Resumable task runs

Tasks can:

- start,
- progress through steps,
- become blocked,
- pause,
- resume,
- and complete with artifacts and a summary.

### E. Task-oriented working memory

The agent can maintain:

- current goal memory,
- plan memory,
- blocker memory,
- decision memory,
- artifact memory,
- and user preference memory,

without silently expanding beyond visible and editable state.

### F. Readable action trace

The user can inspect:

- what the agent planned,
- what it executed,
- what it changed,
- what it deferred,
- and why.

### G. Workspace operating behaviors

Within policy limits, the agent can:

- navigate and inspect the workspace,
- create or edit workspace content,
- synthesize docs or plans,
- chain tools toward a delegated outcome,
- and proactively surface blockers or next steps.

---

## Target Architecture

Milestone 24 should not centralize autonomy in one monolithic file or service.
The target architecture is service-based.

### 1. `IAgentSessionService`

Owns:

- active agent runs,
- task lifecycle,
- pause/resume/cancel,
- task status,
- current step,
- completion / blocked state.

### 2. `IAgentPlanningService`

Owns:

- initial plan generation,
- next-step generation,
- plan revision,
- completion criteria normalization,
- and step decomposition.

### 3. `IAgentPolicyService`

Owns:

- workspace-boundary enforcement,
- action classification,
- permission lookup,
- approval requirement decisions,
- denials and explanations,
- and policy inheritance / override rules.

### 4. `IAgentExecutionService`

Owns:

- tool selection execution,
- orchestration of step execution,
- retry rules,
- failure classification,
- and action-result normalization.

### 5. `IAgentMemoryService`

Owns:

- task-scoped working memory,
- decision log compaction,
- artifact references,
- and selective persistence across sessions.

### 6. `IAgentTraceService`

Owns:

- action trace entries,
- approval history,
- plan revisions,
- state-transition history,
- and debugging summaries.

### 7. `IAgentUIBridgeService`

Owns:

- chat integration for task status,
- approval prompts,
- task summaries,
- trace presentation adapters,
- and future task-pane integration.

### Core runtime data models

The milestone should introduce explicit structured models rather than passing
agent state around as prompt text or untyped blobs.

#### `AgentTaskRecord`

Minimum fields:

- `id`
- `workspaceId`
- `mode`
- `goal`
- `constraints`
- `autonomyLevel`
- `status`
- `createdAt`
- `updatedAt`
- `completionCriteria`
- `artifactRefs`

#### `AgentPlanStep`

Minimum fields:

- `id`
- `taskId`
- `title`
- `description`
- `status`
- `kind`
- `proposedAction`
- `approvalState`
- `dependsOn`

#### `AgentApprovalRequest`

Minimum fields:

- `id`
- `taskId`
- `stepId`
- `actionClass`
- `toolName`
- `summary`
- `scope`
- `reason`
- `status`
- `createdAt`
- `resolvedAt`

#### `AgentTraceEntry`

Minimum fields:

- `id`
- `taskId`
- `stepId?`
- `type`
- `summary`
- `detail`
- `toolName?`
- `approvalRequestId?`
- `stateBefore?`
- `stateAfter?`
- `timestamp`

#### `AgentBoundaryDecision`

Minimum fields:

- `allowed`
- `reason`
- `normalizedPath?`
- `workspaceRoot?`
- `violationType?`

### Code-organization constraints

The autonomy stack must remain maintainable under active debugging. To enforce
that, the implementation should follow these rules:

1. Do not create a single catch-all agent service that owns planning, policy,
   execution, memory, and UI.
2. Keep persistence models, service logic, and UI adapters in separate files.
3. Prefer wrappers around the current tool and chat runtime rather than large
   rewrites of proven subsystems.
4. Boundary enforcement and policy classification must be reusable services,
   not embedded ad hoc in each tool callsite.
5. Trace payload schemas must be explicit TypeScript types, not inferred from
   arbitrary object literals.
6. Each phase should add focused tests alongside its service boundary rather
   than relying on later end-to-end coverage to prove correctness.

### Architectural rules

1. Planning must not perform tool execution directly.
2. Policy must not be embedded inside tool handlers.
3. UI must not implement policy logic itself.
4. Memory must store structured state, not opaque prompt blobs.
5. Boundary enforcement must live in a shared service, not scattered local
   checks.
6. Approval state must be durable and resumable, not tied only to transient
   widget state.
7. Existing chat flows must remain callable without forcing every interaction
   into the autonomous task runtime.

### Target runtime shape

```text
User goal
    ↓
AgentSessionService creates run
    ↓
AgentPlanningService creates plan + first step
    ↓
AgentPolicyService classifies proposed action
    ↓
    ├─ denied → blocked with explanation
    ├─ needs approval → approval queue / user decision
    └─ allowed → execute
    ↓
AgentExecutionService runs tool(s)
    ↓
AgentMemoryService stores step result / decisions / artifacts
    ↓
AgentTraceService records plan/action/state transition
    ↓
AgentSessionService advances, blocks, pauses, or completes
```

---

## Phase Plan

### Phase A — Interaction Contract & Delegation Model

Goal: define what it means for the user to delegate work to the agent.

### A.1 Define agent interaction modes

Support explicit autonomy-oriented modes such as:

- advisor,
- researcher,
- executor,
- reviewer,
- operator.

These are behavior contracts, not just prompt labels.

### A.2 Define delegated task input model

The product should normalize user intent into:

- goal,
- constraints,
- desired autonomy level,
- completion criteria,
- and allowed scope.

### A.3 Define task lifecycle states

Minimum states:

- pending,
- planning,
- awaiting-approval,
- running,
- blocked,
- paused,
- completed,
- failed,
- cancelled.

---

### Phase B — Workspace Boundary & Policy Foundation

Goal: make workspace-bounded autonomy a hard runtime invariant.

### B.1 Create workspace-boundary enforcement service

All path-bearing tool actions must resolve through a central boundary checker.

### B.2 Create action classification model

Actions should be categorized by type, such as:

- read,
- search,
- write,
- edit,
- delete,
- command execution,
- task-state mutation,
- approval-sensitive operation.

### B.3 Create policy lookup model

Support policy decisions by:

- tool,
- action class,
- workspace,
- and interaction mode.

---

### Phase C — Permissions & Approval System

Goal: make user control explicit and inspectable.

### C.1 Implement approval policy model

Each action should resolve to:

- allow,
- allow-with-notification,
- require-approval,
- deny.

### C.2 Add approval queue and resumption flow

The agent should pause cleanly on pending approval and resume from that point
without restarting the whole task.

### C.3 Bundle related approvals

Avoid approval spam by grouping actions where safe and legible.

### Approval policy matrix

The approval system should start with a narrow, explicit matrix rather than an
open-ended policy language.

| Action category | Example | Default policy | Notes |
|---|---|---|---|
| Workspace read | read file, list directory, search text | allow | must still pass workspace-boundary checks |
| Workspace search / analysis | semantic search, code usage lookup, retrieval | allow | no silent expansion outside mounted roots |
| Draft-only synthesis | propose plan, summarize findings, prepare patch text | allow | no side effects |
| Workspace write | create file, edit file, apply patch | require-approval | may later support trusted-mode overrides |
| Destructive workspace mutation | delete file, overwrite large content set | require-approval | should display affected targets clearly |
| Shell / command execution | run terminal command, create task, background process | require-approval | command preview required |
| Boundary-violating action | read/write outside workspace roots | deny | not overridable from task prompt alone |
| Unsupported / unregistered tool use | undeclared tool category | deny | must be surfaced as blocked state |

This matrix should be implemented as product data, not buried inside prompt
text, so the user can inspect and change policy behavior intentionally.

### Approval UX contract

Approval requests should be legible and low-friction.

Minimum approval card contents:

- action summary in user language;
- affected files or workspace targets;
- action class and selected tool;
- why the agent wants to do it now;
- policy reason for approval requirement;
- approval scope options.

Minimum approval actions:

- approve once;
- approve for this task;
- deny;
- cancel task.

The first implementation should avoid broad permanent policy editing inside the
approval card itself. That belongs in a dedicated policy/settings surface.

---

### Phase D — Agent Task Runtime

Goal: turn delegated work into a resumable execution model.

### D.1 Add task/run persistence model

Represent:

- task metadata,
- plan steps,
- current state,
- execution cursor,
- blocker reason,
- artifact references.

### D.2 Add run orchestration loop

The agent should:

- pick the next step,
- classify the action,
- request approval if needed,
- execute,
- inspect result,
- advance or block.

### D.3 Add resume / continue semantics

The product should support:

- continue this task,
- resume the blocked task,
- stop after this step,
- and redirect the task with a new constraint.

---

### Phase E — Working Memory for Agent Runs

Goal: support continuity without opaque behavior.

### E.1 Add task-scoped working memory

Store structured runtime facts such as:

- accepted goal,
- current assumptions,
- chosen plan,
- key evidence references,
- failed attempts,
- created artifacts.

### E.2 Add user preference integration

The agent should honor durable preferences such as:

- verbosity,
- approval strictness,
- preferred execution style,
- desired amount of proactivity.

### E.3 Add memory inspection and correction hooks

Users must be able to inspect and correct important stored assumptions.

---

### Phase F — Action Trace, Explainability, and Debug Surfaces

Goal: make autonomy inspectable by both users and developers.

### F.1 Add readable action trace entries

Each step should record:

- plan intent,
- selected tool,
- approval result,
- output summary,
- state transition.

### F.2 Add blocked-state explanations

Blocked reasons should be normalized, such as:

- outside-workspace request,
- policy denial,
- approval pending,
- insufficient evidence,
- tool failure,
- conflicting instruction.

### F.3 Add developer diagnostics for autonomous runs

Trace data should support reproducible debugging and future eval harnesses.

---

### Phase G — UI Surfaces for Autonomy

Goal: expose autonomy in a usable product shape.

### G.1 Add task-status rendering in chat

The chat UI should show task progress rather than only plain assistant text.

### G.2 Add approval UI primitives

The user should be able to approve, deny, or modify pending actions.

### G.3 Add task summary / artifact summary UI

Completed runs should surface:

- what changed,
- what was created,
- what remains blocked,
- and recommended next steps.

### G.4 Plan a dedicated task/trace panel

If the full UI does not ship in this milestone, the architecture and minimal
bridge should still be built so the dedicated panel can land cleanly next.

---

### Phase H — Evaluation, Safety Gates, and Rollout

Goal: prove the autonomous agent is controlled, bounded, and useful.

### H.1 Add workspace-boundary evals

Verify the agent refuses out-of-workspace file paths and command scopes.

### H.2 Add approval-flow evals

Verify the agent pauses for approval, resumes correctly, and never executes a
denied action.

### H.3 Add delegated-task completion evals

Verify the agent can complete representative delegated workspace tasks while
remaining inside policy.

### H.4 Add rollout gates

Autonomy should not broaden by default until:

- boundary tests pass,
- approval tests pass,
- trace completeness is verified,
- and completion quality meets milestone-owned thresholds.

---

## Implementation Sequence

The implementation order matters. Build the control layers before increasing
the visible autonomy level.

### Sequence 1 — Define the contract

- implement Phase A first;
- finalize the delegated task model before adding runtime loops.

### Sequence 2 — Enforce the workspace boundary

- implement Phase B before any higher-autonomy execution behavior ships.

### Sequence 3 — Add approval and policy control

- implement Phase C before expanding autonomous tool choice.

### Sequence 4 — Add the runtime task loop

- implement Phase D only after policy and boundary checks are authoritative.

### Sequence 5 — Add memory and traceability

- implement Phases E and F before broadening product-facing autonomy.

### Sequence 6 — Add UI and evaluation

- implement Phases G and H before enabling broader default exposure.

### Ordering constraints

1. Do **not** ship resumable autonomous runs before boundary enforcement exists.
2. Do **not** ship approval UI without policy-backed classification.
3. Do **not** store opaque memory blobs that users cannot inspect or correct.
4. Do **not** broaden autonomous defaults before the eval harness exists.

---

## Implementation Breakdown

This section translates the milestone into likely code slices so the work can
be executed without creating an unplanned agent monolith.

### Phase A implementation slice

Primary outputs:

- delegated task types;
- interaction mode definitions;
- task lifecycle enum / transition helpers.

Likely file targets:

- `src/agent/agentTypes.ts`
- `src/agent/agentTaskModels.ts`
- `src/agent/agentLifecycle.ts`
- `src/aiSettings/` additions only if interaction mode becomes user-configurable

Primary tests:

- `tests/unit/agentLifecycle.test.ts`
- `tests/unit/agentTaskModels.test.ts`

### Phase B implementation slice

Primary outputs:

- centralized boundary checker;
- action classification types;
- policy resolution interface.

Likely file targets:

- `src/services/agentBoundaryService.ts`
- `src/services/agentPolicyService.ts`
- `src/services/serviceTypes.ts`
- `src/tools/` wrappers for path-bearing actions where needed

Primary tests:

- `tests/unit/agentBoundaryService.test.ts`
- `tests/unit/agentPolicyService.test.ts`

### Phase C implementation slice

Primary outputs:

- approval request persistence;
- approval queue service;
- approval state transitions;
- approval-to-resume bridge.

Likely file targets:

- `src/services/agentApprovalService.ts`
- `src/services/agentTaskStore.ts`
- `src/services/serviceTypes.ts`
- `src/built-in/chat/` task message rendering hooks

Primary tests:

- `tests/unit/agentApprovalService.test.ts`
- `tests/unit/agentTaskStore.test.ts`
- one focused integration test for pause-on-approval behavior

### Phase D implementation slice

Primary outputs:

- task-run persistence;
- orchestration loop;
- resume / continue / cancel semantics.

Likely file targets:

- `src/services/agentSessionService.ts`
- `src/services/agentExecutionService.ts`
- `src/services/agentPlanningService.ts`
- `src/services/agentTaskStore.ts`

Primary tests:

- `tests/unit/agentSessionService.test.ts`
- `tests/unit/agentExecutionService.test.ts`
- `tests/integration/agentRuntime.integration.test.ts`

### Phase E implementation slice

Primary outputs:

- task-scoped working-memory records;
- memory compaction rules;
- inspect/correct APIs.

Likely file targets:

- `src/services/agentMemoryService.ts`
- `src/services/agentTaskStore.ts`
- `src/built-in/chat/data/` task-debug snapshot additions if needed

Primary tests:

- `tests/unit/agentMemoryService.test.ts`
- `tests/integration/agentMemoryCorrection.integration.test.ts`

### Phase F implementation slice

Primary outputs:

- trace entry schema;
- blocked-state taxonomy;
- developer debug adapters.

Likely file targets:

- `src/services/agentTraceService.ts`
- `src/services/agentBlockReason.ts`
- `src/built-in/chat/data/chatDataService.ts`

Primary tests:

- `tests/unit/agentTraceService.test.ts`
- `tests/unit/agentBlockReason.test.ts`

### Phase G implementation slice

Primary outputs:

- task status rendering in chat;
- approval cards;
- completion and artifact summaries;
- first task/trace panel bridge.

Likely file targets:

- `src/built-in/chat/` task rendering components
- `src/parts/` or `src/views/` for task/trace panel bridge
- `src/ui/` approval primitives only if existing UI primitives are insufficient

Primary tests:

- `tests/e2e/` delegated-task lifecycle coverage
- `tests/e2e/` approval queue rendering / resume flow coverage

### Phase H implementation slice

Primary outputs:

- autonomy eval fixtures;
- policy and boundary evaluation scenarios;
- rollout gate for autonomous defaults.

Likely file targets:

- `tests/ai-eval/agent-runtime.spec.ts`
- `tests/ai-eval/scoring.ts`
- `playwright.ai-eval.config.ts`

Primary tests:

- milestone-specific eval runs for representative delegated tasks;
- negative tests proving deny/approval/cancel behavior.

### File-organization rule for the implementation

If a new phase appears to require a large file, split by responsibility before
the file becomes the default place to add more behavior. The intended shape is
many small services with explicit contracts, not a central `agentService.ts`
that silently absorbs planning, policy, execution, trace, and UI concerns.

---

## Migration & Compatibility

Milestone 24 should preserve existing chat functionality while introducing a
new autonomy layer.

### Compatibility expectations

1. Existing ask/edit/agent behaviors must continue to work during migration.
2. New agent task flows should layer on top of current chat participation
   rather than replacing the whole chat stack in one step.
3. Existing tool contracts should remain stable where possible.
4. Approval and policy integration should wrap current tool execution rather
   than rewriting every tool at once.

### Migration principle

Wrap and classify existing capabilities before inventing new ones.

---

## Evaluation Strategy

Milestone 24 needs a dedicated autonomy evaluation surface, not just retrieval
benchmarks.

### Required evaluation categories

1. **Workspace boundary compliance**
   - agent refuses to operate on paths outside workspace roots.

2. **Approval correctness**
   - agent never executes an action classified as denied;
   - agent pauses on approval-required actions;
   - agent resumes correctly after approval.

3. **Task lifecycle correctness**
   - tasks move through valid states only;
   - pause/resume/cancel transitions are reliable.

4. **Trace completeness**
   - each meaningful action produces a readable trace entry.

5. **Working-memory quality**
   - task memory supports continuity without hallucinated state leakage.

6. **Delegated-task completion quality**
   - representative workspace tasks complete with correct artifacts,
     summaries, and policy handling.

### Test split

- unit tests for policy, classification, memory, and task-state transitions;
- integration tests for task execution and approval flows;
- e2e tests for chat/UI interactions and resumable runs;
- eval scenarios for representative delegated workspace tasks.

### Representative eval scenarios

The eval harness for this milestone should include tasks such as:

- inspect the workspace and produce a cleanup plan without making edits;
- apply documentation-only fixes automatically while asking before code edits;
- refuse an edit request that targets a file path outside the workspace;
- pause on a guarded write action and resume correctly after approval;
- stop cleanly with a blocked-state explanation when the requested action is
   denied by policy;
- resume a partially completed delegated task after a session restart.

### Minimum negative-test coverage

The milestone should not be considered complete without explicit tests for:

- outside-workspace path attempts,
- denied-action non-execution,
- approval timeout or dismissal behavior,
- cancellation during an active autonomous run,
- stale resumed-task recovery,
- and trace completeness after failure.

---

## Task Tracker

### Phase A — Interaction Contract
- [x] A1. Define agent interaction modes and behavior contracts
- [x] A2. Define delegated task input model
- [x] A3. Define task lifecycle states and transitions

### Phase B — Workspace Boundary & Policy Foundation
- [x] B1. Add centralized workspace-boundary enforcement service (implemented through the existing `IWorkspaceBoundaryService`, now consumed by the agent policy layer)
- [x] B2. Add action classification model for agent operations
- [x] B3. Add policy lookup and resolution model

### Phase C — Permissions & Approval System
- [x] C1. Implement approval policy states and persistence
- [x] C2. Add approval queue and resumption flow
- [ ] C3. Add approval bundling and explanation model

### Phase D — Agent Task Runtime
- [ ] D1. Add task/run persistence model
- [ ] D2. Add orchestration loop for delegated execution
- [ ] D3. Add pause/resume/continue semantics

### Phase E — Working Memory
- [ ] E1. Add task-scoped working-memory model
- [ ] E2. Integrate user preferences into execution behavior
- [ ] E3. Add memory inspection and correction hooks

### Phase F — Traceability & Debugging
- [ ] F1. Add readable action-trace model
- [ ] F2. Add normalized blocked-state reasons
- [ ] F3. Add developer diagnostics for autonomous runs

### Phase G — UI Surfaces
- [ ] G1. Add task-status rendering in chat
- [ ] G2. Add approval UI primitives
- [ ] G3. Add task completion / artifact summary UI
- [ ] G4. Add task/trace panel bridge or first slice

### Phase H — Evaluation & Rollout
- [ ] H1. Add workspace-boundary evaluation coverage
- [ ] H2. Add approval correctness evaluation coverage
- [ ] H3. Add delegated-task completion evaluation scenarios
- [ ] H4. Add rollout gate for autonomous defaults

---

## Verification Checklist

- [ ] Agent can accept a delegated workspace goal as a structured task
- [ ] Workspace boundary is enforced for every path-bearing action
- [ ] Agent cannot access content outside workspace roots
- [ ] Policy service explains allow / approval / deny decisions
- [ ] Approval-required actions pause execution instead of continuing
- [ ] Denied actions never execute
- [ ] Tasks can pause, resume, cancel, and complete reliably
- [ ] Working memory supports continuity without hidden opaque state
- [ ] Users can inspect what the agent did and why
- [ ] Blocked states are explicit and actionable
- [ ] Existing chat functionality remains compatible during migration
- [ ] Local-first defaults remain intact
- [ ] `tsc --noEmit` clean after each implementation slice
- [ ] Relevant unit/e2e/eval suites pass after each implementation slice

---

## Risk Register

### Risk 1 — Agent autonomy becomes a monolith
**Mitigation**
- separate planning, policy, execution, memory, trace, and UI services;
- reject designs that centralize all behavior in one runtime file.

### Risk 2 — Boundary checks are inconsistent across tools
**Mitigation**
- enforce workspace checks through one shared boundary service;
- add path-boundary tests for all path-bearing tool categories.

### Risk 3 — Approval UX becomes too noisy
**Mitigation**
- classify actions carefully;
- support approval bundling;
- differentiate notification-only from true approval-required actions.

### Risk 4 — Memory becomes opaque and hard to debug
**Mitigation**
- store structured memory state;
- make important task memory inspectable and correctable.

### Risk 5 — The agent becomes proactive in unpredictable ways
**Mitigation**
- define explicit interaction modes and autonomy levels;
- keep proactive behavior inside policy and mode constraints.

### Risk 6 — Existing chat behavior regresses during migration
**Mitigation**
- layer agent services alongside the current participant runtime;
- use compatibility-preserving wrappers during rollout.

### Risk 7 — Evaluation lags behind implementation
**Mitigation**
- add autonomy-specific evals as part of the milestone rather than after it.

### Risk 8 — The agent feels autonomous but not trustworthy
**Mitigation**
- prioritize control, traceability, and boundary compliance ahead of broader
  proactive behavior.
