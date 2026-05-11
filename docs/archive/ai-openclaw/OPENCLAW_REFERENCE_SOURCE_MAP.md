# OpenClaw Reference Source Map

**Status:** In progress  
**Date:** 2026-03-25  
**Purpose:** Ground ALL future Parallx OpenClaw integration work in the actual
upstream source code. No more heuristic patches. No more guessing.

**Upstream repo:** `https://github.com/openclaw/openclaw` (commit e635cedb, indexed 2026-03-20)  
**Upstream docs:** `https://deepwiki.com/openclaw/openclaw`

---

## 0. Why This Document Exists

The previous AI agent (ChatGPT) built Parallx's OpenClaw integration as
heuristic patchwork — regex routing terms, output-layer answer supplements,
domain-keyword off-topic detection — none of it derived from the actual OpenClaw
source. When caught, it admitted it never read the upstream code.

**Rule going forward:** Every piece of OpenClaw integration code in Parallx must
trace back to a specific upstream file, function, or contract. If it can't, it
doesn't belong.

---

## 1. OpenClaw System Architecture

### 1.1 What OpenClaw Is

OpenClaw is a self-hosted multi-channel AI gateway (Node.js single process).

- Hub-and-spoke: Gateway is the central control plane
- Agent-native: Built on Pi Agent runtime (tool execution, session isolation, multi-agent routing)
- Plugin-based: Channels, auth providers, utilities are modular extensions
- Local-first: Config and state in `~/.openclaw/`

### 1.2 What Parallx Needs From It

Parallx is a desktop-first VS Code-architecture workbench. It does NOT need:
- Multi-channel messaging gateway
- WebSocket RPC protocol
- Docker/daemon deployment
- Channel plugin SDK

Parallx DOES need the **agent runtime patterns**:
- Execution pipeline (how a message becomes a model call and response)
- Context engine (how context is assembled, compacted, maintained)
- Memory & search (hybrid retrieval, embedding, search scoring)
- System prompt construction (how the system prompt is built per-turn)
- Tool policy enforcement (how tools are filtered and dispatched)
- Session management (isolation, transcript persistence, compaction)

---

## 2. Execution Pipeline — The 4-Layer Call Chain

This is THE critical architecture. OpenClaw processes every message through 4
nested layers, each adding specific capabilities.

### Layer 1: `runReplyAgent`
- **File:** `src/auto-reply/reply/agent-runner.ts` (lines 63-728)
- **Responsibility:** Queue policy, steer check, block streaming pipeline, post-processing, usage reporting
- **Input:** `commandBody` (message text after directive stripping), `followupRun`, `typing` controller, `opts` callbacks
- **Key detail:** If `blockStreamingEnabled`, initializes `createBlockReplyPipeline` for incremental text delivery

### Layer 2: `runAgentTurnWithFallback`
- **File:** `src/auto-reply/reply/agent-runner-execution.ts` (lines 77-380)
- **Responsibility:** Retry loop for context overflow and transient HTTP errors
- **Context overflow:** Detects via `isContextOverflowError` → triggers `compactEmbeddedPiSession` → retries
- **Transient HTTP:** Sleep 2500ms → retry

### Layer 3: `runEmbeddedPiAgent`
- **File:** `src/agents/pi-embedded-runner/run.ts` (line 256+)
- **Responsibility:** Lane queuing (session + global concurrency control), model resolution, auth profile rotation
- **Concurrency:** `resolveSessionLane` (one turn per session), `resolveGlobalLane` (total concurrent limit)
- **Auth rotation:** `resolveAuthProfileOrder` → iterate candidates → `markAuthProfileFailure` on rate limit/auth error

### Layer 4: `runEmbeddedAttempt`
- **File:** `src/agents/pi-embedded-runner/run/attempt.ts` (line 427+)
- **Responsibility:** The actual model call. Workspace setup, tool creation, session init.
- **Environment setup (in order):**
  1. System prompt via `buildEmbeddedSystemPrompt` (attempt.ts:132)
  2. Tools via `createOpenClawCodingTools` (attempt.ts:80)
  3. Session management via `SessionManager` (attempt.ts:8-9)
  4. Extra params via `applyExtraParamsToAgent` (extra-params.ts:178-220)

