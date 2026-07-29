// codeEditorPane.ts — the editor pane for code files (M95).
//
// Sits alongside TextEditorPane rather than replacing it. TextEditorPane is a
// textarea with a hand-rolled gutter and minimap, which is the right tool for
// a log or a .txt and structurally incapable of syntax highlighting — the text
// you edit IS the text you see. Rather than gut 800 lines of working code,
// code file types route here, exactly as .md routes to MarkdownEditorPane and
// .xlsx to ExcelEditorPane. Plain text is unaffected.
//
// Everything visual comes from the shared CodeEditor primitive (src/ui/
// codeEditor.ts), which notebook cells will use too. This file owns only the
// pane concerns: binding to the editor input, dirty tracking, the toolbar, and
// the status line.

import './codeEditorPane.css';
import { EditorPane, type EditorPaneViewState } from '../../editor/editorPane.js';
import type { IEditorInput } from '../../editor/editorInput.js';
import { DisposableStore } from '../../platform/lifecycle.js';
import { CodeEditor } from '../../ui/codeEditor.js';
import { FileEditorInput } from './fileEditorInput.js';
import { UntitledEditorInput } from './untitledEditorInput.js';
import { getLanguageForFileName } from '../../services/languageDetection.js';
import { $ } from '../../ui/dom.js';
import type { IPythonEnvService } from '../../services/pythonEnvService.js';

/** Files above this size skip the fancy surface — CM6 is fast but not free. */
const LARGE_FILE_THRESHOLD = 2_000_000;

/** Extensions whose conventional indent is 2 spaces rather than 4. */
const TWO_SPACE_EXTENSIONS = new Set([
  '.ts', '.tsx', '.js', '.jsx', '.mjs', '.cjs', '.json', '.jsonc',
  '.html', '.htm', '.css', '.scss', '.md', '.markdown',
]);

export class CodeEditorPane extends EditorPane {
  static readonly PANE_ID = 'code-editor-pane';

  private _body!: HTMLElement;
  private _toolbar!: HTMLElement;
  private _statusBar!: HTMLElement;
  private _positionItem!: HTMLElement;
  private _languageItem!: HTMLElement;
  private _eolItem!: HTMLElement;
  private _messageItem!: HTMLElement;
  private _formatBtn!: HTMLButtonElement;
  private _runBtn!: HTMLButtonElement;

  private _editor: CodeEditor | undefined;
  private readonly _inputListeners = new DisposableStore();
  private _currentInput: IEditorInput | undefined;
  private _messageTimer: ReturnType<typeof setTimeout> | undefined;

  /**
   * Late-bound rather than injected: the pane is constructed by a factory with
   * no service access, and Python may be absent entirely (browser mode, or a
   * workspace that never opted in). Undefined simply means the Run and Format
   * affordances stay hidden.
   */
  constructor(private readonly _python?: IPythonEnvService) {
    super(CodeEditorPane.PANE_ID);
  }

  // ── Construction ──

  protected override createPaneContent(container: HTMLElement): void {
    container.classList.add('code-editor-pane');

    this._toolbar = $('div');
    this._toolbar.className = 'code-editor-toolbar';

    this._formatBtn = document.createElement('button');
    this._formatBtn.className = 'code-editor-action';
    this._formatBtn.type = 'button';
    this._formatBtn.textContent = 'Format';
    this._formatBtn.title = 'Format this file (Shift+Alt+F)';
    this._formatBtn.addEventListener('click', () => void this._format());

    this._runBtn = document.createElement('button');
    this._runBtn.className = 'code-editor-action code-editor-action--primary';
    this._runBtn.type = 'button';
    this._runBtn.textContent = 'Run';
    this._runBtn.title = 'Save and run this script in the workspace Python environment';
    this._runBtn.addEventListener('click', () => void this._run());

    this._toolbar.append(this._formatBtn, this._runBtn);
    container.appendChild(this._toolbar);

    this._body = $('div');
    this._body.className = 'code-editor-body';
    container.appendChild(this._body);

    this._statusBar = $('div');
    this._statusBar.className = 'code-editor-status';
    this._positionItem = $('span');
    this._positionItem.className = 'code-editor-status-item';
    this._positionItem.textContent = 'Ln 1, Col 1';
    this._eolItem = $('span');
    this._eolItem.className = 'code-editor-status-item';
    this._eolItem.textContent = 'LF';
    this._languageItem = $('span');
    this._languageItem.className = 'code-editor-status-item';
    this._languageItem.textContent = '';
    this._messageItem = $('span');
    this._messageItem.className = 'code-editor-status-message';
    this._statusBar.append(this._positionItem, this._eolItem, this._languageItem, this._messageItem);
    container.appendChild(this._statusBar);
  }

