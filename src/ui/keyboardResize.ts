// keyboardResize.ts — the keyboard's way to drag a divider.
//
// A pane with a divider of its own (a PDF's outline column, a split inside an
// extension's view) registers how it grows. View: Make Focused Area Wider,
// Narrower, Taller and Shorter ask the nearest registered pane around focus
// first, and only then move the workbench's own dividers.
// docs/ACCESSIBILITY.md, section 6.

import type { IDisposable } from '../platform/lifecycle.js';

export type ResizeAxis = 'width' | 'height';

export interface IKeyboardResizable {
  readonly axis: ResizeAxis;
  /** Grow by `delta` px (negative shrinks); false when it is at its limit. */
  resize(delta: number): boolean;
}

const targets = new WeakMap<Element, IKeyboardResizable[]>();

/** Let the resize keys reach a divider: while focus is inside `element`, they grow it. */
export function registerKeyboardResize(element: HTMLElement, target: IKeyboardResizable): IDisposable {
  const list = targets.get(element) ?? [];
  list.push(target);
  targets.set(element, list);
  return { dispose: () => { const l = targets.get(element); if (l) l.splice(l.indexOf(target) >>> 0, 1); } };
}

/**
 * Resize the nearest registered pane around focus along `axis`. True when a
 * pane owns the key (even at its limit, so the key never jumps to another divider).
 */
export function resizeFromFocus(axis: ResizeAxis, delta: number): boolean {
  for (let el: Element | null = document.activeElement; el; el = el.parentElement) {
    const t = targets.get(el)?.find((x) => x.axis === axis);
    if (t) { t.resize(delta); return true; }
  }
  return false;
}
