// pdfOutline.ts — the Outline side of the PDF pane's side panel.
//
// The document's table of contents as a tree: each row learns its page once
// the destinations resolve, the row of the section being read is marked as
// the view moves, and the tree is walked with the arrow keys. The pane owns
// the panel (whether the Outline side shows) and hands this class the tree
// element and what it needs from the viewer.

import type { PDFDocumentProxy } from 'pdfjs-dist';
import { $ } from '../../../ui/dom.js';
import { ICON } from './pdfIcons.js';
import type { PdfOutlineItem } from './pdfTypes.js';

/** What the outline needs from the pane. */
export interface PdfOutlineHost {
  /** The open document, or null between documents. */
  document(): PDFDocumentProxy | null;
  /** The printed label of a page (1-based), when the document has labels. */
  pageLabel(pageNum: number): string | undefined;
  /** Go to an outline entry's destination. */
  goToDestination(dest: string | unknown[]): void;
  /** The viewer's scale (1 = 100%). */
  scale(): number;
  /** The height of the viewer's scrolling area, in CSS px. */
  viewHeight(): number;
  /** Whether the Outline side of the panel is showing. */
  isShowing(): boolean;
}

interface OutlineRow { row: HTMLElement; page: number; top: number | null }
type DestRow = HTMLElement & { __pdfDest?: string | unknown[] };

export class PdfOutline {
  private _items: PdfOutlineItem[] | null = null;
  private _rows: OutlineRow[] = [];
  private _current: HTMLElement | null = null;
  private _viewTopPage = 1;
  private _viewTop: number | null = null;

  constructor(
    private readonly _tree: HTMLElement,
    private readonly _host: PdfOutlineHost,
  ) {
    this._tree.setAttribute('role', 'tree');
    this._tree.addEventListener('keydown', (e) => this._onKeyDown(e));
  }

  /** Whether the open document has an outline. */
  get hasItems(): boolean {
    return !!this._items?.length;
  }

  /** Show a document's outline (or none). */
  render(items: PdfOutlineItem[] | null): void {
    this.clear();
    if (!items?.length) return;
    this._items = items;
    this._buildNodes(items, this._tree, 0);
    const first = this._tree.querySelector<HTMLElement>('.pdf-outline-item');
    if (first) first.tabIndex = 0;
    void this._resolvePages();
  }

  /** Forget the document's outline and where the view was. */
  clear(): void {
    this._tree.replaceChildren();
    this._items = null;
    this._rows = [];
    this._current = null;
    this._viewTopPage = 1;
    this._viewTop = null;
  }

  /** The view moved: `top` is the PDF y at its top edge (null: the page's top). */
  updateViewArea(pageNum: number, top: number | null): void {
    this._viewTopPage = pageNum;
    this._viewTop = top;
    this._markCurrent();
  }

  /** Bring the current section's row into the tree, as the panel opens on Outline. */
  revealCurrent(): void {
    this._current?.scrollIntoView({ block: 'nearest' });
  }

  /**
   * Each row learns its page number (shown at the row's end) once the
   * destinations resolve; the rows then mark where the reader is.
   */
  private async _resolvePages(): Promise<void> {
    const doc = this._host.document();
    if (!doc) return;
    const found: OutlineRow[] = [];
    for (const row of this._tree.querySelectorAll<DestRow>('.pdf-outline-item')) {
      const dest = row.__pdfDest;
      if (!dest) continue;
      try {
        const explicit = (typeof dest === 'string' ? await doc.getDestination(dest) : dest) as any[] | null;
        const ref = explicit?.[0];
        const index = ref == null ? -1
          : typeof ref === 'number' ? ref
          : await doc.getPageIndex(ref);
        if (index < 0 || doc !== this._host.document()) continue;
        const page = index + 1;
        const pageEl = row.querySelector('.pdf-outline-page');
        if (pageEl) pageEl.textContent = this._host.pageLabel(page) ?? String(page);
        // Where on the page the entry starts (PDF units, measured up from the
        // bottom), when the destination says: XYZ carries it third, FitH and
        // FitBH second.
        const kind = explicit?.[1]?.name;
        const rawTop = kind === 'XYZ' ? explicit?.[3] : (kind === 'FitH' || kind === 'FitBH') ? explicit?.[2] : null;
        found.push({ row, page, top: typeof rawTop === 'number' ? rawTop : null });
      } catch { /* a broken destination just has no page number */ }
    }
    if (doc !== this._host.document()) return;
    this._rows = found;
    this._markCurrent();
  }

  /**
   * The current section: the last outline entry (in outline order) that
   * starts above the top of the view or just under it (a heading near the
   * top of the view is the one being read): within a third of the view, and
   * at most an inch and a half, so a zoomed-out view showing a whole page
   * does not jump to its last heading. Before the first entry, the first
   * entry.
   */
  private _markCurrent(): void {
    const pageNum = this._viewTopPage;
    const viewTop = this._viewTop;
    // CSS px = PDF pt × scale × 96/72.
    const scale = this._host.scale() * (96 / 72);
    const slack = Math.min(this._host.viewHeight() / 3 / scale, 108);
    let best: HTMLElement | null = null;
    for (const { row, page, top } of this._rows) {
      const started = page < pageNum
        || (page === pageNum && (top === null || viewTop === null || top + slack >= viewTop));
      if (started) best = row;
    }
    best ??= this._rows[0]?.row ?? null;
    if (best === this._current) return;
    this._current?.classList.remove('is-current');
    this._current = best;
    if (best) {
      best.classList.add('is-current');
      if (this._host.isShowing() && best.offsetParent) best.scrollIntoView({ block: 'nearest' });
    }
  }

