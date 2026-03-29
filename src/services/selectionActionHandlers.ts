// selectionActionHandlers.ts — Built-in action handlers for the Unified
// Selection → AI Action System (M48).
//
// Phase 4: Simplified to a single AddSelectionToChat handler + SendToCanvas.
// Explain/Summarize are handled as model-driven skills (defaultSkillContents.ts),
// not code-level command handlers.

import type {
  ISelectionActionPayload,
  ISelectionActionHandler,
  IActionHandlerServices,
  IChatSelectionAttachment,
} from './selectionActionTypes.js';

// ── Helpers ──────────────────────────────────────────────────────────────────

/** Build a standard selection attachment from a payload. */
function payloadToAttachment(payload: ISelectionActionPayload): IChatSelectionAttachment {
  return {
    kind: 'selection',
    id: `selection-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
    name: payload.source.fileName,
    fullPath: payload.source.filePath,
    isImplicit: false,
    selectedText: payload.selectedText,
    surface: payload.surface,
    startLine: payload.source.startLine,
    endLine: payload.source.endLine,
    pageNumber: payload.source.pageNumber,
  };
}

// ── Add Selection to Chat Handler ────────────────────────────────────────────

export class AddSelectionToChatHandler implements ISelectionActionHandler {
  readonly actionId = 'add-to-chat';
  readonly label = 'Add Selection to Chat';
  readonly icon = '💬';

  async execute(payload: ISelectionActionPayload, services: IActionHandlerServices): Promise<void> {
    const { chatAccess } = services;
    await chatAccess.reveal();
    chatAccess.addSelectionAttachment(payloadToAttachment(payload));
    chatAccess.focus();
  }
}

// ── Send to Canvas Handler ───────────────────────────────────────────────────

export class SendSelectionToCanvasHandler implements ISelectionActionHandler {
  readonly actionId = 'send-to-canvas';
  readonly label = 'Send to Canvas';
  readonly icon = '🎨';

  async execute(payload: ISelectionActionPayload, services: IActionHandlerServices): Promise<void> {
    await services.executeCommand('canvas.appendText', payload.selectedText, payload.source.fileName);
  }
}

// ── Factory ──────────────────────────────────────────────────────────────────

/** Create all built-in action handlers. */
export function createBuiltInActionHandlers(): ISelectionActionHandler[] {
  return [
    new AddSelectionToChatHandler(),
    new SendSelectionToCanvasHandler(),
  ];
}
