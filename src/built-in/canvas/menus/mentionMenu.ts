// mentionMenu.ts — "@" page picker: link to another page while typing
//
// Typing "@" after a space (or at the start of a line) opens a list of pages
// filtered by what follows.  Choosing one replaces "@query" with the page's
// title as an in-app link (`parallx-page:<id>`), the same link a click opens
// here, Markdown export keeps and the backlinks list finds.

import type { Editor } from '@tiptap/core';
import { $, layoutPopup } from '../../../ui/dom.js';
import { svgIcon, resolvePageIcon } from './canvasMenuRegistry.js';
import type { ICanvasMenu, CanvasMenuRegistry, InsertActionBaseContext } from './canvasMenuRegistry.js';
import type { IDisposable } from '../../../platform/lifecycle.js';
import { pageLinkHref } from '../pageLinks.js';

export interface MentionMenuHost {
  readonly editor: Editor | null;
  readonly dataService?: InsertActionBaseContext['dataService'];
  readonly pageId?: string;
  requestSave(reason: string): void;
}

export interface MentionCandidate {
  readonly id: string;
  readonly title: string;
  readonly icon: string | null;
  /** Ancestor titles, root first, shown as a quiet path. */
  readonly path: string;
}

const MAX_RESULTS = 8;

/** The "@query" just before the caret, or null.  "@" must start the line or
 *  follow a space or bracket (so an e-mail address does not open it). */
