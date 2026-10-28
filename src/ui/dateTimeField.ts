// dateTimeField.ts — the app's own date and time fields.
//
// Chromium's <input type="date|time"> draws its own calendar and spinner in
// the operating system's style, not the app's, and reads oddly to a screen
// reader. These are buttons that show the value in words and open a picker
// drawn with the app's tokens:
//
//   DateField: a month grid. Arrows move a day or a week, Page Up/Down a
//   month, Home/End the week's ends, Enter picks, Escape closes; Today jumps.
//   TimeField: a field to type a time ("2:30 pm", "1430", "9") over a list
//   in 15-minute steps. Up/Down move the list, Enter picks, Escape closes.
//
// Values are plain strings, as the native inputs had: YYYY-MM-DD and HH:MM.
// Day arithmetic is done on UTC dates, so no time zone can shift a day.

import { Disposable, toDisposable } from '../platform/lifecycle.js';
import { Emitter, type Event } from '../platform/events.js';
import { attachPopupDismiss, layoutPopup } from './dom.js';
import { createIconElement } from './iconRegistry.js';
import './dateTimeField.css';

const DAY_MS = 86_400_000;

// ─── Pure helpers (tested) ───────────────────────────────────────────────────

export interface Ymd { readonly y: number; readonly m: number; readonly d: number }

export function parseYmd(value: string): Ymd | null {
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(value ?? '');
  if (!m) return null;
  const ymd = { y: +m[1], m: +m[2] - 1, d: +m[3] };
  const t = new Date(Date.UTC(ymd.y, ymd.m, ymd.d));
  return t.getUTCMonth() === ymd.m && t.getUTCDate() === ymd.d ? ymd : null;
}

export function formatYmd(d: Ymd): string {
  return `${String(d.y).padStart(4, '0')}-${String(d.m + 1).padStart(2, '0')}-${String(d.d).padStart(2, '0')}`;
}

export function addDays(d: Ymd, n: number): Ymd {
  const t = new Date(Date.UTC(d.y, d.m, d.d) + n * DAY_MS);
  return { y: t.getUTCFullYear(), m: t.getUTCMonth(), d: t.getUTCDate() };
}

/** The same day of the month `n` months on, held to the month's last day. */
export function addMonths(d: Ymd, n: number): Ymd {
  const first = new Date(Date.UTC(d.y, d.m + n, 1));
  const last = new Date(Date.UTC(first.getUTCFullYear(), first.getUTCMonth() + 1, 0)).getUTCDate();
  return { y: first.getUTCFullYear(), m: first.getUTCMonth(), d: Math.min(d.d, last) };
}

const weekday = (d: Ymd): number => new Date(Date.UTC(d.y, d.m, d.d)).getUTCDay();
const sameDay = (a: Ymd | null, b: Ymd | null): boolean => !!a && !!b && a.y === b.y && a.m === b.m && a.d === b.d;
const utcFmt = (opts: Intl.DateTimeFormatOptions) => new Intl.DateTimeFormat(undefined, { ...opts, timeZone: 'UTC' });

/** "Thu, Oct 15, 2026". */
export function dateWords(d: Ymd, opts: Intl.DateTimeFormatOptions = { weekday: 'short', month: 'short', day: 'numeric', year: 'numeric' }): string {
  return utcFmt(opts).format(Date.UTC(d.y, d.m, d.d));
}

/**
 * A typed time as HH:MM, or null: "2", "2pm", "2:30 pm", "2.30p", "14:30",
 * "1430", "noon", "midnight". A bare hour from 1 to 11 without am/pm reads as
 * written in a 24-hour day (2 is 02:00), like the native field.
 */
export function parseTime(text: string): string | null {
  const t = String(text ?? '').trim().toLowerCase().replace(/\s+/g, '');
  if (!t) return null;
  if (t === 'noon') return '12:00';
  if (t === 'midnight') return '00:00';
  const m = /^(\d{1,2})(?:[:.h]?(\d{2}))?(a|am|p|pm)?$/.exec(t);
  if (!m) return null;
  let h = +m[1];
  const min = m[2] ? +m[2] : 0;
  const ap = m[3];
  if (min > 59) return null;
  if (ap) {
    if (h < 1 || h > 12) return null;
    if (h === 12) h = 0;
    if (ap.startsWith('p')) h += 12;
  } else if (h > 23) return null;
  return `${String(h).padStart(2, '0')}:${String(min).padStart(2, '0')}`;
}

