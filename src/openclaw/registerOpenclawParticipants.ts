import type { IDisposable } from '../platform/lifecycle.js';
import type { IChatAgentService } from '../services/chatTypes.js';
import {
  buildOpenclawCanvasParticipantServices,
  buildOpenclawDefaultParticipantServices,
  buildOpenclawWorkspaceParticipantServices,
} from './openclawParticipantServices.js';
import { createOpenclawCanvasParticipant } from './participants/openclawCanvasParticipant.js';
import { createOpenclawDefaultParticipant } from './participants/openclawDefaultParticipant.js';
import { createOpenclawWorkspaceParticipant } from './participants/openclawWorkspaceParticipant.js';
import type {
  ICanvasParticipantServices,
  IDefaultParticipantServices,
  IWorkspaceParticipantServices,
} from './openclawTypes.js';
import { createAgentRegistry } from './agents/openclawAgentRegistry.js';
import { DEFAULT_AGENT_CONFIGS, type IAgentConfig } from './agents/openclawAgentConfig.js';
import type { IAgentConfigData } from '../aiSettings/unifiedConfigTypes.js';

/** Merge persisted agent definitions with built-in defaults.
 *  User modifications to built-in agents (same ID) override defaults. */
function hydrateAgentConfigs(persisted?: readonly IAgentConfigData[]): readonly IAgentConfig[] {
  if (!persisted?.length) return DEFAULT_AGENT_CONFIGS;
  const merged = new Map<string, IAgentConfig>();
  for (const builtin of DEFAULT_AGENT_CONFIGS) merged.set(builtin.id, builtin);
  for (const userDef of persisted) merged.set(userDef.id, userDef as IAgentConfig);
  return [...merged.values()];
}

export function registerOpenclawParticipants(options: {
  agentService: IChatAgentService;
  defaultParticipantServices: IDefaultParticipantServices;
  workspaceParticipantServices: IWorkspaceParticipantServices;
  canvasParticipantServices: ICanvasParticipantServices;
}): IDisposable[] {
  // Hydrate agent registry from config (persisted definitions override built-in defaults)
  const effectiveConfig = options.defaultParticipantServices.unifiedConfigService?.getEffectiveConfig();
  const agentConfigs = hydrateAgentConfigs(effectiveConfig?.agent?.agentDefinitions);
  const agentRegistry = createAgentRegistry(agentConfigs);

  const defaultParticipant = createOpenclawDefaultParticipant(buildOpenclawDefaultParticipantServices({
    ...options.defaultParticipantServices,
    agentRegistry,
  }));
  const workspaceParticipant = createOpenclawWorkspaceParticipant(buildOpenclawWorkspaceParticipantServices({
    ...options.workspaceParticipantServices,
  }));
  const canvasParticipant = createOpenclawCanvasParticipant(buildOpenclawCanvasParticipantServices({
    ...options.canvasParticipantServices,
  }));

  return [
    defaultParticipant,
    options.agentService.registerAgent(defaultParticipant),
    workspaceParticipant,
    options.agentService.registerAgent(workspaceParticipant),
    canvasParticipant,
    options.agentService.registerAgent(canvasParticipant),
  ];
}