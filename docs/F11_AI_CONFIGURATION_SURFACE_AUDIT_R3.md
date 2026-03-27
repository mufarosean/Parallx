# F11 Re-Audit: AI Configuration Surface — Live Settings Parity (R3)

**Date:** 2026-03-27  
**Scope:** Every setting that currently feeds into the OpenClaw runtime, classified against upstream `github.com/openclaw/openclaw` commit e635cedb.  
**Method:** Source-level comparison of Parallx wiring against upstream config schema (`zod-schema.agent-defaults.ts`, `extra-params.ts`, `memory-search.ts`, `context.ts`) and control flow.

---

## 1. Summary Classification Table

| ID | Setting | Classification | Severity | One-Line Finding |
|----|---------|---------------|----------|-----------------|
| S1 | Temperature | **ALIGNED** | — | Upstream: `agents.defaults.models["provider/model"].params.temperature` → `createStreamFnWithExtraParams`. Parallx: global slider → `requestOptions.temperature`. Same effect, simplified for single-model. |
| S2 | Max Response Tokens | **ALIGNED** | — | Upstream: `agents.defaults.models["provider/model"].params.maxTokens` → stream params. Parallx: global slider → `requestOptions.maxTokens`. Same effect. |
| S3 | Auto RAG | **INVENTION** | LOW | Upstream context engine always runs if registered. No on/off toggle exists. Parallx-specific desktop UX. |
| S4 | Decomposition Mode | **INVENTION** | MEDIUM | No upstream equivalent. Decomposes query into sub-queries — Parallx-specific retrieval optimization. |
| S5 | Candidate Breadth | **INVENTION** | MEDIUM | Upstream has `candidateMultiplier` (numeric) in memory search hybrid config. Parallx maps to a "balanced/broad" enum — different abstraction. |
| S6 | Top K Results | **INVENTION** | MEDIUM | Upstream: `agents.defaults.memorySearch.query.maxResults` (YAML). Parallx: `ragTopK` slider. Configures different retrieval system. |
| S7 | Max Per Source | **INVENTION** | MEDIUM | No upstream equivalent. Source deduplication cap is Parallx-specific. |
| S8 | Token Budget | **INVENTION** | MEDIUM | No upstream equivalent. Upstream memory search has no token budget concept. |
| S9 | Score Threshold | **INVENTION** | MEDIUM | Upstream: `agents.defaults.memorySearch.query.minScore` (YAML). Parallx: `ragScoreThreshold` slider. Configures different retrieval system. |
| S10 | Max Iterations | **INVENTION** | HIGH | Upstream: `MAX_RUN_LOOP_ITERATIONS = 24 + 8/profile` — **HARDCODED**. Parallx exposes as user setting. |
| S11 | Default Model | **DEAD** | HIGH | UI dropdown exists but wiring broken. Runtime reads `chatConfig.get('defaultModel')`, not unified config. |
| S12 | Context Window | **DEAD** | MEDIUM | UI control exists. Runtime uses `getModelContextLength()` from Ollama API. |
| S13 | Embedding Model | **DEAD** | LOW | Config field exists. Hardcoded to `nomic-embed-text`. |
| S14 | Indexing Section | **DEAD** | MEDIUM | 4 UI controls with 0 runtime consumers. |
| S15 | Workspace Description | **INVENTION** | LOW | No upstream equivalent. Upstream uses bootstrap files only. Reasonable desktop adaptation. |
| S16 | Tools Enablement | **ALIGNED** | — | Upstream: `tool-policy.ts` allow/deny config. Parallx: checkbox tree → `getToolPermissions()`. Same concept, UI adaptation. |

### Aggregate

| Classification | Count | Settings |
|---------------|-------|----------|
| ALIGNED | 3 | S1, S2, S16 |
| INVENTION | 8 | S3, S4, S5, S6, S7, S8, S9, S10 |
| DEAD | 4 | S11, S12, S13, S14 |
| MISALIGNED | 0 | — |

**Key finding: 8 of 16 settings are Parallx inventions with no upstream equivalent.**

