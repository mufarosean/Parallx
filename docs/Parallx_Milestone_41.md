# Milestone 41 — Implement OpenClaw Framework in Parallx

**Status:** Phases 1-5 Complete  
**Branch:** `m41-openclaw-rebuild-plan`  
**Depends on:** Milestone 40 (commit `e1e86bb` on `milestone-40`)  
**Upstream Reference:** OpenClaw commit `e635cedb` (2026-03-20)

---

## Methodology

This milestone follows the same approach used to build the Parallx workbench from the VS Code workbench: **study the upstream source directly, understand the architecture, build our version adapted for our platform.**

We do not guess. We do not infer. We read OpenClaw's code, understand what it builds and why, then build the Parallx version of each system. The existing `src/openclaw/` code is not the starting point — OpenClaw's architecture is. Whatever currently exists in `src/openclaw/` will be replaced by the systems described below. We make no assumptions about why it was built or whether any of it is worth preserving.

The adaptation layer is the Parallx platform: `ILanguageModelsService` for model calls, chat participants for turn handling, Electron for desktop, Ollama for local inference. These are our equivalents of VS Code's services layer — the platform constraints within which we implement OpenClaw's architecture.

---

## Table of Contents

1. [What OpenClaw Builds](#1-what-openclaw-builds)
2. [Principles & Anti-Patterns](#2-principles--anti-patterns)
3. [Platform Adaptation Layer](#3-platform-adaptation-layer)
4. [System 1 — Execution Pipeline](#4-system-1--execution-pipeline)
5. [System 2 — Context Engine](#5-system-2--context-engine)
6. [System 3 — System Prompt Builder](#6-system-3--system-prompt-builder)
7. [System 4 — Tool Policy](#7-system-4--tool-policy)
8. [Implementation Order](#8-implementation-order)
9. [Holistic Integration Audit](#9-holistic-integration-audit)
10. [Verification Plan](#10-verification-plan)
11. [Risk Assessment](#11-risk-assessment)
12. [Upstream Systems N/A for Parallx](#12-upstream-systems-na-for-parallx)
13. [Reference Index](#13-reference-index)

---

## 1. What OpenClaw Builds

OpenClaw is a self-hosted AI gateway. Its AI system is built from four core systems. All evidence below comes from direct reads of the OpenClaw source code at commit `e635cedb`. Full source references are in `docs/clawrallx/OPENCLAW_PIPELINE_REFERENCE.md`.

### 1.1 Execution Pipeline

A 4-layer pipeline where each layer handles a single concern:

| Layer | Function | File | Lines | What it does |
|-------|----------|------|-------|--------------|
| L1 | `runReplyAgent` | `agent-runner.ts` | 63-728 | Entry point. Queue policy, steer check, reply building. |
| L2 | `runAgentTurnWithFallback` | `agent-runner-execution.ts` | 113-763 | Error handling. Context overflow → compaction → retry. Transient HTTP → delay → retry. Model fallback on failure. |
| L3 | `runEmbeddedPiAgent` | `run.ts` | 215-1860+ | Turn execution. Model resolution, auth profiles, main retry loop (min 32, max 160 iterations). Overflow compaction max 3, timeout compaction max 2. |
| L4 | `runEmbeddedAttempt` | `attempt.ts` | 1672-3222+ | Single attempt. Workspace setup, skill loading, system prompt construction, tool creation, context engine lifecycle (bootstrap → assemble → execute → finalize). |

**Key pattern:** The pipeline never pre-classifies messages. The user's message goes to the model with system prompt + context + tools. The model handles intent. If the model fails, the pipeline retries with compacted context or a fallback model. It never post-processes the model's output to fix it.

### 1.2 Context Engine

A pluggable interface with a lifecycle contract. From `context-engine/types.ts` lines 104-230:

```typescript
interface ContextEngine {
  readonly info: ContextEngineInfo;
  bootstrap?(params): Promise<BootstrapResult>;
  maintain?(params): Promise<ContextEngineMaintenanceResult>;
  ingest(params): Promise<IngestResult>;
  ingestBatch?(params): Promise<IngestBatchResult>;
  afterTurn?(params): Promise<void>;
  assemble(params): Promise<AssembleResult>;
  compact(params): Promise<CompactResult>;
  prepareSubagentSpawn?(params): Promise<SubagentSpawnPreparation | undefined>;
  onSubagentEnded?(params): Promise<void>;
  dispose?(): Promise<void>;
}

type AssembleResult = {
  messages: AgentMessage[];
  estimatedTokens: number;
  systemPromptAddition?: string;
};
```

**Key pattern:** The context engine owns the token budget. When asked to `assemble()`, it builds the message array to fit within the provided budget. When context overflows, the pipeline calls `compact()` to reduce context, then re-assembles. The engine tracks lifecycle per turn: bootstrap at start, assemble before model call, afterTurn for persistence.

### 1.3 System Prompt Builder

A structured builder that constructs the system prompt from discrete sections. From `agents/system-prompt.ts` lines 110-400:

```typescript
function buildAgentSystemPrompt(params: {
  workspaceDir: string;
  toolNames?: string[];
  toolSummaries?: Record<string, string>;
  contextFiles?: EmbeddedContextFile[];
  skillsPrompt?: string;
  runtimeInfo?: { host, os, arch, node, model, provider, capabilities, channel };
  // ... 20+ additional section parameters
}): string
```

The output has this structure (from direct read):
```
[Identity]
## Skills (mandatory)
  Before replying: scan <available_skills>...
  <available_skills>
    <skill><name>...</name><description>...</description><location>...</location></skill>
  </available_skills>
## Tooling
  [Tool names and one-line summaries]
## Workspace
  [Bootstrap files: AGENTS.md, SOUL.md, TOOLS.md content, budget-limited]
## Runtime
  [Host, OS, model, provider, capabilities]
# Project Context
  [Injected workspace context files]
## Response Format
  [Behavioral rules]
```

**Key pattern:** The prompt is built from data, not hardcoded. Tool descriptions, skills, workspace files, and runtime metadata are all injected programmatically. Bootstrap files have per-file budgets (`agents.defaults.bootstrapMaxChars`, default 20000) and total budgets (`agents.defaults.bootstrapTotalMaxChars`, default 150000).

### 1.4 Tool Policy Pipeline

A multi-stage filtering system that determines which tools are available per turn. From `agents/tool-policy-pipeline.ts` lines 44-154:

```typescript
function applyToolPolicyPipeline(params: {
  tools: AnyAgentTool[];
  toolMeta: (tool) => { pluginId: string } | undefined;
  warn: (message: string) => void;
  steps: ToolPolicyPipelineStep[];
}): AnyAgentTool[]
```

Filtering stages (from `tool-policy.ts`, `tool-policy-match.ts`, `tool-policy-shared.ts`):
1. **Profile-based:** `minimal | coding | messaging | full` → base allow/deny set
2. **Agent config:** Per-agent `tools.allow`, `tools.deny`, `tools.alsoAllow`
3. **Glob matching:** `isToolAllowedByPolicyName` — deny-first, allow-second, with name normalization and aliasing (`apply_patch` ↔ `exec`)

**Key pattern:** Tools are filtered before they reach the model, not after. The model only sees tools it's allowed to use for the current context.

---

## 2. Principles & Anti-Patterns

These principles come from the corrections identified during planning. They must be followed during every implementation step. An agent picking up this document should read this section first and refer back to it whenever making a design choice.

### 2.1 Core Principles

**P1 — We are building a framework, not solving individual problems.**  
The goal is a system that handles any query correctly because the architecture is sound — not a collection of fixes for specific test cases. If a test fails, the fix is always in one of the four systems (pipeline, context engine, prompt builder, tool policy), never in a query-specific handler or output-repair function.

**P2 — OpenClaw is the blueprint, existing code is not.**  
The existing `src/openclaw/` code was built without reading OpenClaw's source. It is not the starting point, not a reference, and not something to preserve. We make no assumptions about why any of it was built. OpenClaw's architecture is the only reference. The existing code is what gets replaced.

**P3 — Study the source, then build our version.**  
Same methodology as the Parallx workbench from VS Code. We read OpenClaw's code → understand what it builds and why → build Parallx's version adapted for our platform constraints. We do not guess. We do not infer. We do not assume. Every design decision must trace to a specific upstream source location.

**P4 — We are not installing OpenClaw into Parallx.**  
We use OpenClaw's code to understand the architecture, then build something that works for Parallx's use case. Same as how Parallx's workbench is not a copy of VS Code's workbench — it's Parallx's version of it. The adaptation layer (Section 3) defines how upstream concepts map to our platform.

**P5 — No deterministic solutions.**  
Never build a codepath that produces a fixed answer for a specific query. Never route a message class to a hardcoded handler. Never post-process the model's output to fix it. The model receives proper inputs (system prompt + context + tools) and produces the output. If the output is wrong, the inputs are wrong.

**P6 — Do NOT invent custom patterns when the upstream has a proven approach.**  
From the project instructions. Applies to OpenClaw the same way it applies to VS Code. If OpenClaw solves a problem (context overflow → compaction → retry), use their approach. Don't invent an alternative.

### 2.2 Anti-Patterns — What went wrong before, and how to avoid it

These are the specific failure modes identified in the prior implementation. Each has a detection test: if you catch yourself doing this, stop.

| Anti-Pattern | What it looks like | Detection test | What to do instead |
|---|---|---|---|
| **Preservation bias** | "What to KEEP" lists with justifications for existing code | Am I reasoning about the current code at all? | Ignore existing code. Build what the upstream blueprint says to build. |
| **Patch-thinking** | Mapping a deleted function to a new location (e.g., "repairX → prompt rule Y") | Am I relocating logic rather than eliminating the need for it? | Build the system that makes the logic unnecessary. The system prompt builder (System 3) gives the model proper instructions. That's not "relocating repair logic" — it's building the system correctly. |
| **Wrapper framing** | "This wraps the existing X behind the new interface" | Am I preserving old code inside a new interface? | Build the implementation from the blueprint. If the old code happens to do something similar, that's coincidence, not a reason to reuse it. |
| **Subtractive framing** | "Phase 1: Delete X. Phase 2: Delete Y." Starting from deletion. | Is my first action destroying something? | Build the new system first (Phase 1). Wire it (Phase 2). Remove the now-dead old code (Phase 3). Construction first, deletion last. |
| **Output repair** | Any function that modifies the model's response after it's generated | Does this function take the model's output as input and return a modified version? | Fix the inputs. Better system prompt, better context, better tool descriptions. Never touch the output. |
| **Pre-classification** | Regex or keyword matching on the user's message to choose a codepath | Am I analyzing the message content before the model sees it? | Send the message to the model. The model classifies intent. Exception: slash commands (`/context`, `/init`, `/compact`) are structural, not classification. |
| **Eval-driven patchwork** | Adding a fix because a specific test case failed | Am I solving for one test or for all possible queries of this class? | Fix the system. If T04 fails because deductible amounts are wrong, the fix is in context assembly (is the policy document in the context?) and system prompt (does it instruct the model to cite exact values?), not in a deductible-specific repair function. |

### 2.3 Before writing any code — checklist

Every implementation step must pass this checklist:

- [ ] I have read the relevant upstream source (not just the reference doc — the actual function signatures and control flow)
- [ ] I can point to the specific upstream code location this is adapted from
- [ ] This does not preserve, wrap, or relocate existing `src/openclaw/` code
- [ ] This does not add a query-specific handler or output-repair function
- [ ] This does not pre-classify messages by content (except slash commands)
- [ ] This builds a system/framework, not a fix for a specific test case
- [ ] I have not assumed anything — every design choice traces to source evidence

---

## 3. Platform Adaptation Layer

Parallx is not OpenClaw. OpenClaw is a multi-user gateway accessed via messaging channels. Parallx is a single-user desktop workbench. The adaptation layer maps OpenClaw's abstractions to Parallx's platform:

| OpenClaw concept | Parallx equivalent | Notes |
|------------------|--------------------|-------|
| Gateway channel (Discord, Telegram, etc.) | Chat participant | VS Code chat participant model |
| Multi-model provider with auth rotation | `ILanguageModelsService` + Ollama | Single local provider, UI-selected model |
| Session store (JSONL files) | Platform session storage | `parallx-chat-session:///<uuid>` URIs |
| Agent config (YAML) | `ai-config.json` + `.parallx/` files | JSON config, prompt file layering (SOUL.md, AGENTS.md, TOOLS.md) |
| Tool catalog (code-level registration) | Platform tool registry | `IToolsService` with SKILL.md manifests |
| Memory manager (standalone) | Platform memory service | `services.storeSessionMemory` / `services.recallMemories` |
| Hybrid search (standalone) | Platform retrieval service | `services.retrieveContext` — sqlite-vec + FTS5, RRF k=60 |
| Embedding (standalone) | Platform embedding via Ollama | nomic-embed-text, `/api/embed` |
| num_ctx injection (HTTP wrapper) | `ILanguageModelsService` model options | Must inject at service level, not HTTP |

### Platform constraints that shape the implementation

From M40, M11, M10, M9 instructions:

- `ILanguageModelsService` for all model calls — no direct Ollama HTTP
- Token budget: System 10%, RAG 30%, History 30%, User 30% (M11)
- Token estimation: `chars / 4` (M9)
- Prompt file layering: SOUL.md → AGENTS.md → TOOLS.md → `.parallx/rules/*.md` (M11)
- Workspace digest in system prompt, ~2000 tokens (M11)
- 3-tier permissions: always / approval / never (M11)
- Skill-based tools with SKILL.md manifests (M11)

---

## 4. System 1 — Execution Pipeline

### What OpenClaw builds

A 4-layer pipeline. L1 handles queue/steer (multi-user). L2 handles error recovery — context overflow detection → compaction → retry; transient HTTP → delay → retry; model fallback. L3 runs the main loop with iteration bounds (min 32, max 160), overflow compaction (max 3), timeout compaction (max 2). L4 executes a single attempt with full lifecycle: workspace setup, skill loading, system prompt build, tool creation, session management, context engine lifecycle, model execution.

### What Parallx builds

A 2-layer pipeline adapted from L2/L3/L4. L1 is N/A (single-user, no queue). L2 and L3 collapse into one error-handling + retry layer. L4 maps to the attempt.

#### Layer 1 — Turn Runner (from upstream L2 + L3)

```typescript
// Parallx adaptation of runAgentTurnWithFallback + runEmbeddedPiAgent
//
// Upstream evidence:
//   agent-runner-execution.ts:113-763 — overflow/transient retry
//   run.ts:879-1860 — MAX_OVERFLOW_COMPACTION_ATTEMPTS = 3, MAX_TIMEOUT_COMPACTION_ATTEMPTS = 2
//   agent-runner-execution.ts — transient retry delay: 2500ms

async function runOpenclawTurn(
  request: IChatRequest,
  context: IOpenclawTurnContext,
  token: CancellationToken,
): Promise<IOpenclawTurnResult> {

  const MAX_OVERFLOW_COMPACTION = 3;   // from run.ts
  const MAX_TIMEOUT_COMPACTION = 2;    // from run.ts
  const TRANSIENT_RETRY_DELAY = 2500;  // from agent-runner-execution.ts
  let overflowAttempts = 0;
  let timeoutAttempts = 0;

  while (!token.isCancellationRequested) {
    const assembled = await context.engine.assemble({
      sessionId: context.sessionId,
      history: context.history,
      tokenBudget: context.tokenBudget,
      prompt: request.prompt,
    });

    try {
      return await executeOpenclawAttempt(request, context, assembled, token);
    } catch (error) {
      if (isContextOverflow(error) && overflowAttempts < MAX_OVERFLOW_COMPACTION) {
        await context.engine.compact({ sessionId: context.sessionId, tokenBudget: context.tokenBudget });
        overflowAttempts++;
        continue;
      }
      if (isTimeoutError(error) && timeoutAttempts < MAX_TIMEOUT_COMPACTION) {
        await context.engine.compact({ sessionId: context.sessionId, tokenBudget: context.tokenBudget, force: true });
        timeoutAttempts++;
        continue;
      }
      if (isTransientError(error)) {
        await delay(TRANSIENT_RETRY_DELAY);
        continue;
      }
      throw error;
    }
  }
}
```

#### Layer 2 — Attempt (from upstream L4)

```typescript
// Parallx adaptation of runEmbeddedAttempt
//
// Upstream evidence:
//   attempt.ts:1672-3222 — single attempt lifecycle
//   attempt.ts — shouldInjectOllamaCompatNumCtx, wrapOllamaCompatNumCtx

async function executeOpenclawAttempt(
  request: IChatRequest,
  context: IOpenclawTurnContext,
  assembled: IOpenclawAssembleResult,
  token: CancellationToken,
): Promise<IOpenclawAttemptResult> {

  // 1. Build system prompt (System 3)
  const systemPrompt = buildOpenclawSystemPrompt({
    bootstrapFiles: context.bootstrapFiles,
    workspaceDigest: context.workspaceDigest,
    skills: context.skills,
    tools: context.tools,
    runtimeInfo: context.runtimeInfo,
    systemPromptAddition: assembled.systemPromptAddition,
  });

  // 2. Filter tools (System 4)
  const allowedTools = applyOpenclawToolPolicy({
    tools: context.tools,
    mode: context.mode,
  });

  // 3. Build messages
  const messages = [
    { role: 'system', content: systemPrompt },
    ...assembled.messages,
    { role: 'user', content: request.prompt },
  ];

  // 4. Execute model turn with num_ctx
  //    (upstream: wrapOllamaCompatNumCtx wraps stream to inject num_ctx)
  const result = await executeModelTurn({
    messages,
    tools: allowedTools,
    modelOptions: { num_ctx: context.tokenBudget },
    token,
  });

  // 5. Finalize context engine turn
  await context.engine.afterTurn?.({
    sessionId: context.sessionId,
    messages: [...messages, result.assistantMessage],
  });

  return result;
}
```

#### Error classification (from upstream L2)

```typescript
// Upstream evidence:
//   agent-runner-execution.ts — isContextOverflowError used in retry logic
//   Ollama API docs — error response patterns

function isContextOverflow(error: unknown): boolean {
  // Ollama: "context length exceeded", HTTP 400 with context error
  const msg = errorMessage(error).toLowerCase();
  return msg.includes('context length') || msg.includes('too many tokens');
}

function isTransientError(error: unknown): boolean {
  // Ollama restart, connection drop, temporary overload
  const msg = errorMessage(error).toLowerCase();
  return /econnrefused|etimedout|econnreset|503|502/.test(msg);
}

function isTimeoutError(error: unknown): boolean {
  const msg = errorMessage(error).toLowerCase();
  return msg.includes('timeout') || msg.includes('deadline');
}
```

### Files to create

| File | What it contains |
|------|-----------------|
| `src/openclaw/openclawTurnRunner.ts` | `runOpenclawTurn` — turn runner with retry/compaction (Layer 1) |
| `src/openclaw/openclawAttempt.ts` | `executeOpenclawAttempt` — single attempt execution (Layer 2) |
| `src/openclaw/openclawErrorClassification.ts` | `isContextOverflow`, `isTransientError`, `isTimeoutError` |

### Success criteria

1. `runOpenclawTurn` exists with retry loop matching upstream constants (overflow max 3, timeout max 2, transient delay 2500ms).
2. `executeOpenclawAttempt` runs a single attempt lifecycle: build prompt, filter tools, build messages, execute model, finalize.
3. Context overflow triggers `engine.compact()` → re-`assemble()` → retry.
4. Transient errors trigger delay → retry.
5. `num_ctx` is passed in model options.
6. Compiles. The turn runner can be called from a chat participant handler.

### Step-by-step tasks

1. **Read upstream source.** Re-read `agent-runner-execution.ts:113-763` (L2) and `run.ts:215-1860` (L3) from `OPENCLAW_PIPELINE_REFERENCE.md`. Confirm the retry constants and control flow.
2. **Create `src/openclaw/openclawErrorClassification.ts`.** Define `isContextOverflow`, `isTransientError`, `isTimeoutError`. Use Ollama-specific error patterns from upstream evidence.
3. **Create `src/openclaw/openclawAttempt.ts`.** Define `IOpenclawTurnContext`, `IOpenclawAttemptResult`, and `executeOpenclawAttempt`. This function takes an assembled context and executes a single model turn: build system prompt (calls System 3), filter tools (calls System 4), build messages, call model, finalize. Import from Systems 3/4 — if those aren't built yet, use placeholder imports that will compile once they exist.
4. **Create `src/openclaw/openclawTurnRunner.ts`.** Define `runOpenclawTurn`. This wraps `executeOpenclawAttempt` in a retry loop: assemble context (calls System 2), try attempt, on overflow → compact → re-assemble → retry, on transient → delay → retry. Use the upstream constants.
5. **Compile check.** `npx tsc --noEmit` — must pass with new files alongside old files.
6. **Unit test.** Write a basic test for error classification functions.

### Verification

```bash
npx tsc --noEmit
npx vitest run tests/unit/ --reporter=dot
```

---

## 5. System 2 — Context Engine

### What OpenClaw builds

A `ContextEngine` interface (from `context-engine/types.ts` lines 104-230) with lifecycle methods. The engine owns context assembly under a token budget. Per-attempt helpers (`attempt.context-engine-helpers.ts`) call `bootstrap`, `assemble`, and `finalize` during the attempt lifecycle. When the pipeline detects overflow, it calls `compact()` to reduce context, then re-assembles.

The `assemble()` return type is `{ messages, estimatedTokens, systemPromptAddition? }` — the engine builds the message array and reports token usage.

### What Parallx builds

An `IOpenclawContextEngine` interface adapted for Parallx's platform services. The engine uses `services.retrieveContext` for RAG, platform session storage for history, and the M11 token budget (System 10%, RAG 30%, History 30%, User 30%).

#### Interface

```typescript
// Parallx adaptation of ContextEngine (context-engine/types.ts:104-230)
//
// Upstream methods mapped:
//   assemble → assemble  (build context under budget)
//   compact  → compact   (reduce context on overflow)
//   afterTurn → afterTurn (post-turn persistence)
//
// Upstream methods NOT adopted (with reason):
//   bootstrap — Parallx bootstraps via platform (bootstrap files loaded separately)
//   maintain  — Transcript maintenance handled by compact
//   ingest/ingestBatch — Platform handles message persistence
//   prepareSubagentSpawn/onSubagentEnded — No subagents in Parallx
//   dispose — Engine is per-turn, not long-lived

interface IOpenclawContextEngine {
  assemble(params: {
    sessionId: string;
    history: IChatMessage[];
    tokenBudget: number;
    prompt: string;
  }): Promise<IOpenclawAssembleResult>;

  compact(params: {
    sessionId: string;
    tokenBudget: number;
    force?: boolean;
  }): Promise<IOpenclawCompactResult>;

  afterTurn?(params: {
    sessionId: string;
    messages: IChatMessage[];
  }): Promise<void>;
}

// Mirrors upstream AssembleResult from context-engine/types.ts
interface IOpenclawAssembleResult {
  messages: IChatMessage[];
  estimatedTokens: number;
  systemPromptAddition?: string;
}

// Mirrors upstream CompactResult from context-engine/types.ts
interface IOpenclawCompactResult {
  compacted: boolean;
  tokensBefore: number;
  tokensAfter: number;
}
```

#### Token budget manager

```typescript
// From M11 spec: System 10%, RAG 30%, History 30%, User 30%
// Upstream parallel: assembleAttemptContextEngine receives tokenBudget
//   from attempt.context-engine-helpers.ts:52-73

interface IOpenclawTokenBudget {
  total: number;       // model's context window (via num_ctx)
  system: number;      // 10% — system prompt + workspace digest
  rag: number;         // 30% — retrieved context
  history: number;     // 30% — conversation history
  user: number;        // 30% — current prompt + tool results
}

function computeTokenBudget(contextWindow: number): IOpenclawTokenBudget {
  return {
    total: contextWindow,
    system:  Math.floor(contextWindow * 0.10),
    rag:     Math.floor(contextWindow * 0.30),
    history: Math.floor(contextWindow * 0.30),
    user:    Math.floor(contextWindow * 0.30),
  };
}
```

#### Implementation

```typescript
// Parallx adaptation: uses platform services for retrieval and persistence
// Upstream: ContextEngine.assemble builds messages under budget
// Parallx: uses services.retrieveContext for RAG, buildSeedMessages for history

class OpenclawContextEngine implements IOpenclawContextEngine {
  constructor(private readonly services: IOpenclawParticipantServices) {}

  async assemble(params): Promise<IOpenclawAssembleResult> {
    const budget = computeTokenBudget(params.tokenBudget);

    // RAG: retrieve workspace context relevant to prompt, within budget
    const ragContext = await this.services.retrieveContext(params.prompt, budget.rag);

    // History: trim conversation history to fit budget
    const historyMessages = trimHistory(params.history, budget.history);

    // Build message array
    const messages = [
      ...historyMessages,
      ...ragContextToMessages(ragContext),
    ];

    return {
      messages,
      estimatedTokens: estimateTokens(messages),  // chars / 4 per M9
    };
  }

  async compact(params): Promise<IOpenclawCompactResult> {
    // Summarize older history to reduce token count
    // Upstream: compactEmbeddedPiSession in agent-runner-execution.ts
    const before = await this.estimateSessionTokens(params.sessionId);
    await this.summarizeOlderHistory(params.sessionId, params.tokenBudget);
    const after = await this.estimateSessionTokens(params.sessionId);
    return { compacted: after < before, tokensBefore: before, tokensAfter: after };
  }

  async afterTurn(params): Promise<void> {
    // Persist any memory mutations from this turn
    await this.services.flushMemory?.(params.sessionId);
  }
}
```

### Files to create

| File | What it contains |
|------|-----------------|
| `src/openclaw/openclawContextEngine.ts` | `IOpenclawContextEngine`, `IOpenclawAssembleResult`, `IOpenclawCompactResult`, `OpenclawContextEngine` |
| `src/openclaw/openclawTokenBudget.ts` | `IOpenclawTokenBudget`, `computeTokenBudget`, `estimateTokens` |

### Success criteria

1. `IOpenclawContextEngine` interface exists with `assemble`, `compact`, `afterTurn`.
2. `OpenclawContextEngine` implements the interface using platform retrieval and session services.
3. Token budget splits total context window into 10/30/30/30.
4. `assemble()` returns messages + token estimate within budget.
5. `compact()` reduces session token count.
6. The turn runner (System 1) uses the context engine for assembly and compaction.
7. Compiles.

### Step-by-step tasks

1. **Read upstream source.** Re-read `context-engine/types.ts:104-230` for the full `ContextEngine` interface and `AssembleResult`/`CompactResult` types. Re-read `attempt.context-engine-helpers.ts:0-73` for how the pipeline calls the engine.
2. **Create `src/openclaw/openclawTokenBudget.ts`.** Define `IOpenclawTokenBudget`, `computeTokenBudget(contextWindow)` → 10/30/30/30 split, and `estimateTokens(text)` → `Math.ceil(text.length / 4)` per M9.
3. **Create `src/openclaw/openclawContextEngine.ts`.** Define:
   - `IOpenclawContextEngine` interface with `assemble`, `compact`, `afterTurn?`
   - `IOpenclawAssembleResult` with `messages`, `estimatedTokens`, `systemPromptAddition?`
   - `IOpenclawCompactResult` with `compacted`, `tokensBefore`, `tokensAfter`
4. **Implement `OpenclawContextEngine.assemble()`.** Compute budget → retrieve RAG context within `budget.rag` → trim history within `budget.history` → build message array → return with token estimate. Uses platform `services.retrieveContext`.
5. **Implement `OpenclawContextEngine.compact()`.** Record token count before → summarize oldest history turns (keep recent N turns intact, compress older ones) → record token count after → return delta.
6. **Implement `OpenclawContextEngine.afterTurn()`.** Flush any pending memory mutations via `services.flushMemory`.
7. **Wire into turn runner.** Verify that `openclawTurnRunner.ts` (System 1) instantiates `OpenclawContextEngine` and calls `assemble` before each attempt, `compact` on overflow, `afterTurn` on success.
8. **Compile check.** `npx tsc --noEmit`.
9. **Unit test.** Test `computeTokenBudget` returns correct splits. Test `estimateTokens` matches `chars / 4`.

### Verification

```bash
npx tsc --noEmit
npx vitest run tests/unit/ --reporter=dot
```

---

## 6. System 3 — System Prompt Builder

### What OpenClaw builds

`buildAgentSystemPrompt` (from `agents/system-prompt.ts` lines 110-400) is a structured builder. It takes ~30 parameters and constructs a multi-section prompt. Key sections:

- **Skills section** (lines 20-37): XML-tagged skill entries with mandatory scan instruction. `"Before replying: scan <available_skills> <description> entries."`
- **Tool summaries** (via `buildToolSummaryMap`): `Record<string, string>` of tool name → description, injected into prompt text alongside the schema.
- **Bootstrap files** (via `resolveBootstrapContextForRun` from `bootstrap-files.ts`): AGENTS.md, SOUL.md, TOOLS.md loaded within per-file budget (default 20000 chars) and total budget (default 150000 chars).
- **Runtime metadata**: Host, OS, model name, provider, capabilities list.
- **Context files**: Workspace files injected as `# Project Context` section.

### What Parallx builds

`buildOpenclawSystemPrompt` — a structured builder adapted for Parallx's prompt file layering (M11) and local model requirements (M11 small model guidance).

```typescript
// Parallx adaptation of buildAgentSystemPrompt
// Upstream: agents/system-prompt.ts lines 110-400
//
// Sections follow upstream structure. Parallx additions:
//   - Workspace digest (M11, ~2000 tokens)
//   - Prompt file layers: SOUL.md → AGENTS.md → TOOLS.md → rules/ (M11)
//   - Small-model behavioral guidance (M11)

interface IOpenclawSystemPromptParams {
  // From upstream buildAgentSystemPrompt signature
  bootstrapFiles: IBootstrapFile[];        // AGENTS.md, SOUL.md, TOOLS.md content
  workspaceDigest: string;                 // Parallx M11: pre-computed workspace summary
  skills: ISkillEntry[];                   // skill name, description, location
  tools: IToolSummary[];                   // tool name, one-line description
  runtimeInfo: {
    model: string;                         // e.g. "gpt-oss:20b"
    provider: string;                      // "ollama"
    host: string;                          // "localhost"
    parallxVersion: string;
  };
  systemPromptAddition?: string;           // from context engine assemble()
}

function buildOpenclawSystemPrompt(params: IOpenclawSystemPromptParams): string {
  const sections: string[] = [];

  // Identity (upstream: first line of buildAgentSystemPrompt)
  sections.push(`You are Parallx, a local AI assistant for workspace knowledge management. You run on ${params.runtimeInfo.model} via ${params.runtimeInfo.provider}.`);

  // Skills (upstream: agents/system-prompt.ts lines 20-37)
  if (params.skills.length > 0) {
    sections.push(buildSkillsSection(params.skills));
  }

  // Tool summaries (upstream: buildToolSummaryMap in pi-embedded-runner/system-prompt.ts)
  if (params.tools.length > 0) {
    sections.push(buildToolSummariesSection(params.tools));
  }

  // Workspace context (upstream: bootstrap files + context files)
  // Parallx: prompt file layers SOUL.md → AGENTS.md → TOOLS.md
  sections.push(buildWorkspaceSection(params.bootstrapFiles, params.workspaceDigest));

  // Context engine addition (upstream: systemPromptAddition from AssembleResult)
  if (params.systemPromptAddition) {
    sections.push(params.systemPromptAddition);
  }

  // Runtime (upstream: runtimeInfo section)
  sections.push(buildRuntimeSection(params.runtimeInfo));

  // Behavioral rules (no upstream equivalent — Parallx small-model guidance per M11)
  sections.push(buildBehavioralRulesSection());

  return sections.join('\n\n');
}
```

#### Skills section builder

```typescript
// Upstream pattern from agents/system-prompt.ts lines 20-37

function buildSkillsSection(skills: ISkillEntry[]): string {
  const entries = skills.map(s =>
    `<skill><name>${s.name}</name><description>${s.description}</description><location>${s.location}</location></skill>`
  ).join('\n');

  return `## Skills (mandatory)
Before replying: scan <available_skills> <description> entries.
- If exactly one skill clearly applies: read its SKILL.md at <location>.
- If multiple could apply: choose the most specific one.
- If none clearly apply: do not read any SKILL.md.
<available_skills>
${entries}
</available_skills>`;
}
```

#### Tool summaries section builder

```typescript
// Upstream pattern: buildToolSummaryMap in pi-embedded-runner/system-prompt.ts line 74

function buildToolSummariesSection(tools: IToolSummary[]): string {
  const lines = tools.map(t => `- **${t.name}**: ${t.description}`).join('\n');
  return `## Available Tools\n${lines}`;
}
```

### Files to create

| File | What it contains |
|------|-----------------|
| `src/openclaw/openclawSystemPrompt.ts` | `buildOpenclawSystemPrompt`, `buildSkillsSection`, `buildToolSummariesSection`, `buildWorkspaceSection`, `buildRuntimeSection`, `buildBehavioralRulesSection` |

### Success criteria

1. `buildOpenclawSystemPrompt` exists and produces a multi-section prompt.
2. Skills section follows upstream XML pattern with mandatory scan instruction.
3. Tool summaries are injected into prompt text (not just API schema).
4. Bootstrap files (SOUL.md, AGENTS.md, TOOLS.md) are included within budget.
5. Workspace digest (~2000 tokens) is included.
6. Runtime metadata (model, provider) is included.
7. The attempt (System 1, Layer 2) uses this as the system message.
8. Compiles.

### Step-by-step tasks

1. **Read upstream source.** Re-read `agents/system-prompt.ts:110-400` for `buildAgentSystemPrompt` section structure. Re-read `agents/skills/workspace.ts:633-724` for skills XML format. Re-read `agents/bootstrap-files.ts:47-118` for bootstrap file budgets.
2. **Create `src/openclaw/openclawSystemPrompt.ts`.** Define `IOpenclawSystemPromptParams` interface.
3. **Implement `buildOpenclawSystemPrompt`.** Build sections in upstream order:
   - Identity line (model + provider from runtime info)
   - Skills section (XML-tagged entries with mandatory scan instruction)
   - Tool summaries section (name + one-line description for each tool)
   - Workspace section (bootstrap files within M11 budget + workspace digest)
   - Context engine addition (if `systemPromptAddition` provided by assembler)
   - Runtime section (model, provider, host, version)
   - Behavioral rules section (M11 small-model guidance — cite sources, be exhaustive, use evidence)
4. **Implement `buildSkillsSection`.** Follow upstream XML format exactly: `<skill><name>...</name><description>...</description><location>...</location></skill>`.
5. **Implement `buildToolSummariesSection`.** One line per tool: `- **name**: description`.
6. **Implement `buildWorkspaceSection`.** Load SOUL.md → AGENTS.md → TOOLS.md content within budget. Append workspace digest.
7. **Implement `buildBehavioralRulesSection`.** This is NOT output repair relocated. This is the standard "how to behave" section that every well-configured AI system has. Keep rules general and framework-level: cite sources, answer from evidence, be thorough. Do NOT add query-specific rules like "when asked about deductibles, quote exact values" — that's patch-thinking (see Anti-Pattern: Eval-driven patchwork in Section 2.2).
8. **Compile check.** `npx tsc --noEmit`.
9. **Manual test.** Call `/context` command → inspect the system prompt structure. Verify all sections present.

### Verification

```bash
npx tsc --noEmit
# Manual: call /context command, inspect system prompt structure
```

---

## 7. System 4 — Tool Policy

### What OpenClaw builds

`applyToolPolicyPipeline` (from `agents/tool-policy-pipeline.ts` lines 44-154) filters tools through a multi-step pipeline. Steps include profile-based filtering (`minimal | coding | messaging | full` from `tool-policy-shared.ts`), agent config allow/deny lists, and glob-pattern matching (`isToolAllowedByPolicyName` from `tool-policy-match.ts`).

### What Parallx builds

A simplified policy pipeline adapted for Parallx's modes and 3-tier permissions (M11).

```typescript
// Parallx adaptation of applyToolPolicyPipeline
// Upstream: agents/tool-policy-pipeline.ts lines 44-154
// Upstream profiles: minimal | coding | messaging | full
// Parallx profiles mapped to modes:

type OpenclawToolProfile = 'readonly' | 'standard' | 'full';

// Upstream: resolveToolProfilePolicy from tool-policy-shared.ts
const TOOL_PROFILES: Record<OpenclawToolProfile, { allow: string[]; deny: string[] }> = {
  readonly:  { allow: ['search_knowledge', 'list_files', 'read_file'], deny: ['write_file', 'edit_file', 'delete_file', 'run_command'] },
  standard:  { allow: ['*'], deny: ['run_command'] },
  full:      { allow: ['*'], deny: [] },
};

// Upstream: applyToolPolicyPipeline filters tools through steps
function applyOpenclawToolPolicy(params: {
  tools: IToolDefinition[];
  mode: OpenclawToolProfile;
  permissions?: IToolPermissions;  // M11 3-tier: always/approval/never
}): IToolDefinition[] {
  const profile = TOOL_PROFILES[params.mode];

  return params.tools.filter(tool => {
    // Step 1: Profile filter (upstream: resolveToolProfilePolicy)
    if (profile.deny.includes(tool.name)) return false;
    if (!profile.allow.includes('*') && !profile.allow.includes(tool.name)) return false;

    // Step 2: Permission filter (Parallx M11: 3-tier)
    if (params.permissions?.never?.includes(tool.name)) return false;

    return true;
  });
}
```

### Files to create

| File | What it contains |
|------|-----------------|
| `src/openclaw/openclawToolPolicy.ts` | `OpenclawToolProfile`, `TOOL_PROFILES`, `applyOpenclawToolPolicy` |

### Success criteria

1. `applyOpenclawToolPolicy` filters tools by profile and permissions.
2. Readonly mode restricts to read-only tools.
3. Full mode allows all tools.
4. Never-allowed tools are always excluded.
5. The attempt (System 1, Layer 2) uses this to filter tools before model call.
6. Compiles.

### Step-by-step tasks

1. **Read upstream source.** Re-read `tool-policy-pipeline.ts:44-154` for `applyToolPolicyPipeline` multi-step pattern. Re-read `tool-policy-shared.ts:0-49` for profiles.
2. **Create `src/openclaw/openclawToolPolicy.ts`.** Define `OpenclawToolProfile` type, `TOOL_PROFILES` record, and `IToolPermissions` interface.
3. **Implement `applyOpenclawToolPolicy`.** Follow upstream pipeline pattern but simplified for Parallx: profile filter → permissions filter. Deny-first, then allow.
4. **Map Parallx modes to profiles.** `readonly` (chat read-only) → restricted set. `standard` (normal chat) → all except dangerous. `full` (agent mode) → everything.
5. **Wire M11 3-tier permissions.** `always` tools pass through. `approval` tools get approval gate (handled by caller). `never` tools are filtered out.
6. **Compile check.** `npx tsc --noEmit`.
7. **Unit test.** Test each profile filters correctly. Test permissions override profile.

### Verification

```bash
npx tsc --noEmit
npx vitest run tests/unit/ --reporter=dot
```

---

## 8. Implementation Order

### Phase 1 — Build the four systems

Build all four systems as new files. Do not modify existing files yet.

| Order | System | Files | Depends on |
|-------|--------|-------|------------|
| 1 | Token Budget | `openclawTokenBudget.ts` | Nothing |
| 2 | Tool Policy | `openclawToolPolicy.ts` | Nothing |
| 3 | System Prompt | `openclawSystemPrompt.ts` | Nothing |
| 4 | Context Engine | `openclawContextEngine.ts` | Token Budget |
| 5 | Error Classification | `openclawErrorClassification.ts` | Nothing |
| 6 | Attempt | `openclawAttempt.ts` | System Prompt, Tool Policy, Context Engine |
| 7 | Turn Runner | `openclawTurnRunner.ts` | Attempt, Context Engine, Error Classification |

After this phase, we have 7 new files that compile independently. The existing code is untouched.

**Gate:** `npx tsc --noEmit` passes with the new files alongside the old files.

### Phase 2 — Wire the participant

Replace the current participant turn handler to call `runOpenclawTurn` from the new turn runner. The participant becomes a thin adapter.

#### Step-by-step tasks

1. **Read the current participant.** Read `openclawDefaultParticipant.ts` fully. Identify the exact function that handles incoming chat requests (`runOpenclawDefaultTurn` or equivalent). Map every service it uses.
2. **Create `IOpenclawTurnContext` builder.** Write a function `buildTurnContext(request, services)` that constructs the `IOpenclawTurnContext` that `runOpenclawTurn` expects. This maps platform services to the context: session ID from request, history from session, token budget from model config, bootstrap files from prompt file loader, workspace digest from digest service, skills from skill registry, tools from tool registry, mode from settings.
3. **Replace the turn handler.** In the participant's request handler: call `buildTurnContext` → call `runOpenclawTurn` → stream the result. The old call to `runOpenclawDefaultTurn` (or whatever the old entry point is) is replaced.
4. **Preserve slash command dispatch.** Slash commands (`/init`, `/context`, `/compact`) must still route to their handlers BEFORE reaching `runOpenclawTurn`. These are structural routing (allowed per P5), not content classification.
5. **Verify streaming.** The turn runner's result must be streamed back via the VS Code chat response stream, same as before.
6. **Compile check.** `npx tsc --noEmit`.
7. **Manual smoke test.** Send a chat message → get response. Send `/context` → get context dump. Send `/compact` → get compaction result.

**Gate:** A chat message reaches `runOpenclawTurn`, calls the model via the new pipeline, and streams a response. All slash commands still work.

### Phase 3 — Remove replaced code

The old code is now dead — the participant calls the new systems. This phase is pure deletion.

#### Step-by-step tasks

1. **Identify dead code.** Search for every function/constant in `openclawDefaultRuntimeSupport.ts` and `openclawDefaultParticipant.ts`. For each, check if it's still imported or called anywhere after Phase 2. If not, it's dead.
2. **Delete dead functions.** Remove all unreferenced code. Expected deletions include:
   - Regex routing constants (`OPENCLAW_WORKSPACE_ROUTING_TERMS`, etc.)
   - `resolveOpenclawTurnInterpretation`
   - All `repair*` functions
   - All `ensure*` / `normalize*` functions
   - `buildDeterministicWorkflowAnswer` / `summarizeSource`
   - `buildOpenclawProductSemanticsAnswer` / `isLikelyOpenclawConversationalTurn` / `buildOpenclawOffTopicRedirectAnswer`
   - `buildOpenclawPromptEnvelope` (replaced by System 3)
   - `prepareOpenclawContext` (replaced by System 2)
3. **Grep check.** `grep -rn "<function_name>" src/openclaw/` for each deleted function — must return nothing.
4. **Compile check.** `npx tsc --noEmit`.
5. **Assess the monolith file.** If `openclawDefaultRuntimeSupport.ts` has very little left, consider whether it should be removed entirely or just trimmed. The systems are in their own files now — the monolith should not be needed.
6. **Delete unused types.** Check `openclawTypes.ts` for types that only the deleted code used. Remove them.
7. **Run unit tests.** Delete or update tests that tested deleted code. Remaining tests must pass.

**Gate:** `grep` confirms no references to deleted code. `npx tsc --noEmit` passes. `npx vitest run tests/unit/ --reporter=dot` passes.

### Phase dependency graph

```
Phase 1: Build systems (new files only, no existing code touched)
    ↓
Holistic Integration Audit (Section 9 — verify systems cohere before wiring)
    ↓
Phase 2: Wire participant (one integration point changed)
    ↓
Phase 3: Remove replaced code (dead code elimination)
```

Each phase is independently committable. Phase 1 is pure addition. Phase 2 is a single integration change. Phase 3 is pure deletion.

---

## 9. Holistic Integration Audit

**When:** After Phase 1 (Build), before Phase 2 (Wire). All four systems exist as new files. Nothing is wired yet.

**Purpose:** Verify that the four systems form a coherent whole before integrating them. Catch interface mismatches, data flow gaps, and missing concerns while the cost of fixing them is low (editing new files only).

### 9.1 Data flow trace

Trace a single user message through the entire pipeline on paper. Every handoff must be concrete — no "and then it somehow gets to X."

```
User sends "What is my collision deductible?" in chat

1. Participant handler receives IChatRequest
   → Calls buildTurnContext(request, services) → produces IOpenclawTurnContext
   → Calls runOpenclawTurn(request, context, token)

2. Turn Runner (openclawTurnRunner.ts)
   → Calls context.engine.assemble({ sessionId, history, tokenBudget, prompt })
   → Receives IOpenclawAssembleResult { messages, estimatedTokens, systemPromptAddition? }

3. Turn Runner → calls executeOpenclawAttempt(request, context, assembled, token)

4. Attempt (openclawAttempt.ts)
   → Calls buildOpenclawSystemPrompt({ bootstrapFiles, workspaceDigest, skills, tools, runtimeInfo, systemPromptAddition })
   → Receives string (the system prompt)
   → Calls applyOpenclawToolPolicy({ tools, mode, permissions })
   → Receives IToolDefinition[] (filtered tools)
   → Builds messages: [{ system, systemPrompt }, ...assembled.messages, { user, prompt }]
   → Calls executeModelTurn({ messages, tools: filteredTools, modelOptions: { num_ctx } })
   → Receives model response
   → Calls context.engine.afterTurn({ sessionId, allMessages })
   → Returns IOpenclawAttemptResult

5. Back in Turn Runner
   → No error? → Returns result
   → Context overflow? → engine.compact() → loop back to step 2
   → Transient error? → delay(2500) → loop back to step 2

6. Back in Participant
   → Streams result to VS Code chat response
```

**Checklist for the data flow trace:**

- [ ] Every function call in the trace uses types that actually exist in the new files
- [ ] Every parameter passed is available at the point where it's needed (no "where does `tokenBudget` come from?")
- [ ] The `IOpenclawTurnContext` contains everything the pipeline needs (session, history, budget, bootstrap, digest, skills, tools, runtime, engine)
- [ ] The context engine's `assemble()` return is consumed correctly by the attempt
- [ ] The system prompt builder receives all its required params from the attempt
- [ ] The tool policy receives the tool list and mode
- [ ] The `num_ctx` value traces from `IOpenclawTurnContext.tokenBudget` through to model options
- [ ] Error classification functions handle Ollama-specific error patterns
- [ ] `afterTurn` receives the complete message array including the assistant's response

### 9.2 Interface consistency check

For each boundary between systems, verify the types match:

| Boundary | Producer | Consumer | Type | Check |
|----------|----------|----------|------|-------|
| Turn Runner → Context Engine | `runOpenclawTurn` | `engine.assemble()` | `{ sessionId, history, tokenBudget, prompt }` | Does `IOpenclawTurnContext` have all these? |
| Context Engine → Attempt | `assemble()` returns | `executeOpenclawAttempt` param | `IOpenclawAssembleResult` | Same type in both files? |
| Attempt → System Prompt | `executeOpenclawAttempt` | `buildOpenclawSystemPrompt` | `IOpenclawSystemPromptParams` | Does context carry bootstrap files, digest, skills, tools, runtime? |
| Attempt → Tool Policy | `executeOpenclawAttempt` | `applyOpenclawToolPolicy` | `{ tools, mode, permissions? }` | Does context carry mode and permissions? |
| Turn Runner → Error Classification | `catch (error)` | `isContextOverflow(error)` | `unknown` | Functions accept `unknown`? |
| Turn Runner → Context Engine | overflow path | `engine.compact()` | `{ sessionId, tokenBudget, force? }` | Available from context? |

### 9.3 Missing concern detection

Ask these questions. If the answer is "I don't know" or "it's not defined," there's a gap.

1. **Where does `tokenBudget` come from?** Which service provides the model's context window size? Is it in `ai-config.json`? Ollama model info API? Hardcoded?
2. **Where does the workspace digest come from?** Which service computes it? Is it ready at turn time, or does it need to be triggered?
3. **Where do bootstrap files come from?** Which service loads SOUL.md, AGENTS.md, TOOLS.md? What if they don't exist?
4. **Where does the skill list come from?** Which service provides `ISkillEntry[]`?
5. **Where does the tool list come from?** Which service provides `IToolDefinition[]` with names and descriptions?
6. **Where does the current mode come from?** User setting? Per-session? Per-request?
7. **What happens when the model produces a tool call?** Does `executeModelTurn` handle tool execution internally, or does the attempt need a tool loop?
8. **What happens when compaction fails to reduce enough?** After 3 overflow compactions, the error propagates. What does the participant do with it?
9. **How are streaming responses handled?** Does `executeModelTurn` return a stream or a complete result? How does the participant stream chunks to the VS Code chat response?

Each question must have a concrete answer before wiring begins. If the answer requires building something, add it to Phase 1.

### 9.4 Gate

All three checks pass:
- [ ] Data flow trace — every handoff is concrete with matching types
- [ ] Interface consistency — every boundary uses matching types
- [ ] Missing concerns — every question has a concrete answer or a Phase 1 addition

Only then proceed to Phase 2 (Wire).

---

## 10. Verification Plan

### Per-phase gates

| Phase | Gate | How to verify |
|-------|------|---------------|
| 1 | New systems compile | `npx tsc --noEmit` |
| 1 | Types are consistent | New interfaces used correctly across systems |
| 2 | Turn reaches new pipeline | Send message, verify it reaches `runOpenclawTurn` |
| 2 | Model responds | Send message, get streaming response |
| 2 | Slash commands work | `/context`, `/init`, `/compact` function |
| 2 | Tools work | Model can call tools, results stream back |
| 3 | Old code removed | `grep` for deleted function names returns nothing |
| 3 | Still compiles | `npx tsc --noEmit` |

### End-to-end validation

After all phases, run the full AI eval suite:

```bash
npx vitest run tests/ai-eval/ --reporter=verbose
```

Eval failures are expected initially. For each failure, the diagnostic process is:
1. What system prompt did the model receive? (Inspect via `/context`)
2. What context was assembled? (Log from context engine)
3. What was the model's raw output? (Before any processing)
4. Is the failure due to missing context, unclear prompt instruction, or model limitation?

The fix for any failure is always in the systems — a better prompt section, better context assembly, better tool descriptions. Never in post-processing the model's output.

### Regression analysis

For test cases that previously passed (via output repair) and now fail:
- The previous pass was artificial. The repair function manufactured the answer.
- The real fix is in the inputs: system prompt instructions, context assembly quality, tool descriptions.
- Document each regression with the specific system change needed to fix it.

---

## 11. Risk Assessment

| Risk | Severity | Mitigation |
|------|----------|------------|
| AI eval regression during Phase 2 | Expected | Fix via System 3 (prompt) and System 2 (context). Never via output repair. |
| Local model doesn't follow structured prompt | High | M11 mandates explicit small-model guidance. Use clear, direct instructions. Test iteratively with actual model. |
| Token budget miscalculation | Medium | Conservative estimation (chars/4 per M9). Log actual vs estimated per turn. |
| Compaction loses important context | Medium | Compact oldest turns first, preserve recent. Log what gets compacted. |
| num_ctx injection doesn't work through ILanguageModelsService | Medium | May need service-level enhancement. Verify with Ollama API logs. |
| Phase 2 integration breaks slash commands | Low | Slash command dispatch is structural — wire as a pre-check before the turn runner. |

---

## 12. Upstream Systems N/A for Parallx

These are documented to prevent scope creep. They exist in OpenClaw but are not part of what we build.

| Upstream System | Why not applicable |
|-----------------|-------------------|
| Multi-user queue policy / steer checks (L1) | Single-user desktop app |
| Session lane / global lane concurrency (L3) | Single-user |
| Auth profile rotation (L3) | Single local Ollama, no API keys |
| Gateway HTTP tool restrictions | No gateway |
| Subagent spawning | Not in scope |
| Channel-specific routing | Not a messaging app |
| Context engine plugin registry | One engine is sufficient |
| Sandbox filesystem isolation | Not applicable to Parallx's model |
| Transcript rewrite via DAG branch | Platform session storage |

---

## 13. Reference Index

Every claim in this document traces to a direct source code read. No conclusions are inferred.

### Upstream source files read

| File | Lines | What was extracted |
|------|-------|--------------------|
| `agent-runner.ts` | 63-728 | L1 `runReplyAgent` — signature, control flow, queue/steer |
| `agent-runner-execution.ts` | 113-763 | L2 `runAgentTurnWithFallback` — overflow/transient retry, 2500ms delay |
| `run.ts` | 215-1860+ | L3 `runEmbeddedPiAgent` — retry loop bounds, MAX_OVERFLOW=3, MAX_TIMEOUT=2 |
| `attempt.ts` | 1672-3222+ | L4 `runEmbeddedAttempt` — attempt lifecycle, num_ctx injection |
| `context-engine/types.ts` | 0-230 | Full `ContextEngine` interface, all result types |
| `context-engine/legacy.ts` | 0-91 | `LegacyContextEngine` implementation |
| `context-engine/registry.ts` | 0-427 | Engine registration, resolution |
| `attempt.context-engine-helpers.ts` | 0-73 | Per-attempt bootstrap, assemble, finalize helpers |
| `context-engine-maintenance.ts` | 0-82 | Transcript maintenance |
| `agents/system-prompt.ts` | 0-400 | `buildAgentSystemPrompt` — sections, skills, tools |
| `pi-embedded-runner/system-prompt.ts` | 0-85 | `buildEmbeddedSystemPrompt` wrapper |
| `agents/bootstrap-files.ts` | 47-118 | `resolveBootstrapContextForRun` — file budgets |
| `agents/skills/workspace.ts` | 633-724 | `buildWorkspaceSkillsPrompt` — XML skill entries |
| `tool-policy.ts` | 0-156 | Base policy types, owner-only, allowlist |
| `tool-policy-match.ts` | 0-44 | `isToolAllowedByPolicyName` — glob matching |
| `tool-policy-pipeline.ts` | 44-154 | `applyToolPolicyPipeline` — multi-step filtering |
| `tool-policy-shared.ts` | 0-49 | Profiles: minimal, coding, messaging, full |

### Parallx reference documents

| Document | Contents |
|----------|----------|
| `docs/clawrallx/OPENCLAW_PIPELINE_REFERENCE.md` | L1-L4 function signatures, parameters, control flow, key constants |
| `docs/clawrallx/OPENCLAW_INTEGRATION_AUDIT.md` | Line-by-line audit of all 11 `src/openclaw/` files |
| `docs/clawrallx/OPENCLAW_GAP_MATRIX.md` | 43-item gap matrix, 7 categories |
| `docs/clawrallx/OPENCLAW_REFERENCE_SOURCE_MAP.md` | Foundation document, upstream file index |

---

## Phase 4 — Strip Post-Retrieval Heuristic Pipeline (Hybrid Search Alignment)

**Status:** Complete  
**Rationale:** Parallx added 8+ post-RRF heuristic stages (lexical focus boost, intent-aware source boost, second-stage rerank, late-interaction rerank, diversity reordering, evidence role balancing, structure-aware expansion, cosine re-ranking, score drop-off) on top of the core hybrid search. Upstream OpenClaw does simple RRF (vector + keyword, k=60) and lets the model decide relevance — no post-retrieval score manipulation. The heuristic stages were identified as the root cause of retrieval quality problems.

### Changes

| File | Action | Details |
|------|--------|---------|
| `src/services/retrievalService.ts` | Rewrote `retrieve()` | Simplified to 6-stage pipeline: embed → hybrid RRF → artifact hygiene → score threshold → dedup → token budget. Removed all heuristic stage calls. |
| `src/services/retrievalService.ts` | Deleted 9 heuristic methods | `_applyLexicalFocusBoost`, `_applyIntentAwareSourceBoost` (295 lines), `_applySecondStageRerank`, `_scoreLateInteractionMatch`, `_applyDiversityReordering`, `_applyEvidenceRoleBalancing`, `_applyStructureAwareExpansion`, `_shouldExpandStructure`, `_cosineRerank` |
| `src/services/retrievalService.ts` | Deleted 9 dead helpers/types | `extractFocusTerms`, `collectRerankFocusTerms`, `isInsuranceCorpusCandidate`, `EvidenceRole`, `uniqueValues`, `classifyQueryEvidenceRoles`, `classifyResultEvidenceRoles`, `DEFAULT_MIN_COSINE_SCORE`, `DEFAULT_DROPOFF_RATIO` |
| `src/services/retrievalService.ts` | Simplified `RetrievalTrace` | Removed heuristic-specific counts (`afterStructureExpansionCount`, `afterDropoffCount`, etc.), `rankingTrace`, `rerankScores`, `cosineThreshold`, `dropoffRatio` |
| `src/services/retrievalService.ts` | Simplified `IRetrievalConfigProvider` | Removed `ragDiversityStrength`, `ragStructureExpansionMode`, `ragRerankMode`, `ragCosineThreshold`, `ragDropoffRatio` |
| `src/services/retrievalService.ts` | Cleaned `_applyTokenBudget` | Removed `EvidenceRole`/`classifyResultEvidenceRoles` references from packing logic |
| `src/services/retrievalService.ts` | Deleted `RetrievalRerankScoreTrace` | Dead export type |
| `src/aiSettings/unifiedConfigTypes.ts` | Removed 5 config properties | `ragDiversityStrength`, `ragStructureExpansionMode`, `ragRerankMode`, `ragCosineThreshold`, `ragDropoffRatio` from interface and defaults |
| `src/aiSettings/ui/sections/retrievalSection.ts` | Removed 5 UI controls | Diversity Strength, Hard-Document Expansion, Rerank Mode, Cosine Threshold, Drop-off Ratio — member fields, build blocks, and update blocks |
| `tests/unit/retrievalService.test.ts` | Deleted 26 heuristic tests | Cosine re-ranking, diversity, late-interaction, structure expansion, intent-aware boosts, evidence role balancing, drop-off filter |
| `tests/unit/retrievalService.test.ts` | Updated 3 tests | Cleaned mock configs and trace assertions |
| `tests/unit/unifiedAIConfigService.test.ts` | Removed 5 dead assertions | Default config assertions for deleted properties |
| `tests/ai-eval/ai-eval-fixtures.ts` | Removed `ragRerankMode` verification | Simplified debug helper |

### Line count

| File | Before | After | Delta |
|------|--------|-------|-------|
| `retrievalService.ts` | 2309 | 1138 | −1171 |
| `retrievalService.test.ts` | ~1663 | ~600 | ~−1063 |

---

## Phase 5 — Session Transcript & Compaction Alignment

**Status:** Complete  
**Rationale:** Upstream couples compaction with auto-flush to long-term memory. Parallx's `compact()` was a stub that called `compactSession()` with a placeholder string and never flushed to memory. JSONL transcript writing (M33) was already in place.

### Changes

| File | Action | Details |
|------|--------|---------|
| `src/openclaw/openclawContextEngine.ts` | Rewrote `compact()` | Now generates real summary via `sendSummarizationRequest`, calls `compactSession()` with the actual summary, and auto-flushes to long-term memory via `storeSessionMemory()`. Caches history from `assemble()` for use by `compact()`. |
| `src/openclaw/openclawDefaultRuntimeSupport.ts` | Wired memory flush into `/compact` command | After manual compaction, calls `storeSessionMemory()` to persist summary to long-term memory. Updated `IOpenclawCompactCommandDeps` and `tryHandleOpenclawCompactCommand` signature. |

### Verification

- 2603 / 2603 unit tests pass (163 test files)
- Zero compile errors
