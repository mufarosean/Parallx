// viewShared.ts — what every database view gets from the pane, and the card
// the board, list and gallery share (docs/DATABASES.md step 4).

import type { DisposableStore } from '../../../platform/lifecycle.js';
import { createBlock, createButton, createIconButton } from '../../../ui/kit.js';
import { addDisposableListener } from '../../../ui/dom.js';
import type { IDatabaseProperty, IDatabaseRow, IDatabaseView } from './databaseTypes.js';
import { readViewConfig, visibleProperties, type IViewConfig } from './viewConfig.js';
import { filesOf, isImageFile, renderCellValue } from './cellRender.js';
import { wireBoardCardKeys } from './boardCardKeys.js';

export interface IViewDeps {
  setCell(pageId: string, propertyId: string, value: unknown): Promise<void>;
  /** Open a row the way the view says (beside the view or as a page). */
  openRow(pageId: string): void;
  addRow(seed?: Record<string, unknown>): Promise<void>;
  updateView(patch: { config?: Record<string, unknown>; groupBy?: string | null }): Promise<void>;
  openRowMenu(e: MouseEvent, row: IDatabaseRow): void;
  rowIcon(icon: string | null): HTMLElement | null;
  /** The page's first picture, for a card preview; null when it has none. */
  pagePreview?(pageId: string): Promise<string | null>;
}

export interface IViewState {
  readonly view: IDatabaseView;
  readonly props: readonly IDatabaseProperty[];
  /** Filtered and sorted already. */
  readonly rows: readonly IDatabaseRow[];
  readonly locked?: boolean;
}

export const ROW_DRAG_TYPE = 'text/parallx-db-row';

/** The preview image of a row under the view's `preview` setting: a files property's first picture, or the page's. */
export function previewSrc(row: IDatabaseRow, cfg: IViewConfig, props: readonly IDatabaseProperty[]): { kind: 'src'; src: string } | { kind: 'page' } | null {
  if (!cfg.preview) return null;
  if (cfg.preview === 'page') return { kind: 'page' };
  const prop = props.find((p) => p.id === cfg.preview && p.type === 'files');
  if (!prop) return null;
  const img = filesOf(row.values[prop.id]).find(isImageFile);
  return img ? { kind: 'src', src: img.src } : null;
}

export interface ICardOptions {
  /** The property the view groups by (not repeated on the card). */
  readonly omit?: readonly string[];
  /** Ctrl+Shift+Left/Right moves the card a group over. */
  readonly move?: (step: -1 | 1) => void;
  readonly draggable?: boolean;
  /** Extra drag data (the board's group key). */
  readonly dragData?: Readonly<Record<string, string>>;
}

/** A row as a card: preview, icon and title, then its visible properties. Click or Enter opens it. */
export function renderCard(container: HTMLElement, row: IDatabaseRow, state: IViewState, deps: IViewDeps, store: DisposableStore, opts: ICardOptions = {}): HTMLElement {
  const cfg = readViewConfig(state.view.config);
  const card = createBlock(container, 'div', { className: `canvas-db-card canvas-db-card--${cfg.cardSize}` });
  card.dataset.pageId = row.pageId;
  const preview = previewSrc(row, cfg, state.props);
  if (preview) {
    const box = createBlock(card, 'div', { className: 'canvas-db-card__preview' });
    const put = (src: string | null): void => { if (src) createBlock(box, 'img', { className: 'canvas-db-card__img', attrs: { src, alt: '', loading: 'lazy' } }); else box.classList.add('canvas-db-card__preview--empty'); };
    if (preview.kind === 'src') put(preview.src);
    else if (deps.pagePreview) void deps.pagePreview(row.pageId).then((src) => { if (box.isConnected) put(src); });
    else put(null);
  }
  const head = createBlock(card, 'div', { className: 'canvas-db-card__title' });
  const icon = deps.rowIcon(row.icon);
  if (icon) { icon.classList.add('canvas-db-card__icon'); head.appendChild(icon); }
  createBlock(head, 'span', { text: row.title || 'Untitled' });
  const omit = new Set(opts.omit ?? []);
  for (const p of visibleProperties(state.props, state.view)) {
    if (omit.has(p.id)) continue;
    const line = createBlock(null, 'div', { className: 'canvas-db-card__prop' });
    if (cfg.showPropertyNames) createBlock(line, 'span', { className: 'canvas-db-card__propname', text: p.name });
    const val = createBlock(line, 'span', { className: 'canvas-db-card__propvalue' });
    if (renderCellValue(val, p, row.values[p.id])) card.appendChild(line);
  }
  store.add(addDisposableListener(card, 'click', () => deps.openRow(row.pageId)));
  store.add(addDisposableListener(card, 'contextmenu', (e) => { e.preventDefault(); deps.openRowMenu(e, row); }));
  wireBoardCardKeys(card, {
    open: () => deps.openRow(row.pageId),
    menu: (x, y) => deps.openRowMenu(new MouseEvent('contextmenu', { clientX: x, clientY: y }), row),
    move: (step) => opts.move?.(step),
  });
  card.setAttribute('aria-label', row.title || 'Untitled');
  if (opts.draggable) {
    card.draggable = true;
    store.add(addDisposableListener(card, 'dragstart', (e) => {
      e.dataTransfer?.setData(ROW_DRAG_TYPE, row.pageId);
      for (const [k, v] of Object.entries(opts.dragData ?? {})) e.dataTransfer?.setData(k, v);
      card.classList.add('canvas-db-card--dragging');
    }));
    store.add(addDisposableListener(card, 'dragend', () => card.classList.remove('canvas-db-card--dragging')));
  }
  return card;
}

/** The "+ New" control a view ends with. */
export function renderNewRow(container: HTMLElement, deps: IViewDeps, seed?: Record<string, unknown>, className = 'canvas-db-newcard'): HTMLElement {
  const host = createBlock(container, 'div', { className });
  createButton(host, { id: 'database.newRowCell', label: 'New', icon: 'plus', kind: 'ghost', size: 'sm', command: 'database.addRow', args: [seed ?? {}] });
  void deps;
  return host;
}

/** A small round + for a group or a day. */
export function renderAddHere(container: HTMLElement, title: string, seed: Record<string, unknown>): HTMLButtonElement {
  return createIconButton(container, { id: null, icon: 'plus', title, size: 'sm', command: 'database.addRow', args: [seed] });
}

/** The words a group's heading shows for an empty key. */
export function noValueLabel(prop: IDatabaseProperty | null): string {
  return prop ? `No ${prop.name}` : 'No value';
}
