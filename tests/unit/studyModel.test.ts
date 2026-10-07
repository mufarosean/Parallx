// studyModel.test.ts — the Study extension's pure model (ext/study/src/10-model.js)
// through the __testables export of the generated main.js, the Flashcards
// pattern. No DOM, no model, no database: `now` and `rng` are arguments.
//
// Covers docs/STUDY_BUILD_SPEC.md §4 and §11: state thresholds and stale
// days, alpha per format class, a retried right counting as a miss, the draw
// order and material interleave with no repeats, format resolution for
// mixed, anchoring on garbled pages, the heading heuristic on page texts
// that look like an actuarial reading, JSON extraction with fences and
// LaTeX, verdict thresholds at 2 of 3 and 3 of 5, a contradiction outranking
// the score, numeric parsing with commas and percents, cloze folding, and
// question validation.

import { describe, it, expect } from 'vitest';
// @ts-expect-error — JS module with no types
import { __testables } from '../../ext/study/main.js';

const {
  stConceptState,
  stApplyAnswer,
  stConceptIsCleanIn,
  stFormatClass,
  stResolveFormat,
  stDrawSession,
  stCoverage,
  stSessionSummary,
  stContextPlan,
  stChunkPages,
  stSkeleton,
  stAnchorOnPage,
  stFindAnchorPage,
  stHeadingsFromPages,
  stSectionsFromOutline,
  stExtractJsonArray,
  stExtractJsonObject,
  stNormalizeRubric,
  stNormalizeVerdict,
  stScoreVerdict,
  stMapVerdictToRating,
  stVerdictLabel,
  stRatingWord,
  stNormalizeFormula,
  stFormulaMatches,
  stNumericMatches,
  stClozeMatches,
  stValidateQuestion,
  stDistractorPrompts,
  stInterleaveMaterials,
  stMasteryFromCardRating,
  stTruncate,
  stEsc,
  stFsPathOf,
  stUriOf,
  bus,
  onDataChanged,
  ST_FORMATS,
  ST_TYPED,
  AGAIN, HARD, GOOD, EASY,
  DAY,
} = __testables;

const NOW = 1_800_000_000_000;

/** A deterministic rng: a linear congruential generator seeded once. */
function seeded(seed = 7) {
  let s = seed >>> 0;
  return () => {
    s = (Math.imul(1664525, s) + 1013904223) >>> 0;
    return s / 4294967296;
  };
}

function concept(over: Record<string, unknown> = {}) {
  return {
    id: 1, materialId: 1, sectionId: 1, title: 'Loglogistic growth curve', summary: '', page: 8, anchorQuote: '', ord: 0,
    mastery: 0, answers: 0, misses: 0, missStreak: 0, rightChooseAt: 0, rightTypeAt: 0, lastAnsweredAt: 0,
    ...over,
  };
}

function question(over: Record<string, unknown> = {}) {
  return {
    id: 1, materialId: 1, conceptId: 1, format: 'mc', stem: 'Which curve does Clark fit?',
    options: ['Loglogistic', 'Normal', 'Poisson', 'Uniform'], answer: '0', explanation: '',
    rubric: [], rubricOrigin: '', contradictions: [], numeric: null,
    sourcePage: 8, sourceQuote: '', sourceUri: '', origin: 'generated', originLabel: '', providerId: '', providerRef: '',
    bankId: 0, checks: {}, difficulty: '', hidden: 0, edited: 0,
    ...over,
  };
}

// ── Page fixtures: Clark (LDF curve fitting) and Mack (chain-ladder variance) ──

const CLARK_PAGES = [
  'Estimation and Simulation of Loss Development Factors\nDavid R. Clark\nCasualty Actuarial Society Forum, Fall 2003\n\nAbstract\nThis paper describes a parametric approach to estimating loss development patterns.',
  '1. Introduction\n\nLoss development is estimated from a triangle of cumulative losses. The method in this paper fits a growth curve G(x) to the emergence pattern so that the expected ultimate loss is a function of a small number of parameters.\n\nThe approach has two advantages over the chain ladder: it smooths the pattern, and it gives a standard error for the reserve estimate.',
  '2. The Growth Curve\n\nThe loglogistic curve is G(x) = x^omega / (x^omega + theta^omega), where x is the average age of the accident period and omega and theta are the parameters to be estimated.\n\n2.1 The Weibull Alternative\n\nThe Weibull curve G(x) = 1 - exp(-(x/theta)^omega) approaches 1 more quickly than the loglogistic curve and gives a thinner tail.',
  '3. The Two Methods\n\n3.1 LDF Method\n\nUnder the LDF method each accident year has its own ultimate loss, so the number of parameters is the number of accident years plus two.\n\n3.2 Cape Cod Method\n\nThe Cape Cod method fits one expected loss ratio ELR for every year, so the ultimate for a year is premium times ELR times the growth curve. Fewer parameters means a smaller parameter variance.',
  '4. Variance of the Reserve\n\nThe variance of the reserve has two pieces: the process variance, which is sigma squared times the expected reserve, and the parameter variance from the information matrix.\n\nThe over-dispersed Poisson assumption means that the variance of the incremental losses is proportional to their mean, with scale factor sigma squared.',
  '5. Conclusion\n\nThe LDF method over-fits when the triangle is small; the Cape Cod method is preferred when the premium is a reliable exposure base.\n\nAppendix A\n\nThe derivation of the information matrix is given below.',
];

const MACK_PAGES = [
  'Measuring the Variability of Chain Ladder Reserve Estimates\nThomas Mack\n\nThe chain ladder method is the most widely used method of loss reserving.',
  'The chain ladder method rests on three assumptions. The first is that E[C(i, k+1) | C(i,1), ..., C(i,k)] = C(i,k) f(k): the expected next cumulative loss is the current one times a development factor that does not depend on the accident year.\n\nThe second assumption is that accident years are independent.\n\nThe third is that Var(C(i, k+1) | C(i,1), ..., C(i,k)) = C(i,k) sigma(k) squared.',
  'Under these assumptions the chain ladder estimates of the development factors are unbiased and the estimated ultimate is unbiased too.\n\nThe mean squared error of the reserve estimate is the sum of the process variance and the estimation error of the development factors.',
];

describe('stConceptState', () => {
  it('is unasked with no answers, whatever the mastery', () => {
    expect(stConceptState(concept({ answers: 0, mastery: 0.9 }), NOW, {})).toBe('unasked');
  });
  it('is weak under 0.6 and clean at 0.6', () => {
    expect(stConceptState(concept({ answers: 1, mastery: 0.59, lastAnsweredAt: NOW }), NOW, {})).toBe('weak');
    expect(stConceptState(concept({ answers: 1, mastery: 0.6, lastAnsweredAt: NOW }), NOW, {})).toBe('clean');
  });
  it('turns stale after staleDays, honouring the option', () => {
    const c = concept({ answers: 2, mastery: 0.8, lastAnsweredAt: NOW - 15 * DAY });
    expect(stConceptState(c, NOW, {})).toBe('stale');
    expect(stConceptState(c, NOW, { staleDays: 14 })).toBe('stale');
    expect(stConceptState(c, NOW, { staleDays: 30 })).toBe('clean');
    expect(stConceptState(concept({ answers: 2, mastery: 0.8, lastAnsweredAt: NOW - 14 * DAY }), NOW, { staleDays: 14 })).toBe('clean');
  });
  it('weak outranks stale', () => {
    expect(stConceptState(concept({ answers: 2, mastery: 0.2, lastAnsweredAt: NOW - 40 * DAY }), NOW, {})).toBe('weak');
  });
});

