// galleryView.ts — the gallery view: a grid of cards, each with its preview
// (a files property's first picture or the page's), its title and its
// visible properties. Card size is the view's.

import type { DisposableStore } from '../../../platform/lifecycle.js';
import { createBlock, createButton } from '../../../ui/kit.js';
import { readViewConfig } from './viewConfig.js';
import { renderCard, type IViewDeps, type IViewState } from './viewShared.js';

export function renderGalleryView(body: HTMLElement, state: IViewState, deps: IViewDeps, store: DisposableStore): void {
  const cfg = readViewConfig(state.view.config);
  const grid = createBlock(body, 'div', { className: `canvas-db-gallery canvas-db-gallery--${cfg.cardSize}`, attrs: { role: 'list' } });
  for (const row of state.rows) {
    const card = renderCard(grid, row, state, deps, store);
    card.setAttribute('role', 'listitem');
    card.classList.add('canvas-db-card--gallery');
  }
  const add = createBlock(grid, 'div', { className: 'canvas-db-card canvas-db-card--new' });
  createButton(add, { id: 'database.newRowCell', label: 'New', icon: 'plus', kind: 'ghost', size: 'sm', command: 'database.addRow' });
  void deps;
}
