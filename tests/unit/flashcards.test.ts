// M93 â€” Flashcards extension: pure-logic tests via the __testables export
// (same pattern as budget-helpers.test.ts).
//
// Covers the SM-2 scheduler's full state machine (learning steps, graduation,
// review growth, lapses/relearning, ease floor, interval cap), the study
// queue builder, the AI-output JSON extractor, the reminder cron builder,
// and the stats aggregation.

import { describe, it, expect } from 'vitest';
// @ts-expect-error â€” JS module with no types
import { __testables } from '../../ext/flashcards/main.js';

const {
  fcSchedule,
  fcIntervalPreview,
  fcBuildQueue,
  fcExtractCardsJson,
  fcRepairLatexEscapes,
  fcReminderCron,
  fcParseTags,
  fcAggregateStats,
  FC_LEARNING_STEPS_MIN,
  FC_MIN_EASE,
  AGAIN, HARD, GOOD, EASY,
  MIN, DAY,
} = __testables;

const NOW = Date.parse('2026-07-22T12:00:00');

function newCard(overrides: Record<string, unknown> = {}) {
  return {
    state: 'new', ease: 2.5, intervalDays: 0, dueAt: 0,
    reps: 0, lapses: 0, learningStep: 0,
    ...overrides,
  };
}

// â”€â”€â”€ SM-2 scheduler â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€

describe('fcSchedule â€” learning', () => {
  it('new + Good enters learning at step 1 (second step)', () => {
    const s = fcSchedule(newCard(), GOOD, NOW);
    expect(s.state).toBe('learning');
    expect(s.learningStep).toBe(1);
    expect(s.dueAt).toBe(NOW + FC_LEARNING_STEPS_MIN[1] * MIN);
    expect(s.reps).toBe(1);
  });

  it('last learning step + Good graduates to review at 1 day', () => {
    const s = fcSchedule(newCard({ state: 'learning', learningStep: 1 }), GOOD, NOW);
    expect(s.state).toBe('review');
    expect(s.intervalDays).toBe(1);
    expect(s.dueAt).toBe(NOW + DAY);
  });

  it('new + Easy graduates immediately at 4 days', () => {
    const s = fcSchedule(newCard(), EASY, NOW);
    expect(s.state).toBe('review');
    expect(s.intervalDays).toBe(4);
    expect(s.dueAt).toBe(NOW + 4 * DAY);
  });

  it('Again resets to the first learning step', () => {
    const s = fcSchedule(newCard({ state: 'learning', learningStep: 1 }), AGAIN, NOW);
    expect(s.state).toBe('learning');
    expect(s.learningStep).toBe(0);
    expect(s.dueAt).toBe(NOW + FC_LEARNING_STEPS_MIN[0] * MIN);
  });

  it('Hard repeats the current step with a 1.5x delay', () => {
    const s = fcSchedule(newCard({ state: 'learning', learningStep: 1 }), HARD, NOW);
    expect(s.state).toBe('learning');
    expect(s.learningStep).toBe(1);
    expect(s.dueAt).toBe(NOW + FC_LEARNING_STEPS_MIN[1] * 1.5 * MIN);
  });
});

