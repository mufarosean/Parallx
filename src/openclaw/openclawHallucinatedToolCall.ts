// openclawHallucinatedToolCall.ts — text that claims a tool ran when no tool
// call was made (openclawAttempt warns the user when it finds one).

/**
 * Escape a string for safe inclusion in a `RegExp` body. Used by
 * `_detectHallucinatedToolCall` so user-defined tool names that happen
 * to contain regex metacharacters can't blow up the matcher.
 */
function _escapeRegExp(s: string): string {
  return s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

/**
 * Detect model text that narrates a tool call without
 * the corresponding `tool_calls` structure being emitted. Two patterns
 * cover the dominant failure mode for OSS models:
 *
 *   Pattern A: "I (just )?(called|ran|invoked|executed) <tool_name>"
 *   Pattern B: "(used|using|with) (the )?<tool_name> tool"
 *
 * Matching is name-aware — the regex is built from the actually-
 * available tool catalog so it can't false-positive on natural-language
 * past tense like "I read the docs" or "I used the search bar."
 *
 * Returns the matched tool name (verbatim from the model's text) or
 * null when no hallucination is detected. Caller is responsible for
 * surfacing the warning to the user; this function is pure.
 *
 * Exported for unit testing only.
 */
export function _detectHallucinatedToolCall(
  markdown: string,
  availableToolNames: readonly string[],
): string | null {
  if (!markdown || availableToolNames.length === 0) return null;
  const namesAlt = availableToolNames.map(_escapeRegExp).join('|');
  // `\\b` word boundaries on both ends keep `fs_read_file` from matching
  // inside `pre_read_filefoo`; the alternation captures the tool name.
  const verbsPast = '(?:called|ran|just\\s+ran|invoked|executed|just\\s+used|queried|queries)';
  const patternA = new RegExp(
    `\\bI\\s+(?:just\\s+)?${verbsPast}\\s+\`?(${namesAlt})\\b`,
    'i',
  );
  const patternB = new RegExp(
    `\\b(?:used|using|with)\\s+(?:the\\s+)?\`?(${namesAlt})\`?\\s+tool\\b`,
    'i',
  );
  const m = patternA.exec(markdown) || patternB.exec(markdown);
  return m ? m[1] : null;
}
