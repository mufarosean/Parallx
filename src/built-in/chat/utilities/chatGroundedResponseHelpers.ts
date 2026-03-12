import type { IChatRequestResponsePair } from '../../../services/chatTypes.js';
import { extractSpecificCoverageFocusTerms } from './chatSpecificCoverageFocus.js';

export function buildDeterministicSessionSummary(
  history: readonly { request: { text: string } }[],
  currentRequestText: string,
): string {
  const userMessages = [...history.map((entry) => entry.request.text), currentRequestText]
    .map((text) => text.replace(/\s+/g, ' ').trim())
    .filter(Boolean)
    .slice(-3);

  if (userMessages.length === 0) {
    return '';
  }

  const sentences = userMessages.map((text) => /[.!?]$/.test(text) ? text : `${text}.`);
  const summary = sentences.join(' ');
  return summary.length <= 900 ? summary : `${summary.slice(0, 897).trimEnd()}...`;
}

function scoreExtractiveFallbackLine(line: string, queryTerms: string[]): number {
  let score = 0;
  const normalizedLine = line.toLowerCase();

  for (const term of queryTerms) {
    if (normalizedLine.includes(term)) {
      score += 2;
    }
  }
  if (/(\(\d{3}\)\s*\d{3}-\d{4}|\b\d{3}-\d{3}-\d{4}\b)/.test(line)) {
    score += 3;
  }
  if (/\b(?:call|contact|phone|email|hotline|deadline|within|before|after|hours?|days?|weeks?)\b/i.test(line)) {
    score += 2;
  }
  if (/\$\d|\b\d+%\b|\b\d+\s*(?:hours?|days?|weeks?|months?)\b/i.test(line)) {
    score += 2;
  }
  if (/^[-*]|^\d+\.|^\|/.test(line)) {
    score += 1;
  }
  if (/^#{1,6}\s/.test(line)) {
    score += 1;
  }

  return score;
}

