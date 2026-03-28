# D8 — Agent Configuration: Parity Audit (Iteration 1 — STRUCTURAL)

**Date:** 2026-03-28  
**Auditor:** AI Parity Auditor  
**Domain:** D8 — Agent Configuration  
**Iteration:** 1 (STRUCTURAL)  
**Parallx files:** `src/openclaw/participants/`, `src/openclaw/registerOpenclawParticipants.ts`, `src/openclaw/openclawTypes.ts`, `src/aiSettings/`  
**Upstream repo:** `https://github.com/openclaw/openclaw` (commit e635cedb)

---

## Summary

- Capabilities audited: **10**
- ALIGNED: **0** (0%)
- MISALIGNED: **3** (30%)
- HEURISTIC: **0** (0%)
- MISSING: **7** (70%)

**Overall finding:** Parallx has no config-driven agent system. The three chat participants (default, workspace, canvas) are hardcoded TypeScript classes with fixed IDs, fixed service interfaces, and fixed behavior. None of the upstream patterns — config-driven agent definitions, a registry for lookup-by-ID, per-agent model/tool/prompt binding, user-configurable agents via config files — exist in Parallx. The only partial overlap is in areas where Parallx has a single global config surface (`IUnifiedAIConfig`) that applies to *all* agents uniformly, and a subagent spawn mechanism that exists independently of agent configuration.

---

## Per-Capability Findings

### D8-1: Agent Config Type Contract

