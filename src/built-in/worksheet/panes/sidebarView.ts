// Worksheets: the sidebar view.

import { declareControl } from '../../../ui/kit.js';
import { listItems, onWorksheetDataChanged } from '../worksheetData.js';
import { openWorksheet } from '../actions.js';
import { renderBankSnapshot } from './bankPane.js';
import { state } from '../state.js';
import { el } from '../widgets.js';

// ── Sidebar view (activity bar → Worksheets): navigation, then the bank snapshot ──

export function createSidebarView(container: HTMLElement) {
  const root = el('div', 'ws-sidebar');
  container.appendChild(root);
  let disposed = false;

  const render = async () => {
    if (disposed) return;
    const items = await listItems().catch(() => []);
    if (disposed) return;
    root.replaceChildren();
    const nav = el('div', 'ws-nav');
    // Same row shape as every other tool's sidebar: icon, then label.
    const navItem = (label: string, icon: string, instanceId: string, tabTitle: string, tip: string) => {
      const b = el('button', 'ws-nav__item') as HTMLButtonElement;
      b.type = 'button';
      b.title = tip;
      const ic = el('span', 'ws-nav__icon');
      try { ic.innerHTML = state.api?.icons?.createIconHtml?.(icon, 16) ?? ''; } catch { /* label alone */ }
      b.append(ic, el('span', 'ws-nav__label', label));
      b.addEventListener('click', () => void openWorksheet(instanceId, tabTitle));
      nav.appendChild(b);
      declareControl(b, { id: `worksheet.side.${instanceId}`, label, hint: tip });
    };
    navItem('Home', 'home', 'home', 'Worksheets', 'Quiz, dashboard, bank, import, generate, scratch sheet');
    navItem('Study Dashboard', 'gauge', 'dashboard', 'Study Dashboard', 'Progress, pace, the campaign, what to work on next');
    navItem('Campaign', 'calendar-check', 'plan', 'Campaign', 'The study plan, day by day: exams, quizzes drawn for the day, sessions, rewards');
    navItem('Quizzes', 'list-checks', 'quizzes', 'Quizzes', 'Every quiz, open and completed: resume, rename, copy, reopen, delete');
    navItem('Settings', 'settings', 'settings', 'Worksheets Settings', 'The campaign and the sheet appearance');
    root.appendChild(nav);
    if (items.length === 0) return;
    renderBankSnapshot(root, items);
  };

  void render();
  const sub = onWorksheetDataChanged(() => void render());
  return { dispose: () => { disposed = true; sub.dispose(); root.remove(); } };
}
