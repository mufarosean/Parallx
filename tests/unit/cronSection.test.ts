// @vitest-environment jsdom
// tests/unit/cronSection.test.ts — Scheduled Jobs section in AI Hub
//
// Validates that the section actually renders the live CronService job
// list (no placeholder!), handles source inference, fires updates back to
// the service, and re-renders on `onDidChangeJobs` events.

import { describe, it, expect, beforeEach, vi } from 'vitest';
import type { AISettingsProfile } from '../../src/aiSettings/aiSettingsTypes';
import { DEFAULT_PROFILE } from '../../src/aiSettings/aiSettingsDefaults';
import { Emitter } from '../../src/platform/events';
import { CronSection } from '../../src/aiSettings/ui/sections/cronSection';
import type { ICronJob, ICronJobChangeEvent } from '../../src/openclaw/openclawCronService';

// ─── Mocks ───────────────────────────────────────────────────────────────────

function createMockService() {
  const profile: AISettingsProfile = structuredClone(DEFAULT_PROFILE);
  return {
    getActiveProfile: vi.fn(() => structuredClone(profile)),
    getAllProfiles: vi.fn(() => []),
    setActiveProfile: vi.fn(async () => {}),
    updateActiveProfile: vi.fn(async () => {}),
    createProfile: vi.fn(),
    deleteProfile: vi.fn(),
    renameProfile: vi.fn(),
    resetSection: vi.fn(),
    resetAll: vi.fn(),
    runPreviewTest: vi.fn(),
    onDidChange: new Emitter<AISettingsProfile>().event,
    dispose: vi.fn(),
  };
}

function makeJob(partial: Partial<ICronJob>): ICronJob {
  return {
    id: partial.id ?? 'cron-1',
    name: partial.name ?? 'test.job',
    schedule: partial.schedule ?? { every: '30m' },
    payload: partial.payload ?? { agentTurn: 'do work' },
    wakeMode: partial.wakeMode ?? 'next-heartbeat',
    contextMessages: partial.contextMessages ?? 0,
    enabled: partial.enabled ?? true,
    createdAt: partial.createdAt ?? 1_700_000_000_000,
    lastRunAt: partial.lastRunAt ?? null,
    nextRunAt: partial.nextRunAt ?? 1_700_001_800_000,
    runCount: partial.runCount ?? 0,
    description: partial.description,
  };
}

function createMockCronService(jobs: ICronJob[] = []) {
  const emitter = new Emitter<ICronJobChangeEvent>();
  let store: ICronJob[] = [...jobs];

  return {
    get jobs() { return [...store]; },
    onDidChangeJobs: emitter.event,
    updateJob: vi.fn((id: string, patch: Partial<ICronJob>) => {
      const i = store.findIndex(j => j.id === id);
      if (i < 0) throw new Error(`not found: ${id}`);
      store[i] = { ...store[i], ...patch };
      emitter.fire({ kind: 'updated', jobId: id });
      return store[i];
    }),
    removeJob: vi.fn((id: string) => {
      const before = store.length;
      store = store.filter(j => j.id !== id);
      if (store.length < before) {
        emitter.fire({ kind: 'removed', jobId: id });
        return true;
      }
      return false;
    }),
    runJob: vi.fn(async (_id: string) => ({
      jobId: _id,
      jobName: 'x',
      firedAt: Date.now(),
      wakeMode: 'now' as const,
      success: true,
    })),
    // Test-only mutators
    _addJob(job: ICronJob) {
      store.push(job);
      emitter.fire({ kind: 'added', jobId: job.id });
    },
    _fireChange(ev: ICronJobChangeEvent) { emitter.fire(ev); },
  };
}

function buildSection(jobs: ICronJob[] = []) {
  const service = createMockService();
  const cronService = createMockCronService(jobs);
  const section = new CronSection(service as any, cronService as any);
  section.build();
  return { section, service, cronService };
}

// ─── Tests ───────────────────────────────────────────────────────────────────

