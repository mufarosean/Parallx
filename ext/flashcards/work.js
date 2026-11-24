// work.js — Flashcards' time and cards as work any tool can read.
//
// Time on cards is counted by the app's clock (api.work.createClock): while a
// card of a study session is showing and the person pressed a key, clicked,
// tapped or scrolled within the idle time; a stretch that ends idle is taken
// back. It is not the gap between showing a card and grading it: a card left
// up for an hour is not an hour. The seconds are kept by local day and card
// (fc_work_time, migration 009) with the card's tags and deck as they were,
// and reported through the core's work-provider point (api.work): one entry
// per day and set of groups, with the cards graded that day and how many of
// them were right (their last grade of the day Good or Easy). A card is in
// its deck and in each of its tags at once, so an entry names them all, tags
// first, and a reader counts it once. The mapping is pure and tested in
// tests/unit/flashcardsWork.test.ts.

import { fcProgressProvider, fcWithRegistry } from './progress.js';

/** Grades that count as right: Good (3) and Easy (4). */
const FC_RIGHT_FROM = 3;

/** A card's groups, the keys progress.js gives: each tag (as written, keyed in lower case), then its deck. */
export function fcWorkGroups(card, deckName) {
  const out = [];
  const seen = new Set();
  const tags = Array.isArray(card?.tags) ? card.tags : String(card?.tags || '').split(',');
  for (const raw of tags) {
    const tag = String(raw || '').trim();
    const key = tag.toLowerCase();
    if (!key || seen.has(key)) continue;
    seen.add(key);
    out.push({ group: `tag:${key}`, label: tag });
  }
  if (card?.deckId != null) out.push({ group: `deck:${card.deckId}`, label: String(deckName || '') });
  return out;
}

/** The rows of FC_WORK_SQL as the provider's entries: minutes from seconds, groups parsed; a row with nothing is left out. */
export function fcWorkEntries(rows) {
  const out = [];
  for (const r of rows || []) {
    const seconds = Math.max(0, Number(r.seconds) || 0);
    const items = Math.max(0, Number(r.items) || 0);
    if (!seconds && !items) continue;
    let groups = [];
    try { const g = JSON.parse(String(r.groups || '[]')); if (Array.isArray(g)) groups = g.filter((x) => x && typeof x === 'object').map((x) => ({ group: String(x.group || ''), label: String(x.label || '') })); } catch { groups = []; }
    out.push({ day: String(r.day), groups, minutes: seconds / 60, items, right: Math.min(items, Math.max(0, Number(r.was_right) || 0)) });
  }
  return out;
}

/** Each day's time and graded cards, by the set of groups the cards were in. */
export const FC_WORK_SQL = 'SELECT day, groups, SUM(seconds) AS seconds, SUM(reviewed) AS items, SUM(was_right) AS was_right FROM fc_work_time GROUP BY day, groups ORDER BY day, groups';

/**
 * What the reviews of some cards say for each day and card: was it graded,
 * and was its last grade of the day right. `reviews` are
 * { card_id, reviewed_at, rating }; `dayOf` turns a moment into its local day.
 * Returns Map('day\u0000cardId' → { reviewed: 1, right: 0 | 1 }).
 */
export function fcWorkGraded(reviews, dayOf) {
  const out = new Map();
  const last = new Map();
  for (const r of reviews || []) {
    const key = `${dayOf(Number(r.reviewed_at))}\u0000${Number(r.card_id)}`;
    const at = Number(r.reviewed_at) || 0;
    if (last.has(key) && last.get(key) > at) continue;
    last.set(key, at);
    out.set(key, { reviewed: 1, right: Number(r.rating) >= FC_RIGHT_FROM ? 1 : 0 });
  }
  return out;
}

const _workListeners = new Set();
const emitWork = () => { for (const fn of _workListeners) { try { fn(); } catch { /* a reader's own */ } } };

/** The provider: `all(sql)` reads Flashcards' database. */
export function fcWorkProvider({ all }) {
  return {
    id: 'flashcards.cards',
    displayName: 'Flashcards',
    kind: 'Cards',
    work: async () => fcWorkEntries(await all(FC_WORK_SQL)),
    onDidChange: (listener) => { _workListeners.add(listener); return { dispose: () => { _workListeners.delete(listener); } }; },
  };
}

/** Both of Flashcards' providers, for the tools that show progress and the tools that keep a record of work; they leave with the extension. */
export function fcRegisterProviders(api, context, { db, isLive, onData }) {
  fcWithRegistry(api, 'progress.getRegistry', isLive, (registry) => context.subscriptions.push(registry.register(fcProgressProvider({ all: (sql) => db.all(sql), onDidChange: onData }))));
  if (api.work && typeof api.work.registerProvider === 'function') context.subscriptions.push(api.work.registerProvider(fcWorkProvider({ all: (sql) => db.all(sql) })));
}

/**
 * The clock of a study session in a pane: it runs while `host` (the pane's
 * body) holds the session and a card is up, and stops by itself when the
 * view is gone. `session.queue[session.index]` is the card showing. Returns
 * { takeCardMs }: the time counted on the card showing since it was shown,
 * for the review's own record; null on a host with no clock.
 */
