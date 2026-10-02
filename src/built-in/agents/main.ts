// Agents — built-in right-sidebar view: the home for work the AI does on
// its own.
//
// Chat is where you talk; Agents is where you see what is running in the
// background and step in. Four sections, top to bottom in order of urgency:
// Needs you (approvals), Running now (live step and progress, Pause /
// Continue), Coming up (scheduled routines and the heartbeat), Done today.
// The header switch is the global pause (FLAG_PAUSED_GLOBAL). The Autonomy
// Log in the panel keeps the full history.

import './agents.css';

import type { ToolContext } from '../../tools/toolModuleLoader.js';
import { DisposableStore, type IDisposable } from '../../platform/lifecycle.js';
import { $ } from '../../ui/dom.js';
import { createButton, createEmptyState, createIconButton, createSectionLabel } from '../../ui/kit.js';
import { createIconElement } from '../../ui/iconRegistry.js';
import type { AgentApprovalResolution } from '../../agent/agentTypes.js';
import type { IAgentsSnapshot } from './agentsModel.js';
import { agentsViewInFront, startAgentsPresence } from './agentsPresence.js';
import { AGENT_RUN_EDITOR, renderAgentRun } from './agentsRun.js';
import { renderRoutineForm } from './agentsRoutine.js';
import { answerApproval, isPaused, onAnyChange, readSnapshot, resolveServices, setPaused, svc, type ParallxApi } from './agentsServices.js';

export function activate(api: ParallxApi, context: ToolContext): void {
  resolveServices(api);
  context.subscriptions.push(api.views.registerViewProvider('view.agents', {
    createView(container: HTMLElement): IDisposable {
      return renderAgentsView(container, api);
    },
  }));
  // Show View on a right-sidebar container that is already in front flips
  // back to Chat, so only ask when Agents isn't showing.
  const reveal = async (): Promise<void> => {
    if (agentsViewInFront()) return;
    await api.commands.executeCommand('workbench.view.show', 'view.agents').catch(() => undefined);
  };
  context.subscriptions.push(api.commands.registerCommand('agents.show', reveal));
  context.subscriptions.push(api.commands.registerCommand('agents.newRoutine', async () => {
    await reveal();
    _openRoutine?.();
  }));
  // The run tab: one task's plan, live, with a note box to steer it.
  context.subscriptions.push(api.editors.registerEditorProvider(AGENT_RUN_EDITOR, {
    createEditorPane(container: HTMLElement, input?: unknown): IDisposable {
      const obj = input as { instanceId?: string; id?: string } | undefined;
      return renderAgentRun(container, obj?.instanceId ?? obj?.id ?? '', api);
    },
  }));
  context.subscriptions.push(api.commands.registerCommand('agents.openRun', async (...args: unknown[]) => {
    const taskId = String(args[0] ?? '');
    const title = typeof args[1] === 'string' && args[1] ? args[1] : 'Agent Run';
    if (taskId) await api.editors.openEditor({ typeId: AGENT_RUN_EDITOR, title, icon: 'px-automations', instanceId: taskId });
  }));
  context.subscriptions.push(startAgentsPresence(api));
}

/** The mounted view's "open the New Routine form", for the command. */
let _openRoutine: (() => void) | undefined;

export function deactivate(): void { /* the view disposes itself */ }

