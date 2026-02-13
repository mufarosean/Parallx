// imageEditorPane.ts — Image viewer pane
//
// Displays image files (png, jpg, gif, svg, webp, bmp, ico, avif) with:
//  - Centered image on transparency checkerboard
//  - Zoom via Ctrl+scroll (0.1x–10x)
//  - Info bar showing dimensions and file size
//
// VS Code reference:
//   src/vs/workbench/contrib/files/browser/editors/binaryFileEditor.ts
//   src/vs/workbench/browser/parts/editor/binaryEditor.ts

import { EditorPane } from '../../editor/editorPane.js';
import type { IEditorInput } from '../../editor/editorInput.js';
import { ImageEditorInput } from './imageEditorInput.js';

// ─── Constants ───────────────────────────────────────────────────────────────

const PANE_ID = 'image-editor-pane';

const MIME_MAP: Record<string, string> = {
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.gif': 'image/gif',
  '.svg': 'image/svg+xml',
  '.webp': 'image/webp',
  '.bmp': 'image/bmp',
  '.ico': 'image/x-icon',
  '.avif': 'image/avif',
};

const MIN_ZOOM = 0.1;
const MAX_ZOOM = 10;
const ZOOM_STEP = 0.1;

// ─── ImageEditorPane ─────────────────────────────────────────────────────────

export class ImageEditorPane extends EditorPane {
  static readonly PANE_ID = PANE_ID;

  private _scrollContainer!: HTMLElement;
  private _imageWrapper!: HTMLElement;
  private _image!: HTMLImageElement;
  private _infoBar!: HTMLElement;
  private _errorMessage!: HTMLElement;

  private _zoom = 1;

  constructor() {
    super(PANE_ID);
  }

  // ── Lifecycle ────────────────────────────────────────────────────────────

  protected override createPaneContent(container: HTMLElement): void {
    container.classList.add('image-editor-pane');

    // Scroll container with checkerboard background
    this._scrollContainer = document.createElement('div');
    this._scrollContainer.classList.add('image-scroll-container');

    this._imageWrapper = document.createElement('div');
    this._imageWrapper.classList.add('image-wrapper');

    this._image = document.createElement('img');
    this._image.classList.add('image-preview');
    this._image.draggable = false;

    // Error message (hidden initially)
    this._errorMessage = document.createElement('div');
    this._errorMessage.classList.add('image-error');
    this._errorMessage.style.display = 'none';
    this._errorMessage.textContent = 'Failed to load image.';

    this._imageWrapper.appendChild(this._image);
    this._imageWrapper.appendChild(this._errorMessage);
    this._scrollContainer.appendChild(this._imageWrapper);
    container.appendChild(this._scrollContainer);

    // Info bar
    this._infoBar = document.createElement('div');
    this._infoBar.classList.add('image-info-bar');
    container.appendChild(this._infoBar);

    // Zoom via Ctrl+Scroll
    this._scrollContainer.addEventListener('wheel', (e) => {
      if (!e.ctrlKey) return;
      e.preventDefault();
      const delta = e.deltaY > 0 ? -ZOOM_STEP : ZOOM_STEP;
      this._zoom = Math.max(MIN_ZOOM, Math.min(MAX_ZOOM, this._zoom + delta));
      this._applyZoom();
    }, { passive: false });

    // Load handler for dimensions
    this._image.addEventListener('load', () => {
      this._image.style.display = '';
      this._errorMessage.style.display = 'none';
      this._updateInfoBar();
    });

    // Error handler
    this._image.addEventListener('error', () => {
      this._image.style.display = 'none';
      this._errorMessage.style.display = '';
      this._errorMessage.textContent = 'Failed to load image.';
    });
  }

  protected override async renderInput(
    input: IEditorInput,
    _previous: IEditorInput | undefined,
  ): Promise<void> {
    if (!(input instanceof ImageEditorInput)) {
      this._errorMessage.style.display = '';
      this._errorMessage.textContent = 'Cannot render: not an image input.';
      return;
    }

    this._zoom = 1;
    this._image.style.display = 'none';
    this._errorMessage.style.display = 'none';
    this._infoBar.textContent = 'Loading…';

    const uri = input.uri;
    const ext = this._getExtension(uri.basename);
    const mime = MIME_MAP[ext] || 'image/png';

    try {
      const electron = (globalThis as any).parallxElectron;
      if (!electron?.fs?.readFile) {
        throw new Error('File system bridge not available');
      }

      const result = await electron.fs.readFile(uri.fsPath);
      if (result.error) {
        throw new Error(result.error.message || 'Read failed');
      }

      let dataUri: string;
      if (result.encoding === 'base64') {
        // Binary file returned as base64
        dataUri = `data:${mime};base64,${result.content}`;
      } else if (mime === 'image/svg+xml') {
        // SVG returned as text — encode to base64
        dataUri = `data:${mime};base64,${btoa(result.content)}`;
      } else {
        // Text encoding for binary — shouldn't happen, but handle gracefully
        dataUri = `data:${mime};base64,${btoa(result.content)}`;
      }

      this._image.src = dataUri;
      this._applyZoom();
    } catch (err) {
      console.error('[ImageEditorPane] Failed to load image:', err);
      this._image.style.display = 'none';
      this._errorMessage.style.display = '';
      this._errorMessage.textContent = `Error: ${(err as Error).message}`;
    }
  }

  protected override clearPaneContent(_previous: IEditorInput | undefined): void {
    this._image.src = '';
    this._infoBar.textContent = '';
    this._zoom = 1;
  }

  protected override layoutPaneContent(width: number, height: number): void {
    if (this._scrollContainer) {
      // Subtract info bar height (24px)
      this._scrollContainer.style.width = `${width}px`;
      this._scrollContainer.style.height = `${Math.max(0, height - 24)}px`;
    }
  }

  // ── Helpers ──────────────────────────────────────────────────────────────

  private _applyZoom(): void {
    this._image.style.transform = `scale(${this._zoom})`;
    this._image.style.transformOrigin = 'center center';
    this._updateInfoBar();
  }

  private _updateInfoBar(): void {
    const w = this._image.naturalWidth;
    const h = this._image.naturalHeight;
    const zoomPct = Math.round(this._zoom * 100);
    if (w && h) {
      this._infoBar.textContent = `${w} × ${h}   ${zoomPct}%`;
    } else {
      this._infoBar.textContent = `${zoomPct}%`;
    }
  }

  private _getExtension(name: string): string {
    const dotIdx = name.lastIndexOf('.');
    return dotIdx >= 0 ? name.substring(dotIdx).toLowerCase() : '';
  }
}
