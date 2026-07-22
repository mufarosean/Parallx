// plannerAutomations.ts — the planner's Automations tab (M93).
//
// Automations are recurring (or one-shot) jobs the APP runs for the user:
// "refresh the study dashboard every morning at 8", "summarize my day at
// 17:30", "re-tag new canvas pages weekly". They are NOT calendar items and
// never sync to Google — they are instructions to the AI, scheduled on the
// workspace cron service (openclawCronService). The planner is just the
// human-friendly face: it owns creation/editing UX and remembers which cron
// jobs it created (planner_settings key `automations.ids`), while the cron
// service remains the single source of truth for scheduling, catch-up and
// autonomy gating:
//
//   - Missed firings while the app was closed coalesce into ONE catch-up run
//     at next launch (CronService.loadFromPersistence + _runMissedJobs).
//   - Every firing is an autonomy event (trigger kind 'cron') and respects
//     the autonomy dial's cron flag — a disabled dial skips the run and logs
//     `gated`.
//   - Jobs also appear in AI Hub → Scheduled jobs; both UIs subscribe to
//     the same onDidChangeJobs event so they never drift.

import type { IDisposable } from '../../platform/lifecycle.js';
import { Dropdown } from '../../ui/dropdown.js';
import { Toggle } from '../../ui/toggle.js';
import { renderEmptyState } from '../../ui/emptyStates.js';
import type {
  ICronJob,
  ICronSchedule,
} from '../../openclaw/openclawCronService.js';

// ─── Structural cron dependency ──────────────────────────────────────────────
// Narrow view of CronService so tests can stub it and this module never
// couples to the concrete class beyond what the tab actually uses.

export interface CronServiceLike {
  readonly jobs: readonly ICronJob[];
  addJob(params: {
    name: string;
    schedule: ICronSchedule;
    payload: { agentTurn?: string };
    wakeMode?: 'now' | 'next-heartbeat';
    contextMessages?: number;
    enabled?: boolean;
    description?: string;
    deleteAfterRun?: boolean;
  }): ICronJob;
  updateJob(id: string, params: {
    name?: string;
    schedule?: ICronSchedule;
    payload?: { agentTurn?: string };
    enabled?: boolean;
    description?: string;
  }): ICronJob;
  removeJob(id: string): boolean;
  getJob(id: string): ICronJob | undefined;
  runJob(id: string): Promise<{ success: boolean; error?: string }>;
  getJobRuns(id: string): readonly { success: boolean; error?: string; firedAt: number }[];
  onDidChangeJobs(listener: (e: { kind: string; jobId?: string }) => void): IDisposable;
}

// ─── Schedule spec ───────────────────────────────────────────────────────────
// The pure conversions live in the shared cronScheduleSpec module (also used
// by the AI Hub's Scheduled-jobs section). Re-exported here so planner code
// and the M93 tests keep their import path.

import {
  buildCronSchedule,
  describeSchedule,
  specFromSchedule,
  WEEKDAY_LABELS,
  type AutomationScheduleSpec,
} from '../../openclaw/cronScheduleSpec.js';

export {
  buildCronSchedule,
  describeSchedule,
  parseTimeOfDay,
  specFromSchedule,
  WEEKDAY_LABELS,
  type AutomationScheduleSpec,
} from '../../openclaw/cronScheduleSpec.js';

// ─── Templates ───────────────────────────────────────────────────────────────
// Seeds for the prompt box. Deliberately generic app capabilities — the
// prompt can ask for ANYTHING the AI can do in the workspace; these just
// show the shape.

export const AUTOMATION_TEMPLATES: readonly { id: string; label: string; prompt: string }[] = [
  {
    id: 'widgets',
    label: 'Refresh dashboard widgets',
    prompt: 'Refresh every AI widget on my dashboards so they show up-to-date content.',
  },
  {
    id: 'digest',
    label: 'Morning digest',
    prompt: 'Review my planner (today\'s events and due tasks) and post a short morning digest to chat.',
  },
  {
    id: 'tidy',
    label: 'Workspace review',
    prompt: 'Look over recently changed canvas pages and flag anything that needs a follow-up task.',
  },
];

/**
 * Create the cron job for an automation. Kept out of the DOM controller so
 * the exact job shape (agentTurn payload, wake mode, context) is testable.
 */
