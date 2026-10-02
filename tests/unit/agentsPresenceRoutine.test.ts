import { describe, expect, it } from 'vitest';
import { presenceLine } from '../../src/built-in/agents/agentsPresence';
import { nextRoutineRuns, routineCron, routinePrompt } from '../../src/built-in/agents/agentsRoutine';

const base = { paused: false, needsYou: [], running: [], upcoming: [], done: [] };

describe('agents presence line', () => {
  it('says nothing when nothing is going on', () => {
    expect(presenceLine(base)).toBeNull();
  });
  it('puts what needs you before what is running', () => {
    const line = presenceLine({
      ...base,
      needsYou: [{ taskId: 't', requestId: 'r', who: 'Inbox Tidy', what: 'Move notes', detail: '' }],
      running: [{ taskId: 't', name: 'Inbox Tidy', step: 'Reading', done: 0, total: 2, state: 'working', action: 'pause' }],
    });
    expect(line).toMatchObject({ text: 'Inbox Tidy needs your OK', tone: 'needs' });
  });
  it('names the running agent and its step, and says when paused', () => {
    expect(presenceLine({ ...base, running: [{ taskId: 't', name: 'Morning Brief', step: 'Reading three notes', done: 1, total: 3, state: 'working', action: 'pause' }] }))
      .toMatchObject({ text: 'Morning Brief: Reading three notes', tone: 'working' });
    expect(presenceLine({ ...base, paused: true })).toMatchObject({ text: 'Agents paused', tone: 'paused' });
  });
});

describe('new routine helpers', () => {
  it('builds a cron line for the chosen days', () => {
    expect(routineCron(new Set([1, 2, 3, 4, 5]), 7, 45)).toBe('45 7 * * 1,2,3,4,5');
    expect(routineCron(new Set([0, 1, 2, 3, 4, 5, 6]), 18, 0)).toBe('0 18 * * *');
  });
  it('lists the next runs on the chosen days only', () => {
    const fri = new Date(2026, 9, 2, 9, 0).getTime(); // a Friday
    const runs = nextRoutineRuns(new Set([1]), 7, 45, fri).map((t) => new Date(t));
    expect(runs).toHaveLength(3);
    expect(runs.every((d) => d.getDay() === 1 && d.getHours() === 7 && d.getMinutes() === 45)).toBe(true);
    expect(nextRoutineRuns(new Set([5]), 18, 0, fri, 1)[0]).toBe(new Date(2026, 9, 2, 18, 0).getTime());
  });
  it('tells the agent where to write when a page is given', () => {
    expect(routinePrompt('Sum up the day', '')).toBe('Sum up the day');
    expect(routinePrompt('Sum up the day', 'Daily Brief')).toContain('canvas page "Daily Brief"');
  });
});
