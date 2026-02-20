// pageChrome.ts — Page chrome controller (ribbon, header, cover, pickers, page menu)
//
// Extracted from canvasEditorProvider.ts monolith.  Owns all page-level UI
// above and around the editor: top ribbon, page header (icon + title),
// cover image, cover picker, icon picker, page menu, and popup lifecycle.

import type { Editor } from '@tiptap/core';
import type { IEditorInput } from '../../../editor/editorInput.js';
import type { IPage, ICanvasDataService } from '../canvasTypes.js';
import type { OpenEditorFn } from '../canvasEditorProvider.js';
import { $, layoutPopup } from '../../../ui/dom.js';
import { tiptapJsonToMarkdown } from '../markdownExport.js';
import { createIconElement, resolvePageIcon, svgIcon } from '../config/iconRegistry.js';

// ── Host Interface ──────────────────────────────────────────────────────────

export interface PageChromeHost {
  readonly editor: Editor | null;
  readonly container: HTMLElement;
  readonly editorContainer: HTMLElement | null;
  readonly dataService: ICanvasDataService;
  readonly pageId: string;
  readonly input: IEditorInput | undefined;
  readonly openEditor: OpenEditorFn | undefined;
  readonly showIconPicker: (options: {
    anchor: HTMLElement;
    showSearch?: boolean;
    showRemove?: boolean;
    iconSize?: number;
    onSelect: (iconId: string) => void;
    onRemove?: () => void;
  }) => void;
  readonly showCoverPicker: (options: {
    editorContainer: HTMLElement | null;
    coverEl?: HTMLElement | null;
    pageHeader?: HTMLElement | null;
    onSelectCover: (coverUrl: string) => void;
  }) => void;
}

// ── Controller ──────────────────────────────────────────────────────────────

export class PageChromeController {
  // ── Page header elements ──
  private _topRibbon: HTMLElement | null = null;
  private _ribbonFavoriteBtn: HTMLElement | null = null;
  private _ribbonEditedLabel: HTMLElement | null = null;
  private _pageHeader: HTMLElement | null = null;
  private _coverEl: HTMLElement | null = null;
  private _coverControls: HTMLElement | null = null;
  private _breadcrumbsEl: HTMLElement | null = null;
  private _breadcrumbCurrentText: HTMLElement | null = null;
  private _iconEl: HTMLElement | null = null;
  private _titleEl: HTMLElement | null = null;
  private _hoverAffordances: HTMLElement | null = null;
  private _pageMenuBtn: HTMLElement | null = null;
  private _pageMenuDropdown: HTMLElement | null = null;
  private _emojiPicker: HTMLElement | null = null;

  // ── Page state ──
  private _currentPage: IPage | null = null;
  private _titleSaveTimer: ReturnType<typeof setTimeout> | null = null;
  private _isRepositioning = false;

  constructor(private readonly _host: PageChromeHost) {}

  // ── Public API ──────────────────────────────────────────────────────────

  get currentPage(): IPage | null { return this._currentPage; }
  set currentPage(page: IPage | null) { this._currentPage = page; }

  /** The title element (for focus delegation). */
  get titleEl(): HTMLElement | null { return this._titleEl; }

  /** The breadcrumb current-page text element. */
  get breadcrumbCurrentText(): HTMLElement | null { return this._breadcrumbCurrentText; }

  /** The icon element. */
  get iconEl(): HTMLElement | null { return this._iconEl; }

  /** Create all page chrome (ribbon, cover, header).
   *
   * @param externalRibbonContainer — If provided, the ribbon is rendered into
   *   this external container (e.g. the editor group's unified ribbon slot)
   *   instead of being prepended to the editor container.
   */
  createChrome(externalRibbonContainer?: HTMLElement): void {
    this._createTopRibbon(externalRibbonContainer);
    this._createCover();
    this._createPageHeader();
  }

