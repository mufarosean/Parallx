// databaseEditorProvider.ts — Database editor pane (full-page context)
//
// Provides the editor provider registered via
// `api.editors.registerEditorProvider('database', ...)`.
// Each editor pane builds a page-header chrome and delegates the database
// view engine to DatabaseViewHost — the single shared rendering component.
//
// Dependencies: platform/ (lifecycle), editor/ (editorInput — type-only),
// ui/ (dom), databaseRegistry (gate import)

import { Disposable, type IDisposable } from '../../../platform/lifecycle.js';
import type { IEditorInput } from '../../../editor/editorInput.js';
import { IconPicker } from '../../../ui/iconPicker.js';
import { $, layoutPopup } from '../../../ui/dom.js';
import {
  DatabaseViewHost,
  PAGE_SELECTABLE_ICONS,
  PageChromeController,
  svgIcon,
  type ICanvasDataService,
  type IDatabaseDataService,
  type OpenEditorFn,
} from './databaseRegistry.js';

import './database.css';

// ─── Database Editor Provider ────────────────────────────────────────────────

export class DatabaseEditorProvider {
  private _openEditor: OpenEditorFn | undefined;

  constructor(
    private readonly _dataService: IDatabaseDataService,
    private readonly _pageDataService: ICanvasDataService,
  ) {}

  /**
   * Set the openEditor callback so panes can navigate to row pages.
   */
  setOpenEditor(fn: OpenEditorFn): void {
    this._openEditor = fn;
  }

  /**
   * Create an editor pane for a database.
   *
   * @param container — DOM element to render into
   * @param input — the ToolEditorInput (input.id === databaseId)
   */
  createEditorPane(container: HTMLElement, input?: IEditorInput): IDisposable {
    const databaseId = input?.id ?? '';
    const pane = new DatabaseEditorPane(
      container,
      databaseId,
      this._dataService,
      this._pageDataService,
      input,
      this._openEditor,
    );
    pane.init().catch(err => {
      console.error('[DatabaseEditorProvider] Pane init failed:', err);
    });
    return pane;
  }
}

// ─── Database Editor Pane ────────────────────────────────────────────────────

class DatabaseEditorPane extends Disposable {
  private static readonly _COVER_GRADIENTS = [
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
  ] as const;

  private _disposed = false;
  private _wrapper: HTMLElement | null = null;
  private _shell: HTMLElement | null = null;
  private _host: DatabaseViewHost | null = null;
  private _pageChrome: PageChromeController | null = null;
  private _emptyState: HTMLElement | null = null;
  private _iconPicker: IconPicker | null = null;
  private _coverPicker: HTMLElement | null = null;
  private _coverPickerOutsideClick: ((e: MouseEvent) => void) | null = null;
  private _coverPickerEscape: ((e: KeyboardEvent) => void) | null = null;

  constructor(
    private readonly _container: HTMLElement,
    private readonly _databaseId: string,
    private readonly _dataService: IDatabaseDataService,
    private readonly _pageDataService: ICanvasDataService,
    private readonly _input: IEditorInput | undefined,
    private readonly _openEditor: OpenEditorFn | undefined,
  ) {
    super();
  }

  get editor(): null { return null; }
  get container(): HTMLElement { return this._container; }
  get editorContainer(): HTMLElement | null { return this._wrapper; }
  get dataService(): ICanvasDataService { return this._pageDataService; }
  get pageId(): string { return this._databaseId; }
  get input(): IEditorInput | undefined { return this._input; }
  get openEditor(): OpenEditorFn | undefined { return this._openEditor; }
  get showIconPicker(): (options: {
    anchor: HTMLElement;
    showSearch?: boolean;
    showRemove?: boolean;
    iconSize?: number;
    onSelect: (iconId: string) => void;
    onRemove?: () => void;
  }) => void {
    return (options) => this._showIconPicker(options);
  }
  get showCoverPicker(): (options: {
    editorContainer: HTMLElement | null;
    coverEl?: HTMLElement | null;
    pageHeader?: HTMLElement | null;
    onSelectCover: (coverUrl: string) => void;
  }) => void {
    return (options) => this._showCoverPicker(options);
  }