describe('stApplyAnswer', () => {
  it('moves mastery by 0.35 toward 1 for a right choice and is a pure copy', () => {
    const before = concept();
    const after = stApplyAnswer(before, { correct: true, rating: GOOD, formatUsed: 'mc', retried: false }, NOW);
    expect(after.mastery).toBeCloseTo(0.35, 6);
    expect(after.answers).toBe(1);
    expect(after.misses).toBe(0);
    expect(after.missStreak).toBe(0);
    expect(after.rightChooseAt).toBe(NOW);
    expect(after.rightTypeAt).toBe(0);
    expect(after.lastAnsweredAt).toBe(NOW);
    expect(before.mastery).toBe(0);
    expect(before.answers).toBe(0);
  });
  it('moves mastery by 0.5 for a typed Good or Easy answer and stamps rightTypeAt', () => {
    for (const rating of [GOOD, EASY]) {
      const after = stApplyAnswer(concept(), { correct: true, rating, formatUsed: 'short', retried: false }, NOW);
      expect(after.mastery).toBeCloseTo(0.5, 6);
      expect(after.rightTypeAt).toBe(NOW);
      expect(after.rightChooseAt).toBe(0);
    }
  });
  it('uses 0.5 as the target for Hard', () => {
    const after = stApplyAnswer(concept({ mastery: 0.2 }), { correct: true, rating: HARD, formatUsed: 'essay', retried: false }, NOW);
    expect(after.mastery).toBeCloseTo(0.2 + 0.5 * (0.5 - 0.2), 6);
  });
  it('a wrong answer lowers mastery, counts a miss and extends the streak', () => {
    const after = stApplyAnswer(concept({ mastery: 0.8, misses: 1, missStreak: 1, answers: 3 }), { correct: false, rating: AGAIN, formatUsed: 'mc', retried: false }, NOW);
    expect(after.mastery).toBeCloseTo(0.8 - 0.35 * 0.8, 6);
    expect(after.misses).toBe(2);
    expect(after.missStreak).toBe(2);
    expect(after.answers).toBe(4);
    expect(after.rightChooseAt).toBe(0);
  });
  it('a retried right has target 0 and does not stamp the clean marker', () => {
    const after = stApplyAnswer(concept({ mastery: 0.4 }), { correct: true, rating: GOOD, formatUsed: 'mc', retried: true }, NOW);
    expect(after.mastery).toBeCloseTo(0.4 - 0.35 * 0.4, 6);
    expect(after.rightChooseAt).toBe(0);
    expect(after.misses).toBe(0);
    expect(after.missStreak).toBe(0);
  });
  it('a right answer resets the miss streak', () => {
    const after = stApplyAnswer(concept({ missStreak: 3, misses: 3, answers: 3 }), { correct: true, rating: GOOD, formatUsed: 'cloze', retried: false }, NOW);
    expect(after.missStreak).toBe(0);
    expect(after.misses).toBe(3);
  });
  it('every typed format uses the typed alpha, mc the chosen one', () => {
    for (const f of ST_FORMATS) {
      const after = stApplyAnswer(concept(), { correct: true, rating: GOOD, formatUsed: f }, NOW);
      expect(after.mastery).toBeCloseTo(ST_TYPED.has(f) ? 0.5 : 0.35, 6);
    }
  });
});

describe('stFormatClass, stConceptIsCleanIn, stResolveFormat', () => {
  it('classes formats', () => {
    expect(stFormatClass('mc')).toBe('choose');
    for (const f of ['short', 'essay', 'numeric', 'formula', 'cloze']) expect(stFormatClass(f)).toBe('type');
  });
  it('reads the clean markers', () => {
    expect(stConceptIsCleanIn(concept({ rightChooseAt: NOW }), 'choose')).toBe(true);
    expect(stConceptIsCleanIn(concept({ rightChooseAt: NOW }), 'type')).toBe(false);
    expect(stConceptIsCleanIn(concept({ rightTypeAt: NOW }), 'type')).toBe(true);
  });
  it('choose keeps mc as mc and typed questions as they are', () => {
    expect(stResolveFormat(concept(), question({ format: 'mc' }), 'choose')).toBe('mc');
    expect(stResolveFormat(concept(), question({ format: 'short' }), 'choose')).toBe('short');
    expect(stResolveFormat(concept(), question({ format: 'formula' }), 'choose')).toBe('formula');
  });
  it('type turns an mc question into short and keeps typed ones', () => {
    expect(stResolveFormat(concept(), question({ format: 'mc' }), 'type')).toBe('short');
    expect(stResolveFormat(concept(), question({ format: 'cloze' }), 'type')).toBe('cloze');
  });
  it('mixed is mc until the concept is clean in choose, then short', () => {
    expect(stResolveFormat(concept(), question({ format: 'mc' }), 'mixed')).toBe('mc');
    expect(stResolveFormat(concept({ rightChooseAt: NOW }), question({ format: 'mc' }), 'mixed')).toBe('short');
    expect(stResolveFormat(concept({ rightTypeAt: NOW }), question({ format: 'mc' }), 'mixed')).toBe('mc');
  });
  it('essay and numeric are always their own', () => {
    for (const af of ['choose', 'type', 'mixed']) {
      expect(stResolveFormat(concept(), question({ format: 'essay' }), af)).toBe('essay');
      expect(stResolveFormat(concept({ rightChooseAt: NOW }), question({ format: 'numeric' }), af)).toBe('numeric');
    }
  });
});