describe('CronSection', () => {
  beforeEach(() => {
    document.body.innerHTML = '';
  });

  it('renders the empty state when CronService has no jobs', () => {
    const { section } = buildSection([]);
    const empty = section.element.querySelector('.ai-settings-section__info');
    // Two info banners (intro, approval) + one empty-state banner — empty visible
    const banners = section.element.querySelectorAll('.ai-settings-section__info');
    expect(banners.length).toBeGreaterThanOrEqual(3);
    expect(empty).toBeTruthy();
    expect(section.element.querySelectorAll('.ai-settings-cron-job')).toHaveLength(0);
    section.dispose();
  });

  it('renders one card per job when CronService has jobs', () => {
    const { section } = buildSection([
      makeJob({ id: 'cron-1', name: 'budget.sync.scheduled', description: 'Pulls transactions' }),
      makeJob({ id: 'cron-2', name: 'daily-recap', schedule: { cron: '0 9 * * *' } }),
    ]);
    const cards = section.element.querySelectorAll('.ai-settings-cron-job');
    expect(cards).toHaveLength(2);
    section.dispose();
  });

  it('infers source: dotted name → Extension, bare name → AI', () => {
    const { section } = buildSection([
      makeJob({ id: 'cron-1', name: 'budget.sync.scheduled' }),
      makeJob({ id: 'cron-2', name: 'morning-reminder' }),
    ]);
    const cards = Array.from(section.element.querySelectorAll('.ai-settings-cron-job'));
    // Cards are sorted: extension first, then AI/user
    expect(cards[0]?.querySelector('.ai-settings-cron-job__name')?.textContent).toBe('budget.sync.scheduled');
    expect(cards[0]?.querySelector('.ai-settings-cron-job__source')?.textContent).toContain('Extension');
    expect(cards[0]?.querySelector('.ai-settings-cron-job__source')?.textContent).toContain('budget');
    expect(cards[1]?.querySelector('.ai-settings-cron-job__source')?.textContent).toBe('AI');
    section.dispose();
  });

  it('shows schedule in human-readable form', () => {
    const { section } = buildSection([
      makeJob({ id: 'cron-1', name: 'a', schedule: { every: '30m' } }),
      makeJob({ id: 'cron-2', name: 'b', schedule: { cron: '0 9 * * *' } }),
    ]);
    const cards = Array.from(section.element.querySelectorAll('.ai-settings-cron-job'));
    const values = cards.map(c =>
      Array.from(c.querySelectorAll('.ai-settings-cron-job__meta-value'))
        .map(v => v.textContent)
        .filter(Boolean),
    );
    expect(values[0]?.[0]).toContain('Every 30m');
    expect(values[1]?.[0]).toContain('Cron: 0 9 * * *');
    section.dispose();
  });

  it('clicking the enabled toggle calls updateJob', () => {
    const { section, cronService } = buildSection([
      makeJob({ id: 'cron-1', name: 'test', enabled: true }),
    ]);
    const toggle = section.element.querySelector('input[type="checkbox"]') as HTMLInputElement;
    expect(toggle.checked).toBe(true);
    toggle.checked = false;
    toggle.dispatchEvent(new Event('change'));
    expect(cronService.updateJob).toHaveBeenCalledWith('cron-1', { enabled: false });
    section.dispose();
  });

  it('clicking Run now calls runJob', () => {
    const { section, cronService } = buildSection([
      makeJob({ id: 'cron-1', name: 'test' }),
    ]);
    const buttons = Array.from(section.element.querySelectorAll('button'));
    const runBtn = buttons.find(b => b.textContent === 'Run now') as HTMLButtonElement;
    runBtn.click();
    expect(cronService.runJob).toHaveBeenCalledWith('cron-1');
    section.dispose();
  });

  it('clicking Delete (and confirming) calls removeJob', () => {
    const confirmSpy = vi.spyOn(window, 'confirm').mockReturnValue(true);
    const { section, cronService } = buildSection([
      makeJob({ id: 'cron-1', name: 'test' }),
    ]);
    const buttons = Array.from(section.element.querySelectorAll('button'));
    const delBtn = buttons.find(b => b.textContent === 'Delete') as HTMLButtonElement;
    delBtn.click();
    expect(confirmSpy).toHaveBeenCalled();
    expect(cronService.removeJob).toHaveBeenCalledWith('cron-1');
    confirmSpy.mockRestore();
    section.dispose();
  });

  it('cancelled Delete does NOT call removeJob', () => {
    const confirmSpy = vi.spyOn(window, 'confirm').mockReturnValue(false);
    const { section, cronService } = buildSection([
      makeJob({ id: 'cron-1', name: 'test' }),
    ]);
    const buttons = Array.from(section.element.querySelectorAll('button'));
    const delBtn = buttons.find(b => b.textContent === 'Delete') as HTMLButtonElement;
    delBtn.click();
    expect(cronService.removeJob).not.toHaveBeenCalled();
    confirmSpy.mockRestore();
    section.dispose();
  });

  it('re-renders when CronService fires onDidChangeJobs', () => {
    const { section, cronService } = buildSection([]);
    expect(section.element.querySelectorAll('.ai-settings-cron-job')).toHaveLength(0);

    cronService._addJob(makeJob({ id: 'cron-1', name: 'new.job' }));
    expect(section.element.querySelectorAll('.ai-settings-cron-job')).toHaveLength(1);

    cronService._fireChange({ kind: 'removed', jobId: 'cron-1' });
    // _addJob pushed into store but our _fireChange doesn't pop — to simulate
    // a real remove we use the service's removeJob directly:
    cronService.removeJob('cron-1');
    expect(section.element.querySelectorAll('.ai-settings-cron-job')).toHaveLength(0);
    section.dispose();
  });

  it('Edit schedule reveals an input pre-filled with the current schedule', () => {
    const { section } = buildSection([
      makeJob({ id: 'cron-1', name: 'test', schedule: { every: '45m' } }),
    ]);
    const buttons = Array.from(section.element.querySelectorAll('button'));
    const editBtn = buttons.find(b => b.textContent === 'Edit schedule') as HTMLButtonElement;
    editBtn.click();

    const input = section.element.querySelector(
      '.ai-settings-cron-job__edit-input',
    ) as HTMLInputElement;
    expect(input).toBeTruthy();
    expect(input.value).toBe('45m');
    section.dispose();
  });

  it('Edit → Save with a valid every-duration calls updateJob with parsed schedule', () => {
    const { section, cronService } = buildSection([
      makeJob({ id: 'cron-1', name: 'test', schedule: { every: '30m' } }),
    ]);
    let buttons = Array.from(section.element.querySelectorAll('button'));
    (buttons.find(b => b.textContent === 'Edit schedule') as HTMLButtonElement).click();

    const input = section.element.querySelector(
      '.ai-settings-cron-job__edit-input',
    ) as HTMLInputElement;
    input.value = '2h';
    buttons = Array.from(section.element.querySelectorAll('button'));
    (buttons.find(b => b.textContent === 'Save') as HTMLButtonElement).click();

    expect(cronService.updateJob).toHaveBeenCalledWith('cron-1', { schedule: { every: '2h' } });
    section.dispose();
  });

  it('Edit → Save with a malformed schedule surfaces an error and does NOT call updateJob', () => {
    const { section, cronService } = buildSection([
      makeJob({ id: 'cron-1', name: 'test' }),
    ]);
    (Array.from(section.element.querySelectorAll('button')).find(
      b => b.textContent === 'Edit schedule',
    ) as HTMLButtonElement).click();

    const input = section.element.querySelector(
      '.ai-settings-cron-job__edit-input',
    ) as HTMLInputElement;
    input.value = 'not a real schedule';
    (Array.from(section.element.querySelectorAll('button')).find(
      b => b.textContent === 'Save',
    ) as HTMLButtonElement).click();

    expect(cronService.updateJob).not.toHaveBeenCalled();
    const error = section.element.querySelector(
      '.ai-settings-cron-job__edit-error',
    ) as HTMLElement;
    expect(error.style.display).not.toBe('none');
    expect(error.textContent).toContain('Could not parse');
    section.dispose();
  });

  it('cron:<expr> input is parsed as a cron schedule', () => {
    const { section, cronService } = buildSection([
      makeJob({ id: 'cron-1', name: 'test' }),
    ]);
    (Array.from(section.element.querySelectorAll('button')).find(
      b => b.textContent === 'Edit schedule',
    ) as HTMLButtonElement).click();

    const input = section.element.querySelector(
      '.ai-settings-cron-job__edit-input',
    ) as HTMLInputElement;
    input.value = 'cron:0 9 * * *';
    (Array.from(section.element.querySelectorAll('button')).find(
      b => b.textContent === 'Save',
    ) as HTMLButtonElement).click();

    expect(cronService.updateJob).toHaveBeenCalledWith('cron-1', { schedule: { cron: '0 9 * * *' } });
    section.dispose();
  });

  it('degrades gracefully without a CronService (headless tests, no panel)', () => {
    const service = createMockService();
    const section = new CronSection(service as any /* no cron service */);
    section.build();
    // Should still render the explanatory banners — just no list, no empty hint
    expect(section.element.querySelectorAll('.ai-settings-section__info').length).toBeGreaterThanOrEqual(2);
    expect(section.element.querySelectorAll('.ai-settings-cron-job').length).toBe(0);
    section.dispose();
  });
});