function renderAgentsView(container: HTMLElement, api: ParallxApi): IDisposable {
  let store = new DisposableStore();
  const root = $('div.agents-view');
  container.appendChild(root);

  // ── New Routine and the background switch ──
  // The sidebar header already says "Agents"; this row holds the controls.
  const head = $('div.agents-head');
  createIconButton(head, { icon: 'plus', title: 'New Routine', size: 'sm', onClick: () => openRoutine() });
  const sw = $('label.agents-switch');
  const swText = $('span'); swText.textContent = 'Run in the background';
  const swBtn = document.createElement('button');
  swBtn.type = 'button';
  swBtn.className = 'agents-switch__track';
  swBtn.setAttribute('role', 'switch');
  swBtn.setAttribute('aria-label', 'Run agents in the background');
  swBtn.appendChild($('span.agents-switch__knob'));
  sw.append(swText, swBtn);
  head.appendChild(sw);
  root.appendChild(head);

  const body = $('div.agents-body');
  root.appendChild(body);

  let disposed = false;
  let pending = false;
  let busy = new Set<string>();
  // While the New Routine form is open the body is the form; repaints wait.
  let closeRoutine: (() => void) | null = null;
  const openRoutine = (): void => {
    if (closeRoutine) return;
    resolveServices(api);
    body.replaceChildren();
    root.classList.add('agents-view--form');
    closeRoutine = renderRoutineForm(body, () => {
      closeRoutine?.();
      closeRoutine = null;
      root.classList.remove('agents-view--form');
      repaint();
    });
  };
  _openRoutine = openRoutine;

  swBtn.addEventListener('click', () => {
    resolveServices(api);
    if (!svc.flags) return;
    void setPaused(!isPaused()).then(repaint);
  });

  const act = (key: string, work: () => Promise<unknown>): void => {
    if (busy.has(key)) return;
    busy.add(key);
    repaint();
    void work()
      .catch((err) => console.warn('[Agents] action failed:', err))
      .finally(() => { busy.delete(key); repaint(); });
  };

  const resolveApproval = (taskId: string, requestId: string, resolution: AgentApprovalResolution): void => {
    act(requestId, () => answerApproval(taskId, requestId, resolution));
  };

  function paint(s: IAgentsSnapshot): void {
    const live = !s.paused;
    swBtn.setAttribute('aria-checked', String(live));
    swBtn.disabled = !svc.flags;
    root.classList.toggle('agents-view--paused', s.paused);

    // Rebuild the body; sections keep their order, so nothing jumps.
    body.replaceChildren();

    if (s.paused) {
      const note = $('div.agents-paused');
      note.textContent = 'Agents are paused. Routines and the heartbeat wait until you turn this back on; anything running stops after its current step.';
      body.appendChild(note);
    }

    const nothing = !s.needsYou.length && !s.running.length && !s.upcoming.length && !s.done.length;
    if (nothing) {
      createEmptyState(body, {
        headline: 'Nothing running',
        hint: 'Tasks you hand to Chat in Agent mode, routines and the heartbeat show up here, with anything that needs your OK at the top.',
        icon: 'px-automations',
      });
    }

    if (s.needsYou.length) {
      const sec = section(body, 'Needs you', 'agents-section--needs');
      for (const n of s.needsYou) {
        const card = $('div.agents-card.agents-card--needs');
        const line = $('div.agents-card__line');
        const who = $('span.agents-card__name'); who.textContent = n.who;
        const what = $('span.agents-card__what'); what.textContent = ` wants to ${lowerFirst(n.what)}`;
        line.append(who, what);
        card.appendChild(line);
        if (n.detail) { const d = $('div.agents-card__detail'); d.textContent = n.detail; card.appendChild(d); }
        const bar = $('div.agents-card__actions');
        const waiting = busy.has(n.requestId);
        createButton(bar, { label: 'Allow', kind: 'primary', size: 'sm', disabled: waiting, onClick: () => resolveApproval(n.taskId, n.requestId, 'approve-once') });
        createButton(bar, { label: 'Allow This Task', kind: 'secondary', size: 'sm', disabled: waiting, title: 'Don’t ask again until this task finishes', onClick: () => resolveApproval(n.taskId, n.requestId, 'approve-for-task') });
        createButton(bar, { label: 'Reject', kind: 'secondary', size: 'sm', disabled: waiting, onClick: () => resolveApproval(n.taskId, n.requestId, 'deny') });
        card.appendChild(bar);
        sec.appendChild(card);
      }
    }

    if (s.running.length) {
      const sec = section(body, 'Running now');
      for (const r of s.running) {
        const card = $(`div.agents-card.agents-card--${r.state}`);
        const top = $('div.agents-card__top');
        top.appendChild($('span.agents-dot'));
        const name = $('span.agents-card__name'); name.textContent = r.name;
        top.appendChild(name);
        if (r.total > 0) { const c = $('span.agents-card__count'); c.textContent = `${r.done} of ${r.total}`; top.appendChild(c); }
        card.appendChild(top);
        const step = $('div.agents-card__step'); step.textContent = r.step;
        card.appendChild(step);
        if (r.total > 0) {
          const track = $('div.agents-progress');
          const fill = $('div.agents-progress__fill');
          fill.style.width = `${Math.round((r.done / r.total) * 100)}%`;
          track.appendChild(fill);
          card.appendChild(track);
        }
        {
          const bar = $('div.agents-card__actions');
          const waiting = busy.has(r.taskId);
          createButton(bar, { label: 'Watch', kind: 'secondary', size: 'sm', onClick: () => { void api.commands.executeCommand('agents.openRun', r.taskId, r.name); } });
          if (!r.action) { /* waiting on you, or already pausing */ } else if (r.action === 'pause') {
            createButton(bar, { label: 'Pause', kind: 'secondary', size: 'sm', disabled: waiting, title: 'Stop after the current step', onClick: () => act(r.taskId, () => svc.sessions!.requestStopAfterCurrentStep(r.taskId)) });
          } else {
            createButton(bar, { label: 'Continue', kind: 'secondary', size: 'sm', disabled: waiting, onClick: () => act(r.taskId, async () => { await svc.sessions!.continueTask(r.taskId); await svc.execution?.runTask(r.taskId); }) });
          }
          card.appendChild(bar);
        }
        sec.appendChild(card);
      }
    }

    if (s.upcoming.length) {
      const sec = section(body, 'Coming up');
      for (const u of s.upcoming) {
        const row = $('div.agents-row');
        const when = $('span.agents-row__when'); when.textContent = u.when;
        const text = $('span.agents-row__text');
        const name = $('span.agents-row__name'); name.textContent = u.name;
        text.appendChild(name);
        if (u.what) { const w = $('span.agents-row__what'); w.textContent = u.what; text.appendChild(w); }
        row.append(when, text);
        sec.appendChild(row);
      }
    }

    if (s.done.length) {
      const sec = section(body, 'Done today');
      for (const d of s.done) {
        const row = $(`div.agents-row.agents-row--${d.result}`);
        const icon = createIconElement(d.result === 'ok' ? 'circle-check' : d.result === 'failed' ? 'circle-alert' : 'circle-stop', 14);
        icon.classList.add('agents-row__icon');
        const text = $('span.agents-row__text');
        const name = $('span.agents-row__name'); name.textContent = d.name;
        text.appendChild(name);
        if (d.what) { const w = $('span.agents-row__what'); w.textContent = d.what; text.appendChild(w); }
        const when = $('span.agents-row__at'); when.textContent = d.when;
        row.append(icon, text, when);
        sec.appendChild(row);
      }
    }

    const foot = $('div.agents-foot');
    createButton(foot, {
      label: 'Open Autonomy Log',
      kind: 'ghost',
      size: 'sm',
      onClick: () => { void api.commands.executeCommand('workbench.view.show', 'view.autonomyLog').catch(() => undefined); },
    });
    body.appendChild(foot);
  }

  // Coalesce bursts of change events into one read per frame-ish.
  function repaint(): void {
    if (pending || disposed) return;
    pending = true;
    setTimeout(() => {
      pending = false;
      if (disposed) return;
      void readSnapshot(api).then((s) => { if (!disposed && !closeRoutine) paint(s); });
    }, 60);
  }

  const listen = (): void => {
    resolveServices(api);
    store.add(onAnyChange(repaint));
  };
  listen();
  // Services that registered after this view: pick them up once, shortly after.
  const heal = setTimeout(() => {
    const before = { ...svc };
    resolveServices(api);
    if (Object.keys(svc).some((k) => (svc as Record<string, unknown>)[k] !== (before as Record<string, unknown>)[k])) {
      store.dispose();
      store = new DisposableStore();
      listen();
    }
    repaint();
  }, 3000);
  // "in 5 min" and the heartbeat's next run move on their own.
  const tick = setInterval(repaint, 30_000);
  repaint();

  return {
    dispose(): void {
      disposed = true;
      if (_openRoutine === openRoutine) _openRoutine = undefined;
      clearTimeout(heal);
      clearInterval(tick);
      busy = new Set();
      store.dispose();
      root.remove();
    },
  };
}

function section(parent: HTMLElement, label: string, extra = ''): HTMLElement {
  const sec = $(`section.agents-section${extra ? `.${extra}` : ''}`);
  createSectionLabel(sec, label);
  parent.appendChild(sec);
  return sec;
}

function lowerFirst(s: string): string {
  return s ? s.charAt(0).toLowerCase() + s.slice(1) : s;
}