describe('stDrawSession', () => {
  const concepts = [
    concept({ id: 1, materialId: 1, title: 'clean old', answers: 3, mastery: 0.9, lastAnsweredAt: NOW - 3 * DAY }),
    concept({ id: 2, materialId: 1, title: 'weak low', answers: 2, mastery: 0.1, lastAnsweredAt: NOW - DAY }),
    concept({ id: 3, materialId: 1, title: 'unasked' }),
    concept({ id: 4, materialId: 1, title: 'stale', answers: 2, mastery: 0.8, lastAnsweredAt: NOW - 30 * DAY }),
    concept({ id: 5, materialId: 1, title: 'weak high', answers: 2, mastery: 0.4, lastAnsweredAt: NOW - DAY }),
    concept({ id: 6, materialId: 1, title: 'clean new', answers: 3, mastery: 0.9, lastAnsweredAt: NOW - DAY }),
  ];
  const questions = concepts.flatMap((c) => [
    question({ id: c.id * 10 + 1, conceptId: c.id, format: 'mc' }),
    question({ id: c.id * 10 + 2, conceptId: c.id, format: 'short' }),
  ]);

  it('orders concepts unasked, weak by lowest mastery, stale, clean by oldest answer', () => {
    const drawn = stDrawSession({ questions, concepts, size: 6, exclude: new Set(), answerFormat: 'choose', now: NOW, rng: seeded(1) });
    expect(drawn.map((q: { conceptId: number }) => q.conceptId)).toEqual([3, 2, 5, 4, 1, 6]);
  });

  it('gives one question per concept before a second round, and never repeats a question', () => {
    const drawn = stDrawSession({ questions, concepts, size: 20, exclude: new Set(), answerFormat: 'mixed', now: NOW, rng: seeded(2) });
    expect(drawn).toHaveLength(12);
    const firstRound = drawn.slice(0, 6).map((q: { conceptId: number }) => q.conceptId);
    expect(new Set(firstRound).size).toBe(6);
    expect(new Set(drawn.map((q: { id: number }) => q.id)).size).toBe(12);
  });

  it('honours size and the exclude set', () => {
    const exclude = new Set([31, 32, 21]);
    const drawn = stDrawSession({ questions, concepts, size: 3, exclude, answerFormat: 'choose', now: NOW, rng: seeded(3) });
    expect(drawn).toHaveLength(3);
    for (const q of drawn) expect(exclude.has(q.id)).toBe(false);
    expect(drawn.map((q: { conceptId: number }) => q.conceptId)).toEqual([2, 5, 4]);
    expect(drawn.some((q: { conceptId: number }) => q.conceptId === 3)).toBe(false);
  });

  it('skips hidden questions and concepts out of scope', () => {
    const qs = [question({ id: 1, conceptId: 1, hidden: 1 }), question({ id: 2, conceptId: 99 }), question({ id: 3, conceptId: 1 })];
    const drawn = stDrawSession({ questions: qs, concepts: [concept({ id: 1 })], size: 10, exclude: new Set(), answerFormat: 'choose', now: NOW, rng: seeded(4) });
    expect(drawn.map((q: { id: number }) => q.id)).toEqual([3]);
  });

  it('prefers the format the answer format picks: mc for choose, typed for type, by cleanliness for mixed', () => {
    const cs = [concept({ id: 1 }), concept({ id: 2, rightChooseAt: NOW, answers: 1, mastery: 0.7, lastAnsweredAt: NOW })];
    const qs = [
      question({ id: 11, conceptId: 1, format: 'mc' }), question({ id: 12, conceptId: 1, format: 'short' }),
      question({ id: 21, conceptId: 2, format: 'mc' }), question({ id: 22, conceptId: 2, format: 'short' }),
    ];
    for (const seed of [1, 2, 3, 4, 5]) {
      const choose = stDrawSession({ questions: qs, concepts: cs, size: 2, exclude: new Set(), answerFormat: 'choose', now: NOW, rng: seeded(seed) });
      expect(choose.map((q: { format: string }) => q.format)).toEqual(['mc', 'mc']);
      const type = stDrawSession({ questions: qs, concepts: cs, size: 2, exclude: new Set(), answerFormat: 'type', now: NOW, rng: seeded(seed) });
      expect(type.map((q: { format: string }) => q.format)).toEqual(['short', 'short']);
      const mixed = stDrawSession({ questions: qs, concepts: cs, size: 2, exclude: new Set(), answerFormat: 'mixed', now: NOW, rng: seeded(seed) });
      expect(mixed.map((q: { conceptId: number; format: string }) => `${q.conceptId}:${q.format}`)).toEqual(['1:mc', '2:short']);
    }
  });

  it('round-robins across materials so no two consecutive questions share one', () => {
    const cs = [
      ...[1, 2, 3, 4].map((i) => concept({ id: i, materialId: 1 })),
      ...[5, 6, 7, 8].map((i) => concept({ id: i, materialId: 2 })),
      ...[9, 10].map((i) => concept({ id: i, materialId: 3 })),
    ];
    const qs = cs.map((c) => question({ id: c.id, conceptId: c.id, materialId: c.materialId }));
    const drawn = stDrawSession({ questions: qs, concepts: cs, size: 10, exclude: new Set(), answerFormat: 'choose', now: NOW, rng: seeded(9) });
    expect(drawn).toHaveLength(10);
    for (let i = 1; i < drawn.length; i++) expect(drawn[i].materialId).not.toBe(drawn[i - 1].materialId);
  });

  it('is deterministic given the rng and varies with it', () => {
    const cs = [1, 2, 3, 4, 5, 6].map((i) => concept({ id: i }));
    const qs = cs.flatMap((c) => [question({ id: c.id * 10, conceptId: c.id }), question({ id: c.id * 10 + 1, conceptId: c.id })]);
    const a = stDrawSession({ questions: qs, concepts: cs, size: 12, exclude: new Set(), answerFormat: 'choose', now: NOW, rng: seeded(11) });
    const b = stDrawSession({ questions: qs, concepts: cs, size: 12, exclude: new Set(), answerFormat: 'choose', now: NOW, rng: seeded(11) });
    expect(a.map((q: { id: number }) => q.id)).toEqual(b.map((q: { id: number }) => q.id));
    const seen = new Set<string>();
    for (let s = 1; s <= 12; s++) seen.add(stDrawSession({ questions: qs, concepts: cs, size: 12, exclude: new Set(), answerFormat: 'choose', now: NOW, rng: seeded(s) }).map((q: { id: number }) => q.id).join(','));
    expect(seen.size).toBeGreaterThan(1);
  });

  it('returns [] for size 0 or no candidates', () => {
    expect(stDrawSession({ questions, concepts, size: 0, exclude: new Set(), answerFormat: 'choose', now: NOW, rng: seeded(1) })).toEqual([]);
    expect(stDrawSession({ questions: [], concepts, size: 5, exclude: new Set(), answerFormat: 'choose', now: NOW, rng: seeded(1) })).toEqual([]);
  });
});

describe('stCoverage and stSessionSummary', () => {
  it('counts states and lists them in order', () => {
    const cs = [
      concept({ id: 1 }),
      concept({ id: 2, answers: 1, mastery: 0.2, lastAnsweredAt: NOW }),
      concept({ id: 3, answers: 1, mastery: 0.9, lastAnsweredAt: NOW }),
      concept({ id: 4, answers: 1, mastery: 0.9, lastAnsweredAt: NOW - 20 * DAY }),
    ];
    const cov = stCoverage(cs, NOW, { staleDays: 14 });
    expect(cov).toMatchObject({ total: 4, unasked: 1, weak: 1, clean: 1, stale: 1 });
    expect(cov.states).toEqual(['unasked', 'weak', 'clean', 'stale']);
    expect(stCoverage([], NOW, {})).toMatchObject({ total: 0, clean: 0, weak: 0, unasked: 0, stale: 0, states: [] });
  });

  it('tallies a session and marks a second miss on the same concept', () => {
    const cs = [concept({ id: 1 }), concept({ id: 2, missStreak: 2 }), concept({ id: 3 })];
    const items = [
      { questionId: 11, conceptId: 1, status: 'wrong', verdict: { note: 'Missed the tail factor.' } },
      { questionId: 12, conceptId: 1, status: 'wrong', verdict: '{"note":"Again."}' },
      { questionId: 21, conceptId: 2, status: 'wrong' },
      { questionId: 31, conceptId: 3, status: 'right' },
      { questionId: 32, conceptId: 3, status: 'skipped' },
      { questionId: 33, conceptId: 3, status: 'pending' },
    ];
    const s = stSessionSummary(items, cs);
    expect(s).toMatchObject({ right: 1, wrong: 3, skipped: 1, answered: 4 });
    expect(s.missed).toEqual([
      { conceptId: 1, questionId: 11, note: 'Missed the tail factor.', secondMiss: false },
      { conceptId: 1, questionId: 12, note: 'Again.', secondMiss: true },
      { conceptId: 2, questionId: 21, note: '', secondMiss: true },
    ]);
  });

  it('reads the concept from an attached question when the item has none', () => {
    const s = stSessionSummary([{ status: 'wrong', question: { id: 7, conceptId: 4 } }], []);
    expect(s.missed).toEqual([{ conceptId: 4, questionId: 7, note: '', secondMiss: false }]);
  });
});

