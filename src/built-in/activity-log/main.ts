// Activity Log — built-in panel tool for Parallx
//
// The user-facing reader for the Activity Journal (the app's common activity
// language): a live, filterable timeline of what happened this session —
// editors opened, pages edited, commands run, questions asked, tools the
// assistant executed. The same stream feeds the heartbeat's wake context and
// the activity_log chat tool; this panel is the human's window onto it.
//
// Pattern: panel view contribution, incremental append (indexing-log model —
// never a full re-render per event).

import './activityLog.css';
import type { ToolContext } from '../../tools/toolModuleLoader.js';
import type { IDisposable } from '../../platform/lifecycle.js';
import { $ } from '../../ui/dom.js';
import { IActivityJournalService, type IActivityEvent } from '../../services/activityJournalService.js';
import { createPanelToolbarButton, createPanelEmptyState } from '../../ui/panelSurface.js';

// ── Local API type ───────────────────────────────────────────────────────────

interface ParallxApi {
  views: {
    registerViewProvider(viewId: string, provider: { createView(container: HTMLElement): IDisposable }, options?: { name?: string; icon?: string }): IDisposable;
  };
  commands: {
    registerCommand(id: string, handler: (...args: unknown[]) => unknown): IDisposable;
  };
  services: {
    get<T>(id: { readonly id: string }): T;
    has(id: { readonly id: string }): boolean;
  };
  window: {
    showInformationMessage(message: string): Promise<unknown>;
  };
}

// ── State ────────────────────────────────────────────────────────────────────

type ActorFilter = 'all' | 'user' | 'ai' | 'other';

const MAX_ROWS = 800;

let _journal: import('../../services/activityJournalService.js').IActivityJournalService | undefined;
let _entries: IActivityEvent[] = [];
let _filter: ActorFilter = 'all';
let _autoScroll = true;

let _listEl: HTMLElement | null = null;
let _emptyEl: HTMLElement | null = null;
let _countEl: HTMLElement | null = null;
/** Event ref → row element, so coalesced updates rewrite in place. */
let _rowByEvent: WeakMap<IActivityEvent, HTMLElement> = new WeakMap();

// ── Rendering ────────────────────────────────────────────────────────────────

function actorCategory(actor: string): Exclude<ActorFilter, 'all'> {
  if (actor === 'user') return 'user';
  if (actor === 'ai') return 'ai';
  return 'other';
}

function actorChipLabel(actor: string): string {
  if (actor === 'user') return 'user';
  if (actor === 'ai') return 'assistant';
  if (actor === 'system') return 'app';
  return actor.startsWith('ext:') ? actor.slice(4) : actor;
}

function eventText(ev: IActivityEvent): string {
  let text = `${ev.verb} ${ev.object}`;
  if (ev.count > 1) text += ` ×${ev.count}`;
  if (ev.detail) text += ` — ${ev.detail}`;
  return text;
}

function fmtTime(ts: number): string {
  const d = new Date(ts);
  return `${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')}:${String(d.getSeconds()).padStart(2, '0')}`;
}

function fillRow(row: HTMLElement, ev: IActivityEvent): void {
  row.innerHTML = '';
  const time = $('span.activity-log-time');
  time.textContent = fmtTime(ev.ts);
  const chip = $('span.activity-log-actor');
  chip.classList.add(`activity-log-actor--${actorCategory(ev.actor)}`);
  chip.textContent = actorChipLabel(ev.actor);
  const text = $('span.activity-log-text');
  text.textContent = eventText(ev);
  // The exact-identity ref stays out of the human line (names read better) —
  // hover reveals it when two same-named objects need telling apart.
  if (ev.ref) text.title = ev.ref;
  row.append(time, chip, text);
}

function passesFilter(ev: IActivityEvent): boolean {
  return _filter === 'all' || actorCategory(ev.actor) === _filter;
}

function appendRow(ev: IActivityEvent): void {
  if (!_listEl || !passesFilter(ev)) return;
  const row = $('div.activity-log-row');
  fillRow(row, ev);
  _rowByEvent.set(ev, row);
  _listEl.appendChild(row);
  while (_listEl.childElementCount > MAX_ROWS) _listEl.firstElementChild?.remove();
  if (_emptyEl) _emptyEl.style.display = 'none';
  if (_autoScroll) _listEl.scrollTop = _listEl.scrollHeight;
}

function refreshList(): void {
  if (!_listEl) return;
  _listEl.innerHTML = '';
  _rowByEvent = new WeakMap();
  const visible = _entries.filter(passesFilter);
  for (const ev of visible.slice(-MAX_ROWS)) appendRow(ev);
  if (_emptyEl) _emptyEl.style.display = visible.length === 0 ? '' : 'none';
  if (_countEl) _countEl.textContent = `${visible.length} event${visible.length === 1 ? '' : 's'}`;
  _listEl.scrollTop = _listEl.scrollHeight;
}

