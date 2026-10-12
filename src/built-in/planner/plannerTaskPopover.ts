// plannerTaskPopover.ts — the Planner's task dialog: new or edit, title, due
// date and time (or all day), reminder, calendar, tags, notes and status;
// Save (or Create Task) and Delete. The Tasks list, Today and the calendar
// open it.

import type { IDisposable } from '../../platform/lifecycle.js';
import type { PlannerTask, TaskStatus } from './plannerTypes.js';
import { Dropdown } from '../../ui/dropdown.js';
import { appDateParts } from '../../services/localTime.js';
import { toDateInputValue, toTimeInputValue, fromDateTimeInputs } from './plannerDates.js';
import { CALENDAR_LABEL_SVG, el } from './plannerUi.js';
import type { PlannerEditorPane } from './plannerEditorProvider.js';

export class PlannerTaskPopover {
  constructor(private readonly _pane: PlannerEditorPane) {}

  /**
   * Single popover for task create + edit. Comprehensive form so every
   * task-create path goes through one place instead of degrading to
   * "type a title and pray". Fields:
   *
   *   title  · due date + time · all-day toggle · reminder dropdown
   *   tags   · notes (description) · status segmented control
   *
   * Save commits via createTask / updateTask; Delete only shows in edit
   * mode. Same close() lifecycle as the event popover so cancel paths
   * (Escape, outside click, ×, Cancel) all clean up consistently.
   */
  openTaskPopover(
    init: { mode: 'create'; seedDueAt?: number; seedStatus?: TaskStatus; seedTitle?: string }
        | { mode: 'edit'; task: PlannerTask },
    anchor: DOMRect,
  ): void {
    // Dropdowns own document-level listeners — every close path disposes them.
    const popupDisposables: IDisposable[] = [];
    const close = () => {
      for (const d of popupDisposables) { try { d.dispose(); } catch { /* noop */ } }
      popupDisposables.length = 0;
      try { overlay.remove(); } catch { /* noop */ }
      document.removeEventListener('keydown', onKey);
    };

    const overlay = el('div', 'planner-popover-overlay');
    overlay.addEventListener('click', (e) => { if (e.target === overlay) close(); });

    const pop = el('div', 'planner-popover');
    pop.style.position = 'fixed';

    const isEdit = init.mode === 'edit';
    // Defaults on create: +5d due, 'reviewing' (the journaling flow).
    // Calendar drags pass seedDueAt + seedStatus='planned' to override.
    const seed: {
      title: string;
      dueAt: number;
      hasReminder: boolean;
      reminderOffsetMin: number;
      tagsCsv: string;
      description: string;
      status: TaskStatus;
      taskId: string | null;
    } = isEdit
      ? {
          title: init.task.title,
          dueAt: init.task.dueAt ?? Date.now() + 5 * 86_400_000,
          hasReminder: init.task.reminderAt != null,
          reminderOffsetMin: init.task.reminderAt != null && init.task.dueAt != null
            ? Math.max(0, Math.round((init.task.dueAt - init.task.reminderAt) / 60_000))
            : 60,
          tagsCsv: init.task.tags.join(', '),
          description: init.task.description ?? '',
          status: init.task.status,
          taskId: init.task.id,
        }
      : {
          title: init.seedTitle ?? '',
          dueAt: init.seedDueAt ?? Date.now() + 5 * 86_400_000,
          hasReminder: false,
          reminderOffsetMin: 60,
          tagsCsv: '',
          description: '',
          status: init.seedStatus ?? 'reviewing',
          taskId: null,
        };

    // Header
    const head = el('div', 'planner-popover__head');
    const heading = el('h3', 'planner-popover__title');
    heading.textContent = isEdit ? 'Edit Task' : 'New task';
    head.appendChild(heading);
    const closeBtn = el('button', 'planner-popover__close');
    closeBtn.type = 'button';
    closeBtn.innerHTML = '<svg xmlns="http://www.w3.org/2000/svg" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><line x1="18" y1="6" x2="6" y2="18"/><line x1="6" y1="6" x2="18" y2="18"/></svg>';
    closeBtn.addEventListener('click', () => close());
    head.appendChild(closeBtn);
    pop.appendChild(head);

    // Body
    const body = el('div', 'planner-popover__body');

    const titleInput = el('input', 'planner-popover__title-input') as HTMLInputElement;
    titleInput.type = 'text';
    titleInput.placeholder = 'What needs to happen?';
    titleInput.value = seed.title;
    body.appendChild(titleInput);

    // Due — date + time row, with an All-day toggle that hides the time field.
    const dueRow = el('div', 'planner-popover__row planner-popover__row--labeled');
    const dueLabel = el('span', 'planner-popover__rowlabel');
    dueLabel.innerHTML = '<svg xmlns="http://www.w3.org/2000/svg" width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><rect x="3" y="4" width="18" height="18" rx="2"/><line x1="16" y1="2" x2="16" y2="6"/><line x1="8" y1="2" x2="8" y2="6"/><line x1="3" y1="10" x2="21" y2="10"/></svg><span>Due</span>';
    dueRow.appendChild(dueLabel);
    const dueDate = el('input', 'planner-popover__field planner-popover__field--date') as HTMLInputElement;
    dueDate.type = 'date';
    dueDate.value = toDateInputValue(seed.dueAt);
    dueRow.appendChild(dueDate);
    const dueTime = el('input', 'planner-popover__field planner-popover__field--time') as HTMLInputElement;
    dueTime.type = 'time';
    dueTime.value = toTimeInputValue(seed.dueAt);
    dueRow.appendChild(dueTime);
    body.appendChild(dueRow);

    const allDayRow = el('label', 'planner-popover__check');
    const allDayInput = el('input') as HTMLInputElement;
    allDayInput.type = 'checkbox';
    // All-day default: true if the seeded time is midnight (the user
    // didn't pick a time), false otherwise.
    allDayInput.checked = appDateParts(seed.dueAt).hour === 0 && appDateParts(seed.dueAt).minute === 0 && !isEdit;
    allDayRow.appendChild(allDayInput);
    const allDayText = el('span');
    allDayText.textContent = 'No specific time (all day)';
    allDayRow.appendChild(allDayText);
    body.appendChild(allDayRow);
    const updateAllDay = () => {
      const off = allDayInput.checked;
      dueTime.disabled = off;
      dueTime.style.opacity = off ? '0.4' : '';
    };
    allDayInput.addEventListener('change', updateAllDay);
    updateAllDay();

    // Reminder — dropdown of presets + None.
    const remindRow = el('div', 'planner-popover__row planner-popover__row--labeled');
    const remindLabel = el('span', 'planner-popover__rowlabel');
    remindLabel.innerHTML = '<svg xmlns="http://www.w3.org/2000/svg" width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M18 8A6 6 0 0 0 6 8c0 7-3 9-3 9h18s-3-2-3-9"/><path d="M13.73 21a2 2 0 0 1-3.46 0"/></svg><span>Remind</span>';
    remindRow.appendChild(remindLabel);
    const remindHost = el('div', 'planner-popover__field planner-popover__field--select');
    const REMINDER_PRESETS: { label: string; offsetMin: number | null }[] = [
      { label: 'No Reminder',         offsetMin: null },
      { label: 'When Due',      offsetMin: 0 },
      { label: '5 minutes before',    offsetMin: 5 },
      { label: '15 minutes before',   offsetMin: 15 },
      { label: '30 minutes before',   offsetMin: 30 },
      { label: '1 hour before',       offsetMin: 60 },
      { label: '1 day before',        offsetMin: 1440 },
      { label: '1 week before',       offsetMin: 10_080 },
    ];
    // Match the closest preset; if none matches exactly, default to "1 hour before".
    const seedRemind = seed.hasReminder
      ? (REMINDER_PRESETS.some(p => p.offsetMin === seed.reminderOffsetMin)
          ? String(seed.reminderOffsetMin)
          : '60')
      : 'none';
    const remindSelect = new Dropdown(remindHost, {
      items: REMINDER_PRESETS.map((p) => ({
        value: p.offsetMin === null ? 'none' : String(p.offsetMin),
        label: p.label,
      })),
      selected: seedRemind,
      ariaLabel: 'Reminder',
    });
    popupDisposables.push(remindSelect);
    remindRow.appendChild(remindHost);
    body.appendChild(remindRow);

    // Calendar — groups + colour-codes the task on the calendar views.
    const calRow = el('div', 'planner-popover__row planner-popover__row--labeled');
    const calLabel = el('span', 'planner-popover__rowlabel');
    calLabel.innerHTML = CALENDAR_LABEL_SVG;
    calRow.appendChild(calLabel);
    const calHost = el('div', 'planner-popover__field planner-popover__field--select');
    const calSelect = new Dropdown(calHost, { items: [], ariaLabel: 'Calendar' });
    popupDisposables.push(calSelect);
    calRow.appendChild(calHost);
    body.appendChild(calRow);
    const seedCalId = isEdit ? (init.task.calendarId ?? null) : null;
    void this._pane._data.listCalendars().then((cals) => {
      calSelect.items = cals.map((c) => ({ value: c.id, label: c.name }));
      const want = seedCalId ?? cals.find(c => c.id === 'cal-tasks')?.id ?? cals.find(c => c.isDefault)?.id ?? (cals[0]?.id ?? '');
      if (want) calSelect.value = want;
    });

    // Tags
    const tagRow = el('div', 'planner-popover__row planner-popover__row--labeled');
    const tagLabel = el('span', 'planner-popover__rowlabel');
    tagLabel.innerHTML = '<svg xmlns="http://www.w3.org/2000/svg" width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M20.59 13.41L13.42 20.58a2 2 0 0 1-2.83 0L2 12V2h10l8.59 8.59a2 2 0 0 1 0 2.82z"/><line x1="7" y1="7" x2="7.01" y2="7"/></svg><span>Tags</span>';
    tagRow.appendChild(tagLabel);
    const tagInput = el('input', 'planner-popover__field planner-popover__field--full') as HTMLInputElement;
    tagInput.type = 'text';
    tagInput.placeholder = 'e.g. errands, calls';
    tagInput.value = seed.tagsCsv;
    tagRow.appendChild(tagInput);
    body.appendChild(tagRow);

    // Notes
    const descInput = el('textarea', 'planner-popover__textarea') as HTMLTextAreaElement;
    descInput.placeholder = 'Notes & links';
    descInput.value = seed.description;
    body.appendChild(descInput);
    this._pane.notes.appendNotesToolbar(body, descInput);
    this._pane.notes.attachDescriptionLinks(body, descInput);

    // Status — segmented control (Reviewing / Planned), defaults from seed.
    const statusRow = el('div', 'planner-popover__statusrow');
    const statusLabel = el('span', 'planner-popover__statuslabel');
    statusLabel.textContent = 'Status';
    statusRow.appendChild(statusLabel);
    const statusGroup = el('div', 'planner-popover__statusgroup');
    let statusValue: TaskStatus = seed.status === 'cancelled' ? 'reviewing' : seed.status;
    const statusOptions: { value: TaskStatus; label: string }[] = [
      { value: 'reviewing', label: 'Reviewing' },
      { value: 'planned',   label: 'Planned' },
    ];
    if (isEdit) statusOptions.push({ value: 'done', label: 'Done' });
    for (const opt of statusOptions) {
      const btn = el('button', 'planner-popover__statusbtn');
      btn.type = 'button';
      btn.dataset.value = opt.value;
      btn.textContent = opt.label;
      if (opt.value === statusValue) btn.classList.add('planner-popover__statusbtn--active');
      btn.addEventListener('click', () => {
        statusValue = opt.value;
        for (const sib of Array.from(statusGroup.children)) {
          if (!(sib instanceof HTMLElement)) continue;
          sib.classList.toggle('planner-popover__statusbtn--active', sib.dataset.value === statusValue);
        }
      });
      statusGroup.appendChild(btn);
    }
    statusRow.appendChild(statusGroup);
    body.appendChild(statusRow);

    pop.appendChild(body);

    // Footer
    const foot = el('div', 'planner-popover__foot');
    if (isEdit && seed.taskId) {
      const delBtn = el('button', 'planner-popover__btn planner-popover__btn--danger');
      delBtn.type = 'button';
      delBtn.textContent = 'Delete';
      delBtn.addEventListener('click', async () => {
        await this._pane._data.removeTask(seed.taskId!);
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
    const save = el('button', 'planner-popover__btn planner-popover__btn--primary');
    save.type = 'button';
    save.textContent = isEdit ? 'Save' : 'Create task';
    const doSave = async () => {
      const title = titleInput.value.trim();
      if (!title) { titleInput.focus(); return; }
      const allDay = allDayInput.checked;
      const dueMs = allDay
        ? fromDateTimeInputs(dueDate.value, '00:00')
        : fromDateTimeInputs(dueDate.value, dueTime.value);
      if (dueMs === null) {
        await this._pane._api.window.showErrorMessage('Invalid due date or time.');
        return;
      }
      const offsetStr = remindSelect.value ?? 'none';
      const reminderAt = offsetStr === 'none' ? null : dueMs - parseInt(offsetStr, 10) * 60_000;
      const tags = tagInput.value.split(',').map(s => s.trim()).filter(Boolean);
      const description = descInput.value.trim() || null;

      try {
        if (isEdit && seed.taskId) {
          await this._pane._data.updateTask(seed.taskId, {
            title,
            description,
            status: statusValue,
            dueAt: dueMs,
            reminderAt,
            tags,
            calendarId: calSelect.value || null,
          });
          this._pane._note('edited', `task "${title}"`, seed.taskId);
        } else {
          this._pane._note('created', `task "${title}"`);
          await this._pane._data.createTask({
            title,
            description,
            status: statusValue,
            dueAt: dueMs,
            reminderAt: reminderAt ?? null,
            tags,
            calendarId: calSelect.value || null,
          });
        }
        close();
      } catch (err) {
        const msg = err instanceof Error ? err.message : String(err);
        await this._pane._api.window.showErrorMessage(`Could not save task: ${msg}`);
      }
    };
    save.addEventListener('click', () => void doSave());
    foot.appendChild(save);
    pop.appendChild(foot);

    overlay.appendChild(pop);
    document.body.appendChild(overlay);

    function onKey(e: KeyboardEvent): void {
      if (e.key === 'Escape') { close(); }
      else if (e.key === 'Enter' && !(e.target instanceof HTMLTextAreaElement)) {
        e.preventDefault(); void doSave();
      }
    }
    document.addEventListener('keydown', onKey);
    overlay.addEventListener('animationend', () => titleInput.focus(), { once: true });
    setTimeout(() => { if (document.activeElement !== titleInput) titleInput.focus(); }, 80);

    // Anchor positioning — same logic as the event popover.
    const m = pop.getBoundingClientRect();
    const vw = window.innerWidth, vh = window.innerHeight;
    let left = anchor.left;
    let top = anchor.bottom + 6;
    if (anchor.left + m.width > vw - 12) left = Math.max(12, vw - m.width - 12);
    if (top + m.height > vh - 12) top = Math.max(12, anchor.top - m.height - 6);
    pop.style.left = `${left}px`;
    pop.style.top = `${top}px`;
  }

  // ── Event popover (create + edit) ───────────────────────────────────
}
