# F11: AI Configuration Surface — Iteration 1 Deep Audit

**Date:** 2026-03-27  
**Auditor:** AI Parity Auditor  
**Upstream ref:** `github.com/openclaw/openclaw` commit e635cedb  
**Scope:** All AI configuration surfaces in Parallx vs upstream OpenClaw patterns

---

## 1. Summary Table

| ID | Capability | Classification | Severity | Finding |
|----|-----------|---------------|----------|---------|
| **C1** | System prompt origin | **LEGACY** | HIGH | 3 independent prompt builders exist. Only OpenClaw's is active for model calls. Legacy `chatSystemPrompts.ts` + `composeChatSystemPrompt` still have 3 live consumers (token status bar, session services getSystemPrompt). |
| **C2** | Bootstrap file loading | **MISALIGNED** | HIGH | Two independent loaders: PromptFileService (Surface B, with defaults) and `loadOpenclawBootstrapEntries` (Surface C, NO defaults). OpenClaw always uses Surface C. Missing files become `[MISSING]` markers in the system prompt — no fallback. |
| **C3** | Bootstrap file scaffolding | **MISALIGNED** | MEDIUM | `/init` creates only AGENTS.md + `.parallx/*` directory structure. Does NOT scaffold SOUL.md, TOOLS.md. 5 phantom files (IDENTITY.md, USER.md, HEARTBEAT.md, BOOTSTRAP.md, MEMORY.md) have no defaults, no scaffolding, no documentation. |
| **C4** | Personality configuration | **DEAD** | HIGH | `systemPromptGenerator.ts` generates prompts from tone/focus/length → stores in `chat.systemPrompt`. OpenClaw default participant NEVER reads this value. Persona name, description, avatarEmoji, workspaceDescription, responseLength — all ignored by the active runtime. |
| **C5** | Model parameters | **MISALIGNED** | HIGH | Default participant (main chat): temperature and maxTokens NOT wired from unified config to attempt `requestOptions`. Workspace + canvas participants DO wire them. contextWindow partially wired via `getModelContextLength()` but NOT from unified config override. |
| **C6** | Retrieval parameters | **DEAD** | MEDIUM | `IUnifiedRetrievalConfig` has autoRag, ragTopK, ragMaxPerSource, ragScoreThreshold, ragTokenBudget, contextBudget — NONE consumed by the OpenClaw context engine. Context engine uses its own hard-coded parameters. |
| **C7** | Memory parameters | **MISALIGNED** | LOW | `memoryEnabled` IS consumed (default participant line 187). `transcriptIndexingEnabled` IS consumed (main.ts:865). `autoSummarize` and `evictionDays` are NOT consumed. |
| **C8** | Agent parameters | **MISALIGNED** | MEDIUM | `maxIterations` IS consumed via main.ts:658 → openclawDefaultParticipantServices. `verbosity`, `approvalStrictness`, `executionStyle`, `proactivity` are NOT consumed. |
| **C9** | Prompt overlay / rules | **ALIGNED** | — | `.parallx/rules/*.md` → `getPromptOverlay` → `buildOpenclawTurnContext.promptOverlay` → `buildOpenclawSystemPrompt.promptOverlay` → section 6. Working correctly. |
| **C10** | Legacy AISettingsService | **LEGACY** | LOW | `AISettingsService` class exists as dead code. `UnifiedAIConfigService` implements `IAISettingsService` and is registered as both. Old class is never instantiated. Safe to delete. |
| **C11** | Legacy unified config consumers | **MISALIGNED** | HIGH | Of ~30 config fields across 10 sections, only 4 are consumed by the active OpenClaw runtime: `memory.memoryEnabled`, `agent.maxIterations`, `model.temperature` (workspace/canvas only), `model.maxTokens` (workspace/canvas only). ~26 fields are dead. |
| **C12** | Legacy system prompt builders | **LEGACY** | MEDIUM | `buildSystemPrompt()` in `chatSystemPrompts.ts` has 3 live consumers: `chatTokenStatusBar.ts:290/301` (token estimation display), `chatDataService.ts:2137` (session services getSystemPrompt). These show the WRONG prompt — the legacy one, not the active OpenClaw prompt. |
| **C13** | Settings UI panel | **MISALIGNED** | HIGH | 10 sections in UI. Only Agent (maxIterations partial), Model (temperature/maxTokens for workspace/canvas only), Memory (memoryEnabled, transcriptIndexingEnabled) have any real effect. 7+ sections are writing to config that nobody reads. |
| **C14** | Preset / profile system | **DEAD** | MEDIUM | 3 built-in presets (Default, Finance Focus, Creative Mode) vary tone, focusDomain, temperature — almost entirely dead config. The preset switch changes values the OpenClaw runtime never reads. Temperature change only affects workspace/canvas participants. |
| **C15** | Workspace override | **MISALIGNED** | LOW | `.parallx/ai-config.json` mechanism works — loads, merges, persists. But since most config values aren't consumed by the active runtime, the override has very limited practical effect. |
| **C16** | Runtime selector | **DEAD** | LOW | `IUnifiedRuntimeConfig.implementation: 'legacy-claw' | 'openclaw'` exists as a declared union, but `resolveChatRuntimeParticipantId()` unconditionally maps to `OPENCLAW_DEFAULT_PARTICIPANT_ID` — the config value is never consulted. |

