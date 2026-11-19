// segmentedCards.test.ts — the kit's segmented switch drawn as cards: a
// segment with lines under its label (src/ui/segmentedControl.ts).
import { describe, it, expect } from 'vitest';
// @ts-expect-error — jsdom ships no types here
import { JSDOM } from 'jsdom';

const dom = new JSDOM('<!doctype html><html><body></body></html>', { pretendToBeVisual: true });
for (const key of ['window', 'document', 'HTMLElement', 'Node', 'Event', 'KeyboardEvent', 'MouseEvent']) (globalThis as any)[key] = key === 'window' ? dom.window : (dom.window as any)[key];
const { SegmentedControl } = await import('../../src/ui/segmentedControl');

describe('segments with lines under their label', () => {
  it('are cards, each a radio named by its label and its lines, one checked', () => {
    const host = document.createElement('div');
    const seen: string[] = [];
    const c = new SegmentedControl(host, { ariaLabel: 'The plan you follow', selected: 'Standard', segments: [{ value: 'Floor', label: 'Floor', detail: ['104 h', '96 under 200'] }, { value: 'Standard', label: 'Standard', detail: ['144 h', '56 under 200'] }] });
    c.onDidChange((v) => seen.push(v));
    expect(c.element.classList.contains('ui-segmented-control--cards')).toBe(true);
    const [floor, standard] = [...c.element.querySelectorAll<HTMLElement>('[role="radio"]')];
    expect([floor!.getAttribute('aria-label'), floor!.getAttribute('aria-checked'), standard!.getAttribute('aria-checked')]).toEqual(['Floor, 104 h, 96 under 200', 'false', 'true']);
    expect([...floor!.querySelectorAll('span')].map((s) => s.textContent)).toEqual(['Floor', '104 h', '96 under 200']);
    floor!.click();
    expect([seen, floor!.getAttribute('aria-checked')]).toEqual([['Floor'], 'true']);
  });

  it('without lines stay the switch they were: the label as the text, no name of their own', () => {
    const c = new SegmentedControl(document.createElement('div'), { ariaLabel: 'Mode', segments: [{ value: 'a', label: 'A' }, { value: 'b', label: 'B' }] });
    const a = c.element.querySelector('[role="radio"]')!;
    expect([c.element.classList.contains('ui-segmented-control--cards'), a.textContent, a.hasAttribute('aria-label')]).toEqual([false, 'A', false]);
  });
});
