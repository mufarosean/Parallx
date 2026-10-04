// pageTreeBlocks.ts — blocks that show the page's place in the tree
//
//   Breadcrumb  the path from the top of the tree to this page; each step
//               opens its page.
//   Sub-pages   this page's sub-pages in their sidebar order, each opening
//               its page (cards for sub-pages can be deleted or moved around
//               the body; this list always shows all of them).
//
// Both read the tree through LiveBlockServices and re-read when workspace
// data changes, so a move or a rename shows at once. Neither stores anything
// but its own id: they say where the page is now, wherever it is copied.

import { Node, mergeAttributes } from '@tiptap/core';
import { createIconElement, resolvePageIcon } from '../config/blockRegistry.js';
import { type LiveBlockOptions, type LivePageSummary, watchWorkspace } from './liveBlock.js';

function pageButton(page: LivePageSummary, open: ((id: string) => void) | undefined, className: string): HTMLButtonElement {
  const btn = document.createElement('button');
  btn.type = 'button';
  btn.className = className;
  try { btn.appendChild(createIconElement(resolvePageIcon(page.icon), 14)); } catch { /* icon is decoration */ }
  const t = document.createElement('span');
  t.textContent = page.title || 'Untitled';
  btn.appendChild(t);
  btn.addEventListener('mousedown', (e) => e.preventDefault());
  btn.addEventListener('click', () => open?.(page.id));
  return btn;
}

/** "Top › Parent › This page": ancestors open on click, the page itself does not. */
export function renderBreadcrumb(
  container: HTMLElement,
  ancestors: readonly LivePageSummary[],
  current: LivePageSummary | null,
  open?: (id: string) => void,
): void {
  container.innerHTML = '';
  const nav = document.createElement('nav');
  nav.className = 'canvas-crumbs-block__trail';
  nav.setAttribute('aria-label', 'Breadcrumb');
  ancestors.forEach((page) => {
    nav.appendChild(pageButton(page, open, 'canvas-crumbs-block__step'));
    const sep = document.createElement('span');
    sep.className = 'canvas-crumbs-block__sep';
    sep.textContent = '/';
    sep.setAttribute('aria-hidden', 'true');
    nav.appendChild(sep);
  });
  const here = document.createElement('span');
  here.className = 'canvas-crumbs-block__here';
  here.setAttribute('aria-current', 'page');
  here.textContent = current?.title || 'Untitled';
  nav.appendChild(here);
  container.appendChild(nav);
}

export function renderSubpages(container: HTMLElement, children: readonly LivePageSummary[], open?: (id: string) => void): void {
  container.innerHTML = '';
  const label = document.createElement('div');
  label.className = 'canvas-subpages-block__label';
  label.textContent = 'Sub-pages';
  container.appendChild(label);
  if (children.length === 0) {
    const empty = document.createElement('div');
    empty.className = 'canvas-subpages-block__empty';
    empty.textContent = 'No sub-pages yet. Type /page to add one.';
    container.appendChild(empty);
    return;
  }
  const list = document.createElement('div');
  list.className = 'canvas-subpages-block__list';
  list.setAttribute('role', 'list');
  for (const child of children) {
    const item = pageButton(child, open, 'canvas-subpages-block__page');
    item.setAttribute('role', 'listitem');
    list.appendChild(item);
  }
  container.appendChild(list);
}

function treeNodeView(kind: 'crumbs' | 'subpages', live: LiveBlockOptions['live']) {
  return () => {
    const dom = document.createElement('div');
    dom.className = kind === 'crumbs' ? 'canvas-crumbs-block' : 'canvas-subpages-block';
    dom.setAttribute('data-type', kind === 'crumbs' ? 'pageBreadcrumb' : 'subpageList');
    dom.contentEditable = 'false';
    let seq = 0;
    const refresh = async (): Promise<void> => {
      const mine = ++seq;
      const pageId = live?.pageId;
      const reader = live?.pages;
      if (!pageId || !reader) {
        if (kind === 'crumbs') renderBreadcrumb(dom, [], null); else renderSubpages(dom, []);
        return;
      }
      try {
        if (kind === 'crumbs') {
          const [ancestors, current] = await Promise.all([reader.getAncestors(pageId), reader.getPage(pageId)]);
          if (mine === seq) renderBreadcrumb(dom, ancestors, current, (id) => live?.openPage(id));
        } else {
          const children = await reader.getChildren(pageId);
          if (mine === seq) renderSubpages(dom, children, (id) => live?.openPage(id));
        }
      } catch { /* keep what is shown; the next change re-reads */ }
    };
    void refresh();
    const stop = watchWorkspace(live, () => { void refresh(); });
    return {
      dom,
      stopEvent: (e: Event) => (e.target as HTMLElement | null)?.closest?.('button') != null,
      ignoreMutation: () => true,
      destroy: () => stop(),
    };
  };
}

export const PageBreadcrumb = Node.create<LiveBlockOptions>({
  name: 'pageBreadcrumb',
  group: 'block',
  atom: true,
  selectable: true,
  draggable: true,
  addOptions() { return { live: undefined }; },
  parseHTML() { return [{ tag: 'div[data-type="pageBreadcrumb"]' }]; },
  renderHTML({ HTMLAttributes }) {
    return ['div', mergeAttributes(HTMLAttributes, { 'data-type': 'pageBreadcrumb', class: 'canvas-crumbs-block' })];
  },
  addNodeView() { return treeNodeView('crumbs', this.options.live); },
});

export const SubpageList = Node.create<LiveBlockOptions>({
  name: 'subpageList',
  group: 'block',
  atom: true,
  selectable: true,
  draggable: true,
  addOptions() { return { live: undefined }; },
  parseHTML() { return [{ tag: 'div[data-type="subpageList"]' }]; },
  renderHTML({ HTMLAttributes }) {
    return ['div', mergeAttributes(HTMLAttributes, { 'data-type': 'subpageList', class: 'canvas-subpages-block' })];
  },
  addNodeView() { return treeNodeView('subpages', this.options.live); },
});
