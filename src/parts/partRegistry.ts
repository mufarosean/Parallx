// partRegistry.ts — part registration and lookup
import { Disposable } from '../platform/lifecycle.js';
import { Emitter, Event } from '../platform/events.js';
import { IPart, PartDescriptor } from './partTypes.js';

/**
 * Error thrown when attempting to register a part with a duplicate ID.
 */
export class DuplicatePartError extends Error {
  constructor(id: string) {
    super(`Part with ID "${id}" is already registered.`);
    this.name = 'DuplicatePartError';
  }
}

/**
 * Error thrown when looking up a part that has not been registered.
 */
export class PartNotFoundError extends Error {
  constructor(id: string) {
    super(`Part with ID "${id}" is not registered.`);
    this.name = 'PartNotFoundError';
  }
}

/**
 * Central registry for structural workbench parts.
 *
 * Parts are registered via descriptors at initialisation time and can be
 * looked up by ID or iterated over.  The registry also provides factory
 * methods that lazily create part instances from their descriptors.
 */
export class PartRegistry extends Disposable {

  /** Descriptor map — registration metadata. */
  private readonly _descriptors = new Map<string, PartDescriptor>();

  /** Instance map — lazily populated by `createPart()`. */
  private readonly _instances = new Map<string, IPart>();

  // ── Events ──

  private readonly _onDidRegister = this._register(new Emitter<PartDescriptor>());
  readonly onDidRegister: Event<PartDescriptor> = this._onDidRegister.event;

  private readonly _onDidCreate = this._register(new Emitter<IPart>());
  readonly onDidCreate: Event<IPart> = this._onDidCreate.event;

  // ── Registration ──

  /**
   * Register a part descriptor. Throws if a part with the same ID already exists.
   */
  register(descriptor: PartDescriptor): void {
    if (this._descriptors.has(descriptor.id)) {
      throw new DuplicatePartError(descriptor.id);
    }
    this._descriptors.set(descriptor.id, descriptor);
    this._onDidRegister.fire(descriptor);
  }

  /**
   * Register multiple descriptors at once.
   */
  registerMany(descriptors: readonly PartDescriptor[]): void {
    for (const d of descriptors) {
      this.register(d);
    }
  }

  /**
   * Returns true if a descriptor is registered for the given ID.
   */
  has(id: string): boolean {
    return this._descriptors.has(id);
  }

  // ── Lookup ──

  /**
   * Get the descriptor for a part by ID. Throws if not found.
   */
  getDescriptor(id: string): PartDescriptor {
    const desc = this._descriptors.get(id);
    if (!desc) {
      throw new PartNotFoundError(id);
    }
    return desc;
  }

  /**
   * Get all registered descriptors.
   */
  getDescriptors(): readonly PartDescriptor[] {
    return [...this._descriptors.values()];
  }

  /**
   * Get a part instance by ID.
   * Returns `undefined` if the part has not been created yet.
   */
  getPart(id: string): IPart | undefined {
    return this._instances.get(id);
  }

  /**
   * Get a part instance by ID, throwing if it hasn't been created.
   */
  requirePart(id: string): IPart {
    const part = this._instances.get(id);
    if (!part) {
      throw new PartNotFoundError(id);
    }
    return part;
  }

  /**
   * Get all created part instances.
   */
  getParts(): readonly IPart[] {
    return [...this._instances.values()];
  }

  // ── Factory ──

  /**
   * Create a part from its registered descriptor.
   *
   * If the part has already been created it is returned as-is (singleton).
   */
  createPart(id: string): IPart {
    const existing = this._instances.get(id);
    if (existing) {
      return existing;
    }

    const descriptor = this.getDescriptor(id);
    const part = descriptor.factory();
    this._instances.set(id, part);
    this._onDidCreate.fire(part);
    return part;
  }

  /**
   * Create all registered parts that haven't been created yet.
   * Returns the full array of part instances.
   */
  createAll(): readonly IPart[] {
    for (const id of this._descriptors.keys()) {
      this.createPart(id);
    }
    return this.getParts();
  }

  // ── Cleanup ──

  override dispose(): void {
    for (const part of this._instances.values()) {
      part.dispose();
    }
    this._instances.clear();
    this._descriptors.clear();
    super.dispose();
  }
}