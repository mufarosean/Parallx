// plannerCalendarsMenu.ts — the Planner's Calendars menu: each calendar's
// colour, name and visibility, rename and delete, and a new calendar.

import { PLANNER_COLORS, el, buildColorSwatches } from './plannerUi.js';
import type { PlannerEditorPane } from './plannerEditorProvider.js';

export class PlannerCalendarsMenu {
  constructor(private readonly _pane: PlannerEditorPane) {}

  /**
   * Calendars manager — a popover to create calendars, recolour them (Google
   * palette), toggle visibility, rename, and delete. All backed by the existing
   * calendar CRUD; re-renders the grid on every change.
   */
  async openCalendarsMenu(anchor: DOMRect): Promise<void> {
    const overlay = el('div', 'planner-popover-overlay');
    overlay.addEventListener('click', (e) => { if (e.target === overlay) overlay.remove(); });
    const pop = el('div', 'planner-popover planner-cals-menu');
    pop.style.position = 'fixed';

    const head = el('div', 'planner-popover__head');
    const heading = el('h3', 'planner-popover__title');
    heading.textContent = 'Calendars';
    head.appendChild(heading);
    const closeBtn = el('button', 'planner-popover__close');
    closeBtn.type = 'button';
    closeBtn.innerHTML = '<svg xmlns="http://www.w3.org/2000/svg" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><line x1="18" y1="6" x2="6" y2="18"/><line x1="6" y1="6" x2="18" y2="18"/></svg>';
    closeBtn.addEventListener('click', () => overlay.remove());
    head.appendChild(closeBtn);
    pop.appendChild(head);

    const list = el('div', 'planner-cals-list');
    pop.appendChild(list);

    const rerenderGrid = (): void => { void this._pane._renderTab(); };

    const renderList = async (): Promise<void> => {
      const cals = await this._pane._data.listCalendars();
      list.innerHTML = '';
      for (const cal of cals) {
        const row = el('div', 'planner-cals-row');

        const swatch = el('button', 'planner-cals-swatch');
        swatch.type = 'button';
        swatch.style.setProperty('--sw', cal.color);
        swatch.title = 'Change colour';
        row.appendChild(swatch);

        const name = el('input', 'planner-cals-name') as HTMLInputElement;
        name.type = 'text';
        name.value = cal.name;
        const saveName = (): void => {
          const v = name.value.trim();
          if (v && v !== cal.name) void this._pane._data.updateCalendar(cal.id, { name: v }).then(rerenderGrid);
        };
        name.addEventListener('blur', saveName);
        name.addEventListener('keydown', (e) => { if (e.key === 'Enter') { e.preventDefault(); name.blur(); } });
        row.appendChild(name);

        const vis = el('button', 'planner-cals-icon');
        vis.type = 'button';
        vis.title = cal.visible ? 'Hide on calendar' : 'Show on calendar';
        vis.classList.toggle('planner-cals-icon--off', !cal.visible);
        vis.innerHTML = cal.visible
          ? '<svg xmlns="http://www.w3.org/2000/svg" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M1 12s4-8 11-8 11 8 11 8-4 8-11 8-11-8-11-8z"/><circle cx="12" cy="12" r="3"/></svg>'
          : '<svg xmlns="http://www.w3.org/2000/svg" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M17.94 17.94A10.07 10.07 0 0 1 12 20c-7 0-11-8-11-8a18.45 18.45 0 0 1 5.06-5.94M9.9 4.24A9.12 9.12 0 0 1 12 4c7 0 11 8 11 8a18.5 18.5 0 0 1-2.16 3.19m-6.72-1.07a3 3 0 1 1-4.24-4.24"/><line x1="1" y1="1" x2="23" y2="23"/></svg>';
        vis.addEventListener('click', () => void this._pane._data.updateCalendar(cal.id, { visible: !cal.visible }).then(() => { rerenderGrid(); void renderList(); }));
        row.appendChild(vis);

        if (!cal.isDefault) {
          const del = el('button', 'planner-cals-icon planner-cals-icon--danger');
          del.type = 'button';
          del.title = 'Delete calendar';
          del.innerHTML = '<svg xmlns="http://www.w3.org/2000/svg" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><polyline points="3 6 5 6 21 6"/><path d="M19 6l-1 14a2 2 0 0 1-2 2H8a2 2 0 0 1-2-2L5 6m3 0V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2"/></svg>';
          del.addEventListener('click', async () => {
            const res = await this._pane._data.deleteCalendar(cal.id);
            if (!res.ok) { await this._pane._api.window.showErrorMessage(res.reason || 'Cannot delete this calendar.'); return; }
            rerenderGrid();
            void renderList();
          });
          row.appendChild(del);
        }

        list.appendChild(row);

        // Inline palette, revealed by the swatch — recolours the calendar.
        const palette = buildColorSwatches(cal.color, (hex) => {
          if (!hex) return;
          swatch.style.setProperty('--sw', hex);
          void this._pane._data.updateCalendar(cal.id, { color: hex }).then(rerenderGrid);
        }, false);
        palette.classList.add('planner-cals-palette');
        list.appendChild(palette);
        swatch.addEventListener('click', () => palette.classList.toggle('planner-cals-palette--open'));
      }
    };
    await renderList();

    const newRow = el('div', 'planner-cals-new');
    const newInput = el('input', 'planner-cals-name') as HTMLInputElement;
    newInput.type = 'text';
    newInput.placeholder = 'New calendar name';
    const addBtn = el('button', 'planner-popover__btn planner-popover__btn--primary');
    addBtn.type = 'button';
    addBtn.textContent = 'Add';
    const doAdd = async (): Promise<void> => {
      const v = newInput.value.trim();
      if (!v) { newInput.focus(); return; }
      const hex = PLANNER_COLORS[Math.floor(Math.random() * PLANNER_COLORS.length)].hex;
      await this._pane._data.createCalendar({ name: v, color: hex });
      newInput.value = '';
      rerenderGrid();
      void renderList();
    };
    addBtn.addEventListener('click', () => void doAdd());
    newInput.addEventListener('keydown', (e) => { if (e.key === 'Enter') { e.preventDefault(); void doAdd(); } });
    newRow.append(newInput, addBtn);
    pop.appendChild(newRow);

    overlay.appendChild(pop);
    document.body.appendChild(overlay);

    const m = pop.getBoundingClientRect();
    const vw = window.innerWidth, vh = window.innerHeight;
    const left = Math.max(12, Math.min(anchor.left, vw - m.width - 12));
    let top = anchor.bottom + 6;
    if (top + m.height > vh - 12) top = Math.max(12, anchor.top - m.height - 6);
    pop.style.left = `${left}px`;
    pop.style.top = `${top}px`;
  }

  // ── Disposal ─────────────────────────────────────────────────────────
}
