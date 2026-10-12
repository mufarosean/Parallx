// openclawToolResultCaps.ts — what a tool result may weigh inside the
// running turn: the per-result and per-round character caps, the images
// kept out of history, long arguments elided on replay, and the content
// shape normalized to the string contract.

import type { IToolResult } from '../services/chatTypes.js';

/**
 * Hard ceiling on characters per tool result before truncation.
 * 100 000 chars ≈ 25 000 tokens — large enough for bulk-fetch tools
 * (e.g. Gmail returning 25+ messages with bodies) on big-context models.
 *
 * NOTE: this is only the upper bound. The effective cap applied per turn is
 * budget-aware (`toolResultCharCap`, computed from `context.tokenBudget`) so a
 * single tool result can never exceed a fraction of the model's context
 * window. Without that, a runaway / bulk tool result could overflow a small
 * window — and the mid-loop compaction can't reclaim it because the recent
 * tool exchange is preserved verbatim, which would then poison every future
 * turn once persisted to history.
 */
export const MAX_TOOL_RESULT_CHARS = 100_000;

/**
 * Floor for the per-result share when one ROUND of tool calls has to split the
 * round's budget. Three parallel calls each at the single-result cap used to
 * add up to more than the whole window in one round; nothing summed them.
 */
export const ROUND_RESULT_FLOOR_CHARS = 2_000;

/**
 * Longest string argument replayed to the model INSIDE the running turn. The
 * tool has already executed on the full payload (a file body, a page's
 * markdown); what the model needs afterwards is what it asked for, not the
 * payload again. Persisted history keeps the full record for the UI.
 */
const IN_TURN_ARG_VALUE_CHARS = 2_000;

/**
 * Cut a tool result to `cap` chars. Success output keeps the head (the useful
 * surface of a file dump lives at the top); error output keeps the tail (the
 * root cause and stack frames live at the bottom).
 */
export function capToolResultContent(content: string, cap: number, isError: boolean): string {
  if (content.length <= cap) return content;
  if (isError) {
    return `(truncated head, ${content.length - cap} chars omitted)\n\n${content.slice(content.length - cap)}`;
  }
  return `${content.slice(0, cap)}\n\n... (truncated, ${content.length} chars total)`;
}

/**
 * Fit a whole round of tool results under `roundCap` chars. Each result is
 * first held to `perResultCap`; if the round still overflows, the budget is
 * split evenly (never below the floor) and every result is re-cut.
 */
export function capToolResultRound<T extends { content: string; isError: boolean }>(
  results: readonly T[],
  perResultCap: number,
  roundCap: number,
): T[] {
  const capped = results.map((r) => ({ ...r, content: capToolResultContent(r.content, perResultCap, r.isError) }));
  const total = capped.reduce((sum, r) => sum + r.content.length, 0);
  if (total <= roundCap || capped.length === 0) return capped;
  const share = Math.max(ROUND_RESULT_FLOOR_CHARS, Math.floor(roundCap / capped.length));
  return capped.map((r) => ({ ...r, content: capToolResultContent(r.content, share, r.isError) }));
}

/** A tool result as the UI and history keep it: its images stay with the running turn. */
export function withoutToolImages(result: IToolResult): IToolResult {
  if (!result.images) return result;
  const kept: { -readonly [K in keyof IToolResult]: IToolResult[K] } = { ...result };
  delete kept.images;
  return kept;
}

/** Elide long string arguments on the tool calls replayed within this turn. */
export function elideLongToolCallArgs<T extends { readonly function: { readonly name: string; readonly arguments: Record<string, unknown> } }>(
  calls: readonly T[],
): readonly T[] {
  let changed = false;
  const out = calls.map((call) => {
    const args = call.function.arguments;
    if (!args || typeof args !== 'object') return call;
    let callChanged = false;
    const next: Record<string, unknown> = {};
    for (const [key, value] of Object.entries(args)) {
      if (typeof value === 'string' && value.length > IN_TURN_ARG_VALUE_CHARS) {
        next[key] = `${value.slice(0, IN_TURN_ARG_VALUE_CHARS)}…[+${value.length - IN_TURN_ARG_VALUE_CHARS} chars elided; the tool ran on the full value]`;
        callChanged = true;
      } else {
        next[key] = value;
      }
    }
    if (!callChanged) return call;
    changed = true;
    return { ...call, function: { ...call.function, arguments: next } };
  });
  return changed ? out : calls;
}

/**
 * Defensive normalizer for `IToolResult.content` that came in from an
 * extension or built-in tool. Parallx's contract is `content: string`, but
 * a few extension authors return MCP-shape `[{ type: 'text', text }, …]`
 * instead — that array then propagates into `role: 'tool'` message content
 * and trips Ollama's HTTP 400. This unwraps the MCP shape into a string and
 * logs a one-line warning so the misbehaving tool can be fixed at the
 * source. Strings (the contract) pass through untouched.
 */
export function normalizeToolResultContent(content: unknown, toolName: string): string {
  if (typeof content === 'string') { return content; }
  if (Array.isArray(content)) {
    const parts = content.map((c) => {
      if (c && typeof c === 'object' && 'type' in c && (c as { type: unknown }).type === 'text'
          && 'text' in c && typeof (c as { text: unknown }).text === 'string') {
        return (c as { text: string }).text;
      }
      return JSON.stringify(c);
    });
    console.warn(
      `[openclawAttempt] Tool "${toolName}" returned MCP-shape array content; `
      + `expected Parallx-shape string. Unwrapping to string.`,
    );
    return parts.join('\n');
  }
  if (content == null) { return ''; }
  console.warn(
    `[openclawAttempt] Tool "${toolName}" returned non-string content (typeof=${typeof content}); `
    + `coercing via JSON.stringify.`,
  );
  return JSON.stringify(content);
}