  /** Sync UI after an external page change event. */
  syncPageChange(page: IPage): void {
    this._currentPage = page;

    // Update title if changed externally
    const titleHasFocus = this._titleEl === document.activeElement;
    if (this._titleEl && !titleHasFocus && page.title !== this._titleEl.textContent) {
      this._titleEl.textContent = (page.title && page.title !== 'Untitled') ? page.title : '';
    }
    // Sync tab label
    if (this._host.input && typeof (this._host.input as any).setName === 'function') {
      (this._host.input as any).setName(page.title || 'Untitled');
    }
    // Sync breadcrumb current-page text
    if (this._breadcrumbCurrentText) {
      this._breadcrumbCurrentText.textContent = page.title || 'Untitled';
    }
    // Update icon
    if (this._iconEl) {
      if (page.icon) {
        const iconId = resolvePageIcon(page.icon);
        this._iconEl.innerHTML = svgIcon(iconId);
        const svg = this._iconEl.querySelector('svg');
        if (svg) { svg.setAttribute('width', '40'); svg.setAttribute('height', '40'); }
        this._iconEl.style.display = '';
      } else {
        this._iconEl.innerHTML = '';
        this._iconEl.style.display = 'none';
      }
    }
    // Update cover
    this._refreshCover();
    // Update ribbon
    this._refreshRibbon();
  }

  /** Apply page display settings CSS classes + lock state. */
  applyPageSettings(): void {
    const ec = this._host.editorContainer;
    if (!ec) return;
    const page = this._currentPage;

    // Font family
    ec.classList.remove('canvas-font-default', 'canvas-font-serif', 'canvas-font-mono');
    ec.classList.add(`canvas-font-${page?.fontFamily || 'default'}`);

    // Full width
    ec.classList.toggle('canvas-full-width', !!page?.fullWidth);

    // Small text
    ec.classList.toggle('canvas-small-text', !!page?.smallText);

    // Lock page
    if (this._host.editor) {
      this._host.editor.setEditable(!page?.isLocked);
    }
    if (this._titleEl) {
      this._titleEl.contentEditable = page?.isLocked ? 'false' : 'true';
    }
    ec.classList.toggle('canvas-locked', !!page?.isLocked);

    // Cover presence affects header padding
    ec.classList.toggle('canvas-has-cover', !!page?.coverUrl);
  }