---

## 2. Per-Setting Detailed Findings

### S1: Temperature

- **Classification**: ALIGNED
- **Parallx file**: `openclawDefaultParticipant.ts:297`, `openclawAttempt.ts:217`
- **Upstream reference**: `extra-params.ts:193-215` — `createStreamFnWithExtraParams`
  - Config path: `agents.defaults.models["provider/model"].params.temperature`
  - Resolution: `resolveExtraParams()` → `resolvePreparedExtraParams()` → stream wrapper
- **Upstream config surface**: Per-model YAML parameter (`agents.defaults.models["ollama/qwen3.5"].params.temperature: 0.7`)
- **Divergence**: Parallx has a global slider (one temperature for all models). Upstream allows per-model temperature via YAML config. For a single-model desktop environment this is acceptable.
- **Evidence**:
  ```ts
  // Upstream: extra-params.ts:193-215
  if (typeof extraParams.temperature === "number") {
    streamParams.temperature = extraParams.temperature;
  }
  
  // Parallx: openclawAttempt.ts:217
  temperature: context.temperature,
  ```
- **Verdict**: Sound adaptation. The temperature reaches the model call identically.

### S2: Max Response Tokens

- **Classification**: ALIGNED
- **Parallx file**: `openclawDefaultParticipant.ts:298`, `openclawAttempt.ts:218`
- **Upstream reference**: `extra-params.ts:193-215` — same `createStreamFnWithExtraParams`
  - Config path: `agents.defaults.models["provider/model"].params.maxTokens`
- **Upstream config surface**: Per-model YAML parameter
- **Divergence**: Same as S1 — global vs per-model. Acceptable.
- **Evidence**:
  ```ts
  // Upstream: extra-params.ts:196-197
  if (typeof extraParams.maxTokens === "number") {
    streamParams.maxTokens = extraParams.maxTokens;
  }
  
  // Parallx: openclawAttempt.ts:218
  maxTokens: context.maxTokens || undefined,
  ```
- **Verdict**: Sound adaptation.

### S3: Auto RAG Toggle

- **Classification**: INVENTION
- **Parallx file**: `openclawDefaultParticipant.ts:299`, `openclawContextEngine.ts:59`
- **Upstream reference**: Context engine (`context-engine/types.ts:104-230`) — NO toggle mechanism
  - `agents.defaults.memorySearch` is the upstream equivalent of retrieval config — but upstream has no on/off toggle. If memory search is configured, it's always available.
  - The upstream `createMemorySearchTool` returns `null` if config is invalid/missing, but there's no user-facing "disable" switch.
- **Divergence**: Parallx gates `_ragReady` in bootstrap based on `autoRag`. Upstream context engine has no equivalent gate.
- **Is this justified?**: YES — reasonable desktop adaptation. A local user may want to disable RAG when their workspace is empty or when they just want to chat without retrieval overhead.
- **Severity**: LOW — the toggle exists for good UX reasons, just not derived from upstream.

### S4: Decomposition Mode

- **Classification**: INVENTION
- **Parallx file**: `retrievalService.ts:509`
- **Upstream reference**: NO equivalent found anywhere in OpenClaw.
  - Upstream `memory_search` tool is a simple query → results pipeline. No query decomposition.
  - The `hybrid` search config (`agents.defaults.memorySearch.query.hybrid`) handles vector + keyword fusion, not query decomposition.
- **Divergence**: Parallx's `_buildQueryPlan` decomposes user queries into sub-queries for broader retrieval. This is entirely Parallx-authored logic.
- **Is this justified?**: MAYBE — improves retrieval quality on complex queries, but adds complexity that upstream intentionally avoids. Upstream lets the model decide what to search via the `memory_search` tool.
- **Severity**: MEDIUM — adds a pattern upstream doesn't use. Should be documented as Parallx-specific.

### S5: Candidate Breadth

