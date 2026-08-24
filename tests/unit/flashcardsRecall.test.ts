// M102 — production recall: the pure grading core.
//
// The whole point of the milestone is that a rating is DERIVED from a
// factual judgement rather than chosen by a model, so these tests pin the
// derivation: rubric normalisation, verdict coercion, scoring, the
// verdict → 1..4 mapping, formula normalisation, and the deterministic
// list pre-pass. No model is involved anywhere below.

import { describe, it, expect } from 'vitest';
// @ts-expect-error — JS module with no types
import { __testables } from '../../ext/flashcards/main.js';

const {
  FC_RECALL_MODES,
  fcNormalizeRecallMode,
  fcIsProductionMode,
  fcNormalizeRubric,
  fcSerializeRubric,
  fcParseRubricLines,
  fcNormalizeVerdict,
  fcScoreVerdict,
  fcMapVerdictToRating,
  fcNormalizeFormula,
  fcFormulaMatches,
  fcMatchListItems,
  fcCapProductionCards,
  fcBuildCustomQueue,
  fcGradingContext,
  fcMarkingTranscript,
  fcExtractJsonObject,
} = __testables;

const AGAIN = 1, HARD = 2, GOOD = 3, EASY = 4;

/** Build a verdict directly from statuses, bypassing model coercion. */
const verdictOf = (statuses: string[], extra: Record<string, unknown> = {}) => ({
  mode: 'conceptual',
  points: statuses.map((status) => ({ status, note: '' })),
  contradiction: false,
  note: '',
  sourced: true,
  ...extra,
});

/** A rubric of n required points. */
const rubricOf = (n: number, required = true) =>
  Array.from({ length: n }, (_, i) => ({ text: `point ${i + 1}`, required }));

describe('recall mode normalisation', () => {
  it('accepts the four known modes', () => {
    for (const m of FC_RECALL_MODES) expect(fcNormalizeRecallMode(m)).toBe(m);
  });

  it('degrades anything unknown to recognition', () => {
    // The safety property: a bad value must land on today's loop, never on a
    // production mode that would demand an answer the UI cannot grade.
    for (const bad of ['', null, undefined, 'nonsense', 42, 'conceptual!']) {
      expect(fcNormalizeRecallMode(bad)).toBe('recognition');
    }
    // Case and surrounding whitespace are a real mode typed loosely, not an
    // unknown value — those normalise rather than degrade.
    expect(fcNormalizeRecallMode('  LIST ')).toBe('list');
    expect(fcNormalizeRecallMode('Conceptual ')).toBe('conceptual');
  });

  it('classifies production modes', () => {
    expect(fcIsProductionMode('recognition')).toBe(false);
    expect(fcIsProductionMode('conceptual')).toBe(true);
    expect(fcIsProductionMode('list')).toBe(true);
    expect(fcIsProductionMode('formula')).toBe(true);
    expect(fcIsProductionMode('garbage')).toBe(false);
  });
});

