// ipcRegistry.test.ts — M86-W6 typed IPC handler registry tests
//
// Tier-0 test. Uses vitest's module-mock to stub electron's `ipcMain` so
// the registry can be loaded without an Electron runtime. Verifies:
//
//   1. defineHandler rejects bad specs (missing name/policy/handler,
//      duplicate registration, allowlist policy without pathArgIndex).
//   2. Policies enforce correctly: public, allowlistRead, allowlistWrite,
//      workspaceOnly. Each returns the documented uniform error shape on
//      denial.
//   3. validate() runs before policy and short-circuits with EINVAL.
//   4. listHandlers() returns a sorted snapshot of registered names.
//
// The registry calls `ipcMain.handle(name, fn)`. Our mock captures every
// (name, fn) pair so the test can invoke handlers as the renderer would.
import { describe, it, expect, beforeEach } from 'vitest';

// Stub electron.ipcMain by injection. The registry tries to
// `require('electron')` at load time and falls back to null when it
// fails (which is what happens under the vitest node runner), then
// accepts an injected stub via `_setIpcMainForTests`.
type Handler = (event: unknown, ...args: unknown[]) => unknown;
const _handlers = new Map<string, Handler>();
const ipcMainStub = {
  handle(name: string, fn: Handler) {
    _handlers.set(name, fn);
  },
};

// Lazy-load registry (CJS).
const registry = await import('../../../electron/ipc/registry.cjs');
const { defineHandler, configureGuards, listHandlers, _resetForTests, _setIpcMainForTests } =
  registry as {
    defineHandler: (spec: Record<string, unknown>) => void;
    configureGuards: (g: Record<string, unknown>) => void;
    listHandlers: () => Array<{ name: string; policy: string }>;
    _resetForTests: () => void;
    _setIpcMainForTests: (stub: { handle: (n: string, fn: Handler) => void }) => void;
  };
_setIpcMainForTests(ipcMainStub);

async function invoke(name: string, ...args: unknown[]): Promise<unknown> {
  const fn = _handlers.get(name);
  if (!fn) throw new Error(`no handler registered: ${name}`);
  return fn({} as unknown, ...args);
}

