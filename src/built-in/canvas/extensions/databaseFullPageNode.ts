// databaseFullPageNode.ts — Full-page database block
//
// Atom block that links to a database page. Renders as a card with database
// icon + title (identical visual treatment to pageBlock). Click opens the
// full-page database editor. Supports icon picking and live title/icon sync.
//
// Gate architecture: child of BlockRegistry — imports ONLY from blockRegistry.

import { Node, mergeAttributes } from '@tiptap/core';
import {
  resolvePageIcon,
  svgIcon,
} from '../config/blockRegistry.js';
import { layoutPopup } from '../../../ui/dom.js';

// ── Local narrow types ──────────────────────────────────────────────────────
// Follows the same structural-typing pattern as pageBlockNode.ts — define
// narrow shapes instead of importing shared types from canvasTypes.ts.

/** Narrow page shape — only the fields this block reads. */
export interface IDatabaseFullPagePage {
  readonly id: string;
  readonly title: string;
  readonly icon: string | null;
}

/** Narrow change-event shape. */
export interface IDatabaseFullPageChangeEvent {
  readonly pageId: string;
  readonly page?: IDatabaseFullPagePage;
}

export interface IDatabaseFullPageDataAccess {
  getPage(pageId: string): Promise<IDatabaseFullPagePage | null>;
  updatePage(pageId: string, updates: { icon?: string | null }): Promise<IDatabaseFullPagePage>;
  readonly onDidChangePage: (listener: (e: IDatabaseFullPageChangeEvent) => void) => { dispose(): void };
}

export interface DatabaseFullPageOptions {
  readonly dataService?: IDatabaseFullPageDataAccess;
  readonly openEditor?: (options: { typeId: string; title: string; icon?: string; instanceId?: string }) => Promise<void>;
  readonly showIconPicker?: (options: {
    anchor: HTMLElement;
    showSearch?: boolean;
    showRemove?: boolean;
    iconSize?: number;
    onSelect: (iconId: string) => void;
    onRemove?: () => void;
  }) => void;
}