describe('rubric normalisation', () => {
  it('accepts a bare array of strings (what models usually emit)', () => {
    expect(fcNormalizeRubric(['a', 'b'])).toEqual([
      { text: 'a', required: true },
      { text: 'b', required: true },
    ]);
  });

  it('accepts objects under several plausible key names', () => {
    expect(fcNormalizeRubric([{ point: 'a' }, { item: 'b' }, { text: 'c' }]))
      .toEqual([
        { text: 'a', required: true },
        { text: 'b', required: true },
        { text: 'c', required: true },
      ]);
  });

  it('defaults required to true and honours an explicit false', () => {
    // Defaulting the other way would let an all-optional rubric grade every
    // answer as complete.
    expect(fcNormalizeRubric([{ text: 'a' }])[0].required).toBe(true);
    expect(fcNormalizeRubric([{ text: 'a', required: false }])[0].required).toBe(false);
  });

  it('parses the stored JSON form and survives corrupt JSON', () => {
    expect(fcNormalizeRubric('[{"text":"a","required":false}]'))
      .toEqual([{ text: 'a', required: false }]);
    expect(fcNormalizeRubric('{not json')).toEqual([]);
    expect(fcNormalizeRubric('')).toEqual([]);
  });

  it('drops empties, collapses whitespace, and caps length', () => {
    expect(fcNormalizeRubric(['  ', '', null, 'a\n\n b'])).toEqual([{ text: 'a b', required: true }]);
    expect(fcNormalizeRubric(Array.from({ length: 40 }, (_, i) => `p${i}`)).length).toBe(12);
    expect(fcNormalizeRubric(['x'.repeat(900)])[0].text.length).toBe(400);
  });

  it('serialises an empty rubric to the empty string, not "[]"', () => {
    // The column default is '' and absence is tested with `= ''`; storing
    // '[]' would make an empty rubric read as present.
    expect(fcSerializeRubric([])).toBe('');
    expect(fcSerializeRubric(['a'])).toBe('[{"text":"a","required":true}]');
  });

  it('round-trips through the stored form', () => {
    const r = [{ text: 'a', required: true }, { text: 'b', required: false }];
    expect(fcNormalizeRubric(fcSerializeRubric(r))).toEqual(r);
  });
});

describe('verdict coercion', () => {
  it('is positional against the rubric', () => {
    const v = fcNormalizeVerdict({ points: [{ status: 'hit' }, { status: 'miss' }] }, rubricOf(2));
    expect(v.points.map((p: { status: string }) => p.status)).toEqual(['hit', 'miss']);
  });

  it('pads a short points array with misses rather than discarding the judgement', () => {
    // A model that judged 3 of 5 has still told us something; throwing it
    // away would force a self-grade on a card already answered.
    const v = fcNormalizeVerdict({ points: [{ status: 'hit' }] }, rubricOf(3));
    expect(v.points.map((p: { status: string }) => p.status)).toEqual(['hit', 'miss', 'miss']);
  });

  it('ignores extra points beyond the rubric', () => {
    const v = fcNormalizeVerdict({ points: ['hit', 'hit', 'hit'] }, rubricOf(2));
    expect(v.points).toHaveLength(2);
  });

  it('accepts bare status strings and yes/no', () => {
    const v = fcNormalizeVerdict({ points: ['hit', 'yes', 'no', 'nonsense'] }, rubricOf(4));
    expect(v.points.map((p: { status: string }) => p.status)).toEqual(['hit', 'hit', 'miss', 'miss']);
  });

  it('reads the contradiction flag under its aliases', () => {
    expect(fcNormalizeVerdict({ contradiction: true }, rubricOf(1)).contradiction).toBe(true);
    expect(fcNormalizeVerdict({ contradictsSource: true }, rubricOf(1)).contradiction).toBe(true);
    expect(fcNormalizeVerdict({}, rubricOf(1)).contradiction).toBe(false);
  });

  it('records mode and sourced-ness', () => {
    const v = fcNormalizeVerdict({}, rubricOf(1), { mode: 'list', sourced: false });
    expect(v.mode).toBe('list');
    expect(v.sourced).toBe(false);
  });
});

describe('verdict scoring', () => {
  it('counts a partial as half', () => {
    const s = fcScoreVerdict(verdictOf(['hit', 'partial', 'miss', 'hit']), rubricOf(4));
    expect(s).toMatchObject({ hits: 2, partials: 1, misses: 1, total: 4 });
    expect(s.score).toBeCloseTo(2.5 / 4);
  });

  it('flags a missed REQUIRED point only', () => {
    const rubric = [
      { text: 'a', required: true },
      { text: 'b', required: false },
    ];
    expect(fcScoreVerdict(verdictOf(['hit', 'miss']), rubric).requiredMissed).toBe(false);
    expect(fcScoreVerdict(verdictOf(['miss', 'hit']), rubric).requiredMissed).toBe(true);
  });

  it('treats absent point judgements as misses', () => {
    const s = fcScoreVerdict({ points: [] }, rubricOf(2));
    expect(s.misses).toBe(2);
    expect(s.score).toBe(0);
  });

  it('returns a zero total for an empty rubric', () => {
    expect(fcScoreVerdict(verdictOf([]), []).total).toBe(0);
  });
});

