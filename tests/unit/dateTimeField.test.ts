// @vitest-environment jsdom
// The app's date and time fields: parsing and day arithmetic that no time
// zone can shift, the kit contract, and the pickers by keyboard.
import { describe, it, expect, beforeEach } from 'vitest';
import { addDays, addMonths, parseYmd, formatYmd, parseTime, nearestStep, TIME_STEPS } from '../../src/ui/dateTimeField';
import { createDateField, createTimeField, createSurface } from '../../src/ui/kit';
import { scene } from '../../src/ui/scene';

describe('date helpers', () => {
  it('parses and writes YYYY-MM-DD, refusing days that do not exist', () => {
    expect(parseYmd('2026-10-15')).toEqual({ y: 2026, m: 9, d: 15 });
    expect(parseYmd('2026-02-30')).toBeNull();
    expect(parseYmd('15/10/2026')).toBeNull();
    expect(formatYmd({ y: 2026, m: 0, d: 5 })).toBe('2026-01-05');
  });
  it('moves by days across months and years, and by months held to the month end', () => {
    expect(addDays({ y: 2026, m: 11, d: 31 }, 1)).toEqual({ y: 2027, m: 0, d: 1 });
    expect(addDays({ y: 2026, m: 2, d: 1 }, -1)).toEqual({ y: 2026, m: 1, d: 28 });
    expect(addMonths({ y: 2026, m: 0, d: 31 }, 1)).toEqual({ y: 2026, m: 1, d: 28 });
    expect(addMonths({ y: 2026, m: 0, d: 15 }, -1)).toEqual({ y: 2025, m: 11, d: 15 });
  });
});

describe('parseTime', () => {
  it('reads the ways people type a time', () => {
    expect(parseTime('2:30 pm')).toBe('14:30');
    expect(parseTime('2.30p')).toBe('14:30');
    expect(parseTime('12am')).toBe('00:00');
    expect(parseTime('12 PM')).toBe('12:00');
    expect(parseTime('1430')).toBe('14:30');
    expect(parseTime('9')).toBe('09:00');
    expect(parseTime('noon')).toBe('12:00');
  });
  it('refuses what is not a time', () => {
    expect(parseTime('25:00')).toBeNull();
    expect(parseTime('13pm')).toBeNull();
    expect(parseTime('2:75')).toBeNull();
    expect(parseTime('soon')).toBeNull();
  });
  it('finds the 15-minute step at or before a time', () => {
    expect(TIME_STEPS[nearestStep('14:37')]).toBe('14:30');
    expect(TIME_STEPS[nearestStep('00:00')]).toBe('00:00');
  });
});

describe('kit date and time fields', () => {
  let host: HTMLElement;
  beforeEach(() => {
    document.body.innerHTML = '';
    scene.reset();
    host = document.createElement('div');
    document.body.appendChild(host);
    createSurface(host, { id: 'test', owner: 'core', label: 'Test' });
  });
  const key = (el: Element, k: string) => el.dispatchEvent(new KeyboardEvent('keydown', { key: k, bubbles: true, cancelable: true }));

  it('a date field is one input in the scene, named with its value, and picks a day by keyboard', () => {
    const changes: string[] = [];
    const f = createDateField(host, { id: 'test.due', label: 'Due date', value: '2026-10-15', onChange: (v) => changes.push(v) });
    expect(f.element.getAttribute('data-px-id')).toBe('test.due');
    expect(f.element.getAttribute('aria-haspopup')).toBe('dialog');
    expect(f.element.getAttribute('aria-label')).toMatch(/^Due date, /);
    expect(scene.find('test.due')[0].state?.()).toEqual({ kind: 'value', value: '2026-10-15' });

    f.element.click();
    expect(f.element.getAttribute('aria-expanded')).toBe('true');
    const grid = document.querySelector('.px-datepicker [role="grid"]')!;
    expect(document.activeElement?.getAttribute('aria-selected')).toBe('true');
    key(grid, 'ArrowRight');
    key(document.querySelector('.px-datepicker [role="grid"]')!, 'ArrowDown');
    key(document.querySelector('.px-datepicker [role="grid"]')!, 'Enter');
    expect(f.value).toBe('2026-10-23');
    expect(changes).toEqual(['2026-10-23']);
    expect(document.querySelector('.px-datepicker')).toBeNull();
    expect(document.activeElement).toBe(f.element);
  });

  it('Page Down moves a month, held to its last day', () => {
    const f = createDateField(host, { id: 'test.d', label: 'Date', value: '2026-01-31' });
    f.element.click();
    key(document.querySelector('.px-datepicker [role="grid"]')!, 'PageDown');
    key(document.querySelector('.px-datepicker [role="grid"]')!, 'Enter');
    expect(f.value).toBe('2026-02-28');
  });

  it('a time field takes a typed time, or the highlighted step, and can be disabled', () => {
    const f = createTimeField(host, { id: 'test.t', label: 'Due time', value: '09:00' });
    f.element.click();
    const input = document.querySelector<HTMLInputElement>('.px-timepicker__input')!;
    expect(document.activeElement).toBe(input);
    input.value = '2:45 pm';
    input.dispatchEvent(new Event('input'));
    key(input, 'Enter');
    expect(f.value).toBe('14:45');
    f.element.click();
    const input2 = document.querySelector<HTMLInputElement>('.px-timepicker__input')!;
    key(input2, 'ArrowDown');
    key(input2, 'Enter');
    expect(f.value).toBe('15:00');
    f.disabled = true;
    f.element.click();
    expect(document.querySelector('.px-timepicker')).toBeNull();
  });
});
