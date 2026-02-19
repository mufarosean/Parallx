// textEditorPane.ts — concrete editor pane for plain text editing
//
// Extends EditorPane to render file/untitled content in a <textarea>.
// Deliberately simple: no syntax highlighting, no autocomplete.
// Includes line-number gutter and minimap.
// Supports word wrap toggle, tab insertion, cursor position tracking,
// and scroll state save/restore.
//
// VS Code reference (architecture only — implementation differs):
//   src/vs/editor/browser/widget/codeEditor/codeEditorWidget.ts

import './textEditorPane.css';
import { EditorPane, type EditorPaneViewState } from '../../editor/editorPane.js';
import type { IEditorInput } from '../../editor/editorInput.js';
import { DisposableStore } from '../../platform/lifecycle.js';
import { Emitter, Event } from '../../platform/events.js';
import { FileEditorInput } from './fileEditorInput.js';
import { UntitledEditorInput } from './untitledEditorInput.js';
import { FindReplaceWidget } from '../../ui/findReplaceWidget.js';
import { $,  hide, show } from '../../ui/dom.js';

// ─── Constants ───────────────────────────────────────────────────────────────

/** Files above this size show a perf warning. */
const LARGE_FILE_THRESHOLD = 1_000_000; // ~1 MB

/** Word-wrap-by-default extensions (prose). */
const WRAP_EXTENSIONS = new Set(['.md', '.txt', '.markdown', '.rst', '.adoc', '.log']);

// ─── TextEditorPane ──────────────────────────────────────────────────────────

export class TextEditorPane extends EditorPane {
  static readonly PANE_ID = 'text-editor-pane';

  private _textarea!: HTMLTextAreaElement;
  private _gutter!: HTMLElement;
  private _editorBody!: HTMLElement;
  private _statusBar!: HTMLElement;
  private _positionItem!: HTMLElement;
  private _encodingItem!: HTMLElement;
  private _eolItem!: HTMLElement;
  private _binaryOverlay!: HTMLElement;

  private _wordWrap = false;
  private _inputListeners = new DisposableStore();
  private _suppressModelUpdate = false;
  private _findWidget: FindReplaceWidget | undefined;

  // Minimap
  private _minimapContainer!: HTMLElement;
  private _minimapCanvas!: HTMLCanvasElement;
  private _minimapSlider!: HTMLElement;
  private _minimapScrollTrack!: HTMLElement;
  private _minimapScrollThumb!: HTMLElement;
  private _minimapDragging = false;
  private _minimapDragStartY = 0;
  private _minimapDragStartScrollTop = 0;
  private _minimapRafId = 0;

  private readonly _onDidToggleWordWrap = this._register(new Emitter<boolean>());
  readonly onDidToggleWordWrap: Event<boolean> = this._onDidToggleWordWrap.event;

  /** Fires when the cursor position changes — consumed by the global status bar. */
  private readonly _onDidChangeCursorPosition = this._register(new Emitter<{ line: number; col: number }>());
  readonly onDidChangeCursorPosition: Event<{ line: number; col: number }> = this._onDidChangeCursorPosition.event;

  constructor() {
    super(TextEditorPane.PANE_ID);
    this._register(this._inputListeners);
  }

  // ── EditorPane hooks ─────────────────────────────────────────────────────