export function buildExtractiveFallbackAnswer(query: string, retrievedContextText: string): string {
  if (!retrievedContextText || !retrievedContextText.includes('[Retrieved Context]')) {
    return '';
  }

  const content = retrievedContextText
    .replace(/^.*?\[Retrieved Context\]\s*/s, '')
    .trim();
  if (!content) {
    return '';
  }

  const queryTerms = query
    .toLowerCase()
    .replace(/[^a-z0-9\s]/g, ' ')
    .split(/\s+/)
    .filter((term) => term.length >= 3 && !['what', 'when', 'where', 'which', 'with', 'your', 'this', 'that', 'have'].includes(term));
  const normalizedQuery = query.toLowerCase();
  const queryNeeds = {
    contact: /\b(call|contact|phone|email|agent|who)\b/.test(normalizedQuery),
    deadline: /\b(deadline|within|when|hours?|days?|report)\b/.test(normalizedQuery),
    coverage: /\b(cover|coverage|policy|insurance|deductible|limit)\b/.test(normalizedQuery),
    action: /\b(step|steps|what should i do|how do i|how to|right now|first)\b/.test(normalizedQuery),
  };

  const scoredLines: Array<{ text: string; score: number; order: number; sectionOrder: number }> = [];
  const lines = content
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter((line) => line.length > 0);

  const sectionCandidates = new Map<number, Array<{ text: string; score: number; order: number }>>();
  const sectionScores = new Map<number, number>();

  let sectionOrder = -1;
  let activeHeadingScore = 0;

  const beginSection = () => {
    sectionOrder += 1;
    activeHeadingScore = 0;
  };

  beginSection();

  for (const [order, line] of lines.entries()) {
    if (/^\[\d+\]\s+Source:/i.test(line)) {
      beginSection();
      activeHeadingScore = scoreExtractiveFallbackLine(line, queryTerms);
      continue;
    }

    if (
      line === '[Retrieved Context]'
      || line === '---'
      || /^Path:/i.test(line)
      || /^\[Source:/i.test(line)
    ) {
      continue;
    }

    const baseScore = scoreExtractiveFallbackLine(line, queryTerms);
    let roleBonus = 0;
    if (queryNeeds.contact && /(\(\d{3}\)\s*\d{3}-\d{4}|\b\d{3}-\d{3}-\d{4}\b|\bcall\b|\bcontact\b|\bphone\b|\bagent\b|\bhotline\b|\bemail\b)/i.test(line)) {
      roleBonus += 4;
    }
    if (queryNeeds.deadline && /(\bwithin\b|\bdeadline\b|\b24 hours\b|\b72 hours\b|\b14 days\b|\breport to\b|\bfile within\b)/i.test(line)) {
      roleBonus += 4;
    }
    if (queryNeeds.coverage && /(\bcoverage\b|\bcovered\b|\bdeductible\b|\blimit\b|\bcollision\b|\bcomprehensive\b|\bliability\b|\buninsured\b|\bunderinsured\b|\bpolicy\b)/i.test(line)) {
      roleBonus += 4;
    }
    if (queryNeeds.action && (/^[-*]|^\d+\.|^#{1,6}\s/.test(line)) && /(\bcall\b|\bfile\b|\breport\b|\bexchange\b|\btake\b|\bget\b|\bdocument\b|\bcheck\b|\bmove\b|\bstop\b|\bcontact\b)/i.test(line)) {
      roleBonus += 3;
    }

    const isHeading = /^#{1,6}\s/.test(line);
    if (isHeading) {
      activeHeadingScore = Math.max(activeHeadingScore, baseScore + roleBonus);
    }

    let score = baseScore + roleBonus;
    if (activeHeadingScore > 0 && (/^[-*]|^\d+\.|^\|/.test(line) || /\*\*[^*]+\*\*/.test(line))) {
      score += Math.max(2, Math.min(4, activeHeadingScore));
    }
    if (score > 0) {
      scoredLines.push({ text: line, score, order, sectionOrder });
      const existingSection = sectionCandidates.get(sectionOrder) ?? [];
      existingSection.push({ text: line, score, order });
      sectionCandidates.set(sectionOrder, existingSection);
    }

    if (isHeading && baseScore === 0) {
      activeHeadingScore = 0;
    }
  }

  for (const [candidateSectionOrder, entries] of sectionCandidates) {
    const topEntries = [...entries]
      .sort((a, b) => b.score - a.score || a.order - b.order)
      .slice(0, 3);
    const totalScore = topEntries.reduce((sum, entry) => sum + entry.score, 0);
    sectionScores.set(candidateSectionOrder, totalScore);
  }

  const rankedSections = [...sectionScores.entries()]
    .sort((a, b) => b[1] - a[1] || a[0] - b[0]);
  const topSectionScore = rankedSections[0]?.[1] ?? 0;
  const selectedSectionOrders = rankedSections
    .filter(([, score]) => score >= Math.max(3, topSectionScore * 0.55))
    .slice(0, 2)
    .map(([candidateSectionOrder]) => candidateSectionOrder);

  const selected = selectedSectionOrders
    .flatMap((candidateSectionOrder) => {
      return [...(sectionCandidates.get(candidateSectionOrder) ?? [])]
        .sort((a, b) => b.score - a.score || a.order - b.order)
        .slice(0, 4)
        .sort((a, b) => a.order - b.order);
    })
    .filter((entry, index, array) => array.findIndex((candidate) => candidate.text === entry.text) === index)
    .slice(0, 6)
    .map((entry) => entry.text);

  if (selected.length === 0) {
    return '';
  }

  return [
    'Relevant details from retrieved context:',
    '',
    ...selected.map((line) => `- ${line.replace(/^[-*]\s*/, '')}`),
  ].join('\n');
}

export function assessEvidenceSufficiency(
  query: string,
  retrievedContextText: string,
  ragSources: readonly { uri: string; label: string; index?: number }[],
): { status: 'sufficient' | 'weak' | 'insufficient'; reasons: string[] } {
  const normalizedQuery = query.toLowerCase();
  const normalizedContext = retrievedContextText.toLowerCase();
  const queryTerms = query
    .toLowerCase()
    .replace(/[^a-z0-9\s]/g, ' ')
    .split(/\s+/)
    .filter((term) => term.length >= 3 && !['what', 'when', 'where', 'which', 'with', 'your', 'this', 'that', 'have', 'from', 'into'].includes(term));
  const matchedTerms = queryTerms.filter((term) => normalizedContext.includes(term));
  const uniqueMatchedTerms = [...new Set(matchedTerms)];
  const sectionCount = (retrievedContextText.match(/^\[\d+\]\s+Source:/gim) ?? []).length;
  const queryWordCount = query.split(/\s+/).filter(Boolean).length;
  const isHardQuestion =
    queryWordCount >= 12
    || /\b(and|then|after|compare|versus|vs\.?|workflow|steps|what should i do|what does .* cover)\b/i.test(normalizedQuery)
    || ((normalizedQuery.match(/\b(what|how|where|who|when|which)\b/g) ?? []).length >= 2);
  const specificCoverageFocusTerms = extractSpecificCoverageFocusTerms(normalizedQuery);

  const reasons: string[] = [];
  if (!retrievedContextText.trim() || ragSources.length === 0) {
    reasons.push('no-grounded-sources');
    return { status: 'insufficient', reasons };
  }

  if (uniqueMatchedTerms.length === 0) {
    reasons.push('no-query-term-overlap');
    return { status: 'insufficient', reasons };
  }

  if (
    specificCoverageFocusTerms.length > 0
    && specificCoverageFocusTerms.some((term) => !normalizedContext.includes(term))
  ) {
    reasons.push('specific-coverage-not-explicitly-supported');
  }

  if (isHardQuestion && ragSources.length < 2) {
    reasons.push('hard-query-low-source-coverage');
  }
  if (isHardQuestion && sectionCount < 2) {
    reasons.push('hard-query-low-section-coverage');
  }
  if (uniqueMatchedTerms.length < Math.min(isHardQuestion ? 3 : 2, queryTerms.length)) {
    reasons.push('limited-focus-overlap');
  }
  if (retrievedContextText.length < (isHardQuestion ? 400 : 120)) {
    reasons.push('thin-evidence-set');
  }

  if (reasons.includes('specific-coverage-not-explicitly-supported')) {
    return { status: 'insufficient', reasons };
  }

  if (reasons.length >= 2 || reasons.includes('hard-query-low-source-coverage')) {
    return {
      status: reasons.includes('no-query-term-overlap') ? 'insufficient' : 'weak',
      reasons,
    };
  }

  return { status: 'sufficient', reasons };
}

export function buildEvidenceResponseConstraint(
  query: string,
  evidenceAssessment: { status: 'sufficient' | 'weak' | 'insufficient'; reasons: string[] },
): string {
  const baseConstraint = evidenceAssessment.status === 'insufficient'
    ? 'Response Constraint: If the evidence stays insufficient, answer narrowly with caveats, ask a clarifying question, or state that more grounded evidence is needed.'
    : 'Response Constraint: Keep the answer narrow and explicitly grounded in the available evidence.';

  if (
    /\b(coverage|cover(?:ed|s)?|endorsement|rider)\b/i.test(query)
    && evidenceAssessment.reasons.includes('specific-coverage-not-explicitly-supported')
  ) {
    return `${baseConstraint} Do not infer that a specific coverage, peril, endorsement, or rider is included from a broader category. Only affirm it if the retrieved evidence names it explicitly; otherwise say the documents do not explicitly confirm it.`;
  }

  return baseConstraint;
}

export function buildFollowUpRetrievalQuery(
  query: string,
  history: readonly IChatRequestResponsePair[],
): string {
  const normalizedQuery = query.toLowerCase().replace(/[’']/g, ' ').trim();
  if (!normalizedQuery || normalizedQuery.includes('deductible') || history.length === 0) {
    return query;
  }

  const lastUserText = history[history.length - 1]?.request.text?.toLowerCase().replace(/[’']/g, ' ').trim();
  if (!lastUserText || !lastUserText.includes('deductible')) {
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

export function buildRetrieveAgainQuery(query: string, retrievedContextText: string): string | undefined {
  const queryTerms = query
    .toLowerCase()
    .replace(/[^a-z0-9\s]/g, ' ')
    .split(/\s+/)
    .filter((term) => term.length >= 3 && !['what', 'when', 'where', 'which', 'with', 'your', 'this', 'that', 'have', 'from', 'into'].includes(term));
  const normalizedContext = retrievedContextText.toLowerCase();
  const missingTerms = [...new Set(queryTerms.filter((term) => !normalizedContext.includes(term)))];
  const fallbackTerms = [...new Set(queryTerms)].slice(0, 6);

  const focusedTerms = (missingTerms.length >= 2 ? missingTerms : fallbackTerms).slice(0, 6);
  if (focusedTerms.length === 0) {
    return undefined;
  }

  const focusedQuery = focusedTerms.join(' ');
  return focusedQuery === query.trim().toLowerCase() ? undefined : focusedQuery;
}