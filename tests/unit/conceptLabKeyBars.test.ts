// @vitest-environment jsdom
// conceptLabKeyBars.test.ts — the Mean Machine's "Drag The Probability
// Mass" from the keyboard: the chart is a slider, Left/Right pick a bar,
// Up/Down change it (Shift: five steps), Home/End its least and most,
// clamped and on the step. docs/ACCESSIBILITY.md, section 6.

import { describe, expect, it } from 'vitest';

// @ts-expect-error — plain-JS extension module with no types
import { clKeyBars, svgEl } from '../../ext/concept-lab/dom.js';

describe('bars from the keyboard', () => {
  it('picks with Left/Right, steps with Up/Down, outlines the pick while focused', () => {
    const svg = svgEl('svg');
    const g = svgEl('g');
    svg.appendChild(g);
    for (let i = 0; i < 3; i++) g.appendChild(svgEl('rect'));
    document.body.appendChild(svg);
    const values = [0.1, 0.2, 0.58];
    clKeyBars(svg, g, {
      label: 'Probability mass', min: 0, max: 0.6, step: 0.01,
      read: () => values.map((v, i) => ({ value: v, label: `x = ${i}`, text: `${Math.round(v * 100)}%` })),
      write: (i: number, v: number) => { values[i] = v; },
    });
    expect(svg.getAttribute('role')).toBe('slider');
    expect(svg.getAttribute('tabindex')).toBe('0');
    (svg as unknown as HTMLElement).focus();
    const key = (k: string, init: KeyboardEventInit = {}) => svg.dispatchEvent(new KeyboardEvent('keydown', { key: k, bubbles: true, cancelable: true, ...init }));

    key('ArrowUp');
    expect(values[0]).toBeCloseTo(0.11, 9);
    key('ArrowRight');
    key('ArrowDown', { shiftKey: true });
    expect(values[1]).toBeCloseTo(0.15, 9);
    expect(g.children[1].getAttribute('stroke')).toBeTruthy();
    expect(g.children[0].getAttribute('stroke')).toBeNull();
    expect(svg.getAttribute('aria-valuetext')).toBe('x = 1: 15%');
    key('ArrowRight');
    key('ArrowUp', { shiftKey: true }); // 0.58 + 0.05, held at 0.6
    expect(values[2]).toBe(0.6);
    key('ArrowRight'); // no bar after the last
    key('Home');
    expect(values[2]).toBe(0);
    key('ArrowUp', { ctrlKey: true }); // not ours
    expect(values[2]).toBe(0);
  });
});
