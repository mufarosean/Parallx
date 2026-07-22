// autonomyActivityWidget.ts — query-backed widget showing recent autonomy events.
//
// M86 ownership: this widget belongs to the chat/autonomy tool (it renders
// the autonomy task rail), contributed to the dashboard via `api.dashboard`.
// The typeId keeps its pre-M86 value ('parallx.dashboard.autonomy-activity')
// so persisted dashboard instances keep working. Visual styles (`aaw__*`)
// intentionally remain in dashboard.css — the widget renders inside the
// dashboard pane's DOM.
//
// Reads the autonomy task rail via the read-only
// `chat.getRecentAutonomyEvents` command. Each row is one background
// agent / automation chain: when it fired, what triggered it, how it ended,
// how long it took, and how many tools it called.
//
// This answers "did anything run in the background?" at a glance — e.g. if
// refreshing the news brief had spawned a background chain it would appear
// here. (It doesn't: the news brief is a direct foreground model call, not a
// rail-routed autonomous turn, so it never emits an autonomy event.)
//
// Privacy: the command returns structured metadata only — no message bodies,
// no tool arguments, no file contents.

import type {
  WidgetContext,
  WidgetHandle,
  WidgetRefreshContext,
  WidgetTypeRegistration,
} from '../../../api/bridges/dashboardBridge.js';

interface AutonomyActivityConfig {
  readonly maxItems: number;
  readonly windowDays: number;
}

const DEFAULT_CONFIG: AutonomyActivityConfig = { maxItems: 12, windowDays: 7 };

const ICON_SVG = '<svg xmlns="http://www.w3.org/2000/svg" width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M12 2v4"/><path d="M12 18v4"/><path d="m4.93 4.93 2.83 2.83"/><path d="m16.24 16.24 2.83 2.83"/><path d="M2 12h4"/><path d="M18 12h4"/><path d="m4.93 19.07 2.83-2.83"/><path d="m16.24 7.76 2.83-2.83"/></svg>';

// ─── Event shape returned by chat.getRecentAutonomyEvents ────────────────────

interface AutonomyEventRow {
  readonly id: string;
  readonly triggeredAt: string;
  readonly trigger: string;
  readonly outcome?: string;
  readonly durationMs?: number;
  readonly tokensIn?: number;
  readonly tokensOut?: number;
  readonly toolCount?: number;
  readonly note?: string;
}

interface CommandApi {
  commands?: { executeCommand<T = unknown>(id: string, ...args: unknown[]): Promise<T> };
}

async function fetchEvents(api: unknown, cfg: AutonomyActivityConfig): Promise<AutonomyEventRow[]> {
  const exec = (api as CommandApi).commands?.executeCommand;
  if (!exec) return [];
  try {
    const rows = await exec<AutonomyEventRow[]>('chat.getRecentAutonomyEvents', {
      sinceDays: cfg.windowDays,
      limit: cfg.maxItems,
    });
    return Array.isArray(rows) ? rows : [];
  } catch {
    return [];
  }
}

// ─── Formatting helpers ──────────────────────────────────────────────────────

function relativeTime(iso: string): string {
  const then = Date.parse(iso);
  if (!Number.isFinite(then)) return '';
  const diff = Date.now() - then;
  const sec = Math.round(diff / 1000);
  if (sec < 60) return 'just now';
  const min = Math.round(sec / 60);
  if (min < 60) return `${min}m ago`;
  const hr = Math.round(min / 60);
  if (hr < 24) return `${hr}h ago`;
  const day = Math.round(hr / 24);
  return `${day}d ago`;
}

function formatDuration(ms?: number): string {
  if (typeof ms !== 'number' || !Number.isFinite(ms) || ms <= 0) return '';
  if (ms < 1000) return `${Math.round(ms)}ms`;
  const sec = ms / 1000;
  if (sec < 60) return `${sec.toFixed(sec < 10 ? 1 : 0)}s`;
  const min = Math.floor(sec / 60);
  const rem = Math.round(sec % 60);
  return `${min}m ${rem}s`;
}

function triggerLabel(trigger: string): string {
  switch (trigger) {
    case 'chat': return 'Chat';
    case 'followup': return 'Follow-up';
    case 'cron': return 'Scheduled';
    case 'heartbeat': return 'Heartbeat';
    case 'subagent': return 'Sub-agent';
    case 'agent': return 'Agent';
    case 'replay': return 'Replay';
    case 'file-change': return 'File change';
    default: return trigger;
  }
}

// ─── Widget ──────────────────────────────────────────────────────────────────

