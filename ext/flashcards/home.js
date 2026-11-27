// home.js — what Flashcards puts on Home: one card for today (how many cards
// the next session hands over, and the button that starts it) and its decks
// as things last worked on. Both leave with the extension. The shaping is
// pure and tested in tests/unit/flashcardsHome.test.ts.

/** Every deck in study with how many cards it holds and when one of them was last reviewed. */
export const FC_HOME_DECKS_SQL = `
  SELECT d.id, d.name, d.description, d.created_at, COUNT(DISTINCT c.id) AS cards, MAX(r.reviewed_at) AS reviewed
  FROM fc_decks d LEFT JOIN fc_cards c ON c.deck_id = d.id LEFT JOIN fc_reviews r ON r.card_id = c.id
  WHERE d.archived = 0 GROUP BY d.id`;

/**
 * Today's card. `served` is what the next session hands over (the number
 * Flashcards' own page shows as due today); `counts.dueTotal` is everything
 * waiting, which the daily limits may hold part of back. No decks: no card.
 */
export function fcHomeCard({ decks, served, counts }) {
  if (!decks) return null;
  const base = { id: 'today', icon: 'px-flashcards', number: String(served), unit: served === 1 ? 'card due' : 'cards due' };
  if (served <= 0) return { ...base, line: 'Nothing due right now.', action: { label: 'Open Flashcards', command: 'flashcards.open' } };
  const held = Math.max(0, (counts.dueTotal || 0) - served);
  const fresh = Math.min(counts.newCount || 0, served);
  const line = held > 0 ? `${held} more ${held === 1 ? 'waits' : 'wait'} behind today's limits.`
    : fresh === served ? (served === 1 ? 'It is new.' : 'All of them are new.')
      : fresh > 0 ? `${fresh} ${fresh === 1 ? 'is' : 'are'} new, ${served - fresh} to review.` : (served === 1 ? 'A review.' : 'All of them are reviews.');
  return { ...base, line, action: { label: 'Study', icon: 'play', command: 'flashcards.study' } };
}

/** The decks as things for Home's feed, last reviewed first. `open(deckId)` opens one. */
export function fcHomeDecks(rows, open) {
  return rows.map((r) => {
    const cards = r.cards || 0;
    const words = `${cards} ${cards === 1 ? 'card' : 'cards'}`;
    return {
      id: String(r.id), title: r.name, kind: 'Deck', icon: 'px-flashcards', summary: r.description || undefined, preview: words,
      stat: { value: String(cards), unit: cards === 1 ? 'card' : 'cards' }, touchedAt: r.reviewed || r.created_at || 0,
      open: () => open(r.id),
    };
  }).sort((a, b) => b.touchedAt - a.touchedAt);
}

const RECOUNT_MS = 10 * 60 * 1000;

/**
 * Registers both on a host that has Home's contribution points. `today()`
 * resolves { decks, served, counts }; `onData(listener)` hears every change
 * to Flashcards' data. Cards also come due as the clock runs, so the card is
 * counted again every ten minutes while the extension is on.
 */
export function fcRegisterHome(api, context, { all, today, onData, openDeck }) {
  const home = api.home;
  if (!home) return;
  const listeners = new Set();
  let card = null;
  let last = '';
  let run = 0;
  const recount = async () => {
    const mine = ++run;
    let next = null;
    try { next = fcHomeCard(await today()); } catch { next = null; }
    if (mine !== run) return;
    const said = JSON.stringify(next);
    if (said === last) return;
    last = said;
    if (next) card = home.registerCard(next);
    else { card?.dispose(); card = null; }
  };
  if (typeof home.registerCard === 'function') {
    const timer = setInterval(() => { void recount(); }, RECOUNT_MS);
    context.subscriptions.push({ dispose: () => { clearInterval(timer); run++; card?.dispose(); } });
    void recount();
  }
  context.subscriptions.push(onData(() => { void recount(); for (const fn of listeners) fn(); }));
  if (typeof home.registerSource === 'function') {
    context.subscriptions.push(home.registerSource({
      id: 'decks', label: 'Flashcards',
      listRecent: async (limit) => fcHomeDecks(await all(FC_HOME_DECKS_SQL), openDeck).slice(0, limit),
      onDidChange: (listener) => { listeners.add(listener); return { dispose: () => { listeners.delete(listener); } }; },
    }));
  }
}
