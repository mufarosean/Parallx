// chatContentParts.ts — Content part rendering (M9 Task 3.6 + 6.4 + 7.3)
//
// Dispatches on IChatContentPart.kind to render typed content parts.
// M9.0: Markdown, CodeBlock, Progress, Thinking, Warning.
// M9.1: ToolInvocation (status cards with accept/reject), Confirmation.
// M9.2: EditProposal, EditBatch (diff preview with accept/reject).
//
// VS Code reference:
//   src/vs/workbench/contrib/chat/browser/chatContentParts/

import 'katex/dist/katex.min.css';

import MarkdownIt from 'markdown-it';
import katex from 'katex';
import { $ } from '../../../ui/dom.js';
import { chatIcons } from '../chatIcons.js';
import { extractFilePath, renderCodeActionButtons } from './chatCodeActions.js';
import { ChatContentPartKind } from '../../../services/chatTypes.js';
import { getFileTypeIcon, getPageIcon } from '../../../ui/iconRegistry.js';
import type {
  IChatContentPart,
  IChatMarkdownContent,
  IChatCodeBlockContent,
  IChatProgressContent,
  IChatThinkingContent,
  IChatWarningContent,
  IChatToolInvocationContent,
  IChatConfirmationContent,
  IChatEditProposalContent,
  IChatEditBatchContent,
  IChatReferenceContent,
} from '../../../services/chatTypes.js';

const CHAT_MARKDOWN = _createChatMarkdownRenderer();

/**
 * Render a single content part into the given container.
 * Returns the created DOM element.
 */
export function renderContentPart(part: IChatContentPart): HTMLElement {
  switch (part.kind) {
    case ChatContentPartKind.Markdown:
      return _renderMarkdown(part);
    case ChatContentPartKind.CodeBlock:
      return _renderCodeBlock(part);
    case ChatContentPartKind.Progress:
      return _renderProgress(part);
    case ChatContentPartKind.Thinking:
      return _renderThinking(part);
    case ChatContentPartKind.Warning:
      return _renderWarning(part);
    case ChatContentPartKind.ToolInvocation:
      return _renderToolInvocation(part);
    case ChatContentPartKind.Reference:
      return _renderReference(part);
    case ChatContentPartKind.Confirmation:
      return _renderConfirmation(part);
    case ChatContentPartKind.EditProposal:
      return _renderEditProposal(part);
    case ChatContentPartKind.EditBatch:
      return _renderEditBatch(part);
  }
}

export function _postProcessMathFallbacksForTest(container: HTMLElement): void {
  _postProcessMathFallbacks(container);
}

// ── Markdown ──

/**
 * Renders markdown content as HTML.
 * M9.0: basic inline markdown (bold, italic, code, links, paragraphs, lists, headings).
 * Full Tiptap integration in follow-up per M9 doc design decisions.
 */
function _renderMarkdown(part: IChatMarkdownContent): HTMLElement {
  const el = $('div.parallx-chat-markdown');
  // Convert basic markdown to HTML
  el.innerHTML = _markdownToHtml(part.content);
  _postProcessMathFallbacks(el);

  // M15: Post-process [N] citation markers into clickable superscript badges.
  // The model emits [1], [2] etc. based on numbered retrieved context.
  // We replace those text nodes with interactive badges that navigate to the source.
  if (part.citations && part.citations.length > 0) {
    _postProcessCitations(el, part.citations);
    // M15 Change 5: Auto-link any quoted or unquoted mention of a source
    // label in the model's prose (Cursor-pattern dual layer).
    _autoLinkSourceMentions(el, part.citations);
  }

  return el;
}

function _postProcessMathFallbacks(container: HTMLElement): void {
  const candidates = Array.from(container.querySelectorAll<HTMLElement>('p, li > p, blockquote p'));
  for (const element of candidates) {
    if (_stripMathDelimiterArtifacts(element)) {
      continue;
    }

    if (element.querySelector('code, pre, .katex, a, sup')) {
      continue;
    }

    const rawText = (element.textContent || '').replace(/\u00a0/g, ' ').trim();
    const wholeParagraphMatch = rawText.match(/^(?:\\)?\[\s*([\s\S]*?)\s*(?:\\)?\]$/);
    if (wholeParagraphMatch) {
      const latex = wholeParagraphMatch[1].trim();
      if (_looksLikeLatex(latex)) {
        element.innerHTML = `<span class="parallx-chat-math-block">${_renderKatex(latex, true)}</span>`;
        continue;
      }
    }

    const originalHtml = element.innerHTML;
    const updatedHtml = originalHtml.replace(
      /(?:\\)?\[\s*(?:<br\s*\/?>|\n)+([\s\S]*?)(?:<br\s*\/?>|\n)+\s*(?:\\)?\]/g,
      (_match, fragment) => {
        const latex = _extractMathTextFromHtmlFragment(fragment);
        if (!_looksLikeLatex(latex)) {
          return _match;
        }
        return `<span class="parallx-chat-math-block">${_renderKatex(latex, true)}</span>`;
      },
    );

    if (updatedHtml !== originalHtml) {
      element.innerHTML = updatedHtml;
    }
  }
}

function _stripMathDelimiterArtifacts(element: HTMLElement): boolean {
  if (!element.querySelector('.katex, .parallx-chat-math-block')) {
    return false;
  }

  const significantNodes = Array.from(element.childNodes).filter((node) => {
    return node.nodeType !== Node.TEXT_NODE || (node.textContent || '').trim().length > 0;
  });

  if (significantNodes.length < 3) {
    return false;
  }

  const first = significantNodes[0];
  const last = significantNodes[significantNodes.length - 1];
  if (first.nodeType !== Node.TEXT_NODE || last.nodeType !== Node.TEXT_NODE) {
    return false;
  }

  const open = (first.textContent || '').trim();
  const close = (last.textContent || '').trim();
  const isWrappedMath = (open === '$' && close === '$')
    || (open === '\\(' && close === '\\)')
    || (open === '[' && close === ']')
    || (open === '\\[' && close === '\\]');
  if (!isWrappedMath) {
    return false;
  }

  const middleNodes = significantNodes.slice(1, -1);
  const containsRenderedMath = middleNodes.some((node) => {
    return node.nodeType === Node.ELEMENT_NODE
      && (node as Element).matches('.katex, .katex-display, .parallx-chat-math-block')
      || (node.nodeType === Node.ELEMENT_NODE && !!(node as Element).querySelector('.katex, .katex-display, .parallx-chat-math-block'));
  });
  if (!containsRenderedMath) {
    return false;
  }

  const onlyMathMarkupBetween = middleNodes.every((node) => {
    if (node.nodeType === Node.TEXT_NODE) {
      return (node.textContent || '').trim().length === 0;
    }
    if (node.nodeType !== Node.ELEMENT_NODE) {
      return false;
    }
    const elementNode = node as Element;
    return elementNode.tagName === 'BR'
      || elementNode.matches('.katex, .katex-display, .parallx-chat-math-block')
      || !!elementNode.querySelector('.katex, .katex-display, .parallx-chat-math-block');
  });
  if (!onlyMathMarkupBetween) {
    return false;
  }

  first.remove();
  last.remove();
  return true;
}

