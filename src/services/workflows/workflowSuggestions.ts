// workflowSuggestions.ts — a habit becomes a workflow the user can read.
//
// The mind notices that most days around 08:05 the user opens the planner.
// That used to become a chat offer ("want me to schedule this with cron?")
// the heartbeat had to deliver at some later tick, or a planner task nobody
// asked for. Now it becomes a SUGGESTED WORKFLOW: a disabled document in the
// Workflows panel, in the same shape as every other workflow, that the user
// approves (enable) or dismisses (delete). Nothing runs until they say so.
//
// Pure: no services, no clock of its own.

import type { WorkflowDoc } from './workflowTypes.js';

/** The slice of a habit reading this builder needs (see mind/habitDetector). */
export interface HabitLike {
  /** The observed action, e.g. "opened planner" or "focused view.planner view". */
  readonly action: string;
  /** "08:05"-style typical time, or null. */
  readonly typicalTime: string | null;
  /** Minutes since midnight, or null. */
  readonly typicalMinuteOfDay: number | null;
  readonly daysObserved?: number;
}

function pad2(n: number): string {
  return n < 10 ? `0${n}` : String(n);
}

export function minutesToClock(minuteOfDay: number): string {
  const m = Math.max(0, Math.min(23 * 60 + 59, Math.round(minuteOfDay)));
  return `${pad2(Math.floor(m / 60))}:${pad2(m % 60)}`;
}

/**
 * Turn a journal-shaped action ("opened planner", "focused view.canvas view")
 * into the infinitive a sentence can carry ("open the planner").
 */
export function humanizeHabitAction(action: string): string {
  let s = action.trim();
  s = s.replace(/^(opened|focused|focus|open)\s+/i, 'open ');
  // "view.planner view" → "the planner view"; "view.chat" → "the chat view"
  s = s.replace(/\bview\.([a-zA-Z0-9-]+)(?:\s+view)?\b/g, (_m, id: string) => `the ${id} view`);
  // A quoted file keeps its quotes; a bare noun gets an article once.
  if (/^open\s+(?!the\b|"|'|a\b|an\b)/.test(s)) s = s.replace(/^open\s+/, 'open the ');
  return s;
}

function titleCase(s: string): string {
  return s.replace(/(^|\s)([a-z])/g, (_m, sp: string, c: string) => `${sp}${c.toUpperCase()}`);
}

/**
 * The suggested workflow for a habit: a daily schedule at the typical time,
 * the day's facts, and one agent turn whose mission is to prepare that
 * moment. Disabled, source 'suggested', and stamped with the habit's action
 * so the same habit is never suggested twice.
 */
export function habitToWorkflow(
  habit: HabitLike,
  _now: number = Date.now(),
): Omit<WorkflowDoc, 'id' | 'createdAt' | 'updatedAt'> {
  const time = habit.typicalTime ?? minutesToClock(habit.typicalMinuteOfDay ?? 9 * 60);
  const doing = humanizeHabitAction(habit.action);
  const name = `Around ${time}: ${titleCase(doing)}`;
  const days = habit.daysObserved && habit.daysObserved > 1 ? `${habit.daysObserved} days` : 'most days';
  return {
    name,
    description: `Suggested from a habit: on ${days} around ${time} you ${doing}. Add it and the agent prepares that moment before you get there.`,
    class: 'quiet',
    enabled: false,
    source: 'suggested',
    suggestedFrom: habit.action,
    nodes: [
      { id: 't', label: `Daily At ${time}`, kind: 'trigger.schedule', spec: { kind: 'daily', time }, x: 40, y: 80 },
      { id: 'c', label: 'Today’s Facts', kind: 'context.facts', x: 280, y: 80 },
      {
        id: 'g', label: 'Prepare The Moment', kind: 'action.agentTurn', x: 520, y: 80,
        prompt: `Around ${time} each day the user usually ${doing}s, a habit learned from their activity. `
          + 'Using the context above, prepare that moment: gather what they will need, note anything new, due or overdue, '
          + `and leave one short summary where they will see it: a canvas page titled "Ready: ${titleCase(doing)}" (canvas_create_page with markdown). `
          + 'Do not ask questions. Do the preparation, briefly.',
      },
    ],
    edges: [{ from: 't', to: 'c' }, { from: 'c', to: 'g' }],
  };
}
