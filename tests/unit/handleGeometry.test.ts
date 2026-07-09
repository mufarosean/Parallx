// @vitest-environment jsdom
//
// handleGeometry.test.ts — the single vertical-band geometry behind handle
// targeting.  jsdom has no layout, so rects are stubbed per element; the
// logic under test is exactly the band selection / own-line / nested-descent
// rules that decide which row's handle appears.

import { describe, expect, it } from 'vitest';
import {
  pickBandIndex,
  ownLineBand,
  pickListItemAtY,
  descendToRowAtY,
} from '../../src/built-in/canvas/handles/handleGeometry';

function stubRect(el: HTMLElement, top: number, bottom: number, left = 0, right = 100): void {
  el.getBoundingClientRect = () =>
    new DOMRect(left, top, right - left, bottom - top);
}

/**
 * Build a <li> row: content paragraph band [top, top+lineH], optional nested
 * rows below.  Returns the li; nested lists get real <ul> wrappers.
 */
function makeRow(doc: Document, label: string, top: number, lineH = 20): HTMLElement {
  const li = doc.createElement('li');
  li.dataset.label = label;
  const p = doc.createElement('p');
  p.textContent = label;
  li.appendChild(p);
  stubRect(p, top, top + lineH);
  stubRect(li, top, top + lineH); // grows when children are attached
  return li;
}

function attachNested(doc: Document, parent: HTMLElement, rows: HTMLElement[]): void {
  const ul = doc.createElement('ul');
  for (const r of rows) ul.appendChild(r);
  parent.appendChild(ul);
  const tops = rows.map((r) => r.getBoundingClientRect().top);
  const bottoms = rows.map((r) => r.getBoundingClientRect().bottom);
  stubRect(ul, Math.min(...tops), Math.max(...bottoms));
  // Parent li box now spans its own line through the last nested row.
  const pTop = parent.getBoundingClientRect().top;
  stubRect(parent, pTop, Math.max(...bottoms));
}

describe('pickBandIndex', () => {
  const bands = [
    { top: 0, bottom: 20 },
    { top: 25, bottom: 45 },
    { top: 50, bottom: 70 },
  ];

  it('containment wins outright', () => {
    expect(pickBandIndex(bands, 10)).toBe(0);
    expect(pickBandIndex(bands, 30)).toBe(1);
    expect(pickBandIndex(bands, 69)).toBe(2);
  });

  it('gap between bands → nearest edge', () => {
    expect(pickBandIndex(bands, 22)).toBe(0); // 2 below band0, 3 above band1
    expect(pickBandIndex(bands, 24)).toBe(1);
    expect(pickBandIndex(bands, 200)).toBe(2);
  });

  it('empty and zero-height bands', () => {
    expect(pickBandIndex([], 10)).toBeNull();
    expect(pickBandIndex([{ top: 5, bottom: 5 }], 10)).toBeNull();
  });
});

describe('descendToRowAtY — the nested-row handle fix', () => {
  it('cursor on the parent row\'s own line → parent', () => {
    const doc = document;
    const parent = makeRow(doc, 'parent', 0);
    const childA = makeRow(doc, 'childA', 25);
    const childB = makeRow(doc, 'childB', 50);
    attachNested(doc, parent, [childA, childB]);

    expect((descendToRowAtY(parent, 10) as HTMLElement).dataset.label).toBe('parent');
  });

  it('cursor at a NESTED row\'s Y (inside the parent box) → the nested row, not the parent', () => {
    const doc = document;
    const parent = makeRow(doc, 'parent', 0);
    const childA = makeRow(doc, 'childA', 25);
    const childB = makeRow(doc, 'childB', 50);
    attachNested(doc, parent, [childA, childB]);

    // Parent's full box is [0, 70] — the old full-rect containment kept the
    // parent for y=30/y=60; the own-line rule must land on the child rows.
    expect((descendToRowAtY(parent, 30) as HTMLElement).dataset.label).toBe('childA');
    expect((descendToRowAtY(parent, 60) as HTMLElement).dataset.label).toBe('childB');
  });

  it('descends recursively through multiple nesting levels', () => {
    const doc = document;
    const parent = makeRow(doc, 'parent', 0);
    const mid = makeRow(doc, 'mid', 25);
    const deep = makeRow(doc, 'deep', 50);
    attachNested(doc, mid, [deep]);
    attachNested(doc, parent, [mid]);

    expect((descendToRowAtY(parent, 30) as HTMLElement).dataset.label).toBe('mid');
    expect((descendToRowAtY(parent, 60) as HTMLElement).dataset.label).toBe('deep');
  });

  it('row without nested lists returns itself even when y is below its line', () => {
    const doc = document;
    const solo = makeRow(doc, 'solo', 0);
    expect((descendToRowAtY(solo, 500) as HTMLElement).dataset.label).toBe('solo');
  });
});

describe('pickListItemAtY', () => {
  it('picks the direct row whose band holds y (marker-gutter case)', () => {
    const doc = document;
    const ul = doc.createElement('ul');
    const r1 = makeRow(doc, 'one', 0);
    const r2 = makeRow(doc, 'two', 25);
    ul.appendChild(r1);
    ul.appendChild(r2);
    stubRect(ul, 0, 45);

    expect((pickListItemAtY(ul, 5) as HTMLElement).dataset.label).toBe('one');
    expect((pickListItemAtY(ul, 30) as HTMLElement).dataset.label).toBe('two');
    // gap → nearest
    expect((pickListItemAtY(ul, 23) as HTMLElement).dataset.label).toBe('two');
  });

  it('empty list → null', () => {
    const ul = document.createElement('ul');
    expect(pickListItemAtY(ul, 10)).toBeNull();
  });
});

describe('ownLineBand', () => {
  it('li → its content element band, not the full box', () => {
    const doc = document;
    const parent = makeRow(doc, 'parent', 0);
    const child = makeRow(doc, 'child', 25);
    attachNested(doc, parent, [child]);

    const band = ownLineBand(parent);
    expect(band.top).toBe(0);
    expect(band.bottom).toBe(20); // the paragraph line, NOT 45 (full box)
  });

  it('taskItem li → skips the checkbox label', () => {
    const doc = document;
    const li = doc.createElement('li');
    const label = doc.createElement('label');
    const content = doc.createElement('div');
    li.appendChild(label);
    li.appendChild(content);
    stubRect(label, 0, 16);
    stubRect(content, 2, 22);
    stubRect(li, 0, 60);

    const band = ownLineBand(li);
    expect(band.top).toBe(2);
    expect(band.bottom).toBe(22);
  });
});
