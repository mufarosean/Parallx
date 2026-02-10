// events.ts — event bus / emitters
//
// Typed event system with composition utilities.
// Every listener returns IDisposable for cleanup.
// Supports filtering, mapping, debounce, throttle, once, any (merge),
// defer (lazy), and development-mode leak tracking.

import { IDisposable, toDisposable, DisposableStore } from './lifecycle.js';

// ─── Leak Detection ──────────────────────────────────────────────────────────

/**
 * Global toggle for development-time listener leak detection.
 * When enabled, emitters warn if listener count exceeds a threshold.
 */
let _leakWarningThreshold = 0;
let _leakWarningEnabled = false;

/**
 * Enable event listener leak detection in development.
 * @param threshold Fire a console.warn when an emitter exceeds this many listeners.
 */
export function enableLeakWarnings(threshold = 25): void {
  _leakWarningThreshold = threshold;
  _leakWarningEnabled = true;
}

/**
 * Disable event listener leak detection.
 */
export function disableLeakWarnings(): void {
  _leakWarningEnabled = false;
}

// ─── Event Type ──────────────────────────────────────────────────────────────

/**
 * A function that represents an event that can be subscribed to.
 * Returns an IDisposable that unsubscribes the listener.
 */
export type Event<T> = (listener: (e: T) => void) => IDisposable;

// ─── Emitter ─────────────────────────────────────────────────────────────────

/**
 * A typed event emitter. Exposes an `event` property for subscription
 * and a `fire` method for dispatching.
 */
export class Emitter<T> implements IDisposable {
  private _listeners = new Set<(e: T) => void>();
  private _disposed = false;
  private _event: Event<T> | undefined;
  private _leakWarnCount = 0;

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

        // Leak detection
        if (_leakWarningEnabled) {
          this._leakWarnCount++;
          if (this._leakWarnCount > _leakWarningThreshold) {
            console.warn(
              `[Emitter] Potential listener leak detected: ${this._leakWarnCount} listeners.` +
              ` Use enableLeakWarnings() to configure threshold.`
            );
          }
        }

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

  /**
   * Number of active listeners.
   */
  get listenerCount(): number {
    return this._listeners.size;
  }

  dispose(): void {
    this._disposed = true;
    this._listeners.clear();
    this._event = undefined;
  }
}

// ─── Event Composition Utilities ─────────────────────────────────────────────

/**
 * Namespace for event composition functions.
 */
export namespace EventUtils {

  /**
   * Creates an event that fires only once, then automatically disposes.
   */
  export function once<T>(event: Event<T>): Event<T> {
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
   * Transform event payloads with a mapping function.
   */
  export function map<I, O>(event: Event<I>, fn: (value: I) => O): Event<O> {
    return (listener: (e: O) => void): IDisposable => {
      return event((value) => listener(fn(value)));
    };
  }

  /**
   * Filter events — only fire when the predicate returns true.
   */
  export function filter<T>(event: Event<T>, predicate: (value: T) => boolean): Event<T>;
  export function filter<T, U extends T>(event: Event<T>, predicate: (value: T) => value is U): Event<U>;
  export function filter<T>(event: Event<T>, predicate: (value: T) => boolean): Event<T> {
    return (listener: (e: T) => void): IDisposable => {
      return event((value) => {
        if (predicate(value)) {
          listener(value);
        }
      });
    };
  }

  /**
   * Merge multiple events into a single event that fires whenever any source fires.
   */
  export function any<T>(...events: Event<T>[]): Event<T> {
    return (listener: (e: T) => void): IDisposable => {
      const store = new DisposableStore();
      for (const event of events) {
        store.add(event(listener));
      }
      return store;
    };
  }

  /**
   * Creates a debounced version of an event.
   * The event fires after `delayMs` of silence.
   */
  export function debounce<T>(event: Event<T>, delayMs: number): Event<T> {
    return (listener: (e: T) => void): IDisposable => {
      let timeout: ReturnType<typeof setTimeout> | undefined;
      let lastValue: T | undefined;
      const sub = event((value) => {
        lastValue = value;
        if (timeout !== undefined) {
          clearTimeout(timeout);
        }
        timeout = setTimeout(() => {
          timeout = undefined;
          listener(lastValue!);
        }, delayMs);
      });
      return toDisposable(() => {
        if (timeout !== undefined) clearTimeout(timeout);
        sub.dispose();
      });
    };
  }

  /**
   * Creates a throttled version of an event.
   * The event fires at most once per `intervalMs`.
   */
  export function throttle<T>(event: Event<T>, intervalMs: number): Event<T> {
    return (listener: (e: T) => void): IDisposable => {
      let lastFired = 0;
      let pending: ReturnType<typeof setTimeout> | undefined;
      let lastValue: T | undefined;

      const sub = event((value) => {
        lastValue = value;
        const now = Date.now();
        const elapsed = now - lastFired;
        if (elapsed >= intervalMs) {
          lastFired = now;
          listener(value);
        } else if (pending === undefined) {
          pending = setTimeout(() => {
            pending = undefined;
            lastFired = Date.now();
            listener(lastValue!);
          }, intervalMs - elapsed);
        }
      });

      return toDisposable(() => {
        if (pending !== undefined) clearTimeout(pending);
        sub.dispose();
      });
    };
  }

  /**
   * Creates a lazy/deferred event that only subscribes to the source
   * when the first listener attaches.
   */
  export function defer<T>(eventFactory: () => Event<T>): Event<T> {
    let source: Event<T> | undefined;
    return (listener: (e: T) => void): IDisposable => {
      if (!source) {
        source = eventFactory();
      }
      return source(listener);
    };
  }

  /**
   * Creates an event from a DOM event on an element.
   */
  export function fromDOMEvent<K extends keyof HTMLElementEventMap>(
    element: HTMLElement,
    type: K,
  ): Event<HTMLElementEventMap[K]> {
    return (listener: (e: HTMLElementEventMap[K]) => void): IDisposable => {
      element.addEventListener(type, listener as EventListener);
      return toDisposable(() => element.removeEventListener(type, listener as EventListener));
    };
  }

  /**
   * Creates an Event that signals (fires undefined) when a promise settles.
   */
  export function fromPromise(promise: Promise<unknown>): Event<void> {
    const emitter = new Emitter<void>();
    promise.then(
      () => { emitter.fire(undefined as void); emitter.dispose(); },
      () => { emitter.fire(undefined as void); emitter.dispose(); },
    );
    return emitter.event;
  }

  /** An event that never fires. */
  export const None: Event<any> = () => toDisposable(() => {});
}

// ─── Legacy top-level helpers (forward to EventUtils) ────────────────────────

/** @deprecated Use EventUtils.once */
export function onceEvent<T>(event: Event<T>): Event<T> {
  return EventUtils.once(event);
}

/** @deprecated Use EventUtils.debounce */
export function debounceEvent<T>(
  event: Event<T>,
  delayMs: number,
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
  store: DisposableStore,
): void {
  store.add(event(listener));
}
