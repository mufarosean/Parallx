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

/** Human preview of what a rating would do ("<10m", "1d", "12d"). */
function fcIntervalPreview(card, rating, now) {
  const s = fcSchedule(card, rating, now);
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
      cards.push({ front, back, tags });
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

async function fcDeleteDeck(id) {
  await db.run('DELETE FROM fc_cards WHERE deck_id = ?', [id]);
  await db.run('DELETE FROM fc_decks WHERE id = ?', [id]);
  _emitDataChanged();
}

async function fcCreateCard(input) {
  const res = await db.run(`
    INSERT INTO fc_cards (deck_id, front, back, notes, tags, source_uri, source_label, created_at)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?)
  `, [
    input.deckId,
    String(input.front).trim(),
    String(input.back).trim(),
    input.notes || '',
    input.tags || '',
    input.sourceUri || '',
    input.sourceLabel || '',
    Date.now(),
  ]);
  _emitDataChanged();
  return res.lastInsertRowid ?? res.lastID ?? null;
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
  let inserted = 0;
  try {
    for (let i = 0; i < cards.length; i += CHUNK) {
      const chunk = cards.slice(i, i + CHUNK);
      const placeholders = chunk.map(() => '(?, ?, ?, ?, ?, ?, ?, ?)').join(', ');
      const params = [];
      for (const c of chunk) {
        params.push(
          deckId,
          String(c.front ?? '').trim(),
          String(c.back ?? '').trim(),
          c.notes || '',
          Array.isArray(c.tags) ? c.tags.join(' ') : (c.tags || ''),
          sourceUri,
          sourceLabel,
          now,
        );
      }
      await db.run(
        `INSERT INTO fc_cards (deck_id, front, back, notes, tags, source_uri, source_label, created_at)
         VALUES ${placeholders}`,
        params,
      );
      inserted += chunk.length;
    }
  } catch (e) {
    // All-or-nothing: a chunk failure mid-call would otherwise leave a partial
    // group that a retry re-inserts in full. Every row of this call shares the
    // same created_at + source stamp, which no other write path produces, so
    // the compensating delete removes exactly this call's rows.
    try {
      await db.run(
        'DELETE FROM fc_cards WHERE deck_id = ? AND created_at = ? AND source_uri = ? AND source_label = ?',
        [deckId, now, sourceUri, sourceLabel],
      );
    } catch { /* compensation is best-effort; the error below still surfaces */ }
    _emitDataChanged();
    throw e;
  }
  _emitDataChanged();
  return inserted;
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
  params.push(id);
  await db.run(`UPDATE fc_cards SET ${sets.join(', ')} WHERE id = ?`, params);
  _emitDataChanged();
}

async function fcDeleteCard(id) {
  await db.run('DELETE FROM fc_cards WHERE id = ?', [id]);
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
async function fcGradeCard(card, rating, msTaken = 0) {
  const now = Date.now();
  const next = fcSchedule(card, rating, now);
  await db.run(`
    UPDATE fc_cards SET state = ?, ease = ?, interval_days = ?, due_at = ?,
      reps = ?, lapses = ?, learning_step = ?
    WHERE id = ?
  `, [next.state, next.ease, next.intervalDays, next.dueAt, next.reps, next.lapses, next.learningStep, card.id]);
  await db.run(`
    INSERT INTO fc_reviews (card_id, reviewed_at, rating, interval_before, interval_after,
      ease_before, ease_after, state_before, state_after, ms_taken)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
  `, [card.id, now, rating, card.intervalDays, next.intervalDays, card.ease, next.ease, card.state, next.state, msTaken]);
  _emitDataChanged();
  return { ...card, ...next };
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
  'Formatting (cards render Markdown + KaTeX):',
  '- Write EVERY formula and symbol in LaTeX between $...$ (or $$...$$ for a display equation).',
  '- Use **bold** for the key term, and bullet lists when the answer enumerates items.',
  '- Never use em dashes.',
  'Output ONLY a JSON array, no prose, in this exact shape:',
  '[{"front": "...", "back": "...", "tags": ["topic"]}]',
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

async function fcGenerateCards(sourceText, { count = 15, focus = '' } = {}) {
  const modelId = await fcPickModel();
  if (!modelId) throw new Error('No language model available. Configure a model in AI settings.');
  const { contextSetting, think } = fcAiOptions();
  const modelCtx = await fcModelContextLength(modelId);
  const { numCtx, maxChars } = fcContextPlan({
    chars: sourceText.length, count, modelCtx, setting: contextSetting,
  });
  const clipped = sourceText.length > maxChars
    ? sourceText.slice(0, maxChars) + '\n\n[...material truncated...]'
    : sourceText;
  if (sourceText.length > maxChars) {
    console.warn(`[Flashcards] material clipped to ${maxChars} chars to fit a ${numCtx}-token window (model: ${modelId}${modelCtx ? `, max ${modelCtx}` : ', context length unknown'})`);
  }
  const user = [
    `Create up to ${Math.min(50, Math.max(1, count))} flashcards from the material below.`,
    focus ? `Focus on: ${focus}` : '',
    '',
    '--- MATERIAL ---',
    clipped,
  ].filter(Boolean).join('\n');

  let output = '';
  const stream = _api.lm.sendChatRequest(modelId, [
    { role: 'system', content: FC_GENERATE_SYSTEM },
    { role: 'user', content: user },
  ], { temperature: 0.2, think, numCtx });
  for await (const chunk of stream) {
    if (chunk.content) output += chunk.content;
  }
  const { cards, error } = fcExtractCardsJson(output);
  if (error && cards.length === 0) {
    console.warn('[Flashcards] generation failed. Raw model output head:', output.slice(0, 400));
    throw new Error(`${error} (model: ${modelId}; raw output logged to console)`);
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
  return { text, label: `Document: ${name}`, uri: filePath };
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

.fc-view { max-width: 720px; margin: 0 auto; padding: var(--px-space-6) var(--px-space-6) var(--px-space-8); }
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
.fc-study__main { flex: 1; min-width: 0; display: flex; flex-direction: column; align-items: center; padding: var(--px-space-8) var(--px-space-8); overflow-y: auto; outline: none; background: var(--px-window); }
.fc-study__toolbar { width: 100%; max-width: 620px; display: flex; align-items: center; gap: var(--px-space-3); margin-bottom: var(--px-space-6); }
.fc-study__progress { flex: 1; height: 2px; border-radius: var(--px-radius-full); background: var(--px-divider); overflow: hidden; }
.fc-study__progress-fill { height: 100%; border-radius: var(--px-radius-full); background: var(--px-accent); transition: width var(--px-dur-base) var(--px-ease); }
.fc-theme-toggle {
  display: inline-flex; align-items: center; justify-content: center;
  width: 26px; height: 26px; border: 0; border-radius: var(--px-radius-sm);
  background: transparent; color: var(--px-text-faint); cursor: pointer;
  transition: background var(--px-dur-fast) var(--px-ease), color var(--px-dur-fast) var(--px-ease);
}
.fc-theme-toggle:hover { background: var(--px-surface-hover); color: var(--px-text); }

.fc-card {
  width: 100%; max-width: 620px;
  background: var(--px-bg-elevated);
  border: 1px solid var(--px-border);
  border-radius: var(--px-radius-lg);
  box-shadow: var(--px-shadow-md), var(--px-edge-light);
  padding: var(--px-space-6) var(--px-space-6);
}
.fc-card--q { animation: fc-card-in var(--px-dur-base) var(--px-ease-out); }
.fc-card--a { margin-top: var(--px-space-2); animation: fc-reveal-in var(--px-dur-base) var(--px-ease-spring); }
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
  color: var(--px-text-faint); font-variant-numeric: tabular-nums;
  margin-bottom: var(--px-space-4);
}
.fc-card__body { font-size: var(--px-text-md); line-height: var(--px-leading-base); color: var(--px-text); }
.fc-card--q .fc-card__body { font-size: var(--px-text-xl); font-weight: 650; letter-spacing: -0.02em; line-height: 1.3; }
.fc-card__source { margin-top: var(--px-space-4); padding-top: var(--px-space-3); border-top: 1px solid var(--px-divider); font-size: var(--px-text-2xs); color: var(--px-text-faint); }
.fc-study__answer-host { width: 100%; max-width: 620px; }

/* Paper cards: a light card face independent of the app theme, like the
   PDF viewer's page. Content-surface hardcodes are deliberate here. */
.fc-study--paper .fc-card {
  background: #faf7f1;
  border-color: #e2dccf;
  box-shadow: 0 8px 24px rgba(0, 0, 0, 0.38);
}
.fc-study--paper .fc-card__body { color: #26221c; }
.fc-study--paper .fc-card__head, .fc-study--paper .fc-card__source { color: #99917f; }
.fc-study--paper .fc-card .px-markdown code { background: #efe9dd; }
.fc-study--paper .fc-card .px-markdown pre { background: #f2ede3; border-color: #e2dccf; }
.fc-study--paper .fc-card .px-markdown blockquote { border-left-color: #d5cdbc; color: #5b5442; }

.fc-study__controls { display: flex; gap: var(--px-space-1); margin-top: var(--px-space-6); justify-content: center; width: 100%; max-width: 620px; }

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

/* ── Dashboard widget ── */
.fc-widget-due { font-size: var(--px-text-base); line-height: var(--px-leading-base); padding: var(--px-space-1) 2px; color: var(--px-text-secondary); }
.fc-widget-due__big { font-size: var(--px-text-xl); font-weight: 700; letter-spacing: -0.02em; color: var(--px-text); font-variant-numeric: tabular-nums; }
.fc-widget-due .fc-btn { margin-top: var(--px-space-2); }
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
      { label: 'Study deck', icon: 'play', onSelect: () => void openFlashcards({ view: 'study', deckId: deck.id }) },
      { label: 'Browse cards', icon: 'layers', onSelect: () => void openFlashcards({ view: 'browse', deckId: deck.id }) },
      { label: 'Add cards with AI', icon: 'px-ai-mark', onSelect: () => void openFlashcards({ view: 'create', deckId: deck.id }) },
      { separator: true },
      { label: 'Rename', icon: 'pencil', onSelect: () => void _renameDeckFlow(deck) },
      { label: 'Delete deck', icon: 'trash', danger: true, onSelect: () => void _deleteDeckFlow(deck) },
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

async function _deleteDeckFlow(deck) {
  const total = deck.total ?? 0;
  const detail = total > 0
    ? `This permanently deletes the deck and its ${total} ${total === 1 ? 'card' : 'cards'}, including review history. This cannot be undone.`
    : 'This permanently deletes the deck. This cannot be undone.';
  let ok = false;
  if (_api.window.showConfirmModal) {
    ok = await _api.window.showConfirmModal({ message: `Delete "${deck.name}"?`, detail, confirmLabel: 'Delete deck', danger: true });
  } else {
    const pick = await _api.window.showWarningMessage(`Delete "${deck.name}"? ${detail}`, { title: 'Delete deck' });
    ok = pick?.title === 'Delete deck';
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
    if (state.disposed || state.route.view === 'study' || state.route.view === 'create' || state.route.view === 'import') return;
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
    ? _api.ui.createAiButton(actions, { label: 'Generate cards' })
    : el('button', 'fc-btn');
  if (!genBtn.parentElement) { genBtn.textContent = 'Generate cards'; actions.appendChild(genBtn); }
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
    info.appendChild(el('div', 'fc-deck-card__name', deck.name));
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
  studyBtn.innerHTML = `${icon('play', 12)}<span>Study this deck</span>`;
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
  saveCard.textContent = 'Add card';
  saveCard.addEventListener('click', () => {
    void (async () => {
      if (!frontIn.value.trim() || !backIn.value.trim()) {
        addErr.textContent = 'Both front and back are required.';
        addErr.style.display = '';
        return;
      }
      addErr.style.display = 'none';
      await fcCreateCard({
        deckId: deckRow.id,
        front: frontIn.value,
        back: backIn.value,
        tags: fcParseTags(tagsIn.value).join(','),
      });
      frontIn.value = ''; backIn.value = ''; tagsIn.value = '';
      frontIn.focus();
    })();
  });
  addRow.appendChild(saveCard);
  addForm.append(el('div', 'fc-label', 'New card'), frontIn, backIn, tagsIn, addErr, addRow);
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
    if (card.state !== 'new') {
      meta.appendChild(el('span', '', card.dueAt <= Date.now()
        ? 'due now'
        : `due ${new Date(card.dueAt).toLocaleDateString()}`));
      meta.appendChild(el('span', '', `ease ${card.ease.toFixed(2)}`));
      meta.appendChild(el('span', '', `${card.reps} reps`));
      if (card.lapses > 0) meta.appendChild(el('span', '', `${card.lapses} lapses`));
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
    back.textContent = 'Back to decks';
    back.addEventListener('click', () => setRoute({ view: 'decks' }));
    done.appendChild(back);
    main.appendChild(done);
    return;
  }

  const deckNames = new Map(
    (await db.all('SELECT id, name FROM fc_decks')).map((d) => [d.id, d.name]),
  );

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
          for await (const chunk of stream) {
            if (chunk.content) {
              text += chunk.content;
              aiMsg.textContent = text;
              log.scrollTop = log.scrollHeight;
            }
          }
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

  // Card theme: follow the app, or force a paper (light) card face like the
  // PDF viewer's page toggle. Persisted per machine.
  const CARD_THEME_KEY = 'flashcards.cardTheme';
  const applyCardTheme = () => {
    study.classList.toggle('fc-study--paper', localStorage.getItem(CARD_THEME_KEY) === 'paper');
  };
  applyCardTheme();

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
      statsBtn.textContent = 'View stats';
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

    const themeBtn = el('button', 'fc-theme-toggle');
    themeBtn.type = 'button';
    themeBtn.title = 'Toggle paper cards';
    const syncThemeIcon = () => {
      themeBtn.innerHTML = icon(localStorage.getItem(CARD_THEME_KEY) === 'paper' ? 'moon' : 'sun', 14);
    };
    syncThemeIcon();
    themeBtn.addEventListener('click', () => {
      localStorage.setItem(CARD_THEME_KEY, localStorage.getItem(CARD_THEME_KEY) === 'paper' ? 'app' : 'paper');
      applyCardTheme();
      syncThemeIcon();
      main.focus();
    });
    toolbar.appendChild(themeBtn);
    main.appendChild(toolbar);

    // ── The QUESTION card ──
    const qCard = el('div', 'fc-card fc-card--q');
    const qHead = el('div', 'fc-card__head');
    qHead.appendChild(el('span', 'fc-card__tag', deckNames.get(card.deckId) || 'Question'));
    qHead.appendChild(el('span', '', `${session.doneCount + 1} / ${session.total}`));
    qCard.appendChild(qHead);
    const qBody = el('div', 'fc-card__body fc-study__front');
    qBody.appendChild(renderCardBody(card.front));
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
      aCard.appendChild(aHead);
      const aBody = el('div', 'fc-card__body fc-study__back');
      aBody.appendChild(renderCardBody(card.back));
      aCard.appendChild(aBody);
      if (card.sourceLabel) aCard.appendChild(el('div', 'fc-card__source', card.sourceLabel));
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
        btn.appendChild(el('span', 'fc-grade__ivl', fcIntervalPreview(card, g.r, now)));
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
      main.appendChild(discussHost);
      main.appendChild(el('div', 'fc-study__keys', 'Space reveal · 1 Again · 2 Hard · 3 Good · 4 Easy'));
    };

    const grade = (rating) => {
      const msTaken = Date.now() - session.cardShownAt;
      void (async () => {
        const updated = await fcGradeCard(card, rating, msTaken);
        // Cards still in learning re-enter the back of the queue when they
        // come due within this session's horizon (10 min).
        if ((updated.state === 'learning' || updated.state === 'relearning')
            && updated.dueAt <= Date.now() + 10 * MIN) {
          session.queue.push(updated);
          session.total++;
        }
        session.doneCount++;
        session.index++;
        showCard();
      })();
    };

    controls.innerHTML = '';
    const revealBtn = el('button', 'fc-btn fc-btn--primary fc-study__reveal');
    revealBtn.textContent = 'Show answer';
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
      { value: '__new__', label: '+ New deck…' },
    ],
    selected: route.deckId ? String(route.deckId) : (decks[0] ? String(decks[0].id) : '__new__'),
    ariaLabel: 'Target deck',
  });
  viewDisposables.push(deckDropdown);
  deckRow.appendChild(deckHost);
  view.appendChild(deckRow);

  // ── Source material — default to in-workspace: drag a file/page, or pick. ──
  view.appendChild(el('div', 'fc-label', 'Source material'));
  const sourceState = { text: '', label: '', uri: '' };
  const srcStatus = el('div', 'fc-hint fc-src-status', 'Drag a file or canvas page here, pick one below, or paste text.');

  const applyLoaded = (loaded) => {
    if (!loaded) return;
    sourceState.text = loaded.text;
    sourceState.label = loaded.label;
    sourceState.uri = loaded.uri;
    pasteIn.value = '';
    srcStatus.textContent = `Loaded ${loaded.label} (${loaded.text.length.toLocaleString()} chars).`;
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
  srcRow.appendChild(srcBtn('Canvas page', 'file-text', async () => {
    const pageId = await fcPickCanvasPage();
    return pageId ? fcReadCanvasPage(pageId) : null;
  }));
  srcRow.appendChild(srcBtn('Workspace file', 'file', () => fcPickWorkspaceFile()));
  srcRow.appendChild(srcBtn('Browse device…', 'hard-drive', () => fcReadPdf()));
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
  countIn.min = '1'; countIn.max = '50'; countIn.value = '15';
  countIn.style.width = '70px';
  optRow.appendChild(el('span', 'fc-hint', 'Up to'));
  optRow.appendChild(countIn);
  optRow.appendChild(el('span', 'fc-hint', 'cards. Focus (optional):'));
  const focusIn = el('input', 'fc-input');
  focusIn.placeholder = 'e.g. formulas only';
  focusIn.style.flex = '1';
  optRow.appendChild(focusIn);
  view.appendChild(optRow);

  const err = el('div', 'fc-error');
  err.style.display = 'none';
  view.appendChild(err);

  const genRow = el('div', 'fc-row');
  genRow.style.marginTop = '10px';
  const genBtn = _api.ui.createAiButton
    ? _api.ui.createAiButton(genRow, { label: 'Generate cards' })
    : el('button', 'fc-btn fc-btn--primary');
  if (!genBtn.parentElement) { genBtn.textContent = 'Generate cards'; genRow.appendChild(genBtn); }
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
        const cards = await fcGenerateCards(text, {
          count: parseInt(countIn.value, 10) || 15,
          focus: focusIn.value.trim(),
        });
        renderReview(cards);
      } catch (e2) {
        err.textContent = e2.message;
        err.style.display = '';
      } finally {
        genBtn.disabled = false;
        setGenLabel('Generate cards');
      }
    })();
  });

  const renderReview = (cards) => {
    reviewHost.innerHTML = '';
    reviewHost.appendChild(el('div', 'fc-label', `Review ${cards.length} generated cards`));
    reviewHost.appendChild(el('div', 'fc-hint',
      'Edit anything inline; drop cards you do not want. Nothing is saved until you import.'));

    const rows = [];
    for (const c of cards) {
      const row = el('div', 'fc-genrow');
      const fields = el('div', 'fc-genrow__fields');
      const front = el('textarea', 'fc-textarea');
      front.rows = 2; front.value = c.front;
      const back = el('textarea', 'fc-textarea');
      back.rows = 2; back.value = c.back;
      fields.append(front, back);
      row.appendChild(fields);
      const dropBtn = el('button', 'fc-btn fc-btn--danger');
      dropBtn.textContent = 'Drop';
      const entry = { row, front, back, tags: c.tags || '', dropped: false };
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
    importBtn.textContent = 'Import cards';
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
  view.appendChild(el('div', 'fc-label', 'Deck file'));
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
  pickBtn.innerHTML = `${icon('hard-drive', 12)}<span>Browse device…</span>`;
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
  pasteBtn.textContent = 'Preview pasted rows';
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
        items.push({ value: '__keep__', label: `Keep the file's decks (${groups.length})` });
      }
      items.push({ value: '__new__', label: '+ New deck…' });
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
      goBtn.textContent = `Import ${total.toLocaleString()} cards`;
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
            goBtn.textContent = remaining > 0 ? `Import ${remaining.toLocaleString()} cards` : 'Import';
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
        return JSON.stringify(s);
      },
      createWidget: (container, ctx) => {
        injectStyles();
        const root = el('div', 'fc-widget-due');
        container.appendChild(root);
        const paint = (raw) => {
          let s = { due: 0, fresh: 0, total: 0 };
          try { s = JSON.parse(raw || '{}'); } catch { /* keep zeros */ }
          root.innerHTML = '';
          const big = el('div', 'fc-widget-due__big', String(s.due || 0));
          root.appendChild(big);
          root.appendChild(el('div', '', `cards due · ${s.fresh || 0} new waiting`));
          const btn = el('button', 'fc-btn fc-btn--primary');
          btn.textContent = 'Study now';
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
      + '"front" (question) and "back" (answer). Use for "make flashcards from this" requests.',
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
  const NEW_DECK = '+ New deck…';
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

  const sourceLabel = source?.fileName
    ? `${source.fileName}${source.pageNumber ? ` p.${source.pageNumber}` : ''}`
    : 'Selection';

  try {
    const cards = await fcGenerateCards(text, { count: 3 });
    for (const c of cards) {
      await fcCreateCard({
        deckId,
        front: c.front,
        back: c.back,
        tags: c.tags,
        sourceUri: source?.filePath || '',
        sourceLabel,
      });
    }
    const deckName = pick.label === NEW_DECK ? 'the new deck' : pick.label;
    const review = await _api.window.showInformationMessage(
      `Added ${cards.length} ${cards.length === 1 ? 'card' : 'cards'} to ${deckName}.`,
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
        label: 'Create flashcard',
        icon: 'px-flashcards',
        execute: async (payload) => fcCaptureSelection(payload.selectedText, payload.source),
      }));
    })
    .catch(() => {
      if (attempt < 5) setTimeout(() => registerSelectionAction(context, attempt + 1), 2000);
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
    cards.push({ front, back, tags: [] });
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
  fcIntervalPreview,
  fcBuildQueue,
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
};
