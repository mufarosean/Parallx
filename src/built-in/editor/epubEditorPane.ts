// epubEditorPane.ts - EPUB reader pane
//
// Renders extracted EPUB text from the Electron document extraction bridge.
// The pane never injects book HTML; content is written via textContent.

import './epubEditorPane.css';
import { EditorPane, type EditorPaneViewState } from '../../editor/editorPane.js';
import type { IEditorInput } from '../../editor/editorInput.js';
import { $, hide, show } from '../../ui/dom.js';
import { getIcon } from '../../ui/iconRegistry.js';
import { EpubEditorInput } from './epubEditorInput.js';

const PANE_ID = 'epub-editor-pane';
const MIN_FONT_SCALE = 0.8;
const MAX_FONT_SCALE = 1.6;
const FONT_SCALE_STEP = 0.1;

const ICON = {
  book: getIcon('book-open-text'),
  zoomOut: getIcon('zoom-out'),
  zoomIn: getIcon('zoom-in'),
  reset: getIcon('rotate-ccw'),
};

export class EpubEditorPane extends EditorPane {
  static readonly PANE_ID = PANE_ID;

  private _titleEl!: HTMLElement;
  private _scrollContainer!: HTMLElement;
  private _contentEl!: HTMLElement;
  private _loadingEl!: HTMLElement;
  private _errorEl!: HTMLElement;
  private _statusEl!: HTMLElement;
  private _zoomLabelEl!: HTMLElement;

  private _fontScale = 1;
  private _loadSeq = 0;
  private _scrollRaf = 0;
  private _lastText = '';
  private _lastMetadata: unknown;

  constructor() {
    super(PANE_ID);
  }

  protected override createPaneContent(container: HTMLElement): void {
    container.classList.add('epub-editor-pane');

    const toolbar = $('div');
    toolbar.classList.add('epub-toolbar');

    const titleGroup = $('div');
    titleGroup.classList.add('epub-toolbar-title-group');

    const icon = $('span');
    icon.classList.add('epub-toolbar-icon');
    icon.innerHTML = ICON.book;

    this._titleEl = $('span');
    this._titleEl.classList.add('epub-toolbar-title');

    titleGroup.append(icon, this._titleEl);

    const spacer = $('div');
    spacer.classList.add('epub-toolbar-spacer');

    const zoomOut = this._button(ICON.zoomOut, 'Decrease text size');
    zoomOut.addEventListener('click', () => this._setFontScale(this._fontScale - FONT_SCALE_STEP));

    this._zoomLabelEl = $('span');
    this._zoomLabelEl.classList.add('epub-toolbar-zoom-label');

    const zoomIn = this._button(ICON.zoomIn, 'Increase text size');
    zoomIn.addEventListener('click', () => this._setFontScale(this._fontScale + FONT_SCALE_STEP));

    const reset = this._button(ICON.reset, 'Reset text size');
    reset.addEventListener('click', () => this._setFontScale(1));

    toolbar.append(titleGroup, spacer, zoomOut, this._zoomLabelEl, zoomIn, reset);
    container.appendChild(toolbar);

    this._scrollContainer = $('div');
    this._scrollContainer.classList.add('epub-reader-scroll');
    this._scrollContainer.tabIndex = 0;
    this._scrollContainer.addEventListener('scroll', () => this._scheduleScrollStateUpdate(), { passive: true });

    this._contentEl = $('article');
    this._contentEl.classList.add('epub-reader-content');

    this._loadingEl = $('div');
    this._loadingEl.classList.add('epub-reader-message');
    this._loadingEl.textContent = 'Loading...';

    this._errorEl = $('div');
    this._errorEl.classList.add('epub-reader-message', 'epub-reader-error');
    hide(this._errorEl);

    this._scrollContainer.append(this._loadingEl, this._errorEl, this._contentEl);
    container.appendChild(this._scrollContainer);

    this._statusEl = $('div');
    this._statusEl.classList.add('epub-status-bar');
    container.appendChild(this._statusEl);

    this._applyFontScale();
  }

  protected override async renderInput(
    input: IEditorInput,
    _previous: IEditorInput | undefined,
  ): Promise<void> {
    if (!(input instanceof EpubEditorInput)) {
      this._showError('Cannot render: not an EPUB input.');
      return;
    }

    const seq = ++this._loadSeq;
    this._titleEl.textContent = input.name;
    this._fontScale = clamp(input.fontScale || 1, MIN_FONT_SCALE, MAX_FONT_SCALE);
    this._lastText = '';
    this._lastMetadata = undefined;
    this._applyFontScale();
    this._showLoading();

    try {
      const electron = (globalThis as any).parallxElectron;
      if (!electron?.document?.extractText) {
        throw new Error('Document extraction bridge not available');
      }

      const result = await electron.document.extractText(input.uri.fsPath);
      if (seq !== this._loadSeq) return;
      if (result?.error) {
        throw new Error(result.error.message || 'EPUB extraction failed');
      }

      const text = typeof result?.text === 'string' ? result.text.trim() : '';
      this._lastText = text;
      this._lastMetadata = result?.metadata;
      this._renderText(text);
      this._updateStatus();

      requestAnimationFrame(() => {
        if (seq !== this._loadSeq) return;
        this._scrollContainer.scrollTop = input.scrollTop || 0;
      });
    } catch (err) {
      if (seq !== this._loadSeq) return;
      console.error('[EpubEditorPane] Failed to load EPUB:', err);
      this._showError(`Error: ${(err as Error).message}`);
    }
  }