- **Classification**: INVENTION
- **Parallx file**: `retrievalService.ts:510`
- **Upstream reference**: The closest upstream concept is `agents.defaults.memorySearch.query.hybrid.candidateMultiplier` (default 4) — a numeric multiplier, not a "balanced/broad" enum.
- **Divergence**: Parallx maps a dropdown (balanced/broad) to behavior. Upstream uses a raw numeric multiplier. Different abstraction level, different system.
- **Is this justified?**: YES — simplifies a technical parameter for non-technical users.
- **Severity**: MEDIUM — configures Parallx's own retrieval, no upstream parity concern beyond documentation.

### S6: Top K Results

- **Classification**: INVENTION
- **Parallx file**: `retrievalService.ts:506`
- **Upstream reference**: `agents.defaults.memorySearch.query.maxResults` — configurable in YAML. Memory search tool also accepts `maxResults` as a parameter.
- **Divergence**: Both systems have a "max results" concept, but:
  1. Upstream's `maxResults` configures OpenClaw's memory search manager (separate system)
  2. Parallx's `ragTopK` configures Parallx's `retrievalService` (its own vector store)
  3. Different retrieval architectures — not a 1:1 mapping
- **Is this justified?**: YES — Parallx's own retrieval system needs tuning knobs.
- **Severity**: MEDIUM — no functional parity issue; it's tuning Parallx's own system.

### S7: Max Per Source

- **Classification**: INVENTION
- **Parallx file**: `retrievalService.ts:508`
- **Upstream reference**: No equivalent. Upstream `memorySearchManager.search()` doesn't have a per-source cap. The QMD manager has `diversifyResultsBySource` internally, but it's not user-configurable.
- **Divergence**: Parallx exposes per-source capping as a user setting. Upstream keeps it internal.
- **Is this justified?**: SOMEWHAT — useful for preventing one noisy file from dominating results. But upstream intentionally doesn't expose search internals to users.
- **Severity**: MEDIUM — low risk, but exposes implementation internals as user settings.

### S8: Token Budget (RAG)

- **Classification**: INVENTION
- **Parallx file**: `retrievalService.ts:514`
- **Upstream reference**: No equivalent. Upstream memory search returns results without a token budget constraint. The context engine handles token budgeting at the assembly stage, not at the retrieval stage.
- **Divergence**: Parallx moves token budgeting into the retrieval service. Upstream keeps it in the context engine.
- **Is this justified?**: SOMEWHAT — pre-filtering by token budget avoids wasting context window, but upstream separates concerns differently (retrieve first, budget at assembly).
- **Severity**: MEDIUM — architectural difference from upstream's separation of concerns.

### S9: Score Threshold

- **Classification**: INVENTION
- **Parallx file**: `retrievalService.ts:507`
- **Upstream reference**: `agents.defaults.memorySearch.query.minScore` — exists in upstream YAML config. Also accepted as `minScore` param on the `memory_search` tool.
- **Divergence**: Both systems have a minimum score, but for different retrieval systems. Parallx's threshold applies to its own Vector/RRF fusion scores. Upstream's applies to its own hybrid BM25 + vector scores.
- **Is this justified?**: YES — Parallx's own retrieval needs a noise floor.
- **Severity**: MEDIUM — same concept, different system.

### S10: Max Iterations

- **Classification**: INVENTION
- **Parallx file**: `openclawDefaultParticipant.ts:265-266`
- **Upstream reference**: `run.ts:108` — `MAX_RUN_LOOP_ITERATIONS = 24 base + 8 per auth profile (min 32, max 160)` — **HARDCODED constant**
  - Config path: NONE. Not in `zod-schema.agent-defaults.ts`. Not in any config type.
  - The upstream `agents.defaults.maxConcurrent` is for concurrent sessions, NOT for iteration limits.
- **Divergence**: Upstream HARDCODES the loop iteration limit. It is not user-configurable. Parallx exposes it as a UI setting.
- **Is this justified?**: PARTIALLY —
  - Pro: Desktop users may want more/fewer tool iterations
  - Con: Upstream hardcodes this for safety. Allowing users to set very low values breaks agent functionality; very high values waste resources.
  - Parallx already applies `Math.min(services.maxIterations ?? OPENCLAW_MAX_AGENT_ITERATIONS, OPENCLAW_MAX_AGENT_ITERATIONS)` as a safety cap, which is good.
