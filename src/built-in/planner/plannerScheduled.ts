// plannerScheduled.ts — the planner's Scheduled tab: what the app will do,
// and when.
//
// Workflows are THE automation surface (docs/WORKFLOWS_BRIEF.md). The planner
// used to carry its own Automations tab, a second front-end over the cron
// service with its own forms and its own idea of a job. It is gone. This tab
// is a READ of the workflow service: every workflow with a schedule trigger,
// filterable by who made it (you, or the AI's suggestions), with next and
// last run, an enable switch, and a door to the editor. Nothing here is
// attached to the calendar, by decision (2026-09-03).

import type { IDisposable } from '../../platform/lifecycle.js';
import { renderEmptyState } from '../../ui/emptyStates.js';
import { formatRelativeTime } from '../../ui/relativeTime.js';
import { describeTriggerNode } from '../../services/workflows/workflowGraph.js';
import { isTriggerNode, type WorkflowDoc, type WorkflowRun } from '../../services/workflows/workflowTypes.js';

/** Structural slice of WorkflowService the tab reads (no cross-tree import of the class). */
export interface WorkflowServiceLike {
  readonly workflows: readonly WorkflowDoc[];
  onDidChangeWorkflows(listener: (e: unknown) => void): IDisposable;
  onDidRecordRun(listener: (run: WorkflowRun) => void): IDisposable;
  getRuns(workflowId: string): readonly WorkflowRun[];
  nextRunAt(workflowId: string): number | null;
  setEnabled(id: string, enabled: boolean): void;
}

export type ScheduledOrigin = 'user' | 'ai' | 'template';
export type ScheduledFilter = 'all' | 'user' | 'ai';

/** Who a workflow came from, in the tab's three words. */
export function scheduledOrigin(wf: Pick<WorkflowDoc, 'source'>): ScheduledOrigin {
  switch (wf.source) {
    case 'suggested': return 'ai';
    case 'stock': return 'template';
    default: return 'user';
  }
}

/** A workflow belongs on this tab when it has a schedule trigger. */
export function isScheduledWorkflow(wf: Pick<WorkflowDoc, 'nodes'>): boolean {
  return wf.nodes.some((n) => n.kind === 'trigger.schedule');
}

export function matchesScheduledFilter(wf: Pick<WorkflowDoc, 'source'>, filter: ScheduledFilter): boolean {
  if (filter === 'all') return true;
  return scheduledOrigin(wf) === filter;
}

/** "in 25 minutes", "in 3 hours", "tomorrow at 05:00". */
export function formatNextRun(nextMs: number, now: number = Date.now()): string {
  const diff = nextMs - now;
  if (diff <= 0) return 'due now';
  const minutes = Math.round(diff / 60_000);
  if (minutes < 60) return `in ${minutes} minute${minutes === 1 ? '' : 's'}`;
  const hours = Math.round(diff / 3_600_000);
  if (hours < 24) return `in ${hours} hour${hours === 1 ? '' : 's'}`;
  const d = new Date(nextMs);
  const hh = String(d.getHours()).padStart(2, '0');
  const mm = String(d.getMinutes()).padStart(2, '0');
  const days = Math.round(diff / 86_400_000);
  return days <= 1 ? `tomorrow at ${hh}:${mm}` : `in ${days} days at ${hh}:${mm}`;
}

function runStatusText(run: WorkflowRun): string {
  switch (run.status) {
    case 'ok': return 'ran';
    case 'error': return 'failed';
    case 'gated': return 'awaiting approval';
    case 'cooldown': return 'held by cooldown';
    case 'held': return 'held';
    case 'running': return 'running';
    default: return String(run.status);
  }
}

function el<K extends keyof HTMLElementTagNameMap>(tag: K, cls?: string, text?: string): HTMLElementTagNameMap[K] {
  const node = document.createElement(tag);
  if (cls) node.className = cls;
  if (text !== undefined) node.textContent = text;
  return node;
}

export interface PlannerScheduledDeps {
  getWorkflows(): WorkflowServiceLike | null;
  commands: { executeCommand<T = unknown>(id: string, ...args: unknown[]): Promise<T> };
  /** True while this tab is the visible one; repaints are skipped otherwise. */
  isActive(): boolean;
  viewState?: { get<T>(key: string, defaultValue: T): T; set(key: string, value: unknown): void };
}

const FILTER_KEY = 'planner.scheduledFilter';

export class PlannerScheduledController implements IDisposable {
  private _filter: ScheduledFilter = 'all';
  private _subscriptions: IDisposable[] = [];
  private _subscribedTo: WorkflowServiceLike | null = null;
  private _body: HTMLElement | null = null;
  private _disposed = false;

  constructor(private readonly _deps: PlannerScheduledDeps) {
    const saved = _deps.viewState?.get<string>(FILTER_KEY, 'all');
    if (saved === 'user' || saved === 'ai') this._filter = saved;
  }

  async render(body: HTMLElement, actions: HTMLElement): Promise<void> {
    this._body = body;
    const service = this._deps.getWorkflows();
    this._subscribe(service);
    this._paintActions(actions);
    this._paintList(body, service);
  }

