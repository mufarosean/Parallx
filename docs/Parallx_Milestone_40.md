# Milestone 40 — VS Code Chat Parity Alignment

> Scope note
>
> Milestone 40 is a planning and accountability milestone for aligning Parallx's
> chat architecture more closely with VS Code's chat system. The immediate goal
> is not to ship a fully rewritten router in one pass. The goal is to document
> how VS Code actually works, identify where Parallx diverges, define a parity
> target, and attach measurable regression gates so future implementation work
> can be judged against sourced evidence instead of intuition.

---

## Table of Contents

1. Problem Statement
2. Why This Milestone Exists
3. Research Summary
4. Current Parallx Gaps
5. Current-to-VS Code Mapping
6. AI Surface Inventory
7. Unification Risks
8. Redesign Charter
9. Migration Matrix
10. Rebuild Decision
11. VS Code Parity Target
12. Milestone 40 Deliverables
13. Accountability Framework
14. Targeted Playwright Gates
15. Execution Plan
16. Evidence Ledger
17. Success Criteria
18. Non-Goals

---

## 1. Problem Statement

Parallx currently relies on a front-door semantic router that classifies user
turns into buckets such as `conversational`, `grounded`, `memory-recall`, and
`product-semantics` before the main evidence and answer pipeline runs.

That design is fast, but it is too brittle.

Two concrete failures exposed the problem:

1. A casual greeting like `Hi hows it going?` was routed as a grounded turn,
   causing workspace sources to be surfaced for a social reply.
2. A natural RF Guides request with slight phrasing noise failed to reliably
   take the exhaustive coverage path, even though the model itself clearly
   understood the user's intent.

This is the wrong failure shape for a user-facing assistant. Users should not
need to phrase requests in router-friendly language for the product to behave
correctly.

---

## 2. Why This Milestone Exists

Milestone 40 exists to prevent architectural drift.

Parallx is intentionally built on workbench patterns derived from VS Code. When
Parallx invents ad hoc chat-routing logic instead of following the proven VS
Code structure, the result is predictable:

- prompt-fragile behavior
- hard-to-debug routing failures
- weak accountability for "what the system should have done"
- regressions that only appear in real user phrasing

This milestone creates a written contract so future implementation work can be
compared against:

- sourced evidence from the VS Code repository
- sourced evidence from DeepWiki's VS Code architecture pages
- a concrete Parallx parity target
- targeted Playwright tests that must stay green

---

## 3. Research Summary

### 3.1 What VS Code actually does

VS Code does not appear to use a monolithic semantic router like Parallx's
current `determineChatTurnRoute()` model.

Instead, its chat stack is split into narrower stages:

1. **Explicit request parsing** via `ChatRequestParser`
   - Parses structured syntax such as `@agent`, `/slashCommand`, tools, and
     references into typed request parts.
   - This is deterministic parsing, not broad semantic intent inference.

2. **Agent selection / default handling** in `ChatService`
   - `sendRequest()` parses the request and resolves the default agent for the
     current location and mode.

3. **Optional participant detection**
   - If the request did not explicitly specify an agent or command, VS Code can
     invoke `ChatAgentService.detectAgentOrCommand(...)`.
   - This delegates to a registered `IChatParticipantDetectionProvider`.
   - This is model-assisted routing, but only for a narrow question:
     "Which participant or command should handle this request?"

4. **Agent invocation**
   - Once the participant is known, `invokeAgent(...)` runs the chosen handler.

This matters because VS Code avoids loading one brittle classifier with too much
responsibility. It separates:

- syntax parsing
- participant selection
- execution behavior

That is materially more stable than asking one heuristic router to infer the
entire downstream workflow contract from a raw sentence.

### 3.2 DeepWiki summary used for this milestone

The DeepWiki pages that were most useful were:

- `AI and Chat Features`
- `Chat System`

Key takeaways:

- `IChatService` is the central orchestration layer.
- `IChatAgentService` owns agent registration and invocation.
- `ChatRequestParser` provides structured request decomposition.
- `chat.detectParticipant.enabled` controls participant auto-detection.
- Ask/Edit/Agent are explicit modes, not latent semantic guesses.

### 3.3 OpenClaw comparison

OpenClaw's routing is not the same as Parallx's current chat router either.
What is visible in its repo is mostly:

- session routing
- bound agent routing
- channel routing
- tool-policy routing

That is closer to infrastructure routing than user-intent workflow routing.

The main takeaway is negative but useful: neither VS Code nor OpenClaw appears
to rely on the kind of single lexical intent router that is currently causing
fragility in Parallx.

---

## 4. Current Parallx Gaps

Parallx currently diverges from VS Code in four meaningful ways.

### 4.1 One classifier decides too much

`src/built-in/chat/utilities/chatTurnRouter.ts` currently decides:

- social vs grounded
- exhaustive vs representative
- workflow type
- some direct-answer behaviors

That is too much responsibility for a front-door heuristic pass.

### 4.2 Parsing and routing are conflated

VS Code explicitly parses request structure first.

Parallx currently mixes:

- mention heuristics
- scope inference
- workflow inference
- coverage inference

without a strong typed parse layer separating durable syntax from semantic
guesswork.

### 4.3 There is no bounded semantic fallback

VS Code allows model-assisted participant detection in a constrained role.

Parallx currently has no equivalent fallback for low-confidence turns. When the
heuristics miss, the pipeline simply takes the wrong path.

### 4.4 There is no parity ledger

Today, it is too easy to claim Parallx is "aligned with VS Code" without being
able to show:

- which VS Code behavior is being mirrored
- where Parallx intentionally deviates
- which tests prove the alignment still holds

Milestone 40 fixes that process gap.

---

## 5. Current-to-VS Code Mapping

Parallx does not need to invent an entirely new chat stack. The more pragmatic
path is to remap what already exists into cleaner VS Code-like layers.

### 5.1 Service-layer mapping

| VS Code concept | Parallx analogue today | Assessment |
|-----------------|------------------------|------------|
| `IChatService` / `ChatService` | `src/services/chatService.ts` | Good structural analogue already exists |
| `IChatAgentService` / `ChatAgentService` | `src/services/chatAgentService.ts` | Good registry/dispatch analogue exists, but lacks bounded participant detection |
| `IChatModeService` / `ChatModeService` | `src/services/chatModeService.ts` | Good basic analogue exists |
| `ChatWidget` / `ChatInputPart` | `src/built-in/chat/widgets/chatWidget.ts`, `src/built-in/chat/input/chatInputPart.ts` | Good UI-layer analogue exists |
| `ChatRequestParser` | `src/built-in/chat/input/chatRequestParser.ts` | Exists, but is not yet the dominant request-entry abstraction for routing |

### 5.2 Where Parallx is structurally ahead

Parallx already has useful lower layers that VS Code itself does not expose in
the same way:

- `chatContextPlanner.ts`
- `chatContextAssembly.ts`
- `chatEvidenceGatherer.ts`
- `chatExecutionPlanner.ts`
- `chatTurnSynthesis.ts`

These are valuable and should be preserved. The problem is not that they exist.
The problem is that too much decision-making happens before they get a chance to
correct or refine the turn.

### 5.3 Where Parallx is structurally off-pattern

The main divergence is the concentration of responsibility in these files:

- `src/built-in/chat/utilities/chatTurnRouter.ts`
- `src/built-in/chat/utilities/chatTurnPrelude.ts`
- `src/built-in/chat/participants/defaultParticipant.ts`

