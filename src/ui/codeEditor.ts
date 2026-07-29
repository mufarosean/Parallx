// codeEditor.ts — THE code-editing surface. One primitive, every consumer.
//
// The file editor pane uses it for `.py`/`.ts`/`.json`/…; the notebook editor
// will use one instance per cell. That sharing is the whole point: the same
// rule the app already applies to dropdowns (api.ui.createDropdown), scrollbars
// (scrollbarReveal), and rAF throttling (platform/rafThrottle) applies here —
// there is exactly one place that knows how code is rendered, themed, and
// keyboard-handled, so a fix lands everywhere at once.
//
// Why CodeMirror 6 and not Monaco. Monaco IS VS Code's editor and would give
// TypeScript IntelliSense for free, but it also arrives with its own
// scrollbars, its own context menus, its own find widget, and its own theming
// system — all of which fight invariants this codebase spent milestones
// establishing. CodeMirror styles from ordinary CSS (so --px tokens work),
// lets its scroller participate in the standard scrollbar-reveal mechanism,
// and tree-shakes. The cost is no cross-file language service, which for
// editing scripts in a study workspace is not what is missing.

import { EditorState, Compartment, type Extension } from '@codemirror/state';
import {
  EditorView, keymap, lineNumbers, highlightActiveLine,
  highlightActiveLineGutter, highlightSpecialChars, drawSelection,
  rectangularSelection, crosshairCursor, dropCursor, placeholder as cmPlaceholder,
} from '@codemirror/view';
import {
  defaultKeymap, history, historyKeymap, indentWithTab,
} from '@codemirror/commands';
import {
  syntaxHighlighting, HighlightStyle, indentUnit, bracketMatching,
  foldGutter, foldKeymap, indentOnInput,
} from '@codemirror/language';
import { searchKeymap, highlightSelectionMatches } from '@codemirror/search';
import {
  autocompletion, completionKeymap, closeBrackets, closeBracketsKeymap,
} from '@codemirror/autocomplete';
import { lintKeymap } from '@codemirror/lint';
import { tags as t } from '@lezer/highlight';

import { Disposable } from '../platform/lifecycle.js';
import { Emitter, type Event } from '../platform/events.js';
import './codeEditor.css';

// ─── Language resolution ─────────────────────────────────────────────────────

/**
 * Extension → dynamic language loader.
 *
 * Lazy on purpose: the Python grammar alone is a meaningful chunk of parse
 * tables, and a workspace that only ever opens `.json` should not pay for
 * every grammar in the bundle. esbuild splits these into the main chunk but
 * the import cost is deferred to first use.
 */
const LANGUAGE_LOADERS: Record<string, () => Promise<Extension>> = {
  '.py':   async () => (await import('@codemirror/lang-python')).python(),
  '.pyw':  async () => (await import('@codemirror/lang-python')).python(),
  '.ts':   async () => (await import('@codemirror/lang-javascript')).javascript({ typescript: true }),
  '.tsx':  async () => (await import('@codemirror/lang-javascript')).javascript({ typescript: true, jsx: true }),
  '.js':   async () => (await import('@codemirror/lang-javascript')).javascript(),
  '.jsx':  async () => (await import('@codemirror/lang-javascript')).javascript({ jsx: true }),
  '.mjs':  async () => (await import('@codemirror/lang-javascript')).javascript(),
  '.cjs':  async () => (await import('@codemirror/lang-javascript')).javascript(),
  '.json': async () => (await import('@codemirror/lang-json')).json(),
  '.jsonc': async () => (await import('@codemirror/lang-json')).json(),
  '.jsonl': async () => (await import('@codemirror/lang-json')).json(),
  '.md':   async () => (await import('@codemirror/lang-markdown')).markdown(),
  '.markdown': async () => (await import('@codemirror/lang-markdown')).markdown(),
  '.html': async () => (await import('@codemirror/lang-html')).html(),
  '.htm':  async () => (await import('@codemirror/lang-html')).html(),
  '.css':  async () => (await import('@codemirror/lang-css')).css(),
  '.scss': async () => (await import('@codemirror/lang-css')).css(),
  '.sql':  async () => (await import('@codemirror/lang-sql')).sql(),
};

