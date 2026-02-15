// serviceCollection.ts — dependency injection container

import { IDisposable } from '../platform/lifecycle.js';
import { ServiceIdentifier } from '../platform/types.js';
import { ServiceDescriptor, getServiceDependencies, IServiceProvider } from '../platform/instantiation.js';

/**
 * Thrown when the service collection detects a circular dependency.
 */
class CircularDependencyError extends Error {
  constructor(chain: string[]) {
    super(`Circular dependency detected: ${chain.join(' → ')}`);
    this.name = 'CircularDependencyError';
  }
}

/**
 * Thrown when a required service is not registered.
 */
class ServiceNotFoundError extends Error {
  constructor(id: ServiceIdentifier<any>) {
    super(`Service not found: ${id.id}`);
    this.name = 'ServiceNotFoundError';
  }
}

/**
 * Entry in the service collection — either a pre-built instance or a descriptor for lazy creation.
 */
type ServiceEntry<T = any> = {
  instance?: T;
  descriptor?: ServiceDescriptor<T>;
};

/**
 * Dependency injection container.
 *
 * Supports:
 * - Registering services by ServiceIdentifier (interface key)
 * - Registering pre-built instances
 * - Lazy instantiation on first request
 * - Constructor injection with automatic dependency resolution
 * - Circular dependency detection
 * - Singleton and transient lifetimes
 * - Disposal of all instantiated services
 */
export class ServiceCollection implements IDisposable, IServiceProvider {
  private readonly _entries = new Map<string, ServiceEntry>();
  private readonly _instantiating = new Set<string>();
  private _disposed = false;

  /**
   * Register a service descriptor (lazy — instantiated on first `get`).
   */
  register<T>(descriptor: ServiceDescriptor<T>): void {
    this._throwIfDisposed();
    this._entries.set(descriptor.id.id, { descriptor });
  }

  /**
   * Register a pre-built service instance.
   */
  registerInstance<T>(id: ServiceIdentifier<T>, instance: T): void {
    this._throwIfDisposed();
    this._entries.set(id.id, { instance });
  }

  /**
   * Check if a service is registered (instance or descriptor).
   */
  has(id: ServiceIdentifier<any>): boolean {
    return this._entries.has(id.id);
  }

  /**
   * Get a service instance. Lazily instantiates if only a descriptor is registered.
   * Throws if not found or if a circular dependency is detected.
   */
  get<T>(id: ServiceIdentifier<T>): T {
    this._throwIfDisposed();

    const entry = this._entries.get(id.id);
    if (!entry) {
      throw new ServiceNotFoundError(id);
    }

    // Return cached instance if available
    if (entry.instance !== undefined) {
      return entry.instance as T;
    }

    // Lazy instantiation
    if (entry.descriptor) {
      return this._instantiate(entry, id.id);
    }

    throw new ServiceNotFoundError(id);
  }

  /**
   * Try to get a service, returning undefined if not registered.
   */
  tryGet<T>(id: ServiceIdentifier<T>): T | undefined {
    if (!this.has(id)) {
      return undefined;
    }
    try {
      return this.get(id);
    } catch {
      return undefined;
    }
  }

  /**
   * Instantiate a service from its descriptor, resolving constructor dependencies.
   */
  private _instantiate<T>(entry: ServiceEntry<T>, serviceId: string): T {
    const descriptor = entry.descriptor!;

    // Circular dependency detection
    if (this._instantiating.has(serviceId)) {
      throw new CircularDependencyError([...this._instantiating, serviceId]);
    }

    this._instantiating.add(serviceId);
    try {
      // Resolve constructor dependencies
      const deps = getServiceDependencies(descriptor.ctor);
      const args: any[] = [];

      for (const dep of deps.sort((a, b) => a.parameterIndex - b.parameterIndex)) {
        if (dep.optional && !this.has(dep.id)) {
          args[dep.parameterIndex] = undefined;
        } else {
          args[dep.parameterIndex] = this.get(dep.id);
        }
      }

      const instance = new descriptor.ctor(...args);

      // Cache singleton instances
      if (descriptor.singleton) {
        entry.instance = instance;
      }

      return instance;
    } finally {
      this._instantiating.delete(serviceId);
    }
  }

  /**
   * Dispose all instantiated services that implement IDisposable,
   * and clear the collection.
   */
  dispose(): void {
    if (this._disposed) {
      return;
    }
    this._disposed = true;

    for (const entry of this._entries.values()) {
      if (entry.instance && typeof (entry.instance as any).dispose === 'function') {
        try {
          (entry.instance as IDisposable).dispose();
        } catch {
          // Swallow disposal errors to ensure all services get disposed
        }
      }
    }
    this._entries.clear();
  }

  private _throwIfDisposed(): void {
    if (this._disposed) {
      throw new Error('ServiceCollection has been disposed');
    }
  }
}
