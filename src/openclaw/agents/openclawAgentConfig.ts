/**
 * Agent configuration type definitions for the OpenClaw agent system.
 *
 * Upstream evidence:
 *   - src/config/types.agents.ts:68-101 (AgentConfig)
 *   - src/config/types.agents.ts:88-89 (AgentToolsConfig)
 *   - src/config/types.agent-defaults.ts (AgentDefaultsConfig)
 *   - src/agents/identity.ts:6-40 (IdentityConfig)
 *   - src/agents/agent-scope.ts:33-50 (ResolvedAgentConfig)
 *
 * Parallx adaptation:
 *   - Desktop simplification: no CLI agent management, no Docker
 *   - Three built-in agents matching existing participants
 */

// ---------------------------------------------------------------------------
// Per-agent tool allow/deny overrides
// Upstream: src/config/types.agents.ts:88-89 (AgentToolsConfig)
// ---------------------------------------------------------------------------

export interface IAgentToolsConfig {
  readonly allow?: readonly string[];
  readonly deny?: readonly string[];
}

// ---------------------------------------------------------------------------
// Per-agent identity/personality
// Upstream: src/agents/identity.ts:6-40 (IdentityConfig)
// ---------------------------------------------------------------------------

export interface IAgentIdentityConfig {
  readonly name?: string;
  readonly theme?: string;
  readonly emoji?: string;
}

// ---------------------------------------------------------------------------
// Single agent definition
// Upstream: src/config/types.agents.ts:68-101 (AgentConfig)
// ---------------------------------------------------------------------------

export interface IAgentConfig {
  readonly id: string;
  readonly name: string;
  readonly isDefault?: boolean;
  readonly surface?: 'default' | 'workspace' | 'canvas';
  readonly model?: string;
  readonly temperature?: number;
  readonly maxTokens?: number;
  readonly tools?: IAgentToolsConfig;
  readonly identity?: IAgentIdentityConfig;
  readonly systemPromptOverlay?: string;
  readonly maxIterations?: number;
  readonly autoRag?: boolean;
}

// ---------------------------------------------------------------------------
// Shared defaults applied to all agents
// Upstream: src/config/types.agent-defaults.ts (AgentDefaultsConfig)
// ---------------------------------------------------------------------------

export interface IAgentDefaults {
  readonly model?: string;
  readonly temperature?: number;
  readonly maxTokens?: number;
  readonly maxIterations?: number;
  readonly autoRag?: boolean;
  readonly tools?: IAgentToolsConfig;
}

// ---------------------------------------------------------------------------
// Fully resolved config (all fields guaranteed)
// Upstream: src/agents/agent-scope.ts:33-50 (ResolvedAgentConfig)
// ---------------------------------------------------------------------------

export interface IResolvedAgentConfig {
  readonly id: string;
  readonly name: string;
  readonly surface?: 'default' | 'workspace' | 'canvas';
  readonly model: string;
  readonly temperature: number;
  readonly maxTokens: number;
  readonly maxIterations: number;
  readonly autoRag: boolean;
  readonly tools: IAgentToolsConfig;
  readonly identity?: IAgentIdentityConfig;
  readonly systemPromptOverlay?: string;
}

// ---------------------------------------------------------------------------
// Built-in agent configs matching existing participants
// ---------------------------------------------------------------------------

export const DEFAULT_AGENT_CONFIGS: readonly IAgentConfig[] = [
  { id: 'default', name: 'Chat', isDefault: true, surface: 'default' },
  { id: 'workspace', name: 'Workspace', surface: 'workspace' },
  { id: 'canvas', name: 'Canvas', surface: 'canvas' },
];
