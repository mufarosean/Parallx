// dashboardWidgetRegistry.ts — registry of widget contributions.
//
// Tools register widget types here at activate-time. The dashboard editor
// pane reads from this registry to populate the picker, look up renderers
// when instantiating a widget instance, and surface "Unavailable —
// extension X not installed" placeholders for instances whose type was
// deregistered (extension deactivated).

import { Emitter, type Event } from '../../platform/events.js';
import { Disposable, toDisposable, type IDisposable } from '../../platform/lifecycle.js';
import type { WidgetTypeRegistration } from './dashboardTypes.js';

export class DashboardWidgetRegistry extends Disposable {
  private readonly _types = new Map<string, WidgetTypeRegistration<any>>();

  private readonly _onDidChange = this._register(new Emitter<void>());
  /** Fires whenever the set of registered widget types changes. */
  readonly onDidChange: Event<void> = this._onDidChange.event;

  registerWidgetType<TConfig = Record<string, unknown>>(
    registration: WidgetTypeRegistration<TConfig>,
  ): IDisposable {
    if (this._types.has(registration.typeId)) {
      console.warn(`[Dashboard] Widget type "${registration.typeId}" is already registered; overwriting.`);
    }
    this._types.set(registration.typeId, registration as WidgetTypeRegistration<unknown>);
    this._onDidChange.fire();

    return toDisposable(() => {
      // Only delete if it still points at this registration — another tool may
      // have overwritten it in the interim.
      if (this._types.get(registration.typeId) === (registration as unknown as WidgetTypeRegistration<unknown>)) {
        this._types.delete(registration.typeId);
        this._onDidChange.fire();
      }
    });
  }

  getWidgetType(typeId: string): WidgetTypeRegistration<unknown> | undefined {
    return this._types.get(typeId);
  }

  listWidgetTypes(): WidgetTypeRegistration<unknown>[] {
    return [...this._types.values()];
  }
}
