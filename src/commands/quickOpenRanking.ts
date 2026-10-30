// quickOpenRanking.ts — how Quick Open (Ctrl+P) scores what its sources
// list and orders every kind of result together. Pure: no widget, no DOM.
//
// Each source's items are matched on their label first, then their detail,
// then their keywords (words the user may type that are not shown, such as a
// setting's key or description). A label match beats a detail match, which
// beats a keyword match, so "accent" lists the Accent setting before a row
// that only mentions accents in its description.
//
// The general list then orders results across kinds:
//   - an empty query keeps each kind in its own section, as listed;
//   - a query that looks like a path ("src/", "notes.md") puts files first;
//   - any other query ranks every result by match quality alone. When that
//     mixes kinds, the section headers give way to a category on each row
//     ("Setting", "Tool", "Theme"), since one kind no longer sits together.

import { fuzzyMatch } from './quickAccessMatch.js';
import type { QuickOpenSource, QuickOpenSourceItem } from '../services/quickOpenSources.js';

/** Added to a detail match's score: the label is what the user calls it. */
export const DETAIL_PENALTY = 100;
/** Added to a keyword match's score: keywords are not even on screen. */
export const KEYWORD_PENALTY = 300;
/** Taken off a recently opened file's score, so it leads among equals. */
export const RECENT_BONUS = 200;

/** One row of the general list, as the ranking sees it. */
export interface QuickOpenRow {
  id: string;
  label: string;
  detail?: string;
  /** Section header the row sits under while its kind is listed together. */
  group?: string;
  /** Category shown before the label ("Setting: Accent"). */
  category?: string;
  /** What the row is, singular ("Setting"); becomes its category when kinds mix. */
  kind?: string;
  /** Lower is better. */
  score: number;
  isRecent?: boolean;
  labelMatches?: number[];
  detailMatches?: number[];
  accept: () => void;
}

export interface EntryMatch {
  score: number;
  labelMatches?: number[];
  detailMatches?: number[];
}

/** Match a query against an entry's label, then detail, then keywords. */
export function matchEntry(query: string, label: string, detail?: string, keywords?: string): EntryMatch | null {
  const onLabel = fuzzyMatch(query, label);
  if (onLabel) return { score: onLabel.score, labelMatches: onLabel.matches };
  const onDetail = detail ? fuzzyMatch(query, detail) : null;
  if (onDetail) return { score: onDetail.score + DETAIL_PENALTY, detailMatches: onDetail.matches };
  // Keywords are free text: only a whole-substring match counts, so a long
  // description does not match every short query by scattered letters.
  const k = keywords?.toLowerCase().indexOf(query.toLowerCase()) ?? -1;
  return k >= 0 ? { score: -1000 + k + KEYWORD_PENALTY } : null;
}

/** True when the query reads as part of a file path rather than a name. */
export function looksLikePath(query: string): boolean {
  const q = query.trim();
  return /[\\/]/.test(q) || /\.[a-z0-9]{1,8}$/i.test(q) || /^\.[a-z]/i.test(q);
}

/**
 * Every source's items as rows, each source's best `max` matches in order.
 * A source marked `onlyWhenQueried` lists nothing until the user types.
 */
export async function collectSourceRows(
  query: string,
  sources: readonly QuickOpenSource[],
  max: number,
): Promise<QuickOpenRow[]> {
  const rows: QuickOpenRow[] = [];
  for (const source of sources) {
    if (source.onlyWhenQueried && query.trim().length === 0) continue;
    let entries: readonly QuickOpenSourceItem[];
    try { entries = await source.listItems(); } catch { continue; }
    const scored: { entry: QuickOpenSourceItem; match: EntryMatch }[] = [];
    entries.forEach((entry, order) => {
      if (query.length === 0) { scored.push({ entry, match: { score: order } }); return; }
      const match = matchEntry(query, entry.label, entry.detail, entry.keywords);
      if (match) scored.push({ entry, match });
    });
    if (query.length > 0) scored.sort((a, b) => a.match.score - b.match.score || a.entry.label.localeCompare(b.entry.label));
    for (const { entry, match } of scored.slice(0, max)) {
      rows.push({
        id: `${source.id}:${entry.id}`,
        label: entry.label,
        detail: entry.detail,
        group: source.group,
        kind: source.kind,
        ...match,
        accept: () => entry.open(),
      });
    }
  }
  return rows;
}

/**
 * Order the general list. `rows` arrive section by section (sources, files,
 * workspaces), each section already in its own order; `pathGroup` names the
 * files' section.
 */
export function rankQuickOpenRows<T extends QuickOpenRow>(rows: readonly T[], query: string, pathGroup = 'files'): T[] {
  if (query.trim().length === 0) return [...rows];
  if (looksLikePath(query)) {
    return [...rows.filter((r) => r.group === pathGroup), ...rows.filter((r) => r.group !== pathGroup)];
  }
  const effective = (r: T): number => (r.isRecent ? r.score - RECENT_BONUS : r.score);
  const ranked = rows
    .map((row, index) => ({ row, index }))
    .sort((a, b) => effective(a.row) - effective(b.row) || a.index - b.index)
    .map(({ row }) => row);
  if (new Set(ranked.map((r) => r.group)).size <= 1) return ranked;
  return ranked.map((r) => ({ ...r, group: undefined, category: r.kind ?? r.category }));
}
