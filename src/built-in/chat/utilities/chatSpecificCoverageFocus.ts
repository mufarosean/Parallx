const EVIDENCE_STOP_WORDS = new Set([
  'what', 'when', 'where', 'which', 'with', 'your', 'this', 'that', 'have', 'from', 'into',
  'about', 'does', 'will', 'would', 'could', 'should', 'doesnt', 'dont', 'policy', 'insurance',
  'coverage', 'cover', 'covered', 'covers', 'endorsement', 'rider', 'include', 'included', 'including',
  'listed', 'mention', 'mentioned', 'explicitly', 'say', 'says', 'under', 'there', 'their', 'them',
  'mine', 'my', 'our', 'ours', 'the', 'and', 'for', 'against', 'damage',
]);

function extractSpecificCoverageRawPhrases(normalizedQuery: string): string[] {
  return [
    ...normalizedQuery.matchAll(/\b([a-z0-9-]+(?:\s+[a-z0-9-]+){0,2})\s+coverage\b/g),
    ...normalizedQuery.matchAll(/\bcoverage\s+for\s+([a-z0-9-]+(?:\s+[a-z0-9-]+){0,2})\b/g),
    ...normalizedQuery.matchAll(/\b([a-z0-9-]+(?:\s+[a-z0-9-]+){0,2})\s+endorsement\b/g),
    ...normalizedQuery.matchAll(/\b([a-z0-9-]+(?:\s+[a-z0-9-]+){0,2})\s+rider\b/g),
  ]
    .map((match) => match[1]?.trim() ?? '')
    .filter(Boolean);
}

export function extractSpecificCoverageFocusTerms(normalizedQuery: string): string[] {
  return [...new Set(
    extractSpecificCoverageRawPhrases(normalizedQuery).flatMap((phrase) => phrase
      .split(/\s+/)
      .filter((term) => term.length >= 4 && !EVIDENCE_STOP_WORDS.has(term))),
  )].slice(0, 3);
}

export function extractSpecificCoverageFocusPhrases(normalizedQuery: string): string[] {
  return [...new Set(extractSpecificCoverageRawPhrases(normalizedQuery)
    .map((phrase) => phrase
      .split(/\s+/)
      .filter((term) => term.length >= 4 && !EVIDENCE_STOP_WORDS.has(term))
      .join(' '))
    .filter(Boolean))].slice(0, 2);
}