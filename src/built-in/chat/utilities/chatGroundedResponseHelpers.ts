// chatGroundedResponseHelpers.ts — the retrieval query for a follow-up turn.
//
// When a question continues the previous one ("and what about theft?"), the
// words that ground it are in the last exchange, so the retrieval query borrows
// them. The chat service calls this before it searches the workspace.

import type { IChatRequestResponsePair } from '../../../services/chatTypes.js';

export function buildFollowUpRetrievalQuery(
  query: string,
  history: readonly IChatRequestResponsePair[],
): string {
  const normalizedQuery = query.toLowerCase().replace(/[’']/g, ' ').trim();
  if (!normalizedQuery || normalizedQuery.includes('deductible') || history.length === 0) {
    return query;
  }

  const lastUserText = history[history.length - 1]?.request.text?.toLowerCase().replace(/[’']/g, ' ').trim();
  if (!lastUserText) {
    return query;
  }

  const isShortFollowUp = /^(?:and\b|and what about\b|what about\b|how about\b|which one\b|which of (?:those|them)\b)/.test(normalizedQuery)
    || normalizedQuery.split(/\s+/).filter(Boolean).length <= 6;
  if (isShortFollowUp) {
    const carryoverTokens = lastUserText
      .replace(/[^a-z0-9\s]/g, ' ')
      .split(/\s+/)
      .filter((term) => term.length >= 4 && ![
        'name', 'three', 'books', 'book', 'workspace', 'about', 'cite', 'sources', 'source', 'which', 'language', 'culture', 'this',
      ].includes(term) && !normalizedQuery.includes(term))
      .slice(0, 3);
    if (carryoverTokens.length > 0) {
      return `${query.replace(/[?.!]+$/, '')} ${carryoverTokens.join(' ')}`;
    }
  }

  if (!lastUserText.includes('deductible')) {
    return query;
  }

  const mentionsCoverageType = /(collision|comprehensive|liability|uninsured|underinsured|medpay|medical|roadside|rental)/.test(normalizedQuery);
  const isLikelyFollowUp = /^(?:and\b|and what about\b|what about\b|how about\b)/.test(normalizedQuery)
    || normalizedQuery.split(/\s+/).filter(Boolean).length <= 5;
  if (!mentionsCoverageType || !isLikelyFollowUp) {
    return query;
  }

  return `${query.replace(/[?.!]+$/, '')} deductible`;
}