describe('verdict → rating', () => {
  it('returns null when there is no rubric to score against', () => {
    // The caller's signal to fall back to a self-grade rather than invent one.
    expect(fcMapVerdictToRating(verdictOf([]), [])).toBeNull();
  });

  it('sends a contradiction to Again regardless of score', () => {
    const v = verdictOf(['hit', 'hit', 'hit'], { contradiction: true });
    expect(fcScoreVerdict(v, rubricOf(3)).score).toBe(1);
    expect(fcMapVerdictToRating(v, rubricOf(3))).toBe(AGAIN);
  });

  it('treats one essential gap on an otherwise clean answer as "almost there"', () => {
    // 3 of 4 required points, nothing else hedged. Capping this at Hard
    // would make Good unreachable on the rubric sizes that actually occur.
    const v = verdictOf(['miss', 'hit', 'hit', 'hit']);
    expect(fcScoreVerdict(v, rubricOf(4)).score).toBeCloseTo(0.75);
    expect(fcMapVerdictToRating(v, rubricOf(4))).toBe(GOOD);
  });

  it('caps two or more essential gaps at Hard', () => {
    // Partial understanding, not almost-there.
    const v = verdictOf(['miss', 'miss', 'hit', 'hit', 'hit', 'hit']);
    expect(fcScoreVerdict(v, rubricOf(6)).score).toBeCloseTo(0.667);
    expect(fcMapVerdictToRating(v, rubricOf(6))).toBe(HARD);
  });

  it('does not call one essential gap "almost there" when the score is weak', () => {
    // 1 of 2 is one gap, but half the answer is missing.
    expect(fcMapVerdictToRating(verdictOf(['miss', 'hit']), rubricOf(2))).toBe(HARD);
  });

  it('caps one essential gap at Hard when something else was hedged too', () => {
    const v = verdictOf(['miss', 'partial', 'hit', 'hit', 'hit']);
    expect(fcMapVerdictToRating(v, rubricOf(5))).toBe(HARD);
  });

  it('sends a missed required point with a weak score to Again', () => {
    expect(fcMapVerdictToRating(verdictOf(['miss', 'miss', 'hit']), rubricOf(3))).toBe(AGAIN);
  });

  it('maps the score bands on optional points', () => {
    const optional = (n: number) => rubricOf(n, false);
    // < 0.5 → Again
    expect(fcMapVerdictToRating(verdictOf(['hit', 'miss', 'miss', 'miss']), optional(4))).toBe(AGAIN);
    // 0.5 → below the Good floor → Hard
    expect(fcMapVerdictToRating(verdictOf(['hit', 'hit', 'miss', 'miss']), optional(4))).toBe(HARD);
    // 0.75 → Good
    expect(fcMapVerdictToRating(verdictOf(['hit', 'hit', 'hit', 'miss']), optional(4))).toBe(GOOD);
    // 1.0 → Easy
    expect(fcMapVerdictToRating(verdictOf(['hit', 'hit', 'hit', 'hit']), optional(4))).toBe(EASY);
  });

  /** Ratings for 0..n hits (rest missed), by rubric size. */
  const byHitCount = (n: number, required: boolean) =>
    Array.from({ length: n + 1 }, (_, hits) => fcMapVerdictToRating(
      verdictOf([...Array(hits).fill('hit'), ...Array(n - hits).fill('miss')]),
      rubricOf(n, required),
    ));

  it('leaves Good reachable by hits alone at every realistic rubric size', () => {
    // The defect a 0.8 floor had. On 3-, 4- and 5-point rubrics the reachable
    // scores skipped the Good band entirely, so every review landed Hard or
    // Easy and FSRS saw a bimodal stream — and rubrics are 3-5 points in
    // practice, so that was the normal case, not an edge one.
    for (const n of [3, 4, 5, 6, 8]) {
      expect(byHitCount(n, true), `n=${n} required`).toContain(GOOD);
      expect(byHitCount(n, false), `n=${n} optional`).toContain(GOOD);
    }
  });

  it('is monotonic — more hits never lowers the rating', () => {
    // Not reachability but the stronger invariant: whatever the bands are
    // tuned to, producing MORE of the answer must never grade worse. A
    // non-monotonic mapping would feed FSRS a signal that inverts on some
    // rubric sizes, and nothing downstream could detect it.
    // (2- and 3-point rubrics genuinely cannot reach all four grades by hits
    // alone — 0.5 and 0.33 are the only intermediate scores that exist — so
    // monotonicity, not coverage, is what holds universally.)
    for (const n of [1, 2, 3, 4, 5, 6, 8, 12]) {
      for (const required of [true, false]) {
        const ratings = byHitCount(n, required);
        for (let i = 1; i < ratings.length; i++) {
          expect(ratings[i], `n=${n} required=${required} hits=${i}`)
            .toBeGreaterThanOrEqual(ratings[i - 1]);
        }
      }
    }
  });

  it('never awards Easy when any point was partial', () => {
    // Two partials score 1.0 on a 2-point rubric only if partials counted
    // full; they do not, but guard the intent explicitly.
    const v = verdictOf(['hit', 'partial', 'hit', 'hit']);
    expect(fcMapVerdictToRating(v, rubricOf(4))).not.toBe(EASY);
  });

  it('tops out at Good on a one-point rubric', () => {
    // "Complete" and "correct" are the same event there, so Easy would hand
    // out FSRS's largest multiplier for a single right answer.
    expect(fcMapVerdictToRating(verdictOf(['hit']), rubricOf(1))).toBe(GOOD);
    expect(fcMapVerdictToRating(verdictOf(['hit', 'hit']), rubricOf(2))).toBe(EASY);
  });

  it('always returns a valid FSRS rating when a rubric exists', () => {
    for (const n of [1, 2, 3, 5, 8]) {
      for (const statuses of [['hit'], ['miss'], ['partial']]) {
        const v = verdictOf(Array.from({ length: n }, (_, i) => statuses[i % statuses.length]));
        const r = fcMapVerdictToRating(v, rubricOf(n));
        expect(r).toBeGreaterThanOrEqual(AGAIN);
        expect(r).toBeLessThanOrEqual(EASY);
      }
    }
  });
});