---

## 2. Classified Totals

| Classification | Count | Capabilities |
|---------------|-------|-------------|
| **ALIGNED** | 1 | C9 |
| **MISALIGNED** | 6 | C2, C3, C5, C7, C8, C11, C13, C15 |
| **DEAD** | 4 | C4, C6, C14, C16 |
| **LEGACY** | 3 | C1, C10, C12 |

**Of 16 capabilities audited, only 1 is fully ALIGNED. 15 have problems.**

---

## 3. Per-Capability Detailed Findings

### C1: System Prompt Origin

**Classification:** LEGACY  
**Severity:** HIGH

**3 independent system prompt builders exist:**

| Path | Builder | Active? | Consumers |
|------|---------|---------|-----------|
| **Surface C (OpenClaw)** | `buildOpenclawSystemPrompt()` | ✅ YES — all model calls | `openclawDefaultParticipant.ts`, `openclawWorkspaceParticipant.ts`, `openclawCanvasParticipant.ts` |
| **Surface D (Legacy)** | `buildSystemPrompt()` | ❌ NO for model calls | `chatTokenStatusBar.ts:290/301`, `composeChatSystemPrompt()` → `chatDataService.ts:2137` |
| **Surface A (Settings)** | `generateChatSystemPrompt()` | ❌ NO — stored in profile but never consumed by runtime | `aiSettingsDefaults.ts`, `unifiedAIConfigService.ts:289`, `advancedSection.ts`, `chatSection.ts` |

