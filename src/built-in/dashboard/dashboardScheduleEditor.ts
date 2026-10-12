// dashboardScheduleEditor.ts — the popover that sets a page's headless
// refresh schedule. The page gives it its data service and its id.

import { createSurface, declareControl } from '../../ui/kit.js';
import { Dropdown } from '../../ui/dropdown.js';
import type { DashboardDataService } from './dashboardDataService.js';

export interface IScheduleEditorHost {
  readonly data: DashboardDataService;
  readonly pageId: string;
}

function el<K extends keyof HTMLElementTagNameMap>(tag: K, className?: string): HTMLElementTagNameMap[K] {
  const node = document.createElement(tag);
  if (className) node.className = className;
  return node;
}

/**
 * "Daily At" / "Weekdays At" as a cron. The fields are the app's Time Zone
 * wall clock, the way the scheduler (computeNextRun) reads them.
 */
export function dailyTimeToCron(time: string, weekdaysOnly: boolean): string {
  const [hh, mm] = (time || '07:00').split(':').map((x) => parseInt(x, 10));
  const h = Number.isFinite(hh) ? Math.min(23, Math.max(0, hh)) : 7;
  const min = Number.isFinite(mm) ? Math.min(59, Math.max(0, mm)) : 0;
  return `${min} ${h} * * ${weekdaysOnly ? '1-5' : '*'}`;
}

/** The time a daily/weekday cron fires at ('HH:MM'), or null for any other cron. */
export function cronToDailyTime(cron: string): { time: string; weekdaysOnly: boolean } | null {
  const m = /^(\d{1,2}) (\d{1,2}) \* \* (\*|1-5)$/.exec(String(cron).trim());
  if (!m) return null;
  return { time: `${m[2].padStart(2, '0')}:${m[1].padStart(2, '0')}`, weekdaysOnly: m[3] === '1-5' };
}


/**
 * Compact popover to set the page's headless refresh schedule.
 * Preset-first (off / hourly / every 4h / daily / weekdays) with a raw
 * cron field for power users. Times and cron fields are in the app's Time
 * Zone, as the scheduler reads them (computeNextRun walks the calendar in
 * that zone). This used to convert daily/weekday times to UTC fields, so
 * "Daily At 7:00" fired at 7:00 UTC read as local: noon in Central Time.
 */
