// Agents — built-in right-sidebar view: the home for work the AI does on
// its own.
//
// Chat is where you talk; Agents is the one place for everything the AI
// does on its own. Four tabs:
//   Now       what needs you (approvals, heartbeat findings), what is
//             running, what is coming up, what finished today;
//   Routines  the heartbeat, scheduled routines and workflows, suggestions,
//             and ways to add one (agentsRoutines.ts);
//   History   every background run, newest first (agentsHistory.ts);
//   Mind      what it believes, habits it noticed, what it may do without
//             asking (agentsMind.ts).
// What agents may do on their own (the global pause included) is set in
// Settings › Agents, registered here (agentsSettings.ts). This replaced the
// Autonomy Log panel, which kept the same things in a second place.

import './agents.css';

import type { ToolContext } from '../../tools/toolModuleLoader.js';
import { DisposableStore, type IDisposable } from '../../platform/lifecycle.js';
import { $ } from '../../ui/dom.js';
import { createButton, createEmptyState, createIconButton, createSectionLabel, createSegmented } from '../../ui/kit.js';
import { createIconElement } from '../../ui/iconRegistry.js';
import type { AgentApprovalResolution } from '../../agent/agentTypes.js';
import type { IAgentsSnapshot } from './agentsModel.js';
import { agentsViewInFront, startAgentsPresence } from './agentsPresence.js';
import { AGENT_RUN_EDITOR, renderAgentRun } from './agentsRun.js';
import { renderRoutineForm } from './agentsRoutine.js';
import { answerApproval, isPaused, onAnyChange, readSnapshot, resolveServices, svc, type ParallxApi } from './agentsServices.js';
import { heartbeatActions, handledHeartbeat, isActionableHeartbeat, renderHistory } from './agentsHistory.js';
import { renderRoutines } from './agentsRoutines.js';
import { renderMind } from './agentsMind.js';
import { WorkflowEditorPane } from './workflowEditorPane.js';
import { AGENTS_SETTINGS_GROUP, registerAgentsSettings } from './agentsSettings.js';
import { ISettingsRegistryService, ICanvasPageQueryService } from '../../services/serviceTypes.js';
import { ILanguageModelToolsService, ILanguageModelsService } from '../../services/chatTypes.js';
import { isBrowserToolName } from '../../services/browserAutomationTypes.js';
import type { IAutonomyLogEntry } from '../../services/autonomyLogService.js';

type AgentsTab = 'now' | 'routines' | 'history' | 'mind';
let currentTab: AgentsTab = 'now';
/** The mounted view's tab switch, for commands that land on a tab. */
let _showTab: ((tab: AgentsTab) => void) | undefined;

export function activate(api: ParallxApi, context: ToolContext): void {
  resolveServices(api);
  // Settings › Agents: this built-in owns its section like any other.
  try {
    if (api.services.has(ISettingsRegistryService)) {
      registerAgentsSettings(
        api.services.get<import('../../services/settingsRegistryService.js').ISettingsRegistryService>(ISettingsRegistryService),
        svc.flags,
        svc.config,
      );
    }
  } catch (err) { console.warn('[Agents] settings registration failed:', err); }
  context.subscriptions.push(api.commands.registerCommand('agents.openSettings', (...args: unknown[]) =>
    api.commands.executeCommand('settings.open', typeof args[0] === 'string' ? args[0] : AGENTS_SETTINGS_GROUP)));
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

  // Commands other surfaces use to land on a tab (the planner's Scheduled
  // tab, the old Autonomy Log ids kept for keybindings and the AI).
  const showTab = async (tab: AgentsTab): Promise<boolean> => {
    currentTab = tab;
    _showTab?.(tab);
    await reveal();
    return true;
  };
  context.subscriptions.push(api.commands.registerCommand('agents.showRoutines', () => showTab('routines')));
  context.subscriptions.push(api.commands.registerCommand('agents.showHistory', () => showTab('history')));
  context.subscriptions.push(api.commands.registerCommand('workflows.showPanel', () => showTab('routines')));
  context.subscriptions.push(api.commands.registerCommand('autonomyLog.markAllRead', () => { resolveServices(api); svc.log?.markRead(); }));
  context.subscriptions.push(api.commands.registerCommand('autonomyLog.clear', () => { resolveServices(api); svc.log?.clear(); }));

  registerWorkflows(api, context);
}

