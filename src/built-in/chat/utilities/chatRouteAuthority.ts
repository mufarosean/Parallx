import type {
  IChatRouteAuthorityDecision,
  IChatTurnRoute,
  ICoverageRecord,
} from '../chatTypes.js';

export function resolveChatRouteAuthority(
  route: IChatTurnRoute,
  coverageRecord: ICoverageRecord | undefined,
  options: { hasActiveSlashCommand: boolean; isRagReady: boolean },
): { turnRoute: IChatTurnRoute; authority: IChatRouteAuthorityDecision } {
  if (
    !options.hasActiveSlashCommand
    && options.isRagReady
    && route.kind === 'grounded'
    && (route.coverageMode === 'exhaustive' || route.coverageMode === 'enumeration')
    && coverageRecord
    && coverageRecord.level === 'none'
    && coverageRecord.totalTargets > 0
  ) {
    return {
      turnRoute: {
        kind: 'grounded',
        reason: 'Evidence authority correction: tool-first coverage produced no usable evidence, so the route falls back to representative retrieval.',
        coverageMode: 'representative',
        workflowType: 'generic-grounded',
      },
      authority: {
        action: 'corrected',
        reason: 'Coverage tracking reported zero covered targets for a tool-first route, so representative retrieval is now authoritative.',
      },
    };
  }

  return {
    turnRoute: route,
    authority: {
      action: 'preserved',
      reason: 'Evidence did not require changing the front-door route.',
    },
  };
}