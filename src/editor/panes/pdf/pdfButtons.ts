// pdfButtons.ts — the PDF pane's icon buttons, named once for screen readers
// and tooltips together.

import { declareControl } from '../../../ui/kit.js';
import { setupTooltip } from '../../../ui/tooltip.js';

/**
 * A toolbar button showing an icon (or text), named `title`. With an `id`
 * it is declared in the scene (docs/SELF_DESCRIBING_UI_DESIGN.md); the
 * `pressed` reader gives its on/off state when it has one.
 */
export function pdfButton(svgOrText: string, title: string, id?: string, pressed?: () => boolean): HTMLButtonElement {
  const b = document.createElement('button');
  b.classList.add('pdf-toolbar-btn');
  b.innerHTML = svgOrText;
  labelButton(b, title);
  if (id) declareControl(b, { id, label: title, kind: 'iconButton', ...(pressed ? { state: () => ({ kind: 'pressed', value: pressed() }) } : {}) });
  return b;
}

/** Name a button for screen readers and its tooltip, together. */
export function labelButton(b: HTMLElement, title: string): void {
  b.setAttribute('aria-label', title);
  setupTooltip(b, title);
}