Current shape:

1. `defaultParticipant.ts` acts as a very large orchestration hub.
2. `chatTurnRouter.ts` decides broad intent and workflow too early.
3. `chatTurnPrelude.ts` binds route, context plan, and scope resolution tightly.
4. The downstream planner/evidence stages mostly execute the route they were
   handed instead of being primary arbiters of sufficiency.

### 5.4 Recommended target mapping

Parallx should map to the VS Code structure like this:

| Desired layer | Parallx file direction |
|---------------|------------------------|
| Request parsing | Promote `src/built-in/chat/input/chatRequestParser.ts` into the primary first-pass request interpretation layer |
| Bounded participant / route detection | Add a new narrow detection service instead of expanding `chatTurnRouter.ts` indefinitely |
| Turn orchestration | Shrink `src/built-in/chat/participants/defaultParticipant.ts` so it coordinates services rather than owning business logic |
| Context and evidence planning | Keep `chatContextPlanner.ts`, `chatContextAssembly.ts`, `chatEvidenceGatherer.ts`, but let them own more correction authority |
| Final response execution | Keep `chatTurnSynthesis.ts` and validation layers |

---

## 6. Rebuild Decision

## 6. AI Surface Inventory

The first version of this milestone focused mainly on the default chat flow.
That is not enough for safe unification. Every AI surface that can originate,
configure, execute, or expose AI behavior must be accounted for.

### 6.1 Core AI orchestration surfaces

| Surface | Files | Role |
|---------|------|------|
| Chat service orchestration | `src/services/chatService.ts` | Session lifecycle, parsed request flow, participant dispatch, response streaming |
| Agent registry / dispatch | `src/services/chatAgentService.ts` | Registers participants and invokes handlers |
| Mode state | `src/services/chatModeService.ts` | Ask/Edit/Agent mode selection |
| Language model transport | `src/services/languageModelsService.ts`, `src/built-in/chat/providers/ollamaProvider.ts` | Model registration and request execution |

### 6.2 Chat UI surfaces

| Surface | Files | Role |
|---------|------|------|
| Main chat view | `src/built-in/chat/widgets/chatView.ts` | Hosts the primary chat widget in the workbench |
| Core chat widget | `src/built-in/chat/widgets/chatWidget.ts` | Message list, input, sidebar, tool actions, approvals |
| Input surface | `src/built-in/chat/input/chatInputPart.ts` | Text input, attachments, pickers, submit/stop flow |
| Rendering surface | `src/built-in/chat/rendering/*` | Response rendering, citations, tool cards, code actions |
| Session sidebar | `src/built-in/chat/widgets/chatSessionSidebar.ts` | Session switching/history UX |

### 6.3 Participant surfaces

| Surface | Files | Role |
|---------|------|------|
| Default participant | `src/built-in/chat/participants/defaultParticipant.ts` | Main orchestration path for general chat |
| Workspace participant | `src/built-in/chat/participants/workspaceParticipant.ts` | Explicit `@workspace` surface |
| Canvas participant | `src/built-in/chat/participants/canvasParticipant.ts` | Explicit `@canvas` surface |

### 6.4 Request interpretation and routing surfaces

| Surface | Files | Role |
|---------|------|------|
| Input parser | `src/built-in/chat/input/chatRequestParser.ts` | Parses mentions, commands, variables |
| Front-door router | `src/built-in/chat/utilities/chatTurnRouter.ts` | Social/grounded/off-topic/memory workflow routing |
| Prelude / entry routing | `src/built-in/chat/utilities/chatTurnPrelude.ts`, `src/built-in/chat/utilities/chatTurnEntryRouting.ts` | Early request shaping and route preparation |
| Context planning | `src/built-in/chat/utilities/chatContextPlanner.ts` | Retrieval plan, citation mode, runtime trace |
| Scope / mention resolution | `src/built-in/chat/utilities/chatScopeResolver.ts`, `src/built-in/chat/utilities/chatMentionResolver.ts` | Workspace scoping and mention cleanup |

### 6.5 Context, retrieval, and memory surfaces

| Surface | Files | Role |
|---------|------|------|
| Context assembly | `src/built-in/chat/utilities/chatContextAssembly.ts`, `src/built-in/chat/utilities/chatTurnContextPreparation.ts` | Current page, retrieval, memory, transcript, concept context assembly |
| Evidence and execution planning | `src/built-in/chat/utilities/chatEvidenceGatherer.ts`, `src/built-in/chat/utilities/chatExecutionPlanner.ts` | Planned evidence workflow and coverage computation |
| Retrieval/indexing | `src/services/retrievalService.ts`, `src/services/indexingPipeline.ts`, `src/services/vectorStoreService.ts`, `src/services/embeddingService.ts` | Workspace retrieval substrate |
| Memory systems | `src/services/memoryService.ts`, `src/services/workspaceMemoryService.ts`, `src/services/canonicalMemorySearchService.ts` | Short-term and canonical memory access |

### 6.6 Agentic execution surfaces

| Surface | Files | Role |
|---------|------|------|
| Agent task execution | `src/services/agentExecutionService.ts` | Stepwise task execution and pause/approval handling |
| Agent approval/session/trace | `src/services/agentApprovalService.ts`, `src/services/agentSessionService.ts`, `src/services/agentTraceService.ts` | Approval workflow, session state, trace recording |
| Chat-grounded agent loop | `src/built-in/chat/utilities/chatGroundedExecutor.ts`, `src/built-in/chat/utilities/chatTurnSynthesis.ts` | Tool-loop execution and final response synthesis |

### 6.7 Configuration and settings surfaces

| Surface | Files | Role |
|---------|------|------|
| Unified config service | `src/aiSettings/unifiedAIConfigService.ts` | Intended single source of truth for AI configuration |
| Legacy compatibility interface | `src/aiSettings/aiSettingsTypes.ts`, consumers resolving `IAISettingsService` | Backward-compat surface still used by many consumers |
| AI Settings UI | `src/built-in/ai-settings/main.ts`, `src/aiSettings/ui/**` | User-facing configuration surface |

### 6.8 API and extension surfaces

| Surface | Files | Role |
|---------|------|------|
| Chat bridge | `src/api/bridges/chatBridge.ts` | Third-party tool registration of chat participants and tools |
| Language model bridge | `src/api/bridges/languageModelBridge.ts` | External access to model transport |
| Public API declarations | `src/api/parallx.d.ts`, `src/api/apiFactory.ts` | Public contract for AI/chat extensibility |

### 6.9 Non-chat AI surfaces

| Surface | Files | Role |
|---------|------|------|
| Proactive suggestions | `src/services/proactiveSuggestionsService.ts` | AI-adjacent suggestion system driven by retrieval/index analysis |
| Prompt/system-prompt generation | `src/aiSettings/systemPromptGenerator.ts`, `src/built-in/chat/config/chatSystemPrompts.ts` | Prompt construction affecting all AI output behavior |

### 6.10 Milestone 40 rule for surface coverage

No unification task should be considered complete unless it explicitly states
which of the above surfaces it impacts and which it intentionally leaves
unchanged.

---

## 7. Unification Risks

The inventory shows three concrete risk classes that must be managed.

### 7.1 Dual configuration path risk

There is already an overlap between:

- `IAISettingsService`
- `IUnifiedAIConfigService`

`UnifiedAIConfigService` is intended to replace the old settings path, but the
old interface still exists for compatibility and is still consumed throughout
the codebase.