function _extractMathTextFromHtmlFragment(fragment: string): string {
  const normalized = fragment.replace(/<br\s*\/?>/gi, '\n');
  const temp = document.createElement('div');
  temp.innerHTML = normalized;
  return (temp.textContent || '')
    .replace(/\u00a0/g, ' ')
    .split('\n')
    .map((line) => line.trim())
    .filter((line) => line.length > 0)
    .join('\n');
}

function _looksLikeLatex(text: string): boolean {
  return /\\[A-Za-z]+|[_^{}]|=/.test(text);
}

function _normalizeChatMarkdown(md: string): string {
  const withMathBlocks = _normalizeLooseMathBlocks(md);
  return _normalizeAlignedTables(withMathBlocks);
}

function _normalizeLooseMathBlocks(md: string): string {
  const lines = md.split('\n');
  const normalized: string[] = [];

  for (let index = 0; index < lines.length; index += 1) {
    const trimmed = lines[index].trim();
    const isOpen = trimmed === '[' || trimmed === '\\[';
    if (!isOpen) {
      normalized.push(lines[index]);
      continue;
    }

    const blockLines: string[] = [];
    let closeIndex = -1;
    for (let cursor = index + 1; cursor < lines.length; cursor += 1) {
      const cursorTrimmed = lines[cursor].trim();
      if (cursorTrimmed === ']' || cursorTrimmed === '\\]') {
        closeIndex = cursor;
        break;
      }
      blockLines.push(lines[cursor]);
    }

    if (closeIndex < 0) {
      normalized.push(lines[index]);
      continue;
    }

    const latex = blockLines.join('\n').trim();
    if (!_looksLikeLatex(latex)) {
      normalized.push(lines[index]);
      continue;
    }

    normalized.push('\\[');
    normalized.push(...blockLines);
    normalized.push('\\]');
    index = closeIndex;
  }

  return normalized.join('\n');
}

function _normalizeAlignedTables(md: string): string {
  const lines = md.split('\n');
  const normalized: string[] = [];

  for (let index = 0; index < lines.length; index += 1) {
    const parsed = _parseAlignedTable(lines, index);
    if (!parsed) {
      normalized.push(lines[index]);
      continue;
    }

    normalized.push(...parsed.markdownLines);
    index = parsed.endLine;
  }

  return normalized.join('\n');
}

function _parseAlignedTable(
  lines: string[],
  startLine: number,
): { markdownLines: string[]; endLine: number } | undefined {
  const block: string[] = [];
  let endLine = startLine;

  for (let index = startLine; index < lines.length; index += 1) {
    const line = lines[index];
    const trimmed = line.trim();
    if (!trimmed) {
      break;
    }
    if (/^(?:[-*+]\s|\d{1,3}[.)]\s|>|#|```|\|)/.test(trimmed)) {
      break;
    }
    block.push(line);
    endLine = index;
  }

  if (block.length < 3) {
    return undefined;
  }

  const rows = block.map((line, rowIndex) => _splitAlignedTableRow(line, rowIndex === 0));
  if (rows.some((row) => !row)) {
    return undefined;
  }

  const safeRows = rows as string[][];
  const header = safeRows[0];
  if (header.length < 3 || !_looksLikeTriangleHeader(header)) {
    return undefined;
  }

  const targetColumns = header.length;
  const dataRows = safeRows.slice(1);
  if (dataRows.length < 2) {
    return undefined;
  }

  const validDataRows = dataRows.every((row) => {
    if (row.length < 2 || row.length > targetColumns) {
      return false;
    }
    return _isTriangleRowLabel(row[0]) && row.slice(1).every((cell) => cell === '' || _isNumericTableCell(cell));
  });
  if (!validDataRows) {
    return undefined;
  }

  const paddedRows = [header, ...dataRows.map((row) => {
    const padded = row.slice();
    while (padded.length < targetColumns) {
      padded.push('');
    }
    return padded;
  })];

  const markdownLines = [
    _toPipeTableRow(paddedRows[0]),
    _toPipeTableRow(new Array(targetColumns).fill('---')),
    ...paddedRows.slice(1).map(_toPipeTableRow),
  ];
  return { markdownLines, endLine };
}

function _splitAlignedTableRow(line: string, isHeader: boolean): string[] | undefined {
  const trimmed = line.trim();
  if (!trimmed) {
    return undefined;
  }

  let cells = trimmed.split(/\s{2,}|\t+/).map((cell) => cell.trim()).filter(Boolean);
  if (cells.length >= 3) {
    return cells;
  }

  if (isHeader) {
    const headerMatch = trimmed.match(/^(Year|AY|Accident Year)\s+(.+)$/i);
    if (!headerMatch) {
      return undefined;
    }
    const headerCells = [headerMatch[1], ...Array.from(headerMatch[2].matchAll(/\d+\s*(?:months?|mos?)|ultimate/gi)).map((match) => match[0].trim())];
    return headerCells.length >= 3 ? headerCells : undefined;
  }

  const rowMatch = trimmed.match(/^([A-Za-z]{1,6}|\d{4})\s+(.+)$/);
  if (!rowMatch) {
    return undefined;
  }
  const numericCells = Array.from(rowMatch[2].matchAll(/-?\d[\d,]*(?:\.\d+)?/g)).map((match) => match[0]);
  if (numericCells.length < 1) {
    return undefined;
  }
  return [rowMatch[1], ...numericCells];
}

function _looksLikeTriangleHeader(header: string[]): boolean {
  const first = header[0].toLowerCase();
  if (!(first === 'year' || first === 'ay' || first === 'accident year')) {
    return false;
  }
  return header.slice(1).every((cell) => /\d+\s*(?:months?|mos?)|ultimate/i.test(cell));
}

