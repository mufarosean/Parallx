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