This is acceptable temporarily, but Milestone 40 implementation work must avoid
creating fresh logic that reads some behavior from the unified config path and
other behavior from legacy settings assumptions without an explicit resolution
rule.

### 7.2 Participant-path divergence risk

Parallx has multiple participant surfaces:

- default
- workspace
- canvas
- third-party tool-contributed participants via `ChatBridge`

If the default path is modernized but the others retain incompatible request
interpretation or prompt-building assumptions, the system will drift into
surface-specific behavior.

Milestone 40 should therefore centralize request interpretation in shared
layers, not just improve the default participant in isolation.

### 7.3 Agent-vs-chat execution divergence risk

There is already a distinction between:

- chat participant orchestration
- agent task execution services

Those systems do not need to be identical, but they must share the same core
policy model for:

- approvals
- traceability
- configuration
- prompt/system-instruction behavior where relevant

Otherwise users will experience different "AI personalities" and action rules
depending on surface.

### 7.4 Required anti-drift rule

Every Milestone 40 implementation task must answer:

1. Which AI surfaces does this change touch?
2. Which shared layer is being centralized rather than duplicated?
3. Which remaining surfaces still need migration to avoid split-brain behavior?

---

## 8. Redesign Charter

Milestone 40 should be treated as an end-to-end redesign of the AI request
stack, not as a local router patch.

That does **not** mean replacing every AI subsystem. It means establishing one
coherent front-to-end architecture and migrating every AI surface onto it.

### 8.1 Systems to preserve

These systems are already doing the right class of job and should remain the
foundation unless a later assessment proves otherwise:

- indexing pipeline
- retrieval substrate
- vector store and embeddings
- workspace and canonical memory storage
- AI settings / unified config as the intended configuration root
- chat session persistence
- agent approval / trace / task state foundations

### 8.2 Systems to redesign

These are the systems that should be considered redesign targets within the
existing stack:

- request interpretation
- routing and participant selection policy
- prelude / entry-flow composition
- participant orchestration boundaries
- shared prompt-construction contract across AI surfaces

### 8.3 End-to-end invariants

The redesigned system should enforce the following invariants:

1. Every AI-originated user turn passes through one shared request
   interpretation contract.
2. No surface may invent its own routing semantics without going through the
   shared interpretation and planning layers.
3. Configuration for AI behavior must resolve from one authoritative effective
   config model.
4. Approval, trace, and system-prompt behavior must not silently differ between
   chat and agent surfaces unless explicitly documented.
5. The system must be explainable end-to-end: for any output, we should be able
   to say how the turn was parsed, routed, planned, executed, and validated.

### 8.4 No split-brain rollout rule

We should not ship a new interpretation path in one surface while leaving an
old incompatible path active in another surface indefinitely.

Temporary compatibility layers are allowed only if they are:

- explicitly named
- tracked in the migration matrix
- scheduled for removal

---

## 9. Migration Matrix

This matrix defines how the redesign should proceed without leaving conflicting
systems in place.

| Surface group | Current owner | Target shared layer | Legacy logic to eliminate |
|---------------|---------------|---------------------|---------------------------|
| Request parsing | `src/built-in/chat/input/chatRequestParser.ts` plus participant-local assumptions | Shared request interpretation contract | Participant-specific request assumptions |
| Front-door routing | `src/built-in/chat/utilities/chatTurnRouter.ts` | Narrow deterministic routing + bounded semantic fallback service | Monolithic lexical workflow classification |
| Prelude flow | `src/built-in/chat/utilities/chatTurnPrelude.ts` | Shared turn preparation service | Route/context/scope coupling in one utility |
| Default participant | `src/built-in/chat/participants/defaultParticipant.ts` | Thin orchestration over shared services | Business logic concentrated in one handler |
| Workspace participant | `src/built-in/chat/participants/workspaceParticipant.ts` | Shared interpretation + shared prompt contract + participant-specific context provider | Participant-specific interpretation drift |
| Canvas participant | `src/built-in/chat/participants/canvasParticipant.ts` | Shared interpretation + shared prompt contract + participant-specific context provider | Participant-specific interpretation drift |
| Tool-contributed participants | `src/api/bridges/chatBridge.ts` registrations | Shared participant registration contract with centralized interpretation semantics | Ad hoc participant behavior assumptions |
| Chat/agent policy behavior | chat utilities + `src/services/agentExecutionService.ts` | Shared policy/config/trace contract | Surface-specific approval and behavior rules |
| Config resolution | `IAISettingsService` compatibility + `IUnifiedAIConfigService` | Unified effective config resolution layer | Implicit mixed reads from legacy and unified assumptions |

### 9.1 Mandatory migration deliverable per row

Each row in the matrix should eventually gain four concrete implementation
notes:

1. current duplication points
2. target abstraction
3. migration task(s)
4. verification task(s)

### 9.2 End-state definition

Milestone 40 is not done when the default chat path looks cleaner.

It is done when the matrix no longer contains active, conflicting logic paths
for request interpretation and AI behavior across surfaces.

---

## 10. Rebuild Decision

### Short answer

No, this should not be a complete rebuild.

### Why a full rebuild would be the wrong move

Parallx already has too much useful infrastructure to justify throwing it away:

- session lifecycle in `src/services/chatService.ts`
- agent registry in `src/services/chatAgentService.ts`
- mode system in `src/services/chatModeService.ts`
- context assembly and evidence-gathering utilities
- AI eval harnesses that already measure critical behaviors

A full rebuild would create three risks:

1. **Regression risk**
   We would likely break retrieval, citation, memory, and tool-loop behavior
   simultaneously.

2. **Parity theater**
   A rebuild could claim to be "more VS Code-like" while actually replacing
   working infrastructure with a superficially cleaner but less capable design.

3. **Loss of evaluability**
   Incremental changes can be measured against current Playwright baselines.
   Full rewrites usually collapse too many variables at once.

### What should be rebuilt versus refactored

#### Rebuild in place

These pieces should be substantially redesigned, but inside the existing stack:

- the front-door routing contract in `chatTurnRouter.ts`
- the division of responsibility in `chatTurnPrelude.ts`
- the oversized orchestration path in `defaultParticipant.ts`

#### Preserve and adapt

These should be kept and re-layered, not replaced wholesale:

- `chatService.ts`
- `chatAgentService.ts`
- `chatModeService.ts`
- `chatContextPlanner.ts`
- `chatContextAssembly.ts`
- `chatEvidenceGatherer.ts`
- `chatTurnSynthesis.ts`

### Recommended migration strategy

The correct move is a **strangler refactor**, not a restart.

1. Introduce a clearer parse layer first.
2. Introduce a bounded semantic fallback service next.
3. Move route correction authority into planning/evidence.
4. Shrink `defaultParticipant.ts` by extracting orchestration into service-like
   seams.
5. Keep running targeted Playwright gates after every change.

---

## 11. VS Code Parity Target

Parallx should align to the following architecture pattern.

### 11.1 Desired request flow

`raw user text -> explicit parse layer -> deterministic fast-path rules -> low-confidence semantic fallback -> evidence/planning stage -> execution`

### 11.2 Design principles

1. **Parse first.** Durable syntax and explicit references should be extracted
   before semantic workflow inference.
2. **Route narrowly.** Any model-assisted routing should answer a constrained
   structured question, not free-form "do whatever seems right" reasoning.
