// plannerEventPopover.ts — the Planner's event dialog: new or edit, title,
// time or all day, calendar, colour, repeats, notes; Save, Delete. Changing
// one occurrence of a repeating event first asks which events it applies
// to (askSeriesScope, which dragging an occurrence also uses).

import { createButton, createDateField, createIconButton, createInput, createSelect, createSurface, createTimeField, createToggle, type IKitPickerField } from '../../ui/kit.js';
import { keepTabInside } from '../../ui/dom.js';
import type { IDisposable } from '../../platform/lifecycle.js';
import type { PlannerEvent, SeriesEditScope, UpdateEventInput } from './plannerTypes.js';
import { buildSimpleRRule, describeRRule, rruleToPreset } from './plannerRecurrence.js';
import { appDateParts } from '../../services/localTime.js';
import { toDateInputValue, toTimeInputValue, fromDateTimeInputs } from './plannerDates.js';
import { WEEKDAY_NAMES, autoGrow, buildColorSwatches, el, eventCalendarItems, formRow } from './plannerUi.js';
import type { PlannerEditorPane } from './plannerEditorProvider.js';

export class PlannerEventPopover {
  constructor(private readonly _pane: PlannerEditorPane) {}

  /**
   * Ask which occurrences a series change applies to (Google-parity). Resolves
   * to the chosen scope, or null if cancelled.
   */
  askSeriesScope(kind: 'edit' | 'delete', anchor: DOMRect): Promise<SeriesEditScope | null> {
    return new Promise((resolve) => {
      let settled = false;
      const overlay = el('div', 'planner-popover-overlay');
      const done = (scope: SeriesEditScope | null): void => {
        if (settled) return;
        settled = true;
        try { overlay.remove(); } catch { /* noop */ }
        document.removeEventListener('keydown', onKey);
        resolve(scope);
      };
      overlay.addEventListener('click', (e) => { if (e.target === overlay) done(null); });

      const pop = el('div', 'planner-popover planner-scope-menu');
      pop.style.position = 'fixed';
      pop.setAttribute('role', 'dialog'); pop.setAttribute('aria-modal', 'true'); pop.setAttribute('aria-label', kind === 'delete' ? 'Delete Recurring Event' : 'Edit Recurring Event');
      keepTabInside(pop);
      const head = el('div', 'planner-popover__head');
      const heading = el('h3', 'planner-popover__title');
      heading.textContent = kind === 'delete' ? 'Delete Recurring Event' : 'Edit Recurring Event';
      head.appendChild(heading);
      pop.appendChild(head);

      const bodyEl = el('div', 'planner-scope-body');
      const opts: { scope: SeriesEditScope; label: string }[] = [
        { scope: 'this', label: 'This Event' },
        { scope: 'following', label: 'This and Following Events' },
        { scope: 'all', label: 'All Events' },
      ];
      for (const o of opts) {
        createButton(bodyEl, { id: `planner.event.scope.${o.scope}`, label: o.label, kind: 'ghost', onClick: () => done(o.scope) }).classList.add('planner-scope-opt');
      }
      pop.appendChild(bodyEl);

      const foot = el('div', 'planner-popover__foot');
      foot.appendChild(el('span', 'planner-popover__spacer'));
      createButton(foot, { id: 'planner.event.scope.cancel', label: 'Cancel', kind: 'secondary', onClick: () => done(null) });
      pop.appendChild(foot);

      const onKey = (e: KeyboardEvent): void => { if (e.key === 'Escape') done(null); };
      document.addEventListener('keydown', onKey);

      overlay.appendChild(pop);
      document.body.appendChild(overlay);
      const m = pop.getBoundingClientRect();
      const vw = window.innerWidth, vh = window.innerHeight;
      const left = Math.max(12, Math.min(anchor.left, vw - m.width - 12));
      let top = anchor.bottom + 6;
      if (top + m.height > vh - 12) top = Math.max(12, anchor.top - m.height - 6);
      pop.style.left = `${left}px`;
      pop.style.top = `${top}px`;
      pop.querySelector<HTMLButtonElement>('.planner-scope-opt')?.focus();
    });
  }