### Execution Stages (full order)
1. **Input Processing:** `parseReplyDirectives`, `detectCommand`
2. **Model Resolution:** `resolveModel`, `resolveAuthProfileOrder`, `runWithModelFallback`
3. **System Prompt:** `buildEmbeddedSystemPrompt`, `resolveBootstrapContextForRun`
4. **Execution:** L1 → L2 → L3 → L4
5. **Tool Dispatch:** `createOpenClawCodingTools`, `isToolAllowedByPolicies`
6. **Response Processing:** `subscribeEmbeddedPiSession`, `buildReplyPayloads`, `createBlockReplyPipeline`
7. **State Management:** `updateSessionStoreEntry`, `persistRunSessionUsage`, `compactEmbeddedPiSession`

---

## 3. Context Engine

### 3.1 Contract
- **File:** `src/context-engine/types.ts` (lines 74-231)
- **Interface:** `ContextEngine` — pluggable contract for context management
- **Required methods:** Generic lifecycle (maintain, bootstrap, assemble)
- **Optional methods:** Retrieval, lineage, etc.

### 3.2 Key Types
- `ContextEngineMaintenanceResult` = `TranscriptRewriteResult`
- `ContextEngineRuntimeContext` = Record with `rewriteTranscriptEntries` helper
- `TranscriptRewriteRequest` / `TranscriptRewriteResult` — safe transcript rewrite

### 3.3 Runtime Integration
- **File:** `src/agents/pi-embedded-runner/context-engine-maintenance.ts`
- `buildContextEngineMaintenanceRuntimeContext` — attaches rewrite helpers to runtime context
- `runContextEngineMaintenance` — runs optional transcript maintenance
- **File:** `src/agents/pi-embedded-runner/run/attempt.context-engine-helpers.ts`
- `runAttemptContextEngineBootstrap` — runs on session init
- `assembleAttemptContextEngine` — builds context per-attempt (messages, token budget, model ID)

### 3.4 Initialization
- **File:** `src/context-engine/init.ts` — `ensureContextEnginesInitialized`
- **File:** `src/context-engine/registry.ts` — `resolveContextEngine`

---

## 4. Memory & Search

### 4.1 Architecture
Two backends, selectable via `memory.backend` config:

| Backend | Manager | Storage | Search |
|---------|---------|---------|--------|
| builtin | `BuiltinMemoryManager` (`src/memory/manager.ts`) | SQLite + sqlite-vec | FTS5 + vector cosine |
| qmd | `QmdMemoryManager` (`src/memory/qmd-manager.ts`) | QMD binary | vsearch + keyword |

