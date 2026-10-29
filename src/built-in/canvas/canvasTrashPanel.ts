// canvasTrashPanel.ts — the sidebar's Trash: what was deleted, from where,
// when, and with how many sub-pages, grouped by day, each one a Restore away.
//
// One row per deleted page the user can act on (a "root": a trashed page
// whose parent is not trashed too). Its trashed sub-pages ride along: Restore
// and Delete Forever take the whole branch, so listing them separately only
// padded the list. The actions are commands (registerTrashCommands), so the
// palette, keybindings and these buttons run the same thing.

import type { ICanvasDataService, IPageSummary, IPageSummaryTreeNode } from './canvasTypes.js';
import type { IDisposable } from '../../platform/lifecycle.js';
import { $, attachPopupDismiss } from '../../ui/dom.js';
import { InputBox } from '../../ui/inputBox.js';
import { createIconElement, resolvePageIcon } from './config/blockRegistry.js';
import { formatRelativeTime } from '../../ui/relativeTime.js';
import { parseStoredTime } from '../../platform/storedTime.js';
import { addAppDays, startOfAppDay } from '../../platform/localTime.js';
import { createButton, createEmptyState, createIconButton, createSectionLabel, createSurface } from '../../ui/kit.js';
import { decodeCanvasContent } from './contentSchema.js';

export interface ITrashEntry {
  readonly page: IPageSummary;
  /** Trashed pages under it, at any depth. */
  readonly subPages: number;
  /** Title of the live page it was under; null at the top level or when that page is gone. */
  readonly fromTitle: string | null;
}

/** The rows of the Trash: its roots, newest first, each with its branch size and origin. */
export function trashEntries(archived: readonly IPageSummary[], liveTitle: (id: string) => string | null): ITrashEntry[] {
  const byId = new Map(archived.map((p) => [p.id, p] as const));
  const rootOf = (p: IPageSummary): IPageSummary => {
    let at = p;
    for (let guard = 0; guard < 1000 && at.parentId && byId.has(at.parentId); guard++) at = byId.get(at.parentId)!;
    return at;
  };
  const counts = new Map<string, number>();
  for (const p of archived) {
    const root = rootOf(p);
    if (root.id !== p.id) counts.set(root.id, (counts.get(root.id) ?? 0) + 1);
  }
  return archived
    .filter((p) => !p.parentId || !byId.has(p.parentId))
    .map((page) => ({ page, subPages: counts.get(page.id) ?? 0, fromTitle: page.parentId ? liveTitle(page.parentId) : null }))
    .sort((a, b) => parseStoredTime(b.page.updatedAt) - parseStoredTime(a.page.updatedAt));
}

/** The day heading a deletion files under, on the app's clock. */
export function trashDayGroup(when: string, now: number = Date.now()): 'Today' | 'Yesterday' | 'Earlier this week' | 'Older' {
  const t = parseStoredTime(when);
  const today = startOfAppDay(now);
  if (t >= today) return 'Today';
  if (t >= addAppDays(today, -1)) return 'Yesterday';
  if (t >= addAppDays(today, -6)) return 'Earlier this week';
  return 'Older';
}

/** The first words of a page, to tell one Untitled page from another. */
export function firstWords(content: string): string {
  try {
    const parts: string[] = [];
    const walk = (n: unknown): void => {
      if (parts.join(' ').length > 80 || !n || typeof n !== 'object') return;
      const node = n as { type?: string; text?: string; content?: unknown[] };
      if (node.type === 'text' && node.text) parts.push(node.text);
      node.content?.forEach(walk);
    };
    walk(decodeCanvasContent(content).doc);
    const text = parts.join(' ').replace(/\s+/g, ' ').trim();
    return text.length > 60 ? `${text.slice(0, 60).trimEnd()}…` : text;
  } catch {
    return '';
  }
}

/** What the Trash commands need from the tool's API. */
export interface ITrashCommandsApi {
  commands: { registerCommand(id: string, handler: (...args: unknown[]) => unknown): IDisposable };
  window: {
    showErrorMessage(message: string): Promise<unknown>;
    showConfirmModal(options: { message: string; detail?: string; confirmLabel?: string; danger?: boolean }): Promise<boolean>;
  };
}

const errorText = (err: unknown): string => (err instanceof Error ? err.message : String(err));

