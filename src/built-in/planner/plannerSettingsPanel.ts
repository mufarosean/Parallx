// plannerSettingsPanel.ts — the planner's panel in the unified Settings hub.
//
// Registered into `settingsPanelRegistry` (id 'planner') so the sidebar's
// Settings row can deep-link straight here via `settings.open('planner')`.
// Starts intentionally small (event defaults); calendar management
// (calendars, colours, week-start, working hours) lands here with the
// calendar milestone.

import type { IDisposable } from '../../platform/lifecycle.js';
import type { ISettingsPanel } from '../../services/settingsPanelRegistry.js';
import type { PlannerDataService } from './plannerDataService.js';

function el<K extends keyof HTMLElementTagNameMap>(tag: K, className?: string): HTMLElementTagNameMap[K] {
  const node = document.createElement(tag);
  if (className) node.className = className;
  return node;
}

export function createPlannerSettingsPanel(data: PlannerDataService): ISettingsPanel {
  return {
    id: 'planner',
    label: 'Planner',
    order: 60,
    description: 'Tasks and calendar defaults.',
    render(container: HTMLElement): IDisposable {
      const wrap = el('div', 'planner-settings');

      // ── Default event length ──
      const field = el('div', 'planner-settings__field');

      const labelWrap = el('div', 'planner-settings__label');
      const title = el('div', 'planner-settings__label-title');
      title.textContent = 'Default event length';
      const help = el('div', 'planner-settings__label-help');
      help.textContent = 'How long a new calendar event runs when you don’t set an end time.';
      labelWrap.appendChild(title);
      labelWrap.appendChild(help);
      field.appendChild(labelWrap);

      const select = el('select', 'planner-settings__select');
      const options: [number, string][] = [
        [15, '15 minutes'], [30, '30 minutes'], [45, '45 minutes'],
        [60, '1 hour'], [90, '1.5 hours'], [120, '2 hours'],
      ];
      for (const [mins, lbl] of options) {
        const opt = el('option');
        opt.value = String(mins);
        opt.textContent = lbl;
        select.appendChild(opt);
      }
      field.appendChild(select);
      wrap.appendChild(field);
      container.appendChild(wrap);

      // Load current value, then persist on change.
      void data.getDefaultEventMinutes().then((m) => { select.value = String(m); });
      const onChange = (): void => {
        const n = parseInt(select.value, 10);
        if (Number.isFinite(n)) void data.setDefaultEventMinutes(n);
      };
      select.addEventListener('change', onChange);

      return { dispose() { select.removeEventListener('change', onChange); } };
    },
  };
}
