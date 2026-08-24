// surfaceRegistry.ts — the one place a renderable thing is registered
//
// Foundation Decision 6 (docs/FOUNDATION.md). Replaces the registration paths
// for content: `contributes.views` + `viewContainers`, `contributes.editors`,
// and (when the dashboard migrates onto the tree) the dashboard widget API.
// The status bar is window chrome, not content (Decision 3), and keeps its
// own registration.
//
// Module singleton, matching colorRegistry / settingsPanelRegistry: a tool may
// register before or after the workbench is built, and service-activation
// order must not decide whether a surface exists. This is the same reasoning
// that made the settings registry a singleton after a missed registration
// turned into a blank Settings panel.

import { Emitter } from '../platform/events.js';
import type { Event } from '../platform/events.js';
import type { IDisposable } from '../platform/lifecycle.js';
import type { ISurface, ISurfaceBinding, ISurfaceDescriptor } from './surfaceTypes.js';
import { bindingsEqual } from './surfaceTypes.js';

/** A live surface plus the registration it came from. */
export interface ISurfaceInstance {
  readonly surface: ISurface;
  readonly descriptor: ISurfaceDescriptor;
  /**
   * The binding this instance was created FOR. Surfaces apply bindings
   * asynchronously, so `surface.binding` can lag the truth by an await — long
   * enough for a second identical open to slip past reuse and duplicate the
   * pane. Matching falls back to this record until the surface catches up.
   */
  readonly requestedBinding?: ISurfaceBinding;
}

export class SurfaceRegistry {
  private readonly _descriptors = new Map<string, ISurfaceDescriptor>();
  private readonly _instances = new Map<string, ISurfaceInstance>();
  private _nextInstance = 1;

  private readonly _onDidRegister = new Emitter<ISurfaceDescriptor>();
  readonly onDidRegister: Event<ISurfaceDescriptor> = this._onDidRegister.event;

  private readonly _onDidUnregister = new Emitter<string>();
  readonly onDidUnregister: Event<string> = this._onDidUnregister.event;

  private readonly _onDidCreateInstance = new Emitter<ISurfaceInstance>();
  readonly onDidCreateInstance: Event<ISurfaceInstance> = this._onDidCreateInstance.event;

  private readonly _onDidDisposeInstance = new Emitter<string>();
  readonly onDidDisposeInstance: Event<string> = this._onDidDisposeInstance.event;

  // ── Registration ──

  register(descriptor: ISurfaceDescriptor): IDisposable {
    if (this._descriptors.has(descriptor.typeId)) {
      throw new Error(`Surface type already registered: ${descriptor.typeId}`);
    }
    this._descriptors.set(descriptor.typeId, descriptor);
    this._onDidRegister.fire(descriptor);
    return {
      dispose: () => {
        if (this._descriptors.get(descriptor.typeId) !== descriptor) return;
        // Live instances are disposed with their registration. An extension
        // being unloaded must not leave panes behind that nothing can rebuild
        // or serialise; the arrangement records them as unavailable instead.
        for (const [id, inst] of [...this._instances]) {
          if (inst.descriptor.typeId === descriptor.typeId) this.disposeInstance(id);
        }
        this._descriptors.delete(descriptor.typeId);
        this._onDidUnregister.fire(descriptor.typeId);
      },
    };
  }

  getDescriptor(typeId: string): ISurfaceDescriptor | undefined {
    return this._descriptors.get(typeId);
  }

  get descriptors(): readonly ISurfaceDescriptor[] {
    return [...this._descriptors.values()];
  }

  /** Types that can be pointed at this kind of thing. Drives "open with". */
  descriptorsForBindingKind(kind: string): readonly ISurfaceDescriptor[] {
    return this.descriptors.filter((d) => d.bindingKinds.includes(kind));
  }

  // ── Instances ──

  /**
   * Build a live surface, or return the existing one when the type is
   * single-instance or an identical binding is already open.
   *
   * Reusing on an equal binding is what stops a second click on the same file
   * opening a second copy. `forceNew` is the deliberate "open another view of
   * this" path — Obsidian's model, and the one that makes side-by-side
   * comparison of the same document possible.
   */
  createInstance(
    typeId: string,
    binding?: ISurfaceBinding,
    opts: { forceNew?: boolean } = {},
  ): ISurfaceInstance {
    const descriptor = this._descriptors.get(typeId);
    if (!descriptor) throw new Error(`Surface type not registered: ${typeId}`);

    // A single-instance type ignores forceNew: "another view of this" is
    // exactly the thing its declaration says is meaningless, and honouring
    // the flag would strand a duplicate no lookup can ever return.
    if (!opts.forceNew || descriptor.instances === 'single') {
      const existing = this.findInstance(typeId, binding);
      if (existing) return existing;
    }

    const instanceId = `${typeId}#${this._nextInstance++}`;
    const surface = descriptor.create(instanceId);
    const instance: ISurfaceInstance = {
      surface,
      descriptor,
      ...(binding ? { requestedBinding: binding } : {}),
    };
    this._instances.set(instanceId, instance);
    this._onDidCreateInstance.fire(instance);
    return instance;
  }

  /**
   * Track a surface built outside any registration.
   *
   * Today that is only the restore placeholder, which stands in for a type
   * that is NOT registered — the absence is why it exists, so it cannot come
   * through `createInstance`. Adoption gives it the same lifetime as every
   * other instance: one `disposeInstance`, one event, no special casing
   * anywhere downstream.
   */
  adoptInstance(surface: ISurface, descriptor: ISurfaceDescriptor): ISurfaceInstance {
    if (this._instances.has(surface.id)) {
      throw new Error(`Instance already tracked: ${surface.id}`);
    }
    const instance: ISurfaceInstance = { surface, descriptor };
    this._instances.set(surface.id, instance);
    this._onDidCreateInstance.fire(instance);
    return instance;
  }

  /**
   * An existing instance of this type with this binding.
   *
   * A single-instance type matches on type alone: its whole point is that a
   * second one is meaningless, whatever it would be pointed at.
   */
  findInstance(typeId: string, binding?: ISurfaceBinding): ISurfaceInstance | undefined {
    const descriptor = this._descriptors.get(typeId);
    const single = descriptor?.instances === 'single';
    for (const inst of this._instances.values()) {
      if (inst.descriptor.typeId !== typeId) continue;
      if (single) return inst;
      // The live binding wins once the surface has applied it; until then the
      // requested one stands in, so an instance mid-load is still findable.
      if (bindingsEqual(inst.surface.binding ?? inst.requestedBinding, binding)) return inst;
    }
    return undefined;
  }

  getInstance(instanceId: string): ISurfaceInstance | undefined {
    return this._instances.get(instanceId);
  }

  get instances(): readonly ISurfaceInstance[] {
    return [...this._instances.values()];
  }

  disposeInstance(instanceId: string): void {
    const instance = this._instances.get(instanceId);
    if (!instance) return;
    this._instances.delete(instanceId);
    // Fire BEFORE disposing: listeners (the tree, the arrangement) need to
    // detach a live surface, and a disposed one can no longer be found or
    // removed cleanly.
    this._onDidDisposeInstance.fire(instanceId);
    instance.surface.dispose();
  }

  dispose(): void {
    for (const id of [...this._instances.keys()]) this.disposeInstance(id);
    this._descriptors.clear();
    this._onDidRegister.dispose();
    this._onDidUnregister.dispose();
    this._onDidCreateInstance.dispose();
    this._onDidDisposeInstance.dispose();
  }
}

/** The app-wide registry. */
export const surfaceRegistry = new SurfaceRegistry();
