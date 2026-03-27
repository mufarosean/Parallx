/**
 * OpenClaw response post-processing — M1 + M6 gap closure.
 *
 * Handles citation validation, citation index remapping, attributable citation
 * filtering, and extractive fallback when the model returns an empty response.
 *
 * Upstream reference: built-in/chat/utilities/chatResponseValidator.ts
 * and chatGroundedResponseHelpers.ts — same algorithms adapted for OpenClaw's
 * pipeline which returns plain `markdown` + `ragSources` instead of a
 * mutable IChatResponseStream.
 */

// ---------------------------------------------------------------------------
// Citation validation (M1)
// ---------------------------------------------------------------------------

export interface IValidatedCitations {
  /** Markdown with citation indices remapped to match ragSources order. */
  readonly markdown: string;
  /** Citations actually referenced in the markdown — unreferenced ones filtered out. */
  readonly attributableSources: readonly { uri: string; label: string; index: number }[];
}

const CITATION_REF_RE = /\[(\d+)\]/g;

/**
 * Validate and clean up citations in the model's markdown response.
 *
 * 1. Detects all `[N]` references in the response text.
 * 2. When the model used arbitrary indices that don't match ragSources,
 *    attempt to remap them (by first-appearance order → sorted source order).
 * 3. Filter to only attributable citations (referenced in text).
 */
export function validateCitations(
  markdown: string,
  ragSources: readonly { uri: string; label: string; index: number }[],
): IValidatedCitations {
  if (!markdown || ragSources.length === 0) {
    return { markdown, attributableSources: [] };
  }

  // Collect all [N] references from the text
  const validIndices = new Set(ragSources.map(s => s.index));
  const referencedIndices: number[] = [];
  const seen = new Set<number>();
  let match: RegExpExecArray | null;

  CITATION_REF_RE.lastIndex = 0;
  while ((match = CITATION_REF_RE.exec(markdown)) !== null) {
    const idx = parseInt(match[1], 10);
    if (!seen.has(idx)) {
      seen.add(idx);
      referencedIndices.push(idx);
    }
  }

  if (referencedIndices.length === 0) {
    return { markdown, attributableSources: [] };
  }

  // Check for index mismatch — try to remap
  let remappedMarkdown = markdown;
  const unmatchedRefs = referencedIndices.filter(idx => !validIndices.has(idx));
  if (unmatchedRefs.length > 0 && referencedIndices.length === ragSources.length) {
    const sortedSources = [...ragSources].sort((a, b) => a.index - b.index);
    const remap = new Map<number, number>();
    for (let i = 0; i < referencedIndices.length; i++) {
      remap.set(referencedIndices[i], sortedSources[i].index);
    }
    remappedMarkdown = markdown.replace(CITATION_REF_RE, (_, num: string) => {
      const mapped = remap.get(parseInt(num, 10));
      return mapped != null ? `[${mapped}]` : `[${num}]`;
    });
  }

  // Filter to attributable citations (only those referenced in final text)
  CITATION_REF_RE.lastIndex = 0;
  const finalRefs = new Set<number>();
  while ((match = CITATION_REF_RE.exec(remappedMarkdown)) !== null) {
    finalRefs.add(parseInt(match[1], 10));
  }
  const attributableSources = ragSources.filter(s => finalRefs.has(s.index));

  return { markdown: remappedMarkdown, attributableSources };
}

// ---------------------------------------------------------------------------
// Extractive fallback (M6)
// ---------------------------------------------------------------------------

/**
 * When the model returns empty/unusable markdown but we have retrieved context,
 * extract the most relevant bullet points directly from the context text.
 *
 * Upstream reference: chatGroundedResponseHelpers.buildExtractiveFallbackAnswer.
 */