### 4.2 Memory Sources
- Workspace Markdown (MEMORY.md, memory/YYYY-MM-DD.md)
- Extra paths (`memory.qmd.paths`)
- Session transcripts (sessions/*.jsonl)

### 4.3 Embedding Providers
| Provider | Model | File |
|----------|-------|------|
| OpenAI | text-embedding-3-small | `src/memory/embeddings-openai.ts` |
| Gemini | text-embedding-004 | `src/memory/embeddings-gemini.ts` |
| Voyage | voyage-3 | `src/memory/batch-voyage.ts` |
| **Ollama** | user-defined | `src/memory/embeddings.ts:100-150` |

### 4.4 Hybrid Search
- `HybridSearch` in `src/memory/search-manager.ts`
- Formula: `FinalScore = (VectorScore * VectorWeight) + (KeywordScore * KeywordWeight)`
- QMD modes: `query` (standard), `search` (keyword), `vsearch` (vector)

### 4.5 Agent Integration
- Agent runtime triggers memory flush on read/write tool calls
- Context compaction (`compactEmbeddedPiSession`) summarizes + flushes to memory/ directory
- Memory indexers pick up flushed content

---

## 5. Routing & Session Management

### 5.1 Routing
- **File:** `src/routing/resolve-route.ts`
- `resolveAgentRoute` — resolves inbound message to agent + session
- `deriveLastRoutePolicy` — determines route persistence
- `resolveInboundLastRouteSessionKey` — session key from last route
- **File:** `src/routing/session-key.ts` — session key parsing and construction

### 5.2 Session Isolation
- `session.dmScope` controls isolation: `per-channel-peer` or `main` (shared)
- Session key format: `channel:account:peer`
- Transcripts stored as JSONL in `~/.openclaw/sessions/`

### 5.3 Multi-Agent Routing
- **File:** `src/agents/subagent-registry.ts`
- Subagent sessions, lifecycle events, delivery context normalization

---

## 6. Tool Policy System

### 6.1 Multi-Stage Pipeline
Tools filtered through 4 stages:

| Stage | Source | Example |
|-------|--------|---------|
| Profile | `tools.profile` config | "coding", "assistant", "strict" |
| Agent-Specific | `agents.list[].tools` | Per-agent allow/deny lists |
| Provider-Specific | `tools.providers[provider]` | Provider-specific restrictions |
| Session Owner | `ownerOnly` flag | Restrict sensitive tools to owner sessions |

### 6.2 Key Files
- `src/agents/tool-policy.ts` — `isToolAllowedByPolicies`
- `src/agents/tools/` — individual tool implementations (gateway, exec, read, write, memory)

---

## 7. System Prompt Construction

- **Function:** `buildEmbeddedSystemPrompt` (referenced from attempt.ts:132)
- **Function:** `resolveBootstrapContextForRun`
- Assembles from: workspace files, tool list, runtime metadata, agent config
- Skills defined in `SKILL.md` files map to tool definitions

---

## 8. Current Parallx Implementation vs. Upstream

### What Parallx Has (and what's wrong with it)

| Parallx File | What It Does | What's Wrong |
|-------------|-------------|-------------|
| `src/openclaw/openclawDefaultRuntimeSupport.ts` | ~1700-line monolith with routing, commands, turn interpretation, context assembly, response generation | Heuristic regex routing instead of upstream patterns. Output-layer patching for answer quality. No execution pipeline layers. No context engine contract. |
| `src/openclaw/openclawTypes.ts` | Type definitions | Disconnected from upstream type contracts |
| `src/aiSettings/unifiedConfigTypes.ts` | Config referencing 'openclaw' implementation | Not aligned with upstream Zod schema config |

### What Parallx Is Missing

1. **No 4-layer execution pipeline** — Everything is flattened into one function
2. **No context engine** — No pluggable ContextEngine contract, no maintenance, no bootstrap
3. **No tool policy system** — No multi-stage tool filtering
4. **No session lane concurrency** — No session/global lane queuing
5. **No retry/fallback logic** — No context overflow detection, no compaction retry, no transient error handling
6. **No system prompt builder** — System prompt is assembled ad-hoc, not via upstream `buildEmbeddedSystemPrompt` pattern
7. **No memory integration pattern** — Memory flush/compaction cycle not implemented per upstream
8. **Heuristic routing** — Regex word lists instead of proper route resolution

---

## 9. Reference Source Files to Study

These are the upstream files that must be read, understood, and used as the basis
for rebuilding Parallx's integration. Listed in dependency order:

### Tier 1: Core Pipeline (read first)
1. `src/auto-reply/reply/agent-runner.ts` — L1 entry point
2. `src/auto-reply/reply/agent-runner-execution.ts` — L2 retry/fallback
3. `src/agents/pi-embedded-runner/run.ts` — L3 model resolution
4. `src/agents/pi-embedded-runner/run/attempt.ts` — L4 actual execution

### Tier 2: Context & Memory
5. `src/context-engine/types.ts` — ContextEngine interface
6. `src/context-engine/init.ts` — initialization
7. `src/context-engine/registry.ts` — engine resolution
8. `src/agents/pi-embedded-runner/context-engine-maintenance.ts` — maintenance
9. `src/agents/pi-embedded-runner/run/attempt.context-engine-helpers.ts` — per-attempt assembly
10. `src/memory/manager.ts` — builtin memory backend
11. `src/memory/search-manager.ts` — hybrid search
12. `src/memory/embeddings.ts` — embedding providers (including Ollama)

### Tier 3: Routing & Session
13. `src/routing/resolve-route.ts` — agent route resolution
14. `src/routing/session-key.ts` — session key management
15. `src/agents/subagent-registry.ts` — multi-agent support

### Tier 4: Tools & Policy
16. `src/agents/tool-policy.ts` — tool policy enforcement
17. `src/agents/pi-embedded-runner/compact.ts` — context compaction

### Tier 5: Config & Types
18. `src/config/zod-schema.ts` — config schema (memory, agents, tools)
19. `src/config/config.ts` — config loading
20. `src/config/validation.ts` — config validation

---

## 10. Next Steps

- [x] Clone key reference files from upstream into `docs/clawrallx/OPENCLAW_PIPELINE_REFERENCE.md`
- [x] Full line-by-line audit of all `src/openclaw/` files → `docs/clawrallx/OPENCLAW_INTEGRATION_AUDIT.md`
- [x] Produce gap matrix → `docs/clawrallx/OPENCLAW_GAP_MATRIX.md`
- [ ] Rebuild plan: ordered list of changes to move from heuristic to systematic (see Gap Matrix Phase 1-5)
- [ ] Execute rebuild: derive every change from reference files
