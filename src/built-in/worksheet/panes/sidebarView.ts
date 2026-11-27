// Worksheets: the sidebar view.

import { declareControl } from '../../../ui/kit.js';
import { bindPlaceLink, markCurrent } from '../../../ui/link.js';
import type { PlaceLocation } from '../../../services/places.js';
import { WS_PLACES_ID } from '../worksheetConstants.js';
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
  /** Each row's place link, undone when the rows are drawn again. */
  const links: { dispose(): void }[] = [];
  const places = state.api?.places;
  /** Mark the row of the place Worksheets' tab is on (the shared mark), whoever moved it. */
  let currentPlace: string | undefined = places?.current(WS_PLACES_ID)?.place;
  const syncMark = () => {
    for (const row of Array.from(root.querySelectorAll<HTMLElement>('.ws-nav__item[data-place]'))) markCurrent(row, row.dataset.place === currentPlace);
  };
  const moved = places?.onDidMove((e: { tool: string; location: PlaceLocation }) => {
    if (e.tool !== WS_PLACES_ID) return;
    currentPlace = e.location.place;
    syncMark();
  });

  const render = async () => {
    if (disposed) return;
    const items = await listItems().catch(() => []);
    if (disposed) return;
    root.replaceChildren();
    for (const d of links.splice(0)) d.dispose();
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
      b.dataset.place = instanceId;
      nav.appendChild(b);
      declareControl(b, { id: `worksheet.side.${instanceId}`, label, hint: tip });
      // A row is a link to its place: Ctrl+click and its menu open it in a tab of its own.
      if (places) links.push(bindPlaceLink(b, places.addressOf(WS_PLACES_ID, { place: instanceId })));
    };
    navItem('Home', 'home', 'home', 'Home', 'Quiz, dashboard, bank, import, generate, scratch sheet');
    navItem('Problem Bank', 'library', 'bank', 'Problem Bank', 'Every problem by paper, with filters and search');
    navItem('Study Dashboard', 'gauge', 'dashboard', 'Study Dashboard', 'Progress, pace, the campaign, what to work on next');
    navItem('Campaign', 'calendar-check', 'plan', 'Campaign', 'The study plan, day by day: exams, quizzes drawn for the day, sessions, rewards');
    navItem('Quizzes', 'list-checks', 'quizzes', 'Quizzes', 'Every quiz, open and completed: resume, rename, copy, reopen, delete');
    navItem('Settings', 'settings', 'settings', 'Worksheets Settings', 'The campaign and the sheet appearance');
    root.appendChild(nav);
    syncMark();
    if (items.length === 0) return;
    renderBankSnapshot(root, items);
  };

  void render();
  const sub = onWorksheetDataChanged(() => void render());
  return { dispose: () => { disposed = true; sub.dispose(); moved?.dispose(); for (const d of links.splice(0)) d.dispose(); root.remove(); } };
}