/** "2:30 PM" for "14:30", in the system's own hour format. */
export function timeWords(hhmm: string): string {
  const [h, m] = hhmm.split(':').map(Number);
  return utcFmt({ hour: 'numeric', minute: '2-digit' }).format(Date.UTC(1970, 0, 1, h, m));
}

// ─── The field button both share ─────────────────────────────────────────────

abstract class PickerField extends Disposable {
  readonly element: HTMLButtonElement;
  private readonly _text: HTMLSpanElement;
  protected _popup: HTMLElement | null = null;
  private _detach: (() => void) | null = null;
  protected readonly _onDidChange = this._register(new Emitter<string>());
  readonly onDidChange: Event<string> = this._onDidChange.event;

  constructor(container: HTMLElement | null, protected readonly _label: string, icon: string, popupRole: 'dialog' | 'listbox') {
    super();
    this.element = document.createElement('button');
    this.element.type = 'button';
    this.element.className = 'px-pickfield';
    this.element.setAttribute('aria-haspopup', popupRole);
    this.element.setAttribute('aria-expanded', 'false');
    this._text = document.createElement('span');
    this._text.className = 'px-pickfield__text';
    this.element.append(this._text, createIconElement(icon, 14));
    this.element.addEventListener('click', () => (this._popup ? this.close() : this.open()));
    this.element.addEventListener('keydown', (e) => {
      if ((e.key === 'ArrowDown' || (e.altKey && e.key === 'ArrowDown')) && !this._popup) { e.preventDefault(); this.open(); }
    });
    container?.appendChild(this.element);
    this._register(toDisposable(() => { this.close(false); this.element.remove(); }));
  }

  get disabled(): boolean { return this.element.disabled; }
  set disabled(v: boolean) { this.element.disabled = v; if (v) this.close(false); }

  /** `words` on the field; `spoken` (when longer) for screen readers. */
  protected _show(words: string, spoken = words): void {
    this._text.textContent = words;
    this.element.setAttribute('aria-label', `${this._label}, ${spoken}`);
  }

  protected abstract _build(popup: HTMLElement): HTMLElement | null;

  open(): void {
    if (this._popup || this.element.disabled) return;
    const popup = document.createElement('div');
    popup.className = 'px-picker';
    document.body.appendChild(popup);
    this._popup = popup;
    const focusFirst = this._build(popup);
    layoutPopup(popup, this.element.getBoundingClientRect(), { position: 'below', gap: 4 });
    this._detach = attachPopupDismiss([popup, this.element], () => this.close(true));
    this.element.setAttribute('aria-expanded', 'true');
    focusFirst?.focus();
  }

  close(returnFocus = true): void {
    if (!this._popup) return;
    const hadFocus = this._popup.contains(document.activeElement);
    this._popup.remove();
    this._popup = null;
    this._detach?.();
    this._detach = null;
    this.element.setAttribute('aria-expanded', 'false');
    if (returnFocus || hadFocus) this.element.focus();
  }
}

// ─── DateField ───────────────────────────────────────────────────────────────

export class DateField extends PickerField {
  private _value: Ymd;
  /** The day the keyboard is on inside the open grid. */
  private _cursor: Ymd;

  constructor(container: HTMLElement | null, options: { value: string; ariaLabel: string }) {
    super(container, options.ariaLabel, 'calendar', 'dialog');
    this._value = parseYmd(options.value) ?? today();
    this._cursor = this._value;
    this._showDate(this._value);
  }

  /** The year only when it is not this one, so the field stays short. */
  private _showDate(d: Ymd): void {
    const full = dateWords(d);
    this._show(d.y === today().y ? dateWords(d, { weekday: 'short', month: 'short', day: 'numeric' }) : full, full);
  }

  get value(): string { return formatYmd(this._value); }
  set value(v: string) {
    const d = parseYmd(v);
    if (!d) return;
    this._value = d;
    this._showDate(d);
  }

  private _pick(d: Ymd): void {
    const changed = !sameDay(d, this._value);
    this.value = formatYmd(d);
    this.close(true);
    if (changed) this._onDidChange.fire(this.value);
  }

