// @vitest-environment jsdom
// mermaidThemeWatch.test.ts — one observer tells every diagram the page changed look.
//
// Each diagram node used to watch the root and the body with its own
// MutationObserver, reading the body's computed background on every
// attribute change. Now one observer serves every diagram: it starts with
// the first listener, tells each once per change, and stops with the last.

import { describe, it, expect, vi } from 'vitest';
import { onMermaidThemeChange, mermaidTheme } from '../../src/built-in/canvas/extensions/mermaidNode';

const tick = () => new Promise((r) => setTimeout(r, 0));

describe('onMermaidThemeChange', () => {
  it('tells every listener once when the page goes light, and not for changes that keep the look', async () => {
    document.body.style.backgroundColor = 'rgb(24, 25, 28)';
    expect(mermaidTheme()).toBe('dark');
    const a = vi.fn();
    const b = vi.fn();
    const offA = onMermaidThemeChange(a);
    const offB = onMermaidThemeChange(b);

    document.body.setAttribute('data-anything', '1'); // an attribute change with the same look
    await tick();
    expect(a).not.toHaveBeenCalled();

    document.body.style.backgroundColor = 'rgb(244, 245, 247)';
    await tick();
    expect(a).toHaveBeenCalledTimes(1);
    expect(a).toHaveBeenCalledWith('default');
    expect(b).toHaveBeenCalledTimes(1);

    offA();
    document.body.style.backgroundColor = 'rgb(24, 25, 28)';
    await tick();
    expect(a).toHaveBeenCalledTimes(1);
    expect(b).toHaveBeenCalledTimes(2);
    expect(b).toHaveBeenLastCalledWith('dark');

    offB();
    document.body.style.backgroundColor = 'rgb(244, 245, 247)';
    await tick();
    expect(b).toHaveBeenCalledTimes(2);
  });
});
