// link.ts — a link control for the kit: a URL, an email or a phone number
// shown as what it is. The external-links guard (externalLinks.ts) routes a
// `_blank` link to the browser; a mailto: or tel: goes to the system.
//
// And a link to a place (services/places.ts), with the one mark for "where
// you are" in a tool's column: Ctrl+click and its menu open the place in a
// tab of its own. The opener is installed once at boot, as the kit's command
// runner is, so this file knows no service and no tool.

import { declareControl, type IKitControlDeclaration } from './kit.js';
import { ContextMenu } from './contextMenu.js';
import type { IDisposable } from '../platform/lifecycle.js';

export interface IKitLinkOptions extends IKitControlDeclaration {
  readonly id: string | null;
  readonly href: string;
  readonly label: string;
  readonly title?: string;
  /** Extra class names on the anchor (a cell's link, a card's source). */
  readonly className?: string;
  /** Opens outside the app (the default): `target=_blank`, which the external-links guard routes to the browser. */
  readonly external?: boolean;
  readonly onClick?: (e: MouseEvent) => void;
}

/** A link. With an id it is in the scene as a button. */
export function createLink(container: HTMLElement | null | undefined, options: IKitLinkOptions): HTMLAnchorElement {
  const a = document.createElement('a');
  a.className = `px-link${options.className ? ` ${options.className}` : ''}`;
  a.href = options.href;
  a.textContent = options.label;
  if (options.title) a.title = options.title;
  if (options.external !== false) { a.target = '_blank'; a.rel = 'noopener'; }
  if (options.onClick) a.addEventListener('click', options.onClick);
  if (container) container.appendChild(a);
  if (options.id) declareControl(a, { id: options.id, label: options.label, kind: 'button' });
  return a;
}

/**
 * Make an element that is not an anchor (a crumb in a trail) a link: a
 * screen reader hears a link, Tab reaches it, Enter or a press runs `go`,
 * and with Ctrl (Cmd on a Mac) `go(true)`: open it in a tab of its own.
 */
export function bindLinkAction(element: HTMLElement, go: (newTab: boolean) => void): IDisposable {
  element.setAttribute('role', 'link');
  if (!element.hasAttribute('tabindex')) element.tabIndex = 0;
  const onClick = (e: MouseEvent) => { if (e.button === 0) go(e.ctrlKey || e.metaKey); };
  const onKey = (e: KeyboardEvent) => { if (e.key !== 'Enter') return; e.preventDefault(); go(e.ctrlKey || e.metaKey); };
  element.addEventListener('click', onClick);
  element.addEventListener('keydown', onKey);
  return { dispose: () => { element.removeEventListener('click', onClick); element.removeEventListener('keydown', onKey); } };
}

// ── Places ───────────────────────────────────────────────────────────────────

type PlaceOpener = (address: string, options: { readonly newTab: boolean }) => Promise<boolean>;
let _open: PlaceOpener | undefined;

const PLACE_ANCHOR = 'a[href^="parallx://place/"]';

/**
 * Called once at boot with the core's places, so a place link can open its
 * place. A plain press on a place's anchor (`<a href="parallx://place/...">`
 * in any surface) goes through the window's parallx:// link route; with Ctrl
 * it opens a tab of its own, and its menu offers Open in Its Own Tab.
 */
export function installPlaceOpener(open: PlaceOpener): void {
  const first = !_open;
  _open = open;
  if (!first) return;
  const placeAt = (target: EventTarget | null) => {
    const anchor = (target as Element | null)?.closest?.(PLACE_ANCHOR) as HTMLAnchorElement | null | undefined;
    const href = anchor?.getAttribute('href');
    return anchor && href ? { anchor, href } : undefined;
  };
  document.addEventListener('click', (e) => {
    if (e.defaultPrevented || e.button !== 0 || !(e.ctrlKey || e.metaKey) || e.shiftKey || e.altKey) return;
    const at = placeAt(e.target);
    if (!at) return;
    e.preventDefault();
    openPlace(at.href, true);
  });
  document.addEventListener('contextmenu', (e) => {
    const at = e.defaultPrevented ? undefined : placeAt(e.target);
    if (!at) return;
    e.preventDefault();
    const r = at.anchor.getBoundingClientRect();
    showPlaceLinkMenu(at.href, e.clientX || e.clientY ? { x: e.clientX, y: e.clientY } : { x: r.left, y: r.bottom });
  });
}

/** Open a place's address, in the tool's tab or a tab of its own. */
export function openPlace(address: string, newTab: boolean): void {
  if (!_open) { console.warn('[placeLink] no places yet; not opened:', address); return; }
  void _open(address, { newTab }).catch((err) => console.warn('[placeLink] could not open', address, err));
}

/**
 * The shared mark of the row (or link) for where you are: aria-current
 * "page" for a screen reader, and one class, `px-current`, for the eye.
 */
export function markCurrent(element: HTMLElement, current: boolean): void {
  if (current) element.setAttribute('aria-current', 'page');
  else element.removeAttribute('aria-current');
  element.classList.toggle('px-current', current);
}

/** Show the menu of a place link: Open, and Open in Its Own Tab. */
export function showPlaceLinkMenu(address: string, at: { readonly x: number; readonly y: number }): void {
  const menu = ContextMenu.show({
    items: [
      { id: 'open', label: 'Open', group: '1_open', order: 10 },
      { id: 'openInOwnTab', label: 'Open in Its Own Tab', keybinding: 'Ctrl+Click', group: '1_open', order: 20 },
    ],
    anchor: at,
  });
  menu.onDidSelect(({ item }) => openPlace(address, item.id === 'openInOwnTab'));
}

/**
 * Make an element a link to a place: a press with Ctrl (Cmd on a Mac) opens
 * the place in a tab of its own instead of what the element does, and its
 * context menu (right-click, Shift+F10, the menu key) offers Open and Open
 * in Its Own Tab. `address` is read each time, so a row can follow a change.
 * With `menu: false` the element keeps a context menu of its own (a row with
 * its own actions); only Ctrl+click is added.
 */
export function bindPlaceLink(element: HTMLElement, address: string | (() => string), options: { readonly menu?: boolean } = {}): IDisposable {
  const addressOf = () => (typeof address === 'function' ? address() : address);
  element.dataset.placeAddress = addressOf();
  const onClick = (e: MouseEvent) => {
    if (!(e.ctrlKey || e.metaKey) || e.button !== 0) return;
    e.preventDefault();
    e.stopImmediatePropagation();
    openPlace(addressOf(), true);
  };
  const onMenu = (e: MouseEvent) => {
    e.preventDefault();
    e.stopPropagation();
    const r = element.getBoundingClientRect();
    // A menu opened from the keyboard has no pointer position: put it at the element.
    const at = e.clientX || e.clientY ? { x: e.clientX, y: e.clientY } : { x: r.left + 8, y: r.bottom };
    showPlaceLinkMenu(addressOf(), at);
  };
  // Capture: it runs before the element's own press, which it replaces with Ctrl.
  element.addEventListener('click', onClick, true);
  const withMenu = options.menu !== false;
  if (withMenu) element.addEventListener('contextmenu', onMenu);
  return { dispose: () => { element.removeEventListener('click', onClick, true); if (withMenu) element.removeEventListener('contextmenu', onMenu); } };
}
