// Worksheets offers "Review Due Flashcards" only while the Flashcards tool runs.
import { describe, it, expect, vi } from 'vitest';

vi.mock('../../src/built-in/worksheet/worksheetData.js', async (orig) => ({
  ...(await orig<object>()),
  getDailyDraw: vi.fn().mockResolvedValue(null),
  saveDailyDraw: vi.fn().mockResolvedValue(undefined),
}));

import { planDay } from '../../src/built-in/worksheet/dashboardPane.js';

const campaign = { startDay: '2026-10-01', days: 30, dailyTarget: 5, startedAt: Date.parse('2026-10-01T08:00:00'), restDays: [] };
const now = Date.parse('2026-10-04T12:00:00');
const base = { startQuiz: () => {}, resumeQuiz: () => {}, openSettings: () => {} };
const labels = (plan: Awaited<ReturnType<typeof planDay>>) =>
  [plan.actions.primary, ...plan.actions.secondary, ...plan.actions.quiet].filter(Boolean).map((a) => a!.label);

describe('Worksheets day plan and the Flashcards tool', () => {
  it('has no flashcards action while Flashcards is off', async () => {
    const plan = await planDay([], [], campaign, [], null, 0, base, now);
    expect(labels(plan)).not.toContain('Review Due Flashcards');
  });

  it('offers it, and runs Flashcards, while Flashcards is on', async () => {
    const study = vi.fn();
    const plan = await planDay([], [], campaign, [], null, 0, { ...base, studyFlashcards: study }, now);
    const action = plan.actions.secondary.find((a) => a.label === 'Review Due Flashcards');
    expect(action).toBeDefined();
    action!.onClick!();
    expect(study).toHaveBeenCalledOnce();
  });
});
