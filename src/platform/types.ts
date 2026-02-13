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