describe('stContextPlan and stChunkPages', () => {
  it('sizes the window from the material and output, rounded to 2048, at least 8192', () => {
    const small = stContextPlan({ chars: 1000, outputTokens: 2000, modelCtx: 32768, setting: 0 });
    expect(small.numCtx).toBe(8192);
    expect(small.maxChars).toBeGreaterThan(4000);
    const big = stContextPlan({ chars: 100_000, outputTokens: 4000, modelCtx: 32768, setting: 0 });
    expect(big.numCtx).toBe(32768);
    expect(big.numCtx % 2048).toBe(0);
    expect(big.maxChars).toBeLessThan(100_000);
  });
  it('a fixed setting caps the window and the model limit caps the setting', () => {
    expect(stContextPlan({ chars: 100_000, outputTokens: 2000, modelCtx: 32768, setting: 16384 }).numCtx).toBe(16384);
    expect(stContextPlan({ chars: 100, outputTokens: 2000, modelCtx: 8192, setting: 65536 }).numCtx).toBe(8192);
  });
  it('maxChars never drops under 4000', () => {
    expect(stContextPlan({ chars: 0, outputTokens: 7000, modelCtx: 4096, setting: 4096 }).maxChars).toBe(4000);
  });

  it('chunks whole pages under maxChars, tagging pages, never splitting one', () => {
    const chunks = stChunkPages(CLARK_PAGES, { from: 1, to: 6, maxChars: 700 });
    expect(chunks.length).toBeGreaterThan(1);
    let next = 1;
    for (const c of chunks) {
      expect(c.pageFrom).toBe(next);
      expect(c.pageTo).toBeGreaterThanOrEqual(c.pageFrom);
      expect(c.text).toContain(`[Page ${c.pageFrom}]`);
      for (let p = c.pageFrom; p <= c.pageTo; p++) expect(c.text).toContain(CLARK_PAGES[p - 1].trim().slice(0, 40));
      next = c.pageTo + 1;
    }
    expect(next).toBe(7);
  });
  it('a page longer than maxChars is its own chunk, intact', () => {
    const chunks = stChunkPages(['a'.repeat(50), 'b'.repeat(500), 'c'.repeat(50)], { maxChars: 100 });
    expect(chunks.map((c: { pageFrom: number; pageTo: number }) => [c.pageFrom, c.pageTo])).toEqual([[1, 1], [2, 2], [3, 3]]);
    expect(chunks[1].text).toContain('b'.repeat(500));
  });
  it('honours from and to and clamps them', () => {
    const chunks = stChunkPages(CLARK_PAGES, { from: 3, to: 4, maxChars: 100_000 });
    expect(chunks).toEqual([{ pageFrom: 3, pageTo: 4, text: expect.stringContaining('[Page 4]') }]);
    expect(chunks[0].text).not.toContain('[Page 5]');
    expect(stChunkPages(CLARK_PAGES, { from: 0, to: 99, maxChars: 100_000 })[0]).toMatchObject({ pageFrom: 1, pageTo: 6 });
    expect(stChunkPages([], {})).toEqual([]);
  });
});

describe('stSkeleton, stAnchorOnPage, stFindAnchorPage', () => {
  it('keeps letters and digits only, lower-cased and NFKC-folded', () => {
    expect(stSkeleton('The ULTIMATE loss: 1,234!')).toBe('theultimateloss1234');
    expect(stSkeleton('eﬃcient ﬁt')).toBe('efficientfit');
    expect(stSkeleton('𝑥 squared')).toBe('xsquared');
    expect(stSkeleton('')).toBe('');
  });
  it('anchors exactly through hyphenation, line breaks, case and punctuation', () => {
    const page = 'The ulti-\nmate loss is NOT the same as the expected loss!  See “Section 2”.';
    expect(stAnchorOnPage('the ultimate loss is not the same as the expected loss', page)).toEqual({ ok: true, similarity: 1 });
    expect(stAnchorOnPage('See "Section 2"', page).ok).toBe(true);
  });
  it('anchors through extraction spacing exactly, through a few character errors at 0.9, and refuses a changed passage', () => {
    const quote = 'The loglogistic curve is G(x) = x^omega / (x^omega + theta^omega), where x is the average age of the accident period';
    const spaced = CLARK_PAGES[2].replace('loglogistic curve is', 'log logistic cur ve  is').replace('average age', 'avera ge age');
    expect(stAnchorOnPage(quote, spaced)).toEqual({ ok: true, similarity: 1 });
    const typos = CLARK_PAGES[2].replace('loglogistic curve', 'loglogistc curve').replace('accident period', 'acident period').replace('average', 'averge');
    const r = stAnchorOnPage(quote, typos);
    expect(r.ok).toBe(true);
    expect(r.similarity).toBeGreaterThanOrEqual(0.9);
    expect(r.similarity).toBeLessThan(1);
    const dropped = CLARK_PAGES[2].replace('x^omega / (x^omega + theta^omega)', 'x over theta');
    const miss = stAnchorOnPage(quote, dropped);
    expect(miss.ok).toBe(false);
    expect(miss.similarity).toBeLessThan(0.9);
    expect(miss.similarity).toBeGreaterThan(0);
    expect(stAnchorOnPage(quote, MACK_PAGES[1]).ok).toBe(false);
  });
  it('a short quote only anchors exactly, and empty input never anchors', () => {
    expect(stAnchorOnPage('Cape Cod', CLARK_PAGES[3]).ok).toBe(true);
    expect(stAnchorOnPage('Cape Cot', CLARK_PAGES[3]).ok).toBe(false);
    expect(stAnchorOnPage('', CLARK_PAGES[3]).ok).toBe(false);
    expect(stAnchorOnPage('anything', '').ok).toBe(false);
  });
  it('finds the page: the hint first, then neighbours, then all; 0 when absent', () => {
    expect(stFindAnchorPage('Fewer parameters means a smaller parameter variance', CLARK_PAGES, 4)).toBe(4);
    expect(stFindAnchorPage('Fewer parameters means a smaller parameter variance', CLARK_PAGES, 2)).toBe(4);
    expect(stFindAnchorPage('Fewer parameters means a smaller parameter variance', CLARK_PAGES, 0)).toBe(4);
    expect(stFindAnchorPage('The derivation of the information matrix is given below', CLARK_PAGES, 1)).toBe(6);
    expect(stFindAnchorPage('accident years are independent', CLARK_PAGES, 3)).toBe(0);
    expect(stFindAnchorPage('anything at all here', [], 1)).toBe(0);
  });
  it('a quote on two pages with a hint picks the hinted one', () => {
    const pages = ['The Cape Cod method fits one expected loss ratio', 'filler', 'The Cape Cod method fits one expected loss ratio'];
    expect(stFindAnchorPage('The Cape Cod method fits one expected loss ratio', pages, 3)).toBe(3);
    expect(stFindAnchorPage('The Cape Cod method fits one expected loss ratio', pages, undefined)).toBe(1);
  });
});

