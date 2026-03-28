/**
 * Agent registry — in-memory store of agent configurations.
 *
 * Upstream evidence:
 *   - src/agents/agent-scope.ts:55-92 (listAgentEntries, resolveDefaultAgentId)
 *   - src/commands/agents.config.ts:104-124 (buildAgentSummaries)
 *
 * Parallx adaptation:
 *   - Simple Map-based registry, no file-system persistence
 *   - Initialized from DEFAULT_AGENT_CONFIGS at registration time
 */

import type { IAgentConfig } from './openclawAgentConfig.js';

// ---------------------------------------------------------------------------
// Interface
// ---------------------------------------------------------------------------

export interface IAgentRegistry {
  register(config: IAgentConfig): void;
  unregister(id: string): boolean;
  get(id: string): IAgentConfig | undefined;
  getDefault(): IAgentConfig;
  list(): readonly IAgentConfig[];
  listIds(): readonly string[];
}

// ---------------------------------------------------------------------------
// Implementation
// ---------------------------------------------------------------------------

export class AgentRegistry implements IAgentRegistry {
  private readonly _agents = new Map<string, IAgentConfig>();

  constructor(initialConfigs?: readonly IAgentConfig[]) {
    if (initialConfigs) {
      for (const config of initialConfigs) {
        this._agents.set(config.id, config);
      }
    }
  }

  register(config: IAgentConfig): void {
    this._agents.set(config.id, config);
  }

  unregister(id: string): boolean {
    return this._agents.delete(id);
  }

  get(id: string): IAgentConfig | undefined {
    return this._agents.get(id);
  }

  getDefault(): IAgentConfig {
    // Upstream pattern: resolveDefaultAgentId — find isDefault:true, or first, or throw
    for (const agent of this._agents.values()) {
      if (agent.isDefault) {
        return agent;
      }
    }
    const first = this._agents.values().next();
    if (!first.done) {
      return first.value;
    }
    throw new Error('AgentRegistry: no agents registered');
  }

  list(): readonly IAgentConfig[] {
    return [...this._agents.values()];
  }

  listIds(): readonly string[] {
    return [...this._agents.keys()];
  }
}

// ---------------------------------------------------------------------------
// Factory
// ---------------------------------------------------------------------------

export function createAgentRegistry(configs?: readonly IAgentConfig[]): IAgentRegistry {
  return new AgentRegistry(configs);
}
