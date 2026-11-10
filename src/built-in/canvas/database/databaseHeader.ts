// databaseHeader.ts — a database's identity (docs/DATABASES.md step 2):
// cover, icon, title, description and the database menu (lock, CSV).
//
// The same pieces a page has, the same pickers: the icon picker the sidebar
// opens, the cover menu the page header opens. Title, icon and cover live on
// the pages row; description and lock on the databases row.
//
// Built with the kit and `createBlock`; no DOM by hand.

import type { DisposableStore } from '../../../platform/lifecycle.js';
import { createBlock, createButton, createIconButton, createMenu } from '../../../ui/kit.js';
import { addDisposableListener } from '../../../ui/dom.js';
import { onDragPress } from '../../../ui/touchDrag.js';
import { IconPicker } from '../../../ui/iconPicker.js';
import type { IExtensionMenuItem } from '../../../ui/contextMenu.js';
import { ALL_PAGE_SELECTABLE_ICONS, createIconElement, resolvePageIcon, svgIcon } from '../config/iconRegistry.js';
import { CoverMenuController } from '../menus/coverMenu.js';
import { CanvasMenuRegistry } from '../menus/canvasMenuRegistry.js';

const PAGE_ICON_RECENT_STORAGE_KEY = 'parallx.iconPicker.recent.pageIcon';

export interface IDatabaseIdentity {
  readonly title: string;
  readonly icon: string | null;
  readonly coverUrl: string | null;
  readonly coverYOffset: number;
  readonly description: string | null;
  readonly isLocked: boolean;
}

export interface IDatabaseHeaderDeps {
  /** Inside a page: the title opens the database and nothing here edits. */
  readonly embed: boolean;
  rename(title: string): void;
  setIcon(icon: string | null): void;
  setCover(url: string | null, yOffset?: number): void;
  setDescription(text: string): void;
  setLocked(locked: boolean): void;
  openDatabase(): void;
  /** Items the database menu shows after Lock (CSV export and import). */
  menuItems(): IExtensionMenuItem[];
}

/** Render the header into `root`. Returns the element after which the view tabs go. */
export function renderDatabaseHeader(root: HTMLElement, info: IDatabaseIdentity, deps: IDatabaseHeaderDeps, store: DisposableStore): HTMLElement {
  const wrap = createBlock(root, 'div', { className: 'canvas-db-identity' });
  if (info.coverUrl && !deps.embed) renderCover(wrap, info, deps, store);

  const header = createBlock(wrap, 'div', { className: `canvas-db-header${info.coverUrl && !deps.embed ? ' canvas-db-header--covered' : ''}` });
  const iconId = info.icon ? resolvePageIcon(info.icon) : '';
  if (deps.embed || info.isLocked) {
    const iconEl = createBlock(header, 'span', { className: 'canvas-db-header__icon' });
    iconEl.appendChild(createIconElement(iconId || 'table', deps.embed ? 18 : 28));
  } else {
    const iconBtn = createIconButton(header, { id: 'database.icon', icon: iconId || 'table', title: info.icon ? 'Change Icon…' : 'Add Icon…', onClick: () => openIconPicker(iconBtn, info, deps) });
    iconBtn.classList.add('canvas-db-header__icon', 'canvas-db-header__iconbtn');
    if (!info.icon) iconBtn.classList.add('canvas-db-header__iconbtn--empty');
  }

  if (deps.embed) {
    createButton(header, { id: 'database.openFromEmbed', label: info.title, kind: 'ghost', icon: 'external-link', title: 'Open the database', onClick: () => deps.openDatabase() })
      .classList.add('canvas-db-header__title', 'canvas-db-header__open');
    return wrap;
  }

  const titleEl = createBlock(header, 'div', { className: 'canvas-db-header__title', text: info.title, attrs: { role: 'textbox', 'aria-label': 'Database title', 'aria-multiline': 'false' } });
  if (!info.isLocked) {
    titleEl.contentEditable = 'true';
    titleEl.spellcheck = false;
    titleEl.tabIndex = 0;
    store.add(addDisposableListener(titleEl, 'blur', () => {
      const next = (titleEl.textContent ?? '').trim() || 'Untitled';
      if (next !== info.title) deps.rename(next);
    }));
    store.add(addDisposableListener(titleEl, 'keydown', (e) => { if (e.key === 'Enter') { e.preventDefault(); titleEl.blur(); } }));
  } else {
    titleEl.setAttribute('aria-readonly', 'true');
  }

  const menuBtn = createIconButton(header, { id: 'database.menu', icon: 'more-horizontal', title: 'Database Menu…', size: 'sm', onClick: () => openDatabaseMenu(menuBtn, info, deps) });
  menuBtn.classList.add('canvas-db-header__menu');

  // Description: a quiet line under the title; empty, it is an affordance.
  if (info.description || !info.isLocked) {
    const desc = createBlock(wrap, 'div', { className: `canvas-db-description${info.description ? '' : ' canvas-db-description--empty'}`, text: info.description ?? '', attrs: { role: 'textbox', 'aria-label': 'Database description', 'aria-multiline': 'true', 'data-placeholder': 'Add a description' } });
    if (!info.isLocked) {
      desc.contentEditable = 'true';
      desc.spellcheck = true;
      desc.tabIndex = 0;
      store.add(addDisposableListener(desc, 'blur', () => {
        const next = (desc.textContent ?? '').trim();
        if (next !== (info.description ?? '')) deps.setDescription(next);
      }));
      store.add(addDisposableListener(desc, 'keydown', (e) => { if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); desc.blur(); } }));
    } else {
      desc.setAttribute('aria-readonly', 'true');
    }
  }

  // Affordances: what the database does not have yet (shown on hover, focus or touch).
  if (!info.isLocked && (!info.icon || !info.coverUrl)) {
    const row = createBlock(wrap, 'div', { className: 'canvas-db-affordances' });
    if (!info.icon) createButton(row, { id: 'database.addIcon', label: 'Add Icon', icon: 'smile', kind: 'ghost', size: 'sm', onClick: (e) => openIconPicker(e.currentTarget as HTMLElement, info, deps) });
    if (!info.coverUrl) createButton(row, { id: 'database.addCover', label: 'Add Cover', icon: 'image', kind: 'ghost', size: 'sm', onClick: (e) => openCoverPicker(e.currentTarget as HTMLElement, root, null, deps, store) });
  }
  return wrap;
}