- **Severity**: HIGH — this is the most material deviation. The setting works, but the user is tuning something upstream doesn't expose.

### S11: Default Model

- **Classification**: DEAD
- **Parallx file**: `modelSection.ts` — Dropdown exists
- **Upstream reference**: `agents.defaults.model.primary` — fully configurable in YAML
- **Divergence**: The UI exists but the wiring is broken — runtime reads from `chatConfig.get('defaultModel')` (workspace config), not from `IUnifiedModelConfig.chatModel`.
- **Severity**: HIGH — broken wiring means the control does nothing.

### S12: Context Window

- **Classification**: DEAD
- **Parallx file**: `modelSection.ts` — InputBox exists
- **Upstream reference**: `agents.defaults.contextTokens` — configurable in YAML. Runtime also auto-resolves via `resolveContextTokensForModel()` from model metadata.
- **Divergence**: Parallx has the UI control but runtime ignores it, using `getModelContextLength()` from the Ollama API instead.
- **Severity**: MEDIUM — the upstream approach (auto-resolve + config override) is better than Parallx's current dead field.

### S13: Embedding Model

- **Classification**: DEAD
- **Parallx file**: Config type has `IUnifiedModelConfig.embeddingModel`
- **Upstream reference**: `agents.defaults.memorySearch.model` — configurable per memory provider
- **Divergence**: Parallx hardcodes `nomic-embed-text`. Config field is never read.
- **Severity**: LOW — `nomic-embed-text` is the right choice for local Ollama. Future expansion could use this field.

### S14: Indexing Section (autoIndex, watchFiles, maxFileSize, excludePatterns)

- **Classification**: DEAD
- **Parallx file**: `indexingSection.ts` — 4 UI controls
- **Upstream reference**: `agents.defaults.memorySearch.sync.*` — configurable in YAML (onSessionStart, onSearch, watch, watchDebounceMs, intervalMinutes, sessions.*)
- **Divergence**: Parallx has UI controls for indexing that map to NO runtime consumers. The indexing pipeline doesn't read these settings.
- **Severity**: MEDIUM — misleading UI. Users think they're controlling indexing but nothing happens.

### S15: Workspace Description

- **Classification**: INVENTION
- **Parallx file**: `chatSection.ts` (UI), `openclawSystemPrompt.ts` (consumer)
- **Upstream reference**: No equivalent. Upstream uses:
  - Bootstrap files: `resolveBootstrapContextForRun` reads AGENTS.md, SOUL.md, etc.
  - Workspace metadata: derives from workspace directory scanning
  - No "describe your workspace" textarea concept
- **Divergence**: Parallx adds a free-text workspace description injected into the system prompt. Upstream relies solely on file-based workspace context (bootstrap files + repo structure).
- **Is this justified?**: YES — good desktop UX. A user can quickly describe their project without creating/editing an AGENTS.md file. This supplements (not replaces) bootstrap file loading.
- **Severity**: LOW — additive, no harm, good UX.

### S16: Tools Enablement

- **Classification**: ALIGNED
- **Parallx file**: `toolsSection.ts` (UI), `openclawToolPolicy.ts` (consumer)
- **Upstream reference**: `agents/tool-policy.ts` — 4-stage filtering pipeline
  - Config path: `agents.list[].tools` — per-agent allow/deny lists
  - `agents.defaults.tools` — global tool config
  - The upstream UI (`ui/src/ui/views/agents-utils.ts`) also has tool sections with toggles
- **Divergence**: Parallx uses a checkbox tree (enable/disable per tool). Upstream uses allow/deny lists in YAML. The concept is equivalent — both control which tools are available.
- **Evidence**: Upstream tool config reference:
  ```ts
  // zod-schema.agent-runtime.ts — ToolPolicySchema
  // tools: { allow: [...], deny: [...] }
  ```
  Parallx adaptation:
  ```ts
  // toolsSection.ts → getToolPermissions() → openclawToolPolicy.ts
  ```
