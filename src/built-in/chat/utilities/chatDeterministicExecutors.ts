import { extractSpecificCoverageFocusPhrases } from './chatSpecificCoverageFocus.js';

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
    `I could not find ${focusPhrase} listed in your policy documents, so it is not explicitly covered in the materials I have.`,
    'The retrieved documents may mention broader categories, but they do not explicitly name that specific coverage.',
    'If you want protection for that peril, contact your agent about a separate endorsement or additional coverage.',
  ].join(' ');
}