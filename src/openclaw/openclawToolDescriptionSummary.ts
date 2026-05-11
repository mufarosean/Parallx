/**
 * Tool description summarization for the system prompt catalog.
 *
 * Upstream evidence (raw.githubusercontent.com/openclaw/openclaw/main):
 *   - src/agents/tool-description-summary.ts
 *       - summarizeToolDescriptionText(): strips structured JSON/schema/action
 *         blocks then takes the first sentence/paragraph.
 *       - truncateSummary(): sentence-boundary cut, default 120 chars.
 *
 * Why this exists in Parallx:
 *   Built-in tool `description` fields contain the full operating manual
 *   intended for the tool-schema sent to the model API. Pasting them into
 *   the prompt's flat tool catalog bloats the prompt and confuses small
 *   models. Upstream addresses this by maintaining a short `displaySummary`
 *   per tool AND summarizing long descriptions at prompt-build time.
 *
 *   This module is the second half of that pattern: when a tool lacks a
 *   `displaySummary`, the prompt builder calls `summarizeToolDescriptionText`
 *   to derive one from `description`.
 */

const DEFAULT_MAX_CHARS = 120;

/**
 * Lines that mark the start of a structured documentation block which
 * should NOT bleed into the short summary. These mirror the markers used
 * in upstream tool descriptions (JSON schemas, action lists, parameter
 * tables) which are useful in the tool schema but noise in the catalog.
 *
 * Upstream parity: tool-description-summary.ts STRUCTURED_LINE_PREFIXES.
 */
const STRUCTURED_LINE_PREFIXES: readonly string[] = [
  '{',
  '[',
  '- ',
  '* ',
  'ACTIONS:',
  'JOB SCHEMA:',
  'PARAMETERS:',
  'EXAMPLES:',
  'NOTES:',
  'IMPORTANT:',
];

/**
 * Strip lines that look like the start of a structured doc block.
 * Stops as soon as the first such line is encountered — everything before
 * it is treated as the human prose preamble.
 *
 * Upstream parity: tool-description-summary.ts stripStructuredBlocks().
 */
function stripStructuredBlocks(text: string): string {
  const lines = text.split(/\r?\n/);
  const out: string[] = [];
  for (const rawLine of lines) {
    const line = rawLine.trim();
    if (STRUCTURED_LINE_PREFIXES.some(prefix => line.startsWith(prefix))) {
      break;
    }
    out.push(rawLine);
  }
  return out.join('\n').trim();
}

/**
 * Truncate a summary at a sentence boundary, falling back to a word
 * boundary, ensuring the result is ≤ `maxChars` chars and ends cleanly.
 *
 * Upstream parity: tool-description-summary.ts truncateSummary().
 *
 * Behavior:
 *   - If text already fits, returned unchanged (trimmed).
 *   - Prefer cutting at the last `. `/`! `/`? ` inside the budget.
 *   - Otherwise cut at the last space inside the budget.
 *   - Append a trailing `…` when content was elided.
 */
export function truncateSummary(text: string, maxChars: number = DEFAULT_MAX_CHARS): string {
  const trimmed = text.trim();
  if (trimmed.length <= maxChars) {
    return trimmed;
  }

  const slice = trimmed.slice(0, maxChars);

  // Prefer sentence-end punctuation
  const sentenceMatch = slice.match(/[\s\S]*[.!?](?=\s|$)/);
  if (sentenceMatch && sentenceMatch[0].length >= maxChars * 0.4) {
    return sentenceMatch[0].trim();
  }

  // Fall back to last whitespace
  const lastSpace = slice.lastIndexOf(' ');
  if (lastSpace > 0) {
    return slice.slice(0, lastSpace).trim() + '…';
  }

  return slice + '…';
}

/**
 * Produce a short, prompt-friendly summary from a long tool description.
 *
 * Pipeline:
 *   1. Strip structured doc blocks (JSON, ACTIONS:, parameter lists, …).
 *   2. Take the first paragraph (collapse multi-line preamble).
 *   3. Truncate to `maxChars` at a sentence/word boundary.
 *
 * Upstream parity: tool-description-summary.ts summarizeToolDescriptionText().
 *
 * Returns an empty string for empty input; callers can fall back to the
 * tool name in that edge case.
 */
export function summarizeToolDescriptionText(
  description: string,
  maxChars: number = DEFAULT_MAX_CHARS,
): string {
  if (!description) {
    return '';
  }

  const stripped = stripStructuredBlocks(description);
  if (!stripped) {
    return '';
  }

  // Collapse internal whitespace; take prose up to first blank line as the
  // headline paragraph (upstream pattern).
  const firstParagraph = stripped.split(/\n\s*\n/)[0] ?? stripped;
  const collapsed = firstParagraph.replace(/\s+/g, ' ').trim();

  return truncateSummary(collapsed, maxChars);
}
