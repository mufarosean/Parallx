# D8 — Agent Configuration: Gap Map (Iteration 1 — STRUCTURAL)

**Date:** 2026-03-28
**Source audit:** `docs/D8_AGENT_CONFIGURATION_AUDIT.md`
**Domain:** D8 — Agent Configuration
**Iteration:** 1 (STRUCTURAL)

---

## Design Principles

1. **Participants stay.** The three participants (default, workspace, canvas) remain as runtime surfaces. They are NOT replaced by agents.
2. **Agent config is data, participants are runtime.** Each participant references an `IAgentConfig` at turn time. Config drives model, prompt overlay, tool policy, behavior.
3. **Desktop simplification.** No CLI agent management, no Docker workspace setup, no multi-instance routing. Single-user, single-machine, Ollama-backed.
4. **Build on what exists.** Extend `IUnifiedAgentConfig`, insert agent stage into existing tool policy pipeline, add overlay slot to existing system prompt builder. Don't rebuild from scratch.

---

## Dependency Order

```
Phase 1: Types        (D8-1)  — IAgentConfig, IAgentDefaults, IResolvedAgentConfig
Phase 2: Registry     (D8-2)  — AgentRegistry with register/lookup/resolve/default
Phase 3: Resolver     (D8-3, D8-9)  — Per-turn config resolution, default agent resolution
Phase 4: Wiring       (D8-5, D8-6, D8-10)  — System prompt overlay, tool policy stage, lifecycle hooks
Phase 5: UI Surface   (D8-7)  — Agent list + per-agent config in AI Settings
Phase 6: Integration  (D8-4, D8-8)  — Config-driven definitions, subagent context engine
```

---

## Phase 1: Agent Config Types

### D8-1: Agent Config Type Contract

- **Status**: MISSING → ALIGNED
- **Upstream**: `src/config/types.agents.ts:68-101` (`AgentConfig`), `src/config/types.agent-defaults.ts` (`AgentDefaultsConfig`), `src/agents/agent-scope.ts:33-50` (`ResolvedAgentConfig`)
- **Parallx file**: CREATE `src/openclaw/agents/openclawAgentConfig.ts`
- **Action**:
  1. Define `IAgentConfig` — the data shape for one agent entry:
     ```ts
     export interface IAgentConfig {
       readonly id: string;              // unique agent ID (e.g., 'default', 'workspace', 'canvas', user-defined)
       readonly name: string;            // display name
       readonly isDefault?: boolean;     // true = this agent is the default for unrouted turns
       readonly surface?: 'default' | 'workspace' | 'canvas';  // which participant surface, if any
       // Model
       readonly model?: string;          // override model ID (undefined = global default)
       readonly temperature?: number;    // override temperature (undefined = global)
       readonly maxTokens?: number;      // override maxTokens (undefined = global)
       // Tools
       readonly tools?: IAgentToolsConfig;  // per-agent tool allow/deny
       // Prompt
       readonly identity?: IAgentIdentityConfig;  // per-agent personality overlay
       readonly systemPromptOverlay?: string;      // literal system prompt text to inject
       // Behavior
       readonly maxIterations?: number;  // override max tool loop iterations
       readonly autoRag?: boolean;       // override workspace retrieval toggle
     }
     ```
  2. Define `IAgentToolsConfig` — per-agent tool allow/deny:
     ```ts
     export interface IAgentToolsConfig {
       readonly allow?: readonly string[];  // tool names to whitelist (empty = no override)
       readonly deny?: readonly string[];   // tool names to blacklist
     }
     ```
     Upstream: `src/config/types.agents.ts:88-89` (`tools?: { allow?, deny?, profile? }`)
  3. Define `IAgentIdentityConfig` — per-agent personality:
     ```ts
     export interface IAgentIdentityConfig {
       readonly name?: string;    // display name for prompt injection
       readonly theme?: string;   // personality description
       readonly emoji?: string;   // avatar emoji
     }
     ```
     Upstream: `src/agents/identity.ts:6-40` (`IdentityConfig`)
  4. Define `IAgentDefaults` — shared baseline applied to all agents unless overridden:
     ```ts
     export interface IAgentDefaults {
       readonly model?: string;
       readonly temperature?: number;
       readonly maxTokens?: number;
       readonly maxIterations?: number;
       readonly autoRag?: boolean;
       readonly tools?: IAgentToolsConfig;
     }
     ```
     Upstream: `src/config/types.agent-defaults.ts` (`AgentDefaultsConfig` — we take the 6 fields relevant to desktop)
  5. Define `IResolvedAgentConfig` — the fully-merged result after defaults + agent + global config:
     ```ts
     export interface IResolvedAgentConfig {
       readonly id: string;
       readonly name: string;
       readonly surface?: 'default' | 'workspace' | 'canvas';
       readonly model: string;          // resolved: agent.model ?? defaults.model ?? globalConfig.model
       readonly temperature: number;
       readonly maxTokens: number;
       readonly maxIterations: number;
       readonly autoRag: boolean;
       readonly tools: IAgentToolsConfig;
       readonly identity?: IAgentIdentityConfig;
       readonly systemPromptOverlay?: string;
     }
     ```
     Upstream: `src/agents/agent-scope.ts:33-50` (`ResolvedAgentConfig`)
  6. Export `DEFAULT_AGENT_CONFIGS` — the three built-in agents matching current participants:
     ```ts
     export const DEFAULT_AGENT_CONFIGS: readonly IAgentConfig[] = [
       { id: 'default', name: 'Chat', isDefault: true, surface: 'default' },
       { id: 'workspace', name: 'Workspace', surface: 'workspace' },
       { id: 'canvas', name: 'Canvas', surface: 'canvas' },
     ];
     ```
