// liveBlock.ts — what blocks that show live workspace data get from the app
//
// A page list, a child-page list, a planner agenda or a media gallery reads
// data that lives outside the page and changes while the page is open. The
// editor hands every such block one `LiveBlockServices` object (through the
// extension context in config/blockRegistry.ts): it can open a page, run an
// app command (other tools answer through their commands, so a block never
// imports another tool), and hear when workspace data changed so it can
// re-read. Blocks also share one settings popover, so they look alike.
//
// No canvas-internal imports: only the app's DOM helpers.

import { $, layoutPopup, attachPopupDismiss } from '../../../ui/dom.js';

export interface LiveBlockServices {
  /** Fires (debounced) after pages, database rows or other workspace data changed. */
  onDidChangeWorkspace(listener: () => void): { dispose(): void };
  /** Open a page in its editor (a database in the database editor). */
  openPage(pageId: string): void;
  /** Run an app command; other tools answer blocks through their commands. */
  executeCommand(id: string, ...args: unknown[]): Promise<unknown>;
  /** The page the editor shows. */
  readonly pageId?: string;
  /** The page tree, read live. */
  readonly pages?: LivePageReader;
  /** The user's databases (Button: Add Row). */
  readonly databases?: LiveDatabaseAccess;
}

export interface LiveDatabaseAccess {
  list(): Promise<LivePageSummary[]>;
  /** Add a row titled `title`; returns the new row page's id. */
  addRow(databaseId: string, title: string): Promise<string>;
}

export interface LivePageSummary {
  readonly id: string;
  readonly title: string;
  readonly icon: string | null;
}

export interface LivePageReader {
  /** Root first, not including the page itself. */
  getAncestors(pageId: string): Promise<LivePageSummary[]>;
  /** Live sub-pages in their sidebar order. */
  getChildren(pageId: string): Promise<LivePageSummary[]>;
  getPage(pageId: string): Promise<LivePageSummary | null>;
  /** Every live page, depth first (pickers). */
  listAll(): Promise<LivePageSummary[]>;
}

export interface LiveBlockOptions {
  live?: LiveBlockServices;
}

/** Re-run `refresh` whenever workspace data changes; returns the stop function. */
export function watchWorkspace(live: LiveBlockServices | undefined, refresh: () => void): () => void {
  if (!live) return () => {};
  const sub = live.onDidChangeWorkspace(refresh);
  return () => sub.dispose();
}

/** The one settings popover blocks open from their "Edit…" button. */
export function openBlockPopover(
  anchor: HTMLElement,
  title: string,
  build: (body: HTMLElement, close: () => void) => void,
  /** Where focus goes when the popover closes with focus inside it (the
   *  block, so the keyboard carries on from there; it was left on the body). */
  returnFocus?: () => void,
): () => void {
  const pop = $('div.canvas-live-popover');
  pop.setAttribute('role', 'dialog');
  pop.setAttribute('aria-label', title);
  const head = $('div.canvas-live-popover__title');
  head.textContent = title;
  pop.appendChild(head);
  const body = $('div.canvas-live-popover__body');
  pop.appendChild(body);
  document.body.appendChild(pop);
  let detach: (() => void) | null = null;
  const close = (): void => {
    const hadFocus = pop.contains(document.activeElement) || document.activeElement === document.body;
    detach?.();
    detach = null;
    pop.remove();
    if (hadFocus) returnFocus?.();
  };
  build(body, close);
  layoutPopup(pop, anchor.getBoundingClientRect(), { position: 'below', gap: 4 });
  // Keep it on screen when the button sits at the right edge of the block.
  const r = pop.getBoundingClientRect();
  if (r.right > window.innerWidth - 8) pop.style.left = `${Math.max(8, window.innerWidth - r.width - 8)}px`;
  detach = attachPopupDismiss(pop, close);
  pop.querySelector<HTMLElement>('input, select, button')?.focus();
  return close;
}

/** A labelled control row inside the popover. */
export function popoverRow(body: HTMLElement, label: string, control: HTMLElement): HTMLElement {
  const row = $('label.canvas-live-popover__row');
  const text = $('span.canvas-live-popover__label');
  text.textContent = label;
  row.append(text, control);
  body.appendChild(row);
  return row;
}

export function selectControl(options: readonly { value: string; label: string }[], value: string): HTMLSelectElement {
  const select = document.createElement('select');
  select.className = 'canvas-live-popover__select';
  for (const o of options) {
    const opt = document.createElement('option');
    opt.value = o.value;
    opt.textContent = o.label;
    select.appendChild(opt);
  }
  select.value = value;
  return select;
}

export function textControl(value: string, placeholder = ''): HTMLInputElement {
  const input = document.createElement('input');
  input.className = 'canvas-live-popover__input';
  input.value = value;
  input.placeholder = placeholder;
  return input;
}

/** The small "Edit…" button a live block shows on hover. */
export function blockEditButton(label: string): HTMLButtonElement {
  const btn = document.createElement('button');
  btn.type = 'button';
  btn.className = 'canvas-live-edit';
  btn.textContent = label;
  btn.addEventListener('mousedown', (e) => e.preventDefault());
  return btn;
}

/** Select a block and focus the editor (after its popover closes). */
export function focusBlock(editor: any, getPos: (() => number | undefined) | boolean): void {
  if (typeof getPos !== 'function' || editor.isDestroyed) return;
  const pos = getPos();
  if (typeof pos !== 'number') return;
  editor.chain().setNodeSelection(pos).focus().run();
}

/** Write new attributes onto a block from inside its node view. */
export function setBlockAttrs(editor: any, getPos: (() => number | undefined) | boolean, attrs: Record<string, unknown>): void {
  if (typeof getPos !== 'function') return;
  const pos = getPos();
  if (typeof pos !== 'number') return;
  const node = editor.state.doc.nodeAt(pos);
  if (!node) return;
  editor.view.dispatch(editor.state.tr.setNodeMarkup(pos, undefined, { ...node.attrs, ...attrs }));
}
