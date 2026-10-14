// univerA11y.ts — the spreadsheet for a person who cannot see it, and for the
// keyboard (docs/ACCESSIBILITY.md, section 9).
//
// The engine (Univer) draws its grid on a canvas: a screen reader finds no
// cells there, only the region. So the sheet speaks: as the selection moves,
// a polite live region says the cell, its formula and its value ("B7,
// =A1*2, 42"), the way a spreadsheet's own screen reader support reads a
// cell. The engine's own toolbar, tabs and menus are DOM it draws: a control
// it leaves without a name takes one from its tooltip, its icon's label or
// its title, and one it draws unreachable joins the Tab order, as the kit
// does for the app's own controls.

import type { IDisposable } from '../../platform/lifecycle.js';
import { sheetKeyHooks } from './univerKeyboard.js';

export interface ISheetCell {
  /** A1 address of the active cell, or null with no selection. */
  readonly cell: string | null;
  readonly value: string;
  readonly formula: string;
}

/** What a screen reader hears for a cell. */
export function describeCell(c: ISheetCell): string {
  if (!c.cell) return '';
  const parts = [c.cell];
  if (c.formula) parts.push(c.formula);
  parts.push(c.value === '' ? 'empty' : c.value);
  return parts.join(', ');
}

const CONTROL = 'button, [role="button"], [role="tab"], [role="menuitem"], [role="option"], [role="checkbox"], input, select, textarea';

/** A name for an engine control drawn without one: its tooltip, icon label or title. */
export function engineControlName(el: Element): string {
  const own = (el.getAttribute('aria-label') || '').trim();
  if (own) return own;
  const labelledBy = el.getAttribute('aria-labelledby');
  if (labelledBy && labelledBy.split(/\s+/).some((id) => (el.ownerDocument.getElementById(id)?.textContent || '').trim())) return '';
  const text = (el.textContent || '').trim();
  if (text) return '';
  // The engine's own parts: the name box, and a toolbar control by its command.
  const comp = el.closest('[data-u-comp]')?.getAttribute('data-u-comp');
  if (comp && COMP_NAMES[comp]) return COMP_NAMES[comp];
  const command = el.closest('[data-u-command]')?.getAttribute('data-u-command');
  if (command) return commandName(command);
  for (const attr of ['data-tooltip', 'title', 'data-title', 'data-command-id', 'data-id']) {
    const v = (el.getAttribute(attr) || '').trim();
    if (v) return humanise(v);
  }
  const icon = el.querySelector('[aria-label], [title], svg title');
  const iconName = (icon?.getAttribute?.('aria-label') || icon?.getAttribute?.('title') || icon?.textContent || '').trim();
  if (iconName) return humanise(iconName);
  const cls = Array.from(el.querySelectorAll('[class*="icon"]')).map((x) => String(x.getAttribute('class') || '')).join(' ');
  // The specific icon ('univerjs-icon-hamburger-icon'), never the engine's generic 'univerjs-icon'.
  const m = /univerjs-icon-([a-z0-9-]+?)-icon\b/i.exec(cls);
  return m ? humanise(m[1]) : '';
}

const COMP_NAMES: Record<string, string> = { 'defined-name': 'Cell reference' };
const ICON_NAMES: Record<string, string> = { fx: 'Insert function', dropdown: 'Expand formula bar' };

/** A toolbar command as a person names it: 'sheet.command.set-range-font-family' is 'Font family'. */
export function commandName(id: string): string {
  // 'sheet.command.numfmt.add.decimal.command' is 'Add decimal'; generic words carry no meaning.
  const parts = id.split('.').filter((p) => !/^(sheet|sheets|command|operation|ui|univer|doc|docs|mutation)$/i.test(p));
  const words = parts.slice(-2).join('-').replace(/^(set-range-|set-|toggle-)/, '').replace(/fontsize/i, 'font-size').replace(/numfmt-?/i, '');
  return humanise(words || id);
}

/** 'sheet.command.set-range-bold' or 'BoldSingle' read as words: 'Set range bold', 'Bold single'. */
function humanise(raw: string): string {
  const last = raw.split('.').pop() || raw;
  const words = last.replace(/([a-z])([A-Z])/g, '$1 $2').replace(/[-_]+/g, ' ').trim().toLowerCase();
  return words ? words[0].toUpperCase() + words.slice(1) : '';
}

