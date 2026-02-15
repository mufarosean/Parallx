// instantiation.ts — service instantiation utilities
//
// Provides constructor-parameter injection decorators, service descriptors
// (singleton / transient), and a standalone `createInstance` function
// that resolves dependencies from a service provider.

import { ServiceIdentifier } from './types.js';

/**
 * Metadata key used to store service dependency information on classes.
 */
const SERVICE_DEPENDENCIES_KEY = Symbol('serviceDependencies');

/**
 * Descriptor for a service dependency on a constructor parameter.
 */
interface ServiceDependency {
  readonly id: ServiceIdentifier<any>;
  readonly parameterIndex: number;
  readonly optional: boolean;
}

/**
 * Decorator factory that marks a constructor parameter as a service dependency.
 *
 * Usage:
 * ```ts
 * class MyService {
 *   constructor(@inject(ILayoutService) private layout: ILayoutService) {}
 * }
 * ```
 */
export function inject(serviceId: ServiceIdentifier<any>) {
  return function (target: any, _propertyKey: string | symbol | undefined, parameterIndex: number) {
    const deps: ServiceDependency[] = getServiceDependencies(target);
    deps.push({ id: serviceId, parameterIndex, optional: false });
    setServiceDependencies(target, deps);
  };
}

/**
 * Decorator factory for optional service dependencies.
 * If the service is not registered, undefined is injected.
 */
export function injectOptional(serviceId: ServiceIdentifier<any>) {
  return function (target: any, _propertyKey: string | symbol | undefined, parameterIndex: number) {
    const deps: ServiceDependency[] = getServiceDependencies(target);
    deps.push({ id: serviceId, parameterIndex, optional: true });
    setServiceDependencies(target, deps);
  };
}

/**
 * Retrieves service dependencies registered on a constructor.
 */
export function getServiceDependencies(target: any): ServiceDependency[] {
  const deps = (target as any)[SERVICE_DEPENDENCIES_KEY];
  return deps ? [...deps] : [];
}

/**
 * Store service dependencies on a constructor.
 */
function setServiceDependencies(target: any, deps: ServiceDependency[]): void {
  Object.defineProperty(target, SERVICE_DEPENDENCIES_KEY, {
    value: deps,
    enumerable: false,
    configurable: true,
    writable: true,
  });
}

/**
 * Service descriptor that defines how a service is created and its lifetime.
 */
export interface ServiceDescriptor<T> {
  readonly id: ServiceIdentifier<T>;
  readonly ctor: new (...args: any[]) => T;
  readonly singleton: boolean;
}

/**
 * Creates a service descriptor for a singleton service.
 */
export function singleton<T>(
  id: ServiceIdentifier<T>,
  ctor: new (...args: any[]) => T
): ServiceDescriptor<T> {
  return { id, ctor, singleton: true };
}

/**
 * Creates a service descriptor for a transient service (new instance each time).
 */
export function transient<T>(
  id: ServiceIdentifier<T>,
  ctor: new (...args: any[]) => T
): ServiceDescriptor<T> {
  return { id, ctor, singleton: false };
}

// ─── Service Provider ────────────────────────────────────────────────────────

/**
 * Minimal interface for service resolution — used by `createInstance`.
 */
export interface IServiceProvider {
  get<T>(id: ServiceIdentifier<T>): T;
  has(id: ServiceIdentifier<any>): boolean;
}

// ─── createInstance ──────────────────────────────────────────────────────────

/**
 * Thrown when a required service dependency cannot be resolved.
 */
class MissingDependencyError extends Error {
  constructor(
    ctor: Function,
    dep: ServiceDependency,
  ) {
    super(
      `Cannot instantiate ${ctor.name ?? 'anonymous class'}:` +
      ` missing required service "${dep.id.id}" at parameter index ${dep.parameterIndex}.` +
      ` Register the service before calling createInstance, or use @injectOptional.`
    );
    this.name = 'MissingDependencyError';
  }
}

/**
 * Instantiate a class by resolving its `@inject`-decorated constructor
 * dependencies from the given service provider, plus any extra arguments
 * that fill non-decorated parameter positions.
 *
 * @param provider  Service provider for resolving dependencies
 * @param ctor      Class constructor
 * @param extraArgs Additional arguments for non-decorated parameters
 */
export function createInstance<T>(
  provider: IServiceProvider,
  ctor: new (...args: any[]) => T,
  ...extraArgs: any[]
): T {
  const deps = getServiceDependencies(ctor)
    .sort((a, b) => a.parameterIndex - b.parameterIndex);

  // Figure out the total number of constructor params
  const maxIndex = deps.length > 0
    ? Math.max(ctor.length, deps[deps.length - 1].parameterIndex + 1)
    : ctor.length;

  const args: any[] = new Array(maxIndex);

  // Place service dependencies
  for (const dep of deps) {
    if (dep.optional && !provider.has(dep.id)) {
      args[dep.parameterIndex] = undefined;
    } else if (!dep.optional && !provider.has(dep.id)) {
      throw new MissingDependencyError(ctor, dep);
    } else {
      args[dep.parameterIndex] = provider.get(dep.id);
    }
  }

  // Fill remaining slots with extraArgs (in order, skipping service-filled slots)
  let extraIdx = 0;
  for (let i = 0; i < maxIndex && extraIdx < extraArgs.length; i++) {
    if (args[i] === undefined && !deps.some(d => d.parameterIndex === i)) {
      args[i] = extraArgs[extraIdx++];
    }
  }

  return new ctor(...args);
}
