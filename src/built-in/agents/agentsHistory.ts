// agentsHistory.ts — History in Agents: every background run, one stream.
//
// Replaces the Autonomy Log panel's Live and History modes. Rows come from
// the task rail (delivered results and run records, last 30 days), newest
// first, filtered by what started them. A delivered result shows its text,
// whether it failed, the model, View Full Run for its transcript, and, for
// a heartbeat finding, Do It / Tell Me More / Dismiss. Clicking a row marks
// it read. Ordinary chat turns are not agent work and are left out.

import { $ } from '../../ui/dom.js';
import { createButton, createEmptyState, createSegmented } from '../../ui/kit.js';
import { createIconElement } from '../../ui/iconRegistry.js';
import { showConfirmModal } from '../../api/notificationService.js';
import type { IAutonomyLogEntry } from '../../services/autonomyLogService.js';
import type { IRailRow } from '../../services/autonomyTaskRailService.js';
import { labelForTrigger, shorten } from './agentsModel.js';
import { readRunRows, svc, type ParallxApi } from './agentsServices.js';

type HistoryFilter = 'all' | 'heartbeat' | 'routines' | 'helpers';

const FILTER_TRIGGERS: Record<Exclude<HistoryFilter, 'all'>, readonly string[]> = {
  heartbeat: ['heartbeat'],
  routines: ['cron', 'workflow', 'dashboard'],
  helpers: ['subagent', 'agent', 'followup'],
};

let currentFilter: HistoryFilter = 'all';
/** Rows unfolded by the user; survive the list's refreshes. */
const openRows = new Set<string>();

/** Heartbeat findings already acted on or dismissed this session. Log
 *  entries are immutable apart from `read`, so "handled" lives here. */
export const handledHeartbeat = new Set<string>();

/** Whether a delivered result is a heartbeat finding you can act on. Test seam. */
export function isActionableHeartbeat(
  entry: Pick<IAutonomyLogEntry, 'id' | 'origin' | 'content' | 'metadata'>,
  handled: ReadonlySet<string>,
): boolean {
  return (
    entry.origin === 'heartbeat'
    && entry.content.trim().length > 0
    && entry.metadata?.error !== true
    && !handled.has(entry.id)
  );
}

/** The chat prompt that acting on a finding starts with. Test seam. */
export function heartbeatSeedPrompt(content: string, instruction: string): string {
  return `A background heartbeat check flagged this:\n\n${content.trim()}\n\n${instruction}`;
}

/** Do It / Tell Me More / Dismiss for a heartbeat finding. */
export function heartbeatActions(api: ParallxApi, entry: IAutonomyLogEntry, onHandled: () => void): HTMLElement {
  const bar = $('div.agents-hist__actions');
  const handle = (prompt: string | null): void => {
    handledHeartbeat.add(entry.id);
    if (prompt) void api.commands.executeCommand('chat.submitPrompt', { text: prompt });
    // The nag governor learns from this: acting keeps the agent talkative,
    // dismissing quiets it.
    void api.commands.executeCommand('parallx.mind.feedback', { outcome: prompt ? 'act' : 'dismiss' }).catch(() => undefined);
    svc.log?.markRead([entry.id]);
    onHandled();
  };
  createButton(bar, { label: 'Do It', kind: 'primary', size: 'sm', title: 'Open Chat and have the agent act on this', onClick: () => handle(heartbeatSeedPrompt(entry.content, 'Please go ahead and handle it.')) });
  createButton(bar, { label: 'Tell Me More', kind: 'secondary', size: 'sm', title: 'Open Chat and ask the agent to explain first', onClick: () => handle(heartbeatSeedPrompt(entry.content, 'Tell me more about this before I decide what to do.')) });
  createButton(bar, { label: 'Dismiss', kind: 'ghost', size: 'sm', onClick: () => handle(null) });
  return bar;
}

function when(iso: string): string {
  const t = Date.parse(iso);
  if (!Number.isFinite(t)) return '';
  const d = new Date(t);
  const hm = `${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')}`;
  const now = new Date();
  if (d.toDateString() === now.toDateString()) return hm;
  const y = new Date(now); y.setDate(now.getDate() - 1);
  if (d.toDateString() === y.toDateString()) return `Yesterday ${hm}`;
  return `${d.toLocaleDateString(undefined, { month: 'short', day: 'numeric' })} ${hm}`;
}

function outcomeWords(outcome: string): string {
  switch (outcome) {
    case 'completed': return 'Finished';
    case 'error': return 'Ran into an error';
    case 'budget': return 'Stopped at its budget';
    case 'gated': return 'Held back by a setting';
    case 'cancelled': return 'Stopped';
    default: return outcome;
  }
}

