// cronSection.ts — Scheduled jobs section in the AI Hub
//
// Renders every cron job from `CronService`, regardless of origin: jobs
// registered programmatically by extensions (e.g. budget.sync.scheduled),
// jobs created by the AI via the `cron_add` tool, jobs the user created in
// Planner → Automations, and jobs added here. All live in the same store
// and are surfaced equally.
//
// Per job, the UI exposes:
//   - Stable name + human description
//   - Source label (Extension / AI / User) inferred from the name shape
//   - Schedule in human-readable form (shared cronScheduleSpec)
//   - Enabled toggle (core Toggle component)
//   - Last run / Next run timestamps
//   - Actions: Run now, Edit schedule (friendly builder), Delete
//
// Subscribes to `CronService.onDidChangeJobs` so additions, updates, runs,
// and removals reflect in the panel without polling. Confirms and errors go
// through the app's modal/notification system — never window.confirm/alert.

import { $ } from '../../../ui/dom.js';
import { Dropdown } from '../../../ui/dropdown.js';
import { Toggle } from '../../../ui/toggle.js';
import { showConfirmModal, type NotificationService } from '../../../api/notificationService.js';
import { SettingsSection } from '../sectionBase.js';
import type { AISettingsProfile, IAISettingsService } from '../../aiSettingsTypes.js';
import {
  buildCronSchedule,
  describeSchedule,
  specFromSchedule,
  WEEKDAY_LABELS,
  type AutomationScheduleSpec,
} from '../../../openclaw/cronScheduleSpec.js';
import type {
  CronService,
  ICronJob,
} from '../../../openclaw/openclawCronService.js';
import type { IDisposable } from '../../../platform/lifecycle.js';

// ─── Source-of-job heuristic ─────────────────────────────────────────────────
//
// The cron registry doesn't track origin as a field. We infer it from the
// stable `name` (which the bridge stamps as the extension-provided id, the
// AI's `cron_add` tool stamps with the model's chosen string, and the user
// would set explicitly):
//
//   - `<ext>.*`           → Extension (e.g. `budget.sync.scheduled`)
//   - bare or no dot      → AI / User-added (most cron_add results)
//
// This is a display-only label; nothing downstream depends on it.

type CronSource =
  | { kind: 'extension'; extensionId: string }
  | { kind: 'ai' };

function _inferSource(name: string): CronSource {
  const dotIdx = name.indexOf('.');
  if (dotIdx > 0) {
    return { kind: 'extension', extensionId: name.slice(0, dotIdx) };
  }
  return { kind: 'ai' };
}

function _sourceLabel(source: CronSource): string {
  return source.kind === 'extension'
    ? `Extension · ${source.extensionId}`
    : 'AI';
}

// ─── Timestamp formatting ────────────────────────────────────────────────────

function _formatTimestamp(ts: number | null): string {
  if (ts === null) return 'Unknown';
  const d = new Date(ts);
  if (Number.isNaN(d.getTime())) return 'Unknown';
  return d.toLocaleString();
}

