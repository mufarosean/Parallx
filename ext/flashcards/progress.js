// progress.js — Flashcards' cards as progress any tool can show.
//
// Offered through the core's progress-provider seam (the core command
// `progress.getRegistry`): every tag and every deck is a group, and a card's
// state is its last rating: Good or Easy good, Hard middling, Again poor,
// never reviewed the rest. A card is in its deck and in each of its tags, so
// groups cannot be added: `count` takes several together, each card once.
// Suspended cards and archived decks are left out,
// as they are out of study. There is no `open`: Flashcards has no screen for
// "the cards of this tag last rated Again", so a reader draws the bar plain.
// The mapping is pure and tested in tests/unit/flashcardsProgress.test.ts.

/** Flashcards' words for the four states. */
export const FC_PROGRESS_WORDS = Object.freeze({ good: 'Good or Easy', middling: 'Hard', poor: 'Again', rest: 'Not reviewed' });

/** Every card in study with its deck and its latest review's rating (null: never reviewed). */
export const FC_PROGRESS_SQL = `
  SELECT c.tags, c.deck_id, d.name AS deck_name, r.rating AS last_rating
  FROM fc_cards c JOIN fc_decks d ON d.id = c.deck_id
  LEFT JOIN (
    SELECT card_id, rating, ROW_NUMBER() OVER (PARTITION BY card_id ORDER BY reviewed_at DESC, id DESC) AS n FROM fc_reviews
  ) r ON r.card_id = c.id AND r.n = 1
  WHERE c.suspended = 0 AND d.archived = 0`;

/** A rating (1 Again, 2 Hard, 3 Good, 4 Easy) as one of the four states. */
export function fcProgressState(rating) {
  const r = Number(rating);
  return r === 3 || r === 4 ? 'good' : r === 2 ? 'middling' : r === 1 ? 'poor' : 'rest';
}

/**
 * The groups of the rows FC_PROGRESS_SQL gives: one per tag (whatever its
 * case; named as first written) and one per deck, tags first, each in name
 * order: [{ group, label, total, good, middling, poor }]. A card counts in
 * its deck and in each of its tags.
 */
export function fcProgressGroups(rows) {
  const tags = new Map();
  const decks = new Map();
  const count = (map, key, group, label, state) => {
    let g = map.get(key);
    if (!g) { g = { group, label, total: 0, good: 0, middling: 0, poor: 0 }; map.set(key, g); }
    g.total += 1;
    if (state !== 'rest') g[state] += 1;
  };
  for (const row of rows || []) {
    const state = fcProgressState(row.last_rating);
    count(decks, row.deck_id, `deck:${row.deck_id}`, String(row.deck_name || ''), state);
    const seen = new Set();
    for (const tag of String(row.tags || '').split(',').map((t) => t.trim()).filter(Boolean)) {
      const key = tag.toLowerCase();
      if (seen.has(key)) continue;
      seen.add(key);
      count(tags, key, `tag:${key}`, tag, state);
    }
  }
  const byLabel = (a, b) => a.label.localeCompare(b.label, undefined, { numeric: true, sensitivity: 'base' });
  return [...[...tags.values()].sort(byLabel), ...[...decks.values()].sort(byLabel)];
}

/**
 * These groups taken together, each card once: a card in its deck and in two
 * of its tags is in three groups and is still one card. `groups` are the
 * keys fcProgressGroups gives ('tag:mack', 'deck:3'). Returns
 * { total, good, middling, poor }.
 */
export function fcProgressCount(rows, groups) {
  const wanted = new Set((groups || []).map(String));
  const out = { total: 0, good: 0, middling: 0, poor: 0 };
  for (const row of rows || []) {
    const tags = String(row.tags || '').split(',').map((t) => t.trim().toLowerCase()).filter(Boolean);
    if (!wanted.has(`deck:${row.deck_id}`) && !tags.some((t) => wanted.has(`tag:${t}`))) continue;
    const state = fcProgressState(row.last_rating);
    out.total += 1;
    if (state !== 'rest') out[state] += 1;
  }
  return out;
}

/** The provider: `all(sql)` reads Flashcards' database, `onDidChange` is its data-change event. */
export function fcProgressProvider({ all, onDidChange }) {
  return {
    id: 'flashcards.cards',
    displayName: 'Cards',
    toolId: 'parallx-community.flashcards',
    words: FC_PROGRESS_WORDS,
    groups: async () => fcProgressGroups(await all(FC_PROGRESS_SQL)),
    count: async (groups) => fcProgressCount(await all(FC_PROGRESS_SQL), groups),
    onDidChange: (listener) => onDidChange(listener),
  };
}

/**
 * Run a core command that returns a live registry and hand the registry to
 * `use`. The command may land after this extension: it is tried again every
 * two seconds, six times in all, and never once `isLive()` says the
 * extension is off.
 */
export function fcWithRegistry(api, command, isLive, use, attempt = 0) {
  api.commands.executeCommand(command)
    .then((registry) => {
      if (!isLive()) return;
      if (!registry || typeof registry.register !== 'function') throw new Error('no registry');
      use(registry);
    })
    .catch(() => {
      if (attempt < 5 && isLive()) setTimeout(() => { if (isLive()) fcWithRegistry(api, command, isLive, use, attempt + 1); }, 2000);
    });
}