/** Language ids usable with `setLanguageId` (notebook cells know 'python', not a filename). */
const LANGUAGE_BY_ID: Record<string, () => Promise<Extension>> = {
  python: LANGUAGE_LOADERS['.py'],
  typescript: LANGUAGE_LOADERS['.ts'],
  javascript: LANGUAGE_LOADERS['.js'],
  json: LANGUAGE_LOADERS['.json'],
  markdown: LANGUAGE_LOADERS['.md'],
  html: LANGUAGE_LOADERS['.html'],
  css: LANGUAGE_LOADERS['.css'],
  sql: LANGUAGE_LOADERS['.sql'],
};

/** True when this file type gets syntax highlighting (drives pane routing). */
export function hasCodeLanguage(fileName: string): boolean {
  return extensionOf(fileName) in LANGUAGE_LOADERS;
}

/** The set of extensions the code editor claims. */
export function codeExtensions(): readonly string[] {
  return Object.keys(LANGUAGE_LOADERS);
}

function extensionOf(fileName: string): string {
  const dot = fileName.lastIndexOf('.');
  return dot >= 0 ? fileName.slice(dot).toLowerCase() : '';
}

// ─── Theme ───────────────────────────────────────────────────────────────────

/**
 * Token colours read from --px-syntax-* so themes and light mode drive the
 * editor. CodeMirror needs real CSS values here, and `var(...)` is legal in a
 * declaration value, so the indirection survives a theme switch without the
 * editor being rebuilt.
 */
const pxHighlightStyle = HighlightStyle.define([
  { tag: [t.comment, t.blockComment, t.lineComment, t.docComment], color: 'var(--px-syntax-comment)', fontStyle: 'italic' },
  { tag: [t.keyword, t.moduleKeyword, t.controlKeyword, t.operatorKeyword, t.definitionKeyword], color: 'var(--px-syntax-keyword)' },
  { tag: [t.string, t.special(t.string), t.docString], color: 'var(--px-syntax-string)' },
  { tag: [t.number, t.integer, t.float, t.bool, t.null], color: 'var(--px-syntax-number)' },
  { tag: [t.function(t.variableName), t.function(t.propertyName), t.macroName], color: 'var(--px-syntax-function)' },
  { tag: [t.typeName, t.className, t.namespace, t.standard(t.typeName)], color: 'var(--px-syntax-type)' },
  { tag: [t.variableName, t.propertyName, t.attributeName], color: 'var(--px-syntax-variable)' },
  { tag: [t.constant(t.variableName), t.standard(t.variableName), t.atom], color: 'var(--px-syntax-constant)' },
  { tag: [t.operator, t.compareOperator, t.arithmeticOperator, t.logicOperator], color: 'var(--px-syntax-operator)' },
  { tag: [t.punctuation, t.separator, t.bracket, t.paren, t.brace, t.squareBracket], color: 'var(--px-syntax-punctuation)' },
  { tag: [t.meta, t.annotation, t.processingInstruction], color: 'var(--px-syntax-meta)' },
  { tag: [t.invalid], color: 'var(--px-syntax-invalid)' },
  { tag: [t.heading], color: 'var(--px-syntax-keyword)', fontWeight: 'bold' },
  { tag: [t.link, t.url], color: 'var(--px-accent)', textDecoration: 'underline' },
  { tag: [t.emphasis], fontStyle: 'italic' },
  { tag: [t.strong], fontWeight: 'bold' },
  { tag: [t.strikethrough], textDecoration: 'line-through' },
]);

/**
 * Structural theme. Colours come from tokens; this sets only geometry and the
 * handful of chrome surfaces CodeMirror draws itself.
 *
 * Note what is NOT set: `.cm-scroller` gets no scrollbar styling at all. It
 * carries the standard `px-scrollbar-*` classes instead, so the app-wide
 * hover-or-scrolling reveal rule owns it like every other scrollable surface.
 */