  protected override createPaneContent(container: HTMLElement): void {
    container.classList.add('text-editor-pane');

    // Editor body — flex row containing gutter + textarea
    this._editorBody = $('div');
    this._editorBody.classList.add('text-editor-body');

    // Line number gutter
    this._gutter = $('div');
    this._gutter.classList.add('text-editor-gutter');
    this._gutter.setAttribute('aria-hidden', 'true');
    this._editorBody.appendChild(this._gutter);

    // Textarea
    this._textarea = $('textarea');
    this._textarea.classList.add('text-editor-textarea');
    this._textarea.spellcheck = false;
    this._textarea.autocapitalize = 'off';
    this._textarea.setAttribute('autocomplete', 'off');
    this._textarea.setAttribute('autocorrect', 'off');
    this._textarea.placeholder = 'Start typing…';

    // Store instance reference on the textarea so external commands
    // (e.g. editor.toggleWordWrap) can reach the pane via DOM query.
    (this._textarea as any).__textEditorPane = this;

    // Tab-key override
    this._textarea.addEventListener('keydown', this._onKeyDown);

    // Content changes → push to input
    this._textarea.addEventListener('input', this._onTextInput);

    // Cursor tracking
    this._textarea.addEventListener('keyup', this._updateCursorPosition);
    this._textarea.addEventListener('click', this._updateCursorPosition);
    this._textarea.addEventListener('select', this._updateCursorPosition);

    // Scroll sync: gutter follows textarea vertical scroll
    this._textarea.addEventListener('scroll', this._syncGutterScroll);

    this._editorBody.appendChild(this._textarea);

    // Minimap — scaled-down document overview on the right edge
    this._minimapContainer = $('div');
    this._minimapContainer.classList.add('text-editor-minimap');

    this._minimapCanvas = $('canvas');
    this._minimapCanvas.classList.add('text-editor-minimap-canvas');
    this._minimapContainer.appendChild(this._minimapCanvas);

    this._minimapSlider = $('div');
    this._minimapSlider.classList.add('text-editor-minimap-slider');
    this._minimapContainer.appendChild(this._minimapSlider);

    // Thin scrollbar track on the right edge of the minimap
    this._minimapScrollTrack = $('div');
    this._minimapScrollTrack.classList.add('text-editor-minimap-scrollbar-track');
    this._minimapScrollThumb = $('div');
    this._minimapScrollThumb.classList.add('text-editor-minimap-scrollbar-thumb');
    this._minimapScrollTrack.appendChild(this._minimapScrollThumb);
    this._minimapContainer.appendChild(this._minimapScrollTrack);

    this._editorBody.appendChild(this._minimapContainer);

    // Minimap interactions
    this._minimapContainer.addEventListener('mousedown', this._onMinimapMouseDown);
    this._textarea.addEventListener('scroll', this._updateMinimapSlider);

    // Selection changes → redraw minimap to show highlight
    this._textarea.addEventListener('select', this._renderMinimap.bind(this));
    this._textarea.addEventListener('mouseup', this._renderMinimap.bind(this));

    container.appendChild(this._editorBody);

    // Gutter click → select entire line
    this._gutter.addEventListener('mousedown', this._onGutterClick);

    // Binary file overlay (hidden by default)
    this._binaryOverlay = $('div');
    this._binaryOverlay.classList.add('text-editor-binary');
    this._binaryOverlay.textContent = 'Binary file — cannot display';
    hide(this._binaryOverlay);
    container.appendChild(this._binaryOverlay);

    // Status bar
    this._statusBar = $('div');
    this._statusBar.classList.add('text-editor-status');

    this._positionItem = $('span');
    this._positionItem.classList.add('text-editor-status-item');
    this._positionItem.textContent = 'Ln 1, Col 1';

    this._encodingItem = $('span');
    this._encodingItem.classList.add('text-editor-status-item');
    this._encodingItem.textContent = 'UTF-8';

    this._eolItem = $('span');
    this._eolItem.classList.add('text-editor-status-item');
    this._eolItem.textContent = 'LF';

    this._statusBar.appendChild(this._positionItem);
    this._statusBar.appendChild(this._encodingItem);
    this._statusBar.appendChild(this._eolItem);
    container.appendChild(this._statusBar);

    // Find & Replace widget (overlay — positioned absolute inside .editor-pane)
    this._findWidget = this._register(new FindReplaceWidget(container, {
      textarea: this._textarea,
    }));
  }

