// chatListRenderer.ts — Message list rendering (M9 Task 3.6)
//
// Renders request/response pairs into the message list container.
// Each pair becomes a user message + assistant message block.
// Uses chatContentParts.ts for typed content part rendering.
//
// M9.0 uses direct DOM rendering. The Tiptap read-only instance
// rendering (per M9 doc) replaces this in a follow-up once custom
// node types are defined.
//
// VS Code reference:
//   src/vs/workbench/contrib/chat/browser/chatListRenderer.ts

import { Disposable } from '../../../platform/lifecycle.js';
import { $ } from '../../../ui/dom.js';
import { renderContentPart, createAgentPresence } from './chatContentParts.js';
import type { ChatPartElement } from './chatContentParts.js';
import { chatIcons } from '../chatIcons.js';
import { getFileTypeIcon } from '../../../ui/iconRegistry.js';
import { isChatImageAttachment, isChatSelectionAttachment, isChatCanvasBlockAttachment } from '../../../services/chatTypes.js';
import type {
  IChatRequestResponsePair,
  IChatAssistantResponse,
  IChatUserMessage,
  IChatContentPart,
  IChatMarkdownContent,
  IChatThinkingContent,
  IChatToolInvocationContent,
} from '../../../services/chatTypes.js';
import { ChatContentPartKind } from '../../../services/chatTypes.js';
import type { OpenAttachmentHandler, RegenerateMessageHandler } from '../chatTypes.js';

// OpenAttachmentHandler — now defined in chatTypes.ts (M13 Phase 1)
export type { OpenAttachmentHandler } from '../chatTypes.js';

/**
 * Mark a settled turn's thinking part as done by freezing its endTime. The
 * "Thought for Xs" label and the live-vs-done toggle key off endTime; turns
 * that finished streaming (or were restored from a saved session that predates
 * the field) must have it set so they don't read as perpetually "Thinking…".
 */
function _settleThinkingPart(response: IChatAssistantResponse): void {
  for (const part of response.parts) {
    if (part.kind !== ChatContentPartKind.Thinking) { continue; }
    const thinking = part as { startTime?: number; endTime?: number; progressMessage?: unknown };
    thinking.progressMessage = undefined;
    if (thinking.endTime == null) {
      // No recorded finish — fall back to startTime so elapsed reads as 0
      // ("Thought") rather than inflating against the current clock.
      thinking.endTime = thinking.startTime ?? Date.now();
    }
  }
}

/**
 * Cheap fingerprint of a part's render-relevant state. The streaming update
 * path re-renders a part ONLY when this changes — rebuilding unchanged parts
 * on every stream tick replayed their entrance animations (tool nodes blinked
 * at token rate during think→tools→think turns) and reset DOM-local state
 * like an expanded tool output. Empty string = kind not fingerprinted, treat
 * as always-changed.
 */
function _partSignature(part: IChatContentPart): string {
  switch (part.kind) {
    case ChatContentPartKind.Thinking: {
      const p = part as IChatThinkingContent;
      return `t:${p.content?.length ?? 0}:${p.isCollapsed ? 1 : 0}:${p.endTime ?? ''}:${p.provenance?.length ?? 0}`;
    }
    case ChatContentPartKind.ToolInvocation: {
      const p = part as IChatToolInvocationContent;
      return `i:${p.status}:${p.isComplete ? 1 : 0}:${p.isError ? 1 : 0}:${p.result?.content?.length ?? 0}`;
    }
    case ChatContentPartKind.Markdown: {
      const p = part as IChatMarkdownContent;
      return `m:${p.content.length}:${p.citations?.length ?? 0}`;
    }
    default:
      return '';
  }
}

