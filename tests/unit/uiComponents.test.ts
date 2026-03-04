// @vitest-environment jsdom
// tests/unit/uiComponents.test.ts — M15 Group C: UI Primitives unit tests
//
// Validates Slider, Toggle, Dropdown, SegmentedControl, and Textarea
// UI components render and function correctly under jsdom.

import { describe, it, expect, beforeEach } from 'vitest';
import { Slider } from '../../src/ui/slider';
import { Toggle } from '../../src/ui/toggle';
import { Dropdown } from '../../src/ui/dropdown';
import { SegmentedControl } from '../../src/ui/segmentedControl';
import { Textarea } from '../../src/ui/textarea';

// ─── Helpers ─────────────────────────────────────────────────────────────────

function container(): HTMLElement {
  const el = document.createElement('div');
  document.body.appendChild(el);
  return el;
}

// ─── Slider ──────────────────────────────────────────────────────────────────

describe('Slider', () => {
  let parent: HTMLElement;

  beforeEach(() => {
    document.body.innerHTML = '';
    parent = container();
  });

  it('renders into the container', () => {
    const slider = new Slider(parent, { min: 0, max: 100, value: 50 });
    expect(parent.querySelector('.ui-slider')).toBeTruthy();
    expect(parent.querySelector('.ui-slider__input')).toBeTruthy();
    slider.dispose();
  });

  it('applies initial value', () => {
    const slider = new Slider(parent, { min: 0, max: 10, value: 7 });
    expect(slider.value).toBe(7);
    slider.dispose();
  });

  it('allows setting value programmatically', () => {
    const slider = new Slider(parent, { min: 0, max: 100, value: 0 });
    slider.value = 42;
    expect(slider.value).toBe(42);
    slider.dispose();
  });

  it('fires onDidChange on input event', () => {
    const slider = new Slider(parent, { min: 0, max: 100, value: 0 });
    const values: number[] = [];
    slider.onDidChange(v => values.push(v));

    const input = parent.querySelector('.ui-slider__input') as HTMLInputElement;
    input.value = '75';
    input.dispatchEvent(new Event('input'));

    expect(values).toEqual([75]);
    slider.dispose();
  });

  it('renders labeled stops', () => {
    const slider = new Slider(parent, {
      min: 0, max: 10, value: 5,
      labeledStops: [
        { value: 0, label: 'Low' },
        { value: 10, label: 'High' },
      ],
    });
    const stops = parent.querySelectorAll('.ui-slider__stop');
    expect(stops.length).toBe(2);
    slider.dispose();
  });

  it('applies disabled state', () => {
    const slider = new Slider(parent, { min: 0, max: 100, disabled: true });
    expect(slider.disabled).toBe(true);
    expect(parent.querySelector('.ui-slider--disabled')).toBeTruthy();

    slider.disabled = false;
    expect(slider.disabled).toBe(false);
    expect(parent.querySelector('.ui-slider--disabled')).toBeFalsy();
    slider.dispose();
  });

  it('defaults min to 0, max to 100', () => {
    const slider = new Slider(parent);
    const input = parent.querySelector('.ui-slider__input') as HTMLInputElement;
    expect(input.min).toBe('0');
    expect(input.max).toBe('100');
    slider.dispose();
  });
});

// ─── Toggle ──────────────────────────────────────────────────────────────────

