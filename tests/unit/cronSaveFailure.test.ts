// cronSaveFailure.test.ts — a routine that could not be saved is reported,
// not lost in silence. The in-memory job set stays the truth for this
// session; the log says it will be missing after a restart, and why.

import { describe, it, expect, vi, afterEach } from 'vitest';
import { CronService } from '../../src/openclaw/openclawCronService';

afterEach(() => vi.restoreAllMocks());

describe('CronService persistence failures', () => {
  it('logs the cause and keeps the job in memory', async () => {
    const error = vi.spyOn(console, 'error').mockImplementation(() => undefined);
    const svc = new CronService(vi.fn().mockResolvedValue(undefined), vi.fn().mockResolvedValue([]), null);
    svc.setPersistence({
      load: async () => null,
      save: async () => { throw new Error('EACCES: permission denied'); },
    });

    const job = svc.addJob({ name: 'nightly', schedule: { every: '5m' }, payload: { agentTurn: 'hi' } });
    for (let i = 0; i < 4; i++) await Promise.resolve();

    expect(svc.jobs.map((j) => j.id)).toEqual([job.id]);
    expect(error).toHaveBeenCalledTimes(1);
    const [message, cause] = error.mock.calls[0];
    expect(String(message)).toMatch(/Could not save 1 routine/);
    expect(String(message)).toMatch(/missing after a restart/);
    expect((cause as Error).message).toBe('EACCES: permission denied');
    svc.dispose();
  });
});
