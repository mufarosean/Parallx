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

export function registerOpenclawParticipants(options: {
  agentService: IChatAgentService;
  defaultParticipantServices: IDefaultParticipantServices;
  workspaceParticipantServices: IWorkspaceParticipantServices;
  canvasParticipantServices: ICanvasParticipantServices;
}): IDisposable[] {
  const defaultParticipant = createOpenclawDefaultParticipant(buildOpenclawDefaultParticipantServices({
    ...options.defaultParticipantServices,
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