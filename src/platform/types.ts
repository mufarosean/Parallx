// types.ts — shared platform types and utilities

/**
 * A unique identifier type branded with a tag for type safety.
 */
export type ServiceIdentifier<T> = {
  readonly _brand: T;
  readonly id: string;
  toString(): string;
};

/**
 * Creates a service identifier that can be used as a key for dependency injection.
 */
export function createServiceIdentifier<T>(id: string): ServiceIdentifier<T> {
  const identifier = {
    _brand: undefined as unknown as T,
    id,
    toString() {
      return `ServiceIdentifier(${id})`;
    },
  };
  return identifier;
}

/**
 * Constructor type that can be instantiated with `new`.
 */
export type Constructor<T = any> = new (...args: any[]) => T;

/**
 * A function that returns void, used for callbacks and handlers.
 */
export type VoidFunction = () => void;

/**
 * Represents a value that may be a promise.
 */
export type MaybePromise<T> = T | Promise<T>;

/**
 * Represents a value that may be undefined.
 */
export type Optional<T> = T | undefined;

/**
 * URI-like identifier for resources.
 */
export interface URI {
  readonly scheme: string;
  readonly authority: string;
  readonly path: string;
  readonly query: string;
  readonly fragment: string;
}
