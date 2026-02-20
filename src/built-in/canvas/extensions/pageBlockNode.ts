// pageBlockNode.ts — Embedded sub-page block
//
// Atom block that links to another Canvas page. Supports open-on-click,
// hover preview, inline icon editing, and dropping blocks onto the card to
// move content into the linked page.

import { Node, mergeAttributes } from '@tiptap/core';
import { PAGE_ICON_IDS, resolvePageIcon, svgIcon } from '../canvasIcons.js';
import { IconPicker } from '../../../ui/iconPicker.js';
import { layoutPopup } from '../../../ui/dom.js';
import { deleteDraggedSourceFromTransaction } from '../mutations/blockMutations.js';
import {
  CANVAS_BLOCK_DRAG_MIME,
  clearActiveCanvasDragSession,
  getActiveCanvasDragSession,
} from '../dnd/dragSession.js';

// ── Local narrow types ──────────────────────────────────────────────────────
// pageBlockNode is a child of blockRegistry and receives all dependencies
// through it.  It defines its own narrow shapes for the page data it needs
// rather than importing shared types from canvasTypes.ts.
// The full IPage / PageChangeEvent / ICanvasDataService structurally satisfy
// these — TypeScript structural typing handles compatibility automatically.

/** Narrow page shape — only the fields pageBlockNode reads. */
export interface IPageBlockPage {
  readonly id: string;
  readonly title: string;
  readonly icon: string | null;
}

/** Narrow change-event shape — only the fields pageBlockNode reads. */
export interface IPageBlockChangeEvent {
  readonly pageId: string;
  readonly page?: IPageBlockPage;
}

export interface IPageBlockDataAccess {
  getPage(pageId: string): Promise<IPageBlockPage | null>;
  updatePage(pageId: string, updates: { icon?: string | null }): Promise<IPageBlockPage>;
  decodePageContentForEditor(page: IPageBlockPage): Promise<{ doc: any; recovered: boolean }>;
  moveBlocksBetweenPagesAtomic(params: {
    sourcePageId: string;
    targetPageId: string;
    sourceDoc: any;
    appendedNodes: any[];
  }): Promise<{ sourcePage: IPageBlockPage; targetPage: IPageBlockPage }>;
  appendBlocksToPage(targetPageId: string, appendedNodes: any[]): Promise<IPageBlockPage>;
  readonly onDidChangePage: (listener: (e: IPageBlockChangeEvent) => void) => { dispose(): void };
}

export interface PageBlockOptions {
  readonly dataService?: IPageBlockDataAccess;
  readonly currentPageId?: string;
  readonly openEditor?: (options: { typeId: string; title: string; icon?: string; instanceId?: string }) => Promise<void>;
}

function collectPreviewText(node: any, parts: string[], limit = 220): void {
  if (!node || parts.join(' ').length >= limit) {
    return;
  }
  if (typeof node.text === 'string' && node.text.trim()) {
    parts.push(node.text.trim());
  }
  const children = Array.isArray(node.content) ? node.content : [];
  for (const child of children) {
    collectPreviewText(child, parts, limit);
    if (parts.join(' ').length >= limit) break;
  }
}

function previewFromDoc(doc: any): string {
  const parts: string[] = [];
  collectPreviewText(doc, parts);
  const text = parts.join(' ').replace(/\s+/g, ' ').trim();
  if (!text) return 'No preview available';
  return text.length > 220 ? `${text.slice(0, 220).trim()}…` : text;
}

