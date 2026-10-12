// pdfViewState.ts — where a reader was in a PDF, kept across tab switches
// and restarts: the page, the scale, and the exact scroll offsets.

import type { PDFViewer } from 'pdfjs-dist/web/pdf_viewer.mjs';

export interface PdfViewState {
  page?: number;
  scaleValue?: string;
  scrollLeft?: number;
  scrollTop?: number;
}

/** The reading position now. `fallbackScale` stands in before a document opens. */
export function readViewState(viewer: PDFViewer | null, container: HTMLElement | null, fallbackScale: string): Record<string, unknown> {
  return {
    page: viewer?.currentPageNumber ?? 1,
    scaleValue: viewer?.currentScaleValue ?? fallbackScale,
    scrollLeft: container?.scrollLeft ?? 0,
    // scrollTop is the exact position; the page alone would land the reader
    // at the top of a page they were halfway down.
    scrollTop: container?.scrollTop ?? 0,
  };
}

/** A saved state, keeping only fields of the right type. */
export function parseViewState(state: Record<string, unknown>): PdfViewState {
  return {
    page: typeof state.page === 'number' ? state.page : undefined,
    scaleValue: typeof state.scaleValue === 'string' ? state.scaleValue : undefined,
    scrollLeft: typeof state.scrollLeft === 'number' ? state.scrollLeft : undefined,
    scrollTop: typeof state.scrollTop === 'number' ? state.scrollTop : undefined,
  };
}

/** Put the reader back: scale, then page, then the exact offsets. */
export function applyViewState(state: PdfViewState, viewer: PDFViewer, container: HTMLElement | null, numPages: number): void {
  if (state.scaleValue) viewer.currentScaleValue = state.scaleValue;
  if (state.page && state.page >= 1 && state.page <= numPages) viewer.currentPageNumber = state.page;
  // The offsets come after the page jump: pdf.js scrolls to the page top at
  // once, then the exact reading position wins.
  if (container) {
    if (typeof state.scrollTop === 'number' && state.scrollTop > 0) container.scrollTop = state.scrollTop;
    if (typeof state.scrollLeft === 'number' && state.scrollLeft > 0) container.scrollLeft = state.scrollLeft;
  }
}
