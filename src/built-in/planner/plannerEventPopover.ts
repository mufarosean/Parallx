// plannerEventPopover.ts — the Planner's event dialog: new or edit, title,
// time or all day, calendar, colour, repeats, notes; Save, Delete. Changing
// one occurrence of a repeating event first asks which events it applies
// to (askSeriesScope, which dragging an occurrence also uses).

import { createSurface, declareControl } from '../../ui/kit.js';
import { keepTabInside } from '../../ui/dom.js';
import type { IDisposable } from '../../platform/lifecycle.js';
import type { PlannerEvent, SeriesEditScope, UpdateEventInput } from './plannerTypes.js';
import { buildSimpleRRule, describeRRule, rruleToPreset } from './plannerRecurrence.js';
import { Dropdown } from '../../ui/dropdown.js';
import { appDateParts } from '../../services/localTime.js';
import { toDateInputValue, toTimeInputValue, fromDateTimeInputs } from './plannerDates.js';
import { WEEKDAY_NAMES, CALENDAR_LABEL_SVG, REPEAT_LABEL_SVG, COLOR_LABEL_SVG, el, buildColorSwatches, eventCalendarItems } from './plannerUi.js';
import type { PlannerEditorPane } from './plannerEditorProvider.js';

export class PlannerEventPopover {
  constructor(private readonly _pane: PlannerEditorPane) {}

  /**
   * Drag-to-move + drag-to-resize for a timed event bar. Mirrors Google /
   * Apple / Outlook: grab the body to reposition (vertical = time, and in
   * week view horizontal = day), grab the thin top / bottom edges to
   * change just the start or end. Snaps to 15 minutes. A movement under the
   * threshold is treated as a click and opens the editor instead.
   */
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
      pop.setAttribute('role', 'dialog'); pop.setAttribute('aria-modal', 'true'); pop.setAttribute('aria-label', kind === 'delete' ? 'Delete recurring event' : 'Edit recurring event');
      keepTabInside(pop);
      const head = el('div', 'planner-popover__head');
      const heading = el('h3', 'planner-popover__title');
      heading.textContent = kind === 'delete' ? 'Delete recurring event' : 'Edit recurring event';
      head.appendChild(heading);
      pop.appendChild(head);

      const bodyEl = el('div', 'planner-scope-body');
      const opts: { scope: SeriesEditScope; label: string }[] = [
        { scope: 'this', label: 'This Event' },
        { scope: 'following', label: 'This and Following Events' },
        { scope: 'all', label: 'All Events' },
      ];
      for (const o of opts) {
        const btn = el('button', 'planner-scope-opt');
        btn.type = 'button';
        btn.textContent = o.label;
        btn.addEventListener('click', () => done(o.scope));
        declareControl(btn, { id: `planner.event.scope.${o.scope}`, label: o.label });
        bodyEl.appendChild(btn);
      }
      pop.appendChild(bodyEl);