describe('stHeadingsFromPages', () => {
  it('finds numbered headings in a paper and builds contiguous ranges with levels', () => {
    const sections = stHeadingsFromPages(CLARK_PAGES);
    const titles = sections.map((s: { title: string }) => s.title);
    expect(titles).toEqual([
      'Page 1',
      '1. Introduction',
      '2. The Growth Curve',
      '2.1 The Weibull Alternative',
      '3. The Two Methods',
      '3.1 LDF Method',
      '3.2 Cape Cod Method',
      '4. Variance of the Reserve',
      '5. Conclusion',
      'Appendix A',
    ]);
    expect(sections[0]).toEqual({ title: 'Page 1', pageFrom: 1, pageTo: 1, level: 1 });
    expect(sections[1]).toEqual({ title: '1. Introduction', pageFrom: 2, pageTo: 2, level: 1 });
    expect(sections[2]).toMatchObject({ pageFrom: 3, pageTo: 3, level: 1 });
    expect(sections[3]).toMatchObject({ pageFrom: 3, pageTo: 3, level: 2 });
    expect(sections[4]).toMatchObject({ pageFrom: 4, pageTo: 4, level: 1 });
    expect(sections[7]).toMatchObject({ pageFrom: 5, pageTo: 5, level: 1 });
    expect(sections[8]).toMatchObject({ pageFrom: 6, pageTo: 6, level: 1 });
    expect(sections[9]).toMatchObject({ title: 'Appendix A', pageFrom: 6, pageTo: 6, level: 1 });
    // Top-level ranges cover the document without gaps.
    const top = sections.filter((s: { level: number }) => s.level === 1);
    for (let i = 1; i < top.length; i++) expect(top[i].pageFrom).toBeGreaterThanOrEqual(top[i - 1].pageTo);
    expect(top[top.length - 1].pageTo).toBe(CLARK_PAGES.length);
  });
  it('a front matter before the first heading becomes a leading Pages section, so ranges start at 1', () => {
    const pages = ['Cover page\nStudy note', 'Contents without numbers', ...CLARK_PAGES.slice(1)];
    const sections = stHeadingsFromPages(pages);
    expect(sections[0]).toEqual({ title: 'Pages 1–2', pageFrom: 1, pageTo: 2, level: 1 });
    expect(sections[1]).toMatchObject({ title: '1. Introduction', pageFrom: 3 });
  });
  it('recognises Chapter, CHAPTER n Title and Section n, each once (running headers repeat)', () => {
    const pages = [
      'CHAPTER 3 Loss Reserving\nThe chain ladder method is the most widely used method of loss reserving.',
      'CHAPTER 3 Loss Reserving\nSection 1\nAssumptions of the model follow.',
      'CHAPTER 3 Loss Reserving\nSection 2\nThe variance of the estimate.',
      'Chapter 4\nStochastic Reserving\nSome text here.',
      'Chapter 4\nMore text.',
    ];
    const sections = stHeadingsFromPages(pages);
    expect(sections.map((s: { title: string; pageFrom: number; pageTo: number; level: number }) => [s.title, s.pageFrom, s.pageTo, s.level])).toEqual([
      ['CHAPTER 3 Loss Reserving', 1, 3, 1],
      ['Section 1', 2, 2, 2],
      ['Section 2', 3, 3, 2],
      ['Chapter 4', 4, 5, 1],
    ]);
  });
  it('Section headings are top level when a document has no chapters', () => {
    const pages = ['Section 1 Overview\ntext', 'text', 'Section 2 The Model\ntext'];
    const sections = stHeadingsFromPages(pages);
    expect(sections.map((s: { level: number }) => s.level)).toEqual([1, 1]);
    expect(sections[0]).toMatchObject({ pageFrom: 1, pageTo: 2 });
  });
  it('ignores sentences that begin with a number, contents lines, and list pages', () => {
    const pages = [
      '1. Introduction\n3. The reserve is the ultimate loss less paid loss.\n2 years later the claim closed.',
      'Contents\n1. Introduction ........ 1\n2. Methods ........ 5\n3. Results ........ 9',
      '2. Methods\nExercises\n1. Compute the reserve\n2. Show the variance\n3. Derive the factor\n4. State the assumptions\n5. Explain the tail\n6. Fit the curve',
    ];
    const sections = stHeadingsFromPages(pages);
    expect(sections.map((s: { title: string }) => s.title)).toEqual(['1. Introduction', '2. Methods']);
  });
  it('falls back to Pages a–b every 8 pages with fewer than two headings', () => {
    const pages = Array.from({ length: 19 }, (_, i) => `Plain prose on page ${i + 1} with no headings at all.`);
    expect(stHeadingsFromPages(pages)).toEqual([
      { title: 'Pages 1–8', pageFrom: 1, pageTo: 8, level: 1 },
      { title: 'Pages 9–16', pageFrom: 9, pageTo: 16, level: 1 },
      { title: 'Pages 17–19', pageFrom: 17, pageTo: 19, level: 1 },
    ]);
    const one = ['1. Only heading\ntext', 'text'];
    expect(stHeadingsFromPages(one)).toEqual([{ title: 'Pages 1–2', pageFrom: 1, pageTo: 2, level: 1 }]);
    expect(stHeadingsFromPages(['one page'])).toEqual([{ title: 'Page 1', pageFrom: 1, pageTo: 1, level: 1 }]);
    expect(stHeadingsFromPages([])).toEqual([]);
  });
  it('handles CRLF and indented headings', () => {
    const pages = ['  1. Introduction\r\ntext', '  2. Methods\r\ntext'];
    expect(stHeadingsFromPages(pages).map((s: { title: string }) => s.title)).toEqual(['1. Introduction', '2. Methods']);
  });
});

