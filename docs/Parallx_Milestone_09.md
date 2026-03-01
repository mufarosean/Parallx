# Milestone 9 — AI Chat System (Local-Only)

> **Authoritative Scope Notice**
>
> This document is the single source of truth for Milestone 9.
> All implementation must conform to the structures and boundaries defined here.
> VS Code source files are referenced strictly as inspiration and validation, not as scope drivers.
> Referenced material must not expand scope unless a missing core chat element is identified.
> Parallx is **not** a code IDE. It is a VS Code-like structural shell that hosts arbitrary domain-specific tools.
> All VS Code references are filtered through this lens — only structural, shell, and hosting patterns apply.

---

## Milestone Definition

### Vision

The workbench shell gains a **VS Code-style AI chat system** powered exclusively by local AI (Ollama). The chat system is a first-class workbench capability — service-driven, not UI-driven — with the same architecture VS Code uses for Copilot Chat: service abstractions for model providers, a participant/agent system for extensibility, three adapted chat modes (Ask, Edit, Agent), streaming response rendering, tool invocation with confirmation gates, and a `parallx.chat` + `parallx.lm` API surface for tools to integrate with.

### Purpose

This milestone transforms Parallx from a static knowledge workspace into an AI-augmented one. It solves AI model integration, conversational UI, streaming response rendering, workspace-aware tool invocation, and chat extensibility before any domain-specific AI features are authored. After M9, a tool developer can register a chat participant, invoke language models, and contribute tools to the agentic loop — all through the existing `parallx` API boundary.

The key architectural insight from VS Code: **the chat system is service-driven, not UI-driven.** The `ChatWidget` is a thin rendering layer over `IChatService` (session lifecycle), `IChatAgentService` (participant dispatch), and `ILanguageModelsService` (model abstraction). This separation means the same AI capabilities are available to tools, commands, and inline experiences — not just the chat panel.

### Conceptual Scope

