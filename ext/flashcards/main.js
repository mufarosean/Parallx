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
function fcExtractCardsJson(text) {
  if (typeof text !== 'string' || !text.trim()) return { cards: [], error: 'Empty response.' };
  let t = text.trim();
  // Strip markdown fences.
  t = t.replace(/```(?:json)?/gi, '');
  const start = t.indexOf('[');
  if (start === -1) return { cards: [], error: 'No JSON array in response.' };
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
  if (end === -1) return { cards: [], error: 'Unterminated JSON array.' };
  let parsed;
  try {
    parsed = JSON.parse(t.slice(start, end + 1));
  } catch (err) {
    return { cards: [], error: `JSON parse failed: ${err.message}` };
  }
  if (!Array.isArray(parsed)) return { cards: [], error: 'Response is not an array.' };
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
  if (cards.length === 0) return { cards: [], error: 'No usable cards in response.' };
  return { cards, error: null };
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
  '- Formulas: keep LaTeX/notation exactly as written in the material.',
  'Output ONLY a JSON array, no prose, in this exact shape:',
  '[{"front": "...", "back": "...", "tags": ["topic"]}]',
].join('\n');

const FC_SOURCE_CHAR_LIMIT = 24000;

async function fcGenerateCards(sourceText, { count = 15, focus = '' } = {}) {
  const modelId = await fcPickModel();
  if (!modelId) throw new Error('No language model available. Configure a model in AI settings.');
  const clipped = sourceText.length > FC_SOURCE_CHAR_LIMIT
    ? sourceText.slice(0, FC_SOURCE_CHAR_LIMIT) + '\n\n[...material truncated...]'
    : sourceText;
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
  ], { temperature: 0.2 });
  for await (const chunk of stream) {
    if (chunk.content) output += chunk.content;
  }
  const { cards, error } = fcExtractCardsJson(output);
  if (error && cards.length === 0) throw new Error(error);
  return cards;
}

/** Stream a discussion turn about a card. Returns the async iterable. */
async function fcDiscussStream(card, history, question) {
  const modelId = await fcPickModel();
  if (!modelId) throw new Error('No language model available.');
  const system = [
    'You are a study tutor discussing ONE flashcard with the learner.',
    'Be concise and concrete. Explain, give mnemonic hooks, test understanding.',
    'Never just restate the back of the card — add insight.',
    `CARD FRONT: ${card.front}`,
    `CARD BACK: ${card.back}`,
    card.sourceLabel ? `SOURCE: ${card.sourceLabel}` : '',
  ].filter(Boolean).join('\n');
  const messages = [
    { role: 'system', content: system },
    ...history,
    { role: 'user', content: question },
  ];
  return _api.lm.sendChatRequest(modelId, messages, { temperature: 0.4 });
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
  return {
    text: result.markdown,
    label: `Canvas: ${result.title || 'Untitled'}`,
    uri: `parallx://canvas/page/${pageId}`,
  };
}

async function fcReadPdf() {
  const electron = electronBridge();
  if (!electron?.dialog?.openFile || !electron?.document?.extractText) {
    throw new Error('File access unavailable in this build.');
  }
  const picked = await electron.dialog.openFile({
    filters: [{ name: 'Documents', extensions: ['pdf', 'docx', 'epub', 'xlsx'] }],
  });
  if (!picked || picked.length === 0) return null;
  const filePath = picked[0];
  const result = await electron.document.extractText(filePath);
  if (result?.error) throw new Error(result.error.message || 'Extraction failed.');
  if (!result?.text?.trim()) throw new Error('No text found in that document.');
  const name = filePath.split(/[\\/]/).pop();
  return { text: result.text, label: `Document: ${name}`, uri: filePath };
}

