// chatProgrammaticAccess.ts — Wraps the active ChatWidget to provide
// IChatProgrammaticAccess for external consumers (M48).

import type { IChatProgrammaticAccess, IChatSelectionAttachment, ICanvasBlockReferencePayload } from '../../services/selectionActionTypes.js';

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

  async addCanvasBlockReference(payload: ICanvasBlockReferencePayload): Promise<void> {
    await this.reveal();
    const widget = this._getWidget();
    if (!widget) {
      return;
    }
    // Resolve the page title once so the chip reads "block — Page" immediately
    // (the block menu only knows the pageId). Best-effort and label-only — the
    // block's actual content is still resolved LIVE at send time.
    let pageTitle = payload.pageTitle;
    if (!pageTitle && payload.blocks[0]) {
      try {
        const res = await this._executeCommand(
          'canvas.resolveBlockForChat', payload.pageId, payload.blocks[0].blockId,
        ) as { pageTitle?: string } | null;
        pageTitle = res?.pageTitle ?? undefined;
      } catch { /* non-fatal — the chip is fine without the title */ }
    }
    for (const b of payload.blocks) {
      const id = `canvas-block://${payload.pageId}/${b.blockId}`;
      const preview = (b.preview ?? '').trim();
      const label = preview
        ? (preview.length > 36 ? preview.slice(0, 33) + '…' : preview)
        : (b.blockType ?? 'block');
      widget.addCanvasBlockAttachment({
        kind: 'canvas-block',
        id,
        name: label,
        fullPath: id,
        isImplicit: false,
        pageId: payload.pageId,
        blockId: b.blockId,
        pageTitle,
        blockType: b.blockType,
      });
    }
    widget.focus();
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
