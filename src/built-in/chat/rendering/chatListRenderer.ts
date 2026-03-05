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
import { renderContentPart } from './chatContentParts.js';
import { chatIcons } from '../chatIcons.js';
import type { IChatRequestResponsePair, IChatAssistantResponse, IChatUserMessage } from '../../../services/chatTypes.js';
import { ChatContentPartKind } from '../../../services/chatTypes.js';
import type { OpenAttachmentHandler } from '../chatTypes.js';

// OpenAttachmentHandler — now defined in chatTypes.ts (M13 Phase 1)
export type { OpenAttachmentHandler } from '../chatTypes.js';

/**
 * Renders the conversation message list.
 *
 * M11 Task 3.10: Incremental rendering — only re-renders the last assistant
 * message during streaming instead of tearing down the entire DOM.
 * Shows a typing indicator (bouncing dots) before content arrives.
 */
export class ChatListRenderer extends Disposable {

  private _onOpenAttachment: OpenAttachmentHandler | undefined;

  /**
   * Track the last rendered state so we can do incremental updates.
   * Key: pair index → { userEl, assistantEl, partCount }
   */
  private _renderedPairs: Map<number, { userEl: HTMLElement; assistantEl: HTMLElement; partCount: number }> = new Map();

  /** Set callback for when user clicks an attachment chip in a message. */
  setOpenAttachmentHandler(handler: OpenAttachmentHandler): void {
    this._onOpenAttachment = handler;
  }

  /** Set callback for cancelling the in-progress request (Task 4.9). */
  setCancelHandler(_handler: () => void): void {
    // Cancel is now handled by the input part's stop button; kept for API compat.
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
    const body = lastPair.assistantEl.querySelector('.parallx-chat-message-body') as HTMLElement;
    if (!body) { return; }

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
      // Always re-render the thinking part (index 0) if it exists — thinking
      // content streams incrementally and may have grown since last render.
      if (response.parts[0]?.kind === ChatContentPartKind.Thinking && existingParts.length > 0) {
        const thinkingEl = existingParts[0] as HTMLElement;
        const newThinkingEl = renderContentPart(response.parts[0]);
        thinkingEl.replaceWith(newThinkingEl);
      }

      // Re-render the last part (streaming appends to last markdown part)
      const lastIdx2 = existingParts.length - 1;
      if (lastIdx2 > 0 || response.parts[0]?.kind !== ChatContentPartKind.Thinking) {
        const lastPartEl = existingParts[lastIdx2] as HTMLElement;
        const newPartEl = renderContentPart(response.parts[newPartCount - 1]);
        lastPartEl.replaceWith(newPartEl);
      }
    } else if (newPartCount > existingParts.length) {
      // New parts added — append them
      for (let i = existingParts.length; i < newPartCount; i++) {
        const partEl = renderContentPart(response.parts[i]);
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

    // Update streaming cursor
    const existingCursor = body.querySelector('.parallx-chat-streaming-cursor');
    if (requestInProgress) {
      if (!existingCursor) {
        const cursor = $('span.parallx-chat-streaming-cursor');
        body.appendChild(cursor);
      }
    } else if (existingCursor) {
      existingCursor.remove();

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
      this._addMessageActions(lastPair.assistantEl, body);
    }

    lastPair.partCount = newPartCount;
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

      // User message
      const userEl = this._renderUserMessage(pair.request);
      container.appendChild(userEl);

      // Assistant response
      const assistantEl = this._renderAssistantMessage(pair.response, requestInProgress && i === messages.length - 1);
      container.appendChild(assistantEl);

      this._renderedPairs.set(i, {
        userEl,
        assistantEl,
        partCount: pair.response.parts.length,
      });
    }

    // Show streaming cursor on the last assistant message if in progress
    if (requestInProgress && messages.length > 0) {
      const lastAssistant = container.querySelector('.parallx-chat-message:last-child .parallx-chat-message-body');
      if (lastAssistant) {
        // If no content yet, show typing indicator
        const lastResponse = messages[messages.length - 1].response;
        if (lastResponse.parts.length === 0) {
          const typing = this._createTypingIndicator();
          lastAssistant.appendChild(typing);
        }
        const cursor = $('span.parallx-chat-streaming-cursor');
        lastAssistant.appendChild(cursor);
      }
    }
  }

  // ── User Message ──

  private _renderUserMessage(request: IChatUserMessage): HTMLElement {
    const root = $('div.parallx-chat-message.parallx-chat-message--user');

    // VS Code Copilot style: user messages are blue bubbles, right-aligned, no avatar
    const body = $('div.parallx-chat-message-body');
    const p = $('p');
    p.textContent = request.text;
    body.appendChild(p);
    root.appendChild(body);

    // Attachment chips shown below the message bubble (VS Code style)
    if (request.attachments?.length) {
      const ribbon = $('div.parallx-chat-message-attachments');
      for (const attachment of request.attachments) {
        const chip = $('div.parallx-chat-message-attachment-chip');
        chip.title = attachment.fullPath;

        // File icon
        const icon = document.createElement('span');
        icon.className = 'parallx-chat-message-attachment-icon';
        icon.innerHTML = chatIcons.file;
        chip.appendChild(icon);

        // File name
        const label = document.createElement('span');
        label.textContent = attachment.name;
        chip.appendChild(label);

        // Click to open in editor
        chip.addEventListener('click', () => {
          this._onOpenAttachment?.(attachment.fullPath);
        });

        ribbon.appendChild(chip);
      }
      root.appendChild(ribbon);
    }

    return root;
  }

  // ── Assistant Message ──

  private _renderAssistantMessage(
    response: IChatAssistantResponse,
    isStreaming: boolean = false,
  ): HTMLElement {
    const root = $('div.parallx-chat-message.parallx-chat-message--assistant');
    const parts = response.parts;

    // Body — render each content part
    const body = $('div.parallx-chat-message-body');

    if (parts.length === 0 && isStreaming) {
      // No content yet — show typing indicator
      body.appendChild(this._createTypingIndicator());
    } else {
      for (const part of parts) {
        const partEl = renderContentPart(part);
        body.appendChild(partEl);
      }
    }

    root.appendChild(body);

    // Message actions bar (copy) — only shown on completed responses
    if (parts.length > 0 && response.isComplete) {
      this._addMessageActions(root, body);
    }

    return root;
  }

  /** Add copy button actions bar to an assistant message. */
  private _addMessageActions(root: HTMLElement, body: HTMLElement): void {
    // Don't duplicate
    if (root.querySelector('.parallx-chat-message-actions')) { return; }

    const actions = $('div.parallx-chat-message-actions');

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

  /** Create the typing indicator (bouncing dots). */
  private _createTypingIndicator(): HTMLElement {
    const indicator = $('div.parallx-chat-typing-indicator');
    for (let i = 0; i < 3; i++) {
      const dot = $('span.parallx-chat-typing-dot');
      indicator.appendChild(dot);
    }
    return indicator;
  }

  override dispose(): void {
    super.dispose();
  }
}
