import type { IChatTurnRoute } from '../chatTypes.js';

const CONVERSATIONAL_TURN_PATTERNS: readonly RegExp[] = [
  /^(?:hi|hello|hey|yo|sup|good morning|good afternoon|good evening)$/,
  /^(?:how are you|hows it going|how is it going|whats up|what is up)$/,
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

function isLikelyConversationalTurn(text: string): boolean {
  const normalized = normalizeForRouting(text, '').replace(/'/g, '');

  if (!normalized || normalized.length > 80) {
    return false;
  }

  if (WORKSPACE_ROUTING_TERMS.test(normalized) || TASK_ROUTING_TERMS.test(normalized)) {
    return false;
  }

  return CONVERSATIONAL_TURN_PATTERNS.some((pattern) => pattern.test(normalized));
}

function isExplicitMemoryRecallTurn(text: string): boolean {
  const normalized = normalizeForRouting(text);

  if (!normalized) {
    return false;
  }

  return /(last|previous|prior)\s+(conversation|chat|session)|what\s+do\s+you\s+remember|remember\s+about\s+(?:it|my|our)|recall\s+(?:my|our)\s+(?:last|previous|prior)/.test(normalized);
}

function buildOffTopicRedirectAnswer(text: string): string | undefined {
  const normalized = normalizeForRouting(text);

  if (!normalized || normalized.length > 180) {
    return undefined;
  }

  if (WORKSPACE_ROUTING_TERMS.test(normalized) || TASK_ROUTING_TERMS.test(normalized) || IN_SCOPE_DOMAIN_TERMS.test(normalized)) {
    return undefined;
  }

  if (!OFF_TOPIC_DOMAIN_TERMS.test(normalized)) {
    return undefined;
  }

  return 'Sorry, I can help with the insurance policy, claims guidance, and other files in this workspace, but I cannot help with that off-topic request here.';
}

function buildProductSemanticsAnswer(text: string): string | undefined {
  const normalized = normalizeForRouting(text, "'");

  if (
    normalized.includes('approve once')
    && normalized.includes('approve task')
    && /(difference|vs|versus|mean|means)/.test(normalized)
  ) {
    return [
      'Approve once allows only the current action to run.',
      'Approve task is broader: it allows the remaining approval-scoped actions in that task to continue without asking again each time.',
      'Use Approve once when you want tighter review. Use Approve task when you trust the remaining task scope and want fewer interruptions.',
    ].join(' ');
  }

  if (
    normalized.includes('outside the workspace')
    && /(blocked|what should i do next|what do i do next|what next|how do i recover)/.test(normalized)
  ) {
    return [
      'The task was blocked because it targeted something outside the active workspace boundary, so the agent stopped before taking that action.',
      'Retarget the task to a file or folder inside the current workspace, or narrow the instructions so the next action stays within an allowed target.',
      'After you fix the target, continue or retry the task.',
    ].join(' ');
  }

  if (
    /(delegated task|task)/.test(normalized)
    && /(recorded artifacts|artifacts)/.test(normalized)
    && /(what should i check next|what should i do next|what next|what do i check)/.test(normalized)
  ) {
    return [
      'Recorded artifacts tell you which workspace files the task changed or produced.',
      'Check those files first to confirm the result matches the goal and to decide whether a follow-up task is needed.',
      'If the artifacts look right, you can keep them. If not, launch a narrower follow-up task to correct or extend the work.',
    ].join(' ');
  }

  if (
    normalized.includes('trace')
    && /(task details|help me understand|tell me|mean|means|show)/.test(normalized)
  ) {
    return [
      'The trace shows the recent planning, approval, and execution events for a task in order.',
      'Use it to see what the agent tried, where it paused or was blocked, and which tool or step produced the latest outcome.',
      'It is most useful when you need to understand why a task stopped, what ran successfully, or what to retry next.',
    ].join(' ');
  }

  return undefined;
}

export function determineChatTurnRoute(
  text: string,
  options?: { hasActiveSlashCommand?: boolean },
): IChatTurnRoute {
  if (options?.hasActiveSlashCommand) {
    return {
      kind: 'grounded',
      reason: 'Slash command is active, so automatic direct-answer routing is bypassed.',
    };
  }

  const productSemanticsAnswer = buildProductSemanticsAnswer(text);
  if (productSemanticsAnswer) {
    return {
      kind: 'product-semantics',
      reason: 'Matched a product-semantics explanation that should bypass retrieval.',
      directAnswer: productSemanticsAnswer,
    };
  }

  const offTopicRedirectAnswer = buildOffTopicRedirectAnswer(text);
  if (offTopicRedirectAnswer) {
    return {
      kind: 'off-topic',
      reason: 'Matched an off-topic request pattern outside the workspace domain.',
      directAnswer: offTopicRedirectAnswer,
    };
  }

  if (isExplicitMemoryRecallTurn(text)) {
    return {
      kind: 'memory-recall',
      reason: 'Explicit prior-conversation recall should use memory without retrieval.',
    };
  }

  if (isLikelyConversationalTurn(text)) {
    return {
      kind: 'conversational',
      reason: 'Short conversational turn should avoid workspace retrieval and tool priming.',
    };
  }

  return {
    kind: 'grounded',
    reason: 'Default grounded route uses normal workspace-aware context planning.',
  };
}