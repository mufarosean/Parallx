// progressProvider.ts — Worksheets' problems as progress any tool can show
//
// The dashboard's "Progress by paper", offered through the core's
// progress-provider seam (src/services/progressProviders.ts): one group per
// paper, Easy good, Medium middling, Hard poor, not rated the rest. The
// counts are progressByPaper's, the same function the dashboard draws from,
// so the two can never disagree. The mapping is pure and tested in
// tests/unit/worksheetProgressProvider.test.ts.

import type { IProgressGroup, IProgressProvider, ProgressState, ProgressWords } from '../../services/progressProviders.js';
import { isWorkbookProblem, progressByPaper, type InsightItem } from './progressInsights.js';
import { normalizeRating, paperLabel } from './problemImport.js';

/** Worksheets' words for the four states, as its dashboard's legend has them. */
export const WORKSHEET_PROGRESS_WORDS: ProgressWords = { good: 'Easy', middling: 'Medium', poor: 'Hard', rest: 'Not rated' };

const RATING_OF: Record<ProgressState, string> = { good: 'easy', middling: 'medium', poor: 'hard', rest: '' };

/** One group per paper of the dashboard, with the dashboard's counts. Pure. */
export function worksheetProgressGroups(items: readonly InsightItem[]): IProgressGroup[] {
  return progressByPaper(items).map((p) => ({ group: p.paper, label: paperLabel(p.paper), total: p.total, good: p.easy, middling: p.medium, poor: p.hard }));
}

/** The workbook's problems of these papers (one, or several together) whose last rating is that state (rest: never rated). Pure. */
export function worksheetProgressIds(items: readonly InsightItem[], papers: string | readonly string[], state: ProgressState): number[] {
  if (!(state in RATING_OF)) return [];
  const wanted = new Set(typeof papers === 'string' ? [papers] : papers);
  return items.filter((it) => isWorkbookProblem(it) && wanted.has(it.paper) && normalizeRating(it.attemptState) === RATING_OF[state]).map((it) => it.id);
}

export function worksheetProgressProvider(deps: {
  listItems(): Promise<readonly InsightItem[]>;
  onDidChange(listener: () => void): { dispose(): void };
  /** Open the quiz builder with exactly these problems chosen, under this name. */
  openQuiz(ids: number[], name: string): void;
}): IProgressProvider {
  return {
    id: 'worksheets.problems',
    displayName: 'Problems',
    toolId: 'parallx.worksheet',
    words: WORKSHEET_PROGRESS_WORDS,
    async groups() {
      return worksheetProgressGroups(await deps.listItems());
    },
    onDidChange: (listener) => deps.onDidChange(listener),
    // A paper's problems are in no other paper, so there is no `count`: a reader adds the papers.
    async open(groups, state) {
      const papers = [...new Set(groups)];
      const ids = worksheetProgressIds(await deps.listItems(), papers, state);
      if (!ids.length) return false;
      deps.openQuiz(ids, `${papers.map(paperLabel).join(', ')} ${WORKSHEET_PROGRESS_WORDS[state]}`);
      return true;
    },
  };
}
