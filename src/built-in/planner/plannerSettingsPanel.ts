// plannerSettingsPanel.ts — the planner's panel in the unified Settings hub.
//
// Registered into `settingsPanelRegistry` (id 'planner') so the sidebar's
// Settings row can deep-link straight here via `settings.open('planner')`.
// Holds event defaults and Google-style calendar management (create / rename /
// recolour / show-hide / delete). The calendar list re-renders live on
// 'calendar-changed'.

import { DisposableStore, type IDisposable } from '../../platform/lifecycle.js';
import type { ISettingsPanel } from '../../services/settingsPanelRegistry.js';
import { DEFAULT_EVENT_CALENDAR_KEY, type PlannerDataService } from './plannerDataService.js';
import type { PlannerCalendar } from './plannerTypes.js';
import { buildICalendar } from './plannerICal.js';
import { googleSync } from './sync/googleClient.js';
import { fetchGoogleCalendarList, GOOGLE_PROVIDER_ID, GOOGLE_TASKS_ENABLED_KEY } from './sync/googleCalendarSyncProvider.js';
import type { IPlannerSyncController } from './sync/plannerSyncOrchestrator.js';

const PALETTE = ['#4c8bf5', '#3fb950', '#e3b341', '#f0883e', '#db61a2', '#a371f7', '#39c5cf', '#f85149'];

function el<K extends keyof HTMLElementTagNameMap>(tag: K, className?: string): HTMLElementTagNameMap[K] {
  const node = document.createElement(tag);
  if (className) node.className = className;
  return node;
}

const EYE_ON = '<svg xmlns="http://www.w3.org/2000/svg" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M2 12s3-7 10-7 10 7 10 7-3 7-10 7-10-7-10-7z"/><circle cx="12" cy="12" r="3"/></svg>';
const EYE_OFF = '<svg xmlns="http://www.w3.org/2000/svg" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M17.94 17.94A10.07 10.07 0 0 1 12 20c-7 0-10-7-10-7a18.45 18.45 0 0 1 5.06-5.94M9.9 4.24A9.12 9.12 0 0 1 12 4c7 0 10 7 10 7a18.5 18.5 0 0 1-2.16 3.19m-6.72-1.07a3 3 0 1 1-4.24-4.24"/><line x1="1" y1="1" x2="23" y2="23"/></svg>';
const TRASH = '<svg xmlns="http://www.w3.org/2000/svg" width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><polyline points="3 6 5 6 21 6"/><path d="M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6m3 0V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2"/></svg>';
const DOWNLOAD = '<svg xmlns="http://www.w3.org/2000/svg" width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"/><polyline points="7 10 12 15 17 10"/><line x1="12" y1="15" x2="12" y2="3"/></svg>';

/** Export a calendar's events + tasks as an .ics file the user can save. */
async function exportCalendar(data: PlannerDataService, cal: PlannerCalendar): Promise<void> {
  const { events, tasks } = await data.getCalendarExport(cal.id);
  const ics = buildICalendar({ events, tasks, calendarName: cal.name, calendarColor: cal.color });
  const slug = cal.name.trim().toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '') || 'calendar';
  await saveTextFile(ics, `${slug}.ics`, 'text/calendar', 'iCalendar', '.ics');
}

/**
 * Save text to disk. Prefers the File System Access save dialog; falls back to
 * an anchor download on older Electron builds (mirrors the Settings export).
 */
async function saveTextFile(content: string, filename: string, mime: string, typeDesc: string, ext: string): Promise<void> {
  const fsApi = (window as unknown as { showSaveFilePicker?: (opts: {
    suggestedName: string;
    types: { description: string; accept: Record<string, string[]> }[];
  }) => Promise<{ createWritable: () => Promise<{ write: (data: string) => Promise<void>; close: () => Promise<void> }> }> }).showSaveFilePicker;
  if (fsApi) {
    try {
      const handle = await fsApi({ suggestedName: filename, types: [{ description: typeDesc, accept: { [mime]: [ext] } }] });
      const writable = await handle.createWritable();
      await writable.write(content);
      await writable.close();
      return;
    } catch (err: unknown) {
      if ((err as { name?: string }).name === 'AbortError') return;
      // Fall through to anchor-download.
    }
  }
  const blob = new Blob([content], { type: `${mime};charset=utf-8` });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  a.remove();
  URL.revokeObjectURL(url);
}

