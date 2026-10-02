// agentsRun.ts — the run tab: watch one agent task, and steer it.
//
// Opened from Watch on a running card. A timeline of the plan (done,
// working, waiting, blocked), what the task has touched, and a note box:
// a note pauses the task after the step it is on, joins its constraints,
// and the task replans and carries on (agentSessionService.redirectTask,
// which only accepts a paused task, hence the pause first).

import { DisposableStore, type IDisposable } from '../../platform/lifecycle.js';
import { $ } from '../../ui/dom.js';
import { createButton } from '../../ui/kit.js';
import { createIconElement } from '../../ui/iconRegistry.js';
import type { AgentPlanStep, AgentTaskRecord } from '../../agent/agentTypes.js';
import { nameFrom } from './agentsModel.js';
import { onAnyChange, resolveServices, svc, type ParallxApi } from './agentsServices.js';

export const AGENT_RUN_EDITOR = 'agents-run';

const STATUS_WORDS: Record<string, string> = {
  pending: 'Starting',
  planning: 'Planning',
  'awaiting-approval': 'Waiting for your OK',
  running: 'Working',
  blocked: 'Stuck',
  paused: 'Paused',
  completed: 'Done',
  failed: 'Failed',
  cancelled: 'Stopped',
};

const STEP_ICON: Record<string, string> = {
  completed: 'circle-check',
  running: 'loader-circle',
  pending: 'circle',
  blocked: 'circle-alert',
  cancelled: 'circle-stop',
};

/** Pending notes, by task: sent once the task has paused after its step. */
const pendingNotes = new Map<string, string>();
/** What you have typed but not sent, by task: repaints must not lose it. */
const drafts = new Map<string, string>();

async function deliverNote(taskId: string, note: string): Promise<void> {
  if (!svc.sessions) return;
  await svc.sessions.redirectTask(taskId, note);
  await svc.execution?.runTask(taskId);
}