const pxTheme = EditorView.theme({
  '&': {
    color: 'var(--px-text)',
    backgroundColor: 'transparent',
    height: '100%',
    fontSize: 'var(--px-code-size, 13px)',
  },
  '.cm-content': {
    fontFamily: 'var(--px-font-mono, ui-monospace, "Cascadia Code", Consolas, monospace)',
    padding: '8px 0',
    caretColor: 'var(--px-accent)',
  },
  '.cm-scroller': {
    fontFamily: 'inherit',
    lineHeight: '1.55',
    overflow: 'auto',
  },
  '&.cm-focused': { outline: 'none' },
  '.cm-cursor, .cm-dropCursor': { borderLeftColor: 'var(--px-accent)', borderLeftWidth: '2px' },
  '&.cm-focused .cm-selectionBackground, .cm-selectionBackground, .cm-content ::selection': {
    backgroundColor: 'var(--px-surface-selected)',
  },
  '.cm-activeLine': { backgroundColor: 'var(--px-surface-hover)' },
  '.cm-gutters': {
    backgroundColor: 'transparent',
    color: 'var(--px-text-faint)',
    border: 'none',
    borderRight: '1px solid var(--px-divider)',
    userSelect: 'none',
  },
  '.cm-activeLineGutter': { backgroundColor: 'var(--px-surface-hover)', color: 'var(--px-text-muted)' },
  '.cm-lineNumbers .cm-gutterElement': { padding: '0 10px 0 14px', minWidth: '32px' },
  '.cm-foldGutter .cm-gutterElement': { padding: '0 4px', cursor: 'pointer' },
  '.cm-matchingBracket, &.cm-focused .cm-matchingBracket': {
    backgroundColor: 'var(--px-accent-soft)',
    outline: '1px solid var(--px-accent)',
    color: 'inherit',
  },
  '.cm-nonmatchingBracket': { color: 'var(--px-danger)' },
  '.cm-selectionMatch': { backgroundColor: 'var(--px-accent-faint)' },
  '.cm-tooltip': {
    backgroundColor: 'var(--px-bg-elevated)',
    border: '1px solid var(--px-border)',
    borderRadius: 'var(--px-radius-md, 6px)',
    boxShadow: 'var(--px-shadow-md)',
    color: 'var(--px-text)',
  },
  '.cm-tooltip-autocomplete > ul > li': {
    fontFamily: 'var(--px-font-mono, monospace)',
    padding: '3px 8px',
  },
  '.cm-tooltip-autocomplete > ul > li[aria-selected]': {
    backgroundColor: 'var(--px-surface-selected)',
    color: 'var(--px-text)',
  },
  '.cm-panels': {
    backgroundColor: 'var(--px-bg-elevated)',
    color: 'var(--px-text)',
    border: 'none',
    borderTop: '1px solid var(--px-divider)',
  },
  '.cm-panel input, .cm-panel button': {
    fontFamily: 'inherit',
    backgroundColor: 'var(--px-bg-inset)',
    color: 'var(--px-text)',
    border: '1px solid var(--px-border)',
    borderRadius: 'var(--px-radius-sm, 4px)',
    padding: '2px 6px',
  },
  '.cm-placeholder': { color: 'var(--px-text-faint)' },
});

// ─── Options ─────────────────────────────────────────────────────────────────

export interface ICodeEditorOptions {
  /** Initial document. */
  readonly value?: string;
  /** Resolve the language from a file name (`summarise.py`). */
  readonly fileName?: string;
  /** Or set it directly by id (`python`) — how notebook cells will do it. */
  readonly languageId?: string;
  readonly readOnly?: boolean;
  /** Default true. Notebook cells turn this off for short cells. */
  readonly lineNumbers?: boolean;
  /** Default true. */
  readonly foldGutter?: boolean;
  readonly placeholder?: string;
  /** Soft wrap. Default false for code. */
  readonly wordWrap?: boolean;
  /** Spaces per indent level. Default 4 (Python's expectation; TS files re-set it). */
  readonly indentSize?: number;
  /**
   * Extra keybindings, highest precedence. The notebook uses this for
   * Shift+Enter (run cell) without the primitive knowing what a cell is.
   */
  readonly extraKeymap?: readonly { key: string; run: () => boolean; preventDefault?: boolean }[];
  /**
   * Grow to fit content instead of scrolling internally — the right model for
   * a notebook cell, the wrong one for a file.
   */
  readonly autoHeight?: boolean;
}

