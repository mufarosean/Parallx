// canvasDocDiff.ts — minimal top-level-block diff for surgical live updates.
//
// When the AI edits an open page we must NOT rebuild the whole document (that
// resets the user's cursor/scroll/selection and flickers). Every block carries a
// stable UniqueID, so a common-prefix/suffix scan (by id + deep equality)
// localizes the edit to the smallest changed SPAN of top-level children.
// Replacing only that span in one ProseMirror transaction preserves every
// untouched block — and any selection inside them maps through cleanly.
//
// Pure + DOM-free: `diffTopLevel` works on plain node JSON, `computeReplaceRange`
// works on any object exposing ProseMirror's `child(i)`/`nodeSize` shape — so the
// whole apply path is unit-testable with prosemirror-model alone (no editor view).

export interface IBlockDiff {
  /** Index where the changed span begins (length of the common prefix). */
  readonly start: number;
  /** End (exclusive) of the changed span in the OLD children. */
  readonly oldEnd: number;
  /** End (exclusive) of the changed span in the NEW children. */
  readonly newEnd: number;
}

/** Structural deep-equality (order-sensitive, sufficient for ProseMirror JSON). */
export function deepEqual(a: unknown, b: unknown): boolean {
  if (a === b) return true;
  if (typeof a !== typeof b || typeof a !== 'object' || a === null || b === null) return false;
  const arrA = Array.isArray(a);
  if (arrA !== Array.isArray(b)) return false;
  if (arrA) {
    const x = a as unknown[]; const y = b as unknown[];
    if (x.length !== y.length) return false;
    for (let i = 0; i < x.length; i++) if (!deepEqual(x[i], y[i])) return false;
    return true;
  }
  const x = a as Record<string, unknown>; const y = b as Record<string, unknown>;
  const kx = Object.keys(x); const ky = Object.keys(y);
  if (kx.length !== ky.length) return false;
  for (const k of kx) { if (!(k in y) || !deepEqual(x[k], y[k])) return false; }
  return true;
}

/** Two blocks are "the same" when their content is deep-equal (the stable id is
 *  part of attrs, so identical id + identical content both fall out of this). */
function sameBlock(a: unknown, b: unknown): boolean {
  return deepEqual(a, b);
}

/**
 * Localize the changed span between two top-level child arrays.
 * Returns `null` when the arrays are identical (nothing to apply).
 *
 * The common prefix and suffix are left untouched; the caller replaces the
 * middle `[start, oldEnd)` (old) with `[start, newEnd)` (new) in one transaction.
 * This yields a single in-place edit for the common cases — block changed,
 * blocks appended, a block inserted/removed — and a tight bounded span for
 * scattered edits, never a whole-doc rebuild.
 */
export function diffTopLevel(oldNodes: readonly unknown[], newNodes: readonly unknown[]): IBlockDiff | null {
  const maxPrefix = Math.min(oldNodes.length, newNodes.length);
  let start = 0;
  while (start < maxPrefix && sameBlock(oldNodes[start], newNodes[start])) start++;

  let oldEnd = oldNodes.length;
  let newEnd = newNodes.length;
  while (oldEnd > start && newEnd > start && sameBlock(oldNodes[oldEnd - 1], newNodes[newEnd - 1])) {
    oldEnd--;
    newEnd--;
  }

  if (start === oldEnd && start === newEnd) return null;
  return { start, oldEnd, newEnd };
}

/** Minimal shape of a ProseMirror node we need to compute child positions. */
export interface IPmNodeLike {
  child(index: number): { nodeSize: number };
  readonly childCount: number;
}

/**
 * Translate a block-index span into ProseMirror document positions for a
 * `replaceWith(from, to, …)`. `from` is the position before child `start`;
 * `to` is the position after child `oldEnd-1`. Positions are sums of child
 * `nodeSize`s (top-level children start at doc position 0).
 */
export function computeReplaceRange(doc: IPmNodeLike, diff: IBlockDiff): { from: number; to: number } {
  let from = 0;
  for (let i = 0; i < diff.start; i++) from += doc.child(i).nodeSize;
  let to = from;
  for (let i = diff.start; i < diff.oldEnd; i++) to += doc.child(i).nodeSize;
  return { from, to };
}

/** What an edit did to each block of a changed span, for the margin marks. */
export interface ISpanClassification {
  /** Per NEW block in the span: added, rewritten, or untouched (null). */
  readonly kinds: readonly ('added' | 'changed' | null)[];
  /** Per NEW block: the old block's text when it was rewritten. */
  readonly before: readonly (string | undefined)[];
  /** Indices (within the OLD span) of blocks the edit removed (empty ones
   *  are left out: they go without a mark). */
  readonly removed: readonly number[];
}

type JsonBlock = { type?: string; attrs?: Record<string, unknown>; text?: string; content?: unknown[] };

/** Plain text of a node JSON, for the "before" peek. */
export function blockText(node: unknown, max = 160): string {
  let out = '';
  const walk = (n: unknown): void => {
    if (out.length > max || !n || typeof n !== 'object') return;
    const b = n as JsonBlock;
    if (typeof b.text === 'string') out += b.text;
    if (Array.isArray(b.content)) for (const c of b.content) { walk(c); if (b.type !== 'text') out += ' '; }
  };
  walk(node);
  out = out.replace(/\s+/g, ' ').trim();
  return out.length > max ? `${out.slice(0, max - 1)}…` : out;
}