3. **Defer more behavior downstream.** The front-door router should decide less.
   Planning and evidence sufficiency should decide more.
4. **Evidence can correct routing.** If the initial route produces weak or odd
   evidence, the system should be able to escalate or reroute.
5. **Social turns must stay clean.** A greeting should not surface workspace
   citations, source lists, or retrieval context.

### 11.3 Target Milestone 40 architectural shape

Parallx should evolve toward these layers:

1. **Request Parse Layer**
   - explicit mentions
   - files/folders
   - slash-like commands
   - attached context
   - obvious social trivialities

2. **Deterministic Routing Layer**
   - clear fast-path cases only
   - no ambitious whole-turn semantic overreach

3. **Semantic Fallback Layer**
   - invoked only when deterministic confidence is low
   - returns structured fields, not prose
   - examples: `intent`, `workflowType`, `coverageMode`, `confidence`

4. **Planner / Evidence Layer**
   - can upgrade or correct weak initial routing
   - owns exhaustive-vs-representative execution decisions more directly

---

## 12. Milestone 40 Deliverables

Milestone 40 itself is complete when the following planning and accountability
 artifacts exist.

### A. Canonical parity document

This file becomes the canonical milestone plan for the alignment effort.

### B. Sourced evidence ledger

The implementation effort must maintain a ledger showing:

- the VS Code source file or DeepWiki page used
- the behavior derived from it
- the Parallx file or subsystem expected to align
- any approved deviation with rationale

### C. Targeted Playwright gates

The implementation branch must run a focused regression set on each major router
 or planner change.

### D. Drift checkpoints

Every parity-related task must record:

- what changed
- which evidence item it maps to
- which Playwright cases were run
- whether the change improved, preserved, or weakened parity

### E. Surface-complete migration plan

The milestone must include a phased rollout plan that explicitly covers:

- chat UI surfaces
- participant surfaces
- request interpretation surfaces
- context/retrieval/memory surfaces
- agent execution surfaces
- configuration surfaces
- API / extension surfaces

---

## 13. Accountability Framework

This section is the anti-drift contract.

### 13.1 Parity ledger rule

Every substantial implementation task in the Milestone 40 stream must include a
 short ledger entry with four fields:

| Field | Meaning |
|------|---------|
| `Evidence` | Which VS Code / DeepWiki source justified the task |
| `Parallx surface` | Which Parallx file or subsystem changed |
| `Expected parity gain` | What should become more VS Code-like |
| `Verification` | Which tests prove it |

### 13.2 No unsourced architecture changes

If a change claims to improve parity but cannot point to a specific VS Code or
DeepWiki source, it is not a parity change. It is a local invention and must be
marked as such.

### 13.3 Allowed deviations must be explicit

Not every VS Code behavior should be copied literally. But any deviation must be
documented under one of these labels:

- `product-difference`
- `workspace-domain-difference`
- `local-model-constraint`
- `temporary-implementation-gap`

### 13.4 Required implementation notes

For each milestone task, implementation notes must capture:

1. the evidence item used
2. the exact Parallx files touched
3. the exact Playwright tests run
4. before/after outcome

### 13.5 No hidden parallel-path rule

If a task introduces a temporary compatibility path, the task must also record:

1. the old path still in use
2. the new path being introduced
3. the switch-over condition
4. the removal task for the old path

---

## 14. Targeted Playwright Gates

The parity effort must stay attached to focused end-to-end checks.

### 14.1 Required baseline set

Run these cases whenever routing or planning behavior changes:

#### Default workspace

- `tests/ai-eval/ai-quality.spec.ts -g "T06|T19"`

Why:

- `T06` guards greeting behavior and conversational cleanliness.
- `T19` guards citation rendering and citation click-open behavior.

#### Exam 7 real workspace

- `tests/ai-eval/exam7-quality.spec.ts -g "E706|E707"`

Why:

- `E706` guards exhaustive folder-summary behavior.
- `E707` guards unsupported-claim / hallucination-guard behavior.

#### Canonical memory workspace coverage

- `tests/ai-eval/memory-layers.spec.ts`

Why:

- validates durable memory vs daily memory separation
- validates fresh-session greeting cleanliness
- validates memory write-back behavior

#### Stress workspace coverage

- `tests/ai-eval/stress-quality.spec.ts`

Why:

- validates robustness under noisy, contradictory, and ambiguous workspace data
- validates that redesigned routing/planning still survives messy real-world inputs

### 14.2 Baseline captured during milestone drafting

Observed targeted baseline on current branch:

#### Default workspace

- `T06` = `80%`
  - greeting behavior passed
  - concise-length assertion failed
- `T19` = `100%`
- `T30` = `100%`
   - combined greeting now routes through the shared conversational path
   - no unsolicited workspace facts or citations surfaced
- `T31` = `100%`
   - default and explicit `@workspace` listing behavior aligned on the demo workspace
- `T32` = `100%`
   - `@canvas` no-page guardrail is now clean and source-free
   - explicit participants now report no-retrieval decisions through the shared debug path

#### Exam 7 workspace

- `E706` = `100%`
- `E707` = `100%`
- `E708` = `100%`

#### Additional suites to treat as required verification surfaces

- `memory-layers.spec.ts` = required suite, baseline not yet restated in this doc
- `stress-quality.spec.ts` = `95%` after remaking the stress workspace through normal Parallx initialization; see `docs/ai/M40_PHASE1_STRESS_BASELINE.md`
   - strongest remaining stress gaps are `S-T03` (`83%`) and `S-T05` (`70%`)

### 14.3 Why this still matters despite green RF Guides targeted tests

The targeted tests are necessary but not sufficient.

The user-reported manual failures still show that:

- natural phrasing can expose gaps not covered by the current eval wording
- real interactive behavior can temporarily diverge from our narrow benchmark
- the greeting case needs better protection than a single rubric assertion

Therefore Milestone 40 should add additional targeted coverage for:

1. combined greeting phrasing such as `Hi hows it going?`
2. prompt-typo variants such as `eachof`
3. social-turn source suppression
4. low-confidence routing fallback behavior once introduced
5. participant-surface agreement between default, `@workspace`, and `@canvas`
6. memory cleanliness across fresh sessions
7. Parallx-specific `@canvas` no-page-open guardrails

### 14.4 Additional parity tests to add during implementation

1. `Greeting does not trigger workspace sources`
2. `Greeting with combined phrasing routes as conversational`
3. `Exhaustive folder-summary survives spacing typo variants`
4. `Low-confidence semantic fallback upgrades route when deterministic parser is unsure`
5. `Default and explicit participants share request interpretation semantics`
6. `Fresh-session greeting does not leak memory or retrieval artifacts`

Implemented during Phase 1 so far:

1. `T30` custom greeting regression using runtime trace and retrieval debug
2. `E708` Exam 7 exhaustive-summary phrasing variant
3. `T31` default-vs-`@workspace` participant agreement scaffold
4. `T32` Parallx-specific `@canvas` no-page-open guardrail scaffold

Implemented during Phase 2 so far:

