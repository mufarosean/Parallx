// pageChrome.ts — Page chrome controller (ribbon, header, cover, pickers, page menu)
//
// Extracted from canvasEditorProvider.ts monolith.  Owns all page-level UI
// above and around the editor: top ribbon, page header (icon + title),
// cover image, cover picker, icon picker, page menu, and popup lifecycle.

import type { Editor } from '@tiptap/core';
import type { IEditorInput } from '../../../editor/editorInput.js';
import type { CanvasDataService } from '../canvasDataService.js';
import type { IPage } from '../canvasTypes.js';
import type { OpenEditorFn } from '../canvasEditorProvider.js';
import { $ } from '../../../ui/dom.js';
import { tiptapJsonToMarkdown } from '../markdownExport.js';
import { createIconElement, resolvePageIcon, svgIcon, PAGE_ICON_IDS } from '../canvasIcons.js';

// ── Host Interface ──────────────────────────────────────────────────────────

export interface PageChromeHost {
  readonly editor: Editor | null;
  readonly container: HTMLElement;
  readonly editorContainer: HTMLElement | null;
  readonly dataService: CanvasDataService;
  readonly pageId: string;
  readonly input: IEditorInput | undefined;
  readonly openEditor: OpenEditorFn | undefined;
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
  private _iconPicker: HTMLElement | null = null;
  private _coverPicker: HTMLElement | null = null;

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

