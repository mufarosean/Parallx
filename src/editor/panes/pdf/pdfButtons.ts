// pdfButtons.ts — the PDF pane's icon buttons, named once for screen readers
// and tooltips together.

import { setupTooltip } from '../../../ui/tooltip.js';

/** A toolbar button showing an icon (or text), named `title`. */
export function pdfButton(svgOrText: string, title: string): HTMLButtonElement {
  const b = document.createElement('button');
  b.classList.add('pdf-toolbar-btn');
  b.innerHTML = svgOrText;
  labelButton(b, title);
  return b;
}

/** Name a button for screen readers and its tooltip, together. */
export function labelButton(b: HTMLElement, title: string): void {
  b.setAttribute('aria-label', title);
  setupTooltip(b, title);
}