- **Remove**: Nothing yet (types are additive).
- **Verify**: Types compile. `IResolvedAgentConfig` covers all fields consumed by turn context builder.
- **Risk**: LOW — purely additive type definitions, no runtime changes.

### D8-1b: Extend `IUnifiedAgentConfig` with Agent List

- **Status**: MISSING → ALIGNED
- **Upstream**: `src/config/types.agents.ts:89-101` (`AgentsConfig = { defaults?, list? }`)
- **Parallx file**: MODIFY `src/aiSettings/unifiedConfigTypes.ts`
- **Action**:
  1. Add `agents` field to `IUnifiedAgentConfig`:
     ```ts
     export interface IUnifiedAgentConfig {
       readonly maxIterations: number;
       // ... existing deprecated fields ...
       /** Agent definitions. Built-in agents are always present. User-added agents appended. */
       readonly agents?: readonly IAgentConfig[];
       /** Shared defaults applied to all agents unless overridden per-agent. */
       readonly agentDefaults?: IAgentDefaults;
     }
     ```
  2. Import `IAgentConfig` and `IAgentDefaults` from `../openclaw/agents/openclawAgentConfig.js`.
  3. Update `DEFAULT_UNIFIED_CONFIG` (wherever it lives) to include the 3 built-in agent configs.
- **Remove**: Nothing.
- **Verify**: `getEffectiveConfig().agent.agents` returns the built-in list. Existing `maxIterations` untouched.
- **Risk**: LOW — additive field on existing interface. No consumers break.

---

## Phase 2: Agent Registry

### D8-2: Agent Registry

- **Status**: MISSING → ALIGNED
- **Upstream**: `src/agents/agent-scope.ts:55-92` (`listAgentEntries`, `listAgentIds`, `resolveDefaultAgentId`), `src/commands/agents.config.ts:104-124` (`buildAgentSummaries`)
- **Parallx file**: CREATE `src/openclaw/agents/openclawAgentRegistry.ts`
- **Action**:
  1. Create `IAgentRegistry` interface:
     ```ts
     export interface IAgentRegistry {
       register(config: IAgentConfig): void;
       unregister(id: string): boolean;
       get(id: string): IAgentConfig | undefined;
       getDefault(): IAgentConfig;
       list(): readonly IAgentConfig[];
       listIds(): readonly string[];
     }
     ```
  2. Create `AgentRegistry` class — simple in-memory Map-based implementation:
     - Constructor takes `IAgentConfig[]` (initial set = built-in agents from config).
     - `register(config)` — adds/replaces by ID. Upstream: `agents.list[]` population from config.
     - `get(id)` — lookup by ID. Upstream: `resolveAgentConfig(cfg, agentId)` first step.
     - `getDefault()` — returns agent with `isDefault: true`, or first agent, or throws. Upstream: `resolveDefaultAgentId(cfg)`.
     - `list()` / `listIds()` — enumerate. Upstream: `listAgentEntries`, `listAgentIds`.
  3. Factory function `createAgentRegistry(configs: readonly IAgentConfig[]): IAgentRegistry`.
