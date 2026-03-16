import type { IChatTurnSemantics, WorkflowType } from '../chatTypes.js';

const CONVERSATIONAL_TURN_PATTERNS: readonly RegExp[] = [
  /^(?:hi|hello|hey|yo|sup|good morning|good afternoon|good evening)$/,
  /^(?:how are you|hows it going|how is it going|whats up|what is up)$/,
  /^(?:hi|hello|hey|yo|sup)\s+(?:how are you|hows it going|how is it going|whats up|what is up)$/,
  /^(?:who are you|what are you)$/,
  /^(?:thanks|thank you|thx|ok|okay|sounds good|got it|nice|cool)$/,
  /^(?:bye|goodbye|see you|see ya)$/,
];

const WORKSPACE_ROUTING_TERMS = /\b(file|files|document|documents|doc|docs|page|pages|note|notes|canvas|workspace|folder|folders|project|repo|repository|code|function|error|bug|test|build|commit|branch|source|sources|citation|cite|pdf|docx|xlsx|markdown|readme)\b/i;
const TASK_ROUTING_TERMS = /\b(read|open|search|find|summari[sz]e|explain|show|list|compare|quote|retrieve|look up|use|run|edit|write|change|delete|fix|debug|analy[sz]e|review|patch)\b/i;
const IN_SCOPE_DOMAIN_TERMS = /\b(insurance|policy|coverage|claim|claims|deductible|agent|adjuster|premium|liability|collision|comprehensive|uninsured|underinsured|medpay|roadside|accident|vehicle|car|auto|workspace|document|file|citation|source|context)\b/i;
const OFF_TOPIC_DOMAIN_TERMS = /\b(recipe|recipes|cook|cooking|bake|baking|cookie|cookies|chocolate|flour|sugar|oven|meal|restaurant|movie|movies|tv|television|song|songs|music|sports?|weather|vacation|travel|dating)\b/i;

