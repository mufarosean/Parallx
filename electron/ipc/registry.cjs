// registry.cjs — M86-W6 typed IPC handler registry
//
// Goal: every IPC handler declares its access policy at the registration
// site, and the registry — not the handler body — enforces it. This
// eliminates the M85-W2/F2 bug class ("allowlist forgotten on this
// handler") by making policy a required field of the registration call.
//
// Surface:
//
//   defineHandler({
//     name: 'fs:readFile',
//     policy: 'allowlistRead',                 // see POLICIES below
//     pathArgIndex: 0,                          // for path-gated policies
//     validate: (args) => { ... } | undefined,  // optional input check
//     handler: async (event, ...args) => { ... },
//   });
//
// The registry calls ipcMain.handle internally; it adds:
//   - policy enforcement (read/write allowlist OR workspaceOnly)
//   - input validation
//   - uniform error shape: { error: { code, message, path? } } on EACCES /
//     EINVAL; original return shape on success.
//
// Authors who define a handler without a `policy` field get a thrown
// error at registration time, so a missed policy can never reach
// production. The list of registered handlers is queryable via
// listHandlers() for runtime diagnostics.
//
// This file is intentionally CJS to live alongside electron/main.cjs.
// All types are documented in JSDoc; consumers in TypeScript can use the
// d.ts at electron/ipc/registry.d.ts (sibling file).

// Load `electron` lazily so this module can be required under vitest's
// node runner (where the real `electron` module isn't available). Tests
// inject a stub via `_setIpcMainForTests`.
/** @type {{ handle(name: string, fn: Function): void } | null} */
let _ipcMain = null;
try {
  _ipcMain = require('electron').ipcMain;
} catch (_e) {
  _ipcMain = null;
}

/**
 * Override ipcMain — used by tier-0 tests that load this module under
 * vitest (where the real `electron` module isn't available). Production
 * code does not call this.
 */
function _setIpcMainForTests(stub) {
  _ipcMain = stub;
}

/**
 * @typedef {'public' | 'allowlistRead' | 'allowlistWrite' | 'workspaceOnly' | 'internal'} Policy
 *
 * - public:         no path/workspace gating. Use for handlers that don't
 *                   accept paths (e.g. window:isMaximized).
 * - allowlistRead:  first path-typed arg is checked against the read
 *                   allowlist (workspace, app, data, home/.parallx, tmp,
 *                   user-blessed extras).
 * - allowlistWrite: first path-typed arg is checked against the write
 *                   allowlist (workspace + user-blessed extras only —
 *                   stricter than read).
 * - workspaceOnly:  handler requires an active workspace root.
 * - internal:       handler should not be exposed to ext webviews. Reserved
 *                   for future W9 enforcement.
 */
const POLICIES = ['public', 'allowlistRead', 'allowlistWrite', 'workspaceOnly', 'internal'];

/** @type {Map<string, { policy: Policy, pathArgIndex: number | null }>} */
const _registry = new Map();

/** @type {{ isAllowedReadPath?: (p: string) => boolean, isAllowedWritePath?: (p: string) => boolean, getWorkspaceRoot?: () => string | null }} */
const _guards = {};

/**
 * Wire the path-allowlist guards from main.cjs into the registry. Called
 * once at startup before any defineHandler() calls — without this,
 * allowlistRead/Write policies fail closed.
 */
function configureGuards(guards) {
  if (guards.isAllowedReadPath) _guards.isAllowedReadPath = guards.isAllowedReadPath;
  if (guards.isAllowedWritePath) _guards.isAllowedWritePath = guards.isAllowedWritePath;
  if (guards.getWorkspaceRoot) _guards.getWorkspaceRoot = guards.getWorkspaceRoot;
}

function _eaccessReadResult(path) {
  return { error: { code: 'EACCES', message: 'Read path is outside the allowed roots', path } };
}

function _eaccessWriteResult(path) {
  return { error: { code: 'EACCES', message: 'Write path is outside the workspace root', path } };
}

function _noWorkspaceResult() {
  return { error: { code: 'ENOWORKSPACE', message: 'No workspace is open' } };
}