export function renderAgentRun(container: HTMLElement, taskId: string, api: ParallxApi): IDisposable {
  const store = new DisposableStore();
  const root = $('div.agents-run');
  container.appendChild(root);
  let disposed = false;

  const paint = (): void => {
    resolveServices(api);
    const task = svc.sessions?.getTask(taskId);
    const old = root.querySelector('.agents-run__note') as HTMLTextAreaElement | null;
    const hadFocus = !!old && document.activeElement === old;
    const caret = old ? [old.selectionStart, old.selectionEnd] as const : null;
    root.replaceChildren();
    if (!task) {
      const gone = $('div.agents-run__gone');
      gone.textContent = 'This task is no longer around. Finished tasks keep their record in the Autonomy Log.';
      root.appendChild(gone);
      return;
    }
    const steps = svc.sessions?.getPlanSteps(taskId) ?? [];
    root.appendChild(header(task, steps));
    root.appendChild(timeline(task, steps));
    if (task.artifactRefs.length) root.appendChild(touched(task));
    root.appendChild(steer(task));
    const note = root.querySelector('.agents-run__note') as HTMLTextAreaElement | null;
    if (note && hadFocus && !note.disabled) {
      note.focus();
      if (caret) note.setSelectionRange(caret[0], caret[1]);
    }
  };

  const header = (task: AgentTaskRecord, steps: readonly AgentPlanStep[]): HTMLElement => {
    const head = $('div.agents-run__head');
    const title = $('div.agents-run__title'); title.textContent = nameFrom(task.goal, 'Task');
    const meta = $('div.agents-run__meta');
    const pill = $(`span.agents-run__pill.agents-run__pill--${task.status}`);
    pill.textContent = STATUS_WORDS[task.status] ?? task.status;
    const done = steps.filter((s) => s.status === 'completed').length;
    const when = $('span');
    const started = new Date(task.createdAt);
    when.textContent = `${steps.length ? `${done} of ${steps.length} steps · ` : ''}started ${String(started.getHours()).padStart(2, '0')}:${String(started.getMinutes()).padStart(2, '0')}`;
    meta.append(pill, when);
    head.append(title, meta);
    if (task.goal.trim() !== title.textContent) {
      const goal = $('div.agents-run__goal'); goal.textContent = task.goal;
      head.appendChild(goal);
    }
    const bar = $('div.agents-run__actions');
    const paused = task.status === 'paused' || task.status === 'blocked';
    const active = !['completed', 'failed', 'cancelled'].includes(task.status);
    if (active && !paused && !task.stopAfterCurrentStep && task.status !== 'awaiting-approval') {
      createButton(bar, { label: 'Pause', kind: 'secondary', size: 'sm', title: 'Stop after the current step', onClick: () => { void svc.sessions?.requestStopAfterCurrentStep(taskId); } });
    }
    if (paused) {
      createButton(bar, { label: 'Continue', kind: 'primary', size: 'sm', onClick: () => { void svc.sessions?.continueTask(taskId).then(() => svc.execution?.runTask(taskId)); } });
    }
    if (task.status === 'awaiting-approval') {
      createButton(bar, { label: 'Answer In Agents', kind: 'primary', size: 'sm', onClick: () => { void api.commands.executeCommand('agents.show'); } });
    }
    if (bar.childElementCount) head.appendChild(bar);
    if (task.blockerReason && paused) {
      const why = $('div.agents-run__why'); why.textContent = task.blockerReason;
      head.appendChild(why);
    }
    return head;
  };

  const timeline = (task: AgentTaskRecord, steps: readonly AgentPlanStep[]): HTMLElement => {
    const box = $('section.agents-run__section');
    const label = $('div.px-section-label'); label.textContent = 'Plan';
    box.appendChild(label);
    if (!steps.length) {
      const empty = $('div.agents-run__empty');
      empty.textContent = task.status === 'planning' || task.status === 'pending' ? 'Working out the steps…' : 'No steps yet.';
      box.appendChild(empty);
      return box;
    }
    const list = $('ol.agents-run__steps');
    for (const step of steps) {
      const current = step.id === task.currentStepId || step.status === 'running';
      const li = $(`li.agents-run__step.agents-run__step--${step.status}${current ? '.agents-run__step--current' : ''}`);
      const icon = createIconElement(STEP_ICON[step.status] ?? 'circle', 14);
      icon.classList.add('agents-run__step-icon');
      const text = $('div.agents-run__step-text');
      const t = $('div.agents-run__step-title'); t.textContent = step.title;
      text.appendChild(t);
      const sub = step.lastError || step.resultSummary || (current ? step.description : '');
      if (sub) { const d = $('div.agents-run__step-sub'); d.textContent = sub; text.appendChild(d); }
      if (step.approvalState === 'pending') {
        const w = $('div.agents-run__step-sub.agents-run__step-sub--ask'); w.textContent = 'Needs your OK'; text.appendChild(w);
      }
      li.append(icon, text);
      list.appendChild(li);
    }
    box.appendChild(list);
    return box;
  };

  const touched = (task: AgentTaskRecord): HTMLElement => {
    const box = $('section.agents-run__section');
    const label = $('div.px-section-label'); label.textContent = 'What it touched';
    box.appendChild(label);
    const list = $('ul.agents-run__touched');
    for (const ref of task.artifactRefs.slice(0, 30)) {
      const li = $('li'); li.textContent = ref; list.appendChild(li);
    }
    box.appendChild(list);
    return box;
  };

  const steer = (task: AgentTaskRecord): HTMLElement => {
    const box = $('section.agents-run__section.agents-run__steer');
    const active = !['completed', 'failed', 'cancelled'].includes(task.status);
    const label = $('div.px-section-label'); label.textContent = 'Steer it';
    box.appendChild(label);
    if (!active) {
      const done = $('div.agents-run__empty'); done.textContent = 'This task has finished.';
      box.appendChild(done);
      return box;
    }
    const waiting = pendingNotes.get(taskId);
    const input = document.createElement('textarea');
    input.className = 'agents-run__note';
    input.rows = 2;
    input.placeholder = 'Tell it something, like "leave the archive folder alone"';
    input.setAttribute('aria-label', 'A note for the agent');
    if (waiting) { input.value = waiting; input.disabled = true; } else input.value = drafts.get(taskId) ?? '';
    input.addEventListener('input', () => { drafts.set(taskId, input.value); });
    const row = $('div.agents-run__steer-row');
    const hint = $('div.agents-run__hint');
    hint.textContent = waiting
      ? 'Your note goes in as soon as the current step finishes.'
      : 'It finishes the step it is on, then replans with your note.';
    const send = (): void => {
      const note = input.value.trim();
      if (!note || pendingNotes.has(taskId)) return;
      const t = svc.sessions?.getTask(taskId);
      if (!t) return;
      if (t.status === 'paused' || t.status === 'blocked') {
        void deliverNote(taskId, note).catch((err) => console.warn('[Agents] note failed:', err));
      } else {
        pendingNotes.set(taskId, note);
        void svc.sessions?.requestStopAfterCurrentStep(taskId);
      }
      drafts.delete(taskId);
      input.value = '';
      paint();
    };
    input.addEventListener('keydown', (e) => {
      if (e.key === 'Enter' && (e.ctrlKey || e.metaKey)) { e.preventDefault(); send(); }
    });
    row.appendChild(hint);
    createButton(row, { label: 'Send Note', kind: 'secondary', size: 'sm', disabled: !!waiting, onClick: send });
    box.append(input, row);
    return box;
  };

  // A note waiting for the pause goes in once the task stops.
  const onChange = (): void => {
    if (disposed) return;
    const note = pendingNotes.get(taskId);
    const t = svc.sessions?.getTask(taskId);
    if (note && t && (t.status === 'paused' || t.status === 'blocked')) {
      pendingNotes.delete(taskId);
      void deliverNote(taskId, note).catch((err) => console.warn('[Agents] note failed:', err));
    }
    paint();
  };

  resolveServices(api);
  store.add(onAnyChange(onChange));
  paint();

  return {
    dispose(): void {
      disposed = true;
      store.dispose();
      root.remove();
    },
  };
}