  /** Export page content as Markdown. */
  async exportMarkdown(): Promise<void> {
    const editor = this._host.editor;
    if (!editor || !this._currentPage) return;

    const doc = editor.getJSON();
    const title = this._currentPage.title || 'Untitled';
    const markdown = tiptapJsonToMarkdown(doc, title);

    const safeName = title.replace(/[<>:"/\\|?*]/g, '_').substring(0, 100).trim() || 'Untitled';

    const electron = (window as any).parallxElectron;
    if (!electron?.dialog?.saveFile || !electron?.fs?.writeFile) {
      console.error('[Canvas] Electron file dialog not available');
      return;
    }

    const filePath = await electron.dialog.saveFile({
      filters: [{ name: 'Markdown', extensions: ['md'] }],
      defaultName: `${safeName}.md`,
    });

    if (!filePath) return;
    await electron.fs.writeFile(filePath, markdown, 'utf-8');
  }

  dismissPopups(): void {
    if (this._emojiPicker) {
      this._emojiPicker.remove();
      this._emojiPicker = null;
    }
    if (this._pageMenuDropdown) {
      this._pageMenuDropdown.remove();
      this._pageMenuDropdown = null;
    }
    document.removeEventListener('mousedown', this._handlePopupOutsideClick);
    document.removeEventListener('keydown', this._handlePopupEscape);
  }

  dispose(): void {
    this.dismissPopups();
    if (this._titleSaveTimer) clearTimeout(this._titleSaveTimer);
    this._topRibbon = null;
    this._ribbonFavoriteBtn = null;
    this._ribbonEditedLabel = null;
    this._pageHeader = null;
    this._coverEl = null;
    this._coverControls = null;
    this._breadcrumbsEl = null;
    this._iconEl = null;
    this._titleEl = null;
    this._hoverAffordances = null;
    this._pageMenuBtn = null;
    this._currentPage = null;
  }

  // ── Top Ribbon ──────────────────────────────────────────────────────────

  /**
   * Build the top ribbon (breadcrumbs + timestamp + star + ⋯ menu).
   *
   * @param externalContainer — If provided, the ribbon is appended here
   *   (the editor-group-level ribbon slot) instead of prepended to `ec`.
   */
  private _createTopRibbon(externalContainer?: HTMLElement): void {
    const ec = this._host.editorContainer;
    if (!ec && !externalContainer) return;

    this._topRibbon = $('div.canvas-top-ribbon');

    // ── Left: breadcrumbs ──
    const ribbonLeft = $('div.canvas-top-ribbon-left');
    this._breadcrumbsEl = $('div.canvas-breadcrumbs');
    ribbonLeft.appendChild(this._breadcrumbsEl);
    this._loadBreadcrumbs();
    this._topRibbon.appendChild(ribbonLeft);

    // ── Right: edited timestamp, favorite star, ⋯ menu ──
    const ribbonRight = $('div.canvas-top-ribbon-right');

    // Edited timestamp
    this._ribbonEditedLabel = $('span.canvas-top-ribbon-edited');
    this._ribbonEditedLabel.textContent = this._formatRelativeTime(this._currentPage?.updatedAt);
    ribbonRight.appendChild(this._ribbonEditedLabel);

    // Favorite star toggle
    this._ribbonFavoriteBtn = $('button.canvas-top-ribbon-btn.canvas-top-ribbon-favorite');
    this._ribbonFavoriteBtn.title = 'Add to Favorites';
    this._updateFavoriteIcon();
    this._ribbonFavoriteBtn.addEventListener('click', (e) => {
      e.stopPropagation();
      this._host.dataService.toggleFavorite(this._host.pageId);
    });
    ribbonRight.appendChild(this._ribbonFavoriteBtn);

    // ⋯ Page menu button
    this._pageMenuBtn = $('button.canvas-top-ribbon-btn.canvas-top-ribbon-menu');
    this._pageMenuBtn.innerHTML = svgIcon('ellipsis');
    const menuSvg = this._pageMenuBtn.querySelector('svg');
    if (menuSvg) { menuSvg.setAttribute('width', '16'); menuSvg.setAttribute('height', '16'); }
    this._pageMenuBtn.title = 'Page settings';
    this._pageMenuBtn.addEventListener('click', (e) => {
      e.stopPropagation();
      this._showPageMenu();
    });
    ribbonRight.appendChild(this._pageMenuBtn);

    this._topRibbon.appendChild(ribbonRight);

    // Mount into the provided external container, or prepend in-pane
    if (externalContainer) {
      externalContainer.appendChild(this._topRibbon);
    } else if (ec) {
      ec.prepend(this._topRibbon);
    }
  }

  private _updateFavoriteIcon(): void {
    if (!this._ribbonFavoriteBtn) return;
    const isFav = !!this._currentPage?.isFavorited;
    const iconId = isFav ? 'star-filled' : 'star';
    this._ribbonFavoriteBtn.innerHTML = svgIcon(iconId);
    const svg = this._ribbonFavoriteBtn.querySelector('svg');
    if (svg) { svg.setAttribute('width', '16'); svg.setAttribute('height', '16'); }
    this._ribbonFavoriteBtn.classList.toggle('canvas-top-ribbon-favorite--active', isFav);
    this._ribbonFavoriteBtn.title = isFav ? 'Remove from Favorites' : 'Add to Favorites';
  }

  private _refreshRibbon(): void {
    if (this._ribbonEditedLabel) {
      this._ribbonEditedLabel.textContent = this._formatRelativeTime(this._currentPage?.updatedAt);
    }
    this._updateFavoriteIcon();
  }

  private _formatRelativeTime(isoStr?: string | null): string {
    if (!isoStr) return '';
    const diff = Date.now() - new Date(isoStr).getTime();
    const seconds = Math.floor(diff / 1000);
    if (seconds < 60) return 'Edited just now';
    const minutes = Math.floor(seconds / 60);
    if (minutes < 60) return `Edited ${minutes}m ago`;
    const hours = Math.floor(minutes / 60);
    if (hours < 24) return `Edited ${hours}h ago`;
    const days = Math.floor(hours / 24);
    if (days < 30) return `Edited ${days}d ago`;
    const months = Math.floor(days / 30);
    return `Edited ${months}mo ago`;
  }

  // ── Page Header ─────────────────────────────────────────────────────────

  private _createPageHeader(): void {
    const ec = this._host.editorContainer;
    if (!ec) return;

    this._pageHeader = $('div.canvas-page-header');

    // ── Icon (large, clickable — SVG) ──
    this._iconEl = $('span.canvas-page-icon');
    const pageIconId = resolvePageIcon(this._currentPage?.icon);
    if (this._currentPage?.icon) {
      this._iconEl.innerHTML = svgIcon(pageIconId);
      const svg = this._iconEl.querySelector('svg');
      if (svg) { svg.setAttribute('width', '40'); svg.setAttribute('height', '40'); }
      this._iconEl.style.display = '';
    } else {
      this._iconEl.style.display = 'none';
    }
    this._iconEl.title = 'Change icon';
    this._iconEl.addEventListener('mousedown', (e) => {
      e.preventDefault();
    });
    this._iconEl.addEventListener('click', (e) => {
      e.stopPropagation();
      this._showIconPicker();
    });
    this._pageHeader.appendChild(this._iconEl);

    // ── Hover affordances (Add icon / Add cover) ──
    this._hoverAffordances = $('div.canvas-page-affordances');

    if (!this._currentPage?.icon) {
      const addIconBtn = $('button.canvas-affordance-btn');
      addIconBtn.dataset.action = 'add-icon';
      addIconBtn.appendChild(createIconElement('smile', 14));
      const lbl = $('span'); lbl.textContent = 'Add icon';
      addIconBtn.appendChild(lbl);
      addIconBtn.addEventListener('mousedown', (e) => { e.preventDefault(); });
      addIconBtn.addEventListener('click', (e) => {
        e.stopPropagation();
        this._showIconPicker();
      });
      this._hoverAffordances.appendChild(addIconBtn);
    }

    if (!this._currentPage?.coverUrl) {
      const addCoverBtn = $('button.canvas-affordance-btn');
      addCoverBtn.dataset.action = 'add-cover';
      addCoverBtn.appendChild(createIconElement('image', 14));
      const lbl2 = $('span'); lbl2.textContent = 'Add cover';
      addCoverBtn.appendChild(lbl2);
      addCoverBtn.addEventListener('mousedown', (e) => { e.preventDefault(); });
      addCoverBtn.addEventListener('click', (e) => {
        e.stopPropagation();
        this._showCoverPicker();
      });
      this._hoverAffordances.appendChild(addCoverBtn);
    }

    this._pageHeader.appendChild(this._hoverAffordances);

    // ── Title (contenteditable) ──
    this._titleEl = $('div.canvas-page-title');
    this._titleEl.contentEditable = 'true';
    this._titleEl.spellcheck = false;
    this._titleEl.setAttribute('data-placeholder', 'Untitled');
    const displayTitle = this._currentPage?.title;
    this._titleEl.textContent = (displayTitle && displayTitle !== 'Untitled') ? displayTitle : '';

    // Title input → debounced save + immediate tab label + breadcrumb sync
    this._titleEl.addEventListener('input', () => {
      const newTitle = this._titleEl?.textContent?.trim() || 'Untitled';
      if (this._host.input && typeof (this._host.input as any).setName === 'function') {
        (this._host.input as any).setName(newTitle);
      }
      if (this._breadcrumbCurrentText) {
        this._breadcrumbCurrentText.textContent = newTitle;
      }
      if (this._titleSaveTimer) clearTimeout(this._titleSaveTimer);
      this._titleSaveTimer = setTimeout(() => {
        this._host.dataService.updatePage(this._host.pageId, { title: newTitle });
      }, 300);
    });

    // Enter → move focus to editor, prevent newline
    this._titleEl.addEventListener('keydown', (e) => {
      if (e.key === 'Enter') {
        e.preventDefault();
        this._host.editor?.commands.focus('start');
      }
    });

    // Paste → strip to plain text, prevent newlines
    this._titleEl.addEventListener('paste', (e) => {
      e.preventDefault();
      const text = e.clipboardData?.getData('text/plain')?.replace(/[\r\n]+/g, ' ') || '';
      document.execCommand('insertText', false, text);
    });

    this._pageHeader.appendChild(this._titleEl);

    // Insert header AFTER the cover element so DOM order is: cover → header → editor
    if (this._coverEl) {
      this._coverEl.after(this._pageHeader);
    } else {
      ec.prepend(this._pageHeader);
    }
  }

  private async _loadBreadcrumbs(): Promise<void> {
    if (!this._breadcrumbsEl || !this._host.pageId) return;
    try {
      const ancestors = await this._host.dataService.getAncestors(this._host.pageId);
      this._breadcrumbsEl.style.display = '';
      this._breadcrumbsEl.innerHTML = '';

      for (let i = 0; i < ancestors.length; i++) {
        const crumb = $('span.canvas-breadcrumb');
        const crumbIcon = createIconElement(resolvePageIcon(ancestors[i].icon), 14);
        crumb.appendChild(crumbIcon);
        const crumbText = $('span');
        crumbText.textContent = ancestors[i].title;
        crumb.appendChild(crumbText);
        crumb.addEventListener('click', () => {
          this._host.openEditor?.({
            typeId: 'canvas',
            title: ancestors[i].title,
            icon: ancestors[i].icon ?? undefined,
            instanceId: ancestors[i].id,
          });
        });
        this._breadcrumbsEl.appendChild(crumb);

        const sep = $('span.canvas-breadcrumb-sep');
        sep.textContent = '›';
        this._breadcrumbsEl.appendChild(sep);
      }

      const currentCrumb = $('span.canvas-breadcrumb.canvas-breadcrumb--current');
      const currentIcon = createIconElement(resolvePageIcon(this._currentPage?.icon), 14);
      currentCrumb.appendChild(currentIcon);
      this._breadcrumbCurrentText = $('span');
      this._breadcrumbCurrentText.textContent = this._currentPage?.title || 'Untitled';
      currentCrumb.appendChild(this._breadcrumbCurrentText);
      this._breadcrumbsEl.appendChild(currentCrumb);
    } catch {
      this._breadcrumbsEl.style.display = 'none';
    }
  }

  // ── Cover Image ─────────────────────────────────────────────────────────

  private _createCover(): void {
    const ec = this._host.editorContainer;
    if (!ec) return;

    this._coverEl = $('div.canvas-page-cover');
    this._coverControls = $('div.canvas-cover-controls');

    const repositionBtn = $('button.canvas-cover-btn.canvas-cover-reposition-btn');
    repositionBtn.textContent = 'Reposition';
    repositionBtn.addEventListener('click', (e) => {
      e.stopPropagation();
      this._startCoverReposition();
    });

    const changeBtn = $('button.canvas-cover-btn');
    changeBtn.textContent = 'Change cover';
    changeBtn.addEventListener('click', (e) => {
      e.stopPropagation();
      this._showCoverPicker();
    });

    const removeBtn = $('button.canvas-cover-btn');
    removeBtn.textContent = 'Remove';
    removeBtn.addEventListener('click', (e) => {
      e.stopPropagation();
      this._host.dataService.updatePage(this._host.pageId, { coverUrl: null });
    });

    this._coverControls.appendChild(repositionBtn);
    this._coverControls.appendChild(changeBtn);
    this._coverControls.appendChild(removeBtn);
    this._coverEl.appendChild(this._coverControls);

    if (this._topRibbon) {
      this._topRibbon.after(this._coverEl);
    } else {
      ec.prepend(this._coverEl);
    }
    this._refreshCover();
  }

  private _refreshCover(): void {
    if (!this._coverEl || !this._coverControls) return;
    const url = this._currentPage?.coverUrl;
    if (!url) {
      this._coverEl.style.display = 'none';
      this._refreshHoverAffordances();
      return;
    }
    this._coverEl.style.display = '';
    const yPct = ((this._currentPage?.coverYOffset ?? 0.5) * 100).toFixed(1);

    const isGradient = url.startsWith('linear-gradient') || url.startsWith('radial-gradient');
    if (isGradient) {
      this._coverEl.style.backgroundImage = url;
      this._coverEl.style.backgroundPosition = '';
      this._coverEl.style.backgroundSize = '';
    } else {
      this._coverEl.style.backgroundImage = `url(${url})`;
      this._coverEl.style.backgroundPosition = `center ${yPct}%`;
      this._coverEl.style.backgroundSize = 'cover';
    }
    this._refreshHoverAffordances();
  }

  private _refreshHoverAffordances(): void {
    if (!this._hoverAffordances) return;
    this._hoverAffordances.innerHTML = '';

    if (!this._currentPage?.icon) {
      const addIconBtn = $('button.canvas-affordance-btn');
      addIconBtn.dataset.action = 'add-icon';
      addIconBtn.appendChild(createIconElement('smile', 14));
      const lbl = $('span'); lbl.textContent = 'Add icon';
      addIconBtn.appendChild(lbl);
      addIconBtn.addEventListener('mousedown', (e) => { e.preventDefault(); });
      addIconBtn.addEventListener('click', (e) => {
        e.stopPropagation();
        this._showIconPicker();
      });
      this._hoverAffordances.appendChild(addIconBtn);
    }

    if (!this._currentPage?.coverUrl) {
      const addCoverBtn = $('button.canvas-affordance-btn');
      addCoverBtn.dataset.action = 'add-cover';
      addCoverBtn.appendChild(createIconElement('image', 14));
      const lbl2 = $('span'); lbl2.textContent = 'Add cover';
      addCoverBtn.appendChild(lbl2);
      addCoverBtn.addEventListener('mousedown', (e) => { e.preventDefault(); });
      addCoverBtn.addEventListener('click', (e) => {
        e.stopPropagation();
        this._showCoverPicker();
      });
      this._hoverAffordances.appendChild(addCoverBtn);
    }
  }

  private _startCoverReposition(): void {
    if (!this._coverEl || !this._currentPage?.coverUrl || this._isRepositioning) return;

    this._isRepositioning = true;

    const overlay = $('div.canvas-cover-reposition-overlay');
    overlay.textContent = 'Drag image to reposition';
    this._coverEl.appendChild(overlay);
    this._coverEl.classList.add('canvas-cover--repositioning');

    if (this._coverControls) {
      this._coverControls.style.display = 'none';
    }

    let startY = 0;
    let startOffset = this._currentPage?.coverYOffset ?? 0.5;

    const onMouseDown = (e: MouseEvent) => {
      e.preventDefault();
      startY = e.clientY;
      startOffset = this._currentPage?.coverYOffset ?? 0.5;
      document.addEventListener('mousemove', onMouseMove);
      document.addEventListener('mouseup', onMouseUp);
    };

    const onMouseMove = (e: MouseEvent) => {
      e.preventDefault();
      const delta = (startY - e.clientY) / (this._coverEl?.offsetHeight ?? 200);
      const newOffset = Math.max(0, Math.min(1, startOffset + delta));
      const yPct = (newOffset * 100).toFixed(1);
      if (this._coverEl) {
        this._coverEl.style.backgroundPosition = `center ${yPct}%`;
      }
      if (this._currentPage) {
        (this._currentPage as any).coverYOffset = newOffset;
      }
    };

    const onMouseUp = () => {
      document.removeEventListener('mousemove', onMouseMove);
      document.removeEventListener('mouseup', onMouseUp);
      const finalOffset = this._currentPage?.coverYOffset ?? 0.5;
      this._host.dataService.updatePage(this._host.pageId, { coverYOffset: finalOffset });
    };

    const originalOffset = this._currentPage?.coverYOffset ?? 0.5;

    overlay.addEventListener('mousedown', onMouseDown);

    const actionBar = $('div.canvas-cover-reposition-actions');

    const cancelBtn = $('button.canvas-cover-btn');
    cancelBtn.textContent = 'Cancel';
    cancelBtn.addEventListener('click', (e) => {
      e.stopPropagation();
      document.removeEventListener('mousemove', onMouseMove);
      document.removeEventListener('mouseup', onMouseUp);
      if (this._currentPage) {
        (this._currentPage as any).coverYOffset = originalOffset;
      }
      const yPct = (originalOffset * 100).toFixed(1);
      if (this._coverEl) {
        this._coverEl.style.backgroundPosition = `center ${yPct}%`;
      }
      overlay.remove();
      actionBar.remove();
      this._coverEl?.classList.remove('canvas-cover--repositioning');
      if (this._coverControls) {
        this._coverControls.style.display = '';
      }
      this._isRepositioning = false;
    });
    actionBar.appendChild(cancelBtn);

    const saveBtn = $('button.canvas-cover-btn.canvas-cover-btn--primary');
    saveBtn.textContent = 'Save position';
    saveBtn.addEventListener('click', (e) => {
      e.stopPropagation();
      document.removeEventListener('mousemove', onMouseMove);
      document.removeEventListener('mouseup', onMouseUp);
      overlay.remove();
      actionBar.remove();
      this._coverEl?.classList.remove('canvas-cover--repositioning');
      if (this._coverControls) {
        this._coverControls.style.display = '';
      }
      this._isRepositioning = false;
      const finalOffset = this._currentPage?.coverYOffset ?? 0.5;
      this._host.dataService.updatePage(this._host.pageId, { coverYOffset: finalOffset });
    });
    actionBar.appendChild(saveBtn);

    this._coverEl.appendChild(actionBar);
  }

  // ── Cover Picker ────────────────────────────────────────────────────────

  private _showCoverPicker(): void {
    this.dismissPopups();

    this._host.showCoverPicker({
      editorContainer: this._host.editorContainer,
      coverEl: this._coverEl,
      pageHeader: this._pageHeader,
      onSelectCover: (coverUrl) => {
        this._host.dataService.updatePage(this._host.pageId, { coverUrl });
      },
    });
  }

  // ── Icon Picker ─────────────────────────────────────────────────────────

  private _showIconPicker(): void {
    this.dismissPopups();

    const anchor = (this._iconEl?.style.display !== 'none' ? this._iconEl : this._pageHeader) ?? this._host.container;

    this._host.showIconPicker({
      anchor,
      showSearch: true,
      showRemove: !!this._currentPage?.icon,
      iconSize: 22,
      onSelect: (id) => {
        this._host.dataService.updatePage(this._host.pageId, { icon: id });
      },
      onRemove: () => {
        this._host.dataService.updatePage(this._host.pageId, { icon: null as any });
      },
    });
  }

  // ── Page Menu ───────────────────────────────────────────────────────────

  /** Show the page settings menu (callable from external ribbon ⋯ button). */
  showPageMenu(): void {
    this._showPageMenu();
  }

  private _showPageMenu(): void {
    if (this._pageMenuDropdown) { this.dismissPopups(); return; }
    this.dismissPopups();

    this._pageMenuDropdown = $('div.canvas-page-menu');
    const page = this._currentPage;

    // ── Font selection ──
    const fontLabel = $('div.canvas-page-menu-label');
    fontLabel.textContent = 'Font';
    this._pageMenuDropdown.appendChild(fontLabel);

    const fonts: { id: 'default' | 'serif' | 'mono'; label: string }[] = [
      { id: 'default', label: 'Default' },
      { id: 'serif', label: 'Serif' },
      { id: 'mono', label: 'Mono' },
    ];

    const fontGroup = $('div.canvas-page-menu-font-group');
    for (const font of fonts) {
      const btn = $('button.canvas-page-menu-font-btn');
      btn.classList.add(`canvas-font-preview-${font.id}`);
      btn.textContent = font.label;
      if (page?.fontFamily === font.id) btn.classList.add('canvas-page-menu-font-btn--active');
      btn.addEventListener('click', () => {
        this._host.dataService.updatePage(this._host.pageId, { fontFamily: font.id });
        fontGroup.querySelectorAll('.canvas-page-menu-font-btn').forEach(b => b.classList.remove('canvas-page-menu-font-btn--active'));
        btn.classList.add('canvas-page-menu-font-btn--active');
      });
      fontGroup.appendChild(btn);
    }
    this._pageMenuDropdown.appendChild(fontGroup);

    // ── Toggles ──
    const toggles: { label: string; key: 'fullWidth' | 'smallText' | 'isLocked'; iconId: string }[] = [
      { label: 'Full width', key: 'fullWidth', iconId: 'expand-width' },
      { label: 'Small text', key: 'smallText', iconId: 'text-size' },
      { label: 'Lock page', key: 'isLocked', iconId: 'lock' },
    ];

    for (const toggle of toggles) {
      const row = $('div.canvas-page-menu-toggle');
      const label = $('span.canvas-page-menu-toggle-label');
      label.appendChild(createIconElement(toggle.iconId as any, 14));
      const labelText = $('span');
      labelText.textContent = ` ${toggle.label}`;
      label.appendChild(labelText);
      const switchEl = $('div.canvas-page-menu-switch');
      const isOn = !!(page as any)?.[toggle.key];
      if (isOn) switchEl.classList.add('canvas-page-menu-switch--on');

      row.appendChild(label);
      row.appendChild(switchEl);
      row.addEventListener('click', () => {
        const current = !!(this._currentPage as any)?.[toggle.key];
        this._host.dataService.updatePage(this._host.pageId, { [toggle.key]: !current } as any);
        switchEl.classList.toggle('canvas-page-menu-switch--on');
      });
      this._pageMenuDropdown.appendChild(row);
    }

    // ── Divider ──
    this._pageMenuDropdown.appendChild($('div.canvas-page-menu-divider'));

    // ── Action buttons ──
    const actions: { label: string; iconId: string; action: () => void; danger?: boolean }[] = [
      {
        label: 'Favorite',
        iconId: 'star',
        action: () => {
          this._host.dataService.toggleFavorite(this._host.pageId);
          this.dismissPopups();
        },
      },
      {
        label: 'Duplicate',
        iconId: 'duplicate',
        action: async () => {
          try {
            const newPage = await this._host.dataService.duplicatePage(this._host.pageId);
            const input = this._host.input as any;
            if (input?._api?.editors) {
              input._api.editors.openEditor({
                typeId: 'canvas',
                title: newPage.title,
                icon: newPage.icon ?? undefined,
                instanceId: newPage.id,
              });
            }
          } catch (err) {
            console.error('[Canvas] Duplicate failed:', err);
          }
          this.dismissPopups();
        },
      },
      {
        label: 'Export Markdown',
        iconId: 'export',
        action: async () => {
          try {
            await this.exportMarkdown();
          } catch (err) {
            console.error('[Canvas] Export failed:', err);
          }
          this.dismissPopups();
        },
      },
      {
        label: 'Delete',
        iconId: 'trash',
        action: () => {
          this._host.dataService.archivePage(this._host.pageId);
          this.dismissPopups();
        },
        danger: true,
      },
    ];

    if (page?.isFavorited) {
      actions[0].label = 'Remove from Favorites';
      actions[0].iconId = 'star-filled';
    }

    for (const act of actions) {
      const btn = $('button.canvas-page-menu-action');
      btn.appendChild(createIconElement(act.iconId as any, 14));
      const actLabel = $('span');
      actLabel.textContent = ` ${act.label}`;
      btn.appendChild(actLabel);
      if (act.danger) btn.classList.add('canvas-page-menu-action--danger');
      btn.addEventListener('click', act.action);
      this._pageMenuDropdown.appendChild(btn);
    }

    document.body.appendChild(this._pageMenuDropdown);

    // Position below menu button (right-aligned)
    if (this._pageMenuBtn) {
      const rect = this._pageMenuBtn.getBoundingClientRect();
      const menuW = this._pageMenuDropdown.offsetWidth;
      layoutPopup(this._pageMenuDropdown, { x: rect.right - menuW, y: rect.bottom }, { gap: 4 });
    }

    setTimeout(() => {
      document.addEventListener('mousedown', this._handlePopupOutsideClick);
    }, 0);
    document.addEventListener('keydown', this._handlePopupEscape);
  }

  // ── Popup Dismiss Helpers ───────────────────────────────────────────────

  private readonly _handlePopupOutsideClick = (e: MouseEvent): void => {
    const target = e.target as HTMLElement;
    if (
      this._emojiPicker?.contains(target) ||
      this._pageMenuDropdown?.contains(target) ||
      this._pageMenuBtn?.contains(target) ||
      this._iconEl?.contains(target) ||
      this._hoverAffordances?.contains(target) ||
      this._coverControls?.contains(target)
    ) return;
    this.dismissPopups();
  };

  private readonly _handlePopupEscape = (e: KeyboardEvent): void => {
    if (e.key === 'Escape') {
      this.dismissPopups();
    }
  };
}
