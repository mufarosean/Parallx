// coverMenu.ts — Cover picker menu registered in CanvasMenuRegistry
//
// Extracts the 3-tab cover picker (Gallery, Upload, Link) from
// pageChrome.ts into an ICanvasMenu surface so it participates in
// mutual exclusion, outside-click dismissal, and interaction arbitration.
//
// Consumers call `menuRegistry.showCoverMenu(options)` instead of
// building raw DOM inline.

import type { IDisposable } from '../../../platform/lifecycle.js';
import { $, layoutPopup } from '../../../ui/dom.js';
import type { ICanvasMenu, CanvasMenuRegistry } from './canvasMenuRegistry.js';

// ── Gradient gallery presets ────────────────────────────────────────────────

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

// ── Options ─────────────────────────────────────────────────────────────────

export interface CoverMenuOptions {
  /**
   * Container whose bounding rect is used for horizontal centering.
   * Falls back to `CoverMenuHost.container` if `null`.
   */
  readonly editorContainer: HTMLElement | null;

  /** Cover element — if visible, popup appears just below it. */
  readonly coverEl?: HTMLElement | null;

  /** Page header — fallback vertical anchor when cover is hidden. */
  readonly pageHeader?: HTMLElement | null;

  /** Called when the user picks a gradient, uploads, or pastes a URL. */
  readonly onSelectCover: (coverUrl: string) => void;
}

// ── Host ────────────────────────────────────────────────────────────────────

export interface CoverMenuHost {
  /** Container element in which the picker popup is mounted. */
  readonly container: HTMLElement;
}

// ── Controller ──────────────────────────────────────────────────────────────

export class CoverMenuController implements ICanvasMenu {
  readonly id = 'cover-menu';

  private _element: HTMLElement | null = null;
  private _visible = false;
  private _registration: IDisposable | null = null;

  constructor(
    private readonly _host: CoverMenuHost,
    private readonly _registry: CanvasMenuRegistry,
  ) {}

  // ── ICanvasMenu ─────────────────────────────────────────────────────────

  get visible(): boolean { return this._visible; }

  containsTarget(target: Node): boolean {
    return this._element?.contains(target) ?? false;
  }

  hide(): void {
    if (this._element) {
      this._element.remove();
      this._element = null;
    }
    this._visible = false;
  }

  dispose(): void {
    this.hide();
    this._registration?.dispose();
    this._registration = null;
  }

  // ── Lifecycle ───────────────────────────────────────────────────────────

  /** Register with the menu registry. Call once during setup. */
  create(): void {
    this._registration = this._registry.register(this);
  }

  // ── Public API ──────────────────────────────────────────────────────────

  /**
   * Show the cover picker popup (Gallery / Upload / Link tabs).
   *
   * Hides any previously-open picker and notifies the registry
   * so all other menus are dismissed.
   */
  show(options: CoverMenuOptions): void {
    this.hide();
    this._registry.notifyShow(this.id);

    const dismiss = () => this.hide();

    const picker = $('div.canvas-cover-picker');

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
    picker.appendChild(tabs);

    // ── Content area ──
    const content = $('div.canvas-cover-picker-content');
    picker.appendChild(content);

    // ── Gallery (default view) ──
    const renderGallery = () => {
      content.innerHTML = '';
      const grid = $('div.canvas-cover-gallery');
      for (const grad of GRADIENTS) {
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

    // ── Upload tab ──
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
          console.error('[CoverMenu] Cover upload failed:', err);
        }
      });
      content.appendChild(uploadBtn);
      const hint = $('div.canvas-cover-upload-hint');
      hint.textContent = 'Recommended: 1500×600px or wider. Max 2MB.';
      content.appendChild(hint);
    };

    // ── Link tab ──
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

    // ── Tab switching ──
    const allTabs = [tabGallery, tabUpload, tabLink];
    const renderers = [renderGallery, renderUpload, renderLink];
    allTabs.forEach((tab, i) => {
      tab.addEventListener('click', () => {
        allTabs.forEach(t => t.classList.remove('canvas-cover-picker-tab--active'));
        tab.classList.add('canvas-cover-picker-tab--active');
        renderers[i]();
      });
    });

    // ── Mount & position ──
    this._host.container.appendChild(picker);
    this._element = picker;
    this._visible = true;

    const wrapperRect = (options.editorContainer ?? this._host.container).getBoundingClientRect();
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
  }
}