describe('Toggle', () => {
  let parent: HTMLElement;

  beforeEach(() => {
    document.body.innerHTML = '';
    parent = container();
  });

  it('renders into the container', () => {
    const toggle = new Toggle(parent);
    expect(parent.querySelector('.ui-toggle')).toBeTruthy();
    toggle.dispose();
  });

  it('defaults to unchecked', () => {
    const toggle = new Toggle(parent);
    expect(toggle.checked).toBe(false);
    toggle.dispose();
  });

  it('respects initial checked option', () => {
    const toggle = new Toggle(parent, { checked: true });
    expect(toggle.checked).toBe(true);
    expect(parent.querySelector('.ui-toggle--checked')).toBeTruthy();
    toggle.dispose();
  });

  it('fires onDidChange on click', () => {
    const toggle = new Toggle(parent);
    const states: boolean[] = [];
    toggle.onDidChange(v => states.push(v));

    toggle.element.click();
    expect(states).toEqual([true]);

    toggle.element.click();
    expect(states).toEqual([true, false]);
    toggle.dispose();
  });

  it('toggles via keyboard (Space)', () => {
    const toggle = new Toggle(parent);
    const states: boolean[] = [];
    toggle.onDidChange(v => states.push(v));

    toggle.element.dispatchEvent(new KeyboardEvent('keydown', { key: ' ' }));
    expect(states).toEqual([true]);
    toggle.dispose();
  });

  it('toggles via keyboard (Enter)', () => {
    const toggle = new Toggle(parent);
    const states: boolean[] = [];
    toggle.onDidChange(v => states.push(v));

    toggle.element.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter' }));
    expect(states).toEqual([true]);
    toggle.dispose();
  });

  it('renders label text', () => {
    const toggle = new Toggle(parent, { label: 'Enable feature' });
    expect(parent.querySelector('.ui-toggle__label')?.textContent).toBe('Enable feature');
    toggle.dispose();
  });

  it('applies disabled state', () => {
    const toggle = new Toggle(parent, { disabled: true });
    expect(toggle.disabled).toBe(true);
    expect(parent.querySelector('.ui-toggle--disabled')).toBeTruthy();

    // Click should not fire on disabled toggle
    const states: boolean[] = [];
    toggle.onDidChange(v => states.push(v));
    toggle.element.click();
    expect(states).toEqual([]);
    toggle.dispose();
  });

  it('sets role="switch" and aria-checked', () => {
    const toggle = new Toggle(parent, { checked: true });
    expect(toggle.element.getAttribute('role')).toBe('switch');
    expect(toggle.element.getAttribute('aria-checked')).toBe('true');
    toggle.dispose();
  });
});

// ─── Dropdown ────────────────────────────────────────────────────────────────

describe('Dropdown', () => {
  let parent: HTMLElement;
  const items = [
    { value: 'a', label: 'Alpha' },
    { value: 'b', label: 'Beta' },
    { value: 'c', label: 'Charlie' },
  ];

  beforeEach(() => {
    document.body.innerHTML = '';
    parent = container();
  });

  it('renders into the container', () => {
    const dd = new Dropdown(parent, { items });
    expect(parent.querySelector('.ui-dropdown')).toBeTruthy();
    expect(parent.querySelector('.ui-dropdown__button')).toBeTruthy();
    dd.dispose();
  });

  it('shows placeholder when no selection', () => {
    const dd = new Dropdown(parent, { items, placeholder: 'Pick one' });
    const btn = parent.querySelector('.ui-dropdown__button') as HTMLElement;
    expect(btn.textContent).toContain('Pick one');
    dd.dispose();
  });

  it('shows selected label', () => {
    const dd = new Dropdown(parent, { items, selected: 'b' });
    const btn = parent.querySelector('.ui-dropdown__button') as HTMLElement;
    expect(btn.textContent).toContain('Beta');
    dd.dispose();
  });

  it('opens and closes on button click', () => {
    const dd = new Dropdown(parent, { items });
    const btn = parent.querySelector('.ui-dropdown__button') as HTMLElement;
    btn.click();
    expect(parent.querySelector('.ui-dropdown--open')).toBeTruthy();
    btn.click();
    expect(parent.querySelector('.ui-dropdown--open')).toBeFalsy();
    dd.dispose();
  });

  it('fires onDidChange when an item is clicked', () => {
    const dd = new Dropdown(parent, { items });
    const values: string[] = [];
    dd.onDidChange(v => values.push(v));

    // Open
    const btn = parent.querySelector('.ui-dropdown__button') as HTMLElement;
    btn.click();

    // Click second item
    const itemElements = parent.querySelectorAll('.ui-dropdown__item');
    (itemElements[1] as HTMLElement).click();

    expect(values).toEqual(['b']);
    expect(dd.value).toBe('b');
    dd.dispose();
  });

  it('closes on Escape key', () => {
    const dd = new Dropdown(parent, { items });
    const btn = parent.querySelector('.ui-dropdown__button') as HTMLElement;
    btn.click();
    expect(parent.querySelector('.ui-dropdown--open')).toBeTruthy();

    dd.element.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }));
    expect(parent.querySelector('.ui-dropdown--open')).toBeFalsy();
    dd.dispose();
  });

  it('applies disabled state', () => {
    const dd = new Dropdown(parent, { items, disabled: true });
    expect(dd.disabled).toBe(true);
    expect(parent.querySelector('.ui-dropdown--disabled')).toBeTruthy();
    dd.dispose();
  });

  it('allows updating items dynamically', () => {
    const dd = new Dropdown(parent, { items });
    dd.items = [{ value: 'x', label: 'X-ray' }];

    const btn = parent.querySelector('.ui-dropdown__button') as HTMLElement;
    btn.click();

    const itemElements = parent.querySelectorAll('.ui-dropdown__item');
    expect(itemElements.length).toBe(1);
    expect(itemElements[0].textContent).toBe('X-ray');
    dd.dispose();
  });
});