export const DatabaseFullPage = Node.create<DatabaseFullPageOptions>({
  name: 'databaseFullPage',
  group: 'block',
  atom: true,
  selectable: true,
  draggable: true,

  addOptions() {
    return {
      dataService: undefined,
      openEditor: undefined,
      showIconPicker: undefined,
    };
  },

  addAttributes() {
    return {
      databaseId: { default: '' },
      title: { default: 'Untitled' },
      icon: { default: 'database' },
    };
  },

  parseHTML() {
    return [{ tag: 'div[data-type="databaseFullPage"]' }];
  },

  renderHTML({ HTMLAttributes }: { HTMLAttributes: Record<string, any> }) {
    return [
      'div',
      mergeAttributes(HTMLAttributes, {
        'data-type': 'databaseFullPage',
        class: 'canvas-page-block canvas-database-full-page-block',
      }),
    ];
  },

  addNodeView() {
    return ({ node, editor, updateAttributes }: any) => {
      let attrs = node.attrs as { databaseId?: string; title?: string; icon?: string | null };
      let resolvedTitle = attrs.title || 'Untitled';
      let resolvedIcon: string | null = attrs.icon ?? 'database';
      let previewPopup: HTMLElement | null = null;
      let previewTimer: ReturnType<typeof setTimeout> | null = null;
      let hidePreviewTimer: ReturnType<typeof setTimeout> | null = null;
      const dataService = this.options.dataService;

      // ── DOM structure ─────────────────────────────────────────────────
      // Reuses the same CSS classes as pageBlock for visual consistency.
      const dom = document.createElement('div');
      dom.classList.add('canvas-page-block', 'canvas-database-full-page-block');
      dom.setAttribute('data-type', 'databaseFullPage');
      dom.contentEditable = 'false';
      dom.draggable = false;
      dom.tabIndex = 0;

      const card = document.createElement('div');
      card.classList.add('canvas-page-block-card');
      dom.appendChild(card);

      const iconBtn = document.createElement('button');
      iconBtn.classList.add('canvas-page-block-icon');
      iconBtn.type = 'button';
      iconBtn.title = 'Change database icon';
      card.appendChild(iconBtn);

      const body = document.createElement('div');
      body.classList.add('canvas-page-block-body');
      card.appendChild(body);

      const titleEl = document.createElement('div');
      titleEl.classList.add('canvas-page-block-title');
      body.appendChild(titleEl);

      // ── Helpers ────────────────────────────────────────────────────────

      const closePreview = () => {
        if (previewPopup) {
          previewPopup.remove();
          previewPopup = null;
        }
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

      const openDatabase = () => {
        const dbId = attrs.databaseId;
        if (!dbId || !this.options.openEditor) return;
        void this.options.openEditor({
          typeId: 'database',
          title: resolvedTitle || 'Untitled',
          icon: resolvedIcon ?? undefined,
          instanceId: dbId,
        });
      };

      const showIconPicker = () => {
        closePreview();
        this.options.showIconPicker?.({
          anchor: dom,
          showSearch: false,
          showRemove: true,
          iconSize: 18,
          onSelect: (iconId) => {
            const dbId = attrs.databaseId;
            if (dbId && dataService) {
              void (async () => {
                await dataService.updatePage(dbId, { icon: iconId });
                resolvedIcon = iconId;
                render();
                updateAttributes({ icon: iconId });
              })();
            }
          },
          onRemove: () => {
            const dbId = attrs.databaseId;
            if (dbId && dataService) {
              void (async () => {
                await dataService.updatePage(dbId, { icon: null });
                resolvedIcon = null;
                render();
                updateAttributes({ icon: null });
              })();
            }
          },
        });
      };

      const syncLinkedPageMeta = async () => {
        const dbId = attrs.databaseId;
        if (!dataService || !dbId) return;
        try {
          const linked = await dataService.getPage(dbId);
          if (!linked) return;

          const nextTitle = linked.title || 'Untitled';
          const nextIcon = linked.icon ?? 'database';

          resolvedTitle = nextTitle;
          resolvedIcon = nextIcon;
          render();

          if (nextTitle !== attrs.title || nextIcon !== (attrs.icon ?? 'database')) {
            updateAttributes({ title: nextTitle, icon: nextIcon });
          }
        } catch {
          // Ignore transient lookup failures.
        }
      };

      const schedulePreview = () => {
        if (previewTimer) clearTimeout(previewTimer);
        if (hidePreviewTimer) clearTimeout(hidePreviewTimer);
        previewTimer = setTimeout(() => {
          // Lightweight tooltip showing it's a database
          const popup = document.createElement('div');
          popup.classList.add('canvas-page-block-preview');
          const title = document.createElement('div');
          title.classList.add('canvas-page-block-preview-title');
          title.textContent = resolvedTitle || 'Untitled';
          popup.appendChild(title);
          const snippet = document.createElement('div');
          snippet.classList.add('canvas-page-block-preview-snippet');
          snippet.textContent = 'Full-page database — click to open';
          popup.appendChild(snippet);

          closePreview();
          previewPopup = popup;
          document.body.appendChild(popup);
          const rect = dom.getBoundingClientRect();
          layoutPopup(popup, rect, { position: 'below', gap: 6 });
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

      // ── Events ────────────────────────────────────────────────────────

      card.addEventListener('click', (event) => {
        if ((event.target as HTMLElement).closest('.canvas-page-block-icon')) return;
        if (editor.view.dom.classList.contains('dragging')) return;
        event.preventDefault();
        event.stopPropagation();
        openDatabase();
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
        openDatabase();
      });

      dom.addEventListener('mouseenter', () => schedulePreview());
      dom.addEventListener('mouseleave', () => scheduleHidePreview());

      dom.addEventListener('dragstart', (event) => {
        event.preventDefault();
        event.stopPropagation();
      });

      // ── Live sync ─────────────────────────────────────────────────────

      const pageListener = dataService?.onDidChangePage((event) => {
        const dbId = attrs.databaseId;
        if (!dbId || event.pageId !== dbId) return;
        if (!event.page) return;

        const nextTitle = event.page.title || 'Untitled';
        const nextIcon = event.page.icon ?? 'database';

        resolvedTitle = nextTitle;
        resolvedIcon = nextIcon;
        render();

        if (nextTitle !== attrs.title || nextIcon !== (attrs.icon ?? 'database')) {
          if (typeof updateAttributes === 'function') {
            updateAttributes({ title: nextTitle, icon: nextIcon });
          }
        }
      });

      // ── Initial render ────────────────────────────────────────────────

      render();
      void syncLinkedPageMeta();

      return {
        dom,
        update(updatedNode: any) {
          if (updatedNode.type.name !== 'databaseFullPage') return false;
          attrs = updatedNode.attrs;
          resolvedTitle = attrs.title || 'Untitled';
          resolvedIcon = attrs.icon ?? 'database';
          render();
          void syncLinkedPageMeta();
          return true;
        },
        destroy() {
          if (previewTimer) clearTimeout(previewTimer);
          if (hidePreviewTimer) clearTimeout(hidePreviewTimer);
          closePreview();
          pageListener?.dispose();
        },
      };
    };
  },
});