export function findMentionQuery(textBefore: string): { query: string; length: number } | null {
  const m = /(?:^|[\s([{"'])@([^@\n￼]{0,40})$/.exec(textBefore);
  if (!m) return null;
  const query = m[1]!;
  // Two spaces, or a space right after "@", end the search.
  if (/^\s|\s\s/.test(query)) return null;
  return { query, length: query.length + 1 };
}

/** Pages whose title has the query, title-starts first, at most eight. */
export function rankMentionCandidates(pages: readonly MentionCandidate[], query: string, excludeId?: string): MentionCandidate[] {
  const q = query.trim().toLowerCase();
  const pool = pages.filter((p) => p.id !== excludeId);
  if (!q) return pool.slice(0, MAX_RESULTS);
  const starts: MentionCandidate[] = [];
  const contains: MentionCandidate[] = [];
  for (const p of pool) {
    const t = (p.title || 'Untitled').toLowerCase();
    if (t.startsWith(q)) starts.push(p);
    else if (t.includes(q)) contains.push(p);
  }
  return [...starts, ...contains].slice(0, MAX_RESULTS);
}

interface TreeLike { id: string; title: string; icon: string | null; children: readonly TreeLike[] }

function flatten(nodes: readonly TreeLike[], path: string[] = [], out: MentionCandidate[] = []): MentionCandidate[] {
  for (const n of nodes) {
    out.push({ id: n.id, title: n.title || 'Untitled', icon: n.icon, path: path.join(' / ') });
    flatten(n.children, [...path, n.title || 'Untitled'], out);
  }
  return out;
}

export class MentionMenuController implements ICanvasMenu {
  readonly id = 'mention-menu';
  private _menu: HTMLElement | null = null;
  private _visible = false;
  private _query = '';
  private _range: { from: number; to: number } | null = null;
  private _selectedIndex = 0;
  /** Where the "@" was when Esc closed the list (it stays closed there). */
  private _dismissedAt: number | null = null;
  private _pages: MentionCandidate[] | null = null;
  private _loading: Promise<void> | null = null;
  private _registration: IDisposable | null = null;

  constructor(
    private readonly _host: MentionMenuHost,
    private readonly _registry: CanvasMenuRegistry,
  ) {}

  get visible(): boolean { return this._visible; }

  containsTarget(target: Node): boolean {
    return this._menu?.contains(target) ?? false;
  }

  create(): void {
    this._menu = $('div.canvas-slash-menu.canvas-mention-menu');
    this._menu.style.display = 'none';
    this._menu.setAttribute('role', 'listbox');
    document.body.appendChild(this._menu);
    this._registration = this._registry.register(this);
  }

  onTransaction(editor: Editor): void {
    if (this._registry.isInteractionLocked() || !this._host.dataService) { this.hide(); return; }
    const { state } = editor;
    if (!state.selection.empty) { this.hide(); return; }
    const { $from } = state.selection;
    if (!$from.parent.isTextblock || $from.parent.type.spec.code) { this.hide(); return; }
    const before = $from.parent.textBetween(Math.max(0, $from.parentOffset - 48), $from.parentOffset, undefined, '￼');
    const found = findMentionQuery(before);
    if (!found) { this._dismissedAt = null; this.hide(); return; }
    const from = $from.pos - found.length;
    if (this._dismissedAt === from) { this.hide(); return; }
    // Text already inside a link is left alone.
    const link = state.schema.marks.link;
    if (link && state.doc.rangeHasMark(from, $from.pos, link)) { this.hide(); return; }
    if (this._range?.from !== from) this._selectedIndex = 0;
    this._range = { from, to: $from.pos };
    this._query = found.query;
    void this._show(editor);
  }

  private async _show(editor: Editor): Promise<void> {
    if (!this._menu) return;
    if (!this._visible) {
      // Read the pages once per opening (a page made meanwhile shows next time).
      this._pages = null;
      this._loading = this._loadPages();
      this._visible = true;
      this._registry.notifyShow(this.id);
      editor.view.dom.addEventListener('keydown', this._handleKeydown, true);
      window.addEventListener('scroll', this._onScroll, true);
    }
    if (!this._pages) await this._loading;
    if (!this._visible) return;
    this._render(editor);
  }

  private async _loadPages(): Promise<void> {
    try {
      const tree = await this._host.dataService!.getPageTree();
      this._pages = flatten(tree as unknown as TreeLike[]);
    } catch {
      this._pages = [];
    }
  }

  private _results(): MentionCandidate[] {
    return rankMentionCandidates(this._pages ?? [], this._query, this._host.pageId);
  }

  private _place(editor: Editor): void {
    if (!this._menu || !this._range) return;
    const coords = editor.view.coordsAtPos(this._range.from);
    layoutPopup(this._menu, { x: coords.left, y: coords.bottom }, { gap: 4 });
  }

  private readonly _onScroll = (e: Event): void => {
    const editor = this._host.editor;
    if (!this._visible || !editor) return;
    if (e.target instanceof Node && this._menu?.contains(e.target)) return;
    this._place(editor);
  };

  private _render(editor: Editor): void {
    const menu = this._menu;
    if (!menu) return;
    const results = this._results();
    menu.innerHTML = '';
    const label = $('div.canvas-slash-group');
    label.textContent = 'Link to page';
    menu.appendChild(label);
    if (results.length === 0) {
      const empty = $('div.canvas-mention-empty');
      empty.textContent = this._query ? `No pages match "${this._query}"` : 'No other pages yet';
      menu.appendChild(empty);
    }
    if (this._selectedIndex >= results.length) this._selectedIndex = Math.max(0, results.length - 1);
    results.forEach((page, index) => {
      const row = $('div.canvas-slash-item.canvas-mention-item');
      row.setAttribute('role', 'option');
      if (index === this._selectedIndex) {
        row.classList.add('canvas-slash-item--selected');
        row.setAttribute('aria-selected', 'true');
      }
      const icon = $('span.canvas-slash-icon');
      icon.innerHTML = svgIcon(resolvePageIcon(page.icon));
      const svg = icon.querySelector('svg');
      if (svg) { svg.setAttribute('width', '16'); svg.setAttribute('height', '16'); }
      row.appendChild(icon);
      const text = $('span.canvas-slash-label');
      text.textContent = page.title;
      row.appendChild(text);
      if (page.path) {
        const path = $('span.canvas-mention-path');
        path.textContent = page.path;
        row.appendChild(path);
        row.title = `${page.path} / ${page.title}`;
      }
      row.addEventListener('mousedown', (e) => { e.preventDefault(); e.stopPropagation(); this._choose(page, editor); });
      row.addEventListener('mouseenter', () => {
        this._selectedIndex = index;
        menu.querySelectorAll('.canvas-mention-item').forEach((r, i) => r.classList.toggle('canvas-slash-item--selected', i === index));
      });
      menu.appendChild(row);
    });
    menu.style.display = 'block';
    this._place(editor);
    menu.querySelector<HTMLElement>('.canvas-slash-item--selected')?.scrollIntoView?.({ block: 'nearest' });
  }

  private readonly _handleKeydown = (e: KeyboardEvent): void => {
    const editor = this._host.editor;
    if (!this._visible || !editor) return;
    const results = this._results();
    const stop = () => { e.preventDefault(); e.stopPropagation(); e.stopImmediatePropagation(); };
    if (e.key === 'Escape') {
      stop();
      this._dismissedAt = this._range?.from ?? null;
      this.hide();
      return;
    }
    if (results.length === 0) return;
    if (e.key === 'ArrowDown') { stop(); this._selectedIndex = (this._selectedIndex + 1) % results.length; this._render(editor); }
    else if (e.key === 'ArrowUp') { stop(); this._selectedIndex = (this._selectedIndex - 1 + results.length) % results.length; this._render(editor); }
    else if (e.key === 'Enter' || e.key === 'Tab') { stop(); this._choose(results[this._selectedIndex]!, editor); }
  };

  private _choose(page: MentionCandidate, editor: Editor): void {
    const range = this._range;
    this.hide();
    if (!range) return;
    // The "@query" is still there: replace it with a link and a space after.
    const current = editor.state.doc.textBetween(range.from, Math.min(range.to, editor.state.doc.content.size), undefined, '￼');
    if (!current.startsWith('@')) return;
    editor.chain().focus().insertContentAt(range, [
      { type: 'text', text: page.title, marks: [{ type: 'link', attrs: { href: pageLinkHref(page.id) } }] },
      { type: 'text', text: ' ' },
    ]).unsetMark('link').run();
    this._host.requestSave('mention-insert');
  }

  hide(): void {
    window.removeEventListener('scroll', this._onScroll, true);
    this._host.editor?.view.dom.removeEventListener('keydown', this._handleKeydown, true);
    if (!this._menu || !this._visible) return;
    this._menu.style.display = 'none';
    this._visible = false;
    this._range = null;
  }

  dispose(): void {
    this.hide();
    this._registration?.dispose();
    this._registration = null;
    this._menu?.remove();
    this._menu = null;
  }
}