describe('formula normalisation', () => {
  it('ignores spacing, delimiters and math-mode markers', () => {
    expect(fcFormulaMatches('$a + b$', 'a+b')).toBe(true);
    expect(fcFormulaMatches('\\left( a \\right)', '(a)')).toBe(true);
    expect(fcFormulaMatches('a \\, b', 'ab')).toBe(true);
  });

  it('unifies pure synonyms', () => {
    expect(fcFormulaMatches('a \\cdot b', 'a \\times b')).toBe(true);
    expect(fcFormulaMatches('\\mathrm{Var}(X)', 'Var(X)')).toBe(true);
  });

  it('strips braces only around single tokens', () => {
    expect(fcNormalizeFormula('x^{2}')).toBe('x^2');
    // A multi-token group is structural — removing its braces would change
    // the expression.
    expect(fcNormalizeFormula('x^{2n}')).toBe('x^{2n}');
  });

  it('does NOT claim algebraically-equivalent forms are equal', () => {
    // The mismatch path hands these to the model. A normalizer that guessed
    // would mark real errors correct, which is the one failure a formula
    // card cannot afford.
    expect(fcFormulaMatches('\\frac{a}{b}', 'a/b')).toBe(false);
    expect(fcFormulaMatches('a+b', 'b+a')).toBe(false);
  });

  it('never matches on empty input', () => {
    expect(fcFormulaMatches('', '')).toBe(false);
    expect(fcFormulaMatches('  ', 'a')).toBe(false);
  });
});

