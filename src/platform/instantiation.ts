// instantiation.ts — service instantiation utilities

import { ServiceIdentifier, createServiceIdentifier } from './types.js';

/**
 * Metadata key used to store service dependency information on classes.
 */
const SERVICE_DEPENDENCIES_KEY = Symbol('serviceDependencies');

/**
 * Descriptor for a service dependency on a constructor parameter.
 */
export interface ServiceDependency {
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
