# OpenClaw Integration Gap Matrix

**Date:** 2026-03-25  
**Input:** `OPENCLAW_REFERENCE_SOURCE_MAP.md`, `OPENCLAW_PIPELINE_REFERENCE.md`, `OPENCLAW_INTEGRATION_AUDIT.md`  
**Purpose:** For each upstream capability, document what Parallx has, what's wrong, and what the fix is.

---

## Gap Classification

- **MISSING** — Upstream has it, Parallx doesn't
- **HEURISTIC** — Parallx has something, but it's regex/hardcoded patchwork, not derived from upstream
- **MISALIGNED** — Parallx has a related capability but it doesn't match upstream patterns
- **ALIGNED** — Parallx has it and it's structurally correct
- **N/A** — Upstream has it but Parallx doesn't need it (multi-channel, gateway, etc.)

---

## 1. Execution Pipeline

| Upstream Capability | Upstream Location | Parallx Status | Parallx Location | Gap | Fix |
|---|---|---|---|---|---|
| 4-layer pipeline (L1→L2→L3→L4) | agent-runner.ts → attempt.ts | **MISSING** | `runOpenclawDefaultTurn` — flat single function | No separation of concerns. All pipeline stages merged into one function. | Refactor into layered functions: entry → retry/fallback → model resolution → attempt execution. Parallx doesn't need all 4 layers but needs at minimum: entry, retry-with-compaction, and attempt. |
| Queue policy / steer check (L1) | agent-runner.ts:97-140 | **N/A** | — | Not needed for single-user desktop app | Skip — no multi-user concurrency |
| Context overflow retry (L2) | agent-runner-execution.ts:113-380 | **MISSING** | — | No retry on context overflow. Request either succeeds or fails. | Add context overflow detection + compaction + retry loop. Upstream retries up to `MAX_OVERFLOW_COMPACTION_ATTEMPTS=3`. |
| Transient HTTP error retry (L2) | agent-runner-execution.ts (2500ms delay) | **MISSING** | — | No transient error handling. Ollama failures are terminal. | Add transient error detection + delay + retry. Even for localhost Ollama, transient failures occur. |
| Model fallback (L2) | model-fallback.ts:759-785 | **MISSING** | — | No model fallback. Single model, no failover. | Add model fallback support. When gpt-oss:20b fails, try configured backup model. |
| Session lane concurrency (L3) | run.ts:215-250 | **N/A** | — | Desktop app runs one turn at a time | Skip — single-user |
| Global lane concurrency (L3) | run.ts:250-270 | **N/A** | — | Same as above | Skip |
| Auth profile rotation (L3) | run.ts:371-619 | **N/A** | — | Single local Ollama, no API keys | Skip — but adopt retry pattern |
| Model resolution (L3) | run.ts:255-370 | **MISALIGNED** | `services.getActiveModel()` | Model is resolved from UI settings, not from agent config | Acceptable — Parallx model selection is UI-driven by design |
| Main retry loop (L3) | run.ts:879-1860 | **MISSING** | — | No top-level retry loop wrapping the attempt | Add simplified retry loop: attempt → check for overflow/timeout → compact → retry |
| Workspace/sandbox setup (L4) | attempt.ts:1672-1700 | **ALIGNED** | Bootstrap file loading | Workspace files loaded via `loadOpenclawBootstrapEntries` | Acceptable |
| Skill loading (L4) | attempt.ts:1692-1743 | **MISALIGNED** | Skills exist in `.parallx/skills/` | Skills loaded but not integrated into tool creation | Wire skill entries to tool definitions |
| System prompt construction (L4) | `buildEmbeddedSystemPrompt` | **MISALIGNED** | `buildOpenclawPromptArtifacts` | Ad-hoc concatenation of bootstrap sections. No structured builder. System prompt placeholder in envelope. | Implement structured system prompt builder that combines: workspace context, tool descriptions, skill prompts, runtime metadata, model capabilities |
| Tool creation (L4) | `createOpenClawCodingTools` | **MISALIGNED** | `services.getToolDefinitions()` | Tools provided by service layer, no tool creation logic | Acceptable for Parallx — tools are registered by the platform |
| Session management (L4) | `SessionManager`, `createAgentSession` | **MISALIGNED** | Chat session via platform | No explicit session manager or agent session lifecycle | Add session lifecycle: create → configure → execute → finalize |
| Ollama num_ctx injection (L4) | `wrapOllamaCompatNumCtx` | **MISSING** | — | No num_ctx injection for Ollama API calls | Add num_ctx injection. This is CRITICAL — without it, Ollama uses default context window which may be too small. |
| Context engine bootstrap (L4) | `runAttemptContextEngineBootstrap` | **MISSING** | — | No context engine bootstrap step | Add bootstrap step that initializes context state per attempt |
| Context engine assembly (L4) | `assembleAttemptContextEngine` | **MISSING** | — | No per-attempt context assembly with token budget | Add context assembly that respects token budget |
| Context engine finalization (L4) | Finalize turn | **MISSING** | — | No finalization step to persist context state | Add finalization to commit context mutations |

