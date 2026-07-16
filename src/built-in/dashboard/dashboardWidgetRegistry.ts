// dashboardWidgetRegistry.ts — registry of widget contributions.
//
// The dashboard's live view of every registered widget type. Populated from
// two directions:
//   1. The dashboard's own core widgets (registered directly at activate).
//   2. The `parallx.dashboard` contribution hub — any tool (built-in or
//      external extension) that called `api.dashboard.registerWidgetType`.
//      Dashboard main.ts mirrors the hub into this registry and keeps it in
//      sync, so contributions land regardless of activation order.
//
// The dashboard editor pane reads from this registry to populate the picker,
// look up renderers when instantiating a widget instance, and surface
// "provided by X, currently unavailable" placeholders for instances whose
// type is not registered (extension disabled / uninstalled).

import { Emitter, type Event } from '../../platform/events.js';
import { Disposable, toDisposable, type IDisposable } from '../../platform/lifecycle.js';
import type { WidgetTypeRegistration } from './dashboardTypes.js';

interface RegistryEntry {
  readonly registration: WidgetTypeRegistration<unknown>;
  /** Tool that contributed the type. Undefined for legacy direct registrations. */
  readonly ownerToolId?: string;
}

export class DashboardWidgetRegistry extends Disposable {
  private readonly _types = new Map<string, RegistryEntry>();

  private readonly _onDidChange = this._register(new Emitter<void>());
  /** Fires whenever the set of registered widget types changes. */
  readonly onDidChange: Event<void> = this._onDidChange.event;

  registerWidgetType<TConfig = Record<string, unknown>>(
    registration: WidgetTypeRegistration<TConfig>,
    ownerToolId?: string,
  ): IDisposable {
    if (this._types.has(registration.typeId)) {
      console.warn(`[Dashboard] Widget type "${registration.typeId}" is already registered; overwriting.`);
    }
    const entry: RegistryEntry = {
      registration: registration as WidgetTypeRegistration<unknown>,
      ownerToolId,
    };
    this._types.set(registration.typeId, entry);
    this._onDidChange.fire();

    return toDisposable(() => {
      // Only delete if it still points at this registration — another tool may
      // have overwritten it in the interim.
      if (this._types.get(registration.typeId) === entry) {
        this._types.delete(registration.typeId);
        this._onDidChange.fire();
      }
    });
  }

  getWidgetType(typeId: string): WidgetTypeRegistration<unknown> | undefined {
    return this._types.get(typeId)?.registration;
  }

  /** Tool that contributed a type, when known. */
  getWidgetTypeOwner(typeId: string): string | undefined {
    return this._types.get(typeId)?.ownerToolId;
  }

  listWidgetTypes(): WidgetTypeRegistration<unknown>[] {
    return Array.from(this._types.values(), (e) => e.registration);
  }
}