async function fcReadPhoto() {
  const electron = electronBridge();
  if (!electron?.dialog?.openFile) throw new Error('File access unavailable in this build.');
  if (!electron?.docling) {
    throw new Error('Photo OCR needs the Docling bridge, which is unavailable in this build.');
  }
  const picked = await electron.dialog.openFile({
    filters: [{ name: 'Images', extensions: ['png', 'jpg', 'jpeg', 'webp', 'bmp', 'tiff'] }],
  });
  if (!picked || picked.length === 0) return null;
  const filePath = picked[0];

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
.fc-sidebar { display: flex; flex-direction: column; height: 100%; font-size: 13px; }
.fc-sidebar__actions { display: flex; gap: 6px; padding: 8px; flex-wrap: wrap; }
.fc-sidebar__list { flex: 1; overflow-y: auto; padding: 0 4px 8px; }
.fc-deck-row {
  display: flex; align-items: center; gap: 8px; width: 100%;
  height: 28px; padding: 0 8px; border: 0; border-radius: 4px;
  background: transparent; color: var(--vscode-foreground, #ccc);
  font: inherit; font-size: 12.5px; cursor: pointer; text-align: left;
  transition: background var(--px-dur-fast) var(--px-ease);
}
.fc-deck-row:hover { background: color-mix(in srgb, var(--vscode-foreground, #ccc) 10%, transparent); }
.fc-deck-row__name { flex: 1; min-width: 0; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.fc-deck-row__due {
  flex: 0 0 auto; min-width: 18px; text-align: center;
  font-size: 10.5px; font-weight: 600; border-radius: 8px; padding: 1px 6px;
  background: color-mix(in srgb, var(--vscode-button-background, #0e639c) 75%, transparent);
  color: var(--vscode-button-foreground, #fff);
}
.fc-deck-row__new {
  flex: 0 0 auto; font-size: 10.5px; font-weight: 600; border-radius: 8px; padding: 1px 6px;
  background: color-mix(in srgb, var(--vscode-foreground, #ccc) 16%, transparent);
  color: color-mix(in srgb, var(--vscode-foreground, #ccc) 80%, transparent);
}
.fc-sidebar__empty { padding: 16px 12px; font-size: 12px; color: color-mix(in srgb, var(--vscode-foreground, #ccc) 55%, transparent); }

.fc-btn {
  display: inline-flex; align-items: center; gap: 6px;
  height: 26px; padding: 0 11px;
  border: 1px solid color-mix(in srgb, var(--vscode-foreground, #ccc) 18%, transparent);
  border-radius: 5px; background: transparent;
  color: color-mix(in srgb, var(--vscode-foreground, #ccc) 82%, transparent);
  font: inherit; font-size: 12px; font-weight: 500; cursor: pointer;
  transition: background var(--px-dur-fast) var(--px-ease), color var(--px-dur-fast) var(--px-ease);
}
.fc-btn:hover { background: color-mix(in srgb, var(--vscode-foreground, #ccc) 10%, transparent); color: var(--vscode-foreground, #eee); }
.fc-btn:disabled { opacity: 0.5; cursor: default; }
.fc-btn--primary { background: var(--vscode-button-background, #0e639c); border-color: transparent; color: var(--vscode-button-foreground, #fff); }
.fc-btn--primary:hover { background: color-mix(in srgb, var(--vscode-button-background, #0e639c) 88%, white); color: var(--vscode-button-foreground, #fff); }
.fc-btn--danger:hover { background: color-mix(in srgb, var(--vscode-errorForeground, #f48771) 16%, transparent); color: var(--vscode-errorForeground, #f48771); border-color: color-mix(in srgb, var(--vscode-errorForeground, #f48771) 40%, transparent); }

.fc-pane { display: flex; flex-direction: column; height: 100%; overflow: hidden; }
.fc-pane__header {
  display: flex; align-items: center; gap: 10px;
  padding: 10px 18px; flex: 0 0 auto;
  border-bottom: 1px solid color-mix(in srgb, var(--vscode-foreground, #ccc) 10%, transparent);
}
.fc-pane__tabs { display: flex; gap: 2px; }
.fc-pane__tab {
  display: inline-flex; align-items: center; gap: 6px; height: 28px; padding: 0 12px;
  border: 0; border-radius: 5px; background: transparent;
  color: color-mix(in srgb, var(--vscode-foreground, #ccc) 60%, transparent);
  font: inherit; font-size: 12.5px; font-weight: 500; cursor: pointer;
  transition: background var(--px-dur-fast) var(--px-ease), color var(--px-dur-fast) var(--px-ease);
}
.fc-pane__tab:hover { color: var(--vscode-foreground, #eee); }
.fc-pane__tab--active { background: color-mix(in srgb, var(--vscode-foreground, #ccc) 12%, transparent); color: var(--vscode-foreground, #eee); }
.fc-pane__spacer { flex: 1; }
.fc-pane__body { flex: 1; overflow-y: auto; }

.fc-view { max-width: 860px; margin: 0 auto; padding: 20px 24px 48px; }
.fc-view__intro { font-size: 12.5px; line-height: 1.55; color: color-mix(in srgb, var(--vscode-foreground, #ccc) 60%, transparent); margin-bottom: 14px; }
.fc-empty { padding: 40px 16px; text-align: center; font-size: 13px; color: color-mix(in srgb, var(--vscode-foreground, #ccc) 55%, transparent); }

.fc-deck-card {
  display: flex; align-items: center; gap: 12px;
  border: 1px solid color-mix(in srgb, var(--vscode-foreground, #ccc) 12%, transparent);
  border-radius: 8px; padding: 12px 16px; margin-bottom: 10px;
  transition: border-color var(--px-dur-fast) var(--px-ease);
}
.fc-deck-card:hover { border-color: color-mix(in srgb, var(--vscode-foreground, #ccc) 24%, transparent); }
.fc-deck-card__info { flex: 1; min-width: 0; cursor: pointer; }
.fc-deck-card__name { font-size: 13.5px; font-weight: 600; color: var(--vscode-foreground, #eee); }
.fc-deck-card__meta { font-size: 11.5px; color: color-mix(in srgb, var(--vscode-foreground, #ccc) 52%, transparent); margin-top: 2px; }
.fc-deck-card__actions { display: flex; gap: 6px; flex: 0 0 auto; }

.fc-form { display: flex; flex-direction: column; gap: 6px; }
.fc-label { font-size: 11px; font-weight: 600; text-transform: uppercase; letter-spacing: 0.05em; color: color-mix(in srgb, var(--vscode-foreground, #ccc) 48%, transparent); margin-top: 10px; }
.fc-input, .fc-textarea {
  width: 100%; box-sizing: border-box; padding: 8px 10px;
  border: 1px solid color-mix(in srgb, var(--vscode-foreground, #ccc) 16%, transparent);
  border-radius: 5px;
  background: color-mix(in srgb, var(--vscode-editor-background, #1e1e1e) 82%, white);
  color: var(--vscode-foreground, #ddd); font: inherit; font-size: 12.5px;
}
.fc-textarea { resize: vertical; min-height: 64px; line-height: 1.5; }
.fc-input:focus, .fc-textarea:focus { outline: none; border-color: var(--vscode-focusBorder, #5b9bd5); }
.fc-row { display: flex; gap: 8px; align-items: center; flex-wrap: wrap; }
.fc-error { font-size: 12px; color: var(--vscode-errorForeground, #f48771); padding: 4px 0; }
.fc-hint { font-size: 11.5px; color: color-mix(in srgb, var(--vscode-foreground, #ccc) 45%, transparent); }

.fc-cardrow {
  border: 1px solid color-mix(in srgb, var(--vscode-foreground, #ccc) 10%, transparent);
  border-radius: 6px; padding: 10px 12px; margin-bottom: 8px;
}
.fc-cardrow--suspended { opacity: 0.55; }
.fc-cardrow__front { font-size: 13px; font-weight: 600; color: var(--vscode-foreground, #eee); }
.fc-cardrow__back { font-size: 12.5px; margin-top: 4px; color: color-mix(in srgb, var(--vscode-foreground, #ccc) 78%, transparent); white-space: pre-wrap; }
.fc-cardrow__meta { display: flex; gap: 12px; margin-top: 6px; font-size: 10.5px; color: color-mix(in srgb, var(--vscode-foreground, #ccc) 45%, transparent); }
.fc-cardrow__actions { display: flex; gap: 6px; margin-top: 8px; }
.fc-state {
  display: inline-block; font-size: 10px; font-weight: 600; text-transform: uppercase;
  letter-spacing: 0.05em; border-radius: 3px; padding: 1px 6px;
}
.fc-state--new { background: color-mix(in srgb, #3f51b5 30%, transparent); color: #aab4f5; }
.fc-state--learning, .fc-state--relearning { background: color-mix(in srgb, #f4511e 26%, transparent); color: #ffab91; }
.fc-state--review { background: color-mix(in srgb, #0b8043 28%, transparent); color: #87d8a5; }

/* Study */
.fc-study { display: flex; height: 100%; }
.fc-study__main { flex: 1; min-width: 0; display: flex; flex-direction: column; align-items: center; padding: 28px 32px; overflow-y: auto; }
.fc-study__progress { width: 100%; max-width: 640px; height: 3px; border-radius: 2px; background: color-mix(in srgb, var(--vscode-foreground, #ccc) 12%, transparent); margin-bottom: 24px; overflow: hidden; }
.fc-study__progress-fill { height: 100%; background: var(--vscode-button-background, #0e639c); transition: width var(--px-dur-base) var(--px-ease); }
.fc-study__card {
  width: 100%; max-width: 640px;
  border: 1px solid color-mix(in srgb, var(--vscode-foreground, #ccc) 14%, transparent);
  border-radius: 10px; padding: 30px 34px;
  background: color-mix(in srgb, var(--vscode-editor-background, #1e1e1e) 93%, white);
}
.fc-study__deckline { display: flex; justify-content: space-between; align-items: center; font-size: 11px; color: color-mix(in srgb, var(--vscode-foreground, #ccc) 45%, transparent); margin-bottom: 14px; }
.fc-study__front { font-size: 17px; font-weight: 600; line-height: 1.5; color: var(--vscode-foreground, #eee); white-space: pre-wrap; }
.fc-study__divider { border: 0; border-top: 1px solid color-mix(in srgb, var(--vscode-foreground, #ccc) 12%, transparent); margin: 18px 0; }
.fc-study__back { font-size: 14.5px; line-height: 1.6; color: color-mix(in srgb, var(--vscode-foreground, #ccc) 88%, transparent); white-space: pre-wrap; }
.fc-study__source { margin-top: 14px; font-size: 11px; color: color-mix(in srgb, var(--vscode-foreground, #ccc) 42%, transparent); }
.fc-study__controls { display: flex; gap: 8px; margin-top: 22px; justify-content: center; width: 100%; max-width: 640px; }
.fc-grade {
  flex: 1; display: flex; flex-direction: column; align-items: center; gap: 2px;
  padding: 9px 0; border-radius: 6px; border: 1px solid transparent;
  font: inherit; font-size: 12.5px; font-weight: 600; cursor: pointer;
  transition: filter var(--px-dur-fast) var(--px-ease), background var(--px-dur-fast) var(--px-ease);
}
.fc-grade span { font-size: 10px; font-weight: 500; opacity: 0.8; }
.fc-grade:hover { filter: brightness(1.15); }
.fc-grade--again { background: color-mix(in srgb, #d50000 24%, transparent); color: #ff8a80; }
.fc-grade--hard  { background: color-mix(in srgb, #f4511e 22%, transparent); color: #ffab91; }
.fc-grade--good  { background: color-mix(in srgb, #0b8043 24%, transparent); color: #87d8a5; }
.fc-grade--easy  { background: color-mix(in srgb, #039be5 22%, transparent); color: #81d4fa; }
.fc-study__reveal { margin-top: 22px; }
.fc-study__keys { margin-top: 14px; font-size: 10.5px; color: color-mix(in srgb, var(--vscode-foreground, #ccc) 38%, transparent); }
.fc-study__done { text-align: center; padding: 60px 20px; }
.fc-study__done-title { font-size: 18px; font-weight: 650; color: var(--vscode-foreground, #eee); margin-bottom: 8px; }
.fc-study__done-sub { font-size: 13px; color: color-mix(in srgb, var(--vscode-foreground, #ccc) 60%, transparent); }

/* Discuss panel */
.fc-discuss {
  flex: 0 0 320px; display: flex; flex-direction: column;
  border-left: 1px solid color-mix(in srgb, var(--vscode-foreground, #ccc) 10%, transparent);
}
.fc-discuss__head { padding: 10px 14px; font-size: 12px; font-weight: 600; color: color-mix(in srgb, var(--vscode-foreground, #ccc) 70%, transparent); border-bottom: 1px solid color-mix(in srgb, var(--vscode-foreground, #ccc) 8%, transparent); }
.fc-discuss__log { flex: 1; overflow-y: auto; padding: 10px 14px; display: flex; flex-direction: column; gap: 10px; }
.fc-discuss__msg { font-size: 12.5px; line-height: 1.55; white-space: pre-wrap; overflow-wrap: anywhere; }
.fc-discuss__msg--user { color: var(--vscode-foreground, #eee); font-weight: 600; }
.fc-discuss__msg--ai { color: color-mix(in srgb, var(--vscode-foreground, #ccc) 82%, transparent); }
.fc-discuss__input-row { display: flex; gap: 6px; padding: 10px 14px; border-top: 1px solid color-mix(in srgb, var(--vscode-foreground, #ccc) 8%, transparent); }
.fc-discuss__input { flex: 1; }
.fc-discuss__empty { font-size: 11.5px; color: color-mix(in srgb, var(--vscode-foreground, #ccc) 42%, transparent); padding: 12px 14px; }

/* Stats */
.fc-stats-grid { display: grid; grid-template-columns: repeat(auto-fit, minmax(150px, 1fr)); gap: 12px; margin-bottom: 22px; }
.fc-stat {
  border: 1px solid color-mix(in srgb, var(--vscode-foreground, #ccc) 12%, transparent);
  border-radius: 8px; padding: 14px 16px;
}
.fc-stat__value { font-size: 22px; font-weight: 700; color: var(--vscode-foreground, #eee); font-variant-numeric: tabular-nums; }
.fc-stat__label { font-size: 11px; font-weight: 600; text-transform: uppercase; letter-spacing: 0.05em; color: color-mix(in srgb, var(--vscode-foreground, #ccc) 46%, transparent); margin-top: 2px; }
.fc-chart { display: flex; align-items: flex-end; gap: 3px; height: 90px; margin: 8px 0 4px; }
.fc-chart__bar { flex: 1; min-width: 3px; border-radius: 2px 2px 0 0; background: color-mix(in srgb, var(--vscode-button-background, #0e639c) 78%, transparent); }
.fc-chart__bar--empty { background: color-mix(in srgb, var(--vscode-foreground, #ccc) 8%, transparent); height: 3px !important; }
.fc-chart-caption { font-size: 10.5px; color: color-mix(in srgb, var(--vscode-foreground, #ccc) 40%, transparent); }

/* Generate review list */
.fc-genrow { display: flex; gap: 8px; align-items: flex-start; border: 1px solid color-mix(in srgb, var(--vscode-foreground, #ccc) 10%, transparent); border-radius: 6px; padding: 8px 10px; margin-bottom: 8px; }
.fc-genrow__fields { flex: 1; display: flex; flex-direction: column; gap: 6px; }
.fc-genrow--dropped { opacity: 0.4; }
.fc-widget-due { font-size: 13px; line-height: 1.6; padding: 4px 2px; }
.fc-widget-due__big { font-size: 26px; font-weight: 700; font-variant-numeric: tabular-nums; }
`;
  document.head.appendChild(style);
}

// ═══════════════════════════════════════════════════════════════════════════════
// SECTION 8: SIDEBAR VIEW
// ═══════════════════════════════════════════════════════════════════════════════

function createSidebarView(container) {
  injectStyles();
  const root = el('div', 'fc-sidebar');

  const actions = el('div', 'fc-sidebar__actions');
  const studyBtn = el('button', 'fc-btn fc-btn--primary');
  studyBtn.innerHTML = `${icon('play', 12)}<span>Study</span>`;
  studyBtn.addEventListener('click', () => void openFlashcards({ view: 'study' }));
  actions.appendChild(studyBtn);

  const newBtn = el('button', 'fc-btn');
  newBtn.innerHTML = `${icon('plus', 12)}<span>Deck</span>`;
  newBtn.addEventListener('click', () => void _cmdNewDeck());
  actions.appendChild(newBtn);

  const genBtn = el('button', 'fc-btn');
  genBtn.innerHTML = `${icon('sparkles', 12)}<span>Generate</span>`;
  genBtn.addEventListener('click', () => void openFlashcards({ view: 'create' }));
  actions.appendChild(genBtn);

  root.appendChild(actions);

  const list = el('div', 'fc-sidebar__list');
  root.appendChild(list);

  let disposed = false;
  const refresh = async () => {
    if (disposed) return;
    let decks = [];
    try { decks = await fcListDecks(); } catch { /* db not ready */ }
    if (disposed) return;
    list.innerHTML = '';
    if (decks.length === 0) {
      const empty = el('div', 'fc-sidebar__empty');
      empty.textContent = 'No decks yet. Create one, or generate cards from a canvas page or PDF.';
      list.appendChild(empty);
      return;
    }
    for (const deck of decks) {
      const row = el('button', 'fc-deck-row');
      row.type = 'button';
      const name = el('span', 'fc-deck-row__name', deck.name);
      row.appendChild(name);
      if (deck.newCount > 0) row.appendChild(el('span', 'fc-deck-row__new', String(deck.newCount)));
      if (deck.dueCount > 0) row.appendChild(el('span', 'fc-deck-row__due', String(deck.dueCount)));
      row.addEventListener('click', () => void openFlashcards({ view: 'browse', deckId: deck.id }));
      list.appendChild(row);
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

// ═══════════════════════════════════════════════════════════════════════════════
// SECTION 9: EDITOR PANE — router (decks / browse / study / stats / create)
// ═══════════════════════════════════════════════════════════════════════════════

const TAB_DEFS = [
  { view: 'decks', label: 'Decks', iconName: 'layers' },
  { view: 'study', label: 'Study', iconName: 'play' },
  { view: 'create', label: 'Create', iconName: 'sparkles' },
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
    // re-rendering mid-review would eat the current card.
    if (state.disposed || state.route.view === 'study' || state.route.view === 'create') return;
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
  const intro = el('div', 'fc-view__intro');
  intro.textContent =
    'Spaced-repetition flashcards. Create cards by hand or generate them with AI '
    + 'from canvas pages, PDFs, and photos — then study daily; the scheduler '
    + 'resurfaces each card right before you would forget it.';
  view.appendChild(intro);

  const actions = el('div', 'fc-row');
  const newDeckBtn = el('button', 'fc-btn fc-btn--primary');
  newDeckBtn.innerHTML = `${icon('plus', 12)}<span>New deck</span>`;
  newDeckBtn.addEventListener('click', () => void _cmdNewDeck());
  actions.appendChild(newDeckBtn);
  const genBtn = el('button', 'fc-btn');
  genBtn.innerHTML = `${icon('sparkles', 12)}<span>Generate cards</span>`;
  genBtn.addEventListener('click', () => setRoute({ view: 'create' }));
  actions.appendChild(genBtn);
  view.appendChild(actions);
  view.appendChild(el('div', 'fc-label', 'Decks'));

  const decks = await fcListDecks();
  if (decks.length === 0) {
    view.appendChild(el('div', 'fc-empty', 'No decks yet — create one to get started.'));
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

async function renderBrowse(body, route, setRoute) {
  const deckRow = await db.get('SELECT * FROM fc_decks WHERE id = ?', [route.deckId]);
  if (!deckRow) { setRoute({ view: 'decks' }); return; }
  const view = el('div', 'fc-view');

  const head = el('div', 'fc-row');
  const backBtn = el('button', 'fc-btn');
  backBtn.innerHTML = `${icon('arrow-left', 12)}<span>Decks</span>`;
  backBtn.addEventListener('click', () => setRoute({ view: 'decks' }));
  head.appendChild(backBtn);
  const title = el('div', 'fc-deck-card__name', deckRow.name);
  title.style.fontSize = '15px';
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
  frontIn.placeholder = 'Front — the question';
  frontIn.rows = 2;
  const backIn = el('textarea', 'fc-textarea');
  backIn.placeholder = 'Back — the answer';
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
    row.appendChild(el('div', 'fc-cardrow__front', card.front));
    row.appendChild(el('div', 'fc-cardrow__back', card.back));
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
      void (async () => {
        const front = await _api.window.showInputBox({ prompt: 'Front', value: card.front });
        if (front === undefined) return;
        const back = await _api.window.showInputBox({ prompt: 'Back', value: card.back });
        if (back === undefined) return;
        await fcUpdateCard(card.id, { front: front.trim() || card.front, back: back.trim() || card.back });
        void renderList();
      })();
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
    const done = el('div', 'fc-study__done');
    done.appendChild(el('div', 'fc-study__done-title', 'All caught up'));
    done.appendChild(el('div', 'fc-study__done-sub',
      cards.length === 0
        ? 'No cards yet — generate some from a canvas page or PDF.'
        : 'Nothing due right now. Come back later, or add new cards.'));
    const back = el('button', 'fc-btn');
    back.style.marginTop = '18px';
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
      'Ask anything about this card — why the answer holds, edge cases, a mnemonic…'));
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

  const showCard = () => {
    closeDiscuss();
    main.innerHTML = '';
    session.revealed = false;
    session.cardShownAt = Date.now();

    if (session.index >= session.queue.length) {
      const done = el('div', 'fc-study__done');
      done.appendChild(el('div', 'fc-study__done-title', 'Session complete'));
      done.appendChild(el('div', 'fc-study__done-sub', `${session.doneCount} cards reviewed. Nice work.`));
      const statsBtn = el('button', 'fc-btn');
      statsBtn.style.marginTop = '18px';
      statsBtn.textContent = 'View stats';
      statsBtn.addEventListener('click', () => setRoute({ view: 'stats' }));
      done.appendChild(statsBtn);
      main.appendChild(done);
      return;
    }

    const card = session.queue[session.index];

    const progress = el('div', 'fc-study__progress');
    const fill = el('div', 'fc-study__progress-fill');
    fill.style.width = `${Math.round((session.doneCount / session.total) * 100)}%`;
    progress.appendChild(fill);
    main.appendChild(progress);

    const cardEl = el('div', 'fc-study__card');
    const deckLine = el('div', 'fc-study__deckline');
    deckLine.appendChild(el('span', '', deckNames.get(card.deckId) || ''));
    deckLine.appendChild(el('span', '', `${session.doneCount + 1} / ${session.total}`));
    cardEl.appendChild(deckLine);
    cardEl.appendChild(el('div', 'fc-study__front', card.front));

    const backHost = el('div');
    cardEl.appendChild(backHost);
    if (card.sourceLabel) cardEl.appendChild(el('div', 'fc-study__source', card.sourceLabel));
    main.appendChild(cardEl);

    const controls = el('div', 'fc-study__controls');
    main.appendChild(controls);

    const reveal = () => {
      if (session.revealed) return;
      session.revealed = true;
      backHost.appendChild(el('hr', 'fc-study__divider'));
      backHost.appendChild(el('div', 'fc-study__back', card.back));
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
        btn.innerHTML = `${g.label}<span>${fcIntervalPreview(card, g.r, now)}</span>`;
        btn.addEventListener('click', () => grade(g.r));
        controls.appendChild(btn);
      }
      const discussBtn = el('button', 'fc-btn');
      discussBtn.style.marginTop = '14px';
      discussBtn.innerHTML = `${icon('message-circle', 12)}<span>Discuss with AI</span>`;
      discussBtn.addEventListener('click', () => openDiscuss(card));
      main.appendChild(discussBtn);
      main.appendChild(el('div', 'fc-study__keys', 'Space — reveal · 1 Again · 2 Hard · 3 Good · 4 Easy'));
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
    main.appendChild(el('div', 'fc-study__keys', 'Space — show answer'));

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
  view.appendChild(el('div', 'fc-view__intro',
    'Generate cards with AI from a canvas page, a PDF/document, a photo (OCR), '
    + 'or pasted text — then review every card before anything is saved.'));

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

  // Source buttons.
  view.appendChild(el('div', 'fc-label', 'Source material'));
  const srcRow = el('div', 'fc-row');
  const sourceState = { text: '', label: '', uri: '' };
  const srcStatus = el('div', 'fc-hint', 'No source loaded — pick one, or paste text below.');

  const srcBtn = (label, iconName, loader) => {
    const b = el('button', 'fc-btn');
    b.innerHTML = `${icon(iconName, 12)}<span>${label}</span>`;
    b.addEventListener('click', () => {
      void (async () => {
        try {
          b.disabled = true;
          const loaded = await loader();
          if (loaded) {
            sourceState.text = loaded.text;
            sourceState.label = loaded.label;
            sourceState.uri = loaded.uri;
            pasteIn.value = '';
            srcStatus.textContent = `Loaded ${loaded.label} (${loaded.text.length.toLocaleString()} chars).`;
          }
        } catch (err) {
          srcStatus.textContent = `Failed: ${err.message}`;
        } finally {
          b.disabled = false;
        }
      })();
    });
    return b;
  };

  srcRow.appendChild(srcBtn('Canvas page', 'file-text', async () => {
    const pageId = await fcPickCanvasPage();
    return pageId ? fcReadCanvasPage(pageId) : null;
  }));
  srcRow.appendChild(srcBtn('PDF / document', 'file', () => fcReadPdf()));
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
  const genBtn = el('button', 'fc-btn fc-btn--primary');
  genBtn.innerHTML = `${icon('sparkles', 12)}<span>Generate cards</span>`;
  genRow.appendChild(genBtn);
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
      genBtn.innerHTML = `${icon('sparkles', 12)}<span>Generating…</span>`;
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
        genBtn.innerHTML = `${icon('sparkles', 12)}<span>Generate cards</span>`;
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

  view.appendChild(el('div', 'fc-label', 'Reviews — last 30 days'));
  const chart = el('div', 'fc-chart');
  const max = Math.max(1, ...stats.last30.map((d) => d.count));
  for (const day of stats.last30) {
    const bar = el('div', 'fc-chart__bar');
    if (day.count === 0) bar.classList.add('fc-chart__bar--empty');
    else bar.style.height = `${Math.max(6, Math.round((day.count / max) * 100))}%`;
    bar.title = `${new Date(day.day).toLocaleDateString()}: ${day.count} reviews`;
    chart.appendChild(bar);
  }
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
          btn.style.marginTop = '8px';
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
            `Cards — new: ${s.counts.new}, learning: ${s.counts.learning + s.counts.relearning}, reviewing: ${s.counts.review}, suspended: ${s.counts.suspended}, total: ${s.counts.total}`,
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
  const name = await _api.window.showInputBox({ prompt: 'New deck name', placeholder: 'e.g. Exam 7 — Reserving' });
  if (!name?.trim()) return;
  const deckId = await fcCreateDeck(name);
  await openFlashcards({ view: 'browse', deckId });
}

function registerCommands(context) {
  const cmds = [
    ['flashcards.open', () => openFlashcards({ view: 'decks' })],
    ['flashcards.study', () => openFlashcards({ view: 'study' })],
    ['flashcards.newDeck', () => _cmdNewDeck()],
    ['flashcards.newCard', () => openFlashcards({ view: 'decks' })],
    ['flashcards.generate', () => openFlashcards({ view: 'create' })],
    ['flashcards.stats', () => openFlashcards({ view: 'stats' })],
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
    console.error('[Flashcards] api.database unavailable — cannot activate.');
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
  FC_LEARNING_STEPS_MIN,
  FC_RELEARNING_STEPS_MIN,
  FC_MIN_EASE,
  AGAIN, HARD, GOOD, EASY,
  MIN, DAY,
};
