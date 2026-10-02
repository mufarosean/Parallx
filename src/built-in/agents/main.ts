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
import { createButton, createEmptyState, createSectionLabel } from '../../ui/kit.js';
import { createIconElement } from '../../ui/iconRegistry.js';
import {
  IAgentApprovalService,
  IAgentExecutionService,
  IAgentSessionService,
  IAutonomyFeatureFlagsService,
  IAutonomyTaskRailService,
} from '../../services/serviceTypes.js';
import type {
  IAgentApprovalService as IApprovals,
  IAgentExecutionService as IExecution,
  IAgentSessionService as ISessions,
} from '../../services/serviceTypes.js';
import type { IAutonomyTaskRailService as IRail, IRailRow } from '../../services/autonomyTaskRailService.js';
import { FLAG_PAUSED_GLOBAL, type AutonomyFeatureFlagsService } from '../../services/autonomyFeatureFlags.js';
import { ICronService, type CronService } from '../../openclaw/openclawCronService.js';
import type { IHeartbeatState } from '../../openclaw/openclawHeartbeatRunner.js';
import type { AgentApprovalResolution } from '../../agent/agentTypes.js';
import { buildAgentsSnapshot, type IAgentsSnapshot } from './agentsModel.js';

interface ParallxApi {
  views: {
    registerViewProvider(
      viewId: string,
      provider: { createView(container: HTMLElement): IDisposable },
      options?: { name?: string; icon?: string },
    ): IDisposable;
  };
  commands: {
    registerCommand(commandId: string, handler: (...args: unknown[]) => unknown): IDisposable;
    executeCommand<T = unknown>(id: string, ...args: unknown[]): Promise<T>;
  };
  services: {
    has(id: unknown): boolean;
    get<T>(id: unknown): T;
  };
}

interface IServices {
  sessions?: ISessions;
  approvals?: IApprovals;
  execution?: IExecution;
  flags?: AutonomyFeatureFlagsService;
  cron?: CronService;
  rail?: IRail;
}

const svc: IServices = {};

/** The autonomy services can register after this view activates, so they
 *  are resolved again at every render; a found instance is never dropped. */
function resolveServices(api: ParallxApi): void {
  const get = <T>(id: unknown): T | undefined => (api.services.has(id) ? api.services.get<T>(id) : undefined);
  svc.sessions ??= get<ISessions>(IAgentSessionService);
  svc.approvals ??= get<IApprovals>(IAgentApprovalService);
  svc.execution ??= get<IExecution>(IAgentExecutionService);
  svc.flags ??= get<AutonomyFeatureFlagsService>(IAutonomyFeatureFlagsService);
  svc.cron ??= get<CronService>(ICronService);
  svc.rail ??= get<IRail>(IAutonomyTaskRailService);
}

export function activate(api: ParallxApi, context: ToolContext): void {
  resolveServices(api);
  context.subscriptions.push(api.views.registerViewProvider('view.agents', {
    createView(container: HTMLElement): IDisposable {
      return renderAgentsView(container, api);
    },
  }));
  context.subscriptions.push(api.commands.registerCommand('agents.show', async () => {
    await api.commands.executeCommand('workbench.view.show', 'view.agents').catch(() => undefined);
  }));
}

export function deactivate(): void { /* the view disposes itself */ }

async function readSnapshot(api: ParallxApi): Promise<IAgentsSnapshot> {
  resolveServices(api);
  const tasks = (svc.sessions?.listActiveWorkspaceTasks() ?? []).map((task) => ({
    task,
    steps: svc.sessions?.getPlanSteps(task.id) ?? [],
  }));
  let rows: readonly IRailRow[] = [];
  try { rows = (await svc.rail?.readRows({ sinceDays: 1, limit: 80 })) ?? []; } catch { /* history is optional */ }
  let heartbeat: IHeartbeatState | undefined;
  try { heartbeat = await api.commands.executeCommand<IHeartbeatState>('parallx.heartbeat.status'); } catch { /* no heartbeat */ }
  return buildAgentsSnapshot({
    paused: svc.flags?.isEnabled(FLAG_PAUSED_GLOBAL) ?? false,
    tasks,
    approvals: svc.approvals?.listPendingApprovalRequests() ?? [],
    jobs: svc.cron?.jobs ?? [],
    heartbeat: heartbeat && typeof heartbeat.nextDueMs === 'number' ? heartbeat : undefined,
    rows,
  });
}

function renderAgentsView(container: HTMLElement, api: ParallxApi): IDisposable {
  let store = new DisposableStore();
  const root = $('div.agents-view');
  container.appendChild(root);

  // ── The background switch ──
  // The sidebar header already says "Agents"; this row holds the switch.
  const head = $('div.agents-head');
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

  swBtn.addEventListener('click', () => {
    resolveServices(api);
    const flags = svc.flags;
    if (!flags) return;
    const paused = flags.isEnabled(FLAG_PAUSED_GLOBAL);
    void flags.setEnabled(FLAG_PAUSED_GLOBAL, !paused).then(repaint);
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
    act(requestId, async () => {
      const task = await svc.sessions!.resolveTaskApproval(taskId, requestId, resolution);
      if (resolution === 'approve-once' || resolution === 'approve-for-task' || task.status === 'planning') {
        await svc.execution?.runTask(taskId);
      }
    });
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
        if (r.action) {
          const bar = $('div.agents-card__actions');
          const waiting = busy.has(r.taskId);
          if (r.action === 'pause') {
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
      void readSnapshot(api).then((s) => { if (!disposed) paint(s); });
    }, 60);
  }

  const listen = (): void => {
    resolveServices(api);
    if (svc.sessions) store.add(svc.sessions.onDidChangeTasks(() => repaint()));
    if (svc.approvals) store.add(svc.approvals.onDidChangeApprovalRequests(() => repaint()));
    if (svc.flags) store.add(svc.flags.onDidChange(() => repaint()));
    if (svc.cron) store.add(svc.cron.onDidChangeJobs(() => repaint()));
    if (svc.rail) store.add(svc.rail.onDidChange(() => repaint()));
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