export const PageBlock = Node.create<PageBlockOptions>({
  name: 'pageBlock',
  group: 'block',
  atom: true,
  selectable: true,
  draggable: true,

  addOptions() {
    return {
      dataService: undefined,
      currentPageId: undefined,
      openEditor: undefined,
    };
  },

  addAttributes() {
    return {
      pageId: { default: '' },
      title: { default: 'Untitled' },
      icon: { default: null },
      parentPageId: { default: null },
    };
  },

  parseHTML() {
    return [{ tag: 'div[data-type="pageBlock"]' }];
  },

  renderHTML({ HTMLAttributes }: { HTMLAttributes: Record<string, any> }) {
    return [
      'div',
      mergeAttributes(HTMLAttributes, {
        'data-type': 'pageBlock',
        class: 'canvas-page-block',
      }),
    ];
  },

  addNodeView() {
    return ({ node, editor, updateAttributes }: any) => {
      let attrs = node.attrs as { pageId?: string; title?: string; icon?: string | null };
      let resolvedTitle = attrs.title || 'Untitled';
      let resolvedIcon: string | null = attrs.icon ?? null;
      let previewPopup: HTMLElement | null = null;
      let iconPicker: IconPicker | null = null;
      let previewTimer: ReturnType<typeof setTimeout> | null = null;
      let hidePreviewTimer: ReturnType<typeof setTimeout> | null = null;
      let loadingPreview = 0;
      let suppressOpenUntil = 0;
      const dataService = this.options.dataService;

      const dom = document.createElement('div');
      dom.classList.add('canvas-page-block');
      dom.setAttribute('data-type', 'pageBlock');
      dom.contentEditable = 'false';
      dom.draggable = false;
      dom.tabIndex = 0;

      const card = document.createElement('div');
      card.classList.add('canvas-page-block-card');
      dom.appendChild(card);

      const iconBtn = document.createElement('button');
      iconBtn.classList.add('canvas-page-block-icon');
      iconBtn.type = 'button';
      iconBtn.title = 'Change page icon';
      card.appendChild(iconBtn);

      const body = document.createElement('div');
      body.classList.add('canvas-page-block-body');
      card.appendChild(body);

      const titleEl = document.createElement('div');
      titleEl.classList.add('canvas-page-block-title');
      body.appendChild(titleEl);

      const closePreview = () => {
        if (previewPopup) {
          previewPopup.remove();
          previewPopup = null;
        }
      };

      const closeIconPicker = () => {
        if (iconPicker) {
          iconPicker.dismiss();
          iconPicker = null;
        }
      };

      const syncLinkedPageMeta = async () => {
        const pageId = attrs.pageId;
        if (!dataService || !pageId) return;
        try {
          const linked = await dataService.getPage(pageId);
          if (!linked) return;

          const nextTitle = linked.title || 'Untitled';
          const nextIcon = linked.icon ?? null;

          resolvedTitle = nextTitle;
          resolvedIcon = nextIcon;
          render();

          if (nextTitle !== attrs.title || nextIcon !== (attrs.icon ?? null)) {
            updateAttributes({ title: nextTitle, icon: nextIcon });
          }
        } catch {
          // Ignore transient lookup failures.
        }
      };

      const positionPopup = (popup: HTMLElement) => {
        const rect = dom.getBoundingClientRect();
        layoutPopup(popup, rect, { position: 'below', gap: 6 });
      };

      const render = () => {
        const iconId = resolvePageIcon(resolvedIcon);
        iconBtn.innerHTML = svgIcon(iconId);
        const iconSvg = iconBtn.querySelector('svg');
        if (iconSvg) {
          iconSvg.setAttribute('width', '14');
          iconSvg.setAttribute('height', '14');
        }
        titleEl.textContent = resolvedTitle || 'Untitled';
      };

      const openLinkedPage = () => {
        const pageId = attrs.pageId;
        if (!pageId || !this.options.openEditor) return;
        void this.options.openEditor({
          typeId: 'canvas',
          title: resolvedTitle || 'Untitled',
          icon: resolvedIcon ?? undefined,
          instanceId: pageId,
        });
      };

      const showIconPicker = () => {
        if (iconPicker) {
          closeIconPicker();
          return;
        }
        closePreview();

        iconPicker = new IconPicker(document.body, {
          anchor: dom,
          icons: PAGE_ICON_IDS,
          renderIcon: (id, _size) => svgIcon(id),
          showSearch: false,
          showRemove: true,
          iconSize: 18,
        });

        iconPicker.onDidSelectIcon((iconId) => {
          const pageId = attrs.pageId;
          if (pageId && dataService) {
            void (async () => {
              await dataService.updatePage(pageId, { icon: iconId });
              resolvedIcon = iconId;
              render();
              updateAttributes({ icon: iconId });
            })();
          }
        });

        iconPicker.onDidRemoveIcon(() => {
          const pageId = attrs.pageId;
          if (pageId && dataService) {
            void (async () => {
              await dataService.updatePage(pageId, { icon: null });
              resolvedIcon = null;
              render();
              updateAttributes({ icon: null });
            })();
          }
        });

        iconPicker.onDidDismiss(() => {
          iconPicker = null;
        });
      };

      const showPreview = async () => {
        const pageId = attrs.pageId;
        if (!pageId || !dataService || iconPicker) return;

        loadingPreview += 1;
        const token = loadingPreview;

        const popup = document.createElement('div');
        popup.classList.add('canvas-page-block-preview');
        popup.innerHTML = '<div class="canvas-page-block-preview-title">Loading preview…</div>';

        closePreview();
        previewPopup = popup;
        document.body.appendChild(popup);
        positionPopup(popup);

        try {
          const linked = await dataService.getPage(pageId);
          if (!linked || token !== loadingPreview) return;

          const decoded = await dataService.decodePageContentForEditor(linked);
          if (token !== loadingPreview) return;

          popup.innerHTML = '';

          const title = document.createElement('div');
          title.classList.add('canvas-page-block-preview-title');
          title.textContent = linked.title || 'Untitled';
          popup.appendChild(title);

          const snippet = document.createElement('div');
          snippet.classList.add('canvas-page-block-preview-snippet');
          snippet.textContent = previewFromDoc(decoded.doc);
          popup.appendChild(snippet);
        } catch {
          if (token !== loadingPreview) return;
          popup.innerHTML = '';
          const title = document.createElement('div');
          title.classList.add('canvas-page-block-preview-title');
          title.textContent = attrs.title || 'Untitled';
          popup.appendChild(title);

          const snippet = document.createElement('div');
          snippet.classList.add('canvas-page-block-preview-snippet');
          snippet.textContent = 'Preview unavailable';
          popup.appendChild(snippet);
        }
      };

      const schedulePreview = () => {
        if (previewTimer) clearTimeout(previewTimer);
        if (hidePreviewTimer) clearTimeout(hidePreviewTimer);
        previewTimer = setTimeout(() => {
          void showPreview();
        }, 220);
      };

      const scheduleHidePreview = () => {
        if (previewTimer) {
          clearTimeout(previewTimer);
          previewTimer = null;
        }
        if (hidePreviewTimer) clearTimeout(hidePreviewTimer);
        hidePreviewTimer = setTimeout(() => {
          closePreview();
        }, 120);
      };

      card.addEventListener('click', (event) => {
        if ((event.target as HTMLElement).closest('.canvas-page-block-icon')) return;
        if (editor.view.dom.classList.contains('dragging')) return;
        if (Date.now() < suppressOpenUntil) return;
        event.preventDefault();
        event.stopPropagation();
        openLinkedPage();
      });

      iconBtn.addEventListener('click', (event) => {
        event.preventDefault();
        event.stopPropagation();
        showIconPicker();
      });

      dom.addEventListener('keydown', (event) => {
        if (event.key !== 'Enter') return;
        event.preventDefault();
        event.stopPropagation();
        openLinkedPage();
      });

      dom.addEventListener('mouseenter', () => {
        schedulePreview();
      });

      dom.addEventListener('mouseleave', () => {
        scheduleHidePreview();
      });

      dom.addEventListener('dragstart', (event) => {
        event.preventDefault();
        event.stopPropagation();
      });

      dom.addEventListener('dragover', (event) => {
        const rawPayload = event.dataTransfer?.getData(CANVAS_BLOCK_DRAG_MIME);
        let payloadMatchesCurrentPage = false;
        if (rawPayload) {
          try {
            const parsed = JSON.parse(rawPayload);
            payloadMatchesCurrentPage = parsed?.sourcePageId === (this.options.currentPageId ?? '')
              && Array.isArray(parsed?.nodes)
              && parsed.nodes.length > 0;
          } catch {
            payloadMatchesCurrentPage = false;
          }
        }

        const hasEditorDragging = !!editor.view.dragging?.slice;
        const dragSession = getActiveCanvasDragSession();
        const hasSessionDragging = !!dragSession
          && dragSession.sourcePageId === (this.options.currentPageId ?? '')
          && Array.isArray(dragSession.nodes)
          && dragSession.nodes.length > 0;
        const hasAnyCanvasDrag = hasEditorDragging || hasSessionDragging || payloadMatchesCurrentPage;
        if (!hasAnyCanvasDrag || !attrs.pageId) return;
        event.preventDefault();
        event.stopPropagation();
        dom.classList.add('canvas-page-block--drop-target');
        if (event.dataTransfer) {
          event.dataTransfer.dropEffect = event.altKey ? 'copy' : 'move';
        }
      });

      dom.addEventListener('dragleave', () => {
        dom.classList.remove('canvas-page-block--drop-target');
      });

      dom.addEventListener('drop', (event) => {
        const dragging = editor.view.dragging;
        const dragSession = getActiveCanvasDragSession();
        const rawPayload = event.dataTransfer?.getData(CANVAS_BLOCK_DRAG_MIME) ?? '';

        let payload: { sourcePageId?: string; from?: number; to?: number; nodes?: any[] } | null = null;
        if (rawPayload) {
          try {
            payload = JSON.parse(rawPayload);
          } catch {
            payload = null;
          }
        }

        const pageId = attrs.pageId;
        if ((!dragging?.slice && !dragSession && !payload) || !pageId || !dataService) return;
        if (this.options.currentPageId && pageId === this.options.currentPageId) return;

        event.preventDefault();
        event.stopPropagation();
        dom.classList.remove('canvas-page-block--drop-target');
        suppressOpenUntil = Date.now() + 350;

        let draggedJson: any[] = [];
        if (dragging?.slice) {
          const slice = dragging.slice;
          if (slice.openStart > 0 || slice.openEnd > 0 || slice.content.childCount === 0) return;
          const fromSlice = slice.content.toJSON();
          if (!Array.isArray(fromSlice) || fromSlice.length === 0) return;
          draggedJson = fromSlice;
        } else if (payload
          && payload.sourcePageId === (this.options.currentPageId ?? '')
          && Array.isArray(payload.nodes)
          && payload.nodes.length > 0) {
          draggedJson = payload.nodes;
        } else if (dragSession && dragSession.sourcePageId === (this.options.currentPageId ?? '')) {
          draggedJson = dragSession.nodes;
          if (!Array.isArray(draggedJson) || draggedJson.length === 0) return;
        } else {
          return;
        }

        const shouldDeleteSource = !event.altKey;
        const dragFrom = typeof (dragging as any)?.from === 'number'
          ? (dragging as any).from
          : typeof payload?.from === 'number'
            ? payload.from
          : typeof dragSession?.from === 'number'
            ? dragSession.from
          : editor.state.selection.from;
        const dragTo = typeof (dragging as any)?.to === 'number'
          ? (dragging as any).to
          : typeof payload?.to === 'number'
            ? payload.to
          : typeof dragSession?.to === 'number'
            ? dragSession.to
          : editor.state.selection.to;

        void (async () => {
          try {
            if (shouldDeleteSource) {
              const sourcePageId = this.options.currentPageId;
              if (!sourcePageId) return;

              const deleteTr = editor.state.tr;
              deleteTr.setMeta('addToHistory', true);
              deleteDraggedSourceFromTransaction(deleteTr, dragFrom, dragTo);
              if (!deleteTr.docChanged) {
                return;
              }

              await dataService.moveBlocksBetweenPagesAtomic({
                sourcePageId,
                targetPageId: pageId,
                sourceDoc: deleteTr.doc.toJSON(),
                appendedNodes: draggedJson,
              });

              editor.view.dispatch(deleteTr);
              clearActiveCanvasDragSession();
              return;
            }

            await dataService.appendBlocksToPage(pageId, draggedJson);
            clearActiveCanvasDragSession();
          } catch (err) {
            console.warn('[Canvas] Failed to move dropped block into linked page:', err);
          }
        })();
      });

      const pageListener = dataService?.onDidChangePage((event) => {
        const linkedPageId = attrs.pageId;
        if (!linkedPageId || event.pageId !== linkedPageId) return;
        if (!event.page) return;

        const nextTitle = event.page.title || 'Untitled';
        const nextIcon = event.page.icon ?? null;

        resolvedTitle = nextTitle;
        resolvedIcon = nextIcon;
        render();

        if (nextTitle !== attrs.title || nextIcon !== (attrs.icon ?? null)) {
          updateAttributes({ title: nextTitle, icon: nextIcon });
        }
      });

      render();
      void syncLinkedPageMeta();

      return {
        dom,
        update(updatedNode: any) {
          if (updatedNode.type.name !== 'pageBlock') return false;
          attrs = updatedNode.attrs;
          resolvedTitle = attrs.title || 'Untitled';
          resolvedIcon = attrs.icon ?? null;
          render();
          void syncLinkedPageMeta();
          return true;
        },
        destroy() {
          if (previewTimer) clearTimeout(previewTimer);
          if (hidePreviewTimer) clearTimeout(hidePreviewTimer);
          closePreview();
          closeIconPicker();
          pageListener?.dispose();
        },
      };
    };
  },
});
