// formulaRefs.ts — Worksheets: keep the dollar signs when a reference box is dragged.
//
// PURE (unit-tested in tests/unit/worksheetFormulaRefs.test.ts). While a
// formula is being edited, Univer 0.25 lets you drag or resize a highlighted
// reference box; it then rewrites EVERY reference of the formula from the
// drawn boxes, which carry no absolute markers, so $A$1 elsewhere in the
// formula comes back as A1 (Mufaro, 2026-09-14; reproduced by a probe).
// Excel keeps the markers, on the moved reference too. Given the formula's
// sequence nodes before and after such a rewrite, this returns the text with
// the markers put back, or null when the change was not that kind of rewrite.

export interface SequenceNodeLike { readonly nodeType: number; readonly token: string }
export type SequenceLike = string | SequenceNodeLike;

const REF = /^(?:(.+)!)?(\$?)([A-Za-z]{1,3})(\$?)(\d+)(?::(\$?)([A-Za-z]{1,3})(\$?)(\d+))?$/;

function cellsOf(token: string): string { return token.replace(/\$/g, '').toUpperCase(); }
function hasMarker(token: string): boolean { return token.includes('$'); }

/** `newToken` with `oldToken`'s absolute markers, position by position. A
 *  single cell grown into a range gives its markers to both ends. */
export function applyMarkers(oldToken: string, newToken: string): string {
  const o = REF.exec(oldToken);
  const n = REF.exec(newToken);
  if (!o || !n) return newToken;
  const [, nSheet, , nCol, , nRow, , nCol2, , nRow2] = n;
  const [, , oColAbs, , oRowAbs, , oColAbs2, , oRowAbs2] = o;
  const startCol = (oColAbs ? '$' : '') + nCol;
  const startRow = (oRowAbs ? '$' : '') + nRow;
  let out = (nSheet ? `${nSheet}!` : '') + startCol + startRow;
  if (nCol2 !== undefined && nRow2 !== undefined) {
    const endColAbs = oCol2Flag(oColAbs2, oColAbs);
    const endRowAbs = oCol2Flag(oRowAbs2, oRowAbs);
    out += ':' + (endColAbs ? '$' : '') + nCol2 + (endRowAbs ? '$' : '') + nRow2;
  }
  return out;
}
function oCol2Flag(endFlag: string | undefined, startFlag: string | undefined): boolean {
  // The old token's own end flag when it was a range, else its start flag.
  return endFlag !== undefined ? endFlag === '$' : startFlag === '$';
}

/**
 * The corrected formula, or null when nothing should change: the reference
 * counts differ (a different edit) or no marker was lost. Outside a pointer
 * drag (`duringDrag` false) it also declines when no reference moved and at
 * most one lost its markers, which is F4 or typing; a drag that drops a
 * reference back on its own cell looks the same, so the host passes what
 * the pointer was doing. The text comes back without a leading '='.
 */
export function restoreAbsoluteMarkers(oldNodes: readonly SequenceLike[], newNodes: readonly SequenceLike[], referenceType: number, duringDrag = false): string | null {
  const refs = (nodes: readonly SequenceLike[]) => nodes.filter((n): n is SequenceNodeLike => typeof n !== 'string' && n.nodeType === referenceType);
  const oldRefs = refs(oldNodes);
  const newRefs = refs(newNodes);
  if (oldRefs.length === 0 || oldRefs.length !== newRefs.length) return null;
  let moved = 0;
  let lost = 0;
  for (let i = 0; i < oldRefs.length; i++) {
    if (cellsOf(oldRefs[i].token) !== cellsOf(newRefs[i].token)) moved++;
    if (hasMarker(oldRefs[i].token) && !hasMarker(newRefs[i].token)) lost++;
  }
  if (lost === 0) return null;
  if (!duringDrag && moved === 0 && lost <= 1) return null;
  const replacement = new Map<SequenceNodeLike, string>();
  for (let i = 0; i < oldRefs.length; i++) {
    if (hasMarker(oldRefs[i].token) && !hasMarker(newRefs[i].token)) replacement.set(newRefs[i], applyMarkers(oldRefs[i].token, newRefs[i].token));
  }
  return newNodes.map((n) => (typeof n === 'string' ? n : (replacement.get(n) ?? n.token))).join('');
}