describe('fcSchedule â€” review', () => {
  const reviewCard = () => newCard({ state: 'review', intervalDays: 10, ease: 2.5, reps: 5 });

  it('Good multiplies the interval by ease', () => {
    const s = fcSchedule(reviewCard(), GOOD, NOW);
    expect(s.intervalDays).toBe(25);
    expect(s.dueAt).toBe(NOW + 25 * DAY);
    expect(s.ease).toBe(2.5);
    expect(s.state).toBe('review');
  });

  it('Hard grows slowly and drops ease', () => {
    const s = fcSchedule(reviewCard(), HARD, NOW);
    expect(s.intervalDays).toBe(12);
    expect(s.ease).toBeCloseTo(2.35, 5);
  });

  it('Easy grows fast and raises ease', () => {
    const s = fcSchedule(reviewCard(), EASY, NOW);
    expect(s.intervalDays).toBeCloseTo(10 * 2.5 * 1.3, 5);
    expect(s.ease).toBeCloseTo(2.65, 5);
  });

  it('Again lapses: relearning, halved interval, ease penalty, lapse count', () => {
    const s = fcSchedule(reviewCard(), AGAIN, NOW);
    expect(s.state).toBe('relearning');
    expect(s.lapses).toBe(1);
    expect(s.ease).toBeCloseTo(2.3, 5);
    expect(s.intervalDays).toBe(5);
    expect(s.dueAt).toBe(NOW + 10 * MIN);
  });

  it('ease never drops below the floor', () => {
    let card = newCard({ state: 'review', intervalDays: 10, ease: 1.35 });
    const s1 = fcSchedule(card, AGAIN, NOW);
    expect(s1.ease).toBe(FC_MIN_EASE);
    const s2 = fcSchedule({ ...s1, state: 'review' }, HARD, NOW);
    expect(s2.ease).toBe(FC_MIN_EASE);
  });

  it('interval caps at 100 years', () => {
    const s = fcSchedule(newCard({ state: 'review', intervalDays: 30000, ease: 2.5 }), GOOD, NOW);
    expect(s.intervalDays).toBe(36500);
  });
});

describe('fcSchedule â€” relearning', () => {
  const relearn = () => newCard({ state: 'relearning', intervalDays: 5, ease: 2.3, lapses: 1 });

  it('Good exits relearning with the stored interval', () => {
    const s = fcSchedule(relearn(), GOOD, NOW);
    expect(s.state).toBe('review');
    expect(s.intervalDays).toBe(5);
    expect(s.dueAt).toBe(NOW + 5 * DAY);
  });

  it('Easy exits with a 1.5x bonus', () => {
    const s = fcSchedule(relearn(), EASY, NOW);
    expect(s.state).toBe('review');
    expect(s.intervalDays).toBe(7.5);
  });

  it('Again stays in relearning at step 0', () => {
    const s = fcSchedule(relearn(), AGAIN, NOW);
    expect(s.state).toBe('relearning');
    expect(s.dueAt).toBe(NOW + 10 * MIN);
  });
});

describe('fcIntervalPreview', () => {
  it('formats minutes, days and months', () => {
    expect(fcIntervalPreview(newCard(), AGAIN, NOW)).toBe('1m');
    expect(fcIntervalPreview(newCard(), EASY, NOW)).toBe('4d');
    const big = newCard({ state: 'review', intervalDays: 100, ease: 2.5 });
    expect(fcIntervalPreview(big, GOOD, NOW)).toMatch(/mo$/);
  });
});

// â”€â”€â”€ Queue builder â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€

describe('fcBuildQueue', () => {
  const cards = [
    { id: 1, state: 'new', dueAt: 0, createdAt: 100, suspended: false },
    { id: 2, state: 'new', dueAt: 0, createdAt: 50, suspended: false },
    { id: 3, state: 'review', dueAt: NOW - 2 * DAY, suspended: false },
    { id: 4, state: 'review', dueAt: NOW - DAY, suspended: false },
    { id: 5, state: 'review', dueAt: NOW + DAY, suspended: false },   // not due
    { id: 6, state: 'learning', dueAt: NOW - MIN, suspended: false },
    { id: 7, state: 'relearning', dueAt: NOW - 2 * MIN, suspended: false },
    { id: 8, state: 'review', dueAt: NOW - DAY, suspended: true },    // suspended
  ];

  it('orders learning â†’ review (most overdue first) â†’ new (oldest first)', () => {
    const q = fcBuildQueue(cards, NOW);
    expect(q.map((c: { id: number }) => c.id)).toEqual([7, 6, 3, 4, 2, 1]);
  });

  it('respects new/review limits', () => {
    const q = fcBuildQueue(cards, NOW, { newLimit: 1, reviewLimit: 1 });
    expect(q.map((c: { id: number }) => c.id)).toEqual([7, 6, 3, 2]);
  });

  it('never surfaces suspended or future-due cards', () => {
    const ids = fcBuildQueue(cards, NOW).map((c: { id: number }) => c.id);
    expect(ids).not.toContain(5);
    expect(ids).not.toContain(8);
  });
});

// â”€â”€â”€ AI output extraction â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€

