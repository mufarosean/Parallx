// selectionActionDispatcher.ts — Routes selection action payloads to handlers.
//
// Central dispatcher for the Unified Selection → AI Action System (M48).
//
// M81 Slice A — additive: dispatching also publishes the payload through
// the active `SelectionService` (if any) so subscribers can react to
// "the current selection changed" without going through the action-handler
// API. The `registerHandler` contract is unchanged.

import type { IDisposable } from '../platform/lifecycle.js';
import type {
  ISelectionActionPayload,
  ISelectionActionHandler,
  ISelectionActionDispatcher,
  IActionHandlerServices,
} from './selectionActionTypes.js';
import type { ISelectionService } from './serviceTypes.js';

// ── Module-level default SelectionService hook (M81 Slice A) ────────────────
//
// The dispatcher is constructed inside the chat built-in (`chat/main.ts`) at
// extension activation. Rather than thread a SelectionService argument through
// that activation site (which is out of scope for Slice A), the workbench
// publishes the singleton service here once and every dispatcher instance
// picks it up. Instances may also override per-construction.

let _activeSelectionService: ISelectionService | undefined;

/**
 * Set the workbench-wide SelectionService that every `SelectionActionDispatcher`
 * publishes through on dispatch. Called once by the workbench during Phase 1.
 *
 * Pass `undefined` to clear (used by tests).
 */
export function setActiveSelectionService(service: ISelectionService | undefined): void {
  _activeSelectionService = service;
}

/**
 * Concrete dispatcher. Maintains a handler registry and routes payloads.
 */
export class SelectionActionDispatcher implements ISelectionActionDispatcher {
  private readonly _handlers = new Map<string, ISelectionActionHandler>();
  private _services: IActionHandlerServices | undefined;
  private readonly _selectionService: ISelectionService | undefined;
  private _disposed = false;

  /**
   * @param selectionService Optional explicit SelectionService for this
   * dispatcher instance. When omitted (the existing call-site shape), the
   * dispatcher falls back to the module-level service set by the workbench.
   */
  constructor(selectionService?: ISelectionService) {
    this._selectionService = selectionService;
  }

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

    // M81 Slice A — broadcast the current selection through the SelectionService
    // as an additional channel. Done BEFORE handler execution so that
    // subscribers see the selection state before any handler-driven side
    // effects (e.g. chat input mutation) fire.
    const svc = this._selectionService ?? _activeSelectionService;
    if (svc) {
      try {
        svc.setSelection(payload.surface, {
          surfaceId: payload.surface,
          selectedText: payload.selectedText,
          source: payload.source,
        });
      } catch (err) {
        console.error('[SelectionActionDispatcher] SelectionService broadcast failed:', err);
      }
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

