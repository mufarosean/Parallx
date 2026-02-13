// pdfEditorPane.ts — PDF viewer pane
//
// Renders PDF files using Chromium's built-in PDF viewer via an <embed> element.
// The file is read as base64 and loaded as a data: URI.
//
// VS Code reference:
//   VS Code opens PDFs in an external application or via extensions.
//   We use the built-in Chromium PDF viewer for simplicity.

import { EditorPane } from '../../editor/editorPane.js';
import type { IEditorInput } from '../../editor/editorInput.js';
import { PdfEditorInput } from './pdfEditorInput.js';

const PANE_ID = 'pdf-editor-pane';

export class PdfEditorPane extends EditorPane {
  static readonly PANE_ID = PANE_ID;

  private _container!: HTMLElement;
  private _embed: HTMLEmbedElement | null = null;
  private _errorMessage!: HTMLElement;
  private _loadingMessage!: HTMLElement;

  constructor() {
    super(PANE_ID);
  }

  protected override createPaneContent(container: HTMLElement): void {
    container.classList.add('pdf-editor-pane');

    this._container = container;

    // Loading indicator
    this._loadingMessage = document.createElement('div');
    this._loadingMessage.classList.add('pdf-loading');
    this._loadingMessage.textContent = 'Loading PDF…';
    container.appendChild(this._loadingMessage);

    // Error message (hidden)
    this._errorMessage = document.createElement('div');
    this._errorMessage.classList.add('pdf-error');
    this._errorMessage.style.display = 'none';
    container.appendChild(this._errorMessage);
  }

  protected override async renderInput(
    input: IEditorInput,
    _previous: IEditorInput | undefined,
  ): Promise<void> {
    // Clean up previous embed
    if (this._embed) {
      this._embed.remove();
      this._embed = null;
    }

    if (!(input instanceof PdfEditorInput)) {
      this._showError('Cannot render: not a PDF input.');
      return;
    }

    this._loadingMessage.style.display = '';
    this._errorMessage.style.display = 'none';

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

      // Create embed element with Chromium's built-in PDF viewer
      this._embed = document.createElement('embed');
      this._embed.classList.add('pdf-embed');
      this._embed.type = 'application/pdf';
      this._embed.src = `data:application/pdf;base64,${base64}`;

      this._loadingMessage.style.display = 'none';
      this._container.appendChild(this._embed);
    } catch (err) {
      console.error('[PdfEditorPane] Failed to load PDF:', err);
      this._showError(`Error: ${(err as Error).message}`);
    }
  }

  protected override clearPaneContent(_previous: IEditorInput | undefined): void {
    if (this._embed) {
      this._embed.remove();
      this._embed = null;
    }
  }

  protected override layoutPaneContent(width: number, height: number): void {
    if (this._embed) {
      this._embed.style.width = `${width}px`;
      this._embed.style.height = `${height}px`;
    }
  }

  private _showError(msg: string): void {
    this._loadingMessage.style.display = 'none';
    this._errorMessage.style.display = '';
    this._errorMessage.textContent = msg;
  }
}
