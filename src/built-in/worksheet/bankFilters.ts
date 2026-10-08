// bankFilters.ts — Worksheets: which problems the Problem Bank shows.
//
// PURE (unit-tested in tests/unit/worksheetBankFilters.test.ts). The bank's
// chips are grouped into facets; within a facet any chip may match, across
// facets all must. The search box takes words: every word must appear
// somewhere in the problem (title, sheet, question, paper name, tags, note),
// in any order; "a phrase in quotes" must appear whole; a word with a
// leading minus must not appear.
import { normalizeRating, paperLabel } from './problemImport.js';
import { recipeKey } from './recipes.js';

export interface BankFilterItem {
  readonly title: string;
  readonly sheetName: string;
  readonly questionMd: string;
  readonly paper: string;
  readonly note: string;
  readonly tags: string;
  readonly source: string;
  readonly kind: string;
  readonly starred: boolean;
  readonly attemptCount: number;
  /** '' = never attempted, 'open' = in progress, else the last rating. */
  readonly attemptState: string;
  /** The recipe the solution follows and its paper (recipes.ts); '' when none. */
  readonly recipe?: string;
  readonly recipePaper?: string;
}

export const BANK_FACETS = {
  status: ['starred', 'noted', 'done', 'incomplete'],
  rating: ['easy', 'medium', 'hard'],
  source: ['rf', 'cas', 'exam'],
  kind: ['quant', 'qual', 'essay'],
} as const satisfies Record<string, readonly string[]>;

export const BANK_FILTERS: readonly (readonly [string, string])[] = [
  ['starred', 'Starred'], ['noted', 'Noted'], ['done', 'Done'], ['incomplete', 'Incomplete'],
  ['easy', 'Easy'], ['medium', 'Medium'], ['hard', 'Hard'],
  ['rf', 'Rising Fellow'], ['cas', 'CAS Exam'], ['exam', 'Practice Exam'],
  ['quant', 'Quantitative'], ['qual', 'Qualitative'], ['essay', 'Essay'],
];

/** Chips that show how many problems they match. */
export const BANK_COUNTED = new Set(['starred', 'noted', 'done', 'incomplete']);

/** The chip/dot class for an attempt state: easy | medium | hard | open. */
export function stateClass(state: string): string {
  return state === 'open' ? 'open' : normalizeRating(state) || state;
}

/** Done: worked through to a rating at least once, and not open again now. */
export function isDone(item: BankFilterItem): boolean {
  return item.attemptCount > 0 && item.attemptState !== 'open';
}

/**
 * `recipes` holds recipeKey(paper, name) values: when any are given, the
 * problem's recipe must be one of them (a facet of its own).
 */
export function bankMatches(item: BankFilterItem, filters: ReadonlySet<string>, query: string, recipes?: ReadonlySet<string>): boolean {
  if (recipes && recipes.size && !(item.recipe && recipes.has(recipeKey(item.recipePaper ?? '', item.recipe)))) return false;
  const state = stateClass(item.attemptState);
  const test = (f: string): boolean => {
    if (f === 'starred') return !!item.starred;
    if (f === 'noted') return !!item.note;
    if (f === 'done') return isDone(item);
    if (f === 'incomplete') return item.attemptCount === 0 || item.attemptState === 'open';
    if (f === 'easy' || f === 'medium' || f === 'hard') return state === f;
    if (f === 'rf' || f === 'cas' || f === 'exam') return item.source === f;
    return item.kind === f;
  };
  for (const facet of Object.values(BANK_FACETS) as readonly (readonly string[])[]) {
    const on = facet.filter((f) => filters.has(f));
    if (on.length && !on.some(test)) return false;
  }
  if (query.trim()) {
    const hay = `${item.title} ${item.sheetName} ${item.questionMd} ${paperLabel(item.paper)} ${item.tags} ${item.note} ${item.recipe ?? ''}`.toLowerCase();
    for (const term of parseQuery(query)) {
      if (hay.includes(term.text) === term.not) return false;
    }
  }
  return true;
}

export interface QueryTerm { readonly text: string; readonly not: boolean }

/** Words, quoted phrases and -exclusions, lower-cased; an empty or lone minus is nothing. */
export function parseQuery(query: string): QueryTerm[] {
  const out: QueryTerm[] = [];
  const re = /(-?)(?:"([^"]*)"?|(\S+))/g;
  for (const m of query.toLowerCase().matchAll(re)) {
    const text = (m[2] ?? m[3] ?? '').trim();
    // A lone minus or stray punctuation is nothing to look for.
    if (!/[\p{L}\p{N}]/u.test(text)) continue;
    out.push({ text, not: m[1] === '-' });
  }
  return out;
}
