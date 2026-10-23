// blockPrint.ts — a block's own print rendering.
//
// Most blocks print as a clone of what the editor shows. A block whose
// editor view is interactive (a board with tools and keys, a live layout)
// registers its own print rendering on its node view's DOM instead; the
// page export (canvas/export/printHtml) swaps the clone for that
// rendering, sized to the page.

/** The space one printed page gives content, in CSS pixels. */
export interface PrintBox {
  readonly width: number;
  readonly height: number;
}

/** A block's print rendering: its HTML, and the CSS that HTML needs (the
 *  print document carries no app stylesheet). Equal CSS strings are
 *  included once. */
export interface BlockPrint {
  readonly html: string;
  readonly css?: string;
}

export type BlockPrintRenderer = (page: PrintBox) => BlockPrint;

/** Marks a DOM element that carries a print renderer (survives cloning). */
export const PRINT_RENDER_ATTR = 'data-print-render';
const PRINT_RENDER_KEY = '__parallxPrint';

/** Give a node view's DOM its own print rendering. */
export function setBlockPrintRenderer(dom: HTMLElement, render: BlockPrintRenderer): void {
  dom.setAttribute(PRINT_RENDER_ATTR, '');
  (dom as unknown as Record<string, unknown>)[PRINT_RENDER_KEY] = render;
}

/** The print renderer an element carries, if any. */
export function blockPrintRenderer(el: Element | undefined): BlockPrintRenderer | null {
  const render = (el as unknown as Record<string, unknown> | undefined)?.[PRINT_RENDER_KEY];
  return typeof render === 'function' ? render as BlockPrintRenderer : null;
}