  protected _build(popup: HTMLElement): HTMLElement | null {
    popup.classList.add('px-datepicker');
    popup.setAttribute('role', 'dialog');
    popup.setAttribute('aria-label', `Choose ${this._label.toLowerCase()}`);
    this._cursor = this._value;
    return this._paint(popup);
  }

  /** Draw the month holding the cursor; returns the day button to focus. */
  private _paint(popup: HTMLElement): HTMLElement {
    popup.replaceChildren();
    const c = this._cursor;
    const head = document.createElement('div');
    head.className = 'px-datepicker__head';
    const title = document.createElement('span');
    title.className = 'px-datepicker__title';
    title.setAttribute('aria-live', 'polite');
    title.textContent = utcFmt({ month: 'long', year: 'numeric' }).format(Date.UTC(c.y, c.m, 1));
    const nav = (icon: string, label: string, n: number): HTMLButtonElement => {
      const b = document.createElement('button');
      b.type = 'button';
      b.className = 'px-btn px-btn--ghost px-btn--icon px-btn--sm';
      b.setAttribute('aria-label', label);
      b.title = label;
      b.appendChild(createIconElement(icon, 14));
      // The month is drawn again, so focus goes to the new copy of this button.
      b.addEventListener('click', () => { this._cursor = addMonths(this._cursor, n); this._paint(popup); popup.querySelector<HTMLButtonElement>(`[aria-label="${label}"]`)?.focus(); });
      return b;
    };
    head.append(nav('chevron-left', 'Previous Month', -1), title, nav('chevron-right', 'Next Month', 1));
    popup.appendChild(head);

    const grid = document.createElement('div');
    grid.className = 'px-datepicker__grid';
    grid.setAttribute('role', 'grid');
    grid.setAttribute('aria-label', title.textContent ?? '');
    const first = { y: c.y, m: c.m, d: 1 };
    const start = addDays(first, -weekday(first));
    const headRow = document.createElement('div');
    headRow.setAttribute('role', 'row');
    headRow.className = 'px-datepicker__row';
    for (let i = 0; i < 7; i++) {
      const h = document.createElement('span');
      h.setAttribute('role', 'columnheader');
      h.className = 'px-datepicker__dow';
      const day = addDays(start, i);
      h.textContent = dateWords(day, { weekday: 'narrow' });
      h.setAttribute('aria-label', dateWords(day, { weekday: 'long' }));
      headRow.appendChild(h);
    }
    grid.appendChild(headRow);
    const now = today();
    let focus: HTMLButtonElement | null = null;
    for (let w = 0; w < 6; w++) {
      const row = document.createElement('div');
      row.setAttribute('role', 'row');
      row.className = 'px-datepicker__row';
      for (let i = 0; i < 7; i++) {
        const d = addDays(start, w * 7 + i);
        const b = document.createElement('button');
        b.type = 'button';
        b.setAttribute('role', 'gridcell');
        b.className = 'px-datepicker__day';
        b.textContent = String(d.d);
        b.setAttribute('aria-label', dateWords(d, { weekday: 'long', month: 'long', day: 'numeric', year: 'numeric' }));
        if (d.m !== c.m) b.classList.add('px-datepicker__day--out');
        if (sameDay(d, now)) { b.classList.add('px-datepicker__day--today'); b.setAttribute('aria-current', 'date'); }
        b.setAttribute('aria-selected', String(sameDay(d, this._value)));
        const isCursor = sameDay(d, c);
        b.tabIndex = isCursor ? 0 : -1;
        if (isCursor) focus = b;
        b.addEventListener('click', () => this._pick(d));
        row.appendChild(b);
      }
      grid.appendChild(row);
    }
    grid.addEventListener('keydown', (e) => {
      const step: Record<string, () => Ymd> = {
        ArrowLeft: () => addDays(this._cursor, -1), ArrowRight: () => addDays(this._cursor, 1),
        ArrowUp: () => addDays(this._cursor, -7), ArrowDown: () => addDays(this._cursor, 7),
        PageUp: () => addMonths(this._cursor, e.shiftKey ? -12 : -1), PageDown: () => addMonths(this._cursor, e.shiftKey ? 12 : 1),
        Home: () => addDays(this._cursor, -weekday(this._cursor)), End: () => addDays(this._cursor, 6 - weekday(this._cursor)),
      };
      if (step[e.key]) {
        e.preventDefault();
        e.stopPropagation();
        this._cursor = step[e.key]();
        this._paint(popup).focus();
      } else if (e.key === 'Enter' || e.key === ' ') {
        e.preventDefault();
        e.stopPropagation();
        this._pick(this._cursor);
      }
    });
    popup.appendChild(grid);

    const foot = document.createElement('div');
    foot.className = 'px-datepicker__foot';
    const todayBtn = document.createElement('button');
    todayBtn.type = 'button';
    todayBtn.className = 'px-btn px-btn--ghost px-btn--sm';
    todayBtn.textContent = 'Today';
    todayBtn.addEventListener('click', () => this._pick(today()));
    foot.appendChild(todayBtn);
    popup.appendChild(foot);
    return focus ?? todayBtn;
  }
}

