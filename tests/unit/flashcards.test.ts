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
  fcScheduleFsrs,
  fcReplayFsrs,
  fcRetrievability,
  fcFsrsInterval,
  fcFsrsInitDifficulty,
  fcFsrsNextDifficulty,
  fcDeadlineCapDays,
  FSRS_W,
  fcIntervalPreview,
  fcBuildQueue,
  fcBuildCustomQueue,
  fcCustomIsPreview,
  fcCountServedToday,
  fcPacePlan,
  fcNewAllowances,
  fcNormalizeImportance,
  FC_FLAGS,
  fcNormalizeFlag,
  fcFlagDef,
  fcBuildMaterial,
  fcBuildMaterialDocs,
  fcClusterPairs,
  fcTrigramPairs,
  fcExtractJsonArray,
  fcTrigramSimilarity,
  fcStreamWithStall,
  fcParseClozeIndices,
  fcRenderCloze,
  fcExtractCardsJson,
  fcRepairLatexEscapes,
  fcNormalizeCardText,
  fcAutoCardEstimate,
  fcReminderCron,
  fcParseTags,
  fcAggregateStats,
  FC_NAV_DEFS,
  FC_VIEW_LABELS,
  FC_DECK_VIEWS,
  fcNavViewFor,
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

describe('fcIntervalPreview (FSRS-backed since M98)', () => {
  it('formats minutes, days and months', () => {
    // New + Again → first learning step (1 minute), unchanged by FSRS.
    expect(fcIntervalPreview(newCard(), AGAIN, NOW)).toBe('1m');
    // New + Easy graduates at I(0.9, S0(Easy) = w[3] ≈ 8.30) = 8 days.
    expect(fcIntervalPreview(newCard(), EASY, NOW)).toBe('8d');
    // Mature card: high stability grows further → months.
    const big = newCard({ state: 'review', intervalDays: 100, stability: 100, difficulty: 4, reps: 5 });
    expect(fcIntervalPreview(big, GOOD, NOW)).toMatch(/mo$/);
  });
});

// ─── FSRS-6 (M98) ────────────────────────────────────────────────────────────
// Vectors hand-derived from the py-fsrs formulas with the default 21 weights;
// there is no library oracle in-repo, so exact-value pins use the formulas
// re-computed independently, and the rest are property pins.

describe('FSRS-6 primitives', () => {
  it('R(S, S) = 0.9 exactly — the defining calibration', () => {
    for (const s of [0.5, 1, 2.3065, 10, 100, 3650]) {
      expect(fcRetrievability(s, s)).toBeCloseTo(0.9, 9);
    }
  });

  it('R(0, S) = 1 and R decreases with elapsed time', () => {
    expect(fcRetrievability(0, 10)).toBeCloseTo(1, 9);
    const r1 = fcRetrievability(1, 10);
    const r10 = fcRetrievability(10, 10);
    const r100 = fcRetrievability(100, 10);
    expect(r1).toBeGreaterThan(r10);
    expect(r10).toBeGreaterThan(r100);
  });

  it('interval at desired retention 0.9 equals stability (rounded)', () => {
    expect(fcFsrsInterval(0.9, 10)).toBe(10);
    expect(fcFsrsInterval(0.9, 2.3065)).toBe(2);
    expect(fcFsrsInterval(0.9, 0.4)).toBe(1); // floor at 1 day
  });

  it('higher desired retention shortens the interval', () => {
    expect(fcFsrsInterval(0.95, 10)).toBeLessThan(fcFsrsInterval(0.9, 10));
    expect(fcFsrsInterval(0.9, 10)).toBeLessThan(fcFsrsInterval(0.8, 10));
  });

  it('initial stability comes from w[0..3] and initial difficulty from w[4]', () => {
    const first = (g: number) => fcScheduleFsrs(newCard(), g, NOW);
    expect(first(AGAIN).stability).toBeCloseTo(FSRS_W[0], 6);
    expect(first(HARD).stability).toBeCloseTo(FSRS_W[1], 6);
    expect(first(GOOD).stability).toBeCloseTo(FSRS_W[2], 6);
    expect(first(EASY).stability).toBeCloseTo(FSRS_W[3], 6);
    expect(fcFsrsInitDifficulty(AGAIN)).toBeCloseTo(FSRS_W[4], 6);
  });

  it('difficulty: Again raises, Easy lowers, always clamped to [1, 10]', () => {
    const d = 5;
    expect(fcFsrsNextDifficulty(d, AGAIN)).toBeGreaterThan(d);
    expect(fcFsrsNextDifficulty(d, EASY)).toBeLessThan(d);
    expect(fcFsrsNextDifficulty(10, AGAIN)).toBeLessThanOrEqual(10);
    expect(fcFsrsNextDifficulty(1, EASY)).toBeGreaterThanOrEqual(1);
  });
});