export function createPlannerSettingsPanel(
  data: PlannerDataService,
  sync?: IPlannerSyncController,
): ISettingsPanel {
  return {
    id: 'planner',
    label: 'Planner',
    order: 60,
    description: 'Google sync, calendars, colours, and event defaults.',
    render(container: HTMLElement): IDisposable {
      const store = new DisposableStore();
      const wrap = el('div', 'planner-settings');
      container.appendChild(wrap);

      // ── Default event length ──
      const durField = el('div', 'planner-settings__field');
      const durLabel = el('div', 'planner-settings__label');
      const durTitle = el('div', 'planner-settings__label-title');
      durTitle.textContent = 'Default event length';
      const durHelp = el('div', 'planner-settings__label-help');
      durHelp.textContent = 'How long a new calendar event runs when you don’t set an end time.';
      durLabel.append(durTitle, durHelp);
      const durSelect = el('select', 'planner-settings__select');
      for (const [mins, lbl] of [[15, '15 minutes'], [30, '30 minutes'], [45, '45 minutes'], [60, '1 hour'], [90, '1.5 hours'], [120, '2 hours']] as [number, string][]) {
        const opt = el('option'); opt.value = String(mins); opt.textContent = lbl; durSelect.appendChild(opt);
      }
      durField.append(durLabel, durSelect);
      wrap.appendChild(durField);
      void data.getDefaultEventMinutes().then((m) => { durSelect.value = String(m); });
      const onDur = (): void => { const n = parseInt(durSelect.value, 10); if (Number.isFinite(n)) void data.setDefaultEventMinutes(n); };
      durSelect.addEventListener('change', onDur);
      store.add({ dispose: () => durSelect.removeEventListener('change', onDur) });

      // ── Google sync ──
      renderGoogleSyncSection(wrap, store, data, sync);

      // ── Calendars ──
      const calHeading = el('div', 'planner-settings__heading');
      calHeading.textContent = 'Calendars';
      wrap.appendChild(calHeading);
      const calHelp = el('div', 'planner-settings__label-help');
      calHelp.textContent = 'Group events and tasks, give each a colour, and toggle what shows on the calendar.';
      wrap.appendChild(calHelp);

      const calList = el('div', 'planner-settings__cals');
      wrap.appendChild(calList);

      const addBtn = el('button', 'planner-settings__cal-add');
      addBtn.type = 'button';
      addBtn.textContent = '+ Add calendar';
      const onAdd = (): void => {
        void data.listCalendars().then((cals) => data.createCalendar({ name: 'New calendar', color: PALETTE[cals.length % PALETTE.length] }));
      };
      addBtn.addEventListener('click', onAdd);
      store.add({ dispose: () => addBtn.removeEventListener('click', onAdd) });
      wrap.appendChild(addBtn);

      const renderCals = async (): Promise<void> => {
        const cals = await data.listCalendars();
        calList.innerHTML = '';
        for (const cal of cals) {
          const row = el('div', 'planner-settings__cal');

          const color = el('input', 'planner-settings__cal-color') as HTMLInputElement;
          color.type = 'color';
          color.value = cal.color;
          color.title = 'Calendar colour';
          color.addEventListener('change', () => void data.updateCalendar(cal.id, { color: color.value }));

          const name = el('input', 'planner-settings__cal-name') as HTMLInputElement;
          name.type = 'text';
          name.value = cal.name;
          const commit = (): void => { const v = name.value.trim(); if (v && v !== cal.name) void data.updateCalendar(cal.id, { name: v }); else if (!v) name.value = cal.name; };
          name.addEventListener('blur', commit);
          name.addEventListener('keydown', (e) => { if (e.key === 'Enter') name.blur(); });

          const vis = el('button', 'planner-settings__cal-vis');
          vis.type = 'button';
          vis.classList.toggle('is-off', !cal.visible);
          vis.title = cal.visible ? 'Visible on calendar' : 'Hidden from calendar';
          vis.innerHTML = cal.visible ? EYE_ON : EYE_OFF;
          vis.addEventListener('click', () => void data.updateCalendar(cal.id, { visible: !cal.visible }));

          const exportBtn = el('button', 'planner-settings__cal-export');
          exportBtn.type = 'button';
          exportBtn.title = 'Export as .ics (import into Google / Apple / Outlook)';
          exportBtn.innerHTML = DOWNLOAD;
          exportBtn.addEventListener('click', () => void exportCalendar(data, cal));

          row.append(color, name, vis, exportBtn);

          if (!cal.isDefault) {
            const del = el('button', 'planner-settings__cal-del');
            del.type = 'button';
            del.title = 'Delete calendar (its items move to the default calendar)';
            del.innerHTML = TRASH;
            del.addEventListener('click', () => void data.deleteCalendar(cal.id));
            row.appendChild(del);
          } else {
            const badge = el('span', 'planner-settings__cal-badge');
            badge.textContent = 'Default';
            row.appendChild(badge);
          }

          calList.appendChild(row);
        }
      };

      void renderCals();
      store.add(data.onDidChange((e) => { if (e.kind === 'calendar-changed') void renderCals(); }));

      return store;
    },
  };
}