// ─── SegmentedControl ────────────────────────────────────────────────────────

describe('SegmentedControl', () => {
  let parent: HTMLElement;
  const segments = [
    { value: 'day', label: 'Day' },
    { value: 'week', label: 'Week' },
    { value: 'month', label: 'Month' },
  ];

  beforeEach(() => {
    document.body.innerHTML = '';
    parent = container();
  });

  it('renders into the container', () => {
    const sc = new SegmentedControl(parent, { segments });
    expect(parent.querySelector('.ui-segmented-control')).toBeTruthy();
    sc.dispose();
  });

  it('renders all segments', () => {
    const sc = new SegmentedControl(parent, { segments });
    const segs = parent.querySelectorAll('.ui-segmented-control__segment');
    expect(segs.length).toBe(3);
    sc.dispose();
  });

  it('selects the first segment by default', () => {
    const sc = new SegmentedControl(parent, { segments });
    expect(sc.value).toBe('day');
    expect(parent.querySelector('.ui-segmented-control__segment--active')?.textContent).toBe('Day');
    sc.dispose();
  });

  it('respects initial selected option', () => {
    const sc = new SegmentedControl(parent, { segments, selected: 'month' });
    expect(sc.value).toBe('month');
    sc.dispose();
  });

  it('fires onDidChange on segment click', () => {
    const sc = new SegmentedControl(parent, { segments });
    const values: string[] = [];
    sc.onDidChange(v => values.push(v));

    const segs = parent.querySelectorAll('.ui-segmented-control__segment');
    (segs[2] as HTMLElement).click();

    expect(values).toEqual(['month']);
    expect(sc.value).toBe('month');
    sc.dispose();
  });

  it('does not fire when clicking already-active segment', () => {
    const sc = new SegmentedControl(parent, { segments, selected: 'day' });
    const values: string[] = [];
    sc.onDidChange(v => values.push(v));

    const segs = parent.querySelectorAll('.ui-segmented-control__segment');
    (segs[0] as HTMLElement).click();

    expect(values).toEqual([]);
    sc.dispose();
  });

  it('uses role="radiogroup" on root', () => {
    const sc = new SegmentedControl(parent, { segments });
    expect(sc.element.getAttribute('role')).toBe('radiogroup');
    sc.dispose();
  });

  it('uses role="radio" on each segment', () => {
    const sc = new SegmentedControl(parent, { segments });
    const segs = parent.querySelectorAll('.ui-segmented-control__segment');
    segs.forEach(seg => {
      expect(seg.getAttribute('role')).toBe('radio');
    });
    sc.dispose();
  });

  it('applies disabled state', () => {
    const sc = new SegmentedControl(parent, { segments, disabled: true });
    expect(sc.disabled).toBe(true);
    expect(parent.querySelector('.ui-segmented-control--disabled')).toBeTruthy();
    sc.dispose();
  });

  it('sets value programmatically', () => {
    const sc = new SegmentedControl(parent, { segments });
    sc.value = 'week';
    expect(sc.value).toBe('week');
    sc.dispose();
  });
});

