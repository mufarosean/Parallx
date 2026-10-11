// modelJson.ts — the JSON inside a model's reply.
//
// A model asked for JSON answers with prose around it, a code fence, a
// leaked <think> block, a citation in brackets before the array, or a reply
// cut off before its last bracket. A greedy /\{[\s\S]*\}/ fails on two
// objects and on a brace in the prose; these walk the text string by string,
// brace by brace, and return the first candidate that parses. Pure: the
// same helpers serve the core and, through api.lm.parseJson, extensions.

/** The reply without <think> blocks (an unterminated one too) and code fences. */
export function stripModelNoise(text: string): string {
  return String(text ?? '')
    .replace(/<think>[\s\S]*?<\/think>/gi, '')
    .replace(/^[\s\S]*?<\/think>/i, '')
    .replace(/```(?:json)?/gi, '')
    .trim();
}

export interface JsonSearchOptions {
  /** Applied to a candidate before the strict parse (a LaTeX escape repair, say). */
  repair?: (slice: string) => string;
  /** How many candidate openings to try before giving up. */
  attempts?: number;
}

export interface JsonArrayOptions extends JsonSearchOptions {
  /**
   * Whether a parsed candidate is the array wanted. A citation such as
   * "[1]" is a valid array, so a caller expecting items that are objects
   * says so here and the walk moves on to the next '['.
   */
  accept?: (value: unknown[]) => boolean;
}

/** The index of the bracket closing the one at `start`, string-aware; -1 when the text ends first. */
export function matchingClose(text: string, start: number, open: string, close: string): number {
  let depth = 0;
  let inStr = false;
  let escape = false;
  for (let i = start; i < text.length; i++) {
    const ch = text[i];
    if (escape) { escape = false; continue; }
    if (ch === '\\') { escape = true; continue; }
    if (ch === '"') { inStr = !inStr; continue; }
    if (inStr) continue;
    if (ch === open) depth++;
    else if (ch === close) { depth--; if (depth === 0) return i; }
  }
  return -1;
}

function parseSlice(slice: string, repair?: (s: string) => string): unknown {
  if (repair) {
    try { return JSON.parse(repair(slice)); } catch { /* the raw slice next */ }
  }
  try { return JSON.parse(slice); } catch { return undefined; }
}

/**
 * The first JSON object in the reply that parses, or null. Each '{' is a
 * candidate (a brace in the prose is skipped when its slice does not parse);
 * an array is not an object.
 */
export function findJsonObject(text: string, opts: JsonSearchOptions = {}): Record<string, unknown> | null {
  const t = stripModelNoise(text);
  const attempts = opts.attempts ?? 8;
  let start = t.indexOf('{');
  for (let n = 0; start !== -1 && n < attempts; n++) {
    const end = matchingClose(t, start, '{', '}');
    if (end === -1) return null;
    const parsed = parseSlice(t.slice(start, end + 1), opts.repair);
    if (parsed && typeof parsed === 'object' && !Array.isArray(parsed)) return parsed as Record<string, unknown>;
    start = t.indexOf('{', start + 1);
  }
  return null;
}

export interface JsonArrayResult {
  /** The array, or null when none parsed. */
  value: unknown[] | null;
  /** The reply ended before the array closed; `value` holds the complete items before the cut. */
  truncated: boolean;
}

/**
 * The first JSON array in the reply that parses. A reply cut off mid-array
 * keeps every complete top-level item before the cut, marked `truncated`.
 * Each '[' is a candidate: the first is often a citation.
 */
export function findJsonArray(text: string, opts: JsonArrayOptions = {}): JsonArrayResult {
  const t = stripModelNoise(text);
  const attempts = opts.attempts ?? 8;
  const accept = opts.accept ?? (() => true);
  let start = t.indexOf('[');
  for (let n = 0; start !== -1 && n < attempts; n++) {
    const end = matchingClose(t, start, '[', ']');
    if (end === -1) {
      // Truncated: the last complete item at depth one is the salvage point.
      let depth = 0, curly = 0, inStr = false, escape = false, lastItemEnd = -1;
      for (let i = start; i < t.length; i++) {
        const ch = t[i];
        if (escape) { escape = false; continue; }
        if (ch === '\\') { escape = true; continue; }
        if (ch === '"') { inStr = !inStr; continue; }
        if (inStr) continue;
        if (ch === '{') curly++;
        else if (ch === '}') { curly--; if (depth === 1 && curly === 0) lastItemEnd = i; }
        else if (ch === '[') depth++;
        else if (ch === ']') depth--;
      }
      if (lastItemEnd > start) {
        const parsed = parseSlice(t.slice(start, lastItemEnd + 1) + ']', opts.repair);
        if (Array.isArray(parsed) && parsed.length > 0 && accept(parsed)) return { value: parsed, truncated: true };
      }
      return { value: null, truncated: true };
    }
    const parsed = parseSlice(t.slice(start, end + 1), opts.repair);
    if (Array.isArray(parsed) && accept(parsed)) return { value: parsed, truncated: false };
    start = t.indexOf('[', start + 1);
  }
  return { value: null, truncated: false };
}

/**
 * The JSON value a reply carries: the whole reply when it is JSON, else the
 * first object or array in it (whichever opens first); null when none.
 */
export function parseModelJson(text: string): Record<string, unknown> | unknown[] | null {
  const t = stripModelNoise(text);
  const direct = parseSlice(t);
  if (direct && typeof direct === 'object') return direct as Record<string, unknown> | unknown[];
  const brace = t.indexOf('{');
  const bracket = t.indexOf('[');
  const objectFirst = brace !== -1 && (bracket === -1 || brace < bracket);
  if (objectFirst) return findJsonObject(t) ?? findJsonArray(t).value;
  return findJsonArray(t).value ?? findJsonObject(t);
}