function _isTriangleRowLabel(value: string): boolean {
  return /^\d{4}$/.test(value) || /^[A-Za-z]{1,8}$/.test(value);
}

function _isNumericTableCell(value: string): boolean {
  return /^-?\d[\d,]*(?:\.\d+)?$/.test(value.trim());
}

function _toPipeTableRow(cells: string[]): string {
  return `| ${cells.map((cell) => cell.trim()).join(' | ')} |`;
}

/**
 * Post-process [N] citation markers within a rendered markdown element.
 *
 * Walks all text nodes looking for patterns like [1], [2], [1][3] etc.
 * Replaces them with clickable superscript badges that navigate to the
 * corresponding source. This is the Perplexity-style citation UX.
 *
 * M15 — Citation Attribution Redesign.
 */
function _postProcessCitations(
  container: HTMLElement,
  citations: Array<{ index: number; uri: string; label: string }>,
): void {
  // Build a lookup map: index → citation
  const citationMap = new Map<number, { uri: string; label: string }>();
  for (const c of citations) {
    citationMap.set(c.index, { uri: c.uri, label: c.label });
  }

  // Walk all text nodes in the container
  const walker = document.createTreeWalker(container, NodeFilter.SHOW_TEXT);
  const nodesToProcess: Text[] = [];
  let node: Text | null;
  while ((node = walker.nextNode() as Text | null)) {
    if (/\[\d+\]/.test(node.textContent || '')) {
      nodesToProcess.push(node);
    }
  }

  // Process each text node that contains [N] markers
  for (const textNode of nodesToProcess) {
    const text = textNode.textContent || '';
    // Split on [N] patterns, keeping the delimiters
    const parts = text.split(/(\[\d+\])/g);
    if (parts.length <= 1) { continue; }

    const frag = document.createDocumentFragment();
    for (const segment of parts) {
      const match = segment.match(/^\[(\d+)\]$/);
      if (match) {
        const idx = parseInt(match[1], 10);
        const citation = citationMap.get(idx);
        if (citation) {
          // Create a clickable superscript citation badge
          const badge = document.createElement('sup');
          badge.className = 'parallx-citation-badge';
          badge.textContent = String(idx);
          badge.title = citation.label;
          badge.setAttribute('data-citation-index', String(idx));
          badge.setAttribute('data-citation-uri', citation.uri);
          badge.addEventListener('click', () => {
            const isPage = citation.uri.startsWith('parallx-page://');
            const isMemory = citation.uri.startsWith('parallx-memory://');
            if (isPage) {
              const pageId = citation.uri.replace('parallx-page://', '');
              badge.dispatchEvent(new CustomEvent('parallx:navigate-page', {
                bubbles: true,
                detail: { pageId },
              }));
            } else if (isMemory) {
              const sessionId = citation.uri.replace('parallx-memory://', '');
              badge.dispatchEvent(new CustomEvent('parallx:open-memory', {
                bubbles: true,
                detail: { sessionId },
              }));
            } else {
              badge.dispatchEvent(new CustomEvent('parallx:open-file', {
                bubbles: true,
                detail: { path: citation.uri },
              }));
            }
          });
          frag.appendChild(badge);
        } else {
          // Unknown citation index — render as plain text
          frag.appendChild(document.createTextNode(segment));
        }
      } else {
        frag.appendChild(document.createTextNode(segment));
      }
    }
    textNode.parentNode?.replaceChild(frag, textNode);
  }
}

/**
 * Auto-link mentions of source labels in the model's prose.
 *
 * After citation badges are placed, this second pass detects occurrences of
 * source names (e.g. "FSI Shona Basic Course.pdf", project-notes.md) in
 * remaining text nodes and wraps them in clickable links. This is the
 * Cursor-pattern dual layer: even when the model doesn't use [N] notation,
 * file/page references become navigable.
 *
 * Handles both quoted ("filename.pdf") and bare mentions. Skips nodes that
 * are already inside <a>, <code>, or <sup> elements to avoid double-linking.
 *
 * M15 Change 5 — Auto-Link Workspace Mentions.
 */
function _autoLinkSourceMentions(
  container: HTMLElement,
  citations: Array<{ index: number; uri: string; label: string }>,
): void {
  if (citations.length === 0) { return; }

  // Build an array of labels sorted longest-first so "FSI Shona Basic Course.pdf"
  // matches before a hypothetical shorter substring.
  const entries = citations
    .map(c => ({ label: c.label, uri: c.uri, index: c.index }))
    .sort((a, b) => b.label.length - a.label.length);

  // Escape labels for use in regex
  const escaped = entries.map(e => ({
    ...e,
    pattern: e.label.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'),
  }));

  // Build a combined regex: match any label, optionally surrounded by quotes
  // The regex captures optional leading quote, the label, and optional trailing quote.
  const combined = new RegExp(
    `(?:["\u201C\u201D])(${escaped.map(e => e.pattern).join('|')})(?:["\u201C\u201D])|\\b(${escaped.map(e => e.pattern).join('|')})(?=\\s|[.,;:!?)\\]]|$)`,
    'gi',
  );

  // Build label → entry lookup (case-insensitive)
  const labelMap = new Map<string, { uri: string; index: number }>();
  for (const e of entries) {
    labelMap.set(e.label.toLowerCase(), { uri: e.uri, index: e.index });
  }

  // Tags we never auto-link inside
  const SKIP_TAGS = new Set(['A', 'CODE', 'PRE', 'SUP']);

  function _isInsideSkipTag(node: Node): boolean {
    let parent = node.parentElement;
    while (parent && parent !== container) {
      if (SKIP_TAGS.has(parent.tagName)) { return true; }
      parent = parent.parentElement;
    }
    return false;
  }

  // Collect text nodes
  const walker = document.createTreeWalker(container, NodeFilter.SHOW_TEXT);
  const textNodes: Text[] = [];
  let tNode: Text | null;
  while ((tNode = walker.nextNode() as Text | null)) {
    if (!_isInsideSkipTag(tNode) && combined.test(tNode.textContent || '')) {
      textNodes.push(tNode);
    }
    combined.lastIndex = 0; // reset stateful regex
  }

  for (const textNode of textNodes) {
    const text = textNode.textContent || '';
    const frag = document.createDocumentFragment();
    let lastIdx = 0;

    combined.lastIndex = 0;
    let m: RegExpExecArray | null;
    while ((m = combined.exec(text)) !== null) {
      const matchedLabel = m[1] || m[2];
      const entry = labelMap.get(matchedLabel.toLowerCase());
      if (!entry) { continue; }

      // Append text before this match
      if (m.index > lastIdx) {
        frag.appendChild(document.createTextNode(text.slice(lastIdx, m.index)));
      }

      // Create clickable link
      const link = document.createElement('a');
      link.className = 'parallx-source-mention';
      link.textContent = matchedLabel;
      link.title = `Open: ${matchedLabel}`;
      link.href = '#';
      link.setAttribute('data-citation-uri', entry.uri);
      link.setAttribute('data-citation-index', String(entry.index));
      link.addEventListener('click', (e) => {
        e.preventDefault();
        const isPage = entry.uri.startsWith('parallx-page://');
        const isMemory = entry.uri.startsWith('parallx-memory://');
        if (isPage) {
          const pageId = entry.uri.replace('parallx-page://', '');
          link.dispatchEvent(new CustomEvent('parallx:navigate-page', {
            bubbles: true,
            detail: { pageId },
          }));
        } else if (isMemory) {
          const sessionId = entry.uri.replace('parallx-memory://', '');
          link.dispatchEvent(new CustomEvent('parallx:open-memory', {
            bubbles: true,
            detail: { sessionId },
          }));
        } else {
          link.dispatchEvent(new CustomEvent('parallx:open-file', {
            bubbles: true,
            detail: { path: entry.uri },
          }));
        }
      });
      frag.appendChild(link);
      lastIdx = m.index + m[0].length;
    }

    // Remaining text after last match
    if (lastIdx < text.length) {
      frag.appendChild(document.createTextNode(text.slice(lastIdx)));
    }

    // Only replace if we actually found matches
    if (lastIdx > 0) {
      textNode.parentNode?.replaceChild(frag, textNode);
    }
  }
}

