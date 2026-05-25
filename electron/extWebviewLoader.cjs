/**
 * electron/extWebviewLoader.cjs — M86-W9 webview-per-extension scaffold.
 *
 * Future-state: each Parallx extension renders into its own webview
 * process, so a runaway timer or wedged require() in one ext cannot
 * stall the workbench shell. This file is the SCAFFOLD only:
 *
 *   1. Resolves the on-disk path to an extension's webview entry
 *      (`ext/<name>/webview/index.html`) when one exists.
 *   2. Returns a uniform descriptor `{ id, name, htmlPath, preloadPath,
 *      partition }` the main process can hand to `<webview>` tags.
 *   3. Exposes a `crashHandler` factory the shell uses to swap a
 *      crashed ext for a recoverable placeholder.
 *
 * The actual `<webview>` wiring (slot/coordinator model) lands in the
 * follow-up work item. For now, the shell continues to load every
 * extension in-process; this loader exists so the ext author has a
 * stable contract to target.
 */

'use strict';

const path = require('node:path');
const fs   = require('node:fs');

const SCHEMA_VERSION = 1;

/** Map extension id → partition name. Persisted partitions survive reloads. */
function partitionFor(extId) {
  if (typeof extId !== 'string' || !extId) {
    throw new Error('extWebviewLoader: extId must be a non-empty string');
  }
  // `persist:` makes the partition durable across sessions so caches
  // and IndexedDB stick around. Same scheme VS Code uses.
  return `persist:ext-${extId.replace(/[^a-zA-Z0-9._-]/g, '-')}`;
}

/**
 * Resolve a webview descriptor for `extDir`. Returns `null` when the
 * extension has no `webview/index.html` (i.e. it's still running
 * in-process; the loader is a no-op).
 */
function resolveWebviewDescriptor(extDir) {
  if (typeof extDir !== 'string' || !extDir) return null;
  let manifest;
  try {
    const raw = fs.readFileSync(path.join(extDir, 'parallx-manifest.json'), 'utf8');
    manifest = JSON.parse(raw);
  } catch {
    return null;
  }
  if (!manifest || typeof manifest.id !== 'string') return null;

  const htmlPath = path.join(extDir, 'webview', 'index.html');
  if (!fs.existsSync(htmlPath)) return null;

  const preloadPath = path.join(extDir, 'webview', 'preload.cjs');
  const hasPreload = fs.existsSync(preloadPath);

  return {
    schemaVersion: SCHEMA_VERSION,
    id: manifest.id,
    name: typeof manifest.name === 'string' ? manifest.name : manifest.id,
    htmlPath,
    preloadPath: hasPreload ? preloadPath : null,
    partition: partitionFor(manifest.id),
  };
}

/**
 * Build a one-shot crash handler the shell wires into each webview's
 * `crashed`/`gpu-crashed` event. Calls `onCrash` with the descriptor +
 * reason so the shell can render a placeholder and offer reload.
 */
function makeCrashHandler(descriptor, onCrash) {
  if (!descriptor || typeof onCrash !== 'function') {
    throw new Error('extWebviewLoader: descriptor + onCrash callback required');
  }
  let _fired = false;
  return function crashHandler(event, reason) {
    if (_fired) return;
    _fired = true;
    try {
      onCrash({
        extId: descriptor.id,
        name: descriptor.name,
        reason: typeof reason === 'string' ? reason : 'unknown',
        event: event && typeof event === 'object' ? { type: event.type } : null,
      });
    } catch (err) {
      // Crash handlers are last-line-of-defense; swallow secondary
      // failures so we don't take down the shell with them.
      console.error('[extWebviewLoader] crashHandler onCrash threw:', err);
    }
  };
}

module.exports = {
  SCHEMA_VERSION,
  partitionFor,
  resolveWebviewDescriptor,
  makeCrashHandler,
};