function openIconPicker(anchor: HTMLElement, info: IDatabaseIdentity, deps: IDatabaseHeaderDeps): void {
  const picker = new IconPicker(document.body, {
    anchor,
    icons: ALL_PAGE_SELECTABLE_ICONS,
    renderIcon: (iconId) => svgIcon(iconId),
    showSearch: true,
    showRemove: !!info.icon,
    iconSize: 20,
    recentStorageKey: PAGE_ICON_RECENT_STORAGE_KEY,
  });
  picker.onDidSelectIcon((iconId) => deps.setIcon(iconId));
  picker.onDidRemoveIcon(() => deps.setIcon(null));
}

/** The page header's cover menu, on a registry of its own (the pane has no page editor); one per header, made on first use, gone with it. */
const coverMenus = new WeakMap<DisposableStore, CoverMenuController>();
function openCoverPicker(anchor: HTMLElement | null, root: HTMLElement, coverEl: HTMLElement | null, deps: IDatabaseHeaderDeps, store: DisposableStore): void {
  let cover = coverMenus.get(store);
  if (!cover) {
    const registry = new CanvasMenuRegistry(() => null);
    const made = new CoverMenuController({ container: document.body }, registry);
    made.create();
    cover = made;
    coverMenus.set(store, made);
    store.add({ dispose: () => { made.hide(); made.dispose(); registry.dispose(); coverMenus.delete(store); } });
    // Escape closes it, as it closes every popup.
    store.add(addDisposableListener(document, 'keydown', (e) => { if (e.key === 'Escape' && made.visible) { e.stopPropagation(); made.hide(); } }, true));
  }
  cover.show({ anchor, editorContainer: root, coverEl, pageHeader: root.querySelector<HTMLElement>('.canvas-db-header'), onSelectCover: (url) => { cover!.hide(); deps.setCover(url); } });
}

function openDatabaseMenu(anchor: HTMLElement, info: IDatabaseIdentity, deps: IDatabaseHeaderDeps): void {
  const items: IExtensionMenuItem[] = [];
  if (!info.isLocked) {
    items.push({ label: info.icon ? 'Change Icon…' : 'Add Icon…', icon: 'smile', onSelect: () => openIconPicker(anchor, info, deps) });
    if (info.icon) items.push({ label: 'Remove Icon', icon: 'x', onSelect: () => deps.setIcon(null) });
    if (info.coverUrl) items.push({ label: 'Remove Cover', icon: 'image', onSelect: () => deps.setCover(null) });
    items.push({ separator: true });
  }
  items.push({ label: info.isLocked ? 'Unlock Database' : 'Lock Database', icon: info.isLocked ? 'lock-open' : 'lock', tooltip: 'Locked, its columns, views, title and description cannot be changed; rows still can.', onSelect: () => deps.setLocked(!info.isLocked) });
  const more = deps.menuItems();
  if (more.length) items.push({ separator: true }, ...more);
  createMenu(anchor, { id: null, label: 'Database', items });
}