describe('fcScheduleFsrs — state machine + stability evolution', () => {
  it('learning steps still run intra-day: new + Good → step 1 at 10 minutes', () => {
    const s = fcScheduleFsrs(newCard(), GOOD, NOW);
    expect(s.state).toBe('learning');
    expect(s.learningStep).toBe(1);
    expect(s.dueAt).toBe(NOW + FC_LEARNING_STEPS_MIN[1] * MIN);
    expect(s.stability).toBeCloseTo(FSRS_W[2], 6);
  });

  it('graduating Good-then-Good lands a ~2 day first interval (S0(Good) ≈ 2.31)', () => {
    const step1 = fcScheduleFsrs(newCard(), GOOD, NOW);
    const grad = fcScheduleFsrs(step1, GOOD, NOW + 10 * MIN);
    expect(grad.state).toBe('review');
    expect(grad.intervalDays).toBe(2);
    // Same-day Good never shrinks stability (short-term multiplier floored at 1).
    expect(grad.stability).toBeGreaterThanOrEqual(step1.stability);
  });

  it('on-time Good review grows stability (spacing effect vector)', () => {
    // Card at S = 2.3065, D = D0(Good), reviewed exactly at S days (R = 0.9):
    // growth = e^w8 · (11−D) · S^−w9 · (e^(w10·0.1) − 1) ⇒ S' ≈ 11.9 (hand-derived).
    const d0Good = fcFsrsInitDifficulty(GOOD);
    const card = newCard({
      state: 'review', stability: 2.3065, difficulty: d0Good,
      intervalDays: 2, lastReviewedAt: NOW - 2.3065 * DAY, reps: 2,
    });
    const s = fcScheduleFsrs(card, GOOD, NOW);
    expect(s.stability).toBeGreaterThan(10);
    expect(s.stability).toBeLessThan(14);
    expect(s.intervalDays).toBe(fcFsrsInterval(0.9, s.stability));
  });

  it('interval ordering: Easy ≥ Good ≥ Hard for the same review', () => {
    const card = newCard({
      state: 'review', stability: 10, difficulty: 5,
      intervalDays: 10, lastReviewedAt: NOW - 10 * DAY, reps: 3,
    });
    const hard = fcScheduleFsrs(card, HARD, NOW);
    const good = fcScheduleFsrs(card, GOOD, NOW);
    const easy = fcScheduleFsrs(card, EASY, NOW);
    expect(easy.intervalDays).toBeGreaterThanOrEqual(good.intervalDays);
    expect(good.intervalDays).toBeGreaterThanOrEqual(hard.intervalDays);
  });

  it('a lapse shrinks stability, never grows it, and enters relearning at 10m', () => {
    const card = newCard({
      state: 'review', stability: 20, difficulty: 5,
      intervalDays: 20, lastReviewedAt: NOW - 20 * DAY, reps: 4, lapses: 0,
    });
    const s = fcScheduleFsrs(card, AGAIN, NOW);
    expect(s.state).toBe('relearning');
    expect(s.lapses).toBe(1);
    expect(s.stability).toBeLessThan(20);
    expect(s.dueAt).toBe(NOW + 10 * MIN);
  });

  it('legacy card without stability is treated as a first FSRS review', () => {
    const legacy = newCard({ state: 'review', intervalDays: 30, ease: 2.7, reps: 9 });
    const s = fcScheduleFsrs(legacy, GOOD, NOW);
    expect(s.stability).toBeCloseTo(FSRS_W[2], 6);
    expect(s.difficulty).toBeGreaterThan(0);
  });
});

describe('fcScheduleFsrs — deadline cap (exam date)', () => {
  it('caps the interval to half the remaining runway', () => {
    expect(fcDeadlineCapDays(NOW + 20 * DAY, NOW)).toBe(10);
    expect(fcDeadlineCapDays(NOW + 1 * DAY, NOW)).toBe(1);
    expect(fcDeadlineCapDays(0, NOW)).toBe(Infinity);
    expect(fcDeadlineCapDays(NOW - DAY, NOW)).toBe(Infinity); // exam passed
  });

  it('a mature card cannot be scheduled past the cap', () => {
    const card = newCard({
      state: 'review', stability: 200, difficulty: 3,
      intervalDays: 180, lastReviewedAt: NOW - 180 * DAY, reps: 10,
    });
    const uncapped = fcScheduleFsrs(card, EASY, NOW);
    const capped = fcScheduleFsrs(card, EASY, NOW, { examDate: NOW + 20 * DAY });
    expect(uncapped.intervalDays).toBeGreaterThan(10);
    expect(capped.intervalDays).toBeLessThanOrEqual(10);
    // Stability itself is NOT capped — only the visible interval.
    expect(capped.stability).toBeCloseTo(uncapped.stability, 6);
  });

  it('per-deck desired retention tightens intervals', () => {
    const card = newCard({
      state: 'review', stability: 30, difficulty: 5,
      intervalDays: 30, lastReviewedAt: NOW - 30 * DAY, reps: 6,
    });
    const normal = fcScheduleFsrs(card, GOOD, NOW, { desiredRetention: 0.9 });
    const strict = fcScheduleFsrs(card, GOOD, NOW, { desiredRetention: 0.95 });
    expect(strict.intervalDays).toBeLessThan(normal.intervalDays);
  });
});

// ─── M98 grounding + dedup primitives ────────────────────────────────────────

describe('fcBuildMaterial', () => {
  it('without pages: plain clip with a truncation marker', () => {
    const { material, paged, clipped } = fcBuildMaterial('abcdef', null, 4);
    expect(paged).toBe(false);
    expect(clipped).toBe(true);
    expect(material.startsWith('abcd')).toBe(true);
    expect(material).toContain('[...material truncated...]');
  });

  it('tags each page with its 1-based number', () => {
    const { material, paged } = fcBuildMaterial('', ['first page', 'second page'], 10_000);
    expect(paged).toBe(true);
    expect(material).toContain('[Page 1]\nfirst page');
    expect(material).toContain('[Page 2]\nsecond page');
  });

  it('honors a page offset so markers match the real PDF pages', () => {
    const { material } = fcBuildMaterial('', ['x', 'y'], 10_000, 10);
    expect(material).toContain('[Page 11]');
    expect(material).toContain('[Page 12]');
  });

  it('skips empty pages without renumbering the rest', () => {
    const { material } = fcBuildMaterial('', ['a', '   ', 'c'], 10_000);
    expect(material).not.toContain('[Page 2]');
    expect(material).toContain('[Page 3]\nc');
  });

  it('clips on a page boundary rather than mid-marker', () => {
    const page = 'z'.repeat(300);
    const { material, clipped } = fcBuildMaterial('', [page, page, page], 700);
    expect(clipped).toBe(true);
    expect(material).toContain('[Page 1]');
    expect(material).toContain('[...material truncated...]');
  });
});

describe('fcExtractCardsJson — truncation salvage', () => {
  it('recovers every complete card from an unterminated array', () => {
    // What a window-filled response actually looks like: complete objects,
    // then a cut mid-object, no closing bracket.
    const cut = '[{"front":"Q1","back":"A1","tags":["t"]},'
      + '{"front":"Q2","back":"A2","tags":["u","v"],"importance":90,"importanceReason":"core"},'
      + '{"front":"Q3","back":"A3 got cut off her';
    const { cards, error, truncated } = fcExtractCardsJson(cut);
    expect(error).toBeNull();
    expect(truncated).toBe(true);
    expect(cards).toHaveLength(2);
    expect(cards[0].front).toBe('Q1');
    expect(cards[1].importance).toBe(90);
  });

  it('nested tag arrays do not confuse the object-boundary walker', () => {
    const cut = '[{"front":"Q1","back":"A1","tags":["a","b","c"]},{"front":"Q2","back":"A2","tags":["d"';
    const { cards, truncated } = fcExtractCardsJson(cut);
    expect(truncated).toBe(true);
    expect(cards).toHaveLength(1);
    expect(cards[0].front).toBe('Q1');
  });

  it('still errors when nothing is salvageable', () => {
    const { cards, error, truncated } = fcExtractCardsJson('[{"front":"only one, cut mi');
    expect(cards).toHaveLength(0);
    expect(error).toMatch(/Unterminated/);
    expect(truncated).toBe(true);
  });

  it('a complete response reports truncated: false', () => {
    const { truncated } = fcExtractCardsJson('[{"front":"Q","back":"A"}]');
    expect(truncated).toBe(false);
  });
});