  protected override async renderInput(
    input: IEditorInput,
    _previous: IEditorInput | undefined,
  ): Promise<void> {
    // Clear previous input listeners
    this._inputListeners.clear();

    // Determine word-wrap default based on file extension
    const name = input.name ?? '';
    const dotIdx = name.lastIndexOf('.');
    const ext = dotIdx >= 0 ? name.substring(dotIdx).toLowerCase() : '';
    this._wordWrap = WRAP_EXTENSIONS.has(ext);
    this._applyWordWrap();

    let content = '';
    let isBinary = false;

    if (input instanceof FileEditorInput) {
      // Resolve the TextFileModel (lazy load from disk)
      try {
        const model = await input.resolve();
        content = model.content;

        // Detect binary: check for null bytes or non-text characters
        if (this._isBinaryContent(content)) {
          isBinary = true;
        }

        // Large file warning
        if (content.length > LARGE_FILE_THRESHOLD) {
          console.warn(
            `[TextEditorPane] Large file (${(content.length / 1_000_000).toFixed(1)} MB): ` +
            `${input.name} — editing may be slow.`,
          );
        }

        // Listen for external content changes (e.g., file watcher reload)
        this._inputListeners.add(input.onDidChangeContent((newContent) => {
          if (!this._suppressModelUpdate) {
            this._textarea.value = newContent;
            this._detectEol(newContent);
            this._updateLineNumbers();
            this._renderMinimap();
          }
        }));
      } catch (err) {
        console.error('[TextEditorPane] Failed to resolve file:', err);
        content = '';
      }
    } else if (input instanceof UntitledEditorInput) {
      content = input.content;

      // Listen for external content changes
      this._inputListeners.add(input.onDidChangeContent((newContent) => {
        if (!this._suppressModelUpdate) {
          this._textarea.value = newContent;
          this._updateLineNumbers();
          this._renderMinimap();
        }
      }));
    }

    // Show binary overlay or textarea
    if (isBinary) {
      hide(this._textarea);
      show(this._binaryOverlay);
      this._textarea.value = '';
    } else {
      show(this._textarea);
      hide(this._binaryOverlay);
      this._textarea.value = content;
    }

    // Detect line endings
    this._detectEol(content);

    // Update cursor position to 1:1
    this._updateCursorPosition();

    // Build initial gutter line numbers
    this._updateLineNumbers();

    // Render minimap
    this._renderMinimap();
  }

  protected override clearPaneContent(_previous: IEditorInput | undefined): void {
    this._inputListeners.clear();
    this._textarea.value = '';
    this._positionItem.textContent = 'Ln 1, Col 1';
    this._encodingItem.textContent = 'UTF-8';
    this._eolItem.textContent = 'LF';
    hide(this._binaryOverlay);
    show(this._textarea);
    this._lineCount = 0;
    this._updateLineNumbers();
    this._renderMinimap();
  }

  protected override layoutPaneContent(_width: number, _height: number): void {
    // textarea fills via flex; redraw minimap on resize
    this._renderMinimap();
  }

  // ── Focus ──

  override focus(): void {
    this._textarea?.focus();
  }

  // ── View State ──

  protected override savePaneViewState(): EditorPaneViewState {
    return {
      scrollTop: this._textarea?.scrollTop ?? 0,
      scrollLeft: this._textarea?.scrollLeft ?? 0,
      selectionStart: this._textarea?.selectionStart ?? 0,
      selectionEnd: this._textarea?.selectionEnd ?? 0,
      wordWrap: this._wordWrap,
    };
  }

  protected override restorePaneViewState(state: EditorPaneViewState): void {
    if (!this._textarea) return;

    if (typeof state.scrollTop === 'number') {
      this._textarea.scrollTop = state.scrollTop;
    }
    if (typeof state.scrollLeft === 'number') {
      this._textarea.scrollLeft = state.scrollLeft;
    }
    if (typeof state.selectionStart === 'number' && typeof state.selectionEnd === 'number') {
      this._textarea.setSelectionRange(
        state.selectionStart as number,
        state.selectionEnd as number,
      );
    }
    if (typeof state.wordWrap === 'boolean') {
      this._wordWrap = state.wordWrap;
      this._applyWordWrap();
    }
  }

  // ── Word Wrap ──

  toggleWordWrap(): void {
    this._wordWrap = !this._wordWrap;
    this._applyWordWrap();
    this._onDidToggleWordWrap.fire(this._wordWrap);
    this.fireViewStateChanged();
  }

  get isWordWrapEnabled(): boolean {
    return this._wordWrap;
  }

  // ── Find & Replace ──

  /** Show the find bar (Ctrl+F). If already visible, re-focus it. */
  showFind(): void {
    if (!this._findWidget) return;
    if (this._findWidget.visible) {
      this._findWidget.focusFind();
    } else {
      this._findWidget.show(false);
    }
  }

  /** Show the find+replace bar (Ctrl+H). */
  showReplace(): void {
    if (!this._findWidget) return;
    if (this._findWidget.visible) {
      this._findWidget.focusReplace();
    } else {
      this._findWidget.show(true);
    }
  }

  /** Get the find widget (for command wiring). */
  get findWidget(): FindReplaceWidget | undefined {
    return this._findWidget;
  }

  private _applyWordWrap(): void {
    if (!this._textarea) return;
    this._textarea.classList.toggle('text-editor-textarea--wrap', this._wordWrap);
    // Wrapping changes scroll geometry → refresh minimap + slider
    this._renderMinimap();
    this._updateMinimapSlider();
  }

  // ── Private Handlers ───────────────────────────────────────────────────

