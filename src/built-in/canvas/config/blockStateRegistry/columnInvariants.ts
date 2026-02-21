// columnInvariants.ts — Structural rules for column layouts
//
// Single source of truth for column structural invariants:
//   • Is a column effectively empty?
//   • Normalize a columnList after any mutation (dissolve 0-1 columns, reset widths)
//   • Reset all column widths to equal
//   • Delete dragged source and clean up empty columns
//
// Consumed by: blockMovement (keyboard + DnD), columnAutoDissolve (safety net),
//              columnNodes (Backspace handler), columnDropPlugin (via facade).
//
// Part of blockStateRegistry — the single authority for block state operations.

// ── Column Empty Check ──────────────────────────────────────────────────────

export function isColumnEffectivelyEmpty(columnNode: any): boolean {
  if (!columnNode || columnNode.type?.name !== 'column') {
    return false;
  }

  return !nodeHasMeaningfulContent(columnNode);
}

function nodeHasMeaningfulContent(node: any): boolean {
  if (!node) return false;

  if (node.isText) {
    const text = String(node.text ?? '');
    return text.replace(/[\s\u200B-\u200D\uFEFF]/g, '').length > 0;
  }

  if (node.type?.name === 'hardBreak') {
    return false;
  }

  if (node.childCount === 0) {
    return !!node.isAtom;
  }

  let meaningful = false;
  node.forEach((child: any) => {
    if (!meaningful && nodeHasMeaningfulContent(child)) {
      meaningful = true;
    }
  });
  return meaningful;
}

// ── Single-ColumnList Normalization ─────────────────────────────────────────

/**
 * Normalize a specific columnList after a mutation:
 *   • 0 columns → delete the columnList entirely
 *   • 1 column  → dissolve: replace columnList with the column's content
 *   • 2+ columns → reset all column widths to equal (null)
 */
export function normalizeColumnList(tr: any, columnListPos: number): void {
  let targetPos = columnListPos;
  let columnListNode = tr.doc.nodeAt(targetPos);

  if (!columnListNode || columnListNode.type.name !== 'columnList') {
    targetPos = tr.mapping.map(columnListPos, -1);
    columnListNode = tr.doc.nodeAt(targetPos);
  }

  if (!columnListNode || columnListNode.type.name !== 'columnList') return;

  const allColumns: any[] = [];
  columnListNode.forEach((child: any) => {
    if (child.type.name === 'column') {
      allColumns.push(child);
    }
  });

  if (allColumns.length === 0) {
    tr.delete(targetPos, targetPos + columnListNode.nodeSize);
    return;
  }

  if (allColumns.length === 1) {
    tr.replaceWith(targetPos, targetPos + columnListNode.nodeSize, allColumns[0].content);
    return;
  }

  resetColumnListWidths(tr, targetPos);
}

/**
 * Normalize ALL columnLists in the document. Walks in reverse to avoid
 * position-shifting issues. Used by moveBlockAcrossColumnBoundary as a
 * final cleanup pass after DnD structural changes.
 *
 * Includes width-reset for 2+ column lists — appropriate after structural
 * mutations but NOT from appendTransaction (use dissolveOrphanedColumnLists
 * for the safety-net plugin).
 */
export function normalizeAllColumnLists(tr: any): void {
  const columnListPositions: number[] = [];
  tr.doc.descendants((node: any, pos: number) => {
    if (node.type?.name === 'columnList') {
      columnListPositions.push(pos);
    }
  });

  for (let i = columnListPositions.length - 1; i >= 0; i--) {
    normalizeColumnList(tr, columnListPositions[i]);
  }
}

/**
 * Safety-net pass: dissolve orphaned columnLists (0 or 1 column) WITHOUT
 * resetting widths on healthy 2+ column layouts.
 *
 * This is the correct function for appendTransaction — it catches structural
 * corruption from undo, external plugins, or content deletion without
 * interfering with user-set column widths or focus state.
 */
export function dissolveOrphanedColumnLists(tr: any): void {
  const columnListPositions: number[] = [];
  tr.doc.descendants((node: any, pos: number) => {
    if (node.type?.name === 'columnList') {
      columnListPositions.push(pos);
    }
  });

  for (let i = columnListPositions.length - 1; i >= 0; i--) {
    dissolveIfOrphaned(tr, columnListPositions[i]);
  }
}

/**
 * Handle only structurally invalid columnLists (0 or 1 column).
 * Leaves healthy 2+ column layouts untouched.
 */