- **Verdict**: Sound adaptation. UI checkbox tree is a valid visual representation of allow/deny policy.

---

## 3. Critical Findings

### CF1: 8 INVENTION Settings Configure a Parallx-Only Retrieval System

Settings S3-S9 (Auto RAG, Decomposition, Candidate Breadth, Top K, Max Per Source, Token Budget, Score Threshold) all configure `retrievalService.ts`, which is Parallx's own retrieval system — NOT an adaptation of upstream's `memory/search-manager.ts`.

**Upstream pattern**: OpenClaw's memory search is:
1. Configured via `agents.defaults.memorySearch.query.*` in YAML
2. Exposed as a **tool** (`memory_search`) that the model calls when it needs context
3. Controlled by `maxResults` and `minScore` — two parameters, not seven

**Parallx pattern**: Parallx's retrieval is:
1. Configured via 7 UI settings
2. Injected **automatically** into every turn (autoRag) — NOT tool-initiated
3. Exposes search implementation internals (decomposition, candidate breadth, per-source caps)

**Assessment**: These settings are functional and needed for tuning Parallx's retrieval system. They are NOT misaligned (they don't implement the wrong upstream pattern) — they implement a **different system entirely**. This is acceptable as a Parallx desktop adaptation, but should be explicitly documented as such.

**Risk**: If Parallx later aligns its retrieval with upstream's tool-based model (where the model decides when to search), most of these settings would become irrelevant.

### CF2: Max Iterations Exposes a Hardcoded Safety Bound

Setting S10 exposes something upstream **intentionally does not expose**. The `MAX_RUN_LOOP_ITERATIONS` constant is hardcoded at 24+8/profile because:
- Too low → agent can't complete multi-step tasks
- Too high → runaway tool loops waste resources
- Upstream chose a conservative range (32-160) after operational experience

Parallx mitigates this with a ceiling (`Math.min(value, OPENCLAW_MAX_AGENT_ITERATIONS)`), which is good. But the floor (user could set 1) is a concern — an agent with 1 iteration can't do multi-step work.

### CF3: 4 Dead Settings Mislead Users

Settings S11-S14 have UI controls but no runtime effect. Users see controls, change values, and nothing happens. This is worse than having no setting — it erodes trust.

---

## 4. Recommended Actions

### Phase 0: Remove Dead Settings (Immediate)

| Setting | Action | File |
|---------|--------|------|
| S11: Default Model | Remove from `modelSection.ts` or wire to `chatConfig` properly | `modelSection.ts` |
| S12: Context Window | Remove from `modelSection.ts` — runtime auto-resolves from Ollama | `modelSection.ts` |
| S13: Embedding Model | Remove config field or leave as future placeholder (no UI exposure) | Config types |
| S14: Indexing Section | Remove `indexingSection.ts` entirely — 0 consumers | `indexingSection.ts` |

### Phase 1: Document Inventions (Next)

For each INVENTION setting (S3-S10, S15), add a doc comment in the config type:

```ts
/**
 * Parallx-specific setting. No upstream OpenClaw equivalent.
 * Configures Parallx's local retrieval service (retrievalService.ts).
 * Upstream uses tool-based search via memory_search tool instead.
 */
ragTopK?: number;
```

### Phase 2: Harden Max Iterations (S10)

Add a minimum floor to prevent rendering the agent useless:

```ts
// Current:
const maxToolIterations = request.mode === ChatMode.Agent
  ? Math.min(services.maxIterations ?? OPENCLAW_MAX_AGENT_ITERATIONS, OPENCLAW_MAX_AGENT_ITERATIONS)
  : OPENCLAW_MAX_READONLY_ITERATIONS;

// Proposed:
const MIN_AGENT_ITERATIONS = 4; // minimum for meaningful multi-step work
const maxToolIterations = request.mode === ChatMode.Agent
  ? Math.max(MIN_AGENT_ITERATIONS, Math.min(services.maxIterations ?? OPENCLAW_MAX_AGENT_ITERATIONS, OPENCLAW_MAX_AGENT_ITERATIONS))
  : OPENCLAW_MAX_READONLY_ITERATIONS;
```