  private _buildNodes(items: PdfOutlineItem[], parent: HTMLElement, depth: number): void {
    for (const item of items) {
      const hasChildren = item.items?.length > 0;

      const row = $('div') as DestRow;
      row.classList.add('pdf-outline-item');
      if (hasChildren) row.classList.add('pdf-outline-item--parent');
      row.style.paddingLeft = `${depth * 14 + 4}px`;
      row.tabIndex = -1; // focusable via roving tabindex
      row.setAttribute('role', 'treeitem');
      // The destination rides on the row for Enter and for page resolution.
      if (item.dest) row.__pdfDest = item.dest;

      const toggleEl = $('span');
      toggleEl.classList.add('pdf-outline-toggle');
      if (hasChildren) toggleEl.innerHTML = ICON.chevronDown;
      else toggleEl.classList.add('pdf-outline-toggle--leaf');
      row.appendChild(toggleEl);

      const title = $('span');
      title.classList.add('pdf-outline-title');
      title.textContent = item.title;
      if (item.bold) title.style.fontWeight = 'bold';
      if (item.italic) title.style.fontStyle = 'italic';
      row.appendChild(title);

      const pageEl = $('span');
      pageEl.classList.add('pdf-outline-page');
      row.appendChild(pageEl);
      parent.appendChild(row);

      let childContainer: HTMLElement | null = null;
      if (hasChildren) {
        childContainer = $('div');
        childContainer.classList.add('pdf-outline-children');
        childContainer.setAttribute('role', 'group');
        this._buildNodes(item.items, childContainer, depth + 1);
        parent.appendChild(childContainer);
      }

      // The chevron collapses; the title navigates.
      toggleEl.addEventListener('click', (e) => {
        e.stopPropagation();
        if (!childContainer) return;
        const collapsed = childContainer.classList.toggle('pdf-outline-children--collapsed');
        toggleEl.innerHTML = collapsed ? ICON.chevronRight : ICON.chevronDown;
      });
      title.addEventListener('click', () => {
        if (item.dest) this._host.goToDestination(item.dest);
      });
    }
  }

  /**
   * ArrowUp/Down move between visible rows; ArrowRight expands (or enters
   * the first child), ArrowLeft collapses (or goes to the parent); Enter
   * goes to the row's destination.
   */
  private _onKeyDown(e: KeyboardEvent): void {
    const current = document.activeElement as DestRow | null;
    if (!current || !current.classList.contains('pdf-outline-item')) return;

    switch (e.key) {
      case 'ArrowDown': {
        e.preventDefault();
        this._visibleNeighbour(current, 1)?.focus();
        break;
      }
      case 'ArrowUp': {
        e.preventDefault();
        this._visibleNeighbour(current, -1)?.focus();
        break;
      }
      case 'ArrowRight': {
        e.preventDefault();
        if (!current.classList.contains('pdf-outline-item--parent')) break;
        const children = current.nextElementSibling;
        if (!children?.classList.contains('pdf-outline-children')) break;
        if (children.classList.contains('pdf-outline-children--collapsed')) {
          current.querySelector<HTMLElement>('.pdf-outline-toggle')?.click();
        } else {
          children.querySelector<HTMLElement>('.pdf-outline-item')?.focus();
        }
        break;
      }
      case 'ArrowLeft': {
        e.preventDefault();
        const children = current.nextElementSibling;
        const isExpanded = current.classList.contains('pdf-outline-item--parent')
          && !!children?.classList.contains('pdf-outline-children')
          && !children.classList.contains('pdf-outline-children--collapsed');
        if (isExpanded) {
          current.querySelector<HTMLElement>('.pdf-outline-toggle')?.click();
        } else {
          // The parent row is the sibling before this row's group.
          const group = current.parentElement;
          const parentRow = group?.classList.contains('pdf-outline-children') ? group.previousElementSibling as HTMLElement | null : null;
          if (parentRow?.classList.contains('pdf-outline-item')) parentRow.focus();
        }
        break;
      }
      case 'Enter': {
        e.preventDefault();
        if (current.__pdfDest) this._host.goToDestination(current.__pdfDest);
        break;
      }
    }
  }

  /** The visible row `step` places from `row`, in tree order. */
  private _visibleNeighbour(row: HTMLElement, step: 1 | -1): HTMLElement | null {
    const visible = Array.from(this._tree.querySelectorAll<HTMLElement>('.pdf-outline-item')).filter((el) => this._isVisible(el));
    const idx = visible.indexOf(row);
    return idx >= 0 ? visible[idx + step] ?? null : null;
  }

  /** A row is visible unless an ancestor group is collapsed. */
  private _isVisible(el: HTMLElement): boolean {
    for (let p = el.parentElement; p && p !== this._tree; p = p.parentElement) {
      if (p.classList.contains('pdf-outline-children--collapsed')) return false;
    }
    return true;
  }
}
