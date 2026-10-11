// openclawParticipantServices.ts — the service bags the chat hands its participants.
//
// The chat activation builds one bag per participant (default, workspace,
// canvas) from its own services. Each bag is the services interface the
// participant declares (the workspace and canvas ones without the two
// members only the default participant fills), so the types are aliases and
// the builders only copy the shape. They stay as functions so the activation
// has one place to call for each participant.

import type {
  ICanvasParticipantServices,
  IDefaultParticipantServices,
  IWorkspaceParticipantServices,
} from './openclawTypes.js';

export type IOpenclawDefaultParticipantAdapterDeps = IDefaultParticipantServices;
export type IOpenclawWorkspaceParticipantAdapterDeps = Omit<IWorkspaceParticipantServices, 'unifiedConfigService' | 'agentRegistry'>;
export type IOpenclawCanvasParticipantAdapterDeps = Omit<ICanvasParticipantServices, 'unifiedConfigService' | 'agentRegistry'>;

export function buildOpenclawDefaultParticipantServices(deps: IOpenclawDefaultParticipantAdapterDeps): IDefaultParticipantServices {
  return { ...deps };
}

export function buildOpenclawWorkspaceParticipantServices(deps: IOpenclawWorkspaceParticipantAdapterDeps): IWorkspaceParticipantServices {
  return { ...deps };
}

export function buildOpenclawCanvasParticipantServices(deps: IOpenclawCanvasParticipantAdapterDeps): ICanvasParticipantServices {
  return { ...deps };
}
