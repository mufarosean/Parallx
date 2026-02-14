// markdownEditorPane.ts — Markdown preview pane
//
// Renders .md files as formatted HTML. Uses the same FileEditorInput as the
// text editor (the input holds the TextFileModel), but displays rendered
// markdown instead of a raw textarea.
//
// VS Code reference:
//   src/vs/workbench/contrib/markdown/browser/markdownDocumentRenderer.ts
//   (VS Code uses a webview; we render directly into the DOM for simplicity.)

import { EditorPane } from '../../editor/editorPane.js';
import { type IEditorInput } from '../../editor/editorInput.js';
import { DisposableStore } from '../../platform/lifecycle.js';
import { FileEditorInput } from './fileEditorInput.js';
import { MarkdownPreviewInput } from './markdownPreviewInput.js';
import { $ } from '../../ui/dom.js';

// ─── Constants ───────────────────────────────────────────────────────────────

const PANE_ID = 'markdown-editor-pane';

// ─── MarkdownEditorPane ──────────────────────────────────────────────────────

export class MarkdownEditorPane extends EditorPane {
  static readonly PANE_ID = PANE_ID;

  private _scrollContainer!: HTMLElement;
  private _contentEl!: HTMLElement;
  private _inputListeners = new DisposableStore();

  constructor() {
    super(PANE_ID);
    this._register(this._inputListeners);
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
  }