export function createAutomationJob(
  cron: CronServiceLike,
  input: { name: string; prompt: string; spec: AutomationScheduleSpec },
): ICronJob {
  const name = input.name.trim();
  const prompt = input.prompt.trim();
  if (!name) throw new Error('Give the automation a name.');
  if (!prompt) throw new Error('Describe what the AI should do.');
  const schedule = buildCronSchedule(input.spec);
  return cron.addJob({
    name,
    schedule,
    payload: { agentTurn: prompt },
    wakeMode: 'now',
    contextMessages: 0,
    enabled: true,
    description: prompt,
    deleteAfterRun: input.spec.kind === 'once' ? true : undefined,
  });
}

// ─── Persistence of planner-owned job ids ────────────────────────────────────

const AUTOMATION_IDS_KEY = 'automations.ids';

interface SettingsStore {
  getSetting(key: string): Promise<string | null>;
  setSetting(key: string, value: string): Promise<void>;
}

export async function loadAutomationIds(store: SettingsStore): Promise<string[]> {
  try {
    const raw = await store.getSetting(AUTOMATION_IDS_KEY);
    if (!raw) return [];
    const parsed = JSON.parse(raw);
    return Array.isArray(parsed) ? parsed.filter((v): v is string => typeof v === 'string') : [];
  } catch {
    return [];
  }
}

export async function saveAutomationIds(store: SettingsStore, ids: readonly string[]): Promise<void> {
  try {
    await store.setSetting(AUTOMATION_IDS_KEY, JSON.stringify([...new Set(ids)]));
  } catch {
    /* settings write failures must not break the tab */
  }
}

// ─── Controller ──────────────────────────────────────────────────────────────

interface AutomationsWindowApi {
  showInformationMessage(message: string, ...actions: { title: string }[]): Promise<{ title: string } | undefined>;
  showErrorMessage(message: string, ...actions: { title: string }[]): Promise<{ title: string } | undefined>;
}

function el<K extends keyof HTMLElementTagNameMap>(tag: K, className?: string): HTMLElementTagNameMap[K] {
  const node = document.createElement(tag);
  if (className) node.className = className;
  return node;
}

const ZAP_SVG = '<svg xmlns="http://www.w3.org/2000/svg" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><polygon points="13 2 3 14 12 14 11 22 21 10 12 10 13 2"/></svg>';

function formatTimestamp(ts: number | null): string {
  if (ts === null) return '—';
  const d = new Date(ts);
  return Number.isNaN(d.getTime()) ? '—' : d.toLocaleString();
}

function formatRelative(ts: number | null): string {
  if (ts === null) return '';
  const delta = ts - Date.now();
  const abs = Math.abs(delta);
  const min = Math.floor(abs / 60_000);
  const hr = Math.floor(min / 60);
  const day = Math.floor(hr / 24);
  let main: string;
  if (day >= 1) main = `${day}d`;
  else if (hr >= 1) main = `${hr}h`;
  else if (min >= 1) main = `${min}m`;
  else main = '<1m';
  return delta >= 0 ? `in ${main}` : `${main} ago`;
}

/**
 * Renders the Automations tab. One instance per planner pane; `render()` is
 * called by the pane's tab dispatcher and re-invoked (via the pane) whenever
 * the cron job set changes.
 */
export class PlannerAutomationsController implements IDisposable {
  private _listenerDisposable: IDisposable | null = null;
  private _formOpen = false;
  private _editingJobId: string | null = null;
  private _body: HTMLElement | null = null;
  private _actions: HTMLElement | null = null;
  private _disposed = false;
  private readonly _formDisposables: IDisposable[] = [];

  constructor(
    private readonly _deps: {
      getCron: () => CronServiceLike | null;
      settings: SettingsStore;
      window: AutomationsWindowApi;
      /** The pane reuses ONE body element for every tab — re-renders driven
       *  by cron events must not fire while another tab owns the body. */
      isActive?: () => boolean;
    },
  ) {}

