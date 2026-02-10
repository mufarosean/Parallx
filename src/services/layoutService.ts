// layoutService.ts — ILayoutService thin facade
//
// Delegates layout operations to the Workbench's grid system.
// Registered in the DI container during Phase 3 after grids exist.

import { Disposable } from '../platform/lifecycle.js';
import type { ILayoutService } from './serviceTypes.js';

/**
 * Minimal shape of the workbench for layout delegation.
 * Avoids circular import of the full Workbench class.
 */
interface LayoutHost {
  readonly container: HTMLElement;
  readonly _hGrid: { layout(): void; resize(w: number, h: number): void };
  readonly _vGrid: { layout(): void; resize(w: number, h: number): void };
  _layoutViewContainers(): void;
}

/**
 * Thin facade over the workbench's grid system.
 * Tools and services access layout through this service rather than
 * reaching into Workbench internals.
 */
export class LayoutService extends Disposable implements ILayoutService {

  private _host: LayoutHost | undefined;

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
}
