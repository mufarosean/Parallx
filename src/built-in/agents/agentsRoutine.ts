// agentsRoutine.ts — the New Routine form, inside the Agents view.
//
// A routine is a workflow: a schedule step and an agent step (routineDoc).
// The form asks what it should do, on which days, at what time, and
// optionally the page it writes its result into. The next three runs are shown as you choose, and Try It
// Once Now saves the routine and runs it straight away.

import { appDateParts, appDateString, appTime } from '../../services/localTime.js';
import { $ } from '../../ui/dom.js';
import { createButton, createSectionLabel } from '../../ui/kit.js';
import { svc } from './agentsServices.js';
import type { WorkflowDoc } from '../../services/workflows/workflowTypes.js';

const DAYS: readonly { label: string; dow: number }[] = [
  { label: 'Mon', dow: 1 }, { label: 'Tue', dow: 2 }, { label: 'Wed', dow: 3 },
  { label: 'Thu', dow: 4 }, { label: 'Fri', dow: 5 }, { label: 'Sat', dow: 6 }, { label: 'Sun', dow: 0 },
];

/** 5-field cron for the chosen days and time. Test seam. */
export function routineCron(days: ReadonlySet<number>, hour: number, minute: number): string {
  const dow = days.size === 0 || days.size === 7 ? '*' : [...days].sort((a, b) => a - b).join(',');
  return `${minute} ${hour} * * ${dow}`;
}

/** The next `count` run times after `now`. Test seam. */
export function nextRoutineRuns(days: ReadonlySet<number>, hour: number, minute: number, now: number, count = 3): number[] {
  const out: number[] = [];
  if (days.size === 0) return out;
  // The user's wall clock (the app's Time Zone), as the schedule runs on it.
  const d = appDateParts(now);
  for (let i = 0; i < 7 * count + 1 && out.length < count; i++) {
    const c = appTime(d.year, d.month, d.day + i, hour, minute, 0, 0);
    if (c > now && days.has(appDateParts(c).weekday)) out.push(c);
  }
  return out;
}

/** The agent's instruction: what to do, and where to put the result. Test seam. */
export function routinePrompt(what: string, page: string): string {
  const task = what.trim();
  const where = page.trim();
  return where ? `${task}\n\nWrite the result into the canvas page "${where}" (create it if it does not exist).` : task;
}

function fmtRun(ms: number): string {
  const d = appDateParts(ms);
  const day = appDateString(ms, { weekday: 'long' });
  return `${day} ${String(d.hour).padStart(2, '0')}:${String(d.minute).padStart(2, '0')}`;
}