describe('list pre-pass', () => {
  const rubric = ['development is independent across accident years',
    'expected losses are proportional to the prior column',
    'variance is proportional to the prior column'];

  it('auto-hits near-verbatim items with no model call', () => {
    const answer = [
      'development is independent across accident years',
      'expected losses are proportional to the prior column',
      'variance is proportional to the prior column',
    ].join('\n');
    const r = fcMatchListItems(answer, rubric);
    expect(r.statuses.every((s: { status: string }) => s.status === 'hit')).toBe(true);
    expect(r.uncertain).toBe(false);
  });

  it('auto-misses items with no trace in the answer', () => {
    const r = fcMatchListItems('something entirely unrelated about reinsurance treaties', rubric);
    expect(r.statuses.every((s: { status: string }) => s.status === 'miss')).toBe(true);
    expect(r.uncertain).toBe(false);
  });

  it('routes anything in between to the model instead of guessing', () => {
    // A paraphrase is exactly the case a trigram score cannot settle, and a
    // wrong auto-hit inflates FSRS stability invisibly.
    const r = fcMatchListItems('accident years develop independently of one another', rubric);
    expect(r.uncertain).toBe(true);
  });

  it('splits bullets, numbers, newlines and semicolons into items', () => {
    const r = fcMatchListItems(
      '- development is independent across accident years\n'
      + '2) expected losses are proportional to the prior column;'
      + ' variance is proportional to the prior column',
      rubric,
    );
    expect(r.candidateCount).toBeGreaterThanOrEqual(3);
    expect(r.statuses.filter((s: { status: string }) => s.status === 'hit').length).toBe(3);
  });

  it('handles an empty answer without throwing', () => {
    const r = fcMatchListItems('', rubric);
    expect(r.candidateCount).toBe(0);
    expect(r.statuses.every((s: { status: string }) => s.status === 'miss')).toBe(true);
  });
});

describe('hand-edited rubric format', () => {
  it('reads one point per line and strips bullets', () => {
    expect(fcParseRubricLines('- first\n* second\n• third')).toEqual([
      { text: 'first', required: true },
      { text: 'second', required: true },
      { text: 'third', required: true },
    ]);
  });

  it('marks a trailing (optional) as supporting detail', () => {
    expect(fcParseRubricLines('core claim\nnice to have (optional)\nalso fine (supporting)')).toEqual([
      { text: 'core claim', required: true },
      { text: 'nice to have', required: false },
      { text: 'also fine', required: false },
    ]);
  });

  it('ignores blank lines and whitespace', () => {
    expect(fcParseRubricLines('\n  \na\n\n  b  \n')).toEqual([
      { text: 'a', required: true },
      { text: 'b', required: true },
    ]);
  });

  it('cannot fail into an empty rubric the way hand-edited JSON would', () => {
    // The reason the format is lines, not JSON: nothing here parses to []
    // except genuinely empty input, so a stray character costs a word, not
    // the whole grading standard.
    expect(fcParseRubricLines('{"text": broken json,,,')).toHaveLength(1);
    expect(fcParseRubricLines('')).toEqual([]);
  });

  it('round-trips the shape the editor renders', () => {
    const rendered = [{ text: 'a', required: true }, { text: 'b', required: false }]
      .map((p) => (p.required ? p.text : `${p.text} (optional)`))
      .join('\n');
    expect(fcParseRubricLines(rendered)).toEqual([
      { text: 'a', required: true },
      { text: 'b', required: false },
    ]);
  });
});

