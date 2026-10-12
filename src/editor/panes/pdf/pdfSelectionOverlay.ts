// pdfSelectionOverlay.ts — the boxes drawn over selected text in a PDF.
//
// pdf.js's text layer is transparent text over the page canvas; the native
// selection highlight on it is ragged (one box per glyph run, gaps between
// words). The pane hides it and draws merged boxes instead, one per run of
// a line. The same boxes place highlights and crop region captures.

import type { IDisposable } from '../../../platform/lifecycle.js';
import { toDisposable } from '../../../platform/lifecycle.js';
import type { SelectionOverlayRect } from './pdfTypes.js';

/**
 * The selection's boxes on one text layer, in layer-local CSS px, merged
 * into one box per run of each line. Empty when the selection is not on
 * this layer.
 */
export function selectionRectsOnLayer(selection: Selection, textLayer: HTMLElement): SelectionOverlayRect[] {
  const rects = collectRects(selection, textLayer);
  return rects.length ? mergeSelectionRects(rects) : [];
}

function collectRects(selection: Selection, textLayer: HTMLElement): SelectionOverlayRect[] {
  const layerRect = textLayer.getBoundingClientRect();
  if (layerRect.width === 0 || layerRect.height === 0) return [];

  // pdf.js makes its endOfContent element selectable and sizes it to the
  // whole text layer while a selection is made. A range that includes it
  // reports a rect covering the entire page, which would draw as a
  // page-sized box. Text rects are at most a line tall, so any rect taller
  // than half the layer is dropped.
  const maxRectHeight = layerRect.height * 0.5;

  const rects: SelectionOverlayRect[] = [];
  for (let index = 0; index < selection.rangeCount; index += 1) {
    const range = selection.getRangeAt(index);
    if (!range.intersectsNode(textLayer)) continue;
    for (const rect of Array.from(range.getClientRects())) {
      const clipped = clipRect(rect, layerRect);
      if (!clipped || clipped.height > maxRectHeight) continue;
      rects.push({
        left: clipped.left - layerRect.left,
        top: clipped.top - layerRect.top,
        width: clipped.width,
        height: clipped.height,
      });
    }
  }
  return rects;
}

function clipRect(rect: DOMRect | ClientRect, bounds: DOMRect): SelectionOverlayRect | null {
  const left = Math.max(rect.left, bounds.left);
  const top = Math.max(rect.top, bounds.top);
  const right = Math.min(rect.right, bounds.right);
  const bottom = Math.min(rect.bottom, bounds.bottom);
  const width = right - left;
  const height = bottom - top;
  if (width <= 0.5 || height <= 0.5) return null;
  return { left, top, width, height };
}

/**
 * Group boxes into lines (by vertical centre) and join the boxes on a line
 * whose gap is under a line height and a half, so a selected passage reads
 * as one bar per line rather than a box per word.
 */
export function mergeSelectionRects(rects: SelectionOverlayRect[]): SelectionOverlayRect[] {
  const sorted = [...rects].sort((a, b) => {
    const centerYDelta = (a.top + a.height / 2) - (b.top + b.height / 2);
    if (Math.abs(centerYDelta) > 1.5) return centerYDelta;
    return a.left - b.left;
  });

  const lines: Array<{ centerY: number; rects: SelectionOverlayRect[] }> = [];
  for (const rect of sorted) {
    const centerY = rect.top + rect.height / 2;
    const line = lines.find((candidate) => {
      const referenceHeight = candidate.rects.reduce((sum, value) => sum + value.height, 0) / candidate.rects.length;
      const tolerance = Math.max(3, referenceHeight * 0.45);
      return Math.abs(candidate.centerY - centerY) <= tolerance;
    });
    if (line) {
      line.rects.push({ ...rect });
      line.centerY = (line.centerY * (line.rects.length - 1) + centerY) / line.rects.length;
    } else {
      lines.push({ centerY, rects: [{ ...rect }] });
    }
  }

  const merged: SelectionOverlayRect[] = [];
  for (const line of lines) {
    const lineRects = line.rects.sort((a, b) => a.left - b.left);
    const averageHeight = lineRects.reduce((sum, value) => sum + value.height, 0) / lineRects.length;
    const gapTolerance = Math.max(6, Math.min(40, averageHeight * 1.5));
    let current: SelectionOverlayRect | null = null;

    for (const rect of lineRects) {
      if (!current) {
        current = { ...rect };
        continue;
      }
      const currentRight = current.left + current.width;
      const rectRight = rect.left + rect.width;
      if (rect.left - currentRight <= gapTolerance) {
        const left = Math.min(current.left, rect.left);
        const top = Math.min(current.top, rect.top);
        const right = Math.max(currentRight, rectRight);
        const bottom = Math.max(current.top + current.height, rect.top + rect.height);
        current = { left, top, width: right - left, height: bottom - top };
        continue;
      }
      merged.push(current);
      current = { ...rect };
    }
    if (current) merged.push(current);
  }
  return merged;
}

/** Draws the merged selection boxes over a viewer's text layers. */
export class PdfSelectionOverlay {
  private _frame: number | null = null;

  constructor(private readonly _container: () => HTMLElement | null) {}

  /** Follow the selection and window size. Dispose to stop. */
  listen(): IDisposable {
    const controller = new AbortController();
    document.addEventListener('selectionchange', () => this.schedule(), { signal: controller.signal });
    window.addEventListener('resize', () => this.schedule(), { signal: controller.signal });
    return toDisposable(() => controller.abort());
  }

  /** Redraw two frames from now, once text-layer layout has settled. */
  schedule(): void {
    if (this._frame !== null) return;
    this._frame = requestAnimationFrame(() => {
      this._frame = requestAnimationFrame(() => {
        this._frame = null;
        this._update();
      });
    });
  }

  /** Remove the boxes (and any redraw on its way). */
  clear(): void {
    if (this._frame !== null) {
      cancelAnimationFrame(this._frame);
      this._frame = null;
    }
    this._container()?.querySelectorAll('.pdf-selection-overlay-root').forEach((node) => node.remove());
  }

  private _update(): void {
    this.clear();
    const selection = globalThis.getSelection?.();
    const container = this._container();
    if (!selection || selection.isCollapsed || selection.rangeCount === 0 || !container) return;

    for (const textLayer of Array.from(container.querySelectorAll<HTMLElement>('.textLayer'))) {
      const rects = selectionRectsOnLayer(selection, textLayer);
      if (rects.length === 0) continue;
      const root = document.createElement('div');
      root.classList.add('pdf-selection-overlay-root');
      textLayer.insertBefore(root, textLayer.firstChild);
      for (const rect of rects) {
        const box = document.createElement('div');
        box.classList.add('pdf-selection-overlay-box');
        box.style.left = `${rect.left}px`;
        box.style.top = `${rect.top}px`;
        box.style.width = `${rect.width}px`;
        box.style.height = `${rect.height}px`;
        root.appendChild(box);
      }
    }
  }
}