/** The sheet's bottom row (its tabs, the add and list buttons, zoom): the largest wrapper of the tabs bar that holds no grid or formula bar. */
function bottomRow(bar: HTMLElement): HTMLElement {
  // Up from the tabs bar while the wrapper still holds no part of the grid or the formula bar.
  let row = bar;
  while (row.parentElement && !row.parentElement.matches('[data-u-comp="workbench-layout"]') && !row.parentElement.querySelector('[data-u-comp="formula-bar"], [data-u-comp="render-canvas"], canvas')) row = row.parentElement;
  return row;
}

/** The bottom row's icon buttons by what they do: the same icon adds a sheet beside the tabs and zooms in beside the zoom. */
function bottomName(el: HTMLElement, bar: HTMLElement): string | null {
  const icon = /univerjs-icon-([a-z0-9-]+?)-icon/.exec(el.querySelector('svg')?.getAttribute('class') || '')?.[1];
  const before = el.getBoundingClientRect().right <= bar.getBoundingClientRect().left;
  if (icon === 'increase') return before ? 'Add sheet' : 'Zoom in';
  if (icon === 'reduce') return 'Zoom out';
  if (icon === 'convert') return 'All sheets';
  if (icon && icon.includes('gridlines')) return 'Gridlines';
  if (!icon && /^\d+%$/.test((el.textContent || '').trim())) return `Zoom, ${(el.textContent || '').trim()}`;
  return null;
}

/** The control before or after `from` in the page's Tab order. */
function nextTabStop(from: HTMLElement, dir: 1 | -1, allowed: (el: HTMLElement) => boolean = () => true): HTMLElement | undefined {
  const stops = Array.from(from.ownerDocument.querySelectorAll<HTMLElement>('a[href], button, input, select, textarea, [tabindex]'))
    .filter((el) => el.tabIndex >= 0 && !(el as HTMLButtonElement).disabled && el.getClientRects().length > 0 && !el.closest('[hidden], [inert], [aria-hidden="true"]'));
  const at = stops.indexOf(from);
  if (at < 0) return undefined;
  for (let i = at + dir; i >= 0 && i < stops.length; i += dir) if (allowed(stops[i])) return stops[i];
  return undefined;
}

/**
 * Gives the sheet a voice and names the engine's controls. `read` reports the
 * active cell; `onSelection` calls back when the selection moves; `roots`
 * are where the engine draws (the sheet and its popup layer).
 */