describe('production card cap', () => {
  const card = (id: number, recallMode: string) => ({ id, recallMode });
  const ids = (list: { id: number }[]) => list.map((c) => c.id);

  it('is a no-op at limit 0', () => {
    expect(ids(fcCapProductionCards([card(1, 'conceptual'), card(2, 'conceptual')], 0))).toEqual([1, 2]);
  });

  it('never drops recognition cards', () => {
    const review = [card(1, 'recognition'), card(2, 'recognition'), card(3, 'recognition')];
    expect(ids(fcCapProductionCards(review, 1))).toEqual([1, 2, 3]);
  });

  it('keeps queue order among the cards it retains', () => {
    const review = [card(1, 'recognition'), card(2, 'conceptual'), card(3, 'recognition'), card(4, 'list')];
    expect(ids(fcCapProductionCards(review, 1))).toEqual([1, 2, 3]);
  });

  it('counts every production mode against one shared budget', () => {
    const review = [card(1, 'conceptual'), card(2, 'list'), card(3, 'formula')];
    expect(ids(fcCapProductionCards(review, 2))).toEqual([1, 2]);
  });
});

describe('grading context', () => {
  it('reports sourced when an excerpt is stored', () => {
    const ctx = fcGradingContext({ back: 'the answer', sourceExcerpt: 'the passage', sourcePage: 12 });
    expect(ctx.sourced).toBe(true);
    expect(ctx.text).toContain('the passage');
    expect(ctx.text).toContain('page 12');
  });

  it('reports unsourced and still yields a reference', () => {
    const ctx = fcGradingContext({ back: 'the answer' });
    expect(ctx.sourced).toBe(false);
    expect(ctx.text).toContain('the answer');
  });

  it('excludes the card notes', () => {
    // Marking an answer against the learner's own notes would be circular:
    // a misconception written into the notes would mark itself correct.
    const ctx = fcGradingContext({ back: 'the answer', notes: 'MY OWN MNEMONIC' });
    expect(ctx.text).not.toContain('MY OWN MNEMONIC');
  });
});

describe('verdict JSON extraction', () => {
  it('pulls an object out of prose and fences', () => {
    const out = fcExtractJsonObject('Sure!\n```json\n{"contradiction": false, "note": "ok"}\n```\nDone.');
    expect(out).toMatchObject({ contradiction: false, note: 'ok' });
  });

  it('skips a leaked think block', () => {
    const out = fcExtractJsonObject('<think>{"fake": 1}</think>{"note": "real"}');
    expect(out).toMatchObject({ note: 'real' });
  });

  it('survives an unterminated think block', () => {
    const out = fcExtractJsonObject('reasoning {"decoy": 1} more</think>{"note": "real"}');
    expect(out).toMatchObject({ note: 'real' });
  });

  it('handles braces inside strings', () => {
    const out = fcExtractJsonObject('{"note": "use {braces} here", "contradiction": true}');
    expect(out).toMatchObject({ note: 'use {braces} here', contradiction: true });
  });

  it('repairs unescaped LaTeX inside math delimiters, as the array extractor does', () => {
    // The repair is delimiter-aware by design: inside $...$ a bare \f is
    // \frac, but in prose it is a real formfeed escape and must stay one.
    // A marker's note quotes formulas, so verdicts hit this path too.
    const out = fcExtractJsonObject('{"note": "you wrote $\\frac{a}{b}$ instead"}');
    expect(out?.note).toContain('\\frac');
  });

  it('leaves a genuine prose escape alone', () => {
    const out = fcExtractJsonObject('{"note": "line one\\nline two"}');
    expect(out?.note).toBe('line one\nline two');
  });

  it('returns null rather than throwing on junk', () => {
    expect(fcExtractJsonObject('no json here')).toBeNull();
    expect(fcExtractJsonObject('')).toBeNull();
    expect(fcExtractJsonObject('{"unterminated": ')).toBeNull();
  });
});

