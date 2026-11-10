// listView.ts — the list view: one quiet line per row, its title at the
// left and its visible properties at the right. For a reading list, a
// changelog, anything that is read more than edited.

import type { DisposableStore } from '../../../platform/lifecycle.js';
import { createBlock, createButton } from '../../../ui/kit.js';
import { addDisposableListener } from '../../../ui/dom.js';
import { readViewConfig, visibleProperties } from './viewConfig.js';
import { renderCellValue } from './cellRender.js';
import { renderNewRow, type IViewDeps, type IViewState } from './viewShared.js';

export function renderListView(body: HTMLElement, state: IViewState, deps: IViewDeps, store: DisposableStore): void {
  const cfg = readViewConfig(state.view.config);
  const props = visibleProperties(state.props, state.view);
  const list = createBlock(body, 'div', { className: 'canvas-db-list', attrs: { role: 'list' } });
  for (const row of state.rows) {
    const line = createBlock(list, 'div', { className: 'canvas-db-list__row', attrs: { role: 'listitem' } });
    const open = createButton(line, { id: null, label: row.title || 'Untitled', kind: 'ghost', size: 'sm', icon: row.icon ? undefined : 'file', onClick: () => deps.openRow(row.pageId) });
    open.classList.add('canvas-db-list__title');
    const icon = deps.rowIcon(row.icon);
    if (icon) { icon.classList.add('canvas-db-list__icon'); open.insertBefore(icon, open.firstChild); }
    const side = createBlock(line, 'div', { className: 'canvas-db-list__props' });
    for (const p of props) {
      const item = createBlock(null, 'span', { className: 'canvas-db-list__prop', attrs: { title: p.name } });
      if (cfg.showPropertyNames) createBlock(item, 'span', { className: 'canvas-db-card__propname', text: p.name });
      const val = createBlock(item, 'span', { className: 'canvas-db-list__value' });
      if (renderCellValue(val, p, row.values[p.id])) side.appendChild(item);
    }
    store.add(addDisposableListener(line, 'contextmenu', (e) => { e.preventDefault(); deps.openRowMenu(e, row); }));
  }
  if (state.rows.length === 0) createBlock(list, 'div', { className: 'canvas-db-list__empty', text: 'No rows yet' });
  renderNewRow(body, deps, undefined, 'canvas-db-list__new');
}
