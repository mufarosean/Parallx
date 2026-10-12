// quickAccessMatch.ts — how a query matches an item, and how the match is
// shown. Pure: no widget, no services. The palette and quick open in
// quickAccess.ts score every candidate with fuzzyMatch and paint the
// matched characters with appendHighlighted.

import { $ } from '../ui/dom.js';

/** Result of a fuzzy match: score (lower is better) and matched character indices. */
export interface FuzzyMatchResult {
  score: number;
  /** Indices in the target string that matched the query characters. */
  matches: number[];
}

/**
 * Fuzzy match: every character in the query must appear in order within
 * the target (case-insensitive). Returns a score (lower is better) and the
 * matched character indices, or null if no match.
 *
 * Two-tier scoring:
 *   1. If the query appears as a contiguous substring, return a strong
 *      score (with extra bonus when the substring sits on a word boundary
 *      or at the very start). This guarantees that typing "scan" surfaces
 *      "**Scan** Directory" before scattered "**S**ear**c**h: Exp**a****n**d".
 *   2. Otherwise fall back to subsequence matching with bonuses for prefix,
 *      word-boundary, CamelCase, and consecutive matches, plus a gap penalty.
 *
 * Without the substring tier the score landscape was too flat — scattered
 * matches with a leading prefix bonus could outrank a clean word match,
 * so each keystroke seemed to reshuffle the list.
 */
export function fuzzyMatch(query: string, target: string): FuzzyMatchResult | null {
  const q = query.toLowerCase();
  const t = target.toLowerCase();

  // ── Tier 1: contiguous substring ──────────────────────────────────────
  const subIdx = t.indexOf(q);
  if (subIdx >= 0) {
    let score = -1000;
    if (subIdx === 0) {
      score -= 500;          // exact prefix
    } else if (isWordBoundary(t, subIdx, target)) {
      score -= 250;          // word boundary
    }
    score += subIdx;          // earlier match wins ties
    const matches: number[] = [];
    for (let i = 0; i < q.length; i++) matches.push(subIdx + i);
    return { score, matches };
  }

  // ── Tier 2: subsequence with bonuses ──────────────────────────────────
  let qi = 0;
  let score = 0;
  let lastMatchIndex = -1;
  const matches: number[] = [];

  for (let ti = 0; ti < t.length && qi < q.length; ti++) {
    if (t[ti] === q[qi]) {
      const gap = lastMatchIndex >= 0 ? ti - lastMatchIndex - 1 : ti;
      let charScore = gap * 2; // gaps hurt more than a single boundary helps

      if (ti === 0) {
        charScore -= 100;
      } else if (isWordBoundary(t, ti, target)) {
        charScore -= 50;
      } else {
        const prevOrig = target.charCodeAt(ti - 1);
        const curOrig = target.charCodeAt(ti);
        const prevIsLower = prevOrig >= 97 && prevOrig <= 122;
        const curIsUpper = curOrig >= 65 && curOrig <= 90;
        if (prevIsLower && curIsUpper) charScore -= 30;
      }
      if (lastMatchIndex === ti - 1) charScore -= 15;

      score += charScore;
      lastMatchIndex = ti;
      matches.push(ti);
      qi++;
    }
  }

  return qi === q.length ? { score, matches } : null;
}

/** True if `t[index]` sits on a word boundary (preceded by a separator). */
function isWordBoundary(t: string, index: number, original: string): boolean {
  if (index === 0) return true;
  const prev = t.charCodeAt(index - 1);
  if (
    prev === 32 /* space */ ||
    prev === 45 /* - */ ||
    prev === 95 /* _ */ ||
    prev === 47 /* / */ ||
    prev === 46 /* . */ ||
    prev === 58 /* : */
  ) return true;
  // CamelCase: prev lowercase, current uppercase in the ORIGINAL casing.
  const prevOrig = original.charCodeAt(index - 1);
  const curOrig = original.charCodeAt(index);
  return prevOrig >= 97 && prevOrig <= 122 && curOrig >= 65 && curOrig <= 90;
}

/**
 * Backward-compatible score-only wrapper. Returns score (lower is better)
 * or -1 if no match.
 */
export function fuzzyScore(query: string, target: string): number {
  const result = fuzzyMatch(query, target);
  return result ? result.score : -1;
}

/**
 * Append text to a container, wrapping matched character indices in
 * `<span class="highlight">` elements. Mirrors VS Code's HighlightedLabel
 * rendering in the quick pick.
 *
 * @param container The element to append text/highlight spans into.
 * @param text The full text string.
 * @param matches Optional sorted array of character indices to highlight.
 */
export function appendHighlighted(
  container: HTMLElement,
  text: string,
  matches?: number[],
): void {
  if (!matches || matches.length === 0) {
    container.appendChild(document.createTextNode(text));
    return;
  }

  const matchSet = new Set(matches);
  let pos = 0;

  while (pos < text.length) {
    if (matchSet.has(pos)) {
      // Collect consecutive highlighted chars
      const start = pos;
      while (pos < text.length && matchSet.has(pos)) pos++;
      const span = $('span');
      span.className = 'highlight';
      span.textContent = text.slice(start, pos);
      container.appendChild(span);
    } else {
      // Collect consecutive non-highlighted chars
      const start = pos;
      while (pos < text.length && !matchSet.has(pos)) pos++;
      container.appendChild(document.createTextNode(text.slice(start, pos)));
    }
  }
}