// ─── CodeEditor ──────────────────────────────────────────────────────────────

export class CodeEditor extends Disposable {
  readonly element: HTMLElement;

  private readonly _view: EditorView;
  private readonly _language = new Compartment();
  private readonly _readOnly = new Compartment();
  private readonly _wrap = new Compartment();
  private readonly _indent = new Compartment();

  private readonly _onDidChange = this._register(new Emitter<string>());
  /** Fires on every document change, with the full text. */
  readonly onDidChange: Event<string> = this._onDidChange.event;

  private readonly _onDidChangeCursor = this._register(new Emitter<{ line: number; column: number }>());
  readonly onDidChangeCursor: Event<{ line: number; column: number }> = this._onDidChangeCursor.event;

  /** Set while applying an external edit, so echoes are not re-broadcast. */
  private _applyingExternal = false;

  constructor(container: HTMLElement, options: ICodeEditorOptions = {}) {
    super();

    this.element = document.createElement('div');
    this.element.className = 'px-code-editor';
    if (options.autoHeight) this.element.classList.add('px-code-editor--auto');
    container.appendChild(this.element);

    const extensions: Extension[] = [
      ...(options.lineNumbers === false ? [] : [lineNumbers(), highlightActiveLineGutter()]),
      ...(options.foldGutter === false ? [] : [foldGutter()]),
      highlightSpecialChars(),
      history(),
      drawSelection(),
      dropCursor(),
      EditorState.allowMultipleSelections.of(true),
      indentOnInput(),
      bracketMatching(),
      closeBrackets(),
      autocompletion(),
      rectangularSelection(),
      crosshairCursor(),
      highlightActiveLine(),
      highlightSelectionMatches(),
      syntaxHighlighting(pxHighlightStyle, { fallback: true }),
      pxTheme,
      keymap.of([
        ...(options.extraKeymap ?? []).map((b) => ({
          key: b.key,
          run: () => b.run(),
          preventDefault: b.preventDefault ?? true,
        })),
        ...closeBracketsKeymap,
        ...defaultKeymap,
        ...searchKeymap,
        ...historyKeymap,
        ...foldKeymap,
        ...completionKeymap,
        ...lintKeymap,
        // Tab indents rather than moving focus. Deliberate: this is a code
        // surface, and the accessibility escape hatch is Escape-then-Tab,
        // which indentWithTab preserves.
        indentWithTab,
      ]),
      this._language.of([]),
      this._readOnly.of(EditorState.readOnly.of(options.readOnly === true)),
      this._wrap.of(options.wordWrap ? EditorView.lineWrapping : []),
      this._indent.of(indentUnit.of(' '.repeat(options.indentSize ?? 4))),
      EditorView.updateListener.of((update) => {
        if (update.docChanged && !this._applyingExternal) {
          this._onDidChange.fire(update.state.doc.toString());
        }
        if (update.selectionSet || update.docChanged) {
          const head = update.state.selection.main.head;
          const line = update.state.doc.lineAt(head);
          this._onDidChangeCursor.fire({ line: line.number, column: head - line.from + 1 });
        }
      }),
      ...(options.placeholder ? [cmPlaceholder(options.placeholder)] : []),
    ];

    this._view = new EditorView({
      state: EditorState.create({ doc: options.value ?? '', extensions }),
      parent: this.element,
    });

    // No scrollbar wiring here on purpose. installScrollbarReveal delegates on
    // `document` and finds any element whose computed overflow scrolls, so
    // `.cm-scroller` joins the app-wide hover-or-scrolling rule for free —
    // provided this file never sets ::-webkit-scrollbar colours or
    // `scrollbar-width` on it. See ui/scrollbarReveal.ts.

    const langSource = options.languageId
      ? LANGUAGE_BY_ID[options.languageId]
      : options.fileName ? LANGUAGE_LOADERS[extensionOf(options.fileName)] : undefined;
    if (langSource) void this._loadLanguage(langSource);
  }