  async render(body: HTMLElement, actions: HTMLElement): Promise<void> {
    this._body = body;
    this._actions = actions;
    this._disposeForm();

    const cron = this._deps.getCron();

    // Header action — New automation.
    actions.innerHTML = '';
    const addBtn = el('button', 'planner-cta');
    addBtn.type = 'button';
    addBtn.innerHTML = `${ZAP_SVG}<span>New automation</span>`;
    addBtn.disabled = !cron;
    addBtn.addEventListener('click', () => {
      this._formOpen = true;
      this._editingJobId = null;
      void this._rerender();
    });
    actions.appendChild(addBtn);

    body.innerHTML = '';
    const wrap = el('div', 'planner-auto');

    if (!cron) {
      const off = el('div', 'planner-auto__pending');
      off.textContent = 'The AI runtime is still starting. Automations appear the moment it is ready.';
      wrap.appendChild(off);
      body.appendChild(wrap);
      return;
    }

    // Subscribe once per render pass; re-render on job-set changes.
    this._listenerDisposable?.dispose();
    this._listenerDisposable = cron.onDidChangeJobs(() => {
      if (!this._disposed && !this._formOpen) void this._rerender();
    });

    if (this._formOpen) {
      wrap.appendChild(this._buildForm(cron));
      body.appendChild(wrap);
      return;
    }

    const ownedIds = new Set(await loadAutomationIds(this._deps.settings));
    // Stale-clean: drop ids whose job no longer exists (deleted via AI Hub or
    // a one-shot that removed itself after running).
    const live = cron.jobs;
    const liveIds = new Set(live.map(j => j.id));
    const cleaned = [...ownedIds].filter(id => liveIds.has(id));
    if (cleaned.length !== ownedIds.size) {
      await saveAutomationIds(this._deps.settings, cleaned);
      ownedIds.clear();
      for (const id of cleaned) ownedIds.add(id);
    }

    const mine = live.filter(j => ownedIds.has(j.id));
    const others = live.filter(j => !ownedIds.has(j.id));

    if (mine.length === 0) {
      wrap.appendChild(renderEmptyState('planner.automations'));
    } else {
      for (const job of mine) wrap.appendChild(this._buildCard(cron, job, true));
    }

    if (others.length > 0) {
      const details = el('details', 'planner-auto__others');
      const summary = el('summary', 'planner-auto__others-summary');
      summary.textContent = `Other scheduled jobs (${others.length}), created by the AI or extensions`;
      details.appendChild(summary);
      for (const job of others) details.appendChild(this._buildCard(cron, job, false));
      wrap.appendChild(details);
    }

    // One quiet line of trust, not a lecture: the two facts worth knowing.
    const footnote = el('div', 'planner-auto__footnote');
    footnote.textContent =
      'Missed runs catch up at the next launch · every run lands in the Autonomy Log';
    wrap.appendChild(footnote);

    body.appendChild(wrap);
  }

  private async _rerender(): Promise<void> {
    if (this._disposed || !this._body || !this._actions) return;
    if (this._deps.isActive && !this._deps.isActive()) return;
    if (!this._body.isConnected) return;
    await this.render(this._body, this._actions);
  }

  // ── Card ──────────────────────────────────────────────────────────────

