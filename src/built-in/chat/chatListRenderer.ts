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

import { Disposable } from '../../platform/lifecycle.js';
import { $ } from '../../ui/dom.js';
import { renderContentPart, renderFollowups } from './chatContentParts.js';
import { chatIcons } from './chatIcons.js';
import type { IChatRequestResponsePair, IChatAssistantResponse } from '../../services/chatTypes.js';

/**
 * Renders the conversation message list.
 *
 * Currently does full re-render on each update. This is acceptable for M9.0
 * because message lists are short. The Tiptap read-only instance approach
 * (per M9 doc design decisions) will provide incremental rendering for
 * production use.
 */
export class ChatListRenderer extends Disposable {

  /**
   * Render all messages into the container.
   * Preserves the empty-state and offline-state elements that may
   * also be children of the container.
   */
  renderMessages(
    container: HTMLElement,
    messages: readonly IChatRequestResponsePair[],
    requestInProgress: boolean,
  ): void {
    // Remove only rendered message elements (preserve state overlays)
    const existingMessages = container.querySelectorAll('.parallx-chat-message');
    existingMessages.forEach((el) => el.remove());

    for (let i = 0; i < messages.length; i++) {
      const pair = messages[i];

      // User message
      const userEl = this._renderUserMessage(pair.request.text);
      container.appendChild(userEl);

      // Assistant response
      const assistantEl = this._renderAssistantMessage(pair.response);
      container.appendChild(assistantEl);
    }

    // Show streaming cursor on the last assistant message if in progress
    if (requestInProgress && messages.length > 0) {
      const lastAssistant = container.querySelector('.parallx-chat-message:last-child .parallx-chat-message-body');
      if (lastAssistant) {
        const cursor = $('span.parallx-chat-streaming-cursor');
        lastAssistant.appendChild(cursor);
      }
    }
  }

  // ── User Message ──

  private _renderUserMessage(text: string): HTMLElement {
    const root = $('div.parallx-chat-message.parallx-chat-message--user');

    // VS Code Copilot style: user messages are blue bubbles, right-aligned, no avatar
    const body = $('div.parallx-chat-message-body');
    const p = $('p');
    p.textContent = text;
    body.appendChild(p);
    root.appendChild(body);

    return root;
  }

  // ── Assistant Message ──

  private _renderAssistantMessage(
    response: IChatAssistantResponse,
  ): HTMLElement {
    const root = $('div.parallx-chat-message.parallx-chat-message--assistant');
    const parts = response.parts;

    // Body — render each content part
    const body = $('div.parallx-chat-message-body');

    if (parts.length === 0) {
      // Empty response (still streaming or error)
      // Will show streaming cursor via the requestInProgress logic above
    } else {
      for (const part of parts) {
        const partEl = renderContentPart(part);
        body.appendChild(partEl);
      }
    }

    root.appendChild(body);

    // Follow-up suggestion chips (shown after complete responses)
    if (response.isComplete && response.followups && response.followups.length > 0) {
      const followupsEl = renderFollowups(response.followups);
      root.appendChild(followupsEl);
    }

    // Message actions bar (copy) — only shown on hover
    if (parts.length > 0) {
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

    return root;
  }
}
