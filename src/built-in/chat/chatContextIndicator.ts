// chatContextIndicator.ts — Token / context window indicator
//
// Shows estimated token usage vs. context window size as a compact
// progress bar beneath the message list. Updates after each message.
//
// Token estimation: chars / 4 (per M9 spec).
// Context window size from OllamaProvider.getActiveModelContextLength().

import { Disposable } from '../../platform/lifecycle.js';
import { $ } from '../../ui/dom.js';

export interface IContextIndicatorServices {
  getContextLength(): number;  // model context window (tokens)
}

/**
 * Compact token usage indicator — shows context consumption.
 */
export class ChatContextIndicator extends Disposable {

  private readonly _root: HTMLElement;
  private readonly _bar: HTMLElement;
  private readonly _fill: HTMLElement;
  private readonly _label: HTMLElement;
  private readonly _services: IContextIndicatorServices;

  constructor(container: HTMLElement, services: IContextIndicatorServices) {
    super();
    this._services = services;

    this._root = $('div.parallx-chat-context-indicator');
    container.appendChild(this._root);

    this._bar = $('div.parallx-chat-context-bar');
    this._fill = $('div.parallx-chat-context-bar-fill');
    this._bar.appendChild(this._fill);
    this._root.appendChild(this._bar);

    this._label = $('span.parallx-chat-context-label');
    this._root.appendChild(this._label);

    // Initially hidden
    this._root.style.display = 'none';
  }

  // ── Public API ──

  /**
   * Update the indicator with current conversation token count.
   * @param conversationChars Total character count of all messages
   */
  update(conversationChars: number): void {
    const contextLength = this._services.getContextLength();
    if (contextLength <= 0) {
      this._root.style.display = 'none';
      return;
    }

    const estimatedTokens = Math.ceil(conversationChars / 4);
    const percentage = Math.min((estimatedTokens / contextLength) * 100, 100);

    this._root.style.display = '';

    // Update bar fill (cached reference)
    this._fill.style.width = `${percentage}%`;

    // Color coding
    this._fill.classList.toggle('parallx-chat-context-bar-fill--warning', percentage >= 70 && percentage < 90);
    this._fill.classList.toggle('parallx-chat-context-bar-fill--danger', percentage >= 90);

    // Update label
    const tokensK = estimatedTokens >= 1000
      ? `${(estimatedTokens / 1000).toFixed(1)}k`
      : `${estimatedTokens}`;
    const contextK = contextLength >= 1000
      ? `${(contextLength / 1000).toFixed(0)}k`
      : `${contextLength}`;
    this._label.textContent = `${tokensK} / ${contextK} tokens`;

    // Tooltip with full details
    this._root.title = `Estimated: ${estimatedTokens.toLocaleString()} tokens used of ${contextLength.toLocaleString()} context window (${percentage.toFixed(1)}%)`;
  }

  /** Hide the indicator (e.g. no session). */
  hide(): void {
    this._root.style.display = 'none';
  }

  override dispose(): void {
    this._root.remove();
    super.dispose();
  }
}
