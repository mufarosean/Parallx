// pdfEditorPane.ts — PDF viewer pane
//
// Renders PDF files using Chromium's built-in PDF viewer via an <iframe>
// navigating to a blob: URL.  Electron 40+ removed PPAPI plugin support,
// so the old <embed type="application/pdf"> approach no longer works.
// Chromium's built-in PDF viewer extension still intercepts iframe
// navigations to application/pdf blob URLs, which is what we use here.
//
// VS Code reference:
//   VS Code opens PDFs via pdf.js extensions or system viewer.
//   We use the built-in Chromium PDF viewer for zero-dependency simplicity.

import './pdfEditorPane.css';
import { EditorPane } from '../../editor/editorPane.js';
import type { IEditorInput } from '../../editor/editorInput.js';
import { PdfEditorInput } from './pdfEditorInput.js';
import { $, hide, show } from '../../ui/dom.js';

const PANE_ID = 'pdf-editor-pane';

export class PdfEditorPane extends EditorPane {
  static readonly PANE_ID = PANE_ID;

  private _container!: HTMLElement;
  private _iframe: HTMLIFrameElement | null = null;
  private _blobUrl: string | null = null;
  private _errorMessage!: HTMLElement;
  private _loadingMessage!: HTMLElement;

  constructor() {
    super(PANE_ID);
  }

  protected override createPaneContent(container: HTMLElement): void {
    container.classList.add('pdf-editor-pane');

    this._container = container;

    // Loading indicator
    this._loadingMessage = $('div');
    this._loadingMessage.classList.add('pdf-loading');
    this._loadingMessage.textContent = 'Loading PDF…';
    container.appendChild(this._loadingMessage);

    // Error message (hidden)
    this._errorMessage = $('div');
    this._errorMessage.classList.add('pdf-error');
    hide(this._errorMessage);
    container.appendChild(this._errorMessage);
  }

  protected override async renderInput(
    input: IEditorInput,
    _previous: IEditorInput | undefined,
  ): Promise<void> {
    // Clean up previous frame and blob
    this._cleanup();

    if (!(input instanceof PdfEditorInput)) {
      this._showError('Cannot render: not a PDF input.');
      return;
    }

    show(this._loadingMessage);
    hide(this._errorMessage);

    try {
      const electron = (globalThis as any).parallxElectron;
      if (!electron?.fs?.readFile) {
        throw new Error('File system bridge not available');
      }

      const result = await electron.fs.readFile(input.uri.fsPath);
      if (result.error) {
        throw new Error(result.error.message || 'Read failed');
      }

      let base64: string;
      if (result.encoding === 'base64') {
        base64 = result.content;
      } else {
        base64 = btoa(result.content);
      }

      // Decode base64 → binary → Blob → blob URL
      const binaryStr = atob(base64);
      const bytes = new Uint8Array(binaryStr.length);
      for (let i = 0; i < binaryStr.length; i++) {
        bytes[i] = binaryStr.charCodeAt(i);
      }
      const blob = new Blob([bytes], { type: 'application/pdf' });
      this._blobUrl = URL.createObjectURL(blob);

      // Create iframe — Chromium's built-in PDF viewer intercepts the
      // navigation to the blob URL and renders the PDF inside the frame.
      this._iframe = document.createElement('iframe');
      this._iframe.classList.add('pdf-embed');
      this._iframe.src = this._blobUrl;

      hide(this._loadingMessage);
      this._container.appendChild(this._iframe);
    } catch (err) {
      console.error('[PdfEditorPane] Failed to load PDF:', err);
      this._showError(`Error: ${(err as Error).message}`);
    }
  }

  protected override clearPaneContent(_previous: IEditorInput | undefined): void {
    this._cleanup();
  }

  protected override layoutPaneContent(width: number, height: number): void {
    if (this._iframe) {
      this._iframe.style.width = `${width}px`;
      this._iframe.style.height = `${height}px`;
    }
  }

  /** Revoke the blob URL and remove the iframe from the DOM. */
  private _cleanup(): void {
    if (this._blobUrl) {
      URL.revokeObjectURL(this._blobUrl);
      this._blobUrl = null;
    }
    if (this._iframe) {
      this._iframe.remove();
      this._iframe = null;
    }
  }

  private _showError(msg: string): void {
    hide(this._loadingMessage);
    show(this._errorMessage);
    this._errorMessage.textContent = msg;
  }
}