/** The workflow editor (a document tab) and its commands. */
function registerWorkflows(api: ParallxApi, context: ToolContext): void {
  context.subscriptions.push(api.editors.registerEditorProvider('workflow', {
    createEditorPane(container: HTMLElement, input?: unknown): IDisposable {
      const obj = input as { instanceId?: string; id?: string } | undefined;
      const workflowId = obj?.instanceId ?? obj?.id ?? '';
      resolveServices(api);
      if (!svc.workflows) {
        const msg = document.createElement('div');
        msg.className = 'wfe__gone';
        msg.textContent = 'Workflows are not available in this workspace.';
        container.appendChild(msg);
        return { dispose: () => msg.remove() };
      }
      return new WorkflowEditorPane(container, workflowId, {
        service: svc.workflows,
        listTemplates: async () => {
          const res = await api.commands.executeCommand<{ id: string; name: string; description: string }[]>('canvas.listTemplates');
          return Array.isArray(res) ? res : [];
        },
        listModels: async () => {
          try {
            if (!api.services.has(ILanguageModelsService)) return [];
            const lm = api.services.get<import('../../services/chatTypes.js').ILanguageModelsService>(ILanguageModelsService);
            return (await lm.getModels()).map((m) => ({ id: m.id, displayName: m.displayName }));
          } catch { return []; }
        },
        listPages: async () => {
          try {
            if (!api.services.has(ICanvasPageQueryService)) return [];
            const canvas = api.services.get<import('../../services/serviceTypes.js').ICanvasPageQueryService>(ICanvasPageQueryService);
            return (await canvas.getRootPages()).filter((p) => !p.isArchived).map((p) => ({ id: p.id, title: p.title }));
          } catch { return []; }
        },
        listTools: () => {
          try {
            if (!api.services.has(ILanguageModelToolsService)) return [];
            const tools = api.services.get<import('../../services/chatTypes.js').ILanguageModelToolsService>(ILanguageModelToolsService);
            // Browser tools run only in a chat turn; a Tool step refuses them.
            return tools.getToolDefinitions()
              .filter((t) => !isBrowserToolName(t.name))
              .map((t) => ({ name: t.name, description: t.description }));
          } catch { return []; }
        },
      });
    },
  }));

  context.subscriptions.push(api.commands.registerCommand('workflows.openEditor', async (...args: unknown[]) => {
    const id = typeof args[0] === 'string' ? args[0] : '';
    resolveServices(api);
    const wf = svc.workflows?.getWorkflow(id);
    if (!wf) return false;
    await api.editors.openEditor({ typeId: 'workflow', title: wf.name, icon: 'git-branch', instanceId: wf.id });
    return true;
  }));

  context.subscriptions.push(api.commands.registerCommand('workflows.new', async () => {
    resolveServices(api);
    if (!svc.workflows) return null;
    const wf = svc.workflows.addWorkflow({
      name: 'Untitled Workflow',
      class: 'quiet',
      enabled: false,
      source: 'user',
      nodes: [{ id: 'n1', label: 'Manual', kind: 'trigger.manual', x: 60, y: 120 }],
      edges: [],
    });
    await api.editors.openEditor({ typeId: 'workflow', title: wf.name, icon: 'git-branch', instanceId: wf.id });
    return wf.id;
  }));

}

/** Heartbeat findings from the last day you haven't acted on: they belong
 *  with what needs you. */
function openFindings(): IAutonomyLogEntry[] {
  const since = Date.now() - 24 * 3600_000;
  return (svc.log?.getEntries({ limit: 30, origin: 'heartbeat' }) ?? [])
    .filter((e) => e.timestamp >= since && isActionableHeartbeat(e, handledHeartbeat))
    .slice(0, 3);
}

/** The mounted view's "open the New Routine form", for the command. */
let _openRoutine: (() => void) | undefined;

export function deactivate(): void { /* the view disposes itself */ }