export function installSheetAccess(
  container: HTMLElement,
  read: () => ISheetCell | null,
  onSelection: (cb: () => void) => { dispose(): void },
  roots: readonly HTMLElement[] = [container],
): IDisposable {
  const live = container.ownerDocument.createElement('div');
  live.className = 'px-visually-hidden';
  live.setAttribute('role', 'status');
  live.setAttribute('aria-live', 'polite');
  live.setAttribute('aria-atomic', 'true');
  // Beside the sheet, not in it: the engine renders into its container and would drop what we put there.
  (container.parentElement ?? container).appendChild(live);

  let timer = 0;
  let last = '';
  const speak = (): void => {
    clearTimeout(timer);
    timer = window.setTimeout(() => {
      const c = read();
      const said = c ? describeCell(c) : '';
      if (!said || said === last) return;
      last = said;
      live.textContent = said;
    }, 120);
  };
  const sub = onSelection(speak);

  const name = (scope: ParentNode): void => {
    for (const el of Array.from(scope.querySelectorAll<HTMLElement>(CONTROL))) {
      if (el === live || (!String(el.className).includes('univer') && !el.closest('[class*="univer-"]'))) continue; // only the engine's own
      const bar = container.querySelector<HTMLElement>('[data-u-comp="slide-tab-bar"]');
      const n = (bar && el.tagName === 'BUTTON' && bottomRow(bar).contains(el) ? bottomName(el, bar) : null) ?? engineControlName(el);
      if (n) el.setAttribute('aria-label', n);
      // Drawn as a div that takes clicks: a button to the keyboard and a screen reader.
      if (el.tagName === 'DIV' || el.tagName === 'SPAN') {
        if (!el.hasAttribute('tabindex')) el.tabIndex = 0;
        if (!el.hasAttribute('role')) el.setAttribute('role', 'button');
      }
    }
  };
  // The toolbar's split buttons and dropdown arrows are divs that take
  // clicks: buttons to the keyboard, named by their command. One the
  // engine drives as a dropdown trigger (data-state) answers Enter, Space
  // and ArrowDown itself once it can hold focus; a plain one gets a click.
  // The zoom slider's grips are pointer helpers: Ctrl+= and Ctrl+- zoom,
  // and the zoom button sits beside them.
  const pressable = (scope: ParentNode): void => {
    // A closed side panel slides off the edge but stays in the page: out of reach until it opens.
    for (const side of Array.from(scope.querySelectorAll<HTMLElement>('[data-u-comp="sidebar"]'))) {
      const closed = String(side.className).includes('univer-translate-x-full');
      side.inert = closed;
      if (closed) side.setAttribute('aria-hidden', 'true'); else side.removeAttribute('aria-hidden');
    }
    for (const el of Array.from(scope.querySelectorAll<HTMLElement>('.univer-toolbar-selector-root, .univer-toolbar-button-selector-main, .univer-toolbar-button-selector-trigger'))) {
      if (el.dataset.pxPressable) continue;
      el.dataset.pxPressable = '1';
      const command = el.closest('[data-u-command]')?.getAttribute('data-u-command') ?? el.querySelector('[data-u-command]')?.getAttribute('data-u-command') ?? '';
      const label = command ? commandName(command) : 'Toolbar control';
      el.tabIndex = 0;
      el.setAttribute('role', 'button');
      el.setAttribute('aria-label', String(el.className).includes('trigger') ? `${label} options` : label);
      if (!el.hasAttribute('data-state')) el.addEventListener('keydown', (e) => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); el.click(); } });
    }
    // A clickable icon the engine draws as a span or div (the formula bar's fx, its expand arrow): a named button.
    for (const el of Array.from(scope.querySelectorAll<HTMLElement>('span[class*="univer-cursor-pointer"], div[class*="univer-cursor-pointer"]'))) {
      const host = el.parentElement?.closest('button, a, [role="button"], [role="tab"], [role="menuitem"], [role="option"]');
      if (el.dataset.pxPressable || el.tabIndex >= 0 || host) continue; // already reachable, or part of something that is
      const icon = /univerjs-icon-([a-z0-9-]+?)-icon/.exec(el.querySelector('svg')?.getAttribute('class') || '')?.[1];
      if (!icon) continue;
      el.dataset.pxPressable = '1'; el.tabIndex = 0; el.setAttribute('role', 'button');
      el.setAttribute('aria-label', ICON_NAMES[icon] ?? humanise(icon));
      el.addEventListener('keydown', (e) => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); el.click(); } });
    }
    // The cell reference box's arrow: the list of named ranges.
    for (const el of Array.from(scope.querySelectorAll<HTMLElement>('[data-u-comp="defined-name"] a'))) { if (el.dataset.pxPressable) continue; el.dataset.pxPressable = '1'; el.tabIndex = 0; el.setAttribute('role', 'button'); el.setAttribute('aria-label', 'Named ranges'); if (!el.hasAttribute('data-state')) el.addEventListener('keydown', (e) => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); el.click(); } }); }
    for (const grip of Array.from(scope.querySelectorAll<HTMLElement>('button[role="handle"]'))) {
      for (const el of [grip, ...Array.from(grip.parentElement?.querySelectorAll<HTMLElement>('a[role="button"]') ?? [])]) { el.tabIndex = -1; el.setAttribute('aria-hidden', 'true'); }
    }
  };
  // The engine's popup menus (a sheet tab's Copy, Rename, Change color...)
  // are buttons in a section with no menu roles, focus left behind on the
  // opener: they become menus a keyboard and a screen reader can use.
  // The engine keeps its popup sections on the page and shows them when they
  // open, in a layer of its own outside the sheet: a section counts as opened
  // when its items show, and its opener is what had focus then.
  const openers = new WeakMap<HTMLElement, HTMLElement | null>();
  const menus = (scope: ParentNode): void => {
    const doc = (scope as Element).ownerDocument ?? container.ownerDocument;
    for (const pop of Array.from(doc.querySelectorAll<HTMLElement>('section[class*="univer-popup"]'))) {
      // Closed, the engine parks the section off-screen: out of reach of Tab and a screen reader until it opens.
      const box = pop.getBoundingClientRect();
      const onScreen = box.right > 0 && box.bottom > 0 && box.left < (doc.defaultView?.innerWidth ?? 1e9) && box.top < (doc.defaultView?.innerHeight ?? 1e9);
      const items = onScreen ? Array.from(pop.querySelectorAll<HTMLButtonElement>('button')).filter((b) => b.getClientRects().length) : [];
      const shown = items.length >= 2;
      if (!onScreen) { pop.setAttribute('aria-hidden', 'true'); pop.inert = true; } else { pop.removeAttribute('aria-hidden'); pop.inert = false; }
      if (!shown) { openers.delete(pop); continue; }
      if (openers.has(pop)) continue;
      const active = doc.activeElement as HTMLElement | null;
      const opener = active && active !== doc.body && !pop.contains(active) ? active : null;
      openers.set(pop, opener);
      pop.setAttribute('role', 'menu');
      pop.setAttribute('aria-label', ((opener?.getAttribute('aria-label') || opener?.textContent || '').trim().replace(/\s+/g, ' ').slice(0, 60)) || 'Menu');
      for (const b of items) { b.setAttribute('role', 'menuitem'); b.tabIndex = -1; }
      if (opener) requestAnimationFrame(() => items.find((b) => !b.disabled)?.focus()); // opened from the keyboard or a focused control: focus goes in (to the first item it can take)
      if (pop.dataset.pxMenu) continue;
      pop.dataset.pxMenu = '1';
      const back = (): void => { const o = openers.get(pop); if (o?.isConnected) o.focus(); };
      pop.addEventListener('keydown', (e) => {
        const list = Array.from(pop.querySelectorAll<HTMLButtonElement>('button')).filter((b) => b.getClientRects().length && !b.disabled);
        const at = list.indexOf(doc.activeElement as HTMLButtonElement);
        let to = -1;
        if (e.key === 'ArrowDown') to = (at + 1) % list.length;
        else if (e.key === 'ArrowUp') to = (at - 1 + list.length) % list.length;
        else if (e.key === 'Home') to = 0;
        else if (e.key === 'End') to = list.length - 1;
        else if (e.key === 'Escape' || e.key === 'Tab') {
          e.preventDefault(); e.stopPropagation();
          // Closed as a press outside closes it, then focus goes back where it was.
          doc.body.dispatchEvent(new PointerEvent('pointerdown', { bubbles: true, pointerType: 'mouse' }));
          doc.body.dispatchEvent(new MouseEvent('mousedown', { bubbles: true }));
          setTimeout(() => { back(); menus(container); }, 0);
          return;
        } else return;
        e.preventDefault(); e.stopPropagation();
        list[to]?.focus();
      });
      // A chosen item closes the menu: focus that falls to the page goes back to the opener.
      pop.addEventListener('focusout', (e) => { if (pop.contains(e.relatedTarget as Node | null)) return; setTimeout(() => { if (!doc.activeElement || doc.activeElement === doc.body) back(); menus(container); }, 0); });
    }
  };
  const observers = roots.map((root) => {
    pressable(root);
    menus(root);
    name(root);
    let queued = false;
    const mo = new MutationObserver(() => { if (queued) return; queued = true; requestAnimationFrame(() => { queued = false; name(root); pressable(root); menus(root); }); });
    mo.observe(root, { subtree: true, childList: true, attributes: true, attributeFilter: ['class'] });
    return mo;
  });

  // F6 from the grid goes to the sheet tabs below it (Tab moves between
  // cells, so nothing after the grid is reached by Tab); F6 there leaves
  // the sheet as before, and Shift+F6 goes back to the grid.
  let gridFocus: HTMLElement | null = null;
  const tabBar = (): HTMLElement | null => container.querySelector<HTMLElement>('[data-u-comp="slide-tab-bar"]');
  const onKey = (e: KeyboardEvent): void => {
    if (e.ctrlKey || e.altKey || e.metaKey) return;
    const bar = tabBar();
    const active = container.ownerDocument.activeElement as HTMLElement | null;
    if (!bar || !active || !container.contains(active)) return;
    const inBottom = bottomRow(bar).contains(active);
    if (e.key === 'Tab' || e.key === 'F6') container.ownerDocument.documentElement.dataset.inputModality = 'keyboard'; // before this handler moves focus
    // The engine, which still thinks the grid has focus, takes Tab as a cell move: move focus here instead, in the page's order.
    // In the bar below the grid, Tab steps through its own controls and then leaves the sheet (the engine's cell
    // editor, drawn later in the page, is not next); Shift+Tab from its first control goes back to the grid.
    if (inBottom && e.key === 'Tab') {
      e.preventDefault(); e.stopPropagation();
      const row = bottomRow(bar);
      const to = nextTabStop(active, e.shiftKey ? -1 : 1, (el) => row.contains(el) || !container.contains(el));
      if (e.shiftKey && (!to || !row.contains(to)) && gridFocus?.isConnected) gridFocus.focus();
      else to?.focus();
      return;
    }
    // A sheet tab's menu from the keyboard, as a right-click opens it.
    if (inBottom && active.getAttribute('role') === 'tab' && (e.key === 'ContextMenu' || (e.shiftKey && e.key === 'F10'))) {
      e.preventDefault(); e.stopPropagation();
      const r = active.getBoundingClientRect();
      // The whole of a right-click, as the engine listens for its parts.
      const at = { bubbles: true, cancelable: true, composed: true, button: 2, clientX: r.left + r.width / 2, clientY: r.top + r.height / 2 };
      active.dispatchEvent(new PointerEvent('pointerdown', { ...at, buttons: 2, pointerType: 'mouse', isPrimary: true }));
      active.dispatchEvent(new MouseEvent('mousedown', { ...at, buttons: 2 }));
      active.dispatchEvent(new PointerEvent('pointerup', { ...at, buttons: 0, pointerType: 'mouse', isPrimary: true }));
      active.dispatchEvent(new MouseEvent('mouseup', { ...at, buttons: 0 }));
      active.dispatchEvent(new MouseEvent('contextmenu', { ...at, buttons: 0 }));
      // The engine shows it after its own delay: look until it does (3 s at most), then focus goes in.
      const until = Date.now() + 3000;
      const look = (): void => { menus(container); const open = !!container.ownerDocument.activeElement?.closest('section[role="menu"]'); if (!open && Date.now() < until) setTimeout(look, 50); };
      setTimeout(look, 50);
      return;
    }
    if (inBottom && active.getAttribute('role') === 'tab' && (e.key === 'ArrowLeft' || e.key === 'ArrowRight' || e.key === 'Enter' || e.key === ' ')) {
      e.preventDefault(); e.stopPropagation();
      if (e.key === 'Enter' || e.key === ' ') { active.click(); return; }
      const tabs = Array.from(bar.querySelectorAll<HTMLElement>('[role="tab"]'));
      const i = tabs.indexOf(active);
      tabs[(i + (e.key === 'ArrowLeft' ? -1 : 1) + tabs.length) % tabs.length]?.focus();
      return;
    }
    // In the formula bar, Tab goes through its own controls (the cell reference, its list, insert function,
    // expand) before the grid: the engine's editor between them would otherwise take Tab as a cell move.
    const fbar = active.closest<HTMLElement>('[data-u-comp="formula-bar"]');
    if (fbar && e.key === 'Tab') {
      const own = nextTabStop(active, e.shiftKey ? -1 : 1, (el) => fbar.contains(el) && el.tagName !== 'CANVAS' && !el.isContentEditable && !el.closest('[contenteditable="true"]'));
      if (own) { e.preventDefault(); e.stopPropagation(); own.focus(); return; }
      // Past the formula bar's last control: into the grid, as a click on it does (the engine takes focus into the cell).
      const grid = !e.shiftKey ? Array.from(container.querySelectorAll<HTMLElement>('canvas')).find((c) => !c.closest('[data-u-comp="formula-bar"]') && !bottomRow(bar).contains(c) && c.getClientRects().length) : undefined;
      if (grid) { e.preventDefault(); e.stopPropagation(); grid.focus(); return; }
    }
    if (e.key !== 'F6') return;
    if (!e.shiftKey && !inBottom) {
      // The bottom row's first control (adding a sheet, the list), then its tabs and zoom.
      const row = bottomRow(bar);
      const tab = Array.from(row.querySelectorAll<HTMLElement>('button, [role="tab"], [tabindex]')).find((x) => x.tabIndex >= 0 && !(x as HTMLButtonElement).disabled && x.getClientRects().length > 0 && !x.closest('[inert], [aria-hidden="true"]'));
      if (!tab) return;
      gridFocus = active;
      e.preventDefault(); e.stopPropagation();
      tab.focus();
    } else if (e.shiftKey && inBottom && gridFocus?.isConnected) {
      e.preventDefault(); e.stopPropagation();
      gridFocus.focus();
    }
  };
  // On the window ahead of the engine (and of the workbench's own F6, on the document).
  const win = container.ownerDocument.defaultView ?? window;
  sheetKeyHooks.add(onKey);

  // The engine hands focus straight back to the grid when one of its own
  // buttons takes it (right for a click: typing stays in the cell). Reached
  // by the keyboard, a button keeps focus: its marker is lifted while it
  // holds focus, before the engine reads it, and put back after.
  const onFocusIn = (e: FocusEvent): void => {
    const t = e.target;
    if (!(t instanceof HTMLElement) || !container.contains(t) || t.ownerDocument.documentElement.dataset.inputModality !== 'keyboard') return;
    const comp = t.dataset.uComp;
    if (comp !== 'button' && comp !== 'sheet-bar-append-button') return;
    delete t.dataset.uComp;
    t.addEventListener('focusout', () => { t.dataset.uComp = comp; }, { once: true });
  };
  win.addEventListener('focusin', onFocusIn, true);

  // The formula bar's own editor is mounted at the very end of the page, so
  // Tab from the last control of the window landed in it (and Tab there
  // moves cells): arriving by Tab from outside the formula bar, focus goes
  // where it would have without it, the window's first control going
  // forward, the one before going back. Formulas stay editable in the cell.
  let lastTab: { at: number; back: boolean } | null = null;
  const onAnyKey = (e: KeyboardEvent): void => { if (e.key === 'Tab') lastTab = { at: Date.now(), back: e.shiftKey }; };
  const onFormulaFocus = (e: FocusEvent): void => {
    const t = e.target as HTMLElement | null;
    if (!t?.closest?.('[id^="univer-doc-selection-container-__INTERNAL_EDITOR__DOCS_FORMULA_BAR"], [id="__editor___INTERNAL_EDITOR__DOCS_FORMULA_BAR"]')) return;
    const from = e.relatedTarget as HTMLElement | null;
    if (!lastTab || Date.now() - lastTab.at > 200 || from?.closest?.('[data-u-comp="formula-bar"]')) return;
    const stops = Array.from(t.ownerDocument.querySelectorAll<HTMLElement>('a[href], button, input, select, textarea, [tabindex]'))
      .filter((el) => el.tabIndex >= 0 && !(el as HTMLButtonElement).disabled && el.getClientRects().length > 0 && !el.closest('[hidden], [inert], [aria-hidden="true"]') && !el.isContentEditable && el.tagName !== 'CANVAS');
    const to = lastTab.back ? (from ? stops[stops.indexOf(from) - 1] : stops[stops.length - 1]) ?? stops[stops.length - 1] : stops[0];
    to?.focus();
  };
  win.addEventListener('keydown', onAnyKey, true);
  win.addEventListener('focusin', onFormulaFocus, true);

  return {
    dispose: () => {
      sheetKeyHooks.delete(onKey);
      win.removeEventListener('focusin', onFocusIn, true);
      win.removeEventListener('keydown', onAnyKey, true);
      win.removeEventListener('focusin', onFormulaFocus, true);
      clearTimeout(timer);
      sub.dispose();
      for (const mo of observers) mo.disconnect();
      live.remove();
    },
  };
}