  private readonly _onKeyDown = (e: KeyboardEvent): void => {
    if (e.key === 'Tab') {
      e.preventDefault();
      const ta = this._textarea;
      const start = ta.selectionStart;
      const end = ta.selectionEnd;

      // Insert tab at cursor position
      ta.value = ta.value.substring(0, start) + '\t' + ta.value.substring(end);
      ta.selectionStart = ta.selectionEnd = start + 1;

      // Trigger the input handler so the model sees the change
      this._pushContentToInput();
    }
  };

  private readonly _onTextInput = (): void => {
    this._pushContentToInput();
    this._updateCursorPosition();
    this._updateLineNumbers();
    this._renderMinimap();
  };

  private _pushContentToInput(): void {
    const input = this.input;
    if (!input) return;

    const value = this._textarea.value;

    // Suppress echo: we are the source of this change,
    // so don't let the onDidChangeContent listener overwrite the textarea
    this._suppressModelUpdate = true;
    try {
      if (input instanceof FileEditorInput) {
        input.updateContent(value);
      } else if (input instanceof UntitledEditorInput) {
        input.updateContent(value);
      }
    } finally {
      this._suppressModelUpdate = false;
    }
  }

  private readonly _updateCursorPosition = (): void => {
    if (!this._textarea || !this._positionItem) return;

    const pos = this._textarea.selectionStart;
    const text = this._textarea.value.substring(0, pos);
    const lines = text.split('\n');
    const line = lines.length;
    const col = (lines[lines.length - 1]?.length ?? 0) + 1;

    this._cursorLine = line;
    this._cursorCol = col;
    this._positionItem.textContent = `Ln ${line}, Col ${col}`;
    this._onDidChangeCursorPosition.fire({ line, col });
  };

  // ── Public getters for status bar consumers ────────────────────────────

  private _cursorLine = 1;
  private _cursorCol = 1;

  /** Current cursor line (1-based). */
  get cursorLine(): number { return this._cursorLine; }
  /** Current cursor column (1-based). */
  get cursorCol(): number { return this._cursorCol; }
  /** Current EOL sequence label. */
  get eolLabel(): string { return this._eolItem?.textContent ?? 'LF'; }

  private _detectEol(content: string): void {
    if (!this._eolItem) return;

    if (content.includes('\r\n')) {
      this._eolItem.textContent = 'CRLF';
    } else {
      this._eolItem.textContent = 'LF';
    }
  }

  private _isBinaryContent(content: string): boolean {
    // Simple check: if content has null characters, likely binary
    for (let i = 0, len = Math.min(content.length, 8192); i < len; i++) {
      if (content.charCodeAt(i) === 0) return true;
    }
    return false;
  }

  // ── Line Number Gutter ─────────────────────────────────────────────────

  private _lineCount = 0;

  /** Rebuild gutter line numbers when the line count changes. */
  private _updateLineNumbers(): void {
    const text = this._textarea?.value ?? '';
    const newCount = text.split('\n').length;

    if (newCount === this._lineCount) return;
    this._lineCount = newCount;

    // Calculate gutter width based on digit count
    const digits = Math.max(2, String(newCount).length);
    this._gutter.style.width = `${digits * 8 + 24}px`;

    // Build line numbers in a single DOM write via fragment
    const frag = document.createDocumentFragment();
    for (let i = 1; i <= newCount; i++) {
      const line = $('div');
      line.classList.add('text-editor-gutter-line');
      line.textContent = String(i);
      line.dataset.lineNumber = String(i);
      frag.appendChild(line);
    }

    this._gutter.textContent = '';
    this._gutter.appendChild(frag);

    // Re-sync scroll position
    this._syncGutterScroll();
  }

  /** Keep gutter scroll in sync with textarea. */
  private readonly _syncGutterScroll = (): void => {
    if (this._gutter && this._textarea) {
      this._gutter.scrollTop = this._textarea.scrollTop;
    }
  };