  private _buildCard(cron: CronServiceLike, job: ICronJob, owned: boolean): HTMLElement {
    const card = el('div', 'planner-auto__card');
    if (!job.enabled) card.classList.add('planner-auto__card--paused');

    const runs = cron.getJobRuns(job.id);
    const lastRun = runs.length > 0 ? runs[runs.length - 1] : null;
    const failed = !!(lastRun && !lastRun.success && lastRun.error);

    // ── Header: presence dot · name · toggle ──
    const head = el('div', 'planner-auto__card-head');

    const dot = el('span', 'planner-auto__dot');
    dot.classList.add(
      failed ? 'planner-auto__dot--failed'
        : job.enabled ? 'planner-auto__dot--on'
        : 'planner-auto__dot--paused',
    );
    dot.title = failed ? 'Last run failed' : job.enabled ? 'Scheduled' : 'Paused';
    head.appendChild(dot);

    const name = el('div', 'planner-auto__card-name');
    name.textContent = job.name;
    head.appendChild(name);

    const toggle = new Toggle(head, {
      checked: job.enabled,
      ariaLabel: `Enable ${job.name}`,
    });
    toggle.onDidChange((checked: boolean) => {
      try {
        cron.updateJob(job.id, { enabled: checked });
      } catch (err) {
        toggle.checked = job.enabled;
        void this._deps.window.showErrorMessage(
          `Could not update "${job.name}": ${err instanceof Error ? err.message : String(err)}`,
        );
      }
    });
    card.appendChild(head);

    // ── The prompt IS the automation — set it like a quotation ──
    const prompt = job.payload?.agentTurn ?? job.description ?? '';
    if (prompt) {
      const promptEl = el('div', 'planner-auto__card-prompt');
      promptEl.textContent = prompt;
      card.appendChild(promptEl);
    }

    // ── One meta line: schedule · next · history ──
    const meta = el('div', 'planner-auto__card-meta');
    const parts: string[] = [describeSchedule(job.schedule)];
    if (!job.enabled) {
      parts.push('paused');
    } else if (job.nextRunAt) {
      parts.push(`next ${formatRelative(job.nextRunAt)}`);
    }
    parts.push(job.runCount === 0
      ? 'never run'
      : `${job.runCount} ${job.runCount === 1 ? 'run' : 'runs'}, last ${formatRelative(job.lastRunAt)}`);
    meta.textContent = parts.join('  ·  ');
    meta.title = [
      `Next: ${job.enabled ? formatTimestamp(job.nextRunAt) : 'paused'}`,
      `Last: ${formatTimestamp(job.lastRunAt)}`,
    ].join('\n');
    card.appendChild(meta);

    // Last-run error — the one signal that must not hide in a tooltip.
    if (failed && lastRun?.error) {
      const err = el('div', 'planner-auto__card-error');
      err.textContent = `Last run failed: ${lastRun.error}`;
      card.appendChild(err);
    }

    const actions = el('div', 'planner-auto__card-actions');

    const runBtn = el('button', 'planner-auto__btn');
    runBtn.type = 'button';
    runBtn.textContent = 'Run now';
    runBtn.title = 'Execute immediately without changing the schedule.';
    runBtn.addEventListener('click', () => {
      runBtn.disabled = true;
      runBtn.textContent = 'Running…';
      cron.runJob(job.id)
        .then((r) => {
          if (!r.success && r.error) {
            void this._deps.window.showErrorMessage(`"${job.name}" failed: ${r.error}`);
          }
        })
        .catch((err) => {
          void this._deps.window.showErrorMessage(
            `"${job.name}" failed: ${err instanceof Error ? err.message : String(err)}`,
          );
        })
        .finally(() => {
          runBtn.disabled = false;
          runBtn.textContent = 'Run now';
          if (!this._formOpen) void this._rerender();
        });
    });
    actions.appendChild(runBtn);

    if (owned) {
      const editBtn = el('button', 'planner-auto__btn');
      editBtn.type = 'button';
      editBtn.textContent = 'Edit';
      editBtn.addEventListener('click', () => {
        this._formOpen = true;
        this._editingJobId = job.id;
        void this._rerender();
      });
      actions.appendChild(editBtn);
    }

    const delBtn = el('button', 'planner-auto__btn planner-auto__btn--danger');
    delBtn.type = 'button';
    delBtn.textContent = 'Delete';
    delBtn.addEventListener('click', () => {
      void (async () => {
        const pick = await this._deps.window.showInformationMessage(
          `Delete "${job.name}"? This cannot be undone.`,
          { title: 'Delete' },
          { title: 'Cancel' },
        );
        if (pick?.title !== 'Delete') return;
        try {
          cron.removeJob(job.id);
          const ids = await loadAutomationIds(this._deps.settings);
          await saveAutomationIds(this._deps.settings, ids.filter(id => id !== job.id));
        } catch (err) {
          void this._deps.window.showErrorMessage(
            `Could not delete "${job.name}": ${err instanceof Error ? err.message : String(err)}`,
          );
        }
        void this._rerender();
      })();
    });
    actions.appendChild(delBtn);

    card.appendChild(actions);
    return card;
  }

  // ── Create / edit form ────────────────────────────────────────────────

