# Proactive AI Assistance: OpenClaw & Continue.dev Technical Comparison

> **Research-only document for Parallx Milestone 11 — Second Brain: From Chat Widget to Jarvis**
> Covers: query expansion, situational awareness, multi-step reasoning, intent classification, agentic loops, and tool-mediated context gathering.

---

## Projects Studied

| | **OpenClaw** | **Continue.dev** |
|---|---|---|
| Repo | github.com/openclaw/openclaw | github.com/continuedev/continue |
| Stars | 248K+ | 31.6K+ |
| Language | TypeScript (86.2%) | TypeScript (84.2%) |
| Nature | Personal AI assistant (multi-channel: WhatsApp, Telegram, Slack, Discord, Signal, iMessage, etc.) | IDE extension (VS Code + JetBrains) + CLI for AI code checks |
| Runtime | Gateway WS control plane + Pi agent runtime | Node.js core + webview UI + IDE protocol layer |

---

## 1. User Intent Classification (Question vs Task vs Situation)

**Key finding: Neither project performs programmatic intent classification at the application level.** Both delegate intent understanding entirely to the LLM via system prompt instructions.

### OpenClaw

- Every inbound message passes through a **command detection pipeline** (`command-detection.ts`), but this only distinguishes **slash commands** (e.g., `/think`, `/model`, `/queue`) from **normal chat** — not question vs task vs situation.
- Message classification functions: `hasInlineCommandTokens()` → `isControlCommandMessage()` → `shouldComputeCommandAuthorized()`.
- **Directives** like `/think`, `/verbose`, `/elevated`, `/reasoning` can be inline in messages and are stripped before the model sees the text. These modify *how* the model thinks, not *what category* the user input belongs to.
- Group activation policies ("mention" vs "always") control *whether* the agent responds, not *what kind* of message it received.
- **The LLM itself** determines whether the user is asking a question, requesting a task, or describing a situation — guided by the system prompt's Messaging, Reply Tags, and Reasoning Format sections.

### Continue.dev

- No message classification layer at all. User input from the chat interface is passed directly to the LLM with attached context items.
- The `@` mention system (e.g., `@docs`, `@commit`, `@discord`) is user-driven context attachment, not intent classification.
- Continue's newer "Checks" system (CI-focused) processes structured markdown check definitions, not free-form intent.

### Implication for Parallx

Neither project validates the idea of a pre-LLM intent classifier. Both rely on carefully structured system prompts to let the LLM perform its own intent recognition. For Parallx, this confirms the M11 approach of using `SOUL.md` personality directives and workspace context to shape LLM behavior rather than building an explicit classifier.

---

## 2. Query Expansion / Multi-Query RAG

**Key finding: Neither project implements query expansion or multi-query RAG at the application level.** Both use single-query retrieval.

### OpenClaw

- **`memory_search` tool** (`memory-tool.ts` + `src/memory/`): The agent calls this tool with a single query string. The system runs hybrid search: **vector similarity** (weight 0.7) + **FTS5 BM25** (weight 0.3), combined via RRF-style scoring, with optional MMR re-ranking and temporal decay.
- Chunking: ~400 tokens/chunk, 80 token overlap, `maxResults=6`, `minScore=0.35`.
- Embedding providers: auto-selected in order `local → openai → gemini → voyage → mistral → FTS-only`.
- The model may **call `memory_search` multiple times** with different queries across a conversation turn, but this is model-directed, not application-orchestrated. The system prompt's Memory Recall section instructs: "search MEMORY.md and memory/*.md before answering questions about prior work."
- **No automatic query reformulation** or parallel multi-query fan-out.

### Continue.dev

- **`DocsContextProvider`**: Single-query vector search against LanceDB. Retrieves top-30 chunks, optionally reranks to top-15.
- **`getContextItems(query, extras)`**: Each context provider receives exactly one query string.
- No documented query expansion, sub-query generation, or HyDE (Hypothetical Document Embeddings).
- The codebase indexer (`CodebaseIndexer.ts`) uses Tree-sitter parsing + embeddings via TransformersJS/ONNX, but retrieval is still single-query.

### Implication for Parallx

