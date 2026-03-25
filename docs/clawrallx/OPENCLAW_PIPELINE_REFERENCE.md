# OpenClaw Upstream Pipeline Reference (Tier 1)

**Source:** `github.com/openclaw/openclaw` commit e635cedb  
**Extracted:** 2026-03-25  
**Purpose:** Concise reference of upstream function signatures, parameters, and control flow for the 4-layer execution pipeline. Every Parallx integration change must trace to patterns documented here.

---

## L1: `runReplyAgent` — agent-runner.ts:63-728

### Signature
```ts
export async function runReplyAgent(
  commandBody: string,           // message text after directive stripping
  followupRun: boolean,          // whether this is a followup turn
  queueKey: string,              // concurrency queue key
  resolvedQueue: ResolvedQueue,  // queue state
  shouldSteer: boolean,          // steer-check flag
  shouldFollowup: boolean,       // followup flag
  isActive: () => boolean,       // activity check
  isRunActive: () => boolean,    // run activity check
  isStreaming: () => boolean,    // streaming check
  opts: RunReplyAgentOpts,       // callbacks: onStart, onComplete, onChunk, onError
  typing: TypingController,      // typing indicator controller
  sessionEntry: SessionStoreEntry,
  sessionStore: SessionStore,
  sessionKey: string,
  storePath: string,
  defaultModel: string,
  agentCfgContextTokens: number | undefined,
  resolvedVerboseLevel: number,
  isNewSession: boolean,
  blockStreamingEnabled: boolean,
  blockReplyChunking: boolean,
  resolvedBlockStreamingBreak: number,
  sessionCtx: SessionContext,
  shouldInjectGroupIntro: boolean,
  typingMode: 'always' | 'auto' | 'off',
): Promise<void>
```

### Control Flow
1. Steer check → if shouldSteer, run steer evaluation
2. Queue policy → check resolvedQueue: drop/enqueue-followup/proceed
3. Create followup runner via `createFollowupRunner`
4. Call `runAgentTurnWithFallback` (L2) with full params
5. Build reply via `buildReplyPayloads` for streaming/block output
6. Post-process: usage tracking, followup scheduling

### Key Imports
- `runAgentTurnWithFallback` from `agent-runner-execution.js`
- `buildReplyPayloads` from `agent-runner-payloads.js`
- `createFollowupRunner` from `followup-runner.js`
- `createBlockReplyPipeline` from `block-reply-pipeline.js`

---

## L2: `runAgentTurnWithFallback` — agent-runner-execution.ts:113-763

### Signature
```ts
export async function runAgentTurnWithFallback(
  // inherits all L1 params plus:
  resetSessionAfterCompactionFailure: boolean,
  resetSessionAfterRoleOrderingConflict: boolean,
  isHeartbeat: boolean,
): Promise<AgentTurnResult>
```

### Control Flow
1. Wrap execution in `runWithModelFallback` (from model-fallback.ts)
   - Provider failover: tries primary model, falls back to alternates
2. Inner function calls `runEmbeddedPiAgent` (L3)
3. Retry loop for:
   - **Context overflow**: detect via `isContextOverflowError` → `compactEmbeddedPiSession` → retry
   - **Transient HTTP**: 2500ms sleep → retry
   - **Rate limit**: detect via response code → mark auth profile failure
   - **Billing error**: detect → abort with clear message
4. Error classification:
   - Compaction failure → reset session if `resetSessionAfterCompactionFailure`
   - Role ordering conflict → reset if `resetSessionAfterRoleOrderingConflict`

### Key Constants
- Transient retry delay: 2500ms
- Max compaction retries: configured via L3

---

## L3: `runEmbeddedPiAgent` — run.ts:215-1860+

### Signature
```ts
export async function runEmbeddedPiAgent(
  // complex params including:
  sessionEntry, sessionStore, sessionKey, storePath,
  defaultModel, agentCfgContextTokens, resolvedVerboseLevel,
  isNewSession, sessionCtx,
): Promise<EmbeddedRunResult>
```

### Control Flow
1. Resolve session lane (`resolveSessionLane`) — one turn per session
2. Resolve global lane (`resolveGlobalLane`) — total concurrent limit
3. Resolve model (`resolveModel`)
4. Resolve auth profiles (`resolveAuthProfileOrder`)
5. Create context engine
6. Main retry loop:
   - `MAX_RUN_LOOP_ITERATIONS` = 24 base + 8 per auth profile (min 32, max 160)
   - Call `runEmbeddedAttempt` (L4)
   - Handle overflow compaction (max 3 attempts)
   - Handle timeout compaction (max 2 attempts)
   - Auth profile rotation on failure
   - Thinking level fallback
7. Build success payloads
8. Return result

### Key Constants
- `MAX_TIMEOUT_COMPACTION_ATTEMPTS = 2`
- `MAX_OVERFLOW_COMPACTION_ATTEMPTS = 3`
- Loop iteration bounds: min 32, max 160

---

## L4: `runEmbeddedAttempt` — attempt.ts:1672-3222+

### Signature
```ts
async function runEmbeddedAttempt(
  // workspace, sandbox, session params
): Promise<AttemptResult>
```

### Control Flow (execution order)
1. Resolve workspace + sandbox
2. Load skills → `loadSkillEntries`
3. Build system prompt → `buildEmbeddedSystemPrompt`
4. Create tools → `createOpenClawCodingTools`
5. Acquire session lock
6. Create session manager → `SessionManager`
7. Bootstrap context engine → `runAttemptContextEngineBootstrap`
8. Create agent session → `createAgentSession` (from `@mariozechner/pi-coding-agent`)
9. Apply system prompt to session
10. Configure stream function:
    - Standard: direct model stream
    - Ollama: wrap with `wrapOllamaCompatNumCtx` if `shouldInjectOllamaCompatNumCtx`
11. Session transcript handling (load/restore)
12. Assemble context engine → `assembleAttemptContextEngine`
13. Execute prompt → run through agent session
14. Finalize context engine turn
15. Return result

### Ollama-Specific Patterns
- `shouldInjectOllamaCompatNumCtx` — checks if Ollama provider needs num_ctx injection
- `wrapOllamaCompatNumCtx` — wraps stream function to inject num_ctx into Ollama API calls
- This is critical for Parallx since it uses Ollama exclusively

### System Prompt Assembly
- `buildEmbeddedSystemPrompt` constructs from:
  - Workspace bootstrap files (AGENTS.md, SOUL.md, etc.)
  - Tool definitions and descriptions
  - Skill prompt entries
  - Runtime metadata (model, provider, capabilities)

### Tool Creation  
- `createOpenClawCodingTools` creates the full tool set
- Tools filtered by `isToolAllowedByPolicies` (4-stage pipeline)
- Tool categories: read, write, exec, search, memory, gateway

---

## Key Patterns Parallx Must Adopt

1. **Layered execution** — Not one monolith. Each layer handles a specific concern.
2. **Retry with compaction** — Context overflow triggers compaction, not failure.
3. **Concurrency control** — Session and global lanes prevent race conditions.
4. **Auth/model failover** — Multiple attempts with profile rotation before failing.
5. **Ollama num_ctx injection** — Critical for local model support.
6. **Context engine lifecycle** — Bootstrap → assemble → maintain → finalize per turn.
7. **System prompt construction** — Structured builder, not ad-hoc string concat.
8. **Tool policy enforcement** — Multi-stage filtering, not "send all tools".