export function renderHistory(host: HTMLElement, api: ParallxApi, repaint: () => void): void {
  const head = $('div.agents-hist__head');
  createSegmented(head, {
    ariaLabel: 'Show runs from',
    value: currentFilter,
    items: [
      { value: 'all', label: 'All' },
      { value: 'heartbeat', label: 'Heartbeat' },
      { value: 'routines', label: 'Routines' },
      { value: 'helpers', label: 'Helpers' },
    ],
    onChange: (v) => { currentFilter = v as HistoryFilter; repaint(); },
  });
  host.appendChild(head);

  const unread = svc.log?.getUnreadCount() ?? 0;
  const tools = $('div.agents-hist__tools');
  const count = $('span.agents-hist__count');
  count.textContent = unread > 0 ? `${unread} new` : '';
  tools.appendChild(count);
  createButton(tools, { label: 'Mark All Read', kind: 'ghost', size: 'sm', disabled: unread === 0, onClick: () => { svc.log?.markRead(); } });
  createButton(tools, {
    label: 'Clear…',
    kind: 'ghost',
    size: 'sm',
    disabled: (svc.log?.size ?? 0) === 0,
    title: 'Remove every delivered result from History',
    onClick: () => {
      void showConfirmModal(document.body, { message: 'Clear History?', detail: 'Delivered results are removed. Run records stay for diagnostics.', confirmLabel: 'Clear', danger: true })
        .then((ok) => { if (ok) svc.log?.clear(); });
    },
  });
  host.appendChild(tools);

  const list = $('div.agents-hist__list');
  host.appendChild(list);
  const loading = $('div.agents-hist__empty'); loading.textContent = 'Reading history…';
  list.appendChild(loading);

  const triggers = currentFilter === 'all' ? undefined : FILTER_TRIGGERS[currentFilter];
  const read = readRunRows({ sinceDays: 30, limit: 200, triggers });
  void read.then((rows) => {
    list.replaceChildren();
    const shown = rows.filter((r) => r.trigger !== 'chat');
    // The delivered result and its run record often describe the same run;
    // show the result (it has the words) and drop the bare record.
    const live = shown.filter((r) => r.kind === 'live').map((r) => ({ t: Date.parse(r.triggeredAt), trigger: r.trigger }));
    const rowsOut = shown.filter((r) => r.kind === 'live'
      || !live.some((l) => l.trigger === r.trigger && Math.abs(l.t - Date.parse(r.triggeredAt)) < 120_000));
    if (!rowsOut.length) {
      createEmptyState(list, {
        headline: currentFilter === 'all' ? 'Nothing has run yet' : 'No runs like this in the last 30 days',
        hint: 'Results from the heartbeat, routines and helper agents land here, newest first.',
        icon: 'history',
      });
      return;
    }
    for (const r of rowsOut) list.appendChild(renderRow(r, api, repaint));
  }).catch(() => {
    list.replaceChildren();
    const err = $('div.agents-hist__empty'); err.textContent = 'History is not available right now.';
    list.appendChild(err);
  });
}

function renderRow(r: IRailRow, api: ParallxApi, repaint: () => void): HTMLElement {
  const row = $('div.agents-hist__row');
  const entry = r.kind === 'live' ? r.liveEntry : undefined;
  const failed = r.kind === 'live'
    ? entry?.metadata?.['error'] === true || r.outcome === 'error'
    : r.outcome === 'error';
  const stopped = !failed && r.outcome !== undefined && r.outcome !== 'completed';
  if (entry && !entry.read) row.classList.add('agents-hist__row--unread');
  if (failed) row.classList.add('agents-hist__row--failed');

  const top = $('div.agents-hist__top');
  const icon = createIconElement(failed ? 'circle-alert' : stopped ? 'circle-stop' : 'circle-check', 14);
  icon.classList.add('agents-hist__icon');
  top.appendChild(icon);
  const who = $('span.agents-hist__who');
  const jobName = entry?.metadata?.['jobName'];
  who.textContent = typeof jobName === 'string' && jobName ? jobName : labelForTrigger(r.trigger);
  top.appendChild(who);
  const at = $('span.agents-hist__at'); at.textContent = when(r.triggeredAt);
  top.appendChild(at);
  row.appendChild(top);

  const titleText = r.kind === 'live'
    ? shorten(r.requestText || 'Result', 120)
    : `${outcomeWords(r.outcome)}${r.note ? `: ${r.note}` : ''}`;
  if (titleText !== who.textContent) {
    const title = $('div.agents-hist__title');
    title.textContent = titleText;
    row.appendChild(title);
  }

  if (r.kind === 'live' && r.content.trim()) {
    const body = $('div.agents-hist__body');
    body.textContent = r.content;
    row.appendChild(body);
    // Long results fold to a few lines; a click opens them.
    if (openRows.has(r.id)) row.classList.add('agents-hist__row--open');
    row.addEventListener('click', () => {
      const open = row.classList.toggle('agents-hist__row--open');
      if (open) openRows.add(r.id); else openRows.delete(r.id);
      if (entry && !entry.read) svc.log?.markRead([entry.id]);
    });
  }

  const meta: string[] = [];
  const model = entry?.metadata?.['model'];
  if (typeof model === 'string' && model) meta.push(model);
  if (failed) meta.push('Failed');
  if (meta.length) { const m = $('div.agents-hist__meta'); m.textContent = meta.join(' · '); row.appendChild(m); }

  if (entry && isActionableHeartbeat(entry, handledHeartbeat)) {
    row.appendChild(heartbeatActions(api, entry, repaint));
  } else if (entry?.sessionId && String(entry.sessionId).startsWith('ephemeral-')) {
    const bar = $('div.agents-hist__actions');
    createButton(bar, {
      label: 'View Full Run',
      kind: 'ghost',
      size: 'sm',
      onClick: () => {
        void api.commands.executeCommand('chat.openArchivedRun', { sessionId: entry.sessionId, origin: entry.origin, title: entry.requestText });
      },
    });
    row.appendChild(bar);
  }
  // Buttons inside the row don't fold or unfold it.
  row.querySelectorAll('.agents-hist__actions').forEach((b) => b.addEventListener('click', (e) => e.stopPropagation()));
  return row;
}