### Phase 3: Evaluate Retrieval Consolidation (Future)

When implementing upstream's tool-based search pattern (F9 domain), evaluate whether S4-S9 should be replaced by tool-level parameters matching upstream's `memory_search` tool interface:
- `maxResults` (maps to S6)
- `minScore` (maps to S9)
- Everything else becomes internal tuning, not user-exposed.

### Phase 4: Wire Dead Model Settings or Remove (Future)

If S11 (default model) and S12 (context window) are worth keeping:
- S11: Wire unified config → `chatConfig` or make the runtime read from unified config
- S12: Wire as override for `getModelContextLength()` (matching upstream's `contextTokensOverride` pattern from `resolveContextTokensForModel`)

Otherwise, remove them.

---

## 5. Upstream Evidence Index

| Upstream File | Relevant Section | What It Tells Us |
|--------------|-----------------|-----------------|
| `extra-params.ts:79-112` | `resolveExtraParams` | Temperature/maxTokens come from `agents.defaults.models["provider/model"].params` |
| `extra-params.ts:193-215` | `createStreamFnWithExtraParams` | temperature + maxTokens applied as stream params |
| `zod-schema.agent-defaults.ts:0-73` | `AgentDefaultsSchema` | `model`, `contextTokens`, `memorySearch` — no `temperature`, `maxTokens`, `autoRag`, `ragTopK`, etc. |
| `zod-schema.agent-runtime.ts:661-688` | `MemorySearchSchema.query` | `maxResults`, `minScore`, `hybrid.*` — internal retrieval tuning |
| `run.ts:108` | `MAX_RUN_LOOP_ITERATIONS` | Hardcoded 24+8/profile, min 32, max 160 |
| `context.ts:380-396` | `resolveContextTokensForModel` | Context window auto-resolved from model metadata + config override |
| `tool-policy.ts` | Tool filtering pipeline | 4-stage allow/deny — Parallx checkbox tree is a valid adaptation |
| `agents/system-prompt.ts:110-400` | `buildAgentSystemPrompt` | Uses bootstrap files for workspace context, no "workspace description" field |
| `memory/search-manager.ts:42-312` | `getMemorySearchManager` | Search config from `agents.defaults.memorySearch`, NOT user-facing sliders |

---

## 6. Settings Origin Map

```
UPSTREAM-DERIVED (ALIGNED):
  S1  temperature  ── agents.defaults.models.*.params.temperature ──→ requestOptions
  S2  maxTokens    ── agents.defaults.models.*.params.maxTokens ───→ requestOptions
  S16 tools        ── agents.list[].tools (allow/deny) ────────────→ toolPolicy

PARALLX INVENTIONS:
  S3  autoRag               ── no upstream ──→ openclawContextEngine.bootstrap
  S4  ragDecompositionMode  ── no upstream ──→ retrievalService._buildQueryPlan
  S5  ragCandidateBreadth   ── no upstream ──→ retrievalService._buildQueryPlan
  S6  ragTopK               ── no upstream ──→ retrievalService.retrieve
  S7  ragMaxPerSource       ── no upstream ──→ retrievalService.retrieve
  S8  ragTokenBudget        ── no upstream ──→ retrievalService.retrieve
  S9  ragScoreThreshold     ── no upstream ──→ retrievalService.retrieve
  S10 maxIterations         ── no upstream ──→ openclawDefaultParticipant
  S15 workspaceDescription  ── no upstream ──→ openclawSystemPrompt

DEAD:
  S11 defaultModel    ── broken wiring ──→ nothing
  S12 contextWindow   ── dead field ─────→ nothing
  S13 embeddingModel  ── hardcoded ──────→ nothing
  S14 indexing.*      ── 0 consumers ────→ nothing
```