describe('fcExtractCardsJson', () => {
  it('parses a clean array', () => {
    const { cards, error } = fcExtractCardsJson('[{"front":"Q1","back":"A1","tags":["t"]}]');
    expect(error).toBeNull();
    expect(cards).toEqual([{ front: 'Q1', back: 'A1', tags: 't' }]);
  });

  it('parses fenced output with surrounding prose', () => {
    const raw = 'Here you go:\n```json\n[{"front":"Q","back":"A"}]\n```\nEnjoy!';
    const { cards } = fcExtractCardsJson(raw);
    expect(cards).toHaveLength(1);
    expect(cards[0].front).toBe('Q');
  });

  it('accepts question/answer and q/a aliases', () => {
    const { cards } = fcExtractCardsJson('[{"question":"Q","answer":"A"},{"q":"Q2","a":"A2"}]');
    expect(cards.map((c: { front: string }) => c.front)).toEqual(['Q', 'Q2']);
  });

  it('survives brackets inside strings', () => {
    const { cards } = fcExtractCardsJson('[{"front":"What is f[x]?","back":"a ] tricky [ one"}]');
    expect(cards).toHaveLength(1);
    expect(cards[0].back).toBe('a ] tricky [ one');
  });

  it('drops incomplete entries and reports empty results', () => {
    const { cards } = fcExtractCardsJson('[{"front":"only front"},{"front":"Q","back":"A"}]');
    expect(cards).toHaveLength(1);
    const bad = fcExtractCardsJson('no json here at all');
    expect(bad.cards).toEqual([]);
    expect(bad.error).toBeTruthy();
  });

  it('handles empty / garbage input without throwing', () => {
    expect(fcExtractCardsJson('').cards).toEqual([]);
    expect(fcExtractCardsJson('[[[').cards).toEqual([]);
    expect(fcExtractCardsJson('[]').cards).toEqual([]);
  });

  it('ignores inline <think> reasoning blocks (thinking models)', () => {
    const raw = '<think>Let me plan. The material cites [1] and [2]...</think>\n[{"front":"Q","back":"A"}]';
    const { cards, error } = fcExtractCardsJson(raw);
    expect(error).toBeNull();
    expect(cards).toEqual([{ front: 'Q', back: 'A', tags: '' }]);
    // Unterminated think head (streaming cut the open tag away).
    const cut = 'reasoning about [3] here</think>[{"front":"Q2","back":"A2"}]';
    expect(fcExtractCardsJson(cut).cards[0].front).toBe('Q2');
  });

  it('skips citation brackets in prose and finds the real array', () => {
    const raw = 'As shown in [1], the method [2] applies.\n[{"front":"Q","back":"A"}]\nDone.';
    const { cards, error } = fcExtractCardsJson(raw);
    expect(error).toBeNull();
    expect(cards).toHaveLength(1);
    expect(cards[0].front).toBe('Q');
  });

  it('reports a truncation-shaped error for a cut-off array', () => {
    const { error } = fcExtractCardsJson('[{"front":"Q","back":"A"},{"front":"Q2","ba');
    expect(error).toContain('cut off');
  });
});

// â”€â”€â”€ Reminder cron â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€

describe('fcReminderCron', () => {
  it('builds a daily cron from HH:MM', () => {
    expect(fcReminderCron('09:00')).toBe('0 9 * * *');
    expect(fcReminderCron('18:45')).toBe('45 18 * * *');
  });
  it('rejects malformed times', () => {
    expect(fcReminderCron('25:00')).toBeNull();
    expect(fcReminderCron('9am')).toBeNull();
    expect(fcReminderCron('')).toBeNull();
  });
});

