// selectionActionDispatcher.ts — Routes selection action payloads to handlers.
//
// Central dispatcher for the Unified Selection → AI Action System (M48).

import type { IDisposable } from '../platform/lifecycle.js';
import type {
  ISelectionActionPayload,
  ISelectionActionHandler,
  ISelectionActionDispatcher,
  IActionHandlerServices,
} from './selectionActionTypes.js';

/**
 * Concrete dispatcher. Maintains a handler registry and routes payloads.
 */
export class SelectionActionDispatcher implements ISelectionActionDispatcher {
  private readonly _handlers = new Map<string, ISelectionActionHandler>();
  private _services: IActionHandlerServices | undefined;
  private _disposed = false;

  /**
   * Bind the shared services that every handler receives.
   * Must be called once during startup, before any dispatch.
   */
  setServices(services: IActionHandlerServices): void {
    this._services = services;
  }

  registerHandler(handler: ISelectionActionHandler): IDisposable {
    if (this._handlers.has(handler.actionId)) {
      console.warn(`[SelectionActionDispatcher] Overwriting existing handler for '${handler.actionId}'`);
    }
    this._handlers.set(handler.actionId, handler);
    return {
      dispose: () => {
        if (this._handlers.get(handler.actionId) === handler) {
          this._handlers.delete(handler.actionId);
        }
      },
    };
  }

  getHandlers(): readonly ISelectionActionHandler[] {
    return [...this._handlers.values()];
  }

  async dispatch(payload: ISelectionActionPayload): Promise<void> {
    if (this._disposed) {
      return;
    }
    const handler = this._handlers.get(payload.actionId);
    if (!handler) {
      console.warn(`[SelectionActionDispatcher] No handler registered for action '${payload.actionId}'`);
      return;
    }
    if (!this._services) {
      console.error('[SelectionActionDispatcher] Services not set — call setServices() before dispatch.');
      return;
    }
    await handler.execute(payload, this._services);
  }

  dispose(): void {
    this._disposed = true;
    this._handlers.clear();
  }
}
