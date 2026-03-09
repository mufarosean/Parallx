function extractSpecificCoverageFocusPhrases(normalizedQuery: string): string[] {
  const stopWords = new Set([
    'what', 'when', 'where', 'which', 'with', 'your', 'this', 'that', 'have', 'from', 'into',
    'about', 'does', 'will', 'would', 'could', 'should', 'doesnt', 'dont', 'policy', 'insurance',
    'coverage', 'cover', 'covered', 'covers', 'endorsement', 'rider', 'include', 'included', 'including',
    'listed', 'mention', 'mentioned', 'explicitly', 'say', 'says', 'under', 'there', 'their', 'them',
    'mine', 'my', 'our', 'ours', 'the', 'and', 'for', 'against', 'damage',
  ]);

  const rawPhrases = [
    ...normalizedQuery.matchAll(/\b([a-z0-9-]+(?:\s+[a-z0-9-]+){0,2})\s+coverage\b/g),
    ...normalizedQuery.matchAll(/\bcoverage\s+for\s+([a-z0-9-]+(?:\s+[a-z0-9-]+){0,2})\b/g),
    ...normalizedQuery.matchAll(/\b([a-z0-9-]+(?:\s+[a-z0-9-]+){0,2})\s+endorsement\b/g),
    ...normalizedQuery.matchAll(/\b([a-z0-9-]+(?:\s+[a-z0-9-]+){0,2})\s+rider\b/g),
  ]
    .map((match) => match[1]?.trim() ?? '')
    .filter(Boolean);

  return [...new Set(rawPhrases
    .map((phrase) => phrase
      .split(/\s+/)
      .filter((term) => term.length >= 4 && !stopWords.has(term))
      .join(' '))
    .filter(Boolean))].slice(0, 2);
}

export function buildDirectMemoryRecallAnswer(memoryContext: string): string | undefined {
  const cleaned = memoryContext
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter((line) => line.length > 0 && line !== '[Conversation Memory]' && line !== '---' && !/^Previous session \(/i.test(line))
    .join(' ')
    .replace(/\s+/g, ' ')
    .trim();

  if (!cleaned) {
    return undefined;
  }

  return `From our previous conversation, I remember: ${cleaned}`;
}

export function buildUnsupportedSpecificCoverageAnswer(
  query: string,
  evidenceAssessment: { status: 'sufficient' | 'weak' | 'insufficient'; reasons: string[] },
): string | undefined {
  if (!evidenceAssessment.reasons.includes('specific-coverage-not-explicitly-supported')) {
    return undefined;
  }

  const normalizedQuery = query.toLowerCase().replace(/[^a-z0-9\s]/g, ' ');
  const focusPhrase = extractSpecificCoverageFocusPhrases(normalizedQuery)[0];
  if (!focusPhrase) {
    return undefined;
  }

  return [
    `I do not see ${focusPhrase} explicitly listed in your policy documents, so I cannot confirm that it is included.`,
    'The retrieved documents may mention broader categories, but they do not explicitly name that specific coverage.',
    'If you want protection for that peril, contact your agent about a separate endorsement or additional coverage.',
  ].join(' ');
}