  /** Click on a gutter line number → select the entire line. */
  private readonly _onGutterClick = (e: MouseEvent): void => {
    // Prevent default to stop the gutter from stealing focus / starting
    // a native text selection, which would interfere with setSelectionRange.
    e.preventDefault();

    const target = e.target as HTMLElement;
    const lineNumStr = target.dataset?.lineNumber;
    if (!lineNumStr) return;

    const lineNum = parseInt(lineNumStr, 10);
    if (isNaN(lineNum)) return;

    const lines = this._textarea.value.split('\n');
    if (lineNum < 1 || lineNum > lines.length) return;

    // Calculate offset to start of the clicked line
    let offset = 0;
    for (let i = 0; i < lineNum - 1; i++) {
      offset += lines[i].length + 1;
    }

    // Select the entire line (including trailing newline if not last)
    const lineEnd = offset + lines[lineNum - 1].length;
    const selectEnd = lineNum < lines.length ? lineEnd + 1 : lineEnd;

    // Set selection BEFORE focus so the browser doesn't scroll to the old
    // caret position (which causes the "jump to bottom" on first click).
    this._textarea.setSelectionRange(offset, selectEnd);
    this._textarea.focus({ preventScroll: true });
    this._updateCursorPosition();
    this._renderMinimap();
  };

  // ── Minimap ─────────────────────────────────────────────────────────────

  /** Schedule a minimap redraw (batched via rAF). */
  private _renderMinimap(): void {
    if (this._minimapRafId) return;
    this._minimapRafId = requestAnimationFrame(() => {
      this._minimapRafId = 0;
      this._renderMinimapNow();
    });
  }

  /** Render the minimap canvas — each line drawn as a proportional bar. */
  private _renderMinimapNow(): void {
    const canvas = this._minimapCanvas;
    const container = this._minimapContainer;
    if (!canvas || !container) return;

    const dpr = window.devicePixelRatio || 1;
    const rect = container.getBoundingClientRect();
    const width = rect.width;
    const height = rect.height;
    if (width === 0 || height === 0) return;

    // Size canvas for crisp rendering
    canvas.width = width * dpr;
    canvas.height = height * dpr;
    canvas.style.width = `${width}px`;
    canvas.style.height = `${height}px`;

    const ctx = canvas.getContext('2d');
    if (!ctx) return;
    ctx.scale(dpr, dpr);
    ctx.clearRect(0, 0, width, height);

    const text = this._textarea?.value ?? '';
    if (text.length === 0) { this._updateMinimapSlider(); return; }

    const lines = text.split('\n');
    const totalLines = lines.length;

    // Each line is ideally 2px tall; scale down if the doc is huge
    const idealLineH = 2;
    const lineH = Math.min(idealLineH, height / totalLines);
    const maxChars = 120;
    // Leave room for scrollbar (14px on right)
    const barArea = width - 22;

    // ── Determine selection range in line numbers ─────────────────────
    let selStartLine = -1;
    let selEndLine = -1;
    const ss = this._textarea?.selectionStart ?? 0;
    const se = this._textarea?.selectionEnd ?? 0;
    if (se > ss) {
      // Walk chars to find selection line range
      let charIdx = 0;
      for (let i = 0; i < totalLines; i++) {
        const lineEnd = charIdx + lines[i].length; // not counting '\n'
        if (selStartLine < 0 && ss <= lineEnd) selStartLine = i;
        if (se <= lineEnd + 1) { selEndLine = i; break; }
        charIdx = lineEnd + 1;
      }
      if (selEndLine < 0) selEndLine = totalLines - 1;
    }

    // ── Draw selection highlight first (behind text bars) ────────────
    if (selStartLine >= 0 && selEndLine >= selStartLine) {
      const selColor = getComputedStyle(document.documentElement).getPropertyValue('--vscode-minimap-selectionHighlight').trim() || 'rgba(38, 79, 120, 0.6)';
      ctx.fillStyle = selColor;
      const sy = selStartLine * lineH;
      const sh = (selEndLine - selStartLine + 1) * lineH;
      ctx.fillRect(0, sy, width - 14, Math.max(1, sh));
    }

    // ── Draw text line bars ──────────────────────────────────────────
    const barColor = getComputedStyle(document.documentElement).getPropertyValue('--vscode-editor-foreground').trim() || 'rgba(200, 200, 200, 0.35)';
    // Apply alpha to the bar color for subtle rendering
    ctx.globalAlpha = 0.35;
    ctx.fillStyle = barColor;

    for (let i = 0; i < totalLines; i++) {
      const len = lines[i].length;
      if (len === 0) continue;
      const barW = Math.min(len, maxChars) / maxChars * barArea;
      const y = i * lineH;
      if (y > height) break;
      ctx.fillRect(4, y, barW, Math.max(0.5, lineH - 0.5));
    }
    ctx.globalAlpha = 1;

    this._updateMinimapSlider();
  }

