// Flashcards — spaced-repetition study system for Parallx (M93).
//
// Create cards by hand, or let the AI generate them from a canvas page, a
// PDF, a photo (Docling OCR), or pasted text. Study with an SM-2 scheduler
// (Anki-flavoured: learning steps, ease, lapses/relearning), discuss any
// card with the AI mid-review, and track progress (state counts, daily
// review volume, retention).
//
// Integration points (everything the host offers, used once each):
//   - api.database          per-extension SQLite (fc_* tables)
//   - api.lm                card generation + card discussion (local models)
//   - api.commands          canvas.getPageMarkdown for canvas sources
//   - parallxElectron.document.extractText   PDF text
//   - parallxElectron.docling.convert        photo OCR (markdown out)
//   - api.chat.registerTool chat tools (create cards, list due, stats)
//   - api.cron              optional daily reminder (autonomy-gated)
//   - api.dashboard         "Cards due" widget
//   - api.links             parallx://flashcards/... deep links
//
// Layout note: pure logic (scheduler, queue builder, JSON extraction, stats
// aggregation) is exported through __testables and unit-tested from
// tests/unit/flashcards.test.ts — keep those functions side-effect free.

// ═══════════════════════════════════════════════════════════════════════════════
// SECTION 1: DATABASE WRAPPER
// ═══════════════════════════════════════════════════════════════════════════════

let _dbBridge = null;

const db = {
  async run(sql, params = []) {
    const res = await _dbBridge.run(sql, params);
    if (res.error) throw new Error(`[FC-DB] ${res.error.message}`);
    return res;
  },
  async get(sql, params = []) {
    const res = await _dbBridge.get(sql, params);
    if (res.error) throw new Error(`[FC-DB] ${res.error.message}`);
    return res.row ?? null;
  },
  async all(sql, params = []) {
    const res = await _dbBridge.all(sql, params);
    if (res.error) throw new Error(`[FC-DB] ${res.error.message}`);
    return res.rows ?? [];
  },
};

// ═══════════════════════════════════════════════════════════════════════════════
// SECTION 2: PURE LOGIC — SM-2 scheduler, queue, parsing, stats
// ═══════════════════════════════════════════════════════════════════════════════

const MIN = 60 * 1000;
const DAY = 24 * 60 * 60 * 1000;

/** Learning steps (minutes) for new cards; relearning steps after a lapse. */
const FC_LEARNING_STEPS_MIN = [1, 10];
const FC_RELEARNING_STEPS_MIN = [10];
/** Learning cards due within this window stay in the live session (served
 *  when due, with a countdown wait screen) instead of silently ending it. */
const FC_LEARN_AHEAD_MS = 10 * MIN;
const FC_GRADUATE_DAYS = 1;
const FC_EASY_GRADUATE_DAYS = 4;
const FC_MIN_EASE = 1.3;
const FC_MAX_INTERVAL_DAYS = 36500;

/** Ratings. */
const AGAIN = 1, HARD = 2, GOOD = 3, EASY = 4;

/**
 * SM-2 (Anki-flavoured) transition. Pure: (cardState, rating, now) → next
 * scheduling state. Card shape uses the DB column names in camelCase:
 * { state, ease, intervalDays, dueAt, reps, lapses, learningStep }.
 */
function fcSchedule(card, rating, now) {
  const c = {
    state: card.state || 'new',
    ease: typeof card.ease === 'number' ? card.ease : 2.5,
    intervalDays: typeof card.intervalDays === 'number' ? card.intervalDays : 0,
    dueAt: card.dueAt || 0,
    reps: card.reps || 0,
    lapses: card.lapses || 0,
    learningStep: card.learningStep || 0,
  };
  const r = Math.min(EASY, Math.max(AGAIN, Math.round(rating)));
  const next = { ...c, reps: c.reps + 1 };

  const clampIvl = (d) => Math.min(FC_MAX_INTERVAL_DAYS, Math.max(1, d));

  const inLearning = c.state === 'new' || c.state === 'learning';
  if (inLearning) {
    const steps = FC_LEARNING_STEPS_MIN;
    if (r === AGAIN) {
      next.state = 'learning';
      next.learningStep = 0;
      next.dueAt = now + steps[0] * MIN;
    } else if (r === HARD) {
      next.state = 'learning';
      next.learningStep = Math.min(c.learningStep, steps.length - 1);
      next.dueAt = now + steps[next.learningStep] * 1.5 * MIN;
    } else if (r === GOOD) {
      const step = (c.state === 'new' ? 0 : c.learningStep) + 1;
      if (step >= steps.length) {
        next.state = 'review';
        next.learningStep = 0;
        next.intervalDays = FC_GRADUATE_DAYS;
        next.dueAt = now + FC_GRADUATE_DAYS * DAY;
      } else {
        next.state = 'learning';
        next.learningStep = step;
        next.dueAt = now + steps[step] * MIN;
      }
    } else { // EASY — graduate immediately
      next.state = 'review';
      next.learningStep = 0;
      next.intervalDays = FC_EASY_GRADUATE_DAYS;
      next.dueAt = now + FC_EASY_GRADUATE_DAYS * DAY;
    }
    return next;
  }

  if (c.state === 'relearning') {
    const steps = FC_RELEARNING_STEPS_MIN;
    if (r === AGAIN) {
      next.learningStep = 0;
      next.dueAt = now + steps[0] * MIN;
    } else if (r === HARD) {
      next.learningStep = Math.min(c.learningStep, steps.length - 1);
      next.dueAt = now + steps[next.learningStep] * 1.5 * MIN;
    } else {
      // Good / Easy exit relearning with the (already-halved) interval;
      // Easy gets a 1.5x bonus for having recovered effortlessly.
      const exitIvl = clampIvl(c.intervalDays * (r === EASY ? 1.5 : 1));
      next.state = 'review';
      next.learningStep = 0;
      next.intervalDays = exitIvl;
      next.dueAt = now + exitIvl * DAY;
    }
    return next;
  }

  // state === 'review'
  if (r === AGAIN) {
    next.state = 'relearning';
    next.learningStep = 0;
    next.lapses = c.lapses + 1;
    next.ease = Math.max(FC_MIN_EASE, c.ease - 0.2);
    next.intervalDays = clampIvl(c.intervalDays * 0.5);
    next.dueAt = now + FC_RELEARNING_STEPS_MIN[0] * MIN;
  } else if (r === HARD) {
    next.ease = Math.max(FC_MIN_EASE, c.ease - 0.15);
    next.intervalDays = clampIvl(c.intervalDays * 1.2);
    next.dueAt = now + next.intervalDays * DAY;
  } else if (r === GOOD) {
    next.intervalDays = clampIvl(c.intervalDays * c.ease);
    next.dueAt = now + next.intervalDays * DAY;
  } else { // EASY
    next.ease = c.ease + 0.15;
    next.intervalDays = clampIvl(c.intervalDays * c.ease * 1.3);
    next.dueAt = now + next.intervalDays * DAY;
  }
  return next;
}

// ── FSRS-6 (M98) ────────────────────────────────────────────────────────────
// Hand-implemented from the py-fsrs reference (no npm dep — see M98 doc).
// State per card: stability S (days until recall probability drops to 90%)
// and difficulty D ∈ [1,10], persisted in fc_cards.stability / .difficulty
// alongside the retained SM-2 columns. fcSchedule (SM-2, above) is retired:
// tests pin it as the historical reference, but it must not gain new callers
// — all scheduling goes through fcScheduleFsrs.

/** FSRS-6 default parameters (py-fsrs DEFAULT_PARAMETERS). */
const FSRS_W = [
  0.212, 1.2931, 2.3065, 8.2956, 6.4133, 0.8334, 3.0194, 0.001,
  1.8722, 0.1666, 0.796, 1.4835, 0.0614, 0.2629, 1.6483, 0.6014,
  1.8729, 0.5425, 0.0912, 0.0658, 0.1542,
];
const FSRS_DECAY = -FSRS_W[20];
const FSRS_FACTOR = Math.pow(0.9, 1 / FSRS_DECAY) - 1;
const FSRS_S_MIN = 0.001;
const FSRS_INIT_S_MAX = 100.0;
const FC_DEFAULT_RETENTION = 0.9;

/** Probability of recall after `elapsedDays` at stability S. R(S, S) = 0.9. */
function fcRetrievability(elapsedDays, stability) {
  const s = Math.max(FSRS_S_MIN, stability);
  const t = Math.max(0, elapsedDays);
  return Math.pow(1 + FSRS_FACTOR * (t / s), FSRS_DECAY);
}

/** Interval (days, ≥1) at which recall probability decays to `retention`. */
function fcFsrsInterval(retention, stability) {
  const r = Math.min(0.995, Math.max(0.7, retention || FC_DEFAULT_RETENTION));
  const raw = (stability / FSRS_FACTOR) * (Math.pow(r, 1 / FSRS_DECAY) - 1);
  return Math.min(FC_MAX_INTERVAL_DAYS, Math.max(1, Math.round(raw)));
}

/** Initial difficulty from the first grade. D0(1) = w4. Clamped [1, 10]. */
function fcFsrsInitDifficulty(grade) {
  const d = FSRS_W[4] - Math.exp(FSRS_W[5] * (grade - 1)) + 1;
  return Math.min(10, Math.max(1, d));
}

/** Difficulty update with linear damping + mean reversion toward D0(Easy). */
function fcFsrsNextDifficulty(d, grade) {
  const deltaD = -FSRS_W[6] * (grade - 3);
  const damped = d + (deltaD * (10 - d)) / 9;
  const reverted = FSRS_W[7] * fcFsrsInitDifficulty(EASY) + (1 - FSRS_W[7]) * damped;
  return Math.min(10, Math.max(1, reverted));
}

/** Stability growth on a successful review (grade ≥ 2, elapsed ≥ 1 day). */
function fcFsrsStabilityOnSuccess(s, d, retrievability, grade) {
  const hardPenalty = grade === HARD ? FSRS_W[15] : 1;
  const easyBonus = grade === EASY ? FSRS_W[16] : 1;
  const growth =
    Math.exp(FSRS_W[8]) *
    (11 - d) *
    Math.pow(s, -FSRS_W[9]) *
    (Math.exp(FSRS_W[10] * (1 - retrievability)) - 1) *
    hardPenalty *
    easyBonus;
  return Math.max(FSRS_S_MIN, s * (1 + growth));
}

/** Post-lapse stability (grade = 1). Never exceeds the pre-lapse stability. */
function fcFsrsStabilityOnLapse(s, d, retrievability) {
  const sf =
    FSRS_W[11] *
    Math.pow(d, -FSRS_W[12]) *
    (Math.pow(s + 1, FSRS_W[13]) - 1) *
    Math.exp(FSRS_W[14] * (1 - retrievability));
  const shortTermFloor = s / Math.exp(FSRS_W[17] * FSRS_W[18]);
  return Math.max(FSRS_S_MIN, Math.min(sf, shortTermFloor, s));
}

/** Same-day (elapsed < 1 day) stability update. Good/Easy never shrink S. */
function fcFsrsStabilityShortTerm(s, grade) {
  let mult = Math.exp(FSRS_W[17] * (grade - 3 + FSRS_W[18])) * Math.pow(s, -FSRS_W[19]);
  if (grade >= GOOD) mult = Math.max(1, mult);
  return Math.max(FSRS_S_MIN, s * mult);
}

/**
 * Deadline cap (M98): with a deck exam date, never schedule past the point
 * where at least one more review still fits before the exam. Generic — any
 * deadline works. No cap once the date has passed.
 */
function fcDeadlineCapDays(examDate, now) {
  if (!examDate || examDate <= now) return Infinity;
  const daysLeft = (examDate - now) / DAY;
  return Math.max(1, Math.ceil(daysLeft / 2));
}

/**
 * FSRS-6 transition. Pure: (card, rating, now, opts) → next scheduling state.
 * Keeps the SM-2 state machine (new/learning/review/relearning + intra-day
 * steps) for UX continuity; S/D and all day-scale intervals come from FSRS.
 * opts: { desiredRetention?: number, examDate?: number (ms epoch) }.
 */
function fcScheduleFsrs(card, rating, now, opts = {}) {
  const c = {
    state: card.state || 'new',
    stability: typeof card.stability === 'number' ? card.stability : 0,
    difficulty: typeof card.difficulty === 'number' ? card.difficulty : 0,
    lastReviewedAt: card.lastReviewedAt || 0,
    intervalDays: typeof card.intervalDays === 'number' ? card.intervalDays : 0,
    dueAt: card.dueAt || 0,
    reps: card.reps || 0,
    lapses: card.lapses || 0,
    learningStep: card.learningStep || 0,
    ease: typeof card.ease === 'number' ? card.ease : 2.5, // legacy, carried not used
  };
  const g = Math.min(EASY, Math.max(AGAIN, Math.round(rating)));
  const retention = opts.desiredRetention || FC_DEFAULT_RETENTION;
  const next = { ...c, reps: c.reps + 1, lastReviewedAt: now };

  // ── S/D update ──
  const isFirstEver = c.stability <= 0;
  if (isFirstEver) {
    next.stability = Math.min(FSRS_INIT_S_MAX, Math.max(FSRS_S_MIN, FSRS_W[g - 1]));
    next.difficulty = fcFsrsInitDifficulty(g);
  } else {
    const elapsedDays = c.lastReviewedAt > 0 ? (now - c.lastReviewedAt) / DAY : c.intervalDays;
    next.difficulty = fcFsrsNextDifficulty(c.difficulty, g);
    if (elapsedDays < 1) {
      next.stability = fcFsrsStabilityShortTerm(c.stability, g);
    } else {
      const r = fcRetrievability(elapsedDays, c.stability);
      next.stability = g === AGAIN
        ? fcFsrsStabilityOnLapse(c.stability, c.difficulty, r)
        : fcFsrsStabilityOnSuccess(c.stability, c.difficulty, r, g);
    }
  }

  const capDays = fcDeadlineCapDays(opts.examDate, now);
  const ivlFor = () => Math.min(fcFsrsInterval(retention, next.stability), capDays === Infinity ? FC_MAX_INTERVAL_DAYS : capDays);

  // ── State machine (intra-day steps unchanged from SM-2 UX) ──
  const inLearning = c.state === 'new' || c.state === 'learning';
  if (inLearning) {
    const steps = FC_LEARNING_STEPS_MIN;
    if (g === AGAIN) {
      next.state = 'learning';
      next.learningStep = 0;
      next.dueAt = now + steps[0] * MIN;
    } else if (g === HARD) {
      next.state = 'learning';
      next.learningStep = Math.min(c.learningStep, steps.length - 1);
      next.dueAt = now + steps[next.learningStep] * 1.5 * MIN;
    } else if (g === GOOD) {
      const step = (c.state === 'new' ? 0 : c.learningStep) + 1;
      if (step >= steps.length) {
        next.state = 'review';
        next.learningStep = 0;
        next.intervalDays = ivlFor();
        next.dueAt = now + next.intervalDays * DAY;
      } else {
        next.state = 'learning';
        next.learningStep = step;
        next.dueAt = now + steps[step] * MIN;
      }
    } else { // EASY — graduate immediately
      next.state = 'review';
      next.learningStep = 0;
      next.intervalDays = ivlFor();
      next.dueAt = now + next.intervalDays * DAY;
    }
    return next;
  }

  if (c.state === 'relearning') {
    const steps = FC_RELEARNING_STEPS_MIN;
    if (g === AGAIN) {
      next.learningStep = 0;
      next.dueAt = now + steps[0] * MIN;
    } else if (g === HARD) {
      next.learningStep = Math.min(c.learningStep, steps.length - 1);
      next.dueAt = now + steps[next.learningStep] * 1.5 * MIN;
    } else {
      next.state = 'review';
      next.learningStep = 0;
      next.intervalDays = ivlFor();
      next.dueAt = now + next.intervalDays * DAY;
    }
    return next;
  }

  // state === 'review'
  if (g === AGAIN) {
    next.state = 'relearning';
    next.learningStep = 0;
    next.lapses = c.lapses + 1;
    next.intervalDays = Math.max(1, Math.round(fcFsrsInterval(retention, next.stability)));
    next.dueAt = now + FC_RELEARNING_STEPS_MIN[0] * MIN;
  } else {
    next.intervalDays = ivlFor();
    next.dueAt = now + next.intervalDays * DAY;
  }
  return next;
}

/**
 * Replay a card's full review history through FSRS-6 to derive S/D for cards
 * scheduled under SM-2 (one-shot migration; see fcHealFsrsState). Pure.
 * Returns { stability, difficulty, lastReviewedAt } — the card's visible
 * schedule (state/interval/due) is deliberately left untouched so migration
 * never reshuffles what the user sees; FSRS takes over from the next review.
 */
function fcReplayFsrs(reviews) {
  let card = { state: 'new', stability: 0, difficulty: 0, lastReviewedAt: 0, intervalDays: 0, dueAt: 0, reps: 0, lapses: 0, learningStep: 0 };
  for (const rev of reviews) {
    card = fcScheduleFsrs(card, rev.rating, rev.reviewedAt);
  }
  return { stability: card.stability, difficulty: card.difficulty, lastReviewedAt: card.lastReviewedAt };
}

/** Human preview of what a rating would do ("<10m", "1d", "12d"). */
function fcIntervalPreview(card, rating, now, opts = {}) {
  const s = fcScheduleFsrs(card, rating, now, opts);
  const deltaMs = s.dueAt - now;
  if (deltaMs < 60 * MIN) return `${Math.max(1, Math.round(deltaMs / MIN))}m`;
  if (deltaMs < DAY) return `${Math.round(deltaMs / (60 * MIN))}h`;
  const days = deltaMs / DAY;
  if (days < 30) return `${Math.round(days)}d`;
  return `${(days / 30.44).toFixed(1)}mo`;
}

/**
 * User-set card flags. 0 = unflagged; 1..4 map to the four hue tokens the
 * theme already ships, so flags follow the app theme in light and dark and
 * add no palette of their own. Meanings are the user's to assign — the tool
 * deliberately ships none.
 *
 * Named "flag", never "rating": fc_reviews.rating is the 1-4 grade pressed
 * on every card, and one word for both would make this code ambiguous.
 */
const FC_FLAGS = [
  { value: 1, name: 'Red', cls: 'red' },
  { value: 2, name: 'Amber', cls: 'amber' },
  { value: 3, name: 'Green', cls: 'green' },
  { value: 4, name: 'Blue', cls: 'blue' },
];

/** Normalize anything into a valid flag value (0 when it is not one).
 *  Rejects rather than floors: a fractional flag means something upstream is
 *  wrong, and silently reading 1.5 as Red would hide it. Numeric strings do
 *  pass — SQLite and dataset attributes hand those back routinely. */
function fcNormalizeFlag(value) {
  const n = Number(value);
  return Number.isInteger(n) && FC_FLAGS.some((f) => f.value === n) ? n : 0;
}

/** Flag definition for a value, or undefined when unflagged/unknown. */
function fcFlagDef(value) {
  return FC_FLAGS.find((f) => f.value === fcNormalizeFlag(value));
}

/** Flagged cards sort ahead of unflagged ones; ties fall through to `then`.
 *  Ordering ONLY — flags never touch FSRS intervals or the deadline cap. */
function fcFlagFirst(then) {
  return (a, b) => {
    const fa = a.flag ? 0 : 1;
    const fb = b.flag ? 0 : 1;
    return fa !== fb ? fa - fb : then(a, b);
  };
}

/**
 * New-card introduction order: flags first (user override), then importance
 * (highest exam criticality first; unscored cards rank below every scored
 * card), then age. When time runs short before the exam, what got introduced
 * first was what mattered most.
 */
function fcNewOrder(a, b) {
  const ia = a.importance || 0;
  const ib = b.importance || 0;
  if (ia !== ib) return ib - ia;
  return (a.createdAt || 0) - (b.createdAt || 0);
}

/**
 * Build a study queue. Pure: cards in, ordered queue out.
 * Order: due learning/relearning (soonest first) → due reviews (most overdue
 * first, capped by reviewLimit) → new cards (flags, then importance, then
 * age — capped by newLimit). Suspended cards never appear.
 *
 * Flagged cards sort to the FRONT of the review and new bands, so they also
 * survive the caps — that is the point of flagging something. The learning
 * band is left strictly time-ordered: its steps are minute-scale, and
 * reordering them would break the "Again 1m means one minute" contract.
 *
 * `newAllowanceByDeck` (Map deckId → count) is the pacing seam for all-decks
 * sessions: each deck's new band is sliced to ITS allowance before the merged
 * band is ordered and capped by newLimit, so one deck's early import cannot
 * monopolize introduction while another deck's deadline slips.
 */
/**
 * Trim DUE cards that demand a typed answer down to `limit`. Pure.
 *
 * Applies to the review band only, and deliberately not to the other two:
 *
 *   learning — the same-session follow-ups an Again produced. Dropping one
 *              breaks the "Again 1m means one minute" contract for exactly
 *              the cards most likely to have earned it.
 *   new      — introduction is deadline-owned. fcPacePlan has already
 *              decided how many new cards this session must introduce to
 *              land the deck before the exam, and letting a second,
 *              unrelated cap silently overrule that is the same bug as
 *              letting `newLimit` trim a raised pace back down. A deferred
 *              REVIEW returns tomorrow at no cost to the plan; a deferred
 *              INTRODUCTION pushes the whole schedule against a fixed date.
 *
 * So the cap bounds how much typing a session's *review* load can demand,
 * and the pace bounds the rest.
 */
function fcCapProductionCards(review, limit) {
  if (!limit || limit <= 0) return review;
  let budget = limit;
  return review.filter((c) => {
    if (!fcIsProductionMode(c.recallMode)) return true;
    if (budget > 0) { budget--; return true; }
    return false;
  });
}

function fcBuildQueue(cards, now, { newLimit = 20, reviewLimit = 200, newAllowanceByDeck = null, productionLimit = 0 } = {}) {
  const active = cards.filter((c) => !c.suspended);
  const learning = active
    .filter((c) => (c.state === 'learning' || c.state === 'relearning') && c.dueAt <= now)
    .sort((a, b) => a.dueAt - b.dueAt);
  const review = active
    .filter((c) => c.state === 'review' && c.dueAt <= now)
    .sort(fcFlagFirst((a, b) => a.dueAt - b.dueAt))
    .slice(0, Math.max(0, reviewLimit));
  let freshPool = active.filter((c) => c.state === 'new');
  if (newAllowanceByDeck instanceof Map) {
    const byDeck = new Map();
    for (const c of freshPool) {
      if (!byDeck.has(c.deckId)) byDeck.set(c.deckId, []);
      byDeck.get(c.deckId).push(c);
    }
    freshPool = [];
    for (const [deckId, group] of byDeck) {
      const allowance = newAllowanceByDeck.has(deckId)
        ? Math.max(0, Number(newAllowanceByDeck.get(deckId)) || 0)
        : Number.POSITIVE_INFINITY;
      group.sort(fcFlagFirst(fcNewOrder));
      freshPool.push(...(allowance === Number.POSITIVE_INFINITY ? group : group.slice(0, allowance)));
    }
  }
  const fresh = freshPool
    .sort(fcFlagFirst(fcNewOrder))
    .slice(0, Math.max(0, newLimit));
  return [...learning, ...fcCapProductionCards(review, productionLimit), ...fresh];
}

/**
 * Deadline-aware pacing for one deck (M101). Pure.
 *
 * The user gives the TRUE exam date; this derives the internal dates. The
 * introduction cutoff sits `freezeDays` before the exam — after it, sessions
 * are pure consolidation (rate 0, frozen). Before it, the required rate is
 * simply "remaining new cards spread over the days left", clamped to the
 * session ceiling. Decks without a future exam date return null: the fixed
 * batch size applies as before.
 */
function fcPacePlan({ examDate, newCount }, now, { freezeDays = 14, ceiling = 20 } = {}) {
  if (!examDate || examDate <= now) return null;
  const freeze = Math.max(0, Number(freezeDays) || 0);
  const cutoff = examDate - freeze * DAY;
  if (now >= cutoff) {
    return { rate: 0, frozen: true, cutoff, daysLeft: 0 };
  }
  const daysLeft = Math.max(1, Math.ceil((cutoff - now) / DAY));
  const needed = Math.ceil(Math.max(0, Number(newCount) || 0) / daysLeft);
  // The deadline wins over the batch-size setting (M102 follow-up).
  //
  // This used to clamp to `ceiling`, which quietly made a large deck
  // unfinishable: 2,000 cards with 76 intro days needs 27/day, the default
  // ceiling is 20, so pacing handed over 20 and the deck card printed a
  // completion date a month past the exam. The readout was honest and
  // entirely passive — you had to notice the date was too late yourself.
  //
  // Pacing still REDUCES the batch when there is time to spare (that is the
  // whole point of it); it just no longer refuses to raise it when there is
  // not. `raised` records that it happened so the UI can say so rather than
  // silently exceeding a number the user set.
  const rate = needed;
  const raised = needed > Math.max(0, Number(ceiling) || 0);
  // At `rate`/day, when does the last waiting card get introduced?
  const doneInDays = rate > 0 ? Math.ceil(Math.max(0, Number(newCount) || 0) / rate) : 0;
  return { rate, raised, frozen: false, cutoff, daysLeft, doneAt: now + doneInDays * DAY };
}

/**
 * Per-deck new-card allowances for a session (M101). Pure.
 *
 * Decks with a future exam date get their paced rate; decks without one get
 * the fixed batch ceiling (pre-pacing behavior). `total` is the sum, used to
 * keep the sidebar's "Study N cards" promise truthful.
 */
function fcNewAllowances(decks, now, { paceEnabled = true, freezeDays = 14, ceiling = 20 } = {}) {
  const byDeck = new Map();
  let total = 0;
  for (const deck of decks) {
    let allowance = Math.max(0, Number(ceiling) || 0);
    if (paceEnabled) {
      const plan = fcPacePlan(deck, now, { freezeDays, ceiling });
      if (plan) allowance = plan.rate;
    }
    byDeck.set(deck.id, allowance);
    total += Math.min(allowance, Math.max(0, Number(deck.newCount) || 0));
  }
  return { byDeck, total };
}

/**
 * How many cards the NEXT daily session will actually serve. The raw counts
 * are uncapped totals, so a 100-card import made the sidebar promise "Study
 * 103 cards" and then hand over 23 — the caps live in fcBuildQueue, and
 * nothing reconciled the two. Custom Study is how you reach the rest.
 */
function fcCountServedToday(counts, limits = {}) {
  const newLimit = Math.max(0, Number(limits.newLimit) || 0);
  const reviewLimit = Math.max(0, Number(limits.reviewLimit) || 0);
  return Math.min(counts.newCount || 0, newLimit)
    + (counts.learnCount || 0)
    + Math.min(counts.reviewCount || 0, reviewLimit);
}

/** Custom-study modes, in the order the dialog lists them. */
const FC_CUSTOM_MODES = ['extra', 'ahead', 'hard', 'cram'];

/**
 * True for modes that must NOT write scheduling. Re-reading a card during a
 * cram pass is not evidence you would have recalled it days from now, so
 * letting those grades reach FSRS would corrupt its picture of your memory
 * (and, via the deadline cap, your whole exam plan). Preview sessions grade
 * for flow only — Again requeues inside the session and nothing persists.
 */
function fcCustomIsPreview(mode) {
  return mode === 'hard' || mode === 'cram';
}

/**
 * Build a custom-study queue — the deliberate "work ahead" path, kept
 * separate from fcBuildQueue so neither can distort the other.
 *
 *   extra — introduce N more NEW cards now. The daily queue's newLimit is a
 *           per-SESSION batch size, so a 100-card import needs an explicit
 *           way to burn down the rest instead of looking untouched.
 *   ahead — pull forward reviews falling due within `aheadDays` (includes
 *           what is already due, so this works as a standalone entry point).
 *   hard  — the cards you lapse most, regardless of schedule.
 *   cram  — any N cards in scope, most-overdue first, regardless of schedule.
 *
 * `tags` scopes every mode: ALL listed tags must be present, matching the
 * browse tag bar so one mental model covers both. `flags` also scopes every
 * mode, but as ANY-of — flags are alternatives you pick between, not
 * attributes that stack. Omitting `count` means unlimited, which is how the
 * dialog counts what is available.
 *
 * Unlike the daily queue, custom queues are NOT flag-biased: here you can
 * scope to flags outright, so an implicit reordering on top would only make
 * "Difficult Cards" lie about being ranked by lapses.
 *
 * Pure: cards in, ordered queue out. Suspended cards never appear.
 */
function fcBuildCustomQueue(cards, now, opts = {}) {
  const mode = FC_CUSTOM_MODES.includes(opts.mode) ? opts.mode : 'extra';
  const rawCount = Number(opts.count);
  const limit = Number.isFinite(rawCount) && rawCount >= 0 ? Math.floor(rawCount) : Number.MAX_SAFE_INTEGER;
  const aheadDays = Math.max(0, Math.floor(Number(opts.aheadDays) || 0));
  const wanted = (Array.isArray(opts.tags) ? opts.tags : [])
    .map((t) => String(t).trim().toLowerCase()).filter(Boolean);
  const wantedFlags = new Set((Array.isArray(opts.flags) ? opts.flags : [])
    .map(fcNormalizeFlag).filter(Boolean));

  const inScope = cards.filter((c) => {
    if (c.suspended) return false;
    if (wantedFlags.size > 0 && !wantedFlags.has(fcNormalizeFlag(c.flag))) return false;
    if (wanted.length === 0) return true;
    const have = new Set(fcParseTags(c.tags).map((t) => t.toLowerCase()));
    return wanted.every((t) => have.has(t));
  });

  let picked;
  if (mode === 'extra') {
    picked = inScope
      .filter((c) => c.state === 'new')
      .sort((a, b) => (a.createdAt || 0) - (b.createdAt || 0));
  } else if (mode === 'ahead') {
    const horizon = now + aheadDays * DAY;
    picked = inScope
      .filter((c) => c.state !== 'new' && c.dueAt <= horizon)
      .sort((a, b) => a.dueAt - b.dueAt);
  } else if (mode === 'hard') {
    picked = inScope
      .filter((c) => (c.lapses || 0) > 0)
      .sort((a, b) => (b.lapses || 0) - (a.lapses || 0)
        || (b.difficulty || 0) - (a.difficulty || 0)
        || a.dueAt - b.dueAt);
  } else {
    picked = inScope.slice().sort((a, b) => a.dueAt - b.dueAt);
  }
  return picked.slice(0, limit);
}

/**
 * Extract a JSON array of {front, back, tags?} from model output. Tolerates
 * fences, prose around the array, and singly-nested objects. Returns
 * { cards, error } — cards is [] on failure, never null.
 */
/**
 * Repair LaTeX backslashes inside a JSON string the model wrote.
 *
 * Strict JSON destroys single-backslash LaTeX both ways: `\sigma` is an
 * INVALID escape (JSON.parse throws, the whole batch is lost) while `\frac`,
 * `\theta`, `\beta` are VALID escapes (formfeed, tab, backspace) that parse
 * "successfully" into control-character garbage. So the exact instruction the
 * generation prompt gives ("write every formula in LaTeX") is what breaks the
 * parse. This walks string literals and doubles the backslashes JSON would
 * eat:
 *
 *   - any invalid escape (`\s`, `\l`, `\D`, `\u` without 4 hex digits) —
 *     strictly a repair, the parse would have thrown;
 *   - a valid-but-suspicious escape (`\b\f\n\r\t` followed by a letter)
 *     INSIDE `$…$` math, where `\neq` is a command and never "newline+eq".
 *     Outside math these are left alone: `\n` between sentences is a real
 *     newline the model meant.
 *
 * Correctly double-escaped output (`\\frac`) passes through untouched.
 */
function fcRepairLatexEscapes(slice) {
  let out = '';
  let inStr = false;
  let inMath = false;
  for (let i = 0; i < slice.length; i++) {
    const ch = slice[i];
    if (!inStr) {
      if (ch === '"') { inStr = true; inMath = false; }
      out += ch;
      continue;
    }
    if (ch === '"') { inStr = false; out += ch; continue; }
    if (ch === '$') {
      // `$$` (display math) is one delimiter, not two inline toggles.
      if (slice[i + 1] === '$') { out += '$$'; i++; } else { out += ch; }
      inMath = !inMath;
      continue;
    }
    if (ch !== '\\') { out += ch; continue; }

    const next = slice[i + 1] ?? '';
    if (next === '\\' || next === '"' || next === '/') {
      out += ch + next; i++;                       // already-correct escape
    } else if (next === 'u' && /^[0-9a-fA-F]{4}$/.test(slice.slice(i + 2, i + 6))) {
      out += ch + next; i++;                       // real unicode escape
    } else if ('bfnrt'.includes(next)) {
      const after = slice[i + 2] ?? '';
      if (inMath && /[a-zA-Z]/.test(after)) {
        out += '\\\\' + next; i++;                 // \frac, \neq, \tau, … in math
      } else {
        out += ch + next; i++;                     // an intended \n, \t, …
      }
    } else {
      out += '\\\\';                               // invalid escape: \sigma, \left, …
    }
  }
  return out;
}

/**
 * Find and parse a JSON array in raw model output. Shared by the card
 * extractor, the duplicate judge, and the coverage parser: think-block and
 * fence stripping, a string-aware bracket walk over EVERY candidate array
 * (the first '[' is often a citation), and the LaTeX escape repair applied
 * BEFORE the strict parse. `mapSlice(parsedArray)` turns one candidate into
 * domain objects — return null to reject the candidate, [] to accept an
 * empty result, or the mapped items.
 * Returns { items, error } — items is [] on failure, never null.
 */
function fcExtractJsonArray(text, mapSlice) {
  if (typeof text !== 'string' || !text.trim()) return { items: [], error: 'Empty response.' };
  let t = text.trim();
  // Thinking models can leak inline reasoning; brackets inside it would
  // hijack the array scan. Drop complete blocks AND an unterminated head.
  t = t.replace(/<think>[\s\S]*?<\/think>/gi, '');
  t = t.replace(/^[\s\S]*?<\/think>/i, '');
  // Strip markdown fences.
  t = t.replace(/```(?:json)?/gi, '');

  const parseSlice = (slice) => {
    let parsed;
    // Repair BEFORE the strict parse: parse-first would silently accept
    // `\frac` as formfeed+"rac" and the corruption would land in the deck.
    try { parsed = JSON.parse(fcRepairLatexEscapes(slice)); }
    catch {
      try { parsed = JSON.parse(slice); } catch { return null; }
    }
    if (!Array.isArray(parsed)) return null;
    return mapSlice(parsed);
  };

  let sawArray = false, unterminated = false;
  let start = t.indexOf('[');
  let attempts = 0;
  while (start !== -1 && attempts < 8) {
    attempts++;
    // Walk to the matching close bracket (string-aware). Also remember where
    // the last COMPLETE top-level object closed — that is the salvage point
    // when the model's window filled and the array never terminates.
    let depth = 0, curly = 0, end = -1, inStr = false, escape = false, lastObjEnd = -1;
    for (let i = start; i < t.length; i++) {
      const ch = t[i];
      if (escape) { escape = false; continue; }
      if (ch === '\\') { escape = true; continue; }
      if (ch === '"') { inStr = !inStr; continue; }
      if (inStr) continue;
      if (ch === '{') curly++;
      else if (ch === '}') {
        curly--;
        if (depth === 1 && curly === 0) lastObjEnd = i;
      } else if (ch === '[') depth++;
      else if (ch === ']') {
        depth--;
        if (depth === 0) { end = i; break; }
      }
    }
    if (end === -1) {
      // Truncated mid-array. A ten-minute generation must not evaporate over
      // its missing last bracket: salvage every complete object before the
      // cut and let the caller warn that the tail of the material is
      // uncovered. Only the trailing partial object is lost.
      if (lastObjEnd > start) {
        const items = parseSlice(t.slice(start, lastObjEnd + 1) + ']');
        if (items !== null && items.length > 0) {
          return { items, error: null, truncated: true };
        }
      }
      unterminated = true;
      break;
    }
    const items = parseSlice(t.slice(start, end + 1));
    if (items !== null) {
      sawArray = true;
      if (items.length > 0) return { items, error: null, truncated: false };
    }
    start = t.indexOf('[', start + 1);
  }

  if (unterminated) return { items: [], error: 'Unterminated JSON array. The response may have been cut off.', truncated: true };
  if (sawArray) return { items: [], error: 'No usable items in response.', truncated: false };
  return { items: [], error: 'No JSON array in response.', truncated: false };
}

/**
 * Same hygiene as fcExtractJsonArray — think-tag leakage, markdown fences,
 * LaTeX escape repair, string-aware brace walking — for a single top-level
 * JSON OBJECT. Returns null when nothing parses.
 *
 * A grading verdict is one object, not an array, and coercing it into an
 * array shape purely to reuse the existing extractor would push the
 * awkwardness into the prompt, which is where local models are least
 * reliable. Pure.
 */
function fcExtractJsonObject(text) {
  if (typeof text !== 'string' || !text.trim()) return null;
  let t = text.trim()
    .replace(/<think>[\s\S]*?<\/think>/gi, '')
    .replace(/^[\s\S]*?<\/think>/i, '')
    .replace(/```(?:json)?/gi, '');

  let start = t.indexOf('{');
  let attempts = 0;
  while (start !== -1 && attempts < 8) {
    attempts++;
    let depth = 0, end = -1, inStr = false, escape = false;
    for (let i = start; i < t.length; i++) {
      const ch = t[i];
      if (escape) { escape = false; continue; }
      if (ch === '\\') { escape = true; continue; }
      if (ch === '"') { inStr = !inStr; continue; }
      if (inStr) continue;
      if (ch === '{') depth++;
      else if (ch === '}') { depth--; if (depth === 0) { end = i; break; } }
    }
    if (end === -1) return null;
    const slice = t.slice(start, end + 1);
    let parsed = null;
    try { parsed = JSON.parse(fcRepairLatexEscapes(slice)); }
    catch { try { parsed = JSON.parse(slice); } catch { parsed = null; } }
    if (parsed && typeof parsed === 'object' && !Array.isArray(parsed)) return parsed;
    start = t.indexOf('{', start + 1);
  }
  return null;
}

function fcExtractCardsJson(text) {
  const { items, error, truncated } = fcExtractJsonArray(text, (parsed) => {
    const cards = [];
    for (const item of parsed.slice(0, 100)) {
      if (!item || typeof item !== 'object') continue;
      const front = String(item.front ?? item.question ?? item.q ?? '').trim();
      const back = String(item.back ?? item.answer ?? item.a ?? '').trim();
      if (!front || !back) continue;
      const tags = Array.isArray(item.tags)
        ? item.tags.map((x) => String(x).trim()).filter(Boolean).slice(0, 8).join(',')
        : '';
      const card = { front, back, tags };
      // M101 exam criticality: 1..100, anything unusable stays 0 (unscored).
      const imp = Math.round(Number(item.importance ?? NaN));
      if (Number.isFinite(imp) && imp > 0) {
        card.importance = Math.min(100, imp);
        card.importanceReason = String(item.importanceReason ?? item.importance_reason ?? '').trim().slice(0, 300);
      }
      // M102 production recall. A rubric without a production mode is
      // dropped rather than guessed at: a rubric on a recognition card is
      // never read, and inferring the mode FROM the rubric's presence would
      // promote cards the model deliberately left as recognition.
      const recallMode = fcNormalizeRecallMode(item.recallMode ?? item.recall_mode);
      if (fcIsProductionMode(recallMode)) {
        const rubric = fcNormalizeRubric(item.rubric ?? item.points);
        // A production card with no usable rubric has nothing to grade
        // against, and fcEnsureRubric would derive one on first review from
        // the same answer text the model just declined to distil. Storing it
        // as recognition is the honest outcome.
        if (rubric.length) { card.recallMode = recallMode; card.rubric = rubric; }
      }
      // M98 grounding: per-card page attribution when the prompt was paged.
      // fcGenerateCards validates the number against the real page range.
      const page = Number(item.page ?? item.source_page ?? NaN);
      if (Number.isInteger(page) && page > 0) card.page = page;
      // Multi-source generation: which [Doc k] the fact came from.
      // fcGenerateCards validates the index against the real doc list.
      const doc = Number(item.doc ?? item.source_doc ?? NaN);
      if (Number.isInteger(doc) && doc > 0) card.doc = doc;
      cards.push(card);
    }
    return cards;
  });
  const error2 = error === 'No usable items in response.' ? 'No usable cards in response.' : error;
  return { cards: items, error: error2, truncated: !!truncated };
}

/** 'HH:MM' → 5-field cron for a daily firing, or null when malformed. */
function fcReminderCron(timeStr) {
  const m = /^(\d{1,2}):(\d{2})$/.exec(String(timeStr || '').trim());
  if (!m) return null;
  const h = parseInt(m[1], 10), mi = parseInt(m[2], 10);
  if (h > 23 || mi > 59) return null;
  return `${mi} ${h} * * *`;
}

/** Split a comma-separated tag string into clean tags. */
function fcParseTags(raw) {
  return String(raw || '')
    .split(',')
    .map((t) => t.trim())
    .filter(Boolean);
}

/**
 * Aggregate progress stats. Pure: review rows + cards in, dashboard shape
 * out. `reviews` need { reviewedAt, rating, stateBefore }; `cards` need
 * { state, suspended }.
 */
function fcAggregateStats(reviews, cards, now) {
  const startOfDay = (ts) => {
    const d = new Date(ts);
    d.setHours(0, 0, 0, 0);
    return d.getTime();
  };
  const todayStart = startOfDay(now);
  const days30Start = todayStart - 29 * DAY;

  const counts = { new: 0, learning: 0, review: 0, relearning: 0, suspended: 0, total: 0 };
  for (const c of cards) {
    counts.total++;
    if (c.suspended) { counts.suspended++; continue; }
    if (counts[c.state] !== undefined) counts[c.state]++;
  }

  let todayCount = 0, todayCorrect = 0, todayMs = 0;
  let retNum = 0, retDen = 0;
  const answers = { again: 0, hard: 0, good: 0, easy: 0 };
  const byDay = new Map();
  for (const r of reviews) {
    if (r.reviewedAt >= todayStart) {
      todayCount++;
      if (r.rating > AGAIN) todayCorrect++;
      // Cap one answer at 60s: a walked-away card must not report an hour
      // of "studying" (Anki caps the same way).
      todayMs += Math.min(r.msTaken || 0, 60_000);
    }
    if (r.reviewedAt >= days30Start) {
      const day = startOfDay(r.reviewedAt);
      byDay.set(day, (byDay.get(day) || 0) + 1);
      if (r.rating === AGAIN) answers.again++;
      else if (r.rating === HARD) answers.hard++;
      else if (r.rating === GOOD) answers.good++;
      else if (r.rating === EASY) answers.easy++;
      // Retention: of REVIEW-state cards seen, how many were recalled
      // (rating > Again)? Learning steps are excluded — failing a card you
      // learned 60 seconds ago is not a retention event.
      if (r.stateBefore === 'review') {
        retDen++;
        if (r.rating > AGAIN) retNum++;
      }
    }
  }

  const last30 = [];
  for (let day = days30Start; day <= todayStart; day += DAY) {
    last30.push({ day, count: byDay.get(day) || 0 });
  }

  // Scheduled load, next 14 days: overdue rolls into today (that is when it
  // will actually be seen). Same honesty rule as the planner forecast: FSRS
  // reshuffles after every review and NEW cards are not scheduled, so this
  // is a floor, never a promise.
  const forecast14 = [];
  {
    const byDue = new Map();
    for (const c of cards) {
      if (c.suspended || c.state === 'new' || !(c.dueAt > 0)) continue;
      const day = Math.max(startOfDay(c.dueAt), todayStart);
      if (day >= todayStart + 14 * DAY) continue;
      byDue.set(day, (byDue.get(day) || 0) + 1);
    }
    for (let day = todayStart; day < todayStart + 14 * DAY; day += DAY) {
      forecast14.push({ day, count: byDue.get(day) || 0 });
    }
  }

  return {
    counts,
    today: {
      reviews: todayCount,
      correctPct: todayCount > 0 ? Math.round((todayCorrect / todayCount) * 100) : null,
      minutes: Math.round(todayMs / 60_000),
    },
    last30,
    retention30: retDen > 0 ? Math.round((retNum / retDen) * 100) : null,
    answers30: answers,
    forecast14,
  };
}

// ═══════════════════════════════════════════════════════════════════════════════
// SECTION 3: MODULE STATE + tiny event bus
// ═══════════════════════════════════════════════════════════════════════════════

let _api = null;
let _activated = false;
let _pendingRoute = null; // consumed by the editor pane on first render
const _routeListeners = new Set();
const _dataListeners = new Set();

function _setRoute(route) {
  _pendingRoute = route;
  for (const fn of _routeListeners) { try { fn(route); } catch { /* noop */ } }
}
function _takePendingRoute() {
  const r = _pendingRoute;
  _pendingRoute = null;
  return r;
}
function _emitDataChanged() {
  for (const fn of _dataListeners) { try { fn(); } catch { /* noop */ } }
}

/** The pacing knobs (M101), normalized. */
function fcPaceSettings() {
  const freeze = Number(cfg('freezeDays', 14));
  return {
    paceEnabled: cfg('paceNewCards', true) !== false,
    freezeDays: Number.isFinite(freeze) ? Math.max(0, freeze) : 14,
    ceiling: Number(cfg('dailyNewLimit', 20)) || 20,
  };
}

/**
 * Per-deck new-card allowances for a session scope (one deck or all).
 * Wraps the pure fcNewAllowances with live deck rows + settings.
 */
async function fcSessionNewAllowances(deckId = null) {
  const decks = await fcListDecks();
  // Route deck ids can arrive as strings (persisted routes, links); a typed
  // mismatch here would silently drop the allowance and disable pacing.
  const scoped = deckId != null ? decks.filter((d) => String(d.id) === String(deckId)) : decks;
  return fcNewAllowances(scoped, Date.now(), fcPaceSettings());
}

function cfg(key, dflt) {
  try {
    const c = _api.workspace.getConfiguration('flashcards');
    const v = c.get(key.replace(/^flashcards\./, ''), dflt);
    return v === undefined ? dflt : v;
  } catch {
    return dflt;
  }
}

function icon(name, size = 14) {
  try {
    if (_api?.icons?.createIconHtml) return _api.icons.createIconHtml(name, size);
  } catch { /* noop */ }
  return '';
}

function el(tag, className, text) {
  const node = document.createElement(tag);
  if (className) node.className = className;
  if (text !== undefined) node.textContent = text;
  return node;
}

const FC_ICON_HTML = '<svg xmlns="http://www.w3.org/2000/svg" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M12 2 2 7l10 5 10-5-10-5z"/><path d="m2 17 10 5 10-5"/><path d="m2 12 10 5 10-5"/></svg>';

/**
 * Open a card's source material (M98 grounding). Canvas pages route through
 * canvas.openPage; files open in their editor, and PDFs additionally jump to
 * the cited page via the parallx.pdf.goToPage event (the pane listens; the
 * delay lets a freshly-opened pane finish mounting first).
 */
async function fcOpenSource(card) {
  try {
    const uri = String(card.sourceUri || '');
    if (!uri) return;
    const canvasMatch = /^parallx:\/\/canvas\/page\/(.+)$/.exec(uri);
    if (canvasMatch) {
      await _api.commands.executeCommand('canvas.openPage', canvasMatch[1]);
      return;
    }
    await _api.editors.openFileEditor(uri, { pinned: false });
    if (card.sourcePage > 0 && /\.pdf$/i.test(uri)) {
      // The PDF pane's M66 link contract: parallx:pdf-reveal navigates any
      // open pane showing this file. The delay lets a fresh pane mount.
      setTimeout(() => {
        window.dispatchEvent(new CustomEvent('parallx:pdf-reveal', {
          detail: { filePath: uri, page: card.sourcePage },
        }));
      }, 500);
    }
  } catch (e) {
    _api.window.showErrorMessage?.(`Could not open the source: ${e.message}`);
  }
}

/** The one deck action menu — shared by the sidebar deck rows and the
 *  Browse header overflow so both surfaces stay in sync. */
function fcDeckMenuItems(deck) {
  return [
    { label: 'Study Deck', icon: 'play', onSelect: () => void openFlashcards({ view: 'study', deckId: deck.id }) },
    { label: 'Custom Study…', icon: 'play', onSelect: () => void openFlashcards({ view: 'custom', deckId: deck.id }) },
    { label: 'Browse Cards', icon: 'layers', onSelect: () => void openFlashcards({ view: 'browse', deckId: deck.id }) },
    { label: 'Add Cards with AI', icon: 'px-ai-mark', onSelect: () => void openFlashcards({ view: 'create', deckId: deck.id }) },
    { label: 'Find Duplicates', icon: 'px-ai-mark', onSelect: () => void openFlashcards({ view: 'dedup', deckId: deck.id }) },
    { label: 'Coverage Review', icon: 'px-ai-mark', onSelect: () => void openFlashcards({ view: 'coverage', deckId: deck.id }) },
    { label: 'Score Importance (AI)', icon: 'px-ai-mark', onSelect: () => void _scoreImportanceFlow(deck) },
    { label: 'Classify Recall Modes (AI)', icon: 'px-ai-mark', onSelect: () => void _classifyRecallFlow(deck) },
    { label: 'Merge Into Another Deck…', icon: 'layers', onSelect: () => void _mergeDeckFlow(deck) },
    { separator: true },
    { label: 'Rename', icon: 'pencil', onSelect: () => void _renameDeckFlow(deck) },
    { label: deck.examDate ? 'Change Exam Date' : 'Set Exam Date', icon: 'calendar', onSelect: () => void _setExamDateFlow(deck) },
    { label: 'Delete Deck', icon: 'trash', danger: true, onSelect: () => void _deleteDeckFlow(deck) },
  ];
}

async function openFlashcards(route) {
  // The route is stashed BEFORE anything else, on every path. An open TAB
  // does not imply a live PANE: the workbench builds a tool pane lazily on
  // first show, and drops it again on workspace restore or when the
  // retention LRU evicts it. In those states the route event below has no
  // listener, and every route-carrying entry point — Custom Study, Study
  // Deck, Browse Cards, the deck menu — surfaced the tab on whatever view it
  // last showed and swallowed the navigation ("Custom Study does nothing").
  // The pending route is what survives to the rebuild; a live pane consumes
  // it in onRouteEvent so it can never hijack a later mount.
  if (route) _setRoute(route);

  // Focus, don't reopen. openEditor on an already-active tab does a FULL
  // pane teardown/rebuild in the workbench (editorGroupView seq quirk) —
  // every "open flashcards" from a command/link/toast was destroying the
  // live pane and any place the user held in it. focusEditor surfaces the
  // existing tab across ALL groups without touching the pane; the route
  // event (when one was requested) navigates it in place.
  try {
    const existing = (_api.editors.openEditors ?? []).find((e) =>
      typeof e?.id === 'string' && e.id.endsWith(':flashcards:main'));
    if (existing) {
      await _api.editors.focusEditor(existing.id);
      if (route) {
        document.dispatchEvent(new CustomEvent('parallx.flashcards.route', { detail: route }));
      }
      return;
    }
  } catch { /* fall through to a fresh open */ }
  await _api.editors.openEditor({
    typeId: 'flashcards',
    title: 'Flashcards',
    iconHtml: FC_ICON_HTML,
    instanceId: 'main',
  });
}

// ═══════════════════════════════════════════════════════════════════════════════
// SECTION 4: DATA LAYER
// ═══════════════════════════════════════════════════════════════════════════════

function rowToCard(row) {
  return {
    id: row.id,
    deckId: row.deck_id,
    front: row.front,
    back: row.back,
    notes: row.notes,
    tags: row.tags,
    sourceUri: row.source_uri,
    sourceLabel: row.source_label,
    createdAt: row.created_at,
    suspended: !!row.suspended,
    flag: row.flag || 0,
    state: row.state,
    ease: row.ease,
    intervalDays: row.interval_days,
    dueAt: row.due_at,
    reps: row.reps,
    lapses: row.lapses,
    learningStep: row.learning_step,
    stability: row.stability ?? 0,
    difficulty: row.difficulty ?? 0,
    lastReviewedAt: row.last_reviewed_at ?? 0,
    sourcePage: row.source_page ?? 0,
    cardType: row.card_type || 'basic',
    noteGroup: row.note_group || '',
    clozeIndex: row.cloze_index ?? 0,
    importance: row.importance || 0,
    importanceReason: row.importance_reason || '',
    // M102. Parsed here rather than at each call site so nothing downstream
    // has to remember that `rubric` is JSON on the way out of SQLite.
    recallMode: fcNormalizeRecallMode(row.recall_mode),
    rubric: fcNormalizeRubric(row.rubric || ''),
    sourceExcerpt: row.source_excerpt || '',
  };
}

async function fcListDecks() {
  const rows = await db.all('SELECT * FROM fc_decks WHERE archived = 0 ORDER BY name COLLATE NOCASE');
  const counts = await db.all(`
    SELECT deck_id,
      SUM(CASE WHEN suspended = 0 AND state = 'new' THEN 1 ELSE 0 END) AS new_count,
      SUM(CASE WHEN suspended = 0 AND state != 'new' AND due_at <= ? THEN 1 ELSE 0 END) AS due_count,
      COUNT(*) AS total
    FROM fc_cards GROUP BY deck_id
  `, [Date.now()]);
  const byDeck = new Map(counts.map((c) => [c.deck_id, c]));
  return rows.map((r) => ({
    id: r.id,
    name: r.name,
    description: r.description,
    createdAt: r.created_at,
    examDate: r.exam_date || 0,
    desiredRetention: r.desired_retention || 0.9,
    newCount: byDeck.get(r.id)?.new_count || 0,
    dueCount: byDeck.get(r.id)?.due_count || 0,
    total: byDeck.get(r.id)?.total || 0,
  }));
}

// Today's workload across ALL decks, split Anki-style into new / learning /
// review (due). Used by the sidebar's Today section.
async function fcTodayCounts() {
  const now = Date.now();
  const row = await db.get(`
    SELECT
      SUM(CASE WHEN suspended = 0 AND state = 'new' THEN 1 ELSE 0 END) AS new_count,
      SUM(CASE WHEN suspended = 0 AND state IN ('learning','relearning') AND due_at <= ? THEN 1 ELSE 0 END) AS learn_count,
      SUM(CASE WHEN suspended = 0 AND state = 'review' AND due_at <= ? THEN 1 ELSE 0 END) AS review_count
    FROM fc_cards
  `, [now, now]);
  const newCount = row?.new_count || 0;
  const learnCount = row?.learn_count || 0;
  const reviewCount = row?.review_count || 0;
  return { newCount, learnCount, reviewCount, dueTotal: learnCount + reviewCount + newCount };
}

/** One deck by id, or null. Used by the pane breadcrumb, which needs a name
 *  and nothing else. */
async function fcGetDeck(id) {
  if (id == null) return null;
  const row = await db.get('SELECT id, name FROM fc_decks WHERE id = ?', [id]);
  return row ? { id: row.id, name: row.name } : null;
}

async function fcCreateDeck(name, description = '') {
  const res = await db.run(
    'INSERT INTO fc_decks (name, description, created_at) VALUES (?, ?, ?)',
    [name.trim(), description, Date.now()],
  );
  _emitDataChanged();
  return res.lastInsertRowid ?? res.lastID ?? null;
}

async function fcGetOrCreateDeckByName(name) {
  const row = await db.get('SELECT id FROM fc_decks WHERE archived = 0 AND name = ? COLLATE NOCASE', [name.trim()]);
  if (row) return row.id;
  return fcCreateDeck(name);
}

async function fcRenameDeck(id, name) {
  await db.run('UPDATE fc_decks SET name = ? WHERE id = ?', [name.trim(), id]);
  _emitDataChanged();
}

async function fcSetDeckExamDate(id, examDate) {
  await db.run('UPDATE fc_decks SET exam_date = ? WHERE id = ?', [examDate || 0, id]);
  _emitDataChanged();
}

async function fcDeleteDeck(id) {
  try {
    await db.run(
      'DELETE FROM fc_card_embeddings WHERE card_id IN (SELECT CAST(id AS TEXT) FROM fc_cards WHERE deck_id = ?)',
      [id],
    );
  } catch { /* vec table absent or subquery unsupported — orphans are harmless (JOIN filters them) */ }
  await db.run('DELETE FROM fc_cards WHERE deck_id = ?', [id]);
  await db.run('DELETE FROM fc_decks WHERE id = ?', [id]);
  _emitDataChanged();
}

/**
 * Normalize card text at the door. Models writing cards emit HTML line
 * breaks (`<br>`) out of habit; the shared renderer correctly ESCAPES raw
 * HTML, so a literal "<br>" would sit visible on the card face. Cards speak
 * Markdown: newlines are the line breaks.
 */
function fcNormalizeCardText(text) {
  return String(text ?? '')
    .replace(/<br\s*\/?\s*>/gi, '\n')
    .replace(/\n{3,}/g, '\n\n')
    .trim();
}

// ── Cloze + reverse notes (M98) ─────────────────────────────────────────────
// Anki-compatible cloze syntax: {{c1::answer}} or {{c1::answer::hint}}.
// One NOTE (the raw text) yields one scheduled CARD per distinct ordinal;
// siblings share a note_group so edits propagate and dedup exempts them.
// Same non-greedy matching limitation as Anki: an answer containing a
// literal `}}` (rare, deep LaTeX nesting) needs a space between the braces.

const FC_CLOZE_RE = /\{\{c(\d+)::([\s\S]*?)(?:::([\s\S]*?))?\}\}/g;

/** Distinct cloze ordinals in a note's text, ascending. */
function fcParseClozeIndices(text) {
  const found = new Set();
  for (const m of String(text || '').matchAll(FC_CLOZE_RE)) {
    const ord = Number(m[1]);
    if (Number.isInteger(ord) && ord > 0) found.add(ord);
  }
  return [...found].sort((a, b) => a - b);
}

/**
 * Render a cloze note for one sibling. mode 'front': the target ordinal is
 * blanked to **[...]** (or its hint); every other ordinal shows its answer.
 * mode 'back': everything revealed, the target bolded. Output is Markdown —
 * this runs BEFORE the shared Markdown+KaTeX renderer.
 */
function fcRenderCloze(text, targetIndex, mode) {
  const source = String(text || '');
  return source.replace(FC_CLOZE_RE, (_all, ordStr, answer, hint, offset) => {
    const ord = Number(ordStr);
    // Markdown ** inside $...$ math renders as literal asterisks (KaTeX owns
    // that span) — emphasize only outside math (M99 review). Inside-math
    // detection: an odd count of unescaped $ before the match.
    const dollars = (source.slice(0, offset).match(/(?<!\\)\$/g) || []).length;
    const inMath = dollars % 2 === 1;
    if (mode === 'front') {
      const blank = `[${(hint || '...').trim()}]`;
      return ord === targetIndex ? (inMath ? blank : `**${blank}**`) : answer;
    }
    return ord === targetIndex ? (inMath ? answer : `**${answer}**`) : answer;
  });
}

/** Clamp an importance value to the stored range: 0 = unscored, 1..100 scored. */
function fcNormalizeImportance(v) {
  const n = Math.round(Number(v));
  if (!Number.isFinite(n) || n <= 0) return 0;
  return Math.min(100, n);
}

// ── Recall modes (M102) ──────────────────────────────────────────────────────
//
// What a review ELICITS, and therefore which grader runs. Orthogonal to
// card_type ('basic' | 'cloze' | 'reverse'), which picks how a note renders.

/** Modes that require the learner to produce an answer before grading. */
const FC_PRODUCTION_MODES = ['conceptual', 'list', 'formula'];
const FC_RECALL_MODES = ['recognition', ...FC_PRODUCTION_MODES];

/** Unknown/absent → 'recognition', so a bad value degrades to today's loop. */
function fcNormalizeRecallMode(v) {
  const s = String(v || '').trim().toLowerCase();
  return FC_RECALL_MODES.includes(s) ? s : 'recognition';
}

function fcIsProductionMode(mode) {
  return FC_PRODUCTION_MODES.includes(fcNormalizeRecallMode(mode));
}

/** Longest rubric we store. Past this the model is padding, not distilling. */
const FC_RUBRIC_MAX_POINTS = 12;
const FC_RUBRIC_POINT_MAX_CHARS = 400;

/**
 * Cap on the stored source passage. A dense actuarial PDF page extracts to
 * roughly 3-4K chars, so this is most of a page and all of a typical one.
 *
 * Sized against the grading prompt, not storage: at the 2.5 chars/token
 * planning ratio this is ~800 tokens, which leaves the rubric, the answer,
 * and the system prompt fitting comfortably inside any model's window
 * without a context plan of their own. Storage is the cheap constraint —
 * 2K chars across even 2,000 cards is ~4MB.
 */
const FC_SOURCE_EXCERPT_MAX_CHARS = 2000;

/**
 * Normalize a rubric to the stored shape: [{ text, required }].
 *
 * Accepts what the model actually emits — a bare array of strings, or
 * objects under any of a few plausible key names — because forcing one exact
 * shape on a local model costs more in retries than normalizing here does.
 * `required` defaults TRUE: a point the model bothered to list is part of the
 * answer unless it explicitly says otherwise, and defaulting the other way
 * would let a rubric of all-optional points grade every answer as complete.
 *
 * Pure.
 */
function fcNormalizeRubric(v) {
  const raw = typeof v === 'string'
    ? (() => { try { return JSON.parse(v); } catch { return []; } })()
    : v;
  if (!Array.isArray(raw)) return [];
  const out = [];
  for (const item of raw) {
    const text = String(
      (item && typeof item === 'object' ? (item.text ?? item.point ?? item.item ?? '') : item) ?? '',
    ).replace(/\s+/g, ' ').trim().slice(0, FC_RUBRIC_POINT_MAX_CHARS);
    if (!text) continue;
    const required = (item && typeof item === 'object' && item.required !== undefined)
      ? !!item.required
      : true;
    out.push({ text, required });
    if (out.length >= FC_RUBRIC_MAX_POINTS) break;
  }
  return out;
}

/** Stored form. Empty rubric stores as '' (not '[]') so `= ''` reads as absent. */
function fcSerializeRubric(points) {
  const norm = fcNormalizeRubric(points);
  return norm.length ? JSON.stringify(norm) : '';
}

/**
 * The hand-editable rubric format: one point per line, a trailing
 * "(optional)" marking supporting detail. Pure.
 *
 * Not JSON, even though JSON is what gets stored. A syntax error in a
 * hand-edited JSON textarea would parse to nothing and silently empty the
 * rubric, which drops the card back to a self-grade with no visible cause —
 * the exact failure this milestone exists to remove. Line-per-point cannot
 * fail that way: the worst outcome is a point worded oddly.
 */
function fcParseRubricLines(text) {
  return fcNormalizeRubric(
    String(text || '')
      .split('\n')
      .map((line) => line.replace(/^\s*[-*•]\s*/, '').trim())
      .filter(Boolean)
      .map((line) => {
        const m = /^(.*?)\s*\((?:optional|supporting)\)\s*$/i.exec(line);
        return m ? { text: m[1].trim(), required: false } : { text: line, required: true };
      })
      .filter((p) => p.text),
  );
}

/** One line of plain English per mode, shown beside the picker. */
const FC_RECALL_MODE_HINTS = {
  recognition: 'Reveal the answer and grade yourself. Right when the answer is a bare name, date, or number.',
  conceptual: 'Write the answer out before it shows — anything that takes a sentence. Graded against the rubric below.',
  list: 'Enumerate the items from memory. Scored on how many you produce.',
  formula: 'Write the formula out. Compared exactly, ignoring spacing and delimiters.',
};

// ── Grading a produced answer (M102) ─────────────────────────────────────────
//
// The model is never asked for a rating. It answers the factual question it
// is actually reliable at — for each rubric point, did the answer contain it?
// — and this code turns that into 1..4. Two consequences worth keeping:
// identical answers cannot land on different levels, and the thresholds are
// testable without a model in the loop.

const FC_POINT_STATUSES = ['hit', 'partial', 'miss'];

/** Grade names and point marks — shared by the study UI, the browse
 *  history, and the chat hand-off, so all three read a verdict alike. */
const FC_RATING_LABELS = { 1: 'Again', 2: 'Hard', 3: 'Good', 4: 'Easy' };
const FC_POINT_GLYPHS = { hit: '✓', partial: '~', miss: '✗' };

/**
 * Score at or above which an incomplete answer still reads as GOOD.
 *
 * Chosen against the scores small rubrics can actually produce, not as a
 * round number: 2 of 3 is 0.67 and 3 of 4 is 0.75, and both are the
 * "got it, missed a detail" answer this band is meant to catch, while 1 of 2
 * (0.5) and 3 of 5 (0.6) are not and must fall to HARD.
 */
const FC_GRADE_GOOD_FLOOR = 0.65;

/**
 * Coerce a model's judgement into the stored verdict shape.
 *
 * `points` is positional — parallel to the rubric — because asking a local
 * model to echo each point's text back costs output tokens and invites it to
 * paraphrase the rubric into something that no longer matches. A short array
 * is padded with misses rather than rejected: a model that judged 3 of 5
 * points has still told us something, and discarding it would force a
 * self-grade fallback on a card the learner already answered.
 *
 * Pure.
 */
function fcNormalizeVerdict(raw, rubric, { mode = 'conceptual', sourced = false } = {}) {
  const points = fcNormalizeRubric(rubric);
  const rawPoints = Array.isArray(raw?.points) ? raw.points : [];
  const out = [];
  for (let i = 0; i < points.length; i++) {
    const p = rawPoints[i];
    const statusRaw = String(
      (p && typeof p === 'object' ? (p.status ?? p.verdict ?? p.result ?? '') : p) ?? '',
    ).trim().toLowerCase();
    const status = FC_POINT_STATUSES.includes(statusRaw) ? statusRaw
      : statusRaw === 'yes' || statusRaw === 'true' ? 'hit'
        : statusRaw === 'no' || statusRaw === 'false' ? 'miss'
          : 'miss';
    out.push({
      status,
      note: String((p && typeof p === 'object' ? p.note ?? p.reason ?? '' : '') || '')
        .replace(/\s+/g, ' ').trim().slice(0, 200),
    });
  }
  return {
    mode: fcNormalizeRecallMode(mode),
    points: out,
    contradiction: !!(raw?.contradiction ?? raw?.contradicts ?? raw?.contradictsSource),
    note: String(raw?.note ?? raw?.feedback ?? raw?.comment ?? '').replace(/\s+/g, ' ').trim().slice(0, 400),
    sourced: !!sourced,
  };
}

/**
 * Score a verdict against its rubric. Pure.
 *
 * A partial counts half: it is the model saying the idea is present but
 * incomplete or hedged, which is genuinely between knowing and not.
 */
function fcScoreVerdict(verdict, rubric) {
  const points = fcNormalizeRubric(rubric);
  const total = points.length;
  if (!total) return { score: 0, hits: 0, partials: 0, misses: 0, requiredMissed: false, total: 0 };
  let hits = 0, partials = 0, misses = 0, requiredMisses = 0;
  for (let i = 0; i < total; i++) {
    const status = verdict?.points?.[i]?.status || 'miss';
    if (status === 'hit') hits++;
    else if (status === 'partial') partials++;
    else {
      misses++;
      if (points[i].required) requiredMisses++;
    }
  }
  return {
    score: (hits + 0.5 * partials) / total,
    hits, partials, misses, total,
    requiredMisses,
    requiredMissed: requiredMisses > 0,
    // Everything short of a clean hit — the "how many things went wrong"
    // count, as distinct from how much credit the answer earned.
    gaps: misses + partials,
  };
}

/**
 * Verdict → FSRS rating (1..4), or null when the verdict cannot be scored
 * (no rubric) and the caller must fall back to a self-grade.
 *
 * Speed is deliberately NOT an input. For a recognition card, latency is
 * evidence of retrieval effort; for a typed answer it measures typing, so
 * folding it in would grade fast typists as knowing more. Completeness
 * carries the whole signal.
 *
 * A contradiction outranks the score, including a high one. An answer that
 * states something the source denies is worse evidence than a blank — and it
 * is exactly what self-grading never catches, because reading the back and
 * recognising your own error feels like a Hard, not an Again.
 *
 * EASY needs a rubric of at least two points. On a one-point rubric
 * "complete" and "correct" are the same event, so awarding the top grade
 * there would hand out FSRS's largest interval multiplier for what is really
 * a single right answer.
 *
 * The GOOD threshold is 0.65, not the 0.8 it started at, because rubrics are
 * small and the reachable scores are coarse. At 0.8, a 2-, 3- or 4-point
 * rubric can only score 0.5 / 0.67 / 0.75 below a perfect answer, so GOOD was
 * unreachable by hits alone and every review landed HARD or EASY. Most
 * rubrics are 3-5 points, so that bimodal stream would have been the normal
 * case, feeding FSRS far more HARDs than the answers earned and shrinking
 * intervals across the deck.
 *
 * Pure.
 */
function fcMapVerdictToRating(verdict, rubric) {
  const s = fcScoreVerdict(verdict, rubric);
  if (!s.total) return null;
  if (verdict?.contradiction) return AGAIN;
  if (s.score < 0.5) return AGAIN;
  // Missing something the rubric marked essential caps the grade, however
  // well the rest scored. The single exception is the "almost there" answer:
  // exactly one thing missing, and it was otherwise clean. Two or more
  // essential gaps is not almost-there, it is partial understanding.
  if (s.requiredMisses >= 2) return HARD;
  if (s.requiredMisses === 1) return (s.gaps === 1 && s.score >= FC_GRADE_GOOD_FLOOR) ? GOOD : HARD;
  if (s.score >= 1 && s.partials === 0) return s.total >= 2 ? EASY : GOOD;
  return s.score >= FC_GRADE_GOOD_FLOOR ? GOOD : HARD;
}

/**
 * Normalize a formula for comparison. Pure.
 *
 * Conservative on purpose: it removes the notation that is genuinely free
 * (spacing, delimiters, `\left`/`\right`, `$`) and unifies the few commands
 * that are pure synonyms, and it does NOT try to be a computer algebra
 * system. Deciding that `\frac{a}{b}` and `a/b` are the same expression is
 * the model's job on the mismatch path; a normalizer that guessed at it
 * would mark real errors correct, which is the one failure mode a formula
 * card cannot afford.
 */
function fcNormalizeFormula(s) {
  return String(s || '')
    .replace(/\$+/g, '')
    .replace(/\\left|\\right/g, '')
    .replace(/\\[,;:!]/g, '')
    .replace(/\\(?:cdot|times)\b/g, '*')
    .replace(/\\(?:mathrm|mathit|text|operatorname)\s*\{([^{}]*)\}/g, '$1')
    .replace(/\s+/g, '')
    .replace(/\{([A-Za-z0-9])\}/g, '$1')
    .trim();
}

/** Exact-after-normalisation formula match. Pure. */
function fcFormulaMatches(a, b) {
  const na = fcNormalizeFormula(a);
  return !!na && na === fcNormalizeFormula(b);
}

// Trigram bands for the deterministic list pre-pass. Wide uncertain band on
// purpose: a wrong auto-hit inflates FSRS stability on a list the learner
// cannot actually produce, and that error is invisible afterwards, so the
// cheap outcome (one extra model call) is strongly preferred to the silent
// one. Only answers that are clearly right or clearly absent skip the model.
const FC_LIST_AUTO_HIT = 0.65;
const FC_LIST_AUTO_MISS = 0.2;

/**
 * Deterministic first pass for `list` mode. Pure.
 *
 * Splits the typed answer into candidate items (lines, bullets, semicolons)
 * and scores each rubric item against its best match. Returns provisional
 * statuses plus whether anything landed in the uncertain band; when nothing
 * did, the whole grading runs offline and costs no model call at all.
 */
function fcMatchListItems(answer, rubric) {
  const points = fcNormalizeRubric(rubric);
  const candidates = String(answer || '')
    .split(/[\n;]+|^\s*[-*•]\s+|\s+\d+[.)]\s+/gm)
    .map((t) => t.replace(/^\s*[-*•]\s*/, '').trim())
    .filter(Boolean);
  const statuses = [];
  let uncertain = false;
  for (const p of points) {
    let best = 0;
    for (const c of candidates) best = Math.max(best, fcTrigramSimilarity(p.text, c));
    if (best >= FC_LIST_AUTO_HIT) statuses.push({ status: 'hit', note: '' });
    else if (best < FC_LIST_AUTO_MISS) statuses.push({ status: 'miss', note: '' });
    else { statuses.push({ status: 'partial', note: '' }); uncertain = true; }
  }
  return { statuses, uncertain, candidateCount: candidates.length };
}

async function fcCreateCard(input) {
  const res = await db.run(`
    INSERT INTO fc_cards (deck_id, front, back, notes, tags, source_uri, source_label, source_page, card_type, note_group, cloze_index, created_at, importance, importance_reason, recall_mode, rubric, source_excerpt)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
  `, [
    input.deckId,
    fcNormalizeCardText(input.front),
    fcNormalizeCardText(input.back),
    input.notes || '',
    input.tags || '',
    input.sourceUri || '',
    input.sourceLabel || '',
    Number.isInteger(input.sourcePage) && input.sourcePage > 0 ? input.sourcePage : 0,
    input.cardType || 'basic',
    input.noteGroup || '',
    Number.isInteger(input.clozeIndex) && input.clozeIndex > 0 ? input.clozeIndex : 0,
    Date.now(),
    fcNormalizeImportance(input.importance),
    String(input.importanceReason || '').slice(0, 300),
    fcNormalizeRecallMode(input.recallMode),
    fcSerializeRubric(input.rubric),
    String(input.sourceExcerpt || '').slice(0, FC_SOURCE_EXCERPT_MAX_CHARS),
  ]);
  _emitDataChanged();
  const id = res.lastInsertRowid ?? res.lastID ?? null;
  if (id != null) void fcEmbedCards([{ id, front: input.front, back: input.back }]);
  return id;
}

/**
 * Insert many cards in one go, chunked into multi-row INSERTs.
 *
 * A Rising Fellow deck is ~1,000 cards; one fcCreateCard per card is one IPC
 * round-trip to the database worker each, which turns an import into seconds
 * of sequential waiting. Fifty rows per statement keeps each statement well
 * under SQLite's default 999-parameter limit (8 params × 50 = 400) and cuts
 * the trips by that factor. One _emitDataChanged at the end, not per chunk —
 * every listener repaint between chunks would be wasted work.
 */
// The compensating DELETE below keys on created_at, so two bulk calls landing
// in the same millisecond (small groups resolve fast) must never share a
// stamp — a failure in the second would erase the first's committed rows.
let _lastBulkStamp = 0;

async function fcCreateCardsBulk(deckId, cards, { sourceUri = '', sourceLabel = '' } = {}) {
  const now = Math.max(Date.now(), _lastBulkStamp + 1);
  _lastBulkStamp = now;
  // M98: per-card provenance/type overrides (c.sourceUri, c.sourcePage,
  // c.cardType, c.noteGroup, …) win over the call-level defaults. Tags are
  // normalized to comma-joined — the bulk path used spaces while every other
  // path used commas, which any tag filtering would have tripped over.
  const rowParams = (c) => [
    deckId,
    fcNormalizeCardText(c.front),
    fcNormalizeCardText(c.back),
    c.notes || '',
    Array.isArray(c.tags) ? c.tags.join(',') : (c.tags || ''),
    c.sourceUri !== undefined ? c.sourceUri : sourceUri,
    c.sourceLabel !== undefined ? c.sourceLabel : sourceLabel,
    Number.isInteger(c.sourcePage) && c.sourcePage > 0 ? c.sourcePage : 0,
    c.cardType || 'basic',
    c.noteGroup || '',
    Number.isInteger(c.clozeIndex) && c.clozeIndex > 0 ? c.clozeIndex : 0,
    now,
    // Generation and import leave this undefined → 0. Copies pass it through:
    // a flag is user-set organisation like tags, not scheduling state, so
    // dropping it while keeping the tags would be arbitrary.
    fcNormalizeFlag(c.flag),
    fcNormalizeImportance(c.importance),
    String(c.importanceReason || '').slice(0, 300),
    // M102. Generation and import leave these undefined → 'recognition' with
    // an empty rubric, which is exactly today's behaviour.
    fcNormalizeRecallMode(c.recallMode),
    fcSerializeRubric(c.rubric),
    String(c.sourceExcerpt || '').slice(0, FC_SOURCE_EXCERPT_MAX_CHARS),
  ];
  const COLS = '(deck_id, front, back, notes, tags, source_uri, source_label, source_page, card_type, note_group, cloze_index, created_at, flag, importance, importance_reason, recall_mode, rubric, source_excerpt)';
  const ROW_PH = '(?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)';
  const ROW_WIDTH = 18;
  // Rows per statement, DERIVED rather than the literal 50 it used to be.
  // That literal was chosen when a row was 8 params wide (400 per statement,
  // comfortably under SQLite's 999-parameter ceiling); the row has grown
  // three times since and is now 18 wide, which would put a 50-row statement
  // at 900 — still passing, but two columns from failing an import silently
  // on the next milestone that adds one. Deriving it keeps the headroom no
  // matter how wide the row gets.
  const CHUNK = Math.max(1, Math.floor(900 / ROW_WIDTH));

  const statements = [];
  for (let i = 0; i < cards.length; i += CHUNK) {
    const chunk = cards.slice(i, i + CHUNK);
    statements.push({
      sql: `INSERT INTO fc_cards ${COLS} VALUES ${chunk.map(() => ROW_PH).join(', ')}`,
      params: chunk.flatMap(rowParams),
    });
  }

  // Preferred path: one real transaction — all-or-nothing at the SQL layer.
  // The runner dispatches on op.type; omitting it fails every op (M99 review).
  if (_dbBridge && typeof _dbBridge.runTransaction === 'function') {
    const res = await _dbBridge.runTransaction(statements.map((s) => ({ type: 'run', sql: s.sql, params: s.params })));
    if (res?.error) throw new Error(`[FC-DB] ${res.error.message}`);
    _emitDataChanged();
    void fcEmbedNewBulk(deckId, now);
    return cards.length;
  }

  // Fallback for hosts without the transaction bridge: sequential chunks with
  // a compensating delete. The uniquified created_at stamp alone identifies
  // exactly this call's rows (per-card source values made the old
  // source_uri/source_label key unusable).
  let inserted = 0;
  try {
    for (const s of statements) {
      await db.run(s.sql, s.params);
      inserted += s.params.length / ROW_WIDTH;
    }
  } catch (e) {
    try {
      await db.run('DELETE FROM fc_cards WHERE deck_id = ? AND created_at = ?', [deckId, now]);
    } catch { /* compensation is best-effort; the error below still surfaces */ }
    _emitDataChanged();
    throw e;
  }
  _emitDataChanged();
  void fcEmbedNewBulk(deckId, now);
  return inserted;
}

// ── Note creation: basic / cloze / reverse (M98) ────────────────────────────

/**
 * Create the card row(s) for one authored note. Cloze text ({{cN::…}} in the
 * front) yields one sibling per ordinal; `reverse: true` yields the pair;
 * otherwise a single basic card. Returns the number of cards created.
 * Sibling groups deliberately skip duplicate scanning — they are near-
 * duplicates by construction (and fcFindDuplicates exempts note_group).
 */
async function fcCreateNote(deckId, input) {
  const front = String(input.front || '');
  const clozeIndices = fcParseClozeIndices(front);
  if (clozeIndices.length > 0) {
    const noteGroup = crypto.randomUUID();
    const cards = clozeIndices.map((ord) => ({
      front,
      back: input.back || '',
      tags: input.tags || '',
      notes: input.notes || '',
      sourceUri: input.sourceUri, sourceLabel: input.sourceLabel, sourcePage: input.sourcePage,
      cardType: 'cloze', noteGroup, clozeIndex: ord,
    }));
    return fcCreateCardsBulk(deckId, cards);
  }
  if (input.reverse) {
    const noteGroup = crypto.randomUUID();
    const shared = {
      tags: input.tags || '', notes: input.notes || '',
      sourceUri: input.sourceUri, sourceLabel: input.sourceLabel, sourcePage: input.sourcePage,
      cardType: 'reverse', noteGroup,
    };
    return fcCreateCardsBulk(deckId, [
      { ...shared, front, back: input.back || '' },
      { ...shared, front: input.back || '', back: front },
    ]);
  }
  await fcCreateCard({ deckId, ...input });
  return 1;
}

/**
 * After a cloze sibling's text is edited, bring the whole group back in sync:
 * every sibling carries the new text, ordinals added in the edit gain fresh
 * (new-state) siblings, and ordinals that vanished lose theirs — review
 * history of surviving ordinals is untouched.
 */
async function fcReconcileClozeGroup(noteGroup, deckId, newFront, newBack, editedId = null) {
  const siblings = await db.all(
    "SELECT id, cloze_index FROM fc_cards WHERE note_group = ? AND card_type = 'cloze'", [noteGroup],
  );
  if (!siblings.length) return;
  const wanted = new Set(fcParseClozeIndices(newFront));
  // Un-clozing (all markers removed) means "make this a plain card" — the
  // edited row survives as basic and only the OTHER siblings go. Deleting
  // the whole group, edited card included, was the M99 review's finding.
  if (wanted.size === 0) {
    for (const s of siblings) {
      if (editedId != null && s.id === editedId) continue;
      await fcDeleteCard(s.id);
    }
    const keepId = editedId ?? siblings[0].id;
    await db.run(
      "UPDATE fc_cards SET card_type = 'basic', note_group = '', cloze_index = 0, front = ?, back = ? WHERE id = ?",
      [fcNormalizeCardText(newFront), fcNormalizeCardText(newBack ?? ''), keepId],
    );
    _emitDataChanged();
    return;
  }
  const have = new Map(siblings.map((s) => [s.cloze_index, s.id]));
  await db.run(
    "UPDATE fc_cards SET front = ?, back = ? WHERE note_group = ? AND card_type = 'cloze'",
    [fcNormalizeCardText(newFront), fcNormalizeCardText(newBack ?? ''), noteGroup],
  );
  for (const [ord, id] of have) {
    if (!wanted.has(ord)) await fcDeleteCard(id);
  }
  const missing = [...wanted].filter((ord) => !have.has(ord));
  if (missing.length) {
    await fcCreateCardsBulk(deckId, missing.map((ord) => ({
      front: newFront, back: newBack ?? '',
      cardType: 'cloze', noteGroup, clozeIndex: ord,
    })));
  }
  _emitDataChanged();
}

// ── Card embeddings + duplicate detection (M98) ─────────────────────────────
// Vectors live in a sqlite-vec vec0 virtual table INSIDE the extension DB
// (the ext bridge loads sqlite-vec for every extension database). The table
// is created lazily in code — NOT in a migration — so a host without vec
// support degrades to the trigram fallback instead of failing activation.
// Everything here is best-effort: no embedding path ever blocks or throws
// into a caller.

const FC_EMB_DIMS = 768; // nomic-embed-text v1.5; EmbeddingService hard-validates
const FC_DUP_SIM_EMBEDDING = 0.88; // cosine similarity flag threshold
const FC_DUP_SIM_TRIGRAM = 0.5;    // Jaccard 3-gram fallback threshold
// Deck-wide sweep shortlist threshold: recall-biased (lower than the flag
// threshold) because the AI judge arbitrates every candidate cluster.
const FC_SWEEP_SIM_EMBEDDING = 0.83;

let _embSvcCache; // undefined = unprobed; null = unavailable
function fcEmbeddingService() {
  if (_embSvcCache !== undefined) return _embSvcCache;
  try {
    const ID = { id: 'IEmbeddingService' };
    _embSvcCache = (_api?.services?.has?.(ID) && _api.services.get(ID)) || null;
  } catch { _embSvcCache = null; }
  return _embSvcCache;
}

let _vecReady; // Promise<boolean>, memoized
function fcEnsureVecTable() {
  if (_vecReady) return _vecReady;
  _vecReady = (async () => {
    try {
      await db.run(
        `CREATE VIRTUAL TABLE IF NOT EXISTS fc_card_embeddings USING vec0(
          embedding float[${FC_EMB_DIMS}] distance_metric=cosine,
          +card_id TEXT NOT NULL
        )`,
      );
      return true;
    } catch (e) {
      console.warn('[Flashcards] vec table unavailable — dedup falls back to trigram:', e?.message);
      return false;
    }
  })();
  return _vecReady;
}

/**
 * Liveness probe: Ollama reachable AND the embedding service resolvable AND
 * the vec table creatable. A plain /api/version ping avoids ensureModel's
 * auto-pull side effect (a first-ever embed can otherwise block on a
 * multi-minute model download).
 */
async function fcEmbeddingsAvailable() {
  const svc = fcEmbeddingService();
  if (!svc) return false;
  if (!(await fcEnsureVecTable())) return false;
  try {
    const ctl = new AbortController();
    const t = setTimeout(() => ctl.abort(), 2000);
    const res = await fetch('http://localhost:11434/api/version', { signal: ctl.signal });
    clearTimeout(t);
    return res.ok;
  } catch { return false; }
}

function fcCardEmbedText(front, back) {
  return `${String(front || '').trim()}\n${String(back || '').trim()}`.slice(0, 4000);
}

/** Standalone byte copy — IPC structured clone can misalign shared buffers. */
function fcVecBlob(vec) {
  return new Uint8Array(new Float32Array(vec).buffer.slice(0));
}

/** Embed and store vectors for cards [{id, front, back}]. Never throws. */
async function fcEmbedCards(cards) {
  try {
    if (!cards.length || !(await fcEmbeddingsAvailable())) return;
    const svc = fcEmbeddingService();
    const texts = cards.map((c) => fcCardEmbedText(c.front, c.back));
    const vectors = await svc.embedDocumentBatch(texts);
    for (let i = 0; i < cards.length; i++) {
      const vec = vectors[i];
      if (!Array.isArray(vec) || vec.length !== FC_EMB_DIMS) continue;
      await db.run('DELETE FROM fc_card_embeddings WHERE card_id = ?', [String(cards[i].id)]);
      await db.run(
        'INSERT INTO fc_card_embeddings (embedding, card_id) VALUES (?, ?)',
        [fcVecBlob(vec), String(cards[i].id)],
      );
    }
  } catch (e) {
    console.warn('[Flashcards] card embedding skipped:', e?.message);
  }
}

/** Embed the rows a bulk insert just created (fire-and-forget). */
async function fcEmbedNewBulk(deckId, createdAt) {
  try {
    const rows = await db.all(
      'SELECT id, front, back FROM fc_cards WHERE deck_id = ? AND created_at = ?',
      [deckId, createdAt],
    );
    await fcEmbedCards(rows);
  } catch { /* best-effort */ }
}

/** 3-gram Jaccard similarity — the no-Ollama fallback. */
function fcTrigramSimilarity(a, b) {
  const grams = (s) => {
    const norm = String(s || '').toLowerCase().replace(/[^a-z0-9$\\]+/g, ' ').replace(/\s+/g, ' ').trim();
    const set = new Set();
    for (let i = 0; i <= norm.length - 3; i++) set.add(norm.slice(i, i + 3));
    return set;
  };
  const ga = grams(a), gb = grams(b);
  if (ga.size === 0 || gb.size === 0) return 0;
  let inter = 0;
  for (const g of ga) if (gb.has(g)) inter++;
  return inter / (ga.size + gb.size - inter);
}

/**
 * Duplicate scan: for each candidate {front, back} return null or
 * { similarity, matchId, matchFront } vs the deck's existing cards.
 * Embedding KNN when available, trigram otherwise. Cards sharing a
 * note_group with the candidate are exempt (cloze/reverse siblings are
 * near-identical by design). Never throws.
 */
async function fcFindDuplicates(deckId, candidates, { noteGroup = '' } = {}) {
  const out = candidates.map(() => null);
  try {
    if (await fcEmbeddingsAvailable()) {
      const svc = fcEmbeddingService();
      const texts = candidates.map((c) => fcCardEmbedText(c.front, c.back));
      const vectors = await svc.embedDocumentBatch(texts);
      for (let i = 0; i < candidates.length; i++) {
        const vec = vectors[i];
        if (!Array.isArray(vec) || vec.length !== FC_EMB_DIMS) continue;
        // KNN in a subquery: vec0 requires the MATCH + k constraint to stand
        // alone; deck filtering happens on the joined outer query.
        const hits = await db.all(
          `SELECT v.card_id, v.distance, c.front, c.note_group
           FROM (SELECT card_id, distance FROM fc_card_embeddings
                 WHERE embedding MATCH ? AND k = 32 ORDER BY distance) v
           JOIN fc_cards c ON c.id = CAST(v.card_id AS INTEGER)
           WHERE c.deck_id = ?
           ORDER BY v.distance`,
          [fcVecBlob(vec), deckId],
        );
        for (const h of hits) {
          if (noteGroup && h.note_group === noteGroup) continue;
          // sqlite-vec cosine distance = 1 − cosine similarity (range 0..2).
          const similarity = 1 - h.distance;
          if (similarity >= FC_DUP_SIM_EMBEDDING) {
            out[i] = { similarity, matchId: Number(h.card_id), matchFront: h.front };
          }
          break; // nearest non-sibling decides
        }
      }
      return out;
    }
    // Trigram fallback — O(deck × candidates), fine at deck scale.
    const existing = await db.all(
      'SELECT id, front, back, note_group FROM fc_cards WHERE deck_id = ?', [deckId],
    );
    for (let i = 0; i < candidates.length; i++) {
      const text = fcCardEmbedText(candidates[i].front, candidates[i].back);
      let best = null;
      for (const ex of existing) {
        if (noteGroup && ex.note_group === noteGroup) continue;
        const sim = fcTrigramSimilarity(text, fcCardEmbedText(ex.front, ex.back));
        if (sim >= FC_DUP_SIM_TRIGRAM && (!best || sim > best.similarity)) {
          best = { similarity: sim, matchId: ex.id, matchFront: ex.front };
        }
      }
      out[i] = best;
    }
  } catch (e) {
    console.warn('[Flashcards] duplicate scan skipped:', e?.message);
  }
  return out;
}

/**
 * Lazy backfill: embed cards that have no vector yet. Runs off the
 * activation path (delayed), capped per run so a huge legacy deck spreads
 * across sessions instead of pinning the embed endpoint for minutes.
 */
async function fcBackfillEmbeddings(cap = 512) {
  try {
    if (!(await fcEmbeddingsAvailable())) return;
    const rows = await db.all(
      `SELECT c.id, c.front, c.back FROM fc_cards c
       LEFT JOIN fc_card_embeddings e ON e.card_id = CAST(c.id AS TEXT)
       WHERE e.card_id IS NULL LIMIT ?`,
      [cap],
    );
    if (rows.length) await fcEmbedCards(rows);
  } catch { /* best-effort */ }
}

// ── Deck-wide duplicate sweep (user ask: find cards asking essentially the
//    same thing across a WHOLE deck, not one by one) ────────────────────────

/**
 * Union-find clustering of candidate pairs. Pure. Input: `{a, b, similarity}`
 * pairs (canonical a < b). Output: clusters of 2+ card ids, each with its
 * pairs, sorted by strongest similarity first.
 */
function fcClusterPairs(pairs) {
  const parent = new Map();
  const find = (x) => {
    let r = x;
    while (parent.get(r) !== r) r = parent.get(r);
    let c = x;
    while (parent.get(c) !== c) { const n = parent.get(c); parent.set(c, r); c = n; }
    return r;
  };
  const union = (a, b) => {
    if (!parent.has(a)) parent.set(a, a);
    if (!parent.has(b)) parent.set(b, b);
    const ra = find(a), rb = find(b);
    if (ra !== rb) parent.set(ra, rb);
  };
  for (const p of pairs) union(p.a, p.b);
  const groups = new Map();
  for (const id of parent.keys()) {
    const root = find(id);
    if (!groups.has(root)) groups.set(root, { cardIds: [], pairs: [] });
    groups.get(root).cardIds.push(id);
  }
  for (const p of pairs) groups.get(find(p.a)).pairs.push(p);
  return [...groups.values()]
    .filter((g) => g.cardIds.length >= 2)
    .map((g) => ({
      cardIds: g.cardIds.sort((a, b) => a - b),
      pairs: g.pairs,
      similarity: Math.max(...g.pairs.map((p) => p.similarity)),
    }))
    .sort((a, b) => b.similarity - a.similarity);
}

/**
 * Trigram pairwise sweep. Pure. Precomputes gram sets once per card (the
 * pairwise loop would otherwise rebuild them O(n²) times). Skips shared
 * note_group pairs (cloze/reverse siblings are near-duplicates by
 * construction). Returns canonical `{a, b, similarity}` pairs >= threshold.
 */
function fcTrigramPairs(cards, threshold = FC_DUP_SIM_TRIGRAM) {
  const grams = (s) => {
    const norm = String(s || '').toLowerCase().replace(/[^a-z0-9$\\]+/g, ' ').replace(/\s+/g, ' ').trim();
    const set = new Set();
    for (let i = 0; i <= norm.length - 3; i++) set.add(norm.slice(i, i + 3));
    return set;
  };
  const sets = cards.map((c) => grams(`${c.front}\n${c.back}`));
  const pairs = [];
  for (let i = 0; i < cards.length; i++) {
    for (let j = i + 1; j < cards.length; j++) {
      if (cards[i].noteGroup && cards[i].noteGroup === cards[j].noteGroup) continue;
      const ga = sets[i], gb = sets[j];
      if (ga.size === 0 || gb.size === 0) continue;
      let inter = 0;
      for (const g of ga) if (gb.has(g)) inter++;
      const sim = inter / (ga.size + gb.size - inter);
      if (sim >= threshold) {
        const a = Math.min(cards[i].id, cards[j].id);
        const b = Math.max(cards[i].id, cards[j].id);
        pairs.push({ a, b, similarity: sim });
      }
    }
  }
  return pairs;
}

/**
 * Collect candidate duplicate pairs across a whole deck. Embedding KNN over
 * STORED vectors when available (deck-scoped backfill first; zero Ollama
 * round-trips for embedded cards), trigram fallback otherwise. Never throws.
 * Returns { pairs, method }.
 */
async function fcSweepDeckPairs(deckId, { onProgress } = {}) {
  const cards = await fcListAllCards(deckId);
  if (cards.length < 2) return { pairs: [], method: 'none' };
  try {
    if (await fcEmbeddingsAvailable()) {
      // Deck-scoped backfill so a partially-embedded deck sweeps fully.
      const missing = await db.all(
        `SELECT c.id, c.front, c.back FROM fc_cards c
         LEFT JOIN fc_card_embeddings e ON e.card_id = CAST(c.id AS TEXT)
         WHERE e.card_id IS NULL AND c.deck_id = ? LIMIT 512`,
        [deckId],
      );
      if (missing.length) await fcEmbedCards(missing);

      const pairMap = new Map();
      let done = 0;
      for (const card of cards) {
        const vecRow = await db.get(
          'SELECT embedding FROM fc_card_embeddings WHERE card_id = ?', [String(card.id)],
        );
        done++;
        try { onProgress?.(done, cards.length); } catch { /* UI gone */ }
        if (!vecRow?.embedding) continue;
        // vec0 rule: MATCH ? AND k must stand ALONE in the subquery; the
        // deck filter joins on the outside.
        const hits = await db.all(
          `SELECT v.card_id, v.distance, c.note_group
           FROM (SELECT card_id, distance FROM fc_card_embeddings
                 WHERE embedding MATCH ? AND k = 32 ORDER BY distance) v
           JOIN fc_cards c ON c.id = CAST(v.card_id AS INTEGER)
           WHERE c.deck_id = ? ORDER BY v.distance`,
          [vecRow.embedding, deckId],
        );
        for (const h of hits) {
          const otherId = Number(h.card_id);
          if (otherId === card.id) continue; // self-match at similarity 1.0
          if (card.noteGroup && h.note_group === card.noteGroup) continue;
          const similarity = 1 - h.distance;
          if (similarity < FC_SWEEP_SIM_EMBEDDING) break; // sorted by distance
          const a = Math.min(card.id, otherId);
          const b = Math.max(card.id, otherId);
          const key = `${a}:${b}`;
          const prev = pairMap.get(key);
          if (!prev || similarity > prev.similarity) pairMap.set(key, { a, b, similarity });
        }
      }
      return { pairs: [...pairMap.values()], method: 'embedding' };
    }
  } catch (err) {
    console.warn('[Flashcards] embedding sweep failed; falling back to trigram:', err);
  }
  return { pairs: fcTrigramPairs(cards), method: 'trigram' };
}

const FC_JUDGE_SYSTEM = [
  'You judge whether flashcards in a cluster are DUPLICATES: cards asking essentially the same thing, even with different wording.',
  'The decision test is KNOWLEDGE redundancy, never text similarity: would a student who reliably answers one card necessarily be able to answer the other? Only then are they duplicates.',
  'CONTRAST TRAP: cards with near-identical wording but DIFFERENT answers (a different variable, method, assumption, sign, or case) are NOT duplicates. They are deliberate contrast pairs, often the most exam-valuable cards in a deck, and both must stay ("distinct"). Compare the ANSWERS before anything else.',
  'For each numbered cluster, decide:',
  '- "duplicate": the cards test the same fact or recall. Pick the single best card to keep (clearest wording, most complete answer) as keepId.',
  '- "overlap": the cards share substance but each adds something. Propose ONE merged card (front + back) that covers both without padding; keepId is the card whose scheduling history should survive.',
  '- "distinct": the cards only look similar; both should stay.',
  'Judge by what the card TESTS, not surface wording. A definition card and an application card about the same concept are distinct.',
  'Never use em dashes. Formulas stay in $LaTeX$.',
  'Output ONLY a JSON array, one object per cluster, echoing the cluster number:',
  '[{"cluster": 1, "verdict": "duplicate", "keepId": 123, "mergedCard": null, "reason": "..."},',
  ' {"cluster": 2, "verdict": "overlap", "keepId": 456, "mergedCard": {"front": "...", "back": "..."}, "reason": "..."}]',
].join('\n');

/**
 * AI arbitration over candidate clusters. Returns
 * `{ clusters, failure }`: clusters carry `verdict/keepId/mergedCard/reason`;
 * a cluster whose batch fails (stall, parse error, bad ids) keeps
 * `verdict: null` — the UI shows it as UNJUDGED, never as an AI opinion.
 * `failure` is the human-readable reason when judging failed wholesale
 * (no model, every batch dead), null otherwise. Never throws.
 */
async function fcJudgeDuplicateClusters(clusters, cardById, { onProgress } = {}) {
  const modelId = await fcPickModel();
  if (!modelId || !_api?.lm?.sendChatRequest) {
    return {
      clusters: clusters.map((c) => ({ ...c, verdict: null })),
      failure: 'No language model is available. Configure one in AI settings.',
    };
  }
  const { contextSetting, think } = fcAiOptions();
  const modelCtx = await fcModelContextLength(modelId);

  const clusterText = (cluster) => cluster.cardIds.map((id) => {
    const card = cardById.get(id);
    return `CARD ${id}:\nFRONT: ${card?.front ?? ''}\nBACK: ${card?.back ?? ''}`;
  }).join('\n');

  const batches = [];
  let batch = [];
  let batchChars = 0;
  for (const cluster of clusters) {
    const size = clusterText(cluster).length;
    if (batch.length > 0 && (batch.length >= 8 || batchChars + size > 6000)) {
      batches.push(batch); batch = []; batchChars = 0;
    }
    batch.push(cluster);
    batchChars += size;
  }
  if (batch.length > 0) batches.push(batch);

  const out = [];
  let done = 0;
  let lastError = null;
  for (const group of batches) {
    let judged = null;
    try {
      const chars = group.reduce((n, c) => n + clusterText(c).length, 0);
      const { numCtx } = fcContextPlan({ chars, count: group.length, modelCtx, setting: contextSetting });
      const user = group.map((c, i) => `CLUSTER ${i + 1}\n${clusterText(c)}`).join('\n\n---\n\n');
      let output = '';
      const stream = _api.lm.sendChatRequest(modelId, [
        { role: 'system', content: FC_JUDGE_SYSTEM },
        { role: 'user', content: user },
      ], { temperature: 0.2, think, numCtx });
      await fcStreamWithStall(stream, (chunk) => { if (chunk.content) output += chunk.content; });
      const { items } = fcExtractJsonArray(output, (parsed) => parsed
        .filter((v) => v && typeof v === 'object')
        .map((v) => ({
          cluster: Number(v.cluster),
          verdict: ['duplicate', 'overlap', 'distinct'].includes(v.verdict) ? v.verdict : null,
          keepId: Number.isInteger(v.keepId) ? v.keepId : Number(v.keepId) || null,
          mergedCard: v.mergedCard && typeof v.mergedCard === 'object'
            && String(v.mergedCard.front || '').trim() && String(v.mergedCard.back || '').trim()
            ? { front: String(v.mergedCard.front).trim(), back: String(v.mergedCard.back).trim() }
            : null,
          reason: String(v.reason || '').slice(0, 300),
        })));
      // Structural acceptance: one valid verdict per cluster, keepId real.
      if (items.length === group.length) {
        judged = group.map((cluster, i) => {
          const v = items.find((x) => x.cluster === i + 1) || items[i];
          const keepOk = v.keepId != null && cluster.cardIds.includes(v.keepId);
          const valid = v.verdict === 'distinct'
            || (v.verdict === 'duplicate' && keepOk)
            || (v.verdict === 'overlap' && keepOk && v.mergedCard);
          return valid
            ? { ...cluster, verdict: v.verdict, keepId: v.keepId, mergedCard: v.mergedCard, reason: v.reason }
            : { ...cluster, verdict: null };
        });
      }
    } catch (e) {
      // Stall or request failure — clusters stay unjudged, but the REASON
      // must survive to the banner: "unavailable" with no cause left users
      // acting on raw similarity without knowing anything went wrong.
      lastError = e instanceof Error ? e.message : String(e);
    }
    out.push(...(judged || group.map((c) => ({ ...c, verdict: null }))));
    done += group.length;
    try { onProgress?.(done, clusters.length); } catch { /* UI gone */ }
  }
  const anyJudged = out.some((c) => c.verdict !== null);
  return {
    clusters: out,
    failure: anyJudged ? null : (lastError || 'The model returned no usable verdicts.'),
  };
}

const FC_PAIR_JUDGE_SYSTEM = [
  'You judge pairs of flashcards: a NEW card about to be added to a deck, and the EXISTING card it resembles.',
  'The decision test is KNOWLEDGE redundancy, never text similarity: would a student who reliably answers the EXISTING card necessarily be able to answer the NEW one?',
  'CONTRAST TRAP: near-identical wording with DIFFERENT answers (a different variable, method, assumption, sign, or case) is NOT redundancy. Such contrast pairs are deliberately similar and the new card should be kept ("distinct"). Compare the ANSWERS before anything else.',
  'For each numbered pair, decide:',
  '- "duplicate": the new card tests what the existing card already tests; adding it would waste reviews.',
  '- "overlap": they share substance but the new card adds something real.',
  '- "distinct": they only look similar; the new card stands on its own.',
  'Never use em dashes.',
  'Output ONLY a JSON array, one object per pair, echoing the pair number:',
  '[{"pair": 1, "verdict": "distinct", "reason": "..."}]',
].join('\n');

/**
 * Creation-time duplicate arbitration (M101). The embedding scan
 * (fcFindDuplicates) is RECALL only — cosine similarity flags contrast
 * pairs ("what is X under method A" vs "under method B") as duplicates,
 * which made the warning read as noise (user report). This pass shows the
 * judge both cards in full and keeps, downgrades, or clears each flag:
 * "distinct" clears it; other verdicts replace the similarity chip with the
 * verdict + reason. Judge unavailable → flags pass through unchanged, so
 * the similarity-only behavior is the worst case, never the norm.
 * Never throws.
 */
async function fcJudgeGenerationDups(cards, dups) {
  const flagged = [];
  for (let i = 0; i < dups.length; i++) if (dups[i]) flagged.push(i);
  if (flagged.length === 0) return dups;
  try {
    const modelId = await fcPickModel();
    if (!modelId || !_api?.lm?.sendChatRequest) return dups;
    // The scan only carries matchFront; a judgment needs both SIDES of the
    // existing card, so hydrate the backs by id.
    const ids = [...new Set(flagged.map((i) => dups[i].matchId).filter(Boolean))];
    const rows = ids.length
      ? await db.all(`SELECT id, front, back FROM fc_cards WHERE id IN (${ids.map(() => '?').join(',')})`, ids)
      : [];
    const byId = new Map(rows.map((r) => [r.id, r]));
    const { contextSetting, think } = fcAiOptions();
    const modelCtx = await fcModelContextLength(modelId);
    const out = dups.slice();
    const BATCH = 10;
    for (let start = 0; start < flagged.length; start += BATCH) {
      const group = flagged.slice(start, start + BATCH);
      const user = group.map((cardIdx, k) => {
        const c = cards[cardIdx];
        const ex = byId.get(dups[cardIdx].matchId);
        return `PAIR ${k + 1}\nNEW CARD:\nFRONT: ${c.front}\nBACK: ${c.back}\nEXISTING CARD:\nFRONT: ${ex?.front ?? dups[cardIdx].matchFront}\nBACK: ${ex?.back ?? '(unavailable)'}`;
      }).join('\n\n---\n\n');
      const { numCtx } = fcContextPlan({ chars: user.length, count: group.length, modelCtx, setting: contextSetting });
      let output = '';
      const stream = _api.lm.sendChatRequest(modelId, [
        { role: 'system', content: FC_PAIR_JUDGE_SYSTEM },
        { role: 'user', content: user },
      ], { temperature: 0.2, think, numCtx });
      await fcStreamWithStall(stream, (chunk) => { if (chunk.content) output += chunk.content; });
      const { items } = fcExtractJsonArray(output, (parsed) => parsed
        .filter((v) => v && typeof v === 'object')
        .map((v) => ({
          pair: Number(v.pair),
          verdict: ['duplicate', 'overlap', 'distinct'].includes(v.verdict) ? v.verdict : null,
          reason: String(v.reason || '').slice(0, 300),
        })));
      for (let k = 0; k < group.length; k++) {
        const v = items.find((x) => x.pair === k + 1) || items[k];
        if (!v || !v.verdict) continue; // unjudged — similarity flag stands
        const cardIdx = group[k];
        if (v.verdict === 'distinct') {
          out[cardIdx] = null;
        } else {
          out[cardIdx] = { ...out[cardIdx], verdict: v.verdict, reason: v.reason };
        }
      }
    }
    return out;
  } catch (e) {
    console.warn('[Flashcards] generation duplicate judging skipped:', e?.message);
    return dups;
  }
}

const FC_SCORE_SYSTEM = [
  'You rate flashcards for exam preparation criticality on a 1-100 scale:',
  '- 90-100: a method, formula, or procedure the exam tests directly as a workable problem.',
  '- 70-89: an assumption, applicability condition, or input needed to correctly APPLY such a method.',
  '- 40-69: interpretive or comparative nuance (when to prefer one method, what a result means).',
  '- 1-39: background, derivation steps, history, notation trivia.',
  'Rate what the card TESTS, not how it is worded. Give a short reason for each rating.',
  'Never use em dashes.',
  'Output ONLY a JSON array, one object per card, echoing the card id:',
  '[{"id": 123, "importance": 85, "reason": "..."}]',
].join('\n');

/**
 * Retroactively score a deck's unscored cards for exam criticality (M101).
 * Cards created before importance existed (or added manually) sit at 0 and
 * would introduce LAST behind every scored card; this backfills them so the
 * paced queue orders the whole deck. Batched; a failed batch leaves its
 * cards at 0 for the next run. Returns { scored, total }.
 */
async function fcScoreDeckImportance(deckId, { onProgress } = {}) {
  const rows = await db.all(
    "SELECT id, front, back FROM fc_cards WHERE deck_id = ? AND importance = 0 AND suspended = 0",
    [deckId],
  );
  if (rows.length === 0) return { scored: 0, total: 0 };
  const modelId = await fcPickModel();
  if (!modelId || !_api?.lm?.sendChatRequest) {
    throw new Error('No language model available. Configure a model in AI settings.');
  }
  const { contextSetting, think } = fcAiOptions();
  const modelCtx = await fcModelContextLength(modelId);
  let scored = 0;
  const BATCH = 12;
  for (let start = 0; start < rows.length; start += BATCH) {
    const group = rows.slice(start, start + BATCH);
    try {
      const user = group.map((r) => `CARD ${r.id}:\nFRONT: ${r.front}\nBACK: ${r.back}`).join('\n\n---\n\n');
      const { numCtx } = fcContextPlan({ chars: user.length, count: group.length, modelCtx, setting: contextSetting });
      let output = '';
      const stream = _api.lm.sendChatRequest(modelId, [
        { role: 'system', content: FC_SCORE_SYSTEM },
        { role: 'user', content: user },
      ], { temperature: 0.2, think, numCtx });
      await fcStreamWithStall(stream, (chunk) => { if (chunk.content) output += chunk.content; });
      const { items } = fcExtractJsonArray(output, (parsed) => parsed
        .filter((v) => v && typeof v === 'object')
        .map((v) => ({
          id: Number(v.id),
          importance: fcNormalizeImportance(v.importance),
          reason: String(v.reason || '').slice(0, 300),
        })));
      const validIds = new Set(group.map((r) => r.id));
      for (const item of items) {
        if (!validIds.has(item.id) || item.importance === 0) continue;
        await db.run('UPDATE fc_cards SET importance = ?, importance_reason = ? WHERE id = ?',
          [item.importance, item.reason, item.id]);
        scored++;
      }
    } catch (e) {
      console.warn('[Flashcards] importance batch failed (cards stay unscored):', e?.message);
    }
    try { onProgress?.(Math.min(start + BATCH, rows.length), rows.length); } catch { /* UI gone */ }
  }
  if (scored > 0) _emitDataChanged();
  return { scored, total: rows.length };
}

// ── Retrofitting recall modes onto an existing deck (M102) ───────────────────
//
// Generation marks new cards as it makes them, but a deck built before M102 —
// or imported from Anki — is entirely recognition, so the feature would do
// nothing for the cards actually being studied. This is the catch-up pass.
//
// Deliberately user-invoked from the deck menu rather than automatic on
// migration: promoting a card changes what a review COSTS (five seconds
// becomes a minute), and a silent overnight change to that is not a decision
// the app gets to make.

const FC_CLASSIFY_SYSTEM = [
  'You decide how each flashcard should be tested, and write the marking rubric when one is needed.',
  'Decide by asking ONE question — what shape is a correct answer?',
  '- "formula": a formula to write from memory. rubric = ["<the formula in LaTeX>"].',
  '- "list": a set of items to enumerate. rubric = one entry per item.',
  '- "conceptual": WRITING. Any answer the student has to put into their own words — a definition,',
  '  a why, a mechanism, a comparison, an assumption and what it buys, what a result means.',
  '  If a correct answer is a sentence rather than a formula or a list, it is conceptual.',
  '  rubric = the 2-6 claims a correct answer must make. A claim, not a topic:',
  '  "variance is proportional to the prior column", never "variance".',
  '- "recognition": the answer is a bare token — a name, a date, a single number, a term.',
  '  Nothing is composed, so there is nothing to write. No rubric.',
  'When unsure, ask whether the card could be answered correctly in three words.',
  'If not, it is "conceptual". Definitions are conceptual: stating one in your own words is',
  'exactly the skill being tested, and reading one back is the recognition this exists to stop.',
  'Rubric entries may be {"text": "...", "required": false} for supporting detail a complete answer could omit.',
  'Never invent content the card does not already contain.',
  'Output ONLY a JSON array, no prose:',
  '[{"id": 12, "recallMode": "conceptual", "rubric": [{"text": "...", "required": true}]}]',
  'Omit any card you would leave as "recognition".',
].join('\n');

/**
 * Classify a deck's unclassified cards. Returns { promoted, total }.
 *
 * Only touches cards still sitting at the default: `recall_mode` untouched
 * AND no rubric. A card you have already set by hand is never revisited, so
 * running this twice cannot undo your own decisions.
 */
async function fcClassifyDeckRecall(deckId, { onProgress } = {}) {
  const rows = await db.all(
    "SELECT id, front, back FROM fc_cards WHERE deck_id = ? AND recall_mode = 'recognition' AND rubric = '' AND suspended = 0",
    [deckId],
  );
  if (rows.length === 0) return { promoted: 0, total: 0 };
  const modelId = await fcPickModel();
  if (!modelId || !_api?.lm?.sendChatRequest) {
    throw new Error('No language model available. Configure a model in AI settings.');
  }
  const { contextSetting, think } = fcAiOptions();
  const modelCtx = await fcModelContextLength(modelId);
  let promoted = 0;
  // Smaller than importance's 12: every promoted card carries a rubric, so
  // the per-card output is several times larger and a bigger batch is what
  // fills the window mid-array.
  const BATCH = 8;
  for (let start = 0; start < rows.length; start += BATCH) {
    const group = rows.slice(start, start + BATCH);
    try {
      const user = group.map((r) => `CARD ${r.id}:\nFRONT: ${r.front}\nBACK: ${r.back}`).join('\n\n---\n\n');
      const { numCtx } = fcContextPlan({
        chars: user.length, count: group.length, modelCtx, setting: contextSetting, withRubrics: true,
      });
      let output = '';
      const stream = _api.lm.sendChatRequest(modelId, [
        { role: 'system', content: FC_CLASSIFY_SYSTEM },
        { role: 'user', content: user },
      ], { temperature: 0.1, think, numCtx });
      await fcStreamWithStall(stream, (chunk) => { if (chunk.content) output += chunk.content; });
      const { items } = fcExtractJsonArray(output, (parsed) => parsed
        .filter((v) => v && typeof v === 'object')
        .map((v) => ({
          id: Number(v.id),
          recallMode: fcNormalizeRecallMode(v.recallMode ?? v.recall_mode),
          rubric: fcNormalizeRubric(v.rubric ?? v.points),
        })));
      const validIds = new Set(group.map((r) => r.id));
      for (const item of items) {
        // A production mode without a rubric has nothing to mark against,
        // and the model returning an id from another batch means it lost
        // track of which cards it was looking at — neither gets written.
        if (!validIds.has(item.id)) continue;
        if (!fcIsProductionMode(item.recallMode) || !item.rubric.length) continue;
        await db.run('UPDATE fc_cards SET recall_mode = ?, rubric = ? WHERE id = ?',
          [item.recallMode, fcSerializeRubric(item.rubric), item.id]);
        promoted++;
      }
    } catch (e) {
      console.warn('[Flashcards] classify batch failed (cards stay recognition):', e?.message);
    }
    try { onProgress?.(Math.min(start + BATCH, rows.length), rows.length); } catch { /* UI gone */ }
  }
  if (promoted > 0) _emitDataChanged();
  return { promoted, total: rows.length };
}

const FC_COVERAGE_SYSTEM = [
  'You audit how well a flashcard deck covers its source material (user goal: confidence the deck offers a COMPREHENSIVE review, missing nothing).',
  'You receive the material and the deck\'s existing cards. Produce:',
  '1. "report": concise Markdown. Sections: **Covered Well** (topic bullets), **Thin Coverage** (topics with too few or too shallow cards, and why), **Not Covered** (facts, formulas, distinctions in the material with NO card). Ground every claim in the material; never invent topics the material does not contain. Formulas in $LaTeX$. Never use em dashes.',
  '2. "missing": a JSON array of NEW flashcards filling the gaps you found, same card rules as generation: one atomic fact each, front asks, back answers, tags, "importance": 1-100 exam criticality with a short "importanceReason" (90-100 directly-tested method/formula; 70-89 assumption/condition; 40-69 interpretive nuance; 1-39 background), and "page": N / "doc": k when the material carries those markers. Empty array when nothing is missing.',
  'Output ONLY one JSON object: {"report": "...", "missing": [{"front": "...", "back": "...", "tags": ["topic"], "importance": 85, "importanceReason": "..."}]}',
].join('\n');

/**
 * Coverage audit: material + existing cards → { report, missing }. Throws
 * on model absence or unusable output (the view surfaces the message).
 */
async function fcCoverageReview(docs, deckCards, { onChunk } = {}) {
  const modelId = await fcPickModel();
  if (!modelId) throw new Error('No language model available. Configure a model in AI settings.');
  const { contextSetting, think } = fcAiOptions();
  const modelCtx = await fcModelContextLength(modelId);
  const totalChars = docs.reduce((n, d) => n + (Array.isArray(d.pageTexts) && d.pageTexts.length
    ? d.pageTexts.reduce((m, p) => m + String(p || '').length, 0)
    : String(d.text || '').length), 0);
  // Existing cards ride in the prompt too — budget for both.
  const cardsBlock = deckCards.map((c, i) => `${i + 1}. ${c.front} => ${c.back.slice(0, 200)}`).join('\n');
  const { numCtx, maxChars } = fcContextPlan({
    chars: totalChars + cardsBlock.length, count: 20, modelCtx, setting: contextSetting,
  });
  const built = docs.length > 1
    ? fcBuildMaterialDocs(docs, Math.max(4000, maxChars - cardsBlock.length))
    : fcBuildMaterial(docs[0]?.text || '', docs[0]?.pageTexts || null, Math.max(4000, maxChars - cardsBlock.length), 0);
  const user = [
    `THE DECK'S EXISTING CARDS (${deckCards.length}):`,
    cardsBlock || '(the deck is empty)',
    '',
    '--- SOURCE MATERIAL ---',
    built.material,
  ].join('\n');

  let output = '';
  const stream = _api.lm.sendChatRequest(modelId, [
    { role: 'system', content: FC_COVERAGE_SYSTEM },
    { role: 'user', content: user },
  ], { temperature: 0.2, think, numCtx });
  await fcStreamWithStall(stream, (chunk) => {
    if (chunk.content) { output += chunk.content; try { onChunk?.(output); } catch { /* UI gone */ } }
  });

  // The output is ONE object, not an array — locate its braces string-aware.
  let t = output.trim()
    .replace(/<think>[\s\S]*?<\/think>/gi, '')
    .replace(/^[\s\S]*?<\/think>/i, '')
    .replace(/```(?:json)?/gi, '');
  const start = t.indexOf('{');
  if (start === -1) throw new Error('No JSON object in the coverage response.');
  let depth = 0, end = -1, inStr = false, escape = false;
  for (let i = start; i < t.length; i++) {
    const ch = t[i];
    if (escape) { escape = false; continue; }
    if (ch === '\\') { escape = true; continue; }
    if (ch === '"') { inStr = !inStr; continue; }
    if (inStr) continue;
    if (ch === '{') depth++;
    else if (ch === '}') { depth--; if (depth === 0) { end = i; break; } }
  }
  if (end === -1) throw new Error('The coverage response was cut off.');
  let parsed;
  const slice = t.slice(start, end + 1);
  try { parsed = JSON.parse(fcRepairLatexEscapes(slice)); }
  catch { parsed = JSON.parse(slice); }
  const report = String(parsed.report || '').trim();
  if (!report) throw new Error('The coverage response had no report.');
  const { cards: missing } = fcExtractCardsJson(JSON.stringify(parsed.missing || []));
  return { report, missing };
}

async function fcUpdateCard(id, patch) {
  const sets = [];
  const params = [];
  const map = { front: 'front', back: 'back', notes: 'notes', tags: 'tags', deckId: 'deck_id' };
  for (const [k, col] of Object.entries(map)) {
    if (patch[k] !== undefined) { sets.push(`${col} = ?`); params.push(patch[k]); }
  }
  if (patch.suspended !== undefined) { sets.push('suspended = ?'); params.push(patch.suspended ? 1 : 0); }
  if (patch.flag !== undefined) { sets.push('flag = ?'); params.push(fcNormalizeFlag(patch.flag)); }
  if (patch.importance !== undefined) { sets.push('importance = ?'); params.push(fcNormalizeImportance(patch.importance)); }
  if (patch.importanceReason !== undefined) { sets.push('importance_reason = ?'); params.push(String(patch.importanceReason || '').slice(0, 300)); }
  if (patch.recallMode !== undefined) { sets.push('recall_mode = ?'); params.push(fcNormalizeRecallMode(patch.recallMode)); }
  if (patch.rubric !== undefined) { sets.push('rubric = ?'); params.push(fcSerializeRubric(patch.rubric)); }
  if (patch.sourceExcerpt !== undefined) { sets.push('source_excerpt = ?'); params.push(String(patch.sourceExcerpt || '').slice(0, FC_SOURCE_EXCERPT_MAX_CHARS)); }
  if (sets.length === 0) return;
  // M98: text edits on a cloze sibling rewrite the whole group (the text IS
  // the note) — grab identity before the UPDATE.
  const before = (patch.front !== undefined || patch.back !== undefined)
    ? await db.get('SELECT deck_id, card_type, note_group, front, back FROM fc_cards WHERE id = ?', [id])
    : null;
  params.push(id);
  await db.run(`UPDATE fc_cards SET ${sets.join(', ')} WHERE id = ?`, params);
  if (before && before.card_type === 'cloze' && before.note_group) {
    await fcReconcileClozeGroup(
      before.note_group, before.deck_id,
      patch.front !== undefined ? patch.front : before.front,
      patch.back !== undefined ? patch.back : before.back,
      id,
    );
  }
  _emitDataChanged();
  // Text changed → the stored vector is stale; re-embed best-effort.
  if (patch.front !== undefined || patch.back !== undefined) {
    void (async () => {
      try {
        const row = await db.get('SELECT id, front, back FROM fc_cards WHERE id = ?', [id]);
        if (row) await fcEmbedCards([row]);
      } catch { /* best-effort */ }
    })();
  }
}

async function fcDeleteCard(id) {
  await db.run('DELETE FROM fc_cards WHERE id = ?', [id]);
  try { await db.run('DELETE FROM fc_card_embeddings WHERE card_id = ?', [String(id)]); } catch { /* vec absent */ }
  _emitDataChanged();
}

// ── Move / copy across decks (user ask: bulk card moves + deck grouping) ────

/** Expand a card-id set so cloze/reverse NOTE GROUPS always travel whole —
 *  moving one sibling without the rest would orphan the group's edit
 *  reconciliation and study exemptions. */
async function fcExpandNoteGroups(ids) {
  if (ids.length === 0) return [];
  const ph = ids.map(() => '?').join(',');
  const rows = await db.all(
    `SELECT DISTINCT id FROM fc_cards WHERE id IN (${ph})
       OR (note_group != '' AND note_group IN (
         SELECT note_group FROM fc_cards WHERE id IN (${ph}) AND note_group != ''))`,
    [...ids, ...ids],
  );
  return rows.map((r) => Number(r.id));
}

/** MOVE cards into another deck. Scheduling state and review history ride
 *  along untouched (only deck_id changes; embeddings key on card_id). */
async function fcMoveCards(ids, targetDeckId) {
  const all = await fcExpandNoteGroups(ids);
  if (all.length === 0) return 0;
  const ph = all.map(() => '?').join(',');
  await db.run(`UPDATE fc_cards SET deck_id = ? WHERE id IN (${ph})`, [targetDeckId, ...all]);
  _emitDataChanged();
  return all.length;
}

/** COPY cards as fresh content-only clones: state new, no history, cloze
 *  groups cloned whole under a fresh group id. */
async function fcCopyCards(ids, targetDeckId) {
  const all = await fcExpandNoteGroups(ids);
  if (all.length === 0) return 0;
  const ph = all.map(() => '?').join(',');
  const rows = (await db.all(`SELECT * FROM fc_cards WHERE id IN (${ph})`, all)).map(rowToCard);
  const groupMap = new Map();
  const clones = rows.map((c) => {
    let noteGroup = '';
    if (c.noteGroup) {
      if (!groupMap.has(c.noteGroup)) {
        groupMap.set(c.noteGroup, `grp-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`);
      }
      noteGroup = groupMap.get(c.noteGroup);
    }
    return {
      front: c.front, back: c.back, notes: c.notes, tags: c.tags, flag: c.flag,
      sourceUri: c.sourceUri, sourceLabel: c.sourceLabel, sourcePage: c.sourcePage,
      cardType: c.cardType, noteGroup, clozeIndex: c.clozeIndex,
    };
  });
  await fcCreateCardsBulk(targetDeckId, clones, {});
  return clones.length;
}

/** Bulk tag edit: add or remove one tag across many cards (user ask:
 *  editing existing tags without opening each card). */
async function fcBulkTag(ids, tag, remove = false) {
  const clean = String(tag || '').trim().replace(/^#/, '');
  if (!clean || ids.length === 0) return 0;
  const ph = ids.map(() => '?').join(',');
  const rows = await db.all(`SELECT id, tags FROM fc_cards WHERE id IN (${ph})`, ids);
  let changed = 0;
  for (const row of rows) {
    const tags = new Set(fcParseTags(row.tags));
    const had = tags.has(clean);
    if (remove) tags.delete(clean); else tags.add(clean);
    if (had === tags.has(clean)) continue;
    await db.run('UPDATE fc_cards SET tags = ? WHERE id = ?', [[...tags].join(','), row.id]);
    changed++;
  }
  if (changed > 0) _emitDataChanged();
  return changed;
}

/** Set (or clear, with flag 0) the flag on many cards at once. One statement:
 *  unlike tags there is nothing per-row to merge. Returns rows written. */
async function fcBulkFlag(ids, flag) {
  if (ids.length === 0) return 0;
  const value = fcNormalizeFlag(flag);
  const ph = ids.map(() => '?').join(',');
  await db.run(`UPDATE fc_cards SET flag = ? WHERE id IN (${ph})`, [value, ...ids]);
  _emitDataChanged();
  return ids.length;
}

/** Quick-pick a destination deck (or create one). Returns a deck id or null. */
async function fcPickDeckTarget(excludeDeckId, placeholder) {
  const decks = (await fcListDecks()).filter((d) => d.id !== excludeDeckId);
  const NEW_DECK = '+ New Deck…';
  const pick = await _api.window.showQuickPick(
    [...decks.map((d) => ({ label: d.name, description: `${d.total} cards` })), { label: NEW_DECK }],
    { placeholder },
  );
  if (!pick) return null;
  if (pick.label === NEW_DECK) {
    const name = await _api.window.showInputBox({ prompt: 'New deck name' });
    if (!name?.trim()) return null;
    return fcCreateDeck(name);
  }
  const match = decks.find((d) => d.name === pick.label);
  return match ? match.id : null;
}

/** Deck grouping: move EVERY card of one deck into another (or a new one).
 *  Repeatable across decks to combine several into a single deck. */
async function _mergeDeckFlow(deck) {
  const rows = await db.all('SELECT id FROM fc_cards WHERE deck_id = ?', [deck.id]);
  if (rows.length === 0) {
    void _api.window.showInformationMessage(`"${deck.name}" has no cards to move.`);
    return;
  }
  const targetId = await fcPickDeckTarget(deck.id, `Move all ${rows.length} cards from "${deck.name}" into…`);
  if (targetId == null) return;
  const pick = await _api.window.showWarningMessage(
    `Move all ${rows.length} cards from "${deck.name}" into the selected deck? Scheduling history is kept; "${deck.name}" stays behind empty.`,
    { title: 'Move Cards' }, { title: 'Cancel' },
  );
  if (pick?.title !== 'Move Cards') return;
  const moved = await fcMoveCards(rows.map((r) => Number(r.id)), targetId);
  void _api.window.showInformationMessage(`Moved ${moved} cards.`);
}

async function fcGetCard(id) {
  const row = await db.get('SELECT * FROM fc_cards WHERE id = ?', [id]);
  return row ? rowToCard(row) : null;
}

async function fcListCards(deckId, search = '') {
  let rows;
  if (search.trim()) {
    const like = `%${search.trim()}%`;
    rows = await db.all(
      'SELECT * FROM fc_cards WHERE deck_id = ? AND (front LIKE ? OR back LIKE ? OR tags LIKE ?) ORDER BY created_at DESC',
      [deckId, like, like, like],
    );
  } else {
    rows = await db.all('SELECT * FROM fc_cards WHERE deck_id = ? ORDER BY created_at DESC', [deckId]);
  }
  return rows.map(rowToCard);
}

async function fcListAllCards(deckId = null) {
  const rows = deckId
    ? await db.all('SELECT * FROM fc_cards WHERE deck_id = ?', [deckId])
    : await db.all('SELECT * FROM fc_cards');
  return rows.map(rowToCard);
}

/** Apply a grading: schedule + persist + log. Returns the updated card. */
/**
 * Revert one grade: restore the card's pre-grade scheduling columns and
 * delete the review row it wrote. The review LOG must stay truthful — FSRS
 * healing replays it, so an undone grade cannot leave a phantom row.
 */
async function fcUndoGrade(cardBefore, reviewedAt) {
  await db.run(`
    UPDATE fc_cards SET state = ?, ease = ?, interval_days = ?, due_at = ?,
      reps = ?, lapses = ?, learning_step = ?,
      stability = ?, difficulty = ?, last_reviewed_at = ?
    WHERE id = ?
  `, [cardBefore.state, cardBefore.ease, cardBefore.intervalDays, cardBefore.dueAt,
    cardBefore.reps, cardBefore.lapses, cardBefore.learningStep,
    cardBefore.stability, cardBefore.difficulty, cardBefore.lastReviewedAt || 0, cardBefore.id]);
  if (reviewedAt) {
    await db.run('DELETE FROM fc_reviews WHERE card_id = ? AND reviewed_at = ?', [cardBefore.id, reviewedAt]);
  }
  _emitDataChanged();
}

/**
 * Apply a grading: schedule + persist + log.
 *
 * `answer` / `verdict` (M102) are the production-recall record — what was
 * typed and what the grader made of it. They ride on the review row rather
 * than the card because they are history: fc_reviews is append-only and
 * fcHealFsrsState replays it, so a card's answers accumulate instead of
 * overwriting. Recognition cards pass neither and store empty strings.
 */
async function fcGradeCard(card, rating, msTaken = 0, deckOpts = {}, { answer = '', verdict = null } = {}) {
  const now = Date.now();
  const next = fcScheduleFsrs(card, rating, now, deckOpts);
  await db.run(`
    UPDATE fc_cards SET state = ?, ease = ?, interval_days = ?, due_at = ?,
      reps = ?, lapses = ?, learning_step = ?,
      stability = ?, difficulty = ?, last_reviewed_at = ?
    WHERE id = ?
  `, [next.state, next.ease, next.intervalDays, next.dueAt, next.reps, next.lapses, next.learningStep,
    next.stability, next.difficulty, next.lastReviewedAt, card.id]);
  await db.run(`
    INSERT INTO fc_reviews (card_id, reviewed_at, rating, interval_before, interval_after,
      ease_before, ease_after, state_before, state_after, ms_taken, answer_text, verdict)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
  `, [card.id, now, rating, card.intervalDays, next.intervalDays, card.ease, next.ease, card.state, next.state, msTaken,
    String(answer || ''), verdict ? JSON.stringify(verdict) : '']);
  _emitDataChanged();
  return { ...card, ...next };
}

/**
 * One-shot SM-2 → FSRS state derivation (M98). Cards scheduled before the
 * FSRS migration have reps but no stability; replay each one's append-only
 * fc_reviews history through FSRS-6 to derive honest S/D. The visible
 * schedule (state/interval/due) is left untouched — FSRS takes over from
 * the next grade. Cards with reps but no review rows (pre-history data)
 * get a conservative estimate: S ≈ current interval (true at retention 0.9),
 * D from ease linearly. Idempotent: the WHERE clause empties after one run.
 */
async function fcHealFsrsState() {
  const rows = await db.all('SELECT id FROM fc_cards WHERE reps > 0 AND stability = 0');
  if (!rows.length) return 0;
  for (const { id } of rows) {
    const reviews = await db.all(
      'SELECT reviewed_at AS reviewedAt, rating FROM fc_reviews WHERE card_id = ? ORDER BY reviewed_at ASC',
      [id],
    );
    let derived;
    if (reviews.length) {
      derived = fcReplayFsrs(reviews);
    } else {
      const card = rowToCard(await db.get('SELECT * FROM fc_cards WHERE id = ?', [id]));
      derived = {
        stability: Math.max(FSRS_S_MIN, card.intervalDays || FSRS_W[GOOD - 1]),
        difficulty: Math.min(10, Math.max(1, 11 - 2 * (card.ease || 2.5))),
        lastReviewedAt: Math.max(0, (card.dueAt || 0) - (card.intervalDays || 0) * DAY),
      };
    }
    await db.run(
      'UPDATE fc_cards SET stability = ?, difficulty = ?, last_reviewed_at = ? WHERE id = ?',
      [derived.stability, derived.difficulty, derived.lastReviewedAt, id],
    );
  }
  return rows.length;
}

/**
 * Written answers for one card, newest first (M102).
 *
 * Only reviews that actually carry an answer — a card promoted to a
 * production mode partway through its life has recognition reviews behind
 * it, and listing those as blank answers would read as failures.
 */
async function fcCardAnswerHistory(cardId, limit = 20) {
  const rows = await db.all(`
    SELECT reviewed_at AS reviewedAt, rating, answer_text AS answerText, verdict
    FROM fc_reviews
    WHERE card_id = ? AND answer_text != ''
    ORDER BY reviewed_at DESC
    LIMIT ?
  `, [cardId, Math.max(1, limit)]);
  return rows.map((r) => {
    let verdict = null;
    try { verdict = r.verdict ? JSON.parse(r.verdict) : null; } catch { verdict = null; }
    return { reviewedAt: r.reviewedAt, rating: r.rating, answerText: r.answerText, verdict };
  });
}

async function fcDueSummary() {
  const now = Date.now();
  const row = await db.get(`
    SELECT
      SUM(CASE WHEN suspended = 0 AND state != 'new' AND due_at <= ? THEN 1 ELSE 0 END) AS due,
      SUM(CASE WHEN suspended = 0 AND state = 'new' THEN 1 ELSE 0 END) AS fresh,
      COUNT(*) AS total
    FROM fc_cards
  `, [now]);
  return { due: row?.due || 0, fresh: row?.fresh || 0, total: row?.total || 0 };
}

async function fcLoadStats() {
  const now = Date.now();
  const reviews = (await db.all(
    'SELECT reviewed_at, rating, state_before, ms_taken FROM fc_reviews WHERE reviewed_at >= ?',
    [now - 31 * DAY],
  )).map((r) => ({ reviewedAt: r.reviewed_at, rating: r.rating, stateBefore: r.state_before, msTaken: r.ms_taken || 0 }));
  const cards = (await db.all('SELECT state, suspended, due_at, deck_id, stability FROM fc_cards'))
    .map((r) => ({ state: r.state, suspended: !!r.suspended, dueAt: r.due_at || 0, deckId: r.deck_id, stability: r.stability || 0 }));
  const stats = fcAggregateStats(reviews, cards, now);

  // Per-deck rollup: where the cards live, what is waiting, how settled the
  // memory is (mean FSRS stability of the cards that have one).
  const deckRows = await db.all('SELECT id, name FROM fc_decks WHERE archived = 0 ORDER BY name');
  stats.perDeck = deckRows.map((d) => {
    const dc = cards.filter((c) => c.deckId === d.id);
    const active = dc.filter((c) => !c.suspended);
    const withStability = active.filter((c) => c.stability > 0);
    return {
      name: d.name,
      total: dc.length,
      due: active.filter((c) => c.state !== 'new' && c.dueAt > 0 && c.dueAt <= now).length,
      fresh: active.filter((c) => c.state === 'new').length,
      avgStability: withStability.length
        ? withStability.reduce((n, c) => n + c.stability, 0) / withStability.length
        : 0,
    };
  }).filter((d) => d.total > 0);

  stats.streak = await fcStudyStreak();
  return stats;
}

/**
 * Per-day SCHEDULED review counts for [fromMs, toMs) — the planner badge +
 * widget forecast (M98). Honest minimum, not a promise: FSRS reshuffles the
 * future after every review, and unscheduled new cards aren't included.
 * Overdue cards roll into today (that is when they will actually be seen).
 */
async function fcDayLoadForecast(fromMs, toMs) {
  const rows = await db.all(
    "SELECT due_at FROM fc_cards WHERE suspended = 0 AND state != 'new' AND due_at > 0 AND due_at < ?",
    [toMs],
  );
  const todayStart = new Date(); todayStart.setHours(0, 0, 0, 0);
  const todayMs = todayStart.getTime();
  const byDay = new Map();
  for (const { due_at } of rows) {
    const d = new Date(Math.max(due_at, todayMs));
    d.setHours(0, 0, 0, 0);
    const key = d.getTime();
    if (key < fromMs - DAY || key >= toMs) continue;
    byDay.set(key, (byDay.get(key) || 0) + 1);
  }
  return [...byDay.entries()]
    .map(([dayStartMs, count]) => ({ dayStartMs, count, label: 'flashcards' }))
    .sort((a, b) => a.dayStartMs - b.dayStartMs);
}

/**
 * Study streak: consecutive local days with at least one review, counting
 * back from today (a still-unreviewed today doesn't break it — yesterday
 * anchors the chain until midnight).
 */
async function fcStudyStreak() {
  const rows = await db.all(
    'SELECT DISTINCT reviewed_at FROM fc_reviews WHERE reviewed_at >= ? ORDER BY reviewed_at DESC',
    [Date.now() - 400 * DAY],
  );
  const days = new Set();
  for (const { reviewed_at } of rows) {
    const d = new Date(reviewed_at); d.setHours(0, 0, 0, 0);
    days.add(d.getTime());
  }
  const today = new Date(); today.setHours(0, 0, 0, 0);
  let cursor = today.getTime();
  if (!days.has(cursor)) cursor -= DAY; // today not studied yet — start at yesterday
  let streak = 0;
  while (days.has(cursor)) { streak++; cursor -= DAY; }
  return streak;
}

// ═══════════════════════════════════════════════════════════════════════════════
// SECTION 5: AI LAYER
// ═══════════════════════════════════════════════════════════════════════════════

async function fcPickModel() {
  const configured = String(cfg('aiModel', '') || '').trim();
  if (configured) return configured;
  try {
    const active = _api.lm && typeof _api.lm.getActiveModel === 'function'
      ? _api.lm.getActiveModel()
      : undefined;
    if (active) return active;
  } catch { /* noop */ }
  try {
    const models = await _api.lm.getModels();
    if (models && models.length > 0) return models[0].id;
  } catch { /* noop */ }
  return null;
}

const FC_GENERATE_SYSTEM = [
  'You create high-quality spaced-repetition flashcards from study material.',
  'Rules:',
  '- Each card tests ONE atomic fact or concept (minimum information principle).',
  '- Front: a precise question. Back: the shortest complete answer.',
  '- Prefer "why/how/when/compare" questions over pure definitions where the material supports it.',
  '- Never invent facts that are not in the material.',
  '- EXCEPTION for garbled math: PDF text extraction mangles formulas (lost',
  '  superscripts and subscripts, broken Greek letters, flattened fractions).',
  '  When the material clearly names or describes a formula but its extracted',
  '  text is corrupted, reconstruct the formula in its standard form in clean',
  '  LaTeX instead of copying the garble or skipping it. Repairing a known',
  '  formula\'s transcription is not inventing a fact.',
  'Exam criticality: rate every card "importance" 1-100 for exam preparation, with a short "importanceReason":',
  '- 90-100: a method, formula, or procedure the exam tests directly as a workable problem.',
  '- 70-89: an assumption, applicability condition, or input needed to correctly APPLY such a method.',
  '- 40-69: interpretive or comparative nuance (when to prefer one method, what a result means).',
  '- 1-39: background, derivation steps, history, notation trivia.',
  'Formatting (cards render Markdown + KaTeX):',
  '- Write EVERY formula and symbol in LaTeX between $...$ (or $$...$$ for a display equation).',
  '- Use **bold** for the key term, and bullet lists when the answer enumerates items.',
  '- Never use em dashes.',
  'Output ONLY a JSON array, no prose, in this exact shape:',
  '[{"front": "...", "back": "...", "tags": ["topic"], "importance": 85, "importanceReason": "..."}]',
  'When the material carries [Page N] markers, add "page": N to each card; when it carries [Doc k] markers, also add "doc": k.',
].join('\n');

/**
 * Appended when production recall is on (M102). Kept as a separate block so
 * the base prompt above stays exactly what it was when the feature is off —
 * a model asked for fields it then never uses is a model spending output
 * tokens on nothing.
 */
const FC_GENERATE_RECALL_RULES = [
  '',
  'Recall mode: add "recallMode" to every card, naming what the student should have to PRODUCE from memory.',
  'Decide it by asking ONE question — what shape is a correct answer?',
  '- "formula": a formula. Add "rubric": ["<the formula in LaTeX>"].',
  '- "list": a set of items to enumerate. Add "rubric" listing the items, one entry each.',
  '- "conceptual": WRITING. Any answer a student has to put into their own words — a definition,',
  '  a why, a mechanism, a comparison, an assumption and what it buys, what a result means.',
  '  If a correct answer is a sentence rather than a formula or a list, it is conceptual.',
  '  Add "rubric": the 2-6 claims a correct answer must make. A claim, not a topic:',
  '  "variance is proportional to the prior column", never "variance".',
  '- "recognition": the answer is a bare token — a name, a date, a single number, a term.',
  '  Nothing is composed, so there is nothing to write. No rubric.',
  'Rubric entries may be {"text": "...", "required": false} to mark supporting detail a complete answer could omit.',
  'When unsure, ask whether you could answer it correctly in three words. If not, it is conceptual, NOT recognition.',
  'Definitions are conceptual: stating one in your own words is exactly the skill being tested.',
].join('\n');

/**
 * Density levels for AUTO card count (M101). A truncation cap ("stop at N")
 * would amputate coverage mid-chapter; these instead shape SELECTIVITY while
 * the model plans across the whole material — every core concept still gets
 * a card, the low-importance tail gets consolidated or skipped.
 */
const FC_DENSITY_LEVELS = {
  thorough: 'Create one flashcard per atomic fact the material supports: as many as it warrants, up to 50. '
    + 'Do not pad thin material with near-duplicate cards, and do not stop early on rich material.',
  balanced: 'Create flashcards covering EVERY core concept, formula, method, and key assumption in the material, up to 50. '
    + 'Be selective about the rest: consolidate minor details into the nearest core card instead of making separate cards for them, '
    + 'and skip trivia no exam would test. Never skip a core concept to save cards.',
  lean: 'Create flashcards ONLY for what a student must master for an exam: methods, formulas, key assumptions, and central results, up to 50. '
    + 'One card each. Skip background, derivations, and peripheral detail entirely. Never skip a core method or formula.',
};

function fcGenerationDensity() {
  const v = String(cfg('generationDensity', 'balanced'));
  return FC_DENSITY_LEVELS[v] ? v : 'balanced';
}

/** M102: whether generation marks recall modes and writes rubrics. */
function fcProductionRecallEnabled() {
  return cfg('productionRecall', true) !== false;
}

/**
 * Per-session cap on cards that need a typed answer. 0 disables the cap.
 * Separate from the review batch because a typed answer costs 30-60s against
 * roughly 5s for a recognition card, so one shared allowance would let a
 * handful of production cards consume a whole session's time budget.
 */
function fcProductionDailyLimit() {
  const n = Number(cfg('productionDailyLimit', 12));
  return Number.isFinite(n) && n > 0 ? Math.floor(n) : 0;
}

// Context planning constants. CHARS_PER_TOKEN is the safe planning ratio,
// not the prose average (~3.5-4): formula-dense PDF extraction measured
// 2.44 on a real actuarial paper (38,263 chars -> 15,709 tokens), and
// under-estimating chars/token overflows the window, which hard-truncates
// the model's output mid-JSON. Prose just gets extra headroom.
const FC_CHARS_PER_TOKEN = 2.5;
/**
 * Headroom multiplier on the prompt estimate. 2.5 is an average; the 2.44
 * measured on real material means the estimate runs ~2.5% short, and that
 * error grows linearly with size: a 143K-char four-source run planned
 * ~1,400 tokens under, ate the entire 2048-rounding slack, and the window
 * filled mid-JSON ("Unterminated JSON array", 2026-08-18). 8% keeps the
 * plan honest at exactly the sizes where a rerun costs the most.
 */
const FC_PROMPT_HEADROOM = 1.08;
/** System prompt + user wrapper + chat template, in tokens. */
const FC_SCAFFOLD_TOKENS = 600;
/**
 * Output reserve: base + per-card. M101 added "importance" and
 * "importanceReason" to every generated card's JSON; the old 220/card
 * budget predated them and under-reserved a 50-card run by ~2K tokens.
 */
const FC_OUTPUT_BASE_TOKENS = 1500;
const FC_OUTPUT_TOKENS_PER_CARD = 280;
/**
 * Extra output reserve per card when generation also emits a recall mode and
 * a rubric (M102). A rubric is 2-6 claims at roughly 15 tokens each plus the
 * JSON scaffolding around them, and `recallMode` adds a short string.
 *
 * Reserved separately rather than folded into the 280 because most of the
 * cost is conditional: a run with production recall off must not pay for
 * headroom it will never emit into, since the reserve is subtracted from
 * the material clip limit and would silently shrink coverage. This is the
 * same failure the 280 itself was raised to fix in M101 — under-reserving
 * fills the window mid-array and the response is cut off.
 */
const FC_OUTPUT_TOKENS_PER_RUBRIC = 140;
/** When the model's context length is unknown (probe failed), assume this
 *  ceiling rather than clipping against a guess. Ollama clamps num_ctx to
 *  the model's real maximum server-side. */
const FC_FALLBACK_MODEL_CTX = 131072;

/**
 * Plan the context window for one generation run. Pure — exported via
 * __testables.
 *
 * The window must hold prompt AND output: Ollama counts generated tokens
 * against num_ctx and hard-stops mid-token when it fills (`truncated = 1`
 * in the server log), which surfaces as cut-off JSON. So the plan is
 * need-based: estimate prompt tokens, reserve output tokens scaled by the
 * card count, request exactly that (rounded up), and clamp to the model's
 * real context length. Requesting the model max instead would force Ollama
 * to allocate a huge KV cache even for tiny notes.
 *
 * `setting` > 0 is the user's explicit `flashcards.generationContext`
 * override (VRAM-starved machines); 0 = auto. `maxChars` is the material
 * clip limit for the chosen window — in auto mode it only bites when even
 * the model's maximum window can't hold document + output.
 */
function fcContextPlan({ chars, count = 15, modelCtx = 0, setting = 0, withRubrics = false } = {}) {
  const nCards = Math.min(50, Math.max(1, Number(count) || 15));
  const perCard = FC_OUTPUT_TOKENS_PER_CARD + (withRubrics ? FC_OUTPUT_TOKENS_PER_RUBRIC : 0);
  const outputTokens = FC_OUTPUT_BASE_TOKENS + perCard * nCards;
  const ceiling = modelCtx > 0 ? modelCtx : FC_FALLBACK_MODEL_CTX;
  let numCtx;
  if (Number.isFinite(setting) && setting > 0) {
    numCtx = Math.min(setting, ceiling);
  } else {
    const neededTokens = Math.ceil(((Number(chars) || 0) / FC_CHARS_PER_TOKEN) * FC_PROMPT_HEADROOM)
      + FC_SCAFFOLD_TOKENS + outputTokens;
    numCtx = Math.min(ceiling, Math.max(8192, Math.ceil(neededTokens / 2048) * 2048));
  }
  // The clip limit divides the headroom back out, so material admitted under
  // the limit still fits after the estimate's worst-case error.
  const maxChars = Math.max(
    4000,
    Math.floor(((numCtx - FC_SCAFFOLD_TOKENS - outputTokens) * FC_CHARS_PER_TOKEN) / FC_PROMPT_HEADROOM),
  );
  return { numCtx, maxChars, outputTokens };
}

/** The user's AI knobs (Settings → Flashcards). An explicit num_ctx is
 *  always sent with the request: without one Ollama falls back to ITS
 *  default (often 4096) and silently truncates the prompt FROM THE TOP —
 *  the system prompt with the JSON rules dies first and the model returns
 *  prose instead of cards. contextSetting 0 = auto-size per request. */
function fcAiOptions() {
  return {
    contextSetting: Number(cfg('generationContext', 0)) || 0,
    think: !!cfg('aiThinking', false),
  };
}

/** The model's real context length, or 0 when the probe fails. */
async function fcModelContextLength(modelId) {
  try {
    if (_api.lm && typeof _api.lm.getModelInfo === 'function') {
      const info = await _api.lm.getModelInfo(modelId);
      return (info && info.contextLength) || 0;
    }
  } catch { /* fall through */ }
  return 0;
}

/**
 * Planning estimate for "Auto" card count: the right number of cards is a
 * property of the material, so size the OUTPUT RESERVE from its length and
 * let the model land wherever the facts are. Roughly one atomic fact per
 * 500 characters of study prose, clamped to a sane band. This number never
 * reaches the prompt — it only budgets tokens.
 */
function fcAutoCardEstimate(chars) {
  return Math.max(10, Math.min(50, Math.round(chars / 500)));
}

/**
 * Consume an LM stream with a stall watchdog (M98). The extension-facing LM
 * API has no AbortSignal and no timeout, so a hung Ollama socket previously
 * left every "Generating…" spinner alive forever. This wrapper re-arms a
 * timer per chunk and throws once no chunk arrives for `stallMs`. It cannot
 * abort the underlying request (no signal to abort with) — it abandons the
 * iterator, which is enough to unwedge the UI.
 */
async function fcStreamWithStall(stream, onChunk, stallMs = 90_000, firstChunkMs = 240_000) {
  const it = stream[Symbol.asyncIterator]();
  let sawChunk = false;
  for (;;) {
    // The FIRST chunk gets a longer leash: cold-loading a 17-20GB model
    // behind a busy GPU takes minutes, and declaring a stall during the load
    // is what made the duplicate judge read "unavailable" on healthy decks.
    const limit = sawChunk ? stallMs : Math.max(stallMs, firstChunkMs);
    let timer;
    const stall = new Promise((_, reject) => {
      timer = setTimeout(() => reject(new Error(
        `The model stopped responding (no output for ${Math.round(limit / 1000)}s). ` +
        'Check that the model backend is running.',
      )), limit);
    });
    // Keep a handle on the pending next() so a stall doesn't orphan it into
    // an unhandled rejection, and close the generator so its cleanup runs.
    const next = it.next();
    next.catch(() => { /* orphaned after a stall; already surfaced */ });
    let step;
    try {
      step = await Promise.race([next, stall]);
    } catch (err) {
      try { void it.return?.(); } catch { /* generator already closed */ }
      throw err;
    } finally {
      clearTimeout(timer);
    }
    if (step.done) return;
    sawChunk = true;
    onChunk(step.value);
  }
}

/**
 * Build the prompt material block (M98 grounding). With per-page text
 * available (PDF extraction), pages are individually tagged so the model can
 * attribute each card to the page its fact came from — flattening the pages
 * first (the pre-M98 behavior) makes any page attribution a hallucination.
 * Clipping keeps whole pages where possible so a marker never lies.
 */
function fcBuildMaterial(sourceText, pageTexts, maxChars, pageOffset = 0) {
  if (!Array.isArray(pageTexts) || pageTexts.length === 0) {
    const clipped = sourceText.length > maxChars
      ? sourceText.slice(0, maxChars) + '\n\n[...material truncated...]'
      : sourceText;
    return { material: clipped, paged: false, clipped: sourceText.length > maxChars };
  }
  const parts = [];
  let used = 0;
  let clipped = false;
  for (let i = 0; i < pageTexts.length; i++) {
    const text = String(pageTexts[i] || '').trim();
    if (!text) continue;
    const block = `[Page ${pageOffset + i + 1}]\n${text}`;
    if (used + block.length > maxChars) {
      const room = maxChars - used;
      // Keep a partial page only when meaningful; a marker with no body lies.
      if (room > 200) parts.push(block.slice(0, room) + '\n[...page truncated...]');
      clipped = true;
      break;
    }
    parts.push(block);
    used += block.length + 2;
  }
  if (clipped) parts.push('[...material truncated...]');
  return { material: parts.join('\n\n'), paged: true, clipped };
}

/**
 * Multi-document material (user ask: "add several documents so the AI can
 * get a comprehensive view of all the available content"). Each doc gets a
 * [Doc k: label] header; page markers restart PER DOC (they map straight to
 * source_page for that doc's PDF reveal). Whole-doc/whole-page clipping with
 * the same truncation markers as fcBuildMaterial.
 */
function fcBuildMaterialDocs(docs, maxChars) {
  const parts = [];
  let used = 0;
  let clipped = false;
  let anyPaged = false;
  for (let k = 0; k < docs.length; k++) {
    const doc = docs[k];
    const header = `[Doc ${k + 1}: ${String(doc.label || `Document ${k + 1}`).slice(0, 80)}]`;
    const room = maxChars - used - header.length - 2;
    // A doc squeezed below a meaningful body would keep a marker the model
    // could attribute cards to while seeing almost none of it — the same
    // "a marker with no body lies" rule as page clipping. Drop it whole.
    if (room < 200) { clipped = true; break; }
    const paged = Array.isArray(doc.pageTexts) && doc.pageTexts.length > 0;
    const inner = paged
      ? fcBuildMaterial('', doc.pageTexts, room, 0)
      : fcBuildMaterial(String(doc.text || ''), null, room, 0);
    if (paged) anyPaged = true;
    if (inner.clipped) clipped = true;
    if (!inner.material.trim()) { clipped = true; break; }
    parts.push(`${header}\n${inner.material}`);
    used += header.length + inner.material.length + 4;
  }
  if (clipped && parts.length < docs.length) parts.push('[...material truncated...]');
  return { material: parts.join('\n\n'), anyPaged, clipped, docCount: docs.length };
}

async function fcGenerateCards(sourceText, { count = null, focus = '', pageTexts = null, pageOffset = 0, docs = null } = {}) {
  const modelId = await fcPickModel();
  if (!modelId) throw new Error('No language model available. Configure a model in AI settings.');
  const { contextSetting, think } = fcAiOptions();
  const modelCtx = await fcModelContextLength(modelId);
  const multiDoc = Array.isArray(docs) && docs.length > 1;
  const totalChars = multiDoc
    ? docs.reduce((n, d) => n + (Array.isArray(d.pageTexts) && d.pageTexts.length
        ? d.pageTexts.reduce((m, p) => m + String(p || '').length, 0)
        : String(d.text || '').length), 0)
    : (Array.isArray(pageTexts) && pageTexts.length
      ? pageTexts.reduce((n, p) => n + String(p || '').length, 0)
      : sourceText.length);
  const planCount = count ?? fcAutoCardEstimate(totalChars);
  const withRubrics = fcProductionRecallEnabled();
  const { numCtx, maxChars } = fcContextPlan({
    chars: totalChars, count: planCount, modelCtx, setting: contextSetting, withRubrics,
  });
  const built = multiDoc
    ? fcBuildMaterialDocs(docs, maxChars)
    : fcBuildMaterial(sourceText, pageTexts, maxChars, pageOffset);
  const { material, clipped } = built;
  const paged = multiDoc ? built.anyPaged : built.paged;
  if (clipped) {
    console.warn(`[Flashcards] material clipped to ${maxChars} chars to fit a ${numCtx}-token window (model: ${modelId}${modelCtx ? `, max ${modelCtx}` : ', context length unknown'})`);
  }
  const user = [
    // Explicit count = a ceiling the user chose. Auto = the material decides,
    // shaped by the density level: a raw number here would only anchor the
    // model into padding thin material or truncating rich material at an
    // arbitrary line, so density steers selectivity instead (M101).
    count
      ? `Create up to ${Math.min(50, Math.max(1, count))} flashcards from the material below.`
      : FC_DENSITY_LEVELS[fcGenerationDensity()],
    multiDoc
      ? 'The material contains MULTIPLE source documents tagged [Doc k: name]. The documents overlap: treat them as one body of content and create ONE card per fact, never one per document. Add "doc": k to every card naming the document its fact comes from.'
        + (paged ? ' Page markers [Page N] restart inside each document; when the fact\'s document is paged, also add "page": N (the page within that document).' : '')
        + ' Never invent a doc or page number that has no marker.'
      : paged
        ? 'The material is tagged with [Page N] markers. Add "page": N to each card, naming the page its fact comes from. Never invent a page number that has no marker.'
        : '',
    focus ? `Guidance from the learner (follow it): ${focus}` : '',
    '',
    '--- MATERIAL ---',
    material,
  ].filter(Boolean).join('\n');

  let output = '';
  const stream = _api.lm.sendChatRequest(modelId, [
    { role: 'system', content: withRubrics ? FC_GENERATE_SYSTEM + FC_GENERATE_RECALL_RULES : FC_GENERATE_SYSTEM },
    { role: 'user', content: user },
  ], { temperature: 0.2, think, numCtx });
  await fcStreamWithStall(stream, (chunk) => {
    if (chunk.content) output += chunk.content;
  });
  const { cards, error, truncated } = fcExtractCardsJson(output);
  if (error && cards.length === 0) {
    console.warn('[Flashcards] generation failed. Raw model output head:', output.slice(0, 400));
    throw new Error(`${error} (model: ${modelId}; raw output logged to console)`);
  }
  if (truncated) {
    console.warn(`[Flashcards] response truncated by the context window — salvaged ${cards.length} complete card(s) (model: ${modelId}, numCtx: ${numCtx})`);
  }
  if (multiDoc) {
    // Attribution hygiene, per doc: a doc index must exist; a page must
    // exist within ITS doc's page range.
    for (const c of cards) {
      if (!(Number.isInteger(c.doc) && c.doc >= 1 && c.doc <= docs.length)) { delete c.doc; delete c.page; continue; }
      const dp = docs[c.doc - 1].pageTexts;
      if (!(Array.isArray(dp) && Number.isInteger(c.page) && c.page >= 1 && c.page <= dp.length)) delete c.page;
    }
  } else if (paged) {
    // Attribution hygiene: only pages that actually exist in the material.
    const maxPage = pageOffset + pageTexts.length;
    for (const c of cards) {
      delete c.doc;
      if (!(Number.isInteger(c.page) && c.page >= pageOffset + 1 && c.page <= maxPage)) delete c.page;
    }
  } else {
    for (const c of cards) { delete c.page; delete c.doc; }
  }
  // M102: freeze the passage each production card was made from.
  //
  // Captured here because generation is the only moment the page text is
  // already in memory. Reading it back at review time would mean
  // extractText() on the WHOLE document to grade one card, and the source
  // could have moved or been edited by then — the card would silently start
  // being marked against different words than it was written from.
  //
  // Production cards only: a recognition card never grades against it, so
  // storing one would be dead weight on every row.
  if (withRubrics) {
    for (const c of cards) {
      if (!fcIsProductionMode(c.recallMode)) continue;
      const pages = multiDoc
        ? (Number.isInteger(c.doc) ? docs[c.doc - 1]?.pageTexts : null)
        : pageTexts;
      const idx = multiDoc
        ? (Number.isInteger(c.page) ? c.page - 1 : -1)
        : (Number.isInteger(c.page) ? c.page - pageOffset - 1 : -1);
      const page = Array.isArray(pages) && idx >= 0 ? pages[idx] : null;
      // Unpaged single-source material is short enough that the whole of it
      // IS the passage; anything longer always carries page markers.
      const text = page != null ? String(page)
        : (!multiDoc && !paged) ? String(sourceText || '') : '';
      if (text.trim()) c.sourceExcerpt = text.slice(0, FC_SOURCE_EXCERPT_MAX_CHARS);
    }
  }
  return { cards, truncated: !!truncated };
}


// ── Grading a produced answer (M102) ─────────────────────────────────────────
//
// The model judges facts; fcMapVerdictToRating turns the judgement into a
// grade. Nothing here ever asks a model for a rating.

const FC_MARK_SYSTEM = [
  'You mark a student\'s written answer against a fixed list of points. You are a marker, not a teacher.',
  'For EACH point, in order, decide whether the student\'s answer contains it:',
  '- "hit": the point is there. Different wording, different order, and imperfect spelling are all fine.',
  '- "partial": the idea is there but incomplete, hedged, or missing the part that makes it true.',
  '- "miss": the point is absent.',
  'Mark meaning only. Never reward fluent writing that says nothing, and never penalise terse writing that says everything.',
  'Set "contradiction": true ONLY when the answer asserts something the reference denies — a wrong direction, a wrong sign, a reversed causal claim, a false condition. An omission is never a contradiction.',
  'Write "note": one short sentence naming what was missing or wrong, addressed to the student. Empty when everything was hit.',
  'Never award a point that is not in the list, and never invent points.',
  'Output ONLY this JSON object, no prose:',
  '{"points": [{"status": "hit|partial|miss", "note": "..."}], "contradiction": false, "note": "..."}',
].join('\n');

const FC_MARK_MODE_RULES = {
  conceptual: 'The points are the ideas a correct explanation must contain.',
  list: 'The points are items the student had to enumerate. Match each item on meaning, not wording, and ignore the order they were listed in.',
  formula: 'The point is a formula. "hit" = mathematically equivalent, however it is written. "partial" = the right structure with a notation slip, a wrong constant, or a wrong index. "miss" = a different formula.',
};

const FC_RUBRIC_SYSTEM = [
  'You reduce a flashcard\'s answer to the points a student must state to have answered it.',
  'Rules:',
  '- One point per idea. Between 2 and 6 points; fewer only when the answer genuinely holds fewer.',
  '- A point is a claim, not a topic: "variance is proportional to the prior column", not "variance".',
  '- Mark "required": false for supporting detail a complete answer could omit. Mark the load-bearing claims required.',
  '- Never add a point the answer does not make.',
  'Output ONLY a JSON array, no prose:',
  '[{"text": "...", "required": true}]',
].join('\n');

/**
 * The reference a produced answer is marked against. Pure.
 *
 * `back` plus the stored source excerpt, and deliberately NOT the card's
 * notes: notes are the learner's own mnemonics and reminders, so marking
 * their answer against them would be circular — a misconception written into
 * the notes would then mark the same misconception correct forever.
 *
 * `sourced` reports whether the excerpt was there, so a verdict reached
 * without one can be shown as the weaker evidence it is.
 */
function fcGradingContext(card) {
  const excerpt = String(card?.sourceExcerpt || '').trim();
  const parts = [`Reference answer:\n${String(card?.back || '').trim()}`];
  if (excerpt) parts.push(`Source passage${card?.sourcePage ? ` (page ${card.sourcePage})` : ''}:\n${excerpt}`);
  return { text: parts.join('\n\n'), sourced: !!excerpt };
}

/** Output reserve for a verdict: a status + short note per point, plus the tail. */
const FC_MARK_OUTPUT_TOKENS = 700;

/**
 * Context window for one judging call. Judging is small and bounded — an
 * excerpt capped at 2K chars, a short rubric, one answer — so it plans from
 * the real lengths rather than borrowing generation's card-count model.
 */
function fcMarkNumCtx(promptChars) {
  const tokens = Math.ceil(promptChars / FC_CHARS_PER_TOKEN * FC_PROMPT_HEADROOM)
    + FC_SCAFFOLD_TOKENS + FC_MARK_OUTPUT_TOKENS;
  return Math.max(2048, Math.ceil(tokens / 1024) * 1024);
}

/**
 * Ask the model to reduce an existing card's answer to rubric points.
 *
 * Used for cards that were never generated with a rubric — hand-made cards,
 * Anki imports, and everything that predates M102. Persisted by the caller,
 * so it happens once per card rather than once per review: deriving it fresh
 * each time would be exactly the drifting standard the stored rubric exists
 * to prevent.
 */
async function fcDeriveRubric(card) {
  const modelId = await fcPickModel();
  if (!modelId) throw new Error('No language model available. Configure a model in AI settings.');
  const { think } = fcAiOptions();
  const ctx = fcGradingContext(card);
  const user = [
    `Card front (the question asked):\n${card.front}`,
    '',
    ctx.text,
  ].join('\n');
  let output = '';
  const stream = _api.lm.sendChatRequest(modelId, [
    { role: 'system', content: FC_RUBRIC_SYSTEM },
    { role: 'user', content: user },
  ], { temperature: 0.1, think, numCtx: fcMarkNumCtx(user.length) });
  await fcStreamWithStall(stream, (chunk) => { if (chunk.content) output += chunk.content; });
  const { items } = fcExtractJsonArray(output, (parsed) => fcNormalizeRubric(parsed));
  return fcNormalizeRubric(items);
}

/**
 * The card's rubric, deriving and persisting one the first time a card is
 * graded without it. Returns [] when derivation fails, which the caller
 * reads as "fall back to a self-grade" rather than as an error worth
 * interrupting a study session for.
 */
async function fcEnsureRubric(card) {
  if (card.rubric && card.rubric.length) return card.rubric;
  try {
    const derived = await fcDeriveRubric(card);
    if (!derived.length) return [];
    await fcUpdateCard(card.id, { rubric: derived });
    card.rubric = derived;
    return derived;
  } catch (err) {
    console.warn('[Flashcards] rubric derivation failed:', err?.message || err);
    return [];
  }
}

/** One judging call. Returns the normalized verdict, or null if nothing parsed. */
async function fcMarkAnswer(card, answer, rubric, { provisional = null } = {}) {
  const modelId = await fcPickModel();
  if (!modelId) throw new Error('No language model available. Configure a model in AI settings.');
  const { think } = fcAiOptions();
  const mode = fcNormalizeRecallMode(card.recallMode);
  const ctx = fcGradingContext(card);
  const user = [
    FC_MARK_MODE_RULES[mode] || FC_MARK_MODE_RULES.conceptual,
    '',
    `Question:\n${card.front}`,
    '',
    ctx.text,
    '',
    'Points to mark, in order:',
    ...rubric.map((p, i) => `${i + 1}. ${p.text}${p.required ? '' : ' (supporting detail)'}`),
    '',
    `Student's answer:\n${String(answer || '').trim() || '(blank)'}`,
  ].join('\n');
  let output = '';
  const stream = _api.lm.sendChatRequest(modelId, [
    { role: 'system', content: FC_MARK_SYSTEM },
    { role: 'user', content: user },
  ], { temperature: 0, think, numCtx: fcMarkNumCtx(user.length) });
  await fcStreamWithStall(stream, (chunk) => { if (chunk.content) output += chunk.content; });
  const raw = fcExtractJsonObject(output);
  if (!raw) {
    console.warn('[Flashcards] judging failed. Raw model output head:', output.slice(0, 400));
    return null;
  }
  // A provisional pass (list mode) already settled the confident items; the
  // model only adjudicates what it was uncertain about, so its judgement is
  // merged UNDER the deterministic one rather than over it.
  const verdict = fcNormalizeVerdict(raw, rubric, { mode, sourced: ctx.sourced });
  if (provisional) {
    for (let i = 0; i < verdict.points.length; i++) {
      const p = provisional[i];
      if (p && p.status !== 'partial') verdict.points[i] = { ...verdict.points[i], status: p.status };
    }
  }
  return verdict;
}

/**
 * Grade a produced answer end to end: rubric → verdict → rating.
 *
 * Returns `{ rating, verdict, rubric }`, or `{ rating: null }` when the card
 * cannot be graded automatically (no rubric could be derived, or the model
 * returned nothing usable). A null rating is not an error — the study view
 * falls back to the self-grade buttons, so a model outage costs the verdict,
 * never the review.
 *
 * The cheap paths run first and can skip the model entirely: an exact
 * formula match, and a list answer whose every item matched or missed
 * decisively.
 */
async function fcGradeAnswer(card, answer) {
  const mode = fcNormalizeRecallMode(card.recallMode);
  if (!fcIsProductionMode(mode)) return { rating: null, verdict: null, rubric: [] };

  const rubric = await fcEnsureRubric(card);
  if (!rubric.length) return { rating: null, verdict: null, rubric: [] };

  const ctx = fcGradingContext(card);
  const base = { mode, contradiction: false, note: '', sourced: ctx.sourced };

  // A blank answer is a legitimate "I cannot", and it is every point missed
  // by definition. Sending it to the model would spend a call to be told so.
  if (!String(answer || '').trim()) {
    const verdict = {
      ...base,
      points: rubric.map(() => ({ status: 'miss', note: '' })),
      note: 'Nothing written down.',
    };
    return { rating: fcMapVerdictToRating(verdict, rubric), verdict, rubric };
  }

  // Formula: an exact match after normalisation needs no judgement at all.
  if (mode === 'formula' && rubric.length === 1 && fcFormulaMatches(answer, rubric[0].text)) {
    const verdict = { ...base, points: [{ status: 'hit', note: '' }] };
    return { rating: fcMapVerdictToRating(verdict, rubric), verdict, rubric };
  }

  // List: the deterministic pre-pass settles clear hits and clear misses.
  let provisional = null;
  if (mode === 'list') {
    const pre = fcMatchListItems(answer, rubric);
    if (!pre.uncertain) {
      const verdict = { ...base, points: pre.statuses };
      return { rating: fcMapVerdictToRating(verdict, rubric), verdict, rubric };
    }
    provisional = pre.statuses;
  }

  const verdict = await fcMarkAnswer(card, answer, rubric, { provisional });
  if (!verdict) return { rating: null, verdict: null, rubric };
  return { rating: fcMapVerdictToRating(verdict, rubric), verdict, rubric };
}


// ── Leech loop (M98) ─────────────────────────────────────────────────────────
// A card failed `flashcards.leechThreshold`+ times is a leech: the formulation
// is not sticking. The study view flags it and offers an AI reformulation;
// scheduling state is deliberately preserved (the FACT is unchanged — only
// its wording moves).

function fcLeechThreshold() {
  const n = Number(cfg('leechThreshold', 5));
  return Number.isFinite(n) && n > 0 ? n : 5;
}

function fcIsLeech(card) {
  return (card.lapses || 0) >= fcLeechThreshold();
}

// ── Faithful transcription (import "Rebuild with AI") ────────────────────────
//
// NOT generation: the mechanical import's exactness promise stands — same
// cards, same wording — but PDF extraction shreds rendered math into
// out-of-order fragments (fraction denominators before numerators, detached
// sub/superscripts, vanished radicals — verified on four real provider
// decks). Only a model can put a known formula back together; this pass does
// that and drops leftover page furniture, and nothing else.

const FC_TRANSCRIBE_SYSTEM = [
  'You transcribe flashcards that were extracted from a PDF with a mangled text layer.',
  'For each numbered card, reproduce the SAME front and back:',
  '- Keep the wording VERBATIM. Never paraphrase, summarize, reorder sections, add facts, or drop content.',
  '- Never merge, split, add, or drop cards. Output EXACTLY one object per input card, in input order.',
  '- Rebuild every mangled formula in clean LaTeX between $...$ (inline math on ONE line; $$...$$ for display equations). Extraction scrambles fractions, subscripts, superscripts and radicals: reconstruct the standard form the text clearly intends instead of copying the garble.',
  '- Fix words broken by extraction (stray tabs, split letters) and re-attach math to the sentence that references it.',
  '- DROP page furniture only: running headers, footers, page numbers, card counters ("FRONT · CARD 2", "Recipe 1 of 5"), watermarks.',
  '- Keep section headings that carry content (e.g. "EXAM TIPS", "PAST EXAM PRACTICE") and source citations.',
  '- Never use em dashes.',
  'Output ONLY a JSON array, no prose, one object per card in input order:',
  '[{"front": "...", "back": "...", "page": N}] where N echoes the CARD number you were given.',
].join('\n');

/**
 * Rebuild paired PDF cards through the model, faithfully. Returns an array
 * of the SAME length: each element is the rebuilt card (front/back replaced;
 * sourcePage/tags preserved) or the untouched original when anything about
 * its batch fails — a parse error, a stall, a count mismatch. Never throws;
 * with no model available it returns the input unchanged.
 */
async function fcAiTranscribePairs(cards, { onProgress } = {}) {
  const modelId = await fcPickModel();
  if (!modelId || !_api?.lm?.sendChatRequest) return cards;
  const { contextSetting, think } = fcAiOptions();
  const modelCtx = await fcModelContextLength(modelId);

  // Small batches bound the blast radius of one bad parse and keep the
  // output reserve honest: a transcription's output is roughly the SIZE OF
  // ITS INPUT, unlike generation's condensed 220-token cards.
  const batches = [];
  let batch = [];
  let batchChars = 0;
  for (const card of cards) {
    const size = card.front.length + card.back.length;
    if (batch.length > 0 && (batch.length >= 8 || batchChars + size > 6000)) {
      batches.push(batch);
      batch = [];
      batchChars = 0;
    }
    batch.push(card);
    batchChars += size;
  }
  if (batch.length > 0) batches.push(batch);

  const out = [];
  let done = 0;
  for (const group of batches) {
    let rebuilt = null;
    try {
      const chars = group.reduce((n, c) => n + c.front.length + c.back.length, 0);
      // chars * 2: the prompt holds the raw text AND the output reserve must
      // hold its cleaned twin.
      const { numCtx } = fcContextPlan({ chars: chars * 2, count: group.length, modelCtx, setting: contextSetting });
      const user = group.map((c, i) =>
        `CARD ${i + 1}\nFRONT:\n${c.front}\nBACK:\n${c.back}`).join('\n\n---\n\n');
      let output = '';
      const stream = _api.lm.sendChatRequest(modelId, [
        { role: 'system', content: FC_TRANSCRIBE_SYSTEM },
        { role: 'user', content: user },
      ], { temperature: 0.2, think, numCtx });
      await fcStreamWithStall(stream, (chunk) => { if (chunk.content) output += chunk.content; });
      const { cards: parsed } = fcExtractCardsJson(output);
      // Structural acceptance, never trust: one output per input, all faces
      // non-empty. Map by echoed card number when every one is valid.
      if (parsed.length === group.length && parsed.every((c) => c.front && c.back)) {
        const byIndex = parsed.every((c, i) => Number.isInteger(c.page) && c.page >= 1 && c.page <= group.length)
          ? group.map((_, i) => parsed.find((c) => c.page === i + 1) || parsed[i])
          : parsed;
        rebuilt = group.map((orig, i) => ({ ...orig, front: byIndex[i].front, back: byIndex[i].back }));
      }
    } catch { /* stall, request failure — this batch keeps its raw text */ }
    out.push(...(rebuilt || group));
    done += group.length;
    try { onProgress?.(done, cards.length, !!rebuilt); } catch { /* UI gone */ }
  }
  return out;
}

const FC_REWRITE_SYSTEM = [
  'You rewrite ONE failing spaced-repetition flashcard.',
  'The learner keeps failing it. Reformulate so it sticks: a sharper cue on the',
  'front, simpler phrasing, or a different angle on the SAME fact. Never change',
  'what is being tested, and never invent new facts.',
  'Formatting (cards render Markdown + KaTeX):',
  '- Write EVERY formula and symbol in LaTeX between $...$.',
  '- Never use em dashes.',
  'Output ONLY a JSON array of exactly 3 alternatives, no prose:',
  '[{"front": "...", "back": "..."}]',
].join('\n');

async function fcGenerateRewrites(card) {
  const modelId = await fcPickModel();
  if (!modelId) throw new Error('No language model available. Configure a model in AI settings.');
  const { contextSetting, think } = fcAiOptions();
  const modelCtx = await fcModelContextLength(modelId);
  const user = [
    `The learner has failed this card ${card.lapses} times.`,
    `FRONT: ${card.front}`,
    `BACK: ${card.back}`,
    card.notes ? `NOTES: ${card.notes}` : '',
    card.sourceLabel ? `SOURCE: ${card.sourceLabel}` : '',
  ].filter(Boolean).join('\n');
  const { numCtx } = fcContextPlan({ chars: user.length, count: 3, modelCtx, setting: contextSetting });
  let output = '';
  const stream = _api.lm.sendChatRequest(modelId, [
    { role: 'system', content: FC_REWRITE_SYSTEM },
    { role: 'user', content: user },
  ], { temperature: 0.6, think, numCtx });
  await fcStreamWithStall(stream, (chunk) => { if (chunk.content) output += chunk.content; });
  const { cards, error } = fcExtractCardsJson(output);
  if (error && cards.length === 0) throw new Error(`${error} (model: ${modelId})`);
  return cards.slice(0, 3);
}

/** Quick-pick one of three AI reformulations; scheduling state survives. */
async function fcLeechRewriteFlow(card) {
  // Cloze siblings share their text group-wide, and a model rewrite would
  // drop the {{cN::…}} markers — reconciliation would then tear the group
  // apart (M99 review). Honest scope cut: point at the editor instead.
  if (card.cardType === 'cloze') {
    await _api.window.showInformationMessage(
      'Cloze cards cannot be auto-rewritten. Edit the note text in Browse instead; changes apply to all of its sibling cards.',
    );
    return false;
  }
  let alts;
  try {
    alts = await fcGenerateRewrites(card);
  } catch (e) {
    await _api.window.showErrorMessage(`Could not generate rewrites: ${e.message}`);
    return false;
  }
  if (!alts.length) {
    await _api.window.showInformationMessage('The model produced no usable alternatives.');
    return false;
  }
  const items = alts.map((a, i) => ({ label: a.front.slice(0, 90), description: a.back.slice(0, 70), index: i }));
  const pick = await _api.window.showQuickPick(items, {
    placeholder: 'Pick a reformulation. Review history and scheduling are preserved.',
  });
  if (!pick) return false;
  const alt = alts[items.find((it) => it.label === pick.label)?.index ?? 0];
  await fcUpdateCard(card.id, { front: fcNormalizeCardText(alt.front), back: fcNormalizeCardText(alt.back) });
  return true;
}

/**
 * "Explain This" (M98): open the main chat with the card staged as a context
 * attachment, then submit a focused prompt. chat.show (idempotent reveal),
 * NEVER chat.focus — that one is a blind toggle that can hide the panel.
 */
/**
 * Stage a grounded question about a card in the chat input — attachments
 * ready, prompt written, NOT sent.
 *
 * Two problems with the old behaviour, both reported:
 *
 *   1. It fired immediately, so the only question you could ever ask was the
 *      one hardcoded here. The card is the user's; the question should be too.
 *   2. "Explain this flashcard" invited the model to paraphrase the card back,
 *      because the card was the only material in front of it. Answers were
 *      confidently derived from a two-line card rather than from the material
 *      the card was made from.
 *
 * So: attach the real source when the card cites one, and write the prompt as
 * an instruction to go find and cite the material — with an explicit licence
 * to say "not found" instead of filling the gap from the card.
 */
/**
 * Render one marking as plain text for the chat hand-off. Pure.
 *
 * The per-point breakdown goes across verbatim rather than being summarised
 * to a grade, because the grade is the least useful part: what makes the
 * conversation worth having is WHICH claim was missing, and the model cannot
 * ask about a gap it was only told the size of.
 */
function fcMarkingTranscript(marking) {
  const { answer, verdict, rubric, rating, reviewedAt } = marking;
  const s = fcScoreVerdict(verdict, rubric);
  const when = reviewedAt ? ` on ${new Date(reviewedAt).toLocaleDateString()}` : '';
  const lines = [
    `MY ANSWER (marked ${FC_RATING_LABELS[rating] || '?'}, ${s.hits}/${s.total} points${when})`,
    String(answer || '').trim() || '(left blank)',
    '',
    'MARKING',
  ];
  rubric.forEach((p, i) => {
    const status = verdict?.points?.[i]?.status || 'miss';
    const note = verdict?.points?.[i]?.note;
    lines.push(`${FC_POINT_GLYPHS[status]} ${p.text}${note && status !== 'hit' ? ` — ${note}` : ''}`);
  });
  if (verdict?.contradiction) lines.push('! This answer contradicts the source.');
  if (verdict?.note) lines.push(`Marker's note: ${verdict.note}`);
  if (!verdict?.sourced) lines.push('(Marked against the card\'s answer only — no source passage is stored.)');
  return lines.join('\n');
}

/**
 * Stage a grounded question about a card in the chat.
 *
 * `marking` (M102) carries a graded answer across — live from the study
 * verdict, or an older one picked out of the card's history. When it is
 * present the ask changes entirely: not "explain this card" but "here is
 * what I could not produce, close that gap". Handing the model the generic
 * prompt while sitting on a specific failure would waste the most useful
 * context the session has.
 */
async function fcExplainInChat(card, deckName, { marking = null } = {}) {
  await _api.commands.executeCommand('chat.show');

  const sourceRef = card.sourceLabel
    ? `${card.sourceLabel}${card.sourcePage ? ` p.${card.sourcePage}` : ''}`
    : '';

  const attachment = {
    kind: 'selection',
    id: `flashcard-${card.id}-${Date.now()}`,
    name: deckName || 'Flashcard',
    fullPath: card.sourceUri || `flashcard://${card.id}`,
    isImplicit: false,
    surface: 'flashcards',
    selectedText: [
      'FLASHCARD',
      `Front: ${card.front}`,
      `Back: ${card.back}`,
      sourceRef ? `Source: ${sourceRef}` : '',
      marking ? `\n${fcMarkingTranscript(marking)}` : '',
    ].filter(Boolean).join('\n'),
  };
  if (card.sourcePage > 0) attachment.pageNumber = card.sourcePage;
  await _api.commands.executeCommand('chat.addSelectionContext', attachment);

  // A cited FILE goes in as a real attachment so the model reads the document
  // instead of the card's summary of it. Canvas pages carry a parallx:// URI
  // that the file-attachment path cannot resolve — the prompt names those and
  // lets the model open them with its own tools.
  const uri = String(card.sourceUri || '');
  const isFile = uri && !uri.startsWith('parallx://') && !uri.startsWith('flashcard://');
  if (isFile) {
    try {
      await _api.commands.executeCommand('chat.addFileAttachment', {
        name: card.sourceLabel || uri.split(/[\\/]/).pop() || 'Source',
        fullPath: uri,
      });
    } catch { /* best effort — the prompt still names the source */ }
  }

  const where = sourceRef
    ? `It came from ${sourceRef}${isFile ? ' (attached)' : ''} — start there.`
    : 'The card records no source, so search the workspace for the material it came from.';

  if (marking) {
    const gaps = marking.rubric
      .map((p, i) => ({ p, status: marking.verdict?.points?.[i]?.status || 'miss' }))
      .filter((x) => x.status !== 'hit')
      .map((x) => `- ${x.p.text}`);
    await _api.commands.executeCommand('chat.stagePrompt', {
      text: [
        `I tried to answer this from memory and it was marked ${FC_RATING_LABELS[marking.rating] || ''}. Help me close the gap.`,
        '',
        `Card: "${fcTruncate(card.front, 160)}"`,
        '',
        ...(marking.verdict?.contradiction
          // A contradiction is the whole conversation: believing something the
          // source denies is a different problem from having missed a point,
          // and fixing it needs the false belief named first.
          ? ['My answer contradicts the source. Start by naming exactly what I got backwards and what the material actually says.']
          : gaps.length
            ? ['What I did not produce:', ...gaps]
            : ['I covered the points, so go deeper than the card does.']),
        '',
        where,
        'Explain the material behind what I missed so I could produce it myself next time — do not just restate the card\'s answer back to me.',
        'Cite the file and page behind each claim, and link back to the source so I can open it.',
        '',
      ].join('\n'),
    });
    return;
  }

  await _api.commands.executeCommand('chat.stagePrompt', {
    text: [
      `Ground this card in my own material before answering it: "${fcTruncate(card.front, 160)}"`,
      '',
      where,
      'Read what the material actually says, then explain why the answer holds and where it comes from.',
      'Cite the file and page behind each claim, and link back to the source so I can open it.',
      'If you cannot find material that supports it, say so plainly instead of answering from the card alone.',
      '',
    ].join('\n'),
  });
}

/** Single-line, length-capped text for prompts and labels. */
function fcTruncate(text, max) {
  const flat = String(text || '').replace(/\s+/g, ' ').trim();
  return flat.length > max ? `${flat.slice(0, max - 1)}…` : flat;
}

// ═══════════════════════════════════════════════════════════════════════════════
// SECTION 6: SOURCES — canvas pages, PDFs, photos, pasted text
// ═══════════════════════════════════════════════════════════════════════════════

function electronBridge() {
  return globalThis.parallxElectron;
}

async function fcPickCanvasPage() {
  const tree = await _api.workspace.getCanvasPageTree();
  const flat = [];
  const walk = (nodes, depth) => {
    for (const n of nodes || []) {
      flat.push({ label: `${'  '.repeat(depth)}${n.title || 'Untitled'}`, description: n.id, id: n.id });
      walk(n.children, depth + 1);
    }
  };
  walk(tree, 0);
  if (flat.length === 0) {
    await _api.window.showInformationMessage('No canvas pages in this workspace yet.');
    return null;
  }
  const pick = await _api.window.showQuickPick(
    flat.map(({ label, description }) => ({ label, description })),
    { placeholder: 'Generate cards from which page?' },
  );
  if (!pick) return null;
  const chosen = flat.find((f) => f.label === pick.label && f.description === pick.description);
  return chosen ? chosen.id : null;
}

async function fcReadCanvasPage(pageId) {
  const result = await _api.commands.executeCommand('canvas.getPageMarkdown', pageId);
  if (!result || !result.markdown) throw new Error('Could not read that canvas page.');
  const text = result.markdown.trim();
  // A near-empty read means the page has no real text (or a read-path bug) —
  // fail HERE with a clear message instead of sending nothing to the model
  // and surfacing a cryptic parse error after generation.
  if (text.length < 120) {
    throw new Error(
      `Only ${text.length} characters could be read from "${result.title || 'that page'}". The page may be empty. Pick a page with written notes.`,
    );
  }
  return {
    text,
    label: `Canvas: ${result.title || 'Untitled'}`,
    uri: `parallx://canvas/page/${pageId}`,
  };
}

// Supported source file types (shared by the picker, drop zone, and dialogs).
const FC_DOC_EXTS = ['pdf', 'docx', 'epub', 'xlsx'];
const FC_IMG_EXTS = ['png', 'jpg', 'jpeg', 'webp', 'bmp', 'tiff'];

function fcExtOf(nameOrPath) {
  const m = /\.([a-z0-9]+)$/i.exec(nameOrPath || '');
  return m ? m[1].toLowerCase() : '';
}

// Normalize a dropped Explorer value (a file:// URI or a raw path) to an fs path.
function fcUriToFsPath(raw) {
  if (!raw) return raw;
  let p = raw;
  if (/^file:\/\//i.test(p)) {
    p = p.replace(/^file:\/\//i, '');
    try { p = decodeURIComponent(p); } catch { /* leave encoded on malformed input */ }
    if (/^\/[a-zA-Z]:/.test(p)) p = p.slice(1); // /D:/x → D:/x
  }
  return p;
}

function fcLooksLikePath(raw) {
  return /^file:\/\//i.test(raw) || /^[a-zA-Z]:[\\/]/.test(raw) || raw.startsWith('/') || raw.startsWith('\\\\');
}

// Which importer handles a dropped/picked file, by dot-less fcExtOf extension.
// Anki's .colpkg (whole-collection export) shares the .apkg container format.
function fcImportKindOf(ext) {
  if (['apkg', 'colpkg', 'txt', 'tsv', 'csv'].includes(ext)) return 'anki';
  if (ext === 'pdf') return 'pdf';
  return null;
}

/**
 * Resolve an OS-dragged File to a filesystem path. Electron removed the
 * nonstandard File.path in v32; webUtils.getPathForFile (exposed through the
 * preload bridge) is the only way to get one now. The legacy property is kept
 * as a fallback for older shells and jsdom test harnesses that set it.
 */
function fcFileDropPath(file) {
  if (!file) return '';
  try {
    const viaBridge = electronBridge()?.getPathForFile?.(file);
    if (viaBridge) return viaBridge;
  } catch { /* fall through to the legacy property */ }
  return file.path || '';
}

// Extract text from a known document path (pdf/docx/epub/xlsx).
async function fcExtractDocument(filePath) {
  const electron = electronBridge();
  if (!electron?.document?.extractText) throw new Error('Document extraction is unavailable in this build.');
  const result = await electron.document.extractText(filePath);
  if (result?.error) throw new Error(result.error.message || 'Extraction failed.');
  const text = (result?.text ?? '').trim();
  if (text.length < 200) {
    // Scanned/image-based PDFs extract to almost nothing — generating from
    // that produces invented cards. Route the user to OCR instead.
    throw new Error(
      text.length === 0
        ? 'No text found in that document. If it is a scanned PDF, drop it as a photo (OCR) instead.'
        : `Only ${text.length} characters of text could be extracted. This looks like a scanned document. Use a photo (OCR) instead.`,
    );
  }
  const name = filePath.split(/[\\/]/).pop();
  // M98 grounding: keep the extractor's per-page text (PDFs) so generation
  // can tag pages and attribute each card — joined text can never recover
  // page boundaries.
  const pageTexts = Array.isArray(result?.pageTexts) && result.pageTexts.length > 1 ? result.pageTexts : null;
  return { text, label: `Document: ${name}`, uri: filePath, pageTexts };
}

// OCR a known image path via the Docling bridge.
async function fcExtractPhoto(filePath) {
  const electron = electronBridge();
  if (!electron?.docling) throw new Error('Photo OCR needs the Docling bridge, which is unavailable in this build.');
  let status = await electron.docling.status();
  if (status?.status !== 'available') {
    if (!status?.doclingInstalled) {
      throw new Error('Docling is not installed. Install it from Settings → Documents to OCR photos.');
    }
    await electron.docling.start();
    status = await electron.docling.status();
    if (status?.status !== 'available') throw new Error('Docling bridge failed to start.');
  }
  const result = await electron.docling.convert(filePath, { ocr: true });
  const text = result?.markdown || '';
  if (!text.trim()) throw new Error('OCR found no text in that image.');
  const name = filePath.split(/[\\/]/).pop();
  return { text, label: `Photo: ${name}`, uri: filePath };
}

// Route a file path to the right extractor by extension.
async function fcExtractPath(filePath) {
  const ext = fcExtOf(filePath);
  if (FC_IMG_EXTS.includes(ext)) return fcExtractPhoto(filePath);
  if (FC_DOC_EXTS.includes(ext)) return fcExtractDocument(filePath);
  throw new Error(`Unsupported file type${ext ? ` (.${ext})` : ''}. Use a PDF, Word, EPUB, Excel, or image file.`);
}

// Resolve a drop onto the Create tab. Explorer files and Canvas pages both
// arrive as text/plain (a file URI vs. a bare page id); OS files arrive as
// dataTransfer.files. Distinguish by shape.
async function fcLoadFromDrop(dataTransfer) {
  const osFile = dataTransfer?.files && dataTransfer.files[0];
  const osPath = fcFileDropPath(osFile);
  if (osPath) return fcExtractPath(osPath);
  const raw = (dataTransfer?.getData('text/plain') || '').trim();
  if (!raw) throw new Error('Drag a file from the Explorer, or a page from the Canvas sidebar.');
  if (fcLooksLikePath(raw)) return fcExtractPath(fcUriToFsPath(raw));
  if (/^[0-9a-fA-F][0-9a-fA-F-]{7,}$/.test(raw)) return fcReadCanvasPage(raw); // canvas page id
  throw new Error('Drop a file from the Explorer, or a page from the Canvas sidebar.');
}

// Pick a document/image from anywhere in the workspace — no OS dialog, so the
// user stays in the workspace (the default way to add source material).
async function fcPickWorkspaceFile() {
  const root = _api.workspace?.workspaceFolders?.[0]?.uri;
  if (!root) { await _api.window.showInformationMessage('No workspace folder is open.'); return null; }
  const electron = electronBridge();
  if (!electron?.fs?.readdir) throw new Error('Workspace file listing is unavailable in this build.');

  const SKIP = new Set(['node_modules', '.git', '.parallx', '.obsidian', 'dist', 'build', 'out', '.cache']);
  const MAX_FILES = 800;
  const found = [];
  const walk = async (dirPath, rel, depth) => {
    if (depth > 6 || found.length >= MAX_FILES) return;
    let res;
    try { res = await electron.fs.readdir(dirPath); } catch { return; }
    if (!res || res.error) return;
    for (const ent of res.entries || []) {
      if (found.length >= MAX_FILES) return;
      const name = ent.name;
      if (!name || name.startsWith('.')) continue;
      const childPath = `${dirPath}/${name}`;
      const childRel = rel ? `${rel}/${name}` : name;
      if (ent.type === 'directory') {
        if (!SKIP.has(name)) await walk(childPath, childRel, depth + 1);
      } else if (FC_DOC_EXTS.includes(fcExtOf(name)) || FC_IMG_EXTS.includes(fcExtOf(name))) {
        found.push({ name, rel: childRel, path: childPath });
      }
    }
  };
  await walk(fcUriToFsPath(root), '', 0);

  if (found.length === 0) {
    await _api.window.showInformationMessage('No PDFs, documents, or images found in this workspace.');
    return null;
  }
  found.sort((a, b) => a.name.localeCompare(b.name));
  const pick = await _api.window.showQuickPick(
    found.map((f) => ({ label: f.name, description: f.rel })),
    { placeholder: `Add which workspace file? (${found.length} found)`, matchOnDescription: true },
  );
  if (!pick) return null;
  const chosen = found.find((f) => f.name === pick.label && f.rel === pick.description);
  return chosen ? fcExtractPath(chosen.path) : null;
}

// Fallback: pick a document from the OS file dialog (material outside the workspace).
async function fcReadPdf() {
  const electron = electronBridge();
  if (!electron?.dialog?.openFile) throw new Error('File access is unavailable in this build.');
  const picked = await electron.dialog.openFile({
    filters: [{ name: 'Documents', extensions: FC_DOC_EXTS }],
  });
  if (!picked || picked.length === 0) return null;
  return fcExtractDocument(picked[0]);
}

// Fallback: pick an image from the OS file dialog and OCR it.
async function fcReadPhoto() {
  const electron = electronBridge();
  if (!electron?.dialog?.openFile) throw new Error('File access is unavailable in this build.');
  const picked = await electron.dialog.openFile({
    filters: [{ name: 'Images', extensions: FC_IMG_EXTS }],
  });
  if (!picked || picked.length === 0) return null;
  return fcExtractPhoto(picked[0]);
}

// ═══════════════════════════════════════════════════════════════════════════════
// SECTION 7: CSS
// ═══════════════════════════════════════════════════════════════════════════════

let _styleInjected = false;

function injectStyles() {
  if (_styleInjected) return;
  _styleInjected = true;
  const style = document.createElement('style');
  style.id = 'flashcards-styles';
  style.textContent = `
/* Flashcards — "sharp editorial" identity on native --px tokens (M83).
   Space and type weight carry hierarchy; borders and inset wells are pulled
   back to hairline dividers. Signal hues (again/hard/good/easy + card stage)
   are the ONLY color in the tool — everything else is high-contrast neutral.
   Uppercase is a tracked 2xs eyebrow for structural labels only, never body. */

/* ── Sidebar — a quiet navigator: header, Today, sectioned deck list.
   Colour is absent here by design; weight and space do the work. ── */
.fc-sidebar { display: flex; flex-direction: column; height: 100%; font-size: var(--px-text-base); }

.fc-sb__header {
  display: flex; align-items: center; height: 38px; flex: 0 0 auto;
  padding: 0 var(--px-space-2) 0 var(--px-sidebar-inset);
  gap: var(--px-space-1);
}
.fc-sb__title {
  flex: 1; min-width: 0;
  font-size: var(--px-text-2xs); font-weight: 700; letter-spacing: 0.1em; text-transform: uppercase;
  color: var(--px-text-faint);
  overflow: hidden; text-overflow: ellipsis; white-space: nowrap;
}
.fc-sb__icon-btn {
  display: inline-flex; align-items: center; justify-content: center;
  width: 24px; height: 24px; flex: 0 0 auto;
  border: 0; border-radius: var(--px-radius-sm); background: transparent;
  color: var(--px-text-faint); cursor: pointer;
  transition: background var(--px-dur-fast) var(--px-ease), color var(--px-dur-fast) var(--px-ease);
}
.fc-sb__icon-btn:hover { background: var(--px-surface-hover); color: var(--px-text); }
.fc-sb__icon-btn:active { transform: var(--px-press); }

/* Navigation rail — the tool's destinations, pinned above the scroller.
   Reads as sidebar navigation (row, glyph, selected slab), not as buttons:
   the app's other navigators use the same left-accent selected state. */
.fc-sb__nav {
  display: flex; flex-direction: column; flex: 0 0 auto;
  padding: var(--px-space-2) var(--px-space-1) var(--px-space-2);
  border-bottom: 1px solid var(--px-divider);
}
.fc-sb__nav-item {
  position: relative;
  display: flex; align-items: center; gap: var(--px-space-2); width: 100%;
  height: 28px; padding: 0 var(--px-space-2); border: 0; border-radius: var(--px-radius-sm);
  background: transparent; color: var(--px-text-secondary);
  font: inherit; font-size: var(--px-text-base); font-weight: 550;
  text-align: left; cursor: pointer;
  transition: background var(--px-dur-fast) var(--px-ease), color var(--px-dur-fast) var(--px-ease);
}
.fc-sb__nav-item:hover { background: var(--px-surface-hover); color: var(--px-text); }
.fc-sb__nav-item:focus-visible { outline: none; box-shadow: var(--px-ring-accent); }
.fc-sb__nav-item--active { background: var(--px-surface-selected); color: var(--px-text); font-weight: 650; }
.fc-sb__nav-item--active::before {
  content: ''; position: absolute; left: 0; top: 5px; bottom: 5px; width: 2px;
  border-radius: 0 2px 2px 0; background: var(--px-accent);
}
.fc-sb__nav-icon { flex: 0 0 auto; display: inline-flex; width: 14px; height: 14px; color: var(--px-text-faint); }
.fc-sb__nav-item--active .fc-sb__nav-icon { color: var(--px-accent); }
.fc-sb__nav-icon svg { width: 100%; height: 100%; }
.fc-sb__nav-label { flex: 1; min-width: 0; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }

.fc-sb__scroll { flex: 1; overflow-y: auto; padding-bottom: var(--px-space-3); }

.fc-sb__section { display: flex; flex-direction: column; }
.fc-sb__section-head {
  display: flex; align-items: center; gap: var(--px-space-1);
  height: 24px; padding: 0 var(--px-space-2) 0 var(--px-sidebar-inset);
  margin-top: var(--px-space-3);
  font-size: var(--px-text-2xs); font-weight: 700; letter-spacing: 0.09em; text-transform: uppercase;
  color: var(--px-text-faint); user-select: none;
}
.fc-sb__section-title { flex: 1; min-width: 0; }
.fc-sb__section-count { font-weight: 600; color: var(--px-text-faint); font-variant-numeric: tabular-nums; }
.fc-sb__section-add {
  display: inline-flex; align-items: center; justify-content: center;
  width: 18px; height: 18px; border: 0; border-radius: var(--px-radius-sm);
  background: transparent; color: var(--px-text-faint); cursor: pointer; opacity: 0;
  transition: background var(--px-dur-fast) var(--px-ease), color var(--px-dur-fast) var(--px-ease), opacity var(--px-dur-fast) var(--px-ease);
}
.fc-sb__section:hover .fc-sb__section-add { opacity: 1; }
.fc-sb__section-add:hover { background: var(--px-surface-hover); color: var(--px-text); }

/* Today — no box. Three big neutral numerals over faint eyebrows, then the
   one earned accent in the whole sidebar: the Study call to action. */
.fc-today {
  margin: var(--px-space-2) var(--px-sidebar-inset) 0;
  padding-bottom: var(--px-space-3);
  border-bottom: 1px solid var(--px-divider);
}
.fc-today__stats { display: flex; align-items: stretch; gap: var(--px-space-3); margin-bottom: var(--px-space-3); }
.fc-today__stat { flex: 1; display: flex; flex-direction: column; gap: 2px; }
.fc-today__num { font-size: var(--px-text-xl); font-weight: 680; font-variant-numeric: tabular-nums; line-height: 1; letter-spacing: -0.02em; color: var(--px-text); }
.fc-today__num--zero { color: var(--px-text-disabled); }
.fc-today__num--new { color: var(--px-accent); }
.fc-today__num--learn { color: var(--px-warning); }
.fc-today__num--due { color: var(--px-success); }
.fc-today__lbl { font-size: var(--px-text-2xs); text-transform: uppercase; letter-spacing: 0.07em; color: var(--px-text-muted); }
.fc-today__study {
  display: flex; align-items: center; justify-content: center; gap: 6px;
  width: 100%; height: 34px; border: 0; border-radius: var(--px-radius-md);
  background: var(--px-accent); color: var(--px-text-on-accent);
  font: inherit; font-size: var(--px-text-sm); font-weight: 600; cursor: pointer;
  transition: background var(--px-dur-fast) var(--px-ease), transform var(--px-dur-instant) var(--px-ease);
}
.fc-today__study:hover { background: var(--px-accent-hover); }
.fc-today__study:active { transform: var(--px-press); }
.fc-today__study:disabled { opacity: 0.45; cursor: default; transform: none; }
.fc-today__study svg { width: 13px; height: 13px; }
/* The overflow line: what the daily batch is holding back, one click from
   Custom Study. A quiet link, never a second primary button. */
.fc-today__more {
  display: block; width: 100%; margin-top: var(--px-space-2); padding: 0;
  border: 0; background: transparent; color: var(--px-text-muted);
  font: inherit; font-size: var(--px-text-xs); text-align: center; cursor: pointer;
  transition: color var(--px-dur-fast) var(--px-ease);
}
.fc-today__more:hover { color: var(--px-accent); text-decoration: underline; }
.fc-today__more:focus-visible { outline: none; box-shadow: var(--px-ring-accent); border-radius: var(--px-radius-sm); }
.fc-today__done {
  padding: 2px 0 var(--px-space-1);
  font-size: var(--px-text-sm); line-height: var(--px-leading-base); color: var(--px-text-muted);
}

/* Deck rows — glyph, name, neutral counts. The row is the object, no chrome. */
.fc-sb__decks { display: flex; flex-direction: column; padding: var(--px-space-1) var(--px-space-1) 0; }
.fc-deck-row {
  display: flex; align-items: center; gap: var(--px-space-2); width: 100%;
  height: 30px; padding: 0 var(--px-space-1) 0 var(--px-space-2); border: 0; border-radius: var(--px-radius-sm);
  background: transparent; color: var(--px-text-secondary);
  font: inherit; font-size: var(--px-text-base); cursor: pointer; text-align: left;
  transition: background var(--px-dur-fast) var(--px-ease), color var(--px-dur-fast) var(--px-ease);
}
.fc-deck-row:hover { background: var(--px-surface-hover); color: var(--px-text); }
.fc-deck-row--active { background: var(--px-surface-selected); color: var(--px-text); }
.fc-deck-row__icon { flex: 0 0 auto; display: inline-flex; width: 13px; height: 13px; color: var(--px-text-faint); }
.fc-deck-row__icon svg { width: 100%; height: 100%; }
.fc-deck-row__name { flex: 1; min-width: 0; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.fc-deck-row__counts { flex: 0 0 auto; display: flex; align-items: center; gap: var(--px-space-2); font-size: var(--px-text-xs); font-weight: 600; font-variant-numeric: tabular-nums; }
/* Anki color language: new = accent, due = success — readable at a glance
   instead of two indistinguishable grey numbers (user report). */
.fc-deck-row__ct--new { color: var(--px-accent); }
.fc-deck-row__ct--due { color: var(--px-success); }
.fc-deck-row__more {
  flex: 0 0 auto; display: inline-flex; align-items: center; justify-content: center;
  width: 20px; height: 20px; border: 0; border-radius: var(--px-radius-sm);
  background: transparent; color: var(--px-text-faint); cursor: pointer; opacity: 0;
  transition: background var(--px-dur-fast) var(--px-ease), opacity var(--px-dur-fast) var(--px-ease);
}
.fc-deck-row:hover .fc-deck-row__more { opacity: 1; }
.fc-deck-row:hover .fc-deck-row__counts { display: none; }
.fc-deck-row__more:hover { background: var(--px-surface-active); color: var(--px-text); }
.fc-sb__empty { padding: var(--px-space-3) var(--px-sidebar-inset); font-size: var(--px-text-sm); line-height: var(--px-leading-base); color: var(--px-text-muted); }

/* ── Buttons — text-forward; ghost default, one accent primary ── */
.fc-btn {
  display: inline-flex; align-items: center; gap: 6px;
  height: 28px; padding: 0 var(--px-space-3);
  border: 1px solid var(--px-border); border-radius: var(--px-radius-md);
  background: transparent; color: var(--px-text-secondary);
  font: inherit; font-size: var(--px-text-sm); font-weight: 550; cursor: pointer;
  transition: background var(--px-dur-fast) var(--px-ease), color var(--px-dur-fast) var(--px-ease), border-color var(--px-dur-fast) var(--px-ease), transform var(--px-dur-instant) var(--px-ease);
}
.fc-btn:hover { background: var(--px-surface-hover); color: var(--px-text); border-color: var(--px-border-strong); }
.fc-btn:active { transform: var(--px-press); }
.fc-btn:disabled { opacity: 0.45; cursor: default; transform: none; }
.fc-btn:focus-visible { outline: none; box-shadow: var(--px-ring-accent); }
.fc-btn--primary { background: var(--px-accent); border-color: transparent; color: var(--px-text-on-accent); font-weight: 600; }
.fc-btn--primary:hover { background: var(--px-accent-hover); color: var(--px-text-on-accent); border-color: transparent; }
.fc-btn--danger:hover { background: var(--px-danger-soft); color: var(--px-danger); border-color: transparent; }

/* ── Pane shell — an editorial page: wide margins, an underline tab strip ── */
.fc-pane { display: flex; flex-direction: column; height: 100%; overflow: hidden; }
.fc-pane__header {
  display: flex; align-items: stretch; gap: var(--px-space-2);
  height: 46px; padding: 0 var(--px-space-4); flex: 0 0 auto;
  border-bottom: 1px solid var(--px-divider);
}
/* Breadcrumb — where you are, and the way back out. Navigation itself lives
   in the sidebar rail; this must never grow into a second tab strip. */
.fc-pane__crumbs { display: flex; align-items: center; gap: var(--px-space-2); min-width: 0; }
.fc-crumb {
  max-width: 240px; overflow: hidden; text-overflow: ellipsis; white-space: nowrap;
  font: inherit; font-size: var(--px-text-base); font-weight: 650; color: var(--px-text);
}
.fc-crumb--link {
  border: 0; padding: 2px var(--px-space-1); margin: 0 calc(var(--px-space-1) * -1);
  border-radius: var(--px-radius-sm); background: transparent;
  color: var(--px-text-muted); font-weight: 550; cursor: pointer;
  transition: background var(--px-dur-fast) var(--px-ease), color var(--px-dur-fast) var(--px-ease);
}
.fc-crumb--link:hover { background: var(--px-surface-hover); color: var(--px-text); }
.fc-crumb--link:focus-visible { outline: none; box-shadow: var(--px-ring-accent); }
.fc-crumb__sep { color: var(--px-text-disabled); font-size: var(--px-text-sm); user-select: none; }
.fc-pane__spacer { flex: 1; }
.fc-pane__body { flex: 1; overflow-y: auto; }

/* Canvas-margin model (mirrors .canvas-full-width): the GUTTERS are the
   constant and the measure is fluid — content stretches to fill the space
   between defined margins instead of squeezing into a fixed column. Wide
   panes grow the gutters, like canvas, so lines stay readable. */
.fc-view, .fc-study {
  --fc-gutter: clamp(28px, 4vw, 72px);
  /* The study stage is wider than a lone card was (920px) because it now
     carries a rail beside it; the card itself keeps its own max-width. */
  --fc-stage-w: 1240px;
  --fc-rail-w: 268px;
}
.fc-view { max-width: none; margin: 0; padding: var(--px-space-6) var(--fc-gutter) var(--px-space-8); }
@media (min-width: 1441px) {
  .fc-view, .fc-study { --fc-gutter: clamp(72px, 8vw, 160px); }
}
.fc-empty { padding: var(--px-space-8) var(--px-space-4); text-align: center; font-size: var(--px-text-base); color: var(--px-text-muted); }

/* ── Decks home — the landing surface. A masthead, today's ask, the actions
   that start work, then the decks. Same editorial voice as the rest of the
   tool: space and weight carry hierarchy, signal hues only on counts. ── */
.fc-home__head {
  display: flex; align-items: flex-end; gap: var(--px-space-3);
  padding-bottom: var(--px-space-3); border-bottom: 1px solid var(--px-divider);
}
.fc-home__head-text { flex: 1; min-width: 0; }
.fc-home__title {
  font-size: var(--px-text-xl); font-weight: 700; letter-spacing: -0.02em;
  line-height: 1.15; color: var(--px-text);
}
.fc-home__sub {
  margin-top: 3px; font-size: var(--px-text-sm); color: var(--px-text-muted);
  font-variant-numeric: tabular-nums;
}
.fc-home__today {
  display: flex; align-items: center; gap: var(--px-space-6); flex-wrap: wrap;
  padding: var(--px-space-4) 0; border-bottom: 1px solid var(--px-divider);
}
.fc-home__stats { display: flex; align-items: stretch; gap: var(--px-space-5); }
.fc-home__stat { display: flex; flex-direction: column; gap: 2px; min-width: 54px; }
.fc-home__num {
  font-size: var(--px-text-xl); font-weight: 680; line-height: 1;
  letter-spacing: -0.02em; font-variant-numeric: tabular-nums; color: var(--px-text);
}
.fc-home__num--zero { color: var(--px-text-disabled); }
.fc-home__num--new { color: var(--px-accent); }
.fc-home__num--learn { color: var(--px-warning); }
.fc-home__num--due { color: var(--px-success); }
.fc-home__stat-lbl {
  font-size: var(--px-text-2xs); text-transform: uppercase; letter-spacing: 0.07em;
  color: var(--px-text-muted);
}
.fc-home__cta { display: flex; align-items: center; gap: var(--px-space-2); flex-wrap: wrap; }
.fc-home__cta .fc-btn { height: 32px; }
.fc-home__behind { font-size: var(--px-text-xs); color: var(--px-text-muted); font-variant-numeric: tabular-nums; }
.fc-home__actions { margin-top: var(--px-space-4); }
.fc-home__decks { display: flex; flex-direction: column; }

/* Deck rows on the home page: identity and counts on the left, the actions
   that operate on that deck on the right — visible, not hover-revealed. A
   home page whose actions only appear on hover is not a home page. */
.fc-deck-card__counts { display: flex; align-items: baseline; gap: var(--px-space-4); margin-top: var(--px-space-2); }
.fc-deck-count { display: inline-flex; align-items: baseline; gap: 5px; }
.fc-deck-count__n { font-size: var(--px-text-md); font-weight: 650; font-variant-numeric: tabular-nums; letter-spacing: -0.01em; }
.fc-deck-count__n--zero { color: var(--px-text-disabled); }
.fc-deck-count__n--new { color: var(--px-accent); }
.fc-deck-count__n--due { color: var(--px-success); }
.fc-deck-count__n--total { color: var(--px-text); }
.fc-deck-count__l { font-size: var(--px-text-2xs); text-transform: uppercase; letter-spacing: 0.07em; color: var(--px-text-muted); }

.fc-deck-card {
  display: flex; align-items: center; gap: var(--px-space-3);
  padding: var(--px-space-4) var(--px-space-1);
  border-bottom: 1px solid var(--px-divider);
}
.fc-deck-card:last-child { border-bottom: 0; }
.fc-deck-card__info { flex: 1; min-width: 0; cursor: pointer; border-radius: var(--px-radius-sm); }
.fc-deck-card__info:focus-visible { outline: none; box-shadow: var(--px-ring-accent); }
.fc-deck-card__name { font-size: var(--px-text-md); font-weight: 600; letter-spacing: -0.01em; color: var(--px-text); }
.fc-deck-card__meta { font-size: var(--px-text-xs); color: var(--px-text-muted); font-variant-numeric: tabular-nums; margin-top: 3px; }
.fc-exam-chip {
  display: inline-block; margin-left: var(--px-space-2); padding: 1px 7px;
  font-size: var(--px-text-xs); font-weight: 600; letter-spacing: 0.01em;
  color: var(--px-accent); background: var(--px-accent-soft);
  border-radius: var(--px-radius-full, 999px); vertical-align: 2px;
  font-variant-numeric: tabular-nums;
  border: 0; font-family: inherit; cursor: pointer;
  transition: background var(--px-dur-fast) var(--px-ease);
}
button.fc-exam-chip:hover { background: var(--px-accent-faint); }

/* ── Exam-date dialogs (M101) — centered mini-modal, portal above every
   workbench layer (popup contract: >= 10005) ── */
/* Scrim matches the core modal overlay (notificationService.css). */
.fc-datedlg-overlay {
  position: fixed; inset: 0; z-index: 10010;
  display: flex; align-items: center; justify-content: center;
  background: rgba(0, 0, 0, 0.5);
  backdrop-filter: blur(3px);
}
.fc-datedlg {
  width: min(360px, calc(100vw - 48px)); max-height: min(80vh, 640px);
  overflow-y: auto; box-sizing: border-box;
  padding: var(--px-space-4);
  background: var(--px-bg-elevated); color: var(--px-text);
  border: 1px solid var(--px-border); border-radius: var(--px-radius-lg);
  box-shadow: var(--px-shadow-lg);
  display: flex; flex-direction: column; gap: var(--px-space-3);
}
.fc-datedlg__title { font-size: var(--px-text-md); font-weight: 650; letter-spacing: -0.01em; }
.fc-datedlg__foot { display: flex; gap: var(--px-space-2); justify-content: flex-end; }
.fc-datedlg__decks {
  display: flex; flex-direction: column; gap: 2px;
  max-height: 180px; overflow-y: auto;
  border: 1px solid var(--px-divider); border-radius: var(--px-radius-md);
  padding: var(--px-space-1) var(--px-space-2);
}
.fc-datedlg__deck { justify-content: flex-start; padding: 3px 0; }
.fc-datedlg__deck > span:nth-of-type(1) { flex: 1; min-width: 0; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.fc-datedlg__deckdate { color: var(--px-text-faint); font-size: var(--px-text-xs); font-variant-numeric: tabular-nums; }

/* ── Month-grid calendar ── */
.fc-cal { user-select: none; }
.fc-cal__head { display: flex; align-items: center; gap: var(--px-space-2); margin-bottom: var(--px-space-2); }
.fc-cal__label { flex: 1; text-align: center; font-size: var(--px-text-base); font-weight: 600; }
.fc-cal__nav {
  display: inline-flex; align-items: center; justify-content: center;
  width: 26px; height: 26px; border: 1px solid var(--px-border); border-radius: var(--px-radius-md);
  background: transparent; color: var(--px-text-muted); cursor: pointer;
  transition: background var(--px-dur-fast) var(--px-ease), color var(--px-dur-fast) var(--px-ease);
}
.fc-cal__nav:hover { background: var(--px-surface-hover); color: var(--px-text); }
.fc-cal__dow {
  display: grid; grid-template-columns: repeat(7, 1fr); text-align: center;
  font-size: var(--px-text-xs); font-weight: 600; color: var(--px-text-faint);
  margin-bottom: 2px;
}
.fc-cal__grid { display: grid; grid-template-columns: repeat(7, 1fr); gap: 2px; }
.fc-cal__pad { min-height: 30px; }
.fc-cal__day {
  min-height: 30px; border: 0; border-radius: var(--px-radius-md);
  background: transparent; color: var(--px-text);
  font: inherit; font-size: var(--px-text-sm); font-variant-numeric: tabular-nums;
  cursor: pointer; transition: background var(--px-dur-fast) var(--px-ease);
}
.fc-cal__day:hover:not(:disabled) { background: var(--px-surface-hover); }
.fc-cal__day--past { color: var(--px-text-faint); cursor: default; }
.fc-cal__day--today { box-shadow: inset 0 0 0 1px var(--px-border-strong); }
.fc-cal__day--selected { background: var(--px-accent-soft); color: var(--px-accent); font-weight: 650; }
.fc-cal__day--selected:hover:not(:disabled) { background: var(--px-accent-faint); }

.fc-input--importance { width: 88px; flex: 0 0 auto; }
.fc-deck-card__actions { display: flex; align-items: center; gap: var(--px-space-1); flex: 0 0 auto; }
.fc-view__title { font-size: var(--px-text-lg); font-weight: 650; letter-spacing: -0.01em; color: var(--px-text); }

/* ── Forms — sentence-case labels (no shouting), quiet inset inputs ── */
.fc-form { display: flex; flex-direction: column; gap: var(--px-space-1); }
.fc-label {
  font-size: var(--px-text-xs); font-weight: 600;
  color: var(--px-text-muted); margin-top: var(--px-space-3);
}
.fc-input, .fc-textarea {
  width: 100%; box-sizing: border-box; padding: 7px 10px;
  border: 1px solid var(--px-border); border-radius: var(--px-radius-md);
  background: var(--px-bg-inset); color: var(--px-text);
  font: inherit; font-size: var(--px-text-base);
  transition: border-color var(--px-dur-fast) var(--px-ease), box-shadow var(--px-dur-fast) var(--px-ease);
}
.fc-textarea { resize: vertical; min-height: 64px; line-height: var(--px-leading-base); }
.fc-input:focus, .fc-textarea:focus { outline: none; border-color: var(--px-accent); box-shadow: 0 0 0 3px var(--px-accent-faint); }
.fc-input::placeholder, .fc-textarea::placeholder { color: var(--px-text-faint); }
.fc-row { display: flex; gap: var(--px-space-2); align-items: center; flex-wrap: wrap; }
.fc-error { font-size: var(--px-text-sm); color: var(--px-danger); padding: var(--px-space-1) 0; }
.fc-hint { font-size: var(--px-text-sm); color: var(--px-text-muted); }
.fc-check { display: flex; align-items: center; gap: var(--px-space-2); font-size: var(--px-text-sm); color: var(--px-text-secondary); cursor: pointer; user-select: none; }

/* ── Create-tab drop zone — the default, in-workspace way to add a source ── */
.fc-dropzone {
  display: flex; flex-direction: column; align-items: center; justify-content: center; gap: 4px;
  padding: var(--px-space-6) var(--px-space-4); margin-top: var(--px-space-1);
  border: 1px dashed var(--px-border-strong); border-radius: var(--px-radius-lg);
  background: var(--px-bg-inset); color: var(--px-text-muted); text-align: center;
  transition: border-color var(--px-dur-fast) var(--px-ease), background var(--px-dur-fast) var(--px-ease), color var(--px-dur-fast) var(--px-ease);
}
.fc-dropzone__icon { display: inline-flex; color: var(--px-text-faint); }
.fc-dropzone__icon svg { width: 20px; height: 20px; }
.fc-dropzone__title { font-size: var(--px-text-sm); font-weight: 600; color: var(--px-text-secondary); }
.fc-dropzone__hint { font-size: var(--px-text-xs); color: var(--px-text-faint); }
.fc-dropzone--over { border-style: solid; border-color: var(--px-accent); background: var(--px-accent-faint); color: var(--px-text); }
.fc-dropzone--over .fc-dropzone__icon, .fc-dropzone--over .fc-dropzone__title { color: var(--px-text); }
.fc-dropzone--busy { opacity: 0.6; pointer-events: none; }

/* ── Import — preview groups mirror the Browse rows: hairline dividers,
   weight for fronts, muted backs. Deselected groups recede, not vanish. ── */
/* ── Card editor — textarea beside its live-rendered preview; the preview
   carries a hairline divider, not a box, per the editorial identity. ── */
.fc-edit { display: flex; flex-direction: column; gap: var(--px-space-2); padding: var(--px-space-2) 0; }
.fc-edit__row { display: grid; grid-template-columns: 1fr 1fr; gap: var(--px-space-3); align-items: stretch; }
.fc-edit__preview {
  border-left: 1px solid var(--px-divider);
  padding: var(--px-space-1) var(--px-space-3);
  font-size: var(--px-text-sm); line-height: var(--px-leading-base);
  color: var(--px-text); overflow-x: auto; min-height: 40px;
}
.fc-edit__preview--empty { color: var(--px-text-faint); }
.fc-edit__actions { display: flex; align-items: center; gap: var(--px-space-2); margin-top: var(--px-space-1); }
.fc-cardrow--editing:hover .fc-cardrow__actions { opacity: 1; }

.fc-import-group { margin-top: var(--px-space-4); padding-top: var(--px-space-3); border-top: 1px solid var(--px-divider); }
.fc-import-group--off { opacity: 0.45; }
.fc-import-group--done { opacity: 0.55; }
.fc-import-sample { padding: var(--px-space-2) var(--px-space-1); border-bottom: 1px solid var(--px-divider); }
.fc-import-sample__front { font-size: var(--px-text-sm); font-weight: 600; color: var(--px-text); white-space: pre-wrap; }
.fc-import-sample__back { font-size: var(--px-text-sm); margin-top: 2px; color: var(--px-text-muted); white-space: pre-wrap; line-height: var(--px-leading-base); }

/* ── Browse — hairline-separated card rows; the stage chip is the only colour;
   row actions surface on hover ── */
.fc-cardrow {
  display: flex;
  gap: var(--px-space-2);
  padding: var(--px-space-3) var(--px-space-1);
  border-bottom: 1px solid var(--px-divider);
}
.fc-cardrow--suspended { opacity: 0.5; }
.fc-cardrow:hover { background: var(--px-surface-hover); }
/* Selection = wash + left accent rail, the app's selected-row language
   (explorer tree, canvas sidebar). */
.fc-cardrow--selected,
.fc-cardrow--selected:hover { background: var(--px-accent-soft); box-shadow: inset 2px 0 0 var(--px-accent); }
/* Fixed-width left rail holding the card number. */
.fc-cardrow__rail {
  flex: 0 0 26px;
  display: flex; flex-direction: column; align-items: center;
  padding-top: 2px;
}
.fc-cardrow__num {
  font-size: var(--px-text-xs); font-weight: 600; color: var(--px-text-faint);
  font-variant-numeric: tabular-nums;
}
/* The flag reads as a dot under the number, inside the fixed-width rail, so
   it forms a scannable column down a long list. It lives HERE rather than as
   a left edge stripe because selection already owns the row's inset
   box-shadow, and the two would overwrite each other. */
.fc-cardrow__rail::after {
  content: ''; width: 7px; height: 7px; margin-top: 5px; border-radius: 50%;
  background: transparent;
}
.fc-cardrow--flag-red    .fc-cardrow__rail::after { background: rgb(var(--px-red-rgb)); }
.fc-cardrow--flag-amber  .fc-cardrow__rail::after { background: rgb(var(--px-yellow-rgb)); }
.fc-cardrow--flag-green  .fc-cardrow__rail::after { background: rgb(var(--px-green-rgb)); }
.fc-cardrow--flag-blue   .fc-cardrow__rail::after { background: rgb(var(--px-blue-rgb)); }
.fc-cardrow__content { flex: 1; min-width: 0; }

/* Compact view: questions only, one line each; click a question to expand
   that card in place. */
.fc-cardlist--compact .fc-cardrow { padding: 6px var(--px-space-1); }
.fc-cardlist--compact .fc-cardrow:not(.fc-cardrow--expanded) .fc-cardrow__back,
.fc-cardlist--compact .fc-cardrow:not(.fc-cardrow--expanded) .fc-cardrow__notes,
.fc-cardlist--compact .fc-cardrow:not(.fc-cardrow--expanded) .fc-cardrow__meta,
.fc-cardlist--compact .fc-cardrow:not(.fc-cardrow--expanded) .fc-cardrow__actions { display: none; }
.fc-cardlist--compact .fc-cardrow:not(.fc-cardrow--expanded) .fc-cardrow__front {
  display: -webkit-box; -webkit-line-clamp: 1; -webkit-box-orient: vertical;
  overflow: hidden; font-size: var(--px-text-sm);
}
.fc-cardlist--compact .fc-cardrow__front { cursor: pointer; }

/* ── Browse toolbar: search + view-control dropdowns on one row ── */
.fc-browse-toolbar { display: flex; align-items: center; gap: var(--px-space-2); margin: 12px 0 4px; }
.fc-browse-toolbar .fc-input { flex: 1; min-width: 0; }
.fc-browse-toolbar .ui-dropdown { flex: 0 0 auto; }

/* ── Tag bar + bulk bar (Browse) ── */
.fc-tagbar { display: flex; flex-wrap: wrap; gap: var(--px-space-1); margin-bottom: 8px; }
.fc-tagbar:empty { display: none; }
.fc-tagchip { cursor: pointer; border: 1px solid transparent; }
.fc-tagchip:hover { border-color: var(--px-border-strong); }
.fc-tagchip--active { color: var(--px-accent); background: var(--px-accent-soft); border-color: var(--px-accent); }
.fc-bulkbar {
  display: flex; align-items: center; gap: var(--px-space-2);
  padding: var(--px-space-2) var(--px-space-3); margin-bottom: 8px;
  background: var(--px-bg-raised); border: 1px solid var(--px-border);
  border-radius: var(--px-radius-md);
  position: sticky; top: 0; z-index: 5;
}
.fc-bulkbar__count { font-size: var(--px-text-sm); font-weight: 600; color: var(--px-text); }
.fc-cardrow__front { font-size: var(--px-text-base); font-weight: 600; color: var(--px-text); }
.fc-cardrow__back { font-size: var(--px-text-sm); margin-top: 3px; color: var(--px-text-muted); white-space: pre-wrap; line-height: var(--px-leading-base); }
.fc-cardrow__meta { display: flex; flex-wrap: wrap; align-items: center; gap: var(--px-space-3); margin-top: var(--px-space-2); font-size: var(--px-text-xs); color: var(--px-text-muted); font-variant-numeric: tabular-nums; }
.fc-cardrow__actions { display: flex; gap: var(--px-space-1); margin-top: var(--px-space-2); opacity: 0; transition: opacity var(--px-dur-fast) var(--px-ease); }
.fc-cardrow:hover .fc-cardrow__actions,
.fc-cardrow:focus-within .fc-cardrow__actions { opacity: 1; }
.fc-state {
  display: inline-block; font-size: var(--px-text-2xs); font-weight: 700;
  text-transform: uppercase; letter-spacing: 0.04em;
  border-radius: var(--px-radius-sm); padding: 1px 6px;
}
.fc-state--new { background: rgba(var(--px-blue-rgb), 0.15); color: var(--px-info); }
.fc-state--learning, .fc-state--relearning { background: var(--px-warning-soft); color: var(--px-warning); }
.fc-state--review { background: rgba(var(--px-green-rgb), 0.15); color: var(--px-success); }

/* ── Study — the hero. A crisp card floating on the recessed desk. ── */
/* Sized against the PANE, not the viewport — this surface can be a narrow
   split, where a viewport media query would report the wrong width. */
.fc-study { display: flex; height: 100%; container-type: inline-size; }
.fc-study__main { flex: 1; min-width: 0; display: flex; flex-direction: column; align-items: center; padding: var(--px-space-8) var(--fc-gutter); overflow-y: auto; outline: none; background: var(--px-window); }
.fc-study__toolbar { width: 100%; max-width: min(100%, var(--fc-stage-w)); display: flex; align-items: center; gap: var(--px-space-3); margin-bottom: var(--px-space-6); }

/* ── Stage: the cards column + the reference rail ──
   The rail carries what you REFER to (notes, key legend); the column carries
   what you ACT on (cards, grades). Stacking all of it made the eye walk the
   whole page and pushed the grade buttons under the fold on short panes. */
.fc-study__stage {
  width: 100%; max-width: min(100%, var(--fc-stage-w));
  display: flex; flex-wrap: wrap; align-items: flex-start;
  gap: var(--px-space-5);
}
.fc-study__col { flex: 1 1 420px; min-width: 0; display: flex; flex-direction: column; align-items: center; }
.fc-study__rail { flex: 0 1 var(--fc-rail-w); min-width: 0; display: flex; flex-direction: column; gap: var(--px-space-5); }
/* Narrow pane: the rail drops below the cards at full width rather than
   squeezing the card into a column too thin to read. */
@container (max-width: 860px) {
  .fc-study__rail { flex-basis: 100%; }
}
.fc-study__progress { flex: 1; height: 2px; border-radius: var(--px-radius-full); background: var(--px-divider); overflow: hidden; }
.fc-study__progress-fill { height: 100%; border-radius: var(--px-radius-full); background: var(--px-accent); transition: width var(--px-dur-base) var(--px-ease); }
.fc-study__cardactions { display: flex; gap: var(--px-space-1); flex: 0 0 auto; }
.fc-btn--ghost { background: transparent; border-color: transparent; color: var(--px-text-muted); }
.fc-btn--ghost:hover { color: var(--px-text); border-color: var(--px-border-strong); background: transparent; }
/* Square icon button — the toolbar actions are glyphs, so the label lives in
   aria-label/title rather than on screen. */
.fc-btn--icon { width: 28px; padding: 0; justify-content: center; gap: 0; }
.fc-btn--icon svg { width: 15px; height: 15px; }
.fc-study__edit { width: 100%; max-width: min(100%, 920px); }

/* The card is a REAL flashcard: white stock, black ink, square corners,
   index-card proportions — deliberately independent of the app theme, the
   way a physical card sits on any desk. Content-surface hardcodes are the
   point here, not a token violation. */
.fc-card {
  width: 100%; max-width: min(100%, 920px);
  background: #ffffff;
  border: 1px solid #e2e2e2;
  border-radius: 0;
  box-shadow: 0 10px 28px rgba(0, 0, 0, 0.4);
  padding: var(--px-space-6) var(--px-space-6);
  display: flex; flex-direction: column;
}
.fc-card--q { min-height: 340px; animation: fc-card-in var(--px-dur-base) var(--px-ease-out); }
.fc-card--a { min-height: 240px; margin-top: var(--px-space-3); animation: fc-reveal-in var(--px-dur-base) var(--px-ease-spring); }
/* The AI mark sits in the answer card's head row, surfacing on hover — and on
   focus-within, because a hover-only control does not exist for the keyboard.
   Hidden with opacity rather than display so it holds its space and revealing
   it never reflows the head. It rides the card's fixed WHITE stock, so it has
   to read against white in both themes; px-ai-btn is alpha-over-surface
   accent, which does. */
.fc-card__ai {
  display: inline-flex; flex: 0 0 auto;
  opacity: 0; transition: opacity var(--px-dur-fast) var(--px-ease);
}
/* focus-within covers the keyboard: tabbing to the button lights the card,
   which reveals the wrapper. A rule on the button itself could not work —
   opacity on the parent cannot be undone by a child. */
.fc-card--a:hover .fc-card__ai,
.fc-card--a:focus-within .fc-card__ai { opacity: 1; }
/* The face centers vertically like writing on an index card. */
.fc-card__body { flex: 1; display: flex; flex-direction: column; justify-content: center; }
@keyframes fc-card-in {
  from { opacity: 0; transform: translateY(6px); }
  to   { opacity: 1; transform: translateY(0); }
}
@keyframes fc-reveal-in {
  from { opacity: 0; transform: translateY(8px) scale(0.99); }
  to   { opacity: 1; transform: translateY(0) scale(1); }
}
.fc-card__head {
  display: flex; justify-content: space-between; align-items: center;
  font-size: var(--px-text-2xs); font-weight: 700; text-transform: uppercase; letter-spacing: 0.09em;
  color: #9a9a9a; font-variant-numeric: tabular-nums;
  margin-bottom: var(--px-space-4);
}
/* M98 leech loop — chip + action live in the answer card's head row.
   Hex is CORRECT here: the card face is a fixed WHITE physical card in both
   app modes (deliberate design), so its inks never follow the theme. */
.fc-card__leech {
  margin-left: auto; margin-right: var(--px-space-2); padding: 1px 7px;
  font-size: var(--px-text-2xs); font-weight: 700; letter-spacing: 0.05em;
  color: #a05a00; background: #fff3e0; border: 1px solid #f0ddc0;
  border-radius: var(--px-radius-full, 999px); text-transform: none;
}
.fc-btn--small { padding: 2px 9px; font-size: var(--px-text-xs); text-transform: none; letter-spacing: normal; font-weight: 500; }
.fc-meta-leech { color: var(--px-warning); font-weight: 600; }
/* Card ink is a book serif: printed-card text, not UI chrome. It matches
   KaTeX's serif math, so "the estimate $L(x)$" reads as ONE sentence instead
   of sans colliding with serif math. The question keeps its bold, but bold
   SERIF carries stroke contrast — emphasis without the slab-blocky mass the
   old 650-weight sans had. */
.fc-card__body {
  font-family: Charter, 'Bitstream Charter', 'Sitka Text', Cambria, Georgia, 'Times New Roman', serif;
  font-size: var(--px-text-md); line-height: var(--px-leading-base); color: #111111;
}
.fc-card--q .fc-card__body { font-size: var(--px-text-xl); font-weight: 700; line-height: 1.35; }
.fc-card__source { margin-top: var(--px-space-4); padding-top: var(--px-space-3); border-top: 1px solid #ececec; font-size: var(--px-text-2xs); color: #9a9a9a; }
.fc-card__source--link { cursor: pointer; text-decoration: underline; text-decoration-color: #d5d5d5; text-underline-offset: 2px; }
.fc-card__source--link:hover { color: #555555; text-decoration-color: #9a9a9a; }
/* Light-surface treatments for markdown furniture on the white card. */
.fc-card .px-markdown code { background: #f2f2f2; color: #111111; }
.fc-card .px-markdown pre { background: #f6f6f6; border-color: #e2e2e2; color: #111111; }
.fc-card .px-markdown blockquote { border-left-color: #d9d9d9; color: #4a4a4a; }
.fc-card .px-markdown a { color: #1d4ed8; }
.fc-study__answer-host { width: 100%; max-width: min(100%, 920px); }

.fc-study__controls { display: flex; gap: var(--px-space-1); margin-top: var(--px-space-6); justify-content: center; width: 100%; max-width: min(100%, 920px); }

/* Grade buttons — borderless columns with a signal dot; the colour fills on hover. */
.fc-grade {
  flex: 1; display: flex; flex-direction: column; align-items: center; gap: 3px;
  padding: var(--px-space-3) 0 var(--px-space-2);
  border: 0; border-radius: var(--px-radius-md);
  background: transparent; color: var(--px-text-secondary);
  font: inherit; font-size: var(--px-text-sm); font-weight: 650; cursor: pointer;
  transition: background var(--px-dur-fast) var(--px-ease), color var(--px-dur-fast) var(--px-ease), transform var(--px-dur-instant) var(--px-ease);
}
.fc-grade:hover { background: var(--px-surface-hover); color: var(--px-text); }
.fc-grade:active { transform: var(--px-press); }
.fc-grade__dot { width: 6px; height: 6px; border-radius: var(--px-radius-full); margin-bottom: 1px; }
.fc-grade__ivl { font-size: var(--px-text-2xs); font-weight: 500; color: var(--px-text-faint); font-variant-numeric: tabular-nums; }
.fc-grade--again .fc-grade__dot { background: var(--px-danger); }
.fc-grade--hard  .fc-grade__dot { background: var(--px-warning); }
.fc-grade--good  .fc-grade__dot { background: var(--px-success); }
.fc-grade--easy  .fc-grade__dot { background: var(--px-info); }
.fc-grade--again:hover { background: var(--px-danger-soft); color: var(--px-danger); }
.fc-grade--hard:hover  { background: var(--px-warning-soft); color: var(--px-warning); }
.fc-grade--good:hover  { background: rgba(var(--px-green-rgb), 0.15); color: var(--px-success); }
.fc-grade--easy:hover  { background: rgba(var(--px-blue-rgb), 0.15); color: var(--px-info); }
.fc-study__reveal { margin-top: var(--px-space-6); height: 32px; padding: 0 var(--px-space-6); }
/* Sits beside the primary action on the same baseline, quieter by weight. */
.fc-study__skip { margin-top: var(--px-space-6); height: 32px; padding: 0 var(--px-space-4); flex: none; }

/* ── Production recall (M102) ──────────────────────────────────────────────
   The answer box sits where the answer card will land, so submitting reads
   as the page continuing rather than as a panel being swapped out. */
.fc-meta-recall { color: var(--px-info); font-weight: 600; }
.fc-cardrow__history { margin-top: var(--px-space-2); }
.fc-answers { display: flex; flex-direction: column; gap: var(--px-space-2); }
.fc-answers__entry {
  border-left: 2px solid var(--px-border); padding-left: var(--px-space-3);
}
.fc-answers__head { display: flex; align-items: center; gap: var(--px-space-2); margin-bottom: 2px; }
.fc-answers__grade { font-size: var(--px-text-2xs); font-weight: 700; text-transform: uppercase; letter-spacing: 0.06em; }
.fc-answers__grade--again { color: var(--px-danger); }
.fc-answers__grade--hard  { color: var(--px-warning); }
.fc-answers__grade--good  { color: var(--px-success); }
.fc-answers__grade--easy  { color: var(--px-info); }
.fc-answers__when, .fc-answers__score { font-size: var(--px-text-2xs); color: var(--px-text-faint); font-variant-numeric: tabular-nums; }
.fc-answers__flag { font-size: var(--px-text-2xs); color: var(--px-danger); }
/* pre-wrap: a typed answer's line breaks ARE its structure, especially a list. */
.fc-answers__text {
  font-size: var(--px-text-xs); color: var(--px-text-secondary);
  white-space: pre-wrap; line-height: var(--px-leading-base);
}
.fc-answers__note { font-size: var(--px-text-2xs); color: var(--px-text-faint); margin-top: 2px; }
.fc-edit__rubric { margin-top: var(--px-space-3); }
.fc-edit__rubric .fc-textarea { width: 100%; box-sizing: border-box; resize: vertical; }
.fc-study__produce { width: 100%; max-width: min(100%, 920px); margin-top: var(--px-space-5); text-align: left; }
.fc-study__produce-label {
  font-size: var(--px-text-2xs); font-weight: 700; text-transform: uppercase;
  letter-spacing: 0.07em; color: var(--px-text-faint); margin-bottom: 4px;
}
.fc-study__produce-input { width: 100%; box-sizing: border-box; resize: vertical; line-height: var(--px-leading-relaxed); }
.fc-study__produce-input[readonly] { opacity: 0.72; cursor: default; }

.fc-verdict {
  width: 100%; box-sizing: border-box; margin-top: var(--px-space-3);
  padding: var(--px-space-3) var(--px-space-4);
  border: 1px solid var(--px-border); border-left-width: 3px;
  border-radius: var(--px-radius-md); background: var(--px-surface-raised);
  text-align: left;
}
.fc-verdict--again { border-left-color: var(--px-danger); }
.fc-verdict--hard  { border-left-color: var(--px-warning); }
.fc-verdict--good  { border-left-color: var(--px-success); }
.fc-verdict--easy  { border-left-color: var(--px-info); }
.fc-verdict--pending, .fc-verdict--fallback { display: flex; align-items: center; gap: var(--px-space-2); }

.fc-verdict__head { display: flex; align-items: center; gap: var(--px-space-2); margin-bottom: var(--px-space-2); }
.fc-verdict__dot { width: 6px; height: 6px; border-radius: var(--px-radius-full); background: currentColor; flex: none; }
.fc-verdict--again .fc-verdict__dot { background: var(--px-danger); }
.fc-verdict--hard  .fc-verdict__dot { background: var(--px-warning); }
.fc-verdict--good  .fc-verdict__dot { background: var(--px-success); }
.fc-verdict--easy  .fc-verdict__dot { background: var(--px-info); }
.fc-verdict__rating { font-size: var(--px-text-sm); font-weight: 650; color: var(--px-text); }
.fc-verdict__score { font-size: var(--px-text-xs); color: var(--px-text-faint); font-variant-numeric: tabular-nums; }
.fc-verdict__unsourced {
  font-size: var(--px-text-2xs); font-weight: 600; color: var(--px-text-faint);
  border: 1px solid var(--px-border); border-radius: var(--px-radius-sm);
  padding: 0 5px; line-height: 16px; cursor: help;
}
.fc-verdict__contradiction {
  font-size: var(--px-text-xs); color: var(--px-danger);
  margin-bottom: var(--px-space-2); line-height: var(--px-leading-base);
}
.fc-verdict__points { display: flex; flex-direction: column; gap: 5px; }
.fc-verdict__point { display: flex; gap: var(--px-space-2); align-items: baseline; }
.fc-verdict__glyph { flex: none; width: 12px; font-size: var(--px-text-xs); font-weight: 700; text-align: center; }
.fc-verdict__point--hit     .fc-verdict__glyph { color: var(--px-success); }
.fc-verdict__point--partial .fc-verdict__glyph { color: var(--px-warning); }
.fc-verdict__point--miss    .fc-verdict__glyph { color: var(--px-danger); }
.fc-verdict__point-body { display: flex; flex-direction: column; gap: 1px; }
.fc-verdict__point-text { font-size: var(--px-text-xs); color: var(--px-text-secondary); line-height: var(--px-leading-base); }
.fc-verdict__point--miss .fc-verdict__point-text { color: var(--px-text); }
.fc-verdict__point-note { font-size: var(--px-text-2xs); color: var(--px-text-faint); line-height: var(--px-leading-base); }
.fc-verdict__note {
  font-size: var(--px-text-xs); color: var(--px-text-secondary);
  margin-top: var(--px-space-2); padding-top: var(--px-space-2);
  border-top: 1px solid var(--px-border-subtle); line-height: var(--px-leading-base);
}
.fc-verdict__foot { margin-top: var(--px-space-3); }
.fc-answers__discuss { margin-left: auto; }
.fc-verdict--pending .fc-verdict__pending-text, .fc-verdict--fallback .fc-verdict__note {
  margin: 0; padding: 0; border: 0; font-size: var(--px-text-xs); color: var(--px-text-faint);
}
.fc-verdict__spinner {
  width: 11px; height: 11px; flex: none; border-radius: var(--px-radius-full);
  border: 2px solid var(--px-border); border-top-color: var(--px-text-faint);
  animation: fc-verdict-spin 620ms linear infinite;
}
@keyframes fc-verdict-spin { to { transform: rotate(360deg); } }
@media (prefers-reduced-motion: reduce) { .fc-verdict__spinner { animation-duration: 2s; } }
/* Rail contents — quiet, left-aligned, full-width within the rail. */
.fc-study__keys {
  font-size: var(--px-text-xs); color: var(--px-text-faint);
  line-height: var(--px-leading-base); text-align: left;
}
.fc-study__notes { width: 100%; text-align: left; }
.fc-study__notes-label { font-size: var(--px-text-2xs); font-weight: 700; text-transform: uppercase; letter-spacing: 0.07em; color: var(--px-text-faint); margin-bottom: 4px; }
.fc-study__notes-input { width: 100%; box-sizing: border-box; min-height: 132px; resize: vertical; }
.fc-cardrow__notes { font-size: var(--px-text-xs); color: var(--px-text-muted); font-style: italic; margin-top: 2px; }
.fc-study__done { text-align: center; padding: var(--px-space-8) var(--px-space-5); }
.fc-study__done .fc-btn { margin-top: var(--px-space-4); }
/* Adjacent inline-flex buttons carry no whitespace node between them. */
.fc-study__done .fc-btn + .fc-btn { margin-left: var(--px-space-2); }
.fc-study__more { margin-top: var(--px-space-2); }

/* ── Card flags — four swatches, one control, everywhere they appear.
   The hues are the theme's four existing signal tokens, so flags inherit
   light/dark automatically and introduce no palette of their own. ── */
.fc-flags { display: inline-flex; align-items: center; gap: 5px; }
.fc-flag {
  flex: 0 0 auto; width: 15px; height: 15px; padding: 0;
  border: 1.5px solid var(--px-border-strong); border-radius: 50%;
  background: transparent; cursor: pointer; opacity: 0.5;
  transition: opacity var(--px-dur-fast) var(--px-ease), background var(--px-dur-fast) var(--px-ease), transform var(--px-dur-instant) var(--px-ease);
}
.fc-flags--compact { gap: 4px; }
.fc-flags--compact .fc-flag { width: 12px; height: 12px; }
.fc-flag:hover { opacity: 1; }
.fc-flag:active { transform: var(--px-press); }
.fc-flag:focus-visible { outline: none; box-shadow: var(--px-ring-accent); }
.fc-flag--on { opacity: 1; }
.fc-flag--red   { border-color: rgb(var(--px-red-rgb)); }
.fc-flag--amber { border-color: rgb(var(--px-yellow-rgb)); }
.fc-flag--green { border-color: rgb(var(--px-green-rgb)); }
.fc-flag--blue  { border-color: rgb(var(--px-blue-rgb)); }
.fc-flag--red.fc-flag--on   { background: rgb(var(--px-red-rgb)); }
.fc-flag--amber.fc-flag--on { background: rgb(var(--px-yellow-rgb)); }
.fc-flag--green.fc-flag--on { background: rgb(var(--px-green-rgb)); }
.fc-flag--blue.fc-flag--on  { background: rgb(var(--px-blue-rgb)); }

/* Flag filter chips (browse + custom study) reuse the tag-chip mechanics;
   only the leading dot carries the hue, so an active chip still reads with
   the accent wash every other filter uses. */
.fc-flagbar { margin-bottom: var(--px-space-1); }
.fc-flagchip { display: inline-flex; align-items: center; }
.fc-flag-dot { width: 7px; height: 7px; margin-right: 5px; border-radius: 50%; flex: 0 0 auto; }
.fc-flag-dot--red   { background: rgb(var(--px-red-rgb)); }
.fc-flag-dot--amber { background: rgb(var(--px-yellow-rgb)); }
.fc-flag-dot--green { background: rgb(var(--px-green-rgb)); }
.fc-flag-dot--blue  { background: rgb(var(--px-blue-rgb)); }
.fc-bulkbar__sep { width: 1px; height: 18px; background: var(--px-divider); margin: 0 var(--px-space-1); }
/* The study toolbar's flag control sits with Undo/Edit/Delete. */
.fc-study__cardactions .fc-flags { margin-right: var(--px-space-2); }

/* ── Custom Study — the work-ahead path. The mode list is the page's one
   piece of structure; everything else is the same quiet form as Create. ── */
.fc-study__mode {
  display: flex; align-items: baseline; gap: var(--px-space-2);
  width: 100%; max-width: min(100%, 920px); margin: 0 auto var(--px-space-2);
  padding-bottom: var(--px-space-2); border-bottom: 1px solid var(--px-divider);
  text-align: left;
}
.fc-study__mode-name { font-size: var(--px-text-2xs); font-weight: 700; text-transform: uppercase; letter-spacing: 0.07em; color: var(--px-accent); }
.fc-study__mode-meta { font-size: var(--px-text-xs); color: var(--px-text-faint); }
.fc-cs { max-width: 640px; }
.fc-cs__modes { display: flex; flex-direction: column; gap: var(--px-space-1); }
.fc-cs__mode {
  display: flex; align-items: flex-start; gap: var(--px-space-3);
  padding: var(--px-space-3); text-align: left;
  border: 1px solid var(--px-border); border-radius: var(--px-radius-md);
  background: transparent; color: inherit; font: inherit; cursor: pointer;
  transition: background var(--px-dur-fast) var(--px-ease), border-color var(--px-dur-fast) var(--px-ease);
}
.fc-cs__mode:hover { background: var(--px-surface-hover); border-color: var(--px-border-strong); }
.fc-cs__mode:focus-visible { outline: none; box-shadow: var(--px-ring-accent); }
.fc-cs__mode--active { border-color: var(--px-accent); background: var(--px-accent-soft); }
.fc-cs__mode-dot {
  flex: 0 0 auto; width: 12px; height: 12px; margin-top: 3px;
  border: 1px solid var(--px-border-strong); border-radius: 50%;
  transition: border-color var(--px-dur-fast) var(--px-ease), box-shadow var(--px-dur-fast) var(--px-ease);
}
.fc-cs__mode--active .fc-cs__mode-dot { border-color: var(--px-accent); box-shadow: inset 0 0 0 3px var(--px-accent); }
.fc-cs__mode-text { display: flex; flex-direction: column; gap: 2px; min-width: 0; flex: 1; }
/* The count sits on the row's baseline, right-aligned: four of these read as
   a column you can scan for "where are my cards". */
.fc-cs__mode-namerow { display: flex; align-items: baseline; gap: var(--px-space-3); }
.fc-cs__mode-name { font-size: var(--px-text-base); font-weight: 600; color: var(--px-text); flex: 1; min-width: 0; }
.fc-cs__mode-count {
  flex: 0 0 auto; font-size: var(--px-text-sm); font-weight: 650;
  color: var(--px-accent); font-variant-numeric: tabular-nums;
}
.fc-cs__mode-count--zero { color: var(--px-text-disabled); font-weight: 550; }
.fc-cs__mode-blurb { font-size: var(--px-text-sm); color: var(--px-text-muted); line-height: var(--px-leading-base); }
.fc-cs__fields { display: flex; gap: var(--px-space-4); align-items: flex-end; }
.fc-cs__field { flex: 0 1 180px; }
.fc-cs__field .fc-label { margin-top: var(--px-space-3); }
.fc-cs__avail { margin-top: var(--px-space-4); font-size: var(--px-text-sm); color: var(--px-text-secondary); font-variant-numeric: tabular-nums; }
.fc-cs__avail--empty { color: var(--px-text-faint); }
.fc-cs__actions { margin-top: var(--px-space-3); }

/* ── Stats — typographic, not boxed. Big tabular numerals over faint eyebrows,
   separated by whitespace; one restrained review histogram on a baseline. ── */
.fc-stats-grid { display: grid; grid-template-columns: repeat(auto-fit, minmax(120px, 1fr)); gap: var(--px-space-5) var(--px-space-4); margin-bottom: var(--px-space-6); }
.fc-stat__value { font-size: var(--px-text-xl); font-weight: 700; letter-spacing: -0.02em; color: var(--px-text); font-variant-numeric: tabular-nums; }
.fc-stat__label { font-size: var(--px-text-2xs); font-weight: 700; text-transform: uppercase; letter-spacing: 0.07em; color: var(--px-text-faint); margin-top: 3px; }
.fc-chart { display: flex; align-items: flex-end; gap: 3px; height: 96px; margin: var(--px-space-2) 0 var(--px-space-1); padding-bottom: var(--px-space-2); border-bottom: 1px solid var(--px-divider); }
.fc-chart__bar { flex: 1; min-width: 3px; border-radius: 2px 2px 0 0; background: var(--px-surface-active); transition: background var(--px-dur-fast) var(--px-ease); }
.fc-chart__bar:hover { background: var(--px-accent); }
.fc-chart__bar--empty { background: var(--px-divider); height: 2px !important; }
.fc-chart__bar--today { background: var(--px-accent); }
.fc-chart-caption { font-size: var(--px-text-xs); color: var(--px-text-faint); font-variant-numeric: tabular-nums; margin-top: var(--px-space-1); }
.fc-chart__bar--forecast { background: var(--px-accent-soft); }
.fc-answermix { display: flex; height: 10px; border-radius: var(--px-radius-full); overflow: hidden; gap: 1px; }
.fc-answermix__seg--again { background: var(--px-danger); }
.fc-answermix__seg--hard { background: var(--px-warning); }
.fc-answermix__seg--good { background: var(--px-success); }
.fc-answermix__seg--easy { background: var(--px-info, var(--px-accent)); }
.fc-answermix__legend { display: flex; gap: var(--px-space-4); margin-top: var(--px-space-2); font-size: var(--px-text-xs); color: var(--px-text-muted); font-variant-numeric: tabular-nums; }
.fc-answermix__key { display: inline-flex; align-items: center; gap: 5px; }
.fc-answermix__dot { width: 8px; height: 8px; border-radius: 50%; display: inline-block; }
.fc-decktable { display: flex; flex-direction: column; }
.fc-decktable__row { display: grid; grid-template-columns: 1fr 70px 70px 70px 100px; gap: var(--px-space-2); padding: 6px 0; border-bottom: 1px solid var(--px-divider); font-size: var(--px-text-sm); color: var(--px-text-secondary); font-variant-numeric: tabular-nums; }
.fc-decktable__row--head { font-size: var(--px-text-2xs); font-weight: 700; text-transform: uppercase; letter-spacing: 0.07em; color: var(--px-text-faint); }
.fc-decktable__name { color: var(--px-text); font-weight: 600; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.fc-decktable__due { color: var(--px-accent); font-weight: 600; }

/* ── AI-generation review rows — hairline separated, not wells ── */
.fc-genrow {
  display: flex; gap: var(--px-space-2); align-items: flex-start;
  padding: var(--px-space-3) var(--px-space-1);
  border-bottom: 1px solid var(--px-divider);
  transition: opacity var(--px-dur-base) var(--px-ease);
}
.fc-genrow__fields { flex: 1; display: flex; flex-direction: column; gap: var(--px-space-1); }
.fc-genrow--dropped { opacity: 0.4; }
.fc-genrow__chips { display: flex; gap: var(--px-space-1); flex-wrap: wrap; }

/* ── Multi-source chips (Create + Coverage) ── */
.fc-srcchips { flex-wrap: wrap; gap: var(--px-space-1); }
.fc-srcchips:empty { display: none; }
.fc-srcchip { display: inline-flex; align-items: center; gap: 4px; }
.fc-srcchip__remove {
  border: none; background: transparent; color: var(--px-text-muted);
  cursor: pointer; font-size: var(--px-text-sm); padding: 0 2px; line-height: 1;
}
.fc-srcchip__remove:hover { color: var(--px-danger); }

/* ── Find Duplicates groups ── */
.fc-dupgroup {
  border: 1px solid var(--px-border); border-radius: var(--px-radius-md);
  padding: var(--px-space-3); margin-bottom: var(--px-space-3);
  display: flex; flex-direction: column; gap: var(--px-space-2);
}
.fc-dupgroup--resolved { opacity: 0.5; }
/* Cleared-by-the-judge section (M101): distinct verdicts collapse out of the
   triage flow behind a toggle. */
.fc-dupcleared {
  margin-top: var(--px-space-4); padding-top: var(--px-space-3);
  border-top: 1px solid var(--px-divider);
  display: flex; flex-direction: column; gap: var(--px-space-2); align-items: flex-start;
}
.fc-dupcleared > div:last-child { align-self: stretch; }
.fc-duprow { display: flex; gap: var(--px-space-3); align-items: flex-start; padding: var(--px-space-2) 0; border-top: 1px solid var(--px-divider); }
.fc-duprow--staged { opacity: 0.45; }
.fc-duprow__check { flex: 0 0 auto; font-size: var(--px-text-xs); color: var(--px-text-muted); display: inline-flex; align-items: center; gap: 4px; padding-top: 2px; cursor: pointer; }
.fc-duprow__body { flex: 1; min-width: 0; }
.fc-duprow__front { font-size: var(--px-text-sm); font-weight: 600; color: var(--px-text); }
.fc-duprow__back { font-size: var(--px-text-sm); color: var(--px-text-secondary); margin-top: 2px; }
.fc-duprow__meta { font-size: var(--px-text-xs); color: var(--px-text-faint); margin-top: 3px; }

/* ── Coverage report ── */
.fc-coverage-report {
  font-size: var(--px-text-sm); color: var(--px-text-secondary);
  line-height: var(--px-leading-base);
  border: 1px solid var(--px-border); border-radius: var(--px-radius-md);
  padding: var(--px-space-3) var(--px-space-4); margin-bottom: var(--px-space-3);
}
.fc-chip {
  display: inline-block; padding: 1px 7px; font-size: var(--px-text-xs);
  color: var(--px-text-muted); background: var(--px-bg-inset);
  border: 1px solid var(--px-border); border-radius: var(--px-radius-full, 999px);
  font-variant-numeric: tabular-nums; max-width: 100%; overflow: hidden;
  text-overflow: ellipsis; white-space: nowrap;
}
.fc-chip--warn { color: var(--px-warning, var(--px-text)); border-color: var(--px-warning, var(--px-border-strong)); }
.fc-chip--link { cursor: pointer; }
.fc-chip--link:hover { color: var(--px-accent); border-color: var(--px-accent); }

/* ── Dashboard widget ── */
.fc-widget-due { font-size: var(--px-text-base); line-height: var(--px-leading-base); padding: var(--px-space-1) 2px; color: var(--px-text-secondary); }
.fc-widget-due__big { font-size: var(--px-text-xl); font-weight: 700; letter-spacing: -0.02em; color: var(--px-text); font-variant-numeric: tabular-nums; }
.fc-widget-due .fc-btn { margin-top: var(--px-space-2); }
.fc-widget-due__spark { display: flex; align-items: flex-end; gap: 3px; height: 28px; margin-top: var(--px-space-2); }
.fc-widget-due__bar { width: 10px; border-radius: 2px 2px 0 0; background: var(--px-accent-soft); }
.fc-widget-due__bar--zero { background: var(--px-bg-inset); }
`;
  document.head.appendChild(style);
}

// ═══════════════════════════════════════════════════════════════════════════════
// SECTION 8: NAVIGATION MODEL + SIDEBAR VIEW
// ═══════════════════════════════════════════════════════════════════════════════

/**
 * The tool's top-level destinations, in sidebar order.
 *
 * The SIDEBAR owns this navigation. It used to live only on the editor pane's
 * tab strip, which meant the map was inside the thing it was supposed to map:
 * with no deck open there was no pane, and with no pane there was no way to
 * reach Decks, Stats, Create or Import at all. You had to click a deck (which
 * lands in Browse) and only then find the tabs. Now the destinations sit above
 * the deck list, always one click away, and the pane carries a breadcrumb
 * instead of a second copy of the same navigation.
 */
const FC_NAV_DEFS = [
  { view: 'decks', label: 'Decks', iconName: 'layers' },
  { view: 'study', label: 'Study', iconName: 'play' },
  { view: 'create', label: 'Create', iconName: 'px-ai-mark' },
  { view: 'import', label: 'Import', iconName: 'inbox' },
  { view: 'stats', label: 'Stats', iconName: 'chart-column' },
];

/** Human names for EVERY route, including the ones that are not destinations
 *  (they are breadcrumb leaves, not rail entries). */
const FC_VIEW_LABELS = {
  decks: 'Decks',
  study: 'Study',
  create: 'Create',
  import: 'Import',
  stats: 'Stats',
  browse: 'Browse Cards',
  custom: 'Custom Study',
  dedup: 'Find Duplicates',
  coverage: 'Coverage Review',
};

/** Views that live UNDER one deck: they light Decks in the rail and put the
 *  deck's name in the breadcrumb. */
const FC_DECK_VIEWS = ['browse', 'dedup', 'coverage'];

/** Which rail destination a route lights. Custom Study is a launcher for
 *  Study, so it lights Study rather than nothing. */
function fcNavViewFor(route) {
  const view = route?.view || 'decks';
  if (FC_DECK_VIEWS.includes(view)) return 'decks';
  if (view === 'custom') return 'study';
  return view;
}

/**
 * The route the open pane is showing, mirrored here so the sidebar rail can
 * light where you are. null when no pane is alive — the rail then shows no
 * selection rather than a stale one.
 */
let _fcActiveRoute = null;
const _navListeners = new Set();
function _setActiveRoute(route) {
  _fcActiveRoute = route;
  for (const listener of [..._navListeners]) {
    try { listener(route); } catch { /* a broken listener must not stop the rest */ }
  }
}


function createSidebarView(container) {
  injectStyles();
  const root = el('div', 'fc-sidebar');

  // No header title here: the sidebar part chrome already says FLASHCARDS —
  // repeating it read as sloppy duplication (user report). Actions live on
  // the section heads instead.

  // ── Navigation rail ──
  // Fixed above the scroller: navigation must not scroll away under a long
  // deck list, and it must work with zero decks (which is exactly when
  // Create and Import matter most).
  const nav = el('div', 'fc-sb__nav');
  nav.setAttribute('role', 'tablist');
  nav.setAttribute('aria-label', 'Flashcards sections');
  const navItems = new Map();
  for (const def of FC_NAV_DEFS) {
    const item = el('button', 'fc-sb__nav-item');
    item.type = 'button';
    item.setAttribute('role', 'tab');
    item.setAttribute('aria-selected', 'false');
    item.dataset.view = def.view;
    const glyph = el('span', 'fc-sb__nav-icon');
    glyph.innerHTML = icon(def.iconName, 14);
    item.appendChild(glyph);
    item.appendChild(el('span', 'fc-sb__nav-label', def.label));
    item.addEventListener('click', () => void openFlashcards({ view: def.view }));
    navItems.set(def.view, item);
    nav.appendChild(item);
  }
  root.appendChild(nav);

  const scroll = el('div', 'fc-sb__scroll');
  root.appendChild(scroll);

  // ── Today section ──
  const todaySection = el('div', 'fc-sb__section');
  const todayHead = el('div', 'fc-sb__section-head');
  todayHead.appendChild(el('span', 'fc-sb__section-title', 'Today'));
  todaySection.appendChild(todayHead);
  const todayHost = el('div');
  todaySection.appendChild(todayHost);
  scroll.appendChild(todaySection);

  // ── Decks section ──
  const decksSection = el('div', 'fc-sb__section');
  const decksHead = el('div', 'fc-sb__section-head');
  decksHead.appendChild(el('span', 'fc-sb__section-title', 'Decks'));
  const deckCount = el('span', 'fc-sb__section-count');
  decksHead.appendChild(deckCount);
  const sectionGen = el('button', 'fc-sb__section-add');
  sectionGen.type = 'button';
  sectionGen.title = 'Generate cards with AI';
  sectionGen.setAttribute('aria-label', 'Generate cards with AI');
  sectionGen.innerHTML = icon('px-ai-mark', 14);
  sectionGen.addEventListener('click', () => void openFlashcards({ view: 'create' }));
  decksHead.appendChild(sectionGen);
  const sectionAdd = el('button', 'fc-sb__section-add');
  sectionAdd.type = 'button';
  sectionAdd.title = 'New Deck';
  sectionAdd.setAttribute('aria-label', 'New Deck');
  sectionAdd.innerHTML = icon('plus', 14);
  sectionAdd.addEventListener('click', () => void _cmdNewDeck());
  decksHead.appendChild(sectionAdd);
  decksSection.appendChild(decksHead);
  const deckList = el('div', 'fc-sb__decks');
  decksSection.appendChild(deckList);
  scroll.appendChild(decksSection);

  const openDeckMenu = (deck, x, y) => {
    if (!_api.ui.showContextMenu) { void openFlashcards({ view: 'browse', deckId: deck.id }); return; }
    _api.ui.showContextMenu({ x, y }, fcDeckMenuItems(deck));
  };

  /** Deck the pane is currently inside, or null. The sidebar should always be
   *  able to answer "where am I?" — a rail entry alone cannot, because four of
   *  the five destinations can be scoped to a deck. */
  let activeDeckId = typeof _fcActiveRoute?.deckId === 'number' ? _fcActiveRoute.deckId : null;

  const syncNav = (route) => {
    const active = route ? fcNavViewFor(route) : null;
    for (const [view, item] of navItems) {
      const on = view === active;
      item.classList.toggle('fc-sb__nav-item--active', on);
      item.setAttribute('aria-selected', on ? 'true' : 'false');
    }
    activeDeckId = typeof route?.deckId === 'number' ? route.deckId : null;
    for (const row of deckList.children) {
      if (!row.dataset?.deckId) continue;
      row.classList.toggle('fc-deck-row--active', Number(row.dataset.deckId) === activeDeckId);
    }
  };

  let disposed = false;
  const refresh = async () => {
    if (disposed) return;
    let decks = [];
    let today = { newCount: 0, learnCount: 0, reviewCount: 0, dueTotal: 0 };
    try { [decks, today] = await Promise.all([fcListDecks(), fcTodayCounts()]); } catch { /* db not ready */ }
    if (disposed) return;

    // Today panel.
    todayHost.innerHTML = '';
    const panel = el('div', 'fc-today');
    if (today.dueTotal > 0) {
      const stats = el('div', 'fc-today__stats');
      const stat = (num, cls, label) => {
        const s = el('div', 'fc-today__stat');
        s.appendChild(el('div', `fc-today__num fc-today__num--${num > 0 ? cls : 'zero'}`, String(num)));
        s.appendChild(el('div', 'fc-today__lbl', label));
        return s;
      };
      stats.appendChild(stat(today.newCount, 'new', 'New'));
      stats.appendChild(stat(today.learnCount, 'learn', 'Learning'));
      stats.appendChild(stat(today.reviewCount, 'due', 'Review'));
      panel.appendChild(stats);
      // Promise what the session will actually hand over. The counts above
      // are uncapped totals; fcBuildQueue's per-session caps are not, so a
      // 100-card import used to advertise "Study 103 cards" and serve 23.
      // Pacing (M101) shrinks the new batch further — the promise follows it.
      // Computed SYNCHRONOUSLY from the decks already fetched: an await here
      // would split the paint and let an overlapping stale refresh land last.
      const pace = fcNewAllowances(decks, Date.now(), fcPaceSettings());
      const served = fcCountServedToday(today, {
        newLimit: Math.min(Number(cfg('dailyNewLimit', 20)) || 20, pace.total),
        reviewLimit: Number(cfg('dailyReviewLimit', 200)) || 200,
      });
      const studyBtn = el('button', 'fc-today__study');
      studyBtn.type = 'button';
      studyBtn.innerHTML = `${icon('play', 13)}<span>Study ${served} ${served === 1 ? 'card' : 'cards'}</span>`;
      studyBtn.disabled = served === 0; // a zeroed daily limit — Custom Study is the way through
      studyBtn.addEventListener('click', () => void openFlashcards({ view: 'study' }));
      panel.appendChild(studyBtn);
      if (served < today.dueTotal) {
        const overflow = el('button', 'fc-today__more');
        overflow.type = 'button';
        overflow.textContent = `${today.dueTotal - served} more behind the batch`;
        overflow.title = 'Open Custom Study to work ahead of the daily batch.';
        overflow.addEventListener('click', () => void openFlashcards({ view: 'custom' }));
        panel.appendChild(overflow);
      }
    } else {
      panel.appendChild(el('div', 'fc-today__done',
        decks.length === 0 ? 'No cards yet. Add a deck to begin.' : 'All caught up. Nothing due right now.'));
      if (decks.length > 0) {
        const aheadBtn = el('button', 'fc-today__more');
        aheadBtn.type = 'button';
        aheadBtn.textContent = 'Custom Study';
        aheadBtn.title = 'Review ahead, add new cards, or cram.';
        aheadBtn.addEventListener('click', () => void openFlashcards({ view: 'custom' }));
        panel.appendChild(aheadBtn);
      }
    }
    todayHost.appendChild(panel);

    // Decks list.
    deckCount.textContent = decks.length ? String(decks.length) : '';
    deckList.innerHTML = '';
    if (decks.length === 0) {
      deckList.appendChild(el('div', 'fc-sb__empty',
        'Your decks live here. Use + to create one, or Generate to turn a page or PDF into cards.'));
    } else {
      for (const deck of decks) {
        const row = el('div', 'fc-deck-row');
        row.setAttribute('role', 'button');
        row.tabIndex = 0;
        const ic = el('span', 'fc-deck-row__icon');
        ic.innerHTML = icon('px-flashcards', 14);
        row.appendChild(ic);
        row.appendChild(el('span', 'fc-deck-row__name', deck.name));

        const counts = el('span', 'fc-deck-row__counts');
        counts.title = `${deck.newCount} new · ${deck.dueCount} due · ${deck.total} total`;
        if (deck.newCount > 0) counts.appendChild(el('span', 'fc-deck-row__ct--new', String(deck.newCount)));
        if (deck.dueCount > 0) counts.appendChild(el('span', 'fc-deck-row__ct--due', String(deck.dueCount)));
        row.appendChild(counts);

        const more = el('button', 'fc-deck-row__more');
        more.type = 'button';
        more.title = 'Deck actions';
        more.setAttribute('aria-label', `Actions for ${deck.name}`);
        more.innerHTML = icon('more-horizontal', 15);
        more.addEventListener('click', (e) => {
          e.stopPropagation();
          const r = more.getBoundingClientRect();
          openDeckMenu(deck, r.left, r.bottom + 2);
        });
        row.appendChild(more);

        row.dataset.deckId = String(deck.id);
        row.classList.toggle('fc-deck-row--active', activeDeckId === deck.id);
        row.addEventListener('click', () => void openFlashcards({ view: 'browse', deckId: deck.id }));
        row.addEventListener('keydown', (e) => {
          if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); void openFlashcards({ view: 'browse', deckId: deck.id }); }
        });
        row.addEventListener('contextmenu', (e) => {
          e.preventDefault();
          openDeckMenu(deck, e.clientX, e.clientY);
        });
        deckList.appendChild(row);
      }
    }
  };
  void refresh();
  const onData = () => void refresh();
  _dataListeners.add(onData);
  _navListeners.add(syncNav);
  syncNav(_fcActiveRoute);

  container.appendChild(root);
  return {
    dispose() {
      disposed = true;
      _dataListeners.delete(onData);
      _navListeners.delete(syncNav);
      root.remove();
    },
  };
}

// ── Deck lifecycle flows (shared by sidebar + browse view) ──

async function _renameDeckFlow(deck) {
  const name = await _api.window.showInputBox({ prompt: 'Rename deck', value: deck.name });
  if (name?.trim() && name.trim() !== deck.name) await fcRenameDeck(deck.id, name.trim());
}

// Guard: one scoring run per deck at a time — a second click mid-run would
// double-score and double-toast.
const _fcScoringDecks = new Set();
/** Same guard for the M102 recall-mode classification pass. */
const _fcClassifyingDecks = new Set();

/**
 * Backfill exam-criticality scores on a deck's unscored cards (M101). Runs
 * in the background with a start toast and a completion toast; progress is
 * visible in the card browser as scores land (data-change events repaint).
 */
async function _scoreImportanceFlow(deck) {
  if (_fcScoringDecks.has(deck.id)) {
    _api.window.showInformationMessage?.(`Already scoring "${deck.name}" — scores appear as they land.`);
    return;
  }
  _fcScoringDecks.add(deck.id);
  try {
    _api.window.showInformationMessage?.(`Scoring "${deck.name}" for exam criticality. Cards update as batches finish.`);
    const { scored, total } = await fcScoreDeckImportance(deck.id);
    if (total === 0) {
      _api.window.showInformationMessage?.(`Every card in "${deck.name}" already has an importance score.`);
    } else if (scored === total) {
      _api.window.showInformationMessage?.(`Scored ${scored} ${scored === 1 ? 'card' : 'cards'} in "${deck.name}". High-importance cards now introduce first.`);
    } else {
      _api.window.showWarningMessage?.(`Scored ${scored} of ${total} cards in "${deck.name}". Run Score Importance again to finish the rest.`);
    }
  } catch (e) {
    _api.window.showErrorMessage?.(`Importance scoring failed: ${e.message}`);
  } finally {
    _fcScoringDecks.delete(deck.id);
  }
}

async function _classifyRecallFlow(deck) {
  if (_fcClassifyingDecks.has(deck.id)) {
    _api.window.showInformationMessage?.(`Already classifying "${deck.name}" — cards update as batches finish.`);
    return;
  }
  _fcClassifyingDecks.add(deck.id);
  try {
    _api.window.showInformationMessage?.(`Classifying "${deck.name}". Cards that need a written answer get a rubric as batches finish.`);
    const { promoted, total } = await fcClassifyDeckRecall(deck.id);
    if (total === 0) {
      _api.window.showInformationMessage?.(`Every card in "${deck.name}" already has a recall mode set.`);
    } else if (promoted === 0) {
      _api.window.showInformationMessage?.(`Reviewed ${total} ${total === 1 ? 'card' : 'cards'} in "${deck.name}". None needed a written answer.`);
    } else {
      _api.window.showInformationMessage?.(`${promoted} of ${total} cards in "${deck.name}" now ask for a written answer. Check the rubrics in Browse before you rely on them.`);
    }
  } catch (e) {
    _api.window.showErrorMessage?.(`Recall classification failed: ${e.message}`);
  } finally {
    _fcClassifyingDecks.delete(deck.id);
  }
}

// ── Exam-date picking (M101) ─────────────────────────────────────────────────
// A real calendar, not a typed YYYY-MM-DD box. One month-grid component
// (fcCalendarEl) backs both the single-deck dialog and the bulk dialog.
// Stored stamps stay local 23:59 — NOT toISOString, which is the NEXT day in
// UTC west of Greenwich and silently advanced the exam a day per re-confirm
// (M99 review).

/** ms epoch → local 23:59 stamp for the given year/month/day. */
function fcExamStamp(y, m, d) {
  return new Date(y, m, d, 23, 59).getTime();
}

/**
 * Month-grid calendar element. `onPick(ms)` fires with the local-23:59 stamp
 * of the clicked day. Days at or before today are disabled — an exam date in
 * the past caps every interval to nothing.
 */
function fcCalendarEl({ selected = 0, onPick }) {
  const today = new Date();
  const sel = selected ? new Date(selected) : null;
  let viewYear = sel ? sel.getFullYear() : today.getFullYear();
  let viewMonth = sel ? sel.getMonth() : today.getMonth();

  const root = el('div', 'fc-cal');
  const head = el('div', 'fc-cal__head');
  const prev = el('button', 'fc-cal__nav');
  prev.type = 'button';
  prev.title = 'Previous Month';
  prev.innerHTML = icon('chevron-left', 14) || '‹';
  const label = el('div', 'fc-cal__label');
  const next = el('button', 'fc-cal__nav');
  next.type = 'button';
  next.title = 'Next Month';
  next.innerHTML = icon('chevron-right', 14) || '›';
  head.append(prev, label, next);
  root.appendChild(head);

  const dow = el('div', 'fc-cal__dow');
  for (const d of ['Su', 'Mo', 'Tu', 'We', 'Th', 'Fr', 'Sa']) dow.appendChild(el('span', '', d));
  root.appendChild(dow);
  const grid = el('div', 'fc-cal__grid');
  root.appendChild(grid);

  const paint = () => {
    label.textContent = new Date(viewYear, viewMonth, 1)
      .toLocaleDateString(undefined, { month: 'long', year: 'numeric' });
    grid.innerHTML = '';
    const firstDow = new Date(viewYear, viewMonth, 1).getDay();
    const daysInMonth = new Date(viewYear, viewMonth + 1, 0).getDate();
    for (let i = 0; i < firstDow; i++) grid.appendChild(el('span', 'fc-cal__pad'));
    for (let d = 1; d <= daysInMonth; d++) {
      const btn = el('button', 'fc-cal__day', String(d));
      btn.type = 'button';
      const stamp = fcExamStamp(viewYear, viewMonth, d);
      if (stamp <= Date.now()) {
        btn.disabled = true;
        btn.classList.add('fc-cal__day--past');
      }
      if (viewYear === today.getFullYear() && viewMonth === today.getMonth() && d === today.getDate()) {
        btn.classList.add('fc-cal__day--today');
      }
      if (sel && viewYear === sel.getFullYear() && viewMonth === sel.getMonth() && d === sel.getDate()) {
        btn.classList.add('fc-cal__day--selected');
      }
      btn.addEventListener('click', () => onPick(stamp));
      grid.appendChild(btn);
    }
  };
  prev.addEventListener('click', () => { viewMonth--; if (viewMonth < 0) { viewMonth = 11; viewYear--; } paint(); });
  next.addEventListener('click', () => { viewMonth++; if (viewMonth > 11) { viewMonth = 0; viewYear++; } paint(); });
  paint();
  return root;
}

/**
 * Centered dialog shell for the date flows. Portals to document.body above
 * every workbench layer; Esc and backdrop-click cancel. `build(close)` fills
 * the dialog and calls close(result) to resolve.
 */
function fcDateDialog(title, build) {
  return new Promise((resolve) => {
    const overlay = el('div', 'fc-datedlg-overlay');
    const dlg = el('div', 'fc-datedlg');
    dlg.setAttribute('role', 'dialog');
    dlg.setAttribute('aria-label', title);
    dlg.appendChild(el('div', 'fc-datedlg__title', title));
    const close = (result) => {
      document.removeEventListener('keydown', onKey, true);
      overlay.remove();
      resolve(result);
    };
    const onKey = (e) => {
      if (e.key === 'Escape') { e.stopPropagation(); close(undefined); }
    };
    document.addEventListener('keydown', onKey, true);
    overlay.addEventListener('mousedown', (e) => { if (e.target === overlay) close(undefined); });
    build(dlg, close);
    overlay.appendChild(dlg);
    document.body.appendChild(overlay);
  });
}

/**
 * Set or clear a deck's exam date via the calendar. The scheduler caps
 * intervals so at least one more review fits before the date
 * (fcDeadlineCapDays), and pacing spreads new-card introduction to land
 * before the freeze window (fcPacePlan).
 */
async function _setExamDateFlow(deck) {
  const result = await fcDateDialog(`Exam Date — ${deck.name}`, (dlg, close) => {
    dlg.appendChild(el('div', 'fc-hint',
      deck.examDate
        ? `Currently ${new Date(deck.examDate).toLocaleDateString()}. Pick a new date, or clear it.`
        : 'Pick the real exam date. The scheduler plans backward from it: intervals cap so every card gets a final review in time, and new cards pace to finish introducing before the freeze window.'));
    dlg.appendChild(fcCalendarEl({ selected: deck.examDate || 0, onPick: (ms) => close(ms) }));
    const foot = el('div', 'fc-datedlg__foot');
    if (deck.examDate) {
      const clearBtn = el('button', 'fc-btn');
      clearBtn.textContent = 'Clear Date';
      clearBtn.addEventListener('click', () => close(0));
      foot.appendChild(clearBtn);
    }
    const cancelBtn = el('button', 'fc-btn');
    cancelBtn.textContent = 'Cancel';
    cancelBtn.addEventListener('click', () => close(undefined));
    foot.appendChild(cancelBtn);
    dlg.appendChild(foot);
  });
  if (result === undefined) return;
  await fcSetDeckExamDate(deck.id, result);
}

/**
 * Set (or clear) exam dates for MANY decks at once (M101). One calendar,
 * a checkbox per deck; sitting one exam usually means several source decks
 * share the date, and setting six decks one dialog at a time was the chore
 * that left decks unprotected by the deadline cap.
 */
async function _setExamDatesBulkFlow() {
  const decks = await fcListDecks();
  if (decks.length === 0) {
    _api.window.showInformationMessage?.('No decks yet. Create a deck first.');
    return;
  }
  const applied = await fcDateDialog('Exam Dates', (dlg, close) => {
    dlg.appendChild(el('div', 'fc-hint',
      'Tick the decks that share the exam, then pick its date on the calendar. Decks keep their own dates otherwise.'));
    const list = el('div', 'fc-datedlg__decks');
    const checks = new Map();
    for (const deck of decks) {
      const row = el('label', 'fc-check fc-datedlg__deck');
      const cb = el('input');
      cb.type = 'checkbox';
      cb.checked = true;
      checks.set(deck.id, cb);
      row.appendChild(cb);
      row.appendChild(el('span', '', deck.name));
      row.appendChild(el('span', 'fc-datedlg__deckdate',
        deck.examDate ? new Date(deck.examDate).toLocaleDateString() : 'no date'));
      list.appendChild(row);
    }
    dlg.appendChild(list);
    const checkedIds = () => decks.filter((d) => checks.get(d.id)?.checked).map((d) => d.id);
    dlg.appendChild(fcCalendarEl({
      selected: 0,
      onPick: (ms) => {
        const ids = checkedIds();
        if (ids.length === 0) return; // nothing ticked — picking a day is a no-op
        close({ ids, ms });
      },
    }));
    const foot = el('div', 'fc-datedlg__foot');
    const clearBtn = el('button', 'fc-btn');
    clearBtn.textContent = 'Clear Dates';
    clearBtn.title = 'Remove the exam date from every ticked deck.';
    clearBtn.addEventListener('click', () => {
      const ids = checkedIds();
      if (ids.length > 0) close({ ids, ms: 0 });
    });
    foot.appendChild(clearBtn);
    const cancelBtn = el('button', 'fc-btn');
    cancelBtn.textContent = 'Cancel';
    cancelBtn.addEventListener('click', () => close(undefined));
    foot.appendChild(cancelBtn);
    dlg.appendChild(foot);
  });
  if (!applied) return;
  for (const id of applied.ids) {
    await fcSetDeckExamDate(id, applied.ms);
  }
  const n = applied.ids.length;
  _api.window.showInformationMessage?.(applied.ms
    ? `Exam date set on ${n} ${n === 1 ? 'deck' : 'decks'}.`
    : `Exam date cleared on ${n} ${n === 1 ? 'deck' : 'decks'}.`);
}

async function _deleteDeckFlow(deck) {
  const total = deck.total ?? 0;
  const detail = total > 0
    ? `This permanently deletes the deck and its ${total} ${total === 1 ? 'card' : 'cards'}, including review history. This cannot be undone.`
    : 'This permanently deletes the deck. This cannot be undone.';
  let ok = false;
  if (_api.window.showConfirmModal) {
    ok = await _api.window.showConfirmModal({ message: `Delete "${deck.name}"?`, detail, confirmLabel: 'Delete Deck', danger: true });
  } else {
    const pick = await _api.window.showWarningMessage(`Delete "${deck.name}"? ${detail}`, { title: 'Delete Deck' });
    ok = pick?.title === 'Delete Deck';
  }
  if (ok) await fcDeleteDeck(deck.id);
}

// ═══════════════════════════════════════════════════════════════════════════════
// SECTION 9: EDITOR PANE — breadcrumb + router
// ═══════════════════════════════════════════════════════════════════════════════

/**
 * What a crashed view shows instead of nothing. Names the view, carries the
 * real message (so a screenshot is enough to diagnose), and offers the two
 * things that actually help: retry, and get out.
 */
function renderViewError(body, route, err, setRoute, retry) {
  console.error(`[Flashcards] the ${route.view} view failed to render:`, err);
  body.innerHTML = '';
  const view = el('div', 'fc-view');
  const box = el('div', 'px-empty');
  box.appendChild(el('div', 'px-empty__headline',
    `${FC_VIEW_LABELS[route.view] || 'This view'} could not be rendered`));
  box.appendChild(el('div', 'px-empty__hint', String(err?.message || err)));
  const again = el('button', 'fc-btn fc-btn--primary');
  again.textContent = 'Try Again';
  again.addEventListener('click', () => retry());
  box.appendChild(again);
  const back = el('button', 'fc-btn');
  back.textContent = 'Back to Decks';
  back.addEventListener('click', () => setRoute({ view: 'decks' }));
  box.appendChild(back);
  view.appendChild(box);
  body.appendChild(view);
}

function createEditorPane(container, input) {
  injectStyles();
  try { input?.setName?.('Flashcards'); } catch { /* noop */ }

  const pendingRoute = _takePendingRoute();
  const state = {
    route: pendingRoute || { view: 'decks' },
    disposed: false,
    session: null, // live study session (owned by renderStudy)
    /** True once a route arrived by explicit navigation (command, link,
     *  tab click, or a pending route consumed at construction) — a later
     *  restoreViewState must not clobber it. */
    explicitRoute: !!pendingRoute,
  };

  const root = el('div', 'fc-pane');
  const header = el('div', 'fc-pane__header');
  // A breadcrumb, not a tab strip. Navigation moved to the sidebar rail
  // (FC_NAV_DEFS) — repeating it here would be the same map in two places,
  // and the pane's job is to say where you ARE and how to step back out.
  const crumbs = el('nav', 'fc-pane__crumbs');
  crumbs.setAttribute('aria-label', 'Breadcrumb');
  header.appendChild(crumbs);
  header.appendChild(el('div', 'fc-pane__spacer'));
  root.appendChild(header);
  const body = el('div', 'fc-pane__body');
  root.appendChild(body);
  container.appendChild(root);

  /** Guards the async deck-name lookup below: a fast route change must not
   *  let an older breadcrumb finish painting after the newer one. */
  let crumbSeq = 0;

  const syncCrumbs = async () => {
    const seq = ++crumbSeq;
    const route = state.route;
    const view = route.view || 'decks';
    const paint = (nodes) => {
      if (seq !== crumbSeq || state.disposed) return;
      crumbs.innerHTML = '';
      for (const n of nodes) crumbs.appendChild(n);
    };
    const crumb = (label, onClick) => {
      const node = el(onClick ? 'button' : 'span', onClick ? 'fc-crumb fc-crumb--link' : 'fc-crumb', label);
      if (onClick) { node.type = 'button'; node.addEventListener('click', onClick); }
      return node;
    };
    const sep = () => el('span', 'fc-crumb__sep', '/');

    if (view === 'decks') { paint([crumb('Decks')]); return; }

    const nodes = [crumb('Decks', () => setRoute({ view: 'decks' }))];
    if (route.deckId != null) {
      const deck = await fcGetDeck(route.deckId);
      if (deck) {
        nodes.push(sep());
        nodes.push(view === 'browse'
          ? crumb(deck.name)
          : crumb(deck.name, () => setRoute({ view: 'browse', deckId: deck.id })));
      }
    }
    if (view !== 'browse' || route.deckId == null) {
      nodes.push(sep());
      nodes.push(crumb(FC_VIEW_LABELS[view] || view));
    }
    paint(nodes);
  };

  let rendering = false, renderQueued = false;
  let viewDisposables = [];
  const disposeView = () => {
    for (const d of viewDisposables) { try { d.dispose(); } catch { /* noop */ } }
    viewDisposables = [];
  };
  const render = async () => {
    if (rendering) { renderQueued = true; return; }
    rendering = true;
    try {
      do {
        renderQueued = false;
        if (state.disposed) return;
        void syncCrumbs();
        _setActiveRoute(state.route); // the sidebar rail lights what we show
        state.session = null;
        disposeView();
        body.innerHTML = '';
        const route = state.route;
        // Error boundary. A view that throws must SAY so: renderStudy once
        // died on a type error after it had appended its (still empty) root,
        // and the pane just sat there blank — no card, no message, nothing to
        // report. That is why "Custom Study shows no cards" needed a
        // reproduction rather than a screenshot. Any future crash lands here.
        try {
          if (route.view === 'browse') await renderBrowse(body, route, setRoute);
          else if (route.view === 'study') await renderStudy(body, route, state, setRoute);
          else if (route.view === 'custom') await renderCustomStudy(body, route, setRoute);
          else if (route.view === 'create') await renderCreate(body, route, setRoute, viewDisposables);
          else if (route.view === 'import') await renderImport(body, route, setRoute, viewDisposables);
          else if (route.view === 'stats') await renderStats(body);
          else if (route.view === 'dedup') await renderDedup(body, route, setRoute);
          else if (route.view === 'coverage') await renderCoverage(body, route, setRoute);
          else await renderDecks(body, setRoute);
        } catch (err) {
          if (state.disposed) return;
          renderViewError(body, route, err, setRoute, () => void render());
        }
      } while (renderQueued && !state.disposed);
    } finally {
      rendering = false;
    }
  };

  function setRoute(route) {
    // Same-route no-op: re-clicking "Study Now" mid-study or re-opening the
    // current deck must not wipe the view (render() rebuilds the body and
    // resets the card face / scroll — the "certain things reset the pane"
    // report).
    if (JSON.stringify(route) === JSON.stringify(state.route)) return;
    state.route = route;
    state.explicitRoute = true;
    void render();
  }

  const onRouteEvent = (e) => {
    if (!root.isConnected) return;
    const route = e.detail;
    if (!route || !route.view) return;
    // This live pane is handling the navigation, so the copy openFlashcards
    // stashed for a possibly-absent pane must be consumed here — otherwise it
    // lingers and sends the NEXT fresh mount somewhere the user never asked for.
    _takePendingRoute();
    setRoute(route);
  };
  document.addEventListener('parallx.flashcards.route', onRouteEvent);

  const onData = () => {
    // Live-refresh passive views. The study session manages its own state —
    // re-rendering mid-review would eat the current card. The import view is
    // excluded too: its own commit loop emits data changes, and a re-render
    // mid-commit would blank the preview and progress it is reporting.
    // Browse joined the exclusions (M99 review): its writes all re-render
    // locally via renderList, and a global re-render mid-inline-edit
    // destroyed unsaved editor text and collapsed the add-card form.
    // Custom Study joins the exclusions: it is a form, and a background write
    // re-rendering it would reset the mode, count, and tag selection mid-edit.
    if (state.disposed || state.route.view === 'study' || state.route.view === 'create'
      || state.route.view === 'import' || state.route.view === 'browse'
      || state.route.view === 'custom'
      || state.route.view === 'dedup' || state.route.view === 'coverage') return;
    // A background write (chat tool, capture toast) refreshing Decks/Stats
    // must not scroll the user back to the top.
    const scrollTop = body.scrollTop;
    void render().then(() => {
      if (!state.disposed && scrollTop > 0) body.scrollTop = scrollTop;
    });
  };
  _dataListeners.add(onData);

  void render();

  return {
    dispose() {
      state.disposed = true;
      disposeView();
      document.removeEventListener('parallx.flashcards.route', onRouteEvent);
      _dataListeners.delete(onData);
      // Only clear the rail if WE are the pane it reflects: a rebuild can
      // construct the new pane before the old one is torn down, and clearing
      // then would blank a selection that is already correct.
      if (_fcActiveRoute === state.route) _setActiveRoute(null);
      root.remove();
    },
    // The workbench rebuilds this pane on every tab switch (media-organizer
    // pattern): without these hooks, clicking away and back always reset the
    // tool to the Decks view. Study routes ARE preserved (Mufaro overruled
    // the old study→decks redirect: following a card's source link must not
    // lose your place) — renderStudy resumes the live session from
    // _fcStudySessions, or builds fresh when none is mid-flight.
    saveViewState() {
      return { route: state.route, scrollTop: body.scrollTop || 0 };
    },
    restoreViewState(saved) {
      if (state.disposed || !saved || !saved.route || !saved.route.view) return;
      // A route that arrived by explicit navigation (command/link/tab click)
      // during this pane's construction outranks the restored snapshot —
      // the workbench does not order the two deterministically, and the
      // stale 120ms scroll timer would jump the NEW view.
      if (state.explicitRoute) return;
      setRoute(saved.route);
      state.explicitRoute = false; // restoring is not user navigation
      if (typeof saved.scrollTop === 'number' && saved.scrollTop > 0) {
        // After the async view render settles; best-effort by design.
        setTimeout(() => { if (!state.disposed) body.scrollTop = saved.scrollTop; }, 120);
      }
    },
  };
}

// ── Decks view ───────────────────────────────────────────────────────────────

/**
 * Decks — the tool's home page.
 *
 * This used to be a bare list with four text buttons per row, and it was only
 * reachable by opening a deck first (which lands in Browse) and then finding
 * the pane's tab strip. It is now the surface you land on and the one the
 * sidebar rail points at: what today asks of you, the actions that start
 * work, then every deck with the schedule it is actually on.
 *
 * The Today promise is computed the same way the sidebar computes it —
 * counts capped by the session limits AND by the deadline pace — so the two
 * surfaces can never disagree about how many cards a session will hand over.
 */
async function renderDecks(body, setRoute) {
  const view = el('div', 'fc-view fc-home');
  const now = Date.now();
  const [decks, today] = await Promise.all([fcListDecks(), fcTodayCounts()]);
  const paceSettings = fcPaceSettings();

  // ── Masthead ──
  const head = el('div', 'fc-home__head');
  const headText = el('div', 'fc-home__head-text');
  head.appendChild(headText);
  headText.appendChild(el('div', 'fc-home__title', 'Decks'));
  const totals = decks.reduce((acc, d) => {
    acc.cards += d.total;
    if (d.examDate > now && (acc.exam === 0 || d.examDate < acc.exam)) acc.exam = d.examDate;
    return acc;
  }, { cards: 0, exam: 0 });
  const summary = [
    `${decks.length} ${decks.length === 1 ? 'deck' : 'decks'}`,
    `${totals.cards} ${totals.cards === 1 ? 'card' : 'cards'}`,
  ];
  if (totals.exam > 0) {
    summary.push(`next exam in ${Math.max(1, Math.ceil((totals.exam - now) / DAY))} days`);
  }
  headText.appendChild(el('div', 'fc-home__sub', summary.join(' · ')));
  // The sidebar rail owns navigation, but the pane must not become a dead end
  // when the sidebar is showing another container: home is one breadcrumb
  // click from anywhere, and every destination is reachable from home.
  const statsBtn = el('button', 'fc-btn');
  statsBtn.textContent = 'Stats';
  statsBtn.title = 'Retention, workload, and review history.';
  statsBtn.addEventListener('click', () => setRoute({ view: 'stats' }));
  head.appendChild(statsBtn);
  view.appendChild(head);

  // ── Today ──
  if (decks.length > 0) {
    const pace = fcNewAllowances(decks, now, paceSettings);
    const served = fcCountServedToday(today, {
      newLimit: Math.min(Number(cfg('dailyNewLimit', 20)) || 20, pace.total),
      reviewLimit: Number(cfg('dailyReviewLimit', 200)) || 200,
    });
    const behind = Math.max(0, today.dueTotal - served);

    const panel = el('div', 'fc-home__today');
    const stats = el('div', 'fc-home__stats');
    const stat = (num, cls, label) => {
      const box = el('div', 'fc-home__stat');
      box.appendChild(el('div', `fc-home__num fc-home__num--${num > 0 ? cls : 'zero'}`, String(num)));
      box.appendChild(el('div', 'fc-home__stat-lbl', label));
      return box;
    };
    stats.appendChild(stat(today.newCount, 'new', 'New'));
    stats.appendChild(stat(today.learnCount, 'learn', 'Learning'));
    stats.appendChild(stat(today.reviewCount, 'due', 'Review'));
    panel.appendChild(stats);

    const cta = el('div', 'fc-home__cta');
    const studyAll = el('button', 'fc-btn fc-btn--primary');
    const studyLabel = served > 0 ? `Study ${served} ${served === 1 ? 'Card' : 'Cards'}` : 'Nothing Due Right Now';
    studyAll.innerHTML = `${icon('play', 12)}<span>${studyLabel}</span>`;
    // A zeroed daily limit still leaves work reachable — through Custom Study.
    studyAll.disabled = served === 0;
    studyAll.addEventListener('click', () => setRoute({ view: 'study' }));
    cta.appendChild(studyAll);
    const customAll = el('button', 'fc-btn');
    customAll.textContent = 'Custom Study';
    customAll.title = behind > 0
      ? `${behind} more cards sit behind today's batch. Custom Study reaches them.`
      : 'Work ahead: extra new cards, review ahead, difficult cards, or cram.';
    customAll.addEventListener('click', () => setRoute({ view: 'custom' }));
    cta.appendChild(customAll);
    if (behind > 0) {
      cta.appendChild(el('span', 'fc-home__behind', `${behind} more behind today's batch`));
    }
    panel.appendChild(cta);
    view.appendChild(panel);
  }

  // ── Actions ──
  const actions = el('div', 'fc-row fc-home__actions');
  const newDeckBtn = el('button', decks.length === 0 ? 'fc-btn fc-btn--primary' : 'fc-btn');
  newDeckBtn.innerHTML = `${icon('plus', 12)}<span>New Deck</span>`;
  newDeckBtn.addEventListener('click', () => void _cmdNewDeck());
  actions.appendChild(newDeckBtn);
  const genBtn = _api.ui.createAiButton
    ? _api.ui.createAiButton(actions, { label: 'Generate Cards' })
    : el('button', 'fc-btn');
  if (!genBtn.parentElement) { genBtn.textContent = 'Generate Cards'; actions.appendChild(genBtn); }
  genBtn.addEventListener('click', () => setRoute({ view: 'create' }));
  const importBtn = el('button', 'fc-btn');
  importBtn.textContent = 'Import Cards';
  importBtn.title = 'Bring in an Anki export, a front/back PDF, or pasted rows.';
  importBtn.addEventListener('click', () => setRoute({ view: 'import' }));
  actions.appendChild(importBtn);
  const datesBtn = el('button', 'fc-btn');
  datesBtn.textContent = 'Exam Dates';
  datesBtn.title = 'Set or clear the exam date on several decks at once.';
  datesBtn.disabled = decks.length === 0;
  datesBtn.addEventListener('click', () => void _setExamDatesBulkFlow());
  actions.appendChild(datesBtn);
  view.appendChild(actions);

  if (decks.length === 0) {
    // Same hero shape as the workbench voice registry (.px-empty is global).
    const empty = el('div', 'px-empty');
    empty.appendChild(el('div', 'px-empty__headline', 'Build your first deck'));
    empty.appendChild(el('div', 'px-empty__hint',
      'Click New Deck, Generate Cards to turn a canvas page, PDF, or photo into cards, or Import Cards to bring in a deck you already have.'));
    view.appendChild(empty);
    body.appendChild(view);
    return;
  }

  view.appendChild(el('div', 'fc-label', 'All Decks'));
  const list = el('div', 'fc-home__decks');
  view.appendChild(list);

  for (const deck of decks) {
    const card = el('div', 'fc-deck-card');

    const info = el('div', 'fc-deck-card__info');
    info.setAttribute('role', 'button');
    info.tabIndex = 0;
    info.title = `Browse the cards in ${deck.name}`;
    const nameRow = el('div', 'fc-deck-card__name', deck.name);
    if (deck.examDate && deck.examDate > now) {
      const daysLeft = Math.max(1, Math.ceil((deck.examDate - now) / DAY));
      const chip = el('button', 'fc-exam-chip', `${daysLeft}d to exam`);
      chip.type = 'button';
      chip.title = `Exam ${new Date(deck.examDate).toLocaleDateString()} — intervals capped so every card gets a final review in time. Click to change.`;
      chip.addEventListener('click', (e) => { e.stopPropagation(); void _setExamDateFlow(deck); });
      nameRow.appendChild(chip);
    }
    info.appendChild(nameRow);

    // Counts carry the Anki colour language the sidebar already uses: new =
    // accent, due = success. Two grey numbers were indistinguishable.
    const counts = el('div', 'fc-deck-card__counts');
    const count = (n, cls, label) => {
      const box = el('span', 'fc-deck-count');
      box.appendChild(el('span', `fc-deck-count__n fc-deck-count__n--${n > 0 ? cls : 'zero'}`, String(n)));
      box.appendChild(el('span', 'fc-deck-count__l', label));
      return box;
    };
    counts.appendChild(count(deck.newCount, 'new', 'new'));
    counts.appendChild(count(deck.dueCount, 'due', 'due'));
    counts.appendChild(count(deck.total, 'total', 'total'));
    info.appendChild(counts);

    // The pace line (M101): what the deadline math actually plans for this
    // deck, so the new-card backlog reads as a schedule instead of a dread
    // counter.
    if (paceSettings.paceEnabled && deck.newCount > 0) {
      const plan = fcPacePlan(deck, now, paceSettings);
      if (plan) {
        const doneLabel = new Date(plan.doneAt).toLocaleDateString(undefined, { month: 'short', day: 'numeric' });
        // A raised rate says so. The batch size is a setting the user chose,
        // and exceeding it without a word would make the number in Settings
        // a lie on exactly the decks where session length matters most.
        const line = el('div', 'fc-deck-card__meta', plan.frozen
          ? 'Introduction frozen — reviews only until the exam'
          : plan.raised
            ? `Pace ${plan.rate}/day (raised to meet the exam), introduced by ${doneLabel}`
            : `Pace ${plan.rate}/day, introduced by ${doneLabel}`);
        if (plan.raised && !plan.frozen) {
          line.title = `Your batch size is ${paceSettings.ceiling}/day, which would not finish introducing `
            + `this deck before the freeze window. Pacing raised it to ${plan.rate}/day so every card lands in time.`;
        }
        info.appendChild(line);
      }
    }

    const openDeck = () => setRoute({ view: 'browse', deckId: deck.id });
    info.addEventListener('click', openDeck);
    info.addEventListener('keydown', (e) => {
      if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); openDeck(); }
    });
    card.appendChild(info);

    const btns = el('div', 'fc-deck-card__actions');
    const studyBtn = el('button', 'fc-btn');
    studyBtn.textContent = 'Study';
    // A live session (learning card pending its 1m step) must stay
    // reachable even when the due badges read zero.
    studyBtn.disabled = deck.dueCount === 0 && deck.newCount === 0 && !_fcStudySessions.has(String(deck.id));
    studyBtn.addEventListener('click', () => setRoute({ view: 'study', deckId: deck.id }));
    btns.appendChild(studyBtn);
    const deckCustomBtn = el('button', 'fc-btn');
    deckCustomBtn.textContent = 'Custom';
    deckCustomBtn.title = `Custom Study scoped to ${deck.name}`;
    deckCustomBtn.disabled = deck.total === 0;
    deckCustomBtn.addEventListener('click', () => setRoute({ view: 'custom', deckId: deck.id }));
    btns.appendChild(deckCustomBtn);
    // Rename / Delete / Merge / Score / Coverage all live in the ONE deck
    // menu the sidebar rows already use, instead of a second set of buttons
    // that drifts away from it.
    const more = el('button', 'fc-btn fc-btn--icon');
    more.title = 'Deck actions';
    more.setAttribute('aria-label', `Actions for ${deck.name}`);
    more.innerHTML = icon('more-horizontal', 15);
    more.addEventListener('click', () => {
      if (!_api.ui.showContextMenu) { openDeck(); return; }
      const r = more.getBoundingClientRect();
      _api.ui.showContextMenu({ x: r.left, y: r.bottom + 2 }, fcDeckMenuItems(deck));
    });
    btns.appendChild(more);
    card.appendChild(btns);

    card.addEventListener('contextmenu', (e) => {
      if (!_api.ui.showContextMenu) return;
      e.preventDefault();
      _api.ui.showContextMenu({ x: e.clientX, y: e.clientY }, fcDeckMenuItems(deck));
    });
    list.appendChild(card);
  }

  body.appendChild(view);
}

// ── Browse view ──────────────────────────────────────────────────────────────

/**
 * Inline card editor: textareas with a LIVE rendered preview beside each.
 *
 * The predecessor was two sequential single-line input boxes — no multi-line
 * editing, no sight of the other side while writing, no tags, and no way to
 * see whether a formula's LaTeX actually renders. For formula-dense material
 * the preview IS the point: `$\frac{a}{b}$` and a typo'd `$\fac{a}{b}$` look
 * identical as source text.
 */
/** Textarea + live markdown/KaTeX preview pair — the review surfaces use
 *  it so a card is judged by what it will RENDER, not raw $LaTeX$ source
 *  (user report: content review was lacking). */
function fcPreviewTextarea(value, rows = 2) {
  const grid = el('div', 'fc-edit__row');
  const ta = el('textarea', 'fc-textarea');
  ta.rows = rows;
  ta.value = value;
  const pv = el('div', 'fc-edit__preview');
  const paint = (text) => {
    pv.innerHTML = '';
    const t = String(text || '').trim();
    pv.classList.toggle('fc-edit__preview--empty', !t);
    if (!t) { pv.textContent = 'nothing yet'; return; }
    try { pv.appendChild(_api.ui.renderMarkdown(t)); } catch { pv.textContent = t; }
  };
  paint(value);
  let timer = null;
  ta.addEventListener('input', () => {
    if (timer) clearTimeout(timer);
    timer = setTimeout(() => paint(ta.value), 150);
  });
  grid.append(ta, pv);
  return { grid, ta };
}

function fcCardEditorEl(card, { onSave, onCancel }) {
  const form = el('div', 'fc-edit');

  const err = el('div', 'fc-error');
  err.style.display = 'none';

  const preview = (host, text) => {
    host.innerHTML = '';
    const t = String(text || '').trim();
    host.classList.toggle('fc-edit__preview--empty', !t);
    if (!t) { host.textContent = 'nothing yet'; return; }
    try { host.appendChild(_api.ui.renderMarkdown(t)); }
    catch { host.textContent = t; }
  };

  const side = (label, value) => {
    form.appendChild(el('div', 'fc-label', label));
    const grid = el('div', 'fc-edit__row');
    const ta = el('textarea', 'fc-textarea');
    ta.value = value;
    ta.rows = 4;
    const pv = el('div', 'fc-edit__preview');
    preview(pv, value);
    let timer = null;
    ta.addEventListener('input', () => {
      if (timer) clearTimeout(timer);
      timer = setTimeout(() => preview(pv, ta.value), 150);
    });
    grid.append(ta, pv);
    form.appendChild(grid);
    return ta;
  };

  const frontIn = side('Front', card.front);
  const backIn = side('Back', card.back);

  form.appendChild(el('div', 'fc-label', 'Notes'));
  const notesIn = el('textarea', 'fc-textarea');
  notesIn.value = card.notes || '';
  notesIn.rows = 2;
  notesIn.placeholder = 'Optional. Shown with the answer during study; the AI rewrite prompt reads them too.';
  form.appendChild(notesIn);

  form.appendChild(el('div', 'fc-label', 'Tags'));
  const tagsIn = el('input', 'fc-input');
  tagsIn.value = fcParseTags(card.tags).join(' ');
  tagsIn.placeholder = 'space-separated';
  form.appendChild(tagsIn);

  form.appendChild(el('div', 'fc-label', 'Importance'));
  const impRow = el('div', 'fc-row');
  const impIn = el('input', 'fc-input fc-input--importance');
  impIn.type = 'number';
  impIn.min = '0';
  impIn.max = '100';
  impIn.value = String(card.importance || 0);
  impIn.title = 'Exam criticality, 1-100. 0 = unscored. High-importance cards introduce first when pacing is on; your value overrides the AI score.';
  impRow.appendChild(impIn);
  impRow.appendChild(el('span', 'fc-hint',
    card.importanceReason ? `AI: ${card.importanceReason}` : '1-100 · high scores introduce first · 0 = unscored'));
  form.appendChild(impRow);

  // ── Recall mode + rubric (M102) ────────────────────────────────────────
  //
  // The rubric is editable here because it IS the grading standard: when a
  // verdict looks wrong, the fix is a five-second edit to the points rather
  // than regenerating the card or distrusting every grade it produces.
  form.appendChild(el('div', 'fc-label', 'Recall Mode'));
  const modeRow = el('div', 'fc-row');
  const modeHost = el('div');
  modeRow.appendChild(modeHost);
  const modeHint = el('span', 'fc-hint');
  modeRow.appendChild(modeHint);
  form.appendChild(modeRow);

  const rubricWrap = el('div', 'fc-edit__rubric');
  rubricWrap.appendChild(el('div', 'fc-label', 'Rubric'));
  const rubricIn = el('textarea', 'fc-textarea');
  rubricIn.rows = 4;
  rubricIn.placeholder = 'One point per line — the claims a correct answer must make.\nEnd a line with "(optional)" for supporting detail a complete answer could omit.';
  // One point per line, not JSON: the stored shape is JSON, but hand-editing
  // JSON in a textarea invites a syntax error that silently empties the
  // rubric and drops the card back to a self-grade.
  rubricIn.value = (card.rubric || [])
    .map((p) => (p.required ? p.text : `${p.text} (optional)`))
    .join('\n');
  rubricWrap.appendChild(rubricIn);
  rubricWrap.appendChild(el('div', 'fc-hint',
    'Left empty on a production card, one is written from the answer the first time you are graded.'));
  form.appendChild(rubricWrap);

  let recallMode = fcNormalizeRecallMode(card.recallMode);
  const syncMode = () => {
    rubricWrap.style.display = fcIsProductionMode(recallMode) ? '' : 'none';
    modeHint.textContent = FC_RECALL_MODE_HINTS[recallMode];
  };
  const modeDd = _api.ui.createDropdown(modeHost, {
    items: [
      { value: 'recognition', label: 'Recognition' },
      { value: 'conceptual', label: 'Conceptual' },
      { value: 'list', label: 'List' },
      { value: 'formula', label: 'Formula' },
    ],
    selected: recallMode,
    ariaLabel: 'Recall mode',
  });
  modeDd.onDidChange((v) => { recallMode = fcNormalizeRecallMode(v); syncMode(); });
  syncMode();

  form.appendChild(err);

  const actions = el('div', 'fc-edit__actions');
  const saveBtn = el('button', 'fc-btn fc-btn--primary');
  saveBtn.textContent = 'Save';
  const cancelBtn = el('button', 'fc-btn');
  cancelBtn.textContent = 'Cancel';
  actions.append(saveBtn, cancelBtn);
  actions.appendChild(el('span', 'fc-hint', 'Ctrl+Enter saves · Esc cancels · $…$ renders math'));
  form.appendChild(actions);

  const save = () => {
    const front = frontIn.value.trim();
    const back = backIn.value.trim();
    if (!front || !back) {
      err.textContent = 'Front and back both need content.';
      err.style.display = '';
      return;
    }
    const tags = tagsIn.value.split(/[\s,]+/).map((t) => t.trim()).filter(Boolean).join(',');
    void onSave({
      front, back, tags, notes: notesIn.value, importance: impIn.value,
      recallMode,
      // A recognition card's rubric is never read, so clearing it on the way
      // back to recognition keeps a stale standard from reappearing if the
      // card is later promoted again.
      rubric: fcIsProductionMode(recallMode) ? fcParseRubricLines(rubricIn.value) : [],
    });
  };
  saveBtn.addEventListener('click', save);
  cancelBtn.addEventListener('click', () => onCancel());
  form.addEventListener('keydown', (e) => {
    if (e.key === 'Enter' && (e.ctrlKey || e.metaKey)) { e.preventDefault(); save(); }
    else if (e.key === 'Escape') { e.preventDefault(); onCancel(); }
  });

  queueMicrotask(() => frontIn.focus());
  return form;
}

async function renderBrowse(body, route, setRoute) {
  const deckRow = await db.get('SELECT * FROM fc_decks WHERE id = ?', [route.deckId]);
  if (!deckRow) { setRoute({ view: 'decks' }); return; }
  const view = el('div', 'fc-view');

  const head = el('div', 'fc-row');
  const backBtn = el('button', 'fc-btn');
  backBtn.innerHTML = `${icon('arrow-left', 12)}<span>Decks</span>`;
  backBtn.addEventListener('click', () => setRoute({ view: 'decks' }));
  head.appendChild(backBtn);
  const title = el('div', 'fc-view__title', deckRow.name);
  head.appendChild(title);
  const spacer = el('div'); spacer.style.flex = '1';
  head.appendChild(spacer);
  const studyBtn = el('button', 'fc-btn fc-btn--primary');
  studyBtn.innerHTML = `${icon('play', 12)}<span>Study This Deck</span>`;
  studyBtn.addEventListener('click', () => setRoute({ view: 'study', deckId: deckRow.id }));
  head.appendChild(studyBtn);
  const addBtn = el('button', 'fc-btn');
  addBtn.innerHTML = `${icon('plus', 12)}<span>Add Card</span>`;
  // The full deck menu (incl. Find Duplicates / Coverage Review) from
  // Browse too — same items as the sidebar rows, one source of truth.
  const moreBtn = el('button', 'fc-btn');
  moreBtn.innerHTML = icon('more-horizontal', 12);
  moreBtn.setAttribute('aria-label', 'Deck actions');
  moreBtn.addEventListener('click', () => {
    if (!_api.ui.showContextMenu) return;
    const r = moreBtn.getBoundingClientRect();
    _api.ui.showContextMenu({ x: r.left, y: r.bottom + 4 }, fcDeckMenuItems({
      id: deckRow.id, name: deckRow.name, examDate: deckRow.exam_date || 0, total: 0,
    }));
  });
  view.appendChild(head);

  // Inline add-card form (collapsed until clicked).
  const addForm = el('div', 'fc-form');
  addForm.style.display = 'none';
  const frontIn = el('textarea', 'fc-textarea');
  frontIn.placeholder = 'Front: the question';
  frontIn.rows = 2;
  const backIn = el('textarea', 'fc-textarea');
  backIn.placeholder = 'Back: the answer';
  backIn.rows = 2;
  const tagsIn = el('input', 'fc-input');
  tagsIn.placeholder = 'Tags (comma separated, optional)';
  const addErr = el('div', 'fc-error');
  addErr.style.display = 'none';
  const addRow = el('div', 'fc-row');
  const saveCard = el('button', 'fc-btn fc-btn--primary');
  saveCard.textContent = 'Save Card';
  // M98 — reverse pair option + cloze affordance. Cloze wins over reverse
  // when markers are present (a cloze note is already multi-card).
  const reverseWrap = el('label', 'fc-check');
  const reverseIn = el('input');
  reverseIn.type = 'checkbox';
  reverseWrap.append(reverseIn, document.createTextNode(' Also create the reversed card (back asks for front)'));
  const clozeHint = el('div', 'fc-hint',
    'Cloze: wrap answers as {{c1::answer}} or {{c1::answer::hint}} in the front. Each numbered blank becomes its own card; the back is optional extra context.');
  saveCard.addEventListener('click', () => {
    void (async () => {
      const isCloze = fcParseClozeIndices(frontIn.value).length > 0;
      if (!frontIn.value.trim() || (!backIn.value.trim() && !isCloze)) {
        addErr.textContent = isCloze ? 'The front is required.' : 'Both front and back are required.';
        addErr.style.display = '';
        return;
      }
      addErr.style.display = 'none';
      const n = await fcCreateNote(deckRow.id, {
        front: frontIn.value,
        back: backIn.value,
        tags: fcParseTags(tagsIn.value).join(','),
        reverse: reverseIn.checked,
      });
      if (n > 1) {
        addErr.textContent = '';
        void _api.window.showInformationMessage(`Created ${n} cards from that note.`);
      }
      frontIn.value = ''; backIn.value = ''; tagsIn.value = '';
      frontIn.focus();
      // Browse no longer auto-refreshes on data changes (inline-edit
      // protection) — the form refreshes its own list.
      void renderList();
    })();
  });
  addRow.appendChild(saveCard);
  addForm.append(el('div', 'fc-label', 'New card'), frontIn, backIn, tagsIn, reverseWrap, clozeHint, addErr, addRow);
  head.appendChild(addBtn);
  head.appendChild(moreBtn);
  addBtn.addEventListener('click', () => {
    addForm.style.display = addForm.style.display === 'none' ? '' : 'none';
    if (addForm.style.display === '') frontIn.focus();
  });
  view.appendChild(addForm);

  // Toolbar: search + the view controls. Grouping and density are REAL
  // controls (core dropdowns), not chips — chips are content filters, and
  // dressing controls as chips made them read as slop.
  const toolbar = el('div', 'fc-browse-toolbar');
  const searchIn = el('input', 'fc-input');
  searchIn.placeholder = 'Search cards… (#tag searches tags)';
  toolbar.appendChild(searchIn);
  const groupDd = _api.ui.createDropdown(toolbar, {
    items: [
      { value: 'none', label: 'No Grouping' },
      { value: 'tag', label: 'Group by Tag' },
    ],
    selected: _fcBrowseGroupTag ? 'tag' : 'none',
    ariaLabel: 'Group cards',
  });
  groupDd.onDidChange((v) => {
    groupByTag = v === 'tag';
    _fcBrowseGroupTag = groupByTag;
    void renderList();
  });
  const viewDd = _api.ui.createDropdown(toolbar, {
    items: [
      { value: 'full', label: 'Full View' },
      { value: 'compact', label: 'Compact View' },
    ],
    selected: _fcBrowseCompact ? 'compact' : 'full',
    ariaLabel: 'Card density',
  });
  viewDd.onDidChange((v) => {
    compactView = v === 'compact';
    _fcBrowseCompact = compactView;
    void renderList();
  });
  view.appendChild(toolbar);

  // Flag bar: sits above the tags because a flag is the coarser cut. ANY-of,
  // unlike tags — flags are alternatives, not stacking attributes.
  const flagBar = el('div', 'fc-tagbar fc-flagbar');
  view.appendChild(flagBar);

  // Tag bar: every tag in the deck as a filter chip (click to narrow;
  // multiple active tags = ALL must match).
  const tagBar = el('div', 'fc-tagbar');
  view.appendChild(tagBar);

  // Bulk bar: appears while cards are selected (user ask: move/copy cards
  // between decks, in bulk).
  const bulkBar = el('div', 'fc-bulkbar');
  bulkBar.style.display = 'none';
  view.appendChild(bulkBar);

  const listHost = el('div');
  view.appendChild(listHost);

  const selectedIds = new Set();
  const activeTags = new Set();
  const activeFlags = new Set();
  let groupByTag = _fcBrowseGroupTag;
  let compactView = _fcBrowseCompact;
  // List-selection state: rows in rendered order (Shift ranges walk it) and
  // the anchor index the last plain/Ctrl click planted.
  const renderedRows = [];
  let anchorIndex = null;

  const syncBulkBar = () => {
    bulkBar.replaceChildren();
    if (selectedIds.size === 0) { bulkBar.style.display = 'none'; return; }
    bulkBar.style.display = '';
    bulkBar.appendChild(el('span', 'fc-bulkbar__count', `${selectedIds.size} Selected`));
    const mk = (label, handler) => {
      const b = el('button', 'fc-btn fc-btn--small');
      b.textContent = label;
      b.addEventListener('click', () => void handler());
      bulkBar.appendChild(b);
    };
    mk('Move to Deck…', async () => {
      const targetId = await fcPickDeckTarget(deckRow.id, `Move ${selectedIds.size} cards into…`);
      if (targetId == null) return;
      const moved = await fcMoveCards([...selectedIds], targetId);
      selectedIds.clear();
      void _api.window.showInformationMessage(
        `Moved ${moved} ${moved === 1 ? 'card' : 'cards'}.${moved > 0 ? ' Cloze and reverse siblings travel together.' : ''}`);
      void renderList();
    });
    mk('Copy to Deck…', async () => {
      const targetId = await fcPickDeckTarget(null, `Copy ${selectedIds.size} cards into…`);
      if (targetId == null) return;
      const copied = await fcCopyCards([...selectedIds], targetId);
      selectedIds.clear();
      void _api.window.showInformationMessage(`Copied ${copied} ${copied === 1 ? 'card' : 'cards'} as fresh cards.`);
      void renderList();
    });
    // Inline swatches, not a "Set Flag…" quick-pick: flagging a selection is
    // a one-click action and a modal for four options would be theatre.
    bulkBar.appendChild(el('span', 'fc-bulkbar__sep'));
    const bulkFlags = fcCreateFlagPicker(bulkBar, {
      compact: true,
      onPick: (next) => {
        if (!next) { bulkFlags.set(0); return; }
        void (async () => {
          const ids = [...selectedIds];
          const n = await fcBulkFlag(ids, next);
          void _api.window.showInformationMessage(
            `Flagged ${n} ${n === 1 ? 'card' : 'cards'} ${fcFlagDef(next).name}.`);
          // Here the swatches are an action palette, not a state readout —
          // the selection can hold four different flags at once.
          bulkFlags.set(0);
          void renderList();
        })();
      },
    });
    bulkFlags.root.title = 'Flag every selected card';
    mk('Clear Flag', async () => {
      const n = await fcBulkFlag([...selectedIds], 0);
      void _api.window.showInformationMessage(`Cleared the flag on ${n} ${n === 1 ? 'card' : 'cards'}.`);
      void renderList();
    });

    mk('Add Tag…', async () => {
      const tag = await _api.window.showInputBox({ prompt: `Add a tag to ${selectedIds.size} cards`, placeholder: 'e.g. mack' });
      if (!tag?.trim()) return;
      const n = await fcBulkTag([...selectedIds], tag);
      void _api.window.showInformationMessage(`Tagged ${n} ${n === 1 ? 'card' : 'cards'} with #${tag.trim().replace(/^#/, '')}.`);
      void renderList();
    });
    mk('Remove Tag…', async () => {
      // Offer only tags that actually exist on the selection.
      const rows = await db.all(
        `SELECT tags FROM fc_cards WHERE id IN (${[...selectedIds].map(() => '?').join(',')})`, [...selectedIds]);
      const present = [...new Set(rows.flatMap((r) => fcParseTags(r.tags)))].sort();
      if (present.length === 0) {
        void _api.window.showInformationMessage('The selected cards have no tags.');
        return;
      }
      const pick = await _api.window.showQuickPick(
        present.map((t) => ({ label: `#${t}` })), { placeholder: 'Remove which tag from the selection?' });
      if (!pick) return;
      const n = await fcBulkTag([...selectedIds], pick.label, true);
      void _api.window.showInformationMessage(`Removed ${pick.label} from ${n} ${n === 1 ? 'card' : 'cards'}.`);
      void renderList();
    });
    mk('Clear Selection', () => {
      selectedIds.clear();
      void renderList();
    });
  };

  const renderFlagBar = (cards) => {
    flagBar.replaceChildren();
    const counts = new Map();
    for (const c of cards) {
      const f = fcNormalizeFlag(c.flag);
      if (f) counts.set(f, (counts.get(f) || 0) + 1);
    }
    // Drop filters for flags that no longer exist here, or the list goes
    // blank with no visible cause.
    for (const f of [...activeFlags]) if (!counts.has(f)) activeFlags.delete(f);
    for (const f of FC_FLAGS) {
      if (!counts.has(f.value)) continue;
      const chip = el('button', `fc-chip fc-tagchip fc-flagchip fc-flagchip--${f.cls}`);
      chip.type = 'button';
      chip.appendChild(el('span', `fc-flag-dot fc-flag-dot--${f.cls}`));
      chip.appendChild(el('span', '', `${f.name} ${counts.get(f.value)}`));
      chip.classList.toggle('fc-tagchip--active', activeFlags.has(f.value));
      chip.setAttribute('aria-pressed', activeFlags.has(f.value) ? 'true' : 'false');
      chip.addEventListener('click', () => {
        if (activeFlags.has(f.value)) activeFlags.delete(f.value); else activeFlags.add(f.value);
        void renderList();
      });
      flagBar.appendChild(chip);
    }
  };

  const renderTagBar = (cards) => {
    tagBar.replaceChildren();
    const counts = new Map();
    for (const c of cards) {
      for (const t of fcParseTags(c.tags)) counts.set(t, (counts.get(t) || 0) + 1);
    }
    for (const [tag, n] of [...counts.entries()].sort((a, b) => b[1] - a[1])) {
      const chip = el('button', 'fc-chip fc-tagchip');
      chip.type = 'button';
      chip.textContent = `#${tag} ${n}`;
      chip.classList.toggle('fc-tagchip--active', activeTags.has(tag));
      chip.addEventListener('click', () => {
        if (activeTags.has(tag)) activeTags.delete(tag); else activeTags.add(tag);
        void renderList();
      });
      tagBar.appendChild(chip);
    }
  };

  const renderList = async (keepCardId = null) => {
    const rawSearch = searchIn.value.trim();
    const tagSearch = rawSearch.startsWith('#') ? rawSearch.slice(1).toLowerCase() : null;
    let cards = await fcListCards(deckRow.id, tagSearch !== null ? '' : searchIn.value);
    renderFlagBar(cards);
    renderTagBar(cards);
    if (tagSearch) {
      cards = cards.filter((c) => fcParseTags(c.tags).some((t) => t.toLowerCase().includes(tagSearch)));
    }
    if (activeFlags.size > 0) {
      cards = cards.filter((c) => activeFlags.has(fcNormalizeFlag(c.flag)));
    }
    if (activeTags.size > 0) {
      cards = cards.filter((c) => {
        const tags = new Set(fcParseTags(c.tags));
        return [...activeTags].every((t) => tags.has(t));
      });
    }
    // Rebuilding collapses the pane's scroll height, which clamps scrollTop
    // to ~0 — saving an edit deep in a long deck dumped the user at the top
    // ("does not keep me at that card"). Capture, rebuild, restore; rows
    // append synchronously so the height is back before the restore.
    const scrollTop = body.scrollTop;
    listHost.innerHTML = '';
    renderedRows.length = 0;
    anchorIndex = null;
    syncBulkBar();
    if (cards.length === 0) {
      listHost.appendChild(el('div', 'fc-empty',
        rawSearch || activeTags.size || activeFlags.size ? 'No matches.' : 'No cards in this deck yet.'));
      return;
    }
    listHost.classList.toggle('fc-cardlist--compact', compactView);
    let rowNumber = 0;
    if (groupByTag) {
      // A multi-tagged card appears under EACH of its tags (true grouping).
      const groups = new Map();
      for (const card of cards) {
        const tags = fcParseTags(card.tags);
        for (const t of tags.length ? tags : ['(untagged)']) {
          if (!groups.has(t)) groups.set(t, []);
          groups.get(t).push(card);
        }
      }
      for (const [tag, group] of [...groups.entries()].sort((a, b) => a[0].localeCompare(b[0]))) {
        listHost.appendChild(el('div', 'fc-label', `${tag === '(untagged)' ? tag : `#${tag}`} · ${group.length}`));
        let n = 0;
        for (const card of group) listHost.appendChild(buildCardRow(card, ++n));
      }
    } else {
      for (const card of cards) {
        listHost.appendChild(buildCardRow(card, ++rowNumber));
      }
    }
    body.scrollTop = scrollTop;
    if (keepCardId != null) {
      const row = listHost.querySelector(`[data-card-id="${keepCardId}"]`);
      row?.scrollIntoView?.({ block: 'nearest' }); // no-op when already visible
    }
  };

  const buildCardRow = (card, number) => {
    const row = el('div', 'fc-cardrow');
    row.dataset.cardId = String(card.id);
    if (card.suspended) row.classList.add('fc-cardrow--suspended');

    // The flag reads as a stripe down the rail, not another meta chip: it has
    // to be scannable down a list of a hundred rows.
    const applyFlagClass = (value) => {
      for (const f of FC_FLAGS) row.classList.remove(`fc-cardrow--flag-${f.cls}`);
      const def = fcFlagDef(value);
      if (def) row.classList.add(`fc-cardrow--flag-${def.cls}`);
    };
    applyFlagClass(card.flag);

    // Left rail: the card number in a fixed-width column.
    const rail = el('div', 'fc-cardrow__rail');
    rail.appendChild(el('span', 'fc-cardrow__num', String(number)));
    row.appendChild(rail);

    // List selection, no checkboxes: click selects (click again deselects),
    // Ctrl/Cmd+click toggles, Shift+click extends from the anchor —
    // the same contract as the canvas sidebar and media organizer.
    // Under Group by Tag a card can render under several tags; selection is
    // by id, so every occurrence lights up together.
    const rowIndex = renderedRows.length;
    renderedRows.push({ row, id: card.id });
    if (selectedIds.has(card.id)) row.classList.add('fc-cardrow--selected');
    row.addEventListener('mousedown', (e) => {
      if (e.shiftKey) e.preventDefault(); // range-select, not text-select
    });
    row.addEventListener('click', (e) => {
      if (e.target.closest('button, a, input, textarea, .fc-chip')) return;
      if (e.shiftKey && anchorIndex !== null) {
        if (!(e.ctrlKey || e.metaKey)) selectedIds.clear();
        const lo = Math.min(anchorIndex, rowIndex);
        const hi = Math.max(anchorIndex, rowIndex);
        for (let i = lo; i <= hi; i++) selectedIds.add(renderedRows[i].id);
      } else if (e.ctrlKey || e.metaKey) {
        if (selectedIds.has(card.id)) selectedIds.delete(card.id); else selectedIds.add(card.id);
        anchorIndex = rowIndex;
      } else {
        const wasOnly = selectedIds.size === 1 && selectedIds.has(card.id);
        selectedIds.clear();
        if (!wasOnly) selectedIds.add(card.id);
        anchorIndex = wasOnly ? null : rowIndex;
        // Compact mode: the click that selects a question also expands it.
        if (listHost.classList.contains('fc-cardlist--compact')) {
          row.classList.toggle('fc-cardrow--expanded');
        }
      }
      for (const r of renderedRows) r.row.classList.toggle('fc-cardrow--selected', selectedIds.has(r.id));
      syncBulkBar();
    });

    const content = el('div', 'fc-cardrow__content');
    const front = el('div', 'fc-cardrow__front');
    front.appendChild(_api.ui.renderMarkdown ? _api.ui.renderMarkdown(card.front) : document.createTextNode(card.front));
    content.appendChild(front);
    const back = el('div', 'fc-cardrow__back');
    back.appendChild(_api.ui.renderMarkdown ? _api.ui.renderMarkdown(card.back) : document.createTextNode(card.back));
    content.appendChild(back);
    if (card.notes) {
      content.appendChild(el('div', 'fc-cardrow__notes', card.notes));
    }
    const meta = el('div', 'fc-cardrow__meta');
    const stateChip = el('span', `fc-state fc-state--${card.state === 'relearning' ? 'learning' : card.state}`);
    stateChip.textContent = card.state;
    meta.appendChild(stateChip);
    // M98 card types: siblings announce themselves (edits propagate group-wide).
    if (card.cardType === 'cloze') meta.appendChild(el('span', '', `Cloze c${card.clozeIndex}`));
    else if (card.cardType === 'reverse') meta.appendChild(el('span', '', 'Reverse Pair'));
    // M101 exam criticality — the introduction-order signal, kept auditable.
    if (card.importance > 0) {
      const imp = el('span', '', `Importance ${card.importance}`);
      if (card.importanceReason) imp.title = card.importanceReason;
      meta.appendChild(imp);
    }
    if (card.state !== 'new') {
      meta.appendChild(el('span', '', card.dueAt <= Date.now()
        ? 'Due Now'
        : `Due ${new Date(card.dueAt).toLocaleDateString()}`));
      // FSRS state (M98); legacy ease only for cards not yet migrated.
      if (card.stability > 0) {
        const s = el('span', '', `Stability ${card.stability < 100 ? card.stability.toFixed(1) : Math.round(card.stability)}d`);
        s.title = `Difficulty ${card.difficulty.toFixed(1)} / 10`;
        meta.appendChild(s);
      } else {
        meta.appendChild(el('span', '', `Ease ${card.ease.toFixed(2)}`));
      }
      meta.appendChild(el('span', '', `${card.reps} ${card.reps === 1 ? 'Rep' : 'Reps'}`));
      if (card.lapses > 0) meta.appendChild(el('span', '', `${card.lapses} ${card.lapses === 1 ? 'Lapse' : 'Lapses'}`));
      if (fcIsLeech(card)) meta.appendChild(el('span', 'fc-meta-leech', 'Leech'));
    }
    // M102: the recall mode is scheduling-relevant metadata — it changes what
    // a review of this card costs, so it belongs on the row rather than
    // hidden one click deep in the editor.
    if (fcIsProductionMode(card.recallMode)) {
      const mode = el('span', 'fc-meta-recall', FC_RECALL_MODE_CHIPS[card.recallMode]);
      mode.title = card.rubric.length
        ? `${card.rubric.length} rubric ${card.rubric.length === 1 ? 'point' : 'points'} — ${FC_RECALL_MODE_HINTS[card.recallMode]}`
        : FC_RECALL_MODE_HINTS[card.recallMode];
      meta.appendChild(mode);
    }
    for (const t of fcParseTags(card.tags)) {
      meta.appendChild(el('span', 'fc-chip', `#${t}`));
    }
    if (card.sourceLabel) meta.appendChild(el('span', '', card.sourceLabel));
    content.appendChild(meta);

    // M102 answer history. Written answers accumulate on the append-only
    // review log, and reading six months of them back-to-back shows whether
    // an explanation is consolidating or drifting — which is the progress
    // signal a score cannot carry. Loaded on demand: a deck of a thousand
    // cards must not query a history nobody asked to see.
    const historyHost = el('div', 'fc-cardrow__history');
    historyHost.style.display = 'none';
    content.appendChild(historyHost);

    const btns = el('div', 'fc-cardrow__actions');
    fcCreateFlagPicker(btns, {
      value: card.flag,
      compact: true,
      onPick: (next) => {
        card.flag = next;
        applyFlagClass(next);
        // No re-render: it would collapse the row and lose the selection.
        void fcUpdateCard(card.id, { flag: next });
      },
    });
    if (fcIsProductionMode(card.recallMode)) {
      const histBtn = el('button', 'fc-btn');
      histBtn.textContent = 'Answers';
      let loaded = false;
      histBtn.addEventListener('click', () => {
        const showing = historyHost.style.display !== 'none';
        historyHost.style.display = showing ? 'none' : '';
        if (showing || loaded) return;
        loaded = true;
        historyHost.appendChild(el('div', 'fc-hint', 'Loading…'));
        void (async () => {
          try {
            const answers = await fcCardAnswerHistory(card.id);
            historyHost.replaceChildren(fcAnswerHistoryEl(answers, card.rubric, {
              onDiscuss: (marking) => void fcExplainInChat(card, deckRow.name, { marking }),
            }));
          } catch (e) {
            historyHost.replaceChildren(el('div', 'fc-hint', `Could not load answers: ${e.message}`));
          }
        })();
      });
      btns.appendChild(histBtn);
    }
    const editBtn = el('button', 'fc-btn');
    editBtn.textContent = 'Edit';
    editBtn.addEventListener('click', () => {
      row.classList.add('fc-cardrow--editing');
      row.replaceChildren(fcCardEditorEl(card, {
        onSave: async (patch) => {
          await fcUpdateCard(card.id, patch);
          void renderList(card.id);
        },
        onCancel: () => void renderList(card.id),
      }));
    });
    btns.appendChild(editBtn);
    const suspendBtn = el('button', 'fc-btn');
    suspendBtn.textContent = card.suspended ? 'Unsuspend' : 'Suspend';
    suspendBtn.addEventListener('click', () => {
      // Explicit arrows: fcUpdateCard resolves undefined, and a bare
      // .then(renderList) would pass it as keepCardId's stand-in.
      void fcUpdateCard(card.id, { suspended: !card.suspended }).then(() => renderList(card.id));
    });
    btns.appendChild(suspendBtn);
    const delBtn = el('button', 'fc-btn fc-btn--danger');
    delBtn.textContent = 'Delete';
    delBtn.addEventListener('click', () => {
      void fcDeleteCard(card.id).then(() => renderList());
    });
    btns.appendChild(delBtn);
    content.appendChild(btns);
    row.appendChild(content);
    return row;
  };

  let searchTimer = null;
  searchIn.addEventListener('input', () => {
    if (searchTimer) clearTimeout(searchTimer);
    searchTimer = setTimeout(() => void renderList(), 200);
  });

  await renderList();
  body.appendChild(view);
}

// ── Find Duplicates view (deck-wide AI dedup) ────────────────────────────────

async function renderDedup(body, route, setRoute) {
  const deckRow = await db.get('SELECT * FROM fc_decks WHERE id = ?', [route.deckId]);
  if (!deckRow) { setRoute({ view: 'decks' }); return; }
  const view = el('div', 'fc-view');

  const head = el('div', 'fc-row');
  const backBtn = el('button', 'fc-btn');
  backBtn.innerHTML = `${icon('arrow-left', 12)}<span>Back</span>`;
  backBtn.addEventListener('click', () => setRoute({ view: 'browse', deckId: deckRow.id }));
  head.appendChild(backBtn);
  head.appendChild(el('div', 'fc-view__title', `Find Duplicates - ${deckRow.name}`));
  view.appendChild(head);
  view.appendChild(el('div', 'fc-hint',
    'Cards asking essentially the same thing, even with different wording. Nothing is deleted until you apply your choices.'));

  const errEl = el('div', 'fc-error');
  errEl.style.display = 'none';
  const status = el('div', 'fc-hint fc-src-status');
  const resultsHost = el('div');
  const footer = el('div', 'fc-row');
  footer.style.marginTop = '10px';
  view.appendChild(status);
  view.appendChild(errEl);
  view.appendChild(resultsHost);
  view.appendChild(footer);
  body.appendChild(view);

  /** Card ids staged for deletion (checkboxes; applied on the footer click). */
  const staged = new Set();

  // Judge state shared between the initial pass and Retry AI Judge.
  let currentClusters = [];
  let cardByIdRef = new Map();
  let methodLabel = '';
  let lastFailure = null;

  const retryBtn = el('button', 'fc-btn');
  retryBtn.textContent = 'Retry AI Judge';
  retryBtn.title = 'Run the AI judge again over the groups it has not reviewed.';
  retryBtn.style.display = 'none';
  status.after(retryBtn);
  retryBtn.addEventListener('click', () => void judgePass());

  const unjudgedCount = () => currentClusters.filter((c) => !c.verdict).length;

  /**
   * The banner never says a bare "unavailable" again: it carries the actual
   * failure and, for unjudged groups, the warning that raw similarity is NOT
   * an opinion — near-identical wording with different answers is usually a
   * deliberate contrast pair, the most exam-valuable card shape there is.
   */
  const updateStatus = () => {
    const total = currentClusters.length;
    const un = unjudgedCount();
    let text = `${total} candidate ${total === 1 ? 'group' : 'groups'} (${methodLabel})`;
    if (un === 0) {
      text += ', all reviewed by the AI judge.';
    } else {
      text += `. ${un === total ? 'AI judge failed' : `${un} ${un === 1 ? 'group' : 'groups'} not judged`}`
        + (lastFailure ? `: ${lastFailure}` : '.')
        + ' Unjudged groups show wording similarity only - that is NOT a duplicate verdict, and look-alikes with different answers are usually deliberate contrast pairs.';
    }
    status.textContent = text;
    retryBtn.style.display = un > 0 ? '' : 'none';
  };

  const renderClusters = (clusters, cardById) => {
    resultsHost.replaceChildren();
    footer.replaceChildren();
    staged.clear();

    // Triage order: real duplicates first, then overlaps, then unjudged.
    // Groups the judge CLEARED as distinct collapse out of the way - making
    // the user re-triage pairs the judge already kept was pure noise.
    const rank = (c) => (c.verdict === 'duplicate' ? 0 : c.verdict === 'overlap' ? 1 : !c.verdict ? 2 : 3);
    const ordered = [...clusters].sort((a, b) => rank(a) - rank(b));
    const cleared = ordered.filter((c) => c.verdict === 'distinct');
    const actionable = ordered.filter((c) => c.verdict !== 'distinct');

    const buildGroup = (cluster) => {
      const group = el('div', 'fc-dupgroup');
      const groupHead = el('div', 'fc-row');
      const judgedBad = cluster.verdict === 'duplicate' || cluster.verdict === 'overlap';
      const simChip = el('span', judgedBad ? 'fc-chip fc-chip--warn' : 'fc-chip', `${Math.round(cluster.similarity * 100)}% Similar`);
      groupHead.appendChild(simChip);
      if (cluster.verdict === 'duplicate') groupHead.appendChild(el('span', 'fc-chip fc-chip--warn', 'AI: Duplicate'));
      else if (cluster.verdict === 'overlap') groupHead.appendChild(el('span', 'fc-chip', 'AI: Overlapping'));
      else if (cluster.verdict === 'distinct') groupHead.appendChild(el('span', 'fc-chip', 'AI: Distinct - Both Stay'));
      else groupHead.appendChild(el('span', 'fc-chip', 'Unjudged - Similarity Only'));
      if (cluster.reason) groupHead.appendChild(el('span', 'fc-hint', cluster.reason));
      group.appendChild(groupHead);

      const checks = new Map();
      for (const id of cluster.cardIds) {
        const card = cardById.get(id);
        if (!card) continue;
        const row = el('div', 'fc-duprow');
        const check = el('input');
        check.type = 'checkbox';
        check.title = 'Delete this card when changes are applied';
        // AI suggestion pre-stages the losers of a clear duplicate; the
        // user always confirms via Apply.
        check.checked = cluster.verdict === 'duplicate' && cluster.keepId != null && id !== cluster.keepId;
        if (check.checked) staged.add(id);
        check.addEventListener('change', () => {
          if (check.checked) staged.add(id); else staged.delete(id);
          row.classList.toggle('fc-duprow--staged', check.checked);
          syncFooter();
        });
        checks.set(id, check);
        row.classList.toggle('fc-duprow--staged', check.checked);
        const checkWrap = el('label', 'fc-duprow__check');
        checkWrap.append(check, document.createTextNode(' Delete'));
        const bodyEl = el('div', 'fc-duprow__body');
        const frontEl = el('div', 'fc-duprow__front');
        try { frontEl.appendChild(_api.ui.renderMarkdown(card.front)); } catch { frontEl.textContent = card.front; }
        const backEl = el('div', 'fc-duprow__back');
        try { backEl.appendChild(_api.ui.renderMarkdown(card.back)); } catch { backEl.textContent = card.back; }
        const meta = el('div', 'fc-duprow__meta');
        const bits = [card.state, `${card.reps || 0} reps`];
        if (card.sourceLabel) bits.push(card.sourceLabel);
        if (cluster.keepId === id && cluster.verdict) bits.push('AI keeps this one');
        meta.textContent = bits.join(' · ');
        bodyEl.append(frontEl, backEl, meta);
        row.append(checkWrap, bodyEl);
        group.appendChild(row);
      }

      const actions = el('div', 'fc-row');
      const keepAll = el('button', 'fc-btn');
      keepAll.textContent = 'Keep All';
      keepAll.addEventListener('click', () => {
        for (const [id, check] of checks) {
          if (check.checked) { check.checked = false; staged.delete(id); }
          check.closest('.fc-duprow')?.classList.remove('fc-duprow--staged');
        }
        group.classList.add('fc-dupgroup--resolved');
        syncFooter();
      });
      actions.appendChild(keepAll);
      if (cluster.verdict === 'overlap' && cluster.mergedCard && cluster.keepId != null) {
        const mergeBtn = el('button', 'fc-btn');
        mergeBtn.textContent = 'Merge Into One';
        mergeBtn.title = 'Edit the AI-merged card; saving replaces this group with it.';
        mergeBtn.addEventListener('click', () => {
          const survivor = cardById.get(cluster.keepId);
          const editHost = el('div');
          group.appendChild(editHost);
          mergeBtn.disabled = true;
          editHost.appendChild(fcCardEditorEl({ ...survivor, front: cluster.mergedCard.front, back: cluster.mergedCard.back }, {
            onSave: async (patch) => {
              try {
                await fcUpdateCard(cluster.keepId, patch);
                for (const id of cluster.cardIds) {
                  if (id !== cluster.keepId) { await fcDeleteCard(id); staged.delete(id); }
                }
                group.classList.add('fc-dupgroup--resolved');
                group.replaceChildren(el('div', 'fc-hint', 'Merged. The survivor keeps its scheduling history.'));
                syncFooter();
              } catch (e) { errEl.textContent = e.message; errEl.style.display = ''; }
            },
            onCancel: () => { editHost.remove(); mergeBtn.disabled = false; },
          }));
        });
        actions.appendChild(mergeBtn);
      }
      group.appendChild(actions);
      return group;
    };

    for (const cluster of actionable) resultsHost.appendChild(buildGroup(cluster));
    if (actionable.length === 0 && cleared.length > 0) {
      resultsHost.appendChild(el('div', 'fc-hint',
        'The AI judge reviewed every look-alike group and kept them all - no duplicates to resolve.'));
    }

    if (cleared.length > 0) {
      const clearedWrap = el('div', 'fc-dupcleared');
      clearedWrap.appendChild(el('div', 'fc-hint',
        `${cleared.length} look-alike ${cleared.length === 1 ? 'group' : 'groups'} judged distinct and kept - contrast pairs or different facts. Nothing to do.`));
      const toggle = el('button', 'fc-btn');
      const host = el('div');
      host.style.display = 'none';
      let shown = false;
      const label = () => `${shown ? 'Hide' : 'Show'} ${cleared.length} Cleared ${cleared.length === 1 ? 'Group' : 'Groups'}`;
      toggle.textContent = label();
      toggle.addEventListener('click', () => {
        shown = !shown;
        host.style.display = shown ? '' : 'none';
        toggle.textContent = label();
      });
      clearedWrap.appendChild(toggle);
      for (const cluster of cleared) host.appendChild(buildGroup(cluster));
      clearedWrap.appendChild(host);
      resultsHost.appendChild(clearedWrap);
    }

    const applyBtn = el('button', 'fc-btn fc-btn--primary');
    const syncFooter = () => {
      applyBtn.textContent = staged.size > 0 ? `Apply Changes - Delete ${staged.size}` : 'Apply Changes';
      applyBtn.disabled = staged.size === 0;
    };
    applyBtn.addEventListener('click', () => {
      void (async () => {
        const ok = await _api.window.showConfirmModal?.({
          message: `Delete ${staged.size} ${staged.size === 1 ? 'card' : 'cards'}?`,
          detail: 'The cards and their review history are permanently removed. This cannot be undone.',
          confirmLabel: 'Delete Cards',
          danger: true,
        }) ?? false;
        if (!ok) return;
        applyBtn.disabled = true;
        try {
          for (const id of staged) await fcDeleteCard(id);
          // Toast fire-and-forget: awaiting it holds the route switch until
          // the notification dismisses.
          void _api.window.showInformationMessage(`Deleted ${staged.size} duplicate ${staged.size === 1 ? 'card' : 'cards'}.`);
          setRoute({ view: 'browse', deckId: deckRow.id });
        } catch (e) {
          errEl.textContent = e.message;
          errEl.style.display = '';
          applyBtn.disabled = false;
        }
      })();
    });
    footer.appendChild(applyBtn);
    syncFooter();
  };

  /**
   * Judge the not-yet-judged clusters and repaint. Runs once after the sweep
   * and again from Retry AI Judge — retry reuses the sweep, so a stalled
   * model costs one click to recover from, not a full re-scan.
   */
  const judgePass = async () => {
    retryBtn.disabled = true;
    retryBtn.style.display = 'none';
    const pending = currentClusters.map((c, i) => ({ c, i })).filter((x) => !x.c.verdict);
    if (pending.length === 0) {
      retryBtn.disabled = false;
      updateStatus();
      return;
    }
    status.textContent = `Reviewing ${pending.length} candidate ${pending.length === 1 ? 'group' : 'groups'} with AI…`;
    const { clusters: judged, failure } = await fcJudgeDuplicateClusters(
      pending.map((x) => x.c), cardByIdRef,
      { onProgress: (done, total) => { status.textContent = `Reviewing with AI - ${done} / ${total} groups…`; } },
    );
    if (!body.isConnected) return;
    judged.forEach((jc, k) => { currentClusters[pending[k].i] = jc; });
    lastFailure = failure;
    retryBtn.disabled = false;
    updateStatus();
    renderClusters(currentClusters, cardByIdRef);
  };

  const run = async () => {
    resultsHost.replaceChildren();
    footer.replaceChildren();
    errEl.style.display = 'none';
    status.textContent = 'Scanning the deck for similar cards…';
    try {
      const { pairs, method } = await fcSweepDeckPairs(deckRow.id, {
        onProgress: (done, total) => { status.textContent = `Scanning the deck - ${done} / ${total} cards…`; },
      });
      if (!body.isConnected) return;
      const clusters = fcClusterPairs(pairs);
      if (clusters.length === 0) {
        status.textContent = 'No likely duplicates found. The deck looks clean.';
        return;
      }
      const cards = await fcListAllCards(deckRow.id);
      cardByIdRef = new Map(cards.map((c) => [c.id, c]));
      currentClusters = clusters;
      methodLabel = method === 'embedding' ? 'semantic match' : 'text match';
      await judgePass();
    } catch (e) {
      status.textContent = '';
      errEl.textContent = e.message;
      errEl.style.display = '';
    }
  };
  void run();
}

// ── Coverage Review view (does the deck cover the material?) ─────────────────

async function renderCoverage(body, route, setRoute) {
  const deckRow = await db.get('SELECT * FROM fc_decks WHERE id = ?', [route.deckId]);
  if (!deckRow) { setRoute({ view: 'decks' }); return; }
  const view = el('div', 'fc-view');

  const head = el('div', 'fc-row');
  const backBtn = el('button', 'fc-btn');
  backBtn.innerHTML = `${icon('arrow-left', 12)}<span>Back</span>`;
  backBtn.addEventListener('click', () => setRoute({ view: 'browse', deckId: deckRow.id }));
  head.appendChild(backBtn);
  head.appendChild(el('div', 'fc-view__title', `Coverage Review - ${deckRow.name}`));
  view.appendChild(head);
  view.appendChild(el('div', 'fc-hint',
    'Load the material this deck should cover. The AI reports what is covered well, what is thin, and what is missing - and drafts the missing cards for review.'));

  const errEl = el('div', 'fc-error');
  errEl.style.display = 'none';

  // Source list — same multi-source model as Create.
  view.appendChild(el('div', 'fc-label', 'Source Material'));
  const sources = [];
  const chipsHost = el('div', 'fc-row fc-srcchips');
  const srcStatus = el('div', 'fc-hint fc-src-status', 'Add every document the deck is meant to cover.');
  const renderChips = () => {
    chipsHost.replaceChildren();
    sources.forEach((s, i) => {
      const chip = el('span', 'fc-chip fc-srcchip');
      const pages = Array.isArray(s.pageTexts) && s.pageTexts.length ? ` · ${s.pageTexts.length}p` : '';
      chip.appendChild(document.createTextNode(`${s.label}${pages} `));
      const x = el('button', 'fc-srcchip__remove');
      x.type = 'button'; x.textContent = '×'; x.title = `Remove ${s.label}`;
      x.addEventListener('click', () => { sources.splice(i, 1); renderChips(); });
      chip.appendChild(x);
      chipsHost.appendChild(chip);
    });
    if (sources.length > 0) {
      srcStatus.textContent = `${sources.length} ${sources.length === 1 ? 'source' : 'sources'} loaded.`;
    }
  };
  const addSource = (loaded) => {
    if (!loaded) return;
    const idx = loaded.uri ? sources.findIndex((s) => s.uri === loaded.uri) : -1;
    if (idx >= 0) sources[idx] = loaded; else sources.push(loaded);
    renderChips();
  };

  // Pre-fill offers: the sources this deck's cards already cite.
  const cited = await db.all(
    `SELECT source_uri AS uri, source_label AS label, COUNT(*) AS n
     FROM fc_cards WHERE deck_id = ? AND source_uri != ''
     GROUP BY source_uri ORDER BY n DESC LIMIT 8`,
    [deckRow.id],
  );
  if (cited.length > 0) {
    const citedRow = el('div', 'fc-row');
    citedRow.appendChild(el('span', 'fc-hint', 'This deck cites:'));
    for (const c of cited) {
      const chip = el('button', 'fc-chip fc-chip--link');
      chip.type = 'button';
      chip.textContent = `Load ${c.label} (${c.n} cards)`;
      chip.addEventListener('click', () => {
        void (async () => {
          try {
            chip.disabled = true;
            srcStatus.textContent = `Loading ${c.label}…`;
            const canvasMatch = /^parallx:\/\/canvas\/page\/(.+)$/.exec(c.uri);
            addSource(canvasMatch ? await fcReadCanvasPage(canvasMatch[1]) : await fcExtractPath(c.uri));
          } catch (e) {
            srcStatus.textContent = `Could not load ${c.label}: ${e.message}`;
            chip.disabled = false;
          }
        })();
      });
      citedRow.appendChild(chip);
    }
    view.appendChild(citedRow);
  }

  const srcRow = el('div', 'fc-row');
  const srcBtn = (label, iconName, loader) => {
    const b = el('button', 'fc-btn');
    b.innerHTML = `${icon(iconName, 12)}<span>${label}</span>`;
    b.addEventListener('click', () => {
      void (async () => {
        try { b.disabled = true; addSource(await loader()); }
        catch (e) { srcStatus.textContent = `Failed: ${e.message}`; }
        finally { b.disabled = false; }
      })();
    });
    return b;
  };
  srcRow.appendChild(srcBtn('Canvas Page', 'file-text', async () => {
    const pageId = await fcPickCanvasPage();
    return pageId ? fcReadCanvasPage(pageId) : null;
  }));
  srcRow.appendChild(srcBtn('Workspace File', 'file', () => fcPickWorkspaceFile()));
  srcRow.appendChild(srcBtn('Browse Device…', 'hard-drive', () => fcReadPdf()));
  view.appendChild(srcRow);
  view.appendChild(chipsHost);
  view.appendChild(srcStatus);
  view.appendChild(errEl);

  // ONE AI action on this surface.
  const genRow = el('div', 'fc-row');
  genRow.style.marginTop = '10px';
  const genBtn = _api.ui.createAiButton
    ? _api.ui.createAiButton(genRow, { label: 'Generate Report' })
    : el('button', 'fc-btn fc-btn--primary');
  if (!genBtn.parentElement) { genBtn.textContent = 'Generate Report'; genRow.appendChild(genBtn); }
  const genLabel = genBtn.querySelector('.px-ai-btn__label');
  const setLabel = (t) => { if (genLabel) genLabel.textContent = t; else genBtn.textContent = t; };
  view.appendChild(genRow);

  const reportHost = el('div');
  reportHost.style.marginTop = '12px';
  const missingHost = el('div');
  view.appendChild(reportHost);
  view.appendChild(missingHost);
  body.appendChild(view);

  genBtn.addEventListener('click', () => {
    void (async () => {
      if (sources.length === 0) {
        errEl.textContent = 'Load at least one source document first.';
        errEl.style.display = '';
        return;
      }
      errEl.style.display = 'none';
      reportHost.replaceChildren();
      missingHost.replaceChildren();
      genBtn.disabled = true;
      setLabel('Auditing coverage…');
      try {
        const deckCards = await fcListAllCards(deckRow.id);
        const streamOut = el('div', 'fc-hint');
        reportHost.appendChild(streamOut);
        const { report, missing } = await fcCoverageReview(sources, deckCards, {
          onChunk: (partial) => { streamOut.textContent = `${partial.length.toLocaleString()} chars received…`; },
        });
        if (!body.isConnected) return;
        reportHost.replaceChildren();
        reportHost.appendChild(el('div', 'fc-label', 'Coverage Report'));
        const reportEl = el('div', 'fc-coverage-report');
        try { reportEl.appendChild(_api.ui.renderMarkdown(report)); } catch { reportEl.textContent = report; }
        reportHost.appendChild(reportEl);

        if (missing.length > 0) {
          missingHost.appendChild(el('div', 'fc-label', `${missing.length} Suggested Missing ${missing.length === 1 ? 'Card' : 'Cards'}`));
          missingHost.appendChild(el('div', 'fc-hint', 'Edit or drop suggestions; nothing is saved until you import.'));
          const dups = await fcFindDuplicates(deckRow.id, missing);
          const rows = [];
          missing.forEach((c, ci) => {
            const row = el('div', 'fc-genrow');
            const fields = el('div', 'fc-genrow__fields');
            const dup = dups[ci];
            if (c.page || c.doc || dup) {
              const chips = el('div', 'fc-genrow__chips');
              if (c.doc && sources[c.doc - 1]) chips.appendChild(el('span', 'fc-chip', String(sources[c.doc - 1].label).slice(0, 32)));
              if (c.page) chips.appendChild(el('span', 'fc-chip', `p.${c.page}`));
              if (dup) {
                const dupChip = el('span', 'fc-chip fc-chip--warn', `Similar to: ${String(dup.matchFront).slice(0, 60)}`);
                dupChip.title = `${Math.round(dup.similarity * 100)}% similar to an existing card`;
                chips.appendChild(dupChip);
              }
              fields.appendChild(chips);
            }
            const { grid: frontGrid, ta: front } = fcPreviewTextarea(c.front);
            const { grid: backGrid, ta: back } = fcPreviewTextarea(c.back);
            fields.append(frontGrid, backGrid);
            row.appendChild(fields);
            const dropBtn = el('button', 'fc-btn fc-btn--danger');
            dropBtn.textContent = 'Drop';
            const entry = { front, back, tags: c.tags || '', page: c.page || 0, doc: c.doc || 0, dropped: false };
            dropBtn.addEventListener('click', () => {
              entry.dropped = !entry.dropped;
              row.classList.toggle('fc-genrow--dropped', entry.dropped);
              dropBtn.textContent = entry.dropped ? 'Keep' : 'Drop';
            });
            row.appendChild(dropBtn);
            rows.push(entry);
            missingHost.appendChild(row);
          });
          const importRow = el('div', 'fc-row');
          importRow.style.marginTop = '10px';
          const importBtn = el('button', 'fc-btn fc-btn--primary');
          importBtn.textContent = 'Import Missing Cards';
          importBtn.addEventListener('click', () => {
            void (async () => {
              const keep = rows.filter((r) => !r.dropped && r.front.value.trim() && r.back.value.trim());
              if (keep.length === 0) { errEl.textContent = 'No cards left to import.'; errEl.style.display = ''; return; }
              importBtn.disabled = true;
              try {
                for (const r of keep) {
                  const src = sources[r.doc - 1] || (sources.length === 1 ? sources[0] : null);
                  await fcCreateCard({
                    deckId: deckRow.id,
                    front: r.front.value,
                    back: r.back.value,
                    tags: r.tags,
                    sourceUri: src?.uri ?? '',
                    sourceLabel: src?.label ?? 'Coverage review',
                    sourcePage: src ? (r.page || 0) : 0,
                  });
                }
                void _api.window.showInformationMessage(`Imported ${keep.length} ${keep.length === 1 ? 'card' : 'cards'}.`);
                setRoute({ view: 'browse', deckId: deckRow.id });
              } catch (e) {
                errEl.textContent = e.message;
                errEl.style.display = '';
                importBtn.disabled = false;
              }
            })();
          });
          importRow.appendChild(importBtn);
          missingHost.appendChild(importRow);
        } else {
          missingHost.appendChild(el('div', 'fc-hint', 'No missing cards suggested - the deck covers the loaded material.'));
        }
      } catch (e) {
        errEl.textContent = e.message;
        errEl.style.display = '';
      } finally {
        genBtn.disabled = false;
        setLabel('Generate Report');
      }
    })();
  });
}

/**
 * A ghost ICON button. With no text node the accessible name has to come from
 * aria-label, and if the host's icon registry is unavailable `icon()` returns
 * an empty string — which would render an invisible, unclickable control. Both
 * are handled here so no call site has to remember them.
 */
function fcIconBtn(host, { iconName, label, title, danger, onClick }) {
  const btn = el('button', `fc-btn fc-btn--ghost fc-btn--icon${danger ? ' fc-btn--danger' : ''}`);
  btn.type = 'button';
  const svg = icon(iconName, 15);
  if (svg) btn.innerHTML = svg;
  else btn.textContent = label; // registry missing — degrade to the word
  btn.title = title || label;
  btn.setAttribute('aria-label', label);
  btn.addEventListener('click', onClick);
  host.appendChild(btn);
  return btn;
}

// ── Card flags ───────────────────────────────────────────────────────────────

/**
 * The one flag control: four swatches, click the active one to clear.
 * Shared by the study toolbar and the browse rows so setting a flag looks and
 * behaves the same wherever you do it.
 *
 * Returns { root, set, value } — `set` moves the control WITHOUT firing
 * onPick, for callers that need to reflect an external change.
 */
function fcCreateFlagPicker(host, opts = {}) {
  const root = el('div', 'fc-flags');
  if (opts.compact) root.classList.add('fc-flags--compact');
  root.setAttribute('role', 'radiogroup');
  root.setAttribute('aria-label', 'Card flag');

  let value = fcNormalizeFlag(opts.value);
  const buttons = [];

  const sync = () => {
    for (const [f, btn] of buttons) {
      const on = f.value === value;
      btn.classList.toggle('fc-flag--on', on);
      btn.setAttribute('aria-checked', on ? 'true' : 'false');
    }
  };

  for (const f of FC_FLAGS) {
    const btn = el('button', `fc-flag fc-flag--${f.cls}`);
    btn.type = 'button';
    btn.setAttribute('role', 'radio');
    btn.setAttribute('aria-label', `${f.name} flag`);
    btn.title = opts.shortcutHint
      ? `${f.name} flag · Alt+${f.value} · click again to clear`
      : `${f.name} flag · click again to clear`;
    btn.addEventListener('click', (e) => {
      e.stopPropagation(); // browse rows are themselves clickable
      // Clicking the active swatch clears — a flag you can set but not
      // unset is a trap, and there is no room for a separate clear button.
      const next = value === f.value ? 0 : f.value;
      value = next;
      sync();
      opts.onPick?.(next);
    });
    root.appendChild(btn);
    buttons.push([f, btn]);
  }

  sync();
  host.appendChild(root);
  return {
    root,
    set(next) { value = fcNormalizeFlag(next); sync(); },
    get value() { return value; },
  };
}

// ── Custom Study view ────────────────────────────────────────────────────────

/** Copy for each mode. `unit` labels the count field; `noun` names what the
 *  availability line is counting. */
const FC_CUSTOM_MODE_DEFS = [
  {
    mode: 'extra',
    label: 'Extra New Cards',
    blurb: 'Introduce more new cards now, past the batch the daily session hands you.',
    unit: 'Cards To Introduce',
    noun: 'new cards',
  },
  {
    mode: 'ahead',
    label: 'Review Ahead',
    blurb: 'Pull forward reviews that fall due soon — spend a free day now instead of losing it.',
    unit: 'Cards At Most',
    noun: 'reviews in range',
  },
  {
    mode: 'hard',
    label: 'Difficult Cards',
    blurb: 'The cards you lapse most, regardless of schedule. Grading will not change your schedule.',
    unit: 'Cards At Most',
    noun: 'lapsed cards',
  },
  {
    mode: 'cram',
    label: 'Cram',
    blurb: 'Any cards in scope, most-overdue first. Grading will not change your schedule.',
    unit: 'Cards At Most',
    noun: 'cards in scope',
  },
];

/** Custom Study choices survive pane rebuilds — the workbench destroys this
 *  pane on every tab switch, and retyping the form each time would make the
 *  feature not worth reaching for. */
let _fcCustomPrefs = { mode: 'extra', count: 20, aheadDays: 3, tags: [], flags: [] };

/**
 * The Custom Study launcher: pick a mode, a size, and a tag scope, then hand
 * a built queue to the study session. A route (not a modal) because panes are
 * REBUILT on every tab switch — a route survives that via saveViewState, an
 * overlay would silently vanish.
 */
async function renderCustomStudy(body, route, setRoute) {
  const view = el('div', 'fc-view fc-cs');

  view.appendChild(el('div', 'fc-view__title', 'Custom Study'));
  view.appendChild(el('div', 'fc-hint',
    'Work ahead of the daily queue. The normal session hands you a fixed batch; this is how you reach everything behind it.'));

  const decks = await fcListDecks();
  let deckId = route.deckId ?? null;
  if (deckId != null && !decks.some((d) => d.id === deckId)) deckId = null;

  const state = {
    mode: FC_CUSTOM_MODES.includes(_fcCustomPrefs.mode) ? _fcCustomPrefs.mode : 'extra',
    count: _fcCustomPrefs.count,
    aheadDays: _fcCustomPrefs.aheadDays,
    tags: new Set(_fcCustomPrefs.tags || []),
    flags: new Set((_fcCustomPrefs.flags || []).map(fcNormalizeFlag).filter(Boolean)),
  };

  // ── Scope: deck + tags ──
  view.appendChild(el('div', 'fc-label', 'Deck'));
  const deckDd = _api.ui.createDropdown(view, {
    items: [
      { value: '__all__', label: 'All Decks' },
      ...decks.map((d) => ({ value: String(d.id), label: d.name })),
    ],
    selected: deckId == null ? '__all__' : String(deckId),
    ariaLabel: 'Deck to study',
  });

  const flagLabel = el('div', 'fc-label', 'Flags');
  view.appendChild(flagLabel);
  const flagBar = el('div', 'fc-tagbar fc-cs__flagbar');
  view.appendChild(flagBar);
  const flagHint = el('div', 'fc-hint', 'No flagged cards in this scope yet.');
  view.appendChild(flagHint);

  const tagLabel = el('div', 'fc-label', 'Tags');
  view.appendChild(tagLabel);
  const tagBar = el('div', 'fc-tagbar');
  view.appendChild(tagBar);
  const tagHint = el('div', 'fc-hint', 'No tags on these cards yet.');
  view.appendChild(tagHint);

  // ── Mode ──
  view.appendChild(el('div', 'fc-label', 'Mode'));
  const modeList = el('div', 'fc-cs__modes');
  modeList.setAttribute('role', 'radiogroup');
  modeList.setAttribute('aria-label', 'Custom study mode');
  view.appendChild(modeList);

  // ── Size ──
  const sizeRow = el('div', 'fc-cs__fields');
  view.appendChild(sizeRow);

  const countField = el('div', 'fc-cs__field');
  const countLabel = el('div', 'fc-label', 'Cards');
  countField.appendChild(countLabel);
  const countIn = el('input', 'fc-input');
  countIn.type = 'number';
  countIn.min = '1';
  countIn.max = '9999';
  countIn.value = String(state.count);
  countField.appendChild(countIn);
  sizeRow.appendChild(countField);

  const aheadField = el('div', 'fc-cs__field');
  aheadField.appendChild(el('div', 'fc-label', 'Days Ahead'));
  const aheadIn = el('input', 'fc-input');
  aheadIn.type = 'number';
  aheadIn.min = '1';
  aheadIn.max = '365';
  aheadIn.value = String(state.aheadDays);
  aheadField.appendChild(aheadIn);
  sizeRow.appendChild(aheadField);

  // ── Availability + actions ──
  const avail = el('div', 'fc-cs__avail');
  view.appendChild(avail);

  const actions = el('div', 'fc-row fc-cs__actions');
  const startBtn = el('button', 'fc-btn fc-btn--primary');
  startBtn.textContent = 'Start Studying';
  actions.appendChild(startBtn);
  const cancelBtn = el('button', 'fc-btn');
  cancelBtn.textContent = 'Cancel';
  cancelBtn.addEventListener('click', () => setRoute({ view: 'decks' }));
  actions.appendChild(cancelBtn);
  view.appendChild(actions);

  body.appendChild(view);

  // ── Live state ──
  /** Cards in the current deck scope, refetched when the deck changes. */
  let scopeCards = [];
  let matched = 0;

  const readInputs = () => {
    const c = Math.floor(Number(countIn.value));
    state.count = Number.isFinite(c) && c > 0 ? Math.min(9999, c) : 1;
    const a = Math.floor(Number(aheadIn.value));
    state.aheadDays = Number.isFinite(a) && a > 0 ? Math.min(365, a) : 1;
  };

  const def = () => FC_CUSTOM_MODE_DEFS.find((d) => d.mode === state.mode) || FC_CUSTOM_MODE_DEFS[0];

  /**
   * Every mode carries its OWN live count, not just the selected one.
   *
   * A deck of 48 new cards and 2 reviews made Review Ahead report "2 reviews
   * in range" with no hint that 46 cards were sitting one mode away — which
   * reads as "Custom Study can't reach my cards" (user report: "studying
   * ahead only shows one or two cards"). Showing all four counts at once
   * turns the mode list into the answer to "where ARE my cards".
   */
  const modeRows = new Map();

  const buildModes = () => {
    modeList.innerHTML = '';
    modeRows.clear();
    for (const d of FC_CUSTOM_MODE_DEFS) {
      const opt = el('button', 'fc-cs__mode');
      opt.type = 'button';
      opt.setAttribute('role', 'radio');
      opt.appendChild(el('span', 'fc-cs__mode-dot'));
      const text = el('span', 'fc-cs__mode-text');
      const nameRow = el('span', 'fc-cs__mode-namerow');
      nameRow.appendChild(el('span', 'fc-cs__mode-name', d.label));
      const count = el('span', 'fc-cs__mode-count');
      nameRow.appendChild(count);
      text.appendChild(nameRow);
      text.appendChild(el('span', 'fc-cs__mode-blurb', d.blurb));
      opt.appendChild(text);
      opt.addEventListener('click', () => {
        state.mode = d.mode;
        paintModes();
        syncFields();
        updateAvail();
      });
      modeRows.set(d.mode, { opt, count });
      modeList.appendChild(opt);
    }
    paintModes();
  };

  /** Selection state only — the DOM is built once. */
  const paintModes = () => {
    for (const [mode, row] of modeRows) {
      const active = mode === state.mode;
      row.opt.setAttribute('aria-checked', active ? 'true' : 'false');
      row.opt.classList.toggle('fc-cs__mode--active', active);
    }
  };

  const syncFields = () => {
    countLabel.textContent = def().unit;
    aheadField.style.display = state.mode === 'ahead' ? '' : 'none';
  };

  // Flags are ANY-of: they are alternatives you choose between, not
  // attributes that stack the way tags do.
  const renderFlags = () => {
    flagBar.innerHTML = '';
    const counts = new Map();
    for (const c of scopeCards) {
      if (c.suspended) continue;
      const f = fcNormalizeFlag(c.flag);
      if (f) counts.set(f, (counts.get(f) || 0) + 1);
    }
    for (const f of [...state.flags]) if (!counts.has(f)) state.flags.delete(f);
    const present = FC_FLAGS.filter((f) => counts.has(f.value));
    flagHint.style.display = present.length ? 'none' : '';
    flagLabel.style.display = present.length ? '' : 'none';
    for (const f of present) {
      const chip = el('button', `fc-chip fc-tagchip fc-flagchip fc-flagchip--${f.cls}`);
      chip.type = 'button';
      const dot = el('span', `fc-flag-dot fc-flag-dot--${f.cls}`);
      chip.appendChild(dot);
      chip.appendChild(el('span', '', `${f.name} (${counts.get(f.value)})`));
      chip.classList.toggle('fc-tagchip--active', state.flags.has(f.value));
      chip.setAttribute('aria-pressed', state.flags.has(f.value) ? 'true' : 'false');
      chip.addEventListener('click', () => {
        if (state.flags.has(f.value)) state.flags.delete(f.value); else state.flags.add(f.value);
        renderFlags();
        updateAvail();
      });
      flagBar.appendChild(chip);
    }
  };

  const renderTags = () => {
    tagBar.innerHTML = '';
    const counts = new Map();
    for (const c of scopeCards) {
      if (c.suspended) continue;
      for (const t of fcParseTags(c.tags)) counts.set(t, (counts.get(t) || 0) + 1);
    }
    // Drop selections that no longer exist in this deck scope, or the queue
    // silently matches nothing and the empty result looks like a bug.
    for (const t of [...state.tags]) if (!counts.has(t)) state.tags.delete(t);
    const tags = [...counts.keys()].sort((a, b) => a.localeCompare(b));
    tagHint.style.display = tags.length ? 'none' : '';
    tagLabel.style.display = tags.length ? '' : 'none';
    for (const tag of tags) {
      const chip = el('button', 'fc-chip fc-tagchip');
      chip.type = 'button';
      chip.textContent = `${tag} (${counts.get(tag)})`;
      chip.classList.toggle('fc-tagchip--active', state.tags.has(tag));
      chip.setAttribute('aria-pressed', state.tags.has(tag) ? 'true' : 'false');
      chip.addEventListener('click', () => {
        if (state.tags.has(tag)) state.tags.delete(tag); else state.tags.add(tag);
        renderTags();
        updateAvail();
      });
      tagBar.appendChild(chip);
    }
  };

  const updateAvail = () => {
    readInputs();
    const now = Date.now();
    const scope = { aheadDays: state.aheadDays, tags: [...state.tags], flags: [...state.flags] };

    // One pass over all four modes: the selected one drives the CTA, the rest
    // label their own rows so the whole picture is visible at once.
    const counts = new Map();
    for (const d of FC_CUSTOM_MODE_DEFS) {
      counts.set(d.mode, fcBuildCustomQueue(scopeCards, now, { ...scope, mode: d.mode }).length);
      const row = modeRows.get(d.mode);
      if (row) {
        const n = counts.get(d.mode);
        row.count.textContent = n === 0 ? 'none' : String(n);
        row.count.classList.toggle('fc-cs__mode-count--zero', n === 0);
      }
    }

    matched = counts.get(state.mode) ?? 0;
    const serving = Math.min(matched, state.count);
    const d = def();
    if (matched === 0) {
      const narrowed = [];
      if (state.flags.size > 0) narrowed.push(state.flags.size === 1 ? 'that flag' : 'those flags');
      if (state.tags.size > 0) narrowed.push(state.tags.size === 1 ? 'that tag' : 'all those tags');
      // Point at where the cards actually are. An empty mode with a full deck
      // behind it is the difference between "no cards" and "wrong mode", and
      // the user cannot tell those apart from a zero.
      const elsewhere = FC_CUSTOM_MODE_DEFS
        .filter((o) => o.mode !== state.mode && (counts.get(o.mode) || 0) > 0)
        .sort((a, b) => counts.get(b.mode) - counts.get(a.mode))[0];
      const hint = elsewhere
        ? ` ${elsewhere.label} has ${counts.get(elsewhere.mode)}.`
        : '';
      avail.textContent = (narrowed.length > 0
        ? `No ${d.noun} match ${narrowed.join(' and ')}.`
        : `No ${d.noun} available.`) + hint;
    } else {
      avail.textContent = `${matched} ${d.noun} available — this session will serve ${serving}.`;
    }
    avail.classList.toggle('fc-cs__avail--empty', matched === 0);
    startBtn.disabled = matched === 0;
    startBtn.textContent = matched === 0 ? 'Start Studying' : `Study ${serving} ${serving === 1 ? 'Card' : 'Cards'}`;
  };

  const reloadScope = async () => {
    scopeCards = await fcListAllCards(deckId);
    renderFlags();
    renderTags();
    updateAvail();
  };

  deckDd.onDidChange((v) => {
    deckId = v === '__all__' ? null : Number(v);
    void reloadScope();
  });
  countIn.addEventListener('input', updateAvail);
  aheadIn.addEventListener('input', updateAvail);

  startBtn.addEventListener('click', () => {
    readInputs();
    _fcCustomPrefs = {
      mode: state.mode, count: state.count, aheadDays: state.aheadDays,
      tags: [...state.tags], flags: [...state.flags],
    };
    setRoute({
      view: 'study',
      ...(deckId != null ? { deckId } : {}),
      custom: {
        mode: state.mode,
        count: state.count,
        aheadDays: state.aheadDays,
        tags: [...state.tags],
        flags: [...state.flags],
        // Stamps this launch so a tab switch RESUMES the same session (same
        // route → same key) while a fresh launch starts a new one.
        startedAt: Date.now(),
      },
    });
  });

  buildModes();
  syncFields();
  await reloadScope();
}

/** Names of the flags in a custom descriptor, for the study banner. */
function fcFlagNames(flags) {
  return (Array.isArray(flags) ? flags : [])
    .map((f) => fcFlagDef(f)?.name).filter(Boolean);
}

// ── Study view ───────────────────────────────────────────────────────────────

/** Browse view preferences — survive pane rebuilds like the sessions. */
let _fcBrowseCompact = false;
let _fcBrowseGroupTag = false;

/** Live study sessions, keyed by deck scope. Editor panes are DESTROYED on
 *  every tab switch (pane-lifecycle contract) — following a card's source
 *  link and coming back must resume the session, not reset it (user report:
 *  "loses place", and the in-memory pending pool held the Again-1m card).
 *
 *  INVARIANT: keys are ALWAYS strings — the deck id stringified, '__all__',
 *  or 'custom:<stamp>:<deckKey>'. A daily session used to key on the raw
 *  NUMBER, and fcPruneCustomSessions then called String methods on it: the
 *  moment you had studied any deck normally, launching Custom Study threw
 *  mid-render and left a blank pane ("Custom Study literally does not show
 *  any cards"). Never put a number in this map. */
const _fcStudySessions = new Map();

/**
 * Daily sessions are keyed by deck, so they self-limit. Custom ones are keyed
 * per LAUNCH (see renderStudy) — without this, opening Custom Study twenty
 * times would leave twenty card arrays pinned in memory forever. Drop the
 * finished ones, then cap the abandoned-but-unfinished remainder.
 */
function fcPruneCustomSessions(keepKey) {
  const live = [];
  for (const [key, s] of _fcStudySessions) {
    if (key === keepKey || !String(key).startsWith('custom:')) continue;
    if (s.index >= s.queue.length && s.pending.length === 0) {
      _fcStudySessions.delete(key);
      continue;
    }
    live.push(key);
  }
  // Oldest first, by the launch stamp the key carries.
  live.sort((a, b) => Number(a.split(':')[1]) - Number(b.split(':')[1]));
  while (live.length > 3) _fcStudySessions.delete(live.shift());
}

// ── Production recall UI (M102) ──────────────────────────────────────────────

/** What each production mode asks for, and how much room to ask for it in. */
const FC_PRODUCE_SPECS = {
  conceptual: {
    label: 'Write Your Answer',
    placeholder: 'In your own words, in full sentences. Recognising the answer is not the same as being able to state it.',
    rows: 7,
  },
  list: {
    label: 'List Them',
    placeholder: 'One item per line. Order does not matter.',
    rows: 6,
  },
  formula: {
    label: 'Write The Formula',
    placeholder: 'LaTeX or plain text. Spacing and delimiters are ignored.',
    rows: 3,
  },
};

/** Short row-chip names for the production modes. Title Case, like every chip. */
const FC_RECALL_MODE_CHIPS = {
  conceptual: 'Written',
  list: 'List',
  formula: 'Formula',
};

const FC_RATING_CLASSES = { 1: 'again', 2: 'hard', 3: 'good', 4: 'easy' };

/**
 * Past written answers for one card, newest first.
 *
 * Shows the answers themselves rather than a chart of the grades: the point
 * is to read what you wrote and see whether it is getting sharper, which a
 * score line cannot show. Each carries the grade it earned and, when the
 * verdict was stored, which rubric points it hit.
 */
function fcAnswerHistoryEl(answers, rubric, { onDiscuss = null } = {}) {
  const root = el('div', 'fc-answers');
  if (!answers.length) {
    root.appendChild(el('div', 'fc-hint', 'No written answers yet. They appear here after you study this card.'));
    return root;
  }
  for (const a of answers) {
    const entry = el('div', 'fc-answers__entry');
    const head = el('div', 'fc-answers__head');
    const badge = el('span', `fc-answers__grade fc-answers__grade--${FC_RATING_CLASSES[a.rating] || 'good'}`,
      FC_RATING_LABELS[a.rating] || '');
    head.appendChild(badge);
    head.appendChild(el('span', 'fc-answers__when', new Date(a.reviewedAt).toLocaleDateString()));
    if (a.verdict && rubric.length) {
      const s = fcScoreVerdict(a.verdict, rubric);
      head.appendChild(el('span', 'fc-answers__score', `${s.hits}/${s.total}`));
    }
    if (a.verdict?.contradiction) head.appendChild(el('span', 'fc-answers__flag', 'Contradicted the source'));
    // Any marking can go to chat, not just the live one: the useful question
    // is often about an answer from weeks ago that you can now see you kept
    // getting wrong the same way.
    if (onDiscuss && a.verdict) {
      const btn = el('button', 'fc-btn fc-btn--small fc-answers__discuss');
      btn.textContent = 'Discuss';
      btn.title = 'Stage a question in the chat with this answer, its marking, and the source attached.';
      btn.addEventListener('click', () => onDiscuss({
        answer: a.answerText, verdict: a.verdict, rubric, rating: a.rating, reviewedAt: a.reviewedAt,
      }));
      head.appendChild(btn);
    }
    entry.appendChild(head);
    entry.appendChild(el('div', 'fc-answers__text', a.answerText));
    if (a.verdict?.note) entry.appendChild(el('div', 'fc-answers__note', a.verdict.note));
    root.appendChild(entry);
  }
  return root;
}

/**
 * The marked verdict: the grade it produced, then the points it was derived
 * from, then the one-line note.
 *
 * The points are shown rather than summarised because the grade is only
 * trustworthy if its evidence is inspectable — this is the surface where a
 * bad rubric becomes visible, and the card editor is one keystroke away.
 */
function fcVerdictEl(verdict, rubric, rating, { onDiscuss = null } = {}) {
  const root = el('div', `fc-verdict fc-verdict--${FC_RATING_CLASSES[rating] || 'good'}`);

  const head = el('div', 'fc-verdict__head');
  head.appendChild(el('span', 'fc-verdict__dot'));
  head.appendChild(el('span', 'fc-verdict__rating', `Graded ${FC_RATING_LABELS[rating] || ''}`));
  const s = fcScoreVerdict(verdict, rubric);
  head.appendChild(el('span', 'fc-verdict__score', `${s.hits}/${s.total} points`));
  if (!verdict.sourced) {
    // An unsourced verdict was reached against the card's own answer text
    // rather than the passage it came from. Weaker evidence, shown as such
    // instead of hidden.
    const tag = el('span', 'fc-verdict__unsourced', 'No source');
    tag.title = 'Marked against this card\'s answer only — no source passage is stored for it.';
    head.appendChild(tag);
  }
  root.appendChild(head);

  if (verdict.contradiction) {
    root.appendChild(el('div', 'fc-verdict__contradiction',
      'This contradicts the source, which is why it is Again rather than a partial credit.'));
  }

  const list = el('div', 'fc-verdict__points');
  rubric.forEach((p, i) => {
    const status = verdict.points?.[i]?.status || 'miss';
    const row = el('div', `fc-verdict__point fc-verdict__point--${status}`);
    row.appendChild(el('span', 'fc-verdict__glyph', FC_POINT_GLYPHS[status]));
    const body = el('div', 'fc-verdict__point-body');
    body.appendChild(el('span', 'fc-verdict__point-text', p.text));
    const note = verdict.points?.[i]?.note;
    if (note && status !== 'hit') body.appendChild(el('span', 'fc-verdict__point-note', note));
    row.appendChild(body);
    list.appendChild(row);
  });
  root.appendChild(list);

  if (verdict.note) root.appendChild(el('div', 'fc-verdict__note', verdict.note));

  // The moment you have just been told what you could not produce is the
  // moment the question is sharpest, so the hand-off lives here rather than
  // only behind the answer card's corner mark. It stages the ask with the
  // whole marking attached; you still edit and send it yourself.
  if (onDiscuss) {
    const foot = el('div', 'fc-verdict__foot');
    const btn = el('button', 'fc-btn fc-btn--small');
    btn.textContent = 'Discuss This Marking';
    btn.title = 'Stage a question in the chat with your answer, the marking, and the source attached.';
    btn.addEventListener('click', () => onDiscuss());
    foot.appendChild(btn);
    root.appendChild(foot);
  }
  return root;
}

async function renderStudy(body, route, paneState, setRoute, aheadMs = 0) {
  // A custom session gets its own key (stamped at launch) so it neither
  // resumes into nor is resumed by the deck's daily session — but a tab
  // switch, which restores the same route, still lands back on the same key.
  const custom = route.custom || null;
  const deckKey = String(route.deckId ?? '__all__');
  const sessionKey = custom ? `custom:${custom.startedAt}:${deckKey}` : deckKey;
  const cachedSession = _fcStudySessions.get(sessionKey);
  const resuming = !aheadMs && !!cachedSession
    && (cachedSession.index < cachedSession.queue.length || cachedSession.pending.length > 0);

  const cards = await fcListAllCards(route.deckId ?? null);
  // Deadline-aware pacing (M101): each deck's new band is sliced to its
  // paced allowance. Custom study deliberately bypasses pacing — "extra"
  // exists precisely to work past the paced batch.
  const pace = (resuming || custom) ? null : await fcSessionNewAllowances(route.deckId ?? null);
  // aheadMs: learn-ahead (Study Now on the countdown screen) — build the
  // queue as of a moment slightly past the next learning card's dueAt.
  const queue = resuming ? []
    : custom ? fcBuildCustomQueue(cards, Date.now(), custom)
      : fcBuildQueue(cards, Date.now() + aheadMs, {
        // The paced allowance has to be able to EXCEED the batch setting,
        // and this global slice runs after the per-deck one — leaving it at
        // the raw setting would trim a raised pace straight back down and
        // make the raise a no-op.
        newLimit: Math.max(Number(cfg('dailyNewLimit', 20)) || 20, pace ? pace.total : 0),
        reviewLimit: Number(cfg('dailyReviewLimit', 200)) || 200,
        newAllowanceByDeck: pace ? pace.byDeck : null,
        // Custom study bypasses this the same way it bypasses pacing —
        // "extra" exists precisely to work past the batch.
        productionLimit: fcProductionDailyLimit(),
      });
  // Preview modes grade for flow only — see fcCustomIsPreview.
  const previewOnly = !!custom && fcCustomIsPreview(custom.mode);
  const customDef = custom
    ? FC_CUSTOM_MODE_DEFS.find((d) => d.mode === custom.mode) || FC_CUSTOM_MODE_DEFS[0]
    : null;

  const study = el('div', 'fc-study');
  const main = el('div', 'fc-study__main');
  main.tabIndex = 0; // container-scoped keyboard grading
  study.appendChild(main);
  body.appendChild(study);

  if (queue.length === 0 && !resuming && custom) {
    // A custom queue that matched nothing must say so. Falling through to
    // "All caught up" would credit the daily schedule for an empty result
    // the user's own filters produced.
    const none = el('div', 'fc-study__done px-empty');
    none.appendChild(el('div', 'px-empty__headline', 'Nothing to study'));
    none.appendChild(el('div', 'px-empty__hint',
      `No ${customDef.noun} match this scope. Widen the tags, raise the range, or pick another mode.`));
    const again = el('button', 'fc-btn fc-btn--primary');
    again.textContent = 'Change Filters';
    again.addEventListener('click', () => setRoute({ view: 'custom', ...(route.deckId != null ? { deckId: route.deckId } : {}) }));
    none.appendChild(again);
    const backDecks = el('button', 'fc-btn');
    backDecks.textContent = 'Back to Decks';
    backDecks.addEventListener('click', () => setRoute({ view: 'decks' }));
    none.appendChild(backDecks);
    main.appendChild(none);
    return;
  }

  if (queue.length === 0 && !resuming) {
    // A learning card due in the next few minutes means "caught up" is a
    // lie about to expire — count down and reopen the session at dueAt
    // (this screen used to freeze forever; graded-Again cards never came
    // back without manually leaving and re-entering).
    const soon = cards
      .filter((c) => !c.suspended && (c.state === 'learning' || c.state === 'relearning') && c.dueAt > Date.now())
      .sort((a, b) => a.dueAt - b.dueAt)[0];
    const withinAhead = soon && soon.dueAt - Date.now() <= FC_LEARN_AHEAD_MS;

    const done = el('div', 'fc-study__done px-empty');
    done.appendChild(el('div', 'px-empty__headline',
      cards.length === 0 ? 'Ready when you are' : withinAhead ? 'Almost caught up' : 'All caught up'));
    const hint = el('div', 'px-empty__hint');
    const fmt = (ms) => {
      const s = Math.max(0, Math.ceil(ms / 1000));
      return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, '0')}`;
    };
    hint.textContent = cards.length === 0
      ? 'Create cards in a deck, or click Create to generate them from a canvas page or PDF.'
      : withinAhead
        ? `A learning card comes due in ${fmt(soon.dueAt - Date.now())}.`
        : 'The scheduler brings cards back right before you would forget them. Check back later.';
    done.appendChild(hint);
    const restart = () => {
      if (!body.isConnected) return;
      body.innerHTML = '';
      void renderStudy(body, route, paneState, setRoute);
    };
    if (withinAhead) {
      const aheadBtn = el('button', 'fc-btn fc-btn--primary');
      aheadBtn.textContent = 'Study Now';
      aheadBtn.title = 'Serve the learning card early instead of waiting.';
      // Learn-ahead: build the queue as of the card's due time.
      aheadBtn.addEventListener('click', () => {
        if (!body.isConnected) return;
        body.innerHTML = '';
        void renderStudy(body, route, paneState, setRoute, soon.dueAt - Date.now() + 1000);
      });
      done.appendChild(aheadBtn);
      const timer = setInterval(() => {
        if (!body.isConnected) { clearInterval(timer); return; }
        const ms = soon.dueAt - Date.now();
        if (ms <= 0) { clearInterval(timer); restart(); return; }
        hint.textContent = `A learning card comes due in ${fmt(ms)}.`;
      }, 250);
    }
    // Caught up is exactly when working ahead is worth offering — otherwise
    // a free study day has nowhere to go.
    if (cards.length > 0) {
      const customBtn = el('button', 'fc-btn');
      customBtn.textContent = 'Custom Study';
      customBtn.title = 'Review ahead, add new cards, or cram — without waiting for the schedule.';
      customBtn.addEventListener('click', () => setRoute({ view: 'custom', ...(route.deckId != null ? { deckId: route.deckId } : {}) }));
      done.appendChild(customBtn);
    }
    const back = el('button', 'fc-btn');
    back.textContent = 'Back to Decks';
    back.addEventListener('click', () => setRoute({ view: 'decks' }));
    done.appendChild(back);
    main.appendChild(done);
    return;
  }

  const deckRows = await db.all('SELECT id, name, exam_date, desired_retention FROM fc_decks');
  const deckNames = new Map(deckRows.map((d) => [d.id, d.name]));
  // Per-deck scheduling options (M98): desired retention + deadline cap.
  const deckSchedOpts = new Map(deckRows.map((d) => [d.id, {
    desiredRetention: d.desired_retention || 0.9,
    examDate: d.exam_date || 0,
  }]));
  const optsFor = (card) => deckSchedOpts.get(card.deckId) || {};

  const session = resuming ? cachedSession : {
    queue: [...queue],
    index: 0,
    revealed: false,
    doneCount: 0,
    total: queue.length,
    cardShownAt: Date.now(),
    /** Learning cards graded this session, waiting on a FUTURE dueAt.
     *  Served the moment they come due — the "Again 1m" contract. */
    pending: [],
    waitTimer: null,
    /** Grade history for Undo: { before: pre-grade card, reviewedAt }. */
    history: [],
    /** Custom-study descriptor (null for the daily queue) + whether its mode
     *  is preview-only. Carried ON the session so a resumed one keeps its
     *  no-scheduling contract even if the route were rebuilt. */
    custom,
    previewOnly,
  };
  if (resuming) {
    // The old pane died mid-flight: clear transient flags; its wait timer
    // self-cleared on the disconnected DOM.
    session.grading = false;
    session.editing = false;
    session.waitTimer = null;
    session.history = session.history || [];
  }
  _fcStudySessions.set(sessionKey, session);
  if (custom) fcPruneCustomSessions(sessionKey);
  paneState.session = session;

  // Render card text through the shared Markdown + KaTeX renderer; fall
  // back to plain text if the host is too old to provide it.
  const renderCardBody = (text) => {
    try { return _api.ui.renderMarkdown(text); } catch {
      const d = el('div');
      d.textContent = text;
      return d;
    }
  };

  const fmtWait = (ms) => {
    const s = Math.max(0, Math.ceil(ms / 1000));
    return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, '0')}`;
  };

  /** Undo the last grade (user ask: navigate back across seen cards).
   *  Reverts the DB (scheduling + review row) and steps the session back. */
  const undoLast = () => {
    if (session.grading || session.history.length === 0) return;
    session.grading = true;
    void (async () => {
      const h = session.history.pop();
      await fcUndoGrade(h.before, h.reviewedAt);
      // Remove the post-grade copy wherever it went: the pending pool, or a
      // promoted-but-unserved queue slot ahead of the cursor.
      session.pending = session.pending.filter((c) => c.id !== h.before.id);
      for (let i = session.queue.length - 1; i >= session.index; i--) {
        if (session.queue[i].id === h.before.id) {
          session.queue.splice(i, 1);
          session.total = Math.max(1, session.total - 1);
        }
      }
      session.doneCount = Math.max(0, session.doneCount - 1);
      session.index = Math.max(0, session.index - 1);
      session.queue[session.index] = h.before;
      session.grading = false;
      showCard();
    })();
  };

  /** Wait screen: only future-due learning cards remain. Count down to the
   *  soonest and auto-serve it at dueAt — the "Again 1m" promise, kept. */
  const renderWait = () => {
    const next = session.pending[0];
    const wait = el('div', 'fc-study__done px-empty');
    wait.appendChild(el('div', 'px-empty__headline', 'Almost done'));
    const hint = el('div', 'px-empty__hint');
    const label = () => {
      const n = session.pending.length;
      return `${n} ${n === 1 ? 'card is' : 'cards are'} still in learning. Next card in ${fmtWait(next.dueAt - Date.now())}.`;
    };
    hint.textContent = label();
    wait.appendChild(hint);
    const nowBtn = el('button', 'fc-btn fc-btn--primary');
    nowBtn.textContent = 'Show Now';
    nowBtn.title = 'Serve the next learning card early instead of waiting.';
    nowBtn.addEventListener('click', () => {
      session.queue.splice(session.index, 0, session.pending.shift());
      session.total++;
      showCard();
    });
    wait.appendChild(nowBtn);
    if (session.history.length > 0) {
      const undoBtn = el('button', 'fc-btn');
      undoBtn.textContent = 'Undo Last Grade';
      undoBtn.addEventListener('click', undoLast);
      wait.appendChild(undoBtn);
    }
    const back = el('button', 'fc-btn');
    back.textContent = 'Back to Decks';
    back.addEventListener('click', () => setRoute({ view: 'decks' }));
    wait.appendChild(back);
    main.appendChild(wait);
    session.waitTimer = setInterval(() => {
      // The pane rebuilds on tab switches — a disconnected host means this
      // timer outlived its session.
      if (!main.isConnected) { clearInterval(session.waitTimer); session.waitTimer = null; return; }
      if (next.dueAt - Date.now() <= 0) { showCard(); return; }
      hint.textContent = label();
    }, 250);
  };

  const showCard = (opts = {}) => {
    if (session.waitTimer) { clearInterval(session.waitTimer); session.waitTimer = null; }
    main.innerHTML = '';
    session.revealed = false;
    session.editing = false;
    // M102: a held card's grade has already landed, so both guards clear
    // with the card. Leaving `settled` set would freeze grading on the next
    // one; leaving `marking` set would do the same after a torn-down mark.
    session.settled = false;
    session.marking = false;
    // Cleared with the card, not just overwritten on the next mark: a
    // recognition card following a graded one would otherwise hand the
    // PREVIOUS card's answer to the chat.
    session.lastMarking = null;
    session.cardShownAt = Date.now();

    // A learning card that has come DUE cuts in ahead of the rest — this is
    // what makes "Again 1m" mean one minute instead of "end of queue".
    session.pending.sort((a, b) => a.dueAt - b.dueAt);
    if (session.pending.length > 0 && session.pending[0].dueAt <= Date.now()) {
      session.queue.splice(session.index, 0, session.pending.shift());
      session.total++;
    }

    if (session.index >= session.queue.length) {
      if (session.pending.length > 0) { renderWait(); return; }
      _fcStudySessions.delete(sessionKey);
      const n = session.doneCount;
      const done = el('div', 'fc-study__done px-empty');
      done.appendChild(el('div', 'px-empty__headline',
        session.previewOnly ? 'Pass complete' : 'Session complete'));
      done.appendChild(el('div', 'px-empty__hint', session.previewOnly
        ? `${n} ${n === 1 ? 'card' : 'cards'} seen. Your schedule is unchanged — preview passes never reschedule.`
        : `${n} ${n === 1 ? 'card' : 'cards'} reviewed. Check Stats to watch retention climb.`));

      // What is STILL waiting. dailyNewLimit is a per-SESSION batch, so this
      // screen used to be a dead end while a hundred freshly-made cards sat
      // untouched and nothing on screen admitted it.
      const more = el('div', 'px-empty__hint fc-study__more');
      more.style.display = 'none';
      done.appendChild(more);

      const statsBtn = el('button', 'fc-btn');
      statsBtn.textContent = 'View Stats';
      statsBtn.addEventListener('click', () => setRoute({ view: 'stats' }));
      done.appendChild(statsBtn);
      const customBtn = el('button', 'fc-btn');
      customBtn.textContent = 'Custom Study';
      customBtn.title = 'Review ahead, add new cards, or cram — without waiting for the schedule.';
      customBtn.addEventListener('click', () => setRoute({ view: 'custom', ...(route.deckId != null ? { deckId: route.deckId } : {}) }));
      done.appendChild(customBtn);
      main.appendChild(done);

      void (async () => {
        let fresh;
        try { fresh = await fcListAllCards(route.deckId ?? null); } catch { return; }
        if (!main.isConnected) return;
        const t = Date.now();
        const newLeft = fresh.filter((c) => !c.suspended && c.state === 'new').length;
        const dueLeft = fresh.filter((c) => !c.suspended && c.state !== 'new' && c.dueAt <= t).length;
        const parts = [];
        if (newLeft) parts.push(`${newLeft} new ${newLeft === 1 ? 'card' : 'cards'}`);
        if (dueLeft) parts.push(`${dueLeft} ${dueLeft === 1 ? 'review' : 'reviews'}`);
        if (parts.length === 0) return;
        const batch = Number(cfg('dailyNewLimit', 20)) || 20;
        let waitingNote = `new cards come out ${batch} to a session.`;
        try {
          const paceLeft = await fcSessionNewAllowances(route.deckId ?? null);
          if (paceLeft.total < Math.min(batch, newLeft)) {
            waitingNote = paceLeft.total === 0
              ? 'new-card introduction is frozen this close to the exam — reviews only.'
              : `introduction is paced to your exam dates: ${paceLeft.total} more ${paceLeft.total === 1 ? 'card' : 'cards'} today, Custom Study reaches the rest.`;
          }
        } catch { /* pacing note is best-effort */ }
        more.textContent = newLeft
          ? `${parts.join(' and ')} still waiting — ${waitingNote}`
          : `${parts.join(' and ')} still waiting.`;
        more.style.display = '';
        const go = el('button', 'fc-btn fc-btn--primary');
        go.textContent = 'Keep Going';
        go.title = 'Start another session on what is left.';
        go.addEventListener('click', () => {
          if (session.custom) {
            // Dropping the custom descriptor is a REAL route change, so it
            // goes through setRoute — otherwise a later tab switch restores
            // the finished custom session instead of the daily queue.
            setRoute({ view: 'study', ...(route.deckId != null ? { deckId: route.deckId } : {}) });
            return;
          }
          // Same route: setRoute would no-op on its identical-route guard, so
          // re-render in place.
          if (!body.isConnected) return;
          body.innerHTML = '';
          void renderStudy(body, route, paneState, setRoute);
        });
        done.insertBefore(go, statsBtn);
      })();
      return;
    }

    const card = session.queue[session.index];

    // ── In-study Edit / Delete (Mufaro: "If I see a flashcard is incorrect,
    // I have to edit it right there and then") ──
    const openEdit = () => {
      // Editing from the ANSWER face must return to the answer face — the
      // typical flow is reveal → spot the error → fix it, and being dumped
      // back on the question ("does not keep me at that card") forced a
      // pointless re-reveal.
      const wasRevealed = session.revealed;
      const faceOpts = () => (wasRevealed ? { revealCardId: card.id } : {});
      session.editing = true;
      main.innerHTML = '';
      const wrap = el('div', 'fc-study__edit');
      wrap.appendChild(el('div', 'fc-label', 'Edit This Card'));
      wrap.appendChild(fcCardEditorEl(card, {
        onSave: async (patch) => {
          await fcUpdateCard(card.id, patch);
          // Cloze reconcile may have rewritten or even retyped the card —
          // refetch; if the edit dissolved this sibling, skip past it.
          const fresh = await fcGetCard(card.id);
          if (fresh) session.queue[session.index] = fresh;
          else session.queue.splice(session.index, 1);
          showCard(faceOpts());
        },
        onCancel: () => showCard(faceOpts()),
      }));
      main.appendChild(wrap);
    };

    const deleteCurrent = () => {
      void (async () => {
        const ok = await _api.window.showConfirmModal?.({
          message: 'Delete this card?',
          detail: 'The card and its review history are permanently removed. This cannot be undone.',
          confirmLabel: 'Delete Card',
          danger: true,
        }) ?? false;
        if (!ok) return;
        await fcDeleteCard(card.id);
        // Purge every queued/pending appearance (a re-queued learning copy
        // of the same card may sit later in the session).
        session.queue.splice(session.index, 1);
        for (let i = session.queue.length - 1; i >= session.index; i--) {
          if (session.queue[i].id === card.id) { session.queue.splice(i, 1); session.total = Math.max(1, session.total - 1); }
        }
        session.pending = session.pending.filter((c) => c.id !== card.id);
        session.total = Math.max(1, session.total - 1);
        showCard();
      })();
    };

    // A custom session must announce itself — otherwise a cram pass is
    // indistinguishable from the real queue, and "why didn't my reviews
    // move?" becomes a bug report.
    if (session.custom && customDef) {
      const banner = el('div', 'fc-study__mode');
      banner.appendChild(el('span', 'fc-study__mode-name', customDef.label));
      const bits = [];
      if (session.custom.mode === 'ahead') {
        const d = Math.max(1, Math.floor(Number(session.custom.aheadDays) || 1));
        bits.push(`next ${d} ${d === 1 ? 'day' : 'days'}`);
      }
      const flagNames = fcFlagNames(session.custom.flags);
      if (flagNames.length) bits.push(flagNames.join(' / '));
      if (session.custom.tags?.length) bits.push(session.custom.tags.join(' + '));
      if (session.previewOnly) bits.push('schedule unchanged');
      if (bits.length) banner.appendChild(el('span', 'fc-study__mode-meta', bits.join(' · ')));
      main.appendChild(banner);
    }

    // ── Toolbar: progress + card actions ──
    const toolbar = el('div', 'fc-study__toolbar');
    const progress = el('div', 'fc-study__progress');
    const fill = el('div', 'fc-study__progress-fill');
    fill.style.width = `${Math.round((session.doneCount / Math.max(1, session.total)) * 100)}%`;
    progress.appendChild(fill);
    toolbar.appendChild(progress);
    const cardActions = el('div', 'fc-study__cardactions');
    // Flag the card you are looking at, without leaving the session. Writes
    // straight through so it survives however the session ends.
    const flagPicker = fcCreateFlagPicker(cardActions, {
      value: card.flag,
      shortcutHint: true,
      onPick: (next) => {
        card.flag = next;
        void fcUpdateCard(card.id, { flag: next });
      },
    });
    const undoBtn = fcIconBtn(cardActions, {
      iconName: 'undo-2',
      label: 'Undo',
      title: 'Take back the last grade and return to that card (Z)',
      onClick: undoLast,
    });
    undoBtn.disabled = session.history.length === 0;
    fcIconBtn(cardActions, {
      iconName: 'pencil',
      label: 'Edit',
      title: 'Fix this card without leaving the session (E)',
      onClick: openEdit,
    });
    fcIconBtn(cardActions, {
      iconName: 'trash-2',
      label: 'Delete',
      title: 'Permanently delete this card',
      danger: true,
      onClick: deleteCurrent,
    });
    toolbar.appendChild(cardActions);

    main.appendChild(toolbar);

    // ── Stage: cards on the left, a quiet rail on the right ──
    // Everything used to stack in one column, so notes and the shortcut key
    // pushed the grade buttons off-screen on short panes and the eye had to
    // travel the whole page. The rail holds what you REFER to; the column
    // holds what you ACT on.
    const stage = el('div', 'fc-study__stage');
    const col = el('div', 'fc-study__col');
    const rail = el('div', 'fc-study__rail');
    stage.appendChild(col);
    stage.appendChild(rail);
    main.appendChild(stage);

    // ── The QUESTION card ──
    const qCard = el('div', 'fc-card fc-card--q');
    const qHead = el('div', 'fc-card__head');
    qHead.appendChild(el('span', 'fc-card__tag', deckNames.get(card.deckId) || 'Question'));
    qHead.appendChild(el('span', '', `${session.doneCount + 1} / ${session.total}`));
    qCard.appendChild(qHead);
    const qBody = el('div', 'fc-card__body fc-study__front');
    // M98 cloze: the front blanks THIS sibling's ordinal, reveals the rest.
    qBody.appendChild(renderCardBody(card.cardType === 'cloze'
      ? fcRenderCloze(card.front, card.clozeIndex, 'front')
      : card.front));
    qCard.appendChild(qBody);
    col.appendChild(qCard);

    const answerHost = el('div', 'fc-study__answer-host');
    col.appendChild(answerHost);

    const controls = el('div', 'fc-study__controls');
    col.appendChild(controls);

    // ── Rail: notes, then the key legend ──
    // Built here so the autosave wiring lives in one place, but HIDDEN until
    // the answer is revealed: notes hold mnemonics and traps, so showing them
    // against the question would hand over the answer before you have tried
    // to recall it. reveal() unhides.
    const notesWrap = el('div', 'fc-study__notes');
    notesWrap.style.display = 'none';
    notesWrap.appendChild(el('div', 'fc-study__notes-label', 'My Notes'));
    const notesIn = el('textarea', 'fc-textarea fc-study__notes-input');
    notesIn.placeholder = 'Mnemonics, pitfalls, exam traps. They stay with the card.';
    notesIn.value = card.notes || '';
    notesIn.rows = 6;
    let notesTimer = null;
    const saveNotes = () => {
      const v = notesIn.value;
      if (v === (card.notes || '')) return;
      card.notes = v;
      void fcUpdateCard(card.id, { notes: v });
    };
    notesIn.addEventListener('input', () => {
      if (notesTimer) clearTimeout(notesTimer);
      notesTimer = setTimeout(saveNotes, 600);
    });
    notesIn.addEventListener('blur', () => {
      if (notesTimer) clearTimeout(notesTimer);
      saveNotes();
    });
    notesWrap.appendChild(notesIn);
    rail.appendChild(notesWrap);

    const reveal = () => {
      if (session.revealed) return;
      session.revealed = true;

      // ── The ANSWER card: its own physical card, sliding in below ──
      const aCard = el('div', 'fc-card fc-card--a');
      const aHead = el('div', 'fc-card__head');
      aHead.appendChild(el('span', 'fc-card__tag', 'Answer'));
      // M98 leech loop: a repeatedly-failed card announces itself and offers
      // an AI reformulation (fact unchanged, scheduling preserved).
      if (fcIsLeech(card)) {
        const leech = el('span', 'fc-card__leech', `Leech · ${card.lapses} lapses`);
        leech.title = 'This card keeps failing. The wording may be the problem.';
        aHead.appendChild(leech);
        const rewriteBtn = el('button', 'fc-btn fc-btn--small');
        rewriteBtn.textContent = 'Rewrite with AI';
        rewriteBtn.addEventListener('click', () => {
          rewriteBtn.disabled = true;
          rewriteBtn.textContent = 'Rewriting…';
          void (async () => {
            const done = await fcLeechRewriteFlow(card);
            rewriteBtn.disabled = false;
            rewriteBtn.textContent = 'Rewrite with AI';
            if (done) {
              const fresh = await fcGetCard(card.id);
              if (fresh && session.queue[session.index]?.id === card.id) {
                session.queue[session.index] = fresh;
                showCard();
              }
            }
          })();
        });
        aHead.appendChild(rewriteBtn);
      }
      aCard.appendChild(aHead);
      const aBody = el('div', 'fc-card__body fc-study__back');
      // M98 cloze: the answer reveals everything with this ordinal bolded;
      // the note's back rides along as extra context when present.
      aBody.appendChild(renderCardBody(card.cardType === 'cloze'
        ? fcRenderCloze(card.front, card.clozeIndex, 'back') + (card.back ? `\n\n${card.back}` : '')
        : card.back));
      aCard.appendChild(aBody);
      // M98 grounding: the source line is a LINK back to the material —
      // canvas pages open in place, PDFs open and jump to the cited page.
      if (card.sourceLabel) {
        const srcText = card.sourcePage > 0 ? `${card.sourceLabel} · p.${card.sourcePage}` : card.sourceLabel;
        const src = el('div', 'fc-card__source', srcText);
        if (card.sourceUri) {
          src.classList.add('fc-card__source--link');
          src.title = 'Open the source';
          src.addEventListener('click', () => void fcOpenSource(card));
        }
        aCard.appendChild(src);
      }
      // ONE AI action, now a mark in the answer card's corner instead of a
      // labelled button under it. Revealed on hover OR focus-within — a
      // hover-only control is invisible to the keyboard, which is the trap
      // this pattern usually falls into.
      const aiHost = el('div', 'fc-card__ai');
      const discussBtn = _api.ui.createAiButton
        ? _api.ui.createAiButton(aiHost, {
          label: 'Discuss with AI',
          iconOnly: true,
          compact: true,
          title: 'Stage a grounded question in the chat — card and source attached. Edit it, then send.',
        })
        : el('button', 'fc-btn fc-btn--small');
      if (!discussBtn.parentElement) {
        discussBtn.textContent = 'Discuss with AI';
        aiHost.appendChild(discussBtn);
      }
      discussBtn.addEventListener('click', () => {
        // Carries the marking when this card was just answered and graded —
        // same one action, sharper question when there is a failure to point
        // at. A second button for the graded case would split one concept.
        void fcExplainInChat(card, deckNames.get(card.deckId), { marking: session.lastMarking });
      });
      // In the head ROW, not absolutely positioned over it: a leech card
      // already puts its chip and Rewrite button at the top right, and an
      // overlay would land on top of them. As a flex child it also reserves
      // its space while hidden, so revealing it shifts nothing.
      aHead.appendChild(aiHost);

      answerHost.appendChild(aCard);

      // The answer is out — notes can come up without spoiling anything.
      notesWrap.style.display = '';

      controls.innerHTML = '';
      const now = Date.now();
      const grades = [
        { r: AGAIN, label: 'Again', cls: 'again' },
        { r: HARD, label: 'Hard', cls: 'hard' },
        { r: GOOD, label: 'Good', cls: 'good' },
        { r: EASY, label: 'Easy', cls: 'easy' },
      ];
      for (const g of grades) {
        const btn = el('button', `fc-grade fc-grade--${g.cls}`);
        btn.appendChild(el('span', 'fc-grade__dot'));
        btn.appendChild(el('span', 'fc-grade__label', g.label));
        // Preview passes do not reschedule, so printing an interval here
        // would promise something the grade will not do. Again still means
        // something — the card comes back inside this pass.
        btn.appendChild(el('span', 'fc-grade__ivl', session.previewOnly
          ? (g.r === AGAIN ? 'again' : '—')
          : fcIntervalPreview(card, g.r, now, optsFor(card))));
        btn.addEventListener('click', () => grade(g.r));
        controls.appendChild(btn);
      }
      // The legend switches to grading keys in place — it lives in the rail
      // now, so there is nothing to re-append.
      keys.textContent = session.previewOnly
        ? '1 Again · 2 Hard · 3 Good · 4 Easy · E edit · Alt+1-4 flag'
        : '1 Again · 2 Hard · 3 Good · 4 Easy · E edit · Z undo · Alt+1-4 flag';
    };

    /**
     * @param rating 1..4
     * @param hold   keep the card on screen after writing the grade, so a
     *               marked answer's verdict can be read before moving on.
     *               `advance()` then does the moving. Recognition grading
     *               passes false and the next card appears immediately.
     */
    const grade = (rating, { answer = '', verdict = null, hold = false } = {}) => {
      // Re-entrancy guard (M99 review): a double-click or key repeat before
      // the async grade lands would grade the same card twice and skip one.
      // `settled` extends that guard across the held window: the card is
      // still on screen after its grade landed, so 1-4 must no longer fire.
      if (session.grading || session.settled) return;
      session.grading = true;
      const msTaken = Date.now() - session.cardShownAt;

      // Preview pass (Difficult Cards / Cram): nothing is written. Re-reading
      // a card here is not evidence you would have recalled it days out, and
      // feeding that to FSRS would inflate stability across the whole deck —
      // and, through the exam-date cap, the plan built on it. Again requeues
      // the card inside this pass; the other grades just move on.
      if (session.previewOnly) {
        if (rating === AGAIN) {
          session.queue.push(card);
          session.total++;
        }
        session.doneCount++;
        session.index++;
        session.grading = false;
        showCard();
        return;
      }

      void (async () => {
        const updated = await fcGradeCard(card, rating, msTaken, optsFor(card), { answer, verdict });
        // Undo material: the pre-grade card + the review row's timestamp.
        session.history.push({ before: card, reviewedAt: updated.lastReviewedAt });
        // Cards still in learning stay in the session when due within the
        // horizon — held in `pending` and served WHEN DUE (they used to be
        // pushed to the queue tail, which served them at whatever moment the
        // index arrived: instantly for the last card, ages later mid-deck —
        // the "Again 1m never means 1 minute" bug).
        if ((updated.state === 'learning' || updated.state === 'relearning')
            && updated.dueAt <= Date.now() + FC_LEARN_AHEAD_MS) {
          session.pending.push(updated);
        }
        session.doneCount++;
        session.index++;
        session.grading = false;
        if (hold) { session.settled = true; onSettled?.(rating); return; }
        showCard();
      })();
    };

    /** Move past a held card. No-op unless a grade has actually landed. */
    const advance = () => {
      if (!session.settled) return;
      session.settled = false;
      showCard();
    };

    /**
     * Move this card to the back of the session and serve the next one.
     *
     * Not a grade: nothing is written, no review row, no FSRS update, and
     * neither counter moves — you have not done the card, you have deferred
     * it. The card is spliced out and pushed, so the queue length and the
     * progress denominator are unchanged; `index` already points at the next
     * card once the splice lands.
     *
     * Only before the answer is revealed. Once you have seen it, re-serving
     * the card in the same session tests nothing — that is what Again is
     * for, and it schedules honestly.
     */
    const canSkip = () => !session.revealed && !session.grading && !session.marking && !session.settled
      && (session.queue.length - session.index > 1
        // A due learning card cuts in on the next showCard, so it counts as
        // somewhere to skip TO even when the queue holds nothing else.
        || session.pending.some((p) => p.dueAt <= Date.now()));

    const skip = () => {
      if (!canSkip()) return;
      const [moved] = session.queue.splice(session.index, 1);
      session.queue.push(moved);
      showCard();
    };

    /** Set by the production flow so a landed grade can paint its own footer. */
    let onSettled = null;

    /**
     * Submit a typed answer: reveal the back at once, mark behind it, then
     * hold on the verdict.
     *
     * The reveal is deliberately NOT gated on the marking call. Reading the
     * real answer is the pedagogically useful second the marking takes, so
     * spending it on a spinner would be pure dead time — and dead time is
     * how a daily habit dies. Only production cards pay any of this cost.
     *
     * Every failure path lands on the self-grade buttons that reveal()
     * already rendered. A model outage costs the verdict, never the review.
     */
    function submitAnswer() {
      if (session.revealed || session.grading || session.marking) return;
      const answer = String(answerInput?.value || '');
      if (answerInput) answerInput.readOnly = true;
      session.marking = true;
      reveal();

      const strip = el('div', 'fc-verdict fc-verdict--pending');
      strip.appendChild(el('span', 'fc-verdict__spinner'));
      strip.appendChild(el('span', 'fc-verdict__pending-text', 'Marking your answer…'));
      answerHost.appendChild(strip);

      const fallback = (why) => {
        session.marking = false;
        strip.className = 'fc-verdict fc-verdict--fallback';
        strip.innerHTML = '';
        strip.appendChild(el('span', 'fc-verdict__note', why));
        keys.textContent = '1 Again · 2 Hard · 3 Good · 4 Easy · E edit · Z undo · Alt+1-4 flag';
      };

      void (async () => {
        let result;
        try {
          result = await fcGradeAnswer(card, answer);
        } catch (err) {
          fallback(`Marking failed (${err?.message || err}). Grade it yourself.`);
          return;
        }
        if (result.rating == null) {
          fallback(result.rubric.length
            ? 'The model did not return a usable verdict. Grade it yourself.'
            : 'No rubric for this card yet, and one could not be written. Grade it yourself.');
          return;
        }
        // Clear the marking guard so grade() can run — it is the one caller
        // allowed through, and `settled` takes over the guard immediately.
        session.marking = false;
        // Held for the corner Discuss button too: with a marking in hand it
        // asks the sharper question, and one AI action beats two.
        session.lastMarking = { answer, verdict: result.verdict, rubric: result.rubric, rating: result.rating };
        onSettled = () => {
          strip.replaceWith(fcVerdictEl(result.verdict, result.rubric, result.rating, {
            onDiscuss: () => void fcExplainInChat(card, deckNames.get(card.deckId), {
              marking: session.lastMarking,
            }),
          }));
          controls.innerHTML = '';
          const next = el('button', 'fc-btn fc-btn--primary fc-study__reveal');
          next.textContent = 'Next Card';
          next.addEventListener('click', advance);
          controls.appendChild(next);
          keys.textContent = 'Space or Enter for the next card · E edit · Z undo · Alt+1-4 flag';
        };
        grade(result.rating, { answer, verdict: result.verdict, hold: true });
      })();
    }

    // ── Production recall (M102) ────────────────────────────────────────────
    //
    // A card whose value is an explanation asks for one BEFORE it shows the
    // answer. Recognition cards are untouched: reveal-then-self-grade is the
    // right measurement for a card you either produced in your head or did
    // not, and it costs five seconds instead of a minute.
    //
    // Preview passes (Cram, Difficult Cards) stay recognition-style whatever
    // the card's mode. They deliberately write nothing, so demanding a typed
    // answer would charge the full cost for a grade that is discarded.
    // `revealCardId` means this card is coming back to its ANSWER face after
    // an edit — it was already answered, so asking again would put an empty
    // box next to the revealed answer and lose what was typed.
    const production = fcIsProductionMode(card.recallMode)
      && !session.previewOnly
      && opts.revealCardId !== card.id;
    let answerInput = null;

    controls.innerHTML = '';
    if (production) {
      const spec = FC_PRODUCE_SPECS[card.recallMode];
      const wrap = el('div', 'fc-study__produce');
      wrap.appendChild(el('div', 'fc-study__produce-label', spec.label));
      answerInput = el('textarea', 'fc-textarea fc-study__produce-input');
      answerInput.placeholder = spec.placeholder;
      answerInput.rows = spec.rows;
      wrap.appendChild(answerInput);
      col.insertBefore(wrap, controls);

      const submitBtn = el('button', 'fc-btn fc-btn--primary fc-study__reveal');
      submitBtn.textContent = 'Submit Answer';
      submitBtn.addEventListener('click', () => submitAnswer());
      controls.appendChild(submitBtn);

      // The textarea owns Enter (answers are multi-line), so submission is
      // Ctrl/Cmd+Enter. main.onkeydown bails out inside form fields, so this
      // has to live on the field itself.
      answerInput.addEventListener('keydown', (e) => {
        if (e.key === 'Enter' && (e.ctrlKey || e.metaKey)) { e.preventDefault(); submitAnswer(); }
      });
      // Focus the box, not the container: the first thing to do with this
      // card is write, and a container-focused surface would swallow the
      // first keystroke into a study shortcut.
      queueMicrotask(() => answerInput.focus());
    } else {
      const revealBtn = el('button', 'fc-btn fc-btn--primary fc-study__reveal');
      revealBtn.textContent = 'Show Answer';
      revealBtn.addEventListener('click', reveal);
      controls.appendChild(revealBtn);
    }

    // Rendered only when there is somewhere to skip TO. A button that
    // silently does nothing on the last card of a session reads as broken.
    if (canSkip()) {
      const skipBtn = el('button', 'fc-btn fc-study__skip');
      skipBtn.textContent = 'Skip';
      skipBtn.title = 'Move this card to the end of the session. Nothing is graded and your schedule is unchanged.';
      skipBtn.addEventListener('click', skip);
      controls.appendChild(skipBtn);
    }
    // Built from the keys that ACTUALLY fire on this card. A production card
    // does not reveal on Space (Submit owns the reveal, so Space must not
    // skip past the answer the card exists to elicit), and the legend used to
    // promise it anyway.
    const keys = el('div', 'fc-study__keys', [
      production ? 'Ctrl+Enter submits' : 'Space reveals the answer',
      canSkip() ? 'S skip' : '',
      'E edit',
      session.previewOnly ? '' : 'Z undo',
      'Alt+1-4 flag',
    ].filter(Boolean).join(' · '));
    rail.appendChild(keys);

    // Container-scoped keyboard: only fires while the study surface has focus.
    main.onkeydown = (e) => {
      if (e.target instanceof HTMLInputElement || e.target instanceof HTMLTextAreaElement) return;
      // The inline editor owns the keyboard while open (its own Ctrl+Enter /
      // Escape handling) — study shortcuts must not fire underneath it.
      if (session.editing) return;
      // Alt+1..4 flags the card. NOT Anki's Ctrl+1..4: KeybindingService owns
      // a document-level CAPTURE listener and stopPropagation()s its matches,
      // and Ctrl+1..3 are already the focus-editor-group commands — so those
      // three would never arrive here while Ctrl+4 would, which is worse than
      // no shortcut. Matched on e.code so the digit row works on any layout.
      if (e.altKey && !e.ctrlKey && !e.metaKey
          && ['Digit1', 'Digit2', 'Digit3', 'Digit4'].includes(e.code)) {
        e.preventDefault();
        const picked = Number(e.code.slice(-1));
        const next = card.flag === picked ? 0 : picked;
        card.flag = next;
        flagPicker.set(next);
        void fcUpdateCard(card.id, { flag: next });
        return;
      }
      if (e.key === ' ' || e.key === 'Enter') {
        e.preventDefault();
        // Same key, three states: reveal, then (on a marked card) move on.
        // A production card's reveal is owned by Submit, so Space must not
        // short-circuit it and skip the answer the card exists to elicit.
        if (session.settled) advance();
        else if (!session.revealed && !production) reveal();
        return;
      }
      if (e.key === 'e' || e.key === 'E') {
        e.preventDefault();
        openEdit();
        return;
      }
      if (e.key === 'z' || e.key === 'Z') {
        e.preventDefault();
        undoLast();
        return;
      }
      if (e.key === 's' || e.key === 'S') {
        e.preventDefault();
        skip();
        return;
      }
      // Marking in flight: the grade is about to be written by the verdict,
      // so a keypress here would race it into a double grade. grade() also
      // guards on `marking`, but swallowing the key stops the buttons from
      // looking live while they are not.
      if (session.revealed && !session.marking && ['1', '2', '3', '4'].includes(e.key)) {
        e.preventDefault();
        grade(parseInt(e.key, 10));
      }
    };
    // A production card focuses its answer box instead (see above): focusing
    // the container would swallow the first keystroke into a shortcut.
    if (!production) main.focus();
    // Return to the answer face after an edit made from it — but ONLY for
    // the same card: a newly-due learning card promoted ahead (or a cloze
    // edit dissolving the sibling) must start on its question, never with
    // its answer pre-exposed.
    if (opts.revealCardId != null && card.id === opts.revealCardId) reveal();
  };

  showCard();
}

// ── Create / generate view ───────────────────────────────────────────────────

async function renderCreate(body, route, setRoute, viewDisposables = []) {
  const view = el('div', 'fc-view');
  view.appendChild(el('div', 'fc-hint',
    'Pick a source, let the AI draft the cards, then edit or drop each one before importing.'));

  const decks = await fcListDecks();

  // Deck target.
  view.appendChild(el('div', 'fc-label', 'Into deck'));
  const deckRow = el('div', 'fc-row');
  const deckHost = el('div');
  deckHost.style.minWidth = '220px';
  const deckDropdown = _api.ui.createDropdown(deckHost, {
    items: [
      ...decks.map((d) => ({ value: String(d.id), label: d.name })),
      { value: '__new__', label: '+ New Deck…' },
    ],
    selected: route.deckId ? String(route.deckId) : (decks[0] ? String(decks[0].id) : '__new__'),
    ariaLabel: 'Target deck',
  });
  viewDisposables.push(deckDropdown);
  deckRow.appendChild(deckHost);
  view.appendChild(deckRow);

  // ── Source material — default to in-workspace: drag a file/page, or pick.
  // MULTIPLE sources are first-class (user ask: "add several documents so
  // the AI can get a comprehensive view of all the available content" —
  // feeding docs one at a time across sessions is what bred duplicates). ──
  view.appendChild(el('div', 'fc-label', 'Source Material'));
  const sources = [];
  const srcStatus = el('div', 'fc-hint fc-src-status', 'Drag files or canvas pages here, pick below, or paste text. Add as many sources as the topic needs.');
  const chipsHost = el('div', 'fc-row fc-srcchips');

  const renderSourceChips = () => {
    chipsHost.replaceChildren();
    for (let i = 0; i < sources.length; i++) {
      const s = sources[i];
      const chip = el('span', 'fc-chip fc-srcchip');
      const pages = Array.isArray(s.pageTexts) && s.pageTexts.length ? ` · ${s.pageTexts.length}p` : '';
      chip.appendChild(document.createTextNode(`${s.label}${pages} `));
      const x = el('button', 'fc-srcchip__remove');
      x.type = 'button';
      x.textContent = '×';
      x.title = `Remove ${s.label}`;
      x.addEventListener('click', () => { sources.splice(i, 1); renderSourceChips(); });
      chip.appendChild(x);
      chipsHost.appendChild(chip);
    }
    const totalChars = sources.reduce((n, s) => n + s.text.length, 0);
    srcStatus.textContent = sources.length === 0
      ? 'Drag files or canvas pages here, pick below, or paste text. Add as many sources as the topic needs.'
      : `${sources.length} ${sources.length === 1 ? 'source' : 'sources'} · ${totalChars.toLocaleString()} chars. Pasted text (below) is included as one more source.`;
  };

  const applyLoaded = (loaded) => {
    if (!loaded) return;
    const entry = { text: loaded.text, label: loaded.label, uri: loaded.uri, pageTexts: loaded.pageTexts || null };
    // Re-adding the same document replaces it instead of doubling it.
    const existing = entry.uri ? sources.findIndex((s) => s.uri === entry.uri) : -1;
    if (existing >= 0) sources[existing] = entry;
    else sources.push(entry);
    renderSourceChips();
  };

  // Drop zone — the primary path: drag straight from the Explorer or Canvas
  // sidebar, so you never leave the workspace or open the OS file browser.
  const drop = el('div', 'fc-dropzone');
  const dzIcon = el('div', 'fc-dropzone__icon');
  dzIcon.innerHTML = icon('inbox', 20);
  drop.appendChild(dzIcon);
  drop.appendChild(el('div', 'fc-dropzone__title', 'Drag a file or canvas page here'));
  drop.appendChild(el('div', 'fc-dropzone__hint', 'From the Explorer or Canvas sidebar, or use the buttons below.'));
  view.appendChild(drop);

  const onDragOver = (e) => {
    e.preventDefault(); e.stopPropagation();
    if (e.dataTransfer) {
      // Explorer dragstart sets effectAllowed='move'; forcing 'copy' makes
      // Chromium refuse the drop (the drop event never fires).
      e.dataTransfer.dropEffect = e.dataTransfer.effectAllowed === 'move' ? 'move' : 'copy';
    }
    drop.classList.add('fc-dropzone--over');
  };
  drop.addEventListener('dragenter', onDragOver);
  drop.addEventListener('dragover', onDragOver);
  drop.addEventListener('dragleave', (e) => { if (e.target === drop) drop.classList.remove('fc-dropzone--over'); });
  drop.addEventListener('drop', (e) => {
    e.preventDefault(); e.stopPropagation();
    drop.classList.remove('fc-dropzone--over');
    const dt = e.dataTransfer;
    void (async () => {
      try {
        drop.classList.add('fc-dropzone--busy');
        srcStatus.textContent = 'Loading dropped source…';
        applyLoaded(await fcLoadFromDrop(dt));
      } catch (err) {
        srcStatus.textContent = `Failed: ${err.message}`;
      } finally {
        drop.classList.remove('fc-dropzone--busy');
      }
    })();
  });

  // Buttons — in-workspace first (Canvas page, Workspace file); the OS dialog
  // and photo OCR are the fallback for material outside the workspace.
  const srcRow = el('div', 'fc-row');
  srcRow.style.marginTop = '8px';
  const srcBtn = (label, iconName, loader) => {
    const b = el('button', 'fc-btn');
    b.innerHTML = `${icon(iconName, 12)}<span>${label}</span>`;
    b.addEventListener('click', () => {
      void (async () => {
        try { b.disabled = true; applyLoaded(await loader()); }
        catch (err) { srcStatus.textContent = `Failed: ${err.message}`; }
        finally { b.disabled = false; }
      })();
    });
    return b;
  };
  srcRow.appendChild(srcBtn('Canvas Page', 'file-text', async () => {
    const pageId = await fcPickCanvasPage();
    return pageId ? fcReadCanvasPage(pageId) : null;
  }));
  srcRow.appendChild(srcBtn('Workspace File', 'file', () => fcPickWorkspaceFile()));
  srcRow.appendChild(srcBtn('Browse Device…', 'hard-drive', () => fcReadPdf()));
  srcRow.appendChild(srcBtn('Photo (OCR)', 'image', () => fcReadPhoto()));
  view.appendChild(srcRow);
  view.appendChild(chipsHost);
  view.appendChild(srcStatus);

  const pasteIn = el('textarea', 'fc-textarea');
  pasteIn.placeholder = 'Or paste study material here…';
  pasteIn.rows = 5;
  pasteIn.style.marginTop = '8px';
  view.appendChild(pasteIn);

  // Options.
  view.appendChild(el('div', 'fc-label', 'Options'));
  const optRow = el('div', 'fc-row');
  const countIn = el('input', 'fc-input');
  countIn.type = 'number';
  countIn.min = '1'; countIn.max = '50';
  countIn.placeholder = 'Auto';
  countIn.style.width = '70px';
  optRow.appendChild(el('span', 'fc-hint', 'Cards:'));
  optRow.appendChild(countIn);
  // Density (M101): shapes SELECTIVITY in auto mode. Writes straight to the
  // setting so the choice sticks across runs and surfaces in Settings too.
  optRow.appendChild(el('span', 'fc-hint', 'Density:'));
  const densityDd = _api.ui.createDropdown(optRow, {
    items: [
      { value: 'thorough', label: 'Thorough' },
      { value: 'balanced', label: 'Balanced' },
      { value: 'lean', label: 'Lean' },
    ],
    selected: fcGenerationDensity(),
    ariaLabel: 'Generation density',
  });
  densityDd.onDidChange((v) => {
    try {
      Promise.resolve(_api.workspace.getConfiguration('flashcards').update('generationDensity', v))
        .catch(() => { /* setting write is best-effort */ });
    } catch { /* setting write is best-effort */ }
  });
  optRow.appendChild(el('span', 'fc-hint', 'Blank = the material decides how many it warrants (50 max). Density steers how selective auto mode is; it never skips core concepts.'));
  view.appendChild(optRow);

  // Steering. Free text straight into the prompt, persisted because a study
  // phase tends to want the same steer for weeks. Chips FILL the box rather
  // than acting invisibly, so what the model is told stays inspectable.
  view.appendChild(el('div', 'fc-label', 'Steer the Cards (Optional)'));
  const guideIn = el('textarea', 'fc-textarea');
  guideIn.rows = 2;
  guideIn.placeholder = 'Tell the model what you want, e.g. "every formula as its own card" or "test when each method applies, not definitions".';
  const GUIDE_KEY = 'flashcards.generateGuidance';
  guideIn.value = localStorage.getItem(GUIDE_KEY) || '';
  guideIn.addEventListener('input', () => localStorage.setItem(GUIDE_KEY, guideIn.value));
  view.appendChild(guideIn);
  const chipRow = el('div', 'fc-row');
  chipRow.style.marginTop = '6px';
  for (const [label, text] of [
    ['Formulas First', 'Make every formula its own card, in LaTeX. Add one card per symbol or parameter explaining what it measures. Reconstruct any formula the PDF extraction garbled.'],
    ['Definitions', 'Focus on precise definitions of terms and their exact scope.'],
    ['Compare Methods', 'Focus on assumptions, when each method applies, and how the methods differ. Skip pure definitions.'],
    ['Worked Numbers', 'Prefer cards that each walk one small numeric example end to end.'],
  ]) {
    const chip = el('button', 'fc-btn');
    chip.textContent = label;
    chip.addEventListener('click', () => {
      guideIn.value = text;
      localStorage.setItem(GUIDE_KEY, guideIn.value);
    });
    chipRow.appendChild(chip);
  }
  view.appendChild(chipRow);

  const err = el('div', 'fc-error');
  err.style.display = 'none';
  view.appendChild(err);

  const genRow = el('div', 'fc-row');
  genRow.style.marginTop = '10px';
  const genBtn = _api.ui.createAiButton
    ? _api.ui.createAiButton(genRow, { label: 'Generate Cards' })
    : el('button', 'fc-btn fc-btn--primary');
  if (!genBtn.parentElement) { genBtn.textContent = 'Generate Cards'; genRow.appendChild(genBtn); }
  const genLabel = genBtn.querySelector('.px-ai-btn__label');
  const setGenLabel = (text) => {
    if (genLabel) genLabel.textContent = text;
    else genBtn.textContent = text;
  };
  const manualHint = el('span', 'fc-hint', 'Prefer manual entry? Open a deck and use "Add Card".');
  genRow.appendChild(manualHint);
  view.appendChild(genRow);

  const reviewHost = el('div');
  reviewHost.style.marginTop = '16px';
  view.appendChild(reviewHost);
  /** The doc list the last generation ran with — resolves per-card "doc"
   *  indexes to real provenance at import time. */
  let lastDocs = [];

  genBtn.addEventListener('click', () => {
    void (async () => {
      // Every loaded source AND the paste box combine into one material set —
      // pasted text no longer overrides loaded documents.
      const docs = [...sources];
      if (pasteIn.value.trim()) {
        docs.push({ text: pasteIn.value.trim(), label: 'Pasted text', uri: '', pageTexts: null });
      }
      if (docs.length === 0) {
        err.textContent = 'Load a source or paste some material first.';
        err.style.display = '';
        return;
      }
      err.style.display = 'none';
      genBtn.disabled = true;
      setGenLabel('Generating…');
      try {
        const n = parseInt(countIn.value, 10);
        const { cards, truncated } = await fcGenerateCards(docs.length === 1 ? docs[0].text : '', {
          count: Number.isFinite(n) && n > 0 ? Math.min(50, n) : null,
          focus: guideIn.value.trim(),
          pageTexts: docs.length === 1 ? docs[0].pageTexts : null,
          docs: docs.length > 1 ? docs : null,
        });
        lastDocs = docs;
        // Duplicate scan against the target deck (existing decks only).
        // Embeddings are recall; the judge decides (M101) — cosine similarity
        // alone flagged contrast pairs as duplicates.
        let dups = cards.map(() => null);
        const deckSel = parseInt(deckDropdown.value, 10);
        if (Number.isFinite(deckSel)) {
          setGenLabel('Checking for duplicates…');
          dups = await fcFindDuplicates(deckSel, cards);
          if (dups.some(Boolean)) {
            setGenLabel('Judging similar cards…');
            dups = await fcJudgeGenerationDups(cards, dups);
          }
        }
        renderReview(cards, dups, truncated);
      } catch (e2) {
        err.textContent = e2.message;
        err.style.display = '';
      } finally {
        genBtn.disabled = false;
        setGenLabel('Generate Cards');
      }
    })();
  });

  const renderReview = (cards, dups = [], truncated = false) => {
    reviewHost.innerHTML = '';
    reviewHost.appendChild(el('div', 'fc-label', `Review ${cards.length} generated cards`));
    if (truncated) {
      reviewHost.appendChild(el('div', 'fc-error',
        `The model hit its context window mid-response: these are the ${cards.length} cards it completed before the cut. `
        + 'The tail of the material is likely uncovered - import these, then generate again or run Coverage Review to fill the gaps.'));
    }
    const dupCount = dups.filter(Boolean).length;
    reviewHost.appendChild(el('div', 'fc-hint',
      'Edit anything inline; drop cards you do not want. Nothing is saved until you import.'
      + (dupCount ? ` ${dupCount} ${dupCount === 1 ? 'card looks' : 'cards look'} similar to cards already in the deck.` : '')));

    const rows = [];
    for (let ci = 0; ci < cards.length; ci++) {
      const c = cards[ci];
      const row = el('div', 'fc-genrow');
      const fields = el('div', 'fc-genrow__fields');
      // Provenance + importance + duplicate chips above the editors.
      const dup = dups[ci];
      if (c.page || c.doc || dup || c.importance) {
        const chips = el('div', 'fc-genrow__chips');
        if (c.doc && lastDocs[c.doc - 1]) {
          chips.appendChild(el('span', 'fc-chip', String(lastDocs[c.doc - 1].label).slice(0, 32)));
        }
        if (c.page) chips.appendChild(el('span', 'fc-chip', `p.${c.page}`));
        if (c.importance) {
          const impChip = el('span', 'fc-chip', `Importance ${c.importance}`);
          impChip.title = c.importanceReason || 'Exam-criticality score (1-100). High scores introduce first when pacing is on.';
          chips.appendChild(impChip);
        }
        if (dup) {
          // Judge verdicts (M101) replace the raw similarity reading; a
          // similarity-only chip means the judge was unavailable this run.
          const label = dup.verdict === 'duplicate'
            ? `Duplicate of: ${String(dup.matchFront).slice(0, 60)}`
            : dup.verdict === 'overlap'
              ? `Overlaps: ${String(dup.matchFront).slice(0, 60)}`
              : `Similar to: ${String(dup.matchFront).slice(0, 60)}`;
          const dupChip = el('span', 'fc-chip fc-chip--warn', label);
          dupChip.title = dup.reason
            || `${Math.round(dup.similarity * 100)}% similar to an existing card in this deck (AI judge unavailable; similarity only)`;
          chips.appendChild(dupChip);
        }
        fields.appendChild(chips);
      }
      const { grid: frontGrid, ta: front } = fcPreviewTextarea(c.front);
      const { grid: backGrid, ta: back } = fcPreviewTextarea(c.back);
      fields.append(frontGrid, backGrid);
      row.appendChild(fields);
      const dropBtn = el('button', 'fc-btn fc-btn--danger');
      dropBtn.textContent = 'Drop';
      const entry = {
        row, front, back, tags: c.tags || '', page: c.page || 0, doc: c.doc || 0,
        importance: c.importance || 0, importanceReason: c.importanceReason || '', dropped: false,
      };
      dropBtn.addEventListener('click', () => {
        entry.dropped = !entry.dropped;
        row.classList.toggle('fc-genrow--dropped', entry.dropped);
        dropBtn.textContent = entry.dropped ? 'Keep' : 'Drop';
      });
      row.appendChild(dropBtn);
      rows.push(entry);
      reviewHost.appendChild(row);
    }

    const importRow = el('div', 'fc-row');
    importRow.style.marginTop = '10px';
    const importBtn = el('button', 'fc-btn fc-btn--primary');
    importBtn.textContent = 'Import Cards';
    importBtn.addEventListener('click', () => {
      void (async () => {
        const keep = rows.filter((r) => !r.dropped && r.front.value.trim() && r.back.value.trim());
        if (keep.length === 0) {
          err.textContent = 'No cards left to import.';
          err.style.display = '';
          return;
        }
        importBtn.disabled = true;
        try {
          let deckId = deckDropdown.value;
          if (!deckId || deckId === '__new__') {
            const name = await _api.window.showInputBox({ prompt: 'New deck name', value: lastDocs[0]?.label || 'New deck' });
            if (!name?.trim()) { importBtn.disabled = false; return; }
            deckId = await fcCreateDeck(name);
          } else {
            deckId = parseInt(deckId, 10);
          }
          for (const r of keep) {
            // Per-card provenance: the doc the model attributed the fact to;
            // single-source runs resolve to that one document.
            const src = lastDocs[r.doc - 1] || (lastDocs.length === 1 ? lastDocs[0] : null);
            await fcCreateCard({
              deckId,
              front: r.front.value,
              back: r.back.value,
              tags: r.tags,
              sourceUri: src?.uri ?? '',
              sourceLabel: src?.label ?? (lastDocs.length > 1 ? 'Multiple sources' : 'Pasted text'),
              sourcePage: src ? (r.page || 0) : 0,
              importance: r.importance,
              importanceReason: r.importanceReason,
            });
          }
          await _api.window.showInformationMessage(`Imported ${keep.length} cards.`);
          setRoute({ view: 'browse', deckId });
        } catch (e3) {
          err.textContent = e3.message;
          err.style.display = '';
          importBtn.disabled = false;
        }
      })();
    });
    importRow.appendChild(importBtn);
    reviewHost.appendChild(importRow);
    importRow.scrollIntoView({ block: 'nearest' });
  };

  body.appendChild(view);
}

// ── Import view — mechanical, not AI ─────────────────────────────────────────
//
// The Create view asks a model to draft cards from prose. This view is the
// opposite contract: the cards ALREADY EXIST — an Anki deck from a provider, a
// printed front/back PDF, a spreadsheet — and the import must reproduce them
// exactly. Provider decks (Rising Fellow et al.) are the reason this is a
// first-class surface and not a paste box.

async function renderImport(body, route, setRoute, viewDisposables = []) {
  const view = el('div', 'fc-view');
  view.appendChild(el('div', 'fc-hint',
    'Bring in cards that already exist: what the file says is what you get. Page headers and footers are stripped; for PDFs the optional Rebuild with AI pass restores mangled formulas as real math without touching the wording.'));

  const err = el('div', 'fc-error');
  err.style.display = 'none';
  const showErr = (msg) => { err.textContent = msg; err.style.display = msg ? '' : 'none'; };

  // ── Source ──
  view.appendChild(el('div', 'fc-label', 'Deck File'));
  view.appendChild(el('div', 'fc-hint',
    'Anki exports (.apkg, or "Notes in Plain Text" .txt) and front/back PDFs where odd pages are fronts and even pages are backs.'));

  const drop = el('div', 'fc-dropzone');
  const dzIcon = el('div', 'fc-dropzone__icon');
  dzIcon.innerHTML = icon('inbox', 20);
  drop.appendChild(dzIcon);
  drop.appendChild(el('div', 'fc-dropzone__title', 'Drop a .apkg, .txt, or .pdf here'));
  drop.appendChild(el('div', 'fc-dropzone__hint', 'Or pick a file below. Pasting rows works too.'));
  view.appendChild(drop);

  const srcRow = el('div', 'fc-row');
  srcRow.style.marginTop = '8px';
  const pickBtn = el('button', 'fc-btn');
  pickBtn.innerHTML = `${icon('hard-drive', 12)}<span>Browse Device…</span>`;
  srcRow.appendChild(pickBtn);
  const srcStatus = el('span', 'fc-hint');
  srcRow.appendChild(srcStatus);
  view.appendChild(srcRow);

  const pasteIn = el('textarea', 'fc-textarea');
  pasteIn.placeholder = 'Or paste rows: front and back separated by a tab, " | ", or " :: ", one card per line.';
  pasteIn.rows = 4;
  pasteIn.style.marginTop = '8px';
  view.appendChild(pasteIn);
  const pasteBtn = el('button', 'fc-btn');
  pasteBtn.textContent = 'Preview Pasted Rows';
  pasteBtn.style.marginTop = '6px';
  view.appendChild(pasteBtn);

  view.appendChild(err);

  const previewHost = el('div');
  previewHost.style.marginTop = '16px';
  view.appendChild(previewHost);

  // ── Loading ──

  /** { kind:'anki', decks:[{name,cards}] } | { kind:'pdf', pageTexts } | { kind:'rows', cards } */
  let loaded = null;

  const loadPath = async (fsPath, label) => {
    showErr('');
    const kind = fcImportKindOf(fcExtOf(fsPath));
    srcStatus.textContent = `Reading ${label}…`;
    try {
      if (kind === 'anki') {
        const bridge = electronBridge();
        if (!bridge?.anki?.read) throw new Error('Anki import needs the desktop app.');
        const res = await bridge.anki.read(fsPath);
        if (!res.ok) throw new Error(res.error || 'Could not read the deck.');
        loaded = { kind: 'anki', decks: res.decks, mediaSkipped: res.mediaSkipped, label, uri: fsPath };
        srcStatus.textContent = `${label}: ${res.cardCount.toLocaleString()} cards in ${res.decks.length} deck${res.decks.length === 1 ? '' : 's'}.`;
      } else if (kind === 'pdf') {
        const bridge = electronBridge();
        const res = await bridge?.document?.extractText?.(fsPath);
        if (!res || res.error) throw new Error(res?.error?.message || 'Could not read the PDF.');
        if (!Array.isArray(res.pageTexts) || res.pageTexts.length === 0) {
          throw new Error('This PDF has no extractable text. If it is a scan, it needs OCR first.');
        }
        loaded = { kind: 'pdf', pageTexts: res.pageTexts, label, uri: fsPath };
        srcStatus.textContent = `${label}: ${res.pageTexts.length} pages.`;
      } else {
        throw new Error(`Not an importable deck: "${label}". Expected .apkg, .txt, or .pdf.`);
      }
      renderPreview();
    } catch (e) {
      loaded = null;
      previewHost.innerHTML = '';
      srcStatus.textContent = '';
      showErr(e.message);
    }
  };

  const onDragOver = (e) => {
    e.preventDefault(); e.stopPropagation();
    if (e.dataTransfer) {
      // Explorer dragstart sets effectAllowed='move'; forcing 'copy' makes
      // Chromium refuse the drop (the drop event never fires).
      e.dataTransfer.dropEffect = e.dataTransfer.effectAllowed === 'move' ? 'move' : 'copy';
    }
    drop.classList.add('fc-dropzone--over');
  };
  drop.addEventListener('dragenter', onDragOver);
  drop.addEventListener('dragover', onDragOver);
  drop.addEventListener('dragleave', (e) => { if (e.target === drop) drop.classList.remove('fc-dropzone--over'); });
  drop.addEventListener('drop', (e) => {
    e.preventDefault(); e.stopPropagation();
    drop.classList.remove('fc-dropzone--over');
    const dt = e.dataTransfer;
    const file = dt?.files?.[0];
    const raw = dt?.getData('text/uri-list') || dt?.getData('text/plain') || '';
    const fsPath = fcFileDropPath(file) || (fcLooksLikePath(raw) ? fcUriToFsPath(raw) : '');
    if (!fsPath) { showErr('Could not read a file path from that drop.'); return; }
    void loadPath(fsPath, file?.name || fsPath.split(/[\\/]/).pop());
  });

  pickBtn.addEventListener('click', () => {
    void (async () => {
      const bridge = electronBridge();
      const res = await bridge?.dialog?.openFile?.({
        title: 'Import a deck',
        filters: [
          { name: 'Decks', extensions: ['apkg', 'colpkg', 'txt', 'tsv', 'csv', 'pdf'] },
        ],
      });
      // dialog:openFile resolves to a bare string[] (or null on cancel).
      const fsPath = Array.isArray(res) ? res[0] : undefined;
      if (fsPath) void loadPath(fsPath, fsPath.split(/[\\/]/).pop());
    })();
  });

  pasteBtn.addEventListener('click', () => {
    showErr('');
    const { cards, skipped } = fcParsePastedRows(pasteIn.value);
    if (cards.length === 0) {
      showErr(skipped > 0
        ? `None of the ${skipped} lines had a separator. Split front and back with a tab, " | ", or " :: ".`
        : 'Paste some rows first.');
      return;
    }
    loaded = { kind: 'rows', cards, skipped, label: 'Pasted rows', uri: '' };
    srcStatus.textContent = `Pasted rows: ${cards.length} cards${skipped ? ` (${skipped} lines skipped)` : ''}.`;
    renderPreview();
  });

  // ── Preview + commit ──

  const renderPreview = () => {
    previewHost.innerHTML = '';
    if (!loaded) return;

    // PDF pairing controls live in the preview, so changing the offset
    // re-pairs live and the result is visible before anything is saved.
    // `ai` = the optional Rebuild with AI pass; `gen` guards overlapping
    // builds (build() is fired fire-and-forget); `aiCache` avoids re-running
    // the model on unrelated rebuilds.
    let pdfState = { offset: 0, ai: false, gen: 0, aiCache: null };

    const build = async () => {
      previewHost.innerHTML = '';
      const gen = ++pdfState.gen;

      let aiStatus = null;
      if (loaded.kind === 'pdf') {
        const bar = el('div', 'fc-row');
        bar.appendChild(el('span', 'fc-hint', 'Odd pages are fronts, even pages are backs. Skip'));
        const offIn = el('input', 'fc-input');
        offIn.type = 'number'; offIn.min = '0'; offIn.max = String(Math.max(0, loaded.pageTexts.length - 1));
        offIn.value = String(pdfState.offset);
        offIn.style.width = '60px';
        offIn.addEventListener('change', () => {
          pdfState.offset = Math.max(0, parseInt(offIn.value, 10) || 0);
          void build();
        });
        bar.appendChild(offIn);
        bar.appendChild(el('span', 'fc-hint', 'leading page(s): covers and instructions.'));
        previewHost.appendChild(bar);

        // Optional faithful AI rebuild: extraction shreds rendered math
        // beyond mechanical repair (fractions flatten, sub/superscripts
        // detach) — only a model can put formulas back into $LaTeX$.
        const aiRow = el('div', 'fc-row');
        const aiToggle = el('label', 'fc-check');
        const aiIn = el('input');
        aiIn.type = 'checkbox';
        aiIn.checked = pdfState.ai;
        aiToggle.append(aiIn, document.createTextNode(' Rebuild with AI: same cards and wording, formulas restored as math, page clutter dropped'));
        aiIn.addEventListener('change', () => {
          pdfState.ai = aiIn.checked;
          void build();
        });
        aiRow.appendChild(aiToggle);
        aiStatus = el('span', 'fc-hint');
        aiRow.appendChild(aiStatus);
        previewHost.appendChild(aiRow);
      }

      // Headers/footers/card counters are stripped mechanically and always —
      // they are page furniture, not card content (user report).
      let pdfCards = null;
      if (loaded.kind === 'pdf') {
        pdfCards = fcPairPages(fcStripPageFurniture(loaded.pageTexts), pdfState);
        if (pdfState.ai) {
          const cacheKey = pdfState.offset;
          if (pdfState.aiCache?.key !== cacheKey) {
            if (aiStatus) aiStatus.textContent = 'Rebuilding cards with AI…';
            const rebuilt = await fcAiTranscribePairs(pdfCards, {
              onProgress: (done, totalCards) => {
                if (aiStatus && gen === pdfState.gen) {
                  aiStatus.textContent = `Rebuilding cards with AI — ${done} / ${totalCards}…`;
                }
              },
            });
            if (gen !== pdfState.gen) return; // a newer build owns the host
            pdfState.aiCache = { key: cacheKey, cards: rebuilt };
          }
          pdfCards = pdfState.aiCache.cards;
          if (aiStatus) {
            aiStatus.textContent = 'Rebuilt. Review below - wording is kept, only math and layout are repaired.';
          }
        }
      }

      const groups = loaded.kind === 'anki'
        ? loaded.decks.map((d) => ({ name: d.name, cards: d.cards, include: true }))
        : [{ name: loaded.label, cards: loaded.kind === 'pdf' ? pdfCards : loaded.cards, include: true }];

      const total = groups.reduce((n, g) => n + g.cards.length, 0);
      previewHost.appendChild(el('div', 'fc-label', `Preview — ${total.toLocaleString()} cards`));
      if (loaded.kind === 'anki' && loaded.mediaSkipped > 0) {
        previewHost.appendChild(el('div', 'fc-hint',
          `${loaded.mediaSkipped} image/audio reference${loaded.mediaSkipped === 1 ? '' : 's'} in the deck were skipped — cards import as text.`));
      }

      // Destination: keep the file's deck names, or pour everything into one.
      const destRow = el('div', 'fc-row');
      destRow.style.margin = '8px 0';
      const decks = await fcListDecks();
      const destHost = el('div');
      destHost.style.minWidth = '260px';
      const items = [];
      if (loaded.kind === 'anki' && groups.length > 1) {
        items.push({ value: '__keep__', label: `Keep the File's Decks (${groups.length})` });
      }
      items.push({ value: '__new__', label: '+ New Deck…' });
      for (const d of decks) items.push({ value: String(d.id), label: `Into: ${d.name}` });
      const destDropdown = _api.ui.createDropdown(destHost, {
        items,
        selected: route.deckId ? String(route.deckId) : items[0].value,
        ariaLabel: 'Import destination',
      });
      viewDisposables.push(destDropdown);
      destRow.appendChild(el('span', 'fc-hint', 'Destination:'));
      destRow.appendChild(destHost);
      previewHost.appendChild(destRow);

      // Per-deck sections with a sample, so what lands is what was shown.
      for (const group of groups) {
        const section = el('div', 'fc-import-group');
        const head = el('div', 'fc-row');
        if (groups.length > 1) {
          const cb = el('input');
          cb.type = 'checkbox'; cb.checked = true;
          cb.addEventListener('change', () => {
            group.include = cb.checked;
            section.classList.toggle('fc-import-group--off', !cb.checked);
          });
          head.appendChild(cb);
        }
        head.appendChild(el('strong', '', group.name));
        head.appendChild(el('span', 'fc-hint', `${group.cards.length.toLocaleString()} cards`));
        section.appendChild(head);
        // The commit loop marks groups done in place after a mid-import
        // failure — the preview must not present landed groups as pending.
        group._ui = { section, head, cb: head.querySelector('input') };

        for (const c of group.cards.slice(0, 3)) {
          const sample = el('div', 'fc-import-sample');
          sample.appendChild(el('div', 'fc-import-sample__front', c.front.length > 160 ? c.front.slice(0, 160) + '…' : c.front));
          sample.appendChild(el('div', 'fc-import-sample__back', c.back.length > 160 ? c.back.slice(0, 160) + '…' : (c.back || '(empty back)')));
          section.appendChild(sample);
        }
        if (group.cards.length > 3) {
          section.appendChild(el('div', 'fc-hint', `…and ${(group.cards.length - 3).toLocaleString()} more.`));
        }
        previewHost.appendChild(section);
      }

      const goRow = el('div', 'fc-row');
      goRow.style.marginTop = '10px';
      const goBtn = el('button', 'fc-btn fc-btn--primary');
      goBtn.textContent = `Import ${total.toLocaleString()} Cards`;
      goRow.appendChild(goBtn);
      const progress = el('span', 'fc-hint');
      goRow.appendChild(progress);
      previewHost.appendChild(goRow);

      goBtn.addEventListener('click', () => {
        void (async () => {
          // `committed` survives a mid-import failure: a retry click must only
          // replay the groups that did NOT land, or every retry doubles them.
          const chosen = groups.filter((g) => g.include && !g.committed && g.cards.length > 0);
          if (chosen.length === 0) { showErr('Nothing selected to import.'); return; }
          showErr('');
          goBtn.disabled = true;
          try {
            let dest = destDropdown.value;
            let firstDeckId = null;
            let done = 0;
            const grand = chosen.reduce((n, g) => n + g.cards.length, 0);

            for (const group of chosen) {
              let deckId;
              if (dest === '__keep__') {
                deckId = await fcGetOrCreateDeckByName(group.name);
              } else if (dest === '__new__') {
                const name = await _api.window.showInputBox({
                  prompt: 'New deck name',
                  value: chosen.length === 1 ? group.name : loaded.label,
                });
                if (!name?.trim()) { goBtn.disabled = false; return; }
                deckId = await fcGetOrCreateDeckByName(name.trim());
                // One prompt for the whole import, not one per group: later
                // groups must see the resolved id, not '__new__' again.
                dest = String(deckId);
                destDropdown.setItems([{ value: String(deckId), label: `Into: ${name.trim()}` }], String(deckId));
              } else {
                deckId = parseInt(dest, 10);
              }
              if (firstDeckId === null) firstDeckId = deckId;

              done += await fcCreateCardsBulk(deckId, group.cards, {
                sourceUri: loaded.uri,
                sourceLabel: loaded.label,
              });
              group.committed = true;
              if (group._ui) {
                group._ui.section.classList.add('fc-import-group--done');
                if (group._ui.cb) group._ui.cb.disabled = true;
                group._ui.head.appendChild(el('span', 'fc-hint', '✓ imported'));
              }
              progress.textContent = `${done.toLocaleString()} / ${grand.toLocaleString()}…`;
            }

            await _api.window.showInformationMessage(`Imported ${done.toLocaleString()} cards.`);
            setRoute({ view: 'browse', deckId: firstDeckId });
          } catch (e) {
            showErr(e.message);
            // Re-arm the button for the REMAINING cards only — the landed
            // groups are marked above and excluded from the retry filter.
            const remaining = groups
              .filter((g) => g.include && !g.committed)
              .reduce((n, g) => n + g.cards.length, 0);
            goBtn.textContent = remaining > 0 ? `Import ${remaining.toLocaleString()} Cards` : 'Import';
            goBtn.disabled = false;
          }
        })();
      });
    };

    void build();
  };

  body.appendChild(view);
}

// ── Stats view ───────────────────────────────────────────────────────────────

async function renderStats(body) {
  const view = el('div', 'fc-view');
  const stats = await fcLoadStats();

  const grid = el('div', 'fc-stats-grid');
  const stat = (value, label) => {
    const box = el('div', 'fc-stat');
    box.appendChild(el('div', 'fc-stat__value', value));
    box.appendChild(el('div', 'fc-stat__label', label));
    return box;
  };
  grid.appendChild(stat(String(stats.today.reviews), 'Reviews today'));
  grid.appendChild(stat(stats.today.reviews > 0 ? `${stats.today.minutes}m` : '—', 'Time today'));
  grid.appendChild(stat(stats.streak > 0 ? `${stats.streak}d` : '—', 'Streak'));
  grid.appendChild(stat(stats.today.correctPct === null ? '—' : `${stats.today.correctPct}%`, 'Correct today'));
  grid.appendChild(stat(stats.retention30 === null ? '—' : `${stats.retention30}%`, 'Retention (30d)'));
  grid.appendChild(stat(String(stats.counts.total), 'Total cards'));
  view.appendChild(grid);

  view.appendChild(el('div', 'fc-label', 'Cards by stage'));
  const stageGrid = el('div', 'fc-stats-grid');
  stageGrid.appendChild(stat(String(stats.counts.new), 'New'));
  stageGrid.appendChild(stat(String(stats.counts.learning + stats.counts.relearning), 'Learning'));
  stageGrid.appendChild(stat(String(stats.counts.review), 'Reviewing'));
  stageGrid.appendChild(stat(String(stats.counts.suspended), 'Suspended'));
  view.appendChild(stageGrid);

  view.appendChild(el('div', 'fc-label', 'Reviews, last 30 days'));
  const chart = el('div', 'fc-chart');
  const max = Math.max(1, ...stats.last30.map((d) => d.count));
  stats.last30.forEach((day, i) => {
    const bar = el('div', 'fc-chart__bar');
    if (day.count === 0) bar.classList.add('fc-chart__bar--empty');
    else {
      bar.style.height = `${Math.max(6, Math.round((day.count / max) * 100))}%`;
      if (i === stats.last30.length - 1) bar.classList.add('fc-chart__bar--today');
    }
    bar.title = `${new Date(day.day).toLocaleDateString()}: ${day.count} reviews`;
    chart.appendChild(bar);
  });
  view.appendChild(chart);
  view.appendChild(el('div', 'fc-chart-caption', `Peak day: ${max} reviews`));

  // ── Scheduled load, next 14 days ──
  view.appendChild(el('div', 'fc-label', 'Scheduled, next 14 days'));
  const fchart = el('div', 'fc-chart');
  const fmax = Math.max(1, ...stats.forecast14.map((d) => d.count));
  stats.forecast14.forEach((day, i) => {
    const bar = el('div', 'fc-chart__bar fc-chart__bar--forecast');
    if (day.count === 0) bar.classList.add('fc-chart__bar--empty');
    else {
      bar.style.height = `${Math.max(6, Math.round((day.count / fmax) * 100))}%`;
      if (i === 0) bar.classList.add('fc-chart__bar--today');
    }
    bar.title = `${new Date(day.day).toLocaleDateString()}: ${day.count} scheduled`;
    fchart.appendChild(bar);
  });
  view.appendChild(fchart);
  const dueTotal14 = stats.forecast14.reduce((n, d) => n + d.count, 0);
  view.appendChild(el('div', 'fc-chart-caption',
    `${stats.forecast14[0]?.count ?? 0} due today · ${dueTotal14} scheduled over 14 days (new cards not included)`));

  // ── Answer mix, last 30 days ──
  const a = stats.answers30;
  const answerTotal = a.again + a.hard + a.good + a.easy;
  if (answerTotal > 0) {
    view.appendChild(el('div', 'fc-label', 'Answers, last 30 days'));
    const mix = el('div', 'fc-answermix');
    const legend = el('div', 'fc-answermix__legend');
    for (const [key, label] of [['again', 'Again'], ['hard', 'Hard'], ['good', 'Good'], ['easy', 'Easy']]) {
      const count = a[key];
      if (count > 0) {
        const seg = el('div', `fc-answermix__seg fc-answermix__seg--${key}`);
        seg.style.flexGrow = String(count);
        seg.title = `${label}: ${count} (${Math.round((count / answerTotal) * 100)}%)`;
        mix.appendChild(seg);
      }
      const item = el('span', 'fc-answermix__key');
      item.appendChild(el('span', `fc-answermix__dot fc-answermix__seg--${key}`));
      item.appendChild(document.createTextNode(` ${label} ${answerTotal ? Math.round((count / answerTotal) * 100) : 0}%`));
      legend.appendChild(item);
    }
    view.appendChild(mix);
    view.appendChild(legend);
  }

  // ── Per-deck breakdown ──
  if (stats.perDeck.length > 0) {
    view.appendChild(el('div', 'fc-label', 'By deck'));
    const table = el('div', 'fc-decktable');
    const headRow = el('div', 'fc-decktable__row fc-decktable__row--head');
    for (const h of ['Deck', 'Cards', 'Due Now', 'New', 'Avg Stability']) {
      headRow.appendChild(el('span', '', h));
    }
    table.appendChild(headRow);
    for (const d of stats.perDeck) {
      const row = el('div', 'fc-decktable__row');
      row.appendChild(el('span', 'fc-decktable__name', d.name));
      row.appendChild(el('span', '', String(d.total)));
      row.appendChild(el('span', d.due > 0 ? 'fc-decktable__due' : '', String(d.due)));
      row.appendChild(el('span', '', String(d.fresh)));
      row.appendChild(el('span', '', d.avgStability > 0
        ? `${d.avgStability < 100 ? d.avgStability.toFixed(1) : Math.round(d.avgStability)}d`
        : '—'));
      table.appendChild(row);
    }
    view.appendChild(table);
  }

  body.appendChild(view);
}

// ═══════════════════════════════════════════════════════════════════════════════
// SECTION 10: DASHBOARD WIDGET
// ═══════════════════════════════════════════════════════════════════════════════

function registerDashboardWidget(context) {
  if (!_api.dashboard?.registerWidgetType) return;
  try {
    context.subscriptions.push(_api.dashboard.registerWidgetType({
      typeId: 'parallx-community.flashcards.due',
      displayName: 'Flashcards due',
      description: 'How many cards are waiting for review, with a jump into a study session.',
      icon: 'layers',
      category: 'query',
      defaultSize: { colSpan: 3, rowSpan: 2 },
      defaultConfig: {},
      defaultRefreshPolicy: { kind: 'interval', ms: 15 * 60 * 1000 },
      refresh: async () => {
        const s = await fcDueSummary();
        // M98: streak + 7-day scheduled forecast ride along.
        const start = new Date(); start.setHours(0, 0, 0, 0);
        const [streak, loads] = await Promise.all([
          fcStudyStreak(),
          fcDayLoadForecast(start.getTime(), start.getTime() + 7 * DAY),
        ]);
        const forecast = [];
        for (let i = 0; i < 7; i++) {
          const dayMs = start.getTime() + i * DAY;
          forecast.push(loads.find((l) => l.dayStartMs === dayMs)?.count || 0);
        }
        return JSON.stringify({ ...s, streak, forecast });
      },
      createWidget: (container, ctx) => {
        injectStyles();
        const root = el('div', 'fc-widget-due');
        container.appendChild(root);
        const paint = (raw) => {
          let s = { due: 0, fresh: 0, total: 0, streak: 0, forecast: [] };
          try { s = { ...s, ...JSON.parse(raw || '{}') }; } catch { /* keep zeros */ }
          root.innerHTML = '';
          const big = el('div', 'fc-widget-due__big', String(s.due || 0));
          root.appendChild(big);
          const streakNote = s.streak > 0 ? ` · ${s.streak} day streak` : '';
          root.appendChild(el('div', '', `cards due · ${s.fresh || 0} new waiting${streakNote}`));
          // 7-day scheduled-review sparkline (bars scale to the week's max).
          if (Array.isArray(s.forecast) && s.forecast.some((n) => n > 0)) {
            const spark = el('div', 'fc-widget-due__spark');
            const max = Math.max(...s.forecast, 1);
            const dayName = (i) => new Date(Date.now() + i * DAY).toLocaleDateString(undefined, { weekday: 'short' });
            s.forecast.forEach((n, i) => {
              const bar = el('div', 'fc-widget-due__bar');
              bar.style.height = `${Math.max(2, Math.round((n / max) * 26))}px`;
              bar.title = `${dayName(i)}: ${n} scheduled`;
              if (n === 0) bar.classList.add('fc-widget-due__bar--zero');
              spark.appendChild(bar);
            });
            spark.title = 'Scheduled reviews, next 7 days';
            root.appendChild(spark);
          }
          const btn = el('button', 'fc-btn fc-btn--primary');
          btn.textContent = 'Study Now';
          btn.addEventListener('click', () => void openFlashcards({ view: 'study' }));
          root.appendChild(btn);
        };
        paint(ctx.cachedOutput);
        return {
          refreshFromCache: (cached) => paint(cached),
          dispose: () => root.remove(),
        };
      },
    }));
  } catch (err) {
    console.warn('[Flashcards] dashboard widget registration failed:', err);
  }
}

// ═══════════════════════════════════════════════════════════════════════════════
// SECTION 11: CHAT TOOLS
// ═══════════════════════════════════════════════════════════════════════════════

function registerChatTools(context) {
  if (!_api.chat?.registerTool) return;

  context.subscriptions.push(_api.chat.registerTool('flashcards.createCards', {
    description:
      'Create spaced-repetition flashcards in the user\'s Flashcards extension. '
      + 'Provide a deck name (created if missing) and an array of cards, each with '
      + '"front" (question) and "back" (answer). Use for "make flashcards from this" requests. '
      + 'Card text is Markdown plus $LaTeX$ for math. Use real newlines for line '
      + 'breaks, NEVER HTML tags like <br> (raw HTML is escaped, not rendered).',
    parameters: {
      type: 'object',
      properties: {
        deckName: { type: 'string', description: 'Target deck name.' },
        cards: {
          type: 'array',
          items: {
            type: 'object',
            properties: {
              front: { type: 'string' },
              back: { type: 'string' },
              tags: { type: 'array', items: { type: 'string' } },
            },
            required: ['front', 'back'],
          },
        },
      },
      required: ['deckName', 'cards'],
    },
    requiresConfirmation: true,
    handler: async (args) => {
      try {
        const deckName = String(args.deckName || '').trim();
        const cards = Array.isArray(args.cards) ? args.cards : [];
        if (!deckName || cards.length === 0) {
          return { content: 'deckName and a non-empty cards array are required.', isError: true };
        }
        const deckId = await fcGetOrCreateDeckByName(deckName);
        let created = 0;
        for (const c of cards.slice(0, 100)) {
          const front = String(c?.front || '').trim();
          const back = String(c?.back || '').trim();
          if (!front || !back) continue;
          const tags = Array.isArray(c.tags) ? c.tags.map(String).join(',') : '';
          await fcCreateCard({ deckId, front, back, tags, sourceLabel: 'Created from chat' });
          created++;
        }
        return { content: `Created ${created} cards in deck "${deckName}".` };
      } catch (err) {
        return { content: `Failed: ${err.message}`, isError: true };
      }
    },
  }));

  context.subscriptions.push(_api.chat.registerTool('flashcards.getDue', {
    description: 'Get the user\'s flashcard workload: due count, new-card count, total cards, per-deck breakdown.',
    parameters: { type: 'object', properties: {} },
    requiresConfirmation: false,
    handler: async () => {
      try {
        const summary = await fcDueSummary();
        const decks = await fcListDecks();
        const lines = [
          `Due now: ${summary.due} · New waiting: ${summary.fresh} · Total: ${summary.total}`,
          ...decks.map((d) => `- ${d.name}: ${d.dueCount} due, ${d.newCount} new (${d.total} cards)`),
        ];
        return { content: lines.join('\n') };
      } catch (err) {
        return { content: `Failed: ${err.message}`, isError: true };
      }
    },
  }));

  context.subscriptions.push(_api.chat.registerTool('flashcards.getStats', {
    description: 'Get the user\'s flashcard study statistics: reviews today, 30-day retention, card counts by stage.',
    parameters: { type: 'object', properties: {} },
    requiresConfirmation: false,
    handler: async () => {
      try {
        const s = await fcLoadStats();
        return {
          content: [
            `Reviews today: ${s.today.reviews}${s.today.correctPct !== null ? ` (${s.today.correctPct}% correct)` : ''}`,
            `30-day retention: ${s.retention30 !== null ? `${s.retention30}%` : 'n/a'}`,
            `Cards: new: ${s.counts.new}, learning: ${s.counts.learning + s.counts.relearning}, reviewing: ${s.counts.review}, suspended: ${s.counts.suspended}, total: ${s.counts.total}`,
          ].join('\n'),
        };
      } catch (err) {
        return { content: `Failed: ${err.message}`, isError: true };
      }
    },
  }));
}

// ═══════════════════════════════════════════════════════════════════════════════
// SECTION 12: LINKS CONTRACT
// ═══════════════════════════════════════════════════════════════════════════════

function registerLinks(context) {
  if (!_api.links?.register) return;
  try {
    context.subscriptions.push(_api.links.register({
      segment: 'flashcards',
      displayName: 'Flashcards',
      kinds: {
        deck: {
          uriTemplate: 'parallx://flashcards/deck/<deckId>',
          description: 'Open a flashcards deck in the browser view.',
          open: async (parsed) => {
            const deckId = parseInt(parsed.pathSegments[1] || '', 10);
            if (!Number.isFinite(deckId)) return false;
            await openFlashcards({ view: 'browse', deckId });
            return true;
          },
          resolveMetadata: async (parsed) => {
            const deckId = parseInt(parsed.pathSegments[1] || '', 10);
            const row = await db.get('SELECT name FROM fc_decks WHERE id = ?', [deckId]).catch(() => null);
            return row ? { title: `Deck: ${row.name}`, icon: 'layers' } : null;
          },
        },
        study: {
          uriTemplate: 'parallx://flashcards/study',
          description: 'Start a flashcards study session for everything due.',
          open: async () => {
            await openFlashcards({ view: 'study' });
            return true;
          },
        },
      },
    }));
  } catch (err) {
    console.warn('[Flashcards] links registration failed:', err);
  }
}

// ═══════════════════════════════════════════════════════════════════════════════
// SECTION 13: DAILY REMINDER (cron, autonomy-gated)
// ═══════════════════════════════════════════════════════════════════════════════

const FC_REMINDER_JOB_ID = 'flashcards.daily-reminder';

function syncReminderJob() {
  if (!_api.cron) return;
  try {
    const enabled = !!cfg('dailyReminder', false);
    if (!enabled) {
      _api.cron.removeJob(FC_REMINDER_JOB_ID);
      return;
    }
    const cronExpr = fcReminderCron(cfg('reminderTime', '09:00')) || '0 9 * * *';
    _api.cron.upsertJob({
      id: FC_REMINDER_JOB_ID,
      schedule: { cron: cronExpr },
      payload: {
        agentTurn:
          'Check the user\'s flashcards workload with the flashcards.getDue tool. '
          + 'If cards are due, post ONE short encouraging nudge naming the busiest '
          + 'deck and link parallx://flashcards/study. If nothing is due, say nothing beyond a one-line all-clear.',
      },
      wakeMode: 'now',
      contextMessages: 0,
      description: 'Daily flashcards due-cards check (Flashcards extension setting).',
    });
  } catch (err) {
    console.warn('[Flashcards] reminder job sync failed:', err);
  }
}

// ═══════════════════════════════════════════════════════════════════════════════
// SECTION 14: COMMANDS
// ═══════════════════════════════════════════════════════════════════════════════

async function _cmdNewDeck() {
  const name = await _api.window.showInputBox({ prompt: 'New deck name', placeholder: 'e.g. Exam 7 Reserving' });
  if (!name?.trim()) return;
  const deckId = await fcCreateDeck(name);
  await openFlashcards({ view: 'browse', deckId });
}

// ─── Selection → flashcard (M48 selection-action system) ────────────────────
// Any surface that dispatches a 'create-flashcard' selection action (PDF
// viewer, text/markdown editors) lands here: pick a deck, generate a few
// cards from the selection, import, confirm with a toast.

async function fcCaptureSelection(selectedText, source) {
  const text = String(selectedText || '').trim();
  if (text.length < 20) {
    await _api.window.showInformationMessage('Select a little more text to make a flashcard from.');
    return;
  }

  const decks = await fcListDecks();
  const NEW_DECK = '+ New Deck…';
  const pick = await _api.window.showQuickPick(
    [...decks.map((d) => ({ label: d.name, description: `${d.total} cards` })), { label: NEW_DECK }],
    { placeholder: 'Add flashcards to which deck?' },
  );
  if (!pick) return;

  let deckId;
  if (pick.label === NEW_DECK) {
    const name = await _api.window.showInputBox({ prompt: 'New deck name', value: source?.fileName || '' });
    if (!name?.trim()) return;
    deckId = await fcCreateDeck(name);
  } else {
    deckId = decks.find((d) => d.name === pick.label)?.id;
  }
  if (!deckId) return;

  // M98: page number lives in the structured source_page column (clickable
  // source line in study; PDF reveal), not baked into the display label.
  const sourceLabel = source?.fileName || 'Selection';
  const sourcePage = Number.isInteger(source?.pageNumber) && source.pageNumber > 0 ? source.pageNumber : 0;

  try {
    const { cards } = await fcGenerateCards(text, { count: 3 });
    // Same duplicate scan as the Create view — captures flag, never drop.
    const dups = await fcFindDuplicates(deckId, cards);
    const dupCount = dups.filter(Boolean).length;
    for (const c of cards) {
      await fcCreateCard({
        deckId,
        front: c.front,
        back: c.back,
        tags: c.tags,
        sourceUri: source?.filePath || '',
        sourceLabel,
        sourcePage,
      });
    }
    const deckName = pick.label === NEW_DECK ? 'the new deck' : pick.label;
    const dupNote = dupCount ? ` ${dupCount} may duplicate existing cards.` : '';
    const review = await _api.window.showInformationMessage(
      `Added ${cards.length} ${cards.length === 1 ? 'card' : 'cards'} to ${deckName}.${dupNote}`,
      { title: 'Review' },
    );
    if (review?.title === 'Review') await openFlashcards({ view: 'browse', deckId });
  } catch (err) {
    await _api.window.showErrorMessage(`Could not create flashcards: ${err.message}`);
  }
}

/** Register into the unified selection-action dispatcher. Chat may activate
 *  after this extension, so retry briefly until its command exists. */
function registerSelectionAction(context, attempt = 0) {
  _api.commands.executeCommand('chat.getSelectionActionDispatcher')
    .then((dispatcher) => {
      if (!dispatcher || typeof dispatcher.registerHandler !== 'function') throw new Error('no dispatcher');
      context.subscriptions.push(dispatcher.registerHandler({
        actionId: 'create-flashcard',
        label: 'Create Flashcard',
        icon: 'px-flashcards',
        execute: async (payload) => fcCaptureSelection(payload.selectedText, payload.source),
      }));
    })
    .catch(() => {
      if (attempt < 5 && _dbBridge) setTimeout(() => registerSelectionAction(context, attempt + 1), 2000);
    });
}

/**
 * M98 — contribute the per-day review forecast to the planner calendar via
 * its generic day-load seam. Same retry shape as the dispatcher above: the
 * planner is a built-in that may activate after this extension.
 */
function registerPlannerDayLoads(context, attempt = 0) {
  _api.commands.executeCommand('planner.getRegistry')
    .then((registry) => {
      // A retry can land after deactivate; a provider over a nulled bridge
      // would throw on every calendar render (M99 review).
      if (!_dbBridge) return;
      if (!registry || typeof registry.registerDayLoadProvider !== 'function') throw new Error('no registry');
      context.subscriptions.push(registry.registerDayLoadProvider({
        id: 'flashcards',
        getDayLoads: (fromMs, toMs) => fcDayLoadForecast(fromMs, toMs),
        onDidChange: (listener) => {
          _dataListeners.add(listener);
          return { dispose: () => { _dataListeners.delete(listener); } };
        },
      }));
    })
    .catch(() => {
      if (attempt < 5 && _dbBridge) setTimeout(() => registerPlannerDayLoads(context, attempt + 1), 2000);
    });
}

function registerCommands(context) {
  const cmds = [
    // No forced route on the generic opens: an already-open pane surfaces
    // exactly as the user left it (fresh opens still default to Decks).
    ['flashcards.open', () => openFlashcards()],
    ['flashcards.study', () => openFlashcards({ view: 'study' })],
    ['flashcards.customStudy', () => openFlashcards({ view: 'custom' })],
    ['flashcards.newDeck', () => _cmdNewDeck()],
    ['flashcards.newCard', () => openFlashcards()],
    ['flashcards.generate', () => openFlashcards({ view: 'create' })],
    ['flashcards.stats', () => openFlashcards({ view: 'stats' })],
    // Direct capture surface for other tools and the AI:
    // flashcards.captureSelection(text, { fileName?, filePath?, pageNumber? })
    ['flashcards.captureSelection', (...args) => fcCaptureSelection(args[0], args[1])],
  ];
  for (const [id, handler] of cmds) {
    context.subscriptions.push(_api.commands.registerCommand(id, handler));
  }
}

// ═══════════════════════════════════════════════════════════════════════════════
// SECTION 15: ACTIVATION
// ═══════════════════════════════════════════════════════════════════════════════

async function ensureDatabase(api) {
  const openResult = await api.database.open();
  if (openResult.error) {
    console.error('[Flashcards] Database open failed:', openResult.error.message);
    return false;
  }
  const toolPath = api.env.toolPath;
  const sep = toolPath.includes('\\') ? '\\' : '/';
  const migrationsDir = toolPath + sep + 'db' + sep + 'migrations';
  const res = await api.database.migrate(migrationsDir);
  if (res.error) {
    console.error('[Flashcards] Migration failed:', res.error.message);
    return false;
  }
  // M98: derive FSRS state for cards scheduled under SM-2. Idempotent; runs
  // once per pre-existing card population, then the guard query is empty.
  try {
    const healed = await fcHealFsrsState();
    if (healed > 0) console.log(`[Flashcards] FSRS state derived for ${healed} card(s) via review replay`);
  } catch (err) {
    console.error('[Flashcards] FSRS heal failed (cards stay on estimated state until next activate):', err);
  }
  return true;
}

export async function activate(api, context) {
  if (_activated) return;
  _activated = true;
  _api = api;

  if (!api.database) {
    console.error('[Flashcards] api.database unavailable; cannot activate.');
    return;
  }
  _dbBridge = api.database;
  const ok = await ensureDatabase(api);
  if (!ok) return;

  injectStyles();

  // M98: lazy embedding backfill for dedup — well off the activation path,
  // capped per run, and a silent no-op when Ollama is absent.
  const backfillTimer = setTimeout(() => { void fcBackfillEmbeddings(); }, 8000);
  context.subscriptions.push({ dispose: () => clearTimeout(backfillTimer) });

  context.subscriptions.push(
    api.views.registerViewProvider('flashcards.decks', {
      createView: (container) => createSidebarView(container),
    }),
  );

  context.subscriptions.push(
    api.editors.registerEditorProvider('flashcards', {
      createEditorPane: (container, input) => createEditorPane(container, input),
    }),
  );

  registerCommands(context);
  registerChatTools(context);
  registerLinks(context);
  registerDashboardWidget(context);
  registerSelectionAction(context);
  registerPlannerDayLoads(context);
  syncReminderJob();

  if (api.workspace?.onDidChangeConfiguration) {
    context.subscriptions.push(api.workspace.onDidChangeConfiguration((e) => {
      if (!e || typeof e.affectsConfiguration !== 'function' || e.affectsConfiguration('flashcards')) {
        syncReminderJob();
      }
    }));
  }

  console.log('[Flashcards] activated');
}

export async function deactivate() {
  _activated = false;
  _routeListeners.clear();
  _dataListeners.clear();
  _dbBridge = null;
}

// ═══════════════════════════════════════════════════════════════════════════════
// SECTION 15b: MECHANICAL IMPORT PARSERS
//
// Deterministic, not AI. These exist because "upload the PDF and tell the
// model odd pages are fronts" does not reliably produce the right cards — a
// language model paraphrases, merges and drops. A printed front/back deck has
// an exact structure; reading it should be exact.
// ═══════════════════════════════════════════════════════════════════════════════

/**
 * Strip page FURNITURE (running headers, footers, card counters) from a
 * PDF's page texts before pairing — user report: "it includes info like
 * document header and footer; those should not be on the flashcards."
 *
 * Grounded in the extraction of four real provider decks (Brosius, Mack CL,
 * Marshall, Meyers — 2026-08-12 scout pass):
 * - Headers are LETTER-SPACED with stray TABs ("B R O S I U S · E X A M \t7",
 *   "R E C I P E 1 O F 3") and their digits vary per card, so exact repeat
 *   matching finds nothing. Normalize by stripping ALL whitespace, folding
 *   digit runs to '#', casefolding.
 * - Furniture lives at FIXED POSITIONS: the first two lines and the last
 *   line of a page. Mid-page repeats ("EXAM TIPS", "PAST EXAM PRACTICE")
 *   are content section headings and must survive; so must one-character
 *   math orphans near the footer (a stray "Z" is card content).
 * - Back-page titles arrive FUSED with a furniture tag via tab
 *   ("p-p Plot & Histogram \tRecipe 1 of 5") — strip the tag suffix only,
 *   never the title.
 * A normalized form qualifies as furniture when it recurs on >= 2 pages at
 * furniture positions and is long enough (>= 6 chars normalized) to never
 * match bare formula fragments.
 */
function fcStripPageFurniture(pageTexts) {
  const pages = (pageTexts || []).map((t) => String(t ?? '').split('\n'));
  const norm = (line) => String(line).replace(/\s+/g, '').replace(/\d+/g, '#').toLowerCase();

  // Pool the normalized forms seen at furniture positions across all pages.
  const pool = new Map();
  const addCandidate = (line) => {
    const n = norm(line);
    if (n.length < 6) return; // short fragments ("Z", "2", "s.e.") are math
    pool.set(n, (pool.get(n) || 0) + 1);
  };
  for (const lines of pages) {
    if (lines.length < 3) continue; // a page this short is all content
    addCandidate(lines[0]);
    addCandidate(lines[1]);
    addCandidate(lines[lines.length - 1]);
    // Fused tag suffix on the first line ("<Title> \tRecipe 1 of 5").
    const tab = lines[0].lastIndexOf('\t');
    if (tab > 0) addCandidate(lines[0].slice(tab + 1));
  }

  // Furniture must carry a folded digit ('#'): every real header/footer/
  // counter in the scouted decks varies a number per card ("RECIPE 1 OF 3",
  // "CARD 2", "…EXAM 7"). Repeated DIGITLESS lines at these positions are
  // content section headings ("EXAM TIPS") and must survive.
  const isFurniture = (line) => {
    const n = norm(line);
    return n.length >= 6 && n.includes('#') && (pool.get(n) || 0) >= 2;
  };
  // Bare page numbers ("12", "Page 3", "3 of 10") as the last line are
  // furniture even without repetition-pool support.
  const isPageNumberFooter = (line) => /^(page)?#(of#)?$/.test(norm(line));

  return pages.map((lines) => {
    if (lines.length < 3) return lines.join('\n');
    const out = [...lines];
    // Last line first (indices stay valid), then the top two.
    const last = out[out.length - 1];
    if (isFurniture(last) || isPageNumberFooter(last)) out.pop();
    if (out.length > 1 && isFurniture(out[1])) out.splice(1, 1);
    if (isFurniture(out[0])) out.splice(0, 1);
    else {
      // Keep a content title, drop its fused furniture tag.
      const tab = out[0].lastIndexOf('\t');
      if (tab > 0 && isFurniture(out[0].slice(tab + 1))) {
        out[0] = out[0].slice(0, tab).replace(/\s+$/, '');
      }
    }
    return out.join('\n');
  });
}

/**
 * Pair a PDF's pages into cards: page 1 front / page 2 back, and so on.
 *
 * `offset` skips leading cover/instruction pages so the pairing starts on the
 * first real card face. An odd remainder page becomes a card with an empty
 * back rather than being silently dropped — visible in the preview, where the
 * user can drop it deliberately.
 */
function fcPairPages(pageTexts, { offset = 0 } = {}) {
  const pages = (pageTexts || []).slice(offset).map((t) => String(t ?? '').trim());
  const cards = [];
  for (let i = 0; i < pages.length; i += 2) {
    const front = pages[i];
    const back = pages[i + 1] ?? '';
    if (!front && !back) continue;   // blank sheet in the middle of the PDF
    // M98 grounding: the 1-based PDF page the FRONT face came from.
    cards.push({ front, back, tags: [], sourcePage: offset + i + 1 });
  }
  return cards;
}

/**
 * Parse pasted rows into cards: one card per line, front and back split on a
 * tab (a spreadsheet paste) or on " | " / " :: " for hand-typed lines. Lines
 * with no separator are skipped and counted, so a wrong guess about the format
 * is reported instead of producing half-empty cards.
 */
function fcParsePastedRows(text) {
  const cards = [];
  let skipped = 0;
  for (const rawLine of String(text || '').split('\n')) {
    const line = rawLine.trim();
    if (!line) continue;
    let front, back;
    if (line.includes('\t')) {
      const parts = line.split('\t');
      front = parts[0]; back = parts.slice(1).filter((p) => p.trim()).join('\n\n');
    } else if (line.includes(' | ')) {
      const at = line.indexOf(' | ');
      front = line.slice(0, at); back = line.slice(at + 3);
    } else if (line.includes(' :: ')) {
      const at = line.indexOf(' :: ');
      front = line.slice(0, at); back = line.slice(at + 4);
    } else {
      skipped++;
      continue;
    }
    front = front.trim(); back = back.trim();
    if (!front || !back) { skipped++; continue; }
    cards.push({ front, back, tags: [] });
  }
  return { cards, skipped };
}

// ═══════════════════════════════════════════════════════════════════════════════
// SECTION 16: TESTABLES
// ═══════════════════════════════════════════════════════════════════════════════

export const __testables = {
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
  fcCapProductionCards,
  fcCountServedToday,
  fcPacePlan,
  fcNewAllowances,
  fcNormalizeImportance,
  // M102 production recall
  FC_RECALL_MODES,
  FC_PRODUCTION_MODES,
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
  fcGradingContext,
  fcMarkingTranscript,
  fcMarkNumCtx,
  fcExtractJsonObject,
  FC_FLAGS,
  fcNormalizeFlag,
  fcFlagDef,
  fcBuildMaterial,
  fcTrigramSimilarity,
  fcStreamWithStall,
  fcParseClozeIndices,
  fcRenderCloze,
  fcExtractCardsJson,
  fcReminderCron,
  fcParseTags,
  fcAggregateStats,
  // Navigation model (sidebar rail + pane breadcrumb)
  FC_NAV_DEFS,
  FC_VIEW_LABELS,
  FC_DECK_VIEWS,
  fcNavViewFor,
  // Live-probe access (ext/flashcards/test/run-generation-probe.mjs): the
  // real generation pipeline against real Ollama. Requires activate() first
  // so _api is bound.
  fcGenerateCards,
  fcContextPlan,
  FC_CHARS_PER_TOKEN,
  FC_PROMPT_HEADROOM,
  FC_SCAFFOLD_TOKENS,
  FC_OUTPUT_BASE_TOKENS,
  FC_OUTPUT_TOKENS_PER_CARD,
  FC_FALLBACK_MODEL_CTX,
  FC_GENERATE_SYSTEM,
  FC_LEARNING_STEPS_MIN,
  FC_RELEARNING_STEPS_MIN,
  FC_MIN_EASE,
  AGAIN, HARD, GOOD, EASY,
  MIN, DAY,
  // Mechanical import
  fcPairPages,
  fcStripPageFurniture,
  fcAiTranscribePairs,
  FC_TRANSCRIBE_SYSTEM,
  fcParsePastedRows,
  // Deck intelligence (multi-doc generation + dedup sweep + coverage)
  fcExtractJsonArray,
  fcBuildMaterialDocs,
  fcClusterPairs,
  fcTrigramPairs,
  FC_JUDGE_SYSTEM,
  FC_COVERAGE_SYSTEM,
  fcImportKindOf,
  fcExtOf,
  // LaTeX survival through the JSON layer
  fcRepairLatexEscapes,
  fcNormalizeCardText,
  fcAutoCardEstimate,
};
