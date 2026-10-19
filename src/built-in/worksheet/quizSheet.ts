// quizSheet.ts — Worksheets: a quiz opens every problem on a clean sheet.
//
// Work from before the quiz would give the answer away, so in a quiz the
// sheet shows only work done since the quiz began. Unfinished work from
// earlier is set aside (worksheet_020): kept, never shown in the quiz, and
// no longer the open attempt, so the quiz's work starts a new one. Outside a
// quiz a problem still opens on its latest work.
import { run } from './worksheetData.js';

interface AttemptLike { readonly id: number; readonly startedAt: number; readonly updatedAt: number }

/**
 * PURE. What a problem opens on inside a quiz that began at `quizStart`:
 * the open attempt when it was begun in the quiz, else the latest work when
 * it was saved in the quiz, else nothing (the clean sheet). `setAside` is
 * the open attempt from before the quiz, to put away.
 */
export function workForQuiz<T extends AttemptLike>(open: T | null, latest: T | null, quizStart: number): { open: T | null; prior: T | null; setAside: T | null } {
  if (open && open.startedAt >= quizStart) return { open, prior: null, setAside: null };
  return { open: null, prior: latest && latest.updatedAt >= quizStart && latest.id !== open?.id ? latest : null, setAside: open };
}

/** Puts an unfinished attempt aside: kept, no longer open. */
export async function setAttemptAside(attemptId: number): Promise<void> {
  await run('UPDATE ws_attempts SET set_aside_at = ? WHERE id = ? AND completed = 0', [Date.now(), attemptId]);
}
