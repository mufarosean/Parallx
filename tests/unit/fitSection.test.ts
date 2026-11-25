// @vitest-environment jsdom
// fitSection.test.ts — a stacked section marked `data-section-fit` takes its
// content's height, up to a share of the container; the others share the rest.

import { describe, it, expect, afterEach } from 'vitest';
import { splitBodies } from '../../src/views/fitSection';

afterEach(() => { document.body.innerHTML = ''; });

/** A view element holding `rows` children of `rowHeight` px (jsdom lays nothing out, so the heights are given). */
function view(rows: number, rowHeight: number, fit: boolean): HTMLElement {
  const el = document.createElement('div');
  if (fit) el.setAttribute('data-section-fit', '');
  for (let i = 0; i < rows; i++) {
    const row = document.createElement('div');
    Object.defineProperty(row, 'offsetHeight', { value: rowHeight });
    el.appendChild(row);
  }
  document.body.appendChild(el);
  return el;
}

describe('splitBodies', () => {
  it('splits equally when no section is fitted', () => {
    const els: Record<string, HTMLElement> = { a: view(3, 26, false), b: view(40, 22, false) };
    const out = splitBodies(['a', 'b'], 600, 80, (id) => els[id]);
    expect([out.get('a'), out.get('b')]).toEqual([300, 300]);
  });

  it('gives a fitted section its rows and the other the rest', () => {
    const els: Record<string, HTMLElement> = { open: view(5, 26, true), files: view(40, 22, false) };
    const out = splitBodies(['open', 'files'], 600, 80, (id) => els[id]);
    expect(out.get('open')).toBe(130);
    expect(out.get('files')).toBe(470);
  });

  it('caps a long fitted section at two fifths of the container', () => {
    const els: Record<string, HTMLElement> = { open: view(30, 26, true), files: view(40, 22, false) };
    const out = splitBodies(['open', 'files'], 600, 80, (id) => els[id]);
    expect(out.get('open')).toBe(240);
    expect(out.get('files')).toBe(360);
  });

  it('finds the mark on a descendant of the view element', () => {
    const outer = document.createElement('div');
    outer.appendChild(view(2, 26, true));
    const els: Record<string, HTMLElement> = { open: outer, files: view(1, 22, false) };
    expect(splitBodies(['open', 'files'], 500, 80, (id) => els[id]).get('open')).toBe(52);
  });

  it('treats a fitted section alone as an ordinary one', () => {
    const els: Record<string, HTMLElement> = { open: view(2, 26, true) };
    expect(splitBodies(['open'], 500, 80, (id) => els[id]).get('open')).toBe(500);
  });
});
