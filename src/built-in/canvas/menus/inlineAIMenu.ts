// inlineAIMenu.ts — Inline AI menu for canvas editor (M10 Phase 7 — Task 7.3)
//
// Adds AI action buttons (Summarize, Expand, Fix Grammar, Translate) that
// appear alongside the bubble menu when text is selected on a canvas page.
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

export interface InlineAIMenuHost {
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

/** Action definitions for inline AI. */
interface InlineAIAction {
  readonly id: string;
  readonly label: string;
  readonly icon: string;
  readonly title: string;
  readonly buildPrompt: (selectedText: string, context?: string) => string;
  readonly temperature?: number;
  readonly maxTokens?: number;
}

// ── Actions ──────────────────────────────────────────────────────────────────

const AI_ACTIONS: InlineAIAction[] = [
  {
    id: 'summarize',
    label: '✦',
    icon: '✦',
    title: 'AI: Summarize',
    buildPrompt: (text, ctx) => {
      let prompt = `Summarize the following text concisely:\n\n${text}`;
      if (ctx) prompt += `\n\n[Additional context]\n${ctx}`;
      return prompt;
    },
    temperature: 0.3,
    maxTokens: 500,
  },
  {
    id: 'expand',
    label: '⇔',
    icon: '⇔',
    title: 'AI: Expand',
    buildPrompt: (text, ctx) => {
      let prompt = `Expand on the following text with more detail and examples. Keep the same style and tone:\n\n${text}`;
      if (ctx) prompt += `\n\n[Additional context]\n${ctx}`;
      return prompt;
    },
    temperature: 0.7,
    maxTokens: 1000,
  },
  {
    id: 'fix-grammar',
    label: 'Aa',
    icon: 'Aa',
    title: 'AI: Fix Grammar',
    buildPrompt: (text) =>
      `Fix any grammar, spelling, and punctuation errors in the following text. Return ONLY the corrected text with no explanation:\n\n${text}`,
    temperature: 0.1,
    maxTokens: 500,
  },
  {
    id: 'translate',
    label: '🌐',
    icon: '🌐',
    title: 'AI: Translate to English',
    buildPrompt: (text) =>
      `Translate the following text to English. Return ONLY the translation with no explanation:\n\n${text}`,
    temperature: 0.2,
    maxTokens: 500,
  },
];

// ── Controller ───────────────────────────────────────────────────────────────

export class InlineAIMenuController implements ICanvasMenu {
  readonly id = 'inline-ai-menu';

  private _menu: HTMLElement | null = null;
  private _resultOverlay: HTMLElement | null = null;
  private _registration: IDisposable | null = null;
  private _abortController: AbortController | null = null;

  constructor(
    private readonly _host: InlineAIMenuHost,
    private readonly _registry: CanvasMenuRegistry,
    private readonly _sendChatRequest: SendChatRequestFn,
    private readonly _retrieveContext?: RetrieveContextFn,
  ) {}

  get visible(): boolean {
    return !!this._menu && this._menu.style.display !== 'none';
  }

  containsTarget(target: Node): boolean {
    return (this._menu?.contains(target) ?? false)
      || (this._resultOverlay?.contains(target) ?? false);
  }

  /** Build the inline AI menu DOM. */
  create(): void {
    this._menu = $('div.canvas-inline-ai-menu');
    this._menu.style.display = 'none';

    // Separator bar
    const sep = $('div.canvas-inline-ai-sep');
    sep.textContent = '|';
    this._menu.appendChild(sep);

    // AI action buttons
    for (const action of AI_ACTIONS) {
      const btn = $('button.canvas-inline-ai-btn');
      btn.textContent = action.label;
      btn.title = action.title;
      btn.dataset.action = action.id;
      btn.addEventListener('mousedown', (ev) => {
        ev.preventDefault(); // prevent editor blur
        this._executeAction(action);
      });
      this._menu.appendChild(btn);
    }

    document.body.appendChild(this._menu);
    this._registration = this._registry.register(this);
  }

  /** ICanvasMenu lifecycle — show the AI menu below the bubble menu on selection. */
  onSelectionUpdate(editor: Editor): void {
    if (!this._menu) return;

    if (this._registry.isInteractionLocked()) {
      this.hide();
      return;
    }

    const { from, to, empty } = editor.state.selection;
    if (empty || from === to) {
      this.hide();
      return;
    }

    // Don't show if the bubble menu is suppressed for this block type
    const { $from } = editor.state.selection;
    if (this._registry.shouldSuppressBubbleMenu($from.parent.type.name)) {
      this.hide();
      return;
    }

    // Position below the selection (the bubble menu is above)
    const end = editor.view.coordsAtPos(to);
    const start = editor.view.coordsAtPos(from);
    const midX = (start.left + end.left) / 2;
    const bottomY = Math.max(start.bottom, end.bottom);

    this._menu.style.display = 'flex';
    // Don't call notifyShow — we coexist with the bubble menu

    requestAnimationFrame(() => {
      if (!this._menu) return;
      const menuWidth = this._menu.offsetWidth;
      const centredX = Math.max(8, midX - menuWidth / 2);
      layoutPopup(this._menu, { x: centredX, y: bottomY + 4 });
    });
  }

