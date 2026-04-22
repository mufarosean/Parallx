// markdownEditorPane.ts — Markdown preview pane
//
// Renders .md files as formatted HTML. Uses the same FileEditorInput as the
// text editor (the input holds the TextFileModel), but displays rendered
// markdown instead of a raw textarea.
//
// VS Code reference:
//   src/vs/workbench/contrib/markdown/browser/markdownDocumentRenderer.ts
//   (VS Code uses a webview; we render directly into the DOM for simplicity.)

import './markdownEditorPane.css';

import MarkdownIt from 'markdown-it';
import markdownItMark from 'markdown-it-mark';
import MarkdownItGitHubAlerts from 'markdown-it-github-alerts';
import hljs from 'highlight.js/lib/common';
import katex from 'katex';

import { EditorPane } from '../../editor/editorPane.js';
import { type IEditorInput } from '../../editor/editorInput.js';
import { DisposableStore } from '../../platform/lifecycle.js';
import { FileEditorInput } from './fileEditorInput.js';
import { MarkdownPreviewInput } from './markdownPreviewInput.js';
import { ReadonlyMarkdownInput } from './readonlyMarkdownInput.js';
import { $ } from '../../ui/dom.js';
import { ContextMenu } from '../../ui/contextMenu.js';

// ─── Constants ───────────────────────────────────────────────────────────────

const PANE_ID = 'markdown-editor-pane';

// ─── MarkdownEditorPane ──────────────────────────────────────────────────────

export class MarkdownEditorPane extends EditorPane {
  static readonly PANE_ID = PANE_ID;

  private _scrollContainer!: HTMLElement;
  private _contentEl!: HTMLElement;
  private _inputListeners = new DisposableStore();
  private _activeContextMenu: ReturnType<typeof ContextMenu.show> | null = null;
  private readonly _md: MarkdownIt;

  constructor() {
    super(PANE_ID);
    this._register(this._inputListeners);
    this._md = _createPreviewRenderer();
  }

  // ── Lifecycle hooks ──────────────────────────────────────────────────────

  protected override createPaneContent(container: HTMLElement): void {
    container.classList.add('markdown-editor-pane');

    this._scrollContainer = $('div');
    this._scrollContainer.classList.add('markdown-scroll-container');

    this._contentEl = $('div');
    this._contentEl.classList.add('markdown-content');

    this._scrollContainer.appendChild(this._contentEl);
    container.appendChild(this._scrollContainer);

    // M48: Context menu for selection AI actions
    this._scrollContainer.addEventListener('contextmenu', this._onContextMenu);
  }

  protected override async renderInput(
    input: IEditorInput,
    _previous: IEditorInput | undefined,
  ): Promise<void> {
    this._inputListeners.clear();

    // ReadonlyMarkdownInput — in-memory content, no file resolution needed
    if (input instanceof ReadonlyMarkdownInput) {
      this._renderMarkdown(input.content);
      this._inputListeners.add(input.onDidChangeContent((newContent) => {
        this._renderMarkdown(newContent);
      }));
      return;
    }

    // Accept MarkdownPreviewInput (wraps FileEditorInput) or direct FileEditorInput
    const fileInput = input instanceof MarkdownPreviewInput
      ? input.sourceInput
      : input instanceof FileEditorInput
        ? input
        : null;

    if (!fileInput) {
      this._contentEl.textContent = 'Cannot render: not a markdown input.';
      return;
    }

    try {
      const model = await fileInput.resolve();
      this._renderMarkdown(model.content);

      // Re-render on content changes (live preview as user types in text editor)
      this._inputListeners.add(fileInput.onDidChangeContent((newContent) => {
        this._renderMarkdown(newContent);
      }));
    } catch (err) {
      console.error('[MarkdownEditorPane] Failed to resolve file:', err);
      this._contentEl.textContent = 'Failed to load markdown file.';
    }
  }

  protected override clearPaneContent(_previous: IEditorInput | undefined): void {
    this._inputListeners.clear();
    if (this._contentEl) {
      this._contentEl.innerHTML = '';
    }
  }

  protected override layoutPaneContent(width: number, height: number): void {
    if (this._scrollContainer) {
      this._scrollContainer.style.width = `${width}px`;
      this._scrollContainer.style.height = `${height}px`;
    }
  }

  // ── Markdown Rendering ─────────────────────────────────────────────────

  private _renderMarkdown(source: string): void {
    this._contentEl.innerHTML = this._md.render(source);
  }

  // ── M48: Selection API & Context Menu ──────────────────────────────

  /** Get the currently selected text in the markdown preview (M48). */
  getSelectedText(): string | undefined {
    const sel = window.getSelection();
    const text = sel?.toString()?.trim();
    return text && text.length > 0 ? text : undefined;
  }

  /** Get selection source metadata for the AI action system (M48). */
  getSelectionSource(): { fileName: string; filePath: string } | undefined {
    const text = this.getSelectedText();
    if (!text || !this.input) return undefined;
    return {
      fileName: this.input.name ?? 'untitled',
      filePath: (this.input as any).uri?.fsPath ?? (this.input as any)?.sourceInput?.uri?.fsPath ?? this.input.name ?? 'untitled',
    };
  }