// ── User-message "safe markdown" subset ──────────────────────────────────────
//
// User turns render a deliberately tiny subset of markdown: fenced code blocks
// (```) and inline code (`…`). Headings, lists, emphasis, links, etc. are left
// literal — user prompts are full of identifiers (snake_case, file_name.ts,
// *globs*) that a full markdown pass would mangle. Line breaks are preserved by
// CSS (white-space: pre-wrap on the paragraph).

type UserSafeBlock =
  | { readonly type: 'text'; value: string }
  | { readonly type: 'code'; readonly lang: string; readonly value: string };

/** Split text into plain-text and fenced-code blocks (``` … ```). */
function parseUserSafeBlocks(text: string): UserSafeBlock[] {
  const blocks: UserSafeBlock[] = [];
  const fenceRe = /```([^\n`]*)\n?([\s\S]*?)```/g;
  let lastIndex = 0;
  let m: RegExpExecArray | null;
  while ((m = fenceRe.exec(text)) !== null) {
    if (m.index > lastIndex) {
      blocks.push({ type: 'text', value: text.slice(lastIndex, m.index) });
    }
    blocks.push({ type: 'code', lang: m[1].trim(), value: m[2].replace(/\n$/, '') });
    lastIndex = fenceRe.lastIndex;
  }
  if (lastIndex < text.length) {
    blocks.push({ type: 'text', value: text.slice(lastIndex) });
  }

  // Trim newlines where a text block butts against a code fence so the fence's
  // own spacing isn't doubled by a stray blank line.
  for (let i = 0; i < blocks.length; i++) {
    const b = blocks[i];
    if (b.type !== 'text') continue;
    if (i > 0 && blocks[i - 1].type === 'code') b.value = b.value.replace(/^\n+/, '');
    if (i < blocks.length - 1 && blocks[i + 1].type === 'code') b.value = b.value.replace(/\n+$/, '');
  }
  return blocks;
}

/** Append text with inline `code` spans (single backticks) into a parent. */
function appendInlineCode(text: string, parent: HTMLElement): void {
  const inlineRe = /`([^`\n]+)`/g;
  let lastIndex = 0;
  let m: RegExpExecArray | null;
  while ((m = inlineRe.exec(text)) !== null) {
    if (m.index > lastIndex) {
      parent.appendChild(document.createTextNode(text.slice(lastIndex, m.index)));
    }
    const code = document.createElement('code');
    code.className = 'parallx-chat-user-inline-code';
    code.textContent = m[1];
    parent.appendChild(code);
    lastIndex = inlineRe.lastIndex;
  }
  if (lastIndex < text.length) {
    parent.appendChild(document.createTextNode(text.slice(lastIndex)));
  }
}

/**
 * Render a user message body: an optional leading /command pill, then the
 * safe-markdown subset of `text`. Stacks text paragraphs and code blocks as
 * siblings (a <pre> can't live inside the <p>).
 */
function renderUserSafeMarkdown(text: string, body: HTMLElement, pill?: HTMLElement): void {
  const blocks = parseUserSafeBlocks(text);
  let pillPlaced = !pill;

  const placePill = (p: HTMLElement, withSpace: boolean): void => {
    if (pillPlaced) return;
    p.appendChild(pill!);
    if (withSpace) p.appendChild(document.createTextNode(' '));
    pillPlaced = true;
  };

  for (const block of blocks) {
    if (block.type === 'code') {
      if (!pillPlaced) {
        const lead = document.createElement('p');
        placePill(lead, false);
        body.appendChild(lead);
      }
      const pre = document.createElement('pre');
      pre.className = 'parallx-chat-user-code';
      const code = document.createElement('code');
      if (block.lang) code.dataset.lang = block.lang;
      code.textContent = block.value;
      pre.appendChild(code);
      body.appendChild(pre);
    } else {
      if (block.value === '' && pillPlaced) continue; // skip empty text runs
      const p = document.createElement('p');
      placePill(p, block.value !== '');
      appendInlineCode(block.value, p);
      body.appendChild(p);
    }
  }

  // Nothing produced (e.g. empty message, or command-only) — keep a paragraph
  // so the bubble still has body. A pending pill goes here.
  if (body.childElementCount === 0) {
    const p = document.createElement('p');
    placePill(p, false);
    body.appendChild(p);
  }
}

/**
 * Renders the conversation message list.
 *
 * M11 Task 3.10: Incremental rendering — only re-renders the last assistant
 * message during streaming instead of tearing down the entire DOM.
 * Shows a typing indicator (bouncing dots) before content arrives.
 */
export class ChatListRenderer extends Disposable {

  private _onOpenAttachment: OpenAttachmentHandler | undefined;
  private _onRegenerateMessage: RegenerateMessageHandler | undefined;

  /** Active context menu element (if any). */
  private _contextMenu: HTMLElement | undefined;
  private _contextMenuCleanup: (() => void) | undefined;

  /**
   * Track the last rendered state so we can do incremental updates.
   * Key: pair index → { userEl, assistantEl, partCount }
   */
  private _renderedPairs: Map<number, { userEl: HTMLElement; assistantEl: HTMLElement; partCount: number }> = new Map();

  /** Set callback for when user clicks an attachment chip in a message. */
  setOpenAttachmentHandler(handler: OpenAttachmentHandler): void {
    this._onOpenAttachment = handler;
  }

  setRegenerateHandler(handler: RegenerateMessageHandler): void {
    this._onRegenerateMessage = handler;
  }

  /** Set callback for cancelling the in-progress request (Task 4.9). */
  setCancelHandler(_handler: () => void): void {
    // Cancel is now handled by the input part's stop button; kept for API compat.
  }

  /** Attach right-click context menu to the message list container. */
  attachContextMenu(container: HTMLElement): void {
    this._register({ dispose: () => this._dismissContextMenu() });

    container.addEventListener('contextmenu', (e) => {
      // Find the closest message body
      const target = e.target as HTMLElement;
      const messageBody = target.closest('.parallx-chat-message-body') as HTMLElement | null;
      if (!messageBody) { return; }

      e.preventDefault();
      this._dismissContextMenu();

      const selection = window.getSelection();
      const selectedText = selection?.toString() ?? '';

      const menu = $('div.parallx-chat-copy-menu');

      // Copy — enabled only when text is selected
      const copyItem = this._createMenuItem('Copy', chatIcons.copy, !!selectedText, () => {
        if (selectedText) {
          navigator.clipboard.writeText(selectedText);
        }
      });
      menu.appendChild(copyItem);

      // Copy All — copies the entire message block
      const copyAllItem = this._createMenuItem('Copy All', chatIcons.copy, true, () => {
        navigator.clipboard.writeText(messageBody.innerText);
      });
      menu.appendChild(copyAllItem);

      // Position near the click
      menu.style.left = `${e.clientX}px`;
      menu.style.top = `${e.clientY}px`;
      document.body.appendChild(menu);
      this._contextMenu = menu;

      // Adjust if overflowing viewport
      requestAnimationFrame(() => {
        const rect = menu.getBoundingClientRect();
        if (rect.right > window.innerWidth) {
          menu.style.left = `${window.innerWidth - rect.width - 4}px`;
        }
        if (rect.bottom > window.innerHeight) {
          menu.style.top = `${window.innerHeight - rect.height - 4}px`;
        }
      });

      // Dismiss on click outside or Escape
      const dismiss = () => this._dismissContextMenu();
      const onMouseDown = (ev: MouseEvent) => {
        if (!menu.contains(ev.target as Node)) { dismiss(); }
      };
      const onKeyDown = (ev: KeyboardEvent) => {
        if (ev.key === 'Escape') { dismiss(); }
      };
      // Use setTimeout so the current click doesn't immediately dismiss
      setTimeout(() => {
        document.addEventListener('mousedown', onMouseDown, { once: true });
        document.addEventListener('keydown', onKeyDown, { once: true });
        this._contextMenuCleanup = () => {
          document.removeEventListener('mousedown', onMouseDown);
          document.removeEventListener('keydown', onKeyDown);
        };
      }, 0);
    });
  }

  /** Create a single menu item. */
  private _createMenuItem(label: string, icon: string, enabled: boolean, action: () => void): HTMLElement {
    const item = $('div.parallx-chat-copy-menu-item');
    if (!enabled) {
      item.classList.add('parallx-chat-copy-menu-item--disabled');
    }

    const iconEl = document.createElement('span');
    iconEl.className = 'parallx-chat-copy-menu-item-icon';
    iconEl.innerHTML = icon;
    item.appendChild(iconEl);

    const labelEl = document.createElement('span');
    labelEl.textContent = label;
    item.appendChild(labelEl);

    if (enabled) {
      item.addEventListener('click', () => {
        action();
        this._dismissContextMenu();
      });
    }

    return item;
  }

  /** Remove the context menu from DOM. */
  private _dismissContextMenu(): void {
    this._contextMenuCleanup?.();
    this._contextMenuCleanup = undefined;
    if (this._contextMenu) {
      this._contextMenu.remove();
      this._contextMenu = undefined;
    }
  }

  /**
   * Render all messages into the container.
   * During streaming, incrementally updates only the last assistant message
   * instead of full tear-down + rebuild.
   */
  renderMessages(
    container: HTMLElement,
    messages: readonly IChatRequestResponsePair[],
    requestInProgress: boolean,
  ): void {
    // Check if we can do an incremental update
    if (this._canIncrementalUpdate(container, messages)) {
      this._incrementalUpdate(container, messages, requestInProgress);
      return;
    }

    // Full re-render (on session switch, new messages, etc.)
    this._fullRender(container, messages, requestInProgress);
  }

  /** Check if incremental update is possible. */
  private _canIncrementalUpdate(
    container: HTMLElement,
    messages: readonly IChatRequestResponsePair[],
  ): boolean {
    // Must have rendered something before
    if (this._renderedPairs.size === 0) { return false; }
    // Same number of pairs (only the last one changed due to streaming)
    if (this._renderedPairs.size !== messages.length) { return false; }
    // Container still has our elements
    const lastPair = this._renderedPairs.get(messages.length - 1);
    if (!lastPair || !container.contains(lastPair.assistantEl)) { return false; }
    return true;
  }

  /** Incremental update — only re-render the last assistant message body. */
  private _incrementalUpdate(
    _container: HTMLElement,
    messages: readonly IChatRequestResponsePair[],
    requestInProgress: boolean,
  ): void {
    const lastIdx = messages.length - 1;
    const lastPair = this._renderedPairs.get(lastIdx);
    if (!lastPair) { return; }

    const response = messages[lastIdx].response;
    const latestRequest = messages[lastIdx].request;
    const body = lastPair.assistantEl.querySelector('.parallx-chat-message-body') as HTMLElement;
    if (!body) { return; }

    const existingActions = lastPair.assistantEl.querySelector('.parallx-chat-message-actions');
    const renderedRequestId = lastPair.assistantEl.dataset.requestId;
    if (existingActions && (requestInProgress || renderedRequestId !== latestRequest.requestId)) {
      existingActions.remove();
    }

    // Remove typing indicator if present
    const typingEl = body.querySelector('.parallx-chat-typing-indicator');
    if (typingEl && response.parts.length > 0) {
      typingEl.remove();
    }

    // Only re-render parts that are new or changed
    const existingParts = body.querySelectorAll(':scope > :not(.parallx-chat-streaming-cursor):not(.parallx-chat-typing-indicator):not(.parallx-chat-message-actions)');
    const newPartCount = response.parts.length;

    // If parts count is the same, update changed parts
    if (existingParts.length === newPartCount && newPartCount > 0) {
      // Refresh every part that can mutate in place mid-stream:
      //   • Thinking — bursts stream incrementally, AND parts are chronological
      //     (a turn can hold several thinking bursts anywhere in the sequence);
      //   • ToolInvocation — status/result changes;
      //   • the LAST part — streaming appends into the trailing markdown.
      // _refreshPart touches the DOM only when the part actually changed.
      const refreshed = new Set<number>();
      for (let i = 0; i < newPartCount; i++) {
        const kind = response.parts[i].kind;
        if (kind === ChatContentPartKind.Thinking || kind === ChatContentPartKind.ToolInvocation) {
          this._refreshPart(existingParts[i] as HTMLElement, response.parts[i]);
          refreshed.add(i);
        }
      }
      const lastIdx2 = newPartCount - 1;
      if (!refreshed.has(lastIdx2)) {
        this._refreshPart(existingParts[lastIdx2] as HTMLElement, response.parts[lastIdx2]);
      }
    } else if (newPartCount > existingParts.length) {
      // New parts added — append them
      for (let i = existingParts.length; i < newPartCount; i++) {
        const partEl = renderContentPart(response.parts[i]);
        partEl.dataset.parallxPartSig = _partSignature(response.parts[i]);
        // Insert before cursor/actions
        const cursor = body.querySelector('.parallx-chat-streaming-cursor');
        if (cursor) {
          body.insertBefore(partEl, cursor);
        } else {
          body.appendChild(partEl);
        }
      }
    } else if (newPartCount < existingParts.length) {
      // Parts were removed (e.g. progress/tool parts stripped on completion).
      // Removed parts can be anywhere in the array, not just the end, so we
      // must re-render the entire body to stay in sync with the data model.
      const cursor = body.querySelector('.parallx-chat-streaming-cursor');
      existingParts.forEach((el) => el.remove());
      for (let i = 0; i < newPartCount; i++) {
        const partEl = renderContentPart(response.parts[i]);
        if (cursor) {
          body.insertBefore(partEl, cursor);
        } else {
          body.appendChild(partEl);
        }
      }
    }

    // Update streaming cursor — the "pen tip" only shows while text is actually
    // streaming, never during the thinking phase (the presence is the signal,
    // otherwise you get a double dot).
    const existingCursor = body.querySelector('.parallx-chat-streaming-cursor');
    const hasTyping = !!body.querySelector('.parallx-chat-typing-indicator');
    if (requestInProgress) {
      if (hasTyping) {
        if (existingCursor) existingCursor.remove();
      } else if (!existingCursor) {
        body.appendChild($('span.parallx-chat-streaming-cursor'));
      }
    } else if (existingCursor) {
      existingCursor.remove();
      // Turn finished — calm the identity core.
      lastPair.assistantEl.querySelector('.parallx-chat-turn-header')?.classList.remove('parallx-chat-turn-header--active');

      // Streaming → complete transition: force a full body re-render so ALL
      // parts reflect their final state (citations, stripped transients, etc.).
      // Without this, the equal-count optimisation above may skip middle parts
      // that now carry citations set by setCitations() after streaming ended.
      const finalParts = body.querySelectorAll(':scope > :not(.parallx-chat-message-actions)');
      finalParts.forEach((el) => el.remove());
      for (let k = 0; k < response.parts.length; k++) {
        body.appendChild(renderContentPart(response.parts[k]));
      }

      // Add message actions bar now that streaming is complete
      this._addMessageActions(lastPair.assistantEl, body, latestRequest, true);
    }

    if (!requestInProgress && response.isComplete && !lastPair.assistantEl.querySelector('.parallx-chat-message-actions')) {
      this._addMessageActions(lastPair.assistantEl, body, latestRequest, true);
    }

    lastPair.assistantEl.dataset.requestId = latestRequest.requestId;
    lastPair.partCount = newPartCount;
  }

  /**
   * Bring a rendered part element up to date, touching the DOM as little as
   * possible. Three tiers:
   *   1. signature unchanged → leave the element alone entirely;
   *   2. the element carries an in-place updater (streaming thinking) → mutate;
   *   3. otherwise → replace with a fresh render (rare: real state transitions,
   *      which are exactly the moments entrance animations SHOULD play).
   */
  private _refreshPart(el: HTMLElement, part: IChatContentPart): void {
    const sig = _partSignature(part);
    if (sig && el.dataset.parallxPartSig === sig) { return; }
    const updater = (el as ChatPartElement).__parallxUpdatePart;
    if (updater && updater(part)) {
      el.dataset.parallxPartSig = sig;
      return;
    }
    const fresh = renderContentPart(part);
    fresh.dataset.parallxPartSig = sig;
    el.replaceWith(fresh);
  }

  /** Full re-render — tear down and rebuild all messages. */
  private _fullRender(
    container: HTMLElement,
    messages: readonly IChatRequestResponsePair[],
    requestInProgress: boolean,
  ): void {
    // Remove only rendered message elements (preserve state overlays)
    const existingMessages = container.querySelectorAll('.parallx-chat-message');
    existingMessages.forEach((el) => el.remove());
    this._renderedPairs.clear();

    for (let i = 0; i < messages.length; i++) {
      const pair = messages[i];
      const isLast = i === messages.length - 1;
      const isStreamingTurn = requestInProgress && isLast;

      // Backfill endTime on any thinking part that belongs to a settled turn
      // (restored sessions, or any turn that isn't the one actively streaming).
      // Old saved sessions predate the endTime field; without this they'd read
      // as "still thinking" and pulse forever.
      if (!isStreamingTurn) {
        _settleThinkingPart(pair.response);
      }

      // User message
      const userEl = this._renderUserMessage(pair.request);
      container.appendChild(userEl);

      // Assistant response
      const assistantEl = this._renderAssistantMessage(
        pair.request,
        pair.response,
        requestInProgress && i === messages.length - 1,
        i === messages.length - 1,
      );
      container.appendChild(assistantEl);

      this._renderedPairs.set(i, {
        userEl,
        assistantEl,
        partCount: pair.response.parts.length,
      });
      assistantEl.dataset.requestId = pair.request.requestId;
    }

    // Show streaming cursor on the last assistant message if in progress
    if (requestInProgress && messages.length > 0) {
      const lastAssistant = container.querySelector('.parallx-chat-message:last-child .parallx-chat-message-body');
      if (lastAssistant) {
        // If no content yet and no typing indicator already present, show one
        const lastResponse = messages[messages.length - 1].response;
        if (lastResponse.parts.length === 0 && !lastAssistant.querySelector('.parallx-chat-typing-indicator')) {
          const typing = this._createTypingIndicator();
          lastAssistant.appendChild(typing);
        }
        // Pen-tip cursor only while text streams — not during the thinking phase.
        if (lastResponse.parts.length > 0) {
          lastAssistant.appendChild($('span.parallx-chat-streaming-cursor'));
        }
      }
    }
  }

  // ── User Message ──

  private _renderUserMessage(request: IChatUserMessage): HTMLElement {
    const root = $('div.parallx-chat-message.parallx-chat-message--user');

    const body = $('div.parallx-chat-message-body');

    // Detect leading /command and render as a pill badge (VS Code style).
    let text = request.text;
    let pill: HTMLElement | undefined;
    const cmdMatch = text.match(/^(\/[a-zA-Z_]\w*)\s*([\s\S]*)$/);
    if (cmdMatch) {
      pill = document.createElement('span');
      pill.className = 'parallx-chat-command-pill';
      pill.textContent = cmdMatch[1];
      text = cmdMatch[2];
    }

    // Render a SAFE markdown subset — fenced code blocks + inline code only.
    // Everything else stays literal so prose and identifiers (snake_case,
    // file_name.ts) are never accidentally formatted.
    renderUserSafeMarkdown(text, body, pill);

    root.appendChild(body);

    // Explicit attachments are rendered below the user prompt box, aligned to its right edge.
    if (request.attachments?.length) {
      const ribbon = $('div.parallx-chat-message-attachments');
      for (const attachment of request.attachments) {
        const chip = $('div.parallx-chat-message-attachment-chip');
        chip.title = attachment.fullPath;

        if (isChatSelectionAttachment(attachment)) {
          // M48: Selection attachments show excerpt + source
          chip.classList.add('parallx-chat-message-attachment-chip--selection');

          const icon = document.createElement('span');
          icon.className = 'parallx-chat-message-attachment-icon';
          icon.innerHTML = chatIcons.selection;
          chip.appendChild(icon);

          // Truncated excerpt
          const excerpt = document.createElement('span');
          excerpt.className = 'parallx-chat-message-attachment-excerpt';
          const rawText = attachment.selectedText.replace(/\n/g, ' ').trim();
          excerpt.textContent = rawText.length > 60 ? rawText.slice(0, 57) + '\u2026' : rawText;
          chip.appendChild(excerpt);

          // Source label (filename + location)
          const source = document.createElement('span');
          source.className = 'parallx-chat-message-attachment-source';
          const loc = attachment.startLine && attachment.endLine
            ? ` L${attachment.startLine}\u2013${attachment.endLine}`
            : attachment.pageNumber ? ` p${attachment.pageNumber}` : '';
          source.textContent = `\u2014 ${attachment.name}${loc}`;
          chip.appendChild(source);

          // Full text in tooltip
          chip.title = attachment.selectedText;

          chip.addEventListener('click', () => {
            this._onOpenAttachment?.(attachment.fullPath);
          });
        } else if (isChatCanvasBlockAttachment(attachment)) {
          // Live canvas-block reference — show the block label + page.
          chip.classList.add('parallx-chat-message-attachment-chip--selection');

          const icon = document.createElement('span');
          icon.className = 'parallx-chat-message-attachment-icon';
          icon.innerHTML = chatIcons.selection;
          chip.appendChild(icon);

          const excerpt = document.createElement('span');
          excerpt.className = 'parallx-chat-message-attachment-excerpt';
          excerpt.textContent = attachment.name;
          chip.appendChild(excerpt);

          const source = document.createElement('span');
          source.className = 'parallx-chat-message-attachment-source';
          source.textContent = attachment.pageTitle ? `— ${attachment.pageTitle}` : '— canvas block';
          chip.appendChild(source);

          chip.title = `Live reference to a ${attachment.blockType ?? 'block'}${attachment.pageTitle ? ` on "${attachment.pageTitle}"` : ''} — the AI reads its current content and can edit it.`;
        } else if (isChatImageAttachment(attachment)) {
          chip.classList.add('parallx-chat-message-attachment-chip--image');

          const icon = document.createElement('span');
          icon.className = 'parallx-chat-message-attachment-icon';
          const preview = document.createElement('span');
          preview.className = 'parallx-chat-message-attachment-preview';
          preview.style.backgroundImage = `url(data:${attachment.mimeType};base64,${attachment.data})`;
          icon.appendChild(preview);

          const glyph = document.createElement('span');
          glyph.className = 'parallx-chat-message-attachment-glyph';
          glyph.innerHTML = chatIcons.image;
          icon.appendChild(glyph);
          chip.appendChild(icon);

          const label = document.createElement('span');
          label.textContent = attachment.name;
          chip.appendChild(label);
        } else {
          // File attachment — use extension-aware colored icon (matches input area)
          const icon = document.createElement('span');
          icon.className = 'parallx-chat-message-attachment-icon';
          const extMatch = attachment.name.match(/\.([a-zA-Z0-9]+)$/);
          icon.innerHTML = getFileTypeIcon(extMatch ? extMatch[1] : '');
          chip.appendChild(icon);

          const label = document.createElement('span');
          label.textContent = attachment.name;
          chip.appendChild(label);

          chip.addEventListener('click', () => {
            this._onOpenAttachment?.(attachment.fullPath);
          });
        }

        ribbon.appendChild(chip);
      }
      root.appendChild(ribbon);
    }

    return root;
  }

  // ── Assistant Message ──

  private _renderAssistantMessage(
    request: IChatUserMessage,
    response: IChatAssistantResponse,
    isStreaming: boolean = false,
    isLatest: boolean = false,
  ): HTMLElement {
    const root = $('div.parallx-chat-message.parallx-chat-message--assistant');
    const parts = response.parts;

    // Persistent agent identity — a "● Parallx" header whose core breathes while
    // the turn is active and settles when done. Gives the assistant a presence
    // (the user turn is a bubble; the assistant was just bare text).
    const header = $('div.parallx-chat-turn-header');
    if (isStreaming && !response.isComplete) header.classList.add('parallx-chat-turn-header--active');
    header.appendChild($('span.parallx-chat-turn-core'));
    header.appendChild($('span.parallx-chat-turn-name', 'Parallx'));
    root.appendChild(header);

    // Body — render each content part
    const body = $('div.parallx-chat-message-body');

    if (parts.length === 0 && isStreaming) {
      // No content yet — show typing indicator
      body.appendChild(this._createTypingIndicator());
    } else {
      for (const part of parts) {
        const partEl = renderContentPart(part);
        // Stamp the streaming-diff signature so the first incremental tick
        // after a full render doesn't needlessly rebuild unchanged parts.
        partEl.dataset.parallxPartSig = _partSignature(part);
        body.appendChild(partEl);
      }
    }

    root.appendChild(body);

    // Message actions bar (copy) — only shown on completed responses
    if (parts.length > 0 && response.isComplete) {
      this._addMessageActions(root, body, request, isLatest);
    }

    root.dataset.requestId = request.requestId;

    return root;
  }

  /** Add copy button actions bar to an assistant message. */
  private _addMessageActions(root: HTMLElement, body: HTMLElement, request: IChatUserMessage, canRegenerate: boolean): void {
    // Don't duplicate
    if (root.querySelector('.parallx-chat-message-actions')) { return; }

    const actions = $('div.parallx-chat-message-actions');

    if (canRegenerate) {
      const regenerateBtn = document.createElement('button');
      regenerateBtn.className = 'parallx-chat-action-btn';
      regenerateBtn.type = 'button';
      regenerateBtn.title = 'Regenerate response';
      regenerateBtn.setAttribute('aria-label', 'Regenerate response');
      regenerateBtn.innerHTML = chatIcons.refresh;
      regenerateBtn.addEventListener('click', () => {
        this._onRegenerateMessage?.(request);
      });
      actions.appendChild(regenerateBtn);
    }

    const copyBtn = document.createElement('button');
    copyBtn.className = 'parallx-chat-action-btn';
    copyBtn.type = 'button';
    copyBtn.title = 'Copy response';
    copyBtn.setAttribute('aria-label', 'Copy response');
    copyBtn.innerHTML = chatIcons.copy;
    copyBtn.addEventListener('click', () => {
      const text = body.innerText;
      navigator.clipboard.writeText(text).then(() => {
        copyBtn.innerHTML = chatIcons.check;
        setTimeout(() => { copyBtn.innerHTML = chatIcons.copy; }, 1500);
      });
    });
    actions.appendChild(copyBtn);

    root.appendChild(actions);
  }

  /** Create the "working" indicator — a breathing agent presence (Living System). */
  private _createTypingIndicator(): HTMLElement {
    return createAgentPresence('Thinking');
  }

  override dispose(): void {
    super.dispose();
  }
}
