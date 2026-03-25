import type {
  IChatRouteAuthorityDecision,
  IChatTurnRoute,
  ICoverageRecord,
} from '../chatTypes.js';

type EvidenceStatus = 'sufficient' | 'weak' | 'insufficient';

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

export function refineChatRouteAuthorityWithEvidence(
  route: IChatTurnRoute,
  coverageRecord: ICoverageRecord | undefined,
  evidenceStatus: EvidenceStatus,
  options: { hasActiveSlashCommand: boolean; isRagReady: boolean },
): { turnRoute: IChatTurnRoute; authority: IChatRouteAuthorityDecision } {
  if (
    !options.hasActiveSlashCommand
    && options.isRagReady
    && route.kind === 'grounded'
    && (route.coverageMode === 'exhaustive' || route.coverageMode === 'enumeration')
    && coverageRecord
    && coverageRecord.totalTargets > 0
    && (coverageRecord.level === 'partial' || coverageRecord.level === 'minimal' || coverageRecord.level === 'none')
    && evidenceStatus !== 'sufficient'
  ) {
    return {
      turnRoute: {
        kind: 'grounded',
        reason: 'Evidence authority correction: tool-first coverage stayed insufficient after planning, so the route falls back to representative retrieval.',
        coverageMode: 'representative',
      },
      authority: {
        action: 'corrected',
        reason: 'Coverage was incomplete and the resulting evidence remained weak or insufficient, so representative retrieval is now authoritative.',
      },
    };
  }

  return {
    turnRoute: route,
    authority: {
      action: 'preserved',
      reason: 'Post-planning evidence did not require changing the route.',
    },
  };
}