- **Remove**: Nothing (additive).
- **Verify**: `registry.get('default')` returns the default agent config. `registry.list()` returns all 3 built-ins. `registry.getDefault()` returns the agent with `isDefault: true`.
- **Risk**: LOW — new class, no existing code modified.

---

## Phase 3: Config Resolution

### D8-3: Agent Config-to-Runtime Binding

- **Status**: MISSING → ALIGNED
- **Upstream**: `src/agents/agent-scope.ts:130-156` (`resolveAgentConfig`), `src/agents/model-selection.ts:340-564` (`resolveDefaultModelForAgent`)
- **Parallx file**: CREATE `src/openclaw/agents/openclawAgentResolver.ts`, MODIFY `src/openclaw/participants/openclawDefaultParticipant.ts`
- **Action**:
  1. Create `resolveAgentConfig()` in `openclawAgentResolver.ts`:
     ```ts
     export function resolveAgentConfig(
       registry: IAgentRegistry,
       agentId: string,
       globalConfig: IUnifiedAIConfig,
     ): IResolvedAgentConfig
     ```
     Resolution order (upstream pattern from `agent-scope.ts:130-156`):
     - Look up `IAgentConfig` from registry by `agentId`.
     - Merge: `globalConfig` (base) → `agentDefaults` (shared) → `agentConfig` (per-agent).
     - Return `IResolvedAgentConfig` with all fields resolved.
  2. Modify `buildOpenclawTurnContext()` in `openclawDefaultParticipant.ts` (line 226):
     - Accept `agentId` parameter (default: participant's surface ID → agent ID mapping).
     - Call `resolveAgentConfig(registry, agentId, effectiveConfig)`.
     - Use resolved config for: `temperature`, `maxTokens`, `maxToolIterations`, `autoRag`, model.
     - Pass `resolvedAgentConfig` through `IOpenclawTurnContext`.
  3. Add `readonly agentConfig?: IResolvedAgentConfig` to `IOpenclawTurnContext` in `openclawAttempt.ts`.
- **Remove**: The hardcoded reads from `effectiveConfig.model.temperature`, `effectiveConfig.model.maxTokens`, `effectiveConfig.retrieval.autoRag` in `buildOpenclawTurnContext()` (lines 290-305). These become `resolvedAgentConfig.temperature`, etc.
- **Verify**: Default participant builds turn context with resolved agent config. Switching agent ID changes model/temperature/maxTokens used in the turn.
- **Risk**: MEDIUM — modifies the hot path (`buildOpenclawTurnContext`). Must preserve exact same behavior when agent has no overrides (resolution falls through to global config).

### D8-9: Default Agent Resolution

- **Status**: MISSING → ALIGNED
- **Upstream**: `src/agents/agent-scope.ts:80-93` (`resolveDefaultAgentId`)
- **Parallx file**: MODIFY `src/services/chatRuntimeSelector.ts`, uses `openclawAgentRegistry.ts`
- **Action**:
  1. Add `resolveDefaultAgentId(registry: IAgentRegistry): string` to `openclawAgentResolver.ts`:
     ```ts
     export function resolveDefaultAgentId(registry: IAgentRegistry): string {
       return registry.getDefault().id;
     }
     ```
     Upstream: `resolveDefaultAgentId(cfg)` — finds `default: true`, falls back to first, falls back to `"main"`.
  2. The `OPENCLAW_DEFAULT_PARTICIPANT_ID` constant in `chatRuntimeSelector.ts` stays (it's the VS Code participant ID, not the agent ID). But the turn context builder now also resolves the *agent* ID from the registry rather than being hardcoded.
  3. Add mapping: participant ID → agent ID. The default participant (`parallx.chat.openclaw-default`) maps to agent ID `'default'`. Workspace participant maps to `'workspace'`. Canvas maps to `'canvas'`.
- **Remove**: Nothing (the participant ID constant stays; agent resolution is additive).
- **Verify**: `resolveDefaultAgentId(registry)` returns `'default'` with built-in config. If user marks a different agent as default, that one is returned.
- **Risk**: LOW — additive function. Participant ID mapping is a simple lookup table.

---

## Phase 4: Wiring

### D8-5: Agent-Specific System Prompt Overlay

- **Status**: MISALIGNED → ALIGNED
- **Upstream**: `src/agents/identity.ts:6-40` (`resolveAgentIdentity`), `src/config/types.agents.ts:84` (`identity?: IdentityConfig`), `src/agents/workspace.ts:24` (`DEFAULT_IDENTITY_FILENAME = "IDENTITY.md"`)
- **Parallx file**: MODIFY `src/openclaw/openclawSystemPrompt.ts`, MODIFY `src/openclaw/openclawAttempt.ts`
- **Action**:
  1. Add `agentIdentity?: IAgentIdentityConfig` to `IOpenclawSystemPromptParams`:
     ```ts
     /** Per-agent identity overlay. Injected after the global identity section. */
     readonly agentIdentity?: IAgentIdentityConfig;
     /** Per-agent literal system prompt overlay text. */
     readonly agentSystemPromptOverlay?: string;
     ```
  2. In `buildOpenclawSystemPrompt()`, after section 1 (identity), insert agent identity section:
     ```ts
     // 1c. Agent identity overlay (upstream: resolveAgentIdentity)
     if (params.agentIdentity) {
       sections.push(buildAgentIdentitySection(params.agentIdentity));
     }
     if (params.agentSystemPromptOverlay) {
       sections.push(`## Agent Instructions\n${params.agentSystemPromptOverlay}`);
     }
     ```
  3. Add `buildAgentIdentitySection(identity: IAgentIdentityConfig): string` helper:
     ```ts
     function buildAgentIdentitySection(identity: IAgentIdentityConfig): string {
       const parts: string[] = [];
       if (identity.name) parts.push(`Your agent name is ${identity.name}.`);
       if (identity.theme) parts.push(identity.theme);
       return parts.join(' ');
     }
     ```
  4. In `executeOpenclawAttempt()` (`openclawAttempt.ts`), pass `context.agentConfig?.identity` and `context.agentConfig?.systemPromptOverlay` through to `buildOpenclawPromptArtifacts`.
  5. In `buildOpenclawPromptArtifacts` (`openclawPromptArtifacts.ts`), thread the new params through to `buildOpenclawSystemPrompt`.
- **Remove**: Nothing (SOUL.md stays as workspace-level identity; agent identity is additive overlay).
- **Verify**: When agent has `identity: { name: 'Research Assistant', theme: 'You are a meticulous researcher...' }`, the system prompt contains that text after the global identity section. When agent has no identity, prompt is unchanged.
- **Risk**: LOW — additive sections in system prompt. No existing sections move or change.

### D8-6: Agent-Specific Tool Policy Stage

- **Status**: MISALIGNED → ALIGNED
- **Upstream**: `src/agents/tool-policy.ts` (`isToolAllowedByPolicies`), `src/config/types.agents.ts:88-89` (`tools?: AgentToolsConfig`), `src/agents/sandbox/tool-policy.ts` (`resolveSandboxToolPolicyForAgent`)
- **Parallx file**: MODIFY `src/openclaw/openclawToolPolicy.ts`, MODIFY `src/openclaw/openclawToolState.ts`
- **Action**:
  1. Add optional `agentTools?: IAgentToolsConfig` parameter to `applyOpenclawToolPolicy`:
     ```ts
     export function applyOpenclawToolPolicy(params: {
       tools: readonly IToolDefinition[];
       mode: OpenclawToolProfile;
       permissions?: IToolPermissions;
       agentTools?: IAgentToolsConfig;  // NEW: per-agent allow/deny
     }): IToolDefinition[]
     ```
  2. Insert Step 1.5 (agent-specific filter) between Profile and Permission stages:
     ```ts
     // Step 1.5: Agent-specific filter (upstream: isToolAllowedByPolicies stage 2)
     if (params.agentTools) {
       // Deny-first: if tool is on agent deny list, exclude it
       if (params.agentTools.deny?.includes(tool.name)) return false;
       // If agent has an allow list, tool must be on it
       if (params.agentTools.allow?.length && !params.agentTools.allow.includes(tool.name)) return false;
     }
     ```
  3. Update `buildOpenclawRuntimeToolState` in `openclawToolState.ts` to accept and pass through `agentTools`.
  4. In `buildOpenclawTurnContext()`, pass `resolvedAgentConfig.tools` to tool state builder.
- **Remove**: Nothing (existing 2 stages preserved, new stage inserted between them).
- **Verify**: Agent with `tools: { deny: ['run_command'] }` on `full` profile still blocks `run_command`. Agent with `tools: { allow: ['read_file', 'search'] }` only sees those tools. Existing tool policy tests still pass (no `agentTools` = no change).
- **Risk**: LOW — additive filter stage. Existing tests cover stages 1 and 2. New tests cover stage 1.5.

### D8-10: Agent Lifecycle Hooks (Per-Turn Config Binding)

- **Status**: MISALIGNED → ALIGNED
- **Upstream**: `src/agents/pi-embedded-runner/run.ts:256+` (L3 per-turn model resolution), `src/agents/workspace.ts` (workspace setup per agent)
- **Parallx file**: MODIFY `src/openclaw/participants/openclawDefaultParticipant.ts`, MODIFY `src/openclaw/registerOpenclawParticipants.ts`
- **Action**:
  1. Per-turn config binding is implemented by D8-3 (`resolveAgentConfig` called at turn start). This capability is satisfied by that wiring — no separate lifecycle hook system needed.
  2. Registry initialization in `registerOpenclawParticipants.ts`:
     - Create `AgentRegistry` from `effectiveConfig.agent.agents` (or `DEFAULT_AGENT_CONFIGS`).
     - Pass registry to participants via their service interfaces.
  3. Add `agentRegistry?: IAgentRegistry` to `IDefaultParticipantServices` in `openclawTypes.ts`.
  4. The Parallx agent task model (`agentLifecycle.ts`, `agentTypes.ts`) is a valid Parallx-specific adaptation and remains untouched. It handles plan-step-execute for M46 autonomy, which is orthogonal to config-driven agent lifecycle.
- **Remove**: Nothing (the existing M46 task model stays).
- **Verify**: On each turn, `buildOpenclawTurnContext` reads fresh agent config from registry. If config changes mid-session (user edits in AI Settings), next turn picks up new values.
- **Risk**: LOW — registry is created once at registration time, passed through existing service plumbing.

---

## Phase 5: UI Surface

### D8-7: User-Configurable Agents

- **Status**: MISSING → ALIGNED
- **Upstream**: `src/commands/agents.config.ts:152-164` (`applyAgentConfig`), `ui/src/ui/views/agents.ts` (web UI agent management)
- **Parallx file**: MODIFY `src/aiSettings/ui/sections/agentSection.ts`, MODIFY `src/aiSettings/unifiedConfigTypes.ts`
- **Action**:
  1. Extend `AgentSection` to show an agent list beneath the existing max-iterations slider:
     - Display built-in agents (default, workspace, canvas) as read-only rows.
     - Allow user-defined agents: "Add Agent" button → inline row with name, model override dropdown, identity fields, tool restrictions.
     - Per-agent settings: model (dropdown from available models), temperature (slider), maxTokens (number), systemPromptOverlay (textarea), tools allow/deny (multi-select).
  2. Agent list changes write to `effectiveConfig.agent.agents` via `updateActivePreset({ agent: { agents: [...] } })`.
  3. Desktop adaptation: No CLI, no gateway API. Config surface is purely the AI Settings panel + `.parallx/ai-config.json` workspace override file (where users can also hand-edit agent configs).
  4. **Note**: Full UI implementation is lower priority. The type + registry + resolver layers (Phases 1-3) must land first. The UI can initially be minimal (list + per-agent model/maxIterations) and expand later.
- **Remove**: Nothing (max-iterations slider stays, UI is additive).
- **Verify**: User can add an agent, set its model to a different value than global, and see that agent's turns use the overridden model.
- **Risk**: MEDIUM — UI code is more complex. Deferred to after core types/registry/resolver are stable.

---

## Phase 6: Integration

### D8-4: Config-Driven Agent Definitions

- **Status**: MISSING → ALIGNED
- **Upstream**: `src/config/types.agents.ts:89-101` (`AgentsConfig`), `src/config/zod-schema.agent-runtime.ts:744-768` (`AgentEntrySchema`)
- **Parallx file**: No new files — this is achieved by Phases 1-3 combined.
- **Action**:
  1. With `IAgentConfig` (D8-1), `AgentRegistry` (D8-2), and config-to-runtime binding (D8-3), agents ARE config-driven:
     - Built-in agents = `DEFAULT_AGENT_CONFIGS` (code-defined data, not code-driven behavior).
     - User-defined agents = entries in `effectiveConfig.agent.agents` (pure data).
     - All agents share the same execution pipeline (`runOpenclawTurn`); behavior differs only through `IResolvedAgentConfig`.
  2. The three participant files (`openclawDefaultParticipant.ts`, `openclawWorkspaceParticipant.ts`, `openclawCanvasParticipant.ts`) remain as runtime surfaces. But their BEHAVIOR (model, tools, prompt) is now controlled by agent config, not by hardcoded logic.
  3. Desktop adaptation: Unlike upstream where agents are pure YAML entries, Parallx keeps participant classes because they serve UI composition purposes (different command sets, different context assembly logic for workspace/canvas surfaces). The config layer sits ABOVE the participant layer.
- **Remove**: Over time, hardcoded model/temperature/tools reads in workspace and canvas participants should also be routed through agent config resolution. But that's a follow-on task — this iteration focuses on the default participant.
- **Verify**: Adding a new `IAgentConfig` entry to the config makes it available via the registry without code changes. The default participant uses the resolved config for its turns.
- **Risk**: LOW — this capability is the emergent result of D8-1 + D8-2 + D8-3.

### D8-8: Subagent Preparation (Context Engine Integration)

- **Status**: MISALIGNED → ALIGNED
- **Upstream**: `src/context-engine/types.ts:194-210` (`prepareSubagentSpawn`, `onSubagentEnded`)
- **Parallx file**: MODIFY `src/openclaw/openclawContextEngine.ts`, MODIFY `src/openclaw/openclawSubagentSpawn.ts`
- **Action**:
  1. Add optional `prepareSubagentSpawn` and `onSubagentEnded` to `IOpenclawContextEngine`:
     ```ts
     prepareSubagentSpawn?(params: { agentId: string; reason?: string }): Promise<void>;
     onSubagentEnded?(params: { agentId: string }): Promise<void>;
     ```
  2. In `OpenclawContextEngine`, implement as no-ops initially (the context engine doesn't need to do anything yet, but the contract exists for future use).
  3. Wire `SubagentSpawner` to call `engine.prepareSubagentSpawn` before spawning and `engine.onSubagentEnded` after completion. This requires the spawner to have a reference to the context engine (passed via spawn params or constructor).
  4. Remove the comment in `openclawContextEngine.ts` line 37-43 that says "No subagents in Parallx" — subagents exist since M46 D5.
- **Remove**: The comment `prepareSubagentSpawn/onSubagentEnded — No subagents in Parallx` from the context engine interface (line 37-43).
- **Verify**: Spawning a subagent calls `prepareSubagentSpawn` on the engine. Subagent completion calls `onSubagentEnded`. No functional change (no-op implementations), but the contract is wired.
- **Risk**: LOW — no-op implementations, contract-only change. Functional logic deferred.

---

## File Change Summary

### New Files

| File | Phase | Purpose |
|------|-------|---------|
| `src/openclaw/agents/openclawAgentConfig.ts` | 1 | Type definitions: `IAgentConfig`, `IAgentToolsConfig`, `IAgentIdentityConfig`, `IAgentDefaults`, `IResolvedAgentConfig`, `DEFAULT_AGENT_CONFIGS` |
| `src/openclaw/agents/openclawAgentRegistry.ts` | 2 | `IAgentRegistry` interface + `AgentRegistry` class + `createAgentRegistry()` factory |
| `src/openclaw/agents/openclawAgentResolver.ts` | 3 | `resolveAgentConfig()` + `resolveDefaultAgentId()` |
| `tests/unit/openclawAgentConfig.test.ts` | 1 | Type sanity + `DEFAULT_AGENT_CONFIGS` validation |
| `tests/unit/openclawAgentRegistry.test.ts` | 2 | Registry register/get/getDefault/list/unregister |
| `tests/unit/openclawAgentResolver.test.ts` | 3 | Resolution merge order: global → defaults → per-agent |

### Modified Files

| File | Phase | Changes |
|------|-------|---------|
| `src/aiSettings/unifiedConfigTypes.ts` | 1 | Add `agents?: readonly IAgentConfig[]` and `agentDefaults?: IAgentDefaults` to `IUnifiedAgentConfig`. Import agent config types. |
| `src/openclaw/openclawTypes.ts` | 4 | Add `agentRegistry?: IAgentRegistry` to `IDefaultParticipantServices` |
| `src/openclaw/openclawAttempt.ts` | 3,4 | Add `readonly agentConfig?: IResolvedAgentConfig` to `IOpenclawTurnContext` |
| `src/openclaw/openclawSystemPrompt.ts` | 4 | Add `agentIdentity?` and `agentSystemPromptOverlay?` to `IOpenclawSystemPromptParams`. Insert agent identity section after global identity. |
| `src/openclaw/openclawPromptArtifacts.ts` | 4 | Thread `agentIdentity` and `agentSystemPromptOverlay` params to `buildOpenclawSystemPrompt` |
| `src/openclaw/openclawToolPolicy.ts` | 4 | Add `agentTools?: IAgentToolsConfig` param to `applyOpenclawToolPolicy`. Insert agent-specific filter step between profile and permission stages. |
| `src/openclaw/openclawToolState.ts` | 4 | Accept and pass `agentTools` to `applyOpenclawToolPolicy` |
| `src/openclaw/openclawContextEngine.ts` | 6 | Add `prepareSubagentSpawn` and `onSubagentEnded` to interface. Remove stale "no subagents" comment. |
| `src/openclaw/openclawSubagentSpawn.ts` | 6 | Wire spawner to call context engine subagent hooks |
| `src/openclaw/participants/openclawDefaultParticipant.ts` | 3,4 | In `buildOpenclawTurnContext`: resolve agent config from registry, pass to turn context. Replace direct config reads with resolved values. |
| `src/openclaw/registerOpenclawParticipants.ts` | 4 | Create `AgentRegistry` from config, pass to participant services. |
| `src/aiSettings/ui/sections/agentSection.ts` | 5 | Extend with agent list UI (deferred to after Phases 1-4 stable) |
| `tests/unit/openclawToolPolicy.test.ts` | 4 | Add test cases for agent-specific tool filtering stage |

---

## Cross-Cutting Concerns

### Import Chain
```
openclawAgentConfig.ts  (types only, no deps)
    ↓
openclawAgentRegistry.ts  (depends on config types)
    ↓
openclawAgentResolver.ts  (depends on registry + config types + unifiedConfigTypes)
    ↓
openclawDefaultParticipant.ts  (depends on resolver + registry)
registerOpenclawParticipants.ts  (depends on registry)
openclawToolPolicy.ts  (depends on config types for IAgentToolsConfig)
openclawSystemPrompt.ts  (depends on config types for IAgentIdentityConfig)
```

### Backward Compatibility
- When `agentConfig` is undefined on `IOpenclawTurnContext`, all existing code paths work exactly as before (global config fallback).
- When `agentTools` is undefined in `applyOpenclawToolPolicy`, the agent filter stage is skipped (existing behavior).
- When `agentIdentity` is undefined in `buildOpenclawSystemPrompt`, no agent section is inserted (existing behavior).
- All new fields are optional. Zero breaking changes to existing consumers.

### Platform Adaptations (vs. upstream)

| Upstream pattern | Parallx adaptation | Reason |
|-----------------|-------------------|--------|
| Agents are YAML config entries | Agents are `IAgentConfig` objects in unified config | Desktop app stores config in JSON, not YAML. Integrates with existing `IUnifiedAIConfigService`. |
| `resolveAgentConfig` reads from parsed YAML | `resolveAgentConfig` reads from `IAgentRegistry` + `IUnifiedAIConfig` | Same semantics, different data source. |
| `AgentEntrySchema` (Zod validation) | TypeScript interfaces (compile-time) | Desktop app loads config from trusted local files. Runtime validation deferred to UI layer. |
| Agents create workspace directories | No per-agent workspace dirs | Desktop single-workspace. Per-agent IDENTITY.md deferred (SOUL.md serves workspace-level personality). |
| CLI + Gateway API for agent CRUD | AI Settings panel only | Desktop GUI, no CLI needed. |
| Session-key-based agent routing | Participant ID → agent ID mapping | Desktop uses participant surfaces, not channel routing. |

---

## Test Plan

### Unit Tests (Phase 1-3, must pass before Phase 4)

1. **`openclawAgentConfig.test.ts`**
   - `DEFAULT_AGENT_CONFIGS` has 3 entries with correct IDs
   - Exactly one has `isDefault: true`
   - All have unique IDs

2. **`openclawAgentRegistry.test.ts`**
   - `register` adds an agent, `get` retrieves it
   - `getDefault` returns the default agent
   - `getDefault` falls back to first agent if none marked default
   - `unregister` removes an agent
   - `list` returns all agents, `listIds` returns all IDs
   - Duplicate ID `register` replaces existing

3. **`openclawAgentResolver.test.ts`**
   - Global config used when agent has no overrides
   - Agent defaults applied before per-agent overrides
   - Per-agent `model` overrides global model
   - Per-agent `temperature` overrides global temperature
   - Per-agent `tools.deny` merges with (not replaces) defaults
   - `resolveDefaultAgentId` returns `isDefault: true` agent
   - `resolveDefaultAgentId` falls back to first agent

### Unit Tests (Phase 4 additions)

4. **`openclawToolPolicy.test.ts`** (extend existing)
   - Agent deny list blocks tool on full profile
   - Agent allow list restricts to only listed tools
   - No `agentTools` = existing behavior unchanged
   - Agent deny + M11 never-allowed = both enforced

5. **`openclawSystemPrompt.test.ts`** (new or extend existing)
   - Agent identity section appears after global identity
   - Agent system prompt overlay appears in output
   - No agent identity = prompt unchanged

---

## Flagged Items

### NEEDS_UPSTREAM_VERIFICATION: None
All upstream references are cited from `D8_AGENT_CONFIGURATION_AUDIT.md` findings which read the actual upstream source files.

### Deferred to Iteration 2
- **Workspace/Canvas participant agent config wiring**: This iteration focuses on the default participant. Workspace and canvas participants have different context assembly logic that needs separate analysis.
- **Full agent management UI**: Phase 5 UI is outlined but detailed widget layout deferred.
- **Per-agent IDENTITY.md files**: Upstream pattern of per-agent workspace directories with IDENTITY.md. Desktop adaptation TBD — may use per-agent config field instead of filesystem.
- **Config file schema validation**: Upstream uses Zod schemas. Parallx defers runtime validation to UI input handling.
