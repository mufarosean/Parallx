import { describe, expect, it } from 'vitest';
import { buildAgentsSnapshot, formatWhen, nameFrom } from '../../src/built-in/agents/agentsModel';

const NOW = new Date(2026, 9, 2, 9, 0, 0).getTime();
const iso = (ms: number) => new Date(ms).toISOString();

const task = (id: string, status: string, extra: Record<string, unknown> = {}) => ({
  id, workspaceId: 'w', status, createdAt: iso(NOW - 60_000), updatedAt: iso(NOW - 1000), artifactRefs: [],
  goal: 'tidy the inbox. Move old notes.', constraints: [], desiredAutonomy: 'allow-safe-actions', completionCriteria: [],
  allowedScope: { kind: 'workspace' }, mode: 'operator', ...extra,
}) as never;
const step = (id: string, status: string, title = id) => ({ id, taskId: 't', title, description: '', status, kind: 'edit', approvalState: 'not-required', dependsOn: [], createdAt: '', updatedAt: '' }) as never;

describe('Agents view model', () => {
  it('lists approvals with the task name and a short target list', () => {
    const s = buildAgentsSnapshot({
      paused: false,
      tasks: [{ task: task('t', 'awaiting-approval'), steps: [] }],
      approvals: [{ id: 'r1', taskId: 't', status: 'pending', summary: 'Move 6 notes into Archive', explanation: '', toolName: 'fs_move', affectedTargets: ['a.md', 'b.md', 'c.md', 'd.md'], createdAt: iso(NOW) } as never],
      jobs: [], rows: [],
    }, NOW);
    expect(s.needsYou[0]).toMatchObject({ who: 'Tidy the inbox', what: 'Move 6 notes into Archive', detail: 'a.md, b.md and 2 more' });
    expect(s.running[0]).toMatchObject({ state: 'waiting', step: 'Waiting for your OK', action: null });
  });

  it('shows the current step and progress, and offers Pause or Continue', () => {
    const s = buildAgentsSnapshot({
      paused: false,
      tasks: [
        { task: task('t', 'running', { currentStepId: 's2' }), steps: [step('s1', 'completed'), step('s2', 'running', 'Reading three notes'), step('s3', 'pending')] },
        { task: task('u', 'paused', { blockerReason: 'Paused by you' }), steps: [] },
      ],
      approvals: [], jobs: [], rows: [],
    }, NOW);
    expect(s.running.find((r) => r.taskId === 't')).toMatchObject({ step: 'Reading three notes', done: 1, total: 3, action: 'pause' });
    expect(s.running.find((r) => r.taskId === 'u')).toMatchObject({ state: 'paused', action: 'continue' });
  });

  it('orders what is coming up, and only today counts as done', () => {
    const s = buildAgentsSnapshot({
      paused: true,
      tasks: [], approvals: [],
      jobs: [
        { id: 'j1', name: 'Evening Review', enabled: true, nextRunAt: NOW + 9 * 3600_000, payload: {}, description: 'Sums up the day' } as never,
        { id: 'j2', name: 'Off', enabled: false, nextRunAt: NOW + 1000, payload: {} } as never,
      ],
      heartbeat: { enabled: true, nextDueMs: NOW + 5 * 60_000, intervalMs: 30 * 60_000 },
      rows: [
        { kind: 'event', id: 'e1', triggeredAt: iso(NOW - 3600_000), trigger: 'cron', outcome: 'completed', record: { trigger: { kind: 'cron', ref: 'j1' } } } as never,
        { kind: 'event', id: 'e2', triggeredAt: iso(NOW - 30 * 3600_000), trigger: 'cron', outcome: 'completed', record: { trigger: { kind: 'cron' } } } as never,
        { kind: 'event', id: 'e3', triggeredAt: iso(NOW - 600_000), trigger: 'chat', outcome: 'completed', record: { trigger: { kind: 'chat' } } } as never,
      ],
    }, NOW);
    expect(s.paused).toBe(true);
    expect(s.upcoming.map((u) => u.name)).toEqual(['Heartbeat', 'Evening Review']);
    expect(s.upcoming[0].when).toBe('in 5 min');
    expect(s.done).toHaveLength(1);
    expect(s.done[0]).toMatchObject({ name: 'Evening Review', result: 'ok' });
  });

  it('formats times and names', () => {
    expect(formatWhen(NOW + 30_000, NOW)).toBe('Now');
    expect(formatWhen(NOW + 3 * 3600_000, NOW)).toBe('12:00');
    expect(formatWhen(NOW + 24 * 3600_000, NOW)).toBe('Tomorrow 09:00');
    expect(nameFrom('', 'Task')).toBe('Task');
  });
});