      const foot = el('div', 'planner-popover__foot');
      const spacer = el('span', 'planner-popover__spacer');
      foot.appendChild(spacer);
      const cancel = el('button', 'planner-popover__btn');
      cancel.type = 'button';
      cancel.textContent = 'Cancel';
      cancel.addEventListener('click', () => done(null));
      foot.appendChild(cancel);
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
    });
  }

  /**
   * Single popover for both creating a new event and editing an existing
   * one. Form: title, start time, end time, all-day toggle, location,
   * description. Save commits via createEvent / updateEvent; Delete only
   * shows in edit mode. Dismisses on Escape or outside click; never
   * navigates away.
   */
  openEventPopover(
    init: { mode: 'create'; startAt: number; endAt: number; allDay?: boolean; pendingGhost?: HTMLElement | null }
        | { mode: 'edit'; event: PlannerEvent },
    anchor: DOMRect,
  ): void {
    // Pending ghost from a drag selection — survives onto the popover so
    // the user sees what they're creating while they fill it in. Cleared
    // by close(), so cancel / escape / outside-click / save all dispose
    // of it without flicker.
    const pendingGhost = init.mode === 'create' ? init.pendingGhost ?? null : null;

    // Dropdowns own document-level listeners — every close path disposes them.
    const popupDisposables: IDisposable[] = [];
    // A modal dialog: focus goes back where it was when it closes.
    const returnFocus = document.activeElement instanceof HTMLElement && document.activeElement !== document.body ? document.activeElement : null;
    const close = () => {
      for (const d of popupDisposables) { try { d.dispose(); } catch { /* noop */ } }
      popupDisposables.length = 0;
      try { overlay.remove(); } catch { /* noop */ }
      if (returnFocus?.isConnected && (!document.activeElement || document.activeElement === document.body)) returnFocus.focus();
      if (pendingGhost && pendingGhost.parentElement) {
        try { pendingGhost.remove(); } catch { /* noop */ }
      }
      document.removeEventListener('keydown', onKey);
    };

    const overlay = el('div', 'planner-popover-overlay');
    overlay.addEventListener('click', (e) => { if (e.target === overlay) close(); });
    // Highlight the pending ghost while the popover is open — it's the
    // visible "this is what you're creating" anchor.
    if (pendingGhost) pendingGhost.classList.add('planner-cal__ghost--pending');

    const pop = el('div', 'planner-popover');
    pop.style.position = 'fixed';
    createSurface(pop, { id: 'planner.eventPopover', owner: 'planner', label: 'Event' });

    const isEdit = init.mode === 'edit';
    pop.setAttribute('role', 'dialog'); pop.setAttribute('aria-modal', 'true'); pop.setAttribute('aria-label', isEdit ? 'Edit Event' : 'New Event');
    keepTabInside(pop); // modal: Tab goes round inside it (its listener goes with the element)
    const seed: { title: string; startAt: number; endAt: number; allDay: boolean; location: string; description: string; eventId: string | null } = isEdit
      ? {
          title: init.event.title,
          startAt: init.event.startAt,
          endAt: init.event.endAt,
          allDay: init.event.allDay,
          location: init.event.location ?? '',
          description: init.event.description ?? '',
          eventId: init.event.id,
        }
      : {
          title: '',
          startAt: init.startAt,
          endAt: init.endAt,
          allDay: init.allDay ?? false,
          location: '',
          description: '',
          eventId: null,
        };

    // Header
    const head = el('div', 'planner-popover__head');
    const heading = el('h3', 'planner-popover__title');
    heading.textContent = isEdit ? 'Edit event' : 'New event';
    head.appendChild(heading);
    const closeBtn = el('button', 'planner-popover__close');
    declareControl(closeBtn, { id: 'planner.event.close', label: 'Close', kind: 'iconButton' });
    closeBtn.type = 'button';
    closeBtn.innerHTML = '<svg xmlns="http://www.w3.org/2000/svg" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><line x1="18" y1="6" x2="6" y2="18"/><line x1="6" y1="6" x2="18" y2="18"/></svg>';
    closeBtn.addEventListener('click', () => close());
    head.appendChild(closeBtn);
    pop.appendChild(head);

    // Body
    const body = el('div', 'planner-popover__body');

    const titleInput = el('input', 'planner-popover__title-input') as HTMLInputElement;
    declareControl(titleInput, { id: 'planner.event.title', label: 'Title', kind: 'input', state: () => ({ kind: 'value', value: titleInput.value }) });
    titleInput.type = 'text';
    titleInput.placeholder = 'Add a title';
    titleInput.value = seed.title;
    body.appendChild(titleInput);

    // Date / time row
    const timeRow = el('div', 'planner-popover__row');
    const startDate = el('input', 'planner-popover__field planner-popover__field--date') as HTMLInputElement;
    declareControl(startDate, { id: 'planner.event.startDate', label: 'Start date', kind: 'input', state: () => ({ kind: 'value', value: startDate.value }) });
    startDate.type = 'date';
    startDate.value = toDateInputValue(seed.startAt);
    const startTime = el('input', 'planner-popover__field planner-popover__field--time') as HTMLInputElement;
    declareControl(startTime, { id: 'planner.event.startTime', label: 'Start time', kind: 'input', state: () => ({ kind: 'value', value: startTime.value }) });
    startTime.type = 'time';
    startTime.value = toTimeInputValue(seed.startAt);
    const sep = el('span', 'planner-popover__sep');
    sep.textContent = '–';
    const endTime = el('input', 'planner-popover__field planner-popover__field--time') as HTMLInputElement;
    declareControl(endTime, { id: 'planner.event.endTime', label: 'End time', kind: 'input', state: () => ({ kind: 'value', value: endTime.value }) });
    endTime.type = 'time';
    endTime.value = toTimeInputValue(seed.endAt);
    const endDate = el('input', 'planner-popover__field planner-popover__field--date') as HTMLInputElement;
    declareControl(endDate, { id: 'planner.event.endDate', label: 'End date', kind: 'input', state: () => ({ kind: 'value', value: endDate.value }) });
    endDate.type = 'date';
    endDate.value = toDateInputValue(seed.endAt);
    timeRow.appendChild(startDate);
    timeRow.appendChild(startTime);
    timeRow.appendChild(sep);
    timeRow.appendChild(endTime);
    timeRow.appendChild(endDate);
    body.appendChild(timeRow);

    const allDayRow = el('label', 'planner-popover__check');
    const allDayInput = el('input') as HTMLInputElement;
    allDayInput.type = 'checkbox';
    allDayInput.checked = seed.allDay;
    const allDayText = el('span');
    allDayText.textContent = 'All Day';
    declareControl(allDayInput, { id: 'planner.event.allDay', label: 'All Day', kind: 'toggle', state: () => ({ kind: 'pressed', value: allDayInput.checked }) });
    allDayRow.appendChild(allDayInput);
    allDayRow.appendChild(allDayText);
    body.appendChild(allDayRow);
    const updateAllDayUI = () => {
      const off = allDayInput.checked;
      startTime.disabled = off; endTime.disabled = off;
      startTime.style.opacity = off ? '0.4' : '';
      endTime.style.opacity = off ? '0.4' : '';
    };
    allDayInput.addEventListener('change', updateAllDayUI);
    updateAllDayUI();

    // Calendar picker — colour + grouping come from the chosen calendar.
    const calRow = el('div', 'planner-popover__row planner-popover__row--labeled');
    const calLabel = el('span', 'planner-popover__rowlabel');
    calLabel.innerHTML = CALENDAR_LABEL_SVG;
    calRow.appendChild(calLabel);
    const calHost = el('div', 'planner-popover__field planner-popover__field--select');
    const calSelect = new Dropdown(calHost, { items: [], ariaLabel: 'Calendar' });
    declareControl(calSelect.element, { id: 'planner.event.calendar', label: 'Calendar', kind: 'select', state: () => ({ kind: 'value', value: calSelect.value ?? '' }) });
    popupDisposables.push(calSelect);
    calRow.appendChild(calHost);
    body.appendChild(calRow);
    const seedCalId = isEdit ? (init.event.calendarId ?? null) : null;
    void Promise.all([this._pane._data.listCalendars(), this._pane._data.resolveDefaultEventCalendarId()])
      .then(([cals, defaultCalId]) => {
        calSelect.items = eventCalendarItems(cals);
        // New events follow the resolved default — the user's "New events go to"
        // setting, else a Google-synced calendar. Hard-preferring 'cal-personal'
        // here (the old behaviour) quietly overrode both, so every event made in
        // this dialog landed on a LOCAL calendar and never reached Google.
        const want = seedCalId ?? defaultCalId;
        if (want && cals.some(c => c.id === want)) calSelect.value = want;
      });

    // Colour — overrides the calendar's colour for this event/series. Default
    // (hollow chip) inherits the calendar colour.
    let pendingColor: string | null = isEdit ? (init.event.color ?? null) : null;
    const colorRow = el('div', 'planner-popover__row planner-popover__row--labeled');
    const colorLabel = el('span', 'planner-popover__rowlabel');
    colorLabel.innerHTML = COLOR_LABEL_SVG;
    colorRow.appendChild(colorLabel);
    colorRow.appendChild(buildColorSwatches(pendingColor, (hex) => { pendingColor = hex; }, true));
    body.appendChild(colorRow);

    // Repeats — simple RRULE presets; the "Weekly on X" label tracks the start date.
    const repeatRow = el('div', 'planner-popover__row planner-popover__row--labeled');
    const repeatLabel = el('span', 'planner-popover__rowlabel');
    repeatLabel.innerHTML = REPEAT_LABEL_SVG;
    repeatRow.appendChild(repeatLabel);
    const repeatHost = el('div', 'planner-popover__field planner-popover__field--select');
    const seedRecurrence = isEdit ? (init.event.recurrence ?? null) : null;
    const seedPreset = rruleToPreset(seedRecurrence);
    const repeatSelect = new Dropdown(repeatHost, { items: [], selected: seedPreset, ariaLabel: 'Repeats' });
    declareControl(repeatSelect.element, { id: 'planner.event.repeats', label: 'Repeats', kind: 'select', state: () => ({ kind: 'value', value: repeatSelect.value ?? '' }) });
    popupDisposables.push(repeatSelect);
    const repeatDefs: { value: string; label: () => string }[] = [
      { value: 'none',    label: () => 'Does not repeat' },
      { value: 'daily',   label: () => 'Daily' },
      { value: 'weekly',  label: () => `Weekly on ${WEEKDAY_NAMES[appDateParts(fromDateTimeInputs(startDate.value, '12:00') ?? seed.startAt).weekday]}` },
      { value: 'monthly', label: () => 'Monthly' },
      { value: 'yearly',  label: () => 'Yearly' },
    ];
    const buildRepeatOptions = (): void => {
      const keep = repeatSelect.value || seedPreset;
      const items = repeatDefs.map((def) => ({ value: def.value, label: def.label() }));
      if (seedPreset === 'custom') {
        items.push({ value: 'custom', label: describeRRule(seedRecurrence) });
      }
      repeatSelect.items = items;
      repeatSelect.value = keep;
    };
    buildRepeatOptions();
    startDate.addEventListener('change', buildRepeatOptions);
    repeatRow.appendChild(repeatHost);
    body.appendChild(repeatRow);

    const locationInput = el('input', 'planner-popover__field planner-popover__field--full') as HTMLInputElement;
    declareControl(locationInput, { id: 'planner.event.location', label: 'Location', kind: 'input', state: () => ({ kind: 'value', value: locationInput.value }) });
    locationInput.type = 'text';
    locationInput.placeholder = 'Add location';
    locationInput.value = seed.location;
    body.appendChild(locationInput);

    const descInput = el('textarea', 'planner-popover__textarea') as HTMLTextAreaElement;
    declareControl(descInput, { id: 'planner.event.description', label: 'Description', kind: 'input', state: () => ({ kind: 'value', value: descInput.value }) });
    descInput.placeholder = 'Add notes & links';
    descInput.value = seed.description;
    body.appendChild(descInput);
    this._pane.notes.appendNotesToolbar(body, descInput);
    this._pane.notes.attachDescriptionLinks(body, descInput);

    pop.appendChild(body);

    // Footer
    const foot = el('div', 'planner-popover__foot');
    if (isEdit) {
      const delBtn = el('button', 'planner-popover__btn planner-popover__btn--danger');
      delBtn.type = 'button';
      delBtn.textContent = 'Delete';
      declareControl(delBtn, { id: 'planner.event.delete', label: 'Delete' });
      delBtn.addEventListener('click', async () => {
        if (!seed.eventId) return;
        if (init.mode === 'edit' && init.event.seriesId) {
          const scope = await this.askSeriesScope('delete', delBtn.getBoundingClientRect());
          if (!scope) return;
          await this._pane._data.deleteOccurrence(seed.eventId, scope);
        } else {
          await this._pane._data.removeEvent(seed.eventId);
        }
        close();
      });
      foot.appendChild(delBtn);
    }
    const spacer = el('span', 'planner-popover__spacer');
    foot.appendChild(spacer);
    const cancel = el('button', 'planner-popover__btn');
    cancel.type = 'button';
    cancel.textContent = 'Cancel';
    cancel.addEventListener('click', () => close());
    foot.appendChild(cancel);
    declareControl(cancel, { id: 'planner.event.cancel', label: 'Cancel' });
    const save = el('button', 'planner-popover__btn planner-popover__btn--primary');
    save.type = 'button';
    save.textContent = isEdit ? 'Save' : 'Create';
    declareControl(save, { id: 'planner.event.save', label: isEdit ? 'Save' : 'Create' });
    const doSave = async () => {
      const title = titleInput.value.trim();
      if (!title) { titleInput.focus(); return; }
      const startMs = fromDateTimeInputs(startDate.value, startTime.value);
      const endMs = fromDateTimeInputs(endDate.value, endTime.value);
      if (startMs === null || endMs === null) {
        await this._pane._api.window.showErrorMessage('Invalid date or time.');
        return;
      }
      if (endMs < startMs) {
        await this._pane._api.window.showErrorMessage('End time must be after start time.');
        return;
      }
      const calendarId = calSelect.value || null;
      const presetVal = repeatSelect.value ?? 'none';
      // 'custom' → leave the stored RRULE untouched; otherwise rebuild from the
      // preset against the current start weekday.
      const recurrence = presetVal === 'custom'
        ? undefined
        : buildSimpleRRule(presetVal as 'none' | 'daily' | 'weekly' | 'monthly' | 'yearly', appDateParts(startMs).weekday);
      const isSeries = isEdit && init.mode === 'edit' && !!init.event.seriesId;
      try {
        if (isEdit && seed.eventId) {
          const patch: UpdateEventInput = {
            title,
            startAt: startMs,
            endAt: endMs,
            allDay: allDayInput.checked,
            location: locationInput.value.trim() || null,
            description: descInput.value.trim() || null,
            calendarId,
            color: pendingColor,
            ...(recurrence !== undefined ? { recurrence } : {}),
          };
          if (isSeries) {
            // Recurring occurrence → ask which occurrences the edit applies to.
            const scope = await this.askSeriesScope('edit', save.getBoundingClientRect());
            if (!scope) return; // keep the popover open; user can retry or cancel
            await this._pane._data.applySeriesEdit(seed.eventId, patch, scope);
          } else {
            await this._pane._data.updateEvent(seed.eventId, patch);
          }
        } else {
          await this._pane._data.createEvent({
            title,
            startAt: startMs,
            endAt: endMs,
            allDay: allDayInput.checked,
            location: locationInput.value.trim() || null,
            description: descInput.value.trim() || null,
            calendarId,
            color: pendingColor,
            recurrence: recurrence ?? null,
          });
        }
        close();
      } catch (err) {
        const msg = err instanceof Error ? err.message : String(err);
        await this._pane._api.window.showErrorMessage(`Could not save event: ${msg}`);
      }
    };
    save.addEventListener('click', () => void doSave());
    foot.appendChild(save);
    pop.appendChild(foot);

    overlay.appendChild(pop);
    document.body.appendChild(overlay);

    // Keyboard: Enter saves (when not in textarea), Escape closes.
    function onKey(e: KeyboardEvent): void {
      if (e.key === 'Escape') { close(); }
      else if (e.key === 'Enter' && !(e.target instanceof HTMLTextAreaElement)) {
        e.preventDefault(); void doSave();
      }
    }
    document.addEventListener('keydown', onKey);
    overlay.addEventListener('animationend', () => titleInput.focus(), { once: true });
    // Failsafe focus if animation doesn't fire (e.g. reduced-motion).
    setTimeout(() => { if (document.activeElement !== titleInput) titleInput.focus(); }, 80);

    // Position the popover next to the anchor; keep it on-screen.
    const m = pop.getBoundingClientRect();
    const vw = window.innerWidth, vh = window.innerHeight;
    let left = anchor.left;
    let top = anchor.bottom + 6;
    // If anchor is in the right half, prefer left-align to its right edge so
    // long popovers don't fall off-screen.
    if (anchor.left + m.width > vw - 12) left = Math.max(12, vw - m.width - 12);
    if (top + m.height > vh - 12) top = Math.max(12, anchor.top - m.height - 6);
    pop.style.left = `${left}px`;
    pop.style.top = `${top}px`;
  }
}