1. shared `IChatParticipantInterpretation` contract for default, `@workspace`, and `@canvas`
2. shared default-turn interpretation utility for entry parsing, prelude construction, and deterministic skill activation
3. explicit participant no-retrieval reporting aligned with the shared debug contract
4. conversational routing tightened so combined greeting phrasing stays source-free
5. shared default prepared-turn context utility for execution-plan building, prompt enrichment, evidence gathering, and context preparation
6. shared `IChatTurnSemantics` contract now owns conversational, memory/transcript recall, enumeration, off-topic, product-semantics, workflow-hint, and coverage-hint parsing
7. `chatTurnRouter.ts` now consumes typed semantics and acts as a route-mapping layer instead of re-owning most parse heuristics
8. shared scoped-participant command dispatcher now handles `@workspace` and `@canvas` entry dispatch plus retrieval-debug boilerplate

Phase 2 remaining compatibility note:

- default, `@workspace`, and `@canvas` are migrated onto the shared interpretation path
- contributed / `ChatBridge` participant compatibility is still an explicit follow-on item for Phase 3 shared orchestration work

Implemented during Phase 3 so far:

1. shared default-turn execution utility now owns the default participant's final deterministic-answer, budgeting, user-content composition, synthesis-config, and execution tail
2. `defaultParticipant.ts` is further reduced toward a coordinator over shared utilities
3. contributed participant compatibility path is now explicitly mapped:
   - tool-contributed participants are created through `src/api/bridges/chatBridge.ts`
   - `ChatBridge.createChatParticipant()` currently registers raw tool handlers directly into `IChatAgentService`
   - `src/services/chatAgentService.ts` dispatches those contributed handlers through the same agent registry as built-ins, but without the shared built-in orchestration utilities used by default / `@workspace` / `@canvas`
   - Phase 3 follow-on work must decide whether contributed participants adapt into the shared orchestration contract before registration, or remain intentionally thin pass-through handlers with an explicit compatibility boundary
4. shared scoped-participant execution utility now owns history replay and LLM streaming for `@workspace` and `@canvas`, reducing participant-local orchestration duplication
5. shared scoped-participant message builder now owns the common `system + history + current user` message pattern for `@workspace` and `@canvas`, further aligning their prompt contract
6. shared default command-registry and early-command utilities now own slash-command registration plus `/init` and `/compact` handling, further reducing participant-local control flow in `defaultParticipant.ts`

✅ Phase 3 checkpoint

- targeted participant-agreement scenarios currently pass (`T30`, `T31`, `T32` all `100%`)
- `defaultParticipant.ts` now primarily coordinates shared utilities rather than owning most orchestration business logic
- the contributed / `ChatBridge` compatibility path is explicitly mapped for the next migration decision

Implemented during Phase 4 so far:

1. shared typed semantic fallback contract added for bounded ambiguity handling in the interpretation/prelude layer
2. shared prelude now applies a narrow fallback for broad workspace-summary phrasing only when deterministic routing remains weak and generic
3. fallback activation is observable through shared runtime-trace / debug artifacts instead of hidden participant-local behavior
4. shared prepared-turn context now adds a narrow fallback guidance section so ambiguous broad prompts receive explicit exhaustive-summary framing without replacing downstream planning

Current Phase 4 verification:

- `T30` greeting cleanliness still passes at `100%`
- `S-T09` ambiguous phrasing stress case now passes at `100%`
- focused unit regressions now pass for shared prelude fallback activation and runtime-trace preservation
- local Exam 7 phrasing-variant verification (`E708`) remains unrun in this workspace because the Exam 7 eval workspace is not present locally

Canvas note:

- `@canvas` is a Parallx-specific surface with no direct VS Code counterpart.
- Phase 1 covers the no-page-open guardrail first.
- Rich open-page `@canvas` parity should be added only after a stable canvas-page
   test fixture exists for AI eval.
- Current Phase 1 `@canvas` baseline is recorded in `docs/ai/M40_PHASE1_CANVAS_BASELINE.md`.

### 14.5 Verification contract by workstream

| Workstream | Minimum verification |
|------------|----------------------|
| Request interpretation changes | `ai-quality.spec.ts -g "T06|T19"` + new parity request tests |
| Exhaustive / planning changes | `exam7-quality.spec.ts -g "E706|E707"` |
| Memory-path changes | `memory-layers.spec.ts` |
| Robustness / ambiguity changes | `stress-quality.spec.ts` |
| Participant unification changes | participant-agreement tests plus targeted default/workspace/canvas scenarios |
| Config unification changes | regression checks across AI Settings-driven behavior and chat execution |

---

## 15. Execution Plan

### Phase 1 — Architecture freeze and observability

Required pre-read before starting or resuming this phase:

- `.github/AGENTS.md`
- `.github/instructions/parallx-instructions.instructions.md`
- `docs/Parallx_Milestone_40.md`

Vision:

- establish a trustworthy baseline of how the current system behaves before we
   redesign any shared AI path

Objective:

- convert the currently informal understanding of AI entry points and known
   failures into concrete repository artifacts and regression tests

1. Finalize this milestone doc.
2. Add a parity ledger section to implementation notes or PR summaries.
3. Expand the AI eval harness with parity-specific targeted cases.
4. Record current entry points for every AI surface before behavior changes begin.

Success is testable when:

1. the current entry-point inventory exists in-repo
2. the new parity tests exist in-repo
3. baseline outputs for required suites are captured or their failure modes are
    explicitly documented
4. no redesign work has started without those artifacts being present

### Phase 2 — Shared request interpretation layer

Required pre-read before starting or resuming this phase:

- `.github/AGENTS.md`
- `.github/instructions/parallx-instructions.instructions.md`
- `docs/Parallx_Milestone_40.md`

Vision:

- one turn should mean the same thing no matter which participant or surface
   receives it first

Objective:

- create one typed request-interpretation contract that all chat participants
   and future AI surfaces can rely on

1. Promote explicit request parsing into the primary first-pass contract.
2. Define the typed output shared by default, workspace, canvas, and bridged participants.
3. Reduce `chatTurnRouter.ts` to narrow deterministic fast-path decisions only.

Success is testable when:

1. default, workspace, and canvas participants consume the same interpretation
    object
2. greeting parity tests pass across the shared path
3. no participant-specific copy of the old front-door routing semantics remains
    untracked

### Phase 3 — Shared participant orchestration refactor

Required pre-read before starting or resuming this phase:

- `.github/AGENTS.md`
- `.github/instructions/parallx-instructions.instructions.md`
- `docs/Parallx_Milestone_40.md`

Vision:

- participants should differ by the context they provide, not by secretly
   owning different orchestration models

Objective:

- refactor participant handlers so orchestration logic lives in shared layers
   and participants become thin specializations

1. Shrink `defaultParticipant.ts` into a coordinator over shared services.
2. Migrate `@workspace` and `@canvas` onto the same interpretation and prompt contract.
3. Define the compatibility plan for tool-contributed participants through `ChatBridge`.

Success is testable when:

1. participant-agreement tests pass for the targeted scenarios
2. `defaultParticipant.ts` no longer contains the majority of orchestration
    business logic
3. the bridge path for contributed participants is explicitly mapped to the new
    shared orchestration contract

### Phase 4 — Bounded semantic fallback

Required pre-read before starting or resuming this phase:

- `.github/AGENTS.md`
- `.github/instructions/parallx-instructions.instructions.md`
- `docs/Parallx_Milestone_40.md`

Vision:

- ambiguous turns should be resolved by a constrained and observable fallback,
   not by expanding heuristic guesswork forever

Objective:

- introduce a narrow semantic fallback that activates only when deterministic
   confidence is insufficient

1. Add a structured semantic fallback for ambiguous turns.
2. Keep it opt-in, bounded, and observable.
3. Make its outputs narrow and typed.