describe('stSectionsFromOutline', () => {
  it('turns an outline into ranges, nested entries inside their parent', () => {
    const outline = [
      { title: 'Introduction', page: 2, level: 1 },
      { title: 'The Growth Curve', page: 3, level: 1 },
      { title: 'The Weibull Alternative', page: 3, level: 2 },
      { title: 'The Two Methods', page: 4, level: 1 },
      { title: 'LDF Method', page: 4, level: 2 },
      { title: 'Cape Cod Method', page: 5, level: 2 },
      { title: 'Conclusion', page: 7, level: 1 },
    ];
    const sections = stSectionsFromOutline(outline, 8);
    expect(sections).toEqual([
      { title: 'Page 1', pageFrom: 1, pageTo: 1, level: 1 },
      { title: 'Introduction', pageFrom: 2, pageTo: 2, level: 1 },
      { title: 'The Growth Curve', pageFrom: 3, pageTo: 3, level: 1 },
      { title: 'The Weibull Alternative', pageFrom: 3, pageTo: 3, level: 2 },
      { title: 'The Two Methods', pageFrom: 4, pageTo: 6, level: 1 },
      { title: 'LDF Method', pageFrom: 4, pageTo: 4, level: 2 },
      { title: 'Cape Cod Method', pageFrom: 5, pageTo: 6, level: 2 },
      { title: 'Conclusion', pageFrom: 7, pageTo: 8, level: 1 },
    ]);
  });
  it('drops entries off the page range or without a title, sorts by page, and is empty without pages', () => {
    const out = stSectionsFromOutline([{ title: 'B', page: 5, level: 1 }, { title: '', page: 2 }, { title: 'Z', page: 99 }, { title: 'A', page: 1 }], 6);
    expect(out).toEqual([{ title: 'A', pageFrom: 1, pageTo: 4, level: 1 }, { title: 'B', pageFrom: 5, pageTo: 6, level: 1 }]);
    expect(stSectionsFromOutline([{ title: 'A', page: 1 }], 0)).toEqual([]);
    expect(stSectionsFromOutline(null, 5)).toEqual([]);
  });
});

describe('stExtractJsonArray and stExtractJsonObject', () => {
  it('parses an array inside fences with trailing prose', () => {
    const text = 'Here are the questions:\n```json\n[{"stem": "What is G(x)?", "answer": 0}]\n```\nLet me know if you want more.';
    const r = stExtractJsonArray(text);
    expect(r.error).toBeNull();
    expect(r.items).toEqual([{ stem: 'What is G(x)?', answer: 0 }]);
    expect(r.truncated).toBe(false);
  });
  it('repairs LaTeX escapes inside math and keeps real newlines outside it', () => {
    const text = '[{"answer": "$G(x) = \\frac{x^\\omega}{x^\\omega + \\theta^\\omega}$", "note": "line one\\nline two"}]';
    const r = stExtractJsonArray(text);
    expect(r.items[0].answer).toBe('$G(x) = \\frac{x^\\omega}{x^\\omega + \\theta^\\omega}$');
    expect(r.items[0].note).toBe('line one\nline two');
  });
  it('skips a citation bracket, drops think blocks, salvages a truncated array', () => {
    const r = stExtractJsonArray('<think>[{"a": 0}] was my draft</think> See [Clark, 2003]. [{"a": 1}, {"a": 2}');
    expect(r.items).toEqual([{ a: 1 }, { a: 2 }]);
    expect(r.truncated).toBe(true);
  });
  it('maps candidates through mapSlice and rejects with null', () => {
    const r = stExtractJsonArray('[1, 2] then [{"stem": "x"}]', (arr: unknown[]) => (arr.every((x) => typeof x === 'object') ? arr : null));
    expect(r.items).toEqual([{ stem: 'x' }]);
  });
  it('reports the failure modes', () => {
    expect(stExtractJsonArray('').error).toBe('Empty response.');
    expect(stExtractJsonArray('no brackets here').error).toBe('No JSON array in response.');
    expect(stExtractJsonArray('[]').error).toBe('No usable items in response.');
    expect(stExtractJsonArray('[{"a": 1').error).toMatch(/cut off/);
  });
  it('extracts an object with fences, LaTeX and leading think text', () => {
    const o = stExtractJsonObject('<think>hmm</think>```json\n{"points": [{"status": "hit"}], "contradiction": false, "note": "$\\sigma^2$"}\n```');
    expect(o).toEqual({ points: [{ status: 'hit' }], contradiction: false, note: '$\\sigma^2$' });
    expect(stExtractJsonObject('[1,2]')).toBeNull();
    expect(stExtractJsonObject('{"a": ')).toBeNull();
    expect(stExtractJsonObject('')).toBeNull();
  });
});

describe('the rubric grader (M102 port)', () => {
  const three = [{ text: 'States the three assumptions', required: true }, { text: 'Names the independence of accident years', required: true }, { text: 'Gives the variance form', required: false }];
  const five = ['a', 'b', 'c', 'd', 'e'];
  const v = (statuses: string[], extra: Record<string, unknown> = {}) => ({ points: statuses.map((status) => ({ status })), contradiction: false, note: '', ...extra });

  it('normalises rubric strings, objects, JSON and caps at 12 points', () => {
    expect(stNormalizeRubric(['  a  b ', { point: 'c', required: false }, { text: '' }, 7])).toEqual([
      { text: 'a b', required: true }, { text: 'c', required: false }, { text: '7', required: true },
    ]);
    expect(stNormalizeRubric('[{"text":"x","required":false}]')).toEqual([{ text: 'x', required: false }]);
    expect(stNormalizeRubric('not json')).toEqual([]);
    expect(stNormalizeRubric(Array.from({ length: 20 }, (_, i) => `p${i}`))).toHaveLength(12);
  });

  it('normalises a verdict positionally, pads short arrays with misses, reads yes/no and a JSON string', () => {
    const verdict = stNormalizeVerdict({ points: ['hit', { status: 'PARTIAL', note: 'hedged' }, 'yes'], contradicts: true, feedback: 'ok' }, five);
    expect(verdict.points.map((p: { status: string }) => p.status)).toEqual(['hit', 'partial', 'hit', 'miss', 'miss']);
    expect(verdict.points[1].note).toBe('hedged');
    expect(verdict.contradiction).toBe(true);
    expect(verdict.note).toBe('ok');
    expect(stNormalizeVerdict('```json\n{"points":[{"status":"no"}]}\n```', ['a']).points[0].status).toBe('miss');
    expect(stNormalizeVerdict(null, ['a'])).toEqual({ points: [{ status: 'miss', note: '' }], contradiction: false, note: '' });
  });

  it('scores with partials at half and reports required misses and gaps', () => {
    const s = stScoreVerdict(v(['hit', 'partial', 'miss']), three);
    expect(s).toMatchObject({ score: 0.5, hits: 1, partials: 1, misses: 1, total: 3, requiredMissed: false, gaps: 2 });
    expect(stScoreVerdict(v(['miss', 'hit', 'hit']), three).requiredMissed).toBe(true);
    expect(stScoreVerdict(v([]), []).total).toBe(0);
  });

  it('maps thresholds: 2 of 3 is Good, 3 of 5 is Hard, all hit is Easy, one-point rubric tops at Good', () => {
    expect(stMapVerdictToRating(v(['hit', 'hit', 'miss']), three)).toBe(GOOD);
    expect(stMapVerdictToRating(v(['hit', 'hit', 'hit', 'miss', 'miss']), five)).toBe(HARD);
    expect(stMapVerdictToRating(v(['hit', 'hit', 'hit']), three)).toBe(EASY);
    expect(stMapVerdictToRating(v(['hit']), ['only']), 'one point').toBe(GOOD);
    expect(stMapVerdictToRating(v(['miss', 'miss', 'hit']), three)).toBe(AGAIN);
    expect(stMapVerdictToRating(v(['hit', 'hit', 'hit', 'hit']), ['a', 'b', 'c', 'd']), 'all required hits').toBe(EASY);
    expect(stMapVerdictToRating(v(['hit', 'hit', 'hit', 'partial']), ['a', 'b', 'c', 'd']), 'a partial is not Easy').toBe(GOOD);
    expect(stMapVerdictToRating(v(['hit', 'hit', 'miss', 'miss']), ['a', 'b', 'c', 'd']), 'two required misses at 0.5').toBe(HARD);
  });

  it('a contradiction outranks a full score, and no rubric gives null', () => {
    expect(stMapVerdictToRating(v(['hit', 'hit', 'hit'], { contradiction: true }), three)).toBe(AGAIN);
    expect(stMapVerdictToRating(v(['hit']), [])).toBeNull();
  });

  it('labels verdicts', () => {
    expect(stVerdictLabel(v(['hit', 'hit', 'hit']), three)).toBe('Complete');
    expect(stVerdictLabel(v(['hit', 'hit', 'miss']), three)).toBe('Two of three');
    expect(stVerdictLabel(v(['hit', 'hit', 'hit', 'miss', 'miss']), five)).toBe('Three of five');
    expect(stVerdictLabel(v(['miss', 'miss', 'hit']), three)).toBe('Not quite');
    expect(stVerdictLabel(v(['hit', 'hit', 'hit'], { contradiction: true }), three)).toBe('Contradicts the source');
    expect(stVerdictLabel(v([]), [])).toBe('Not quite');
  });

  it('names ratings', () => {
    expect([1, 2, 3, 4].map(stRatingWord)).toEqual(['Again', 'Hard', 'Good', 'Easy']);
    expect(stRatingWord(0)).toBe('');
  });
});