  private _buildForm(cron: CronServiceLike): HTMLElement {
    const editing = this._editingJobId ? cron.getJob(this._editingJobId) : undefined;

    const form = el('div', 'planner-auto__form');

    const heading = el('h3', 'planner-auto__form-title');
    heading.textContent = editing ? 'Edit automation' : 'New automation';
    form.appendChild(heading);

    // Name.
    const nameLabel = el('label', 'planner-auto__label');
    nameLabel.textContent = 'Name';
    form.appendChild(nameLabel);
    const nameInput = el('input', 'planner-auto__input') as HTMLInputElement;
    nameInput.type = 'text';
    nameInput.placeholder = 'e.g. Morning dashboard refresh';
    nameInput.value = editing?.name ?? '';
    form.appendChild(nameInput);

    // Template seed (create only).
    if (!editing) {
      const tplLabel = el('label', 'planner-auto__label');
      tplLabel.textContent = 'Start from';
      form.appendChild(tplLabel);
      const tplHost = el('div', 'planner-auto__dropdown');
      const tplDropdown = new Dropdown(tplHost, {
        items: [
          { value: '', label: 'Blank' },
          ...AUTOMATION_TEMPLATES.map(t => ({ value: t.id, label: t.label })),
        ],
        selected: '',
        ariaLabel: 'Automation template',
      });
      this._formDisposables.push(tplDropdown);
      this._formDisposables.push(tplDropdown.onDidChange((value: string) => {
        const tpl = AUTOMATION_TEMPLATES.find(t => t.id === value);
        if (tpl) {
          promptInput.value = tpl.prompt;
          if (!nameInput.value.trim()) nameInput.value = tpl.label;
        }
      }));
      form.appendChild(tplHost);
    }

    // Prompt.
    const promptLabel = el('label', 'planner-auto__label');
    promptLabel.textContent = 'What should the AI do?';
    form.appendChild(promptLabel);
    const promptInput = el('textarea', 'planner-auto__textarea') as HTMLTextAreaElement;
    promptInput.rows = 4;
    promptInput.placeholder =
      'Anything you could ask in chat: refresh widgets, summarize pages, review tasks…';
    promptInput.value = editing?.payload?.agentTurn ?? '';
    form.appendChild(promptInput);

    // Schedule.
    const schedLabel = el('label', 'planner-auto__label');
    schedLabel.textContent = 'When';
    form.appendChild(schedLabel);

    const seedSpec: AutomationScheduleSpec = editing
      ? specFromSchedule(editing.schedule)
      : { kind: 'daily', time: '08:00' };

    const schedRow = el('div', 'planner-auto__sched');
    const kindHost = el('div', 'planner-auto__dropdown');
    const kindDropdown = new Dropdown(kindHost, {
      items: [
        { value: 'daily', label: 'Every day' },
        { value: 'weekly', label: 'Every week' },
        { value: 'interval', label: 'On an interval' },
        { value: 'once', label: 'Once' },
        { value: 'cron', label: 'Custom (cron)' },
      ],
      selected: seedSpec.kind,
      ariaLabel: 'Schedule type',
    });
    this._formDisposables.push(kindDropdown);
    schedRow.appendChild(kindHost);

    // Detail inputs — one per kind; visibility switches with the dropdown.
    const timeInput = el('input', 'planner-auto__input planner-auto__input--time') as HTMLInputElement;
    timeInput.type = 'time';
    timeInput.value = (seedSpec.kind === 'daily' || seedSpec.kind === 'weekly') ? seedSpec.time : '08:00';
    schedRow.appendChild(timeInput);

    const dayHost = el('div', 'planner-auto__dropdown');
    const dayDropdown = new Dropdown(dayHost, {
      items: WEEKDAY_LABELS.map((label, i) => ({ value: String(i), label })),
      selected: seedSpec.kind === 'weekly' ? String(seedSpec.day) : '1',
      ariaLabel: 'Weekday',
    });
    this._formDisposables.push(dayDropdown);
    schedRow.appendChild(dayHost);

    const intervalInput = el('input', 'planner-auto__input planner-auto__input--interval') as HTMLInputElement;
    intervalInput.type = 'text';
    intervalInput.placeholder = 'e.g. 30m, 2h, 1d';
    intervalInput.value = seedSpec.kind === 'interval' ? seedSpec.every : '1h';
    schedRow.appendChild(intervalInput);

    const onceInput = el('input', 'planner-auto__input planner-auto__input--once') as HTMLInputElement;
    onceInput.type = 'datetime-local';
    if (seedSpec.kind === 'once') {
      const d = new Date(seedSpec.at);
      if (!Number.isNaN(d.getTime())) {
        const pad = (n: number) => String(n).padStart(2, '0');
        onceInput.value = `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}`;
      }
    }
    schedRow.appendChild(onceInput);

    const cronInput = el('input', 'planner-auto__input planner-auto__input--cron') as HTMLInputElement;
    cronInput.type = 'text';
    cronInput.placeholder = 'e.g. 0 9 * * 1-5';
    cronInput.value = seedSpec.kind === 'cron' ? seedSpec.expr : '';
    schedRow.appendChild(cronInput);

    const syncKindVisibility = () => {
      const kind = kindDropdown.value ?? 'daily';
      timeInput.style.display = (kind === 'daily' || kind === 'weekly') ? '' : 'none';
      dayHost.style.display = kind === 'weekly' ? '' : 'none';
      intervalInput.style.display = kind === 'interval' ? '' : 'none';
      onceInput.style.display = kind === 'once' ? '' : 'none';
      cronInput.style.display = kind === 'cron' ? '' : 'none';
    };
    this._formDisposables.push(kindDropdown.onDidChange(() => syncKindVisibility()));
    syncKindVisibility();
    form.appendChild(schedRow);

    // Inline error.
    const error = el('div', 'planner-auto__error');
    error.style.display = 'none';
    form.appendChild(error);

    const showError = (msg: string) => {
      error.textContent = msg;
      error.style.display = '';
    };

    // Footer.
    const foot = el('div', 'planner-auto__form-foot');

    const readSpec = (): AutomationScheduleSpec => {
      const kind = (kindDropdown.value ?? 'daily') as AutomationScheduleSpec['kind'];
      switch (kind) {
        case 'daily': return { kind, time: timeInput.value };
        case 'weekly': return { kind, day: parseInt(dayDropdown.value ?? '1', 10), time: timeInput.value };
        case 'interval': return { kind, every: intervalInput.value };
        case 'once': return { kind, at: onceInput.value };
        case 'cron': return { kind, expr: cronInput.value };
      }
    };

    const saveBtn = el('button', 'planner-auto__btn planner-auto__btn--primary');
    saveBtn.type = 'button';
    saveBtn.textContent = editing ? 'Save' : 'Create automation';
    saveBtn.addEventListener('click', () => {
      void (async () => {
        try {
          if (editing) {
            const prompt = promptInput.value.trim();
            if (!nameInput.value.trim()) throw new Error('Give the automation a name.');
            if (!prompt) throw new Error('Describe what the AI should do.');
            cron.updateJob(editing.id, {
              name: nameInput.value.trim(),
              schedule: buildCronSchedule(readSpec()),
              payload: { agentTurn: prompt },
              description: prompt,
            });
          } else {
            const job = createAutomationJob(cron, {
              name: nameInput.value,
              prompt: promptInput.value,
              spec: readSpec(),
            });
            const ids = await loadAutomationIds(this._deps.settings);
            await saveAutomationIds(this._deps.settings, [...ids, job.id]);
          }
          this._formOpen = false;
          this._editingJobId = null;
          void this._rerender();
        } catch (err) {
          showError(err instanceof Error ? err.message : String(err));
        }
      })();
    });
    foot.appendChild(saveBtn);

    const cancelBtn = el('button', 'planner-auto__btn');
    cancelBtn.type = 'button';
    cancelBtn.textContent = 'Cancel';
    cancelBtn.addEventListener('click', () => {
      this._formOpen = false;
      this._editingJobId = null;
      void this._rerender();
    });
    foot.appendChild(cancelBtn);

    form.appendChild(foot);
    return form;
  }

  private _disposeForm(): void {
    for (const d of this._formDisposables) {
      try { d.dispose(); } catch { /* noop */ }
    }
    this._formDisposables.length = 0;
  }

  dispose(): void {
    this._disposed = true;
    this._disposeForm();
    this._listenerDisposable?.dispose();
    this._listenerDisposable = null;
    this._body = null;
    this._actions = null;
  }
}
