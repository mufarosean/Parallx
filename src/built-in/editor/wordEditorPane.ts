// wordEditorPane.ts — Word (.docx) reader pane.
//
// Renders mammoth-converted HTML from the Electron document bridge as a safe,
// read-only document view. The HTML is allowlist-sanitized in the renderer
// (DOM-based, not regex) before it ever touches the live document, so no
// script, event handler, or remote resource can survive. Plain-text extraction
// (indexing) stays on its own path.

import './wordEditorPane.css';
import { EditorPane, type EditorPaneViewState } from '../../editor/editorPane.js';
import type { IEditorInput } from '../../editor/editorInput.js';
import { $, hide, show } from '../../ui/dom.js';
import { getIcon } from '../../ui/iconRegistry.js';
import { WordEditorInput } from './wordEditorInput.js';

const PANE_ID = 'word-editor-pane';
const MIN_FONT_SCALE = 0.8;
const MAX_FONT_SCALE = 1.6;
const FONT_SCALE_STEP = 0.1;

const ICON = {
  doc: getIcon('file-text'),
  zoomOut: getIcon('zoom-out'),
  zoomIn: getIcon('zoom-in'),
  reset: getIcon('rotate-ccw'),
};

interface DocxReaderDocument {
  readonly format: 'docx';
  readonly title: string;
  readonly html: string;
  readonly messages?: readonly string[];
}

// Structural tags we keep from mammoth's output. Anything else is unwrapped
// (children preserved) so a stray wrapper never drops content.
const ALLOWED_TAGS = new Set([
  'p', 'h1', 'h2', 'h3', 'h4', 'h5', 'h6', 'ul', 'ol', 'li',
  'strong', 'b', 'em', 'i', 'u', 's', 'strike', 'a', 'br', 'hr',
  'blockquote', 'code', 'pre', 'table', 'thead', 'tbody', 'tfoot',
  'tr', 'td', 'th', 'caption', 'colgroup', 'col', 'img', 'sup', 'sub', 'span', 'div',
]);

/** DOM-based allowlist sanitizer. Parses into an inert document (no scripts run,
 *  no resources load), then re-creates only allowed tags/attributes as fresh
 *  nodes. */
