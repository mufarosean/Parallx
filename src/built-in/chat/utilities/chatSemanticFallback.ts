import type {
  IChatSemanticFallbackDecision,
  IChatTurnRoute,
  IChatTurnSemantics,
  IQueryScope,
} from '../chatTypes.js';

const BROAD_WORKSPACE_SUMMARY_PATTERNS: readonly RegExp[] = [
  /^(?:tell me about|walk me through|go through|summari[sz]e)\s+(?:everything|all(?: of)? (?:this|it|my stuff|my files|the files))(?:\s+in here)?[?.!]?$/i,
  /^what(?:'s| is)\s+in\s+my\s+files\??[?.!]?$/i,
  /^(?:go through|walk through)\s+all\s+my\s+stuff\.?$/i,
  /^(?:tell me|show me)\s+what(?:'s| is)\s+in\s+here[?.!]?$/i,
];

function isBroadWorkspaceSummaryPrompt(text: string): boolean {
  const trimmed = text.trim();
  if (!trimmed || trimmed.length > 120) {
    return false;
  }

  return BROAD_WORKSPACE_SUMMARY_PATTERNS.some((pattern) => pattern.test(trimmed));
}

export function resolveChatSemanticFallback(
  text: string,
  semantics: IChatTurnSemantics,
  route: IChatTurnRoute,
  queryScope: IQueryScope,
  options: { hasActiveSlashCommand: boolean },
): IChatSemanticFallbackDecision | undefined {
  if (options.hasActiveSlashCommand || route.kind !== 'grounded') {
    return undefined;
  }

  if (route.coverageMode && route.coverageMode !== 'representative') {
    return undefined;
  }

  if (route.workflowType && route.workflowType !== 'generic-grounded' && route.workflowType !== 'scoped-topic') {
    return undefined;
  }

  if (queryScope.level !== 'workspace') {
    return undefined;
  }

  if (
    semantics.isConversational
    || semantics.isExplicitMemoryRecall
    || semantics.isExplicitTranscriptRecall
    || semantics.isFileEnumeration
    || semantics.isExhaustiveWorkspaceReview
  ) {
    return undefined;
  }

  if (!isBroadWorkspaceSummaryPrompt(text)) {
    return undefined;
  }

  return {
    kind: 'broad-workspace-summary',
    confidence: 0.76,
    reason: 'Broad workspace-wide phrasing implies exhaustive multi-file coverage even though deterministic routing stayed generic.',
    workflowTypeHint: 'folder-summary',
    groundedCoverageModeHint: 'exhaustive',
  };
}

export function applyChatSemanticFallback(
  route: IChatTurnRoute,
  fallback: IChatSemanticFallbackDecision | undefined,
): IChatTurnRoute {
  if (!fallback) {
    return route;
  }

  return {
    ...route,
    reason: `${route.reason} Semantic fallback applied: ${fallback.reason}`,
    coverageMode: fallback.groundedCoverageModeHint,
    workflowType: fallback.workflowTypeHint,
  };
}