describe('the cap must not overrule the deadline', () => {
  const { fcBuildQueue, fcPacePlan } = __testables;
  const NOW = 1_800_000_000_000;
  const DAY = 86_400_000;

  const newCard = (id: number, recallMode: string) => ({
    id, deckId: 1, state: 'new', suspended: false, dueAt: 0,
    recallMode, flag: 0, importance: 0, createdAt: NOW,
  });

  it('never trims NEW cards, however many need a typed answer', () => {
    // Introduction is deadline-owned: fcPacePlan has already decided how many
    // new cards must land this session for the deck to finish before the
    // exam. A second, unrelated cap silently overruling that is the same bug
    // as letting newLimit trim a raised pace back down — and it would spiral,
    // since the untouched backlog raises next session's required rate again.
    const cards = Array.from({ length: 30 }, (_, i) => newCard(i + 1, 'conceptual'));
    const queue = fcBuildQueue(cards, NOW, { newLimit: 30, reviewLimit: 200, productionLimit: 5 });
    expect(queue).toHaveLength(30);
  });

  it('still caps DUE production reviews, which cost the plan nothing to defer', () => {
    const due = Array.from({ length: 10 }, (_, i) => ({
      ...newCard(i + 1, 'conceptual'), state: 'review', dueAt: NOW - DAY,
    }));
    const queue = fcBuildQueue(due, NOW, { newLimit: 20, reviewLimit: 200, productionLimit: 4 });
    expect(queue).toHaveLength(4);
  });

  it('a raised pace survives the queue build end to end', () => {
    // The whole chain: 2,000 cards against a 90-day exam need 27/day, above
    // the default batch of 20. The pace raises, the session limit follows it,
    // and the cap leaves the new band alone — so 27 actually get served.
    const plan = fcPacePlan({ examDate: NOW + 90 * DAY, newCount: 2000 }, NOW, { freezeDays: 14, ceiling: 20 });
    expect(plan.raised).toBe(true);
    expect(plan.rate).toBeGreaterThan(20);

    const cards = Array.from({ length: 2000 }, (_, i) => newCard(i + 1, i % 2 ? 'conceptual' : 'recognition'));
    const queue = fcBuildQueue(cards, NOW, {
      newLimit: Math.max(20, plan.rate),
      reviewLimit: 200,
      newAllowanceByDeck: new Map([[1, plan.rate]]),
      productionLimit: 12,
    });
    expect(queue).toHaveLength(plan.rate);
  });
});

describe('marking hand-off to chat', () => {
  const rubric = [
    { text: 'parameter risk does not diversify', required: true },
    { text: 'process risk averages out', required: true },
    { text: 'both widen the predictive distribution', required: false },
  ];
  const verdict = {
    mode: 'conceptual',
    points: [
      { status: 'hit', note: '' },
      { status: 'miss', note: 'not mentioned' },
      { status: 'partial', note: 'said "wider" without saying why' },
    ],
    contradiction: false,
    note: 'You have the first half. The second is the one that matters.',
    sourced: true,
  };

  it('carries the answer, the grade, and the per-point breakdown', () => {
    const t = fcMarkingTranscript({ answer: 'my answer', verdict, rubric, rating: 2 });
    expect(t).toContain('my answer');
    expect(t).toContain('Hard');
    expect(t).toContain('1/3 points');
    // The per-point detail is the whole reason to send it: the model cannot
    // ask about a gap it was only told the size of.
    expect(t).toContain('parameter risk does not diversify');
    expect(t).toContain('process risk averages out');
    expect(t).toContain('not mentioned');
    expect(t).toContain("You have the first half");
  });

  it('marks a blank answer as blank rather than as an empty line', () => {
    const t = fcMarkingTranscript({ answer: '   ', verdict, rubric, rating: 1 });
    expect(t).toContain('(left blank)');
  });

  it('calls out a contradiction explicitly', () => {
    const t = fcMarkingTranscript({
      answer: 'backwards', verdict: { ...verdict, contradiction: true }, rubric, rating: 1,
    });
    expect(t).toContain('contradicts the source');
  });

  it('flags an unsourced marking as weaker evidence', () => {
    const t = fcMarkingTranscript({
      answer: 'x', verdict: { ...verdict, sourced: false }, rubric, rating: 2,
    });
    expect(t).toContain('no source passage');
  });

  it('stamps a historical marking with its date', () => {
    const t = fcMarkingTranscript({
      answer: 'x', verdict, rubric, rating: 2, reviewedAt: new Date(2026, 0, 15).getTime(),
    });
    expect(t).toMatch(/points on \S+/);
  });
});

