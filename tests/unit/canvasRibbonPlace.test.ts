// @vitest-environment jsdom
// canvasRibbonPlace.test.ts — a canvas page open in two editor groups: each
// group's ribbon goes with that group's pane (src/built-in/canvas/ribbonPlace.ts).
import { describe, it, expect } from 'vitest';
import { nearest, paneOf } from '../../src/built-in/canvas/ribbonPlace.js';

function group(root: HTMLElement) {
  const g = root.appendChild(document.createElement('div'));
  const ribbon = g.appendChild(document.createElement('div'));
  const pane = g.appendChild(document.createElement('div')).appendChild(document.createElement('div'));
  return { ribbon, pane };
}

describe('ribbonPlace', () => {
  it('pairs each group\'s ribbon with its own pane', () => {
    const root = document.body.appendChild(document.createElement('div'));
    const a = group(root), b = group(root);
    expect(nearest(a.pane, [b.ribbon, a.ribbon])).toBe(a.ribbon);
    expect(nearest(b.pane, [a.ribbon, b.ribbon])).toBe(b.ribbon);
    expect(paneOf(b.ribbon, [a.pane, b.pane], [a.ribbon, b.ribbon])).toBe(b.pane);
  });

  it('gives no pane to a ribbon whose own group\'s pane is not made yet', () => {
    // The other group's kept pane of this page is nearest, but its own group's bar is nearer to it.
    const root = document.body.appendChild(document.createElement('div'));
    const a = group(root), b = group(root);
    expect(paneOf(b.ribbon, [a.pane], [a.ribbon, b.ribbon])).toBeUndefined();
  });
});