If Parallx wants multi-query RAG (e.g., decomposing "how does our canvas handle drag-and-drop?" into sub-queries about canvas architecture, DnD service, drop overlay, etc.), it would need to be a **novel addition** — neither reference project implements this. The simplest approach would be to let the LLM call `search_knowledge` multiple times with different queries (OpenClaw-style model-directed expansion), rather than building an application-level query decomposer.

---

## 3. Planning / Reasoning Step Before Main Response

**Key finding: OpenClaw provides extensive infrastructure for controlling model reasoning depth. Continue.dev does not have an equivalent.**

### OpenClaw

- **`/think` directive levels**: off, low, medium, high, xhigh. These control native model reasoning (e.g., Anthropic extended thinking, OpenAI o-series reasoning).
- The system prompt's **Reasoning Format section** instructs the model on when and how to use `<think>`/`<thinking>` tags. These tags are stripped from the visible output.
- **Skills system forces a "read-then-act" pattern**: The system prompt includes an `<available_skills>` XML block listing all skill names and descriptions. The model is instructed to scan this block and use the `read` tool to load the matching `SKILL.md` **before** responding. This creates an implicit planning phase: skill selection → skill loading → informed response.
- **Memory Recall section**: Instructs the model to search memory before answering questions about prior work — another "gather context, then respond" pattern.
- **Subagent spawning** (`sessions_spawn` tool): The model can delegate complex sub-tasks to isolated subagents, each with their own context window and tool scope. This is a form of task decomposition.
- There is **no explicit "plan" object** or structured planning step at the application level. All planning is expressed as model behavior shaped by system prompt instructions.

### Continue.dev

- **Plan tool group**: Continue has built-in tools `create_plan` and `commit_plan_item` for multi-step planning, but these are tool-call-level features that the model decides to use, not a mandatory pre-response phase.
- **Reasoning token support**: Continue streams `reasoning_content` and `redacted_thinking` tokens from models that support them (o1, Claude extended thinking), but doesn't add application-level reasoning steps.
- No equivalent to OpenClaw's `/think` levels or skills-must-be-loaded-first pattern.
- The newer "Checks" system defines structured check playbooks in markdown, which is a form of pre-planned task execution.

### Implication for Parallx

OpenClaw's skills system is directly analogous to Parallx M11's skill-based tool system. The "scan available skills → load SKILL.md → respond" pattern is already built into M11. Consider adding:
1. A `/think` directive equivalent that maps to model-specific reasoning parameters.
2. A system prompt instruction that explicitly asks the model to outline its plan before executing multi-step tasks.

---

## 4. Context Relevance Determination

**Key finding: OpenClaw uses "always-inject + model-decides-when-to-search" while Continue.dev uses "user-selects-context-providers + always-inject-selected".**

### OpenClaw

- **Always-injected context**: `AGENTS.md`, `SOUL.md`, `TOOLS.md`, `IDENTITY.md`, `USER.md`, `HEARTBEAT.md`, `MEMORY.md` are unconditionally included as `EmbeddedContextFile[]` — per-file limit 20K chars, total 150K chars.
- **Workspace context**: Injected via a dedicated Workspace section in the system prompt.
- **Skills matching**: The `<available_skills>` XML block is always present. The **model** decides which skills are relevant and calls `read` to load them. The application doesn't filter skills by relevance.
- **Memory search**: Tool-initiated. The model decides when to search memory. The system prompt's Memory Recall section *instructs* the model to search before answering certain types of questions, but doesn't enforce it.
- **9-layer tool policy pipeline** (profile → provider profile → global → global provider → agent → agent provider → group → sandbox → subagent): Controls which tools are *available*, not which context is *relevant*. Deny wins over allow at each layer.
- **Context file caching**: System prompt is intentionally stable across turns (no current time, hashed owner IDs) to maximize Anthropic prompt cache hits.

### Continue.dev

- **User-driven context selection**: The `@` mention system lets users explicitly attach context from providers (`@docs`, `@commit`, `@file`, `@code`, etc.).
- **Context providers** are pluggable (`BaseContextProvider` → concrete implementations). Each implements `getContextItems(query, extras)` which returns `ContextItem[]` injected into the prompt.
- **DocsContextProvider**: Vector similarity search against indexed documentation. Retrieves 30 chunks → optional reranking → 15 final chunks. Each provider decides its own relevance filtering.
- **Codebase indexing**: Tree-sitter parsed, embedded, stored in LanceDB. Available via context providers but not automatically injected.
- **Tool selection filtering** (`selectActiveTools.ts`): Filters tools by model capabilities, user config, experimental flags, sign-in status, and remote-IDE restrictions. Not relevance-based.
- **Message compilation** (`compileChatMessages`): Prunes older messages to fit context window — preserves system message and latest tool sequences, drops oldest messages first. Not relevance-based pruning.