  /** Create all page chrome (ribbon, cover, header). */
  createChrome(): void {
    this._createTopRibbon();
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
    if (this._iconPicker) {
      this._iconPicker.remove();
      this._iconPicker = null;
    }
    if (this._coverPicker) {
      this._coverPicker.remove();
      this._coverPicker = null;
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

  private _createTopRibbon(): void {
    const ec = this._host.editorContainer;
    if (!ec) return;

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
    ec.prepend(this._topRibbon);
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
    if (this._coverPicker) { this.dismissPopups(); return; }
    this.dismissPopups();

    this._coverPicker = $('div.canvas-cover-picker');

    // ── Tab bar ──
    const tabs = $('div.canvas-cover-picker-tabs');
    const tabGallery = $('button.canvas-cover-picker-tab.canvas-cover-picker-tab--active');
    tabGallery.textContent = 'Gallery';
    const tabUpload = $('button.canvas-cover-picker-tab');
    tabUpload.textContent = 'Upload';
    const tabLink = $('button.canvas-cover-picker-tab');
    tabLink.textContent = 'Link';
    tabs.appendChild(tabGallery);
    tabs.appendChild(tabUpload);
    tabs.appendChild(tabLink);
    this._coverPicker.appendChild(tabs);

    // ── Content area ──
    const content = $('div.canvas-cover-picker-content');
    this._coverPicker.appendChild(content);

    // Gallery (default view)
    const GRADIENTS = [
      'linear-gradient(135deg, #667eea 0%, #764ba2 100%)',
      'linear-gradient(135deg, #f093fb 0%, #f5576c 100%)',
      'linear-gradient(135deg, #4facfe 0%, #00f2fe 100%)',
      'linear-gradient(135deg, #43e97b 0%, #38f9d7 100%)',
      'linear-gradient(135deg, #fa709a 0%, #fee140 100%)',
      'linear-gradient(135deg, #a18cd1 0%, #fbc2eb 100%)',
      'linear-gradient(135deg, #ffecd2 0%, #fcb69f 100%)',
      'linear-gradient(135deg, #667eea 0%, #f093fb 100%)',
      'linear-gradient(180deg, #2c3e50 0%, #3498db 100%)',
      'linear-gradient(180deg, #141e30 0%, #243b55 100%)',
      'linear-gradient(135deg, #0c0c0c 0%, #1a1a2e 100%)',
      'linear-gradient(180deg, #232526 0%, #414345 100%)',
    ];

    const renderGallery = () => {
      content.innerHTML = '';
      const grid = $('div.canvas-cover-gallery');
      for (const grad of GRADIENTS) {
        const swatch = $('div.canvas-cover-swatch');
        swatch.style.background = grad;
        swatch.addEventListener('click', () => {
          this._host.dataService.updatePage(this._host.pageId, { coverUrl: grad });
          this.dismissPopups();
        });
        grid.appendChild(swatch);
      }
      content.appendChild(grid);
    };

    const renderUpload = () => {
      content.innerHTML = '';
      const uploadBtn = $('button.canvas-cover-upload-btn');
      uploadBtn.textContent = 'Choose an image';
      uploadBtn.addEventListener('click', async () => {
        try {
          const electron = (window as any).parallxElectron;
          if (!electron?.dialog?.openFile) return;
          const filePaths = await electron.dialog.openFile({
            filters: [{ name: 'Images', extensions: ['png', 'jpg', 'jpeg', 'gif', 'webp'] }],
            properties: ['openFile'],
          });
          if (filePaths?.[0]) {
            const filePath = filePaths[0];
            const result = await electron.fs.readFile(filePath);
            if (result?.content && result?.encoding === 'base64') {
              const ext = filePath.split('.').pop()?.toLowerCase() || 'png';
              const mime = ext === 'jpg' ? 'image/jpeg' : `image/${ext}`;
              const dataUrl = `data:${mime};base64,${result.content}`;
              if (result.content.length > 2 * 1024 * 1024 * 1.37) {
                alert('Image is too large (max 2MB). Please choose a smaller image.');
                return;
              }
              this._host.dataService.updatePage(this._host.pageId, { coverUrl: dataUrl });
              this.dismissPopups();
            }
          }
        } catch (err) {
          console.error('[CanvasEditorPane] Cover upload failed:', err);
        }
      });
      content.appendChild(uploadBtn);
      const hint = $('div.canvas-cover-upload-hint');
      hint.textContent = 'Recommended: 1500×600px or wider. Max 2MB.';
      content.appendChild(hint);
    };

    const renderLink = () => {
      content.innerHTML = '';
      const row = $('div.canvas-cover-link-row');
      const input = $('input.canvas-cover-link-input') as HTMLInputElement;
      input.type = 'url';
      input.placeholder = 'Paste image URL…';
      const applyBtn = $('button.canvas-cover-link-apply');
      applyBtn.textContent = 'Apply';
      applyBtn.addEventListener('click', () => {
        const url = input.value.trim();
        if (url) {
          this._host.dataService.updatePage(this._host.pageId, { coverUrl: url });
          this.dismissPopups();
        }
      });
      input.addEventListener('keydown', (e) => {
        if (e.key === 'Enter') applyBtn.click();
        if (e.key === 'Escape') this.dismissPopups();
      });
      row.appendChild(input);
      row.appendChild(applyBtn);
      content.appendChild(row);
    };

    renderGallery();

    // Tab switching
    const allTabs = [tabGallery, tabUpload, tabLink];
    const renderers = [renderGallery, renderUpload, renderLink];
    allTabs.forEach((tab, i) => {
      tab.addEventListener('click', () => {
        allTabs.forEach(t => t.classList.remove('canvas-cover-picker-tab--active'));
        tab.classList.add('canvas-cover-picker-tab--active');
        renderers[i]();
      });
    });

    this._host.container.appendChild(this._coverPicker);

    // Position: fixed, horizontally centered in editor area
    const wrapperRect = (this._host.editorContainer ?? this._host.container).getBoundingClientRect();
    const pickerWidth = 420;
    const left = wrapperRect.left + (wrapperRect.width - pickerWidth) / 2;

    let top: number;
    const coverVisible = this._coverEl && this._coverEl.style.display !== 'none';
    if (coverVisible) {
      top = this._coverEl!.getBoundingClientRect().bottom + 4;
    } else if (this._pageHeader) {
      top = this._pageHeader.getBoundingClientRect().top;
    } else {
      top = wrapperRect.top + 60;
    }

    const pickerHeight = 280;
    top = Math.min(top, window.innerHeight - pickerHeight - 8);
    top = Math.max(top, 8);

    this._coverPicker.style.top = `${top}px`;
    this._coverPicker.style.left = `${Math.max(8, left)}px`;

    setTimeout(() => {
      document.addEventListener('mousedown', this._handlePopupOutsideClick);
    }, 0);
    document.addEventListener('keydown', this._handlePopupEscape);
  }

  // ── Icon Picker ─────────────────────────────────────────────────────────

  private _showIconPicker(): void {
    if (this._iconPicker) { this.dismissPopups(); return; }
    this.dismissPopups();

    this._iconPicker = $('div.canvas-icon-picker');

    // Search
    const searchInput = $('input.canvas-icon-search') as HTMLInputElement;
    searchInput.type = 'text';
    searchInput.placeholder = 'Search icons…';
    this._iconPicker.appendChild(searchInput);

    // Remove button (if icon is set)
    if (this._currentPage?.icon) {
      const removeBtn = $('button.canvas-icon-remove');
      removeBtn.appendChild(createIconElement('close', 12));
      const removeLbl = $('span');
      removeLbl.textContent = ' Remove icon';
      removeBtn.appendChild(removeLbl);
      removeBtn.addEventListener('click', () => {
        this._host.dataService.updatePage(this._host.pageId, { icon: null as any });
        this.dismissPopups();
      });
      this._iconPicker.appendChild(removeBtn);
    }

    // Icon grid
    const contentArea = $('div.canvas-icon-content');

    const renderIcons = (filter?: string) => {
      contentArea.innerHTML = '';
      const grid = $('div.canvas-icon-grid');
      const ids = filter
        ? PAGE_ICON_IDS.filter(id => id.includes(filter.toLowerCase()))
        : PAGE_ICON_IDS;
      for (const id of ids) {
        const btn = $('button.canvas-icon-btn');
        btn.title = id;
        btn.innerHTML = svgIcon(id);
        const svg = btn.querySelector('svg');
        if (svg) { svg.setAttribute('width', '22'); svg.setAttribute('height', '22'); }
        btn.addEventListener('click', () => {
          this._host.dataService.updatePage(this._host.pageId, { icon: id });
          this.dismissPopups();
        });
        grid.appendChild(btn);
      }
      if (ids.length === 0) {
        const empty = $('div.canvas-icon-empty');
        empty.textContent = 'No matching icons';
        grid.appendChild(empty);
      }
      contentArea.appendChild(grid);
    };

    renderIcons();

    searchInput.addEventListener('input', () => {
      const q = searchInput.value.trim();
      renderIcons(q || undefined);
    });

    this._iconPicker.appendChild(contentArea);
    this._host.container.appendChild(this._iconPicker);

    // Position near icon
    if (this._iconEl || this._pageHeader) {
      const target = this._iconEl?.style.display !== 'none' ? this._iconEl : this._pageHeader;
      const rect = target?.getBoundingClientRect();
      if (rect) {
        this._iconPicker.style.left = `${rect.left}px`;
        this._iconPicker.style.top = `${rect.bottom + 4}px`;
      }
    }

    setTimeout(() => searchInput.focus(), 50);

    setTimeout(() => {
      document.addEventListener('mousedown', this._handlePopupOutsideClick);
    }, 0);
    document.addEventListener('keydown', this._handlePopupEscape);
  }

  // ── Page Menu ───────────────────────────────────────────────────────────

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

    this._host.container.appendChild(this._pageMenuDropdown);

    // Position below menu button
    if (this._pageMenuBtn) {
      const rect = this._pageMenuBtn.getBoundingClientRect();
      this._pageMenuDropdown.style.top = `${rect.bottom + 4}px`;
      this._pageMenuDropdown.style.right = `${window.innerWidth - rect.right}px`;
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
      this._iconPicker?.contains(target) ||
      this._coverPicker?.contains(target) ||
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
