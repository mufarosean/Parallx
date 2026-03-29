// inlineAIChat.ts — Floating AI mini-chat for canvas editor (M48 Phase 5)
//
// Replaces the preset-action InlineAIMenuController with a free-form
// multi-turn chat triggered from a ✨ button in the bubble menu.
//
// Uses the same ICanvasMenu contract and CanvasMenuRegistry lifecycle as
// all other canvas menus.  The AI request goes through the sendChatRequest
// function provided at construction time (delegated from the chat tool's
// OllamaProvider + ILanguageModelsService).

import type { Editor } from '@tiptap/core';
import { $, layoutPopup } from '../../../ui/dom.js';
import type { ICanvasMenu } from './canvasMenuRegistry.js';
import type { CanvasMenuRegistry } from './canvasMenuRegistry.js';
import type { IDisposable } from '../../../platform/lifecycle.js';
import type { IChatMessage, IChatResponseChunk } from '../../../services/chatTypes.js';

// ── Types ────────────────────────────────────────────────────────────────────

export interface InlineAIChatHost {
  readonly editor: Editor | null;
  readonly container: HTMLElement;
  readonly editorContainer: HTMLElement | null;
}

/** Function that streams an AI response for given messages. */
export type SendChatRequestFn = (
  messages: readonly IChatMessage[],
  options?: { temperature?: number; maxTokens?: number },
  signal?: AbortSignal,
) => AsyncIterable<IChatResponseChunk>;

/** Optional RAG retrieval for grounded responses. */
export type RetrieveContextFn = (query: string) => Promise<string | undefined>;

// ── Controller ───────────────────────────────────────────────────────────────

export class InlineAIChatController implements ICanvasMenu {
  readonly id = 'inline-ai-chat';

  private _chat: HTMLElement | null = null;
  private _messagesContainer: HTMLElement | null = null;
  private _inputField: HTMLTextAreaElement | null = null;
  private _sendBtn: HTMLElement | null = null;
  private _registration: IDisposable | null = null;
  private _abortController: AbortController | null = null;

  /** Multi-turn conversation history for the current selection. */
  private _messages: IChatMessage[] = [];

  /** The selected text when the chat was opened. */
  private _selectionText = '';
  private _selectionFrom = 0;
  private _selectionTo = 0;

  /** Last AI response text (for Replace / Send to Chat actions). */
  private _lastAssistantText = '';

  /** Whether the AI is currently streaming a response. */
  private _streaming = false;

  constructor(
    private readonly _host: InlineAIChatHost,
    private readonly _registry: CanvasMenuRegistry,
    private readonly _sendChatRequest: SendChatRequestFn,
    private readonly _retrieveContext?: RetrieveContextFn,
  ) {}

  get visible(): boolean {
    return !!this._chat && this._chat.style.display !== 'none';
  }

  containsTarget(target: Node): boolean {
    return this._chat?.contains(target) ?? false;
  }

  // ── DOM Construction ───────────────────────────────────────────────────

  /** Build the floating AI chat DOM and register with the menu registry. */
  create(): void {
    this._chat = $('div.canvas-ai-chat');
    this._chat.style.display = 'none';

    // Header
    const header = $('div.canvas-ai-chat-header');
    const headerTitle = $('span.canvas-ai-chat-title');
    headerTitle.textContent = '✨ AI';
    header.appendChild(headerTitle);
    const closeBtn = $('button.canvas-ai-chat-close');
    closeBtn.textContent = '✕';
    closeBtn.title = 'Close';
    closeBtn.addEventListener('mousedown', (ev) => {
      ev.preventDefault();
      this.hide();
    });
    header.appendChild(closeBtn);
    this._chat.appendChild(header);

    // Scrollable messages area
    this._messagesContainer = $('div.canvas-ai-chat-messages');
    this._chat.appendChild(this._messagesContainer);

    // Input row
    const inputRow = $('div.canvas-ai-chat-input-row');
    this._inputField = document.createElement('textarea');
    this._inputField.className = 'canvas-ai-chat-input';
    this._inputField.placeholder = 'Ask AI anything about the selection…';
    this._inputField.rows = 1;

    // Auto-resize textarea and handle Enter
    this._inputField.addEventListener('input', () => {
      if (!this._inputField) return;
      this._inputField.style.height = 'auto';
      this._inputField.style.height = Math.min(this._inputField.scrollHeight, 80) + 'px';
    });
    this._inputField.addEventListener('keydown', (ev) => {
      if (ev.key === 'Enter' && !ev.shiftKey) {
        ev.preventDefault();
        this._onSend();
      }
      if (ev.key === 'Escape') {
        ev.preventDefault();
        this.hide();
      }
    });
    // Prevent editor blur when interacting with the chat
    this._inputField.addEventListener('mousedown', (ev) => ev.stopPropagation());

    this._sendBtn = $('button.canvas-ai-chat-send');
    this._sendBtn.textContent = '→';
    this._sendBtn.title = 'Send';
    this._sendBtn.addEventListener('mousedown', (ev) => {
      ev.preventDefault();
      this._onSend();
    });

    inputRow.appendChild(this._inputField);
    inputRow.appendChild(this._sendBtn);
    this._chat.appendChild(inputRow);

    document.body.appendChild(this._chat);
    this._registration = this._registry.register(this);
  }