/** Restore asks nothing (deleting again undoes it); the two permanent ones ask first. */
export function registerTrashCommands(api: ITrashCommandsApi, data: () => ICanvasDataService | undefined): IDisposable[] {
  return [
    api.commands.registerCommand('canvas.restorePage', async (...args: unknown[]) => {
      const ds = data(); const pageId = String(args[0] ?? '');
      if (!ds || !pageId) return;
      try { await ds.restorePage(pageId); } catch (err) { void api.window.showErrorMessage(`Could not restore the page. ${errorText(err)}`); }
    }),
    api.commands.registerCommand('canvas.deletePageForever', async (...args: unknown[]) => {
      const ds = data(); const pageId = String(args[0] ?? '');
      if (!ds || !pageId) return;
      const entry = trashEntries(await ds.getArchivedPages(), () => null).find((e) => e.page.id === pageId);
      if (!entry) return;
      const name = `"${entry.page.title || 'Untitled'}"`;
      const ok = await api.window.showConfirmModal({
        message: `Delete ${name} forever?`,
        detail: entry.subPages ? `Its ${entry.subPages === 1 ? 'sub-page goes' : `${entry.subPages} sub-pages go`} too. This cannot be undone.` : 'This cannot be undone.',
        confirmLabel: 'Delete Forever',
        danger: true,
      });
      if (!ok) return;
      try { await ds.permanentlyDeletePage(pageId); } catch (err) { void api.window.showErrorMessage(`Could not delete ${name}. ${errorText(err)}`); }
    }),
    api.commands.registerCommand('canvas.emptyTrash', async () => {
      const ds = data();
      if (!ds) return;
      const n = trashEntries(await ds.getArchivedPages(), () => null).length;
      if (n === 0) return;
      const ok = await api.window.showConfirmModal({
        message: n === 1 ? 'Empty the Trash?' : `Delete all ${n} pages in the Trash forever?`,
        detail: 'Their sub-pages go too. This cannot be undone.',
        confirmLabel: 'Empty Trash',
        danger: true,
      });
      if (!ok) return;
      // The service reads the Trash now: a page restored since is kept.
      try { await ds.emptyTrash(); } catch (err) { void api.window.showErrorMessage(`Could not empty the Trash. ${errorText(err)}`); }
    }),
  ];
}

export interface ITrashPanelHost {
  readonly dataService: ICanvasDataService;
  /** The Trash button: the panel opens above it, and pressing it again is not "outside". */
  readonly anchor: HTMLElement;
  /** The sidebar, whose width the panel takes. */
  readonly sidebar: HTMLElement;
  onClose(): void;
}

export class CanvasTrashPanel {
  private readonly _el = $('div.canvas-trash-panel');
  private readonly _count = $('span.canvas-trash-panel-count');
  private readonly _list = $('div.canvas-trash-panel-list');
  private readonly _footer = $('div.canvas-trash-panel-footer');
  private readonly _search: InputBox;
  private readonly _detach: () => void;
  private _query = '';
  private _entries: ITrashEntry[] = [];
  private _disposed = false;
  /** First words of Untitled pages, read once per page. */
  private readonly _snippets = new Map<string, string>();

  constructor(private readonly _host: ITrashPanelHost, archived: readonly IPageSummary[], tree: readonly IPageSummaryTreeNode[]) {
    createSurface(this._el, { id: 'canvas.trash', owner: 'canvas', label: 'Trash' });
    this._el.setAttribute('role', 'dialog');
    this._el.setAttribute('aria-label', 'Trash');

    const header = $('div.canvas-trash-panel-header');
    const title = $('span.canvas-trash-panel-title');
    title.textContent = 'Trash';
    header.append(title, this._count);
    createIconButton(header, { id: 'canvas.trash.close', icon: 'close', title: 'Close', size: 'sm', onClick: () => this.dispose() })
      .classList.add('canvas-trash-panel-close');

    const searchRow = $('div.canvas-trash-panel-search');
    this._search = new InputBox(searchRow, { placeholder: 'Search the Trash…', ariaLabel: 'Search the Trash' });
    this._search.onDidChange((v) => { this._query = v.trim().toLowerCase(); this._renderList(); });
    this._el.append(header, searchRow, this._list, this._footer);

    this.update(archived, tree);

    const btn = _host.anchor.getBoundingClientRect();
    const side = _host.sidebar.getBoundingClientRect();
    this._el.style.bottom = `${window.innerHeight - btn.top + 4}px`;
    this._el.style.left = `${side.left + 8}px`;
    this._el.style.width = `${Math.max(side.width - 16, 360)}px`;
    document.body.appendChild(this._el);
    setTimeout(() => this._search.focus(), 50);
    this._detach = attachPopupDismiss([this._el, _host.anchor], () => this.dispose(), {
      // A question the panel's commands ask sits over it; answering it is not "outside".
      isDismissable: (e) => !(e.target instanceof Element && e.target.closest('.px-modal, [role="alertdialog"], [aria-modal="true"]')),
    });
  }

