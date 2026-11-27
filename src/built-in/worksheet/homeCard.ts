// homeCard.ts — what Worksheets has for Home: the quiz left open.
//
// One card while a quiz is open: which problem it stands on, its name, and
// Resume, which opens it where it was left. No open quiz: no card. Home
// asks for it when it opens and when the quiz moved or the data changed.

import type { IDisposable } from '../../platform/lifecycle.js';
import type { ToolHomeCard, ToolHomeCardProvider } from '../../api/homeApi.js';
import { practiceListeners, state } from './state.js';
import { getOpenQuizSession, onWorksheetDataChanged } from './worksheetData.js';
import { OPEN_QUIZ_COMMAND } from './panes/rosterPane.js';

/** The open quiz as Home's card. `position` counts problems from 0; past the last one it is on its summary. */
export function quizHomeCard(quiz: { readonly id: string; readonly name: string; readonly problems: number; readonly position: number } | null): ToolHomeCard | null {
  if (!quiz || quiz.problems <= 0) return null;
  const at = Math.max(1, Math.min(quiz.position + 1, quiz.problems));
  return {
    id: 'quiz', icon: 'calculator', number: `${at} of ${quiz.problems}`,
    line: `${quiz.name || 'Quiz'}, the quiz you left open.`,
    action: { label: 'Resume', icon: 'arrow-right', command: OPEN_QUIZ_COMMAND, args: [quiz.id] },
  };
}

interface HomeApi {
  home?: { registerCardProvider?(provider: ToolHomeCardProvider): IDisposable };
}

/** Gives Home the card while Worksheets runs. */
export function registerWorksheetHomeCard(api: HomeApi): IDisposable | undefined {
  return api.home?.registerCardProvider?.({
    id: 'quiz',
    read: async () => {
      // The quiz in memory is ahead of the stored one by the step just taken.
      const live = state.practice;
      if (live) return live.finishedAt ? null : quizHomeCard({ id: live.id, name: live.name, problems: live.ids.length, position: live.index });
      const row = await getOpenQuizSession();
      return row ? quizHomeCard({ id: row.id, name: row.name, problems: row.itemIds.length, position: row.position }) : null;
    },
    onDidChange: (listener) => {
      const heard = (): void => listener();
      practiceListeners.add(heard);
      const data = onWorksheetDataChanged(heard);
      return { dispose: () => { practiceListeners.delete(heard); data.dispose(); } };
    },
  });
}