  protected override async renderInput(
    input: IEditorInput,
    _previous: IEditorInput | undefined,
  ): Promise<void> {
    this._inputListeners.clear();

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

  /**
   * Lightweight markdown → HTML renderer.
   *
   * Supports: headings, bold, italic, strikethrough, inline code, code blocks,
   * links, images, blockquotes, ordered/unordered lists, horizontal rules,
   * tables, and paragraphs.
   *
   * This is intentionally simple — no dependency on external markdown libraries.
   * For full GFM compliance, a library like marked/markdown-it could be used.
   */
  private _renderMarkdown(source: string): void {
    const html = this._markdownToHtml(source);
    this._contentEl.innerHTML = html;
  }

  private _markdownToHtml(md: string): string {
    const lines = md.split('\n');
    const out: string[] = [];
    let i = 0;

    while (i < lines.length) {
      const line = lines[i];

      // Fenced code block (``` or ~~~)
      const fenceMatch = line.match(/^(`{3,}|~{3,})(\w*)/);
      if (fenceMatch) {
        const fence = fenceMatch[1];
        const lang = fenceMatch[2];
        const codeLines: string[] = [];
        i++;
        while (i < lines.length && !lines[i].startsWith(fence)) {
          codeLines.push(lines[i]);
          i++;
        }
        i++; // skip closing fence
        const langAttr = lang ? ` class="language-${this._esc(lang)}"` : '';
        out.push(`<pre><code${langAttr}>${this._esc(codeLines.join('\n'))}</code></pre>`);
        continue;
      }

      // Blank line
      if (line.trim() === '') {
        i++;
        continue;
      }

      // Heading (# to ######)
      const headingMatch = line.match(/^(#{1,6})\s+(.+)/);
      if (headingMatch) {
        const level = headingMatch[1].length;
        out.push(`<h${level}>${this._inline(headingMatch[2])}</h${level}>`);
        i++;
        continue;
      }

      // Horizontal rule
      if (/^(\*{3,}|-{3,}|_{3,})\s*$/.test(line)) {
        out.push('<hr />');
        i++;
        continue;
      }

      // Blockquote (any line starting with '>')
      if (/^>/.test(line)) {
        const quoteLines: string[] = [];
        while (i < lines.length && /^>/.test(lines[i])) {
          quoteLines.push(lines[i].replace(/^>\s?/, ''));
          i++;
        }
        out.push(`<blockquote>${this._markdownToHtml(quoteLines.join('\n'))}</blockquote>`);
        continue;
      }

      // Table (simple: header | separator | rows)
      if (line.includes('|') && i + 1 < lines.length && /^\|?\s*[-:]+[-|:\s]+$/.test(lines[i + 1])) {
        const headerCells = this._parseTableRow(line);
        const alignRow = this._parseTableRow(lines[i + 1]);
        const aligns = alignRow.map(c => {
          if (c.startsWith(':') && c.endsWith(':')) return 'center';
          if (c.endsWith(':')) return 'right';
          return 'left';
        });
        i += 2;
        let tableHtml = '<table><thead><tr>';
        headerCells.forEach((cell, ci) => {
          tableHtml += `<th style="text-align:${aligns[ci] ?? 'left'}">${this._inline(cell.trim())}</th>`;
        });
        tableHtml += '</tr></thead><tbody>';
        while (i < lines.length && lines[i].includes('|')) {
          const cells = this._parseTableRow(lines[i]);
          tableHtml += '<tr>';
          cells.forEach((cell, ci) => {
            tableHtml += `<td style="text-align:${aligns[ci] ?? 'left'}">${this._inline(cell.trim())}</td>`;
          });
          tableHtml += '</tr>';
          i++;
        }
        tableHtml += '</tbody></table>';
        out.push(tableHtml);
        continue;
      }

      // Unordered list
      if (/^(\s*)([-*+])\s+/.test(line)) {
        const listItems: string[] = [];
        while (i < lines.length && /^(\s*)([-*+])\s+/.test(lines[i])) {
          listItems.push(lines[i].replace(/^\s*[-*+]\s+/, ''));
          i++;
        }
        out.push('<ul>' + listItems.map(li => `<li>${this._inline(li)}</li>`).join('') + '</ul>');
        continue;
      }

      // Ordered list
      if (/^(\s*)\d+\.\s+/.test(line)) {
        const listItems: string[] = [];
        while (i < lines.length && /^\s*\d+\.\s+/.test(lines[i])) {
          listItems.push(lines[i].replace(/^\s*\d+\.\s+/, ''));
          i++;
        }
        out.push('<ol>' + listItems.map(li => `<li>${this._inline(li)}</li>`).join('') + '</ol>');
        continue;
      }

      // Paragraph (default)
      const paraLines: string[] = [];
      while (i < lines.length && lines[i].trim() !== '' && !this._isBlockStart(lines[i])) {
        paraLines.push(lines[i]);
        i++;
      }
      if (paraLines.length > 0) {
        out.push(`<p>${this._inline(paraLines.join('\n'))}</p>`);
      } else {
        // Safety: if no handler consumed the line, skip it to prevent infinite loop
        i++;
      }
    }

    return out.join('\n');
  }

  /** Check if a line starts a block-level element (heading, list, hr, quote, fence, table). */
  private _isBlockStart(line: string): boolean {
    if (/^#{1,6}\s/.test(line)) return true;
    if (/^(\*{3,}|-{3,}|_{3,})\s*$/.test(line)) return true;
    if (/^>\s?/.test(line)) return true;
    if (/^(`{3,}|~{3,})/.test(line)) return true;
    if (/^\s*[-*+]\s+/.test(line)) return true;
    if (/^\s*\d+\.\s+/.test(line)) return true;
    return false;
  }

  /** Parse a markdown table row into cells. */
  private _parseTableRow(row: string): string[] {
    return row.replace(/^\|/, '').replace(/\|$/, '').split('|');
  }

  /** Render inline markdown (bold, italic, code, links, images, strikethrough). */
  private _inline(text: string): string {
    let s = this._esc(text);

    // Images: ![alt](url)
    s = s.replace(/!\[([^\]]*)\]\(([^)]+)\)/g, '<img src="$2" alt="$1" />');

    // Links: [text](url)
    s = s.replace(/\[([^\]]+)\]\(([^)]+)\)/g, '<a href="$2">$1</a>');

    // Inline code: `code`
    s = s.replace(/`([^`]+)`/g, '<code>$1</code>');

    // Bold + italic: ***text*** or ___text___
    s = s.replace(/\*{3}(.+?)\*{3}/g, '<strong><em>$1</em></strong>');
    s = s.replace(/_{3}(.+?)_{3}/g, '<strong><em>$1</em></strong>');

    // Bold: **text** or __text__
    s = s.replace(/\*{2}(.+?)\*{2}/g, '<strong>$1</strong>');
    s = s.replace(/_{2}(.+?)_{2}/g, '<strong>$1</strong>');

    // Italic: *text* or _text_
    s = s.replace(/\*(.+?)\*/g, '<em>$1</em>');
    s = s.replace(/_(.+?)_/g, '<em>$1</em>');

    // Strikethrough: ~~text~~
    s = s.replace(/~~(.+?)~~/g, '<del>$1</del>');

    // Line breaks
    s = s.replace(/\n/g, '<br />');

    return s;
  }

  /** HTML-escape a string. */
  private _esc(s: string): string {
    return s
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;');
  }
}
