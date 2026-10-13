// @vitest-environment jsdom
// keepTabInside.test.ts — a modal dialog keeps Tab inside it (the Settings
// overlay, Planner's task and event popovers): past the last control focus
// goes round to the first, Shift+Tab from the first to the last, and a key
// from outside lands on the first. docs/ACCESSIBILITY.md, sections 1-2.

import { describe, expect, it } from 'vitest';
import { keepTabInside } from '../../src/ui/dom';

describe('keepTabInside', () => {
  it('goes round inside the dialog', () => {
    // jsdom lays nothing out: every element reports a box.
    const rects = HTMLElement.prototype.getClientRects;
    HTMLElement.prototype.getClientRects = function () { return [{}] as unknown as DOMRectList; };
    try {
      const pop = document.createElement('div');
      const [a, b, off] = ['button', 'input', 'button'].map((t) => pop.appendChild(document.createElement(t)));
      (off as HTMLButtonElement).disabled = true;
      document.body.appendChild(pop);
      keepTabInside(pop);
      const tab = (shiftKey = false) => {
        const e = new KeyboardEvent('keydown', { key: 'Tab', shiftKey, bubbles: true, cancelable: true });
        (document.activeElement as HTMLElement).dispatchEvent(e);
        return e.defaultPrevented;
      };
      b.focus();
      expect(tab()).toBe(true);
      expect(document.activeElement).toBe(a);
      expect(tab(true)).toBe(true);
      expect(document.activeElement).toBe(b);
      a.focus();
      expect(tab()).toBe(false); // the browser moves on to b itself
    } finally {
      HTMLElement.prototype.getClientRects = rects;
    }
  });
});
