// registry.ts — a set of things tools register while they run.
//
// Several contribution points share one shape: a tool registers an item
// under a stable id, anyone can list the items, and a change event fires
// when one comes or goes. The returned disposable removes the item, but
// only if it is still the one registered (a replacement stays). This is
// that shape, once, so each contribution point is a type and a sentence.

import { Emitter, type Event } from './events.js';
import { toDisposable, type IDisposable } from './lifecycle.js';

export interface Registry<T> {
  /** Register `item` under `key`; the same key again replaces the earlier item. */
  register(key: string, item: T): IDisposable;
  /** The item registered under `key`, if any. */
  get(key: string): T | undefined;
  /** Every registered item, in registration order. */
  list(): readonly T[];
  /** Fires after an item is registered or removed. */
  readonly onDidChange: Event<void>;
}

export function createRegistry<T>(): Registry<T> {
  const items = new Map<string, T>();
  const onDidChange = new Emitter<void>();
  return {
    register(key, item) {
      items.set(key, item);
      onDidChange.fire();
      return toDisposable(() => {
        if (items.get(key) === item) { items.delete(key); onDidChange.fire(); }
      });
    },
    get: (key) => items.get(key),
    list: () => [...items.values()],
    onDidChange: onDidChange.event,
  };
}