function today(): Ymd {
  const n = new Date();
  return { y: n.getFullYear(), m: n.getMonth(), d: n.getDate() };
}

// ─── TimeField ───────────────────────────────────────────────────────────────

/** Every 15 minutes of a day, as HH:MM. */
export const TIME_STEPS: readonly string[] = Array.from({ length: 96 }, (_, i) =>
  `${String(Math.floor(i / 4)).padStart(2, '0')}:${String((i % 4) * 15).padStart(2, '0')}`);

/** The list step nearest a time (the one at or just before it). */
export function nearestStep(hhmm: string): number {
  const [h, m] = hhmm.split(':').map(Number);
  return Math.max(0, Math.min(95, h * 4 + Math.floor(m / 15)));
}

export class TimeField extends PickerField {
  private _value: string;

  constructor(container: HTMLElement | null, options: { value: string; ariaLabel: string }) {
    super(container, options.ariaLabel, 'clock', 'listbox');
    this._value = parseTime(options.value) ?? '09:00';
    this._show(timeWords(this._value));
  }

  get value(): string { return this._value; }
  set value(v: string) {
    const t = parseTime(v);
    if (!t) return;
    this._value = t;
    this._show(timeWords(t));
  }

  private _pick(t: string): void {
    const changed = t !== this._value;
    this.value = t;
    this.close(true);
    if (changed) this._onDidChange.fire(this._value);
  }

  protected _build(popup: HTMLElement): HTMLElement | null {
    popup.classList.add('px-timepicker');
    const input = document.createElement('input');
    input.type = 'text';
    input.className = 'px-timepicker__input';
    input.placeholder = 'Type a time, like 2:30 pm';
    input.setAttribute('aria-label', `Type ${this._label.toLowerCase()}`);
    const list = document.createElement('div');
    list.className = 'px-timepicker__list';
    list.setAttribute('role', 'listbox');
    list.setAttribute('aria-label', this._label);
    list.id = `px-timepicker-${Math.random().toString(36).slice(2)}`;
    input.setAttribute('aria-controls', list.id);
    let active = nearestStep(this._value);
    const options = TIME_STEPS.map((t, i) => {
      const o = document.createElement('div');
      o.className = 'px-timepicker__option';
      o.setAttribute('role', 'option');
      o.id = `${list.id}-${i}`;
      o.textContent = timeWords(t);
      o.setAttribute('aria-selected', String(t === this._value));
      o.addEventListener('click', () => this._pick(t));
      list.appendChild(o);
      return o;
    });
    const setActive = (i: number): void => {
      options[active]?.classList.remove('px-timepicker__option--active');
      active = Math.max(0, Math.min(options.length - 1, i));
      options[active].classList.add('px-timepicker__option--active');
      input.setAttribute('aria-activedescendant', options[active].id);
      options[active].scrollIntoView?.({ block: 'nearest' });
    };
    input.addEventListener('input', () => {
      const t = parseTime(input.value);
      if (t) setActive(nearestStep(t));
    });
    input.addEventListener('keydown', (e) => {
      if (e.key === 'ArrowDown' || e.key === 'ArrowUp') {
        e.preventDefault();
        setActive(active + (e.key === 'ArrowDown' ? 1 : -1));
      } else if (e.key === 'Enter') {
        e.preventDefault();
        e.stopPropagation();
        this._pick(parseTime(input.value) ?? TIME_STEPS[active]);
      }
    });
    popup.append(input, list);
    // Open on the current time, a few rows from the top.
    setActive(active);
    list.scrollTop = Math.max(0, options[active].offsetTop - list.clientHeight / 3);
    return input;
  }
}