  // ── Language ──

  private async _loadLanguage(loader: () => Promise<Extension>): Promise<void> {
    try {
      const ext = await loader();
      // The view can be torn down while the grammar is in flight.
      if (this._disposedFlag) return;
      this._view.dispatch({ effects: this._language.reconfigure(ext) });
    } catch (err) {
      console.warn('[CodeEditor] language load failed:', err);
    }
  }

  /** Re-resolve the language from a file name. */
  setFileName(fileName: string): void {
    const loader = LANGUAGE_LOADERS[extensionOf(fileName)];
    if (loader) void this._loadLanguage(loader);
    else this._view.dispatch({ effects: this._language.reconfigure([]) });
  }

  /** Set the language by id (`python`). */
  setLanguageId(id: string): void {
    const loader = LANGUAGE_BY_ID[id];
    if (loader) void this._loadLanguage(loader);
    else this._view.dispatch({ effects: this._language.reconfigure([]) });
  }

  // ── Document ──

  get value(): string {
    return this._view.state.doc.toString();
  }

  /**
   * Replace the document without firing onDidChange.
   *
   * For external updates (a file reloaded from disk, an AI edit landing) —
   * echoing those back as a user edit would mark the file dirty and, worse,
   * race the very write that produced them.
   */
  setValue(text: string): void {
    if (text === this.value) return;
    this._applyingExternal = true;
    try {
      this._view.dispatch({
        changes: { from: 0, to: this._view.state.doc.length, insert: text },
      });
    } finally {
      this._applyingExternal = false;
    }
  }

  /**
   * Replace the document AS A USER EDIT — onDidChange fires, undo works, the
   * file goes dirty.
   *
   * The counterpart to setValue, and the distinction is the whole point:
   * formatting is something the user did and must be saveable and undoable,
   * whereas a reload from disk is something that happened to them and must
   * not be echoed back as a change.
   */
  setValueAsEdit(text: string): void {
    if (text === this.value) return;
    this._view.dispatch({
      changes: { from: 0, to: this._view.state.doc.length, insert: text },
    });
  }

  /** Insert at the cursor, replacing the selection. */
  insert(text: string): void {
    const { from, to } = this._view.state.selection.main;
    this._view.dispatch({
      changes: { from, to, insert: text },
      selection: { anchor: from + text.length },
    });
  }

  get selectedText(): string {
    const { from, to } = this._view.state.selection.main;
    return this._view.state.sliceDoc(from, to);
  }

  get lineCount(): number {
    return this._view.state.doc.lines;
  }

  get cursorPosition(): { line: number; column: number } {
    const head = this._view.state.selection.main.head;
    const line = this._view.state.doc.lineAt(head);
    return { line: line.number, column: head - line.from + 1 };
  }

  // ── Configuration ──

  setReadOnly(readOnly: boolean): void {
    this._view.dispatch({ effects: this._readOnly.reconfigure(EditorState.readOnly.of(readOnly)) });
  }

  setWordWrap(wrap: boolean): void {
    this._view.dispatch({ effects: this._wrap.reconfigure(wrap ? EditorView.lineWrapping : []) });
  }

  setIndentSize(size: number): void {
    this._view.dispatch({ effects: this._indent.reconfigure(indentUnit.of(' '.repeat(size))) });
  }

  focus(): void {
    this._view.focus();
  }

  get hasFocus(): boolean {
    return this._view.hasFocus;
  }

  /** Scroll position, for editor view-state save/restore across tab switches. */
  get scrollTop(): number {
    return this._view.scrollDOM.scrollTop;
  }
  set scrollTop(value: number) {
    this._view.scrollDOM.scrollTop = value;
  }

  private _disposedFlag = false;

  override dispose(): void {
    this._disposedFlag = true;
    this._view.destroy();
    this.element.remove();
    super.dispose();
  }
}