export function buildExtractiveFallback(query: string, retrievedContextText: string): string {
  if (!retrievedContextText || !retrievedContextText.includes('[Retrieved Context]')) {
    return '';
  }

  const content = retrievedContextText.replace(/^.*?\[Retrieved Context\]\s*/s, '').trim();
  if (!content) {
    return '';
  }

  const queryTerms = query
    .toLowerCase()
    .replace(/[^a-z0-9\s]/g, ' ')
    .split(/\s+/)
    .filter(t => t.length >= 3 && !STOP_WORDS.has(t));

  const normalizedQuery = query.toLowerCase();
  const queryNeeds = {
    contact: /\b(call|contact|phone|email|agent|who)\b/.test(normalizedQuery),
    deadline: /\b(deadline|within|when|hours?|days?|report)\b/.test(normalizedQuery),
    coverage: /\b(cover|coverage|policy|insurance|deductible|limit)\b/.test(normalizedQuery),
    action: /\b(step|steps|what should i do|how do i|how to|right now|first)\b/.test(normalizedQuery),
  };

  const lines = content.split(/\r?\n/).map(l => l.trim()).filter(Boolean);

  // Score each line
  type ScoredLine = { text: string; score: number; order: number; section: number };
  const scored: ScoredLine[] = [];
  const sectionLines = new Map<number, ScoredLine[]>();
  let section = 0;
  let headingBoost = 0;

  for (const [order, line] of lines.entries()) {
    if (/^\[\d+\]\s+Source:/i.test(line)) {
      section++;
      headingBoost = scoreLine(line, queryTerms);
      continue;
    }
    if (line === '[Retrieved Context]' || line === '---' || /^Path:/i.test(line) || /^\[Source:/i.test(line)) {
      continue;
    }

    let score = scoreLine(line, queryTerms);
    score += roleBonus(line, queryNeeds);
    if (/^#{1,6}\s/.test(line)) {
      headingBoost = Math.max(headingBoost, score);
    }
    if (headingBoost > 0 && (/^[-*]|^\d+\.|^\|/.test(line) || /\*\*[^*]+\*\*/.test(line))) {
      score += Math.max(2, Math.min(4, headingBoost));
    }
    if (/^#{1,6}\s/.test(line) && scoreLine(line, queryTerms) === 0) {
      headingBoost = 0;
    }

    if (score > 0) {
      const entry: ScoredLine = { text: line, score, order, section };
      scored.push(entry);
      const bucket = sectionLines.get(section) ?? [];
      bucket.push(entry);
      sectionLines.set(section, bucket);
    }
  }

  // Rank sections, pick top 2
  const sectionScores = new Map<number, number>();
  for (const [sec, entries] of sectionLines) {
    const topN = [...entries].sort((a, b) => b.score - a.score).slice(0, 3);
    sectionScores.set(sec, topN.reduce((sum, e) => sum + e.score, 0));
  }
  const ranked = [...sectionScores.entries()].sort((a, b) => b[1] - a[1]);
  const topScore = ranked[0]?.[1] ?? 0;
  const selectedSections = ranked
    .filter(([, s]) => s >= Math.max(3, topScore * 0.55))
    .slice(0, 2)
    .map(([sec]) => sec);

  const selected = selectedSections
    .flatMap(sec => [...(sectionLines.get(sec) ?? [])]
      .sort((a, b) => b.score - a.score || a.order - b.order)
      .slice(0, 4)
      .sort((a, b) => a.order - b.order))
    .filter((e, i, arr) => arr.findIndex(x => x.text === e.text) === i)
    .slice(0, 6)
    .map(e => e.text);

  if (selected.length === 0) {
    return '';
  }

  return [
    'Relevant details from retrieved context:',
    '',
    ...selected.map(line => `- ${line.replace(/^[-*]\s*/, '')}`),
  ].join('\n');
}

// ---------------------------------------------------------------------------
// Evidence assessment (M5 / M6 support)
// ---------------------------------------------------------------------------

/**
 * Assess whether retrieved context is sufficient, weak, or insufficient.
 */
export function assessEvidence(
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
    .filter(t => t.length >= 3 && !STOP_WORDS_EXTENDED.has(t));

  const matchedTerms = [...new Set(queryTerms.filter(t => normalizedContext.includes(t)))];
  const sectionCount = (retrievedContextText.match(/^\[\d+\]\s+Source:/gim) ?? []).length;
  const wordCount = query.split(/\s+/).filter(Boolean).length;
  const isHard = wordCount >= 12
    || /\b(and|then|after|compare|versus|vs\.?|workflow|steps|what should i do|what does .* cover)\b/i.test(normalizedQuery)
    || ((normalizedQuery.match(/\b(what|how|where|who|when|which)\b/g) ?? []).length >= 2);

  const reasons: string[] = [];

  if (!retrievedContextText.trim() || ragSources.length === 0) {
    return { status: 'insufficient', reasons: ['no-grounded-sources'] };
  }
  if (matchedTerms.length === 0) {
    return { status: 'insufficient', reasons: ['no-query-term-overlap'] };
  }

  // Specific coverage gap detection
  const coverageTerms = extractCoverageFocusTerms(normalizedQuery);
  if (coverageTerms.length > 0 && coverageTerms.some(t => !normalizedContext.includes(t))) {
    reasons.push('specific-coverage-not-explicitly-supported');
  }
  if (isHard && ragSources.length < 2) reasons.push('hard-query-low-source-coverage');
  if (isHard && sectionCount < 2) reasons.push('hard-query-low-section-coverage');
  if (matchedTerms.length < Math.min(isHard ? 3 : 2, queryTerms.length)) reasons.push('limited-focus-overlap');
  if (retrievedContextText.length < (isHard ? 400 : 120)) reasons.push('thin-evidence-set');

  if (reasons.includes('specific-coverage-not-explicitly-supported')) {
    return { status: 'insufficient', reasons };
  }
  if (reasons.length >= 2 || reasons.includes('hard-query-low-source-coverage')) {
    return { status: reasons.includes('no-query-term-overlap') ? 'insufficient' : 'weak', reasons };
  }
  return { status: 'sufficient', reasons };
}

/**
 * Build a constraint string for the model prompt when evidence is weak/insufficient.
 */
export function buildEvidenceConstraint(
  query: string,
  assessment: { status: string; reasons: string[] },
): string {
  const base = assessment.status === 'insufficient'
    ? 'Response Constraint: If the evidence stays insufficient, answer narrowly with caveats, ask a clarifying question, or state that more grounded evidence is needed.'
    : 'Response Constraint: Keep the answer narrow and explicitly grounded in the available evidence.';

  if (
    /\b(coverage|cover(?:ed|s)?|endorsement|rider)\b/i.test(query)
    && assessment.reasons.includes('specific-coverage-not-explicitly-supported')
  ) {
    return `${base} Do not infer that a specific coverage, peril, endorsement, or rider is included from a broader category. Only affirm it if the retrieved evidence names it explicitly; otherwise say the documents do not explicitly confirm it.`;
  }
  return base;
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

const STOP_WORDS = new Set(['what', 'when', 'where', 'which', 'with', 'your', 'this', 'that', 'have']);
const STOP_WORDS_EXTENDED = new Set([...STOP_WORDS, 'from', 'into']);

function scoreLine(line: string, queryTerms: string[]): number {
  let score = 0;
  const lower = line.toLowerCase();
  for (const term of queryTerms) {
    if (lower.includes(term)) score += 2;
  }
  if (/(\(\d{3}\)\s*\d{3}-\d{4}|\b\d{3}-\d{3}-\d{4}\b)/.test(line)) score += 3;
  if (/\b(?:call|contact|phone|email|hotline|deadline|within|before|after|hours?|days?|weeks?)\b/i.test(line)) score += 2;
  if (/\$\d|\b\d+%\b|\b\d+\s*(?:hours?|days?|weeks?|months?)\b/i.test(line)) score += 2;
  if (/^[-*]|^\d+\.|^\|/.test(line)) score += 1;
  if (/^#{1,6}\s/.test(line)) score += 1;
  return score;
}

function roleBonus(
  line: string,
  needs: { contact: boolean; deadline: boolean; coverage: boolean; action: boolean },
): number {
  let bonus = 0;
  if (needs.contact && /(\(\d{3}\)\s*\d{3}-\d{4}|\b\d{3}-\d{3}-\d{4}\b|\bcall\b|\bcontact\b|\bphone\b|\bagent\b|\bhotline\b|\bemail\b)/i.test(line)) bonus += 4;
  if (needs.deadline && /(\bwithin\b|\bdeadline\b|\b24 hours\b|\b72 hours\b|\b14 days\b|\breport to\b|\bfile within\b)/i.test(line)) bonus += 4;
  if (needs.coverage && /(\bcoverage\b|\bcovered\b|\bdeductible\b|\blimit\b|\bcollision\b|\bcomprehensive\b|\bliability\b|\buninsured\b|\bunderinsured\b|\bpolicy\b)/i.test(line)) bonus += 4;
  if (needs.action && /^[-*]|^\d+\.|^#{1,6}\s/.test(line) && /(\bcall\b|\bfile\b|\breport\b|\bexchange\b|\btake\b|\bget\b|\bdocument\b|\bcheck\b|\bmove\b|\bstop\b|\bcontact\b)/i.test(line)) bonus += 3;
  return bonus;
}

/**
 * Extract domain-specific coverage terms from the query.
 * Upstream reference: chatSpecificCoverageFocus.ts.
 */
function extractCoverageFocusTerms(normalizedQuery: string): string[] {
  const patterns = [
    /\b(collision\s+coverage|comprehensive\s+coverage|liability\s+coverage)\b/g,
    /\b(uninsured\s+motorist|underinsured\s+motorist)\b/g,
    /\b(medical\s+payments?|medpay|med\s+pay)\b/g,
    /\b(rental\s+(?:car\s+)?reimbursement|roadside\s+assistance|towing)\b/g,
    /\b(gap\s+(?:insurance|coverage)|new\s+car\s+replacement)\b/g,
    /\b(personal\s+injury\s+protection|pip)\b/g,
  ];
  const terms: string[] = [];
  for (const re of patterns) {
    re.lastIndex = 0;
    let m: RegExpExecArray | null;
    while ((m = re.exec(normalizedQuery)) !== null) {
      terms.push(m[1].toLowerCase());
    }
  }
  return terms;
}
