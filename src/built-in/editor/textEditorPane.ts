// textEditorPane.ts — concrete editor pane for plain text editing
//
// Extends EditorPane to render file/untitled content in a <textarea>.
// Deliberately simple: no syntax highlighting, no autocomplete, no minimap.
// Supports word wrap toggle, tab insertion, cursor position tracking,
// and scroll state save/restore.
//
// VS Code reference (architecture only — implementation differs):
//   src/vs/editor/browser/widget/codeEditor/codeEditorWidget.ts

import { EditorPane, type EditorPaneViewState } from '../../editor/editorPane.js';
import type { IEditorInput } from '../../editor/editorInput.js';
import { DisposableStore, type IDisposable } from '../../platform/lifecycle.js';
import { Emitter, Event } from '../../platform/events.js';
import { FileEditorInput } from './fileEditorInput.js';
import { UntitledEditorInput } from './untitledEditorInput.js';
import { FindReplaceWidget } from '../../ui/findReplaceWidget.js';

// ─── Constants ───────────────────────────────────────────────────────────────

/** Files above this size show a perf warning. */
const LARGE_FILE_THRESHOLD = 1_000_000; // ~1 MB

/** Word-wrap-by-default extensions (prose). */
const WRAP_EXTENSIONS = new Set(['.md', '.txt', '.markdown', '.rst', '.adoc', '.log']);

// ─── TextEditorPane ──────────────────────────────────────────────────────────

export class TextEditorPane extends EditorPane {
  static readonly PANE_ID = 'text-editor-pane';

  private _textarea!: HTMLTextAreaElement;
  private _statusBar!: HTMLElement;
  private _positionItem!: HTMLElement;
  private _encodingItem!: HTMLElement;
  private _eolItem!: HTMLElement;
  private _binaryOverlay!: HTMLElement;

  private _wordWrap = false;
  private _inputListeners = new DisposableStore();
  private _suppressModelUpdate = false;
  private _findWidget: FindReplaceWidget | undefined;

  private readonly _onDidToggleWordWrap = this._register(new Emitter<boolean>());
  readonly onDidToggleWordWrap: Event<boolean> = this._onDidToggleWordWrap.event;

  constructor() {
    super(TextEditorPane.PANE_ID);
    this._register(this._inputListeners);
  }

  // ── EditorPane hooks ─────────────────────────────────────────────────────

  protected override createPaneContent(container: HTMLElement): void {
    container.classList.add('text-editor-pane');

    // Textarea
    this._textarea = document.createElement('textarea');
    this._textarea.classList.add('text-editor-textarea');
    this._textarea.spellcheck = false;
    this._textarea.autocapitalize = 'off';
    this._textarea.setAttribute('autocomplete', 'off');
    this._textarea.setAttribute('autocorrect', 'off');
    this._textarea.placeholder = 'Start typing…';

    // Tab-key override
    this._textarea.addEventListener('keydown', this._onKeyDown);

    // Content changes → push to input
    this._textarea.addEventListener('input', this._onTextInput);

    // Cursor tracking
    this._textarea.addEventListener('keyup', this._updateCursorPosition);
    this._textarea.addEventListener('click', this._updateCursorPosition);
    this._textarea.addEventListener('select', this._updateCursorPosition);

    container.appendChild(this._textarea);

    // Binary file overlay (hidden by default)
    this._binaryOverlay = document.createElement('div');
    this._binaryOverlay.classList.add('text-editor-binary');
    this._binaryOverlay.textContent = 'Binary file — cannot display';
    this._binaryOverlay.style.display = 'none';
    container.appendChild(this._binaryOverlay);

    // Status bar
    this._statusBar = document.createElement('div');
    this._statusBar.classList.add('text-editor-status');

    this._positionItem = document.createElement('span');
    this._positionItem.classList.add('text-editor-status-item');
    this._positionItem.textContent = 'Ln 1, Col 1';

    this._encodingItem = document.createElement('span');
    this._encodingItem.classList.add('text-editor-status-item');
    this._encodingItem.textContent = 'UTF-8';

    this._eolItem = document.createElement('span');
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
        }
      }));
    }

    // Show binary overlay or textarea
    if (isBinary) {
      this._textarea.style.display = 'none';
      this._binaryOverlay.style.display = '';
      this._textarea.value = '';
    } else {
      this._textarea.style.display = '';
      this._binaryOverlay.style.display = 'none';
      this._textarea.value = content;
    }

    // Detect line endings
    this._detectEol(content);

    // Update cursor position to 1:1
    this._updateCursorPosition();
  }

  protected override clearPaneContent(_previous: IEditorInput | undefined): void {
    this._inputListeners.clear();
    this._textarea.value = '';
    this._positionItem.textContent = 'Ln 1, Col 1';
    this._encodingItem.textContent = 'UTF-8';
    this._eolItem.textContent = 'LF';
    this._binaryOverlay.style.display = 'none';
    this._textarea.style.display = '';
  }

  protected override layoutPaneContent(_width: number, _height: number): void {
    // textarea fills via flex; nothing to do here
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

    this._positionItem.textContent = `Ln ${line}, Col ${col}`;
  };

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
    super.dispose();
  }
}