// ─── Google sync section ───────────────────────────────────────────────────────

/**
 * Account connect/disconnect, manual sync + status, and per-calendar sync
 * toggles for two-way Google sync. The subtree is re-rendered on connect/
 * disconnect; the sync-status line updates in place via a single
 * onDidChange listener (no per-render listener accumulation).
 */
function renderGoogleSyncSection(
  host: HTMLElement,
  store: DisposableStore,
  data: PlannerDataService,
  sync?: IPlannerSyncController,
): void {
  const heading = el('div', 'planner-settings__heading');
  heading.textContent = 'Google sync';
  host.appendChild(heading);

  const help = el('div', 'planner-settings__label-help');
  help.textContent = 'Two-way sync of your calendars and tasks with Google. Changes flow both ways on a timer and when you sync manually.';
  host.appendChild(help);

  const section = el('div', 'planner-settings__google');
  host.appendChild(section);

  let busy = false;
  // Updated in place by the connected branch; cleared otherwise. A single
  // onDidChange listener (registered once below) drives it.
  let statusUpdater: (() => void) | null = null;
  if (sync) {
    store.add(sync.onDidChange(() => statusUpdater?.()));
  }

  const refresh = async (): Promise<void> => {
    section.innerHTML = '';
    statusUpdater = null;

    if (!googleSync.available()) {
      const s = el('div', 'planner-settings__google-status');
      s.textContent = 'Google sync is unavailable in this build.';
      section.appendChild(s);
      return;
    }

    const status = await googleSync.status();

    // No OAuth client configured — explain how to add one.
    if (!status.hasClient) {
      const s = el('div', 'planner-settings__google-status is-error');
      s.textContent = 'No Google OAuth client found.';
      section.appendChild(s);
      const h = el('div', 'planner-settings__label-help planner-settings__google-help');
      h.innerHTML = 'Create a Desktop OAuth client in Google Cloud (with the Calendar &amp; Tasks APIs enabled) and save it to <code>~/.parallx/google/oauth-client.json</code>, then re-check.';
      section.appendChild(h);
      const recheck = el('button', 'planner-settings__btn');
      recheck.type = 'button';
      recheck.textContent = 'Re-check';
      recheck.addEventListener('click', () => void refresh());
      section.appendChild(recheck);
      return;
    }

    // Client present but not connected — offer Connect.
    if (!status.connected) {
      const row = el('div', 'planner-settings__google-row');
      const connect = el('button', 'planner-settings__btn planner-settings__btn--primary');
      connect.type = 'button';
      connect.textContent = 'Connect Google';
      const statusLine = el('div', 'planner-settings__google-status');
      connect.addEventListener('click', async () => {
        if (busy) return;
        busy = true;
        connect.disabled = true;
        statusLine.classList.remove('is-error');
        statusLine.textContent = 'Opening your browser… approve access, then return here.';
        const res = await googleSync.authorize();
        busy = false;
        if (res.ok) {
          await sync?.refreshProviders();
          void refresh();
        } else {
          connect.disabled = false;
          statusLine.classList.add('is-error');
          statusLine.textContent = `Couldn’t connect: ${friendlyAuthError(res.error)}`;
        }
      });
      row.appendChild(connect);
      section.appendChild(row);
      section.appendChild(statusLine);
      return;
    }

    // ── Connected ──
    const acctRow = el('div', 'planner-settings__google-row');
    const acct = el('div', 'planner-settings__google-account');
    acct.textContent = `Connected as ${status.email ?? 'your Google account'}`;
    acctRow.appendChild(acct);
    const disconnect = el('button', 'planner-settings__btn');
    disconnect.type = 'button';
    disconnect.textContent = 'Disconnect';
    disconnect.addEventListener('click', async () => {
      if (busy) return;
      busy = true;
      disconnect.disabled = true;
      await googleSync.disconnect();
      await sync?.refreshProviders();
      busy = false;
      void refresh();
    });
    acctRow.appendChild(disconnect);
    section.appendChild(acctRow);

    // Token expired / revoked — the account row alone is misleading. Surface a
    // one-click Reconnect that re-runs OAuth (prompt=consent mints a fresh
    // refresh token; no need to disconnect first).
    if (status.needsReauth) {
      const warn = el('div', 'planner-settings__google-status is-error');
      warn.textContent = 'Your Google connection expired or was revoked — reconnect to resume syncing.';
      section.appendChild(warn);
      const reconnect = el('button', 'planner-settings__btn planner-settings__btn--primary');
      reconnect.type = 'button';
      reconnect.textContent = 'Reconnect Google';
      reconnect.addEventListener('click', async () => {
        if (busy) return;
        busy = true;
        reconnect.disabled = true;
        warn.classList.remove('is-error');
        warn.textContent = 'Opening your browser… approve access, then return here.';
        const res = await googleSync.authorize();
        busy = false;
        if (res.ok) {
          await sync?.refreshProviders();
          void refresh();
        } else {
          reconnect.disabled = false;
          warn.classList.add('is-error');
          warn.textContent = `Couldn’t reconnect: ${friendlyAuthError(res.error)}`;
        }
      });
      section.appendChild(reconnect);
    }

    // Sync now + last-sync status.
    if (sync) {
      const syncRow = el('div', 'planner-settings__google-row');
      const syncBtn = el('button', 'planner-settings__btn');
      syncBtn.type = 'button';
      syncBtn.textContent = 'Sync now';
      syncBtn.addEventListener('click', () => { if (!sync.isRunning) void sync.syncNow(); });
      const syncStatus = el('div', 'planner-settings__google-status');
      syncRow.append(syncBtn, syncStatus);
      section.appendChild(syncRow);

      const updateStatus = async (): Promise<void> => {
        syncBtn.disabled = sync.isRunning;
        if (sync.isRunning) {
          syncStatus.classList.remove('is-error');
          syncStatus.textContent = 'Syncing…';
          return;
        }
        const failed = sync.lastResults.find((r) => r.provider === GOOGLE_PROVIDER_ID && !r.ok);
        if (failed) {
          syncStatus.classList.add('is-error');
          syncStatus.textContent = `Last sync failed: ${failed.error ?? 'unknown error'}`;
          return;
        }
        const last = await sync.getLastSyncMs(GOOGLE_PROVIDER_ID);
        syncStatus.classList.remove('is-error');
        syncStatus.textContent = last ? `Last synced ${formatRelative(Date.now() - last)}` : 'Not synced yet.';
      };
      statusUpdater = () => { void updateStatus(); };
      void updateStatus();
    }

    // Sync tasks (Google Tasks) toggle.
    const tasksRow = el('label', 'planner-settings__google-row');
    tasksRow.style.marginTop = '6px';
    const tasksCb = document.createElement('input');
    tasksCb.type = 'checkbox';
    tasksCb.checked = (await data.getSetting(GOOGLE_TASKS_ENABLED_KEY)) === '1';
    tasksCb.addEventListener('change', async () => {
      tasksCb.disabled = true;
      try {
        await data.setSetting(GOOGLE_TASKS_ENABLED_KEY, tasksCb.checked ? '1' : '');
        await sync?.syncNow();
      } finally {
        tasksCb.disabled = false;
      }
    });
    const tasksName = el('span');
    tasksName.textContent = 'Sync tasks with Google Tasks';
    tasksRow.append(tasksCb, tasksName);
    section.appendChild(tasksRow);

    // Calendars to sync.
    const calLabel = el('div', 'planner-settings__label-help');
    calLabel.style.marginTop = '10px';
    calLabel.textContent = 'Calendars to sync';
    section.appendChild(calLabel);

    const calBox = el('div', 'planner-settings__google');
    const loading = el('div', 'planner-settings__google-status');
    loading.textContent = 'Loading your Google calendars…';
    calBox.appendChild(loading);
    section.appendChild(calBox);

    try {
      const [remote, mirrors] = await Promise.all([
        fetchGoogleCalendarList(),
        data.listSyncedCalendars(GOOGLE_PROVIDER_ID),
      ]);
      const enabled = new Set(mirrors.map((m) => m.sourceId).filter((x): x is string => !!x));
      calBox.innerHTML = '';
      if (remote.length === 0) {
        const none = el('div', 'planner-settings__google-status');
        none.textContent = 'No calendars found on this account.';
        calBox.appendChild(none);
      }
      for (const gc of remote) {
        const rowEl = el('label', 'planner-settings__google-row');
        const cb = document.createElement('input');
        cb.type = 'checkbox';
        cb.checked = enabled.has(gc.id);
        cb.addEventListener('change', async () => {
          cb.disabled = true;
          try {
            if (cb.checked) {
              await data.upsertCalendarFromSync(GOOGLE_PROVIDER_ID, gc.id, { name: gc.summary, color: gc.backgroundColor });
            } else {
              await data.removeSyncedCalendar(GOOGLE_PROVIDER_ID, gc.id);
              // Reset the per-calendar incremental cursor so a future re-enable
              // does a clean full pull rather than resuming from a stale token.
              await data.setSetting(`sync.${GOOGLE_PROVIDER_ID}.cal.${gc.id}.token`, '');
            }
            await sync?.syncNow();
          } catch (err) {
            cb.checked = !cb.checked; // revert on failure
            console.error('[Planner] toggle calendar sync failed:', err);
          } finally {
            cb.disabled = false;
          }
        });
        const name = el('span');
        name.textContent = gc.summary + (gc.primary ? ' (primary)' : '');
        rowEl.append(cb, name);
        calBox.appendChild(rowEl);
      }
    } catch (err) {
      calBox.innerHTML = '';
      const e = el('div', 'planner-settings__google-status is-error');
      e.textContent = `Couldn’t load calendars: ${err instanceof Error ? err.message : String(err)}`;
      calBox.appendChild(e);
    }

    // Where new events land when the user (or the AI) doesn't pick a calendar.
    // Defaulting this to a Google-synced calendar is what makes "add a meeting"
    // — from chat or quick-add — actually appear on the user's Google calendar.
    try {
      const cals = await data.listCalendars();
      const current = (await data.getSetting(DEFAULT_EVENT_CALENDAR_KEY)) || '';

      const defRow = el('div', 'planner-settings__google-row');
      defRow.style.marginTop = '10px';
      const defLabel = el('span');
      defLabel.textContent = 'New events go to';
      const sel = document.createElement('select');
      sel.className = 'planner-settings__select';

      const auto = document.createElement('option');
      auto.value = '';
      auto.textContent = 'Auto — your synced Google calendar';
      sel.appendChild(auto);
      for (const c of cals) {
        const o = document.createElement('option');
        o.value = c.id;
        o.textContent = c.name + (c.sourceProvider === GOOGLE_PROVIDER_ID ? ' (Google)' : '');
        if (c.id === current) o.selected = true;
        sel.appendChild(o);
      }
      sel.addEventListener('change', () => {
        void data.setSetting(DEFAULT_EVENT_CALENDAR_KEY, sel.value);
      });
      defRow.append(defLabel, sel);
      section.appendChild(defRow);
    } catch {
      // non-fatal — the picker is a convenience over the auto default.
    }
  };

  void refresh();
}

/** Coarse "x ago" for the last-sync line. */
function formatRelative(deltaMs: number): string {
  const s = Math.max(0, Math.round(deltaMs / 1000));
  if (s < 60) return 'just now';
  const m = Math.round(s / 60);
  if (m < 60) return `${m} min ago`;
  const h = Math.round(m / 60);
  if (h < 24) return `${h} h ago`;
  return `${Math.round(h / 24)} d ago`;
}

/** Map raw OAuth error codes to a sentence the user can act on. */
function friendlyAuthError(code?: string): string {
  switch (code) {
    case 'no-oauth-client': return 'no OAuth client is configured.';
    case 'no-refresh-token': return 'Google didn’t return a refresh token. Revoke Parallx under your Google account’s third-party access, then try again.';
    case 'no-access-token': return 'Google didn’t return an access token.';
    case 'state-mismatch': return 'the security check failed — please retry.';
    case 'access_denied': return 'access was denied in the browser.';
    case 'bridge-unavailable': return 'the sync bridge is unavailable.';
    default: return code || 'unknown error.';
  }
}
