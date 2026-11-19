// quickPickMany.ts — the quick pick of several (`showQuickPick` with canPickMany)
//
// Each row a checkbox (role option, aria-selected), a search that finds every
// word typed in the label (and the description and detail with
// `matchOnDescription`), and the dialog's own buttons, Cancel and the
// confirming one (`confirmLabel`, "OK" when none is given), which run the
// core commands quickPick.cancel and quickPick.accept on the pick in front.
// The search field, the list, Cancel and the confirming button are the Tab
// stops, and Tab stays among them. In the list the arrows move and Space ticks
// the row; a click ticks it too. Enter confirms from anywhere; Escape
// cancels, and the focus goes back where it was. What is ticked stays ticked
// while the search changes. Built from the kit only.

import { addDisposableListener, keepTabInside } from '../ui/dom.js';
import { createBlock, createButton, createInput, createList, createSurface } from '../ui/kit.js';
import { createIconElement } from '../ui/iconRegistry.js';
import type { IDisposable } from '../platform/lifecycle.js';

/** How many rows are drawn at once; the rest wait for the search to narrow them. */
const ROWS_DRAWN = 200;

type Item = { label: string; description?: string; detail?: string; picked?: boolean };

/** The picks open now, the last in front: what quickPick.accept and quickPick.cancel act on. */
const _open: { accept(): void; cancel(): void }[] = [];

/** quickPick.accept: confirm the pick of several in front with what is ticked. */
export function acceptQuickPickMany(): void { _open[_open.length - 1]?.accept(); }
/** quickPick.cancel: close the pick of several in front with nothing chosen. */
export function cancelQuickPickMany(): void { _open[_open.length - 1]?.cancel(); }

const fold = (text: string | undefined): string => String(text ?? '').normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase();

let _seq = 0;