function sanitizeDocxHtml(html: string): DocumentFragment {
  const parsed = new DOMParser().parseFromString(html, 'text/html');
  const out = document.createDocumentFragment();

  const copy = (src: Node): Node | null => {
    if (src.nodeType === Node.TEXT_NODE) return document.createTextNode(src.nodeValue ?? '');
    if (src.nodeType !== Node.ELEMENT_NODE) return null;

    const el = src as Element;
    const tag = el.tagName.toLowerCase();

    if (!ALLOWED_TAGS.has(tag)) {
      // Unwrap: keep the children, drop the disallowed element itself.
      const frag = document.createDocumentFragment();
      el.childNodes.forEach((c) => { const n = copy(c); if (n) frag.appendChild(n); });
      return frag;
    }

    const clone = document.createElement(tag);
    if (tag === 'a') {
      const href = el.getAttribute('href') ?? '';
      if (/^(https?:|mailto:)/i.test(href)) {
        clone.setAttribute('href', href);
        clone.setAttribute('target', '_blank');
        clone.setAttribute('rel', 'noopener noreferrer');
      }
    } else if (tag === 'img') {
      const src2 = el.getAttribute('src') ?? '';
      if (/^data:image\//i.test(src2)) clone.setAttribute('src', src2);
      const alt = el.getAttribute('alt');
      if (alt) clone.setAttribute('alt', alt);
    } else if (tag === 'td' || tag === 'th') {
      for (const a of ['colspan', 'rowspan']) {
        const v = el.getAttribute(a);
        if (v && /^\d{1,3}$/.test(v)) clone.setAttribute(a, v);
      }
    } else if ((tag === 'col' || tag === 'colgroup')) {
      const span = el.getAttribute('span');
      if (span && /^\d{1,3}$/.test(span)) clone.setAttribute('span', span);
    }

    el.childNodes.forEach((c) => { const n = copy(c); if (n) clone.appendChild(n); });
    return clone;
  };

  parsed.body.childNodes.forEach((c) => { const n = copy(c); if (n) out.appendChild(n); });
  return out;
}

function clamp(v: number, lo: number, hi: number): number { return Math.min(hi, Math.max(lo, v)); }

export class WordEditorPane extends EditorPane {
  static readonly PANE_ID = PANE_ID;

  private _titleEl!: HTMLElement;
  private _zoomLabelEl!: HTMLElement;
  private _scrollContainer!: HTMLElement;
  private _contentEl!: HTMLElement;
  private _loadingEl!: HTMLElement;
  private _errorEl!: HTMLElement;

  private _current: WordEditorInput | null = null;
  private _fontScale = 1;
  private _loadSeq = 0;
  private _scrollRaf = 0;

  constructor() {
    super(PANE_ID);
  }

  protected override createPaneContent(container: HTMLElement): void {
    container.classList.add('word-editor-pane');

    // ── Toolbar ──
    const toolbar = $('div.word-toolbar');
    const titleGroup = $('div.word-toolbar-title-group');
    const icon = $('span.word-toolbar-icon');
    if (ICON.doc) icon.innerHTML = ICON.doc;
    this._titleEl = $('span.word-toolbar-title');
    titleGroup.appendChild(icon);
    titleGroup.appendChild(this._titleEl);
    toolbar.appendChild(titleGroup);

    const spacer = $('div.word-toolbar-spacer');
    toolbar.appendChild(spacer);

    const zoomOut = this._button(ICON.zoomOut, 'Zoom out');
    zoomOut.addEventListener('click', () => this._setFontScale(this._fontScale - FONT_SCALE_STEP));
    this._zoomLabelEl = $('span.word-toolbar-zoom-label');
    const zoomIn = this._button(ICON.zoomIn, 'Zoom in');
    zoomIn.addEventListener('click', () => this._setFontScale(this._fontScale + FONT_SCALE_STEP));
    const reset = this._button(ICON.reset, 'Reset zoom');
    reset.addEventListener('click', () => this._setFontScale(1));
    toolbar.appendChild(zoomOut);
    toolbar.appendChild(this._zoomLabelEl);
    toolbar.appendChild(zoomIn);
    toolbar.appendChild(reset);
    container.appendChild(toolbar);

    // ── Scrollable document surface ──
    this._scrollContainer = $('div.word-reader-scroll');
    this._scrollContainer.tabIndex = 0;
    this._contentEl = $('article.word-reader-content');
    this._scrollContainer.appendChild(this._contentEl);
    container.appendChild(this._scrollContainer);

    this._loadingEl = $('div.word-reader-message', 'Loading…');
    this._errorEl = $('div.word-reader-message.word-reader-error');
    container.appendChild(this._loadingEl);
    container.appendChild(this._errorEl);
    hide(this._loadingEl);
    hide(this._errorEl);

    this._scrollContainer.addEventListener('scroll', () => {
      if (this._scrollRaf) return;
      this._scrollRaf = requestAnimationFrame(() => {
        this._scrollRaf = 0;
        if (this._current) this._current.scrollTop = this._scrollContainer.scrollTop;
      });
    });

    this._applyFontScale();
  }

  protected override async renderInput(input: IEditorInput, _previous: IEditorInput | undefined): Promise<void> {
    if (!(input instanceof WordEditorInput)) {
      this._showError('Cannot render: not a Word input.');
      return;
    }
    this._current = input;
    const seq = ++this._loadSeq;
    this._titleEl.textContent = input.name;
    this._fontScale = clamp(input.fontScale || 1, MIN_FONT_SCALE, MAX_FONT_SCALE);
    this._applyFontScale();
    this._showLoading();

    try {
      const electron = (globalThis as { parallxElectron?: { document?: { readDocx?: (p: string) => Promise<DocxReaderDocument | { error?: { message?: string } }> } } }).parallxElectron;
      if (!electron?.document?.readDocx) {
        throw new Error('Document bridge not available');
      }
      const result = await electron.document.readDocx(input.uri.fsPath);
      if (seq !== this._loadSeq) return;
      if (result && 'error' in result && result.error) {
        throw new Error(result.error.message || 'Word rendering failed');
      }
      this._renderDoc(result as DocxReaderDocument);

      requestAnimationFrame(() => {
        if (seq !== this._loadSeq) return;
        this._scrollContainer.scrollTop = input.scrollTop || 0;
      });
    } catch (err) {
      if (seq !== this._loadSeq) return;
      console.error('[WordEditorPane] Failed to load Word document:', err);
      this._showError(`Couldn’t open this document: ${(err as Error).message}`);
    }
  }

  protected override clearPaneContent(_previous: IEditorInput | undefined): void {
    this._loadSeq++;
    this._current = null;
    this._contentEl.textContent = '';
    this._titleEl.textContent = '';
    this._fontScale = 1;
    this._applyFontScale();
    hide(this._loadingEl);
    hide(this._errorEl);
  }

  override focus(): void {
    this._scrollContainer?.focus();
  }

  protected override savePaneViewState(): EditorPaneViewState {
    return { scrollTop: this._scrollContainer?.scrollTop ?? 0, fontScale: this._fontScale };
  }

  protected override restorePaneViewState(state: EditorPaneViewState): void {
    if (typeof state.fontScale === 'number') this._setFontScale(state.fontScale, false);
    if (typeof state.scrollTop === 'number' && this._scrollContainer) {
      this._scrollContainer.scrollTop = state.scrollTop;
      if (this._current) this._current.scrollTop = state.scrollTop;
    }
  }

  override dispose(): void {
    if (this._scrollRaf) { cancelAnimationFrame(this._scrollRaf); this._scrollRaf = 0; }
    super.dispose();
  }

  // ── Rendering ──

  private _renderDoc(doc: DocxReaderDocument): void {
    hide(this._loadingEl);
    hide(this._errorEl);
    this._contentEl.textContent = '';
    const safe = sanitizeDocxHtml(doc.html || '');
    if (!safe.hasChildNodes()) {
      this._contentEl.appendChild($('p.word-reader-empty', 'This document has no readable content.'));
      return;
    }
    this._contentEl.appendChild(safe);
    show(this._scrollContainer);
  }

  private _showLoading(): void {
    this._contentEl.textContent = '';
    hide(this._errorEl);
    show(this._loadingEl);
  }

  private _showError(message: string): void {
    this._contentEl.textContent = '';
    hide(this._loadingEl);
    this._errorEl.textContent = message;
    show(this._errorEl);
  }

  // ── Zoom ──

  private _setFontScale(scale: number, persist = true): void {
    this._fontScale = clamp(Math.round(scale * 10) / 10, MIN_FONT_SCALE, MAX_FONT_SCALE);
    this._applyFontScale();
    if (persist && this._current) this._current.fontScale = this._fontScale;
  }

  private _applyFontScale(): void {
    if (this._contentEl) this._contentEl.style.setProperty('--word-font-scale', String(this._fontScale));
    if (this._zoomLabelEl) this._zoomLabelEl.textContent = `${Math.round(this._fontScale * 100)}%`;
  }

  private _button(iconSvg: string | undefined, title: string): HTMLButtonElement {
    const button = $('button') as HTMLButtonElement;
    button.type = 'button';
    button.classList.add('word-toolbar-btn');
    button.title = title;
    button.setAttribute('aria-label', title);
    if (iconSvg) button.innerHTML = iconSvg;
    else button.textContent = title;
    return button;
  }
}