function onJournalAppend(ev: IActivityEvent): void {
  // Coalesced burst: the journal mutates and re-fires the SAME event object —
  // rewrite its existing row instead of appending a duplicate.
  const existing = _rowByEvent.get(ev);
  if (existing) {
    fillRow(existing, ev);
    if (_autoScroll && _listEl) _listEl.scrollTop = _listEl.scrollHeight;
    return;
  }
  if (_entries[_entries.length - 1] !== ev) {
    _entries.push(ev);
    if (_entries.length > MAX_ROWS) _entries.splice(0, _entries.length - MAX_ROWS);
  }
  appendRow(ev);
  if (_countEl) {
    const n = _entries.filter(passesFilter).length;
    _countEl.textContent = `${n} event${n === 1 ? '' : 's'}`;
  }
}

function renderActivityView(container: HTMLElement): IDisposable {
  container.classList.add('activity-log-container', 'px-panel');

  // ── Toolbar: actor filter + copy ──
  const header = $('div');
  header.className = 'px-panel-toolbar';

  _countEl = $('span.px-panel-toolbar-status');
  header.appendChild(_countEl);

  const spacer = $('div');
  spacer.className = 'px-panel-toolbar-spacer';
  header.appendChild(spacer);

  const filters: { id: ActorFilter; label: string; title: string }[] = [
    { id: 'all', label: 'All', title: 'Show everything' },
    { id: 'user', label: 'User', title: 'Only your actions' },
    { id: 'ai', label: 'Assistant', title: 'Only the assistant’s actions' },
    { id: 'other', label: 'App', title: 'App + extension events' },
  ];
  const filterBtns: HTMLButtonElement[] = [];
  for (const f of filters) {
    const btn = document.createElement('button');
    btn.type = 'button';
    btn.className = 'px-panel-toolbar-btn activity-log-filter';
    btn.textContent = f.label;
    btn.title = f.title;
    btn.classList.toggle('is-active', _filter === f.id);
    btn.addEventListener('click', () => {
      _filter = f.id;
      for (const b of filterBtns) b.classList.remove('is-active');
      btn.classList.add('is-active');
      refreshList();
    });
    filterBtns.push(btn);
    header.appendChild(btn);
  }

  header.appendChild(createPanelToolbarButton({
    icon: 'copy',
    title: 'Copy visible timeline to clipboard',
    onClick: () => { void copyVisible(); },
  }));

  container.appendChild(header);

  // ── Scrolling list ──
  const list = $('div.activity-log-list');
  _listEl = list;
  list.addEventListener('scroll', () => {
    _autoScroll = list.scrollTop + list.clientHeight >= list.scrollHeight - 8;
  });
  container.appendChild(list);

  _emptyEl = createPanelEmptyState({
    icon: 'clock',
    title: 'No activity yet',
    hint: 'The timeline fills in as you work — editors, commands, pages, and assistant turns all narrate here.',
  });
  container.appendChild(_emptyEl);

  // Seed from persisted history (previous sessions included), then go live.
  void (async () => {
    try {
      const history = await _journal?.query({ limit: 300 });
      if (history && history.length > 0) {
        // The live ring may already share tail objects with the query result —
        // dedupe by identity-ish key (ts+actor+verb+object).
        const seen = new Set(_entries.map((e) => `${e.ts}|${e.actor}|${e.verb}|${e.object}`));
        const merged = [...history.filter((e) => !seen.has(`${e.ts}|${e.actor}|${e.verb}|${e.object}`)), ..._entries];
        merged.sort((a, b) => a.ts - b.ts);
        _entries = merged.slice(-MAX_ROWS);
      }
    } catch { /* ring-only is fine */ }
    refreshList();
  })();

  return {
    dispose: () => {
      _listEl = null;
      _emptyEl = null;
      _countEl = null;
      _rowByEvent = new WeakMap();
    },
  };
}

async function copyVisible(): Promise<void> {
  const lines = _entries.filter(passesFilter).map((ev) =>
    `${fmtTime(ev.ts)} ${actorChipLabel(ev.actor)} ${eventText(ev)}`);
  try { await navigator.clipboard.writeText(lines.join('\n')); } catch { /* clipboard denied */ }
}

// ── Activation ───────────────────────────────────────────────────────────────

export function activate(api: ParallxApi, context: ToolContext): void {
  _journal = api.services.has(IActivityJournalService)
    ? api.services.get<import('../../services/activityJournalService.js').IActivityJournalService>(IActivityJournalService)
    : undefined;

  if (_journal) {
    context.subscriptions.push(_journal.onDidAppend(onJournalAppend));
  }

  context.subscriptions.push(api.views.registerViewProvider('view.activityLog', {
    createView(container: HTMLElement): IDisposable {
      return renderActivityView(container);
    },
  }));

  context.subscriptions.push(api.commands.registerCommand('activityLog.copyRecent', async () => {
    await copyVisible();
    void api.window.showInformationMessage('Activity timeline copied to clipboard.');
  }));
}

export function deactivate(): void {
  _journal = undefined;
  _entries = [];
  _listEl = null;
  _emptyEl = null;
  _countEl = null;
  _rowByEvent = new WeakMap();
}