describe('overriding the marker', () => {
  const rubric = [{ text: 'a', required: true }, { text: 'b', required: true }];
  const base = {
    mode: 'conceptual',
    points: [{ status: 'hit', note: '' }, { status: 'hit', note: '' }],
    contradiction: false,
    note: '',
    sourced: true,
  };

  it('names both grades in the chat hand-off when they disagree', () => {
    // The disagreement is often the thing worth discussing: you thought it
    // was harder than the marker did, and the model should know that.
    const t = fcMarkingTranscript({
      answer: 'my answer',
      verdict: { ...base, aiRating: 4 },
      rubric,
      rating: 2,
    });
    expect(t).toContain('marked Easy by the marker');
    expect(t).toContain('changed to Hard by me');
  });

  it('says it plainly when the grade was left alone', () => {
    const t = fcMarkingTranscript({ answer: 'x', verdict: base, rubric, rating: 4 });
    expect(t).toContain('marked Easy');
    expect(t).not.toContain('changed to');
  });

  it('does not report an override when the user picked the same grade', () => {
    const t = fcMarkingTranscript({ answer: 'x', verdict: { ...base, aiRating: 3 }, rubric, rating: 3 });
    expect(t).not.toContain('changed to');
  });
});

describe('single-card study', () => {
  const NOW = 1_800_000_000_000;
  const card = (id: number, extra: Record<string, unknown> = {}) => ({
    id, deckId: 1, state: 'review', dueAt: NOW + 90 * 86_400_000, suspended: false,
    tags: 'mack', flag: 0, lapses: 0, createdAt: NOW, ...extra,
  });
  const cards = [card(1), card(2), card(3, { suspended: true })];

  it('serves exactly the card you picked', () => {
    const q = fcBuildCustomQueue(cards, NOW, { mode: 'single', cardId: 2 });
    expect(q.map((c: { id: number }) => c.id)).toEqual([2]);
  });

  it('serves it even though nothing about it is due', () => {
    // The point of picking a card by hand: schedule is not the filter.
    expect(cards[1].dueAt).toBeGreaterThan(NOW);
    expect(fcBuildCustomQueue(cards, NOW, { mode: 'single', cardId: 2 })).toHaveLength(1);
  });

  it('ignores tag and flag scope, which the user did not ask for', () => {
    // A filter that silently excluded the card you clicked could only surprise.
    const q = fcBuildCustomQueue(cards, NOW, {
      mode: 'single', cardId: 2, tags: ['nonexistent'], flags: [3],
    });
    expect(q.map((c: { id: number }) => c.id)).toEqual([2]);
  });

  it('still refuses a suspended card', () => {
    expect(fcBuildCustomQueue(cards, NOW, { mode: 'single', cardId: 3 })).toEqual([]);
  });

  it('returns empty for a card that no longer exists', () => {
    expect(fcBuildCustomQueue(cards, NOW, { mode: 'single', cardId: 999 })).toEqual([]);
  });

  it('tolerates a string card id from a persisted route', () => {
    const q = fcBuildCustomQueue(cards, NOW, { mode: 'single', cardId: '2' });
    expect(q.map((c: { id: number }) => c.id)).toEqual([2]);
  });

  it('is not a preview mode — grading it counts', () => {
    // Unlike cram, one deliberately chosen card cannot distort a deck, and
    // answering it properly is real evidence about recall.
    expect(__testables.fcCustomIsPreview('single')).toBe(false);
  });
});