export async function openScheduleEditor(host: IScheduleEditorHost, anchor: HTMLElement): Promise<void> {
  document.querySelector('.dashboard-schedule-pop')?.remove();
  const page = await host.data.getPage(host.pageId);
  const current = page?.refreshPolicy ?? null;

  const pop = el('div', 'dashboard-schedule-pop');
  createSurface(pop, { id: 'dashboard.schedulePopover', owner: 'dashboard', label: 'Refresh schedule' });
  const title = el('div', 'dashboard-schedule-pop__title');
  title.textContent = 'Refresh this page automatically';
  pop.appendChild(title);

  const selectHost = el('div', 'dashboard-schedule-pop__select');
  const select = new Dropdown(selectHost, {
    items: [
      { value: 'off', label: 'Off' },
      { value: 'hourly', label: 'Every Hour' },
      { value: 'every4h', label: 'Every 4 hours' },
      { value: 'daily', label: 'Daily At…' },
      { value: 'weekdays', label: 'Weekdays At…' },
      { value: 'cron', label: 'Custom Cron…' },
    ],
    selected: 'off',
    ariaLabel: 'Refresh schedule',
  });
  pop.appendChild(selectHost);

  const timeInput = document.createElement('input');
  timeInput.type = 'time';
  timeInput.value = '07:00';
  timeInput.className = 'dashboard-schedule-pop__time';
  declareControl(timeInput, { id: 'dashboard.schedule.time', label: 'Time', kind: 'input', state: () => ({ kind: 'value', value: timeInput.value }) });
  pop.appendChild(timeInput);

  const cronInput = document.createElement('input');
  cronInput.type = 'text';
  cronInput.placeholder = '0 12 * * 1-5  (5-field cron, your time zone)';
  cronInput.className = 'dashboard-schedule-pop__cron';
  declareControl(cronInput, { id: 'dashboard.schedule.cron', label: 'Cron', kind: 'input', state: () => ({ kind: 'value', value: cronInput.value }) });
  pop.appendChild(cronInput);

  const hint = el('div', 'dashboard-schedule-pop__hint');
  pop.appendChild(hint);

  // Initial state from the persisted policy.
  if (!current) {
    select.value = 'off';
  } else if (current.kind === 'interval') {
    select.value = current.ms === 4 * 3_600_000 ? 'every4h' : 'hourly';
  } else if (current.kind === 'cron') {
    // Try to recognise our own daily/weekday shapes; otherwise show raw.
    const daily = cronToDailyTime(current.cron);
    if (daily) {
      timeInput.value = daily.time;
      select.value = daily.weekdaysOnly ? 'weekdays' : 'daily';
    } else {
      select.value = 'cron';
      cronInput.value = current.cron;
    }
  }

  const syncVisibility = (): void => {
    const v = select.value;
    timeInput.style.display = v === 'daily' || v === 'weekdays' ? '' : 'none';
    cronInput.style.display = v === 'cron' ? '' : 'none';
    hint.textContent =
      v === 'off' ? 'Widgets only refresh manually or on their own schedules.'
      : v === 'cron' ? 'Standard 5-field cron, in your time zone.'
      : v === 'daily' || v === 'weekdays' ? 'Local time. AI widgets run as background agents.'
      : 'AI widgets run as background agents; the chat is never opened.';
  };
  syncVisibility();
  select.onDidChange(syncVisibility);

  const row = el('div', 'dashboard-schedule-pop__actions');
  const save = el('button', 'dashboard-btn dashboard-btn--primary');
  save.textContent = 'Save';
  declareControl(save, { id: 'dashboard.schedule.save', label: 'Save' });
  save.addEventListener('click', async () => {
    let policy: import('./dashboardTypes.js').WidgetRefreshPolicy | null = null;
    const v = select.value;
    if (v === 'hourly') policy = { kind: 'interval', ms: 3_600_000 };
    else if (v === 'every4h') policy = { kind: 'interval', ms: 4 * 3_600_000 };
    else if (v === 'daily' || v === 'weekdays') {
      policy = { kind: 'cron', cron: dailyTimeToCron(timeInput.value, v === 'weekdays') };
    } else if (v === 'cron') {
      const cron = cronInput.value.trim();
      if (cron) policy = { kind: 'cron', cron };
    }
    try {
      await host.data.setPageRefreshPolicy(host.pageId, policy);
      teardown();
    } catch (err) {
      hint.textContent = err instanceof Error ? err.message : String(err);
    }
  });
  row.appendChild(save);
  const cancel = el('button', 'dashboard-btn dashboard-btn--ghost');
  cancel.textContent = 'Cancel';
  declareControl(cancel, { id: 'dashboard.schedule.cancel', label: 'Cancel' });
  cancel.addEventListener('click', () => teardown());
  row.appendChild(cancel);
  pop.appendChild(row);

  // Anchor under the button; dismiss on outside click. The Dropdown owns a
  // document-level listener, so the popover teardown must dispose it.
  const teardown = (): void => {
    select.dispose();
    pop.remove();
    document.removeEventListener('mousedown', dismiss, true);
  };
  const rect = anchor.getBoundingClientRect();
  pop.style.top = `${rect.bottom + 6}px`;
  pop.style.right = `${Math.max(8, window.innerWidth - rect.right)}px`;
  document.body.appendChild(pop);
  const dismiss = (e: MouseEvent): void => {
    if (!pop.contains(e.target as Node) && e.target !== anchor) {
      teardown();
    }
  };
  document.addEventListener('mousedown', dismiss, true);
}
