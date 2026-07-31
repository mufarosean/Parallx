// codeFences.ts — turn a chat model's answer into something that can go in a cell.
//
// A notebook cell holds code, but a chat model returns prose-and-markdown: it
// wraps code in ``` fences, labels the language, and often adds a sentence
// before and after. Writing that verbatim into a cell produces a SyntaxError on
// the first line, so the fences have to come off.
//
// The system prompt asks for bare code, and this still exists because that is a
// request, not a guarantee — every local model complies at a different rate, and
// the failure mode when one doesn't is a cell that cannot run.
//
// Streaming is the reason this is a pure function over the WHOLE accumulated
// buffer rather than a per-chunk transform. Chunks split wherever the tokeniser
// happened to split, so a chunk boundary can fall inside a fence marker; only
// the full buffer is ever unambiguous. Re-deriving from scratch each frame is
// cheap next to the repaint it feeds.

/** A fence line: ``` or ~~~, optionally indented, optionally language-tagged. */
const FENCE_LINE = /^[ \t]{0,3}(?:```|~~~)/;

/**
 * Extract the code from a model reply.
 *
 * With fences present, returns the fenced content — every block, joined by a
 * blank line, since a model asked for one cell's worth of code sometimes splits
 * it in two. With no fences, returns the text as-is: it is either already bare
 * code (the good case) or prose the caller will see and can fix by re-prompting.
 *
 * Safe to call on a partially-received buffer: an unterminated final block is
 * treated as still-arriving code rather than discarded.
 */
export function stripCodeFences(text: string): string {
  if (!text) return '';

  const lines = text.split('\n');
  const blocks: string[] = [];
  let current: string[] | null = null;
  let sawFence = false;

  for (const line of lines) {
    if (FENCE_LINE.test(line)) {
      sawFence = true;
      if (current === null) {
        current = [];
      } else {
        blocks.push(current.join('\n'));
        current = null;
      }
      continue;
    }
    // Text outside a fence is prose and is dropped — but only once we know
    // fences are in play at all.
    if (current !== null) current.push(line);
  }

  // An unclosed block is the normal mid-stream state, not a malformed reply.
  if (current !== null) blocks.push(current.join('\n'));

  if (!sawFence) return trimBlankEdges(text);
  return trimBlankEdges(blocks.filter((b) => b.trim() !== '').join('\n\n'));
}

/**
 * Drop leading and trailing blank lines, preserving indentation on kept lines.
 *
 * `String.trim()` would eat the leading whitespace of the first line, which for
 * a reply that opens mid-block would silently change the code's meaning in
 * Python.
 */
function trimBlankEdges(text: string): string {
  const lines = text.split('\n');
  let start = 0;
  let end = lines.length;
  while (start < end && lines[start].trim() === '') start++;
  while (end > start && lines[end - 1].trim() === '') end--;
  return lines.slice(start, end).join('\n');
}
