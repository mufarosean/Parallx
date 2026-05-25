// uiCache.ts — M86-W7
//
// Module-level singleton for sync-cached UI state that used to live in
// localStorage:
//
//   - canvas.propertyBar.collapsed  (boolean — propertyBar.ts)
//   - parallx-canvas-recent-text-colors  (string[] — canvasMenuRegistry.ts)
//   - parallx-canvas-recent-bg-colors    (string[] — canvasMenuRegistry.ts)
//
// The workbench calls initUiCache(globalStorage) during Phase 1 (after
// the global-storage warmup) so by the time any view code calls
// uiCacheGet() the underlying cache is already populated.
//
// uiCacheGet() before init returns undefined; uiCacheSet() before init
// queues into a temporary buffer that flushes on init. This keeps view
// constructors agnostic to boot order.

import { SyncCachedStorage } from './syncCachedStorage.js';
import type { IStorage } from './storage.js';

const NAMESPACE = 'ui-cache:';

let _cache: SyncCachedStorage<unknown> | undefined;
const _pending = new Map<string, unknown>();

/**
 * Initialise and warm the cache. Idempotent: subsequent calls reuse the
 * existing instance. Flushes any sets recorded before init landed.
 */
export async function initUiCache(storage: IStorage): Promise<void> {
  if (_cache) return;
  _cache = new SyncCachedStorage<unknown>(storage, NAMESPACE);
  await _cache.warm();
  if (_pending.size > 0) {
    for (const [k, v] of _pending) {
      // Fire-and-forget — caller already returned.
      _cache.set(k, v).catch(() => { /* IStorage owns error reporting */ });
    }
    _pending.clear();
  }
}

export function uiCacheGet<T>(key: string): T | undefined {
  if (!_cache) return undefined;
  return _cache.get(key) as T | undefined;
}

export function uiCacheSet<T>(key: string, value: T): void {
  if (!_cache) {
    _pending.set(key, value);
    return;
  }
  void _cache.set(key, value);
}

/** Test-only reset hook. */
export function _resetUiCacheForTests(): void {
  _cache = undefined;
  _pending.clear();
}
