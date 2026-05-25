// resourceRegistry.ts — Per-type Resource resolver registry (Slice A2)
//
// A small dispatch layer that lets each domain (canvas, chat, file, tool)
// own its own Resource resolver, while every consumer talks to one API.
//
// Spec: WORKBENCH_INTERACTION_MODEL.md §2.2 "Migration Story":
//   "Canvas, chat, explorer each register their resource resolver at
//    LinkResolverService.registerType('type', resolver)."
//
// This file is the workbench-level home for that registration. It does NOT
// modify the existing `src/links/linkResolverService.ts` (preservation
// surface). Future slices will route LinkResolverService through this
// registry, but not in this slice.
//
// Pure-additive: no consumers wired this slice. The registry is exercised
// only by its tier-0 unit tests.

import { Disposable } from '../../platform/lifecycle.js';
import { Emitter, Event } from '../../platform/events.js';
import type { Resource, ResourceType } from './resource.js';
import { parse } from './parallxUri.js';

/**
 * Resolves a Resource into a usable form for the calling surface.
 *
 * The exact return type is domain-specific (display name + content,
 * editor input, attachment record, etc.), so this slice keeps it generic.
 * Future slices may narrow the shape per ResourceType.
 */
export interface ResourceResolver<R extends Resource = Resource, T = unknown> {
  readonly type: R['type'];
  resolve(resource: R): Promise<T>;
}

export interface IResourceRegistry {
  /** Register a resolver for a Resource type. Throws if the type is already registered. */
  register<R extends Resource, T>(resolver: ResourceResolver<R, T>): void;

  /** Replace any existing resolver for the type. Returns true if one was replaced. */
  override<R extends Resource, T>(resolver: ResourceResolver<R, T>): boolean;

  /** Remove the resolver for a type. Returns true if one was removed. */
  unregister(type: ResourceType): boolean;

  /** Whether a resolver exists for the given type. */
  has(type: ResourceType): boolean;

  /**
   * Whether the registry has a resolver for the given Resource (or for
   * the type derived from parsing a URI string). Convenience for the
   * common pattern:
   *   `const r = parse(uri); return r ? registry.has(r.type) : false;`
   * Returns `false` for malformed URIs and for resources whose `type`
   * has no registered resolver.
   */
  canResolve(target: Resource | string): boolean;

  /** Snapshot list of every currently-registered resource type. Order is
   *  insertion order. */
  types(): readonly ResourceType[];

  /** Fires whenever a resolver is registered, replaced, or unregistered. */
  readonly onDidChange: Event<ResourceRegistryChangeEvent>;

  /** Resolve a Resource via the registered resolver for its type. Rejects if none is registered. */
  resolve<T = unknown>(resource: Resource): Promise<T>;

  /**
   * Parse a URI then resolve. Convenience for the common path:
   *   `const r = parse(uri); if (r) return registry.resolve(r);`
   * Resolves to `null` if the URI is malformed; rejects if no resolver
   * is registered for the parsed type.
   */
  resolveUri<T = unknown>(uri: string): Promise<T | null>;
}

/** Change notification fired by {@link IResourceRegistry.onDidChange}. */
export interface ResourceRegistryChangeEvent {
  readonly type: ResourceType;
  readonly kind: 'register' | 'override' | 'unregister';
}

export class ResourceRegistry extends Disposable implements IResourceRegistry {
  private readonly _resolvers = new Map<ResourceType, ResourceResolver>();
  private readonly _onDidChange = this._register(new Emitter<ResourceRegistryChangeEvent>());
  readonly onDidChange = this._onDidChange.event;

  register<R extends Resource, T>(resolver: ResourceResolver<R, T>): void {
    if (this._resolvers.has(resolver.type)) {
      throw new Error(`[ResourceRegistry] resolver for type "${resolver.type}" is already registered`);
    }
    this._resolvers.set(resolver.type, resolver as ResourceResolver);
    this._onDidChange.fire({ type: resolver.type, kind: 'register' });
  }

  override<R extends Resource, T>(resolver: ResourceResolver<R, T>): boolean {
    const had = this._resolvers.has(resolver.type);
    this._resolvers.set(resolver.type, resolver as ResourceResolver);
    this._onDidChange.fire({ type: resolver.type, kind: had ? 'override' : 'register' });
    return had;
  }

  unregister(type: ResourceType): boolean {
    const had = this._resolvers.delete(type);
    if (had) {
      this._onDidChange.fire({ type, kind: 'unregister' });
    }
    return had;
  }

  has(type: ResourceType): boolean {
    return this._resolvers.has(type);
  }

  canResolve(target: Resource | string): boolean {
    if (typeof target === 'string') {
      const r = parse(target);
      return r !== null && this._resolvers.has(r.type);
    }
    if (!target || typeof target !== 'object') return false;
    const t = (target as { type?: unknown }).type;
    if (typeof t !== 'string') return false;
    return this._resolvers.has(t as ResourceType);
  }

  types(): readonly ResourceType[] {
    return Array.from(this._resolvers.keys());
  }

  async resolve<T = unknown>(resource: Resource): Promise<T> {
    const resolver = this._resolvers.get(resource.type);
    if (!resolver) {
      throw new Error(`[ResourceRegistry] no resolver registered for type "${resource.type}"`);
    }
    return resolver.resolve(resource) as Promise<T>;
  }

  async resolveUri<T = unknown>(uri: string): Promise<T | null> {
    const resource = parse(uri);
    if (!resource) return null;
    return this.resolve<T>(resource);
  }

  override dispose(): void {
    this._resolvers.clear();
    super.dispose();
  }
}
