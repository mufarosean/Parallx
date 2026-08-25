// widgetAppearance.ts — per-instance look customization, host-agnostic.
//
// Extracted from DashboardEditorPane._applyAppearance so a widget seated
// in the WORKBENCH wears exactly the look the user gave it on a
// dashboard: same appearance object, same DOM writes, one implementation.

import type { WidgetAppearance } from './dashboardTypes.js';

export function applyWidgetAppearance(card: HTMLElement, a: WidgetAppearance): void {
  if (a.background === 'transparent') {
    card.style.background = 'transparent';
  } else if (a.background === 'custom' && a.backgroundColor) {
    card.style.background = a.backgroundColor;
  } else {
    card.style.removeProperty('background');
  }

  if (a.border === 'none') {
    card.style.border = 'none';
  } else if (a.border === 'custom' && a.borderColor) {
    card.style.border = `1px solid ${a.borderColor}`;
  } else {
    card.style.removeProperty('border');
  }

  // When the outer border is gone, the inner header/footer separators look
  // orphaned — drop them too so the card reads as a single clean surface.
  if (a.border === 'none') card.dataset.borderless = 'true';
  else delete card.dataset.borderless;

  // Title override + hide. Title text only updates when the element already
  // exists (it doesn't during the very first mount call — _mountWidget sets
  // the initial text itself); this branch drives live preview in the drawer.
  if (a.titleHidden) card.dataset.titleHidden = 'true';
  else delete card.dataset.titleHidden;
  const titleEl = card.querySelector<HTMLElement>('.dashboard-widget__title');
  if (titleEl) {
    titleEl.textContent = a.title?.trim() || titleEl.dataset.defaultTitle || '';
  }
}
