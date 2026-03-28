/**
 * Agent config resolver — merges global, defaults, and per-agent config.
 *
 * Upstream evidence:
 *   - src/agents/agent-scope.ts:130-156 (resolveAgentConfig)
 *
 * Parallx adaptation:
 *   - Uses IGlobalConfigSlice instead of full upstream config object
 *   - Tools merge: deny lists combine, allow lists override
 */

import type { IAgentRegistry } from './openclawAgentRegistry.js';
import type { IAgentDefaults, IResolvedAgentConfig, IAgentToolsConfig } from './openclawAgentConfig.js';

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

/**
 * Global config shape — only the fields we need for merge.
 * Avoids importing the full IUnifiedAgentConfig.
 */
export interface IGlobalConfigSlice {
  readonly model: string;
  readonly temperature: number;
  readonly maxTokens: number;
  readonly maxIterations: number;
  readonly autoRag: boolean;
}

// ---------------------------------------------------------------------------
// Resolution
// ---------------------------------------------------------------------------

export function resolveAgentConfig(
  registry: IAgentRegistry,
  agentId: string,
  globalConfig: IGlobalConfigSlice,
  agentDefaults?: IAgentDefaults,
): IResolvedAgentConfig {
  const agent = registry.get(agentId);
  if (!agent) {
    // Unknown agent — return a resolved config using global defaults
    return {
      id: agentId,
      name: agentId,
      model: agentDefaults?.model ?? globalConfig.model,
      temperature: agentDefaults?.temperature ?? globalConfig.temperature,
      maxTokens: agentDefaults?.maxTokens ?? globalConfig.maxTokens,
      maxIterations: agentDefaults?.maxIterations ?? globalConfig.maxIterations,
      autoRag: agentDefaults?.autoRag ?? globalConfig.autoRag,
      tools: agentDefaults?.tools ?? {},
    };
  }

  // Merge: global → agentDefaults → per-agent (most specific wins)
  return {
    id: agent.id,
    name: agent.name,
    surface: agent.surface,
    model: agent.model ?? agentDefaults?.model ?? globalConfig.model,
    temperature: agent.temperature ?? agentDefaults?.temperature ?? globalConfig.temperature,
    maxTokens: agent.maxTokens ?? agentDefaults?.maxTokens ?? globalConfig.maxTokens,
    maxIterations: agent.maxIterations ?? agentDefaults?.maxIterations ?? globalConfig.maxIterations,
    autoRag: agent.autoRag ?? agentDefaults?.autoRag ?? globalConfig.autoRag,
    tools: mergeToolsConfig(agent.tools, agentDefaults?.tools),
    identity: agent.identity,
    systemPromptOverlay: agent.systemPromptOverlay,
  };
}

// ---------------------------------------------------------------------------
// Tools merge
// ---------------------------------------------------------------------------

function mergeToolsConfig(
  agentTools?: IAgentToolsConfig,
  defaultTools?: IAgentToolsConfig,
): IAgentToolsConfig {
  if (!agentTools && !defaultTools) {
    return {};
  }
  if (!agentTools) {
    return defaultTools ?? {};
  }
  if (!defaultTools) {
    return agentTools;
  }
  // Agent-specific overrides defaults — deny lists merge, allow lists override
  return {
    allow: agentTools.allow ?? defaultTools.allow,
    deny: [...(defaultTools.deny ?? []), ...(agentTools.deny ?? [])],
  };
}

// ---------------------------------------------------------------------------
// Default agent ID resolution
// ---------------------------------------------------------------------------

export function resolveDefaultAgentId(registry: IAgentRegistry): string {
  return registry.getDefault().id;
}