export function renderRoutineForm(host: HTMLElement, onClose: (saved: boolean) => void): () => void {
  const form = document.createElement('form');
  form.className = 'agents-routine';
  form.noValidate = true;

  const field = (label: string, control: HTMLElement, id: string, hint?: string): HTMLElement => {
    const wrap = $('div.agents-routine__field');
    const l = document.createElement('label');
    l.className = 'agents-routine__label';
    l.htmlFor = id;
    l.textContent = label;
    control.id = id;
    wrap.append(l, control);
    if (hint) { const h = $('div.agents-routine__hint'); h.textContent = hint; wrap.appendChild(h); }
    return wrap;
  };

  const name = document.createElement('input');
  name.type = 'text';
  name.className = 'agents-routine__input';
  name.placeholder = 'Morning Brief';
  name.maxLength = 60;

  const what = document.createElement('textarea');
  what.className = 'agents-routine__input agents-routine__what';
  what.rows = 3;
  what.placeholder = 'Look over what changed since yesterday and sum it up in a few lines, with anything due today first.';

  const page = document.createElement('input');
  page.type = 'text';
  page.className = 'agents-routine__input';
  page.placeholder = 'Daily Brief';

  form.appendChild(field('Name', name, 'agents-routine-name'));
  form.appendChild(field('What should it do', what, 'agents-routine-what'));

  // When: day chips and a time.
  const when = $('div.agents-routine__field');
  const whenLabel = $('div.agents-routine__label'); whenLabel.textContent = 'When';
  const chips = $('div.agents-routine__days');
  chips.setAttribute('role', 'group');
  chips.setAttribute('aria-label', 'Days');
  const days = new Set<number>([1, 2, 3, 4, 5]);
  for (const d of DAYS) {
    const b = document.createElement('button');
    b.type = 'button';
    b.className = 'agents-routine__day';
    b.textContent = d.label;
    b.setAttribute('aria-pressed', String(days.has(d.dow)));
    b.addEventListener('click', () => {
      if (days.has(d.dow)) days.delete(d.dow); else days.add(d.dow);
      b.setAttribute('aria-pressed', String(days.has(d.dow)));
      update();
    });
    chips.appendChild(b);
  }
  const time = document.createElement('input');
  time.type = 'time';
  time.className = 'agents-routine__input agents-routine__time';
  time.value = '07:45';
  time.setAttribute('aria-label', 'Time');
  const whenRow = $('div.agents-routine__when');
  whenRow.append(chips, time);
  when.append(whenLabel, whenRow);
  form.appendChild(when);

  form.appendChild(field('Where it writes', page, 'agents-routine-page', 'A canvas page for the result. Leave empty to keep it in History only.'));

  const nextBox = $('div.agents-routine__next');
  createSectionLabel(nextBox, 'Next runs');
  const nextList = $('div.agents-routine__runs');
  nextBox.appendChild(nextList);
  form.appendChild(nextBox);

  const error = $('div.agents-routine__error');
  error.setAttribute('role', 'alert');
  form.appendChild(error);

  const bar = $('div.agents-routine__actions');
  createButton(bar, { label: 'Cancel', kind: 'ghost', size: 'sm', onClick: () => onClose(false) });
  const tryNow = createButton(bar, { label: 'Try It Once Now', kind: 'secondary', size: 'sm', onClick: () => save(true) });
  const saveBtn = createButton(bar, { label: 'Save Routine', kind: 'primary', size: 'sm', onClick: () => save(false) });
  form.appendChild(bar);

  const parseTime = (): [number, number] | null => {
    const m = /^(\d{1,2}):(\d{2})$/.exec(time.value);
    if (!m) return null;
    const h = Number(m[1]); const mi = Number(m[2]);
    return h < 24 && mi < 60 ? [h, mi] : null;
  };

  function update(): void {
    const t = parseTime();
    nextList.replaceChildren();
    const runs = t ? nextRoutineRuns(days, t[0], t[1], Date.now()) : [];
    if (!runs.length) {
      const none = $('div.agents-routine__hint'); none.textContent = 'Pick at least one day and a time.';
      nextList.appendChild(none);
    }
    for (const r of runs) { const row = $('div.agents-routine__run'); row.textContent = fmtRun(r); nextList.appendChild(row); }
  }
  time.addEventListener('input', update);
  update();

  let savedId: string | null = null;
  function save(runNow: boolean): void {
    error.textContent = '';
    const t = parseTime();
    const task = what.value.trim();
    if (!task) { error.textContent = 'Say what it should do.'; what.focus(); return; }
    if (!t || days.size === 0) { error.textContent = 'Pick at least one day and a time.'; return; }
    const wf = svc.workflows;
    if (!wf) { error.textContent = 'Routines are not available in this workspace.'; return; }
    const doc = routineDoc({
      name: name.value.trim() || task.split(/\n|[.!?]\s/)[0].slice(0, 48),
      task,
      page: page.value,
      cron: routineCron(days, t[0], t[1]),
    });
    try {
      if (savedId) wf.updateWorkflow(savedId, doc);
      else savedId = wf.addWorkflow(doc).id;
    } catch (err) {
      error.textContent = err instanceof Error ? err.message : 'Could not save the routine.';
      return;
    }
    if (runNow) {
      tryNow.disabled = true;
      saveBtn.disabled = true;
      void wf.runNow(savedId)
        .catch((err) => { error.textContent = err instanceof Error ? err.message : 'The test run failed.'; })
        .finally(() => onClose(true));
      return;
    }
    onClose(true);
  }

  form.addEventListener('submit', (e) => { e.preventDefault(); save(false); });
  host.appendChild(form);
  setTimeout(() => name.focus(), 0);
  return () => form.remove();
}

/**
 * The routine the form makes: one schedule step and one agent step, a
 * workflow like any other, so Edit Steps opens it in the step editor and
 * it runs on the same engine as every routine. Test seam.
 */
export function routineDoc(r: { name: string; task: string; page: string; cron: string }): Omit<WorkflowDoc, 'id' | 'createdAt' | 'updatedAt'> {
  return {
    name: r.name,
    description: r.task.length > 90 ? `${r.task.slice(0, 89)}…` : r.task,
    class: 'quiet',
    enabled: true,
    source: 'user',
    nodes: [
      { id: 'when', label: 'When', kind: 'trigger.schedule', spec: { kind: 'cron', expr: r.cron }, x: 60, y: 120 },
      { id: 'do', label: 'Do It', kind: 'action.agentTurn', prompt: routinePrompt(r.task, r.page), x: 320, y: 120 },
    ],
    edges: [{ from: 'when', to: 'do' }],
  };
}

/** A routine's schedule in words: "Weekdays at 07:45", "Mon, Thu at 18:00".
 *  Falls back to null for shapes this form does not make. Test seam. */
export function describeRoutineCron(expr: string | undefined): string | null {
  const m = /^(\d{1,2}) (\d{1,2}) \* \* ([\d,]+|\*)$/.exec((expr ?? '').trim());
  if (!m) return null;
  const time = `${m[2].padStart(2, '0')}:${m[1].padStart(2, '0')}`;
  if (m[3] === '*') return `Every day at ${time}`;
  const days = new Set(m[3].split(',').map(Number));
  if (days.size === 7) return `Every day at ${time}`;
  if (days.size === 5 && [1, 2, 3, 4, 5].every((d) => days.has(d))) return `Weekdays at ${time}`;
  if (days.size === 2 && days.has(0) && days.has(6)) return `Weekends at ${time}`;
  const names = DAYS.filter((d) => days.has(d.dow)).map((d) => d.label);
  return `${names.join(', ')} at ${time}`;
}