function _einvalResult(message) {
  return { error: { code: 'EINVAL', message } };
}

/**
 * Register a typed IPC handler.
 *
 * @param {{
 *   name: string,
 *   policy: Policy,
 *   pathArgIndex?: number,
 *   validate?: (args: unknown[]) => string | null | undefined,
 *   handler: (event: Electron.IpcMainInvokeEvent, ...args: any[]) => any
 * }} spec
 */
function defineHandler(spec) {
  if (!spec || typeof spec !== 'object') {
    throw new Error('defineHandler: spec is required');
  }
  if (typeof spec.name !== 'string' || spec.name.length === 0) {
    throw new Error('defineHandler: name is required');
  }
  if (!POLICIES.includes(spec.policy)) {
    throw new Error(`defineHandler(${spec.name}): policy must be one of ${POLICIES.join(', ')}; got ${spec.policy}`);
  }
  if (typeof spec.handler !== 'function') {
    throw new Error(`defineHandler(${spec.name}): handler must be a function`);
  }
  if ((spec.policy === 'allowlistRead' || spec.policy === 'allowlistWrite') && typeof spec.pathArgIndex !== 'number') {
    throw new Error(`defineHandler(${spec.name}): policy ${spec.policy} requires pathArgIndex`);
  }
  if (_registry.has(spec.name)) {
    throw new Error(`defineHandler(${spec.name}): handler already registered`);
  }

  const pathArgIndex = typeof spec.pathArgIndex === 'number' ? spec.pathArgIndex : null;
  _registry.set(spec.name, { policy: spec.policy, pathArgIndex });

  if (!_ipcMain) {
    throw new Error(`defineHandler(${spec.name}): ipcMain is not available (test setup forgot _setIpcMainForTests?)`);
  }
  _ipcMain.handle(spec.name, async (event, ...args) => {
    // 1. Custom validation, if any.
    if (typeof spec.validate === 'function') {
      const msg = spec.validate(args);
      if (typeof msg === 'string' && msg.length > 0) {
        return _einvalResult(msg);
      }
    }

    // 2. Policy enforcement.
    switch (spec.policy) {
      case 'public':
      case 'internal':
        break;
      case 'allowlistRead': {
        const p = args[pathArgIndex];
        if (typeof p !== 'string' || p.length === 0) {
          return _einvalResult('path argument missing');
        }
        const guard = _guards.isAllowedReadPath;
        if (typeof guard !== 'function') {
          return _eaccessReadResult(p);
        }
        if (!guard(p)) {
          return _eaccessReadResult(p);
        }
        break;
      }
      case 'allowlistWrite': {
        const p = args[pathArgIndex];
        if (typeof p !== 'string' || p.length === 0) {
          return _einvalResult('path argument missing');
        }
        const guard = _guards.isAllowedWritePath;
        if (typeof guard !== 'function') {
          return _eaccessWriteResult(p);
        }
        if (!guard(p)) {
          return _eaccessWriteResult(p);
        }
        break;
      }
      case 'workspaceOnly': {
        const root = _guards.getWorkspaceRoot ? _guards.getWorkspaceRoot() : null;
        if (!root) return _noWorkspaceResult();
        break;
      }
    }

    // 3. Run the handler.
    return spec.handler(event, ...args);
  });
}

/** Returns the registered handler metadata for diagnostics. */
function listHandlers() {
  /** @type {Array<{ name: string, policy: Policy }>} */
  const out = [];
  for (const [name, meta] of _registry.entries()) {
    out.push({ name, policy: meta.policy });
  }
  out.sort((a, b) => a.name.localeCompare(b.name));
  return out;
}

/** Test-only: clear the registry. Production callers should never need this. */
function _resetForTests() {
  _registry.clear();
  delete _guards.isAllowedReadPath;
  delete _guards.isAllowedWritePath;
  delete _guards.getWorkspaceRoot;
}

module.exports = {
  defineHandler,
  configureGuards,
  listHandlers,
  POLICIES,
  _resetForTests,
  _setIpcMainForTests,
};