describe('formula, numeric and cloze matching', () => {
  it('matches formulas after normalisation and not otherwise', () => {
    expect(stFormulaMatches('$G(x) = \\frac{x^2}{x^2 + \\theta^2}$', 'G(x)=\\frac{x^{2}}{x^{2}+\\theta^{2}}')).toBe(true);
    expect(stFormulaMatches('\\frac{x^\\omega}{x^\\omega + \\theta^\\omega}', '\\frac{x^{\\omega}}{x^{\\omega}+\\theta^{\\omega}}'), 'braced commands are left to the model').toBe(false);
    expect(stFormulaMatches('a \\cdot b', 'a \\times b')).toBe(true);
    expect(stFormulaMatches('\\left( a + b \\right)', '(a+b)')).toBe(true);
    expect(stFormulaMatches('\\mathrm{ELR} \\, P', 'ELR P')).toBe(true);
    expect(stFormulaMatches('a + b', 'a - b')).toBe(false);
    expect(stFormulaMatches('', '')).toBe(false);
    expect(stNormalizeFormula('x^{2}')).toBe('x^2');
  });

  it('parses commas, currency, percents, suffixes and parentheses', () => {
    expect(stNumericMatches('1,234.5', 1234.5, 0.005)).toBe(true);
    expect(stNumericMatches('$1.2M', 1_200_000, 0.005)).toBe(true);
    expect(stNumericMatches('12.5%', 0.125, 0.005)).toBe(true);
    expect(stNumericMatches('12.5%', 12.5, 0.005)).toBe(true);
    expect(stNumericMatches('12.5', '12.5%', 0.005)).toBe(true);
    expect(stNumericMatches('(150)', -150, 0.005)).toBe(true);
    expect(stNumericMatches('650 dollars', '650', 0.005)).toBe(true);
    expect(stNumericMatches('3.2e-4', 0.00032, 0.005)).toBe(true);
    expect(stNumericMatches('about 1,000', 1000, 0)).toBe(true);
  });
  it('applies the relative tolerance, absolute near zero, and refuses non-numbers', () => {
    expect(stNumericMatches('1004', 1000, 0.005)).toBe(true);
    expect(stNumericMatches('1006', 1000, 0.005)).toBe(false);
    expect(stNumericMatches('0.0000000001', 0, 0.005)).toBe(true);
    expect(stNumericMatches('0.001', 0, 0.005)).toBe(false);
    expect(stNumericMatches('twelve', 12, 0.005)).toBe(false);
    expect(stNumericMatches('', 12, 0.005)).toBe(false);
    expect(stNumericMatches('12', 'n/a', 0.005)).toBe(false);
  });

  it('folds case, whitespace, punctuation and articles for cloze, with aliases', () => {
    expect(stClozeMatches('cape cod', 'Cape Cod', ['Cape-Cod'])).toBe(true);
    expect(stClozeMatches('  CAPE-COD ', 'Cape Cod', [])).toBe(true);
    expect(stClozeMatches('the Cape Cod method', 'Cape Cod method', [])).toBe(true);
    expect(stClozeMatches('Bornhuetter Ferguson', 'Cape Cod', ['BF', 'Bornhuetter-Ferguson'])).toBe(true);
    expect(stClozeMatches('chain ladder', 'Cape Cod', ['BF'])).toBe(false);
    expect(stClozeMatches('', 'Cape Cod', [])).toBe(false);
  });
});