  // ── Public API (called by bubble menu ✨ button) ──────────────────────

  /** Toggle the AI chat open/closed. Captures selection on open. */
  toggle(): void {
    if (this.visible) {
      this.hide();
      return;
    }
    this._open();
  }

  // ── Show / Hide ────────────────────────────────────────────────────────

  private _open(): void {
    if (!this._chat) return;

    const editor = this._host.editor;
    if (!editor) return;

    const { from, to, empty } = editor.state.selection;
    if (empty || from === to) return;

    // Capture selection state
    this._selectionText = editor.state.doc.textBetween(from, to);
    this._selectionFrom = from;
    this._selectionTo = to;

    if (!this._selectionText.trim()) return;

    // Reset conversation for new selection context
    this._resetConversation();

    // Position below the selection
    const end = editor.view.coordsAtPos(to);
    const start = editor.view.coordsAtPos(from);
    const midX = (start.left + end.left) / 2;
    const bottomY = Math.max(start.bottom, end.bottom);

    this._chat.style.display = 'flex';
    // Don't call notifyShow — we coexist with the bubble menu

    requestAnimationFrame(() => {
      if (!this._chat) return;
      const chatWidth = this._chat.offsetWidth;
      const centredX = Math.max(8, midX - chatWidth / 2);
      layoutPopup(this._chat, { x: centredX, y: bottomY + 8 });
      this._inputField?.focus();
    });
  }

  hide(): void {
    if (this._chat) {
      this._chat.style.display = 'none';
    }
    this._abortController?.abort();
    this._abortController = null;
    this._streaming = false;
    this._updateSendButton();
  }

  dispose(): void {
    this._registration?.dispose();
    this._registration = null;
    this._abortController?.abort();
    this._abortController = null;
    if (this._chat) {
      this._chat.remove();
      this._chat = null;
    }
    this._messagesContainer = null;
    this._inputField = null;
    this._sendBtn = null;
    this._messages = [];
  }

  // ── Conversation Management ────────────────────────────────────────────

  private _resetConversation(): void {
    this._messages = [];
    this._lastAssistantText = '';
    this._streaming = false;
    this._abortController?.abort();
    this._abortController = null;
    if (this._messagesContainer) {
      this._messagesContainer.innerHTML = '';
    }
    // Show the selected text as context indicator
    this._appendContextIndicator();
    this._updateSendButton();
  }

  private _appendContextIndicator(): void {
    if (!this._messagesContainer || !this._selectionText) return;
    const indicator = $('div.canvas-ai-chat-context');
    const label = $('span.canvas-ai-chat-context-label');
    label.textContent = 'Selection:';
    indicator.appendChild(label);
    const excerpt = $('span.canvas-ai-chat-context-excerpt');
    const trimmed = this._selectionText.length > 120
      ? this._selectionText.slice(0, 120) + '…'
      : this._selectionText;
    excerpt.textContent = trimmed;
    indicator.appendChild(excerpt);
    this._messagesContainer.appendChild(indicator);
  }

  // ── Send / Stream ──────────────────────────────────────────────────────

