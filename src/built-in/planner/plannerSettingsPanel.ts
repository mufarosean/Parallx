// plannerSettingsPanel.ts — the planner's panel in the unified Settings hub.
//
// Registered into `settingsPanelRegistry` (id 'planner') so the sidebar's
// Settings row can deep-link straight here via `settings.open('planner')`.
// Holds event defaults and Google-style calendar management (create / rename /
// recolour / show-hide / delete). The calendar list re-renders live on
// 'calendar-changed'.

import { DisposableStore, type IDisposable } from '../../platform/lifecycle.js';
import type { ISettingsPanel } from '../../services/settingsPanelRegistry.js';
import type { PlannerDataService } from './plannerDataService.js';

const PALETTE = ['#4c8bf5', '#3fb950', '#e3b341', '#f0883e', '#db61a2', '#a371f7', '#39c5cf', '#f85149'];

function el<K extends keyof HTMLElementTagNameMap>(tag: K, className?: string): HTMLElementTagNameMap[K] {
  const node = document.createElement(tag);
  if (className) node.className = className;
  return node;
}

const EYE_ON = '<svg xmlns="http://www.w3.org/2000/svg" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M2 12s3-7 10-7 10 7 10 7-3 7-10 7-10-7-10-7z"/><circle cx="12" cy="12" r="3"/></svg>';
const EYE_OFF = '<svg xmlns="http://www.w3.org/2000/svg" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M17.94 17.94A10.07 10.07 0 0 1 12 20c-7 0-10-7-10-7a18.45 18.45 0 0 1 5.06-5.94M9.9 4.24A9.12 9.12 0 0 1 12 4c7 0 10 7 10 7a18.5 18.5 0 0 1-2.16 3.19m-6.72-1.07a3 3 0 1 1-4.24-4.24"/><line x1="1" y1="1" x2="23" y2="23"/></svg>';
const TRASH = '<svg xmlns="http://www.w3.org/2000/svg" width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><polyline points="3 6 5 6 21 6"/><path d="M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6m3 0V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2"/></svg>';

export function createPlannerSettingsPanel(data: PlannerDataService): ISettingsPanel {
  return {
    id: 'planner',
    label: 'Planner',
    order: 60,
    description: 'Calendars, colours, and event defaults.',
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

          row.append(color, name, vis);

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
