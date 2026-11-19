// @vitest-environment jsdom
// A tooltip goes with its anchor: a control taken out of the page while the
// pointer is on it gets no mouseleave, and its tooltip must not stay floating
// over whatever replaced it (the Stop button's tooltip left over Study's
// first question).
import { describe, it, expect, vi, afterEach } from 'vitest';
import { installGlobalTooltipDelegate, setupTooltip, showTooltipNow } from '../../src/ui/tooltip';

const tip = () => document.querySelector<HTMLElement>('.parallx-tooltip');
const shown = () => !!tip() && tip()!.style.display !== 'none';
const hover = (el: Element) => el.dispatchEvent(new MouseEvent('mouseover', { bubbles: true }));

afterEach(() => { vi.useRealTimers(); document.body.replaceChildren(); });

describe('a tooltip whose anchor leaves the page', () => {
  it('a title tooltip that is up goes when its control is removed', async () => {
    vi.useFakeTimers();
    installGlobalTooltipDelegate();
    const view = document.createElement('div');
    const stop = document.createElement('button');
    stop.title = 'Stop writing. What is kept stays in the bank.';
    view.append(stop);
    document.body.append(view);
    hover(stop);
    await vi.advanceTimersByTimeAsync(1000);
    expect(shown()).toBe(true);
    // The view changes under the pointer: no mouseleave reaches the button.
    view.replaceChildren(document.createElement('article'));
    await vi.advanceTimersByTimeAsync(0);
    expect(shown()).toBe(false);
  });

  it('a pending tooltip never shows once its control is gone', async () => {
    vi.useFakeTimers();
    installGlobalTooltipDelegate();
    const btn = document.createElement('button');
    btn.title = 'Pending';
    document.body.append(btn);
    hover(btn);
    await vi.advanceTimersByTimeAsync(100);
    btn.remove();
    await vi.advanceTimersByTimeAsync(2000);
    expect(shown()).toBe(false);
  });

  it('the same holds for setupTooltip and for the tooltip shown at once', async () => {
    vi.useFakeTimers();
    const a = document.createElement('button');
    document.body.append(a);
    setupTooltip(a, 'Managed');
    a.dispatchEvent(new MouseEvent('mouseenter'));
    await vi.advanceTimersByTimeAsync(1000);
    expect(shown()).toBe(true);
    a.remove();
    await vi.advanceTimersByTimeAsync(0);
    expect(shown()).toBe(false);

    const b = document.createElement('button');
    document.body.append(b);
    showTooltipNow(b, 'Now');
    expect(shown()).toBe(true);
    b.remove();
    await vi.advanceTimersByTimeAsync(0);
    expect(shown()).toBe(false);
  });

  it('a tooltip whose control stays is not taken away by other changes', async () => {
    vi.useFakeTimers();
    installGlobalTooltipDelegate();
    const btn = document.createElement('button');
    btn.title = 'Stays';
    document.body.append(btn);
    hover(btn);
    await vi.advanceTimersByTimeAsync(1000);
    document.body.append(document.createElement('p'));
    await vi.advanceTimersByTimeAsync(0);
    expect(shown()).toBe(true);
  });
});