/**
 * Block-level markdown → HTML converter.
 *
 * Parses markdown line-by-line into blocks (code, heading, list, blockquote,
 * horizontal rule, paragraph), then applies inline formatting within each
 * block. This avoids the corruption caused by chaining global regex
 * replacements — paragraphs can't leak into lists, `<br>` can't appear
 * between `<li>` items, etc.
 *
 * Exported for testing.
 */
export function _markdownToHtml(md: string): string {
  return CHAT_MARKDOWN.render(_normalizeChatMarkdown(md));
}

function _escapeHtml(text: string): string {
  return text
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;');
}

function _createChatMarkdownRenderer(): MarkdownIt {
  const markdown = new MarkdownIt({
    html: false,
    breaks: true,
    linkify: false,
  });

  _installKatexRules(markdown);

  const defaultLinkOpen = markdown.renderer.rules.link_open
    ?? ((tokens, idx, options, _env, self) => self.renderToken(tokens, idx, options));
  markdown.renderer.rules.link_open = (tokens, idx, options, env, self) => {
    const token = tokens[idx];
    token.attrSet('target', '_blank');
    token.attrSet('rel', 'noopener');
    return defaultLinkOpen(tokens, idx, options, env, self);
  };

  return markdown;
}

function _installKatexRules(markdown: MarkdownIt): void {
  markdown.block.ruler.before('fence', 'parallx_math_block', (state, startLine, endLine, silent) => {
    const start = state.bMarks[startLine] + state.tShift[startLine];
    const max = state.eMarks[startLine];
    const firstLine = state.src.slice(start, max).trim();

    let open = '';
    let close = '';
    if (firstLine === '$$') {
      open = '$$';
      close = '$$';
    } else if (firstLine === '\\[') {
      open = '\\[';
      close = '\\]';
    } else {
      return false;
    }

    let nextLine = startLine + 1;
    const contentLines: string[] = [];
    while (nextLine < endLine) {
      const nextStart = state.bMarks[nextLine] + state.tShift[nextLine];
      const nextMax = state.eMarks[nextLine];
      const nextText = state.src.slice(nextStart, nextMax);
      if (nextText.trim() === close) {
        break;
      }
      contentLines.push(nextText);
      nextLine += 1;
    }

    if (nextLine >= endLine) {
      return false;
    }

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

  markdown.inline.ruler.before('escape', 'parallx_math_inline', (state, silent) => {
    const src = state.src;
    const start = state.pos;

    let open = '';
    let close = '';
    if (src.startsWith('\\(', start)) {
      open = '\\(';
      close = '\\)';
    } else if (src.charAt(start) === '$' && src.charAt(start + 1) !== '$') {
      open = '$';
      close = '$';
    } else {
      return false;
    }

    let matchPos = start + open.length;
    while (matchPos < src.length) {
      matchPos = src.indexOf(close, matchPos);
      if (matchPos < 0) {
        return false;
      }
      if (src.charAt(matchPos - 1) !== '\\') {
        break;
      }
      matchPos += close.length;
    }

    const content = src.slice(start + open.length, matchPos);
    if (!content.trim() || /\n/.test(content)) {
      return false;
    }

    if (!silent) {
      const token = state.push('parallx_math_inline', 'span', 0);
      token.content = content;
      token.markup = open;
    }

    state.pos = matchPos + close.length;
    return true;
  });

  markdown.renderer.rules.parallx_math_inline = (tokens, idx) => {
    return _renderKatex(tokens[idx].content, false);
  };

  markdown.renderer.rules.parallx_math_block = (tokens, idx) => {
    return `<div class="parallx-chat-math-block">${_renderKatex(tokens[idx].content, true)}</div>\n`;
  };
}

function _renderKatex(expression: string, displayMode: boolean): string {
  try {
    return katex.renderToString(expression, {
      throwOnError: false,
      displayMode,
      output: 'html',
    });
  } catch {
    const escaped = _escapeHtml(expression);
    return displayMode
      ? `<pre class="parallx-chat-math-fallback">${escaped}</pre>`
      : `<code class="parallx-chat-math-fallback">${escaped}</code>`;
  }
}

// ── Code Block ──

function _renderCodeBlock(part: IChatCodeBlockContent): HTMLElement {
  const root = $('div.parallx-chat-code-block');

  // Check for filepath header (M11 Task 2.6)
  const fileInfo = extractFilePath(part.code);

  // Header with language label + copy button
  const header = $('div.parallx-chat-code-block-header');
  const langLabel = $('span', part.language || 'text');
  const copyBtn = document.createElement('button');
  copyBtn.className = 'parallx-chat-code-block-copy';
  copyBtn.innerHTML = chatIcons.copy;
  copyBtn.type = 'button';
  copyBtn.title = 'Copy code';
  copyBtn.setAttribute('aria-label', 'Copy code');
  copyBtn.addEventListener('click', () => {
    const textToCopy = fileInfo ? fileInfo.codeWithoutHeader : part.code;
    navigator.clipboard.writeText(textToCopy).then(() => {
      copyBtn.innerHTML = chatIcons.check;
      setTimeout(() => {
        copyBtn.innerHTML = chatIcons.copy;
      }, 2000);
    });
  });
  header.appendChild(langLabel);
  header.appendChild(copyBtn);
  root.appendChild(header);

  // Code content (strip filepath header if present for display)
  const pre = document.createElement('pre');
  const code = document.createElement('code');
  code.textContent = fileInfo ? fileInfo.codeWithoutHeader : part.code;
  pre.appendChild(code);
  root.appendChild(pre);

  // Code action buttons when filepath detected (M11 Task 2.6)
  if (fileInfo) {
    const actionBar = renderCodeActionButtons(
      fileInfo.filePath,
      fileInfo.codeWithoutHeader,
      part.language,
    );
    root.appendChild(actionBar);
  }

  return root;
}

// ── Progress ──

function _renderProgress(part: IChatProgressContent): HTMLElement {
  const root = $('div.parallx-chat-progress');
  const spinner = $('div.parallx-chat-progress-spinner');
  const text = $('span', part.message);
  root.appendChild(spinner);
  root.appendChild(text);
  return root;
}

// ── Thinking ──

function _renderThinking(part: IChatThinkingContent): HTMLElement {
  const root = $('div.parallx-chat-thinking');
  if (part.isCollapsed) {
    root.classList.add('parallx-chat-thinking--collapsed');
  }

  // ── Toggle header ──
  // Builds:  ▶ Thinking · Searching 4 sources · 3 sources
  const toggle = $('div.parallx-chat-thinking-toggle');

  function _rebuildToggle(): void {
    toggle.textContent = '';

    // Arrow (CSS rotates it based on collapsed state)
    const arrowEl = $('span.parallx-chat-thinking-arrow', '\u25B6');
    toggle.appendChild(arrowEl);

    // Label: "Thinking" if we have reasoning text, "Context" if just refs/progress
    const hasContent = !!part.content;
    const hasRefs = part.references && part.references.length > 0;
    const hasProgress = !!part.progressMessage;
    const baseLabel = hasContent ? 'Thinking' : (hasRefs || hasProgress ? 'Context' : 'Thinking');

    const labelEl = $('span.parallx-chat-thinking-label', baseLabel);
    toggle.appendChild(labelEl);

    // Progress message (ephemeral, shown during streaming)
    if (hasProgress) {
      const sep = $('span.parallx-chat-thinking-sep', '\u00B7');
      toggle.appendChild(sep);
      const progressEl = $('span.parallx-chat-thinking-progress-label');
      const spinner = $('span.parallx-chat-thinking-spinner');
      progressEl.appendChild(spinner);
      const msgEl = $('span', ` ${part.progressMessage}`);
      progressEl.appendChild(msgEl);
      toggle.appendChild(progressEl);
    }

    // Source count summary
    if (hasRefs) {
      const count = part.references!.length;
      const sep = $('span.parallx-chat-thinking-sep', '\u00B7');
      toggle.appendChild(sep);
      const countEl = $('span.parallx-chat-thinking-source-count', `${count} source${count !== 1 ? 's' : ''}`);
      toggle.appendChild(countEl);
    }
  }

  _rebuildToggle();

  toggle.addEventListener('click', () => {
    part.isCollapsed = !part.isCollapsed;
    root.classList.toggle('parallx-chat-thinking--collapsed', part.isCollapsed);
    _rebuildToggle();
  });
  root.appendChild(toggle);

  // ── Content area (hidden when collapsed) ──
  const content = $('div.parallx-chat-thinking-content');

  // Thinking text
  if (part.content) {
    const text = $('div.parallx-chat-thinking-text');
    text.textContent = part.content;
    content.appendChild(text);
  }

  // Source reference pills
  if (part.references && part.references.length > 0) {
    const sourcesSection = $('div.parallx-chat-thinking-sources');

    // Add a subtle label when there's also thinking text above
    if (part.content) {
      const sourcesLabel = $('div.parallx-chat-thinking-sources-label', 'Sources');
      sourcesSection.appendChild(sourcesLabel);
    }

    const pillsRow = $('div.parallx-chat-thinking-sources-pills');
    for (const ref of part.references) {
      const pill = _renderReference({
        kind: ChatContentPartKind.Reference,
        uri: ref.uri,
        label: ref.index != null ? `[${ref.index}] ${ref.label}` : ref.label,
      });
      pillsRow.appendChild(pill);
    }
    sourcesSection.appendChild(pillsRow);

    content.appendChild(sourcesSection);
  }

  root.appendChild(content);

  return root;
}

// ── Warning ──

function _renderWarning(part: IChatWarningContent): HTMLElement {
  const root = $('div.parallx-chat-warning');
  const icon = $('span.parallx-chat-warning-icon', '\u26A0');
  const text = $('span', part.message);
  root.appendChild(icon);
  root.appendChild(text);
  return root;
}

// ── Reference Citation (M10 Phase 6 — Task 6.2) ──

/**
 * Render a source reference as a clickable pill/chip.
 * Clicking opens the referenced page or file.
 * URI scheme: `parallx-page://<pageId>` for canvas pages, file path for workspace files.
 */
function _renderReference(part: IChatReferenceContent): HTMLElement {
  const root = $('span.parallx-chat-reference');

  // Determine source type from URI
  const isPage = part.uri.startsWith('parallx-page://');
  const isMemory = part.uri.startsWith('parallx-memory://');

  // Icon — file-type aware (C4)
  const icon = $('span.parallx-chat-reference-icon');
  if (isPage) {
    icon.innerHTML = getPageIcon();
  } else if (isMemory) {
    icon.innerHTML = chatIcons.sparkleSmall;
  } else {
    // Extract extension from URI/path for file-type icon
    const extMatch = part.uri.match(/\.([a-zA-Z0-9]+)$/);
    const ext = extMatch ? extMatch[1] : '';
    icon.innerHTML = getFileTypeIcon(ext);
  }
  root.appendChild(icon);

  // Label
  const label = $('span.parallx-chat-reference-label');
  label.textContent = part.label;
  root.appendChild(label);

  // Click handler — open referenced source
  root.addEventListener('click', () => {
    if (isPage) {
      const pageId = part.uri.replace('parallx-page://', '');
      // Bubble through DOM so ChatWidget can listen on _messageListContainer
      root.dispatchEvent(new CustomEvent('parallx:navigate-page', {
        bubbles: true,
        detail: { pageId },
      }));
    } else if (isMemory) {
      const sessionId = part.uri.replace('parallx-memory://', '');
      root.dispatchEvent(new CustomEvent('parallx:open-memory', {
        bubbles: true,
        detail: { sessionId },
      }));
    } else {
      // File paths — open in editor
      root.dispatchEvent(new CustomEvent('parallx:open-file', {
        bubbles: true,
        detail: { path: part.uri },
      }));
    }
  });

  root.title = isMemory
    ? `View memory: ${part.label}`
    : isPage
      ? `Open page: ${part.label}`
      : `Open file: ${part.label}`;

  return root;
}

// ── Tool Invocation (Cap 6 Task 6.4) ──

/** Status badge labels and CSS modifier suffixes. */
const TOOL_STATUS_LABELS: Record<string, { label: string; modifier: string }> = {
  pending:   { label: 'Pending',   modifier: 'pending' },
  running:   { label: 'Running…',  modifier: 'running' },
  completed: { label: 'Completed', modifier: 'completed' },
  rejected:  { label: 'Rejected',  modifier: 'rejected' },
};

function _renderToolInvocation(part: IChatToolInvocationContent): HTMLElement {
  const root = $('div.parallx-chat-tool-invocation');

  // Header: tool icon + name
  const header = $('div.parallx-chat-tool-invocation-header');
  const icon = $('span.parallx-chat-tool-invocation-icon');
  icon.innerHTML = chatIcons.wrench;
  const name = $('span.parallx-chat-tool-invocation-name', part.toolName);
  header.appendChild(icon);
  header.appendChild(name);

  // Status badge
  const statusInfo = TOOL_STATUS_LABELS[part.status] ?? TOOL_STATUS_LABELS['pending'];
  const badge = $('span.parallx-chat-tool-status-badge');
  badge.classList.add(`parallx-chat-tool-status-badge--${statusInfo.modifier}`);
  badge.textContent = statusInfo.label;
  header.appendChild(badge);
  root.appendChild(header);

  // Arguments summary (collapsible)
  if (part.args && Object.keys(part.args).length > 0) {
    const argsContainer = $('div.parallx-chat-tool-invocation-args');
    const argsSummary = Object.entries(part.args)
      .map(([k, v]) => `${k}: ${_truncate(String(v), 80)}`)
      .join(', ');
    argsContainer.textContent = argsSummary;
    root.appendChild(argsContainer);
  }

  // Result (shown when complete)
  if (part.isComplete && part.result) {
    const resultContainer = $('div.parallx-chat-tool-invocation-result');

    if (part.isError || part.result.isError) {
      resultContainer.classList.add('parallx-chat-tool-invocation-result--error');
    }

    // Collapsible result content
    const resultText = part.result.content;
    if (resultText.length > 300) {
      const preview = $('div.parallx-chat-tool-invocation-result-preview');
      preview.textContent = resultText.slice(0, 300) + '…';

      const toggle = document.createElement('button');
      toggle.className = 'parallx-chat-tool-invocation-result-toggle';
      toggle.textContent = 'Show more';
      toggle.type = 'button';

      const full = $('div.parallx-chat-tool-invocation-result-full');
      full.textContent = resultText;
      full.style.display = 'none';

      toggle.addEventListener('click', () => {
        const isHidden = full.style.display === 'none';
        full.style.display = isHidden ? 'block' : 'none';
        preview.style.display = isHidden ? 'none' : 'block';
        toggle.textContent = isHidden ? 'Show less' : 'Show more';
      });

      resultContainer.appendChild(preview);
      resultContainer.appendChild(toggle);
      resultContainer.appendChild(full);
    } else {
      resultContainer.textContent = resultText;
    }

    root.appendChild(resultContainer);
  }

  // Running spinner
  if (part.status === 'running') {
    const spinner = $('div.parallx-chat-progress-spinner');
    root.appendChild(spinner);
  }

  return root;
}

function _truncate(text: string, max: number): string {
  return text.length > max ? text.slice(0, max) + '…' : text;
}

// ── Confirmation (Cap 6 Task 6.4, M11 Task 2.1) ──

function _renderConfirmation(part: IChatConfirmationContent): HTMLElement {
  const root = $('div.parallx-chat-confirmation');

  const message = $('div.parallx-chat-confirmation-message');
  message.textContent = part.message;
  root.appendChild(message);

  // Show tool arguments summary when available (M11 Task 2.1)
  if (part.toolArgs && Object.keys(part.toolArgs).length > 0) {
    const argsBlock = $('div.parallx-chat-confirmation-args');
    const argsSummary = Object.entries(part.toolArgs)
      .map(([k, v]) => {
        const val = typeof v === 'string'
          ? (v.length > 80 ? v.slice(0, 80) + '…' : v)
          : JSON.stringify(v);
        return `${k}: ${val}`;
      })
      .join('\n');
    const pre = document.createElement('pre');
    pre.textContent = argsSummary;
    argsBlock.appendChild(pre);
    root.appendChild(argsBlock);
  }

  // If already decided (3-tier grant), show result
  if (part.grantDecision) {
    const result = $('span.parallx-chat-confirmation-result');
    const labels: Record<string, { text: string; cls: string }> = {
      'allow-once': { text: '✓ Allowed (once)', cls: 'parallx-chat-confirmation-result--accepted' },
      'allow-session': { text: '✓ Allowed (session)', cls: 'parallx-chat-confirmation-result--accepted' },
      'always-allow': { text: '✓ Always allowed', cls: 'parallx-chat-confirmation-result--accepted' },
      'reject': { text: '✗ Rejected', cls: 'parallx-chat-confirmation-result--rejected' },
    };
    const info = labels[part.grantDecision] ?? { text: '✓ Allowed', cls: 'parallx-chat-confirmation-result--accepted' };
    result.textContent = info.text;
    result.classList.add(info.cls);
    root.appendChild(result);
    return root;
  }

  // If already decided (legacy flow), show result
  if (part.isAccepted !== undefined) {
    const result = $('span.parallx-chat-confirmation-result');
    result.textContent = part.isAccepted ? '✓ Accepted' : '✗ Rejected';
    result.classList.add(
      part.isAccepted
        ? 'parallx-chat-confirmation-result--accepted'
        : 'parallx-chat-confirmation-result--rejected',
    );
    root.appendChild(result);
    return root;
  }

  // Grant buttons (M11 Task 2.1 — 3-tier flow)
  if (part.onGrant) {
    const buttonBar = $('div.parallx-chat-confirmation-buttons');

    const makeBtn = (label: string, cls: string, decision: import('../../../services/chatTypes.js').ToolGrantDecision): void => {
      const btn = document.createElement('button');
      btn.className = `parallx-chat-confirmation-btn ${cls}`;
      btn.textContent = label;
      btn.type = 'button';
      btn.addEventListener('click', () => {
        part.grantDecision = decision;
        // Also set legacy field for backward compat
        part.isAccepted = decision !== 'reject';
        part.onGrant!(decision);
        _replaceWithGrantResult(root, decision);
      });
      buttonBar.appendChild(btn);
    };

    makeBtn('Allow once', 'parallx-chat-confirmation-btn--accept', 'allow-once');
    makeBtn('Allow for session', 'parallx-chat-confirmation-btn--session', 'allow-session');
    makeBtn('Always allow', 'parallx-chat-confirmation-btn--always', 'always-allow');
    makeBtn('Reject', 'parallx-chat-confirmation-btn--reject', 'reject');

    root.appendChild(buttonBar);
    return root;
  }

  // Legacy Accept / Reject buttons (no onGrant callback)
  const buttonBar = $('div.parallx-chat-confirmation-buttons');

  const acceptBtn = document.createElement('button');
  acceptBtn.className = 'parallx-chat-confirmation-btn parallx-chat-confirmation-btn--accept';
  acceptBtn.textContent = 'Accept';
  acceptBtn.type = 'button';
  acceptBtn.addEventListener('click', () => {
    part.isAccepted = true;
    _replaceWithResult(root, true);
  });

  const rejectBtn = document.createElement('button');
  rejectBtn.className = 'parallx-chat-confirmation-btn parallx-chat-confirmation-btn--reject';
  rejectBtn.textContent = 'Reject';
  rejectBtn.type = 'button';
  rejectBtn.addEventListener('click', () => {
    part.isAccepted = false;
    _replaceWithResult(root, false);
  });

  buttonBar.appendChild(acceptBtn);
  buttonBar.appendChild(rejectBtn);
  root.appendChild(buttonBar);

  return root;
}

function _replaceWithGrantResult(root: HTMLElement, decision: import('../../../services/chatTypes.js').ToolGrantDecision): void {
  // Remove buttons, show result text
  const buttonBar = root.querySelector('.parallx-chat-confirmation-buttons');
  if (buttonBar) { buttonBar.remove(); }

  const labels: Record<string, { text: string; cls: string }> = {
    'allow-once': { text: '✓ Allowed (once)', cls: 'parallx-chat-confirmation-result--accepted' },
    'allow-session': { text: '✓ Allowed (session)', cls: 'parallx-chat-confirmation-result--accepted' },
    'always-allow': { text: '✓ Always allowed', cls: 'parallx-chat-confirmation-result--accepted' },
    'reject': { text: '✗ Rejected', cls: 'parallx-chat-confirmation-result--rejected' },
  };
  const info = labels[decision] ?? { text: '✓ Allowed', cls: 'parallx-chat-confirmation-result--accepted' };

  const result = $('span.parallx-chat-confirmation-result');
  result.textContent = info.text;
  result.classList.add(info.cls);
  root.appendChild(result);
}

function _replaceWithResult(root: HTMLElement, accepted: boolean): void {
  // Remove buttons, show result text
  const buttonBar = root.querySelector('.parallx-chat-confirmation-buttons');
  if (buttonBar) { buttonBar.remove(); }

  const result = $('span.parallx-chat-confirmation-result');
  result.textContent = accepted ? '✓ Accepted' : '✗ Rejected';
  result.classList.add(
    accepted
      ? 'parallx-chat-confirmation-result--accepted'
      : 'parallx-chat-confirmation-result--rejected',
  );
  root.appendChild(result);
}

// ── Edit Proposal (Cap 7 Task 7.3) ──

/** Status labels for edit proposals. */
const EDIT_STATUS_LABELS: Record<string, { label: string; modifier: string }> = {
  pending:  { label: 'Pending',  modifier: 'pending' },
  accepted: { label: 'Applied',  modifier: 'accepted' },
  rejected: { label: 'Rejected', modifier: 'rejected' },
};

/** Operation labels and icons. */
const EDIT_OP_LABELS: Record<string, { label: string; icon: string }> = {
  insert: { label: 'Insert', icon: '\u002B' },  // +
  update: { label: 'Update', icon: '\u270E' },  // ✎
  delete: { label: 'Delete', icon: '\u2212' },  // −
};

import type { EditApplyEventDetail } from '../chatTypes.js';

// EditApplyEventDetail — now defined in chatTypes.ts (M13 Phase 1)
export type { EditApplyEventDetail } from '../chatTypes.js';

function _renderEditProposal(part: IChatEditProposalContent): HTMLElement {
  const root = $('div.parallx-chat-edit-proposal');
  root.dataset['pageId'] = part.pageId;
  if (part.blockId) { root.dataset['blockId'] = part.blockId; }
  root.dataset['operation'] = part.operation;

  // Header: operation icon + label + target info
  const header = $('div.parallx-chat-edit-proposal-header');
  const opInfo = EDIT_OP_LABELS[part.operation] ?? EDIT_OP_LABELS['update'];
  const icon = $('span.parallx-chat-edit-proposal-icon', opInfo.icon);
  const label = $('span.parallx-chat-edit-proposal-label', `${opInfo.label} block`);
  header.appendChild(icon);
  header.appendChild(label);

  // Status badge
  const statusInfo = EDIT_STATUS_LABELS[part.status] ?? EDIT_STATUS_LABELS['pending'];
  const badge = $('span.parallx-chat-edit-status-badge');
  badge.classList.add(`parallx-chat-edit-status-badge--${statusInfo.modifier}`);
  badge.textContent = statusInfo.label;
  header.appendChild(badge);
  root.appendChild(header);

  // Target info
  const target = $('div.parallx-chat-edit-proposal-target');
  target.textContent = part.blockId
    ? `Page: ${_truncate(part.pageId, 12)} \u2192 Block: ${_truncate(part.blockId, 12)}`
    : `Page: ${_truncate(part.pageId, 12)}`;
  root.appendChild(target);

  // Diff preview: before (red) / after (green)
  const diff = $('div.parallx-chat-edit-proposal-diff');

  if (part.before) {
    const beforeBlock = $('div.parallx-chat-edit-diff-before');
    const beforeLabel = $('span.parallx-chat-edit-diff-label', '\u2212 Before');
    const beforeContent = $('pre.parallx-chat-edit-diff-content');
    beforeContent.textContent = part.before;
    beforeBlock.appendChild(beforeLabel);
    beforeBlock.appendChild(beforeContent);
    diff.appendChild(beforeBlock);
  }

  if (part.after && part.operation !== 'delete') {
    const afterBlock = $('div.parallx-chat-edit-diff-after');
    const afterLabel = $('span.parallx-chat-edit-diff-label', '\u002B After');
    const afterContent = $('pre.parallx-chat-edit-diff-content');
    afterContent.textContent = part.after;
    afterBlock.appendChild(afterLabel);
    afterBlock.appendChild(afterContent);
    diff.appendChild(afterBlock);
  }

  root.appendChild(diff);

  // Accept / Reject buttons (only when pending)
  if (part.status === 'pending') {
    const buttonBar = $('div.parallx-chat-edit-proposal-buttons');

    const acceptBtn = document.createElement('button');
    acceptBtn.className = 'parallx-chat-edit-btn parallx-chat-edit-btn--accept';
    acceptBtn.textContent = '\u2713 Accept';
    acceptBtn.type = 'button';
    acceptBtn.addEventListener('click', () => {
      part.status = 'accepted';
      _updateEditProposalStatus(root, part);
      // Dispatch custom event for apply logic
      root.dispatchEvent(new CustomEvent('parallx-edit-apply', {
        bubbles: true,
        detail: { proposal: part } satisfies EditApplyEventDetail,
      }));
    });

    const rejectBtn = document.createElement('button');
    rejectBtn.className = 'parallx-chat-edit-btn parallx-chat-edit-btn--reject';
    rejectBtn.textContent = '\u2717 Reject';
    rejectBtn.type = 'button';
    rejectBtn.addEventListener('click', () => {
      part.status = 'rejected';
      _updateEditProposalStatus(root, part);
    });

    buttonBar.appendChild(acceptBtn);
    buttonBar.appendChild(rejectBtn);
    root.appendChild(buttonBar);
  }

  return root;
}

function _updateEditProposalStatus(root: HTMLElement, part: IChatEditProposalContent): void {
  // Update badge
  const badge = root.querySelector('.parallx-chat-edit-status-badge');
  if (badge) {
    const statusInfo = EDIT_STATUS_LABELS[part.status] ?? EDIT_STATUS_LABELS['pending'];
    badge.textContent = statusInfo.label;
    badge.className = 'parallx-chat-edit-status-badge';
    (badge as HTMLElement).classList.add(`parallx-chat-edit-status-badge--${statusInfo.modifier}`);
  }

  // Remove buttons once decided
  const buttonBar = root.querySelector('.parallx-chat-edit-proposal-buttons');
  if (buttonBar) { buttonBar.remove(); }
}

// ── Edit Batch (Cap 7 Task 7.3) ──

function _renderEditBatch(part: IChatEditBatchContent): HTMLElement {
  const root = $('div.parallx-chat-edit-batch');

  // Explanation
  if (part.explanation) {
    const explanation = $('div.parallx-chat-edit-batch-explanation');
    explanation.innerHTML = _markdownToHtml(part.explanation);
    root.appendChild(explanation);
  }

  // Batch action buttons
  const batchBar = $('div.parallx-chat-edit-batch-actions');

  const acceptAllBtn = document.createElement('button');
  acceptAllBtn.className = 'parallx-chat-edit-btn parallx-chat-edit-btn--accept-all';
  acceptAllBtn.textContent = '\u2713 Accept All';
  acceptAllBtn.type = 'button';
  acceptAllBtn.addEventListener('click', () => {
    for (const proposal of part.proposals) {
      if (proposal.status === 'pending') {
        proposal.status = 'accepted';
      }
    }
    _refreshBatchProposals(root, part);
    // Dispatch custom event for each accepted proposal
    for (const proposal of part.proposals) {
      if (proposal.status === 'accepted') {
        root.dispatchEvent(new CustomEvent('parallx-edit-apply', {
          bubbles: true,
          detail: { proposal } satisfies EditApplyEventDetail,
        }));
      }
    }
  });

  const rejectAllBtn = document.createElement('button');
  rejectAllBtn.className = 'parallx-chat-edit-btn parallx-chat-edit-btn--reject-all';
  rejectAllBtn.textContent = '\u2717 Reject All';
  rejectAllBtn.type = 'button';
  rejectAllBtn.addEventListener('click', () => {
    for (const proposal of part.proposals) {
      if (proposal.status === 'pending') {
        proposal.status = 'rejected';
      }
    }
    _refreshBatchProposals(root, part);
  });

  batchBar.appendChild(acceptAllBtn);
  batchBar.appendChild(rejectAllBtn);
  root.appendChild(batchBar);

  // Individual proposals
  const proposalContainer = $('div.parallx-chat-edit-batch-proposals');
  for (const proposal of part.proposals) {
    proposalContainer.appendChild(_renderEditProposal(proposal));
  }
  root.appendChild(proposalContainer);

  return root;
}

function _refreshBatchProposals(root: HTMLElement, part: IChatEditBatchContent): void {
  const container = root.querySelector('.parallx-chat-edit-batch-proposals');
  if (!container) { return; }

  // Re-render all proposals
  container.innerHTML = '';
  for (const proposal of part.proposals) {
    container.appendChild(_renderEditProposal(proposal));
  }

  // Hide batch buttons if all decided
  const allDecided = part.proposals.every((p) => p.status !== 'pending');
  if (allDecided) {
    const actions = root.querySelector('.parallx-chat-edit-batch-actions');
    if (actions) { actions.remove(); }
  }
}


