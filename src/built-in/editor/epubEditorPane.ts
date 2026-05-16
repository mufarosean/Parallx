// epubEditorPane.ts - EPUB reader pane
//
// Renders sanitized EPUB XHTML from the Electron document bridge. The plain
// text extraction path remains separate for indexing.

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

interface EpubReaderChapter {
  readonly id: string;
  readonly title: string;
  readonly path: string;
  readonly html: string;
  readonly text: string;
}

interface EpubReaderDocument {
  readonly title: string;
  readonly chapters: readonly EpubReaderChapter[];
  readonly metadata?: Record<string, unknown>;
}

export class EpubEditorPane extends EditorPane {
  static readonly PANE_ID = PANE_ID;

  private _titleEl!: HTMLElement;
  private _bodyEl!: HTMLElement;
  private _navEl!: HTMLElement;
  private _navListEl!: HTMLElement;
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

    const toolbar = $('div.epub-toolbar');

    const titleGroup = $('div.epub-toolbar-title-group');
    const icon = $('span.epub-toolbar-icon');
    icon.innerHTML = ICON.book;

    this._titleEl = $('span.epub-toolbar-title');
    titleGroup.append(icon, this._titleEl);

    const spacer = $('div.epub-toolbar-spacer');

    const zoomOut = this._button(ICON.zoomOut, 'Decrease text size');
    zoomOut.addEventListener('click', () => this._setFontScale(this._fontScale - FONT_SCALE_STEP));

    this._zoomLabelEl = $('span.epub-toolbar-zoom-label');

    const zoomIn = this._button(ICON.zoomIn, 'Increase text size');
    zoomIn.addEventListener('click', () => this._setFontScale(this._fontScale + FONT_SCALE_STEP));

    const reset = this._button(ICON.reset, 'Reset text size');
    reset.addEventListener('click', () => this._setFontScale(1));

    toolbar.append(titleGroup, spacer, zoomOut, this._zoomLabelEl, zoomIn, reset);
    container.appendChild(toolbar);

    this._bodyEl = $('div.epub-reader-body');
    this._navEl = $('aside.epub-reader-nav');
    this._navListEl = $('div.epub-reader-nav-list');
    this._navEl.appendChild(this._navListEl);

    this._scrollContainer = $('div.epub-reader-scroll');
    this._scrollContainer.tabIndex = 0;
    this._scrollContainer.addEventListener('scroll', () => this._scheduleScrollStateUpdate(), { passive: true });

    this._contentEl = $('article.epub-reader-content');
    this._contentEl.addEventListener('click', (event) => this._handleContentClick(event));

    this._loadingEl = $('div.epub-reader-message', 'Loading...');

    this._errorEl = $('div.epub-reader-message.epub-reader-error');
    hide(this._errorEl);

    this._scrollContainer.append(this._loadingEl, this._errorEl, this._contentEl);
    this._bodyEl.append(this._navEl, this._scrollContainer);
    container.appendChild(this._bodyEl);

    this._statusEl = $('div.epub-status-bar');
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

      if (electron.document.readEpub) {
        const readerResult = await electron.document.readEpub(input.uri.fsPath);
        if (seq !== this._loadSeq) return;
        if (readerResult?.error) {
          throw new Error(readerResult.error.message || 'EPUB rendering failed');
        }
        this._renderBook(readerResult as EpubReaderDocument);
      } else {
        const textResult = await electron.document.extractText(input.uri.fsPath);
        if (seq !== this._loadSeq) return;
        if (textResult?.error) {
          throw new Error(textResult.error.message || 'EPUB extraction failed');
        }
        const text = typeof textResult?.text === 'string' ? textResult.text.trim() : '';
        this._renderText(text, textResult?.metadata);
      }

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
    this._navListEl.textContent = '';
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
    this._navListEl.textContent = '';
    this._statusEl.textContent = 'Loading...';
    hide(this._errorEl);
    show(this._loadingEl);
  }

  private _showError(message: string): void {
    this._contentEl.textContent = '';
    this._navListEl.textContent = '';
    this._statusEl.textContent = '';
    hide(this._loadingEl);
    this._errorEl.textContent = message;
    show(this._errorEl);
  }

  private _renderBook(book: EpubReaderDocument): void {
    hide(this._loadingEl);
    hide(this._errorEl);
    this._contentEl.textContent = '';
    this._navListEl.textContent = '';

    const chapters = Array.isArray(book.chapters) ? book.chapters : [];
    this._titleEl.textContent = book.title || this._titleEl.textContent;
    this._lastText = chapters.map((chapter) => chapter.text || '').join('\n\n').trim();
    this._lastMetadata = book.metadata;

    if (chapters.length === 0) {
      this._renderText('', book.metadata);
      return;
    }

    this._navEl.classList.toggle('epub-reader-nav-hidden', chapters.length < 2);

    chapters.forEach((chapter, index) => {
      const section = $('section.epub-chapter');
      section.id = `epub-${chapter.id || index}`;
      section.dataset.chapterIndex = String(index);
      section.innerHTML = chapter.html || '';
      this._contentEl.appendChild(section);

      const navButton = $('button') as HTMLButtonElement;
      navButton.type = 'button';
      navButton.classList.add('epub-reader-nav-item');
      navButton.textContent = chapter.title || `Chapter ${index + 1}`;
      navButton.addEventListener('click', () => section.scrollIntoView({ block: 'start' }));
      this._navListEl.appendChild(navButton);
    });

    this._updateStatus();
  }

  private _renderText(text: string, metadata: unknown): void {
    hide(this._loadingEl);
    hide(this._errorEl);
    this._navEl.classList.add('epub-reader-nav-hidden');
    this._contentEl.textContent = text || 'No extractable text found in this EPUB.';
    this._lastText = text;
    this._lastMetadata = metadata;
    this._updateStatus();
  }

  private _handleContentClick(event: MouseEvent): void {
    const target = event.target as HTMLElement | null;
    const anchor = target?.closest('a[href^="#"]') as HTMLAnchorElement | null;
    if (!anchor) return;
    const id = anchor.getAttribute('href')?.slice(1);
    if (!id) return;
    const destination = this._contentEl.querySelector(`#${CSS.escape(id)}`);
    if (!destination) return;
    event.preventDefault();
    destination.scrollIntoView({ block: 'start' });
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
    if (!this._statusEl) return;
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
