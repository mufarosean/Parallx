import type { IChatTurnSemantics } from '../chatTypes.js';

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

function normalizeForRouting(text: string, apostropheReplacement = ' '): string {
  return text
    .toLowerCase()
    .trim()
    .replace(/[’']/g, apostropheReplacement)
    .replace(/[^a-z0-9\s']/g, ' ')
    .replace(/\s+/g, ' ');
}

function isLikelyConversationalTurn(_normalizedText: string, strippedApostropheText: string): boolean {
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

  return /(last|previous|prior)\s+(conversation|chat|session)|what\s+do\s+you\s+remember|remember\s+about\s+(?:it|my|our)|recall\s+(?:my|our)\s+(?:last|previous|prior)|\bfrom memory\b|\bdurable memory\b|\bdaily memory\b|\bdurable preference\b|\bremembered preference\b|\bwhat durable preference\b|\bwhat preference is recorded\b|\bwhat .* recorded in daily memory\b|\bwhat was today(?: s|\'s)? .* from memory\b/.test(normalizedText);
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

export function analyzeChatTurnSemantics(text: string): IChatTurnSemantics {
  const normalizedText = normalizeForRouting(text);
  const strippedApostropheText = normalizeForRouting(text, '').replace(/'/g, '');
  const isFileEnumeration = isFileEnumerationTurn(normalizedText);

  return {
    rawText: text,
    normalizedText,
    strippedApostropheText,
    isConversational: isLikelyConversationalTurn(normalizedText, strippedApostropheText),
    isExplicitMemoryRecall: isExplicitMemoryRecallTurn(normalizedText),
    isExplicitTranscriptRecall: isExplicitTranscriptRecallTurn(normalizedText),
    isFileEnumeration,
  };
}