  // ─── Initialization ──────────────────────────────────────────────────

  async init(): Promise<void> {
    this._wrapper = $('div.canvas-editor-wrapper.db-host.db-host--fullpage');
    this._container.appendChild(this._wrapper);

    this._pageChrome = new PageChromeController(this, {
      titleLayout: 'inline',
      hideFavoriteButton: true,
      menuKind: 'database',
    });

    try {
      this._pageChrome.currentPage = await this._pageDataService.getPage(this._databaseId) ?? null;
    } catch {
      this._pageChrome.currentPage = null;
    }

    if (this._input && typeof (this._input as any).setName === 'function') {
      const initialTitle = this._pageChrome.currentPage?.title?.trim() || 'Untitled';
      (this._input as any).setName(initialTitle);
    }

    this._pageChrome.applyPageSettings();
    this._pageChrome.createChrome();

    this._shell = $('div.db-host-shell');
    this._wrapper.appendChild(this._shell);

    // Slots for DatabaseViewHost
    const tabBarSlot = $('div.db-host-tabbar');
    this._shell.appendChild(tabBarSlot);

    const toolbarSlot = $('div.db-host-toolbar');
    this._shell.appendChild(toolbarSlot);

    const toolbarPanelsSlot = $('div.db-host-toolbar-panels');
    this._shell.appendChild(toolbarPanelsSlot);

    const contentSlot = $('div.db-host-content');
    this._shell.appendChild(contentSlot);

    // Create the shared view host
    this._host = this._register(new DatabaseViewHost({
      databaseId: this._databaseId,
      dataService: this._dataService,
      openEditor: this._openEditor,
      slots: {
        tabBar: tabBarSlot,
        toolbar: toolbarSlot,
        toolbarPanels: toolbarPanelsSlot,
        content: contentSlot,
      },
    }));

    this._register(this._host.onDidFailLoad(message => {
      this._showEmptyState(message);
    }));

    this._register(this._pageDataService.onDidChangePage((event) => {
      if (event.pageId !== this._databaseId || !event.page) return;
      this._pageChrome?.syncPageChange(event.page);
      this._pageChrome?.applyPageSettings();
    }));

    await this._host.load();
  }

  // ─── Empty State ─────────────────────────────────────────────────────

  private _showEmptyState(message: string): void {
    if (this._emptyState) {
      this._emptyState.textContent = message;
      return;
    }
    this._emptyState = $('div.db-host-empty-state');
    this._emptyState.textContent = message;
    (this._shell ?? this._wrapper ?? this._container).appendChild(this._emptyState);
  }

  private _showIconPicker(options: {
    anchor: HTMLElement;
    showSearch?: boolean;
    showRemove?: boolean;
    iconSize?: number;
    onSelect: (iconId: string) => void;
    onRemove?: () => void;
  }): void {
    this._dismissOverlays();

    this._iconPicker = new IconPicker(this._wrapper ?? this._container, {
      anchor: options.anchor,
      icons: [...PAGE_SELECTABLE_ICONS],
      renderIcon: (id) => svgIcon(id),
      showSearch: options.showSearch ?? true,
      showRemove: options.showRemove ?? false,
      iconSize: options.iconSize ?? 22,
    });

    this._iconPicker.onDidSelectIcon((iconId) => {
      options.onSelect(iconId);
    });

    if (options.onRemove) {
      this._iconPicker.onDidRemoveIcon(() => {
        options.onRemove!();
      });
    }

    this._iconPicker.onDidDismiss(() => {
      this._iconPicker = null;
    });
  }