Success is testable when:

1. fallback usage is visible in traces/debug artifacts
2. typo-variant and ambiguous-request tests improve without regressing greeting
    cleanliness
3. fallback output is structured and does not directly replace downstream
    planning logic

### Phase 5 — Planner/evidence authority shift

Required pre-read before starting or resuming this phase:

- `.github/AGENTS.md`
- `.github/instructions/parallx-instructions.instructions.md`
- `docs/Parallx_Milestone_40.md`

Vision:

- the system should trust evidence sufficiency more than early routing guesses

Objective:

- move correctness authority toward planning and evidence assessment so weak
   early routes can be corrected

1. Allow planning/evidence stages to correct weak front-door routing.
2. Prefer evidence sufficiency over early heuristic confidence.
3. Remove duplicated workflow decisions from participant-specific paths.

Success is testable when:

1. exhaustive-summary scenarios still pass under the shared architecture
2. traces can explain why a route was corrected or preserved
3. participant-specific workflow duplication has been reduced or removed for the
    migrated paths

Implemented during Phase 5 so far:

1. shared route-authority decision contract now allows evidence/planning stages to preserve or correct a grounded route after coverage is known
2. shared default prepared-turn context now applies a bounded evidence-authority correction when tool-first exhaustive/enumeration coverage produces zero covered targets and RAG is available
3. corrected route/context-plan decisions are now written back into the shared runtime trace so traces can explain why a route was preserved or corrected
4. focused unit regressions now cover both semantic fallback and the first evidence-authority correction rule
5. post-assessment authority correction now also handles incomplete (`partial`/`minimal`) tool-first coverage when the resulting evidence remains weak or insufficient
6. `@workspace` and `@canvas` now share a common scoped prompt/stream runner instead of each repeating local message-build and LLM-stream ceremony

Current Phase 5 checkpoint:

- shared authority correction compiles cleanly and unit regressions pass
- trace propagation for both semantic fallback and route authority is covered
- prepared-turn-context regression now proves that an empty exhaustive route is corrected back into representative retrieval when RAG is available
- end-to-end route-authority regression now passes by injecting unreadable rich documents into the eval workspace and confirming the real chat flow records a corrected route-authority decision
- broader partial/minimal correction is currently unit-covered; the reliable end-to-end proof remains the zero-covered-target route-authority case
- participant-specific scoped prompt execution duplication has been reduced for `@workspace` and `@canvas`, with participant tests still passing

### Phase 6 — Config and policy unification

Required pre-read before starting or resuming this phase:

- `.github/AGENTS.md`
- `.github/instructions/parallx-instructions.instructions.md`
- `docs/Parallx_Milestone_40.md`

Vision:

- users should experience one AI system, not separate personalities and policy
   rules depending on which surface they touched

Objective:

- make unified effective configuration and shared policy behavior authoritative
   across chat and agent-related surfaces

1. Make unified config resolution authoritative for AI behavior.
2. Keep `IAISettingsService` only as a compatibility interface until all reads resolve through the unified model.
3. Align chat and agent surfaces on policy, trace, and prompt behavior where applicable.

Success is testable when:

1. AI behavior reads resolve through one authoritative config model
2. compatibility-only settings paths are explicitly tracked
3. memory/config-driven behavior tests pass without relying on hidden legacy
    reads

### Phase 7 — Verification and removal of legacy paths

Required pre-read before starting or resuming this phase:

- `.github/AGENTS.md`
- `.github/instructions/parallx-instructions.instructions.md`
- `docs/Parallx_Milestone_40.md`

Vision:

- the redesign is only complete when the old conflicting paths are removed and
   the new system proves itself against the required eval surfaces

Objective:

- close the migration matrix, remove temporary paths, and validate the final
   unified architecture with the required test contract

1. Re-run targeted Playwright gates after each major change.
2. Compare outcomes against the evidence ledger.
3. Remove temporary compatibility paths once their replacement is verified.
4. Record any remaining intentional deviations.

Success is testable when:

1. migration-matrix rows touched by the redesign are marked complete or have an
    explicit tracked deviation
2. required verification suites pass at the agreed acceptance level
3. temporary compatibility paths introduced during the milestone are removed or
    explicitly justified with follow-up tasks

### 15.1 Exit criteria per phase

No phase should be considered complete unless:

1. the migration-matrix rows touched by that phase are updated
2. the required verification contract entries were run
3. any temporary compatibility path introduced in that phase has a tracked removal step

### 15.1A Phase success matrix

| Phase | Testable success signal |
|-------|--------------------------|
| Phase 1 | inventory artifacts and new parity tests exist; baseline runs recorded |
| Phase 2 | shared request-interpretation contract is consumed by migrated participants |
| Phase 3 | participant-agreement checks pass and orchestration is centralized |
| Phase 4 | bounded fallback improves ambiguous cases without degrading greetings |
| Phase 5 | planner/evidence layers can explain and correct weak initial routing |
| Phase 6 | unified config and policy behavior drive migrated AI surfaces |
| Phase 7 | legacy paths are removed or explicitly deferred and the required verification contract passes |

### 15.2 Detailed implementation checklist

The checklist below is the concrete execution sequence for Milestone 40. It is
the build plan that should be followed unless new evidence requires a change.

#### Phase 1 tasks — freeze the current system and capture truth

1. Record every AI entry point and the first shared layer it reaches.
2. Add parity-focused tests for:
   - combined greeting phrasing
   - typo-tolerant exhaustive summary phrasing
   - participant-surface agreement
3. Capture baseline traces for the required verification suites.

Verification:

- `npx playwright test --config=playwright.ai-eval.config.ts tests/ai-eval/ai-quality.spec.ts -g "T06|T19"`
- current Phase 2 focused verification:
   - `npx playwright test --config=playwright.ai-eval.config.ts tests/ai-eval/ai-quality.spec.ts -g "T30|T31|T32"`
- `npx playwright test --config=playwright.ai-eval.config.ts tests/ai-eval/exam7-quality.spec.ts -g "E706|E707"`

#### Phase 2 tasks — establish a shared request-interpretation contract

1. Define a typed request-interpretation object that all participants consume.
2. Move durable parse concerns into that shared contract:
   - participant mentions
   - commands
   - file/folder references
   - social trivialities
   - explicit memory/transcript recall cues
3. Reduce `chatTurnRouter.ts` to narrow fast-path decisions only.
4. Update default, workspace, and canvas participants to consume the shared
   contract instead of deriving their own request semantics.

Primary files:

- `src/built-in/chat/input/chatRequestParser.ts`
- `src/built-in/chat/utilities/chatTurnRouter.ts`
- `src/built-in/chat/utilities/chatTurnPrelude.ts`
- `src/built-in/chat/participants/defaultParticipant.ts`
- `src/built-in/chat/participants/workspaceParticipant.ts`
- `src/built-in/chat/participants/canvasParticipant.ts`

Verification:

- `npx playwright test --config=playwright.ai-eval.config.ts tests/ai-eval/ai-quality.spec.ts -g "T06|T19"`
- participant-agreement tests added in this milestone

#### Phase 3 tasks — refactor participant orchestration

1. Extract shared orchestration services from `defaultParticipant.ts`.
2. Narrow participant responsibilities:
   - default participant: general-purpose orchestration
   - workspace participant: workspace context provider
   - canvas participant: page-structure context provider
3. Define how tool-contributed participants created via `ChatBridge` adopt the
   same interpretation and orchestration contracts.