export function fcStudyWork({ api, db, pane, host, view, session, deckNames, onData }) {
  if (pane.work) { pane.work.dispose(); pane.work = null; }
  if (!api || !api.work || typeof api.work.createClock !== 'function') return null;
  const dayOf = (ms) => api.work.dayOf(ms);
  const cardNow = () => (session.waitTimer || session.index >= session.queue.length ? null : session.queue[session.index] || null);
  /** Cards this clock has counted time on, by id: what their grades are looked up for. */
  const touched = new Map();
  let shownId = null;
  let shownSeconds = 0;
  let disposed = false;
  let chain = Promise.resolve();
  const later = (fn) => { chain = chain.then(fn).catch((err) => { console.warn('[Flashcards] work time not kept:', err && err.message); }); return chain; };
  const groupsOf = (card) => JSON.stringify(fcWorkGroups(card, deckNames.get(card.deckId)));

  /** The day's rows of the cards touched follow fc_reviews: graded or not, right or not (an undone grade takes its mark back). */
  const followGrades = () => later(async () => {
    if (!touched.size) return;
    const ids = [...touched.keys()];
    const since = Date.now() - 48 * 3600 * 1000;
    const reviews = await db.all(`SELECT card_id, reviewed_at, rating FROM fc_reviews WHERE reviewed_at >= ? AND card_id IN (${ids.map(() => '?').join(',')})`, [since, ...ids]);
    const graded = fcWorkGraded(reviews, dayOf);
    const days = [dayOf(Date.now()), dayOf(Date.now() - 24 * 3600 * 1000)];
    const have = await db.all(`SELECT day, card_id, reviewed, was_right FROM fc_work_time WHERE day IN (?, ?) AND card_id IN (${ids.map(() => '?').join(',')})`, [...days, ...ids]);
    let changed = false;
    for (const row of have) {
      const key = `${row.day}\u0000${row.card_id}`;
      const g = graded.get(key) || { reviewed: 0, right: 0 };
      graded.delete(key);
      if (Number(row.reviewed) === g.reviewed && Number(row.was_right) === g.right) continue;
      await db.run('UPDATE fc_work_time SET reviewed = ?, was_right = ? WHERE day = ? AND card_id = ?', [g.reviewed, g.right, row.day, row.card_id]);
      changed = true;
    }
    for (const [key, g] of graded) {
      const [day, id] = key.split('\u0000');
      if (!days.includes(day) || !touched.has(Number(id))) continue;
      await db.run('INSERT INTO fc_work_time (day, card_id, groups, seconds, reviewed, was_right) VALUES (?, ?, ?, 0, ?, ?) ON CONFLICT(day, card_id) DO UPDATE SET reviewed = excluded.reviewed, was_right = excluded.was_right', [day, Number(id), touched.get(Number(id)), g.reviewed, g.right]);
      changed = true;
    }
    if (changed) emitWork();
  });

  const clock = api.work.createClock({
    showing: () => {
      // The view is gone (another view of the pane, the pane rebuilt): the clock stops by itself.
      if (!view.isConnected) { if (!disposed) setTimeout(dispose, 0); return false; }
      const card = cardNow();
      if (card && card.id !== shownId) { shownId = card.id; shownSeconds = 0; }
      return !!card && view.getClientRects().length > 0 && !(typeof document.visibilityState === 'string' && document.visibilityState !== 'visible');
    },
    bucket: () => { const card = cardNow(); if (!card) return ''; touched.set(card.id, groupsOf(card)); return String(card.id); },
    onCount: (seconds) => { shownSeconds = Math.max(0, shownSeconds + seconds); },
    credit: (credits) => {
      const rows = credits.filter((c) => c.bucket && c.seconds);
      if (!rows.length) return;
      void later(async () => {
        for (const c of rows) {
          const id = Number(c.bucket);
          await db.run('INSERT INTO fc_work_time (day, card_id, groups, seconds) VALUES (?, ?, ?, MAX(0, ?)) ON CONFLICT(day, card_id) DO UPDATE SET seconds = MAX(0, seconds + ?), groups = excluded.groups', [c.day, id, touched.get(id) || '[]', c.seconds, c.seconds]);
        }
        emitWork();
      });
    },
  });
  // The stop for idleness and the return, said across the top of the pane, above the card.
  const status = api.work.createClockStatus(null, clock, { bar: true });
  if (host.parentElement) host.parentElement.insertBefore(status.element, host);
  const data = onData(() => { void followGrades(); });
  function dispose() {
    if (disposed) return;
    disposed = true;
    data.dispose();
    status.dispose();
    clock.dispose();
    void followGrades();
    if (pane.work === handle) pane.work = null;
  }
  const handle = {
    dispose,
    /** Milliseconds the clock counted on the card showing, since it was shown. */
    takeCardMs: () => { clock.flush(); const ms = shownSeconds * 1000; shownSeconds = 0; return ms; },
  };
  pane.work = handle;
  return handle;
}
