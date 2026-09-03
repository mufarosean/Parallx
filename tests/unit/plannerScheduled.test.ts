/**
 * The planner's Scheduled tab reads the workflow service: which workflows
 * belong on it, how they are labelled, and how the next run reads.
 */

import { describe, it, expect } from 'vitest';
import {
  formatNextRun,
  isScheduledWorkflow,
  matchesScheduledFilter,
  scheduledOrigin,
} from '../../src/built-in/planner/plannerScheduled';

describe('scheduledOrigin', () => {
  it('maps every source onto the tab\'s three words', () => {
    expect(scheduledOrigin({ source: 'user' })).toBe('user');
    expect(scheduledOrigin({ source: 'migrated-cron' })).toBe('user');
    expect(scheduledOrigin({ source: 'suggested' })).toBe('ai');
    expect(scheduledOrigin({ source: 'stock' })).toBe('template');
  });
});

describe('isScheduledWorkflow', () => {
  it('only workflows with a schedule trigger belong on the tab', () => {
    expect(isScheduledWorkflow({ nodes: [{ id: 't', label: 'T', kind: 'trigger.schedule', spec: { kind: 'daily', time: '05:00' } }] })).toBe(true);
    expect(isScheduledWorkflow({ nodes: [{ id: 't', label: 'T', kind: 'trigger.manual' }] })).toBe(false);
    expect(isScheduledWorkflow({ nodes: [] })).toBe(false);
  });
});

describe('matchesScheduledFilter', () => {
  it('All shows everything; User and AI split by origin', () => {
    expect(matchesScheduledFilter({ source: 'stock' }, 'all')).toBe(true);
    expect(matchesScheduledFilter({ source: 'user' }, 'user')).toBe(true);
    expect(matchesScheduledFilter({ source: 'suggested' }, 'user')).toBe(false);
    expect(matchesScheduledFilter({ source: 'suggested' }, 'ai')).toBe(true);
  });
});

describe('formatNextRun', () => {
  const now = new Date(2026, 8, 3, 4, 0).getTime(); // 04:00
  it('reads as a person would say it', () => {
    expect(formatNextRun(now - 1, now)).toBe('due now');
    expect(formatNextRun(now + 25 * 60_000, now)).toBe('in 25 minutes');
    expect(formatNextRun(now + 3 * 3_600_000, now)).toBe('in 3 hours');
    expect(formatNextRun(new Date(2026, 8, 3, 23, 0).getTime(), now)).toBe('in 19 hours');
    expect(formatNextRun(new Date(2026, 8, 4, 5, 0).getTime(), now)).toBe('tomorrow at 05:00');
    expect(formatNextRun(new Date(2026, 8, 7, 5, 0).getTime(), now)).toBe('in 4 days at 05:00');
  });
});