  // ── Input binding ──

  protected override async renderInput(
    input: IEditorInput,
    _previous: IEditorInput | undefined,
  ): Promise<void> {
    this._inputListeners.clear();
    this._currentInput = input;

    const name = input.name ?? '';
    let content = '';

    if (input instanceof FileEditorInput) {
      try {
        const model = await input.resolve();
        content = model.content;
      } catch (err) {
        console.error('[CodeEditorPane] Failed to resolve file:', err);
        content = '';
      }
      this._inputListeners.add(input.onDidChangeContent((newContent) => {
        // setValue does not re-fire onDidChange, so an external reload cannot
        // bounce back as a user edit and re-dirty the file.
        this._editor?.setValue(newContent);
      }));
    } else if (input instanceof UntitledEditorInput) {
      content = input.content;
      this._inputListeners.add(input.onDidChangeContent((newContent) => {
        this._editor?.setValue(newContent);
      }));
    }

    if (content.length > LARGE_FILE_THRESHOLD) {
      console.warn(
        `[CodeEditorPane] Large file (${(content.length / 1_000_000).toFixed(1)} MB): ${name}`,
      );
    }

    // Rebuild the editor per input: swapping a CodeMirror document AND its
    // language, history, and indent config in place is more moving parts than
    // it is worth for a tab switch, and the pane is pooled per input anyway.
    this._editor?.dispose();
    this._editor = new CodeEditor(this._body, {
      value: content,
      fileName: name,
      indentSize: TWO_SPACE_EXTENSIONS.has(this._extensionOf(name)) ? 2 : 4,
      extraKeymap: [
        { key: 'Shift-Alt-f', run: () => { void this._format(); return true; } },
        { key: 'Mod-Shift-Enter', run: () => { void this._run(); return true; } },
      ],
    });

    this._inputListeners.add(this._editor.onDidChange((value) => {
      if (this._currentInput instanceof FileEditorInput) {
        this._currentInput.updateContent(value);
      } else if (this._currentInput instanceof UntitledEditorInput) {
        this._currentInput.updateContent(value);
      }
    }));

    this._inputListeners.add(this._editor.onDidChangeCursor(({ line, column }) => {
      this._positionItem.textContent = `Ln ${line}, Col ${column}`;
    }));

    this._languageItem.textContent = getLanguageForFileName(name);
    this._eolItem.textContent = content.includes('\r\n') ? 'CRLF' : 'LF';
    this._positionItem.textContent = 'Ln 1, Col 1';
    this._updateActions(name);
  }

  private _extensionOf(name: string): string {
    const dot = name.lastIndexOf('.');
    return dot >= 0 ? name.slice(dot).toLowerCase() : '';
  }

  /**
   * Run is a Python-only affordance and only when the workspace opted in.
   * Format is shown for Python (needs the env) and JSON (native, always
   * works) — showing a button that can only ever produce an error message is
   * worse than not showing it.
   */
  private _updateActions(name: string): void {
    const ext = this._extensionOf(name);
    const isPython = ext === '.py' || ext === '.pyw';
    const pythonReady = !!this._python?.isEnabled;

    this._runBtn.hidden = !(isPython && pythonReady);
    this._formatBtn.hidden = !((isPython && pythonReady) || ext === '.json' || ext === '.jsonc');
    this._toolbar.hidden = this._runBtn.hidden && this._formatBtn.hidden;
  }

