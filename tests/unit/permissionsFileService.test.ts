// permissionsFileService.test.ts — pin .parallx/permissions.json bridge.
//
// Pins:
//   - PERMISSIONS_FILE_PATH constant
//   - load() with no fs OR no permissionService → no-op (isLoaded stays false)
//   - load() with file missing → isLoaded=true, no read attempt of content
//   - load() valid → loadPersistentOverrides called with file content; isLoaded=true
//   - load() exists() throw → isLoaded=true, no throw
//   - load() readFile throw → isLoaded=true, no throw
//   - setPermissionService subscribes to onDidChange → triggers save
//   - save is DEBOUNCED 500ms; multiple changes coalesce into one writeFile
//   - save only queued AFTER isLoaded=true (changes BEFORE load are ignored for save)
//   - save with empty overrides → no writeFile
//   - save uses serializeOverrides() output
//   - save with no writer → no-op (no throw)
//   - writer throw is swallowed
//
// Uses fake timers for the 500ms debounce.

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import {
  PermissionsFileService,
  PERMISSIONS_FILE_PATH,
  type IPermissionsFileWriter,
} from '../../src/services/permissionsFileService';
import type { IConfigFileSystem } from '../../src/services/parallxConfigService';
import { Emitter } from '../../src/platform/events';

class StubPermissionService {
  readonly _onDidChange = new Emitter<void>();
  readonly onDidChange = this._onDidChange.event;
  loadPersistentOverrides = vi.fn();
  getPersistentOverrides = vi.fn(() => this._overrides);
  serializeOverrides = vi.fn(() => JSON.stringify({ tools: Object.fromEntries(this._overrides) }));
  _overrides = new Map<string, string>();

  setOverride(tool: string, level: string): void {
    this._overrides.set(tool, level);
    this._onDidChange.fire();
  }
  clear(): void {
    this._overrides.clear();
    this._onDidChange.fire();
  }
}

function mkReader(files: Record<string, string>): IConfigFileSystem {
  return {
    exists: vi.fn(async (p: string) => p in files),
    readFile: vi.fn(async (p: string) => files[p]),
  } as IConfigFileSystem;
}

function mkWriter(): IPermissionsFileWriter & { writeFile: ReturnType<typeof vi.fn> } {
  return { writeFile: vi.fn(async () => {}) };
}

beforeEach(() => {
  vi.useFakeTimers();
});

afterEach(() => {
  vi.useRealTimers();
});

describe('PermissionsFileService — constants', () => {
  it('PERMISSIONS_FILE_PATH is ".parallx/permissions.json"', () => {
    expect(PERMISSIONS_FILE_PATH).toBe('.parallx/permissions.json');
  });
});

describe('PermissionsFileService — load', () => {
  it('no fs → no-op, isLoaded stays false', async () => {
    const svc = new PermissionsFileService();
    const perm = new StubPermissionService();
    svc.setPermissionService(perm as any);
    await svc.load();
    expect(svc.isLoaded).toBe(false);
    expect(perm.loadPersistentOverrides).not.toHaveBeenCalled();
  });

  it('no permissionService → no-op', async () => {
    const svc = new PermissionsFileService();
    svc.setFileSystem(mkReader({ [PERMISSIONS_FILE_PATH]: '{}' }));
    await svc.load();
    expect(svc.isLoaded).toBe(false);
  });

  it('file missing → isLoaded=true, no overrides loaded', async () => {
    const svc = new PermissionsFileService();
    const perm = new StubPermissionService();
    svc.setFileSystem(mkReader({}));
    svc.setPermissionService(perm as any);
    await svc.load();
    expect(svc.isLoaded).toBe(true);
    expect(perm.loadPersistentOverrides).not.toHaveBeenCalled();
  });

  it('file exists → loadPersistentOverrides called with content, isLoaded=true', async () => {
    const svc = new PermissionsFileService();
    const perm = new StubPermissionService();
    const content = '{"tools":{"writeFile":"allow"}}';
    svc.setFileSystem(mkReader({ [PERMISSIONS_FILE_PATH]: content }));
    svc.setPermissionService(perm as any);
    await svc.load();
    expect(svc.isLoaded).toBe(true);
    expect(perm.loadPersistentOverrides).toHaveBeenCalledWith(content);
  });

  it('exists() throw → caught, isLoaded=true', async () => {
    const svc = new PermissionsFileService();
    const perm = new StubPermissionService();
    svc.setFileSystem({
      exists: async () => { throw new Error('io'); },
      readFile: async () => '',
    } as any);
    svc.setPermissionService(perm as any);
    await svc.load();
    expect(svc.isLoaded).toBe(true);
    expect(perm.loadPersistentOverrides).not.toHaveBeenCalled();
  });

  it('readFile throw → caught, isLoaded=true', async () => {
    const svc = new PermissionsFileService();
    const perm = new StubPermissionService();
    svc.setFileSystem({
      exists: async () => true,
      readFile: async () => { throw new Error('io'); },
    } as any);
    svc.setPermissionService(perm as any);
    await svc.load();
    expect(svc.isLoaded).toBe(true);
  });
});

