// viewDescriptor.ts — view metadata and registration
import { SizeConstraints, DEFAULT_SIZE_CONSTRAINTS } from '../layout/layoutTypes.js';
import { IView } from './view.js';

// ─── View Descriptor ─────────────────────────────────────────────────────────

/**
 * Declarative metadata describing a view before it is instantiated.
 *
 * Descriptors are registered with the ViewManager and used to:
 * - populate menus and palettes
 * - defer view creation until actually needed (lazy instantiation)
 * - persist view registration info as JSON
 */
export interface IViewDescriptor {
  /** Unique view ID. */
  readonly id: string;

  /** Human-readable name shown in tabs and menus. */
  readonly name: string;

  /** Icon identifier (CSS class or codicon name). */
  readonly icon?: string;

  /** ID of the part / view container this view belongs to by default. */
  readonly containerId: string;

  /**
   * When clause — a string expression evaluated against the context key
   * service. The view is only shown when this evaluates to true.
   * If undefined the view is always available.
   */
  readonly when?: string;

  /** Default size constraints for the view. */
  readonly constraints: SizeConstraints;

  /**
   * Whether the view should grab focus when first activated.
   */
  readonly focusOnActivate: boolean;

  /**
   * Optional keyboard shortcut to toggle / focus this view.
   * Format: modifier keys + key, e.g. "Ctrl+Shift+E".
   */
  readonly keybinding?: string;

  /**
   * Priority for ordering within a container (lower = earlier).
   */
  readonly order: number;

  /**
   * Factory function that creates the view instance.
   * Called lazily the first time the view is needed.
   */
  readonly factory: () => IView | Promise<IView>;
}

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
export interface SerializedViewDescriptor {
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