describe('fcContextPlan', () => {
  const { fcContextPlan, FC_CHARS_PER_TOKEN, FC_SCAFFOLD_TOKENS, FC_FALLBACK_MODEL_CTX } = __testables;

  it('sizes the window to document + output, not a fixed constant', () => {
    // The regression that motivated this: a 38,263-char PDF tokenized to
    // 15,709 tokens (~2.44 chars/token), filling a fixed 16,384 window
    // almost entirely â€” the model was hard-stopped 674 tokens into its
    // JSON. The plan must leave the full output reserve on top.
    const { numCtx, maxChars, outputTokens } = fcContextPlan({
      chars: 38_263, count: 15, modelCtx: 262_144, setting: 0,
    });
    const promptEstimate = Math.ceil(38_263 / FC_CHARS_PER_TOKEN) + FC_SCAFFOLD_TOKENS;
    expect(numCtx).toBeGreaterThanOrEqual(promptEstimate + outputTokens);
    expect(numCtx % 2048).toBe(0);
    expect(maxChars).toBeGreaterThanOrEqual(38_263); // whole doc fits, no clip
  });

  it('requests only what the job needs, never the model maximum', () => {
    const { numCtx } = fcContextPlan({ chars: 2_000, count: 10, modelCtx: 262_144, setting: 0 });
    expect(numCtx).toBe(8192); // floor â€” tiny note must not allocate a 262K KV cache
  });

  it('clamps to the model ceiling and clips material to fit', () => {
    const { numCtx, maxChars } = fcContextPlan({
      chars: 500_000, count: 15, modelCtx: 32_768, setting: 0,
    });
    expect(numCtx).toBe(32_768);
    // Clip limit leaves the output reserve inside the ceiling.
    expect(maxChars).toBeLessThan(500_000);
    expect(maxChars).toBe(Math.floor((32_768 - FC_SCAFFOLD_TOKENS - (1500 + 220 * 15)) * FC_CHARS_PER_TOKEN));
  });

  it('honors an explicit user override, still capped by the model', () => {
    expect(fcContextPlan({ chars: 1_000, count: 5, modelCtx: 262_144, setting: 16_384 }).numCtx).toBe(16_384);
    expect(fcContextPlan({ chars: 1_000, count: 5, modelCtx: 8_192, setting: 128_000 }).numCtx).toBe(8_192);
  });

  it('assumes a large fallback ceiling when the model probe fails', () => {
    const { numCtx } = fcContextPlan({ chars: 1_000_000, count: 15, modelCtx: 0, setting: 0 });
    expect(numCtx).toBe(FC_FALLBACK_MODEL_CTX);
  });

  it('scales the output reserve with the requested card count', () => {
    const few = fcContextPlan({ chars: 100_000, count: 5, modelCtx: 262_144, setting: 0 });
    const many = fcContextPlan({ chars: 100_000, count: 50, modelCtx: 262_144, setting: 0 });
    expect(many.outputTokens).toBeGreaterThan(few.outputTokens);
    expect(many.maxChars).toBeLessThan(few.maxChars);
  });
});

describe('fcParseTags', () => {
  it('splits and trims', () => {
    expect(fcParseTags(' a, b ,,c ')).toEqual(['a', 'b', 'c']);
    expect(fcParseTags('')).toEqual([]);
  });
});

// â”€â”€â”€ Stats aggregation â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€

describe('fcAggregateStats', () => {
  const startOfToday = (() => {
    const d = new Date(NOW);
    d.setHours(0, 0, 0, 0);
    return d.getTime();
  })();

  const cards = [
    { state: 'new', suspended: false },
    { state: 'new', suspended: false },
    { state: 'learning', suspended: false },
    { state: 'review', suspended: false },
    { state: 'review', suspended: true },
  ];

  it('counts cards by stage with suspended separated', () => {
    const s = fcAggregateStats([], cards, NOW);
    expect(s.counts).toEqual({ new: 2, learning: 1, review: 1, relearning: 0, suspended: 1, total: 5 });
  });

  it('tracks today\'s reviews and correctness', () => {
    const reviews = [
      { reviewedAt: startOfToday + 3600_000, rating: GOOD, stateBefore: 'review' },
      { reviewedAt: startOfToday + 3700_000, rating: AGAIN, stateBefore: 'review' },
      { reviewedAt: startOfToday - DAY, rating: GOOD, stateBefore: 'review' }, // yesterday
    ];
    const s = fcAggregateStats(reviews, cards, NOW);
    expect(s.today.reviews).toBe(2);
    expect(s.today.correctPct).toBe(50);
  });

  it('retention counts only review-state cards (learning failures excluded)', () => {
    const reviews = [
      { reviewedAt: NOW - DAY, rating: GOOD, stateBefore: 'review' },
      { reviewedAt: NOW - DAY, rating: GOOD, stateBefore: 'review' },
      { reviewedAt: NOW - DAY, rating: AGAIN, stateBefore: 'review' },
      { reviewedAt: NOW - DAY, rating: AGAIN, stateBefore: 'learning' }, // ignored
      { reviewedAt: NOW - DAY, rating: AGAIN, stateBefore: 'new' },      // ignored
    ];
    const s = fcAggregateStats(reviews, cards, NOW);
    expect(s.retention30).toBe(67);
  });

  it('produces a 30-day series ending today', () => {
    const s = fcAggregateStats([], cards, NOW);
    expect(s.last30).toHaveLength(30);
    expect(s.last30[29].day).toBe(startOfToday);
  });

  it('null percentages when there is no data', () => {
    const s = fcAggregateStats([], [], NOW);
    expect(s.today.correctPct).toBeNull();
    expect(s.retention30).toBeNull();
  });
});

