// chatContentParts.ts — Content part rendering (M9 Task 3.6 + 6.4 + 7.3)
//
// Dispatches on IChatContentPart.kind to render typed content parts.
// M9.0: Markdown, CodeBlock, Progress, Thinking, Warning.
// M9.1: ToolInvocation (status cards with accept/reject), Confirmation.
// M9.2: EditProposal, EditBatch (diff preview with accept/reject).
//
// VS Code reference:
//   src/vs/workbench/contrib/chat/browser/chatContentParts/

import { $ } from '../../ui/dom.js';
import { chatIcons } from './chatIcons.js';
import { extractFilePath, renderCodeActionButtons } from './chatCodeActions.js';
import { ChatContentPartKind } from '../../services/chatTypes.js';
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

  // Icon
  const icon = $('span.parallx-chat-reference-icon');
  icon.textContent = isPage ? '\uD83D\uDCC4' : '\uD83D\uDCC1'; // 📄 for pages, 📁 for files
  root.appendChild(icon);

  // Label
  const label = $('span.parallx-chat-reference-label');
  label.textContent = part.label;
  root.appendChild(label);

  // Click handler — open referenced source
  root.addEventListener('click', () => {
    if (isPage) {
      const pageId = part.uri.replace('parallx-page://', '');
      // Navigate to the page via the workspace command
      // This uses the global command registry — the same pattern as other internal links
      const event = new CustomEvent('parallx:navigate-page', { detail: { pageId } });
      document.dispatchEvent(event);
    } else {
      // File paths — open in editor
      const event = new CustomEvent('parallx:open-file', { detail: { path: part.uri } });
      document.dispatchEvent(event);
    }
  });

  root.title = isPage
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

    const makeBtn = (label: string, cls: string, decision: import('../../services/chatTypes.js').ToolGrantDecision): void => {
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

function _replaceWithGrantResult(root: HTMLElement, decision: import('../../services/chatTypes.js').ToolGrantDecision): void {
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

import type { EditApplyEventDetail } from './chatTypes.js';

// EditApplyEventDetail — now defined in chatTypes.ts (M13 Phase 1)
export type { EditApplyEventDetail } from './chatTypes.js';

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


