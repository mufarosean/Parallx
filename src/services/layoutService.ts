// layoutService.ts — ILayoutService thin facade
//
// Delegates layout operations to the Workbench's grid system.
// Registered in the DI container during Phase 3 after grids exist.

import { Disposable } from '../platform/lifecycle.js';
import { Emitter, Event } from '../platform/events.js';
import type { ILayoutService, PartVisibilityChangeEvent } from './serviceTypes.js';

/**
 * Minimal shape of the workbench for layout delegation.
 * Avoids circular import of the full Workbench class.
 */
interface LayoutHost {
  readonly container: HTMLElement;
  readonly _hGrid: { layout(): void; resize(w: number, h: number): void };
  readonly _vGrid: { layout(): void; resize(w: number, h: number): void };
  _layoutViewContainers(): void;
  /** Check if a part is visible by its Part ID. */
  isPartVisible(partId: string): boolean;
  /** Show or hide a part by its Part ID. */
  setPartHidden(hidden: boolean, partId: string): void;
}

/**
 * Layout service implementing VS Code's IWorkbenchLayoutService pattern.
 *
 * Provides:
 * - `isVisible(partId)` — query part visibility
 * - `setPartHidden(hidden, partId)` — toggle part visibility
 * - `onDidChangePartVisibility` — event for visibility changes
 * - `layout()` — re-layout all grids and containers
 *
 * VS Code reference: src/vs/workbench/services/layout/browser/layoutService.ts
 */
export class LayoutService extends Disposable implements ILayoutService {

  private _host: LayoutHost | undefined;

  private readonly _onDidChangePartVisibility = this._register(new Emitter<PartVisibilityChangeEvent>());
  readonly onDidChangePartVisibility: Event<PartVisibilityChangeEvent> = this._onDidChangePartVisibility.event;

  /**
   * Bind the layout host (Workbench). Called once during Phase 3.
   */
  setHost(host: LayoutHost): void {
    this._host = host;
  }

  get container(): HTMLElement | undefined {
    return this._host?.container;
  }

  layout(): void {
    if (!this._host) return;
    this._host._hGrid.layout();
    this._host._vGrid.layout();
    this._host._layoutViewContainers();
  }

  /**
   * Returns whether the given part is currently visible.
   * VS Code reference: isVisible(part: Parts): boolean in layout.ts
   */
  isVisible(partId: string): boolean {
    if (!this._host) return false;
    return this._host.isPartVisible(partId);
  }

  /**
   * Show or hide a workbench part.
   * VS Code reference: setPartHidden(hidden, part) → dispatches to setSideBarHidden etc.
   */
  setPartHidden(hidden: boolean, partId: string): void {
    if (!this._host) return;
    this._host.setPartHidden(hidden, partId);
    // The host fires part visibility change events, but we also emit here
    // so external consumers (tools, contributions) can listen on the service.
    this._onDidChangePartVisibility.fire({ partId, visible: !hidden });
  }
}
