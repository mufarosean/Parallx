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
 * Build a study queue. Pure: cards in, ordered queue out.
 * Order: due learning/relearning (soonest first) → due reviews (most overdue
 * first, capped by reviewLimit) → new cards (oldest first, capped by
 * newLimit). Suspended cards never appear.
 */
function fcBuildQueue(cards, now, { newLimit = 20, reviewLimit = 200 } = {}) {
  const active = cards.filter((c) => !c.suspended);
  const learning = active
    .filter((c) => (c.state === 'learning' || c.state === 'relearning') && c.dueAt <= now)
    .sort((a, b) => a.dueAt - b.dueAt);
  const review = active
    .filter((c) => c.state === 'review' && c.dueAt <= now)
    .sort((a, b) => a.dueAt - b.dueAt)
    .slice(0, Math.max(0, reviewLimit));
  const fresh = active
    .filter((c) => c.state === 'new')
    .sort((a, b) => (a.createdAt || 0) - (b.createdAt || 0))
    .slice(0, Math.max(0, newLimit));
  return [...learning, ...review, ...fresh];
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

function fcExtractCardsJson(text) {
  if (typeof text !== 'string' || !text.trim()) return { cards: [], error: 'Empty response.' };
  let t = text.trim();
  // Thinking models can leak inline reasoning; brackets inside it would
  // hijack the array scan. Drop complete blocks AND an unterminated head.
  t = t.replace(/<think>[\s\S]*?<\/think>/gi, '');
  t = t.replace(/^[\s\S]*?<\/think>/i, '');
  // Strip markdown fences.
  t = t.replace(/```(?:json)?/gi, '');

  /** Parse cards out of one candidate array slice. */
  const parseSlice = (slice) => {
    let parsed;
    // Repair BEFORE the strict parse: parse-first would silently accept
    // `\frac` as formfeed+"rac" and the corruption would land in the deck.
    try { parsed = JSON.parse(fcRepairLatexEscapes(slice)); }
    catch {
      try { parsed = JSON.parse(slice); } catch { return null; }
    }
    if (!Array.isArray(parsed)) return null;
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
      // M98 grounding: per-card page attribution when the prompt was paged.
      // fcGenerateCards validates the number against the real page range.
      const page = Number(item.page ?? item.source_page ?? NaN);
      if (Number.isInteger(page) && page > 0) card.page = page;
      cards.push(card);
    }
    return cards;
  };

  // The first '[' can be a citation ("[1]") or stray bracket in prose —
  // walk EVERY candidate array until one yields usable cards.
  let sawArray = false, unterminated = false;
  let start = t.indexOf('[');
  let attempts = 0;
  while (start !== -1 && attempts < 8) {
    attempts++;
    // Walk to the matching close bracket (string-aware).
    let depth = 0, end = -1, inStr = false, escape = false;
    for (let i = start; i < t.length; i++) {
      const ch = t[i];
      if (escape) { escape = false; continue; }
      if (ch === '\\') { escape = true; continue; }
      if (ch === '"') { inStr = !inStr; continue; }
      if (inStr) continue;
      if (ch === '[') depth++;
      else if (ch === ']') {
        depth--;
        if (depth === 0) { end = i; break; }
      }
    }
    if (end === -1) { unterminated = true; break; }
    const cards = parseSlice(t.slice(start, end + 1));
    if (cards !== null) {
      sawArray = true;
      if (cards.length > 0) return { cards, error: null };
    }
    start = t.indexOf('[', start + 1);
  }

  if (unterminated) return { cards: [], error: 'Unterminated JSON array. The response may have been cut off.' };
  if (sawArray) return { cards: [], error: 'No usable cards in response.' };
  return { cards: [], error: 'No JSON array in response.' };
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

  let todayCount = 0, todayCorrect = 0;
  let retNum = 0, retDen = 0;
  const byDay = new Map();
  for (const r of reviews) {
    if (r.reviewedAt >= todayStart) {
      todayCount++;
      if (r.rating > AGAIN) todayCorrect++;
    }
    if (r.reviewedAt >= days30Start) {
      const day = startOfDay(r.reviewedAt);
      byDay.set(day, (byDay.get(day) || 0) + 1);
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

  return {
    counts,
    today: {
      reviews: todayCount,
      correctPct: todayCount > 0 ? Math.round((todayCorrect / todayCount) * 100) : null,
    },
    last30,
    retention30: retDen > 0 ? Math.round((retNum / retDen) * 100) : null,
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

async function openFlashcards(route) {
  if (route) _setRoute(route);
  await _api.editors.openEditor({
    typeId: 'flashcards',
    title: 'Flashcards',
    iconHtml: FC_ICON_HTML,
    instanceId: 'main',
  });
  // Re-dispatch for an already-open pane (first-open consumed _pendingRoute).
  if (route) {
    document.dispatchEvent(new CustomEvent('parallx.flashcards.route', { detail: route }));
  }
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

async function fcCreateCard(input) {
  const res = await db.run(`
    INSERT INTO fc_cards (deck_id, front, back, notes, tags, source_uri, source_label, source_page, card_type, note_group, cloze_index, created_at)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
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
  const CHUNK = 50;
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
  ];
  const COLS = '(deck_id, front, back, notes, tags, source_uri, source_label, source_page, card_type, note_group, cloze_index, created_at)';
  const ROW_PH = '(?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)';

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
      inserted += s.params.length / 12;
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

async function fcUpdateCard(id, patch) {
  const sets = [];
  const params = [];
  const map = { front: 'front', back: 'back', notes: 'notes', tags: 'tags', deckId: 'deck_id' };
  for (const [k, col] of Object.entries(map)) {
    if (patch[k] !== undefined) { sets.push(`${col} = ?`); params.push(patch[k]); }
  }
  if (patch.suspended !== undefined) { sets.push('suspended = ?'); params.push(patch.suspended ? 1 : 0); }
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
async function fcGradeCard(card, rating, msTaken = 0, deckOpts = {}) {
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
      ease_before, ease_after, state_before, state_after, ms_taken)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
  `, [card.id, now, rating, card.intervalDays, next.intervalDays, card.ease, next.ease, card.state, next.state, msTaken]);
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
  const reviews = (await db.all(
    'SELECT reviewed_at, rating, state_before FROM fc_reviews WHERE reviewed_at >= ?',
    [Date.now() - 31 * DAY],
  )).map((r) => ({ reviewedAt: r.reviewed_at, rating: r.rating, stateBefore: r.state_before }));
  const cards = (await db.all('SELECT state, suspended FROM fc_cards'))
    .map((r) => ({ state: r.state, suspended: !!r.suspended }));
  return fcAggregateStats(reviews, cards, Date.now());
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
  'Formatting (cards render Markdown + KaTeX):',
  '- Write EVERY formula and symbol in LaTeX between $...$ (or $$...$$ for a display equation).',
  '- Use **bold** for the key term, and bullet lists when the answer enumerates items.',
  '- Never use em dashes.',
  'Output ONLY a JSON array, no prose, in this exact shape:',
  '[{"front": "...", "back": "...", "tags": ["topic"]}]',
  'When the material carries [Page N] markers, add "page": N to each card.',
].join('\n');

// Context planning constants. CHARS_PER_TOKEN is the safe planning ratio,
// not the prose average (~3.5-4): formula-dense PDF extraction measured
// 2.44 on a real actuarial paper (38,263 chars -> 15,709 tokens), and
// under-estimating chars/token overflows the window, which hard-truncates
// the model's output mid-JSON. Prose just gets extra headroom.
const FC_CHARS_PER_TOKEN = 2.5;
/** System prompt + user wrapper + chat template, in tokens. */
const FC_SCAFFOLD_TOKENS = 600;
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
function fcContextPlan({ chars, count = 15, modelCtx = 0, setting = 0 } = {}) {
  const nCards = Math.min(50, Math.max(1, Number(count) || 15));
  const outputTokens = 1500 + 220 * nCards;
  const ceiling = modelCtx > 0 ? modelCtx : FC_FALLBACK_MODEL_CTX;
  let numCtx;
  if (Number.isFinite(setting) && setting > 0) {
    numCtx = Math.min(setting, ceiling);
  } else {
    const neededTokens = Math.ceil((Number(chars) || 0) / FC_CHARS_PER_TOKEN)
      + FC_SCAFFOLD_TOKENS + outputTokens;
    numCtx = Math.min(ceiling, Math.max(8192, Math.ceil(neededTokens / 2048) * 2048));
  }
  const maxChars = Math.max(
    4000,
    Math.floor((numCtx - FC_SCAFFOLD_TOKENS - outputTokens) * FC_CHARS_PER_TOKEN),
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
async function fcStreamWithStall(stream, onChunk, stallMs = 90_000) {
  const it = stream[Symbol.asyncIterator]();
  for (;;) {
    let timer;
    const stall = new Promise((_, reject) => {
      timer = setTimeout(() => reject(new Error(
        `The model stopped responding (no output for ${Math.round(stallMs / 1000)}s). ` +
        'Check that the model backend is running.',
      )), stallMs);
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

async function fcGenerateCards(sourceText, { count = null, focus = '', pageTexts = null, pageOffset = 0 } = {}) {
  const modelId = await fcPickModel();
  if (!modelId) throw new Error('No language model available. Configure a model in AI settings.');
  const { contextSetting, think } = fcAiOptions();
  const modelCtx = await fcModelContextLength(modelId);
  const totalChars = Array.isArray(pageTexts) && pageTexts.length
    ? pageTexts.reduce((n, p) => n + String(p || '').length, 0)
    : sourceText.length;
  const planCount = count ?? fcAutoCardEstimate(totalChars);
  const { numCtx, maxChars } = fcContextPlan({
    chars: totalChars, count: planCount, modelCtx, setting: contextSetting,
  });
  const { material, paged, clipped } = fcBuildMaterial(sourceText, pageTexts, maxChars, pageOffset);
  if (clipped) {
    console.warn(`[Flashcards] material clipped to ${maxChars} chars to fit a ${numCtx}-token window (model: ${modelId}${modelCtx ? `, max ${modelCtx}` : ', context length unknown'})`);
  }
  const user = [
    // Explicit count = a ceiling the user chose. Auto = the material decides:
    // a number here would only anchor the model into padding thin material
    // or truncating rich material at an arbitrary line.
    count
      ? `Create up to ${Math.min(50, Math.max(1, count))} flashcards from the material below.`
      : 'Create one flashcard per atomic fact the material supports: as many as it warrants, up to 50. '
        + 'Do not pad thin material with near-duplicate cards, and do not stop early on rich material.',
    paged
      ? 'The material is tagged with [Page N] markers. Add "page": N to each card, naming the page its fact comes from. Never invent a page number that has no marker.'
      : '',
    focus ? `Guidance from the learner (follow it): ${focus}` : '',
    '',
    '--- MATERIAL ---',
    material,
  ].filter(Boolean).join('\n');

  let output = '';
  const stream = _api.lm.sendChatRequest(modelId, [
    { role: 'system', content: FC_GENERATE_SYSTEM },
    { role: 'user', content: user },
  ], { temperature: 0.2, think, numCtx });
  await fcStreamWithStall(stream, (chunk) => {
    if (chunk.content) output += chunk.content;
  });
  const { cards, error } = fcExtractCardsJson(output);
  if (error && cards.length === 0) {
    console.warn('[Flashcards] generation failed. Raw model output head:', output.slice(0, 400));
    throw new Error(`${error} (model: ${modelId}; raw output logged to console)`);
  }
  if (paged) {
    // Attribution hygiene: only pages that actually exist in the material.
    const maxPage = pageOffset + pageTexts.length;
    for (const c of cards) {
      if (!(Number.isInteger(c.page) && c.page >= pageOffset + 1 && c.page <= maxPage)) delete c.page;
    }
  } else {
    for (const c of cards) delete c.page;
  }
  return cards;
}

/** Stream a discussion turn about a card. Returns the async iterable. */
async function fcDiscussStream(card, history, question) {
  const modelId = await fcPickModel();
  if (!modelId) throw new Error('No language model available.');
  const system = [
    'You are a study tutor discussing ONE flashcard with the learner.',
    'Be concise and concrete. Explain, give mnemonic hooks, test understanding.',
    'Never just restate the back of the card; add insight.',
    'Answers render Markdown + KaTeX: write formulas in LaTeX between $...$. Never use em dashes.',
    `CARD FRONT: ${card.front}`,
    `CARD BACK: ${card.back}`,
    card.sourceLabel ? `SOURCE: ${card.sourceLabel}` : '',
  ].filter(Boolean).join('\n');
  const messages = [
    { role: 'system', content: system },
    ...history,
    { role: 'user', content: question },
  ];
  // Same user-controlled AI knobs as generation (Settings → Flashcards).
  const { contextSetting, think } = fcAiOptions();
  const modelCtx = await fcModelContextLength(modelId);
  const chars = messages.reduce((n, m) => n + String(m.content || '').length, 0);
  const { numCtx } = fcContextPlan({ chars, count: 1, modelCtx, setting: contextSetting });
  return _api.lm.sendChatRequest(modelId, messages, { temperature: 0.4, think, numCtx });
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
async function fcExplainInChat(card, deckName) {
  await _api.commands.executeCommand('chat.show');
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
      card.sourceLabel ? `Source: ${card.sourceLabel}${card.sourcePage ? ` p.${card.sourcePage}` : ''}` : '',
    ].filter(Boolean).join('\n'),
  };
  if (card.sourcePage > 0) attachment.pageNumber = card.sourcePage;
  await _api.commands.executeCommand('chat.addSelectionContext', attachment);
  await _api.commands.executeCommand('chat.submitPrompt', {
    text: 'Explain this flashcard: why the answer holds, the intuition behind it, and one concrete example. Keep it tight.',
  });
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
.fc-today__lbl { font-size: var(--px-text-2xs); text-transform: uppercase; letter-spacing: 0.07em; color: var(--px-text-faint); }
.fc-today__study {
  display: flex; align-items: center; justify-content: center; gap: 6px;
  width: 100%; height: 34px; border: 0; border-radius: var(--px-radius-md);
  background: var(--px-accent); color: var(--px-text-on-accent);
  font: inherit; font-size: var(--px-text-sm); font-weight: 600; cursor: pointer;
  transition: background var(--px-dur-fast) var(--px-ease), transform var(--px-dur-instant) var(--px-ease);
}
.fc-today__study:hover { background: var(--px-accent-hover); }
.fc-today__study:active { transform: var(--px-press); }
.fc-today__study svg { width: 13px; height: 13px; }
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
.fc-deck-row__counts { flex: 0 0 auto; display: flex; align-items: center; gap: var(--px-space-2); font-size: var(--px-text-xs); font-weight: 600; font-variant-numeric: tabular-nums; color: var(--px-text-faint); }
.fc-deck-row__ct--new { color: var(--px-text-muted); }
.fc-deck-row__ct--due { color: var(--px-text-secondary); }
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
.fc-pane__tabs { display: flex; align-items: stretch; gap: 0; }
.fc-pane__tab {
  position: relative;
  display: inline-flex; align-items: center; gap: 7px; height: 100%; padding: 0 var(--px-space-3);
  border: 0; background: transparent; color: var(--px-text-muted);
  font: inherit; font-size: var(--px-text-base); font-weight: 550; cursor: pointer;
  transition: color var(--px-dur-fast) var(--px-ease);
}
.fc-pane__tab::after {
  content: ''; position: absolute; left: var(--px-space-3); right: var(--px-space-3); bottom: -1px;
  height: 2px; border-radius: 2px 2px 0 0; background: transparent;
  transition: background var(--px-dur-fast) var(--px-ease);
}
.fc-pane__tab svg { width: 14px; height: 14px; opacity: 0.8; }
.fc-pane__tab:hover { color: var(--px-text); }
.fc-pane__tab--active { color: var(--px-text); font-weight: 650; }
.fc-pane__tab--active::after { background: var(--px-accent); }
.fc-pane__spacer { flex: 1; }
.fc-pane__body { flex: 1; overflow-y: auto; }

/* Canvas-margin model (mirrors .canvas-full-width): the GUTTERS are the
   constant and the measure is fluid — content stretches to fill the space
   between defined margins instead of squeezing into a fixed column. Wide
   panes grow the gutters, like canvas, so lines stay readable. */
.fc-view, .fc-study {
  --fc-gutter: clamp(28px, 4vw, 72px);
}
.fc-view { max-width: none; margin: 0; padding: var(--px-space-6) var(--fc-gutter) var(--px-space-8); }
@media (min-width: 1441px) {
  .fc-view, .fc-study { --fc-gutter: clamp(72px, 8vw, 160px); }
}
.fc-empty { padding: var(--px-space-8) var(--px-space-4); text-align: center; font-size: var(--px-text-base); color: var(--px-text-muted); }

/* ── Deck list (Decks tab) — hairline-separated rows, not boxes; secondary
   actions stay out of sight until the row is engaged ── */
.fc-deck-card {
  display: flex; align-items: center; gap: var(--px-space-3);
  padding: var(--px-space-3) var(--px-space-1);
  border-bottom: 1px solid var(--px-divider);
}
.fc-deck-card__info { flex: 1; min-width: 0; cursor: pointer; }
.fc-deck-card__name { font-size: var(--px-text-md); font-weight: 600; letter-spacing: -0.01em; color: var(--px-text); }
.fc-deck-card__meta { font-size: var(--px-text-xs); color: var(--px-text-muted); font-variant-numeric: tabular-nums; margin-top: 3px; }
.fc-exam-chip {
  display: inline-block; margin-left: var(--px-space-2); padding: 1px 7px;
  font-size: var(--px-text-xs); font-weight: 600; letter-spacing: 0.01em;
  color: var(--px-accent); background: var(--px-accent-soft);
  border-radius: var(--px-radius-full, 999px); vertical-align: 2px;
  font-variant-numeric: tabular-nums;
}
.fc-deck-card__actions { display: flex; gap: var(--px-space-1); flex: 0 0 auto; opacity: 0; transition: opacity var(--px-dur-fast) var(--px-ease); }
.fc-deck-card:hover .fc-deck-card__actions,
.fc-deck-card:focus-within .fc-deck-card__actions { opacity: 1; }
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
  padding: var(--px-space-3) var(--px-space-1);
  border-bottom: 1px solid var(--px-divider);
}
.fc-cardrow--suspended { opacity: 0.5; }
.fc-cardrow__front { font-size: var(--px-text-base); font-weight: 600; color: var(--px-text); }
.fc-cardrow__back { font-size: var(--px-text-sm); margin-top: 3px; color: var(--px-text-muted); white-space: pre-wrap; line-height: var(--px-leading-base); }
.fc-cardrow__meta { display: flex; flex-wrap: wrap; align-items: center; gap: var(--px-space-3); margin-top: var(--px-space-2); font-size: var(--px-text-xs); color: var(--px-text-faint); font-variant-numeric: tabular-nums; }
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
.fc-study { display: flex; height: 100%; }
.fc-study__main { flex: 1; min-width: 0; display: flex; flex-direction: column; align-items: center; padding: var(--px-space-8) var(--fc-gutter); overflow-y: auto; outline: none; background: var(--px-window); }
.fc-study__toolbar { width: 100%; max-width: min(100%, 920px); display: flex; align-items: center; gap: var(--px-space-3); margin-bottom: var(--px-space-6); }
.fc-study__progress { flex: 1; height: 2px; border-radius: var(--px-radius-full); background: var(--px-divider); overflow: hidden; }
.fc-study__progress-fill { height: 100%; border-radius: var(--px-radius-full); background: var(--px-accent); transition: width var(--px-dur-base) var(--px-ease); }

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
/* M98 leech loop — chip + action live in the answer card's head row. */
.fc-card__leech {
  margin-left: auto; margin-right: var(--px-space-2); padding: 1px 7px;
  font-size: var(--px-text-2xs); font-weight: 700; letter-spacing: 0.05em;
  color: #a05a00; background: #fff3e0; border: 1px solid #f0ddc0;
  border-radius: var(--px-radius-full, 999px); text-transform: none;
}
.fc-btn--small { padding: 2px 9px; font-size: var(--px-text-xs); text-transform: none; letter-spacing: normal; font-weight: 500; }
.fc-meta-leech { color: #a05a00; font-weight: 600; }
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
.fc-study__discuss { margin-top: var(--px-space-3); }
.fc-study__keys { margin-top: var(--px-space-4); font-size: var(--px-text-xs); color: var(--px-text-faint); }
.fc-study__done { text-align: center; padding: var(--px-space-8) var(--px-space-5); }
.fc-study__done .fc-btn { margin-top: var(--px-space-4); }

/* ── Discuss panel ── */
.fc-discuss {
  flex: 0 0 320px; display: flex; flex-direction: column;
  border-left: 1px solid var(--px-divider);
  animation: fc-discuss-in var(--px-dur-base) var(--px-ease-out);
}
@keyframes fc-discuss-in {
  from { opacity: 0; transform: translateX(8px); }
  to   { opacity: 1; transform: translateX(0); }
}
.fc-discuss__head {
  padding: var(--px-space-2) var(--px-space-3);
  font-size: var(--px-text-xs); font-weight: 600; text-transform: uppercase; letter-spacing: 0.06em;
  color: var(--px-text-faint);
  border-bottom: 1px solid var(--px-divider);
}
.fc-discuss__log { flex: 1; overflow-y: auto; padding: var(--px-space-2) var(--px-space-3); display: flex; flex-direction: column; gap: var(--px-space-2); }
.fc-discuss__msg { font-size: var(--px-text-sm); line-height: var(--px-leading-base); white-space: pre-wrap; overflow-wrap: anywhere; }
.fc-discuss__msg--user { color: var(--px-text); font-weight: 600; }
.fc-discuss__msg--ai { color: var(--px-text-secondary); }
.fc-discuss__input-row { display: flex; gap: var(--px-space-1); padding: var(--px-space-2) var(--px-space-3); border-top: 1px solid var(--px-divider); }
.fc-discuss__input { flex: 1; }
.fc-discuss__empty { font-size: var(--px-text-xs); color: var(--px-text-faint); padding: var(--px-space-2) var(--px-space-3); line-height: var(--px-leading-base); }

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
// SECTION 8: SIDEBAR VIEW
// ═══════════════════════════════════════════════════════════════════════════════

function createSidebarView(container) {
  injectStyles();
  const root = el('div', 'fc-sidebar');

  // ── Header: title + quiet icon actions (Generate, + deck) ──
  const header = el('div', 'fc-sb__header');
  header.appendChild(el('div', 'fc-sb__title', 'Flashcards'));

  const genBtn = el('button', 'fc-sb__icon-btn');
  genBtn.type = 'button';
  genBtn.title = 'Generate cards with AI';
  genBtn.setAttribute('aria-label', 'Generate cards with AI');
  genBtn.innerHTML = icon('px-ai-mark', 15);
  genBtn.addEventListener('click', () => void openFlashcards({ view: 'create' }));
  header.appendChild(genBtn);

  const addBtn = el('button', 'fc-sb__icon-btn');
  addBtn.type = 'button';
  addBtn.title = 'New deck';
  addBtn.setAttribute('aria-label', 'New deck');
  addBtn.innerHTML = icon('plus', 16);
  addBtn.addEventListener('click', () => void _cmdNewDeck());
  header.appendChild(addBtn);
  root.appendChild(header);

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
  const sectionAdd = el('button', 'fc-sb__section-add');
  sectionAdd.type = 'button';
  sectionAdd.title = 'New deck';
  sectionAdd.setAttribute('aria-label', 'New deck');
  sectionAdd.innerHTML = icon('plus', 14);
  sectionAdd.addEventListener('click', () => void _cmdNewDeck());
  decksHead.appendChild(sectionAdd);
  decksSection.appendChild(decksHead);
  const deckList = el('div', 'fc-sb__decks');
  decksSection.appendChild(deckList);
  scroll.appendChild(decksSection);

  const openDeckMenu = (deck, x, y) => {
    if (!_api.ui.showContextMenu) { void openFlashcards({ view: 'browse', deckId: deck.id }); return; }
    _api.ui.showContextMenu({ x, y }, [
      { label: 'Study Deck', icon: 'play', onSelect: () => void openFlashcards({ view: 'study', deckId: deck.id }) },
      { label: 'Browse Cards', icon: 'layers', onSelect: () => void openFlashcards({ view: 'browse', deckId: deck.id }) },
      { label: 'Add Cards with AI', icon: 'px-ai-mark', onSelect: () => void openFlashcards({ view: 'create', deckId: deck.id }) },
      { separator: true },
      { label: 'Rename', icon: 'pencil', onSelect: () => void _renameDeckFlow(deck) },
      { label: deck.examDate ? 'Change Exam Date' : 'Set Exam Date', icon: 'calendar', onSelect: () => void _setExamDateFlow(deck) },
      { label: 'Delete Deck', icon: 'trash', danger: true, onSelect: () => void _deleteDeckFlow(deck) },
    ]);
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
      const studyBtn = el('button', 'fc-today__study');
      studyBtn.type = 'button';
      studyBtn.innerHTML = `${icon('play', 13)}<span>Study ${today.dueTotal} ${today.dueTotal === 1 ? 'card' : 'cards'}</span>`;
      studyBtn.addEventListener('click', () => void openFlashcards({ view: 'study' }));
      panel.appendChild(studyBtn);
    } else {
      panel.appendChild(el('div', 'fc-today__done',
        decks.length === 0 ? 'No cards yet. Add a deck to begin.' : 'All caught up. Nothing due right now.'));
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

  container.appendChild(root);
  return {
    dispose() {
      disposed = true;
      _dataListeners.delete(onData);
      root.remove();
    },
  };
}

// ── Deck lifecycle flows (shared by sidebar + browse view) ──

async function _renameDeckFlow(deck) {
  const name = await _api.window.showInputBox({ prompt: 'Rename deck', value: deck.name });
  if (name?.trim() && name.trim() !== deck.name) await fcRenameDeck(deck.id, name.trim());
}

/**
 * Set or clear a deck's exam date (M98 deadline-aware scheduling). Plain
 * YYYY-MM-DD input; blank clears. The scheduler caps intervals so at least
 * one more review fits before the date (fcDeadlineCapDays).
 */
async function _setExamDateFlow(deck) {
  // Local-date formatting, NOT toISOString: the stored stamp is local 23:59,
  // which is the NEXT day in UTC west of Greenwich — a toISOString prefill
  // would silently advance the exam a day on every re-confirm (M99 review).
  const fmtLocal = (ms) => {
    const d = new Date(ms);
    return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
  };
  const current = deck.examDate ? fmtLocal(deck.examDate) : '';
  const raw = await _api.window.showInputBox({
    prompt: 'Exam date (YYYY-MM-DD). Leave blank to clear.',
    value: current,
    placeHolder: '2026-10-27',
  });
  if (raw === undefined) return; // cancelled
  const trimmed = String(raw).trim();
  if (trimmed === '') {
    await fcSetDeckExamDate(deck.id, 0);
    return;
  }
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(trimmed);
  const ts = m ? new Date(Number(m[1]), Number(m[2]) - 1, Number(m[3]), 23, 59).getTime() : NaN;
  if (!m || Number.isNaN(ts)) {
    _api.window.showErrorMessage?.(`"${trimmed}" is not a valid date. Use YYYY-MM-DD.`);
    return;
  }
  if (ts <= Date.now()) {
    _api.window.showErrorMessage?.('The exam date must be in the future.');
    return;
  }
  await fcSetDeckExamDate(deck.id, ts);
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
// SECTION 9: EDITOR PANE — router (decks / browse / study / stats / create)
// ═══════════════════════════════════════════════════════════════════════════════

const TAB_DEFS = [
  { view: 'decks', label: 'Decks', iconName: 'layers' },
  { view: 'study', label: 'Study', iconName: 'play' },
  { view: 'create', label: 'Create', iconName: 'px-ai-mark' },
  { view: 'import', label: 'Import', iconName: 'inbox' },
  { view: 'stats', label: 'Stats', iconName: 'chart-column' },
];

function createEditorPane(container, input) {
  injectStyles();
  try { input?.setName?.('Flashcards'); } catch { /* noop */ }

  const state = {
    route: _takePendingRoute() || { view: 'decks' },
    disposed: false,
    session: null, // live study session (owned by renderStudy)
  };

  const root = el('div', 'fc-pane');
  const header = el('div', 'fc-pane__header');
  const tabs = el('div', 'fc-pane__tabs');
  header.appendChild(tabs);
  header.appendChild(el('div', 'fc-pane__spacer'));
  root.appendChild(header);
  const body = el('div', 'fc-pane__body');
  root.appendChild(body);
  container.appendChild(root);

  for (const def of TAB_DEFS) {
    const tab = el('button', 'fc-pane__tab');
    tab.type = 'button';
    tab.dataset.view = def.view;
    tab.innerHTML = `${icon(def.iconName, 13)}<span>${def.label}</span>`;
    tab.addEventListener('click', () => setRoute({ view: def.view }));
    tabs.appendChild(tab);
  }

  const syncTabs = () => {
    const activeView = state.route.view === 'browse' ? 'decks' : state.route.view;
    for (const t of tabs.children) {
      t.classList.toggle('fc-pane__tab--active', t.dataset.view === activeView);
    }
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
        syncTabs();
        state.session = null;
        disposeView();
        body.innerHTML = '';
        const route = state.route;
        if (route.view === 'browse') await renderBrowse(body, route, setRoute);
        else if (route.view === 'study') await renderStudy(body, route, state, setRoute);
        else if (route.view === 'create') await renderCreate(body, route, setRoute, viewDisposables);
        else if (route.view === 'import') await renderImport(body, route, setRoute, viewDisposables);
        else if (route.view === 'stats') await renderStats(body);
        else await renderDecks(body, setRoute);
      } while (renderQueued && !state.disposed);
    } finally {
      rendering = false;
    }
  };

  function setRoute(route) {
    state.route = route;
    void render();
  }

  const onRouteEvent = (e) => {
    if (!root.isConnected) return;
    const route = e.detail;
    if (route && route.view) setRoute(route);
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
    if (state.disposed || state.route.view === 'study' || state.route.view === 'create'
      || state.route.view === 'import' || state.route.view === 'browse') return;
    void render();
  };
  _dataListeners.add(onData);

  void render();

  return {
    dispose() {
      state.disposed = true;
      disposeView();
      document.removeEventListener('parallx.flashcards.route', onRouteEvent);
      _dataListeners.delete(onData);
      root.remove();
    },
    // The workbench rebuilds this pane on every tab switch (media-organizer
    // pattern): without these hooks, clicking away and back always reset the
    // tool to the Decks view. Study sessions are deliberately NOT resumed —
    // a half-graded card should not reappear mid-question after an hour away.
    saveViewState() {
      const route = state.route.view === 'study' ? { view: 'decks' } : state.route;
      return { route, scrollTop: body.scrollTop || 0 };
    },
    restoreViewState(saved) {
      if (state.disposed || !saved || !saved.route || !saved.route.view) return;
      setRoute(saved.route);
      if (typeof saved.scrollTop === 'number' && saved.scrollTop > 0) {
        // After the async view render settles; best-effort by design.
        setTimeout(() => { if (!state.disposed) body.scrollTop = saved.scrollTop; }, 120);
      }
    },
  };
}

// ── Decks view ───────────────────────────────────────────────────────────────

async function renderDecks(body, setRoute) {
  const view = el('div', 'fc-view');

  const actions = el('div', 'fc-row');
  const newDeckBtn = el('button', 'fc-btn fc-btn--primary');
  newDeckBtn.innerHTML = `${icon('plus', 12)}<span>New deck</span>`;
  newDeckBtn.addEventListener('click', () => void _cmdNewDeck());
  actions.appendChild(newDeckBtn);
  const genBtn = _api.ui.createAiButton
    ? _api.ui.createAiButton(actions, { label: 'Generate Cards' })
    : el('button', 'fc-btn');
  if (!genBtn.parentElement) { genBtn.textContent = 'Generate Cards'; actions.appendChild(genBtn); }
  genBtn.addEventListener('click', () => setRoute({ view: 'create' }));
  view.appendChild(actions);
  view.appendChild(el('div', 'fc-label', 'Decks'));

  const decks = await fcListDecks();
  if (decks.length === 0) {
    // Same hero shape as the workbench voice registry (.px-empty is global).
    const empty = el('div', 'px-empty');
    empty.appendChild(el('div', 'px-empty__headline', 'Build your first deck'));
    empty.appendChild(el('div', 'px-empty__hint',
      'Click New deck, or Generate to turn a canvas page, PDF, or photo into cards.'));
    view.appendChild(empty);
  }
  for (const deck of decks) {
    const card = el('div', 'fc-deck-card');
    const info = el('div', 'fc-deck-card__info');
    const nameRow = el('div', 'fc-deck-card__name', deck.name);
    if (deck.examDate && deck.examDate > Date.now()) {
      const daysLeft = Math.max(1, Math.ceil((deck.examDate - Date.now()) / DAY));
      const chip = el('span', 'fc-exam-chip', `${daysLeft}d to exam`);
      chip.title = `Exam ${new Date(deck.examDate).toLocaleDateString()} — intervals capped so every card gets a final review in time`;
      nameRow.appendChild(chip);
    }
    info.appendChild(nameRow);
    info.appendChild(el('div', 'fc-deck-card__meta',
      `${deck.total} cards · ${deck.dueCount} due · ${deck.newCount} new`));
    info.addEventListener('click', () => setRoute({ view: 'browse', deckId: deck.id }));
    card.appendChild(info);

    const btns = el('div', 'fc-deck-card__actions');
    const studyBtn = el('button', 'fc-btn');
    studyBtn.textContent = 'Study';
    studyBtn.disabled = deck.dueCount === 0 && deck.newCount === 0;
    studyBtn.addEventListener('click', () => setRoute({ view: 'study', deckId: deck.id }));
    btns.appendChild(studyBtn);
    const renameBtn = el('button', 'fc-btn');
    renameBtn.textContent = 'Rename';
    renameBtn.addEventListener('click', () => {
      void (async () => {
        const name = await _api.window.showInputBox({ prompt: 'Rename deck', value: deck.name });
        if (name?.trim()) await fcRenameDeck(deck.id, name);
      })();
    });
    btns.appendChild(renameBtn);
    const delBtn = el('button', 'fc-btn fc-btn--danger');
    delBtn.textContent = 'Delete';
    delBtn.addEventListener('click', () => {
      void (async () => {
        const pick = await _api.window.showWarningMessage(
          `Delete "${deck.name}" and its ${deck.total} cards? This cannot be undone.`,
          { title: 'Delete' }, { title: 'Cancel' },
        );
        if (pick?.title === 'Delete') await fcDeleteDeck(deck.id);
      })();
    });
    btns.appendChild(delBtn);
    card.appendChild(btns);
    view.appendChild(card);
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

  form.appendChild(el('div', 'fc-label', 'Tags'));
  const tagsIn = el('input', 'fc-input');
  tagsIn.value = fcParseTags(card.tags).join(' ');
  tagsIn.placeholder = 'space-separated';
  form.appendChild(tagsIn);

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
    void onSave({ front, back, tags });
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
  addBtn.innerHTML = `${icon('plus', 12)}<span>Add card</span>`;
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
  saveCard.textContent = 'Add Card';
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
  addBtn.addEventListener('click', () => {
    addForm.style.display = addForm.style.display === 'none' ? '' : 'none';
    if (addForm.style.display === '') frontIn.focus();
  });
  view.appendChild(addForm);

  // Search.
  const searchIn = el('input', 'fc-input');
  searchIn.placeholder = 'Search cards…';
  searchIn.style.margin = '12px 0';
  view.appendChild(searchIn);

  const listHost = el('div');
  view.appendChild(listHost);

  const renderList = async () => {
    const cards = await fcListCards(deckRow.id, searchIn.value);
    listHost.innerHTML = '';
    if (cards.length === 0) {
      listHost.appendChild(el('div', 'fc-empty', searchIn.value ? 'No matches.' : 'No cards in this deck yet.'));
      return;
    }
    for (const card of cards) {
      listHost.appendChild(buildCardRow(card));
    }
  };

  const buildCardRow = (card) => {
    const row = el('div', 'fc-cardrow');
    if (card.suspended) row.classList.add('fc-cardrow--suspended');
    const front = el('div', 'fc-cardrow__front');
    front.appendChild(_api.ui.renderMarkdown ? _api.ui.renderMarkdown(card.front) : document.createTextNode(card.front));
    row.appendChild(front);
    const back = el('div', 'fc-cardrow__back');
    back.appendChild(_api.ui.renderMarkdown ? _api.ui.renderMarkdown(card.back) : document.createTextNode(card.back));
    row.appendChild(back);
    const meta = el('div', 'fc-cardrow__meta');
    const stateChip = el('span', `fc-state fc-state--${card.state === 'relearning' ? 'learning' : card.state}`);
    stateChip.textContent = card.state;
    meta.appendChild(stateChip);
    // M98 card types: siblings announce themselves (edits propagate group-wide).
    if (card.cardType === 'cloze') meta.appendChild(el('span', '', `cloze c${card.clozeIndex}`));
    else if (card.cardType === 'reverse') meta.appendChild(el('span', '', 'reverse pair'));
    if (card.state !== 'new') {
      meta.appendChild(el('span', '', card.dueAt <= Date.now()
        ? 'due now'
        : `due ${new Date(card.dueAt).toLocaleDateString()}`));
      // FSRS state (M98); legacy ease only for cards not yet migrated.
      if (card.stability > 0) {
        const s = el('span', '', `stability ${card.stability < 100 ? card.stability.toFixed(1) : Math.round(card.stability)}d`);
        s.title = `Difficulty ${card.difficulty.toFixed(1)} / 10`;
        meta.appendChild(s);
      } else {
        meta.appendChild(el('span', '', `ease ${card.ease.toFixed(2)}`));
      }
      meta.appendChild(el('span', '', `${card.reps} reps`));
      if (card.lapses > 0) meta.appendChild(el('span', '', `${card.lapses} lapses`));
      if (fcIsLeech(card)) meta.appendChild(el('span', 'fc-meta-leech', 'leech'));
    }
    if (card.tags) meta.appendChild(el('span', '', `#${fcParseTags(card.tags).join(' #')}`));
    if (card.sourceLabel) meta.appendChild(el('span', '', card.sourceLabel));
    row.appendChild(meta);

    const btns = el('div', 'fc-cardrow__actions');
    const editBtn = el('button', 'fc-btn');
    editBtn.textContent = 'Edit';
    editBtn.addEventListener('click', () => {
      row.classList.add('fc-cardrow--editing');
      row.replaceChildren(fcCardEditorEl(card, {
        onSave: async (patch) => {
          await fcUpdateCard(card.id, patch);
          void renderList();
        },
        onCancel: () => void renderList(),
      }));
    });
    btns.appendChild(editBtn);
    const suspendBtn = el('button', 'fc-btn');
    suspendBtn.textContent = card.suspended ? 'Unsuspend' : 'Suspend';
    suspendBtn.addEventListener('click', () => {
      void fcUpdateCard(card.id, { suspended: !card.suspended }).then(renderList);
    });
    btns.appendChild(suspendBtn);
    const delBtn = el('button', 'fc-btn fc-btn--danger');
    delBtn.textContent = 'Delete';
    delBtn.addEventListener('click', () => {
      void fcDeleteCard(card.id).then(renderList);
    });
    btns.appendChild(delBtn);
    row.appendChild(btns);
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

// ── Study view ───────────────────────────────────────────────────────────────

async function renderStudy(body, route, paneState, setRoute) {
  const cards = await fcListAllCards(route.deckId ?? null);
  const queue = fcBuildQueue(cards, Date.now(), {
    newLimit: Number(cfg('dailyNewLimit', 20)) || 20,
    reviewLimit: Number(cfg('dailyReviewLimit', 200)) || 200,
  });

  const study = el('div', 'fc-study');
  const main = el('div', 'fc-study__main');
  main.tabIndex = 0; // container-scoped keyboard grading
  study.appendChild(main);
  body.appendChild(study);

  if (queue.length === 0) {
    const done = el('div', 'fc-study__done px-empty');
    done.appendChild(el('div', 'px-empty__headline', cards.length === 0 ? 'Ready when you are' : 'All caught up'));
    done.appendChild(el('div', 'px-empty__hint',
      cards.length === 0
        ? 'Create cards in a deck, or click Create to generate them from a canvas page or PDF.'
        : 'The scheduler brings cards back right before you would forget them. Check back later.'));
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

  const session = {
    queue: [...queue],
    index: 0,
    revealed: false,
    doneCount: 0,
    total: queue.length,
    cardShownAt: Date.now(),
    discussHistory: [],
  };
  paneState.session = session;

  // Discuss panel (collapsed by default; toggled per card).
  let discussPanel = null;
  const closeDiscuss = () => {
    if (discussPanel) { discussPanel.remove(); discussPanel = null; }
  };

  const openDiscuss = (card) => {
    closeDiscuss();
    session.discussHistory = [];
    const panel = el('div', 'fc-discuss');
    discussPanel = panel;
    panel.appendChild(el('div', 'fc-discuss__head', 'Discuss this card'));
    const log = el('div', 'fc-discuss__log');
    panel.appendChild(log);
    panel.appendChild(el('div', 'fc-discuss__empty',
      'Ask anything about this card: why the answer holds, edge cases, a mnemonic…'));
    const inputRow = el('div', 'fc-discuss__input-row');
    const input = el('input', 'fc-input fc-discuss__input');
    input.placeholder = 'Ask the AI…';
    const send = el('button', 'fc-btn fc-btn--primary');
    send.textContent = 'Send';
    const submit = () => {
      const q = input.value.trim();
      if (!q || send.disabled) return;
      input.value = '';
      void (async () => {
        send.disabled = true;
        const userMsg = el('div', 'fc-discuss__msg fc-discuss__msg--user', q);
        log.appendChild(userMsg);
        const aiMsg = el('div', 'fc-discuss__msg fc-discuss__msg--ai', '…');
        log.appendChild(aiMsg);
        log.scrollTop = log.scrollHeight;
        try {
          const stream = await fcDiscussStream(card, session.discussHistory, q);
          let text = '';
          await fcStreamWithStall(stream, (chunk) => {
            if (chunk.content) {
              text += chunk.content;
              aiMsg.textContent = text;
              log.scrollTop = log.scrollHeight;
            }
          });
          // Final render: markdown + LaTeX (streaming shows plain text).
          if (_api.ui.renderMarkdown) {
            aiMsg.textContent = '';
            aiMsg.appendChild(_api.ui.renderMarkdown(text));
            log.scrollTop = log.scrollHeight;
          }
          session.discussHistory.push({ role: 'user', content: q });
          session.discussHistory.push({ role: 'assistant', content: text });
          // Keep the transcript bounded.
          if (session.discussHistory.length > 12) {
            session.discussHistory = session.discussHistory.slice(-12);
          }
        } catch (err) {
          aiMsg.textContent = `(${err.message})`;
        } finally {
          send.disabled = false;
          input.focus();
        }
      })();
    };
    send.addEventListener('click', submit);
    input.addEventListener('keydown', (e) => { if (e.key === 'Enter') submit(); });
    inputRow.append(input, send);
    panel.appendChild(inputRow);
    study.appendChild(panel);
    input.focus();
  };

  // Render card text through the shared Markdown + KaTeX renderer; fall
  // back to plain text if the host is too old to provide it.
  const renderCardBody = (text) => {
    try { return _api.ui.renderMarkdown(text); } catch {
      const d = el('div');
      d.textContent = text;
      return d;
    }
  };

  const showCard = () => {
    closeDiscuss();
    main.innerHTML = '';
    session.revealed = false;
    session.cardShownAt = Date.now();

    if (session.index >= session.queue.length) {
      const done = el('div', 'fc-study__done px-empty');
      done.appendChild(el('div', 'px-empty__headline', 'Session complete'));
      done.appendChild(el('div', 'px-empty__hint',
        `${session.doneCount} ${session.doneCount === 1 ? 'card' : 'cards'} reviewed. Check Stats to watch retention climb.`));
      const statsBtn = el('button', 'fc-btn');
      statsBtn.textContent = 'View Stats';
      statsBtn.addEventListener('click', () => setRoute({ view: 'stats' }));
      done.appendChild(statsBtn);
      main.appendChild(done);
      return;
    }

    const card = session.queue[session.index];

    // ── Toolbar: progress + card-theme toggle ──
    const toolbar = el('div', 'fc-study__toolbar');
    const progress = el('div', 'fc-study__progress');
    const fill = el('div', 'fc-study__progress-fill');
    fill.style.width = `${Math.round((session.doneCount / session.total) * 100)}%`;
    progress.appendChild(fill);
    toolbar.appendChild(progress);

    main.appendChild(toolbar);

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
    main.appendChild(qCard);

    const answerHost = el('div', 'fc-study__answer-host');
    main.appendChild(answerHost);

    const controls = el('div', 'fc-study__controls');
    main.appendChild(controls);

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
      answerHost.appendChild(aCard);

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
        btn.appendChild(el('span', 'fc-grade__ivl', fcIntervalPreview(card, g.r, now, optsFor(card))));
        btn.addEventListener('click', () => grade(g.r));
        controls.appendChild(btn);
      }
      const discussHost = el('div', 'fc-study__discuss');
      const discussBtn = _api.ui.createAiButton
        ? _api.ui.createAiButton(discussHost, { label: 'Discuss with AI' })
        : el('button', 'fc-btn');
      if (!discussBtn.parentElement) {
        discussBtn.textContent = 'Discuss with AI';
        discussHost.appendChild(discussBtn);
      }
      discussBtn.addEventListener('click', () => openDiscuss(card));
      // M98: hand the card to the main chat with full context staged.
      const explainBtn = el('button', 'fc-btn');
      explainBtn.textContent = 'Explain in Chat';
      explainBtn.addEventListener('click', () => {
        void fcExplainInChat(card, deckNames.get(card.deckId));
      });
      discussHost.appendChild(explainBtn);
      main.appendChild(discussHost);
      main.appendChild(el('div', 'fc-study__keys', 'Space reveal · 1 Again · 2 Hard · 3 Good · 4 Easy'));
    };

    const grade = (rating) => {
      // Re-entrancy guard (M99 review): a double-click or key repeat before
      // the async grade lands would grade the same card twice and skip one.
      if (session.grading) return;
      session.grading = true;
      const msTaken = Date.now() - session.cardShownAt;
      void (async () => {
        const updated = await fcGradeCard(card, rating, msTaken, optsFor(card));
        // Cards still in learning re-enter the back of the queue when they
        // come due within this session's horizon (10 min).
        if ((updated.state === 'learning' || updated.state === 'relearning')
            && updated.dueAt <= Date.now() + 10 * MIN) {
          session.queue.push(updated);
          session.total++;
        }
        session.doneCount++;
        session.index++;
        session.grading = false;
        showCard();
      })();
    };

    controls.innerHTML = '';
    const revealBtn = el('button', 'fc-btn fc-btn--primary fc-study__reveal');
    revealBtn.textContent = 'Show Answer';
    revealBtn.addEventListener('click', reveal);
    controls.appendChild(revealBtn);
    main.appendChild(el('div', 'fc-study__keys', 'Space shows the answer'));

    // Container-scoped keyboard: only fires while the study surface has focus.
    main.onkeydown = (e) => {
      if (e.target instanceof HTMLInputElement || e.target instanceof HTMLTextAreaElement) return;
      if (e.key === ' ' || e.key === 'Enter') {
        e.preventDefault();
        if (!session.revealed) reveal();
        return;
      }
      if (session.revealed && ['1', '2', '3', '4'].includes(e.key)) {
        e.preventDefault();
        grade(parseInt(e.key, 10));
      }
    };
    main.focus();
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

  // ── Source material — default to in-workspace: drag a file/page, or pick. ──
  view.appendChild(el('div', 'fc-label', 'Source Material'));
  const sourceState = { text: '', label: '', uri: '', pageTexts: null };
  const srcStatus = el('div', 'fc-hint fc-src-status', 'Drag a file or canvas page here, pick one below, or paste text.');

  const applyLoaded = (loaded) => {
    if (!loaded) return;
    sourceState.text = loaded.text;
    sourceState.label = loaded.label;
    sourceState.uri = loaded.uri;
    sourceState.pageTexts = loaded.pageTexts || null;
    pasteIn.value = '';
    const pages = sourceState.pageTexts ? ` · ${sourceState.pageTexts.length} pages` : '';
    srcStatus.textContent = `Loaded ${loaded.label} (${loaded.text.length.toLocaleString()} chars${pages}).`;
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
    if (e.dataTransfer) e.dataTransfer.dropEffect = 'copy';
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
  optRow.appendChild(el('span', 'fc-hint', 'Blank = the material decides how many it warrants (50 max). A number sets a ceiling.'));
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
  const manualHint = el('span', 'fc-hint', 'Prefer manual entry? Open a deck and use "Add card".');
  genRow.appendChild(manualHint);
  view.appendChild(genRow);

  const reviewHost = el('div');
  reviewHost.style.marginTop = '16px';
  view.appendChild(reviewHost);

  genBtn.addEventListener('click', () => {
    void (async () => {
      const text = (pasteIn.value.trim() || sourceState.text).trim();
      if (!text) {
        err.textContent = 'Load a source or paste some material first.';
        err.style.display = '';
        return;
      }
      err.style.display = 'none';
      genBtn.disabled = true;
      setGenLabel('Generating…');
      try {
        const n = parseInt(countIn.value, 10);
        // Pasted text overrides the loaded source — page tagging only applies
        // when generating from the loaded (paged) document itself.
        const usingLoadedSource = !pasteIn.value.trim() && !!sourceState.text;
        const cards = await fcGenerateCards(text, {
          count: Number.isFinite(n) && n > 0 ? Math.min(50, n) : null,
          focus: guideIn.value.trim(),
          pageTexts: usingLoadedSource ? sourceState.pageTexts : null,
        });
        // Duplicate scan against the target deck (existing decks only).
        let dups = cards.map(() => null);
        const deckSel = parseInt(deckDropdown.value, 10);
        if (Number.isFinite(deckSel)) {
          setGenLabel('Checking for duplicates…');
          dups = await fcFindDuplicates(deckSel, cards);
        }
        renderReview(cards, dups);
      } catch (e2) {
        err.textContent = e2.message;
        err.style.display = '';
      } finally {
        genBtn.disabled = false;
        setGenLabel('Generate Cards');
      }
    })();
  });

  const renderReview = (cards, dups = []) => {
    reviewHost.innerHTML = '';
    reviewHost.appendChild(el('div', 'fc-label', `Review ${cards.length} generated cards`));
    const dupCount = dups.filter(Boolean).length;
    reviewHost.appendChild(el('div', 'fc-hint',
      'Edit anything inline; drop cards you do not want. Nothing is saved until you import.'
      + (dupCount ? ` ${dupCount} ${dupCount === 1 ? 'card looks' : 'cards look'} similar to cards already in the deck.` : '')));

    const rows = [];
    for (let ci = 0; ci < cards.length; ci++) {
      const c = cards[ci];
      const row = el('div', 'fc-genrow');
      const fields = el('div', 'fc-genrow__fields');
      // Provenance + duplicate chips above the editors.
      const dup = dups[ci];
      if (c.page || dup) {
        const chips = el('div', 'fc-genrow__chips');
        if (c.page) chips.appendChild(el('span', 'fc-chip', `p.${c.page}`));
        if (dup) {
          const dupChip = el('span', 'fc-chip fc-chip--warn', `Similar to: ${String(dup.matchFront).slice(0, 60)}`);
          dupChip.title = `${Math.round(dup.similarity * 100)}% similar to an existing card in this deck`;
          chips.appendChild(dupChip);
        }
        fields.appendChild(chips);
      }
      const front = el('textarea', 'fc-textarea');
      front.rows = 2; front.value = c.front;
      const back = el('textarea', 'fc-textarea');
      back.rows = 2; back.value = c.back;
      fields.append(front, back);
      row.appendChild(fields);
      const dropBtn = el('button', 'fc-btn fc-btn--danger');
      dropBtn.textContent = 'Drop';
      const entry = { row, front, back, tags: c.tags || '', page: c.page || 0, dropped: false };
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
            const name = await _api.window.showInputBox({ prompt: 'New deck name', value: sourceState.label || 'New deck' });
            if (!name?.trim()) { importBtn.disabled = false; return; }
            deckId = await fcCreateDeck(name);
          } else {
            deckId = parseInt(deckId, 10);
          }
          for (const r of keep) {
            await fcCreateCard({
              deckId,
              front: r.front.value,
              back: r.back.value,
              tags: r.tags,
              sourceUri: sourceState.uri,
              sourceLabel: sourceState.label || 'Pasted text',
              sourcePage: r.page || 0,
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
    'Bring in cards that already exist. Nothing here goes through the AI; what the file says is what you get.'));

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
    if (e.dataTransfer) e.dataTransfer.dropEffect = 'copy';
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
    let pdfState = { offset: 0 };

    const build = async () => {
      previewHost.innerHTML = '';

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
      }

      const groups = loaded.kind === 'anki'
        ? loaded.decks.map((d) => ({ name: d.name, cards: d.cards, include: true }))
        : [{ name: loaded.label, cards: loaded.kind === 'pdf' ? fcPairPages(loaded.pageTexts, pdfState) : loaded.cards, include: true }];

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
    const cards = await fcGenerateCards(text, { count: 3 });
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
    ['flashcards.open', () => openFlashcards({ view: 'decks' })],
    ['flashcards.study', () => openFlashcards({ view: 'study' })],
    ['flashcards.newDeck', () => _cmdNewDeck()],
    ['flashcards.newCard', () => openFlashcards({ view: 'decks' })],
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
  fcBuildMaterial,
  fcTrigramSimilarity,
  fcStreamWithStall,
  fcParseClozeIndices,
  fcRenderCloze,
  fcExtractCardsJson,
  fcReminderCron,
  fcParseTags,
  fcAggregateStats,
  // Live-probe access (ext/flashcards/test/run-generation-probe.mjs): the
  // real generation pipeline against real Ollama. Requires activate() first
  // so _api is bound.
  fcGenerateCards,
  fcContextPlan,
  FC_CHARS_PER_TOKEN,
  FC_SCAFFOLD_TOKENS,
  FC_FALLBACK_MODEL_CTX,
  FC_GENERATE_SYSTEM,
  FC_LEARNING_STEPS_MIN,
  FC_RELEARNING_STEPS_MIN,
  FC_MIN_EASE,
  AGAIN, HARD, GOOD, EASY,
  MIN, DAY,
  // Mechanical import
  fcPairPages,
  fcParsePastedRows,
  fcImportKindOf,
  fcExtOf,
  // LaTeX survival through the JSON layer
  fcRepairLatexEscapes,
  fcNormalizeCardText,
  fcAutoCardEstimate,
};