export const AUTONOMY_ACTIVITY_WIDGET: WidgetTypeRegistration<AutonomyActivityConfig> = {
  typeId: 'parallx.dashboard.autonomy-activity',
  displayName: 'Autonomy activity',
  description: 'Recent background agent and automation runs — what triggered them and how they ended.',
  icon: ICON_SVG,
  category: 'query',
  defaultSize: { colSpan: 5, rowSpan: 4 },
  defaultConfig: DEFAULT_CONFIG,
  configSchema: {
    fields: {
      maxItems: {
        type: 'number',
        label: 'How many to show',
        description: '1-50.',
      },
      windowDays: {
        type: 'number',
        label: 'Look-back window (days)',
        description: '1-90.',
      },
    },
  },
  defaultRefreshPolicy: { kind: 'interval', ms: 60_000 },

  async refresh(ctx: WidgetRefreshContext<AutonomyActivityConfig>): Promise<string> {
    const cfg = normalize(ctx.config);
    const rows = await fetchEvents(ctx.api, cfg);
    return JSON.stringify(rows.slice(0, cfg.maxItems));
  },

  createWidget(container: HTMLElement, ctx: WidgetContext<AutonomyActivityConfig>): WidgetHandle {
    container.classList.add('aaw');

    const list = document.createElement('div');
    list.className = 'aaw__list';
    container.appendChild(list);

    function paintFrom(cached: string | null): void {
      list.innerHTML = '';
      let rows: AutonomyEventRow[] = [];
      if (cached) {
        try {
          const parsed = JSON.parse(cached);
          if (Array.isArray(parsed)) rows = parsed as AutonomyEventRow[];
        } catch { /* malformed */ }
      }

      if (rows.length === 0) {
        const empty = document.createElement('div');
        empty.className = 'aaw__empty';
        empty.innerHTML = `
          <strong>No background activity</strong>
          <p>When an agent runs on its own — a follow-up, a scheduled task, or a sub-agent — it shows up here.</p>
        `;
        list.appendChild(empty);
        return;
      }

      for (const row of rows) {
        const item = document.createElement('div');
        item.className = 'aaw__row';
        item.title = row.note ? row.note : '';

        const dot = document.createElement('span');
        dot.className = `aaw__dot aaw__dot--${outcomeClass(row.outcome)}`;
        item.appendChild(dot);

        const body = document.createElement('div');
        body.className = 'aaw__body';

        const top = document.createElement('div');
        top.className = 'aaw__top';
        const trig = document.createElement('span');
        trig.className = 'aaw__trigger';
        trig.textContent = triggerLabel(row.trigger);
        top.appendChild(trig);
        if (row.outcome) {
          const oc = document.createElement('span');
          oc.className = `aaw__outcome aaw__outcome--${outcomeClass(row.outcome)}`;
          oc.textContent = row.outcome;
          top.appendChild(oc);
        }
        body.appendChild(top);

        const meta = document.createElement('div');
        meta.className = 'aaw__meta';
        const parts: string[] = [relativeTime(row.triggeredAt)];
        const dur = formatDuration(row.durationMs);
        if (dur) parts.push(dur);
        if (typeof row.toolCount === 'number' && row.toolCount > 0) {
          parts.push(`${row.toolCount} tool${row.toolCount === 1 ? '' : 's'}`);
        }
        meta.textContent = parts.filter(Boolean).join(' · ');
        body.appendChild(meta);

        item.appendChild(body);
        list.appendChild(item);
      }
    }

    paintFrom(ctx.cachedOutput);

    const sub = ctx.onDidChangeConfig(() => ctx.requestRefresh());

    // Always kick a refresh on mount — autonomy events change out-of-band, so
    // even a warm cache should re-check what ran while the dashboard was idle.
    ctx.requestRefresh();

    return {
      refreshFromCache(cached: string | null) {
        paintFrom(cached);
      },
      renderError(message: string | null) {
        if (!message) { paintFrom(ctx.cachedOutput); return; }
        list.innerHTML = '';
        const err = document.createElement('div');
        err.className = 'aaw__empty';
        err.innerHTML = `<strong>Couldn\u2019t load activity</strong><p></p>`;
        const p = err.querySelector('p');
        if (p) p.textContent = message;
        list.appendChild(err);
      },
      dispose() {
        sub.dispose();
      },
    };
  },
};

function outcomeClass(outcome?: string): string {
  switch (outcome) {
    case 'completed': return 'ok';
    case 'cancelled': return 'cancelled';
    case 'budget': return 'budget';
    case 'gated': return 'gated';
    case 'error': return 'error';
    default: return 'neutral';
  }
}

function normalize(cfg: AutonomyActivityConfig | undefined): AutonomyActivityConfig {
  const maxItems = clamp(cfg?.maxItems, 1, 50, DEFAULT_CONFIG.maxItems);
  const windowDays = clamp(cfg?.windowDays, 1, 90, DEFAULT_CONFIG.windowDays);
  return { maxItems, windowDays };
}

function clamp(n: unknown, min: number, max: number, fallback: number): number {
  const v = typeof n === 'number' ? n : Number(n);
  if (!Number.isFinite(v)) return fallback;
  return Math.max(min, Math.min(max, Math.floor(v)));
}