describe('fcExtractCardsJson — importance (M101)', () => {
  it('reads a per-card importance and reason', () => {
    const { cards } = fcExtractCardsJson('[{"front":"Q","back":"A","importance":92,"importanceReason":"core formula"}]');
    expect(cards[0].importance).toBe(92);
    expect(cards[0].importanceReason).toBe('core formula');
  });

  it('clamps importance above 100 and drops unusable values', () => {
    const { cards } = fcExtractCardsJson('[{"front":"Q","back":"A","importance":250},{"front":"Q2","back":"A2","importance":"x"},{"front":"Q3","back":"A3"}]');
    expect(cards[0].importance).toBe(100);
    expect(cards[1].importance).toBeUndefined();
    expect(cards[2].importance).toBeUndefined();
  });
});

describe('fcExtractCardsJson — page attribution', () => {
  it('reads a per-card page number', () => {
    const { cards } = fcExtractCardsJson('[{"front":"Q","back":"A","page":12}]');
    expect(cards[0].page).toBe(12);
  });

  it('ignores non-integer or non-positive pages', () => {
    const { cards } = fcExtractCardsJson('[{"front":"Q","back":"A","page":-3},{"front":"Q2","back":"A2","page":"x"}]');
    expect(cards[0].page).toBeUndefined();
    expect(cards[1].page).toBeUndefined();
  });

  it('reads a per-card doc index (multi-source generation)', () => {
    const { cards } = fcExtractCardsJson('[{"front":"Q","back":"A","doc":2,"page":3},{"front":"Q2","back":"A2","doc":"x"}]');
    expect(cards[0].doc).toBe(2);
    expect(cards[0].page).toBe(3);
    expect(cards[1].doc).toBeUndefined();
  });
});

describe('fcBuildMaterialDocs — multi-document material', () => {
  it('tags each doc with a header and restarts page numbers per doc', () => {
    const { material, anyPaged, docCount } = fcBuildMaterialDocs([
      { label: 'Mack Paper', text: '', pageTexts: ['mack page one', 'mack page two'] },
      { label: 'RF Cookbook', text: 'flat cookbook text', pageTexts: null },
    ], 100_000);
    expect(docCount).toBe(2);
    expect(anyPaged).toBe(true);
    expect(material).toContain('[Doc 1: Mack Paper]');
    expect(material).toContain('[Doc 2: RF Cookbook]');
    // Pages restart inside each doc — doc 2 is unpaged, doc 1 owns [Page 1].
    expect(material.indexOf('[Page 1]\nmack page one')).toBeGreaterThan(material.indexOf('[Doc 1:'));
    expect(material).toContain('flat cookbook text');
  });

  it('clips whole docs against the budget with the truncation marker', () => {
    const big = 'x'.repeat(500);
    const { material, clipped } = fcBuildMaterialDocs([
      { label: 'A', text: big, pageTexts: null },
      { label: 'B', text: big, pageTexts: null },
    ], 550);
    expect(clipped).toBe(true);
    expect(material).toContain('[Doc 1: A]');
    expect(material).not.toContain('[Doc 2: B]');
    expect(material).toContain('[...material truncated...]');
  });
});

describe('fcClusterPairs — union-find duplicate clustering', () => {
  it('merges transitive chains into one cluster sorted by similarity', () => {
    const clusters = fcClusterPairs([
      { a: 1, b: 2, similarity: 0.9 },
      { a: 2, b: 3, similarity: 0.85 },
      { a: 10, b: 11, similarity: 0.95 },
    ]);
    expect(clusters).toHaveLength(2);
    expect(clusters[0].cardIds).toEqual([10, 11]); // strongest first
    expect(clusters[0].similarity).toBe(0.95);
    expect(clusters[1].cardIds).toEqual([1, 2, 3]);
  });

  it('returns nothing for no pairs', () => {
    expect(fcClusterPairs([])).toEqual([]);
  });
});

describe('fcTrigramPairs — deck-wide pairwise sweep', () => {
  const card = (id: number, front: string, noteGroup = '') => ({ id, front, back: 'same back text for overlap', noteGroup });

  it('finds canonical pairs above the threshold', () => {
    const pairs = fcTrigramPairs([
      card(5, 'What is the Mack chain ladder assumption about development factors?'),
      card(2, 'What is the Mack chain ladder assumption about development factors, exactly?'),
      card(9, 'Completely unrelated question about Bayesian priors and hierarchies'),
    ], 0.5);
    expect(pairs).toHaveLength(1);
    expect(pairs[0].a).toBe(2); // canonical a < b
    expect(pairs[0].b).toBe(5);
    expect(pairs[0].similarity).toBeGreaterThan(0.5);
  });

  it('never pairs cloze/reverse siblings (shared note group)', () => {
    const pairs = fcTrigramPairs([
      card(1, 'The {{c1::Mack}} method assumes independent accident years', 'grp-1'),
      card(2, 'The {{c2::Mack}} method assumes independent accident years', 'grp-1'),
    ], 0.3);
    expect(pairs).toEqual([]);
  });
});

describe('fcExtractJsonArray — shared array scanner', () => {
  it('maps arbitrary object shapes via mapSlice (judge verdicts)', () => {
    const raw = 'Sure!\n```json\n[{"cluster":1,"verdict":"duplicate","keepId":7}]\n```';
    const { items, error } = fcExtractJsonArray(raw, (parsed: unknown[]) =>
      parsed.map((v) => ({ cluster: (v as { cluster: number }).cluster, verdict: (v as { verdict: string }).verdict })));
    expect(error).toBeNull();
    expect(items).toEqual([{ cluster: 1, verdict: 'duplicate' }]);
  });

  it('repairs LaTeX escapes before parsing, like the card path', () => {
    const raw = '[{"cluster":1,"reason":"both test $\\sigma^2$"}]';
    const { items } = fcExtractJsonArray(raw, (parsed: unknown[]) => parsed);
    expect((items[0] as { reason: string }).reason).toContain('\\sigma');
  });
});