### Implication for Parallx

Parallx M11 already has a hybrid approach: workspace digest (~2000 tokens) is always injected, while `search_knowledge` is model-initiated. The key insight from OpenClaw is the **prompt instruction pattern** — telling the model *when* to search rather than trying to programmatically determine relevance. The insight from Continue is that **user-directed context attachment** (`@mentions`) is valuable for power users who know what context they need.

---

## 5. Agentic Loop / "Think Before Acting" Phase

**Key finding: OpenClaw has a sophisticated 4-layer agentic loop with streaming, compaction, and fallback. Continue.dev has a simpler tool-call loop via Redux thunks.**

### OpenClaw

- **4-layer execution pipeline**:
  1. **`runReplyAgent`** (Layer 1): Queue policy (drop / enqueue-followup / proceed), steer check (inject message into active streaming run), typing indicators, post-processing (fallback tracking, compaction count, usage persistence, diagnostics).
  2. **`runAgentTurnWithFallback`** (Layer 2): Retry loop for context overflow (triggers compaction), transient HTTP errors (2500ms delay), role ordering conflicts (Gemini-specific), model fallback chain via `FailoverError` reasons (`rate_limit`, `auth`, `context_overflow`, `model_not_found`, `billing`).
  3. **`runEmbeddedPiAgent`** (Layer 3): Session lane + global lane queuing (serialized via `enqueueCommandInLane`), model resolution from `openclaw-models.json` registry, auth profile iteration with cooldown tracking.
  4. **`runEmbeddedAttempt`** (Layer 4): Full execution setup — workspace resolution, sandbox detection, skills loading, bootstrap files, tool creation (`createOpenClawCodingTools`), system prompt construction, session lock/repair/init.

- **Tool streaming**: The model calls tools mid-response. Tool results are fed back and the model continues generating. This is the core agentic loop — the model iterates between reasoning, tool use, and output generation.
- **Compaction**: When context overflow occurs, Layer 2 triggers conversation compaction (summarizing older messages) and retries.
- **Loop detection**: `genericRepeat`, `knownPollNoProgress`, `pingPong` detectors with warning/critical/circuit-breaker thresholds prevent infinite tool-call loops.
- **Subagent depth limits**: `DEFAULT_SUBAGENT_MAX_SPAWN_DEPTH` prevents infinite subagent recursion.

### Continue.dev

- **`streamNormalInput` thunk** (`gui/src/redux/thunks/streamNormalInput.ts`): The main agentic loop.
  1. Compile messages via `compileChatMessages` (token counting, pruning, tool sequence preservation).
  2. Determine tool mode: native tool calling (if model supports) or system message tools (fallback — tool descriptions in system prompt, XML/JSON code block output parsing).
  3. Stream LLM response. During streaming, accumulate tool call deltas.
  4. When streaming completes and tool calls are present: preprocess args → evaluate policies → execute approved tools → feed results back → loop.
  5. Tool lifecycle states: `generating → generated → calling → done/errored/canceled`.

- **Policy evaluation**: Each tool call goes through `evaluateToolCallPolicy` — some tools auto-execute, others require user approval.
- **No compaction**: Continue prunes from the front (oldest messages) rather than summarizing.
- **No explicit loop detection**: Relies on model behavior and user cancellation.
- **System message tools fallback**: For models without native tool calling, Continue injects tool descriptions into the system prompt and parses tool calls from code blocks in the response. This is handled by `SystemMessageToolCodeblocksFramework` + `interceptSystemToolCalls`.

### Implication for Parallx

OpenClaw's 4-layer pipeline is over-engineered for Parallx's local-only Ollama setup (no multi-provider failover, no billing, no multi-channel queuing needed). However, key patterns to adopt:
1. **Compaction on overflow** — instead of just truncating, summarize older context.
2. **Loop detection** — essential for local models that may get stuck in tool-call loops.
3. **Continue's system message tools fallback** — relevant since Ollama models may have inconsistent native tool calling support.

---