function renderAgentsView(container: HTMLElement, api: ParallxApi): IDisposable {
  let store = new DisposableStore();
  const root = $('div.agents-view');
  container.appendChild(root);

  // ── New Routine. Running in the background is a setting (Settings ›
  // Agents); when it is off, the body says so with a way there. ──
  const head = $('div.agents-head');
  createIconButton(head, { icon: 'plus', title: 'New Routine', size: 'sm', onClick: () => openRoutine() });
  createIconButton(head, { icon: 'settings', title: 'Agent Settings', size: 'sm', onClick: () => { void api.commands.executeCommand('agents.openSettings'); } });
  root.appendChild(head);

  const tabs = $('div.agents-tabs');
  const tabSwitch = createSegmented(tabs, {
    ariaLabel: 'Agents',
    value: currentTab,
    items: [
      { value: 'now', label: 'Now' },
      { value: 'routines', label: 'Routines' },
      { value: 'history', label: 'History' },
      { value: 'mind', label: 'Mind' },
    ],
    onChange: (v) => { currentTab = v as AgentsTab; body.scrollTop = 0; repaint(); },
  });
  root.appendChild(tabs);

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
  _showTab = (tab) => { tabSwitch.value = tab; currentTab = tab; repaint(); };


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
    root.classList.toggle('agents-view--paused', s.paused);

    // Rebuild the body; sections keep their order, so nothing jumps.
    body.replaceChildren();

    if (s.paused) pausedNotice(body, api);

    const nothing = !s.needsYou.length && !s.running.length && !s.upcoming.length && !s.done.length && !openFindings().length;
    if (nothing) {
      createEmptyState(body, {
        headline: 'Nothing running',
        hint: 'Tasks you hand to Chat in Agent mode, routines and the heartbeat show up here, with anything that needs your OK at the top.',
        icon: 'px-automations',
      });
    }

    const findings = openFindings();
    if (s.needsYou.length || findings.length) {
      const sec = section(body, 'Needs you', 'agents-section--needs');
      for (const f of findings) {
        const card = $('div.agents-card.agents-card--needs');
        const line = $('div.agents-card__line');
        const who = $('span.agents-card__name'); who.textContent = 'The heartbeat noticed something';
        line.appendChild(who);
        card.appendChild(line);
        const body2 = $('div.agents-card__finding'); body2.textContent = f.content;
        card.appendChild(body2);
        card.appendChild(heartbeatActions(api, f, repaint));
        sec.appendChild(card);
      }
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
    createButton(foot, { label: 'See All History', kind: 'ghost', size: 'sm', onClick: () => _showTab?.('history') });
    body.appendChild(foot);
  }

  // Coalesce bursts of change events into one read per frame-ish.
  function repaint(): void {
    if (pending || disposed) return;
    pending = true;
    setTimeout(() => {
      pending = false;
      if (disposed) return;
      if (closeRoutine) return;
      if (currentTab === 'now') {
        void readSnapshot(api).then((s) => { if (!disposed && !closeRoutine && currentTab === 'now') paint(s); });
        return;
      }
      // The other tabs draw themselves; the switch and paused note stay true.
      resolveServices(api);
      const paused = isPaused();
      root.classList.toggle('agents-view--paused', paused);
      const keep = body.scrollTop;
      body.replaceChildren();
      if (paused) pausedNotice(body, api);
      if (currentTab === 'routines') renderRoutines(body, api, openRoutine, repaint);
      else if (currentTab === 'history') renderHistory(body, api, repaint);
      else renderMind(body, api, repaint);
      body.scrollTop = keep;
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
  // Skip a tick while the user is on a control inside, so focus isn't lost.
  const tick = setInterval(() => {
    const f = document.activeElement;
    if (f instanceof HTMLElement && body.contains(f)) return;
    repaint();
  }, 30_000);
  repaint();

  return {
    dispose(): void {
      disposed = true;
      if (_openRoutine === openRoutine) _openRoutine = undefined;
      _showTab = undefined;
      tabSwitch.dispose();
      clearTimeout(heal);
      clearInterval(tick);
      busy = new Set();
      store.dispose();
      root.remove();
    },
  };
}

/** Agents are paused: one quiet line, and the way to the setting. */
function pausedNotice(host: HTMLElement, api: ParallxApi): void {
  const note = $('div.agents-paused');
  const text = $('span.agents-paused__text');
  text.textContent = 'Agents are paused. Nothing runs on its own until Run In The Background is back on.';
  note.appendChild(text);
  createButton(note, { label: 'Open Settings', kind: 'ghost', size: 'sm', onClick: () => { void api.commands.executeCommand('agents.openSettings', 'schema:Agents'); } });
  host.appendChild(note);
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