  hide(): void {
    if (this._menu) {
      this._menu.style.display = 'none';
    }
    this._dismissResult();
  }

  dispose(): void {
    this._registration?.dispose();
    this._registration = null;
    this._abortController?.abort();
    this._abortController = null;
    if (this._menu) {
      this._menu.remove();
      this._menu = null;
    }
    this._dismissResult();
  }

  // ── AI Execution ──

  private async _executeAction(action: InlineAIAction): Promise<void> {
    const editor = this._host.editor;
    if (!editor) return;

    const { from, to } = editor.state.selection;
    const selectedText = editor.state.doc.textBetween(from, to);
    if (!selectedText.trim()) return;

    // Cancel any previous request
    this._abortController?.abort();
    this._abortController = new AbortController();
    const signal = this._abortController.signal;

    // Hide the menu, show loading overlay
    this.hide();
    this._showResultOverlay(from, to, action.title, true);

    try {
      // Optionally retrieve RAG context for grounded responses
      let ragContext: string | undefined;
      if (this._retrieveContext && (action.id === 'summarize' || action.id === 'expand')) {
        ragContext = await this._retrieveContext(selectedText);
      }

      const userPrompt = action.buildPrompt(selectedText, ragContext);

      const messages: IChatMessage[] = [
        {
          role: 'system',
          content: 'You are a helpful writing assistant. Respond with the requested text transformation only. Do not include explanations, preamble, or markdown formatting unless the original text uses it.',
        },
        { role: 'user', content: userPrompt },
      ];

      // Stream the response
      let result = '';
      const stream = this._sendChatRequest(
        messages,
        { temperature: action.temperature, maxTokens: action.maxTokens },
        signal,
      );

      for await (const chunk of stream) {
        if (signal.aborted) return;
        if (chunk.content) {
          result += chunk.content;
          this._updateResultOverlay(result, false);
        }
      }

      if (signal.aborted) return;

      // Show final result with accept/reject buttons
      this._updateResultOverlay(result, true, () => {
        // Accept: replace selected text
        editor.chain().focus().deleteRange({ from, to }).insertContentAt(from, result).run();
        this._dismissResult();
      }, () => {
        // Reject: dismiss without changes
        this._dismissResult();
        // Re-focus editor at original selection
        editor.chain().focus().setTextSelection({ from, to }).run();
      });

    } catch (err) {
      if (signal.aborted) return;
      console.error('[InlineAI] Action failed:', err);
      this._updateResultOverlay(
        `Error: ${err instanceof Error ? err.message : 'Request failed'}`,
        true,
        undefined,
        () => this._dismissResult(),
      );
    }
  }

  // ── Result Overlay ──

  private _showResultOverlay(_from: number, to: number, title: string, loading: boolean): void {
    this._dismissResult();

    const editor = this._host.editor;
    if (!editor) return;

    const overlay = $('div.canvas-inline-ai-result');
    const header = $('div.canvas-inline-ai-result-header');
    header.textContent = loading ? `${title}…` : title;
    overlay.appendChild(header);

    const content = $('div.canvas-inline-ai-result-content');
    if (loading) {
      content.textContent = 'Generating…';
      content.classList.add('canvas-inline-ai-result-loading');
    }
    overlay.appendChild(content);

    // Position below the selection
    const coords = editor.view.coordsAtPos(to);
    document.body.appendChild(overlay);
    this._resultOverlay = overlay;

    requestAnimationFrame(() => {
      if (!this._resultOverlay) return;
      layoutPopup(this._resultOverlay, { x: coords.left, y: coords.bottom + 8 });
    });
  }

  private _updateResultOverlay(
    text: string,
    finished: boolean,
    onAccept?: () => void,
    onReject?: () => void,
  ): void {
    if (!this._resultOverlay) return;

    const content = this._resultOverlay.querySelector('.canvas-inline-ai-result-content');
    if (content) {
      content.textContent = text;
      content.classList.toggle('canvas-inline-ai-result-loading', !finished);
    }

    // Add accept/reject buttons when finished
    if (finished) {
      const existing = this._resultOverlay.querySelector('.canvas-inline-ai-result-actions');
      if (existing) existing.remove();

      const actions = $('div.canvas-inline-ai-result-actions');

      if (onAccept) {
        const acceptBtn = $('button.canvas-inline-ai-accept');
        acceptBtn.textContent = '✓ Accept';
        acceptBtn.addEventListener('click', (ev) => {
          ev.preventDefault();
          onAccept();
        });
        actions.appendChild(acceptBtn);
      }

      if (onReject) {
        const rejectBtn = $('button.canvas-inline-ai-reject');
        rejectBtn.textContent = '✕ Discard';
        rejectBtn.addEventListener('click', (ev) => {
          ev.preventDefault();
          onReject();
        });
        actions.appendChild(rejectBtn);
      }

      this._resultOverlay.appendChild(actions);
    }
  }

  private _dismissResult(): void {
    this._abortController?.abort();
    this._abortController = null;
    if (this._resultOverlay) {
      this._resultOverlay.remove();
      this._resultOverlay = null;
    }
  }
}