  /**
   * One dialog for creating and editing an event. Save commits through
   * createEvent or updateEvent (a repeating event first asks which
   * occurrences); Delete shows only when editing. Escape, a press outside,
   * × and Cancel all close it the same way, and never navigate away.
   */
  openEventPopover(
    init: { mode: 'create'; startAt: number; endAt: number; allDay?: boolean; pendingGhost?: HTMLElement | null }
        | { mode: 'edit'; event: PlannerEvent },
    anchor: DOMRect,
  ): void {
    void this._open(init, anchor);
  }

  private async _open(
    init: { mode: 'create'; startAt: number; endAt: number; allDay?: boolean; pendingGhost?: HTMLElement | null } | { mode: 'edit'; event: PlannerEvent },
    anchor: DOMRect,
  ): Promise<void> {
    // The drag's ghost stays while the dialog is open, so the user sees what
    // they are creating; every way of closing removes it.
    const pendingGhost = init.mode === 'create' ? init.pendingGhost ?? null : null;
    if (pendingGhost) pendingGhost.classList.add('planner-cal__ghost--pending');
    const [cals, defaultCalId] = await Promise.all([
      this._pane._data.listCalendars().catch(() => []),
      this._pane._data.resolveDefaultEventCalendarId().catch(() => null),
    ]);

    const disposables: IDisposable[] = [];
    // A modal dialog: focus goes back where it was when it closes.
    const returnFocus = document.activeElement instanceof HTMLElement && document.activeElement !== document.body ? document.activeElement : null;
    const close = () => {
      for (const d of disposables) { try { d.dispose(); } catch { /* noop */ } }
      disposables.length = 0;
      overlay.remove();
      document.removeEventListener('keydown', onKey);
      if (returnFocus?.isConnected && (!document.activeElement || document.activeElement === document.body)) returnFocus.focus();
      pendingGhost?.remove();
    };

    const overlay = el('div', 'planner-popover-overlay');
    overlay.addEventListener('click', (e) => { if (e.target === overlay) close(); });
    const pop = el('div', 'planner-popover planner-form');
    pop.style.position = 'fixed';
    createSurface(pop, { id: 'planner.eventPopover', owner: 'planner', label: 'Event' });

    const event = init.mode === 'edit' ? init.event : null;
    pop.setAttribute('role', 'dialog'); pop.setAttribute('aria-modal', 'true'); pop.setAttribute('aria-label', event ? 'Edit Event' : 'New Event');
    keepTabInside(pop);
    const seedStart = event?.startAt ?? (init.mode === 'create' ? init.startAt : Date.now());
    const seedEnd = event?.endAt ?? (init.mode === 'create' ? init.endAt : seedStart + 3_600_000);

    // Header
    const head = el('div', 'planner-popover__head');
    const heading = el('h3', 'planner-popover__title');
    heading.textContent = event ? 'Edit Event' : 'New Event';
    head.appendChild(heading);
    createIconButton(head, { id: 'planner.event.close', icon: 'close', title: 'Close', size: 'sm', onClick: () => close() });
    pop.appendChild(head);

    const body = el('div', 'planner-popover__body planner-form__body');
    const title = createInput(body, { id: 'planner.event.title', label: 'Title', placeholder: 'Add a title', value: event?.title ?? '' });
    title.element.classList.add('planner-form__title');
    disposables.push(title);
    const titleInput = title.element.querySelector('input') ?? title.element;

    // Starts and ends: moving the start keeps the length, as calendars do.
    const startsRow = formRow(body, 'Starts');
    const endsRow = formRow(body, 'Ends');
    // All day has its own line, so Starts and Ends hold the same two fields and line up.
    const allDayRow = formRow(body, '');
    // The time fields keep their values while All day is on, so the length
    // carried over is always the timed one.
    const startMs = () => fromDateTimeInputs(startDate.value, startTime.value);
    let lastStart = seedStart;
    const followStart = () => {
      const next = startMs();
      if (next === null) return;
      const end = fromDateTimeInputs(endDate.value, endTime.value);
      if (end !== null) {
        const moved = end + (next - lastStart);
        endDate.value = toDateInputValue(moved);
        endTime.value = toTimeInputValue(moved);
      }
      lastStart = next;
      buildRepeatOptions();
    };
    const startDate: IKitPickerField = createDateField(startsRow, { id: 'planner.event.startDate', label: 'Start date', value: toDateInputValue(seedStart), onChange: followStart });
    const startTime: IKitPickerField = createTimeField(startsRow, { id: 'planner.event.startTime', label: 'Start time', value: toTimeInputValue(seedStart), onChange: followStart });
    const endDate: IKitPickerField = createDateField(endsRow, { id: 'planner.event.endDate', label: 'End date', value: toDateInputValue(seedEnd) });
    const endTime: IKitPickerField = createTimeField(endsRow, { id: 'planner.event.endTime', label: 'End time', value: toTimeInputValue(seedEnd) });
    disposables.push(startDate, startTime, endDate, endTime);
    for (const t of [startTime, endTime]) t.element.classList.add('planner-form__time');
    const allDayWrap = el('label', 'planner-form__inline');
    const allDay = createToggle(allDayWrap, {
      id: 'planner.event.allDay', label: 'All day', checked: event?.allDay ?? (init.mode === 'create' && !!init.allDay),
      onChange: (on) => { startTime.disabled = on; endTime.disabled = on; },
    });
    disposables.push(allDay);
    const allDayText = el('span');
    allDayText.textContent = 'All day';
    allDayWrap.appendChild(allDayText);
    allDayRow.appendChild(allDayWrap);
    startTime.disabled = endTime.disabled = allDay.checked;

    // Calendar: new events go where the user's "New events go to" setting
    // says, else a Google-synced calendar (never a hard-coded local one, which
    // quietly kept events from reaching Google).
    const want = event?.calendarId ?? defaultCalId;
    const calendar = createSelect(formRow(body, 'Calendar'), {
      id: 'planner.event.calendar', label: 'Calendar', onChange: () => {},
      value: want && cals.some((c) => c.id === want) ? want : cals[0]?.id ?? '',
      items: eventCalendarItems(cals),
    });
    disposables.push(calendar);

    // Colour overrides the calendar's for this event or series; the hollow
    // chip keeps the calendar's.
    let pendingColor: string | null = event?.color ?? null;
    formRow(body, 'Color').appendChild(buildColorSwatches(pendingColor, (hex) => { pendingColor = hex; }, true));

    // Repeats: simple RRULE presets; "Weekly on X" follows the start date.
    const seedRecurrence = event?.recurrence ?? null;
    const seedPreset = rruleToPreset(seedRecurrence);
    const repeatItems = () => [
      { value: 'none', label: 'Does not repeat' },
      { value: 'daily', label: 'Daily' },
      { value: 'weekly', label: `Weekly on ${WEEKDAY_NAMES[appDateParts(fromDateTimeInputs(startDate.value, '12:00') ?? seedStart).weekday]}` },
      { value: 'monthly', label: 'Monthly' },
      { value: 'yearly', label: 'Yearly' },
      ...(seedPreset === 'custom' ? [{ value: 'custom', label: describeRRule(seedRecurrence) }] : []),
    ];
    const repeats = createSelect(formRow(body, 'Repeats'), { id: 'planner.event.repeats', label: 'Repeats', value: seedPreset, items: repeatItems(), onChange: () => {} });
    disposables.push(repeats);
    function buildRepeatOptions(): void {
      const keep = repeats.value || seedPreset;
      repeats.setItems(repeatItems());
      repeats.value = keep;
    }

    const location = createInput(formRow(body, 'Location'), { id: 'planner.event.location', label: 'Location', placeholder: 'Add a place', value: event?.location ?? '' });
    disposables.push(location);

    const notesCell = formRow(body, 'Notes');
    const descInput = el('textarea', 'planner-form__notes') as HTMLTextAreaElement;
    descInput.placeholder = 'Notes and links';
    descInput.setAttribute('aria-label', 'Description');
    descInput.value = event?.description ?? '';
    notesCell.appendChild(descInput);
    autoGrow(descInput);
    this._pane.notes.appendNotesToolbar(notesCell, descInput);
    this._pane.notes.attachDescriptionLinks(notesCell, descInput);
    pop.appendChild(body);

    // Footer
    const foot = el('div', 'planner-popover__foot');
    if (event) {
      const del: HTMLButtonElement = createButton(foot, {
        id: 'planner.event.delete', label: 'Delete', kind: 'danger',
        onClick: () => void (async () => {
          if (event.seriesId) {
            const scope = await this.askSeriesScope('delete', del.getBoundingClientRect());
            if (!scope) return;
            await this._pane._data.deleteOccurrence(event.id, scope);
          } else {
            await this._pane._data.removeEvent(event.id);
          }
          close();
        })(),
      });
    }
    foot.appendChild(el('span', 'planner-popover__spacer'));
    createButton(foot, { id: 'planner.event.cancel', label: 'Cancel', kind: 'secondary', onClick: () => close() });
    const doSave = async () => {
      const name = title.value.trim();
      if (!name) { titleInput.focus(); return; }
      const start = startMs();
      const end = fromDateTimeInputs(endDate.value, endTime.value);
      if (start === null || end === null) {
        await this._pane._api.window.showErrorMessage('Invalid date or time.');
        return;
      }
      if (end < start) {
        await this._pane._api.window.showErrorMessage('The event must end after it starts.');
        return;
      }
      const preset = repeats.value || 'none';
      // 'custom' keeps the stored RRULE; a preset is rebuilt on the start's weekday.
      const recurrence = preset === 'custom'
        ? undefined
        : buildSimpleRRule(preset as 'none' | 'daily' | 'weekly' | 'monthly' | 'yearly', appDateParts(start).weekday);
      const fields = {
        title: name,
        startAt: start,
        endAt: end,
        allDay: allDay.checked,
        location: location.value.trim() || null,
        description: descInput.value.trim() || null,
        calendarId: calendar.value || null,
        color: pendingColor,
      };
      try {
        if (event) {
          const patch: UpdateEventInput = { ...fields, ...(recurrence !== undefined ? { recurrence } : {}) };
          if (event.seriesId) {
            // One occurrence of a series: ask which occurrences it applies to;
            // cancelling keeps the dialog open.
            const scope = await this.askSeriesScope('edit', save.getBoundingClientRect());
            if (!scope) return;
            await this._pane._data.applySeriesEdit(event.id, patch, scope);
          } else {
            await this._pane._data.updateEvent(event.id, patch);
          }
        } else {
          await this._pane._data.createEvent({ ...fields, recurrence: recurrence ?? null });
        }
        close();
      } catch (err) {
        await this._pane._api.window.showErrorMessage(`Could not save event: ${err instanceof Error ? err.message : String(err)}`);
      }
    };
    const save = createButton(foot, { id: 'planner.event.save', label: event ? 'Save' : 'Create Event', kind: 'primary', onClick: () => void doSave() });
    pop.appendChild(foot);

    overlay.appendChild(pop);
    document.body.appendChild(overlay);

    // Escape and Enter belong to an open date or time picker first.
    function onKey(e: KeyboardEvent): void {
      if (document.querySelector('.px-picker') || document.querySelector('.planner-scope-menu')) return;
      if (e.key === 'Escape') close();
      else if (e.key === 'Enter' && !(e.target instanceof HTMLTextAreaElement) && !(e.target instanceof HTMLButtonElement)) {
        e.preventDefault();
        void doSave();
      }
    }
    document.addEventListener('keydown', onKey);
    setTimeout(() => titleInput.focus(), 30);

    // Beside what opened it, kept on screen.
    const m = pop.getBoundingClientRect();
    const vw = window.innerWidth, vh = window.innerHeight;
    let left = anchor.left;
    let top = anchor.bottom + 6;
    if (anchor.left + m.width > vw - 12) left = Math.max(12, vw - m.width - 12);
    if (top + m.height > vh - 12) top = Math.max(12, Math.min(anchor.top - m.height - 6, vh - m.height - 12));
    pop.style.left = `${left}px`;
    pop.style.top = `${top}px`;
  }
}