// ─── LaTeX survival through the JSON layer ───────────────────────────────────
//
// The generation prompt demands LaTeX, the renderer speaks LaTeX, and strict
// JSON.parse sat between them destroying it: a single-backslash \sigma is an
// invalid escape (throws — whole batch lost) while \frac / \theta / \beta are
// VALID escapes (formfeed/tab/backspace) that silently parse into
// control-character garbage.

describe('fcRepairLatexEscapes', () => {
  it('repairs invalid escapes that would make JSON.parse throw', () => {
    const raw = String.raw`[{"front":"$\sigma^2$","back":"$\lambda$"}]`;
    expect(() => JSON.parse(raw)).toThrow();
    const parsed = JSON.parse(fcRepairLatexEscapes(raw));
    expect(parsed[0].front).toBe(String.raw`$\sigma^2$`);
    expect(parsed[0].back).toBe(String.raw`$\lambda$`);
  });

  it('rescues valid-but-wrong escapes inside math (\\frac is a command, not formfeed)', () => {
    const raw = String.raw`[{"front":"$\frac{a}{b} \neq \theta$","back":"x"}]`;
    const parsed = JSON.parse(fcRepairLatexEscapes(raw));
    expect(parsed[0].front).toBe(String.raw`$\frac{a}{b} \neq \theta$`);
  });

  it('keeps an intended newline OUTSIDE math as a newline', () => {
    const raw = String.raw`[{"front":"line one\nline two","back":"x"}]`;
    const parsed = JSON.parse(fcRepairLatexEscapes(raw));
    expect(parsed[0].front).toBe('line one\nline two');
  });

  it('passes correctly double-escaped output through untouched', () => {
    const raw = String.raw`[{"front":"$\\frac{a}{b}$","back":"café"}]`;
    expect(fcRepairLatexEscapes(raw)).toBe(raw);
    expect(JSON.parse(fcRepairLatexEscapes(raw))[0].back).toBe('café');
  });

  it('treats $$ display math as one delimiter, repairing commands inside', () => {
    const raw = String.raw`[{"front":"$$\sum_{i=1}^{n} \beta_i$$","back":"x"}]`;
    const parsed = JSON.parse(fcRepairLatexEscapes(raw));
    expect(parsed[0].front).toBe(String.raw`$$\sum_{i=1}^{n} \beta_i$$`);
  });
});

describe('fcExtractCardsJson + LaTeX', () => {
  it('extracts cards whose formulas the model wrote with single backslashes', () => {
    const output = 'Here are the cards:\n'
      + String.raw`[{"front":"What is the Mack variance estimator?","back":"$\hat{\sigma}^2 = \frac{1}{n-1}\sum (f_i - \bar{f})^2$","tags":["mack"]}]`;
    const { cards, error } = fcExtractCardsJson(output);
    expect(error).toBeNull();
    expect(cards).toHaveLength(1);
    expect(cards[0].back).toContain(String.raw`\hat{\sigma}^2`);
    expect(cards[0].back).toContain(String.raw`\frac{1}{n-1}`);
    expect(cards[0].back).not.toMatch(/[\f\b\t]/);
  });
});
