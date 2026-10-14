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
  for (const attr of ['data-tooltip', 'title', 'data-title', 'data-u-comp', 'data-command-id', 'data-id']) {
    const v = (el.getAttribute(attr) || '').trim();
    if (v) return humanise(v);
  }
  const icon = el.querySelector('[aria-label], [title], svg title');
  const iconName = (icon?.getAttribute?.('aria-label') || icon?.getAttribute?.('title') || icon?.textContent || '').trim();
  if (iconName) return humanise(iconName);
  const cls = Array.from(el.querySelectorAll('[class*="icon"]')).map((x) => String(x.getAttribute('class') || '')).join(' ');
  const m = /(?:^|\s)([a-z]+(?:-[a-z]+)*)-icon\b/i.exec(cls) || /univer-icon-([a-z-]+)/i.exec(cls);
  return m ? humanise(m[1]) : '';
}

/** 'sheet.command.set-range-bold' or 'BoldSingle' read as words: 'Set range bold', 'Bold single'. */
function humanise(raw: string): string {
  const last = raw.split('.').pop() || raw;
  const words = last.replace(/([a-z])([A-Z])/g, '$1 $2').replace(/[-_]+/g, ' ').trim().toLowerCase();
  return words ? words[0].toUpperCase() + words.slice(1) : '';
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
  container.appendChild(live);

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
      const n = engineControlName(el);
      if (n) el.setAttribute('aria-label', n);
      // Drawn as a div that takes clicks: a button to the keyboard and a screen reader.
      if (el.tagName === 'DIV' || el.tagName === 'SPAN') {
        if (!el.hasAttribute('tabindex')) el.tabIndex = 0;
        if (!el.hasAttribute('role')) el.setAttribute('role', 'button');
      }
    }
  };
  const observers = roots.map((root) => {
    name(root);
    let queued = false;
    const mo = new MutationObserver(() => { if (queued) return; queued = true; requestAnimationFrame(() => { queued = false; name(root); }); });
    mo.observe(root, { subtree: true, childList: true });
    return mo;
  });

  return {
    dispose: () => {
      clearTimeout(timer);
      sub.dispose();
      for (const mo of observers) mo.disconnect();
      live.remove();
    },
  };
}