---

## 2. Context Engine

| Upstream Capability | Upstream Location | Parallx Status | Parallx Location | Gap | Fix |
|---|---|---|---|---|---|
| ContextEngine interface | context-engine/types.ts:74-231 | **MISSING** | — | No pluggable context engine contract | Define `IContextEngine` interface with bootstrap/assemble/maintain/finalize lifecycle |
| Context engine init | context-engine/init.ts | **MISSING** | — | No engine initialization | Add init step that creates the context engine for the session |
| Context engine registry | context-engine/registry.ts | **MISSING** | — | No engine resolution/selection | For Parallx, a single workspace-aware engine is sufficient. No registry needed initially. |
| Context maintenance | context-engine-maintenance.ts | **MISSING** | — | No transcript maintenance | Implement transcript rewrite/compaction within context engine |
| Per-attempt helpers | attempt.context-engine-helpers.ts | **MISSING** | — | No per-attempt context helpers | Implement bootstrap and assembly helpers |
| Token budget management | Context engine assembly | **MISALIGNED** | `OPENCLAW_DEFAULT_BOOTSTRAP_MAX_CHARS` | Char-based budget in bootstrap only, not token-based full budget | Implement token budget manager per M11 spec: System 10%, RAG 30%, History 30%, User 30% |

---

## 3. Memory & Search