function normalizeForRouting(text: string, apostropheReplacement = ' '): string {
  return text
    .toLowerCase()
    .trim()
    .replace(/[’']/g, apostropheReplacement)
    .replace(/[^a-z0-9\s']/g, ' ')
    .replace(/\s+/g, ' ');
}

function buildOffTopicRedirectAnswer(normalizedText: string): string | undefined {
  if (!normalizedText || normalizedText.length > 180) {
    return undefined;
  }

  if (WORKSPACE_ROUTING_TERMS.test(normalizedText) || TASK_ROUTING_TERMS.test(normalizedText) || IN_SCOPE_DOMAIN_TERMS.test(normalizedText)) {
    return undefined;
  }

  if (!OFF_TOPIC_DOMAIN_TERMS.test(normalizedText)) {
    return undefined;
  }

  return 'Sorry, I can help with the insurance policy, claims guidance, and other files in this workspace, but I cannot help with that off-topic request here.';
}

function buildProductSemanticsAnswer(normalizedText: string): string | undefined {
  if (
    normalizedText.includes('approve once')
    && normalizedText.includes('approve task')
    && /(difference|vs|versus|mean|means)/.test(normalizedText)
  ) {
    return [
      'Approve once allows only the current action to run.',
      'Approve task is broader: it allows the remaining approval-scoped actions in that task to continue without asking again each time.',
      'Use Approve once when you want tighter review. Use Approve task when you trust the remaining task scope and want fewer interruptions.',
    ].join(' ');
  }

  if (
    normalizedText.includes('outside the workspace')
    && /(blocked|what should i do next|what do i do next|what next|how do i recover)/.test(normalizedText)
  ) {
    return [
      'The task was blocked because it targeted something outside the active workspace boundary, so the agent stopped before taking that action.',
      'Retarget the task to a file or folder inside the current workspace, or narrow the instructions so the next action stays within an allowed target.',
      'After you fix the target, continue or retry the task.',
    ].join(' ');
  }

  if (
    /(delegated task|task)/.test(normalizedText)
    && /(recorded artifacts|artifacts)/.test(normalizedText)
    && /(what should i check next|what should i do next|what next|what do i check)/.test(normalizedText)
  ) {
    return [
      'Recorded artifacts tell you which workspace files the task changed or produced.',
      'Check those files first to confirm the result matches the goal and to decide whether a follow-up task is needed.',
      'If the artifacts look right, you can keep them. If not, launch a narrower follow-up task to correct or extend the work.',
    ].join(' ');
  }

  if (
    normalizedText.includes('trace')
    && /(task details|help me understand|tell me|mean|means|show)/.test(normalizedText)
  ) {
    return [
      'The trace shows the recent planning, approval, and execution events for a task in order.',
      'Use it to see what the agent tried, where it paused or was blocked, and which tool or step produced the latest outcome.',
      'It is most useful when you need to understand why a task stopped, what ran successfully, or what to retry next.',
    ].join(' ');
  }

  return undefined;
}

function isLikelyConversationalTurn(normalizedText: string, strippedApostropheText: string): boolean {
  if (!strippedApostropheText || strippedApostropheText.length > 80) {
    return false;
  }

  if (WORKSPACE_ROUTING_TERMS.test(strippedApostropheText) || TASK_ROUTING_TERMS.test(strippedApostropheText)) {
    return false;
  }

  const hasGreetingPrefix = /^(?:hi|hello|hey|yo|sup)\b/.test(strippedApostropheText);
  const hasShortSocialFollowUp = /\b(?:how are you|hows it going|how is it going|whats up|what is up)\b/.test(strippedApostropheText);
  if (hasGreetingPrefix && hasShortSocialFollowUp) {
    return true;
  }

  return CONVERSATIONAL_TURN_PATTERNS.some((pattern) => pattern.test(strippedApostropheText));
}

function isExplicitMemoryRecallTurn(normalizedText: string): boolean {
  if (!normalizedText) {
    return false;
  }

  if (/\btranscript\b|\bsession\s+transcript\b/.test(normalizedText)) {
    return false;
  }

  return /(last|previous|prior)\s+(conversation|chat|session)|what\s+do\s+you\s+remember|remember\s+about\s+(?:it|my|our)|recall\s+(?:my|our)\s+(?:last|previous|prior)/.test(normalizedText);
}

function isExplicitTranscriptRecallTurn(normalizedText: string): boolean {
  if (!normalizedText) {
    return false;
  }

  return /\btranscript\b|\bsession\s+history\b|\bchat\s+history\b|what\s+did\s+(?:i|we)\s+(?:say|discuss)|\b(?:last|previous|prior)\s+session\b/.test(normalizedText);
}

function isFileEnumerationTurn(normalizedText: string): boolean {
  if (!normalizedText || normalizedText.length > 200) {
    return false;
  }

  return /(?:what(?:'?s| is| are)\s+in\s+the\s+\w|how\s+many\s+files|list\s+(?:the\s+)?(?:files|contents)|show\s+(?:me\s+)?(?:the\s+)?(?:files|contents)\s+(?:in|of)|what(?:'?s| is)\s+in\s+(?:the\s+)?(?:my\s+)?workspace)/.test(normalizedText)
    && /\b(?:folder|directory|workspace|dir)\b/.test(normalizedText);
}

function isExhaustiveWorkspaceReviewTurn(normalizedText: string): boolean {
  if (!normalizedText) {
    return false;
  }

  const hasExhaustiveLanguage = /(?:each|every|all|for each)(?:\s+of)?(?:\s+the)?\s+(?:file|document|paper|guide|note|pdf|doc|docx|markdown)s?|one\s+(?:sentence|paragraph)\s+summary\s+(?:of|for)\s+(?:each|every|all|for each)(?:\s+of)?(?:\s+the)?\s+(?:file|document|paper|guide|note|pdf|doc|docx|markdown)s?|(?:provide|give|create|write)?\s*summary\s+(?:of|for)\s+(?:each|every|all|for each)(?:\s+of)?(?:\s+the)?\s+(?:file|document|paper|guide|note|pdf|doc|docx|markdown)s?|summari[sz]e\s+(?:each|every|all)(?:\s+of)?(?:\s+the)?\s+(?:file|document|paper|guide|note|pdf|doc|docx|markdown)s?|read\s+(?:each|every|all)(?:\s+of)?(?:\s+the)?\s+(?:file|document|paper|guide|note|pdf|doc|docx|markdown)s?/.test(normalizedText);
  const hasWorkspaceTarget = /\b(folder|directory|workspace|docs|documents|guides|papers|files)\b/.test(normalizedText);
  return hasExhaustiveLanguage && hasWorkspaceTarget;
}

const SUMMARY_VERBS = /\b(summari[sz]e|overview|describe|outline|recap|brief)\b/i;
const COMPARISON_CUES = /\b(compare|contrast|difference|differences|vs\.?|versus)\b/i;
const EXHAUSTIVE_CUES = /\b(every|all|each|complete|entire|full)\b/i;
const EXTRACTION_VERBS = /\b(extract|list|enumerate|find|identify|collect|gather|pull)\b/i;

function hasSummaryIntent(text: string): boolean {
  return SUMMARY_VERBS.test(text)
    || /\bsummary\b/i.test(text)
    || /\bone\s+(?:sentence|paragraph)\b/i.test(text);
}

function classifyWorkflowType(text: string, isExhaustive: boolean): WorkflowType {
  if (isExhaustive) {
    if (EXTRACTION_VERBS.test(text) && EXHAUSTIVE_CUES.test(text)) {
      return 'exhaustive-extraction';
    }
    return 'folder-summary';
  }

  if (COMPARISON_CUES.test(text)) {
    return 'comparative';
  }

  const entityMatches = text.match(/\b[A-Z][A-Za-z0-9 _&-]{2,60}\b/g) ?? [];
  const hasEntityRef = entityMatches.length > 0;
  const summaryIntent = hasSummaryIntent(text);

  if (hasEntityRef && summaryIntent && /\b(folder|directory|files)\b/i.test(text)) {
    return 'folder-summary';
  }

  if (hasEntityRef && summaryIntent) {
    return 'document-summary';
  }

  if (hasEntityRef && !SUMMARY_VERBS.test(text)) {
    return 'scoped-topic';
  }

  return 'generic-grounded';
}

export function analyzeChatTurnSemantics(text: string): IChatTurnSemantics {
  const normalizedText = normalizeForRouting(text);
  const strippedApostropheText = normalizeForRouting(text, '').replace(/'/g, '');
  const isFileEnumeration = isFileEnumerationTurn(normalizedText);
  const isExhaustiveWorkspaceReview = isExhaustiveWorkspaceReviewTurn(normalizedText);
  const workflowTypeHint = isFileEnumeration
    ? 'folder-summary'
    : classifyWorkflowType(text, isExhaustiveWorkspaceReview);

  return {
    rawText: text,
    normalizedText,
    strippedApostropheText,
    isConversational: isLikelyConversationalTurn(normalizedText, strippedApostropheText),
    isExplicitMemoryRecall: isExplicitMemoryRecallTurn(normalizedText),
    isExplicitTranscriptRecall: isExplicitTranscriptRecallTurn(normalizedText),
    isFileEnumeration,
    isExhaustiveWorkspaceReview,
    offTopicDirectAnswer: buildOffTopicRedirectAnswer(normalizedText),
    productSemanticsDirectAnswer: buildProductSemanticsAnswer(normalizeForRouting(text, "'")),
    workflowTypeHint,
    groundedCoverageModeHint: isFileEnumeration
      ? 'enumeration'
      : isExhaustiveWorkspaceReview
        ? 'exhaustive'
        : 'representative',
  };
}