  /** Redraw from the sidebar's latest data (a restore or delete lands here). */
  update(archived: readonly IPageSummary[], tree: readonly IPageSummaryTreeNode[]): void {
    if (this._disposed) return;
    const titles = new Map<string, string>();
    const walk = (nodes: readonly IPageSummaryTreeNode[]): void => { for (const n of nodes) { titles.set(n.id, n.title || 'Untitled'); walk(n.children); } };
    walk(tree);
    this._entries = trashEntries(archived, (id) => titles.get(id) ?? null);
    this._count.textContent = String(this._entries.length);
    this._count.hidden = this._entries.length === 0;
    this._renderList();
    this._footer.replaceChildren();
    this._footer.hidden = this._entries.length === 0;
    if (this._entries.length > 0) {
      const note = $('span.canvas-trash-panel-footer-note');
      note.textContent = 'Pages stay here until you empty the Trash.';
      this._footer.appendChild(note);
      createButton(this._footer, { id: 'canvas.trash.empty', label: 'Empty Trash…', icon: 'trash-2', size: 'sm', kind: 'danger', command: 'canvas.emptyTrash' });
    }
  }

  private _renderList(): void {
    this._list.replaceChildren();
    const shown = this._entries.filter((e) => !this._query
      || (e.page.title || 'Untitled').toLowerCase().includes(this._query)
      || (this._snippets.get(e.page.id) ?? '').toLowerCase().includes(this._query));
    if (shown.length === 0) {
      createEmptyState(this._list, this._query
        ? { headline: 'No matching pages', hint: 'Try a different word.' }
        : { headline: 'The Trash is empty', hint: 'Pages you delete wait here until you empty the Trash.' });
      return;
    }
    let group = '';
    for (const entry of shown) {
      const g = trashDayGroup(entry.page.updatedAt);
      if (g !== group) {
        group = g;
        createSectionLabel(this._list, g).classList.add('canvas-trash-panel-group');
      }
      this._list.appendChild(this._renderRow(entry));
    }
  }

  private _renderRow(entry: ITrashEntry): HTMLElement {
    const { page } = entry;
    const name = page.title || 'Untitled';
    const row = $('div.canvas-trash-panel-row');
    row.setAttribute('data-page-id', page.id);
    row.appendChild(createIconElement(resolvePageIcon(page.icon), 16));

    const text = $('div.canvas-trash-panel-text');
    const title = $('div.canvas-trash-panel-title-text');
    title.textContent = name;
    const meta = $('div.canvas-trash-panel-meta');
    meta.textContent = [
      entry.fromTitle ? `From ${entry.fromTitle}` : null,
      formatRelativeTime(page.updatedAt, 'long'),
      entry.subPages ? (entry.subPages === 1 ? '1 sub-page' : `${entry.subPages} sub-pages`) : null,
    ].filter(Boolean).join(' · ').replace(/^./, (c) => c.toUpperCase());
    text.append(title, meta);
    row.appendChild(text);
    if (!page.title || page.title === 'Untitled') this._fillSnippet(page.id, title);

    const actions = $('div.canvas-trash-panel-actions');
    createButton(actions, {
      id: `canvas.trash.restore.${page.id}`, label: 'Restore', icon: 'rotate-ccw', size: 'sm', kind: 'secondary',
      title: entry.subPages ? 'Put this page and its sub-pages back where they were.' : 'Put this page back where it was.',
      command: 'canvas.restorePage', args: [page.id],
    });
    createIconButton(actions, {
      id: `canvas.trash.delete.${page.id}`, icon: 'trash', size: 'sm', title: `Delete "${name}" Forever…`,
      command: 'canvas.deletePageForever', args: [page.id],
    }).classList.add('canvas-trash-panel-delete');
    row.appendChild(actions);
    return row;
  }

  /** An Untitled page shows its first words instead, once they are read. */
  private _fillSnippet(pageId: string, titleEl: HTMLElement): void {
    const apply = (s: string | undefined): void => {
      if (!s) return;
      titleEl.textContent = s;
      titleEl.classList.add('canvas-trash-panel-title-text--snippet');
      titleEl.title = `Untitled: ${s}`;
    };
    if (this._snippets.has(pageId)) { apply(this._snippets.get(pageId)); return; }
    void this._host.dataService.getPage(pageId).then((p) => {
      const s = p ? firstWords(p.content) : '';
      this._snippets.set(pageId, s);
      if (titleEl.isConnected) apply(s);
    }).catch(() => this._snippets.set(pageId, ''));
  }

  dispose(): void {
    if (this._disposed) return;
    this._disposed = true;
    this._detach();
    this._search.dispose();
    this._el.remove();
    this._host.onClose();
  }
}