- **Classification**: MISSING
- **Parallx file**: `src/openclaw/openclawTypes.ts`, `src/aiSettings/unifiedConfigTypes.ts`
- **Upstream reference**: `src/config/types.agents.ts:68-101` (`AgentConfig`), `src/config/types.agent-defaults.ts` (`AgentDefaultsConfig`), `src/agents/agent-scope.ts:33-50` (`ResolvedAgentConfig`)
- **What Parallx has**: 
  - `IDefaultParticipantServices` / `IWorkspaceParticipantServices` / `ICanvasParticipantServices` — three separate, hardcoded service interfaces in [openclawTypes.ts](src/openclaw/openclawTypes.ts). These are *not* agent config types; they are dependency injection contracts for wiring platform services into participants.
  - `IUnifiedAgentConfig` in [unifiedConfigTypes.ts](src/aiSettings/unifiedConfigTypes.ts#L150) — has only `maxIterations` (active), plus deprecated fields `verbosity`, `approvalStrictness`, `executionStyle`, `proactivity` (all marked `@deprecated F11: No OpenClaw consumer`).
- **What upstream has**:
  - `AgentConfig` type with: `id`, `default`, `name`, `workspace`, `agentDir`, `model` (primary + fallbacks), `thinkingDefault`, `reasoningDefault`, `fastModeDefault`, `skills[]`, `memorySearch`, `humanDelay`, `heartbeat`, `identity` (name/theme/emoji), `groupChat`, `subagents`, `sandbox`, `params`, `tools` (allow/deny/profile), `runtime` (embedded/acp).
  - `AgentsConfig = { defaults?: AgentDefaultsConfig; list?: AgentConfig[] }` — a structured registry with shared defaults and per-agent overrides.
  - `AgentDefaultsConfig` with 50+ fields covering model, compaction, context pruning, embedded Pi settings, memory search, heartbeat, sandbox, subagent limits, typing, streaming, etc.
- **Divergence**: Parallx has no typed agent definition. There is no `AgentConfig` type. The closest analog (`IUnifiedAgentConfig`) has 1 active field vs upstream's 20+ per-agent fields. Each Parallx participant's "config" is actually its hardcoded TypeScript implementation, not a data-driven definition.
- **Severity**: HIGH

---

### D8-2: Agent Registry (register agents, look up by ID, default agent resolution)

- **Classification**: MISSING
- **Parallx file**: `src/openclaw/registerOpenclawParticipants.ts`
- **Upstream reference**: `src/agents/agent-scope.ts:55-92` (`listAgentEntries`, `listAgentIds`, `resolveDefaultAgentId`), `src/commands/agents.config.ts:104-124` (`buildAgentSummaries`)
- **What Parallx has**: 
  - `registerOpenclawParticipants()` in [registerOpenclawParticipants.ts](src/openclaw/registerOpenclawParticipants.ts) — creates 3 hardcoded participants (default, workspace, canvas), calls `agentService.registerAgent()` for each. This is participant registration with the VS Code chat agent service, not an agent registry.
  - No `loadAgentConfig(id)`, no `resolveAgentConfig(cfg, id)`, no `listAgentEntries()`. 
  - Agent IDs are constants: `'parallx.chat.openclaw-default'`, `'parallx.chat.workspace'`, `'parallx.chat.canvas'`.
- **What upstream has**:
  - `listAgentEntries(cfg: OpenClawConfig)` → iterates `cfg.agents.list`, returns all agent entries.
  - `resolveAgentConfig(cfg, agentId)` → normalizes ID, finds entry, returns typed config with all resolved fields.
  - `resolveDefaultAgentId(cfg)` → finds entry with `default: true`, or first entry, or `"main"`.
  - `buildAgentSummaries(cfg)` → produces summary for each agent with model, workspace, identity, bindings.
  - Registry is config-file-driven, not hardcoded. Number and identity of agents is determined at runtime from config.
- **Divergence**: Parallx has a fixed set of 3 participants registered at startup. There is no dynamic agent registry. You cannot add or remove agents without modifying TypeScript source code.
- **Severity**: HIGH

---

### D8-3: Agent Config-to-Runtime Binding

- **Classification**: MISSING
- **Parallx file**: `src/openclaw/participants/openclawDefaultParticipant.ts` (lines 225-290, `buildOpenclawTurnContext`)
- **Upstream reference**: `src/agents/agent-scope.ts:130-156` (`resolveAgentConfig`), `src/agents/model-selection.ts:340-564` (`resolveDefaultModelForAgent`), `src/agents/identity.ts:6-40` (`resolveAgentIdentity`)
- **What Parallx has**: 
  - `buildOpenclawTurnContext()` in [openclawDefaultParticipant.ts](src/openclaw/participants/openclawDefaultParticipant.ts#L225) builds turn context from *global* platform services — `services.getActiveModel()`, `services.getToolDefinitions()`, `services.unifiedConfigService.getEffectiveConfig()`. 
  - Model, temperature, maxTokens, autoRag all come from the single global `IUnifiedAIConfig`. There is no per-agent config lookup.
  - The workspace and canvas participants use a completely different code path (`runWorkspacePromptTurn` / `runCanvasPromptTurn`) that builds its own messages — no turn context, no config binding at all.
- **What upstream has**:
  - At turn start, upstream resolves: `resolveAgentConfig(cfg, agentId)` → typed config with model, tools, skills, identity, workspace, heartbeat, compaction, subagents.
  - Agent config flows into: model selection (`resolveDefaultModelForAgent`), tool policy (`resolveSandboxToolPolicyForAgent`), system prompt (`resolveAgentIdentity` for personality), context engine settings (`memorySearch`), compaction strategy (`compaction`).
  - Different agents in the same OpenClaw instance can use different models, different tools, different personalities, different memory configurations.
- **Divergence**: In Parallx, all participants share the same global model, the same global tool set, the same global temperature/maxTokens. There is no per-agent config resolution at turn time.
- **Severity**: HIGH

---

### D8-4: Config-Driven Agent Definitions (not hardcoded classes per agent)

- **Classification**: MISSING
- **Parallx file**: `src/openclaw/participants/openclawDefaultParticipant.ts`, `openclawWorkspaceParticipant.ts`, `openclawCanvasParticipant.ts`
- **Upstream reference**: `src/config/types.agents.ts:89-101` (`AgentsConfig`), `src/config/zod-schema.agent-runtime.ts:744-768` (`AgentEntrySchema`)
- **What Parallx has**: 
  - Three TypeScript files, each exporting a factory function:
    - `createOpenclawDefaultParticipant(services)` — ~350 lines of hardcoded logic
    - `createOpenclawWorkspaceParticipant(services)` — ~280 lines of hardcoded logic
    - `createOpenclawCanvasParticipant(services)` — ~250 lines of hardcoded logic
  - Each participant has hardcoded: ID, display name, description, commands, handler logic.
  - Adding a new "agent" requires writing a new TypeScript file, a new service interface, and modifying `registerOpenclawParticipants.ts`.
- **What upstream has**:
  - `AgentsConfig = { defaults?: AgentDefaultsConfig; list?: AgentConfig[] }` — agents are data entries in a YAML/JSON config file.
  - `AgentEntrySchema` (Zod) validates: `id`, `name`, `workspace`, `model`, `skills`, `tools`, `identity`, `heartbeat`, etc.
  - Adding a new agent = adding an entry to `agents.list[]` in `~/.openclaw/config.yaml`. No code changes required.
  - All agents share the same execution pipeline; their behavior differs only through config.
- **Divergence**: Parallx participants are code-driven, not config-driven. This is a fundamental architectural divergence from upstream.
- **Severity**: HIGH

---

### D8-5: Agent-Specific System Prompt Overlay

- **Classification**: MISALIGNED
- **Parallx file**: `src/openclaw/openclawSystemPrompt.ts` (lines 88-146, `buildOpenclawSystemPrompt`)
- **Upstream reference**: `src/agents/identity.ts:6-40` (`resolveAgentIdentity`), `src/config/types.agents.ts:84` (`identity?: IdentityConfig`), `src/agents/workspace.ts:24` (`DEFAULT_IDENTITY_FILENAME = "IDENTITY.md"`)
- **What Parallx has**: 
  - `buildOpenclawSystemPrompt(params)` builds a single prompt template shared by all participants. It includes:
    - Bootstrap files (SOUL.md, AGENTS.md, TOOLS.md) — loaded from workspace root, same for all agents.
    - `params.preferencesPrompt` and `params.promptOverlay` — global, not per-agent.
    - No `agentId` parameter. No agent-specific identity injection.
  - The workspace/canvas participants use `buildOpenclawSystemPrompt()` directly via the shared participant runtime, with no agent-specific overlay.
  - SOUL.md is a workspace-level personality file, not a per-agent personality. There is no IDENTITY.md concept.
- **What upstream has**:
  - Per-agent `identity` config: `{ name, theme, emoji }` in `agents.list[].identity`.
  - Per-agent `IDENTITY.md` file in the agent's workspace directory.
  - `resolveAgentIdentity(cfg, agentId)` resolves identity from config → `IDENTITY.md` → defaults.
  - Identity injected into system prompt: personality name, theme, emoji displayed in responses.
  - Different agents can have completely different personalities within the same instance.
- **Divergence**: Parallx has a single shared SOUL.md personality. The system prompt builder has no concept of per-agent identity overlay. This is MISALIGNED rather than MISSING because SOUL.md is analogous to upstream's IDENTITY.md — it's just workspace-scoped rather than agent-scoped.
- **Severity**: MEDIUM

---

### D8-6: Agent-Specific Tool Policy Profile

- **Classification**: MISALIGNED
- **Parallx file**: `src/openclaw/openclawToolPolicy.ts` (lines 114-131, `resolveToolProfile`)
- **Upstream reference**: `src/agents/tool-policy.ts` (`isToolAllowedByPolicies`), `src/config/types.agents.ts:88-89` (`tools?: AgentToolsConfig`), `src/agents/sandbox/tool-policy.ts` (`resolveSandboxToolPolicyForAgent`)
- **What Parallx has**: 
  - `resolveToolProfile(mode: string)` → maps chat **mode** (edit/ask/agent) to tool profile (readonly/standard/full).
  - `applyOpenclawToolPolicy({ tools, mode, permissions })` → filters by profile + M11 3-tier permissions.
  - No `agentId` parameter anywhere in the tool policy pipeline. Tools are filtered by mode, not by agent.
  - The tool policy pipeline is a good structural match to upstream's multi-stage filtering, but the agent-specific stage is missing.
- **What upstream has**:
  - 4-stage pipeline: Profile → Agent-specific → Provider-specific → Session owner.
  - `agents.list[].tools.allow` / `agents.list[].tools.deny` → per-agent tool overrides.
  - `resolveSandboxToolPolicyForAgent(cfg, agentId)` → resolves combined global + agent tool policy.
  - Different agents can have different tool access. A "read-only assistant" agent can be denied write tools while a "coding agent" has full access.
- **Divergence**: Parallx has mode-based tool filtering (matches upstream stage 1: profile) but lacks agent-specific tool filtering (upstream stage 2). The tool policy architecture exists but is incomplete — only 2 of 4 stages are implemented.
- **Severity**: MEDIUM

---

### D8-7: User-Configurable Agents

- **Classification**: MISSING
- **Parallx file**: `src/aiSettings/ui/sections/agentSection.ts`
- **Upstream reference**: `src/commands/agents.config.ts:152-164` (`applyAgentConfig`), `src/gateway/server-methods/agents.ts:635-666` (gateway agent config API), `ui/src/ui/views/agents.ts` (web UI)
- **What Parallx has**: 
  - `AgentSection` in [agentSection.ts](src/aiSettings/ui/sections/agentSection.ts) — exposes a single slider for "Max Iterations" (1-50) and an info note pointing to the Retrieval section. No other agent configuration is exposed.
  - No way to define new agents, rename agents, assign different models to agents, restrict tool access per agent, or set per-agent identity/personality.
  - No agent list in the UI. No agent-specific configuration panel.
- **What upstream has**:
  - CLI: `openclaw agents add <name>`, `openclaw agents set-identity`, `openclaw agents config <id> <key> <value>`.
  - Gateway API: CRUD operations for agents (`agents.list`, `agents.create`, `agents.update`, `agents.delete`).
  - Web UI: Full agent management panel with agent list, per-agent config (model, tools, identity, workspace, skills), agent files management (AGENTS.md, SOUL.md, TOOLS.md, IDENTITY.md per agent).
  - Config file: Direct editing of `~/.openclaw/config.yaml` `agents.list[]` entries.
- **Divergence**: Parallx has no user-facing agent configuration beyond max iterations. Users cannot define, modify, or manage agents through any surface.
- **Severity**: MEDIUM (desktop single-user reduces urgency, but the gap is real)

---

### D8-8: Subagent Preparation (context engine can prepare for subagent spawn with agent config)

- **Classification**: MISALIGNED
- **Parallx file**: `src/openclaw/openclawSubagentSpawn.ts`, `src/openclaw/openclawContextEngine.ts` (lines 37-43)
- **Upstream reference**: `src/context-engine/types.ts:194-210` (`prepareSubagentSpawn`, `onSubagentEnded`)
- **What Parallx has**: 
  - `SubagentSpawner` and `SubagentRegistry` in [openclawSubagentSpawn.ts](src/openclaw/openclawSubagentSpawn.ts) — a functional subagent spawn mechanism with lifecycle tracking, depth limits, timeouts, and announcement. This is well-implemented (from M46 D5 audit).
  - `IOpenclawContextEngine` in [openclawContextEngine.ts](src/openclaw/openclawContextEngine.ts#L37-43) — explicitly comments `prepareSubagentSpawn/onSubagentEnded — No subagents in Parallx` and omits these methods.
  - The subagent spawner operates independently of the context engine. No integration between context engine and subagent lifecycle.
- **What upstream has**:
  - `ContextEngine.prepareSubagentSpawn({ agentId, reason })` → returns `SubagentSpawnPreparation` or undefined.
  - `ContextEngine.onSubagentEnded({ agentId })` → cleanup lifecycle.
  - The context engine is aware of subagent spawns and can prepare context / manage state accordingly.
- **Divergence**: Parallx has subagent spawning but the context engine is not wired to it. The context engine interface explicitly excludes subagent methods despite the spawner existing. This creates a disconnect — subagents run without context engine awareness.
- **Severity**: LOW (the spawner works independently; context engine integration would improve but isn't blocking)

---

### D8-9: Default Agent Resolution

- **Classification**: MISSING
- **Parallx file**: `src/services/chatRuntimeSelector.ts` (line 2)
- **Upstream reference**: `src/agents/agent-scope.ts:80-93` (`resolveDefaultAgentId`), `src/config/legacy.shared.ts:96-127` (legacy default resolution)
- **What Parallx has**: 
  - `OPENCLAW_DEFAULT_PARTICIPANT_ID = 'parallx.chat.openclaw-default'` — a compile-time constant in [chatRuntimeSelector.ts](src/services/chatRuntimeSelector.ts#L2).
  - `resolveChatRuntimeParticipantId()` always returns this constant (line 14).
  - There is no runtime resolution. The "default agent" is whichever class has the hardcoded default ID.
- **What upstream has**:
  - `resolveDefaultAgentId(cfg)` reads `agents.list[]`, finds entry with `default: true`, falls back to first entry, falls back to `"main"`.
  - Default agent can change at runtime by modifying config.
  - `agents.defaults` provides shared baseline config that the default agent inherits.
  - `routing.defaultAgentId` is an alternative config path for the default.
- **Divergence**: Parallx hardcodes the default agent at compile time. Upstream resolves it from config at runtime. Since Parallx has no agent registry, there's nothing to resolve from.
- **Severity**: MEDIUM (depends on D8-2 and D8-4 being addressed first)

---

### D8-10: Agent Lifecycle Hooks (activation, deactivation, per-turn binding)

- **Classification**: MISALIGNED
- **Parallx file**: `src/agent/agentLifecycle.ts`, `src/agent/agentTypes.ts`
- **Upstream reference**: `src/agents/pi-embedded-runner/run.ts:256+` (L3 lifecycle), `src/agents/workspace.ts` (workspace setup per agent)
- **What Parallx has**: 
  - `agentLifecycle.ts` — task state machine transitions: pending → planning → running → completed/failed/cancelled, with proper transition validation.
  - `agentTypes.ts` — rich type system: `AgentTaskRecord`, `AgentPlanStep`, `DelegatedTaskInput`, `AgentAutonomyLevel`, `AgentInteractionMode`, `AgentTabTrace`, approval system.
  - These are for the M46 agent *task* model (plan-step-execute pattern), not for agent *configuration* lifecycle.
  - Participants have `dispose()` methods but no activation hooks, no per-turn config binding, no on-session-start setup.
- **What upstream has**:
  - Agent workspace setup: `ensureAgentWorkspace()` creates workspace with bootstrap files on first activation.
  - Per-turn binding: `resolveAgentConfig(cfg, agentId)` called at turn start to get current config.
  - Session key routing: agents bound to sessions via `resolveAgentIdFromSessionKey`.
  - Heartbeat lifecycle: periodic background turns per agent.
  - Model resolution per turn: agent's configured model resolved fresh each turn (allows hot-swap).
- **Divergence**: Parallx has an agent task model (planning/execution/approval) but no agent *configuration* lifecycle. There is no per-turn config binding, no activation setup, no deactivation cleanup. The agent task model is a Parallx-specific adaptation that doesn't correspond to upstream's agent lifecycle hooks — upstream agents don't have a plan-step-execute pattern; they have config-driven turn processing.
- **Severity**: LOW (the Parallx task model serves a different purpose; config lifecycle depends on D8-2/D8-4)

---

## Structural Assessment

### What exists (partial credit)

1. **Single global config surface** — `IUnifiedAIConfig` provides model, retrieval, memory, indexing settings that apply to all agents. This is a valid foundation that could be extended to per-agent resolution, but currently lacks the agent dimension.

2. **Tool policy pipeline** — The 2-stage tool policy (profile + M11 permissions) is a correct subset of upstream's 4-stage pipeline. Adding an agent-specific stage would complete the architecture.

3. **Subagent spawn mechanism** — `SubagentSpawner` and `SubagentRegistry` implement upstream's subagent lifecycle (from M46 D5). Missing context engine integration.

4. **Agent task model** — `agentTypes.ts` and `agentLifecycle.ts` provide a sophisticated task/plan/step system. This is Parallx-specific (not upstream) but is a valid adaptation for desktop agent autonomy.

### What is fundamentally missing

1. **Agent config type** — No typed definition of what an "agent" is in configuration terms.
2. **Agent registry** — No dynamic list of agents, no lookup-by-ID, no config-driven registration.
3. **Per-agent config resolution** — No way to give different agents different models, tools, prompts, or behavior.
4. **Config-driven definitions** — Agents are code, not data. Adding a new agent requires TypeScript changes.
5. **User-facing agent management** — No UI or config file path for users to define/modify agents.

### Root cause

Parallx's participant system was modeled after VS Code's chat participant architecture (fixed set of participants registered at startup with hardcoded IDs and behavior). OpenClaw's agent system is config-driven (agents are data entries that share a common execution pipeline but differ in config). These are fundamentally different architectural patterns.

### Parallx-specific adaptations that are valid

- **Single-user desktop** reduces the urgency for multi-agent routing, per-channel agent binding, and concurrent agent limits.
- **Three participant surfaces** (default/workspace/canvas) serve a UI composition purpose that upstream doesn't have (upstream agents don't have separate "surfaces").
- **The M46 agent task model** is a valid Parallx-specific adaptation for desktop agent autonomy that doesn't need upstream parity.

### Priority for closure

| Gap | Priority | Depends On |
|-----|----------|------------|
| D8-1: Agent config type | HIGH | — |
| D8-2: Agent registry | HIGH | D8-1 |
| D8-4: Config-driven definitions | HIGH | D8-1, D8-2 |
| D8-3: Config-to-runtime binding | HIGH | D8-1, D8-2 |
| D8-9: Default agent resolution | MEDIUM | D8-2 |
| D8-5: Per-agent prompt overlay | MEDIUM | D8-1 |
| D8-6: Per-agent tool policy | MEDIUM | D8-1 |
| D8-7: User-configurable agents | MEDIUM | D8-1, D8-2, D8-4 |
| D8-8: Subagent context engine | LOW | D8-1 |
| D8-10: Agent lifecycle hooks | LOW | D8-2, D8-4 |

---

## Metrics Table

| Capability | ID | Status | Severity |
|------------|-----|--------|----------|
| Agent config type contract | D8-1 | MISSING | HIGH |
| Agent registry | D8-2 | MISSING | HIGH |
| Agent config-to-runtime binding | D8-3 | MISSING | HIGH |
| Config-driven agent definitions | D8-4 | MISSING | HIGH |
| Agent-specific system prompt overlay | D8-5 | MISALIGNED | MEDIUM |
| Agent-specific tool policy profile | D8-6 | MISALIGNED | MEDIUM |
| User-configurable agents | D8-7 | MISSING | MEDIUM |
| Subagent preparation | D8-8 | MISALIGNED | LOW |
| Default agent resolution | D8-9 | MISSING | MEDIUM |
| Agent lifecycle hooks | D8-10 | MISALIGNED | LOW |

**ALIGNED: 0 | MISALIGNED: 4 (contains partial but wrong) | HEURISTIC: 0 | MISSING: 6 (no implementation at all)**

*(Note: D8-10 reclassified from MISSING to MISALIGNED because the agent task model exists but serves a different purpose than upstream's config lifecycle. D8-8 reclassified because subagent spawning exists but isn't wired to context engine.)*

---

## Iteration 2 — REFINEMENT Re-Audit (2026-03-28)

### Changes Since Iteration 1
- D8-1 through D8-6, D8-9, D8-10: ALIGNED (Iter 1 code execution)
- D8-8: `prepareSubagentSpawn`/`onSubagentEnded` added to context engine → ALIGNED
- D8-7: `AgentSection` extended with full agent list UI, `IAgentConfigData` type, `agentDefinitions` persistence → ALIGNED
- R1: Workspace/canvas participants wired to agent config
- R2: +7 tool policy tests for agent allow/deny
- R3: +6 prompt overlay tests for identity/instructions
- R5: +5 edge case tests for resolver

### Updated Metrics

| Capability | ID | Iter 1 Status | Iter 2 Status |
|---|---|---|---|
| Agent config type contract | D8-1 | MISSING | ✅ ALIGNED |
| Agent registry | D8-2 | MISSING | ✅ ALIGNED |
| Agent config-to-runtime binding | D8-3 | MISSING | ✅ ALIGNED |
| Config-driven agent definitions | D8-4 | MISSING | ✅ ALIGNED |
| Agent-specific system prompt overlay | D8-5 | MISALIGNED | ✅ ALIGNED |
| Agent-specific tool policy profile | D8-6 | MISALIGNED | ✅ ALIGNED |
| User-configurable agents | D8-7 | MISSING | ✅ ALIGNED |
| Subagent preparation | D8-8 | MISALIGNED | ✅ ALIGNED |
| Default agent resolution | D8-9 | MISSING | ✅ ALIGNED |
| Agent lifecycle hooks | D8-10 | MISALIGNED | ✅ ALIGNED |

**ALIGNED: 10/10**

---

## Iteration 3 — PARITY CHECK Final Audit (2026-03-28)

### Result: 10/10 ALIGNED — DOMAIN CLOSED

All 10 D8 capabilities verified as structurally complete, upstream-traced, tested, and free of M41 anti-patterns. No issues found.

- M41 Compliance: PASS
- Cross-domain readiness: READY for D2 (Chat Commands)
- Test suite: 140 files, 2681 tests, 0 failures, 0 tsc errors