  // ── Actions ──

  private async _format(): Promise<void> {
    if (!this._editor) return;
    const name = this._currentInput?.name ?? '';
    const ext = this._extensionOf(name);
    const source = this._editor.value;

    if (ext === '.json' || ext === '.jsonc') {
      try {
        const indent = TWO_SPACE_EXTENSIONS.has(ext) ? 2 : 2;
        this._editor.setValueAsEdit(JSON.stringify(JSON.parse(source), null, indent) + '\n');
        this._flash('Formatted');
      } catch (err) {
        this._flash(`Invalid JSON: ${(err as Error).message}`, true);
      }
      return;
    }

    if (!this._python) { this._flash('Python is not available here.', true); return; }
    this._flash('Formatting…');
    const res = await this._python.formatPython(source);
    if (!res.ok || res.formatted === undefined) {
      this._flash(res.error ?? 'Formatting failed.', true);
      return;
    }
    if (res.formatted === source) { this._flash('Already formatted'); return; }
    this._editor.setValueAsEdit(res.formatted);
    this._flash('Formatted');
  }

  private async _run(): Promise<void> {
    if (!this._python || !this._currentInput) return;

    if (this._currentInput instanceof UntitledEditorInput) {
      this._flash('Save the file before running it.', true);
      return;
    }
    const input = this._currentInput as FileEditorInput;

    // Run what is on disk, not what is in the buffer. Anything else means the
    // traceback line numbers refer to a file that does not exist.
    try {
      await input.save();
    } catch (err) {
      this._flash(`Could not save before running: ${(err as Error).message}`, true);
      return;
    }

    // `description` is the workspace-relative path when the input has one and
    // the absolute fsPath otherwise. The bridge accepts either, and validates
    // containment on both.
    const target = input.description || input.name;
    this._flash('Running…');
    const res = await this._python.runScript(target);
    if (!res.ok) { this._flash(res.error ?? 'Could not start.', true); return; }

    const runId = res.handle?.runId;
    const sub = this._python.onDidRunExit((p) => {
      if (p.runId !== runId) return;
      sub.dispose();
      if (p.error) this._flash(p.error.message, true);
      else if (p.exitCode === 0) this._flash(`Finished in ${p.durationMs} ms — see Settings › Python for output`);
      else this._flash(`Exited ${p.exitCode} — see Settings › Python for output`, true);
    });
    this._inputListeners.add(sub);
  }

  private _flash(message: string, isError = false): void {
    if (this._messageTimer) clearTimeout(this._messageTimer);
    this._messageItem.textContent = message;
    this._messageItem.classList.toggle('code-editor-status-message--error', isError);
    this._messageTimer = setTimeout(() => {
      this._messageItem.textContent = '';
      this._messageItem.classList.remove('code-editor-status-message--error');
    }, 6000);
  }

  // ── Pane lifecycle ──

  protected override clearPaneContent(_previous: IEditorInput | undefined): void {
    this._inputListeners.clear();
    this._editor?.dispose();
    this._editor = undefined;
    this._currentInput = undefined;
    this._positionItem.textContent = 'Ln 1, Col 1';
    this._languageItem.textContent = '';
    this._messageItem.textContent = '';
  }

  override focus(): void {
    this._editor?.focus();
  }

  protected override savePaneViewState(): EditorPaneViewState {
    return { scrollTop: this._editor?.scrollTop ?? 0 };
  }

  protected override restorePaneViewState(state: EditorPaneViewState): void {
    if (this._editor && typeof state.scrollTop === 'number') {
      this._editor.scrollTop = state.scrollTop;
    }
  }

  override dispose(): void {
    if (this._messageTimer) clearTimeout(this._messageTimer);
    this._inputListeners.dispose();
    this._editor?.dispose();
    super.dispose();
  }
}
