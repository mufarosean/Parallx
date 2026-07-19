// @vitest-environment jsdom
//
// scrollbarReveal.test.ts — the app-wide scrollbar visibility rule:
// a scrollable surface shows its thumb while hovered or actively scrolling.
// The controller toggles px-scrollbar-hover / px-scrollbar-scrolling on the
// scroll element; workbench.css keys thumb visibility off those classes.

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { installScrollbarReveal } from '../../src/ui/scrollbarReveal';
import type { IDisposable } from '../../src/platform/lifecycle';

/** Make an element report as scrollable (jsdom has no layout). */
function makeScrollable(el: HTMLElement): void {
  el.style.overflowY = 'auto';
  Object.defineProperty(el, 'scrollHeight', { value: 500, configurable: true });
  Object.defineProperty(el, 'clientHeight', { value: 100, configurable: true });
}

describe('scrollbarReveal', () => {
  let controller: IDisposable;
  let scroller: HTMLElement;
  let child: HTMLElement;
  let plain: HTMLElement;

  beforeEach(() => {
    vi.useFakeTimers();
    document.body.innerHTML = '';
    scroller = document.createElement('div');
    makeScrollable(scroller);
    child = document.createElement('p');
    scroller.appendChild(child);
    plain = document.createElement('div');
    document.body.appendChild(scroller);
    document.body.appendChild(plain);
    controller = installScrollbarReveal(document);
  });

  afterEach(() => {
    controller.dispose();
    vi.useRealTimers();
  });

  function hover(target: Element): void {
    target.dispatchEvent(new Event('pointerover', { bubbles: true }));
    vi.advanceTimersByTime(20); // flush the rAF-throttle (setTimeout fallback)
  }

  it('hovering a child marks the nearest scrollable ancestor', () => {
    hover(child);
    expect(scroller.classList.contains('px-scrollbar-hover')).toBe(true);
  });

  it('moving to a non-scrollable surface clears the mark', () => {
    hover(child);
    hover(plain);
    expect(scroller.classList.contains('px-scrollbar-hover')).toBe(false);
    expect(plain.classList.contains('px-scrollbar-hover')).toBe(false);
  });

  it('scrolling marks the element and the mark lingers, then clears', () => {
    scroller.dispatchEvent(new Event('scroll'));
    expect(scroller.classList.contains('px-scrollbar-scrolling')).toBe(true);

    vi.advanceTimersByTime(400);
    expect(scroller.classList.contains('px-scrollbar-scrolling')).toBe(true);

    // Continued scrolling keeps extending the linger.
    scroller.dispatchEvent(new Event('scroll'));
    vi.advanceTimersByTime(400);
    expect(scroller.classList.contains('px-scrollbar-scrolling')).toBe(true);

    vi.advanceTimersByTime(400);
    expect(scroller.classList.contains('px-scrollbar-scrolling')).toBe(false);
  });

  it('non-scrollable elements never get the hover mark', () => {
    hover(plain);
    expect(plain.classList.contains('px-scrollbar-hover')).toBe(false);
  });

  it('install is idempotent and dispose cleans all marks', () => {
    const second = installScrollbarReveal(document);
    hover(child);
    scroller.dispatchEvent(new Event('scroll'));
    expect(scroller.classList.contains('px-scrollbar-hover')).toBe(true);
    expect(scroller.classList.contains('px-scrollbar-scrolling')).toBe(true);

    second.dispose(); // no-op — first controller still owns the document
    hover(plain);
    hover(child);
    expect(scroller.classList.contains('px-scrollbar-hover')).toBe(true);

    controller.dispose();
    expect(scroller.classList.contains('px-scrollbar-hover')).toBe(false);
    expect(scroller.classList.contains('px-scrollbar-scrolling')).toBe(false);
    // Re-install works after dispose.
    controller = installScrollbarReveal(document);
    hover(child);
    expect(scroller.classList.contains('px-scrollbar-hover')).toBe(true);
  });
});