  private _showCoverPicker(options: {
    editorContainer: HTMLElement | null;
    coverEl?: HTMLElement | null;
    pageHeader?: HTMLElement | null;
    onSelectCover: (coverUrl: string) => void;
  }): void {
    this._dismissOverlays();

    const picker = $('div.canvas-cover-picker');
    this._coverPicker = picker;

    const dismiss = (): void => {
      if (this._coverPickerOutsideClick) {
        document.removeEventListener('mousedown', this._coverPickerOutsideClick, true);
        this._coverPickerOutsideClick = null;
      }
      if (this._coverPickerEscape) {
        document.removeEventListener('keydown', this._coverPickerEscape, true);
        this._coverPickerEscape = null;
      }
      if (this._coverPicker) {
        this._coverPicker.remove();
        this._coverPicker = null;
      }
    };

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
    picker.appendChild(tabs);

    const content = $('div.canvas-cover-picker-content');
    picker.appendChild(content);

    const renderGallery = () => {
      content.innerHTML = '';
      const grid = $('div.canvas-cover-gallery');
      for (const grad of DatabaseEditorPane._COVER_GRADIENTS) {
        const swatch = $('div.canvas-cover-swatch');
        swatch.style.background = grad;
        swatch.addEventListener('click', () => {
          options.onSelectCover(grad);
          dismiss();
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
              options.onSelectCover(dataUrl);
              dismiss();
            }
          }
        } catch (err) {
          console.error('[DatabaseEditorProvider] Cover upload failed:', err);
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
          options.onSelectCover(url);
          dismiss();
        }
      });
      input.addEventListener('keydown', (e) => {
        if (e.key === 'Enter') applyBtn.click();
        if (e.key === 'Escape') dismiss();
      });
      row.appendChild(input);
      row.appendChild(applyBtn);
      content.appendChild(row);
    };

    renderGallery();

    const allTabs = [tabGallery, tabUpload, tabLink];
    const renderers = [renderGallery, renderUpload, renderLink];
    allTabs.forEach((tab, index) => {
      tab.addEventListener('click', () => {
        allTabs.forEach(t => t.classList.remove('canvas-cover-picker-tab--active'));
        tab.classList.add('canvas-cover-picker-tab--active');
        renderers[index]();
      });
    });

    (this._wrapper ?? this._container).appendChild(picker);

    const wrapperRect = (options.editorContainer ?? this._wrapper ?? this._container).getBoundingClientRect();
    const pickerWidth = 420;
    const left = wrapperRect.left + (wrapperRect.width - pickerWidth) / 2;

    let top: number;
    const coverVisible = options.coverEl && options.coverEl.style.display !== 'none';
    if (coverVisible) {
      top = options.coverEl!.getBoundingClientRect().bottom + 4;
    } else if (options.pageHeader) {
      top = options.pageHeader.getBoundingClientRect().top;
    } else {
      top = wrapperRect.top + 60;
    }
    layoutPopup(picker, { x: left, y: top });

    this._coverPickerOutsideClick = (e: MouseEvent) => {
      const target = e.target as Node;
      if (this._coverPicker?.contains(target)) return;
      dismiss();
    };
    this._coverPickerEscape = (e: KeyboardEvent) => {
      if (e.key === 'Escape') dismiss();
    };
    setTimeout(() => {
      if (this._coverPickerOutsideClick) {
        document.addEventListener('mousedown', this._coverPickerOutsideClick, true);
      }
    }, 0);
    document.addEventListener('keydown', this._coverPickerEscape, true);
  }

  private _dismissOverlays(): void {
    if (this._iconPicker) {
      this._iconPicker.dismiss();
      this._iconPicker = null;
    }
    if (this._coverPicker) {
      this._coverPicker.remove();
      this._coverPicker = null;
    }
    if (this._coverPickerOutsideClick) {
      document.removeEventListener('mousedown', this._coverPickerOutsideClick, true);
      this._coverPickerOutsideClick = null;
    }
    if (this._coverPickerEscape) {
      document.removeEventListener('keydown', this._coverPickerEscape, true);
      this._coverPickerEscape = null;
    }
  }

  // ─── Dispose ─────────────────────────────────────────────────────────

  override dispose(): void {
    if (this._disposed) return;
    this._disposed = true;

    this._dismissOverlays();
    this._pageChrome?.dismissPopups();
    this._pageChrome?.dispose();
    this._pageChrome = null;
    this._host = null;

    if (this._wrapper) {
      this._wrapper.remove();
      this._wrapper = null;
    }
    this._shell = null;

    super.dispose();
  }
}