/** The cover above the header: the image at its offset, and on hover Change, Reposition and Remove. */
function renderCover(wrap: HTMLElement, info: IDatabaseIdentity, deps: IDatabaseHeaderDeps, store: DisposableStore): void {
  const cover = createBlock(wrap, 'div', { className: 'canvas-page-cover canvas-db-cover', attrs: { role: 'img', 'aria-label': 'Cover' } });
  const url = info.coverUrl!;
  const isGradient = /^(linear|radial)-gradient\(/.test(url);
  const apply = (offset: number): void => {
    if (isGradient) { cover.style.backgroundImage = url; return; }
    cover.style.backgroundImage = `url("${url.replace(/"/g, '%22')}")`;
    cover.style.backgroundPosition = `center ${(offset * 100).toFixed(1)}%`;
    cover.style.backgroundSize = 'cover';
  };
  apply(info.coverYOffset);
  if (info.isLocked) return;

  const controls = createBlock(cover, 'div', { className: 'canvas-cover-controls' });
  let repositioning = false;
  const changeBtn = createButton(controls, { id: 'database.cover.change', label: 'Change Cover…', icon: 'image', size: 'sm', onClick: () => openCoverPicker(changeBtn, wrap, cover, deps, store) });
  changeBtn.classList.add('canvas-cover-btn');
  if (!isGradient) {
    const repositionBtn = createButton(controls, { id: 'database.cover.reposition', label: 'Reposition', icon: 'move', size: 'sm', onClick: () => startReposition() });
    repositionBtn.classList.add('canvas-cover-btn');
    const startReposition = (): void => {
      if (repositioning) return;
      repositioning = true;
      let offset = info.coverYOffset;
      cover.classList.add('canvas-cover--repositioning');
      controls.style.display = 'none';
      const overlay = createBlock(cover, 'div', { className: 'canvas-cover-reposition-overlay', text: 'Drag the image, or use the arrow keys, to reposition' });
      overlay.tabIndex = 0;
      const actions = createBlock(cover, 'div', { className: 'canvas-cover-reposition-actions' });
      const finish = (save: boolean): void => {
        repositioning = false;
        cover.classList.remove('canvas-cover--repositioning');
        overlay.remove(); actions.remove();
        controls.style.display = '';
        if (save) deps.setCover(url, offset); else apply(info.coverYOffset);
      };
      const setOffset = (next: number): void => { offset = Math.max(0, Math.min(1, next)); apply(offset); };
      createButton(actions, { id: 'database.cover.cancelReposition', label: 'Cancel', kind: 'ghost', size: 'sm', onClick: () => finish(false) }).classList.add('canvas-cover-btn');
      createButton(actions, { id: 'database.cover.saveReposition', label: 'Save Position', icon: 'check', size: 'sm', kind: 'primary', onClick: () => finish(true) }).classList.add('canvas-cover-btn', 'canvas-cover-btn--primary');
      store.add(addDisposableListener(overlay, 'keydown', (e) => {
        if (e.key === 'ArrowUp') { e.preventDefault(); setOffset(offset - 0.02); }
        else if (e.key === 'ArrowDown') { e.preventDefault(); setOffset(offset + 0.02); }
        else if (e.key === 'Escape') { e.preventDefault(); finish(false); }
        else if (e.key === 'Enter') { e.preventDefault(); finish(true); }
      }));
      store.add(onDragPress(overlay, (e) => {
        e.preventDefault();
        const startY = e.clientY, startOffset = offset, height = cover.offsetHeight || 280;
        const onMove = (ev: MouseEvent): void => setOffset(startOffset + (startY - ev.clientY) / height);
        const onUp = (): void => { document.removeEventListener('mousemove', onMove); document.removeEventListener('mouseup', onUp); };
        document.addEventListener('mousemove', onMove);
        document.addEventListener('mouseup', onUp);
      }));
      overlay.focus();
    };
  }
  createButton(controls, { id: 'database.cover.remove', label: 'Remove', icon: 'x', size: 'sm', onClick: () => deps.setCover(null) }).classList.add('canvas-cover-btn');
}
