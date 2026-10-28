// plannerTaskPopover.ts — the Planner's task dialog: new or edit, title, when
// it is due (a date, a time or all day), reminder, calendar, tags, notes and
// status; Save (or Create Task) and Delete. The Tasks list, Today and the
// calendar open it. Every control is the kit's: the date and time are the
// app's own fields (dateTimeField.ts), not the browser's.

import {
  createButton, createDateField, createIconButton, createInput, createSegmented, createSelect, createSurface, createTimeField, createToggle,
  type IKitPickerField,
} from '../../ui/kit.js';
import { keepTabInside } from '../../ui/dom.js';
import type { IDisposable } from '../../platform/lifecycle.js';
import type { PlannerTask, TaskStatus } from './plannerTypes.js';
import { appDateParts } from '../../services/localTime.js';
import { toDateInputValue, toTimeInputValue, fromDateTimeInputs } from './plannerDates.js';
import { autoGrow, el, formRow } from './plannerUi.js';
import type { PlannerEditorPane } from './plannerEditorProvider.js';

const REMINDER_PRESETS: { label: string; offsetMin: number | null }[] = [
  { label: 'No reminder', offsetMin: null },
  { label: 'When due', offsetMin: 0 },
  { label: '5 minutes before', offsetMin: 5 },
  { label: '15 minutes before', offsetMin: 15 },
  { label: '30 minutes before', offsetMin: 30 },
  { label: '1 hour before', offsetMin: 60 },
  { label: '1 day before', offsetMin: 1440 },
  { label: '1 week before', offsetMin: 10_080 },
];

export class PlannerTaskPopover {
  constructor(private readonly _pane: PlannerEditorPane) {}

  /**
   * One dialog for creating and editing a task, so every path that makes a
   * task fills in the same fields. Save commits through createTask or
   * updateTask; Delete shows only when editing. Escape, a press outside,
   * × and Cancel all close it the same way.
   */
  openTaskPopover(
    init: { mode: 'create'; seedDueAt?: number; seedStatus?: TaskStatus; seedTitle?: string }
        | { mode: 'edit'; task: PlannerTask },
    anchor: DOMRect,
  ): void {
    void this._open(init, anchor);
  }