| Upstream Capability | Upstream Location | Parallx Status | Parallx Location | Gap | Fix |
|---|---|---|---|---|---|
| Memory manager | memory/manager.ts | **MISALIGNED** | `services.recallMemories` / `services.storeSessionMemory` | Memory exists via service layer but lacks structured manager | Acceptable for now — service layer abstraction is fine |
| Hybrid search | memory/search-manager.ts | **MISALIGNED** | RAG via `services.retrieveContext` | Vector + keyword search via platform, not standalone | Acceptable — platform handles this |
| Embedding (Ollama) | memory/embeddings.ts:100-150 | **ALIGNED** | nomic-embed-text via Ollama | Configured in ai-config.json | Acceptable |
| Memory flush on compaction | Triggered by context compaction | **MISSING** | — | No automatic memory persistence on compaction | Add memory flush as part of compaction cycle |
| Session transcript persistence | sessions/*.jsonl | **MISALIGNED** | Platform session storage | Transcripts stored by platform, not as JSONL files | Acceptable — different storage backend is fine |

---

## 4. Routing & Turn Classification

| Upstream Capability | Upstream Location | Parallx Status | Parallx Location | Gap | Fix |
|---|---|---|---|---|---|
| Route resolution | routing/resolve-route.ts | **HEURISTIC** | `resolveOpenclawTurnInterpretation` L594-720 | Regex cascades classify turns by keyword matching. Upstream resolves routes by channel/agent config. | **Remove regex routing.** Let the model handle intent classification via system prompt instructions. Route only by structural signals (slash commands, mode selection). |
| Off-topic detection | `OPENCLAW_OFF_TOPIC_DOMAIN_TERMS` | **HEURISTIC** | L66, L85-103 | Keyword regex detects off-topic prompts | Remove. The model handles off-topic responses via system prompt boundaries. |
| Conversational detection | `OPENCLAW_CONVERSATIONAL_PATTERNS` | **HEURISTIC** | L58-62, L155-172 | Regex detects greetings/farewells | Remove. The model handles conversational turns naturally. |
| Product semantics Q&A | `buildOpenclawProductSemanticsAnswer` | **HEURISTIC** | L105-152 | Hardcoded answers for 4 specific product questions | Remove. These are eval-specific hacks. The model should answer these from context. |
| Broad workspace summary | `BROAD_WORKSPACE_SUMMARY_PATTERNS` | **HEURISTIC** | L52-56 | Regex triggers exhaustive coverage | Simplify. Keep the concept of exhaustive retrieval but trigger it via slash command (`/summarize`) or explicit mode, not regex. |

---

## 5. Response Quality

| Upstream Capability | Upstream Location | Parallx Status | Parallx Location | Gap | Fix |
|---|---|---|---|---|---|
| Model produces correct output | Proper system prompt + context | **HEURISTIC** | Output repair layer (15+ functions) | Model output is post-processed by ~15 repair functions that override/append content | **Remove all output repair functions.** Fix the INPUTS: better system prompt, better context assembly, better evidence presentation. If the model can't produce correct output from correct inputs, the model or prompt is wrong. |
| Deterministic workflow answers | — (upstream doesn't have this) | **HEURISTIC** | `buildDeterministicWorkflowAnswer` + source summaries | Answers for folder-summary, comparative, exhaustive-extraction are built WITHOUT the model, from hardcoded path-specific descriptions | **Remove.** These bypass the model entirely. If the model needs guidance for these workflows, add it to the system prompt as instructions, not as code that replaces the model. |
| Evidence sufficiency scoring | — (upstream doesn't have this) | **HEURISTIC** | `assessEvidenceSufficiency` | Term overlap + content length scoring | Keep but simplify. This is a reasonable quality signal for weak local models. Move it from routing (pre-model) to post-model validation. |
| Citation attribution | — | **ALIGNED** | `selectAttributableCitations`, `buildMissingCitationFooter` | Reasonable citation handling | Acceptable |

---

## 6. System Prompt

| Upstream Capability | Upstream Location | Parallx Status | Parallx Location | Gap | Fix |
|---|---|---|---|---|---|
| Structured prompt builder | `buildEmbeddedSystemPrompt` | **MISALIGNED** | `buildOpenclawPromptArtifacts` | Bootstrap files concatenated as sections. No structured prompt with capabilities, rules, model metadata. | Implement structured system prompt builder: identity section → workspace context → tool descriptions → behavioral rules → response format rules |
| Workspace bootstrap | `resolveBootstrapContextForRun` | **ALIGNED** | `loadOpenclawBootstrapEntries` + `buildOpenclawBootstrapContext` | Bootstrap files (AGENTS.md, SOUL.md, etc.) loaded with budget limits | Acceptable |
| Skill-to-prompt mapping | Skills in system prompt | **MISSING** | — | Skills loaded but not injected into system prompt | Wire skill manifests into prompt builder |
| Tool descriptions in prompt | Tools listed in system prompt | **MISALIGNED** | Tools provided via API, not in system prompt | OpenAI/Ollama tool format handles this, but explicit prompt tool descriptions improve local model compliance | Consider adding tool summary to system prompt for local models |

---

## 7. Tool Policy

| Upstream Capability | Upstream Location | Parallx Status | Parallx Location | Gap | Fix |
|---|---|---|---|---|---|
| 4-stage tool filtering | tool-policy.ts | **MISSING** | — | All tools sent to model unconditionally | Add tool filtering: by profile (read-only vs full), by agent config, by mode (Chat vs Agent) |
| Tool approval system | Session-level approval | **ALIGNED** | `IChatRuntimeAutonomyMirror` | Approval flow exists in types and participant | Acceptable |

---

## Priority-Ordered Fix Plan

### Phase 1: Remove Heuristic Patchwork (HIGH — M40 mandate)
1. **Remove output repair layer** — Delete all `repair*` functions from `openclawDefaultRuntimeSupport.ts` and all `ensure*` functions from `openclawDefaultParticipant.ts`
2. **Remove regex routing** — Delete all routing term regex, turn interpretation cascades, off-topic/conversational detection
3. **Remove deterministic workflow answers** — Delete `buildDeterministicWorkflowAnswer`, hardcoded source summaries
4. **Remove product semantics hardcoded Q&A** — Delete `buildOpenclawProductSemanticsAnswer`

### Phase 2: Fix System Prompt (HIGH — root cause of output quality)
5. **Implement structured system prompt builder** — Replace placeholder with proper prompt that includes: identity, workspace context, behavioral rules, response format, citation rules, evidence handling
6. **Add tool descriptions to prompt** — Improve local model tool compliance
7. **Wire skills into prompt** — Map skill manifests to prompt sections

### Phase 3: Add Execution Pipeline (MEDIUM — reliability)
8. **Add retry with compaction** — Detect context overflow, compact, retry
9. **Add transient error handling** — Retry on Ollama connection/timeout errors
10. **Add Ollama num_ctx injection** — Critical for correct context window behavior
11. **Add model fallback** — Try backup model on primary failure

### Phase 4: Implement Context Engine (MEDIUM — architecture)
12. **Define IContextEngine interface** — Pluggable lifecycle contract
13. **Implement token budget manager** — System/RAG/History/User budget allocation
14. **Add context assembly per turn** — Budget-aware context building
15. **Add context compaction** — Automatic compaction when budget exceeded

### Phase 5: Clean Up Types (LOW — alignment)
16. **Align types with upstream contracts** — Update `openclawTypes.ts` to reflect actual upstream patterns
17. **Add tool policy** — Basic tool filtering by mode
18. **Simplify routing** — Route by slash command and mode, not by message content

---

## Metrics

| Category | Total Items | ALIGNED | MISALIGNED | HEURISTIC | MISSING | N/A |
|----------|------------|---------|------------|-----------|---------|-----|
| Execution Pipeline | 17 | 1 | 4 | 0 | 8 | 4 |
| Context Engine | 6 | 0 | 1 | 0 | 5 | 0 |
| Memory & Search | 5 | 1 | 3 | 0 | 1 | 0 |
| Routing | 5 | 0 | 0 | 5 | 0 | 0 |
| Response Quality | 4 | 1 | 0 | 3 | 0 | 0 |
| System Prompt | 4 | 1 | 2 | 0 | 1 | 0 |
| Tool Policy | 2 | 1 | 0 | 0 | 1 | 0 |
| **TOTAL** | **43** | **5** | **10** | **8** | **16** | **4** |

**Bottom line:** of 39 applicable capabilities (43 minus 4 N/A), only 5 are aligned (13%), 10 misaligned (26%), 8 are heuristic patchwork (20%), and 16 are entirely missing (41%). The integration needs a systematic rebuild.