/** Dice overlap of the two texts' words (0..1). */
function likeness(a: string, b: string): number {
  const words = (t: string): Set<string> => new Set(t.toLowerCase().split(/[^\p{L}\p{N}]+/u).filter(Boolean));
  const A = words(a); const B = words(b);
  if (A.size === 0 || B.size === 0) return A.size === B.size ? 1 : 0;
  let both = 0;
  for (const w of A) if (B.has(w)) both++;
  return (2 * both) / (A.size + B.size);
}

function isEmptyBlock(node: unknown): boolean {
  const b = node as JsonBlock | null;
  return !!b && b.type === 'paragraph' && (!b.content || b.content.length === 0);
}

function withoutId(node: unknown): unknown {
  const b = node as JsonBlock | null;
  if (!b || typeof b !== 'object' || !b.attrs || !('id' in b.attrs)) return node;
  const { id: _id, ...rest } = b.attrs;
  return { ...b, attrs: rest };
}

/**
 * Pair the old and new blocks of a changed span. Blocks equal in content
 * (ignoring ids, which a markdown rewrite regenerates) are untouched; a new
 * block whose id matches an old one, or that shares enough words with an old
 * block of the same type in the same place, is a rewrite; the rest are added
 * or removed. Callers pass schema-normalized JSON so default attrs agree.
 */
export function classifySpan(oldSpan: readonly unknown[], newSpan: readonly unknown[]): ISpanClassification {
  const n = oldSpan.length;
  const m = newSpan.length;
  const kinds: ('added' | 'changed' | null)[] = new Array(m).fill('added');
  const before: (string | undefined)[] = new Array(m).fill(undefined);
  const oldTaken = new Array<boolean>(n).fill(false);
  const pairWith = new Array<number>(m).fill(-1);

  // Untouched blocks: longest common subsequence by content (spans are small;
  // past 400×400 everything simply counts as rewritten or added).
  if (n * m <= 160_000) {
    const a = oldSpan.map(withoutId);
    const b = newSpan.map(withoutId);
    const L: number[][] = Array.from({ length: n + 1 }, () => new Array<number>(m + 1).fill(0));
    for (let i = n - 1; i >= 0; i--) {
      for (let j = m - 1; j >= 0; j--) {
        L[i][j] = deepEqual(a[i], b[j]) ? L[i + 1][j + 1] + 1 : Math.max(L[i + 1][j], L[i][j + 1]);
      }
    }
    let i = 0; let j = 0;
    while (i < n && j < m) {
      if (deepEqual(a[i], b[j])) { kinds[j] = null; oldTaken[i] = true; pairWith[j] = i; i++; j++; }
      else if (L[i + 1][j] >= L[i][j + 1]) i++;
      else j++;
    }
  }

  // Rewrites by stable id.
  const idOf = (x: unknown): string | undefined => {
    const id = (x as JsonBlock | null)?.attrs?.['id'];
    return typeof id === 'string' && id ? id : undefined;
  };
  const oldById = new Map<string, number>();
  oldSpan.forEach((o, i) => { const id = idOf(o); if (id && !oldTaken[i]) oldById.set(id, i); });
  newSpan.forEach((nb, j) => {
    if (kinds[j] === null) return;
    const id = idOf(nb);
    const i = id !== undefined ? oldById.get(id) : undefined;
    if (i !== undefined && !oldTaken[i]) {
      oldTaken[i] = true; pairWith[j] = i; kinds[j] = 'changed'; before[j] = blockText(oldSpan[i]);
    }
  });

  // Rewrites by likeness: between two anchors, an unmatched new block pairs
  // with the next unmatched old block of the same type that shares enough of
  // its words. Order is kept, so pairs never cross.
  let lastOld = -1;
  let gapNew: number[] = [];
  const flush = (nextOld: number): void => {
    let cursor = lastOld + 1;
    for (const j of gapNew) {
      const nb = newSpan[j] as JsonBlock;
      const nText = blockText(nb, 400);
      for (let i = cursor; i < nextOld; i++) {
        if (oldTaken[i] || (oldSpan[i] as JsonBlock)?.type !== nb?.type) continue;
        const oText = blockText(oldSpan[i], 400);
        if (likeness(oText, nText) >= 0.4) {
          oldTaken[i] = true; kinds[j] = 'changed'; before[j] = blockText(oldSpan[i]);
          cursor = i + 1;
          break;
        }
      }
    }
    gapNew = [];
  };
  for (let j = 0; j < m; j++) {
    if (pairWith[j] >= 0) { flush(pairWith[j]); lastOld = pairWith[j]; }
    else if (kinds[j] === 'added') gapNew.push(j);
  }
  flush(n);

  // An empty block coming or going is not worth a mark.
  newSpan.forEach((nb, j) => { if (kinds[j] === 'added' && isEmptyBlock(nb)) kinds[j] = null; });

  const removed: number[] = [];
  for (let i = 0; i < n; i++) if (!oldTaken[i] && !isEmptyBlock(oldSpan[i])) removed.push(i);
  return { kinds, before, removed };
}