  private readonly _onContextMenu = (e: MouseEvent): void => {
    const selected = this.getSelectedText();
    if (!selected) return; // Only show AI menu when text is selected

    e.preventDefault();
    this._dismissContextMenu();

    const menu = ContextMenu.show({
      items: [
        {
          id: 'md.copy',
          label: 'Copy',
          keybinding: 'Ctrl+C',
        },
        // M48 Phase 4: Single AI action
        {
          id: 'ai.addToChat',
          label: 'Add Selection to Chat',
          group: 'ai',
        },
      ],
      anchor: { x: e.clientX, y: e.clientY },
    });

    menu.onDidSelect((ev) => {
      if (ev.item.id === 'md.copy') {
        void navigator.clipboard.writeText(selected);
      } else if (ev.item.id === 'ai.addToChat') {
        this._dispatchSelectionAction(ev.item.id);
      }
    });

    this._activeContextMenu = menu;
  };

  /** Dispatch a selection action to the unified dispatcher (M48 Phase 4). */
  private _dispatchSelectionAction(_menuItemId: string): void {
    const selected = this.getSelectedText();
    const source = this.getSelectionSource();
    if (!selected || !source) return;
    const actionId = 'add-to-chat';

    this._scrollContainer.dispatchEvent(
      new CustomEvent('parallx-selection-action', {
        bubbles: true,
        detail: {
          selectedText: selected,
          surface: 'markdown',
          actionId,
          source,
        },
      }),
    );
  }

  private _dismissContextMenu(): void {
    if (this._activeContextMenu) {
      this._activeContextMenu.dispose();
      this._activeContextMenu = null;
    }
  }

  override dispose(): void {
    this._dismissContextMenu();
    this._scrollContainer?.removeEventListener('contextmenu', this._onContextMenu);
    super.dispose();
  }
}

// ── Shared markdown-it renderer for the editor preview pane ──────────────────

function _createPreviewRenderer(): MarkdownIt {
  const md = new MarkdownIt({
    html: false,
    breaks: true,
    linkify: true,
    highlight(str, lang) {
      if (lang && hljs.getLanguage(lang)) {
        try {
          return hljs.highlight(str, { language: lang }).value;
        } catch { /* fall through */ }
      }
      return ''; // markdown-it will escape the content
    },
  });

  md.use(markdownItMark);
  md.use(MarkdownItGitHubAlerts, { markers: '*' });

  // The github-alerts plugin inserts callout titles as raw text.
  // Override the renderer to run inline rules on the title.
  md.renderer.rules.alert_open = (tokens, idx) => {
    const { title, type, icon } = tokens[idx].meta;
    const renderedTitle = md.renderInline(title);
    return `<div class="markdown-alert markdown-alert-${type}"><p class="markdown-alert-title">${icon}${renderedTitle}</p>`;
  };

  _installKatexRules(md);
  return md;
}

// ── KaTeX math rules (block + inline) ────────────────────────────────────────

function _installKatexRules(md: MarkdownIt): void {
  // Block math: $$ ... $$ or \[ ... \]
  md.block.ruler.before('fence', 'parallx_math_block', (state, startLine, endLine, silent) => {
    const start = state.bMarks[startLine] + state.tShift[startLine];
    const max = state.eMarks[startLine];
    const firstLine = state.src.slice(start, max).trim();

    let open = '';
    let close = '';
    if (firstLine === '$$') { open = '$$'; close = '$$'; }
    else if (firstLine === '\\[') { open = '\\['; close = '\\]'; }
    else { return false; }

    let nextLine = startLine + 1;
    const contentLines: string[] = [];
    while (nextLine < endLine) {
      const s = state.bMarks[nextLine] + state.tShift[nextLine];
      const m = state.eMarks[nextLine];
      const text = state.src.slice(s, m);
      if (text.trim() === close) break;
      contentLines.push(text);
      nextLine += 1;
    }
    if (nextLine >= endLine) return false;

    if (!silent) {
      const token = state.push('parallx_math_block', 'div', 0);
      token.block = true;
      token.content = contentLines.join('\n').trim();
      token.map = [startLine, nextLine + 1];
      token.markup = open;
    }
    state.line = nextLine + 1;
    return true;
  });

  // Inline math: \( ... \) or $ ... $
  md.inline.ruler.before('escape', 'parallx_math_inline', (state, silent) => {
    const src = state.src;
    const pos = state.pos;

    let open = '';
    let close = '';
    if (src.startsWith('\\(', pos)) { open = '\\('; close = '\\)'; }
    else if (src.charAt(pos) === '$' && src.charAt(pos + 1) !== '$') { open = '$'; close = '$'; }
    else { return false; }

    let matchPos = pos + open.length;
    while (matchPos < src.length) {
      matchPos = src.indexOf(close, matchPos);
      if (matchPos < 0) return false;
      if (src.charAt(matchPos - 1) !== '\\') break;
      matchPos += close.length;
    }

    const content = src.slice(pos + open.length, matchPos);
    if (!content.trim() || /\n/.test(content)) return false;

    if (!silent) {
      const token = state.push('parallx_math_inline', 'span', 0);
      token.content = content;
      token.markup = open;
    }
    state.pos = matchPos + close.length;
    return true;
  });

  md.renderer.rules.parallx_math_inline = (tokens, idx) => _renderKatex(tokens[idx].content, false);
  md.renderer.rules.parallx_math_block = (tokens, idx) =>
    `<div class="markdown-math-block">${_renderKatex(tokens[idx].content, true)}</div>\n`;
}

function _renderKatex(expression: string, displayMode: boolean): string {
  try {
    return katex.renderToString(expression, {
      throwOnError: false,
      displayMode,
      output: 'html',
    });
  } catch {
    const escaped = expression.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
    return displayMode
      ? `<pre class="markdown-math-fallback">${escaped}</pre>`
      : `<code class="markdown-math-fallback">${escaped}</code>`;
  }
}