describe('M86-W6 ipcRegistry', () => {
  beforeEach(() => {
    _resetForTests();
    _handlers.clear();
  });

  // ── Spec validation ────────────────────────────────────────────────────

  it('throws if name is missing', () => {
    expect(() => defineHandler({ policy: 'public', handler: () => 1 })).toThrow(/name/);
  });

  it('throws if policy is unknown', () => {
    expect(() =>
      defineHandler({ name: 'x', policy: 'bogus', handler: () => 1 }),
    ).toThrow(/policy/);
  });

  it('throws if handler is not a function', () => {
    expect(() =>
      defineHandler({ name: 'x', policy: 'public', handler: 'nope' }),
    ).toThrow(/handler/);
  });

  it('throws on duplicate registration', () => {
    defineHandler({ name: 'dup', policy: 'public', handler: () => 1 });
    expect(() =>
      defineHandler({ name: 'dup', policy: 'public', handler: () => 2 }),
    ).toThrow(/already registered/);
  });

  it('requires pathArgIndex for allowlistRead', () => {
    expect(() =>
      defineHandler({ name: 'r', policy: 'allowlistRead', handler: () => 1 }),
    ).toThrow(/pathArgIndex/);
  });

  it('requires pathArgIndex for allowlistWrite', () => {
    expect(() =>
      defineHandler({ name: 'w', policy: 'allowlistWrite', handler: () => 1 }),
    ).toThrow(/pathArgIndex/);
  });

  // ── public policy ──────────────────────────────────────────────────────

  it('public policy passes args straight through', async () => {
    defineHandler({
      name: 'public:echo',
      policy: 'public',
      handler: (_e, a) => ({ got: a }),
    });
    expect(await invoke('public:echo', 42)).toEqual({ got: 42 });
  });

  // ── allowlistRead ──────────────────────────────────────────────────────

  it('allowlistRead returns EACCES when guard rejects', async () => {
    configureGuards({ isAllowedReadPath: (p: string) => p.startsWith('/ok') });
    defineHandler({
      name: 'r:read',
      policy: 'allowlistRead',
      pathArgIndex: 0,
      handler: () => ({ content: 'data' }),
    });
    const res = (await invoke('r:read', '/nope/file')) as {
      error: { code: string; path: string };
    };
    expect(res.error.code).toBe('EACCES');
    expect(res.error.path).toBe('/nope/file');
  });

  it('allowlistRead fails closed when no guard is configured', async () => {
    defineHandler({
      name: 'r:read2',
      policy: 'allowlistRead',
      pathArgIndex: 0,
      handler: () => ({ content: 'data' }),
    });
    const res = (await invoke('r:read2', '/whatever')) as { error: { code: string } };
    expect(res.error.code).toBe('EACCES');
  });

  it('allowlistRead lets a valid path through', async () => {
    configureGuards({ isAllowedReadPath: () => true });
    defineHandler({
      name: 'r:ok',
      policy: 'allowlistRead',
      pathArgIndex: 0,
      handler: () => ({ content: 'data' }),
    });
    expect(await invoke('r:ok', '/anywhere')).toEqual({ content: 'data' });
  });

  it('allowlistRead returns EINVAL when path arg is missing', async () => {
    configureGuards({ isAllowedReadPath: () => true });
    defineHandler({
      name: 'r:missing',
      policy: 'allowlistRead',
      pathArgIndex: 0,
      handler: () => ({ content: 'data' }),
    });
    const res = (await invoke('r:missing')) as { error: { code: string } };
    expect(res.error.code).toBe('EINVAL');
  });

  // ── allowlistWrite ─────────────────────────────────────────────────────

  it('allowlistWrite returns EACCES on reject', async () => {
    configureGuards({ isAllowedWritePath: () => false });
    defineHandler({
      name: 'w:write',
      policy: 'allowlistWrite',
      pathArgIndex: 0,
      handler: () => ({ error: null }),
    });
    const res = (await invoke('w:write', '/x')) as { error: { code: string } };
    expect(res.error.code).toBe('EACCES');
  });

  // ── workspaceOnly ──────────────────────────────────────────────────────

  it('workspaceOnly returns ENOWORKSPACE when no workspace is open', async () => {
    configureGuards({ getWorkspaceRoot: () => null });
    defineHandler({
      name: 'ws:op',
      policy: 'workspaceOnly',
      handler: () => ({ ok: true }),
    });
    const res = (await invoke('ws:op')) as { error: { code: string } };
    expect(res.error.code).toBe('ENOWORKSPACE');
  });

  it('workspaceOnly passes through when a workspace root exists', async () => {
    configureGuards({ getWorkspaceRoot: () => '/ws' });
    defineHandler({
      name: 'ws:op2',
      policy: 'workspaceOnly',
      handler: () => ({ ok: true }),
    });
    expect(await invoke('ws:op2')).toEqual({ ok: true });
  });

  // ── validate ───────────────────────────────────────────────────────────

  it('validate() short-circuits with EINVAL before policy', async () => {
    defineHandler({
      name: 'v:check',
      policy: 'public',
      validate: (args: unknown[]) => (typeof args[0] === 'string' ? null : 'first arg must be string'),
      handler: () => 'ok',
    });
    const res = (await invoke('v:check', 123)) as { error: { code: string; message: string } };
    expect(res.error.code).toBe('EINVAL');
    expect(res.error.message).toMatch(/first arg/);
  });

  // ── listHandlers ───────────────────────────────────────────────────────

  it('listHandlers returns a sorted snapshot of registered handlers', () => {
    defineHandler({ name: 'z', policy: 'public', handler: () => 1 });
    defineHandler({ name: 'a', policy: 'public', handler: () => 1 });
    defineHandler({ name: 'm', policy: 'public', handler: () => 1 });
    expect(listHandlers().map((h) => h.name)).toEqual(['a', 'm', 'z']);
  });
});