describe('fcTrigramSimilarity', () => {
  it('identical text scores 1, unrelated text scores near 0', () => {
    const a = 'What is the Bornhuetter-Ferguson expected loss ratio?';
    expect(fcTrigramSimilarity(a, a)).toBe(1);
    expect(fcTrigramSimilarity(a, 'Photosynthesis converts light to sugar')).toBeLessThan(0.1);
  });

  it('near-duplicates with small wording changes score high', () => {
    const a = 'Define the Bornhuetter-Ferguson method reserve estimate';
    const b = 'Define the Bornhuetter-Ferguson method reserve estimate.';
    expect(fcTrigramSimilarity(a, b)).toBeGreaterThan(0.85);
  });

  it('empty input scores 0', () => {
    expect(fcTrigramSimilarity('', 'anything')).toBe(0);
  });
});

describe('fcStreamWithStall', () => {
  it('consumes a healthy stream to completion', async () => {
    async function* stream() { yield { content: 'a' }; yield { content: 'b' }; }
    let out = '';
    await fcStreamWithStall(stream(), (c: { content: string }) => { out += c.content; }, 1000);
    expect(out).toBe('ab');
  });

  it('throws when the stream stalls past the watchdog', async () => {
    async function* stalled() {
      yield { content: 'x' };
      await new Promise((r) => setTimeout(r, 300));
      yield { content: 'never-delivered' };
    }
    let out = '';
    await expect(
      fcStreamWithStall(stalled(), (c: { content: string }) => { out += c.content; }, 50),
    ).rejects.toThrow(/stopped responding/);
    expect(out).toBe('x');
  });

  it('gives the FIRST chunk a longer leash than later chunks (cold model load)', async () => {
    const delay = (ms: number) => new Promise((r) => setTimeout(r, ms));
    async function* slowLoad() {
      await delay(80);           // slower than stallMs, within firstChunkMs
      yield { content: 'loaded' };
      await delay(10);           // fast once warm
      yield { content: '!' };
    }
    let out = '';
    await fcStreamWithStall(slowLoad(), (c: { content: string }) => { out += c.content; }, 40, 500);
    expect(out).toBe('loaded!');
  });

  it('still stalls between chunks even when the first-chunk leash is long', async () => {
    const delay = (ms: number) => new Promise((r) => setTimeout(r, ms));
    async function* warmThenDead() {
      yield { content: 'warm' };
      await delay(300);          // past stallMs — the leash no longer applies
      yield { content: 'never-delivered' };
    }
    let out = '';
    await expect(
      fcStreamWithStall(warmThenDead(), (c: { content: string }) => { out += c.content; }, 50, 10_000),
    ).rejects.toThrow(/stopped responding/);
    expect(out).toBe('warm');
  });
});

// ─── M98 cloze notes ─────────────────────────────────────────────────────────

describe('fcParseClozeIndices', () => {
  it('finds distinct ordinals, sorted, deduped', () => {
    expect(fcParseClozeIndices('The {{c2::BF}} method uses {{c1::a priori}} and {{c1::development}}.'))
      .toEqual([1, 2]);
  });

  it('returns empty for plain text and malformed markers', () => {
    expect(fcParseClozeIndices('No cloze here')).toEqual([]);
    expect(fcParseClozeIndices('{{c::missing number}} {{d1::wrong letter}}')).toEqual([]);
  });

  it('tolerates LaTeX inside the answer', () => {
    expect(fcParseClozeIndices('ELR is {{c1::$\\frac{L}{P}$}}')).toEqual([1]);
  });
});

describe('fcRenderCloze', () => {
  const note = 'The {{c1::Bornhuetter-Ferguson}} method blends {{c2::expected losses::what kind?}} with actuals.';

  it('front blanks only the target ordinal', () => {
    const front = fcRenderCloze(note, 1, 'front');
    expect(front).toContain('**[...]**');
    expect(front).not.toContain('Bornhuetter-Ferguson');
    expect(front).toContain('expected losses'); // other ordinal revealed
  });

  it('front shows the hint when one exists', () => {
    const front = fcRenderCloze(note, 2, 'front');
    expect(front).toContain('**[what kind?]**');
    expect(front).toContain('Bornhuetter-Ferguson');
  });

  it('back reveals everything and bolds the target', () => {
    const back = fcRenderCloze(note, 1, 'back');
    expect(back).toContain('**Bornhuetter-Ferguson**');
    expect(back).toContain('expected losses');
    expect(back).not.toContain('{{');
  });

  it('keeps LaTeX answers intact', () => {
    const out = fcRenderCloze('ELR is {{c1::$\\frac{L}{P}$}}', 1, 'back');
    expect(out).toContain('**$\\frac{L}{P}$**');
  });
});

