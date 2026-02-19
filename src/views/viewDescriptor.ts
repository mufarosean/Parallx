// viewDescriptor.ts — view metadata and registration
import { SizeConstraints, DEFAULT_SIZE_CONSTRAINTS } from '../layout/layoutTypes.js';
import type { IView } from './viewTypes.js';
import type { IViewDescriptor } from './viewTypes.js';
export type { IViewDescriptor } from './viewTypes.js';

// ─── Builder ─────────────────────────────────────────────────────────────────

/**
 * Fluent builder for creating `IViewDescriptor` objects with sensible defaults.
 *
 * ```ts
 * const desc = ViewDescriptorBuilder.create('explorer', 'Explorer')
 *   .icon('files')
 *   .container('workbench.parts.sidebar')
 *   .factory(() => new ExplorerView())
 *   .build();
 * ```
 */
export class ViewDescriptorBuilder {
  private _id: string;
  private _name: string;
  private _icon?: string;
  private _containerId = '';
  private _when?: string;
  private _constraints: SizeConstraints = DEFAULT_SIZE_CONSTRAINTS;
  private _focusOnActivate = false;
  private _keybinding?: string;
  private _order = 100;
  private _factory: (() => IView | Promise<IView>) | undefined;

  private constructor(id: string, name: string) {
    this._id = id;
    this._name = name;
  }

  static create(id: string, name: string): ViewDescriptorBuilder {
    return new ViewDescriptorBuilder(id, name);
  }

  icon(value: string): this { this._icon = value; return this; }
  container(id: string): this { this._containerId = id; return this; }
  when(clause: string): this { this._when = clause; return this; }
  constraints(c: SizeConstraints): this { this._constraints = c; return this; }
  focusOnActivate(v = true): this { this._focusOnActivate = v; return this; }
  keybinding(kb: string): this { this._keybinding = kb; return this; }
  order(n: number): this { this._order = n; return this; }
  factory(fn: () => IView | Promise<IView>): this { this._factory = fn; return this; }

  build(): IViewDescriptor {
    if (!this._factory) {
      throw new Error(`ViewDescriptor "${this._id}" requires a factory function.`);
    }
    if (!this._containerId) {
      throw new Error(`ViewDescriptor "${this._id}" requires a containerId.`);
    }
    return {
      id: this._id,
      name: this._name,
      icon: this._icon,
      containerId: this._containerId,
      when: this._when,
      constraints: this._constraints,
      focusOnActivate: this._focusOnActivate,
      keybinding: this._keybinding,
      order: this._order,
      factory: this._factory,
    };
  }
}

// ─── Serialised form ─────────────────────────────────────────────────────────

/**
 * JSON-serialisable subset of IViewDescriptor (excludes factory).
 * Used for persisting registered view information.
 */
interface SerializedViewDescriptor {
  readonly id: string;
  readonly name: string;
  readonly icon?: string;
  readonly containerId: string;
  readonly when?: string;
  readonly constraints: SizeConstraints;
  readonly focusOnActivate: boolean;
  readonly keybinding?: string;
  readonly order: number;
}

/**
 * Extract the serialisable portion of a descriptor.
 */
export function serializeViewDescriptor(d: IViewDescriptor): SerializedViewDescriptor {
  return {
    id: d.id,
    name: d.name,
    icon: d.icon,
    containerId: d.containerId,
    when: d.when,
    constraints: d.constraints,
    focusOnActivate: d.focusOnActivate,
    keybinding: d.keybinding,
    order: d.order,
  };
}