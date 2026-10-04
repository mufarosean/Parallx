// worksheetEmbed.ts — what the Canvas "Practice Problems" block asks for
//
// A page shows a few problems from the bank (by paper, tag and state) and
// opens one to work it. The block reaches this through the worksheet.embed.*
// commands, never the ws_* tables. Pure, so the choice is tested alone.

import { itemTags } from './practiceSession.js';
import { normalizeRating, paperLabel, ratingLabel } from './problemImport.js';

export type EmbedShow = 'all' | 'new' | 'needsWork' | 'starred';
export const EMBED_SHOW: ReadonlyArray<{ value: EmbedShow; label: string }> = [
  { value: 'all', label: 'All problems' },
  { value: 'new', label: 'Not tried yet' },
  { value: 'needsWork', label: 'Needs work (Hard or Medium)' },
  { value: 'starred', label: 'Starred' },
];

export interface EmbedQuery {
  readonly paper?: string;
  readonly tag?: string;
  readonly show?: EmbedShow | string;
  readonly limit?: number;
}

export interface EmbedItemLike {
  readonly id: number;
  readonly title: string;
  readonly paper: string;
  readonly tags: string;
  readonly attemptState: string;
  readonly attemptCount: number;
  readonly lastAttemptAt: number;
  readonly starred: boolean;
}

export interface EmbedProblem {
  readonly id: number;
  readonly title: string;
  readonly paper: string;
  /** "Easy", "Medium", "Hard", "In progress" or "Not tried". */
  readonly state: string;
  readonly starred: boolean;
}

export const EMBED_LIMIT_DEFAULT = 5;
export const EMBED_LIMIT_MAX = 25;

export function clampEmbedLimit(value: unknown): number {
  const n = Math.round(Number(value));
  if (!Number.isFinite(n) || n < 1) return EMBED_LIMIT_DEFAULT;
  return Math.min(EMBED_LIMIT_MAX, n);
}

function stateOf(item: EmbedItemLike): string {
  if (item.attemptState === 'open') return 'In progress';
  return ratingLabel(item.attemptState) || 'Not tried';
}

/** The problems a block shows, in the order it shows them. Needs work puts
 *  the longest-untouched first, so the block is a review list. */
export function selectEmbedProblems(items: readonly EmbedItemLike[], query: EmbedQuery): EmbedProblem[] {
  const paper = String(query.paper ?? '').trim().toLowerCase();
  const tag = String(query.tag ?? '').trim().toLowerCase();
  const show = String(query.show ?? 'all');
  let picked = items.filter((it) => {
    if (paper && it.paper.toLowerCase() !== paper) return false;
    if (tag && !itemTags(it.tags).some((t) => t.toLowerCase() === tag)) return false;
    if (show === 'new') return !it.attemptState;
    if (show === 'needsWork') { const r = normalizeRating(it.attemptState); return r === 'hard' || r === 'medium'; }
    if (show === 'starred') return it.starred;
    return true;
  });
  if (show === 'needsWork') {
    const rank = (it: EmbedItemLike) => (normalizeRating(it.attemptState) === 'hard' ? 0 : 1);
    picked = [...picked].sort((a, b) => rank(a) - rank(b) || a.lastAttemptAt - b.lastAttemptAt);
  }
  return picked.slice(0, clampEmbedLimit(query.limit)).map((it) => ({
    id: it.id, title: it.title || 'Untitled problem', paper: paperLabel(it.paper), state: stateOf(it), starred: it.starred,
  }));
}

/** The papers and tags to offer in the block's Edit… popover. */
export function embedFilterChoices(items: readonly EmbedItemLike[]): { papers: Array<{ value: string; label: string }>; tags: string[] } {
  const papers = new Map<string, string>();
  const tags = new Set<string>();
  for (const it of items) {
    if (it.paper) papers.set(it.paper.toLowerCase(), paperLabel(it.paper));
    for (const t of itemTags(it.tags)) tags.add(t);
  }
  return {
    papers: [...papers].map(([value, label]) => ({ value, label })).sort((a, b) => a.label.localeCompare(b.label)),
    tags: [...tags].sort((a, b) => a.localeCompare(b)),
  };
}
