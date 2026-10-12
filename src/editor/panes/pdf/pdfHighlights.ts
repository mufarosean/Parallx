// pdfHighlights.ts — a highlight as it is stored, its palette, and the arithmetic on it.
//
// Highlights are kept in PDF user space (rotation and scale independent) under
// a colour key; the pane draws them, this file says what they are. Pure.

// ─── Highlight palette ─────────────────────────────────────────────────────
// Stored by key; rendered with the rgba value. Order = swatch order.
export const HIGHLIGHT_COLORS: ReadonlyArray<{ key: string; label: string; rgba: string }> = [
  { key: 'yellow', label: 'Yellow', rgba: 'rgba(255, 214, 64, 0.40)' },
  { key: 'green',  label: 'Green',  rgba: 'rgba(118, 214, 122, 0.40)' },
  { key: 'blue',   label: 'Blue',   rgba: 'rgba(96, 170, 255, 0.38)' },
  { key: 'pink',   label: 'Pink',   rgba: 'rgba(255, 128, 191, 0.38)' },
  { key: 'orange', label: 'Orange', rgba: 'rgba(255, 167, 64, 0.40)' },
];
export function highlightRgba(key: string): string {
  return (HIGHLIGHT_COLORS.find((c) => c.key === key) ?? HIGHLIGHT_COLORS[0]).rgba;
}
/** The same colour at full strength, for swatches (a see-through dot turns muddy on a dark panel). */
export function highlightSolid(rgba: string): string {
  return rgba.replace(/^rgba\((\s*\d+\s*,\s*\d+\s*,\s*\d+)\s*,\s*[\d.]+\s*\)$/, 'rgb($1)');
}

// A highlight rectangle stored in PDF user-space (rotation/scale independent).
export interface PdfHighlightRect {
  x1: number;
  y1: number;
  x2: number;
  y2: number;
}

// one saved turn of the per-highlight AI discussion (a review record,
// not a live session).
export interface PdfHighlightThreadTurn {
  role: 'user' | 'ai';
  text: string;
  at: number;
}

// a canvas page this highlight's passage was captured to.
export interface PdfHighlightCanvasLink {
  pageId: string;
  title: string;
  at: number;
}

export interface PdfHighlight {
  id: string;
  page: number;          // 1-based
  color: string;         // HIGHLIGHT_COLORS key
  rects: PdfHighlightRect[];
  text: string;          // captured selection text (for reference/export)
  note: string;          // optional margin note
  thread?: PdfHighlightThreadTurn[];      // saved AI discussion
  canvasLinks?: PdfHighlightCanvasLink[]; // pages this became
  createdAt: number;
}

// One reversible highlight action for the undo/redo stacks. `highlights` is a
// deep copy so a deleted highlight can be fully restored on undo.
export interface PdfHighlightAction {
  kind: 'create' | 'delete';
  highlights: PdfHighlight[];
}

/** True when the two rectangle sets cover at least half of the smaller one. */
export function rectsOverlap(a: readonly PdfHighlightRect[], b: readonly PdfHighlightRect[]): boolean {
  const area = (rs: readonly PdfHighlightRect[]): number =>
    rs.reduce((sum, r) => sum + Math.abs(r.x2 - r.x1) * Math.abs(r.y2 - r.y1), 0);
  let intersection = 0;
  for (const r1 of a) {
    const ax1 = Math.min(r1.x1, r1.x2), ax2 = Math.max(r1.x1, r1.x2);
    const ay1 = Math.min(r1.y1, r1.y2), ay2 = Math.max(r1.y1, r1.y2);
    for (const r2 of b) {
      const bx1 = Math.min(r2.x1, r2.x2), bx2 = Math.max(r2.x1, r2.x2);
      const by1 = Math.min(r2.y1, r2.y2), by2 = Math.max(r2.y1, r2.y2);
      const ix = Math.max(0, Math.min(ax2, bx2) - Math.max(ax1, bx1));
      const iy = Math.max(0, Math.min(ay2, by2) - Math.max(ay1, by1));
      intersection += ix * iy;
    }
  }
  const smaller = Math.min(area(a), area(b));
  return smaller > 0 && intersection / smaller >= 0.5;
}

/** A deep copy, so an undo can restore a deleted highlight whole. */
export function cloneHighlight(hl: PdfHighlight): PdfHighlight {
  return {
    ...hl,
    rects: hl.rects.map((r) => ({ ...r })),
    thread: hl.thread?.map((t) => ({ ...t })),
    canvasLinks: hl.canvasLinks?.map((l) => ({ ...l })),
  };
}