**Evidence:**
- [chatRuntimeSelector.ts](src/services/chatRuntimeSelector.ts#L10-L17): `resolveChatRuntimeParticipantId()` always returns `OPENCLAW_DEFAULT_PARTICIPANT_ID`
- [chatService.ts](src/services/chatService.ts#L901): All requests route through the runtime resolver
- [openclawDefaultParticipant.ts](src/openclaw/participants/openclawDefaultParticipant.ts#L245-L260): Turn context uses `buildOpenclawSystemPrompt` exclusively

**Upstream reference:** OpenClaw has ONE system prompt builder: `buildEmbeddedSystemPrompt` in `agents/system-prompt.ts`. No parallel paths.

**Divergence:** Parallx has 3 prompt builders where upstream has 1. The legacy builders produce different output from the active one, causing the token status bar and session-level prompt display to show inaccurate information.

---

### C2: Bootstrap File Loading

**Classification:** MISALIGNED  
**Severity:** HIGH

**Two independent loaders exist:**

| Loader | Files Loaded | Defaults | Budget | Used By |
|--------|-------------|----------|--------|---------|
| **Surface B:** `PromptFileService` | SOUL.md, AGENTS.md, TOOLS.md, `.parallx/rules/*.md` | ✅ YES (DEFAULT_SOUL, auto-generated tools) | None | Legacy — not used by active runtime |
| **Surface C:** `loadOpenclawBootstrapEntries` | SOUL.md, AGENTS.md, TOOLS.md, IDENTITY.md, USER.md, HEARTBEAT.md, BOOTSTRAP.md, MEMORY.md | ❌ NO — missing → `[MISSING]` marker | 20K/file, 150K total | OpenClaw default participant |

**Evidence:**
- [openclawParticipantRuntime.ts](src/openclaw/participants/openclawParticipantRuntime.ts#L24-L29): `OPENCLAW_BOOTSTRAP_FILES` array has 7 files
- [openclawParticipantRuntime.ts](src/openclaw/participants/openclawParticipantRuntime.ts#L47-L57): Missing files get `{ missing: true }` — no fallback
- [openclawParticipantRuntime.ts](src/openclaw/participants/openclawParticipantRuntime.ts#L79-L82): Missing entries become `[MISSING] Expected at: ${pathValue}` in the system prompt
- [promptFileService.ts](src/services/promptFileService.ts#L68-L86): DEFAULT_SOUL is 31 lines of good personality guidance — never injected into the active prompt

**Upstream reference:** `resolveBootstrapContextForRun` in `agents/bootstrap-files.ts:97-118`. Upstream loads bootstrap files from the workspace directory. There's NO mechanism in upstream for built-in defaults either — but upstream's `ensureAgentWorkspace` seeds the files on workspace creation (see `agents/workspace.ts:155+`), so missing files are avoided by design.

**Divergence:** The budget (20K chars/file, 150K total) ALIGNS with upstream `DEFAULT_BOOTSTRAP_MAX_CHARS` and `DEFAULT_BOOTSTRAP_TOTAL_MAX_CHARS` (confirmed in `pi-embedded-helpers.ts`). The gap is that:
1. PromptFileService (with defaults) is dead code for the active runtime
2. The active loader has no defaults — a fresh workspace with no bootstrap files gets `[MISSING]` markers for all 7+ files
3. Upstream avoids this by scaffolding bootstrap files on workspace init

---

### C3: Bootstrap File Scaffolding

**Classification:** MISALIGNED  
**Severity:** MEDIUM

**Evidence:**
- [openclawDefaultRuntimeSupport.ts](src/openclaw/openclawDefaultRuntimeSupport.ts#L137-L243): `/init` command scans workspace and generates AGENTS.md using the LLM
- [openclawDefaultRuntimeSupport.ts](src/openclaw/openclawDefaultRuntimeSupport.ts#L229-L236): Also creates `.parallx/`, `.parallx/rules/`, `.parallx/commands/`, `.parallx/skills/` directories
- Does NOT create: SOUL.md, TOOLS.md, IDENTITY.md, USER.md, HEARTBEAT.md, BOOTSTRAP.md, MEMORY.md

**Upstream reference:** `agents/workspace.ts` has `ensureAgentWorkspace` which creates workspace bootstrap files proactively. The upstream setup path (`agents.commands.bind.ts:648-659`, `gateway/server-methods/agents.ts:663-665`) calls `ensureAgentWorkspace({ dir, ensureBootstrapFiles: !skipBootstrap })`.

**Upstream valid bootstrap files:** `VALID_BOOTSTRAP_NAMES` set in `agents/workspace.ts:174-184` includes: `AGENTS.md`, `SOUL.md`, `TOOLS.md`, `IDENTITY.md`, `USER.md`, `HEARTBEAT.md`, `BOOTSTRAP.md`, `MEMORY.md`, plus a `MEMORY.md` alternate.

**Divergence:** Parallx only scaffolds AGENTS.md (1/8). The 7 other files are mentioned in the `OPENCLAW_BOOTSTRAP_FILES` array but have no creation path, no defaults, and no user documentation. Users have no way to know these files exist or what to put in them.

---

### C4: Personality Configuration

**Classification:** DEAD  
**Severity:** HIGH

**The full personality pipeline:**
1. User adjusts tone/focus/length in Settings UI → writes to `IUnifiedAIConfig.suggestions.*` and `chat.responseLength`
2. `systemPromptGenerator.ts` generates a prompt from these settings → stored in `chat.systemPrompt`
3. **STOP.** Nobody reads `chat.systemPrompt` in the active runtime.

**Evidence:**
- [systemPromptGenerator.ts](src/aiSettings/systemPromptGenerator.ts#L69-L87): `generateChatSystemPrompt()` produces prompt from tone/focus/length
- [unifiedAIConfigService.ts](src/aiSettings/unifiedAIConfigService.ts#L283-L296): Generated system prompt stored in preset's `chat.systemPrompt`
- Grep for `getEffectiveConfig` in `openclawDefaultParticipant.ts`: Only 1 match (line 187) — for `memory.memoryEnabled`
- `buildOpenclawTurnContext` (lines 222-282): Builds system prompt from bootstrap files, workspace digest, skills, tools, runtime info — never reads unified config's systemPrompt, persona, tone, focus, or responseLength

**Dead config fields for OpenClaw default participant:**
- `persona.name` — never injected
- `persona.description` — never injected
- `persona.avatarEmoji` — display-only (UI uses it, not the model)
- `chat.systemPrompt` — never consumed by model calls
- `chat.responseLength` — never consumed
- `chat.workspaceDescription` — never consumed (workspace digest is auto-generated separately)
- `suggestions.tone` — never consumed
- `suggestions.focusDomain` — never consumed

**Upstream reference:** OpenClaw uses bootstrap files (SOUL.md, IDENTITY.md) for personality, not config-driven tone/focus/length enums. The personality IS file-based in upstream.

**Assessment:** The personality system is DEAD, but also structurally different from upstream. OpenClaw's approach is correct for Parallx — personality via SOUL.md (file-based) rather than UI enum dropdowns. However, the user has no way to know this — the Settings UI shows personality controls that do nothing.

---

### C5: Model Parameters

**Classification:** MISALIGNED  
**Severity:** HIGH

**Parameter wiring by participant:**

| Parameter | Default Participant | Workspace Participant | Canvas Participant |
|-----------|--------------------|-----------------------|-------------------|
| `temperature` | ❌ NOT WIRED | ✅ [line 299](src/openclaw/participants/openclawWorkspaceParticipant.ts#L299) | ✅ [line 246](src/openclaw/participants/openclawCanvasParticipant.ts#L246) |
| `maxTokens` | ❌ NOT WIRED | ✅ [line 300](src/openclaw/participants/openclawWorkspaceParticipant.ts#L300) | ✅ [line 247](src/openclaw/participants/openclawCanvasParticipant.ts#L247) |
| `contextWindow` | ⚠️ Partial — `getModelContextLength()` uses model metadata, not config override | N/A | N/A |
| `chatModel` | ❌ — Model selection UI-driven via `ILanguageModelsService`, not from config | N/A | N/A |
| `embeddingModel` | ❌ — hardcoded `nomic-embed-text` | N/A | N/A |

**Evidence — Default participant (the main chat surface):**
- [openclawAttempt.ts](src/openclaw/openclawAttempt.ts#L200-L204): Request options built as `{ think: true, tools: ..., numCtx: context.tokenBudget }` — NO temperature, NO maxTokens
- [openclawDefaultParticipant.ts](src/openclaw/participants/openclawDefaultParticipant.ts#L230-L232): `contextWindow = services.getModelContextLength?.() ?? 8192` — from model metadata, NOT from unified config's `contextWindow` override

**Upstream reference:** `applyExtraParamsToAgent` in `pi-embedded-runner/extra-params.ts:318-377` applies temperature and other params from config to the agent's stream function. The config schema (`zod-schema.agent-defaults.ts`) includes `params` as a per-model record of arbitrary extra parameters.

**Divergence:** The default participant — which handles the vast majority of chat — doesn't honor temperature or maxTokens from the settings UI. A user changing temperature from 0.7 to 0.2 in the Settings panel has ZERO effect on the primary chat surface. This is a critical user-facing gap.

---

### C6: Retrieval Parameters

**Classification:** DEAD  
**Severity:** MEDIUM

**Evidence:**
- [unifiedConfigTypes.ts](src/aiSettings/unifiedConfigTypes.ts#L98-L135): `IUnifiedRetrievalConfig` defines autoRag, ragTopK, ragMaxPerSource, ragTokenBudget, ragScoreThreshold, contextBudget
- Grep for these config keys in `src/openclaw/openclawContextEngine.ts`: **0 matches**
- [openclawContextEngine.ts](src/openclaw/openclawContextEngine.ts): The context engine uses its own budget system (`computeElasticBudget`), not the config values

**Dead retrieval config fields:**
- `autoRag` — context engine always retrieves (hardcoded behavior)
- `ragTopK` — not passed to the retrieval layer from config
- `ragMaxPerSource` — not passed
- `ragScoreThreshold` — not passed
- `ragTokenBudget` — elastic budget computed independently
- `ragDecompositionMode` — not consumed
- `ragCandidateBreadth` — not consumed
- `contextBudget.trimPriority.*` — not consumed (engine has its own budget logic)
- `contextBudget.minPercent.*` — not consumed

**Upstream reference:** OpenClaw uses `config.agents.defaults.memorySearch` for search params (maxResults, minScore, hybrid settings) from `zod-schema.agent-runtime.ts:661-716`. Config-driven retrieval tuning IS part of upstream.

**Divergence:** Parallx has a detailed retrieval config UI section but the values are never read by the context engine. Users changing RAG settings see no effect.

---

### C7: Memory Parameters

**Classification:** MISALIGNED  
**Severity:** LOW

| Parameter | Consumed? | Where |
|-----------|----------|-------|
| `memoryEnabled` | ✅ | [openclawDefaultParticipant.ts:187](src/openclaw/participants/openclawDefaultParticipant.ts#L187) |
| `transcriptIndexingEnabled` | ✅ | [main.ts:865](src/built-in/chat/main.ts#L865) |
| `autoSummarize` | ❌ | Not consumed by any OpenClaw participant |
| `evictionDays` | ❌ | Not consumed — no eviction mechanism exists |

---

### C8: Agent Parameters

**Classification:** MISALIGNED  
**Severity:** MEDIUM

| Parameter | Consumed? | Where |
|-----------|----------|-------|
| `maxIterations` | ✅ | [main.ts:658](src/built-in/chat/main.ts#L658) → `openclawDefaultParticipantServices.maxIterations` |
| `verbosity` | ❌ | Not consumed — no verbosity logic in OpenClaw participants |
| `approvalStrictness` | ❌ | Not consumed — permission system uses skill-level permissions, not config |
| `executionStyle` | ❌ | Not consumed |
| `proactivity` | ❌ | Not consumed |

---

### C9: Prompt Overlay / Rules

**Classification:** ALIGNED  
**Severity:** N/A

**Evidence:**
- [openclawDefaultParticipant.ts](src/openclaw/participants/openclawDefaultParticipant.ts#L103): `const patternRulesOverlay = await services.getPromptOverlay?.().catch(() => undefined);`
- Passed to `buildOpenclawTurnContext` as `preprocessed.promptOverlay`
- [openclawSystemPrompt.ts](src/openclaw/openclawSystemPrompt.ts#L119): `if (params.promptOverlay) { sections.push('## Active Rules\n${params.promptOverlay}'); }`

This is the ONE fully working config surface. Pattern-scoped rules from `.parallx/rules/*.md` reach the active system prompt.

---

### C10: Legacy AISettingsService

**Classification:** LEGACY  
**Severity:** LOW

**Evidence:**
- [aiSettingsService.ts](src/aiSettings/aiSettingsService.ts#L70): `AISettingsService` class exists (274 lines)
- [workbenchServices.ts](src/workbench/workbenchServices.ts#L307-L310): `UnifiedAIConfigService` is registered as BOTH `IUnifiedAIConfigService` AND `IAISettingsService`
- The standalone `AISettingsService` class is never instantiated at runtime

**Dead code:** `aiSettingsService.ts` (entire file) and the standalone `AISettingsService` class. The unified service replaced it. The types in `aiSettingsTypes.ts` are still referenced (IAISettingsService interface) by the unified service.

---

### C11: Legacy Unified Config Consumers

**Classification:** MISALIGNED  
**Severity:** HIGH

**Config fields actually consumed by the active OpenClaw runtime:**

| Section | Field | Consumed By | Effect |
|---------|-------|-------------|--------|
| `memory` | `memoryEnabled` | Default participant | Gates memory writeback |
| `memory` | `transcriptIndexingEnabled` | main.ts transcript accessor | Gates transcript indexing |
| `agent` | `maxIterations` | main.ts → default participant services | Caps tool loop iterations |
| `model` | `temperature` | Workspace + Canvas participants ONLY | Sets model temperature |
| `model` | `maxTokens` | Workspace + Canvas participants ONLY | Sets max response length |

**Config fields NOT consumed (~26 fields):**

| Section | Dead Fields |
|---------|-------------|
| `persona` | name, description, avatarEmoji |
| `chat` | systemPrompt, systemPromptIsCustom, responseLength, workspaceDescription |
| `model` | chatModel, embeddingModel, contextWindow |
| `suggestions` | tone, focusDomain, customFocusDescription, suggestionConfidenceThreshold, suggestionsEnabled, maxPendingSuggestions |
| `retrieval` | ALL 9+ fields |
| `agent` | verbosity, approvalStrictness, executionStyle, proactivity |
| `memory` | autoSummarize, evictionDays |
| `indexing` | ALL 4 fields |
| `tools` | enabledOverrides |
| `runtime` | implementation |

---

### C12: Legacy System Prompt Builders

**Classification:** LEGACY  
**Severity:** MEDIUM

**Live consumers of legacy prompt builders:**

| Consumer | File:Line | What It Does | Problem |
|----------|-----------|-------------|---------|
| Token status bar | [chatTokenStatusBar.ts:290](src/built-in/chat/widgets/chatTokenStatusBar.ts#L290) | Estimates system prompt size for token display | Shows size of WRONG prompt (legacy, not OpenClaw) |
| Token status bar | [chatTokenStatusBar.ts:301](src/built-in/chat/widgets/chatTokenStatusBar.ts#L301) | Base prompt for comparison | Same |
| Session services | [chatDataService.ts:2137](src/built-in/chat/data/chatDataService.ts#L2137) | `getSystemPrompt` for session display | Returns legacy prompt text, not what model actually sees |

**Evidence:** `chatSystemPrompts.ts` defines `PARALLX_IDENTITY` (11-line identity block) and `buildAgentPrompt` (full agent mode prompt with context guidance, skill catalog, tool listing). This is completely different from `buildOpenclawSystemPrompt`'s 10-section structured output.

---

### C13: Settings UI Panel

**Classification:** MISALIGNED  
**Severity:** HIGH

**10 UI sections and their real effect on the active runtime:**

| Section | File | Effect on OpenClaw Runtime |
|---------|------|---------------------------|
| Persona | `personaSection.ts` | ❌ DEAD — persona fields never read |
| Chat | `chatSection.ts` | ❌ DEAD — systemPrompt, responseLength, workspaceDescription never read |
| Model | `modelSection.ts` | ⚠️ PARTIAL — temperature/maxTokens affect workspace/canvas only; contextWindow dead |
| Suggestions | `suggestionsSection.ts` | ❌ DEAD — tone, focusDomain, etc. never read |
| Retrieval | `retrievalSection.ts` | ❌ DEAD — all retrieval config never read |
| Agent | `agentSection.ts` | ⚠️ PARTIAL — maxIterations works; verbosity/approval/execution/proactivity dead |
| Indexing | `indexingSection.ts` | ❓ UNCLEAR — indexing service may read config independently of OpenClaw |
| Tools | `toolsSection.ts` | ❌ DEAD — enabledOverrides never read by tool policy |
| Advanced | `advancedSection.ts` | ❌ DEAD — shows generated system prompt that nobody uses |
| Preview | `previewSection.ts` | ⚠️ PARTIAL — sends test request (works), but uses settings-generated prompt, not OpenClaw prompt |

**Summary:** Of 10 sections, 0 are fully effective, 3 are partially effective, and 7 are DEAD.

---

### C14: Preset / Profile System

**Classification:** DEAD  
**Severity:** MEDIUM

**Evidence:**
- [aiSettingsDefaults.ts](src/aiSettings/aiSettingsDefaults.ts#L102-L103): 3 built-in presets: Default, Finance Focus, Creative Mode
- [unifiedAIConfigService.ts](src/aiSettings/unifiedAIConfigService.ts#L85-L142): Built-in presets define different config values
- Finance Focus: `tone: 'concise'`, `focusDomain: 'finance'`, `temperature: 0.7`
- Creative Mode: `tone: 'detailed'`, `focusDomain: 'writing'`, `temperature: 0.9`

**Assessment:** Switching from Default to Creative Mode changes `temperature` from 0.7 to 0.9, which affects workspace/canvas participants but NOT the default participant. The `tone` and `focusDomain` changes have zero effect on any participant. The preset system works mechanically (CRUD, storage, switching) but the values it manages are almost entirely dead.

---

### C15: Workspace Override

**Classification:** MISALIGNED  
**Severity:** LOW

**Evidence:**
- [unifiedAIConfigService.ts](src/aiSettings/unifiedAIConfigService.ts#L207-L219): `getEffectiveConfig()` merges workspace override onto base preset
- `.parallx/ai-config.json` loaded via `_loadWorkspaceOverride()`
- [main.ts](src/built-in/chat/main.ts#L1368-L1395): Filesystem wired and config loaded on workspace open

**Assessment:** The mechanism works correctly. But since most config values aren't consumed, workspace overrides have limited practical effect. The only useful workspace overrides are: `memory.memoryEnabled`, `agent.maxIterations`, and `model.temperature/maxTokens` (workspace/canvas only).

---

### C16: Runtime Selector

**Classification:** DEAD  
**Severity:** LOW

**Evidence:**
- [unifiedConfigTypes.ts](src/aiSettings/unifiedConfigTypes.ts#L161-L164): `IUnifiedRuntimeConfig { implementation: 'legacy-claw' | 'openclaw' }`
- [chatRuntimeSelector.ts](src/services/chatRuntimeSelector.ts#L10-L17): Function signature accepts `_getConfig` parameter but NEVER reads it — unconditionally returns `OPENCLAW_DEFAULT_PARTICIPANT_ID`

```typescript
export function resolveChatRuntimeParticipantId(
  participantId: string,
  _getConfig?: () => IUnifiedAIConfig | undefined,
): string {
  if (participantId !== DEFAULT_CHAT_PARTICIPANT_ID) {
    return participantId;
  }
  return OPENCLAW_DEFAULT_PARTICIPANT_ID;  // Always OpenClaw
}
```

The `_getConfig` parameter is accepted but never used. The `implementation` config field has no consumers.

---

## 4. Critical Findings

### CRITICAL-1: Default Participant Ignores Temperature and MaxTokens
The primary chat surface (default participant) builds model request options without temperature or maxTokens from the unified config. A user adjusting these settings in the UI sees no change in chat behavior. This is the #1 user-facing bug.

**Files:** [openclawAttempt.ts](src/openclaw/openclawAttempt.ts#L200-L204)  
**Fix:** Wire `temperature` and `maxTokens` from `IOpenclawTurnContext` (add fields, populate from unified config in `buildOpenclawTurnContext`).

### CRITICAL-2: Settings UI is 70% Dead
7 of 10 settings sections write config that the active runtime never reads. Users adjusting persona, chat, suggestions, retrieval, tools, or advanced settings see no behavioral change. This creates a broken trust relationship with the UI.

### CRITICAL-3: Two Competing Bootstrap Loaders  
`PromptFileService` has good defaults (DEFAULT_SOUL) but isn't used. `loadOpenclawBootstrapEntries` is used but has no defaults. A fresh workspace gets `[MISSING]` markers in the system prompt instead of reasonable defaults.

### CRITICAL-4: /init Doesn't Scaffold Key Bootstrap Files
Only AGENTS.md is created. SOUL.md and TOOLS.md (the two most important personality/behavior files) get no scaffolding, no defaults, and no user documentation.

### CRITICAL-5: Token Status Bar Shows Wrong Prompt
`chatTokenStatusBar.ts` calls the legacy `buildSystemPrompt()` for token estimation, which produces a completely different prompt than what the OpenClaw runtime actually sends to the model.

---

## 5. Upstream Config Architecture (for reference)

OpenClaw's configuration is fundamentally different from Parallx's UI-driven approach:

| Aspect | OpenClaw | Parallx |
|--------|----------|---------|
| **Config location** | `~/.openclaw/config.json` (Zod schema) | `IStorage` (in-memory presets) + `.parallx/ai-config.json` |
| **Personality** | SOUL.md + IDENTITY.md (file-based) | UI dropdowns (tone, focus, length) → dead code |
| **Model params** | `agents.defaults.params` + `applyExtraParamsToAgent` | `IUnifiedModelConfig` → partially wired |
| **Retrieval** | `agents.defaults.memorySearch` config section | `IUnifiedRetrievalConfig` → not consumed |
| **Tool policy** | `tools.profile` + per-agent overrides in config | `openclawToolPolicy.ts` (working but not config-driven) |
| **Bootstrap files** | Loaded + scaffold on workspace creation | Loaded but no scaffold/defaults |
| **No UI panel** | CLI + file-based configuration only | 10-section settings panel |

**Key insight:** OpenClaw is file-based and config-file-based. Parallx added a rich Settings UI (M15/M20) that was designed for the pre-OpenClaw runtime. The OpenClaw runtime was built without consuming the UI settings. The result is a Settings panel that writes to storage nobody reads.

---

## 6. Recommended Fix Priority

### Phase 1: Wire Critical Config to Default Participant (HIGH)
1. Add `temperature` and `maxTokens` fields to `IOpenclawTurnContext`
2. Populate from unified config in `buildOpenclawTurnContext`
3. Wire into attempt `requestOptions`
4. Unifies behavior with workspace/canvas participants

### Phase 2: Fix Bootstrap Defaults (HIGH)
1. Give `loadOpenclawBootstrapEntries` a fallback mechanism for SOUL.md (use DEFAULT_SOUL from PromptFileService)
2. Extend `/init` to scaffold SOUL.md and TOOLS.md with sensible defaults
3. Consider consolidating the two bootstrap loaders

### Phase 3: Fix Token Status Bar (MEDIUM)
1. Wire `chatTokenStatusBar.ts` to use the OpenClaw prompt (via `getLastSystemPromptReport`)

### Phase 4: Audit and Document Dead Config (MEDIUM)
1. For each dead config field, decide: wire it, remove it, or document it as "planned"
2. Settings UI sections that can't affect behavior should either be removed or marked as "requires OpenClaw support"

### Phase 5: Clean Up Dead Code (LOW)
1. Delete `AISettingsService` class (aiSettingsService.ts)
2. Remove `'legacy-claw'` from `IUnifiedRuntimeConfig.implementation` union
3. Remove `_getConfig` parameter from `resolveChatRuntimeParticipantId`

---

## 7. Files Read During This Audit

| File | Purpose |
|------|---------|
| `src/aiSettings/aiSettingsTypes.ts` | Full type system |
| `src/aiSettings/aiSettingsDefaults.ts` | Default profiles and built-in presets |
| `src/aiSettings/aiSettingsService.ts` | Legacy service implementation |
| `src/aiSettings/systemPromptGenerator.ts` | Tone/focus/length → prompt generator |
| `src/aiSettings/unifiedConfigTypes.ts` | Merged type system + defaults |
| `src/aiSettings/unifiedAIConfigService.ts` | Unified config service implementation |
| `src/aiSettings/ui/aiSettingsPanel.ts` | Settings panel shell |
| `src/services/promptFileService.ts` | Prompt file loader with defaults |
| `src/services/chatRuntimeSelector.ts` | Runtime participant resolver |
| `src/services/chatService.ts` | Request dispatch |
| `src/openclaw/participants/openclawParticipantRuntime.ts` | Bootstrap loader |
| `src/openclaw/participants/openclawDefaultParticipant.ts` | Default participant |
| `src/openclaw/participants/openclawWorkspaceParticipant.ts` | Workspace participant |
| `src/openclaw/participants/openclawCanvasParticipant.ts` | Canvas participant |
| `src/openclaw/openclawSystemPrompt.ts` | Structured system prompt builder |
| `src/openclaw/openclawAttempt.ts` | Attempt execution (request options) |
| `src/openclaw/openclawTurnRunner.ts` | Turn runner |
| `src/openclaw/openclawContextEngine.ts` | Context engine |
| `src/openclaw/openclawParticipantServices.ts` | Service adapter |
| `src/openclaw/openclawDefaultRuntimeSupport.ts` | /init command |
| `src/openclaw/openclawTypes.ts` | Type definitions |
| `src/built-in/chat/config/chatSystemPrompts.ts` | Legacy system prompts |
| `src/built-in/chat/utilities/chatSystemPromptComposer.ts` | Legacy prompt composer |
| `src/built-in/chat/data/chatDataService.ts` | Chat data service |
| `src/built-in/chat/main.ts` | Chat tool main — participant wiring |
| `src/workbench/workbenchServices.ts` | Service registration |
| Upstream: `agents/bootstrap-files.ts`, `agents/workspace.ts`, `config/zod-schema*.ts`, `pi-embedded-runner/extra-params.ts` | OpenClaw config architecture |