**Included**
- Language model provider abstraction (`ILanguageModelProvider` interface)
- Ollama provider implementation (REST API integration)
- Chat service with session lifecycle and message storage
- Chat agent/participant registry and dispatch system
- Chat mode system (Ask, Edit, Agent) with per-mode capabilities
- Chat widget UI in the Auxiliary Bar (message list + input + pickers)
- Streaming response rendering with typed content parts
- Chat request parser (@mentions, /commands, #variables)
- Language model tool invocation framework with confirmation gates
- Built-in tools for workspace operations (search, read, list, create)
- Built-in chat participants (default, @workspace, @canvas)
- Edit mode adaptation for canvas block/page editing
- `parallx.lm` and `parallx.chat` API namespaces with bridges
- Session persistence to SQLite
- Chat-specific commands, keybindings, and configuration
- Connection health monitoring and graceful degradation

**Excluded**
- Cloud AI providers (OpenAI, Anthropic, Google) — local-only by design
- API key management or authentication flows — not applicable
- MCP (Model Context Protocol) server hosting — deferred to M10+
- Multi-window chat — deferred to M10+
- Chat in editor tabs or inline — Auxiliary Bar only for M9
- Image generation or vision models — backlog (nice to have)
- RAG (Retrieval-Augmented Generation) pipeline — **critical, early milestone** (research Microsoft MarkItDown for file→markdown conversion)
- Fine-tuning or model training — out of scope
- Voice input/output — out of scope
- Telemetry or usage analytics — explicitly prohibited
- Custom chat modes (VS Code supports custom modes via prompt files) — deferred to M10+
- Follow-up suggestions (`provideFollowups()` in VS Code) — **promoted to M9.2 required**
- Session delegation to remote providers (GitHub Copilot Workspace, Azure ML) — not applicable
- Question carousel (interactive inline questions in responses) — deferred to M10+

### Structural Commitments

These invariants are non-negotiable. Every implementation decision must preserve them.

- **Mirror VS Code's service architecture.** The 6 core chat services map 1:1 from VS Code to Parallx with the same boundaries and responsibilities.
- **ILanguageModelProvider abstraction.** Ollama is the first provider behind an interface. Chat code never calls Ollama directly — it goes through `ILanguageModelsService`.
- **Chat lives in the Auxiliary Bar.** No new shell parts. The chat view registers in the existing `auxiliaryBarPart`.
- **Three adapted modes.** Ask (Q&A), Edit (canvas block editing), Agent (autonomous + tool invocation).
- **Participant/Agent model.** Same registration pattern as VS Code's `chatParticipants`. Built-in and tool-contributed participants use identical mechanisms.
- **Streaming-first.** All AI responses stream. The UI renders incrementally — never waits for a complete response.
- **No new npm dependencies.** Fetch API for HTTP. Existing `Emitter<T>`, `Disposable`, `Event<T>` primitives. No AI/LLM libraries.
- **Same DI patterns.** Services registered via `serviceCollection.ts` using `createDecorator<T>()`.
- **Local-only.** No cloud API calls, no telemetry, no data leaves the machine.

### Architectural Principles

- **Service-Driven Chat**: UI is a thin layer over 6 core services. All AI capabilities accessible programmatically.
- **Provider Abstraction**: Language model backends are pluggable. Ollama is implementation, not architecture.
- **Participant Symmetry**: Built-in participants and tool-contributed participants use identical registration.
- **Streaming Protocol**: Response chunks flow through typed content parts with microtask batching. In VS Code, batching coalesces chunks across the IPC boundary; in Parallx (same-process), batching coalesces DOM updates — chunks pushed to a `sendQueue` are flushed via `queueMicrotask()` to avoid per-token re-renders.
- **Confirmation Gates**: Tool invocations require explicit user approval unless auto-approved by policy. VS Code separates this into `ILanguageModelToolsConfirmationService` (4-level auto-approval: global, per-tool, edit-specific, URL-specific). Parallx ships with a single `chat.agent.autoApproveTools` boolean as a deliberate simplification — the confirmation logic lives inside `ILanguageModelToolsService` rather than a separate service.
- **Graceful Degradation**: Missing Ollama = clear setup guidance, not error walls.
- **Four Error Paths**: Errors surface through 4 distinct channels (mirroring VS Code): throw exception (handler crash), return `errorDetails` in result (structured failure), `stream.warning()` (non-fatal warning part), and tool error (tool invocation failure). Each path renders differently in the UI.

### Terminology

VS Code's internal code uses **"Agent"** (`IChatAgentService`, `IChatAgent`, `invokeAgent()`) while the public Extension API uses **"Participant"** (`vscode.chat.createChatParticipant()`). Parallx mirrors this split: service-layer interfaces use `IChatAgentService` / `IChatAgent`, while the `parallx.chat` API surface uses `ChatParticipant`. This document uses both terms — "agent" when discussing service internals, "participant" when discussing the API boundary. They refer to the same thing.

---

## Sub-Milestone Breakdown

| Sub-Milestone | Capabilities | Focus |
|---------------|-------------|-------|
| **M9.0** | 0–3 | Type system + Language model service + Ollama provider + Chat service + Basic UI |
| **M9.1** | 4–6 | Mode system + Participant/Agent registry + Tool invocation framework |
| **M9.2** | 7–9 | Edit mode + Tool API surface + Session persistence + Polish |

Each sub-milestone is independently shippable and testable.

---

## Progress Tracker

| Capability | Title | Tasks | Status | Commit |
|------------|-------|-------|--------|--------|
| **Cap 0** | Type System & Service Interfaces | 0.1–0.4 | ✅ DONE | `9c45066` |
| **Cap 1** | Language Model Provider Abstraction | 1.1–1.3 | ✅ DONE | `9c45066` |
| **Cap 2** | Chat Service Core | 2.1–2.4 | ✅ DONE | `9c45066` |
| **Cap 3** | Chat Built-in Tool & UI | 3.1–3.7 | ✅ DONE | `5c59540` + `23fd223` |
| **Cap 4** | Chat Mode System | 4.1–4.2 | ✅ DONE | `f866946` |
| **Cap 5** | Participant/Agent System | 5.1–5.4 | ✅ DONE | _pending_ |
| **Cap 6** | Tool Invocation Framework | 6.1–6.4 | ✅ DONE | _pending_ |
| **Cap 7** | Edit Mode | 7.1–7.3 | ⬜ TODO | — |
| **Cap 8** | Tool API Surface | 8.1–8.3 | ⬜ TODO | — |
| **Cap 9** | Session Persistence, Commands & Polish | 9.1–9.5 | ⬜ TODO | — |

| Sub-Milestone | Status | Tests |
|---------------|--------|-------|
| **M9.0** (Cap 0–3) | ✅ DONE | 49 new tests (parser 12, agent 10, service 18, ollama 9) |
| **M9.1** (Cap 4–6) | ✅ DONE | 63 new tests (mode caps 12, system prompts 23, workspace participant 10, canvas participant 15+, tools service 19, agentic loop 7, built-in tools 17) |
| **M9.2** (Cap 7–9) | ⬜ TODO | — |

**Total project tests:** 985 passing (38 files) · `tsc --noEmit` clean

---

## Architecture & Design Decisions

### VS Code → Parallx Service Mapping

VS Code's chat system has 6 core singleton services. Parallx mirrors each one:

> **Note on VS Code file paths:** VS Code's chat codebase has been reorganized into subdirectories (e.g., `chatService/chatService.ts`, `model/chatModel.ts`, `widget/chatWidget.ts`). All paths below reflect the latest structure under `src/vs/workbench/contrib/chat/`.

| VS Code Service | Parallx Service | File | Responsibility |
|----------------|-----------------|------|----------------|
| `IChatService` | `IChatService` | `services/chatService.ts` | Session lifecycle, message storage, sendRequest() |
| `IChatAgentService` | `IChatAgentService` | `services/chatAgentService.ts` | Participant registry, invokeAgent(), default agent |
| `IChatModeService` | `IChatModeService` | `services/chatModeService.ts` | Mode registry (Ask/Edit/Agent), mode capabilities |
| `ILanguageModelsService` | `ILanguageModelsService` | `services/languageModelsService.ts` | Provider registry, model selection, sendChatRequest() |
| `IChatWidgetService` | `IChatWidgetService` | `services/chatWidgetService.ts` | Widget registry, getWidgetBySessionId() |
| `ILanguageModelToolsService` | `ILanguageModelToolsService` | `services/languageModelToolsService.ts` | Tool registry, invokeTool(), confirmation gates |

**VS Code also has these supplementary services** (not mirrored as separate services in Parallx):
- `ILanguageModelToolsConfirmationService` — Manages approval dialogs and auto-approval policies. In Parallx, confirmation logic is folded into `ILanguageModelToolsService` as a deliberate simplification.
- `IChatSessionsService` — Manages session list, background sessions, and session lifecycle events (separate from `IChatService`). In Parallx, session management lives within `IChatService`.
- `IChatViewModel` — View model layer between `IChatModel` and `ChatWidget`. Parallx omits this layer; the widget reads from the session model directly.

### Request Flow

> **Stream ownership:** `IChatService.sendRequest()` creates the `ChatResponseStream` instance and passes it to `IChatAgentService.invokeAgent()`. The agent handler receives the stream pre-wired to the response model — writing to the stream mutates the response that the widget observes. This mirrors VS Code where `ExtHostChatAgents2` creates `ChatAgentResponseStream` before calling the handler.

```
User types message
        │
        ▼
ChatWidget.acceptInput()
        │
        ▼
ChatRequestParser
  ├─ extracts @participant mentions
  ├─ extracts /slash commands
  └─ extracts #variable references
        │
        ▼
IChatService.sendRequest(sessionId, message, options)
        │
        ▼
IChatAgentService.invokeAgent(participantId, request, context)
        │
        ▼
Agent handler runs
  ├─ calls ILanguageModelsService.sendChatRequest(messages, options)
  │       │
  │       ▼
  │   ILanguageModelProvider (Ollama)
  │       │
  │       ▼
  │   POST /api/chat → streaming response
  │
  ├─ may invoke tools via ILanguageModelToolsService
  │       │
  │       ▼
  │   Tool confirmation → execution → result
  │
  └─ streams response chunks back
        │
        ▼
ChatWidget renders incrementally
  ├─ markdown content
  ├─ tool invocation cards
  ├─ progress indicators
  └─ thinking blocks
```

### Ollama REST API Surface

Parallx targets Ollama (`localhost:11434`) as its local AI backend. These are the endpoints used:

| Endpoint | Method | Purpose | Used By |
|----------|--------|---------|---------|
| `/api/chat` | POST | Streaming chat completions with message history + tool calling | `OllamaProvider.sendChatRequest()` |
| `/api/tags` | GET | List locally available models | `OllamaProvider.listModels()` |
| `/api/show` | POST | Model info (family, parameters, capabilities, context length) | `OllamaProvider.getModelInfo()` |
| `/api/ps` | GET | List currently loaded/running models | Health monitor |
| `/api/version` | GET | Ollama version (connectivity check) | `OllamaProvider.checkAvailability()` |

**Chat request shape** (POST `/api/chat`):
```json
{
    "model": "llama3.2",
    "messages": [
        { "role": "system", "content": "You are a helpful assistant." },
        { "role": "user", "content": "Why is the sky blue?" }
    ],
    "stream": true,
    "tools": [{ "type": "function", "function": { "name": "search_workspace", "description": "...", "parameters": {...} } }]
}
```

**Streaming response** (one JSON object per line, newline-delimited):
```json
{ "model": "llama3.2", "message": { "role": "assistant", "content": "The" }, "done": false }
{ "model": "llama3.2", "message": { "role": "assistant", "content": " sky" }, "done": false }
{ "model": "llama3.2", "message": { "role": "assistant", "content": "" }, "done": true, "eval_count": 259, "eval_duration": 4232710000 }
```

**Tool call response** (model requests tool invocation):
```json
{
    "message": {
        "role": "assistant",
        "content": "",
        "tool_calls": [{ "function": { "name": "search_workspace", "arguments": { "query": "project goals" } } }]
    },
    "done": false
}
```

**Tool result** (fed back to model as next message):
```json
{ "role": "tool", "content": "Found 3 pages matching 'project goals'...", "tool_name": "search_workspace" }
```

**List models response** (GET `/api/tags`):
```json
{
    "models": [{
        "name": "llama3.2:latest",
        "model": "llama3.2:latest",
        "size": 2019393189,
        "details": { "family": "llama", "parameter_size": "3.2B", "quantization_level": "Q4_K_M" }
    }]
}
```

**Model info response** (POST `/api/show`):
```json
{
    "details": { "family": "llama", "parameter_size": "8.0B", "quantization_level": "Q4_0" },
    "model_info": { "llama.context_length": 8192, "llama.embedding_length": 4096 },
    "capabilities": ["completion", "tools"]
}
```

### Content Part Types

VS Code renders typed content parts in chat responses. Parallx implements the same set:

| Content Part | VS Code Type | Parallx Type | Description |
|-------------|-------------|-------------|-------------|
| Markdown | `markdownContent` | `IChatMarkdownContent` | Rendered markdown text |
| Code block | `codeblockUri` | `IChatCodeBlockContent` | Syntax-highlighted code with copy button |
| Tool invocation | `toolInvocation` | `IChatToolInvocationContent` | Shows tool call + result with confirmation UI. Fields include `toolCallId`, `toolName`, `args`, `status`, `isConfirmed`, `isComplete`, `isError`, `result?`, `toolSpecificData?` |
| Progress | `progressMessage` | `IChatProgressContent` | "Searching workspace..." style status |
| Thinking | `thinking` | `IChatThinkingContent` | Collapsible reasoning block (for thinking models). VS Code tracks a `thinkingId` to coalesce incremental thinking chunks |
| Reference | `inlineReference` | `IChatReferenceContent` | Clickable link to a page, block, or file |
| Warning | `warning` | `IChatWarningContent` | Caution/warning message |
| Confirmation | `confirmation` | `IChatConfirmationContent` | Accept/reject buttons for tool execution |

### Chat Modes

| Mode | VS Code Behavior | Parallx Adaptation |
|------|-----------------|-------------------|
| **Ask** | Q&A only, no side effects | Q&A about workspace content, general knowledge. No tool invocation. |
| **Edit** | Multi-file code edits with diffs | Canvas page/block editing — AI proposes block insertions, text changes, property edits. User accepts/rejects. |
| **Agent** | Autonomous with tool invocation | AI invokes registered tools (search, read, create pages) with confirmation gates. Full agentic loop. |

### File Structure

```
src/
├── services/
│   ├── chatTypes.ts               # All chat/LM type definitions and service interfaces
│   ├── chatService.ts             # IChatService implementation
│   ├── chatAgentService.ts        # IChatAgentService implementation
│   ├── chatModeService.ts         # IChatModeService implementation
│   ├── chatWidgetService.ts       # IChatWidgetService implementation
│   ├── languageModelsService.ts   # ILanguageModelsService implementation
│   └── languageModelToolsService.ts # ILanguageModelToolsService implementation
│
├── built-in/
│   └── chat/                      # Chat built-in (Auxiliary Bar view)
│       ├── manifest.json          # Tool manifest for registration
│       ├── chatTool.ts            # Tool activation + service wiring
│       ├── chatView.ts            # Main chat view (registers in Auxiliary Bar)
│       ├── chatWidget.ts          # ChatWidget — message list + input
│       ├── chatInputPart.ts       # Chat input area with mode/model pickers
│       ├── chatListRenderer.ts    # Virtualized message rendering
│       ├── chatContentParts.ts    # Content part renderers (markdown, code, etc.)
│       ├── chatRequestParser.ts   # Extract @mentions, /commands, #variables from input
│       ├── chatModePicker.ts      # Ask/Edit/Agent mode selector
│       ├── chatModelPicker.ts     # Model selection dropdown
│       ├── chatActions.ts         # Chat-specific commands/actions
│       ├── chatView.css           # Chat view styles
│       ├── chatWidget.css         # Widget styles
│       ├── chatInput.css          # Input area styles
│       ├── providers/
│       │   └── ollamaProvider.ts  # ILanguageModelProvider for Ollama
│       └── participants/
│           ├── defaultParticipant.ts    # Default chat agent (no @mention)
│           ├── workspaceParticipant.ts  # @workspace — search, read pages
│           └── canvasParticipant.ts     # @canvas — block operations
│
├── api/
│   ├── parallx.d.ts               # Updated with parallx.lm + parallx.chat namespaces
│   └── bridges/
│       ├── chatBridge.ts          # parallx.chat API bridge
│       └── languageModelBridge.ts # parallx.lm API bridge
```

### Layered Architecture (Updated)

```
┌─────────────────────────────────────────────────┐
│                   workbench/                     │  ← Composition root
│          (orchestrates everything)               │
├─────────────────────────────────────────────────┤
│                   services/                      │  ← Service layer
│  chatService, chatAgentService, chatModeService  │
│  languageModelsService, languageModelToolsService│
│  chatWidgetService                               │
├────────┬────────┬────────┬────────┬─────────────┤
│ parts/ │ views/ │editor/ │  dnd/  │  commands/   │  ← Feature modules
│        │        │        │        │  context/    │
│        │        │        │        │  workspace/  │
├────────┴────────┴────────┴────────┴─────────────┤
│                   layout/                        │  ← Layout engine
├─────────────────────────────────────────────────┤
│                  platform/                       │  ← Foundation
│  (events, lifecycle, storage, instantiation)     │
└─────────────────────────────────────────────────┘

┌─────────────────────────────────────────────────┐
│                built-in/chat/                    │  ← Chat tool (uses parallx API)
│  chatWidget, chatView, participants, providers   │
│  (consumes services through interfaces only)     │
└─────────────────────────────────────────────────┘
```

### Absolute Prohibitions

- **No circular dependencies.** If module A imports from module B, module B must not import from module A.
- **No upward dependencies.** Lower layers (`platform/`, `layout/`) never import from higher layers.
- **No direct Ollama calls from chat code.** All AI communication goes through `ILanguageModelsService` → `ILanguageModelProvider`.
- **No cloud API support.** No configuration for remote endpoints, API keys, or external authentication.
- **No new npm dependencies.** Fetch API for HTTP. Existing primitives for everything else.

---

## Capability 0 — Chat Type System & Service Interfaces ✅

### Capability Description

The system defines all shared type definitions and service interfaces for the chat domain. Types are pure data — no runtime dependencies, no service imports. Service interfaces define the contracts that Capabilities 1–6 implement. This phase produces only TypeScript types and interfaces.

### Goals

- All chat-domain types defined in a single file (`chatTypes.ts`)
- Service interfaces defined alongside their types (not in separate files)
- Type definitions are self-contained — no imports from service implementations
- Types match VS Code's shapes where applicable (session, message, content parts, participant, tool)
- Service identifiers created via `createDecorator<T>()` following existing DI pattern

### Conceptual Responsibilities

- Define provider types (model info, provider status, request/response shapes)
- Define session types (session, message pair, user message, assistant response)
- Define content part types (markdown, code, tool invocation, progress, thinking, reference, warning, confirmation)
- Define mode types (Ask, Edit, Agent enum)
- Define participant types (participant descriptor, handler signature, response stream, result)
- Define tool types (definition, call, result)
- Define all 6 service interfaces with their methods and events
- Create DI service identifiers

### Dependencies

None — this is prerequisite work.

### VS Code Reference

- `src/vs/workbench/contrib/chat/common/model/chatModel.ts` — `IChatRequestModel`, `IChatResponseModel`, `IChatModel` (session model)
- `src/vs/workbench/contrib/chat/common/chatService/chatService.ts` — `IChatService` interface, `IChatSendRequestOptions`
- `src/vs/workbench/contrib/chat/common/chatAgents.ts` — `IChatAgentService`, `IChatAgentImplementation`, `IChatAgent`
- `src/vs/workbench/contrib/chat/common/chatModes.ts` — `IChatMode`, `IChatModeService`, `ChatModeKind` enum
- `src/vs/workbench/contrib/chat/common/languageModels.ts` — `ILanguageModelsService`, `ILanguageModelChatMetadata`
- `src/vs/workbench/contrib/chat/common/tools/languageModelToolsService.ts` — `ILanguageModelToolsService`, `IToolData`, `IToolInvocation`
- `src/vs/workbench/contrib/chat/common/tools/languageModelToolsConfirmationService.ts` — `ILanguageModelToolsConfirmationService` (separate from tools service)
- `src/vs/workbench/contrib/chat/common/constants.ts` — `ChatModeKind` enum values, configuration keys
- `src/vs/workbench/contrib/chat/common/model/chatUri.ts` — Session URI schemes (`vscode-local-chat-session:///<uuid>`)
- `src/vs/workbench/api/common/extHostTypes.ts` — `ChatResponseStream` methods enum
- DeepWiki: [Chat System Architecture](https://deepwiki.com/microsoft/vscode/8.1-chat-system-architecture) — Core Services, Types, Session model

#### Tasks

**Task 0.1 — Define Provider & Message Types** ✅
- **Task Description:** Define all types related to language model providers, chat messages, and request/response shapes in `src/services/chatTypes.ts`.
- **Output:** TypeScript interfaces for `ILanguageModelInfo`, `IProviderStatus`, `IChatMessage`, `IChatRequestOptions`, `IChatResponseChunk`.
- **Completion Criteria:**
  - `ILanguageModelInfo` includes: `id`, `displayName`, `family`, `parameterSize`, `quantization`, `contextLength`, `capabilities[]`
  - `IProviderStatus` includes: `available`, `version?`, `error?`
  - `IChatMessage` includes: `role` (system/user/assistant/tool), `content`, `toolCalls?`, `toolName?`, `thinking?`
  - `IChatRequestOptions` includes: `temperature?`, `topP?`, `maxTokens?`, `tools?`, `format?`, `seed?`, `think?`
  - `IChatResponseChunk` includes: `content`, `thinking?`, `toolCalls?`, `done`, `evalCount?`, `evalDuration?`
  - Types match Ollama's API shapes (documented in Architecture section above)
- **Notes / Constraints:**
  - Reference only: `src/vs/workbench/contrib/chat/common/languageModels.ts` — `ILanguageModelChatMessage`, `ILanguageModelChatResponsePart`
  - `IChatMessage.role` uses the same 4 roles Ollama uses: `system`, `user`, `assistant`, `tool`
  - `IChatResponseChunk` maps 1:1 to Ollama's streaming JSON objects

**Task 0.2 — Define Session & Content Part Types** ✅
- **Task Description:** Define all session lifecycle types and the discriminated union of content part types.
- **Output:** TypeScript interfaces for sessions, request/response pairs, and all 8 content part types.
- **Completion Criteria:**
  - `IChatSession` includes: `id`, `sessionResource` (URI object with scheme `parallx-chat-session`, format: `parallx-chat-session:///<uuid>`), `createdAt`, `title`, `mode`, `modelId`, `messages[]`, `requestInProgress`
  - `IChatRequestResponsePair` includes: `request: IChatUserMessage`, `response: IChatAssistantResponse`
  - `IChatUserMessage` includes: `text`, `participantId?`, `command?`, `variables?[]`, `timestamp`
  - `IChatAssistantResponse` includes: `parts[]`, `isComplete`, `modelId`, `timestamp`
  - `ChatContentPartKind` enum with 8 values: Markdown, CodeBlock, ToolInvocation, Progress, Thinking, Reference, Warning, Confirmation
  - `IChatContentPart` discriminated union type covering all 8 kinds
  - Each content part interface has a `kind` discriminant + part-specific fields
  - `ChatMode` enum: Ask, Edit, Agent
- **Notes / Constraints:**
  - Reference only: `src/vs/workbench/contrib/chat/common/model/chatModel.ts` — `ChatResponsePart` union type, `IChatResponseModel`
  - Content part `kind` field enables `switch` exhaustiveness checking
  - `IChatMarkdownContent`: `{ kind, content: string }`
  - `IChatCodeBlockContent`: `{ kind, code: string, language?: string }`
  - `IChatToolInvocationContent`: `{ kind, toolCallId: string, toolName: string, args: Record<string, unknown>, status: 'pending'|'running'|'completed'|'rejected', isConfirmed?: boolean, isComplete?: boolean, isError?: boolean, result?: IToolResult, toolSpecificData?: unknown }`
  - `IChatProgressContent`: `{ kind, message: string }`
  - `IChatThinkingContent`: `{ kind, content: string, isCollapsed: boolean }`
  - `IChatReferenceContent`: `{ kind, uri: string, label: string }`
  - `IChatWarningContent`: `{ kind, message: string }`
  - `IChatConfirmationContent`: `{ kind, message: string, data: unknown, isAccepted?: boolean }`

**Task 0.3 — Define Participant & Tool Types** ✅
- **Task Description:** Define participant (agent) types and tool invocation types.
- **Output:** TypeScript interfaces for participants, handlers, response stream, and tool definitions.
- **Completion Criteria:**
  - `IChatParticipant` includes: `id`, `displayName`, `description`, `iconPath?`, `commands[]`, `handler`
  - `IChatParticipantHandler` signature: `(request, context, response, token) => Promise<IChatParticipantResult>`
  - `IChatParticipantRequest` includes: `text`, `requestId` (UUID for cancellation/retry tracking), `command?`, `variables?[]`, `mode`, `modelId`, `attempt` (retry count, starting at 0)
  - `IChatParticipantContext` includes: `history[]` (previous request/response pairs)
  - `IChatResponseStream` interface with methods: `markdown()`, `codeBlock()`, `progress()`, `reference()`, `thinking()`, `warning()`, `button()`, `confirmation()`, `beginToolInvocation(toolCallId, toolName, data?)`, `updateToolInvocation(toolCallId, data)`, `push()`
  - Stream has a `throwIfDone()` guard — writing to a closed stream throws `Error('Stream is closed')`. This prevents participants from writing to a response after it has been finalized or cancelled (mirrors VS Code's safety pattern).
  - `IChatParticipantResult` includes: `errorDetails?` (`{ message: string, responseIsIncomplete?: boolean, responseIsFiltered?: boolean }`), `metadata?` (opaque result data)
  - `IChatCommand` includes: `name`, `description`
  - `IToolDefinition` includes: `name`, `description`, `parameters` (JSON Schema object)
  - `IToolCall` includes: `function: { name, arguments }`
  - `IToolResult` includes: `content`, `isError?`
  - `IChatTool` includes: `name`, `description`, `parameters`, `handler: (args, token) => Promise<IToolResult>`, `requiresConfirmation`
- **Notes / Constraints:**
  - Reference only: `src/vs/workbench/contrib/chat/common/chatAgents.ts` — `IChatAgentImplementation`, `IChatAgentCommand`, `IChatAgentRequest` (includes `sessionResource`, `requestId`, `attempt`, `location`, `mode`)
  - Reference only: `src/vs/workbench/api/common/extHostTypes.ts` — `ChatResponseStream` class methods (includes `beginToolInvocation()`, `updateToolInvocation()`)
  - Reference only: `src/vs/workbench/contrib/chat/common/tools/languageModelToolsService.ts` — `IToolData` (includes `id`, `displayName`, `modelDescription`, `inputSchema`), `IToolInvocation`
  - Handler signature mirrors VS Code: `vscode.chat.createChatParticipant(id, handler)` where handler is `(request, context, response, token)`
  - `IChatResponseStream` methods each create/update a content part in the active response

**Task 0.4 — Define Service Interfaces & DI Identifiers** ✅
- **Task Description:** Define all 7 service interfaces (6 chat services + 1 provider interface) and create their DI service identifiers.
- **Output:** TypeScript interfaces and `createDecorator<T>()` calls at the bottom of `chatTypes.ts`.
- **Completion Criteria:**
  - `ILanguageModelProvider` interface: `id`, `displayName`, `listModels()`, `checkAvailability()`, `sendChatRequest()`, `getModelInfo()`
  - `ILanguageModelsService` interface: `onDidChangeProviders`, `onDidChangeModels`, `registerProvider()`, `getProviders()`, `getModels()`, `getActiveModel()`, `setActiveModel()`, `sendChatRequest()`, `checkStatus()`
  - `IChatService` interface: `onDidCreateSession`, `onDidDeleteSession`, `onDidChangeSession`, `createSession()`, `deleteSession()`, `getSession()`, `getSessions()`, `sendRequest()`
  - `IChatAgentService` interface: `onDidChangeAgents`, `registerAgent()`, `getAgents()`, `getAgent()`, `getDefaultAgent()`, `invokeAgent()`
  - `IChatModeService` interface: `onDidChangeMode`, `getMode()`, `setMode()`, `getAvailableModes()`
  - `IChatWidgetService` interface: `onDidAddWidget`, `onDidRemoveWidget`, `registerWidget()`, `getWidget()`, `getWidgets()`
  - `ILanguageModelToolsService` interface: `onDidChangeTools`, `registerTool()`, `getTools()`, `getTool()`, `invokeTool()`
  - All 6 service interfaces have DI identifiers: `ILanguageModelsService = createDecorator<ILanguageModelsService>('languageModelsService')`, etc.
  - `ILanguageModelProvider` is NOT a DI service — it's an interface implementations register with `ILanguageModelsService`
- **Notes / Constraints:**
  - Reference only: `src/vs/workbench/contrib/chat/common/chatService/chatService.ts` — `IChatService` interface shape, `IChatSendRequestOptions` (includes `noCommandDetection`, `enableImplicitContext`)
  - Reference only: `src/vs/workbench/contrib/chat/common/chatAgents.ts` — `IChatAgentService` interface shape, `IChatAgentResult` (includes `errorDetails?`, `timings?`, `metadata?`)
  - Reference only: `src/vs/workbench/contrib/chat/common/languageModels.ts` — `ILanguageModelsService` interface shape
  - Follow the exact pattern in `src/services/serviceTypes.ts` for DI identifiers
  - All event properties use `Event<T>` from `platform/events.ts`
  - All return types use `IDisposable` for cleanup from registration methods

---

## Capability 1 — Language Model Provider Abstraction ✅

### Capability Description

The system can discover, connect to, and communicate with local AI model providers through a pluggable abstraction. The `ILanguageModelsService` manages provider registration, model enumeration, active model selection, and delegates chat requests to the appropriate provider. The Ollama provider is the first (and initially only) implementation.

### Goals

- Language model backends are pluggable — chat code never calls a specific backend directly
- Ollama provider connects to `localhost:11434` and maps its REST API to the provider interface
- Models are enumerated from the provider and the user can select one
- Chat requests stream token-by-token via `AsyncIterable<IChatResponseChunk>`
- Health monitoring detects availability changes and emits events
- Graceful degradation when Ollama is not running

### Conceptual Responsibilities

- Register and manage language model providers
- Aggregate models from all registered providers
- Track the user's active model selection
- Delegate chat completion requests to the correct provider
- Monitor provider availability on a polling interval
- Translate Ollama's REST API shapes into Parallx's type system

### Dependencies

- Capability 0 (Type System & Service Interfaces)

### VS Code Reference

- `src/vs/workbench/contrib/chat/common/languageModels.ts` — `ILanguageModelsService`, `ILanguageModelChatMetadata`, provider registration pattern
- `src/vs/workbench/api/common/extHostLanguageModels.ts` — `ExtHostLanguageModels`: `$selectChatModels()`, aggregator pattern
- DeepWiki: [Chat System Architecture](https://deepwiki.com/microsoft/vscode/8.1-chat-system-architecture) — Language Model Service, Provider Registration

#### Tasks

**Task 1.1 — Implement Language Models Service** ✅
- **Task Description:** Implement `ILanguageModelsService` as a singleton service that manages providers, models, and request delegation.
- **Output:** `LanguageModelsService` class in `src/services/languageModelsService.ts`.
- **Completion Criteria:**
  - Implements `ILanguageModelsService` interface from `chatTypes.ts`
  - `registerProvider(provider)` stores provider; returns `IDisposable` for removal; fires `onDidChangeProviders`
  - `getModels()` aggregates models from all registered providers via `provider.listModels()`
  - `getActiveModel()` / `setActiveModel(modelId)` tracks user's model selection; fires `onDidChangeModels`
  - `sendChatRequest(messages, options)` resolves the active model's provider and delegates; throws if no model selected
  - `checkStatus()` calls `checkAvailability()` on the first provider (Ollama) and returns the result
  - Service identifier: `ILanguageModelsService = createDecorator<ILanguageModelsService>('languageModelsService')`
  - Registered as singleton in DI container via `workbenchServices.ts`
- **Notes / Constraints:**
  - Reference only: `src/vs/workbench/contrib/chat/common/languageModels.ts` — registration via `registerLanguageModelChat()`, model selection via `selectChatModels()`
  - Provider map keyed by `provider.id`; model map keyed by `model.id` linking back to source provider
  - `sendChatRequest()` returns `AsyncIterable<IChatResponseChunk>` — it re-yields from the provider's async generator
  - Error handling: wrap provider calls in try/catch, emit clear errors for connection failures

**Task 1.2 — Implement Ollama Provider** ✅
- **Task Description:** Implement `ILanguageModelProvider` for Ollama's REST API with streaming support.
- **Output:** `OllamaProvider` class in `src/built-in/chat/providers/ollamaProvider.ts`.
- **Completion Criteria:**
  - `id: 'ollama'`, `displayName: 'Ollama'`
  - Constructor accepts `baseUrl` (default: `http://localhost:11434`)
  - `checkAvailability()` → `GET /api/version`; returns `{ available: true, version: string }` on success; `{ available: false, error: string }` on connection refused
  - `listModels()` → `GET /api/tags`; maps `response.models[]` to `ILanguageModelInfo[]` (extracting `name`, `details.family`, `details.parameter_size`, `details.quantization_level`)
  - `getModelInfo(modelId)` → `POST /api/show` with `{ model: modelId }`; extracts `model_info["*.context_length"]`, `capabilities[]`, detailed metadata
  - `sendChatRequest(modelId, messages, options)` → `POST /api/chat` with `{ model, messages, stream: true, tools?, options: { temperature, top_p, seed } }`
    - Uses `fetch()` with `ReadableStream` reader
    - Splits response on newlines, parses each line as JSON
    - Yields `IChatResponseChunk` for each parsed object
    - Handles `tool_calls` field in response chunks
    - Handles `thinking` field for reasoning models (e.g., DeepSeek-R1)
    - Accepts `AbortSignal` for cancellation
  - All fetch calls use `AbortSignal` with configurable timeout (default: 60s for chat, 10s for metadata)
- **Notes / Constraints:**
  - Reference only: Ollama API docs — https://github.com/ollama/ollama/blob/main/docs/api.md (key endpoints documented in Architecture section above)
  - Streaming pattern using `async function*`:
    ```typescript
    async function* streamOllamaChat(url: string, body: object, signal: AbortSignal): AsyncIterable<IChatResponseChunk> {
        const response = await fetch(url, { method: 'POST', body: JSON.stringify(body), signal });
        const reader = response.body!.getReader();
        const decoder = new TextDecoder();
        let buffer = '';
        while (true) {
            const { done, value } = await reader.read();
            if (done) break;
            buffer += decoder.decode(value, { stream: true });
            const lines = buffer.split('\n');
            buffer = lines.pop() || '';
            for (const line of lines) {
                if (line.trim()) yield parseChunk(JSON.parse(line));
            }
        }
    }
    ```
  - Ollama tool calling: pass `tools` array in request body, model responds with `message.tool_calls[]`
  - Context length extracted from `model_info["llama.context_length"]` or similar family-prefixed key
  - No npm packages — raw `fetch()` calls only

**Task 1.3 — Implement Connection Health Monitor** ✅
- **Task Description:** Implement a polling health monitor that tracks Ollama availability and loaded models.
- **Output:** Health monitoring logic within `OllamaProvider` or as a separate `OllamaHealthMonitor` class.
- **Completion Criteria:**
  - Polls `checkAvailability()` on configurable interval (default: 30s when connected, 5s after failure)
  - Emits `onDidChangeStatus` event when availability transitions (connected→disconnected or vice versa)
  - Polls `GET /api/ps` to track which models are currently loaded in memory
  - Stops polling when disposed
  - Initial check runs immediately on creation
- **Notes / Constraints:**
  - Reference only: VS Code polls extension hosts for liveness — similar pattern
  - Use `setInterval` + `clearInterval` with dynamic interval adjustment
  - Exponential backoff consideration: after repeated failures, slow polling to 60s to avoid noise

---

## Capability 2 — Chat Service Core ✅

### Capability Description

The system manages chat sessions, dispatches requests to participants, tracks conversation history, and provides mode management. This is the "brain" of the chat system — the services that the UI layer consumes.

### Goals

- Sessions are created, stored in memory, and queryable by ID
- Sending a request orchestrates the full pipeline: parse → dispatch → stream → store
- Modes determine per-request capabilities (tools available, system prompt shape)
- Agent dispatch routes to the correct participant based on @mentions
- Widget service tracks active chat UI instances

### Conceptual Responsibilities

- Session lifecycle (create, delete, list, get)
- Request orchestration (build message, invoke agent, stream response, update session)
- Mode state (Ask/Edit/Agent selection, capabilities per mode)
- Agent registry (register, lookup, invoke participants)
- Widget registry (track which widget shows which session)

### Dependencies

- Capability 0 (Type System & Service Interfaces)
- Capability 1 (Language Model Provider Abstraction)

### VS Code Reference

- `src/vs/workbench/contrib/chat/common/chatService/chatService.ts` — `ChatService`: session store, `sendRequest()`, response model creation
- `src/vs/workbench/contrib/chat/common/chatAgents.ts` — `ChatAgentService`: `invokeAgent()`, agent registry, default agent resolution
- `src/vs/workbench/contrib/chat/common/chatModes.ts` — `ChatModeService`: mode registry, `ChatModeKind` enum (`Ask = 'ask'`, `Edit = 'edit'`, `Agent = 'agent'`)
- `src/vs/workbench/contrib/chat/browser/widget/chatWidgetService.ts` — `ChatWidgetService` (simple map of sessionId → widget)
- `src/vs/workbench/contrib/chat/common/constants.ts` — Mode enum values and configuration keys
- DeepWiki: [Chat System Architecture](https://deepwiki.com/microsoft/vscode/8.1-chat-system-architecture) — Chat Service, Session Model, Agent Dispatch
- DeepWiki: [Chat Modes and Sessions](https://deepwiki.com/microsoft/vscode/8.5-chat-modes-and-sessions) — Mode switching validation, session lifecycle states

#### Tasks

**Task 2.1 — Implement Chat Service** ✅
- **Task Description:** Implement `IChatService` for session lifecycle and request orchestration.
- **Output:** `ChatService` class in `src/services/chatService.ts`.
- **Completion Criteria:**
  - `createSession(mode, modelId?)` creates a new session with UUID, empty message list, fires `onDidCreateSession`
  - `deleteSession(sessionId)` removes session from store, fires `onDidDeleteSession`
  - `getSession(sessionId)` returns session by ID or undefined
  - `getSessions()` returns all sessions (readonly)
  - `sendRequest(sessionId, message, options?)` orchestrates the full pipeline:
    1. Creates `IChatUserMessage` from input text
    2. Creates empty `IChatAssistantResponse` with `isComplete: false`
    3. Appends `{ request, response }` pair to session
    4. Fires `onDidChangeSession`
    5. Calls `IChatAgentService.invokeAgent()` with the resolved participant
    6. As response stream yields chunks, updates `response.parts[]` and fires `onDidChangeSession`
    7. Sets `response.isComplete = true` when done
  - Session title auto-generated from first user message (truncated to ~50 chars)
  - Consumes `IChatAgentService` and `IChatModeService` through DI
  - Service identifier: `IChatService = createDecorator<IChatService>('chatService')`
- **Notes / Constraints:**
  - Reference only: `src/vs/workbench/contrib/chat/common/chatService/chatService.ts` — `ChatService.sendRequest()` creates `ChatRequestModel` → creates `ChatResponseStream` (wired to response model) → invokes agent with pre-wired stream → receives `ChatResponseModel`
  - Session store is a `Map<string, IChatSession>` — no persistence in M9.0 (added in M9.2)
  - Response updates use mutable backing object (even though interface is readonly) — same pattern VS Code uses with `ChatResponseModel`
  - Cancellation: pass `CancellationToken` through to agent → provider; chat UI provides "Stop" button

**Task 2.2 — Implement Chat Agent Service** ✅
- **Task Description:** Implement `IChatAgentService` for participant registration and request dispatch.
- **Output:** `ChatAgentService` class in `src/services/chatAgentService.ts`.
- **Completion Criteria:**
  - `registerAgent(participant)` stores participant keyed by `participant.id`; returns `IDisposable`; fires `onDidChangeAgents`
  - `getAgents()` returns all registered participants (readonly)
  - `getAgent(id)` returns participant by ID or undefined
  - `getDefaultAgent()` returns the participant with `id === 'parallx.chat.default'` (the fallback)
  - `invokeAgent(participantId, request, context, response, token)` resolves participant, calls `participant.handler(request, context, response, token)`, returns result
  - Throws clear error if participant not found
  - Service identifier: `IChatAgentService = createDecorator<IChatAgentService>('chatAgentService')`
- **Notes / Constraints:**
  - Reference only: `src/vs/workbench/contrib/chat/common/chatAgents.ts` — `ChatAgentService.invokeAgent()` resolves agent, wraps handler invocation
  - Default agent is the one registered by the chat built-in tool (Capability 3). It handles messages when no `@mention` is specified
  - Agent errors are caught and converted to error content parts — never crash the chat session

**Task 2.3 — Implement Chat Mode Service** ✅
- **Task Description:** Implement `IChatModeService` for mode state management.
- **Output:** `ChatModeService` class in `src/services/chatModeService.ts`.
- **Completion Criteria:**
  - `getMode()` returns current mode (default: `ChatMode.Ask`)
  - `setMode(mode)` updates current mode; fires `onDidChangeMode`
  - `getAvailableModes()` returns all three modes: `[Ask, Edit, Agent]`
  - Service identifier: `IChatModeService = createDecorator<IChatModeService>('chatModeService')`
- **Notes / Constraints:**
  - Reference only: `src/vs/workbench/contrib/chat/common/chatModes.ts` — `ChatModeService` maintains mode registry and current selection.
  - **Mode switching validation:** When the user switches modes and the session has existing requests, check compatibility. Ask ↔ Edit switching is generally compatible; switching to/from Agent may require clearing the session (because tool availability changes). If clearing is needed, show a confirmation dialog before proceeding. If the user cancels, keep the current mode. If the session is empty, switch immediately with no dialog. This mirrors VS Code's `handleModeSwitch()` in `chatActions.ts`.

**Task 2.4 — Implement Chat Widget Service** ✅
- **Task Description:** Implement `IChatWidgetService` for tracking active chat widget instances.
- **Output:** `ChatWidgetService` class in `src/services/chatWidgetService.ts`.
- **Completion Criteria:**
  - `registerWidget(widget)` stores widget; returns `IDisposable`; fires `onDidAddWidget`
  - `getWidget(sessionId)` returns the widget currently showing that session
  - `getWidgets()` returns all registered widgets (readonly)
  - Disposal fires `onDidRemoveWidget`
  - Service identifier: `IChatWidgetService = createDecorator<IChatWidgetService>('chatWidgetService')`
- **Notes / Constraints:**
  - Reference only: `src/vs/workbench/contrib/chat/browser/chat.ts` — `IChatWidgetService` is a simple map
  - M9.0 will only have one widget (the Auxiliary Bar chat), but the service supports multiple for future expansion

---

## Capability 3 — Chat Built-in Tool & UI ✅

### Capability Description

The system provides a chat UI in the Auxiliary Bar that allows users to converse with local AI models. The chat is registered as a built-in tool (like Canvas, Explorer, etc.) following the same manifest + activation pattern. The UI includes a message list, input area, model picker, and mode selector.

### Goals

- Chat registers as a built-in tool using the existing tool manifest system
- Chat view appears in the Auxiliary Bar with an activity bar icon
- Widget renders user messages and streaming assistant responses
- Input area supports multi-line text, model selection, and mode switching
- Content parts (markdown, code blocks, progress, thinking) render correctly
- Empty state guides the user when no session exists or Ollama is offline
- Streaming responses update the UI incrementally

### Conceptual Responsibilities

- Tool manifest and activation function
- Chat view registration in the Auxiliary Bar
- Chat widget orchestration (message list + input)
- Input handling (submit, newline, stop)
- Message rendering with typed content parts
- Markdown rendering (basic inline markdown)
- Model picker and mode picker UI
- Auto-scroll with "scroll to bottom" button

### Dependencies

- Capability 1 (Language Model Provider Abstraction — for model listing and chat requests)
- Capability 2 (Chat Service Core — for sessions, dispatch, and mode)

### VS Code Reference

- `src/vs/workbench/contrib/chat/browser/widget/chatWidget.ts` — `ChatWidget`: widget layout (list + input), `acceptInput()`, session binding
- `src/vs/workbench/contrib/chat/browser/widget/input/chatInputPart.ts` — `ChatInputPart`: input editor, model picker, mode picker, toolbar
- `src/vs/workbench/contrib/chat/browser/chatListRenderer.ts` — `ChatListRenderer`: virtualized list, message template, content part rendering
- `src/vs/workbench/contrib/chat/browser/chatContentParts/` — directory of individual content part renderers
- `src/vs/workbench/contrib/chat/browser/chat.contribution.ts` — contribution point registration, service instantiation (`InstantiationType.Delayed` for lazy loading)
- DeepWiki: [Chat UI Components](https://deepwiki.com/microsoft/vscode/8.4-chat-ui-components) — ChatWidget, ChatInputPart, ChatListRenderer, Content Parts

#### Tasks

**Task 3.1 — Create Chat Tool Manifest & Activation** ✅
- **Task Description:** Register the chat as a built-in tool using the existing manifest system and implement its activation function.
- **Output:** `manifest.json` and `chatTool.ts` in `src/built-in/chat/`.
- **Completion Criteria:**
  - `manifest.json` declares: `id: "parallx.chat"`, `name: "Chat"`, `activationEvents: ["onStartupFinished"]`, `contributes.viewContainers` for Auxiliary Bar, `contributes.views` for chat view, `contributes.commands` for chat commands
  - `chatTool.ts` `activate(context)` function:
    1. Creates `OllamaProvider` instance and registers it with `ILanguageModelsService`
    2. Registers the default chat participant with `IChatAgentService`
    3. Creates the chat view and registers it in the Auxiliary Bar via `parallx.views.registerViewProvider()`
    4. Registers chat-specific commands (toggle, new session, clear, stop)
    5. All registrations added to `context.subscriptions` for cleanup
- **Notes / Constraints:**
  - Reference only: `src/vs/workbench/contrib/chat/browser/chat.contribution.ts` — registers services, views, commands via contribution system
  - Follow the exact pattern used by existing built-ins (Canvas, Explorer, etc.) in `src/built-in/`
  - Chat tool must be scannable by `ToolScanner` and activatable by `ToolActivationService`

**Task 3.2 — Implement Chat View** ✅
- **Task Description:** Implement the view that registers in the Auxiliary Bar and hosts the ChatWidget.
- **Output:** `ChatView` class in `src/built-in/chat/chatView.ts` + `chatView.css`.
- **Completion Criteria:**
  - Implements `ViewProvider` interface (from `parallx.d.ts`)
  - `createView(container)` creates the root DOM element and instantiates `ChatWidget` inside it
  - View receives layout events and forwards to widget
  - Registered in the Auxiliary Bar view container
  - Activity bar button with chat icon toggles the Auxiliary Bar
  - View title: "Chat"
- **Notes / Constraints:**
  - Reference only: `src/vs/workbench/contrib/chat/browser/chatViewPane.ts` — `ChatViewPane` extends `ViewPane`, creates `ChatWidget` inside
  - Follow the pattern of existing Auxiliary Bar views in the codebase
  - CSS: flex column, full height, dark background matching workbench theme

**Task 3.3 — Implement Chat Widget** ✅
- **Task Description:** Implement the core chat widget with message list and input area.
- **Output:** `ChatWidget` class in `src/built-in/chat/chatWidget.ts` + `chatWidget.css`.
- **Completion Criteria:**
  - Extends `Disposable`
  - Two main regions: **message list** (scrollable, flex-grow) + **input area** (bottom-pinned, flex-shrink-0)
  - **Message list architecture:** Single Tiptap editor instance in read-only mode for the entire conversation. Custom node types represent each message element: `userMessage` (avatar + text + timestamp), `assistantMessage` (avatar + streaming content parts), `toolInvocationCard`, `thinkingBlock`, `progressIndicator`, etc. The conversation *is* a Tiptap document — streaming appends/updates nodes in the existing document rather than re-rendering.
  - `setSession(session)` binds the widget to a session — loads the conversation as Tiptap document content
  - `acceptInput()` reads input text, calls `IChatService.sendRequest()`, clears input
  - Listens to `IChatService.onDidChangeSession` to re-render when response updates
  - Auto-scrolls to bottom on new content; shows "↓" button when user scrolls up
  - Empty state: shows welcome message with "Start a conversation" prompt when no messages
  - Ollama offline state: shows "Ollama not detected" with setup instructions
  - `layout(width, height)` adjusts dimensions
- **Notes / Constraints:**
  - Reference only: `src/vs/workbench/contrib/chat/browser/widget/chatWidget.ts` — `ChatWidget` has `_list: WorkbenchObjectTree<ChatTreeItem>` + `_inputPart: ChatInputPart`
  - VS Code uses a virtualized tree for messages; Parallx uses a single Tiptap instance with custom node types per message element (see Resolved Design Decisions #2). This is architecturally different but achieves the same goal — efficient incremental rendering of streaming conversations.
  - Widget accesses services through the tool's API boundary or DI — never imports service implementations directly
  - CSS: message list fills available space; input area has border-top separator

**Task 3.4 — Implement Chat Input Part** ✅
- **Task Description:** Implement the chat input area with text input, model picker, and mode picker.
- **Output:** `ChatInputPart` class in `src/built-in/chat/chatInputPart.ts` + `chatInput.css`.
- **Completion Criteria:**
  - Multi-line text input using a **writable Tiptap instance** (enables @mention autocomplete via Tiptap's Mention extension, /command completion, and rich text input). Auto-expands vertically (max ~200px, then scrolls).
  - `Enter` submits message; `Shift+Enter` inserts newline
  - Model picker dropdown populated from `ILanguageModelsService.getModels()`; shows current model name
  - Mode picker shows Ask/Edit/Agent; highlights current mode
  - Submit button (visible when input has text)
  - Stop button (visible during streaming; cancels the current request)
  - Fires `onDidAcceptInput` event when user submits
  - `focus()` method to programmatically focus the input
- **Notes / Constraints:**
  - Reference only: `src/vs/workbench/contrib/chat/browser/widget/input/chatInputPart.ts` — `ChatInputPart` uses Monaco editor for input; Parallx uses a writable Tiptap instance (with Mention extension for @autocomplete and Placeholder extension for hint text)
  - Model picker uses existing `contextMenu` or `list` UI component
  - Mode picker: three small buttons or a segmented control

**Task 3.5 — Implement Chat Request Parser** ✅
- **Task Description:** Implement parsing of user input to extract @participant mentions, /slash commands, and #variable references.
- **Output:** `ChatRequestParser` class or function in `src/built-in/chat/chatRequestParser.ts`.
- **Completion Criteria:**
  - Extracts `@participantId` mentions from the beginning of input (e.g., "@workspace what is this project about?")
  - Extracts `/command` after participant mention (e.g., "@workspace /search query")
  - Extracts `#variable` references (e.g., "#currentPage" or "#selection") — M9.0 supports `#currentPage`
  - Returns parsed result: `{ participantId?: string, command?: string, variables: IChatVariable[], text: string }` where `text` is the remaining message after extracting mentions
  - Handles edge cases: no mentions (routes to default), multiple @mentions (first wins), escaped @ and /
- **Notes / Constraints:**
  - Reference only: `src/vs/workbench/contrib/chat/common/requestParser/chatRequestParser.ts` — `ChatRequestParser` with `parseChatRequest()` method (also see `requestParser/chatParserTypes.ts` for parsed result types)
  - Keep it simple in M9.0 — regex-based extraction, not a full grammar
  - Variables are resolved at request time by the participant handler (not the parser)

**Task 3.6 — Implement Chat List Renderer & Content Parts** ✅
- **Task Description:** Implement message rendering including all content part types needed for M9.0.
- **Output:** `ChatListRenderer` class in `src/built-in/chat/chatListRenderer.ts` + `ChatContentParts` in `src/built-in/chat/chatContentParts.ts`.
- **Completion Criteria:**
  - `ChatListRenderer.renderMessages(container, messages[])` renders all request/response pairs
  - User messages: avatar (user icon), message text, timestamp
  - Assistant messages: avatar (AI icon), streaming content parts
  - `ChatContentParts` provides a `renderPart(container, part: IChatContentPart)` function that dispatches on `part.kind`:
    - **Markdown**: rendered by the single Tiptap read-only instance as paragraph/heading/list/link/bold/italic nodes — Tiptap handles all markdown-to-DOM conversion natively
    - **CodeBlock**: rendered by Tiptap's `CodeBlock` extension — monospace, language label, copy-to-clipboard button. No syntax highlighting in M9 (Parallx is not a code IDE).
    - **Progress**: spinner animation + message text (custom Tiptap node view)
    - **Thinking**: collapsible block with reasoning text (custom Tiptap node view)
  - Content parts for M9.1 (ToolInvocation, Confirmation) and M9.2 (Reference, Warning, EditProposal) are stubbed as "unsupported part" placeholders
  - Streaming: new content parts are inserted as Tiptap nodes into the conversation document. The Tiptap transaction system handles incremental DOM updates natively — no manual DOM patching needed.
- **Notes / Constraints:**
  - Reference only: `src/vs/workbench/contrib/chat/browser/chatListRenderer.ts` — `ChatListRenderer` uses `WorkbenchObjectTree` with templates per item type
  - Reference only: `src/vs/workbench/contrib/chat/browser/chatContentParts/chatMarkdownContentPart.ts` — markdown rendering with `MarkdownRenderer`
  - Markdown and code block rendering uses Tiptap in read-only mode (see Resolved Design Decisions #1 and #2). No custom markdown renderer needed — Tiptap's built-in extensions (StarterKit, CodeBlock, Link, etc.) handle the required subset.
  - Streaming update pattern: new content parts are appended as Tiptap nodes via transactions. Adjacent markdown chunks are merged into a single paragraph/content node by the batching layer (see Task 5.1).

**Task 3.7 — Implement Model Picker & Mode Picker** ✅
- **Task Description:** Implement the model and mode selection UI components.
- **Output:** `ChatModelPicker` in `src/built-in/chat/chatModelPicker.ts` + `ChatModePicker` in `src/built-in/chat/chatModePicker.ts`.
- **Completion Criteria:**
  - **Model Picker**: dropdown showing available models (name + parameter size); current model highlighted; selecting fires `ILanguageModelsService.setActiveModel()`; shows "No models available" when Ollama has none; refreshes on `onDidChangeModels`
  - **Mode Picker**: three-state toggle (Ask / Edit / Agent); current mode highlighted; selecting fires `IChatModeService.setMode()`; shows tooltip describing each mode
  - Both use existing UI primitives from `src/ui/` where possible (contextMenu for dropdown, button for toggle)
- **Notes / Constraints:**
  - Reference only: `src/vs/workbench/contrib/chat/browser/widget/input/chatInputPart.ts` — model picker is `ChatModelPickerWidget`, mode picker integrated into input toolbar
  - Model display: show `displayName` (e.g., "Llama 3.2") + `parameterSize` (e.g., "3.2B") + loaded status from `/api/ps`

#### M9.0 Verification Checklist

- [x] Chat built-in tool registered and activated on startup
- [x] `ILanguageModelsService` registered as singleton; Ollama provider registered
- [x] Models populated from local Ollama instance
- [x] "Ollama not running" state shown when unavailable
- [x] User can select a model from the model picker
- [x] User can type a message and receive a streaming response
- [ ] Response renders as markdown incrementally via Tiptap read-only instance (bold, italic, code, lists, headings) — *deferred: Tiptap integration is Cap 6 (M9.1); basic DOM content parts render now*
- [ ] Code blocks render via Tiptap CodeBlock extension with copy button and language label — *deferred: Tiptap integration is Cap 6 (M9.1); basic code part renders now*
- [x] Multiple messages in a session maintain conversation context
- [x] Session created/switched/deleted
- [x] @participant mentions parsed and routed correctly  
- [x] Mode picker shows Ask/Edit/Agent (only Ask functional in M9.0)
- [x] Chat view appears in Auxiliary Bar with activity bar icon
- [x] Auto-scroll on new content; "scroll to bottom" button when scrolled up
- [x] All existing tests pass
- [x] New unit tests for: OllamaProvider streaming, ChatService session lifecycle, ChatAgentService dispatch, ChatRequestParser

---

## Capability 4 — Chat Mode System ✅

### Capability Description

The system enforces per-mode capabilities during chat requests. Each mode (Ask, Edit, Agent) determines what system prompt is used, whether tools are available, and what kinds of responses the AI can produce. Mode-aware request building is the boundary between "just chatting" and "AI taking actions."

### Goals

- Ask mode: pure Q&A with no side effects
- Edit mode: AI produces structured edit proposals for canvas blocks
- Agent mode: AI has access to tools and can perform multi-step autonomous work
- System prompts are mode-specific and include appropriate context
- Mode capabilities are enforced at the service level (not just UI)

### Conceptual Responsibilities

- Define capability matrix per mode (tools, edits, autonomous)
- Build mode-aware system prompts
- Filter tool availability based on current mode
- Validate that responses match mode expectations

### Dependencies

- Capability 2 (Chat Service Core — mode service)

### VS Code Reference

- `src/vs/workbench/contrib/chat/common/chatModes.ts` — `ChatModeService`, `ChatModeKind` enum (`Ask = 'ask'`, `Edit = 'edit'`, `Agent = 'agent'`), per-mode config
- `src/vs/workbench/contrib/chat/common/constants.ts` — Mode enum string values and mode-to-capability mapping
- `src/vs/workbench/contrib/chat/common/chatAgents.ts` — mode passed to `invokeAgent()` affects agent behavior and tool availability
- DeepWiki: [Chat Modes and Sessions](https://deepwiki.com/microsoft/vscode/8.5-chat-modes-and-sessions) — Mode-specific session behavior, mode switching validation, mode storage in sessions

#### Tasks

**Task 4.1 — Implement Mode Capability Matrix** ✅ DONE
- **Task Description:** Define and enforce what each mode can do at the service level.
- **Output:** `chatModeCapabilities.ts` — frozen capability matrix, `getModeCapabilities()`, `shouldIncludeTools()`, `shouldUseStructuredOutput()`.
- **Completion Criteria:**
  - Mode capabilities enforced:

    | Capability          | Ask | Edit | Agent |
    |---------------------|-----|------|-------|
    | Read context        | ✅  | ✅   | ✅    |
    | Invoke tools        | ❌  | ❌   | ✅    |
    | Propose edits       | ❌  | ✅   | ✅    |
    | Autonomous multi-step | ❌ | ❌   | ✅    |

  - `sendRequest()` omits `tools` array from Ollama request in Ask/Edit modes
  - Agent mode includes full tool descriptions in the `tools` parameter
  - Edit mode includes edit-specific instructions in the system prompt
- **Notes / Constraints:**
  - Reference only: `src/vs/workbench/contrib/chat/common/chatAgents.ts` — mode is checked in `invokeAgent()` to determine available capabilities
  - Enforcement happens in the request building phase, not the UI — even programmatic requests respect mode

**Task 4.2 — Implement Mode-Aware System Prompts** ✅ DONE
- **Task Description:** Build system prompts that vary by mode and include relevant context.
- **Output:** `chatSystemPrompts.ts` — `buildSystemPrompt(mode, context)`, mode-specific prompts for Ask/Edit/Agent. `defaultParticipant.ts` + `chatTool.ts` updated with workspace context wiring.
- **Completion Criteria:**
  - **Ask mode prompt**: brief context about Parallx workspace (name, page count), instruction to be helpful, no tool references
  - **Edit mode prompt**: instruction to propose edits in a structured format (block ID + new content), list of available block operations, instruction to explain changes
  - **Agent mode prompt**: full tool descriptions (name, description, parameter schema), instruction to use tools when appropriate, instruction to explain reasoning
  - System prompt is prepended to the message array sent to the language model
  - Workspace context (current page, workspace name) injected dynamically
- **Notes / Constraints:**
  - Keep prompts concise — large system prompts consume context window
  - Edit mode structured format defined here but rendering deferred to Capability 7

---

## Capability 5 — Participant/Agent System

### Capability Description

The system supports multiple chat participants that handle messages based on @mentions. Built-in participants provide workspace search, canvas operations, and general chat. The participant handler contract, response stream, and dispatch logic mirror VS Code's chat agent API.

### Goals

- Default participant handles messages with no @mention
- `@workspace` participant provides workspace-aware context and search
- `@canvas` participant provides canvas-specific operations
- Participants use `IChatResponseStream` to build typed responses
- New participants can be registered by other tools via the API (Capability 8)

### Conceptual Responsibilities

- Implement default participant (passthrough to language model)
- Implement workspace participant (search, page listing, summarization)
- Implement canvas participant (block reading, page structure)
- Implement `ChatResponseStream` adapter that creates content parts from stream methods

### Dependencies

- Capability 2 (Chat Agent Service — registration and dispatch)
- Capability 4 (Mode System — mode-aware prompts)

### VS Code Reference

- `src/vs/workbench/contrib/chat/common/chatAgents.ts` — `IChatAgentImplementation`, agent handler pattern, `IChatAgentRequest` fields
- `src/vs/workbench/api/common/extHostChatAgents2.ts` — `ExtHostChatAgent`: how agents receive requests; `ChatAgentResponseStream` creation with `sendQueue` microtask batching
- `src/vs/workbench/api/common/extHostTypes.ts` — `ChatResponseStream` class with methods like `markdown()`, `anchor()`, `button()`, `beginToolInvocation()`, `updateToolInvocation()`
- DeepWiki: [Chat Request and Response Flow](https://deepwiki.com/microsoft/vscode/8.3-chat-request-and-response-flow) — Stream creation, batching mechanism, cancellation with `throwIfDone()`

#### Tasks

**Task 5.1 — Implement Chat Response Stream**
- **Task Description:** Implement the `IChatResponseStream` that participants use to build responses from typed content parts.
- **Output:** `ChatResponseStream` class in `src/built-in/chat/chatResponseStream.ts` or within the service layer.
- **Completion Criteria:**
  - Implements `IChatResponseStream` interface from `chatTypes.ts`
  - `markdown(content)` creates/appends to a `IChatMarkdownContent` part
  - `codeBlock(code, language?)` creates a `IChatCodeBlockContent` part
  - `progress(message)` creates a `IChatProgressContent` part (replaces previous progress)
  - `reference(uri, label)` creates a `IChatReferenceContent` part
  - `thinking(content)` creates a `IChatThinkingContent` part
  - `warning(message)` creates a `IChatWarningContent` part
  - `confirmation(message, data)` creates a `IChatConfirmationContent` part
  - `push(part)` directly adds any `IChatContentPart`
  - Each method fires a change event so the UI can re-render incrementally
  - Adjacent `markdown()` calls merge into a single markdown content part (batching). **Batching pattern:** consecutive chunks from the provider's async iterator are pushed to a `sendQueue` array. A `queueMicrotask()` callback flushes the entire queue in one pass, creating/updating content parts and firing a single change event. This coalesces per-token DOM updates into batched renders — VS Code does this to minimize IPC calls; Parallx does it to minimize DOM thrashing.
  - `beginToolInvocation(toolCallId, toolName, data?)` creates a pending `IChatToolInvocationContent` part in the response
  - `updateToolInvocation(toolCallId, data)` updates an existing tool invocation part (e.g., status change, result data)
  - Stream enforces `throwIfDone()` — any write after `close()` or cancellation throws
- **Notes / Constraints:**
  - Reference only: `src/vs/workbench/api/common/extHostTypes.ts` — `ChatResponseStream` class, each method creates a specific part type
  - Batching: consecutive `markdown()` calls (common during streaming) should concatenate into one part, not create new parts each chunk
  - The stream holds a reference to the response object it's building — mutations are in-place

**Task 5.2 — Implement Default Participant**
- **Task Description:** Implement the default participant that handles all messages with no @mention.
- **Output:** `DefaultParticipant` in `src/built-in/chat/participants/defaultParticipant.ts`.
- **Completion Criteria:**
  - Registered with `IChatAgentService` with `id: 'parallx.chat.default'`
  - Handler builds system prompt based on current mode (from `IChatModeService`)
  - Handler calls `ILanguageModelsService.sendChatRequest()` with conversation history + system prompt
  - Iterates over `AsyncIterable<IChatResponseChunk>` and writes to `IChatResponseStream`:
    - Text content → `response.markdown(chunk.content)`
    - Thinking content → `response.thinking(chunk.thinking)`
    - Tool calls → handled by agentic loop (Capability 6, stubbed in M9.0)
  - Handles cancellation via token
  - Handles errors (model not found, connection lost) by writing error as warning part
- **Notes / Constraints:**
  - Reference only: `src/vs/workbench/contrib/chat/browser/chatAgents.ts` — default agent handler pattern
  - In M9.0 this is a simple passthrough. In M9.1, it gains the agentic loop (tool_calls handling)

**Task 5.3 — Implement Workspace Participant**
- **Task Description:** Implement the `@workspace` participant for workspace-aware queries.
- **Output:** `WorkspaceParticipant` in `src/built-in/chat/participants/workspaceParticipant.ts`.
- **Completion Criteria:**
  - Registered with `id: 'parallx.chat.workspace'`, `displayName: 'Workspace'`
  - Supports commands: `/search` (search pages), `/list` (list all pages), `/summarize` (summarize a page)
  - Handler gathers workspace context using existing `IDatabaseService` / `IWorkspaceService`:
    - Lists pages → includes page titles in context
    - Searches pages → includes search results in context
    - Reads page content → includes content in context
  - Prepends gathered context to the message before sending to language model
  - Uses `response.reference()` to link back to source pages
  - Uses `response.progress()` while gathering context
- **Notes / Constraints:**
  - Workspace context is injected into the system/user message, not as tool calls — this is Ask-mode compatible
  - Keep context injection concise to avoid filling the context window

**Task 5.4 — Implement Canvas Participant**
- **Task Description:** Implement the `@canvas` participant for canvas-specific queries.
- **Output:** `CanvasParticipant` in `src/built-in/chat/participants/canvasParticipant.ts`.
- **Completion Criteria:**
  - Registered with `id: 'parallx.chat.canvas'`, `displayName: 'Canvas'`
  - Supports commands: `/describe` (describe current page structure), `/blocks` (list blocks on current page)
  - Handler reads the current canvas page's block tree and includes structure in context
  - In Edit mode: includes edit-specific system prompt for proposing block changes
  - Uses `response.reference()` to link to specific blocks
- **Notes / Constraints:**
  - Accesses canvas via existing services — does not import canvas internals
  - Edit mode capabilities fully implemented in Capability 7; in M9.1 this participant just does read-only context injection

#### M9.1 Verification Checklist (Part 1)

- [ ] Default participant handles unmentioned messages correctly in all three modes
- [ ] `@workspace` routes to workspace participant; gathers page context
- [ ] `@workspace /search query` returns relevant pages with references
- [ ] `@canvas` routes to canvas participant; describes current page structure
- [ ] `IChatResponseStream` methods create correct content parts
- [ ] Markdown batching works (consecutive chunks merge into one part)
- [ ] Progress parts display during context gathering
- [ ] Reference parts link to source pages

---

## Capability 6 — Tool Invocation Framework

### Capability Description

The system supports tool invocation in Agent mode. The AI model can request tool calls, which are confirmed by the user, executed, and their results fed back for multi-step reasoning. This is the core of the agentic loop.

### Goals

- Tools are registered with name, description, JSON schema, and handler
- Agent mode passes tool definitions to the language model
- Model's `tool_calls` are captured and presented to the user for confirmation
- Confirmed tools execute and results feed back to the model
- Agentic loop continues until final answer or iteration limit
- Built-in tools provide workspace operations

### Conceptual Responsibilities

- Tool registry (register, list, lookup)
- Tool invocation with confirmation gates
- Agentic loop orchestration
- Built-in tool implementations
- Confirmation UI rendering (accept/reject cards)

### Dependencies

- Capability 4 (Mode System — Agent mode enables tools)
- Capability 5 (Participant System — default participant runs agentic loop)

### VS Code Reference

- `src/vs/workbench/contrib/chat/common/tools/languageModelToolsService.ts` — `LanguageModelToolsService`: tool registry, `invokeTool()`, `IToolData` interface (includes `id`, `displayName`, `modelDescription`, `inputSchema`)
- `src/vs/workbench/contrib/chat/common/tools/languageModelToolsConfirmationService.ts` — `ILanguageModelToolsConfirmationService`: separate service for approval dialogs and auto-approval policies
- `src/vs/workbench/contrib/chat/browser/tools/languageModelToolsConfirmationService.ts` — Browser-side implementation with 4-level auto-approval: `chat.tools.global.autoApprove` (global YOLO mode), `chat.tools.edits.autoApprove` (file pattern matching), `chat.tools.urls.autoApprove` (URL patterns), `chat.tools.eligibleForAutoApproval` (per-tool eligibility)
- `src/vs/workbench/contrib/chat/common/chatAgents.ts` — agentic loop in agent handler: tool_call → execute → feed back → repeat
- `src/vs/workbench/contrib/chat/browser/chatContentParts/chatToolInvocationPart.ts` — tool invocation UI rendering (`ChatToolInvocationPart` with `toolCallId`, `isConfirmed`, `isComplete`, `isError`, `toolSpecificData`)
- `src/vs/workbench/api/common/extHostChatAgents2.ts` — `stream.beginToolInvocation(toolCallId, toolName, streamData?)` and `stream.updateToolInvocation(toolCallId, streamData)` for tool progress
- DeepWiki: [Language Model Tools and MCP](https://deepwiki.com/microsoft/vscode/8.6-language-model-tools-and-mcp) — Tool Service, Tool Invocation Sequence, Confirmation Flow, Auto-Approval Decision Flow

#### Tasks

**Task 6.1 — Implement Language Model Tools Service**
- **Task Description:** Implement `ILanguageModelToolsService` for tool registration and invocation with confirmation gates.
- **Output:** `LanguageModelToolsService` class in `src/services/languageModelToolsService.ts`.
- **Completion Criteria:**
  - `registerTool(tool: IChatTool)` stores tool; returns `IDisposable`; fires `onDidChangeTools`
  - `getTools()` returns all registered tools (readonly)
  - `getTool(name)` returns tool by name or undefined
  - `invokeTool(name, args, token)` executes tool's handler:
    1. Resolves tool by name; throws if not found
    2. If `tool.requiresConfirmation === true`: returns a pending `IToolResult` and emits confirmation request (handled by UI)
    3. On confirmation accept: executes `tool.handler(args, token)`, returns result
    4. On confirmation reject: returns `{ content: 'Tool execution rejected by user', isError: true }`
  - `getToolDefinitions()` returns all tools formatted as Ollama `tools[]` array (name, description, parameters) for inclusion in chat requests
  - Service identifier: `ILanguageModelToolsService = createDecorator<ILanguageModelToolsService>('languageModelToolsService')`
- **Notes / Constraints:**
  - Reference only: `src/vs/workbench/contrib/chat/common/tools/languageModelToolsService.ts` — `LanguageModelToolsService.invokeTool()` checks confirmation policy before executing
  - **VS Code separation note:** VS Code separates tool confirmation into `ILanguageModelToolsConfirmationService` (a distinct service from `ILanguageModelToolsService`) with 4-level auto-approval: global YOLO mode, per-tool eligibility, file edit patterns, and URL patterns. Parallx deliberately merges confirmation logic into `ILanguageModelToolsService` as a simplification — one service, one `chat.agent.autoApproveTools` boolean. This avoids over-engineering for M9 where all tools are built-in and well-understood. If tool trust becomes more nuanced (e.g., community-contributed tools), extract `ILanguageModelToolsConfirmationService` at that point.
  - Confirmation is async — the service must support waiting for user decision
  - `chat.agent.autoApproveTools` config setting bypasses confirmation (equivalent to VS Code's YOLO mode)

**Task 6.2 — Implement Agentic Loop**
- **Task Description:** Implement the tool call → execute → feed back loop within the default participant's Agent mode handler.
- **Output:** Agentic loop logic in `defaultParticipant.ts` (Agent mode branch).
- **Completion Criteria:**
  - When model returns `tool_calls` in response:
    1. For each tool call: write `IChatToolInvocationContent` part to response stream (status: pending)
    2. Invoke tool via `ILanguageModelToolsService.invokeTool()` (with confirmation)
    3. Update tool invocation part status (running → completed/rejected)
    4. Write tool result as `{ role: 'tool', content: result, tool_name: name }` message
    5. Send updated message history back to language model
    6. Repeat until model produces response without tool_calls, or max iterations reached
  - Maximum iterations configurable via `chat.agent.maxIterations` (default: 10)
  - Each iteration is visible in the chat as tool invocation cards
  - Cancellation token stops the loop at any point
  - Loop timeout: total agentic execution limited to configurable duration
- **Notes / Constraints:**
  - Reference only: `src/vs/workbench/contrib/chat/common/chatAgents.ts` — agent handler processes tool_calls, feeds results back
  - Ollama's tool calling: model returns `message.tool_calls[]` with `function.name` and `function.arguments`. Results go back as `{ role: 'tool', content: '...', tool_name: '...' }` messages
  - Guard against infinite loops: hard limit of `maxIterations` even if model keeps requesting tools

**Task 6.3 — Implement Built-in Tools**
- **Task Description:** Implement workspace operation tools that the AI can invoke in Agent mode.
- **Output:** Tool handler functions registered during chat tool activation.
- **Completion Criteria:**

  | Tool Name | Description | Handler |
  |-----------|------------|---------|
  | `search_workspace` | Search pages and blocks by text query | Uses `IDatabaseService` to search page titles and content |
  | `read_page` | Read the full content of a page by ID | Uses `IDatabaseService` to fetch page content |
  | `list_pages` | List all pages with titles and IDs | Uses `IDatabaseService` to list pages |
  | `get_page_properties` | Get database properties of a page | Uses `IDatabaseService` for property values |
  | `create_page` | Create a new page with title and optional content | Uses `IDatabaseService` to create page |

  - Each tool has: name, description, JSON Schema `parameters`, handler function, `requiresConfirmation: true` (except read-only tools)
  - Read-only tools (`search_workspace`, `read_page`, `list_pages`, `get_page_properties`) can be auto-approved
  - Write tools (`create_page`) always require confirmation
  - Tool results are formatted as concise text (not raw JSON dumps)
- **Notes / Constraints:**
  - Tools use existing Parallx services — they do NOT invoke canvas code directly
  - Tool parameter schemas must be valid JSON Schema (Ollama validates them)
  - Keep tool descriptions concise — they go into the system prompt and consume context window

**Task 6.4 — Implement Tool Invocation & Confirmation UI**
- **Task Description:** Implement the visual rendering of tool invocations and confirmation prompts in the chat message list.
- **Output:** Tool invocation content part renderer in `chatContentParts.ts`.
- **Completion Criteria:**
  - `IChatToolInvocationContent` renders as a card: tool icon, tool name, arguments summary, status badge
  - Status states: pending (gray), running (blue spinner), completed (green check), rejected (red x)
  - `IChatConfirmationContent` renders Accept / Reject buttons below the tool card
  - Accept button fires confirmation acceptance → tool executes → card updates to completed
  - Reject button fires rejection → card updates to rejected
  - Completed tools show their result text inline (collapsible if long)
  - Cards are visually distinct from regular message content (bordered, slight background)
- **Notes / Constraints:**
  - Reference only: `src/vs/workbench/contrib/chat/browser/chatContentParts/chatToolInvocationPart.ts` — renders tool status, name, result
  - Use existing `button` UI component for Accept/Reject

#### M9.1 Verification Checklist (Part 2)

- [ ] Mode switching changes system prompt and tool availability
- [ ] Agent mode sends tools array to Ollama
- [ ] Model tool_call responses captured and rendered as cards
- [ ] Tool confirmation UI shows Accept/Reject buttons
- [ ] Accepted tools execute and show results inline
- [ ] Rejected tools show "Skipped by user" and loop continues
- [ ] Agentic loop feeds tool results back to model
- [ ] Loop stops at max iterations
- [ ] Built-in tools (search, read, list, create) functional
- [ ] Auto-approve setting bypasses confirmation for read-only tools
- [ ] All existing tests pass
- [ ] New unit tests for: tool registration, tool invocation, agentic loop, confirmation flow, built-in tool handlers

---

## Capability 7 — Edit Mode

### Capability Description

The system supports an Edit mode where the AI proposes changes to canvas pages and blocks. Proposals are presented as diff-like content parts that the user can accept or reject individually or in batch. Accepted edits are applied to the canvas through existing block APIs.

### Goals

- AI produces structured edit proposals for canvas blocks
- Proposals rendered as before/after diffs in the chat
- Accept/Reject per proposal or batch accept/reject
- Accepted edits applied to canvas via existing APIs
- Edit operations are undoable

### Conceptual Responsibilities

- Define edit proposal content part type
- Build edit-mode system prompt with available operations
- Parse model's edit proposals from response
- Render diff-like edit previews
- Apply accepted edits to canvas

### Dependencies

- Capability 4 (Mode System — Edit mode)
- Capability 5 (Canvas Participant — provides page context)

### VS Code Reference

- `src/vs/workbench/contrib/chat/common/model/chatModel.ts` — `IChatTextEditGroup` for file edit groups
- `src/vs/workbench/contrib/chat/browser/chatContentParts/chatTextEditContentPart.ts` — edit preview rendering
- `src/vs/workbench/contrib/chat/browser/chatEditing/` — orchestration of multi-file edits, accept/reject
- DeepWiki: [Chat System Architecture](https://deepwiki.com/microsoft/vscode/8.1-chat-system-architecture) — Edit Mode, Text Edit Groups

#### Tasks

**Task 7.1 — Define Edit Proposal Content Part**
- **Task Description:** Define the `IChatEditProposalContent` type and add it to the content part union.
- **Output:** New content part type in `chatTypes.ts`.
- **Completion Criteria:**
  - `IChatEditProposalContent` includes: `kind: 'editProposal'`, `pageId`, `blockId?`, `operation` (insert/update/delete), `before?: string` (original content), `after: string` (proposed content), `status` (pending/accepted/rejected)
  - Added to `ChatContentPartKind` enum and `IChatContentPart` union
  - Batch wrapper: `IChatEditBatchContent` with `proposals: IChatEditProposalContent[]` for group accept/reject
- **Notes / Constraints:**
  - Reference only: `src/vs/workbench/contrib/chat/common/model/chatModel.ts` — `IChatTextEditGroup` has `uri`, `edits`, `state` (pending/accepted/rejected)
  - Parallx adapts "file edits" → "block edits" — same concept, different unit of editing

**Task 7.2 — Implement Edit Proposal Parsing**
- **Task Description:** Parse the model's edit proposals from JSON structured output into structured edit content parts.
- **Output:** Edit proposal parser in the canvas participant or default participant (Edit mode branch).
- **Completion Criteria:**
  - Edit mode requests use Ollama's `format: { type: "object" }` parameter to force JSON output matching a defined schema
  - **Edit response schema:** `{ explanation: string, edits: Array<{ pageId: string, blockId?: string, operation: 'insert' | 'update' | 'delete', content: string }> }`
  - Parser validates the JSON against the schema, extracts edits, creates `IChatEditProposalContent` parts
  - `explanation` field rendered as markdown text above the edit proposals
  - Falls back gracefully if model output doesn't match expected format (show raw response + warning)
- **Notes / Constraints:**
  - The edit format schema is embedded in the Edit mode system prompt (Task 4.2) so the model knows the expected output shape
  - Ollama's `format` parameter ensures valid JSON output — but the model may still put unexpected values in fields, so validate each edit entry

**Task 7.3 — Implement Edit Preview & Apply**
- **Task Description:** Render edit proposals as diff previews and apply accepted edits.
- **Output:** Edit content part renderer in `chatContentParts.ts` + apply logic.
- **Completion Criteria:**
  - Edit proposal renders as: page/block reference + before/after comparison
  - Before text shown with red background (deletion), after text with green background (insertion)
  - Accept button applies the edit via existing canvas block APIs
  - Reject button marks the proposal as rejected
  - "Accept All" / "Reject All" buttons for batch operations
  - Applied edits are reflected immediately in the canvas
- **Notes / Constraints:**
  - Reference only: `src/vs/workbench/contrib/chat/browser/chatContentParts/chatTextEditContentPart.ts` — renders diff with accept/reject
  - Keep diff rendering simple in M9.2 — side-by-side or inline text diff, not a full diff editor
  - Undo support: edits applied through canvas APIs should be undoable via canvas undo stack

---

## Capability 8 — Tool API Surface

### Capability Description

The system exposes `parallx.lm` and `parallx.chat` API namespaces so that other tools can access language models and register chat participants/tools. This extends the `parallx.*` API boundary (Milestone 2) with AI capabilities.

### Goals

- Tools can access language models programmatically via `parallx.lm`
- Tools can register chat participants via `parallx.chat.createChatParticipant()`
- Tools can register chat tools via `parallx.chat.registerTool()`
- API bridges follow the same pattern as existing bridges (commands, views, editors, etc.)
- API is type-safe via updated `parallx.d.ts`

### Conceptual Responsibilities

- Define `parallx.lm` type definitions and bridge
- Define `parallx.chat` type definitions and bridge
- Map API calls to internal services
- Scope API access per tool (same as existing bridges)

### Dependencies

- Capability 1 (Language Models Service — backend for `parallx.lm`)
- Capability 2 (Chat Agent Service — backend for `parallx.chat.createChatParticipant`)
- Capability 6 (Tools Service — backend for `parallx.chat.registerTool`)

### VS Code Reference

- `src/vscode-dts/vscode.d.ts` — `vscode.lm` namespace, `vscode.chat` namespace
- `src/vs/workbench/api/common/extHostLanguageModels.ts` — `ExtHostLanguageModels`: bridge from extension API to main thread service
- `src/vs/workbench/api/common/extHostChatAgents2.ts` — `ExtHostChatAgents2`: bridge from extension API to main thread agent service
- DeepWiki: [Extension System → API Surface](https://deepwiki.com/microsoft/vscode/8-extension-system)

#### Tasks

**Task 8.1 — Add `parallx.lm` to API Type Definitions**
- **Task Description:** Add the `parallx.lm` namespace to `src/api/parallx.d.ts`.
- **Output:** Updated `parallx.d.ts` with language model types and methods.
- **Completion Criteria:**
  - `parallx.lm.getModels()` → `Promise<LanguageModelInfo[]>`
  - `parallx.lm.sendChatRequest(modelId, messages, options?)` → `AsyncIterable<ChatResponseChunk>`
  - `parallx.lm.registerProvider(provider: LanguageModelProvider)` → `IDisposable`
  - `parallx.lm.onDidChangeModels` → `Event<void>`
  - All supporting types exported: `LanguageModelInfo`, `ChatMessage`, `ChatRequestOptions`, `ChatResponseChunk`, `LanguageModelProvider`
- **Notes / Constraints:**
  - Reference only: `src/vscode-dts/vscode.d.ts` — `namespace lm` section
  - Types in `parallx.d.ts` use structural typing — no class instances cross the API boundary

**Task 8.2 — Add `parallx.chat` to API Type Definitions**
- **Task Description:** Add the `parallx.chat` namespace to `src/api/parallx.d.ts`.
- **Output:** Updated `parallx.d.ts` with chat participant and tool types.
- **Completion Criteria:**
  - `parallx.chat.createChatParticipant(id, handler)` → `ChatParticipant` (with `dispose()`)
  - `parallx.chat.registerTool(name, tool)` → `IDisposable`
  - `ChatParticipant` type with `id`, `displayName`, `description`, `iconPath`, `commands[]`
  - `ChatParticipantHandler` type matching internal `IChatParticipantHandler` signature
  - `ChatTool` type with `description`, `parameters`, `handler`
  - `ChatResponseStream` type with all stream methods
- **Notes / Constraints:**
  - Reference only: `src/vscode-dts/vscode.d.ts` — `namespace chat` section
  - Follow the existing pattern of `parallx.views`, `parallx.commands`, etc.

**Task 8.3 — Implement API Bridges**
- **Task Description:** Implement the bridge layer mapping `parallx.lm` and `parallx.chat` API calls to internal services.
- **Output:** `LanguageModelBridge` in `src/api/bridges/languageModelBridge.ts` + `ChatBridge` in `src/api/bridges/chatBridge.ts`.
- **Completion Criteria:**
  - `LanguageModelBridge` maps:
    - `getModels()` → `ILanguageModelsService.getModels()`
    - `sendChatRequest()` → `ILanguageModelsService.sendChatRequest()`
    - `registerProvider()` → `ILanguageModelsService.registerProvider()`
    - `onDidChangeModels` → forwards from `ILanguageModelsService.onDidChangeModels`
  - `ChatBridge` maps:
    - `createChatParticipant()` → `IChatAgentService.registerAgent()` (wraps handler for tool-scoping)
    - `registerTool()` → `ILanguageModelToolsService.registerTool()`
  - Both bridges follow existing patterns: constructor receives `toolId` + services, `_throwIfDisposed()` guard, disposals tracked
  - API factory (`apiFactory.ts`) updated to include `lm` and `chat` namespaces in the API object
- **Notes / Constraints:**
  - Reference only: `src/vs/workbench/api/common/extHostLanguageModels.ts` and `extHostChatAgents2.ts`
  - Follow exact pattern of existing bridges in `src/api/bridges/` (commandsBridge, viewsBridge, etc.)

---

## Capability 9 — Session Persistence, Commands & Polish

### Capability Description

The system persists chat sessions to SQLite, registers keyboard shortcuts and commands, provides configuration settings, and handles edge cases for a production-quality experience.

### Goals

- Sessions survive workbench restarts
- Standard keyboard shortcuts for chat operations
- Commands accessible via command palette
- Configuration settings for Ollama URL, default model, agent behavior
- Status bar shows model and connection status
- Clear error states for all failure scenarios

### Conceptual Responsibilities

- SQLite schema for sessions and messages
- Session serialization/deserialization
- Command registration
- Keybinding registration
- Configuration integration
- Status bar item
- Error handling and edge cases

### Dependencies

- Capability 2 (Chat Service — session storage interface)
- Capability 3 (Chat UI — commands target the chat view)

### VS Code Reference

- `src/vs/workbench/contrib/chat/common/chatService/chatService.ts` — session persistence, `restoreSessions()`
- `src/vs/workbench/contrib/chat/browser/actions/` — chat actions and keybindings (includes `chatActions.ts`, `chatExecuteActions.ts`)
- `src/vs/workbench/contrib/chat/browser/chat.contribution.ts` — `chat.*` configuration namespace declarations (lines 337-581 cover tool, mode, MCP, and UI settings)
- DeepWiki: [Chat Modes and Sessions](https://deepwiki.com/microsoft/vscode/8.5-chat-modes-and-sessions) — Session persistence, serialization, restoration flow

#### Tasks

**Task 9.1 — Implement Session Persistence**
- **Task Description:** Persist chat sessions and messages to SQLite so they survive restarts.
- **Output:** SQLite tables + serialization logic, likely in `ChatService` or a dedicated persistence module.
- **Completion Criteria:**
  - New tables: `chat_sessions` (id, title, mode, modelId, createdAt, updatedAt) + `chat_messages` (id, sessionId, role, content, parts JSON, timestamp)
  - Sessions saved on every message (or debounced)
  - Sessions restored on workbench load via `ChatService.restoreSessions()`
  - Deleted sessions removed from database
  - Content parts serialized as JSON in the `parts` column
  - Migration-safe: schema version tracked for future changes
- **Notes / Constraints:**
  - Reference only: `src/vs/workbench/contrib/chat/common/chatService/chatService.ts` — `_persistSession()` saves to storage
  - Use existing `IDatabaseService` patterns for SQLite table creation and queries
  - Keep serialization format simple — flat JSON, no protobuf or binary

**Task 9.2 — Register Commands & Keyboard Shortcuts**
- **Task Description:** Register all chat commands and their default keybindings.
- **Output:** Command registrations in `chatActions.ts`, keybindings in manifest.
- **Completion Criteria:**

  | Command ID | Keybinding | Description |
  |-----------|-----------|-------------|
  | `parallx.chat.toggle` | `Ctrl+Shift+I` | Toggle chat panel (Auxiliary Bar) |
  | `parallx.chat.newSession` | `Ctrl+L` | Create new chat session |
  | `parallx.chat.clearSession` | — | Clear current session messages |
  | `parallx.chat.switchMode` | — | Cycle through Ask/Edit/Agent |
  | `parallx.chat.selectModel` | — | Open model selection picker |
  | `parallx.chat.stopResponse` | `Escape` (when streaming) | Cancel current response |

  - Commands registered via `parallx.commands.registerCommand()` in `chatTool.ts`
  - Keybindings declared in tool manifest `contributes.keybindings`
- **Notes / Constraints:**
  - `Escape` for stop should only fire when chat input is focused and a response is streaming
  - Follow existing command registration patterns from other built-in tools

**Task 9.3 — Implement Configuration Settings**
- **Task Description:** Register chat configuration settings in the configuration service.
- **Output:** Configuration declarations in manifest + defaults.
- **Completion Criteria:**

  | Setting | Type | Default | Description |
  |---------|------|---------|-------------|
  | `chat.ollama.baseUrl` | string | `http://localhost:11434` | Ollama server URL |
  | `chat.ollama.pollInterval` | number | `30000` | Health check interval (ms) |
  | `chat.defaultMode` | string | `ask` | Default chat mode |
  | `chat.defaultModel` | string | `""` | Preferred model (empty = first available) |
  | `chat.agent.maxIterations` | number | `10` | Max agentic loop iterations |
  | `chat.agent.autoApproveTools` | boolean | `false` | Skip tool confirmation |
  | `chat.fontSize` | number | `13` | Chat message font size |
  | `chat.fontFamily` | string | `""` | Chat font family |

  - Declared in manifest `contributes.configuration`
  - Read by services via `parallx.workspace.getConfiguration('chat')`
  - Changes take effect immediately (listen to `onDidChangeConfiguration`)
- **Notes / Constraints:**
  - Reference only: `src/vs/workbench/contrib/chat/browser/chat.contribution.ts` — configuration keys declared inline in contribution registration (lines 337-581 cover all `chat.*` settings including tool approval, MCP, and UI settings)
  - Follow existing configuration contribution pattern from other built-in tools

**Task 9.4 — Implement Status Bar Integration**
- **Task Description:** Add a status bar item showing the current model and connection status.
- **Output:** Status bar item registered via `parallx.window.createStatusBarItem()`.
- **Completion Criteria:**
  - Shows: model name + colored dot (green = connected, red = disconnected)
  - Shows "No AI" text when Ollama is unavailable
  - Click opens model selection picker (reuses `parallx.chat.selectModel` command)
  - Updates reactively on model change and status change events
  - Positioned on the right side of the status bar
- **Notes / Constraints:**
  - Use existing `StatusBarItem` API from `parallx.window`
  - Follow the pattern of existing status bar items in the codebase

**Task 9.5 — Implement Error Handling & Edge Cases**
- **Task Description:** Handle all known failure scenarios with clear user-facing messages.
- **Output:** Error handling throughout chat service and UI layers.
- **Completion Criteria:**
  - **Ollama not running**: Chat view shows "Ollama not detected" with setup link (https://ollama.com) and instructions
  - **No models available**: Picker shows "No models. Run `ollama pull llama3.2` to get started"
  - **Model not found**: Error message names the model with `ollama pull <model>` suggestion
  - **Stream interrupted**: Partial response preserved and marked incomplete; "Retry" button shown. Retry increments `IChatParticipantRequest.attempt` counter so the handler knows this is a retry.
  - **Network timeout**: Configurable timeout (60s default); "Request timed out" message
  - **Empty response**: "Model returned an empty response" shown (not silent)
  - **Context overflow**: Rough token estimate (chars/4); warning when approaching model's `contextLength` at 80% capacity. When exceeded, compress older messages using the LLM itself — send a separate summarization request asking the model to condense conversation history into a concise context message. Original messages preserved in UI and SQLite — summarization only affects what is sent to the model. The summarization prompt is invisible to the user.
  - All errors written as `IChatWarningContent` parts in the response — never throw unhandled to the UI
  - **Four distinct error paths** (mirroring VS Code):
    1. **Throw exception**: Handler crashes → caught by `invokeAgent()` → rendered as error warning part
    2. **Return `errorDetails`**: Handler returns `{ errorDetails: { message, responseIsIncomplete } }` → rendered as inline error with message
    3. **Stream warning**: Handler calls `response.warning(message)` → non-fatal warning part rendered inline
    4. **Tool error**: Tool invocation fails → `IToolResult.isError = true` → rendered as error state on tool card
- **Notes / Constraints:**
  - Error messages should be actionable — tell the user what to do, not just what went wrong
  - Connection errors should trigger health monitor to increase poll frequency

#### M9.2 Verification Checklist

- [ ] Edit mode proposes block-level changes in the chat
- [ ] Edit proposals render with before/after diff and Accept/Reject buttons
- [ ] Accepted edits apply correctly to canvas blocks
- [ ] `parallx.lm` API functional — tools can list models and send requests
- [ ] `parallx.chat` API functional — tools can register participants and tools
- [ ] API bridges follow existing bridge patterns
- [ ] Sessions persist across workbench restarts (SQLite)
- [ ] Restored sessions show full message history
- [ ] All keyboard shortcuts registered and functional
- [ ] All commands accessible via command palette
- [ ] Configuration settings respected (base URL, default model, font, agent settings)
- [ ] Status bar shows model name + connection status
- [ ] "Ollama not running" shows clear setup instructions
- [ ] Stream interruption preserves partial response
- [ ] Context overflow triggers history summarization (invisible to user, original messages preserved in UI)
- [ ] All existing tests pass
- [ ] New tests for: session persistence, edit mode parsing, API bridges, error scenarios
- [ ] Follow-up suggestion chips render below responses (`provideFollowups()` on participant handler)

---

## Dependency Map

```
chatTypes.ts (types only — no runtime deps)
    ↑
    ├── languageModelsService.ts (depends on: chatTypes, platform/events, platform/lifecycle)
    │       ↑
    │       └── ollamaProvider.ts (depends on: chatTypes — uses Fetch API)
    │
    ├── chatService.ts (depends on: chatTypes, chatAgentService, chatModeService, platform/events)
    │
    ├── chatAgentService.ts (depends on: chatTypes, platform/events, platform/lifecycle)
    │
    ├── chatModeService.ts (depends on: chatTypes, platform/events)
    │
    ├── chatWidgetService.ts (depends on: chatTypes, platform/events, platform/lifecycle)
    │
    └── languageModelToolsService.ts (depends on: chatTypes, platform/events, platform/lifecycle)

chatTool.ts (activation — wires services + registers UI)
    ↑
    ├── chatView.ts → chatWidget.ts → chatInputPart.ts + chatListRenderer.ts + chatContentParts.ts
    │
    ├── chatRequestParser.ts
    │
    ├── chatResponseStream.ts
    │
    ├── defaultParticipant.ts, workspaceParticipant.ts, canvasParticipant.ts
    │
    └── chatActions.ts (commands)

API Layer:
    ├── parallx.d.ts (type definitions — parallx.lm + parallx.chat namespaces)
    ├── languageModelBridge.ts → ILanguageModelsService
    └── chatBridge.ts → IChatAgentService + ILanguageModelToolsService
```

---

## Resolved Design Decisions

These decisions were open questions during M9 authoring and have been resolved:

1. **Markdown & code block rendering → Tiptap read-only.** Chat responses are rendered using Tiptap in read-only mode. Tiptap is already in the project for the editor — reusing it avoids building a custom markdown renderer. Code blocks use Tiptap's `CodeBlock` extension (monospace, language label, copy button — no syntax highlighting in M9). Parallx is not a code IDE, so dedicated syntax highlighting is deferred. If needed later, it can be added as a Tiptap extension (e.g., `lowlight`).

2. **Chat message list architecture → Single Tiptap instance.** The entire conversation is represented as a single Tiptap document in read-only mode, using custom node types for each message element: `userMessage`, `assistantMessage`, `toolInvocationCard`, `thinkingBlock`, `progressIndicator`, etc. This approach is more performant than one Tiptap instance per message and makes the conversation a structured document that Tiptap manages natively. The input area is a separate writable Tiptap instance (enables @mention autocomplete via Tiptap's Mention extension and /command completion).

3. **Token counting → chars/4 + summarize old messages.** Ollama doesn't expose a tokenizer. Use `chars / 4` as a rough token estimate. When the estimated token count exceeds 80% of the model's `contextLength`, compress older messages using the LLM itself (ask it to summarize the conversation so far into a concise context message). The summarization request uses a separate short prompt and is not visible in the chat UI. Original messages are preserved in the UI and in session persistence — summarization only affects what is sent to the model.

4. **Edit mode structured format → JSON structured output.** Edit proposals use Ollama's `format: { type: "object" }` parameter to force JSON output matching a defined schema. The schema includes: `explanation` (natural text), `edits[]` (array of `{ pageId, blockId?, operation, content }`). Reliable parsing wins over natural-text-with-markers for programmatic edits. The model's explanatory text lives in the `explanation` field.

5. **Follow-up suggestions → M9.2 required.** `provideFollowups()` is added to the participant handler contract and rendered as clickable suggestion chips below responses. This is a required M9.2 deliverable.

6. **Session URI scheme → Full URI scheme from day one.** Sessions are identified by URI objects (`parallx-chat-session:///<uuid>`), not plain string IDs. The scheme is used throughout the type system and service layer. This enables future editor-tab integration (opening a session as an editor tab via the URI scheme) without migration. The URI type is a simple wrapper with `scheme`, `authority`, `path` components — matching existing Parallx URI patterns.