  private async _onSend(): Promise<void> {
    if (this._streaming) return;
    if (!this._inputField) return;

    const userText = this._inputField.value.trim();
    if (!userText) return;

    // Clear input
    this._inputField.value = '';
    this._inputField.style.height = 'auto';

    // Append user message to UI
    this._appendMessageBubble('user', userText);

    // Build the conversation messages
    // First turn: include the selection as context in the system message
    if (this._messages.length === 0) {
      this._messages.push({
        role: 'system',
        content: 'You are a helpful writing assistant working on a selected passage of text. '
          + 'The user has selected the following text from their document:\n\n'
          + `---\n${this._selectionText}\n---\n\n`
          + 'Help them with whatever they ask about this selection. '
          + 'Be concise and direct. If they ask you to rewrite or transform the text, '
          + 'return only the transformed text without explanation.',
      });
    }

    this._messages.push({ role: 'user', content: userText });

    // Optionally retrieve RAG context
    let ragContext: string | undefined;
    if (this._retrieveContext) {
      try {
        ragContext = await this._retrieveContext(userText);
      } catch { /* RAG failure is non-fatal */ }
    }

    // If RAG returned context, append it as a system message
    const messagesToSend: IChatMessage[] = [...this._messages];
    if (ragContext) {
      messagesToSend.push({
        role: 'system',
        content: `[Additional workspace context]\n${ragContext}`,
      });
    }

    // Start streaming
    this._streaming = true;
    this._updateSendButton();
    this._abortController?.abort();
    this._abortController = new AbortController();
    const signal = this._abortController.signal;

    const { bubble, contentEl } = this._appendMessageBubble('assistant', '');
    let result = '';

    try {
      const stream = this._sendChatRequest(messagesToSend, { temperature: 0.5 }, signal);
      for await (const chunk of stream) {
        if (signal.aborted) return;
        if (chunk.content) {
          result += chunk.content;
          contentEl.textContent = result;
          this._scrollToBottom();
        }
      }

      if (signal.aborted) return;

      // Record the assistant response
      this._messages.push({ role: 'assistant', content: result });
      this._lastAssistantText = result;

      // Add action buttons below the response
      this._appendActionButtons(bubble);

    } catch (err) {
      if (signal.aborted) return;
      contentEl.textContent = `Error: ${err instanceof Error ? err.message : 'Request failed'}`;
      contentEl.classList.add('canvas-ai-chat-error');
    } finally {
      this._streaming = false;
      this._updateSendButton();
    }
  }

  // ── UI Helpers ─────────────────────────────────────────────────────────

  private _appendMessageBubble(
    role: 'user' | 'assistant',
    text: string,
  ): { bubble: HTMLElement; contentEl: HTMLElement } {
    const bubble = $(`div.canvas-ai-chat-msg.canvas-ai-chat-msg--${role}`);
    const contentEl = $('div.canvas-ai-chat-msg-content');
    contentEl.textContent = text;
    bubble.appendChild(contentEl);
    this._messagesContainer?.appendChild(bubble);
    this._scrollToBottom();
    return { bubble, contentEl };
  }

  private _appendActionButtons(bubble: HTMLElement): void {
    const actions = $('div.canvas-ai-chat-actions');

    // ✓ Replace Selection
    const replaceBtn = $('button.canvas-ai-chat-action-btn.canvas-ai-chat-replace');
    replaceBtn.textContent = '✓ Replace';
    replaceBtn.title = 'Replace selection with this response';
    replaceBtn.addEventListener('mousedown', (ev) => {
      ev.preventDefault();
      this._replaceSelection();
    });
    actions.appendChild(replaceBtn);

    // 💬 Send to Chat
    const sendToChatBtn = $('button.canvas-ai-chat-action-btn.canvas-ai-chat-send-to-chat');
    sendToChatBtn.textContent = '💬 Send to Chat';
    sendToChatBtn.title = 'Send selection + conversation to main chat';
    sendToChatBtn.addEventListener('mousedown', (ev) => {
      ev.preventDefault();
      this._sendToChat();
    });
    actions.appendChild(sendToChatBtn);

    bubble.appendChild(actions);
    this._scrollToBottom();
  }

  private _scrollToBottom(): void {
    if (this._messagesContainer) {
      this._messagesContainer.scrollTop = this._messagesContainer.scrollHeight;
    }
  }

  private _updateSendButton(): void {
    if (this._sendBtn) {
      this._sendBtn.textContent = this._streaming ? '⏹' : '→';
      this._sendBtn.title = this._streaming ? 'Stop' : 'Send';
    }
  }

  // ── Actions ────────────────────────────────────────────────────────────

  /** Replace the original selection with the last AI response. */
  private _replaceSelection(): void {
    const editor = this._host.editor;
    if (!editor || !this._lastAssistantText) return;

    editor.chain()
      .focus()
      .deleteRange({ from: this._selectionFrom, to: this._selectionTo })
      .insertContentAt(this._selectionFrom, this._lastAssistantText)
      .run();

    this.hide();
  }

  /** Dispatch the selection + conversation to the main chat panel. */
  private _sendToChat(): void {
    // Build a summary of the conversation for context
    const conversationSummary = this._messages
      .filter(m => m.role !== 'system')
      .map(m => `[${m.role}]: ${m.content}`)
      .join('\n\n');

    const detail = {
      actionId: 'add-to-chat',
      selectedText: this._selectionText,
      surface: 'canvas',
      source: { fileName: 'Canvas Page', filePath: 'canvas' },
      // Include conversation context so the chat panel has full history
      conversationContext: conversationSummary || undefined,
    };

    document.dispatchEvent(
      new CustomEvent('parallx-selection-action', { bubbles: true, detail }),
    );

    this.hide();
  }
}