function dissolveIfOrphaned(tr: any, columnListPos: number): void {
  let targetPos = columnListPos;
  let columnListNode = tr.doc.nodeAt(targetPos);

  if (!columnListNode || columnListNode.type.name !== 'columnList') {
    targetPos = tr.mapping.map(columnListPos, -1);
    columnListNode = tr.doc.nodeAt(targetPos);
  }

  if (!columnListNode || columnListNode.type.name !== 'columnList') return;

  const allColumns: any[] = [];
  columnListNode.forEach((child: any) => {
    if (child.type.name === 'column') {
      allColumns.push(child);
    }
  });

  if (allColumns.length === 0) {
    tr.delete(targetPos, targetPos + columnListNode.nodeSize);
    return;
  }

  if (allColumns.length === 1) {
    tr.replaceWith(targetPos, targetPos + columnListNode.nodeSize, allColumns[0].content);
    return;
  }

  // 2+ columns — structurally valid, leave untouched.
}

// ── Width Reset ─────────────────────────────────────────────────────────────

/**
 * Reset all column widths in a columnList to null (equal distribution).
 */
export function resetColumnListWidths(tr: any, columnListPos: number): void {
  const mPos = tr.mapping.map(columnListPos);
  const cl = tr.doc.nodeAt(mPos);
  if (!cl || cl.type.name !== 'columnList') return;

  let off = mPos + 1;
  for (let i = 0; i < cl.childCount; i++) {
    const ch = cl.child(i);
    if (ch.type.name === 'column' && ch.attrs.width !== null) {
      tr.setNodeMarkup(off, undefined, { ...ch.attrs, width: null });
    }
    off += ch.nodeSize;
  }
}

// ── Dragged Source Deletion ─────────────────────────────────────────────────

/**
 * Delete the dragged block range from the transaction, then clean up any
 * resulting empty column and normalize the parent columnList.
 *
 * Handles all source contexts:
 *   • Top-level block → simple delete
 *   • Block inside column → delete, then dissolve empty column + normalize
 */
export function deleteDraggedSource(
  tr: any,
  dragFrom: number,
  dragTo: number,
): void {
  const initialDoc = Array.isArray(tr.docs) && tr.docs.length > 0 ? tr.docs[0] : tr.doc;
  const safeFrom = Math.max(0, Math.min(dragFrom, initialDoc.content.size));
  const $src = initialDoc.resolve(safeFrom);
  let sourceColumnStartPos: number | null = null;
  let sourceColumnListPos: number | null = null;

  let colD = -1;
  for (let d = $src.depth; d >= 1; d--) {
    if ($src.node(d).type.name === 'column') { colD = d; break; }
  }

  if (colD >= 0) {
    sourceColumnStartPos = $src.before(colD);
    sourceColumnListPos = $src.before(colD - 1);
  }

  const mFrom = tr.mapping.map(dragFrom);
  const mTo = tr.mapping.map(dragTo);

  if (mTo > mFrom) tr.delete(mFrom, mTo);

  if (sourceColumnStartPos == null || sourceColumnListPos == null) {
    return;
  }

  const mappedColumnStart = tr.mapping.map(sourceColumnStartPos, 1);
  const maybeColumn = tr.doc.nodeAt(mappedColumnStart);
  if (!maybeColumn || maybeColumn.type.name !== 'column') {
    return;
  }

  if (isColumnEffectivelyEmpty(maybeColumn)) {
    tr.delete(mappedColumnStart, mappedColumnStart + maybeColumn.nodeSize);
    normalizeColumnList(tr, sourceColumnListPos);
    return;
  }

  // Fallback for extraction flows where mapping cannot re-resolve the original
  // source column start precisely after prior tr steps. Keep this structural and
  // conservative: only remove one empty column from a 2-column list.
  const mappedColumnListPos = tr.mapping.map(sourceColumnListPos, -1);
  const columnListNode = tr.doc.nodeAt(mappedColumnListPos);
  if (!columnListNode || columnListNode.type.name !== 'columnList') {
    return;
  }

  if (columnListNode.childCount !== 2) {
    return;
  }

  const emptyColumns: Array<{ pos: number; nodeSize: number }> = [];
  let scanPos = mappedColumnListPos + 1;
  columnListNode.forEach((child: any) => {
    if (child.type?.name === 'column' && isColumnEffectivelyEmpty(child)) {
      emptyColumns.push({ pos: scanPos, nodeSize: child.nodeSize });
    }
    scanPos += child.nodeSize;
  });

  if (emptyColumns.length !== 1) {
    return;
  }

  tr.delete(emptyColumns[0].pos, emptyColumns[0].pos + emptyColumns[0].nodeSize);
  normalizeColumnList(tr, mappedColumnListPos);
}

// ── Backward-Compat Aliases ─────────────────────────────────────────────────
// These aliases preserve existing consumer imports during the transition.
// Remove once all callers are updated to the shorter names.

export {
  normalizeColumnList as normalizeColumnListAfterMutation,
  resetColumnListWidths as resetColumnListWidthsInTransaction,
  deleteDraggedSource as deleteDraggedSourceFromTransaction,
  normalizeAllColumnLists as normalizeAllColumnListsAfterMutation,
  dissolveOrphanedColumnLists as dissolveOrphanedColumnListsAfterMutation,
};
