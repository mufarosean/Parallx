// @vitest-environment jsdom
// externalLinks.test.ts — a web or mail link never navigates the app's
// window: it opens outside, unless something else already handled it.
// docs/ACCESSIBILITY.md (Enter on a focused link is the same click).

import { describe, it, expect, vi } from 'vitest';
import { installExternalLinks } from '../../src/ui/externalLinks';

describe('external links', () => {
  it('opens a web link outside and keeps the window where it is', () => {
    const open = vi.spyOn(window, 'open').mockReturnValue(null);
    const guard = installExternalLinks(window);
    const a = document.createElement('a');
    a.href = 'https://ollama.com/';
    a.textContent = 'ollama.com';
    document.body.appendChild(a);
    const ev = new MouseEvent('click', { bubbles: true, cancelable: true });
    a.dispatchEvent(ev);
    expect(ev.defaultPrevented).toBe(true);
    expect(open).toHaveBeenCalledWith('https://ollama.com/', '_blank', 'noopener');

    // A link an editor handles itself is left to it.
    open.mockClear();
    a.addEventListener('click', (e) => e.preventDefault(), { once: true });
    a.dispatchEvent(new MouseEvent('click', { bubbles: true, cancelable: true }));
    expect(open).not.toHaveBeenCalled();
    guard.dispose();
    open.mockRestore();
  });
});
