// slashMenuQuery.ts — When "/" opens the slash menu, and what a query finds
//
// Pure functions, zero imports: the controller (slashMenu.ts) feeds them the
// text before the caret and the menu items, and acts on what they return.
//
// The trigger: a "/" at the start of a line, or right after a space, opens
// the menu; one right after any other character ("and/or", a URL, 10/30)
// is just a slash. The query is what follows it, up to the caret.
//
// The ranking: an exact name or alias first, then a name, a word of a name
// or an alias that starts with the query, then one that contains it, then a
// description that contains it. Ties keep the menu's own order.

/** What slash-menu search reads of an item. */
export interface SlashRankable {
  readonly label: string;
  readonly description: string;
  /** Other names the item is found by ("h1", "todo", "-"). */
  readonly aliases?: readonly string[];
}

/** An open "/" before the caret: where the "/" is, and what follows it. */
export interface SlashTrigger {
  /** Offset of the "/" in the text passed in. */
  readonly offset: number;
  /** The text typed after the "/", up to the caret. */
  readonly query: string;
}

/** Longest query still read as a search; anything longer is just text. */
const MAX_QUERY_LENGTH = 40;

const isSpace = (ch: string): boolean => /\s/.test(ch);

/**
 * The "/" the caret is typing a query after, or null.
 *
 * `textBefore` is the line's text from its start to the caret; an inline
 * object (a mention, an equation) stands in as one non-space character.
 */
export function findSlashTrigger(textBefore: string): SlashTrigger | null {
  const offset = textBefore.lastIndexOf('/');
  if (offset < 0) return null;
  // "and/or", "https://", "10/30": a "/" after a character is a slash.
  if (offset > 0 && !isSpace(textBefore[offset - 1])) return null;
  const query = textBefore.slice(offset + 1);
  // "a / b": a "/" followed by a space is a slash.
  if (query.length > 0 && isSpace(query[0])) return null;
  if (query.length > MAX_QUERY_LENGTH) return null;
  return { offset, query };
}

/** Lower case, letters and digits only ("To-do List" → "todolist"). */
function squash(s: string): string {
  return s.toLowerCase().replace(/[^a-z0-9]/g, '');
}

/** Lower case, spaces collapsed, symbols kept ("```", "[]", "-"). */
function plain(s: string): string {
  return s.toLowerCase().replace(/\s+/g, ' ').trim();
}

const EXACT = 0;
const PREFIX = 1;
const SUBSTRING = 2;
const DESCRIPTION = 3;
const NO_MATCH = 4;

/** How well one name (a label or an alias) matches the query. */
function nameScore(name: string, q: string, sq: string): number {
  const p = plain(name);
  const s = squash(name);
  if (p === q || (sq && s === sq)) return EXACT;
  if (p.startsWith(q) || (sq && s.startsWith(sq))) return PREFIX;
  if (p.split(/[\s-]+/).some((word) => word.startsWith(q))) return PREFIX;
  if (p.includes(q) || (sq && s.includes(sq))) return SUBSTRING;
  return NO_MATCH;
}

/** How well an item matches a query (lower is better; 4 is no match). */
export function slashMatchScore(item: SlashRankable, query: string): number {
  const q = plain(query);
  if (!q) return EXACT;
  const sq = squash(q);
  let best = nameScore(item.label, q, sq);
  for (const alias of item.aliases ?? []) {
    if (typeof alias !== 'string' || !alias.trim()) continue;
    best = Math.min(best, nameScore(alias, q, sq));
  }
  if (best === NO_MATCH && sq && squash(item.description).includes(sq)) best = DESCRIPTION;
  return best;
}

/**
 * The items a query finds, best first. An empty query returns every item in
 * its own order.
 */
export function rankSlashItems<T extends SlashRankable>(items: readonly T[], query: string): T[] {
  if (!plain(query)) return [...items];
  return items
    .map((item, index) => ({ item, index, score: slashMatchScore(item, query) }))
    .filter((r) => r.score < NO_MATCH)
    .sort((a, b) => a.score - b.score || a.index - b.index)
    .map((r) => r.item);
}

/**
 * Whether a query is still a search. Once a space follows words that find
 * nothing ("/xyz and"), the "/" was text: the menu stays closed for it even
 * if later words happen to match something.
 */
export function slashQueryAlive(items: readonly SlashRankable[], query: string): boolean {
  for (let i = 1; i < query.length; i++) {
    if (isSpace(query[i]) && !isSpace(query[i - 1])) {
      const head = query.slice(0, i);
      if (!items.some((item) => slashMatchScore(item, head) < NO_MATCH)) return false;
    }
  }
  return true;
}
