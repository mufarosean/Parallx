// autonomyLogSection.ts — AI Settings section: Autonomy Log
//
// Dedicated surface for heartbeat / cron / subagent run results. These
// deliveries used to inject themselves into the chat transcript (M58
// ship-thin → M58-real post-fix), which made actual conversation hard
// to read. This section displays the same stream in a purpose-built
// panel and is the primary way users catch up on what the agent did
// while they weren't looking.
//
// The agent reads the same data via the `autonomy_log` built-in tool.
//
// Interactions:
//   - Summary badge shows N new / M total
//   - Filter chips: all | heartbeat | cron | subagent
//   - Each entry: origin badge, timestamp, request label, collapsible
//     markdown body, "mark read" state
//   - "Mark all read" and "Clear" buttons
//
// This is a purely informational section — no profile fields to sync.

import { $ } from '../../../ui/dom.js';
import { SettingsSection } from '../sectionBase.js';
import type { AISettingsProfile, IAISettingsService } from '../../aiSettingsTypes.js';
import type {
  AutonomyLogService,
  IAutonomyLogEntry,
  AutonomyOrigin,
} from '../../../services/autonomyLogService.js';

type Filter = 'all' | AutonomyOrigin;

const ORIGIN_BADGE: Record<string, { label: string; cls: string }> = {
  heartbeat: { label: 'Heartbeat', cls: 'heartbeat' },
  cron:      { label: 'Cron',      cls: 'cron' },
  subagent:  { label: 'Subagent',  cls: 'subagent' },
  agent:     { label: 'Agent',     cls: 'agent' },
};

function formatTime(ts: number): string {
  const d = new Date(ts);
  const hh = String(d.getHours()).padStart(2, '0');
  const mm = String(d.getMinutes()).padStart(2, '0');
  const ss = String(d.getSeconds()).padStart(2, '0');
  return `${d.toLocaleDateString()} ${hh}:${mm}:${ss}`;
}

export class AutonomyLogSection extends SettingsSection {
  private readonly _log?: AutonomyLogService;
  private _summaryEl!: HTMLElement;
  private _listEl!: HTMLElement;
  private _emptyEl!: HTMLElement;
  private _filter: Filter = 'all';

  constructor(service: IAISettingsService, log?: AutonomyLogService) {
    super(service, 'autonomy-log', 'Autonomy log');
    this._log = log;
  }

  build(): void {
    // Summary badge in header
    this._summaryEl = $('span.ai-settings-autonomy-summary');
    this.headerElement.appendChild(this._summaryEl);

    // Intro
    const intro = $('div.ai-settings-section__info');
    intro.textContent =
      'Results from heartbeat triggers, scheduled cron jobs, and subagent ' +
      'runs land here instead of your chat. The agent can read this log ' +
      'via the autonomy_log tool, so it stays aware of background activity.';
    this.contentElement.appendChild(intro);

    if (!this._log) {
      const na = $('div.ai-settings-section__info');
      na.textContent = 'Autonomy log service is unavailable in this build.';
      this.contentElement.appendChild(na);
      return;
    }

    // Filter chips
    const filterRow = $('div.ai-settings-autonomy-filters');
    for (const f of ['all', 'heartbeat', 'cron', 'subagent'] as const) {
      const chip = $('button.ai-settings-autonomy-chip');
      chip.dataset.filter = f;
      chip.textContent = f[0].toUpperCase() + f.slice(1);
      chip.addEventListener('click', () => {
        this._filter = f;
        this._renderChips(filterRow);
        this._renderList();
      });
      filterRow.appendChild(chip);
    }
    this.contentElement.appendChild(filterRow);
    this._renderChips(filterRow);

    // List container
    this._listEl = $('div.ai-settings-autonomy-list');
    this.contentElement.appendChild(this._listEl);

    this._emptyEl = $('div.ai-settings-section__info');
    this._emptyEl.textContent = 'No autonomy activity yet.';
    this.contentElement.appendChild(this._emptyEl);

    // Actions
    const actions = $('div.ai-settings-autonomy-actions');
    const markAll = $('button.ai-settings-autonomy-action');
    markAll.textContent = 'Mark all read';
    markAll.addEventListener('click', () => { this._log?.markRead(); });
    actions.appendChild(markAll);

    const clear = $('button.ai-settings-autonomy-action');
    clear.textContent = 'Clear';
    clear.addEventListener('click', () => {
      if (confirm('Clear the entire autonomy log?')) this._log?.clear();
    });
    actions.appendChild(clear);
    this.contentElement.appendChild(actions);

    // Initial paint
    this._renderAll();

    // Live updates — debounced via rAF to coalesce bursts.
    let pending = false;
    this._register(this._log.onDidChange(() => {
      if (pending) return;
      pending = true;
      requestAnimationFrame(() => {
        pending = false;
        this._renderAll();
      });
    }));
  }

  update(_profile: AISettingsProfile): void { /* informational only */ }

  // -------------------------------------------------------------------------

  private _renderChips(container: HTMLElement): void {
    for (const chip of Array.from(container.querySelectorAll<HTMLElement>('button[data-filter]'))) {
      chip.classList.toggle('ai-settings-autonomy-chip--active', chip.dataset.filter === this._filter);
    }
  }

  private _renderAll(): void {
    this._renderSummary();
    this._renderList();
  }

  private _renderSummary(): void {
    if (!this._log) return;
    const total = this._log.size;
    const unread = this._log.getUnreadCount();
    if (total === 0) {
      this._summaryEl.textContent = '';
      return;
    }
    this._summaryEl.textContent = unread > 0
      ? `${unread} new · ${total} total`
      : `${total} total`;
    this._summaryEl.classList.toggle('ai-settings-autonomy-summary--unread', unread > 0);
  }

  private _renderList(): void {
    if (!this._log || !this._listEl) return;
    const originFilter = this._filter === 'all' ? undefined : this._filter;
    const entries = this._log.getEntries({ limit: 200, origin: originFilter });

    this._listEl.innerHTML = '';
    if (entries.length === 0) {
      this._emptyEl.style.display = '';
      return;
    }
    this._emptyEl.style.display = 'none';

    for (const entry of entries) {
      this._listEl.appendChild(this._renderEntry(entry));
    }
  }

  private _renderEntry(entry: IAutonomyLogEntry): HTMLElement {
    const row = $('div.ai-settings-autonomy-entry');
    if (!entry.read) row.classList.add('ai-settings-autonomy-entry--unread');

    const header = $('div.ai-settings-autonomy-entry__header');
    const badgeMeta = ORIGIN_BADGE[entry.origin] ?? { label: entry.origin, cls: 'agent' };
    const badge = $(`span.ai-settings-autonomy-badge.ai-settings-autonomy-badge--${badgeMeta.cls}`);
    badge.textContent = badgeMeta.label;
    header.appendChild(badge);

    const req = $('span.ai-settings-autonomy-entry__label');
    req.textContent = entry.requestText;
    header.appendChild(req);

    const ts = $('span.ai-settings-autonomy-entry__time');
    ts.textContent = formatTime(entry.timestamp);
    header.appendChild(ts);

    row.appendChild(header);

    // Body — plain text presentation so code fences don't wreck layout in
    // the settings panel; the agent's full markdown is still available via
    // the tool.
    const body = $('pre.ai-settings-autonomy-entry__body');
    body.textContent = entry.content;
    row.appendChild(body);

    row.addEventListener('click', () => {
      if (!entry.read) this._log?.markRead([entry.id]);
    });

    return row;
  }
}