export function showQuickPickMany<T extends Item>(
  parent: HTMLElement,
  items: readonly T[],
  options: { placeholder?: string; matchOnDescription?: boolean; confirmLabel?: string },
): Promise<T[] | undefined> {
  return new Promise((resolve) => {
    const seq = ++_seq;
    const label = options.placeholder ?? 'Select items';
    const returnFocus = document.activeElement instanceof HTMLElement && document.activeElement !== document.body ? document.activeElement : null;
    const overlay = createBlock(parent, 'div', { className: 'parallx-modal-overlay' });
    const box = createBlock(null, 'div', { className: 'parallx-quickpick-box parallx-quickpick-box--many', attrs: { role: 'dialog', 'aria-modal': 'true', 'aria-label': label } });
    createSurface(box, { id: 'quickPick', owner: 'core', label, instance: `many-${seq}` });

    const field = createInput(box, { id: 'quickPick.filter', label, placeholder: label });
    field.element.classList.add('parallx-quickpick-field');
    const input = (field.element.querySelector('input') ?? field.element) as HTMLInputElement;

    const list = createBlock(box, 'div', { className: 'parallx-quickpick-list', attrs: { 'aria-multiselectable': 'true', tabindex: '0', id: `quick-pick-many-${seq}` } });
    const more = createBlock(box, 'div', { className: 'parallx-quickpick-more' });
    const picked = new Set<number>(items.map((it, i) => (it.picked ? i : -1)).filter((i) => i >= 0));
    let active = 0;
    const rowsOf = () => Array.from(list.querySelectorAll<HTMLElement>('[data-index]'));
    const listDecl = createList(list, { id: 'quickPick.list', label, rows: rowsOf, selected: () => [...picked].map(String) });

    const footer = createBlock(box, 'div', { className: 'parallx-quickpick-footer' });
    const count = createBlock(footer, 'span', { className: 'parallx-quickpick-count', attrs: { 'aria-live': 'polite' } });
    createButton(footer, { id: 'quickPick.cancel', label: 'Cancel', kind: 'secondary', command: 'quickPick.cancel' });
    const okBtn = createButton(footer, { id: 'quickPick.confirm', label: options.confirmLabel || 'OK', icon: 'check', kind: 'primary', command: 'quickPick.accept' });

    const say = () => {
      count.textContent = picked.size ? `${picked.size} chosen` : '';
      okBtn.disabled = picked.size === 0;
    };
    const paintRow = (row: HTMLElement) => {
      const on = picked.has(Number(row.dataset.index));
      row.setAttribute('aria-selected', String(on));
      row.classList.toggle('parallx-quickpick-row--picked', on);
      const check = row.querySelector<HTMLElement>('.parallx-quickpick-check');
      if (check) check.replaceChildren(...(on ? [createIconElement('check', 12)] : []));
    };
    const highlight = (at: number, scroll = true) => {
      const rows = rowsOf();
      if (!rows.length) { list.removeAttribute('aria-activedescendant'); return; }
      active = Math.max(0, Math.min(at, rows.length - 1));
      rows.forEach((r, i) => r.classList.toggle('parallx-quickpick-row--active', i === active));
      list.setAttribute('aria-activedescendant', rows[active]!.id);
      if (scroll) rows[active]!.scrollIntoView?.({ block: 'nearest' });
    };
    const toggle = (i: number) => {
      if (picked.has(i)) picked.delete(i); else picked.add(i);
      const row = list.querySelector<HTMLElement>(`[data-index="${i}"]`);
      if (row) paintRow(row);
      say();
    };

    const render = () => {
      const words = fold(input.value).split(/\s+/).filter(Boolean);
      const hay = (it: Item) => fold([it.label, ...(options.matchOnDescription ? [it.description, it.detail] : [])].filter(Boolean).join(' '));
      const shown: number[] = [];
      items.forEach((it, i) => { if (!words.length || words.every((w) => hay(it).includes(w))) shown.push(i); });
      list.replaceChildren();
      for (const i of shown.slice(0, ROWS_DRAWN)) {
        const it = items[i]!;
        const row = createBlock(list, 'div', { className: 'parallx-quickpick-row parallx-quickpick-row--many', attrs: { role: 'option', id: `${list.id}-${i}`, 'data-index': String(i) } });
        createBlock(row, 'span', { className: 'parallx-quickpick-check', attrs: { 'aria-hidden': 'true' } });
        const text = createBlock(row, 'span', { className: 'parallx-quickpick-text' });
        createBlock(text, 'span', { className: 'parallx-quickpick-label', text: it.label });
        if (it.description) createBlock(text, 'span', { className: 'parallx-quickpick-desc', text: it.description });
        if (it.detail) createBlock(text, 'span', { className: 'parallx-quickpick-desc parallx-quickpick-detail', text: it.detail });
        paintRow(row);
      }
      const rest = shown.length - Math.min(shown.length, ROWS_DRAWN);
      more.textContent = !shown.length ? (words.length ? 'Nothing matches.' : 'Nothing to choose.') : rest > 0 ? `${rest} more. Type to narrow the list.` : '';
      more.hidden = !more.textContent;
      highlight(0, false);
    };

    const subs: IDisposable[] = [];
    let done = false;
    const close = (result: T[] | undefined) => {
      if (done) return;
      done = true;
      const at = _open.indexOf(handle);
      if (at >= 0) _open.splice(at, 1);
      for (const d of subs) d.dispose();
      listDecl.dispose();
      field.dispose();
      overlay.remove();
      if (returnFocus?.isConnected) returnFocus.focus();
      resolve(result);
    };
    const handle = {
      accept: () => {
        if (picked.size) { close(items.filter((_, i) => picked.has(i))); return; }
        // Enter with nothing ticked: say why nothing happened, in the live count.
        count.textContent = 'Nothing is ticked yet.';
      },
      cancel: () => close(undefined),
    };
    _open.push(handle);

    subs.push(addDisposableListener(input, 'input', render));
    // A row ticks where it is pressed: one listener for the list, whatever rows it draws.
    subs.push(addDisposableListener(list, 'click', (e) => {
      const row = (e.target as HTMLElement | null)?.closest?.<HTMLElement>('[data-index]');
      if (!row) return;
      toggle(Number(row.dataset.index));
      highlight(rowsOf().indexOf(row), false);
    }));
    subs.push(addDisposableListener(box, 'keydown', (e) => {
      const onButton = (e.target as HTMLElement | null)?.tagName === 'BUTTON';
      if (e.key === 'Escape') { e.preventDefault(); e.stopPropagation(); handle.cancel(); return; }
      if (e.key === 'Enter' && !onButton) { e.preventDefault(); handle.accept(); return; }
      const inList = e.target === list;
      if (e.key === 'ArrowDown' && (e.target === input || inList)) { e.preventDefault(); if (e.target === input) { list.focus(); highlight(0); } else highlight(active + 1); return; }
      if (e.key === 'ArrowUp' && inList) { e.preventDefault(); if (active === 0) input.focus(); else highlight(active - 1); return; }
      if (inList && (e.key === 'Home' || e.key === 'End')) { e.preventDefault(); highlight(e.key === 'Home' ? 0 : rowsOf().length - 1); return; }
      if (inList && e.key === ' ') { e.preventDefault(); const row = rowsOf()[active]; if (row) toggle(Number(row.dataset.index)); return; }
      // A letter typed in the list goes on the search.
      if (inList && e.key.length === 1 && !e.ctrlKey && !e.metaKey && !e.altKey) input.focus();
    }));
    subs.push(keepTabInside(box));
    // A modal: a key pressed while the focus is somewhere behind it (it fell to the page) brings the focus back, and Escape still closes it.
    subs.push(addDisposableListener(document, 'keydown', (e) => {
      if (box.contains(document.activeElement) || _open[_open.length - 1] !== handle) return;
      if (e.key === 'Escape') { e.preventDefault(); e.stopPropagation(); handle.cancel(); return; }
      input.focus();
    }));
    subs.push(addDisposableListener(overlay, 'click', (e) => { if (e.target === overlay) handle.cancel(); }));

    overlay.appendChild(box);
    render();
    say();
    input.focus();
  });
}