## 6. Tool Calls: Context Gathering vs Response Generation

**Key finding: OpenClaw explicitly separates context-gathering tools from action tools in its system prompt. Continue.dev treats all tools uniformly but has an implicit read/write distinction via tool policies.**

### OpenClaw

The system prompt's tool sections explicitly instruct the model to use **context-gathering tools first**:

- **Context-gathering tools** (called before responding):
  - `memory_search` — semantic search over MEMORY.md + memory/*.md files
  - `memory_get` — read a specific memory file
  - `read` — read files from the workspace
  - `web_search` — search the web for current information
  - Skills `read` — load SKILL.md before using a skill's tools

- **Action tools** (called to fulfill the user's request):
  - `write` / `edit` / `apply_patch` — modify files
  - `exec` — run shell commands
  - `browser` — browse web pages
  - `canvas` — create/update canvas artifacts
  - `tts` — text-to-speech
  - `sessions_spawn` — spawn subagents
  - `cron` — schedule recurring tasks
  - `message` — send messages to other channels

- **System prompt enforcement patterns**:
  - Skills section: "scan `<available_skills>`, use `read` tool to load matching SKILL.md **before** responding"
  - Memory Recall section: "search MEMORY.md and memory/*.md **before** answering questions about prior work"
  - These create a mandatory "gather first, act second" behavior via prompt engineering, not code.

- **Tool policy pipeline**: 9 layers of allow/deny policies control tool *availability*, but all available tools are presented to the model equally. The model decides the order.

### Continue.dev

- **Tool definition structure** (`Tool` interface):
  - `readonly` property marks tools that don't modify state (e.g., `read_file`, `list_dir`)
  - `isInstant` property marks tools that execute without streaming
  - `defaultToolPolicy` and `evaluateToolCallPolicy` control approval requirements

- **Built-in tool groups**:
  - `BUILT_IN_GROUP_NAME` — core file/codebase operations: `read_file`, `edit_file`, `list_dir`
  - Plan group — multi-step planning: `create_plan`, `commit_plan_item`
  - Experimental — feature-flagged tools

- **Tool overrides**: Users can customize tool descriptions per model via `toolOverrides` in config, which changes what the LLM understands about each tool's purpose.

- **No explicit "gather first" instruction** in the system prompt. The model decides tool call order based on the tool descriptions alone.

### Implication for Parallx

OpenClaw's explicit "gather context first" pattern via system prompt instructions is directly applicable to Parallx. M11's `TOOLS.md` prompt file should include instructions like:
- "Before answering questions about the workspace, call `search_knowledge` to find relevant context."
- "Before using a skill's tools, load its `SKILL.md` manifest."
- "Before modifying files, read the current content."

This is purely a prompt engineering pattern — no application code needed.

---

## 7. Situational Messages (User Describes Situation vs Direct Question)

**Key finding: Neither project has special handling for situational messages. Both rely on the LLM to understand and respond appropriately to any message type.**

### OpenClaw

- The system prompt includes sections for:
  - **Reply Tags**: Defines response format guidelines (concise vs detailed, code blocks, etc.)
  - **Messaging**: Channel-specific formatting rules (WhatsApp char limits, Telegram markdown, etc.)
  - **Voice**: Tone and personality directives from SOUL.md
  - **Heartbeats**: The model can send "silent" heartbeat messages to indicate it's alive during long tool operations — a form of situational awareness.
  - **Reactions**: The model can react to messages with emoji — useful for acknowledging situational updates without a full response.

- Situational awareness comes from **always-injected context** (AGENTS.md/SOUL.md describe the project, MEMORY.md provides history) plus **model-initiated memory search**. When a user describes a situation, the model already has project context and can search for relevant history.

### Continue.dev

- The chat interface passes all user input uniformly to the LLM. No pre-processing differentiates "I'm working on X and seeing Y" from "how do I do Z?".
- **LSP Context Integration** (`core/context/providers/`) can provide real-time IDE context (open files, cursor position, diagnostics) which gives the model situational awareness of the editing environment.
- **Rules system** (`.continue/rules/`) can define project-specific instructions that shape how the model interprets messages.

### Implication for Parallx

For Parallx's "Jarvis" vision, situational awareness comes from:
1. **Workspace digest** (always injected) — the AI already knows file structure and canvas pages.
2. **Prompt file personality** (`SOUL.md`) — can instruct the model to acknowledge situations before acting.
3. **Hybrid retrieval** — when the model encounters a situational description, it can search for relevant workspace context.
4. Neither reference project suggests building an explicit "situation detector" — the LLM handles this naturally.

---

## Summary: What Parallx Should Adopt

| Pattern | Source | Status in M11 | Recommendation |
|---------|--------|---------------|----------------|
| Always-inject project context files | OpenClaw | ✅ Workspace digest + prompt files | Keep as-is |
| Skills scan → load → respond | OpenClaw | ✅ SKILL.md manifest system | Keep as-is |
| Hybrid retrieval (vector + BM25) | Both | ✅ sqlite-vec + FTS5 via RRF | Keep as-is |
| Model-directed multi-call search | OpenClaw | ⚠️ Model can call search_knowledge | Add prompt instructions encouraging multi-call |
| "Gather first, act second" prompt pattern | OpenClaw | ⚠️ Partially in TOOLS.md | Strengthen with explicit instructions |
| Reasoning depth control (/think levels) | OpenClaw | ❌ Not implemented | Consider for future milestone |
| Compaction on context overflow | OpenClaw | ❌ Not implemented | Consider — important for long sessions |
| Tool-call loop detection | OpenClaw | ❌ Not implemented | Important — local models are more prone to loops |
| System message tools fallback | Continue | ❌ Not implemented | Important for Ollama models without native tool calling |
| User-directed context attachment (@mentions) | Continue | ❌ Not implemented | Nice-to-have for power users |
| Explicit intent classification | Neither | N/A | Don't build — no precedent, LLM handles it |
| Application-level query expansion | Neither | N/A | Don't build initially — let model multi-call instead |

---

## Source Files Referenced

### OpenClaw
- `src/auto-reply/reply/agent-runner.ts` — 4-layer execution pipeline
- `src/auto-reply/reply/agent-runner-execution.ts` — Retry/fallback logic
- `src/agents/pi-embedded-runner/run.ts` — Agent session setup
- `src/agents/pi-embedded-runner/run/attempt.ts` — Full execution environment
- `src/agents/system-prompt.ts` — `buildAgentSystemPrompt` (189-664), prompt modes, section assembly
- `src/agents/pi-tools.ts` — `createOpenClawCodingTools`, 9-layer policy pipeline
- `src/agents/tools/memory-tool.ts` — `memory_search` / `memory_get` agent-facing tools
- `src/memory/manager.ts` — `MemorySearchManager` interface
- `src/memory/hybrid.ts` — Hybrid vector+BM25 search (vector 0.7 / BM25 0.3)
- `src/agents/subagent-spawn.ts` — Subagent spawning, depth limits
- `src/agents/subagent-registry.ts` — Subagent lifecycle tracking
- `src/auto-reply/command-detection.ts` — Message classification (commands only)
- `src/auto-reply/commands-core.ts` — Slash command handlers

### Continue.dev
- `core/core.ts` — Core orchestrator
- `core/config/ConfigHandler.ts` — Configuration management
- `core/context/providers/DocsContextProvider.ts` — Documentation context with vector search + reranking
- `core/context/providers/GitCommitContextProvider.ts` — Git history context
- `core/context/providers/DiscordContextProvider.ts` — Discord channel context
- `core/llm/countTokens.ts` — `compileChatMessages`, token counting, pruning strategies
- `core/llm/index.ts` — `BaseLLM.streamChat`, streaming pipeline
- `core/llm/toolSupport.ts` — `PROVIDER_TOOL_SUPPORT`, model capability detection
- `core/tools/builtIn/index.ts` — Built-in tool groups
- `core/tools/systemMessageTools/buildToolsSystemMessage.ts` — System message tool descriptions
- `core/tools/systemMessageTools/interceptSystemToolCalls.ts` — Code block tool call parsing
- `core/indexing/docs/DocsService.ts` — Documentation indexing (crawl → chunk → embed → LanceDB)
- `gui/src/redux/thunks/streamNormalInput.ts` — Main agentic loop
- `gui/src/redux/thunks/callToolById.ts` — Tool execution
- `gui/src/redux/thunks/evaluateToolPolicies.ts` — Policy evaluation
- `gui/src/redux/slices/sessionSlice.ts` — Tool call state management
