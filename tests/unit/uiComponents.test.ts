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

    // Click second item. Queried from `document`, not `parent`: the open list is
    // mounted in a body-level fixed layer so it is not clipped by scrolling
    // ancestors — see the class comment in dropdown.ts.
    const itemElements = document.querySelectorAll('.ui-dropdown__item');
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

    const itemElements = document.querySelectorAll('.ui-dropdown__item');
    expect(itemElements.length).toBe(1);
    expect(itemElements[0].textContent).toBe('X-ray');
    dd.dispose();
  });

  // ── The list lives in a body-level layer ──
  //
  // Not a style preference. An absolutely-positioned list inside the wrapper is
  // clipped by any ancestor with `overflow` other than `visible`, so a dropdown
  // in a scrolling table had its options cut off. That limitation is why
  // hand-rolled clones of this component existed; these tests keep it closed.

  it('mounts the open list on document.body, not inside the wrapper', () => {
    const dd = new Dropdown(parent, { items });
    (parent.querySelector('.ui-dropdown__button') as HTMLElement).click();
    const list = document.querySelector('.ui-dropdown__list')!;
    expect(list.parentElement).toBe(document.body);
    expect(parent.querySelector('.ui-dropdown__list')).toBeNull();
    dd.dispose();
  });

  it('removes the list from the DOM when closed', () => {
    const dd = new Dropdown(parent, { items });
    const btn = parent.querySelector('.ui-dropdown__button') as HTMLElement;
    btn.click();
    expect(document.querySelector('.ui-dropdown__list')).not.toBeNull();
    btn.click();
    expect(document.querySelector('.ui-dropdown__list')).toBeNull();
    dd.dispose();
  });

  it('does not leave an orphaned list on body after dispose', () => {
    const dd = new Dropdown(parent, { items });
    (parent.querySelector('.ui-dropdown__button') as HTMLElement).click();
    dd.dispose();
    expect(document.querySelector('.ui-dropdown__list')).toBeNull();
  });

  it('treats a click on an option as inside, not as an outside dismissal', () => {
    // The list is no longer a descendant of the wrapper, so an outside-click
    // check written only against `element` would close the list on mousedown and
    // the option's own click handler would never run.
    const dd = new Dropdown(parent, { items });
    const values: string[] = [];
    dd.onDidChange(v => values.push(v));
    (parent.querySelector('.ui-dropdown__button') as HTMLElement).click();

    const item = document.querySelectorAll('.ui-dropdown__item')[2] as HTMLElement;
    item.dispatchEvent(new MouseEvent('mousedown', { bubbles: true }));
    expect(document.querySelector('.ui-dropdown__list'), 'closed before the click landed').not.toBeNull();
    item.click();
    expect(values).toEqual(['c']);
    dd.dispose();
  });

  // ── Scrolling the list must not dismiss it ──

  it('stays open when the scroll event comes from inside the list', () => {
    // THE bug this component's hand-rolled clone shipped with: a capture-phase
    // window scroll listener fires for events targeting descendants, so an
    // unguarded close() made a scrollable list impossible to scroll.
    const dd = new Dropdown(parent, { items });
    (parent.querySelector('.ui-dropdown__button') as HTMLElement).click();
    const list = document.querySelector('.ui-dropdown__list')!;

    list.dispatchEvent(new Event('scroll', { bubbles: false }));
    expect(document.querySelector('.ui-dropdown__list'), 'scrolling the list dismissed it').not.toBeNull();
    dd.dispose();
  });

  it('stays open when the scroll targets an option inside the list', () => {
    const dd = new Dropdown(parent, { items });
    (parent.querySelector('.ui-dropdown__button') as HTMLElement).click();
    document.querySelector('.ui-dropdown__item')!.dispatchEvent(new Event('scroll', { bubbles: false }));
    expect(document.querySelector('.ui-dropdown__list')).not.toBeNull();
    dd.dispose();
  });

  it('closes when something outside the list scrolls', () => {
    // The other half: the list is position:fixed against the trigger's viewport
    // rect, so a real page scroll has to dismiss it or it floats away from its
    // trigger.
    const dd = new Dropdown(parent, { items });
    (parent.querySelector('.ui-dropdown__button') as HTMLElement).click();
    parent.dispatchEvent(new Event('scroll', { bubbles: false }));
    expect(document.querySelector('.ui-dropdown__list')).toBeNull();
    dd.dispose();
  });

  it('closes on window resize', () => {
    const dd = new Dropdown(parent, { items });
    (parent.querySelector('.ui-dropdown__button') as HTMLElement).click();
    window.dispatchEvent(new Event('resize'));
    expect(document.querySelector('.ui-dropdown__list')).toBeNull();
    dd.dispose();
  });

  it('unhooks its window listeners on dispose', () => {
    const dd = new Dropdown(parent, { items });
    dd.dispose();
    // A leaked capture listener would keep reacting to every scroll in the app.
    expect(() => document.dispatchEvent(new Event('scroll'))).not.toThrow();
  });

  // ── Placeholder ──

  it('keeps the placeholder after the value is cleared', () => {
    // Regression: the placeholder used to be a parameter supplied only by the
    // constructor, so the first `value =` assignment blanked the trigger.
    const dd = new Dropdown(parent, { items, selected: 'b', placeholder: 'Pick one' });
    const btn = parent.querySelector('.ui-dropdown__button') as HTMLElement;
    expect(btn.textContent).toContain('Beta');
    dd.value = undefined;
    expect(btn.textContent).toContain('Pick one');
    dd.dispose();
  });

  it('keeps the placeholder after the items are replaced', () => {
    const dd = new Dropdown(parent, { items, selected: 'b', placeholder: 'Pick one' });
    const btn = parent.querySelector('.ui-dropdown__button') as HTMLElement;
    dd.items = [{ value: 'z', label: 'Zulu' }];   // 'b' no longer exists
    expect(btn.textContent).toContain('Pick one');
    dd.dispose();
  });

  it('marks the trigger label as a placeholder so it can be styled muted', () => {
    const dd = new Dropdown(parent, { items, placeholder: 'Pick one' });
    const label = parent.querySelector('.ui-dropdown__label')!;
    expect(label.classList.contains('ui-dropdown__label--placeholder')).toBe(true);
    dd.value = 'a';
    expect(label.classList.contains('ui-dropdown__label--placeholder')).toBe(false);
    dd.dispose();
  });

  // ── Colour swatches ──

  it('renders a swatch per coloured option and on the trigger', () => {
    // Budget categories are identified by colour; without this the extension had
    // to keep its own dropdown.
    const dd = new Dropdown(parent, {
      items: [
        { value: 'g', label: 'Groceries', color: '#5cb87a' },
        { value: 'd', label: 'Dining', color: '#e8924a' },
      ],
      selected: 'g',
    });
    expect(parent.querySelector('.ui-dropdown__swatch')).not.toBeNull();
    (parent.querySelector('.ui-dropdown__button') as HTMLElement).click();
    expect(document.querySelectorAll('.ui-dropdown__list .ui-dropdown__swatch')).toHaveLength(2);
    dd.dispose();
  });

  it('drops the trigger swatch when moving to a colourless option', () => {
    const dd = new Dropdown(parent, {
      items: [
        { value: '', label: '— Uncategorized —' },
        { value: 'g', label: 'Groceries', color: '#5cb87a' },
      ],
      selected: 'g',
    });
    expect(parent.querySelector('.ui-dropdown__swatch')).not.toBeNull();
    dd.value = '';
    expect(parent.querySelector('.ui-dropdown__swatch')).toBeNull();
    dd.dispose();
  });

  it('does not accumulate swatches across repeated value changes', () => {
    const dd = new Dropdown(parent, {
      items: [
        { value: 'g', label: 'Groceries', color: '#5cb87a' },
        { value: 'd', label: 'Dining', color: '#e8924a' },
      ],
      selected: 'g',
    });
    dd.value = 'd';
    dd.value = 'g';
    dd.value = 'd';
    expect(parent.querySelectorAll('.ui-dropdown__button .ui-dropdown__swatch')).toHaveLength(1);
    dd.dispose();
  });

  it('keeps labels readable when an option has no colour', () => {
    const dd = new Dropdown(parent, { items });
    (parent.querySelector('.ui-dropdown__button') as HTMLElement).click();
    const first = document.querySelector('.ui-dropdown__item')!;
    expect(first.querySelector('.ui-dropdown__swatch')).toBeNull();
    expect(first.textContent).toBe('Alpha');
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