describe('stValidateQuestion and stDistractorPrompts', () => {
  const mc = { format: 'mc', stem: 'Which curve has the thinner tail?', options: ['Weibull', 'Loglogistic', 'Pareto', 'Normal'], answer: 0, explanation: 'The Weibull approaches 1 faster.', quote: 'gives a thinner tail', page: 3, difficulty: 'medium' };

  it('accepts a well-formed mc question into the StQuestion shape', () => {
    const r = stValidateQuestion(mc, { choices: 4 });
    expect(r.ok).toBe(true);
    expect(r.question).toMatchObject({
      format: 'mc', stem: mc.stem, options: mc.options, answer: '0', explanation: mc.explanation,
      sourcePage: 3, sourceQuote: 'gives a thinner tail', difficulty: 'medium', origin: 'generated', hidden: 0,
      checks: { anchor: null, support: null, distractor: null, numeric: null },
    });
  });
  it('rejects a bad option count, an answer out of range, duplicates and empties', () => {
    expect(stValidateQuestion({ ...mc, options: mc.options.slice(0, 3) }, { choices: 4 })).toMatchObject({ ok: false, reason: expect.stringContaining('options') });
    expect(stValidateQuestion(mc, { choices: 5 }).ok).toBe(false);
    expect(stValidateQuestion({ ...mc, answer: 4 }, { choices: 4 })).toMatchObject({ ok: false, reason: 'answer out of range' });
    expect(stValidateQuestion({ ...mc, answer: -1 }, { choices: 4 }).ok).toBe(false);
    expect(stValidateQuestion({ ...mc, options: ['Weibull', 'weibull', 'Pareto', 'Normal'] }, { choices: 4 }).ok).toBe(false);
    expect(stValidateQuestion({ ...mc, options: ['Weibull', '', 'Pareto', 'Normal'] }, { choices: 4 }).ok).toBe(false);
  });
  it('accepts a letter, a numeric string or the option text as the mc answer', () => {
    expect(stValidateQuestion({ ...mc, answer: 'B' }, { choices: 4 }).question.answer).toBe('1');
    expect(stValidateQuestion({ ...mc, answer: '2' }, { choices: 4 }).question.answer).toBe('2');
    expect(stValidateQuestion({ ...mc, answer: 'normal' }, { choices: 4 }).question.answer).toBe('3');
  });
  it('rejects a missing stem, quote or unknown format, and non-objects', () => {
    expect(stValidateQuestion({ ...mc, stem: ' ' }, { choices: 4 })).toMatchObject({ ok: false, reason: 'empty stem' });
    expect(stValidateQuestion({ ...mc, quote: '' }, { choices: 4 })).toMatchObject({ ok: false, reason: 'no quote' });
    expect(stValidateQuestion({ ...mc, format: 'truefalse' }, { choices: 4 })).toMatchObject({ ok: false, reason: 'unknown format' });
    expect(stValidateQuestion(null, { choices: 4 }).ok).toBe(false);
    expect(stValidateQuestion([], { choices: 4 }).ok).toBe(false);
  });
  it('validates short and essay with a rubric, numeric with a solve() and expected value, formula and cloze', () => {
    const short = stValidateQuestion({ format: 'short', stem: 'What does the Cape Cod method fit?', answer: 'One ELR for every year.', rubric: ['one expected loss ratio', { text: 'for every year', required: false }], quote: 'fits one expected loss ratio', page: 4 }, { choices: 4 });
    expect(short.ok).toBe(true);
    expect(short.question.rubric).toEqual([{ text: 'one expected loss ratio', required: true }, { text: 'for every year', required: false }]);
    expect(short.question.rubricOrigin).toBe('source');
    expect(stValidateQuestion({ format: 'essay', stem: 'Explain.', answer: '', quote: 'q' }, {})).toMatchObject({ ok: false, reason: 'empty answer' });

    const numeric = stValidateQuestion({ format: 'numeric', stem: 'Ultimate?', inputs: { premium: 1000, elr: 0.65 }, solutionPy: "def solve(i):\n    return i['premium'] * i['elr']", expected: '650', units: '', quote: 'premium times ELR', page: 4 }, {});
    expect(numeric.ok).toBe(true);
    expect(numeric.question.answer).toBe('650');
    expect(numeric.question.numeric).toEqual({ inputs: { premium: 1000, elr: 0.65 }, solutionPy: expect.stringContaining('def solve'), expected: 650, units: '', tolerance: null, executed: false, agreed: null });
    expect(stValidateQuestion({ format: 'numeric', stem: 'x', inputs: {}, solutionPy: 'print(1)', expected: 1, quote: 'q' }, {}).ok).toBe(false);
    expect(stValidateQuestion({ format: 'numeric', stem: 'x', inputs: {}, solutionPy: 'def solve(i): return 1', expected: 'many', quote: 'q' }, {}).ok).toBe(false);

    const formula = stValidateQuestion({ format: 'formula', stem: 'Loglogistic G(x)?', answer: 'G(x) = \\frac{x^\\omega}{x^\\omega + \\theta^\\omega}', quote: 'q', page: 3 }, {});
    expect(formula.ok).toBe(true);
    expect(stValidateQuestion({ format: 'formula', stem: 'x', answer: '$$', quote: 'q' }, {}).ok).toBe(false);

    const cloze = stValidateQuestion({ format: 'cloze', stem: 'The ____ method fits one expected loss ratio for every year.', answer: 'Cape Cod', aliases: ['Cape-Cod', ''], quote: 'q', page: 4 }, {});
    expect(cloze.ok).toBe(true);
    expect(cloze.question.answer).toBe('Cape Cod');
    expect(cloze.question.options).toEqual(['Cape-Cod']);
    expect(stValidateQuestion({ format: 'cloze', stem: 'No blank here.', answer: 'x', quote: 'q' }, {})).toMatchObject({ ok: false, reason: 'stem has no blank' });
  });
  it('lists one distractor check per wrong option, none for other formats', () => {
    const q = stValidateQuestion({ ...mc, answer: 1 }, { choices: 4 }).question;
    expect(stDistractorPrompts(q)).toEqual([
      { optionIndex: 0, stem: mc.stem, option: 'Weibull' },
      { optionIndex: 2, stem: mc.stem, option: 'Pareto' },
      { optionIndex: 3, stem: mc.stem, option: 'Normal' },
    ]);
    expect(stDistractorPrompts({ format: 'short', stem: 'x' })).toEqual([]);
    expect(stDistractorPrompts(null)).toEqual([]);
  });
});

describe('stInterleaveMaterials and stMasteryFromCardRating', () => {
  it('reorders so no two consecutive share a material when avoidable, stable otherwise', () => {
    const items = [{ id: 1, materialId: 1 }, { id: 2, materialId: 1 }, { id: 3, materialId: 2 }, { id: 4, materialId: 1 }, { id: 5, materialId: 2 }];
    expect(stInterleaveMaterials(items).map((i: { id: number }) => i.id)).toEqual([1, 3, 2, 5, 4]);
    expect(stInterleaveMaterials([{ id: 1, materialId: 1 }, { id: 2, materialId: 1 }]).map((i: { id: number }) => i.id)).toEqual([1, 2]);
    expect(stInterleaveMaterials([])).toEqual([]);
  });
  it('lowers mastery for Again and Hard only', () => {
    expect(stMasteryFromCardRating(0.8, AGAIN)).toBeCloseTo(0.4, 6);
    expect(stMasteryFromCardRating(0.8, HARD)).toBeCloseTo(0.68, 6);
    expect(stMasteryFromCardRating(0.8, GOOD)).toBe(0.8);
    expect(stMasteryFromCardRating(0.8, EASY)).toBe(0.8);
  });
});

describe('header helpers', () => {
  it('truncates with an ellipsis, escapes html, maps paths and uris', () => {
    expect(stTruncate('The chain ladder method', 10)).toBe('The chain…');
    expect(stTruncate('short', 10)).toBe('short');
    expect(stEsc('<a href="x">&\'')).toBe('&lt;a href=&quot;x&quot;&gt;&amp;&#39;');
    expect(stFsPathOf('file:///home/u/Study%20Notes/clark.pdf')).toBe('/home/u/Study Notes/clark.pdf');
    expect(stFsPathOf('file:///C:/Users/u/clark.pdf')).toBe('C:/Users/u/clark.pdf');
    expect(stFsPathOf('/plain/path.pdf')).toBe('/plain/path.pdf');
    expect(stUriOf('/home/u/Study Notes/clark.pdf')).toBe('file:///home/u/Study%20Notes/clark.pdf');
    expect(stUriOf('C:\\Users\\u\\clark.pdf')).toBe('file:///C:/Users/u/clark.pdf');
    expect(stUriOf('file:///already/a/uri.pdf')).toBe('file:///already/a/uri.pdf');
    expect(stFsPathOf(stUriOf('/home/u/Study Notes/clark.pdf'))).toBe('/home/u/Study Notes/clark.pdf');
  });
  it('the bus delivers, disposes as a function and as a disposable', () => {
    const seen: unknown[] = [];
    const d1 = onDataChanged((x: unknown) => seen.push(['a', x]));
    const d2 = bus.on('data', (x: unknown) => seen.push(['b', x]));
    bus.emit('data', 1);
    d1();
    d2.dispose();
    bus.emit('data', 2);
    expect(seen).toEqual([['a', 1], ['b', 1]]);
    bus.emit('never-registered', 1);
  });
});