Primary files:

- `src/built-in/chat/participants/defaultParticipant.ts`
- `src/built-in/chat/participants/workspaceParticipant.ts`
- `src/built-in/chat/participants/canvasParticipant.ts`
- `src/api/bridges/chatBridge.ts`

Verification:

- participant parity tests across default, workspace, and canvas
- `npx playwright test --config=playwright.ai-eval.config.ts tests/ai-eval/ai-quality.spec.ts -g "T19"`

#### Phase 4 tasks — add bounded semantic fallback

1. Introduce a dedicated low-confidence semantic fallback service.
2. Make its output structured, typed, and auditable.
3. Ensure traces show when fallback was used and what it returned.
4. Keep it out of clear fast-path cases.

Primary files:

- new shared semantic fallback service
- `src/built-in/chat/utilities/chatTurnPrelude.ts`
- `src/built-in/chat/utilities/chatContextPlanner.ts`
- runtime trace/reporting hooks consumed by tests

Verification:

- greeting and typo-variant parity tests
- `npx playwright test --config=playwright.ai-eval.config.ts tests/ai-eval/stress-quality.spec.ts`

#### Phase 5 tasks — shift authority to planning and evidence

1. Let planning/evidence layers upgrade, refine, or reject weak initial routing.
2. Remove participant-specific workflow decisions that duplicate planner logic.
3. Make exhaustive-vs-representative execution explainable in traces.

Primary files:

- `src/built-in/chat/utilities/chatContextPlanner.ts`
- `src/built-in/chat/utilities/chatContextAssembly.ts`
- `src/built-in/chat/utilities/chatEvidenceGatherer.ts`
- `src/built-in/chat/utilities/chatExecutionPlanner.ts`

Verification:

- `npx playwright test --config=playwright.ai-eval.config.ts tests/ai-eval/exam7-quality.spec.ts -g "E706|E707"`
- `npx playwright test --config=playwright.ai-eval.config.ts tests/ai-eval/stress-quality.spec.ts`

#### Phase 6 tasks — unify configuration and policy behavior

1. Audit all AI behavior reads that still rely on compatibility-only assumptions.
2. Make unified effective config the authoritative resolution model.
3. Keep `IAISettingsService` only as a compatibility adapter until all reads
   flow through the unified model.
4. Align chat and agent surfaces on policy, approval, trace, and prompt rules
   where behavior overlaps.

Primary files:

- `src/aiSettings/unifiedAIConfigService.ts`
- AI settings consumers currently resolving `IAISettingsService`
- `src/services/agentExecutionService.ts`
- chat config/prompt consumers under `src/built-in/chat/**`

Verification:

- `npx playwright test --config=playwright.ai-eval.config.ts tests/ai-eval/memory-layers.spec.ts`
- targeted config-driven behavior regression checks

#### Phase 7 tasks — remove legacy paths and close the matrix

1. Remove compatibility branches that are no longer required.
2. Mark migration-matrix rows complete.
3. Re-run the full required verification contract.
4. Document any remaining approved deviations.

Verification:

- `npx playwright test --config=playwright.ai-eval.config.ts tests/ai-eval/ai-quality.spec.ts -g "T06|T19"`
- `npx playwright test --config=playwright.ai-eval.config.ts tests/ai-eval/exam7-quality.spec.ts -g "E706|E707"`
- `npx playwright test --config=playwright.ai-eval.config.ts tests/ai-eval/memory-layers.spec.ts`
- `npx playwright test --config=playwright.ai-eval.config.ts tests/ai-eval/stress-quality.spec.ts`

### 15.3 Definition of done for Milestone 40 implementation

Milestone 40 implementation is complete only when:

1. default, workspace, canvas, and bridged participant paths all use the shared
   request-interpretation contract
2. old front-door routing assumptions are either removed or explicitly listed
   as temporary compatibility paths with removal tasks
3. configuration resolution is explainable through one authoritative effective
   model
4. chat and agent surfaces do not silently disagree on policy and prompt rules
5. the required verification contract passes at the agreed acceptance level

### 15.4 Phase 1 repo task breakdown

Phase 1 should produce concrete artifacts in the repository, not just notes in
chat.

#### Task P1.1 — Current entry-point inventory

Goal:

- create a canonical inventory of every current AI entry point and the first
   shared layer it hits

Suggested artifact:

- add a Milestone 40 appendix or companion research doc containing the current
   entry-point map

Minimum surfaces to include:

- built-in chat activation entry point
- chat view/widget/input surfaces
- default/workspace/canvas participants
- `ChatBridge` tool-contributed participant entry
- agent execution entry points
- AI Settings / unified-config entry points
- proactive suggestions entry point

Primary files to inspect:

- `src/built-in/chat/main.ts`
- `src/built-in/chat/widgets/chatView.ts`
- `src/built-in/chat/widgets/chatWidget.ts`
- `src/built-in/chat/participants/defaultParticipant.ts`
- `src/built-in/chat/participants/workspaceParticipant.ts`
- `src/built-in/chat/participants/canvasParticipant.ts`
- `src/api/bridges/chatBridge.ts`
- `src/services/chatService.ts`
- `src/services/agentExecutionService.ts`
- `src/aiSettings/unifiedAIConfigService.ts`
- `src/services/proactiveSuggestionsService.ts`

Deliverable:

- for each surface, document:
   - origin surface
   - entry file
   - current owner/orchestrator
   - first shared layer touched
   - known duplication risk
- success note:
   - this task is complete only when the inventory is in-repo and can be cited
      by later phase tasks

#### Task P1.2 — Add parity tests for greeting variants

Goal:

- lock in the real-world conversational failures reported during Milestone 40
   discovery

Primary files to change:

- `tests/ai-eval/rubric.ts`
- `tests/ai-eval/ai-quality.spec.ts`
- shared scoring helpers only if needed

Minimum added coverage:

- `Hi hows it going?` should remain conversational
- no workspace facts or citations on greeting turns
- greeting response should remain concise and natural

Deliverable:

- one or more targeted tests that fail if greeting turns trigger grounded
   retrieval behavior again
- success note:
   - this task is complete only when the tests are present and runnable from the
      milestone verification commands

#### Task P1.3 — Add exhaustive-summary typo-tolerance tests

Goal:

- lock in the phrasing brittleness issue around exhaustive summary requests

Primary files to change:

- `tests/ai-eval/exam7Rubric.ts`
- `tests/ai-eval/exam7-quality.spec.ts`

Minimum added coverage:

- wording variants with spacing noise or small typos should still route to the
   exhaustive exploration path when intent is obvious

Deliverable:

- at least one additional Exam 7 exhaustive-summary parity case with pipeline
   expectations
- success note:
   - this task is complete only when the new case asserts both response quality
      and expected pipeline behavior

#### Task P1.4 — Add participant-agreement tests

Goal:

- verify that default, `@workspace`, and `@canvas` do not silently diverge on
   request interpretation semantics as the redesign begins

Primary files to change:

- targeted AI eval specs or a new participant-parity Playwright spec

Minimum added coverage:

- explicit participant invocation should preserve shared request semantics for
   basic greeting / retrieval / scoped-summary cases where applicable

Deliverable:

- participant parity tests with clear assertions about shared interpretation
- success note:
   - this task is complete only when a future participant drift would fail a
      targeted test rather than rely on manual discovery

#### Task P1.5 — Capture baseline traces and outputs