// ─── Textarea ────────────────────────────────────────────────────────────────

describe('Textarea', () => {
  let parent: HTMLElement;

  beforeEach(() => {
    document.body.innerHTML = '';
    parent = container();
  });

  it('renders into the container', () => {
    const ta = new Textarea(parent);
    expect(parent.querySelector('.ui-textarea')).toBeTruthy();
    expect(parent.querySelector('.ui-textarea__input')).toBeTruthy();
    ta.dispose();
  });

  it('applies initial value', () => {
    const ta = new Textarea(parent, { value: 'Hello world' });
    expect(ta.value).toBe('Hello world');
    ta.dispose();
  });

  it('applies placeholder', () => {
    const ta = new Textarea(parent, { placeholder: 'Type here...' });
    const el = parent.querySelector('.ui-textarea__input') as HTMLTextAreaElement;
    expect(el.placeholder).toBe('Type here...');
    ta.dispose();
  });

  it('applies rows option', () => {
    const ta = new Textarea(parent, { rows: 8 });
    const el = parent.querySelector('.ui-textarea__input') as HTMLTextAreaElement;
    expect(el.rows).toBe(8);
    ta.dispose();
  });

  it('defaults to 4 rows', () => {
    const ta = new Textarea(parent);
    const el = parent.querySelector('.ui-textarea__input') as HTMLTextAreaElement;
    expect(el.rows).toBe(4);
    ta.dispose();
  });

  it('fires onDidChange on input event', () => {
    const ta = new Textarea(parent);
    const values: string[] = [];
    ta.onDidChange(v => values.push(v));

    const el = parent.querySelector('.ui-textarea__input') as HTMLTextAreaElement;
    el.value = 'new text';
    el.dispatchEvent(new Event('input'));

    expect(values).toEqual(['new text']);
    ta.dispose();
  });

  it('fires onDidBlur on blur event', () => {
    const ta = new Textarea(parent);
    let blurred = false;
    ta.onDidBlur(() => { blurred = true; });

    const el = parent.querySelector('.ui-textarea__input') as HTMLTextAreaElement;
    el.dispatchEvent(new Event('blur'));

    expect(blurred).toBe(true);
    ta.dispose();
  });

  it('allows setting value programmatically', () => {
    const ta = new Textarea(parent);
    ta.value = 'programmatic';
    expect(ta.value).toBe('programmatic');
    ta.dispose();
  });

  it('applies readonly state', () => {
    const ta = new Textarea(parent, { readonly: true });
    expect(ta.readonly).toBe(true);
    expect(parent.querySelector('.ui-textarea--readonly')).toBeTruthy();

    ta.readonly = false;
    expect(ta.readonly).toBe(false);
    expect(parent.querySelector('.ui-textarea--readonly')).toBeFalsy();
    ta.dispose();
  });

  it('applies disabled state', () => {
    const ta = new Textarea(parent, { disabled: true });
    expect(ta.disabled).toBe(true);
    expect(parent.querySelector('.ui-textarea--disabled')).toBeTruthy();

    ta.disabled = false;
    expect(ta.disabled).toBe(false);
    expect(parent.querySelector('.ui-textarea--disabled')).toBeFalsy();
    ta.dispose();
  });

  it('applies aria-label', () => {
    const ta = new Textarea(parent, { ariaLabel: 'Description' });
    const el = parent.querySelector('.ui-textarea__input') as HTMLTextAreaElement;
    expect(el.getAttribute('aria-label')).toBe('Description');
    ta.dispose();
  });

  it('has working select method', () => {
    const ta = new Textarea(parent, { value: 'select me' });
    // Just ensure the method exists and doesn't throw
    expect(() => ta.select()).not.toThrow();
    ta.dispose();
  });
});