  private async _open(
    init: { mode: 'create'; seedDueAt?: number; seedStatus?: TaskStatus; seedTitle?: string } | { mode: 'edit'; task: PlannerTask },
    anchor: DOMRect,
  ): Promise<void> {
    const cals = await this._pane._data.listCalendars().catch(() => []);
    const disposables: IDisposable[] = [];
    // A modal dialog: focus goes back where it was when it closes.
    const returnFocus = document.activeElement instanceof HTMLElement && document.activeElement !== document.body ? document.activeElement : null;
    const close = () => {
      for (const d of disposables) { try { d.dispose(); } catch { /* noop */ } }
      disposables.length = 0;
      overlay.remove();
      document.removeEventListener('keydown', onKey);
      if (returnFocus?.isConnected && (!document.activeElement || document.activeElement === document.body)) returnFocus.focus();
    };

    const overlay = el('div', 'planner-popover-overlay');
    overlay.addEventListener('click', (e) => { if (e.target === overlay) close(); });
    const pop = el('div', 'planner-popover planner-form');
    pop.style.position = 'fixed';
    createSurface(pop, { id: 'planner.taskPopover', owner: 'planner', label: 'Task' });

    const isEdit = init.mode === 'edit';
    pop.setAttribute('role', 'dialog'); pop.setAttribute('aria-modal', 'true'); pop.setAttribute('aria-label', isEdit ? 'Edit Task' : 'New Task');
    keepTabInside(pop);
    // New tasks: due in five days, in the Review Queue (the journaling flow);
    // a drag on the calendar passes its own day and 'planned'.
    const task = isEdit ? init.task : null;
    const dueAt = task?.dueAt ?? (init.mode === 'create' ? init.seedDueAt : undefined) ?? Date.now() + 5 * 86_400_000;
    const reminderMin = task?.reminderAt != null && task.dueAt != null ? Math.max(0, Math.round((task.dueAt - task.reminderAt) / 60_000)) : null;

    // Header
    const head = el('div', 'planner-popover__head');
    const heading = el('h3', 'planner-popover__title');
    heading.textContent = isEdit ? 'Edit Task' : 'New Task';
    head.appendChild(heading);
    createIconButton(head, { id: 'planner.task.close', icon: 'close', title: 'Close', size: 'sm', onClick: () => close() });
    pop.appendChild(head);

    const body = el('div', 'planner-popover__body planner-form__body');
    const title = createInput(body, { id: 'planner.task.title', label: 'Title', placeholder: 'What needs to happen?', value: task?.title ?? (init.mode === 'create' ? init.seedTitle : '') ?? '' });
    title.element.classList.add('planner-form__title');
    disposables.push(title);
    const titleInput = title.element.querySelector('input') ?? title.element;

    // When: a date, then a time unless it is all day.
    const when = formRow(body, 'Due');
    const date: IKitPickerField = createDateField(when, { id: 'planner.task.dueDate', label: 'Due date', value: toDateInputValue(dueAt) });
    const time: IKitPickerField = createTimeField(when, { id: 'planner.task.dueTime', label: 'Due time', value: toTimeInputValue(dueAt) });
    disposables.push(date, time);
    time.element.classList.add('planner-form__time');
    const allDayWrap = el('label', 'planner-form__inline');
    const midnight = appDateParts(dueAt).hour === 0 && appDateParts(dueAt).minute === 0;
    const allDay = createToggle(allDayWrap, { id: 'planner.task.allDay', label: 'All day', checked: midnight && !isEdit, onChange: (on) => { time.disabled = on; } });
    disposables.push(allDay);
    const allDayText = el('span');
    allDayText.textContent = 'All day';
    allDayWrap.appendChild(allDayText);
    when.appendChild(allDayWrap);
    time.disabled = allDay.checked;

    const remindValue = reminderMin == null ? 'none' : String(REMINDER_PRESETS.some((p) => p.offsetMin === reminderMin) ? reminderMin : 60);
    const remind = createSelect(formRow(body, 'Remind'), {
      id: 'planner.task.reminder', label: 'Reminder', value: remindValue, onChange: () => {},
      items: REMINDER_PRESETS.map((p) => ({ value: p.offsetMin === null ? 'none' : String(p.offsetMin), label: p.label })),
    });
    disposables.push(remind);

    const calId = task?.calendarId ?? cals.find((c) => c.id === 'cal-tasks')?.id ?? cals.find((c) => c.isDefault)?.id ?? cals[0]?.id ?? '';
    const calendar = createSelect(formRow(body, 'Calendar'), {
      id: 'planner.task.calendar', label: 'Calendar', value: calId, onChange: () => {},
      items: cals.map((c) => ({ value: c.id, label: c.name })),
    });
    disposables.push(calendar);

    const tags = createInput(formRow(body, 'Tags'), { id: 'planner.task.tags', label: 'Tags', placeholder: 'errands, calls', value: (task?.tags ?? []).join(', ') });
    disposables.push(tags);

    const notesCell = formRow(body, 'Notes');
    const descInput = el('textarea', 'planner-form__notes') as HTMLTextAreaElement;
    descInput.placeholder = 'Notes and links';
    descInput.setAttribute('aria-label', 'Notes');
    descInput.value = task?.description ?? '';
    notesCell.appendChild(descInput);
    autoGrow(descInput);
    this._pane.notes.appendNotesToolbar(notesCell, descInput);
    this._pane.notes.attachDescriptionLinks(notesCell, descInput);

    const startStatus: TaskStatus = task ? (task.status === 'cancelled' ? 'reviewing' : task.status) : (init.mode === 'create' ? init.seedStatus : undefined) ?? 'reviewing';
    const status = createSegmented(formRow(body, 'Status'), {
      id: 'planner.task.status', ariaLabel: 'Status', value: startStatus,
      items: [{ value: 'reviewing', label: 'Reviewing' }, { value: 'planned', label: 'Planned' }, ...(isEdit ? [{ value: 'done', label: 'Done' }] : [])],
    });
    disposables.push(status);
    pop.appendChild(body);

    // Footer
    const foot = el('div', 'planner-popover__foot');
    if (task) {
      createButton(foot, {
        id: 'planner.task.delete', label: 'Delete', kind: 'danger',
        onClick: () => { void this._pane._data.removeTask(task.id).then(close); },
      });
    }
    foot.appendChild(el('span', 'planner-popover__spacer'));
    createButton(foot, { id: 'planner.task.cancel', label: 'Cancel', kind: 'secondary', onClick: () => close() });
    const doSave = async () => {
      const name = title.value.trim();
      if (!name) { titleInput.focus(); return; }
      const dueMs = fromDateTimeInputs(date.value, allDay.checked ? '00:00' : time.value);
      if (dueMs === null) {
        await this._pane._api.window.showErrorMessage('Invalid due date or time.');
        return;
      }
      const offset = remind.value || 'none';
      const reminderAt = offset === 'none' ? null : dueMs - parseInt(offset, 10) * 60_000;
      const fields = {
        title: name,
        description: descInput.value.trim() || null,
        status: (status.value || 'reviewing') as TaskStatus,
        dueAt: dueMs,
        reminderAt,
        tags: tags.value.split(',').map((s) => s.trim()).filter(Boolean),
        calendarId: calendar.value || null,
      };
      try {
        if (task) {
          await this._pane._data.updateTask(task.id, fields);
          this._pane._note('edited', `task "${name}"`, task.id);
        } else {
          this._pane._note('created', `task "${name}"`);
          await this._pane._data.createTask(fields);
        }
        close();
      } catch (err) {
        await this._pane._api.window.showErrorMessage(`Could not save task: ${err instanceof Error ? err.message : String(err)}`);
      }
    };
    createButton(foot, { id: 'planner.task.save', label: isEdit ? 'Save' : 'Create Task', kind: 'primary', onClick: () => void doSave() });
    pop.appendChild(foot);

    overlay.appendChild(pop);
    document.body.appendChild(overlay);

    // Escape and Enter belong to an open date or time picker first.
    function onKey(e: KeyboardEvent): void {
      if (document.querySelector('.px-picker')) return;
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