describe('PermissionsFileService — debounced save', () => {
  it('changes BEFORE load are NOT saved (save queue requires isLoaded)', async () => {
    const svc = new PermissionsFileService();
    const perm = new StubPermissionService();
    const writer = mkWriter();
    svc.setFileSystem(mkReader({}));
    svc.setFileWriter(writer);
    svc.setPermissionService(perm as any);
    perm.setOverride('writeFile', 'allow');
    await vi.advanceTimersByTimeAsync(600);
    expect(writer.writeFile).not.toHaveBeenCalled();
  });

  it('one change after load → one writeFile after 500ms debounce', async () => {
    const svc = new PermissionsFileService();
    const perm = new StubPermissionService();
    const writer = mkWriter();
    svc.setFileSystem(mkReader({}));
    svc.setFileWriter(writer);
    svc.setPermissionService(perm as any);
    await svc.load();
    perm.setOverride('writeFile', 'allow');
    expect(writer.writeFile).not.toHaveBeenCalled();
    await vi.advanceTimersByTimeAsync(499);
    expect(writer.writeFile).not.toHaveBeenCalled();
    await vi.advanceTimersByTimeAsync(2);
    expect(writer.writeFile).toHaveBeenCalledTimes(1);
    expect(writer.writeFile).toHaveBeenCalledWith(
      PERMISSIONS_FILE_PATH,
      perm.serializeOverrides(),
    );
  });

  it('multiple changes within the debounce window coalesce into ONE writeFile', async () => {
    const svc = new PermissionsFileService();
    const perm = new StubPermissionService();
    const writer = mkWriter();
    svc.setFileWriter(writer);
    svc.setFileSystem(mkReader({}));
    svc.setPermissionService(perm as any);
    await svc.load();
    perm.setOverride('a', 'allow');
    await vi.advanceTimersByTimeAsync(100);
    perm.setOverride('b', 'allow');
    await vi.advanceTimersByTimeAsync(100);
    perm.setOverride('c', 'allow');
    await vi.advanceTimersByTimeAsync(600);
    expect(writer.writeFile).toHaveBeenCalledTimes(1);
  });

  it('empty overrides → no writeFile', async () => {
    const svc = new PermissionsFileService();
    const perm = new StubPermissionService();
    const writer = mkWriter();
    svc.setFileWriter(writer);
    svc.setFileSystem(mkReader({}));
    svc.setPermissionService(perm as any);
    await svc.load();
    perm.clear();
    await vi.advanceTimersByTimeAsync(600);
    expect(writer.writeFile).not.toHaveBeenCalled();
  });

  it('no writer bound → save no-ops (no throw)', async () => {
    const svc = new PermissionsFileService();
    const perm = new StubPermissionService();
    svc.setFileSystem(mkReader({}));
    svc.setPermissionService(perm as any);
    await svc.load();
    perm.setOverride('a', 'allow');
    await vi.advanceTimersByTimeAsync(600);
    // no writer = no throw, no writeFile
  });

  it('writer throw is swallowed', async () => {
    const svc = new PermissionsFileService();
    const perm = new StubPermissionService();
    const writer: IPermissionsFileWriter = { writeFile: async () => { throw new Error('disk'); } };
    svc.setFileWriter(writer);
    svc.setFileSystem(mkReader({}));
    svc.setPermissionService(perm as any);
    await svc.load();
    perm.setOverride('a', 'allow');
    await vi.advanceTimersByTimeAsync(600);
    // swallowed — no rejection visible
  });
});