  private _subscribe(service: WorkflowServiceLike | null): void {
    if (!service || service === this._subscribedTo) return;
    for (const d of this._subscriptions) d.dispose();
    this._subscriptions = [];
    this._subscribedTo = service;
    const repaint = () => {
      if (this._disposed || !this._deps.isActive() || !this._body) return;
      this._paintList(this._body, service);
    };
    this._subscriptions.push(service.onDidChangeWorkflows(repaint));
    this._subscriptions.push(service.onDidRecordRun(repaint));
  }

  private _paintActions(actions: HTMLElement): void {
    actions.replaceChildren();
    const chips = el('div', 'planner-sched__filters');
    chips.setAttribute('role', 'group');
    chips.setAttribute('aria-label', 'Show workflows by origin');
    const defs: { key: ScheduledFilter; label: string }[] = [
      { key: 'all', label: 'All' },
      { key: 'user', label: 'User' },
      { key: 'ai', label: 'AI' },
    ];
    for (const d of defs) {
      const chip = el('button', 'planner-sched__filter', d.label);
      chip.type = 'button';
      chip.dataset.filter = d.key;
      if (d.key === this._filter) chip.classList.add('planner-sched__filter--active');
      chip.addEventListener('click', () => {
        this._filter = d.key;
        this._deps.viewState?.set(FILTER_KEY, d.key);
        for (const c of chips.querySelectorAll<HTMLElement>('.planner-sched__filter')) {
          c.classList.toggle('planner-sched__filter--active', c.dataset.filter === d.key);
        }
        if (this._body) this._paintList(this._body, this._deps.getWorkflows());
      });
      chips.appendChild(chip);
    }
    actions.appendChild(chips);

    const open = el('button', 'planner-btn planner-btn--small planner-btn--ghost', 'Open Workflows');
    open.type = 'button';
    open.title = 'The Workflows panel: create, edit and read every run.';
    open.addEventListener('click', () => { void this._deps.commands.executeCommand('workflows.showPanel'); });
    actions.appendChild(open);
  }

  private _paintList(body: HTMLElement, service: WorkflowServiceLike | null): void {
    const wrap = el('div', 'planner-sched');
    if (!service) {
      wrap.appendChild(this._note('Workflows are still starting. This list fills in a moment.'));
      body.replaceChildren(wrap);
      return;
    }
    const rows = service.workflows
      .filter(isScheduledWorkflow)
      .filter((wf) => matchesScheduledFilter(wf, this._filter));

    if (rows.length === 0) {
      // The action bar already carries "Open Workflows"; the empty state
      // says where things come from and leaves the one door where it is.
      wrap.appendChild(renderEmptyState('planner.scheduled'));
      body.replaceChildren(wrap);
      return;
    }

    const now = Date.now();
    for (const wf of rows) wrap.appendChild(this._row(service, wf, now));
    body.replaceChildren(wrap);
  }

  private _note(text: string): HTMLElement {
    return el('div', 'planner-sched__note', text);
  }

  private _row(service: WorkflowServiceLike, wf: WorkflowDoc, now: number): HTMLElement {
    const row = el('div', 'planner-sched__row');
    row.dataset.workflowId = wf.id;
    if (!wf.enabled) row.classList.add('planner-sched__row--off');

    const main = el('div', 'planner-sched__main');
    const head = el('div', 'planner-sched__head');
    const name = el('button', 'planner-sched__name', wf.name);
    name.type = 'button';
    name.title = 'Open in the workflow editor.';
    name.addEventListener('click', () => { void this._deps.commands.executeCommand('workflows.openEditor', wf.id); });
    head.appendChild(name);
    const origin = scheduledOrigin(wf);
    const chip = el('span', `planner-sched__origin planner-sched__origin--${origin}`,
      origin === 'ai' ? 'AI' : origin === 'template' ? 'Template' : 'User');
    chip.title = origin === 'ai'
      ? 'Suggested by the AI from a habit it noticed. Runs only once you enable it.'
      : origin === 'template' ? 'Installed from the template gallery.' : 'Made by you.';
    head.appendChild(chip);
    main.appendChild(head);

    const meta = el('div', 'planner-sched__meta');
    const parts: string[] = [];
    const triggers = wf.nodes.filter(isTriggerNode);
    parts.push(triggers.map((t) => describeTriggerNode(t)).join(', ') || 'No trigger');
    const next = wf.enabled ? service.nextRunAt(wf.id) : null;
    if (next !== null) parts.push(`next ${formatNextRun(next, now)}`);
    const runs = service.getRuns(wf.id);
    const last = runs[runs.length - 1];
    if (last) parts.push(`${runStatusText(last)} ${formatRelativeTime(last.startedAt, 'short', now)}`);
    meta.textContent = parts.join(' · ');
    if (last?.status === 'error') meta.classList.add('planner-sched__meta--error');
    main.appendChild(meta);
    row.appendChild(main);

    const toggle = el('label', 'planner-sched__toggle');
    const input = document.createElement('input');
    input.type = 'checkbox';
    input.checked = wf.enabled;
    input.setAttribute('aria-label', `Enable ${wf.name}`);
    input.addEventListener('change', () => {
      try { service.setEnabled(wf.id, input.checked); } catch { input.checked = wf.enabled; }
    });
    toggle.appendChild(input);
    toggle.appendChild(el('span', undefined, wf.enabled ? 'On' : 'Off'));
    row.appendChild(toggle);
    return row;
  }

  dispose(): void {
    this._disposed = true;
    for (const d of this._subscriptions) d.dispose();
    this._subscriptions = [];
    this._subscribedTo = null;
    this._body = null;
  }
}
