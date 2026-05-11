# Milestone 40 — AI Entrypoint Inventory

This document captures the current AI entry points in Parallx and the first
shared layer each one reaches. It is the Phase 1 inventory artifact for
Milestone 40.

## Purpose

The redesign cannot be trusted if we only reason about the default chat path.
This inventory exists to answer two questions for every AI surface:

1. Where does the AI interaction originate?
2. What is the first shared layer that owns the request or behavior?

## Entrypoint Matrix

| Surface | Entrypoint | Current owner/orchestrator | First shared layer touched | Known duplication risk |
|---------|------------|----------------------------|----------------------------|------------------------|
| Built-in chat activation | `src/built-in/chat/main.ts` | Chat built-in activation | `src/services/chatService.ts` / `src/services/chatAgentService.ts` | Activation wires multiple participants and utilities that can drift semantically |
| Chat view host | `src/built-in/chat/widgets/chatView.ts` | Chat view provider | `src/built-in/chat/widgets/chatWidget.ts` | UI-level behavior can diverge from service-level assumptions |
| Main chat widget send flow | `src/built-in/chat/widgets/chatWidget.ts` | Widget submit/stop/session wiring | `src/services/chatService.ts` | Widget may reflect old/new execution states differently during migration |
| Chat input parsing surface | `src/built-in/chat/input/chatInputPart.ts` | Input toolbar/textarea/attachments | `src/services/chatService.ts` via submit path | Input affordances can diverge from request interpretation rules |
| Chat service request send | `src/services/chatService.ts` | Session + request orchestrator | `src/built-in/chat/input/chatRequestParser.ts` then `IChatAgentService.invokeAgent()` | Parsed request structure and participant routing can diverge from participant-local logic |
| Default participant | `src/built-in/chat/participants/defaultParticipant.ts` | Main chat orchestration | `src/built-in/chat/utilities/chatTurnPrelude.ts` | High concentration of routing, planning, prompting, and execution logic |
| Workspace participant | `src/built-in/chat/participants/workspaceParticipant.ts` | Explicit `@workspace` participant | participant-local prompt assembly + `sendChatRequest()` | Can drift from default participant interpretation and prompting rules |
| Canvas participant | `src/built-in/chat/participants/canvasParticipant.ts` | Explicit `@canvas` participant | participant-local prompt assembly + `sendChatRequest()` | Can drift from default/workspace participant semantics |
| Tool-contributed participant bridge | `src/api/bridges/chatBridge.ts` | API bridge for tool participants | `src/services/chatAgentService.ts` | Contributed participants can bypass intended shared interpretation conventions |
| Chat routing prelude | `src/built-in/chat/utilities/chatTurnPrelude.ts` | Early turn shaping | `chatTurnRouter.ts` + `chatContextPlanner.ts` + scope resolution | Conflates request semantics, route choice, and context planning |
| Front-door routing | `src/built-in/chat/utilities/chatTurnRouter.ts` | Heuristic route classifier | returns `IChatTurnRoute` | Current monolithic lexical router owns too many decisions |
| Context planning | `src/built-in/chat/utilities/chatContextPlanner.ts` | Retrieval/memory/citation planning | shared context plan | Planning authority currently secondary to front-door routing |
| Context assembly | `src/built-in/chat/utilities/chatContextAssembly.ts` | Retrieval/current-page/memory assembly | retrieval + memory services | Can inherit incorrect early routing assumptions |
| Evidence workflow | `src/built-in/chat/utilities/chatEvidenceGatherer.ts` | Planned evidence gathering | retrieval/file services | Workflow correctness depends on earlier route quality |
| Response synthesis | `src/built-in/chat/utilities/chatTurnSynthesis.ts` | Final answer execution/validation | LM send + validation helpers | Final output quality can mask upstream routing problems |
| Agent task execution | `src/services/agentExecutionService.ts` | Task-step execution engine | agent session/policy/trace services | Chat and agent paths can drift on policy/config behavior |
| Agent approvals | `src/services/agentApprovalService.ts` | Approval queue and resolution | agent session store | Approval semantics can diverge from chat-facing explanation semantics |
| Agent trace | `src/services/agentTraceService.ts` | Task trace recording | trace store | Trace model can diverge from chat runtime trace model |
| Unified AI config | `src/aiSettings/unifiedAIConfigService.ts` | Intended config source of truth | effective config resolution | Legacy `IAISettingsService` compatibility can hide split config reads |
| AI Settings UI | `src/built-in/ai-settings/main.ts` | Settings panel activation | `IAISettingsService` / `IUnifiedAIConfigService` | UI can appear unified while runtime consumers still split |
| Proactive suggestions | `src/services/proactiveSuggestionsService.ts` | Suggestion generation | retrieval/indexing services + AI settings | Non-chat AI behavior still influenced by legacy-compatible settings reads |

## Immediate Phase 1 Findings

1. The default chat path is only one of several active AI entry points.
2. `defaultParticipant.ts` remains the largest single concentration of AI
   behavior decisions.
3. `@workspace` and `@canvas` already represent parallel interpretation and
   prompting paths, even before tool-contributed participants are considered.
4. Configuration is intended to be unified, but compatibility surfaces still
   exist and must be tracked during migration.
5. Chat and agent execution are adjacent but not yet guaranteed to honor one
   shared behavioral contract.

## Phase 1 Use

Every Milestone 40 implementation task should cite this inventory when stating:

- which entry points are affected
- which first shared layer is being changed
- which adjacent surfaces could drift if not migrated together