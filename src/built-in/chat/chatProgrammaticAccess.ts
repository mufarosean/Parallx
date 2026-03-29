// chatProgrammaticAccess.ts — Wraps the active ChatWidget to provide
// IChatProgrammaticAccess for external consumers (M48).

import type { IChatProgrammaticAccess, IChatSelectionAttachment } from '../../services/selectionActionTypes.js';

/**
 * Thin wrapper that provides programmatic control of the chat panel.
 *
 *   - Accepts a getter for the active widget (the module-level _activeWidget
 *     reference in chat/main.ts) and a command executor for reveal.
 *   - All methods are safe to call even if no widget is active (they no-op).
 */
export class ChatProgrammaticAccess implements IChatProgrammaticAccess {
  constructor(
    private readonly _getWidget: () => import('./widgets/chatWidget.js').ChatWidget | undefined,
    private readonly _executeCommand: (id: string, ...args: unknown[]) => Promise<unknown>,
  ) {}

  addSelectionAttachment(attachment: IChatSelectionAttachment): void {
    const widget = this._getWidget();
    if (widget) {
      widget.addSelectionAttachment(attachment);
    }
  }

  setInputValue(text: string): void {
    const widget = this._getWidget();
    if (widget) {
      widget.setInputValue(text);
    }
  }

  focus(): void {
    const widget = this._getWidget();
    if (widget) {
      widget.focus();
    }
  }

  submit(): void {
    const widget = this._getWidget();
    if (widget) {
      widget.acceptInput();
    }
  }

  async reveal(): Promise<void> {
    // Ensure the chat panel (auxiliary bar) is visible — uses show not toggle
    await this._executeCommand('chat.show');
  }
}