function _formatRelative(ts: number | null): string {
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

// ─── CronSection ─────────────────────────────────────────────────────────────

export class CronSection extends SettingsSection {

  private _listContainer: HTMLElement | null = null;
  private _emptyEl: HTMLElement | null = null;
  private _editingJobId: string | null = null;
  private readonly _listenerDisposables: IDisposable[] = [];
  /** Disposables owned by the CURRENT render pass (toggles, dropdowns). */
  private readonly _renderDisposables: IDisposable[] = [];

  constructor(
    service: IAISettingsService,
    private readonly _cronService?: CronService,
    private readonly _notifications?: NotificationService,
  ) {
    super(service, 'cron', 'Scheduled jobs');
  }

  build(): void {
    const intro = $('div.ai-settings-section__info');
    intro.textContent =
      'Background jobs the cron scheduler runs for this workspace: automations ' +
      'you created in Planner → Automations, jobs registered by extensions, and ' +
      'jobs the AI scheduled through approved cron_add calls. Everything can be ' +
      'paused, edited, run on demand, or removed here.';
    this.contentElement.appendChild(intro);

    this._listContainer = $('div.ai-settings-cron-list');
    this.contentElement.appendChild(this._listContainer);

    this._emptyEl = $('div.ai-settings-section__info');
    this._emptyEl.textContent =
      'No scheduled jobs yet. Create one in Planner → Automations, or ask the AI to set a reminder.';
    this.contentElement.appendChild(this._emptyEl);

    this._renderList();

    if (this._cronService) {
      // Live updates: re-render on every job-set change. Cheap — the list
      // is small (capped at MAX_CRON_JOBS = 50).
      this._listenerDisposables.push(
        this._cronService.onDidChangeJobs(() => this._renderList()),
      );
    }
  }

  update(_profile: AISettingsProfile): void {
    // Job state is service-owned, not profile-owned. Nothing to sync from
    // a profile change.
  }

  override dispose(): void {
    this._disposeRenderScope();
    for (const d of this._listenerDisposables) d.dispose();
    this._listenerDisposables.length = 0;
    super.dispose();
  }

  private _disposeRenderScope(): void {
    for (const d of this._renderDisposables) {
      try { d.dispose(); } catch { /* noop */ }
    }
    this._renderDisposables.length = 0;
  }

  // ── Rendering ─────────────────────────────────────────────────────────

  private _renderList(): void {
    if (!this._listContainer) return;
    this._disposeRenderScope();
    this._listContainer.innerHTML = '';

    const jobs = this._cronService ? this._cronService.jobs : [];

    if (!this._cronService) {
      // Service unavailable (rare — happens in headless tests). Hide both
      // the empty state and the list, leave only the explanatory headers.
      if (this._emptyEl) this._emptyEl.style.display = 'none';
      return;
    }

    if (jobs.length === 0) {
      if (this._emptyEl) this._emptyEl.style.display = '';
      return;
    }

    if (this._emptyEl) this._emptyEl.style.display = 'none';

    // Stable sort: extensions first (alphabetical), then AI/user jobs by name.
    const sorted = [...jobs].sort((a, b) => {
      const aSrc = _inferSource(a.name);
      const bSrc = _inferSource(b.name);
      if (aSrc.kind !== bSrc.kind) return aSrc.kind === 'extension' ? -1 : 1;
      return a.name.localeCompare(b.name);
    });

    for (const job of sorted) {
      this._listContainer.appendChild(this._renderJob(job));
    }
  }

  private _renderJob(job: ICronJob): HTMLElement {
    const card = $('div.ai-settings-cron-job');
    card.dataset.jobId = job.id;
    if (!job.enabled) card.classList.add('ai-settings-cron-job--disabled');

    // ── Header row: name + source pill + enabled toggle ──
    const header = $('div.ai-settings-cron-job__header');

    const titleBlock = $('div.ai-settings-cron-job__title');
    const name = $('div.ai-settings-cron-job__name');
    name.textContent = job.name;
    titleBlock.appendChild(name);

    const sourcePill = $('span.ai-settings-cron-job__source');
    const src = _inferSource(job.name);
    sourcePill.textContent = _sourceLabel(src);
    sourcePill.classList.add(
      src.kind === 'extension'
        ? 'ai-settings-cron-job__source--extension'
        : 'ai-settings-cron-job__source--ai',
    );
    titleBlock.appendChild(sourcePill);
    header.appendChild(titleBlock);

    // Enabled — the core Toggle, not a bare checkbox.
    const toggle = new Toggle(header, {
      checked: job.enabled,
      ariaLabel: `Enable ${job.name}`,
    });
    this._renderDisposables.push(toggle);
    this._renderDisposables.push(toggle.onDidChange((checked: boolean) => {
      if (!this._cronService) return;
      try {
        this._cronService.updateJob(job.id, { enabled: checked });
      } catch (err) {
        toggle.checked = job.enabled; // revert UI on failure
        void this._notifications?.error(
          `Could not update "${job.name}": ${err instanceof Error ? err.message : String(err)}`,
        );
      }
    }));

    card.appendChild(header);

    // ── Description ──
    if (job.description) {
      const desc = $('div.ai-settings-cron-job__description');
      desc.textContent = job.description;
      card.appendChild(desc);
    }

    // ── Meta grid (schedule, last run, next run, run count) ──
    const meta = $('div.ai-settings-cron-job__meta');
    meta.appendChild(this._metaCell('Schedule', describeSchedule(job.schedule)));
    meta.appendChild(this._metaCell(
      'Last run',
      job.lastRunAt
        ? `${_formatTimestamp(job.lastRunAt)} (${_formatRelative(job.lastRunAt)})`
        : 'Never',
    ));
    meta.appendChild(this._metaCell(
      'Next run',
      job.enabled && job.nextRunAt
        ? `${_formatTimestamp(job.nextRunAt)} (${_formatRelative(job.nextRunAt)})`
        : (job.enabled ? 'Not scheduled' : 'Paused'),
    ));
    meta.appendChild(this._metaCell('Runs', String(job.runCount)));
    card.appendChild(meta);

    // ── Edit form (collapsed by default) ──
    if (this._editingJobId === job.id) {
      card.appendChild(this._renderEditForm(job));
    }

    // ── Actions ──
    const actions = $('div.ai-settings-cron-job__actions');

    const runBtn = document.createElement('button');
    runBtn.type = 'button';
    runBtn.className = 'ai-settings-cron-job__btn';
    runBtn.textContent = 'Run Now';
    runBtn.title = 'Execute this job immediately (does not change the schedule).';
    runBtn.addEventListener('click', () => this._runNow(job));
    actions.appendChild(runBtn);

    const editBtn = document.createElement('button');
    editBtn.type = 'button';
    editBtn.className = 'ai-settings-cron-job__btn';
    editBtn.textContent = this._editingJobId === job.id ? 'Cancel edit' : 'Edit schedule';
    editBtn.addEventListener('click', () => {
      this._editingJobId = this._editingJobId === job.id ? null : job.id;
      this._renderList();
    });
    actions.appendChild(editBtn);

    const deleteBtn = document.createElement('button');
    deleteBtn.type = 'button';
    deleteBtn.className = 'ai-settings-cron-job__btn ai-settings-cron-job__btn--danger';
    deleteBtn.textContent = 'Delete';
    deleteBtn.addEventListener('click', () => this._confirmAndDelete(job));
    actions.appendChild(deleteBtn);

    card.appendChild(actions);

    return card;
  }

  private _metaCell(label: string, value: string): HTMLElement {
    const cell = $('div.ai-settings-cron-job__meta-cell');
    const l = $('div.ai-settings-cron-job__meta-label');
    l.textContent = label;
    const v = $('div.ai-settings-cron-job__meta-value');
    v.textContent = value;
    cell.appendChild(l);
    cell.appendChild(v);
    return cell;
  }

  /**
   * Friendly schedule builder — the same daily / weekly / interval / once /
   * cron model as Planner → Automations, driven by the shared
   * cronScheduleSpec conversions. No raw `cron:` text syntax.
   */
  private _renderEditForm(job: ICronJob): HTMLElement {
    const form = $('div.ai-settings-cron-job__edit');

    const label = $('label.ai-settings-cron-job__edit-label');
    label.textContent = 'Schedule';
    form.appendChild(label);

    const seedSpec = specFromSchedule(job.schedule);

    const row = $('div.ai-settings-cron-job__edit-row');
    form.appendChild(row);

    const kindHost = $('div.ai-settings-cron-job__edit-kind');
    const kindDropdown = new Dropdown(kindHost, {
      items: [
        { value: 'daily', label: 'Every Day' },
        { value: 'weekly', label: 'Every Week' },
        { value: 'interval', label: 'On an Interval' },
        { value: 'once', label: 'Once' },
        { value: 'cron', label: 'Custom (cron)' },
      ],
      selected: seedSpec.kind,
      ariaLabel: 'Schedule type',
    });
    this._renderDisposables.push(kindDropdown);
    row.appendChild(kindHost);

    const timeInput = document.createElement('input');
    timeInput.type = 'time';
    timeInput.className = 'ai-settings-cron-job__edit-input ai-settings-cron-job__edit-input--time';
    timeInput.value = (seedSpec.kind === 'daily' || seedSpec.kind === 'weekly') ? seedSpec.time : '08:00';
    row.appendChild(timeInput);

    const dayHost = $('div.ai-settings-cron-job__edit-kind');
    const dayDropdown = new Dropdown(dayHost, {
      items: WEEKDAY_LABELS.map((l2, i) => ({ value: String(i), label: l2 })),
      selected: seedSpec.kind === 'weekly' ? String(seedSpec.day) : '1',
      ariaLabel: 'Weekday',
    });
    this._renderDisposables.push(dayDropdown);
    row.appendChild(dayHost);

    const intervalInput = document.createElement('input');
    intervalInput.type = 'text';
    intervalInput.className = 'ai-settings-cron-job__edit-input';
    intervalInput.placeholder = 'e.g. 30m, 2h, 1d';
    intervalInput.value = seedSpec.kind === 'interval' ? seedSpec.every : '1h';
    row.appendChild(intervalInput);

    const onceInput = document.createElement('input');
    onceInput.type = 'datetime-local';
    onceInput.className = 'ai-settings-cron-job__edit-input';
    if (seedSpec.kind === 'once') {
      const d = new Date(seedSpec.at);
      if (!Number.isNaN(d.getTime())) {
        const pad = (n: number) => String(n).padStart(2, '0');
        onceInput.value = `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}`;
      }
    }
    row.appendChild(onceInput);

    const cronInput = document.createElement('input');
    cronInput.type = 'text';
    cronInput.className = 'ai-settings-cron-job__edit-input';
    cronInput.placeholder = 'e.g. 0 9 * * 1-5';
    cronInput.value = seedSpec.kind === 'cron' ? seedSpec.expr : '';
    row.appendChild(cronInput);

    const syncVisibility = () => {
      const kind = kindDropdown.value ?? 'daily';
      timeInput.style.display = (kind === 'daily' || kind === 'weekly') ? '' : 'none';
      dayHost.style.display = kind === 'weekly' ? '' : 'none';
      intervalInput.style.display = kind === 'interval' ? '' : 'none';
      onceInput.style.display = kind === 'once' ? '' : 'none';
      cronInput.style.display = kind === 'cron' ? '' : 'none';
    };
    this._renderDisposables.push(kindDropdown.onDidChange(() => syncVisibility()));
    syncVisibility();

    const error = $('div.ai-settings-cron-job__edit-error');
    error.style.display = 'none';
    form.appendChild(error);

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

    const buttons = $('div.ai-settings-cron-job__edit-actions');

    const save = document.createElement('button');
    save.type = 'button';
    save.className = 'ai-settings-cron-job__btn ai-settings-cron-job__btn--primary';
    save.textContent = 'Save';
    save.addEventListener('click', () => {
      if (!this._cronService) return;
      try {
        const schedule = buildCronSchedule(readSpec());
        this._cronService.updateJob(job.id, { schedule });
        this._editingJobId = null;
        this._renderList(); // onDidChangeJobs will also fire, but this gives instant feedback
      } catch (err) {
        error.textContent = err instanceof Error ? err.message : String(err);
        error.style.display = '';
      }
    });
    buttons.appendChild(save);

    const cancel = document.createElement('button');
    cancel.type = 'button';
    cancel.className = 'ai-settings-cron-job__btn';
    cancel.textContent = 'Cancel';
    cancel.addEventListener('click', () => {
      this._editingJobId = null;
      this._renderList();
    });
    buttons.appendChild(cancel);

    form.appendChild(buttons);
    return form;
  }

  private _runNow(job: ICronJob): void {
    if (!this._cronService) return;
    this._cronService.runJob(job.id).catch((err) => {
      console.warn(`[CronSection] runJob("${job.name}") failed:`, err);
      const message = `"${job.name}" failed: ${err instanceof Error ? err.message : String(err)}`;
      if (this._notifications) {
        void this._notifications.error(message);
      } else {
        void showConfirmModal(document.body, { message, cancelLabel: null });
      }
    });
  }

  private _confirmAndDelete(job: ICronJob): void {
    if (!this._cronService) return;
    const src = _inferSource(job.name);
    void showConfirmModal(document.body, {
      message: `Delete the scheduled job "${job.name}"?`,
      detail: src.kind === 'extension'
        ? `Registered by the ${src.extensionId} extension, which may re-create it on next activation.`
        : 'This cannot be undone.',
      confirmLabel: 'Delete',
      danger: true,
    }).then((ok) => {
      if (!ok || !this._cronService) return;
      try {
        this._cronService.removeJob(job.id);
      } catch (err) {
        console.warn(`[CronSection] removeJob("${job.name}") failed:`, err);
      }
    });
  }
}