describe('fcReplayFsrs — SM-2 history migration', () => {
  it('replays a review history into finite S/D and stamps lastReviewedAt', () => {
    const t0 = NOW - 30 * DAY;
    const reviews = [
      { reviewedAt: t0, rating: GOOD },
      { reviewedAt: t0 + 10 * MIN, rating: GOOD },
      { reviewedAt: t0 + 2 * DAY, rating: GOOD },
      { reviewedAt: t0 + 9 * DAY, rating: AGAIN },
      { reviewedAt: t0 + 9 * DAY + 10 * MIN, rating: GOOD },
      { reviewedAt: t0 + 14 * DAY, rating: EASY },
    ];
    const out = fcReplayFsrs(reviews);
    expect(out.stability).toBeGreaterThan(0);
    expect(Number.isFinite(out.stability)).toBe(true);
    expect(out.difficulty).toBeGreaterThanOrEqual(1);
    expect(out.difficulty).toBeLessThanOrEqual(10);
    expect(out.lastReviewedAt).toBe(t0 + 14 * DAY);
  });

  it('an all-Again history yields lower stability than an all-Good one', () => {
    const t0 = NOW - 20 * DAY;
    const mk = (rating: number) => [
      { reviewedAt: t0, rating },
      { reviewedAt: t0 + 1 * DAY, rating },
      { reviewedAt: t0 + 3 * DAY, rating },
      { reviewedAt: t0 + 7 * DAY, rating },
    ];
    const struggling = fcReplayFsrs(mk(AGAIN));
    const solid = fcReplayFsrs(mk(GOOD));
    expect(struggling.stability).toBeLessThan(solid.stability);
    expect(struggling.difficulty).toBeGreaterThan(solid.difficulty);
  });

  it('empty history leaves the card new', () => {
    const out = fcReplayFsrs([]);
    expect(out.stability).toBe(0);
    expect(out.lastReviewedAt).toBe(0);
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

  it('introduces new cards by importance before age; unscored cards last (M101)', () => {
    const scored = [
      { id: 1, state: 'new', dueAt: 0, createdAt: 10, importance: 0, suspended: false },
      { id: 2, state: 'new', dueAt: 0, createdAt: 20, importance: 95, suspended: false },
      { id: 3, state: 'new', dueAt: 0, createdAt: 30, importance: 60, suspended: false },
      { id: 4, state: 'new', dueAt: 0, createdAt: 5, importance: 60, suspended: false },
    ];
    const q = fcBuildQueue(scored, NOW);
    expect(q.map((c: { id: number }) => c.id)).toEqual([2, 4, 3, 1]);
  });

  it('flags still outrank importance in the new band', () => {
    const mixed = [
      { id: 1, state: 'new', dueAt: 0, createdAt: 10, importance: 99, flag: 0, suspended: false },
      { id: 2, state: 'new', dueAt: 0, createdAt: 20, importance: 10, flag: 1, suspended: false },
    ];
    const q = fcBuildQueue(mixed, NOW);
    expect(q.map((c: { id: number }) => c.id)).toEqual([2, 1]);
  });

  it('slices each deck to its allowance in all-decks sessions (M101)', () => {
    const multi = [
      { id: 1, deckId: 1, state: 'new', dueAt: 0, createdAt: 1, importance: 90, suspended: false },
      { id: 2, deckId: 1, state: 'new', dueAt: 0, createdAt: 2, importance: 80, suspended: false },
      { id: 3, deckId: 1, state: 'new', dueAt: 0, createdAt: 3, importance: 70, suspended: false },
      { id: 4, deckId: 2, state: 'new', dueAt: 0, createdAt: 4, importance: 50, suspended: false },
      { id: 5, deckId: 2, state: 'new', dueAt: 0, createdAt: 5, importance: 40, suspended: false },
    ];
    const allowances = new Map([[1, 1], [2, 2]]);
    const q = fcBuildQueue(multi, NOW, { newLimit: 20, newAllowanceByDeck: allowances });
    // Deck 1 contributes only its best card; deck 2 contributes both; the
    // merged band re-orders by importance.
    expect(q.map((c: { id: number }) => c.id)).toEqual([1, 4, 5]);
  });

  it('a deck missing from the allowance map is uncapped (fixed-batch decks)', () => {
    const multi = [
      { id: 1, deckId: 1, state: 'new', dueAt: 0, createdAt: 1, suspended: false },
      { id: 2, deckId: 1, state: 'new', dueAt: 0, createdAt: 2, suspended: false },
      { id: 3, deckId: 2, state: 'new', dueAt: 0, createdAt: 3, suspended: false },
    ];
    const q = fcBuildQueue(multi, NOW, { newLimit: 20, newAllowanceByDeck: new Map([[2, 0]]) });
    expect(q.map((c: { id: number }) => c.id)).toEqual([1, 2]);
  });
});

describe('fcPacePlan (M101 deadline-aware pacing)', () => {
  it('returns null without a future exam date (fixed batch applies)', () => {
    expect(fcPacePlan({ examDate: 0, newCount: 100 }, NOW)).toBeNull();
    expect(fcPacePlan({ examDate: NOW - DAY, newCount: 100 }, NOW)).toBeNull();
  });

  it('spreads the backlog over the days before the freeze window', () => {
    // 204 cards, exam in 67 days, 14-day freeze → 53 intro days → 4/day.
    const plan = fcPacePlan({ examDate: NOW + 67 * DAY, newCount: 204 }, NOW, { freezeDays: 14, ceiling: 20 });
    expect(plan).not.toBeNull();
    expect(plan.frozen).toBe(false);
    expect(plan.rate).toBe(4);
    // At 4/day, 204 cards introduce in 51 days — before the 53-day cutoff.
    expect(plan.doneAt).toBe(NOW + 51 * DAY);
  });

  it('raises the rate above the batch size when the deadline needs it', () => {
    // 500 cards, 8 intro days → 63/day needed. Clamping to the 20 ceiling
    // (the old behaviour) handed over 20/day and printed a completion date
    // 17 days past the exam, with nothing saying so. The deadline wins.
    const plan = fcPacePlan({ examDate: NOW + 10 * DAY, newCount: 500 }, NOW, { freezeDays: 2, ceiling: 20 });
    expect(plan.rate).toBe(63);
    expect(plan.raised).toBe(true);
  });

  it('still shrinks below the batch size when there is time to spare', () => {
    // Pacing is not "always introduce more" — the reduction is the point.
    const plan = fcPacePlan({ examDate: NOW + 67 * DAY, newCount: 204 }, NOW, { freezeDays: 14, ceiling: 20 });
    expect(plan.rate).toBe(4);
    expect(plan.raised).toBe(false);
  });

  it('a raised pace always finishes before the freeze window', () => {
    // The property the raise exists to guarantee, across a range of decks.
    for (const newCount of [500, 1200, 2000, 5000]) {
      for (const days of [20, 45, 90]) {
        const plan = fcPacePlan(
          { examDate: NOW + days * DAY, newCount },
          NOW,
          { freezeDays: 14, ceiling: 20 },
        );
        if (!plan || plan.frozen) continue;
        expect(plan.doneAt, `${newCount} cards / ${days} days`).toBeLessThanOrEqual(plan.cutoff);
      }
    }
  });

  it('freezes introduction inside the freeze window', () => {
    const plan = fcPacePlan({ examDate: NOW + 5 * DAY, newCount: 50 }, NOW, { freezeDays: 14, ceiling: 20 });
    expect(plan.frozen).toBe(true);
    expect(plan.rate).toBe(0);
  });

  it('an empty backlog paces to zero without freezing', () => {
    const plan = fcPacePlan({ examDate: NOW + 30 * DAY, newCount: 0 }, NOW, { freezeDays: 14, ceiling: 20 });
    expect(plan.frozen).toBe(false);
    expect(plan.rate).toBe(0);
  });
});

describe('fcNewAllowances (M101)', () => {
  const decks = [
    { id: 1, examDate: NOW + 67 * DAY, newCount: 204 },  // paced → 4/day
    { id: 2, examDate: 0, newCount: 100 },               // no date → ceiling
    { id: 3, examDate: NOW + 5 * DAY, newCount: 50 },    // frozen → 0
  ];

  it('mixes paced, fixed, and frozen decks', () => {
    const { byDeck, total } = fcNewAllowances(decks, NOW, { paceEnabled: true, freezeDays: 14, ceiling: 20 });
    expect(byDeck.get(1)).toBe(4);
    expect(byDeck.get(2)).toBe(20);
    expect(byDeck.get(3)).toBe(0);
    // total = min(4, 204) + min(20, 100) + min(0, 50)
    expect(total).toBe(24);
  });

  it('pacing off restores the fixed batch everywhere', () => {
    const { byDeck } = fcNewAllowances(decks, NOW, { paceEnabled: false, freezeDays: 14, ceiling: 20 });
    expect(byDeck.get(1)).toBe(20);
    expect(byDeck.get(3)).toBe(20);
  });
});

describe('fcNormalizeImportance', () => {
  it('clamps to 0..100 with 0 as the unscored sentinel', () => {
    expect(fcNormalizeImportance(85)).toBe(85);
    expect(fcNormalizeImportance(150)).toBe(100);
    expect(fcNormalizeImportance(-5)).toBe(0);
    expect(fcNormalizeImportance('72')).toBe(72);
    expect(fcNormalizeImportance(undefined)).toBe(0);
    expect(fcNormalizeImportance('nope')).toBe(0);
  });
});

// ─── Card flags ──────────────────────────────────────────────────────────────

describe('fcNormalizeFlag', () => {
  it('accepts the four real flag values', () => {
    for (const f of FC_FLAGS) expect(fcNormalizeFlag(f.value)).toBe(f.value);
  });

  it('treats anything else as unflagged rather than corrupting the column', () => {
    for (const bad of [0, 5, -1, 99, null, undefined, '', 'red', NaN, 1.5]) {
      expect(fcNormalizeFlag(bad)).toBe(0);
    }
  });

  it('accepts a numeric string, since SQLite and dataset attrs hand back strings', () => {
    expect(fcNormalizeFlag('3')).toBe(3);
  });
});

describe('fcFlagDef', () => {
  it('names each flag', () => {
    expect(fcFlagDef(1).name).toBe('Red');
    expect(fcFlagDef(4).name).toBe('Blue');
  });

  it('returns undefined for unflagged', () => {
    expect(fcFlagDef(0)).toBeUndefined();
    expect(fcFlagDef(9)).toBeUndefined();
  });
});

describe('fcBuildQueue — flag bias', () => {
  it('sorts flagged reviews ahead of more-overdue unflagged ones', () => {
    const cards = [
      { id: 1, state: 'review', dueAt: NOW - 9 * DAY, suspended: false, flag: 0 },
      { id: 2, state: 'review', dueAt: NOW - DAY, suspended: false, flag: 2 },
      { id: 3, state: 'review', dueAt: NOW - 5 * DAY, suspended: false, flag: 0 },
    ];
    expect(fcBuildQueue(cards, NOW).map((c: { id: number }) => c.id)).toEqual([2, 1, 3]);
  });

  it('introduces flagged new cards first, whatever their age', () => {
    const cards = [
      { id: 1, state: 'new', dueAt: 0, createdAt: 10, suspended: false, flag: 0 },
      { id: 2, state: 'new', dueAt: 0, createdAt: 900, suspended: false, flag: 1 },
      { id: 3, state: 'new', dueAt: 0, createdAt: 20, suspended: false, flag: 0 },
    ];
    expect(fcBuildQueue(cards, NOW).map((c: { id: number }) => c.id)).toEqual([2, 1, 3]);
  });

  it('lets flagged cards survive the cap — the point of flagging them', () => {
    const cards = [
      { id: 1, state: 'review', dueAt: NOW - 9 * DAY, suspended: false, flag: 0 },
      { id: 2, state: 'review', dueAt: NOW - 8 * DAY, suspended: false, flag: 0 },
      { id: 3, state: 'review', dueAt: NOW - MIN, suspended: false, flag: 3 },
    ];
    expect(fcBuildQueue(cards, NOW, { reviewLimit: 1 }).map((c: { id: number }) => c.id)).toEqual([3]);
  });

  it('leaves the learning band strictly time-ordered', () => {
    // Learning steps are minute-scale; reordering them would break the
    // "Again 1m means one minute" contract.
    const cards = [
      { id: 1, state: 'learning', dueAt: NOW - 5 * MIN, suspended: false, flag: 0 },
      { id: 2, state: 'learning', dueAt: NOW - MIN, suspended: false, flag: 1 },
    ];
    expect(fcBuildQueue(cards, NOW).map((c: { id: number }) => c.id)).toEqual([1, 2]);
  });

  it('is a no-op when nothing is flagged', () => {
    const cards = [
      { id: 1, state: 'review', dueAt: NOW - 2 * DAY, suspended: false },
      { id: 2, state: 'review', dueAt: NOW - DAY, suspended: false },
    ];
    expect(fcBuildQueue(cards, NOW).map((c: { id: number }) => c.id)).toEqual([1, 2]);
  });
});

// ─── Custom study (work ahead) ───────────────────────────────────────────────

describe('fcBuildCustomQueue', () => {
  // 5 new cards, so the 20-card daily batch is not the whole story.
  const cards = [
    { id: 1, state: 'new', dueAt: 0, createdAt: 300, suspended: false, tags: 'mack' },
    { id: 2, state: 'new', dueAt: 0, createdAt: 100, suspended: false, tags: 'mack,reserving' },
    { id: 3, state: 'new', dueAt: 0, createdAt: 200, suspended: false, tags: '' },
    { id: 4, state: 'review', dueAt: NOW - DAY, suspended: false, lapses: 3, difficulty: 7, tags: 'mack' },
    { id: 5, state: 'review', dueAt: NOW + 2 * DAY, suspended: false, lapses: 0, tags: 'reserving' },
    { id: 6, state: 'review', dueAt: NOW + 9 * DAY, suspended: false, lapses: 9, difficulty: 9, tags: '' },
    { id: 7, state: 'learning', dueAt: NOW + 5 * MIN, suspended: false, lapses: 1, difficulty: 4, tags: 'mack' },
    { id: 8, state: 'review', dueAt: NOW - DAY, suspended: true, lapses: 20, tags: 'mack' },
  ];
  const ids = (q: { id: number }[]) => q.map((c) => c.id);

  it('extra: hands out NEW cards, oldest first — the batch you were denied', () => {
    expect(ids(fcBuildCustomQueue(cards, NOW, { mode: 'extra', count: 2 }))).toEqual([2, 3]);
  });

  it('ahead: pulls forward reviews inside the horizon, soonest first', () => {
    // 3 days ahead reaches the overdue 4, the learning 7, and 5 (+2d) — not 6 (+9d).
    expect(ids(fcBuildCustomQueue(cards, NOW, { mode: 'ahead', aheadDays: 3 }))).toEqual([4, 7, 5]);
  });

  it('ahead: a wider horizon reaches further, and never picks up new cards', () => {
    const q = ids(fcBuildCustomQueue(cards, NOW, { mode: 'ahead', aheadDays: 30 }));
    expect(q).toEqual([4, 7, 5, 6]);
    expect(q).not.toContain(1);
  });

  it('hard: ranks by lapses, ignoring the schedule', () => {
    expect(ids(fcBuildCustomQueue(cards, NOW, { mode: 'hard' }))).toEqual([6, 4, 7]);
  });

  it('cram: takes anything in scope, most overdue first', () => {
    expect(ids(fcBuildCustomQueue(cards, NOW, { mode: 'cram', count: 3 }))).toEqual([1, 2, 3]);
  });

  it('tags scope every mode, and ALL listed tags must match', () => {
    expect(ids(fcBuildCustomQueue(cards, NOW, { mode: 'extra', tags: ['mack'] }))).toEqual([2, 1]);
    expect(ids(fcBuildCustomQueue(cards, NOW, { mode: 'extra', tags: ['mack', 'reserving'] }))).toEqual([2]);
    expect(fcBuildCustomQueue(cards, NOW, { mode: 'extra', tags: ['nope'] })).toEqual([]);
  });

  it('matches tags case-insensitively', () => {
    expect(ids(fcBuildCustomQueue(cards, NOW, { mode: 'extra', tags: ['MACK'] }))).toEqual([2, 1]);
  });

  it('omitting count means unlimited — this is how the dialog counts availability', () => {
    expect(fcBuildCustomQueue(cards, NOW, { mode: 'cram' })).toHaveLength(7); // all but the suspended
  });

  it('never surfaces suspended cards, in any mode', () => {
    for (const mode of ['extra', 'ahead', 'hard', 'cram']) {
      const q = ids(fcBuildCustomQueue(cards, NOW, { mode, aheadDays: 365 }));
      expect(q).not.toContain(8);
    }
  });

  it('falls back to extra on an unknown mode rather than serving nothing', () => {
    expect(ids(fcBuildCustomQueue(cards, NOW, { mode: 'bogus', count: 1 }))).toEqual([2]);
  });

  it('scopes by flag as ANY-of, since flags are alternatives not attributes', () => {
    const flagged = [
      { id: 1, state: 'new', dueAt: 0, createdAt: 10, suspended: false, flag: 1 },
      { id: 2, state: 'new', dueAt: 0, createdAt: 20, suspended: false, flag: 3 },
      { id: 3, state: 'new', dueAt: 0, createdAt: 30, suspended: false, flag: 0 },
    ];
    expect(ids(fcBuildCustomQueue(flagged, NOW, { mode: 'extra', flags: [1] }))).toEqual([1]);
    expect(ids(fcBuildCustomQueue(flagged, NOW, { mode: 'extra', flags: [1, 3] }))).toEqual([1, 2]);
  });

  it('ignores an empty or bogus flag scope instead of matching nothing', () => {
    const flagged = [{ id: 1, state: 'new', dueAt: 0, createdAt: 10, suspended: false, flag: 1 }];
    expect(ids(fcBuildCustomQueue(flagged, NOW, { mode: 'extra', flags: [] }))).toEqual([1]);
    expect(ids(fcBuildCustomQueue(flagged, NOW, { mode: 'extra', flags: [0, 99] }))).toEqual([1]);
  });

  it('combines a flag scope with a tag scope', () => {
    const both = [
      { id: 1, state: 'new', dueAt: 0, createdAt: 10, suspended: false, flag: 1, tags: 'mack' },
      { id: 2, state: 'new', dueAt: 0, createdAt: 20, suspended: false, flag: 1, tags: 'bf' },
      { id: 3, state: 'new', dueAt: 0, createdAt: 30, suspended: false, flag: 2, tags: 'mack' },
    ];
    expect(ids(fcBuildCustomQueue(both, NOW, { mode: 'extra', flags: [1], tags: ['mack'] }))).toEqual([1]);
  });

  it('does NOT flag-bias custom queues — the scope is explicit here', () => {
    const mixed = [
      { id: 1, state: 'new', dueAt: 0, createdAt: 10, suspended: false, flag: 0 },
      { id: 2, state: 'new', dueAt: 0, createdAt: 20, suspended: false, flag: 1 },
    ];
    expect(ids(fcBuildCustomQueue(mixed, NOW, { mode: 'extra' }))).toEqual([1, 2]);
  });
});

describe('fcCustomIsPreview', () => {
  it('marks cram and difficult-card passes as non-scheduling', () => {
    expect(fcCustomIsPreview('cram')).toBe(true);
    expect(fcCustomIsPreview('hard')).toBe(true);
  });

  it('lets extra-new and review-ahead reschedule normally', () => {
    expect(fcCustomIsPreview('extra')).toBe(false);
    expect(fcCustomIsPreview('ahead')).toBe(false);
  });
});

describe('fcCountServedToday', () => {
  const limits = { newLimit: 20, reviewLimit: 200 };

  it('reports what the session will serve, not the uncapped total', () => {
    // The bug: 100 new cards advertised "Study 103 cards" and served 23.
    expect(fcCountServedToday({ newCount: 100, learnCount: 3, reviewCount: 0 }, limits)).toBe(23);
  });

  it('leaves learning cards uncapped — they are already mid-flight', () => {
    expect(fcCountServedToday({ newCount: 0, learnCount: 40, reviewCount: 0 }, limits)).toBe(40);
  });

  it('caps reviews independently of new cards', () => {
    expect(fcCountServedToday({ newCount: 5, learnCount: 0, reviewCount: 900 }, limits)).toBe(205);
  });

  it('is the plain total when nothing exceeds a limit', () => {
    expect(fcCountServedToday({ newCount: 4, learnCount: 2, reviewCount: 6 }, limits)).toBe(12);
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

  it('salvages complete cards from a cut-off array instead of erroring (2026-08-18)', () => {
    const { cards, error, truncated } = fcExtractCardsJson('[{"front":"Q","back":"A"},{"front":"Q2","ba');
    expect(error).toBeNull();
    expect(truncated).toBe(true);
    expect(cards).toHaveLength(1);
    expect(cards[0].front).toBe('Q');
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
  const {
    fcContextPlan, FC_CHARS_PER_TOKEN, FC_PROMPT_HEADROOM, FC_SCAFFOLD_TOKENS,
    FC_OUTPUT_BASE_TOKENS, FC_OUTPUT_TOKENS_PER_CARD, FC_FALLBACK_MODEL_CTX,
  } = __testables;

  it('sizes the window to document + output, not a fixed constant', () => {
    // The regression that motivated this: a 38,263-char PDF tokenized to
    // 15,709 tokens (~2.44 chars/token), filling a fixed 16,384 window
    // almost entirely â€” the model was hard-stopped 674 tokens into its
    // JSON. The plan must leave the full output reserve on top.
    const { numCtx, maxChars, outputTokens } = fcContextPlan({
      chars: 38_263, count: 15, modelCtx: 262_144, setting: 0,
    });
    const promptEstimate = Math.ceil((38_263 / FC_CHARS_PER_TOKEN) * FC_PROMPT_HEADROOM) + FC_SCAFFOLD_TOKENS;
    expect(numCtx).toBeGreaterThanOrEqual(promptEstimate + outputTokens);
    expect(numCtx % 2048).toBe(0);
    expect(maxChars).toBeGreaterThanOrEqual(38_263); // whole doc fits, no clip
  });

  it('survives the MEASURED tokenizer ratio at large multi-source size (2026-08-18 regression)', () => {
    // The real run that failed: 4 sources, 143,882 chars, auto count (50).
    // Planned at 2.5 chars/token the prompt came in ~1,400 tokens short of
    // the measured 2.44 ratio, ate the rounding slack, and the window filled
    // mid-JSON ("Unterminated JSON array"). The plan must hold at 2.44.
    const { numCtx, outputTokens } = fcContextPlan({
      chars: 143_882, count: 50, modelCtx: 131_072, setting: 0,
    });
    const realistPrompt = Math.ceil(143_882 / 2.44) + FC_SCAFFOLD_TOKENS;
    expect(numCtx).toBeGreaterThanOrEqual(realistPrompt + outputTokens);
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
    const reserve = FC_OUTPUT_BASE_TOKENS + FC_OUTPUT_TOKENS_PER_CARD * 15;
    expect(maxChars).toBe(Math.floor(((32_768 - FC_SCAFFOLD_TOKENS - reserve) * FC_CHARS_PER_TOKEN) / FC_PROMPT_HEADROOM));
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

describe('fcNormalizeCardText', () => {
  it('converts <br> variants to newlines (raw HTML is escaped by the renderer)', () => {
    expect(fcNormalizeCardText('1. smaller MSE<br>2. better approximation<br/>3. superior<br />done'))
      .toBe('1. smaller MSE\n2. better approximation\n3. superior\ndone');
  });

  it('collapses runaway breaks and trims', () => {
    expect(fcNormalizeCardText('  a<br><br><br>b  ')).toBe('a\n\nb');
  });

  it('leaves LaTeX and Markdown untouched', () => {
    const s = String.raw`$\frac{a}{b}$ and **bold** stay`;
    expect(fcNormalizeCardText(s)).toBe(s);
  });
});

describe('fcAutoCardEstimate', () => {
  it('scales with material length, one fact per ~500 chars', () => {
    expect(fcAutoCardEstimate(10_000)).toBe(20);
    expect(fcAutoCardEstimate(15_000)).toBe(30);
  });

  it('clamps to a sane band: thin material still budgets 10, rich caps at 50', () => {
    expect(fcAutoCardEstimate(500)).toBe(10);
    expect(fcAutoCardEstimate(0)).toBe(10);
    expect(fcAutoCardEstimate(200_000)).toBe(50);
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

describe('navigation model', () => {
  it('every rail destination has a label and an icon', () => {
    expect(FC_NAV_DEFS.map((d: { view: string }) => d.view))
      .toEqual(['decks', 'study', 'create', 'import', 'stats']);
    for (const def of FC_NAV_DEFS) {
      expect(FC_VIEW_LABELS[def.view]).toBe(def.label);
      expect(def.iconName).toBeTruthy();
    }
  });

  it('names every route the pane can render, so the breadcrumb never shows a raw id', () => {
    // Mirrors createEditorPane's dispatch table.
    const routed = ['browse', 'study', 'custom', 'create', 'import', 'stats', 'dedup', 'coverage', 'decks'];
    for (const view of routed) expect(FC_VIEW_LABELS[view]).toBeTruthy();
  });

  it('lights Decks for the views that live under one deck', () => {
    for (const view of FC_DECK_VIEWS) {
      expect(fcNavViewFor({ view, deckId: 3 })).toBe('decks');
    }
  });

  it('lights Study for Custom Study, which is a launcher for it', () => {
    expect(fcNavViewFor({ view: 'custom' })).toBe('study');
    expect(fcNavViewFor({ view: 'custom', deckId: 1 })).toBe('study');
  });

  it('lights the destination itself for plain routes, and Decks with no route', () => {
    expect(fcNavViewFor({ view: 'stats' })).toBe('stats');
    expect(fcNavViewFor({ view: 'import' })).toBe('import');
    expect(fcNavViewFor({})).toBe('decks');
    expect(fcNavViewFor(null)).toBe('decks');
  });
});