  protected override clearPaneContent(_previous: IEditorInput | undefined): void {
    this._loadSeq++;
    this._contentEl.textContent = '';
    this._statusEl.textContent = '';
    this._titleEl.textContent = '';
    this._fontScale = 1;
    this._lastText = '';
    this._lastMetadata = undefined;
    this._applyFontScale();
    hide(this._loadingEl);
    hide(this._errorEl);
  }

  override focus(): void {
    this._scrollContainer?.focus();
  }

  protected override savePaneViewState(): EditorPaneViewState {
    return {
      scrollTop: this._scrollContainer?.scrollTop ?? 0,
      fontScale: this._fontScale,
    };
  }

  protected override restorePaneViewState(state: EditorPaneViewState): void {
    if (typeof state.fontScale === 'number') {
      this._setFontScale(state.fontScale, false);
    }
    if (typeof state.scrollTop === 'number' && this._scrollContainer) {
      this._scrollContainer.scrollTop = state.scrollTop;
      this._updateInputViewState();
    }
  }

  override dispose(): void {
    if (this._scrollRaf) {
      cancelAnimationFrame(this._scrollRaf);
      this._scrollRaf = 0;
    }
    super.dispose();
  }

  private _button(iconSvg: string, title: string): HTMLButtonElement {
    const button = $('button') as HTMLButtonElement;
    button.type = 'button';
    button.classList.add('epub-toolbar-btn');
    button.title = title;
    button.setAttribute('aria-label', title);
    if (iconSvg) {
      button.innerHTML = iconSvg;
    } else {
      button.textContent = title;
    }
    return button;
  }

  private _showLoading(): void {
    this._contentEl.textContent = '';
    this._statusEl.textContent = 'Loading...';
    hide(this._errorEl);
    show(this._loadingEl);
  }

  private _showError(message: string): void {
    this._contentEl.textContent = '';
    this._statusEl.textContent = '';
    hide(this._loadingEl);
    this._errorEl.textContent = message;
    show(this._errorEl);
  }

  private _renderText(text: string): void {
    hide(this._loadingEl);
    hide(this._errorEl);
    this._contentEl.textContent = text || 'No extractable text found in this EPUB.';
  }

  private _setFontScale(scale: number, notify = true): void {
    this._fontScale = clamp(scale, MIN_FONT_SCALE, MAX_FONT_SCALE);
    this._applyFontScale();
    this._updateInputViewState();
    this._updateStatus();
    if (notify) this.fireViewStateChanged();
  }

  private _applyFontScale(): void {
    if (this._contentEl) {
      this._contentEl.style.fontSize = `${16 * this._fontScale}px`;
    }
    if (this._zoomLabelEl) {
      this._zoomLabelEl.textContent = `${Math.round(this._fontScale * 100)}%`;
    }
  }

  private _scheduleScrollStateUpdate(): void {
    if (this._scrollRaf) return;
    this._scrollRaf = requestAnimationFrame(() => {
      this._scrollRaf = 0;
      this._updateInputViewState();
      this.fireViewStateChanged();
    });
  }

  private _updateInputViewState(): void {
    if (this.input instanceof EpubEditorInput) {
      this.input.scrollTop = this._scrollContainer?.scrollTop ?? 0;
      this.input.fontScale = this._fontScale;
    }
  }

  private _formatStatus(text: string, metadata: unknown): string {
    const wordCount = (text.match(/\S+/g) ?? []).length;
    const chapterCount = readNumberMetadata(metadata, 'chapterCount');
    const parts: string[] = [];
    if (chapterCount > 0) parts.push(`${chapterCount.toLocaleString()} chapters`);
    parts.push(`${wordCount.toLocaleString()} words`);
    parts.push(`${Math.round(this._fontScale * 100)}%`);
    return parts.join(' - ');
  }

  private _updateStatus(): void {
    if (!this._statusEl || !this._lastText) return;
    this._statusEl.textContent = this._formatStatus(this._lastText, this._lastMetadata);
  }
}

function clamp(value: number, min: number, max: number): number {
  return Math.max(min, Math.min(max, value));
}

function readNumberMetadata(metadata: unknown, key: string): number {
  if (!metadata || typeof metadata !== 'object') return 0;
  const value = (metadata as Record<string, unknown>)[key];
  return typeof value === 'number' ? value : 0;
}
