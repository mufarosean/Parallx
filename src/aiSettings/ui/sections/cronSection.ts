// cronSection.ts — Scheduled jobs section in the AI Hub
//
// Renders every cron job from `CronService`, regardless of origin: jobs
// registered programmatically by extensions (e.g. budget.sync.scheduled),
// jobs created by the AI via the `cron_add` tool, and jobs added by the
// user directly. All three live in the same in-memory store and are
// surfaced here equally.
//
// Per job, the UI exposes:
//   - Stable name + human description
//   - Source label (Extension / AI / User) inferred from the name shape
//   - Schedule (every / cron / at) in human-readable form
//   - Enabled toggle
//   - Last run / Next run timestamps
//   - Actions: Run now, Edit schedule, Delete (with confirm)
//
// Subscribes to `CronService.onDidChangeJobs` so additions, updates,
// runs, and removals reflect in the panel without polling. Static fall-
// back (no service) still renders the explanatory header so the section
// is never empty.

import { $ } from '../../../ui/dom.js';
import { SettingsSection } from '../sectionBase.js';
import type { AISettingsProfile, IAISettingsService } from '../../aiSettingsTypes.js';
import type {
  CronService,
  ICronJob,
  ICronSchedule,
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

// ─── Schedule formatting ─────────────────────────────────────────────────────

function _formatSchedule(s: ICronSchedule): string {
  if (s.every) return `Every ${s.every}`;
  if (s.cron) return `Cron: ${s.cron}`;
  if (s.at) {
    const d = new Date(s.at);
    return Number.isNaN(d.getTime()) ? `At ${s.at}` : `At ${d.toLocaleString()}`;
  }
  return '(no schedule)';
}

// ─── Schedule input ↔ object helpers ─────────────────────────────────────────

function _scheduleToInput(s: ICronSchedule): string {
  if (s.every) return s.every;
  if (s.cron) return `cron:${s.cron}`;
  if (s.at) return `at:${s.at}`;
  return '';
}

/**
 * Parse the edit-form's text input back into an ICronSchedule.
 *  - "30m" / "1h" / "45s"       → { every: '30m' }
 *  - "cron:0 9 * * *"           → { cron: '0 9 * * *' }
 *  - "at:2026-05-21T09:00:00Z"  → { at: '2026-05-21T09:00:00Z' }
 *
 * Returns null on parse failure so the caller can surface an error.
 */
function _inputToSchedule(raw: string): ICronSchedule | null {
  const v = raw.trim();
  if (!v) return null;
  if (v.startsWith('cron:')) {
    const expr = v.slice('cron:'.length).trim();
    return expr.length > 0 ? { cron: expr } : null;
  }
  if (v.startsWith('at:')) {
    const iso = v.slice('at:'.length).trim();
    if (iso.length === 0) return null;
    const d = new Date(iso);
    return Number.isNaN(d.getTime()) ? null : { at: d.toISOString() };
  }
  // Plain duration string like "30m". CronService.validateSchedule will
  // double-check syntax; we just confirm there's something there.
  return /^\d+(?:\.\d+)?[smhd]$/i.test(v) ? { every: v } : null;
}

// ─── Timestamp formatting ────────────────────────────────────────────────────

function _formatTimestamp(ts: number | null): string {
  if (ts === null) return '—';
  const d = new Date(ts);
  if (Number.isNaN(d.getTime())) return '—';
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

  constructor(
    service: IAISettingsService,
    private readonly _cronService?: CronService,
  ) {
    super(service, 'cron', 'Scheduled jobs');
  }

  build(): void {
    const intro = $('div.ai-settings-section__info');
    intro.textContent =
      'Background jobs that the cron scheduler runs on a schedule. Includes ' +
      'jobs registered by extensions (e.g. budget sync) and jobs the AI ' +
      'schedules through approved cron_add tool calls. Everything is listed ' +
      'here and can be enabled, edited, run on demand, or removed.';
    this.contentElement.appendChild(intro);

    const approval = $('div.ai-settings-section__info');
    approval.textContent =
      'Approval posture: cron_add / cron_update / cron_remove require your ' +
      'confirmation when the AI invokes them. Direct edits made in this ' +
      'panel are user-initiated and apply immediately.';
    this.contentElement.appendChild(approval);

    this._listContainer = $('div.ai-settings-cron-list');
    this.contentElement.appendChild(this._listContainer);

    this._emptyEl = $('div.ai-settings-section__info');
    this._emptyEl.textContent =
      'No scheduled jobs yet. Install an extension that registers one (e.g. ' +
      'Budget) or ask the AI to create a reminder.';
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
    for (const d of this._listenerDisposables) d.dispose();
    this._listenerDisposables.length = 0;
    super.dispose();
  }

  // ── Rendering ─────────────────────────────────────────────────────────

  private _renderList(): void {
    if (!this._listContainer) return;
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

    // Enabled toggle
    const toggleWrap = $('label.ai-settings-cron-job__toggle');
    const toggle = document.createElement('input');
    toggle.type = 'checkbox';
    toggle.checked = job.enabled;
    toggle.setAttribute('aria-label', `Enable ${job.name}`);
    toggle.addEventListener('change', () => {
      if (!this._cronService) return;
      try {
        this._cronService.updateJob(job.id, { enabled: toggle.checked });
      } catch (err) {
        console.warn(`[CronSection] failed to toggle "${job.name}":`, err);
        toggle.checked = job.enabled; // revert UI on failure
      }
    });
    toggleWrap.appendChild(toggle);
    const toggleLabel = $('span', toggle.checked ? 'Enabled' : 'Disabled');
    toggleWrap.appendChild(toggleLabel);
    toggle.addEventListener('change', () => {
      toggleLabel.textContent = toggle.checked ? 'Enabled' : 'Disabled';
    });
    header.appendChild(toggleWrap);

    card.appendChild(header);

    // ── Description ──
    if (job.description) {
      const desc = $('div.ai-settings-cron-job__description');
      desc.textContent = job.description;
      card.appendChild(desc);
    }

    // ── Meta grid (schedule, last run, next run, run count) ──
    const meta = $('div.ai-settings-cron-job__meta');
    meta.appendChild(this._metaCell('Schedule', _formatSchedule(job.schedule)));
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
        : (job.enabled ? '—' : 'Paused'),
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
    runBtn.textContent = 'Run now';
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

  private _renderEditForm(job: ICronJob): HTMLElement {
    const form = $('div.ai-settings-cron-job__edit');

    const label = $('label.ai-settings-cron-job__edit-label', 'Schedule');
    form.appendChild(label);

    const input = document.createElement('input');
    input.type = 'text';
    input.className = 'ai-settings-cron-job__edit-input';
    input.value = _scheduleToInput(job.schedule);
    input.placeholder = 'e.g. 30m  ·  cron:0 9 * * *  ·  at:2026-05-21T09:00:00Z';
    form.appendChild(input);

    const help = $('div.ai-settings-cron-job__edit-help');
    help.textContent =
      'Accepted: a duration like "30m", "1h", "45s"; or "cron:<expr>" for a ' +
      '5-field cron expression; or "at:<ISO datetime>" for a one-shot job.';
    form.appendChild(help);

    const error = $('div.ai-settings-cron-job__edit-error');
    error.style.display = 'none';
    form.appendChild(error);

    const buttons = $('div.ai-settings-cron-job__edit-actions');

    const save = document.createElement('button');
    save.type = 'button';
    save.className = 'ai-settings-cron-job__btn ai-settings-cron-job__btn--primary';
    save.textContent = 'Save';
    save.addEventListener('click', () => {
      const parsed = _inputToSchedule(input.value);
      if (!parsed) {
        error.textContent = 'Could not parse that schedule. Check the format and try again.';
        error.style.display = '';
        return;
      }
      if (!this._cronService) return;
      try {
        this._cronService.updateJob(job.id, { schedule: parsed });
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
      window.alert(
        `Failed to run "${job.name}":\n\n${err instanceof Error ? err.message : String(err)}`,
      );
    });
  }

  private _confirmAndDelete(job: ICronJob): void {
    if (!this._cronService) return;
    const src = _inferSource(job.name);
    const extraWarning = src.kind === 'extension'
      ? `\n\nThis job was registered by the ${src.extensionId} extension. The extension may re-create it on next activation.`
      : '';
    const ok = window.confirm(
      `Delete the scheduled job "${job.name}"?${extraWarning}\n\nThis cannot be undone.`,
    );
    if (!ok) return;
    try {
      this._cronService.removeJob(job.id);
    } catch (err) {
      console.warn(`[CronSection] removeJob("${job.name}") failed:`, err);
    }
  }
}