  /** Reposition the viewport slider over the minimap. */
  private readonly _updateMinimapSlider = (): void => {
    if (!this._minimapSlider || !this._textarea || !this._minimapContainer) return;

    const ta = this._textarea;
    const ch = this._minimapContainer.clientHeight;
    if (ch === 0 || ta.scrollHeight === 0) return;

    const viewportRatio = Math.min(1, ta.clientHeight / ta.scrollHeight);
    const sliderH = Math.max(20, viewportRatio * ch);

    const scrollable = ta.scrollHeight - ta.clientHeight;
    const scrollRatio = scrollable > 0 ? ta.scrollTop / scrollable : 0;
    const maxTop = ch - sliderH;
    const sliderTop = scrollRatio * maxTop;

    this._minimapSlider.style.top = `${sliderTop}px`;
    this._minimapSlider.style.height = `${sliderH}px`;
    viewportRatio >= 1 ? hide(this._minimapSlider) : show(this._minimapSlider);

    // Update the thin scrollbar thumb on the right edge
    if (this._minimapScrollThumb && this._minimapScrollTrack) {
      const trackH = this._minimapScrollTrack.clientHeight;
      const thumbH = Math.max(16, viewportRatio * trackH);
      const thumbTop = scrollRatio * (trackH - thumbH);
      this._minimapScrollThumb.style.top = `${thumbTop}px`;
      this._minimapScrollThumb.style.height = `${thumbH}px`;
      viewportRatio >= 1 ? hide(this._minimapScrollTrack) : show(this._minimapScrollTrack);
    }
  };

  /** Mousedown on minimap: click-to-scroll or start slider drag. */
  private readonly _onMinimapMouseDown = (e: MouseEvent): void => {
    e.preventDefault();

    const containerRect = this._minimapContainer.getBoundingClientRect();
    const clickY = e.clientY - containerRect.top;

    // If clicking on the slider itself → start drag
    const sr = this._minimapSlider.getBoundingClientRect();
    if (e.clientY >= sr.top && e.clientY <= sr.bottom) {
      this._minimapDragging = true;
      this._minimapDragStartY = e.clientY;
      this._minimapDragStartScrollTop = this._textarea.scrollTop;
      document.addEventListener('mousemove', this._onMinimapMouseMove);
      document.addEventListener('mouseup', this._onMinimapMouseUp);
      return;
    }

    // Click outside slider → centre viewport on clicked position
    const ratio = clickY / containerRect.height;
    this._textarea.scrollTop = Math.max(
      0,
      ratio * this._textarea.scrollHeight - this._textarea.clientHeight / 2,
    );
  };

  private readonly _onMinimapMouseMove = (e: MouseEvent): void => {
    if (!this._minimapDragging) return;
    const deltaY = e.clientY - this._minimapDragStartY;
    const scrollDelta = (deltaY / this._minimapContainer.clientHeight) * this._textarea.scrollHeight;
    const scrollable = this._textarea.scrollHeight - this._textarea.clientHeight;
    this._textarea.scrollTop = Math.max(0, Math.min(scrollable, this._minimapDragStartScrollTop + scrollDelta));
  };

  private readonly _onMinimapMouseUp = (): void => {
    this._minimapDragging = false;
    document.removeEventListener('mousemove', this._onMinimapMouseMove);
    document.removeEventListener('mouseup', this._onMinimapMouseUp);
  };

  // ── Accessor for external use ──

  get textarea(): HTMLTextAreaElement {
    return this._textarea;
  }

  // ── Dispose ──

  override dispose(): void {
    this._textarea?.removeEventListener('keydown', this._onKeyDown);
    this._textarea?.removeEventListener('input', this._onTextInput);
    this._textarea?.removeEventListener('keyup', this._updateCursorPosition);
    this._textarea?.removeEventListener('click', this._updateCursorPosition);
    this._textarea?.removeEventListener('select', this._updateCursorPosition);
    this._textarea?.removeEventListener('scroll', this._syncGutterScroll);
    this._textarea?.removeEventListener('scroll', this._updateMinimapSlider);
    this._gutter?.removeEventListener('mousedown', this._onGutterClick);
    this._minimapContainer?.removeEventListener('mousedown', this._onMinimapMouseDown);
    document.removeEventListener('mousemove', this._onMinimapMouseMove);
    document.removeEventListener('mouseup', this._onMinimapMouseUp);
    if (this._minimapRafId) cancelAnimationFrame(this._minimapRafId);
    super.dispose();
  }
}
