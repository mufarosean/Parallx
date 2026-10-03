/**
 * A part gliding open or shut (Layout._glidePart): its box moves in the
 * grid while its content holds its full size and rides the moving edge, and
 * a part gliding shut already reads as hidden.
 *
 * @vitest-environment jsdom
 */

import { describe, expect, it, beforeEach } from 'vitest';
import { Part } from '../../src/parts/part';
import { PartPosition } from '../../src/parts/partTypes';
import { Orientation } from '../../src/layout/layoutTypes';

class TestPart extends Part {
  contentLayouts: [number, number][] = [];
  constructor() {
    super('test.part', 'Test Part', PartPosition.Left, {
      minimumWidth: 170, maximumWidth: Infinity, minimumHeight: 80, maximumHeight: Infinity,
    });
  }
  protected override get hasTitleArea(): boolean { return true; }
  protected override createContent(): void { /* empty */ }
  protected override layoutContent(width: number, height: number): void {
    this.contentLayouts.push([width, height]);
  }
  get title(): HTMLElement { return this.element.querySelector('.part-title') as HTMLElement; }
}

describe('Part.holdContent', () => {
  let part: TestPart;

  beforeEach(() => {
    part = new TestPart();
    part.create(document.createElement('div'));
    part.layout(300, 600, Orientation.Horizontal);
    part.contentLayouts = [];
  });

  it('keeps the content at full width against the moving right edge while the box shrinks', () => {
    part.holdContent('width', 'end');
    part.layout(120, 600, Orientation.Horizontal);

    expect(part.element.style.width).toBe('120px');
    expect(part.width).toBe(300);
    expect(part.contentElement.style.width).toBe('300px');
    // Its right side follows the box's right side: it slides out to the left.
    expect(part.contentElement.style.transform).toBe('translateX(-180px)');
    expect(part.title.style.transform).toBe('translateX(-180px)');
    // No re-flow per frame.
    expect(part.contentLayouts).toEqual([]);
  });

  it('against a moving left edge the content stays put and the box clips it', () => {
    part.holdContent('width', 'start');
    part.layout(120, 600, Orientation.Horizontal);
    expect(part.contentElement.style.width).toBe('300px');
    expect(part.contentElement.style.transform).toBe('');
  });

  it('turns the minimum off along the glide only, so the box can pass through nothing', () => {
    part.holdContent('width', 'end');
    expect(part.minimumWidth).toBe(0);
    expect(part.minimumHeight).toBe(80);
    part.releaseContent();
    expect(part.minimumWidth).toBe(170);
  });

  it('along a height glide the content keeps its height under the title', () => {
    part.holdContent('height', 'start');
    part.layout(300, 100, Orientation.Vertical);
    expect(part.height).toBe(600);
    expect(part.width).toBe(300);
    expect(part.contentElement.style.flexGrow).toBe('0');
    expect(part.contentElement.style.flexShrink).toBe('0');
    expect(part.contentElement.style.height).toBe(`${600 - part.title.offsetHeight}px`);
  });

  it('holding again (a glide reversed mid-way) keeps the size first held', () => {
    part.holdContent('width', 'end');
    part.layout(120, 600, Orientation.Horizontal);
    part.holdContent('width', 'end');
    expect(part.width).toBe(300);
  });

  it('release hands the content the box size again and lays it out once', () => {
    const sizes: { width: number; height: number }[] = [];
    part.onDidChangeSize((d) => sizes.push(d));
    part.holdContent('width', 'end');
    part.layout(250, 600, Orientation.Horizontal);
    part.releaseContent();

    expect(part.width).toBe(250);
    expect(part.contentElement.style.width).toBe('');
    expect(part.contentElement.style.transform).toBe('');
    expect(part.contentLayouts).toEqual([[250, 600]]);
    expect(sizes).toEqual([{ width: 250, height: 600 }]);
  });
});

describe('Part.setLeaving', () => {
  let part: TestPart;
  let events: boolean[];

  beforeEach(() => {
    part = new TestPart();
    part.create(document.createElement('div'));
    events = [];
    part.onDidChangeVisibility((v) => events.push(v));
  });

  it('reads as hidden from the first frame, while it stays on screen', () => {
    part.setLeaving(true);
    expect(part.visible).toBe(false);
    expect(part.element.classList.contains('hidden')).toBe(false);
    expect(events).toEqual([false]);
  });

  it('landing hides it without announcing the hide twice', () => {
    part.setLeaving(true);
    part.setVisible(false);
    expect(part.element.classList.contains('hidden')).toBe(true);
    expect(events).toEqual([false]);
  });

  it('brought back mid-way it is shown again', () => {
    part.setLeaving(true);
    part.setLeaving(false);
    expect(part.visible).toBe(true);
    expect(events).toEqual([false, true]);
  });

  it('a shape restore that shows it ends the leaving', () => {
    part.setLeaving(true);
    part.setVisible(true);
    expect(part.visible).toBe(true);
    expect(events).toEqual([false, true]);
  });

  it('means nothing for a part already hidden', () => {
    part.setVisible(false);
    events = [];
    part.setLeaving(true);
    expect(events).toEqual([]);
  });
});
