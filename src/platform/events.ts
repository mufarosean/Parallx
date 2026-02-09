// events.ts — event bus / emitters

import { IDisposable, toDisposable, DisposableStore } from './lifecycle.js';

/**
 * A function that represents an event that can be subscribed to.
 * Returns an IDisposable that unsubscribes the listener.
 */
export type Event<T> = (listener: (e: T) => void) => IDisposable;

/**
 * A typed event emitter. Exposes an `event` property for subscription
 * and a `fire` method for dispatching.
 */
export class Emitter<T> implements IDisposable {
  private _listeners = new Set<(e: T) => void>();
  private _disposed = false;
  private _event: Event<T> | undefined;

  /**
   * The event function that listeners subscribe to.
   */
  get event(): Event<T> {
    if (!this._event) {
      this._event = (listener: (e: T) => void): IDisposable => {
        if (this._disposed) {
          return toDisposable(() => {});
        }
        this._listeners.add(listener);
        return toDisposable(() => {
          this._listeners.delete(listener);
        });
      };
    }
    return this._event;
  }

  /**
   * Fire the event, notifying all listeners.
   */
  fire(event: T): void {
    if (this._disposed) {
      return;
    }
    for (const listener of [...this._listeners]) {
      listener(event);
    }
  }

  /**
   * Check if there are any listeners.
   */
  get hasListeners(): boolean {
    return this._listeners.size > 0;
  }

  dispose(): void {
    this._disposed = true;
    this._listeners.clear();
    this._event = undefined;
  }
}

/**
 * Creates an event that fires only once, then automatically disposes.
 */
export function onceEvent<T>(event: Event<T>): Event<T> {
  return (listener: (e: T) => void): IDisposable => {
    let didFire = false;
    const subscription = event((e) => {
      if (!didFire) {
        didFire = true;
        subscription.dispose();
        listener(e);
      }
    });
    if (didFire) {
      subscription.dispose();
    }
    return subscription;
  };
}

/**
 * Creates a debounced version of an event.
 */
export function debounceEvent<T>(
  event: Event<T>,
  delayMs: number
): { event: Event<T>; dispose(): void } {
  const emitter = new Emitter<T>();
  let timeout: ReturnType<typeof setTimeout> | undefined;
  let lastValue: T | undefined;

  const subscription = event((value) => {
    lastValue = value;
    if (timeout !== undefined) {
      clearTimeout(timeout);
    }
    timeout = setTimeout(() => {
      timeout = undefined;
      emitter.fire(lastValue!);
    }, delayMs);
  });

  return {
    event: emitter.event,
    dispose() {
      if (timeout !== undefined) {
        clearTimeout(timeout);
      }
      subscription.dispose();
      emitter.dispose();
    },
  };
}

/**
 * Collects events from an emitter into a DisposableStore for bulk cleanup.
 */
export function listenTo<T>(
  event: Event<T>,
  listener: (e: T) => void,
  store: DisposableStore
): void {
  store.add(event(listener));
}
