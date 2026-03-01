// chatContentParts.ts — Content part rendering (M9 Task 3.6)
//
// Dispatches on IChatContentPart.kind to render typed content parts.
// M9.0 supports: Markdown, CodeBlock, Progress, Thinking, Warning.
// M9.1/M9.2 parts (ToolInvocation, Reference, Confirmation) are stubbed.
//
// VS Code reference:
//   src/vs/workbench/contrib/chat/browser/chatContentParts/

import { $ } from '../../ui/dom.js';
import { ChatContentPartKind } from '../../services/chatTypes.js';
import type {
  IChatContentPart,
  IChatMarkdownContent,
  IChatCodeBlockContent,
  IChatProgressContent,
  IChatThinkingContent,
  IChatWarningContent,
} from '../../services/chatTypes.js';

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
    case ChatContentPartKind.Reference:
    case ChatContentPartKind.Confirmation:
      return _renderUnsupported(part.kind);
  }
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
  return el;
}

/**
 * Minimal markdown → HTML converter for M9.0.
 * Covers the most common constructs that appear in LLM responses.
 * No external dependencies — pure regex transforms.
 */
function _markdownToHtml(md: string): string {
  let html = _escapeHtml(md);

  // Code blocks (``` ... ```) — must be processed before inline code
  html = html.replace(/```(\w*)\n([\s\S]*?)```/g, (_match, lang, code) => {
    const langAttr = lang ? ` data-lang="${lang}"` : '';
    return `<pre${langAttr}><code>${code.trimEnd()}</code></pre>`;
  });

  // Inline code (`...`)
  html = html.replace(/`([^`\n]+)`/g, '<code>$1</code>');

  // Headings (### ...)
  html = html.replace(/^### (.+)$/gm, '<h3>$1</h3>');
  html = html.replace(/^## (.+)$/gm, '<h2>$1</h2>');
  html = html.replace(/^# (.+)$/gm, '<h1>$1</h1>');

  // Bold (**...**)
  html = html.replace(/\*\*([^*]+)\*\*/g, '<strong>$1</strong>');

  // Italic (*...*)
  html = html.replace(/\*([^*]+)\*/g, '<em>$1</em>');

  // Links [text](url)
  html = html.replace(/\[([^\]]+)\]\(([^)]+)\)/g, '<a href="$2" target="_blank" rel="noopener">$1</a>');

  // Unordered lists (- item or * item)
  html = html.replace(/^[*-] (.+)$/gm, '<li>$1</li>');
  html = html.replace(/(<li>.*<\/li>\n?)+/g, '<ul>$&</ul>');

  // Ordered lists (1. item)
  html = html.replace(/^\d+\. (.+)$/gm, '<li>$1</li>');

  // Paragraphs: wrap remaining text blocks
  html = html.replace(/\n{2,}/g, '</p><p>');
  html = html.replace(/\n/g, '<br>');

  // Wrap in paragraph if not already wrapped in a block element
  if (!html.startsWith('<h') && !html.startsWith('<ul') && !html.startsWith('<ol') && !html.startsWith('<pre')) {
    html = `<p>${html}</p>`;
  }

  return html;
}

function _escapeHtml(text: string): string {
  return text
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;');
}

// ── Code Block ──

function _renderCodeBlock(part: IChatCodeBlockContent): HTMLElement {
  const root = $('div.parallx-chat-code-block');

  // Header with language label + copy button
  const header = $('div.parallx-chat-code-block-header');
  const langLabel = $('span', part.language || 'text');
  const copyBtn = document.createElement('button');
  copyBtn.className = 'parallx-chat-code-block-copy';
  copyBtn.textContent = 'Copy';
  copyBtn.type = 'button';
  copyBtn.addEventListener('click', () => {
    navigator.clipboard.writeText(part.code).then(() => {
      copyBtn.textContent = 'Copied!';
      setTimeout(() => {
        copyBtn.textContent = 'Copy';
      }, 2000);
    });
  });
  header.appendChild(langLabel);
  header.appendChild(copyBtn);
  root.appendChild(header);

  // Code content
  const pre = document.createElement('pre');
  const code = document.createElement('code');
  code.textContent = part.code;
  pre.appendChild(code);
  root.appendChild(pre);

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

  // Toggle header
  const toggle = $('div.parallx-chat-thinking-toggle');
  toggle.textContent = part.isCollapsed ? '\u25B6 Thinking\u2026' : '\u25BC Thinking';
  toggle.addEventListener('click', () => {
    part.isCollapsed = !part.isCollapsed;
    root.classList.toggle('parallx-chat-thinking--collapsed', part.isCollapsed);
    toggle.textContent = part.isCollapsed ? '\u25B6 Thinking\u2026' : '\u25BC Thinking';
  });
  root.appendChild(toggle);

  // Content
  const content = $('div.parallx-chat-thinking-content');
  content.textContent = part.content;
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

// ── Unsupported (stub for M9.1/M9.2 parts) ──

function _renderUnsupported(kind: string): HTMLElement {
  const el = $('div.parallx-chat-warning');
  el.textContent = `[Unsupported content: ${kind}]`;
  return el;
}