Goal:

- make Phase 1 the last moment where the current system behavior is recorded in
   a stable way before redesign work starts

Deliverable:

- archived baseline outputs for:
   - default workspace targeted run
   - Exam 7 targeted run
   - memory layers suite
   - stress suite or documented instability note if still failing
- success note:
   - this task is complete only when the stress-suite state is explicitly
      accounted for, even if it is still failing

#### Phase 2 tasks — shared request interpretation layer

Goal:

- move from ad hoc request semantics toward a single typed contract used across
   chat participants

Suggested implementation tasks:

1. define the shared request-interpretation type
2. move durable parse semantics into the shared interpretation layer
3. route all migrated participants through that contract
4. reduce `chatTurnRouter.ts` to narrow fast-path logic

Deliverable:

- one typed request-interpretation contract with migrated consumer paths

Success note:

- this phase is complete only when migrated participants no longer derive their
   own incompatible first-pass request semantics

#### Phase 3 tasks — shared participant orchestration refactor

Goal:

- centralize orchestration and leave participants responsible for context
   specialization only

Suggested implementation tasks:

1. extract orchestration responsibilities from `defaultParticipant.ts`
2. align workspace/canvas participant orchestration with the shared model
3. define the compatibility contract for `ChatBridge` participants

Deliverable:

- shared orchestration seams consumed by default/workspace/canvas paths

Success note:

- this phase is complete only when participant differences are primarily about
   context provision rather than hidden orchestration divergence

#### Phase 4 tasks — bounded semantic fallback

Goal:

- introduce a constrained fallback for ambiguous turns without replacing the
   shared planner with unconstrained model routing

Suggested implementation tasks:

1. define structured fallback outputs
2. define activation thresholds and observability hooks
3. integrate fallback into the shared prelude path

Deliverable:

- observable bounded semantic fallback integrated behind the shared contract

Success note:

- this phase is complete only when fallback improves ambiguous cases and its
   use can be explained from traces

#### Phase 5 tasks — planner/evidence authority shift

Goal:

- make planning and evidence the authority on whether the route is sufficient

Suggested implementation tasks:

1. add route-correction hooks to planning/evidence layers
2. remove participant-local workflow duplication
3. expose route-correction decisions in trace/debug outputs

Deliverable:

- planner/evidence layers can preserve or correct weak early decisions

Success note:

- this phase is complete only when exhaustive and ambiguity-sensitive tests pass
   through planner-driven correctness rather than brittle early routing alone

#### Phase 6 tasks — config and policy unification

Goal:

- align AI behavior under one authoritative config and shared policy model

Suggested implementation tasks:

1. audit remaining compatibility-only config reads
2. move migrated behavior to unified effective config
3. align overlapping chat/agent policy behavior

Deliverable:

- authoritative unified config resolution for migrated AI surfaces

Success note:

- this phase is complete only when migrated surfaces can explain behavior from
   the unified config path instead of hidden legacy reads

#### Phase 7 tasks — verification and removal of legacy paths

Goal:

- close the milestone by proving the unified system and removing replaced paths

Suggested implementation tasks:

1. remove temporary compatibility paths that are no longer needed
2. close migration-matrix rows
3. run the required verification contract and record outcomes

Deliverable:

- milestone close-out report showing final migrated surfaces, removed legacy
   paths, remaining approved deviations, and verification outcomes

Success note:

- this phase is complete only when the final verification set is run and the
   remaining deviations are explicit rather than accidental

### 15.5 Phase 1 verification commands

These commands are the minimum required validation set for Phase 1:

1. `npx playwright test --config=playwright.ai-eval.config.ts tests/ai-eval/ai-quality.spec.ts -g "T06|T19"`
2. `npx playwright test --config=playwright.ai-eval.config.ts tests/ai-eval/exam7-quality.spec.ts -g "E706|E707"`
3. `npx playwright test --config=playwright.ai-eval.config.ts tests/ai-eval/memory-layers.spec.ts`
4. `npx playwright test --config=playwright.ai-eval.config.ts tests/ai-eval/stress-quality.spec.ts`

If the stress suite remains unstable in Phase 1, the milestone must record the
exact failure mode rather than silently dropping the suite from verification.

---

## 16. Evidence Ledger

The entries below are the initial canonical evidence set for Milestone 40.

| ID | Source | Evidence | Parallx implication |
|----|--------|----------|---------------------|
| `VSC-CHAT-01` | DeepWiki `AI and Chat Features` | VS Code chat uses shared service layers (`IChatService`, `IChatAgentService`, `IChatModeService`) rather than a single intent router | Parallx should move routing responsibility into clearer layered services rather than one front-door classifier |
| `VSC-CHAT-02` | DeepWiki `Chat System` | `ChatRequestParser` performs deterministic parsing of explicit request structure | Parallx should separate explicit parse behavior from semantic workflow routing |
| `VSC-CHAT-03` | `src/vs/workbench/contrib/chat/common/chatService/chatServiceImpl.ts` | `sendRequest()` parses request, resolves default agent, and may invoke participant detection only when no explicit participant/command is set | Parallx should consider model-assisted fallback only for low-confidence ambiguous cases |
| `VSC-CHAT-04` | `src/vs/workbench/contrib/chat/common/participants/chatAgents.ts` | `detectAgentOrCommand(...)` is a narrow participant/command selector, not a general workflow planner | Any Parallx LLM-assisted router should return narrow structured output, not broad behavioral decisions |
| `VSC-CHAT-05` | `src/vs/workbench/contrib/chat/common/requestParser/chatRequestParser.ts` | Explicit tokens like `@agent` and `/command` are parsed only in structurally valid positions | Parallx should harden explicit parse semantics before reaching for more heuristic regex expansion |
| `VSC-CHAT-06` | `chat.detectParticipant.enabled` configuration docs from DeepWiki and VS Code chat service flow | Participant detection is optional, bounded, and configurable | Parallx should ship any semantic fallback behind a clearly defined gate and observability path |

### Approved initial deviations

| Deviation | Label | Rationale |
|-----------|-------|-----------|
| Parallx must reason about workspace-grounded research tasks more than stock VS Code chat | `workspace-domain-difference` | Parallx is a second-brain workbench with stronger document-centric workflows |
| Parallx uses local-model constraints and retrieval pipelines that VS Code does not mirror directly | `local-model-constraint` | Local Ollama-driven workflows need stronger evidence budgeting and deterministic safeguards |

---

## 17. Success Criteria

Milestone 40 is successful when:

1. A canonical parity plan exists with sourced evidence.
2. The implementation stream can be judged against an evidence ledger.
3. Focused Playwright gates exist for conversational cleanliness and RF Guides
   routing correctness.
4. Future router/planner work is required to cite the evidence it claims to
   implement.
5. Parallx has an explicit path away from a monolithic lexical router and
   toward a layered parse + bounded semantic fallback architecture.
6. Every AI surface is either migrated to the shared architecture or explicitly
   listed as a temporary compatibility path with a removal plan.
7. We can explain any AI response path end-to-end across parsing, routing,
   planning, execution, and validation.

---

## 18. Non-Goals

This milestone does not, by itself:

- fully replace the existing router
- guarantee literal one-to-one behavioral parity with every VS Code chat mode
- rewrite the entire evidence engine
- remove all heuristics from Parallx chat
- ship an unconstrained LLM router

The purpose of Milestone 40 is to make the next implementation steps correct,
measurable, and accountable.