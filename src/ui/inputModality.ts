// inputModality.ts — whether the person is moving through the app by
// keyboard or by pointer, as `data-input-modality` on the root element.
//
// A focus ring is a keyboard user's cursor, but on a rich text field
// (a page title, a page body) Chromium matches :focus-visible on a click
// too, so a ring there would frame every paragraph clicked into. The
// stylesheet asks this instead: a key press (Tab, F6, an arrow) makes it
// "keyboard", a pointer press makes it "pointer".

import type { IDisposable } from '../platform/lifecycle.js';

export function installInputModality(doc: Document = document): IDisposable {
  const root = doc.documentElement;
  const set = (m: 'keyboard' | 'pointer'): void => { if (root.dataset.inputModality !== m) root.dataset.inputModality = m; };
  const onKey = (e: KeyboardEvent): void => { if (!e.ctrlKey && !e.metaKey && (e.key === 'Tab' || e.key === 'F6' || e.key.startsWith('Arrow') || e.key === 'Escape' || e.key === 'Home' || e.key === 'End')) set('keyboard'); };
  const onPointer = (): void => set('pointer');
  doc.addEventListener('keydown', onKey, true);
  doc.addEventListener('pointerdown', onPointer, true);
  return {
    dispose: () => {
      doc.removeEventListener('keydown', onKey, true);
      doc.removeEventListener('pointerdown', onPointer, true);
      delete root.dataset.inputModality;
    },
  };
}
