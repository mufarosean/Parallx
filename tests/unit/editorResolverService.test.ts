// editorResolverService.test.ts — pin EditorResolverService.
//
// Pins:
//   - registerEditor appends + sorts by priority DESC (highest first).
//   - returned disposable removes only THIS registration.
//   - disposable is no-op if registration already removed.
//   - resolve(): returns first matching registration's input+pane+registration in priority order.
//   - extension matching is case-insensitive on URI basename (last dot wins, e.g. 'a.tar.gz' → '.gz').
//   - no extension (no dot) → ext=''; only '.*' wildcard matches.
//   - '.*' wildcard catches everything (lowest-priority safety net pattern).
//   - resolve returns undefined when nothing matches.
//   - findRegistration: same priority order as resolve, no input/pane created.
//   - findById: linear find by id.
//   - getRegistrations returns the live (sorted) array.
//   - createInput/createPane invoked exactly ONCE per resolve call; pane is a NEW instance every call.

import { describe, it, expect } from 'vitest';
import {
  EditorResolverService,
  EditorResolverPriority,
  type EditorResolverRegistration,
} from '../../src/services/editorResolverService';
import { URI } from '../../src/platform/uri';

let nextPaneId = 0;
function mkReg(over: Partial<EditorResolverRegistration> & Pick<EditorResolverRegistration, 'id' | 'extensions' | 'priority'>): EditorResolverRegistration {
  return {
    name: over.name ?? over.id,
    createInput: over.createInput ?? ((uri) => ({ resource: uri, id: `input:${over.id}` } as any)),
    createPane: over.createPane ?? (() => ({ id: `pane:${over.id}:${++nextPaneId}` } as any)),
    ...over,
  };
}

describe('EditorResolverService — registration', () => {
  it('registerEditor sorts by priority DESC (highest first)', () => {
    const svc = new EditorResolverService();
    svc.registerEditor(mkReg({ id: 'a', extensions: ['.a'], priority: EditorResolverPriority.Builtin }));
    svc.registerEditor(mkReg({ id: 'b', extensions: ['.b'], priority: EditorResolverPriority.Exclusive }));
    svc.registerEditor(mkReg({ id: 'c', extensions: ['.c'], priority: EditorResolverPriority.Default }));
    const ids = svc.getRegistrations().map((r) => r.id);
    expect(ids).toEqual(['b', 'c', 'a']);
  });

  it('disposable removes only the registered entry', () => {
    const svc = new EditorResolverService();
    const a = svc.registerEditor(mkReg({ id: 'a', extensions: ['.a'], priority: 0 }));
    svc.registerEditor(mkReg({ id: 'b', extensions: ['.b'], priority: 0 }));
    a.dispose();
    expect(svc.getRegistrations().map((r) => r.id)).toEqual(['b']);
  });

  it('disposable is idempotent / no-op when already removed', () => {
    const svc = new EditorResolverService();
    const a = svc.registerEditor(mkReg({ id: 'a', extensions: ['.a'], priority: 0 }));
    a.dispose();
    expect(() => a.dispose()).not.toThrow();
    expect(svc.getRegistrations()).toEqual([]);
  });
});

describe('EditorResolverService — resolve', () => {
  it('returns the highest-priority matching registration', () => {
    const svc = new EditorResolverService();
    svc.registerEditor(mkReg({ id: 'low', extensions: ['.png'], priority: EditorResolverPriority.Builtin }));
    svc.registerEditor(mkReg({ id: 'hi', extensions: ['.png'], priority: EditorResolverPriority.Exclusive }));
    const out = svc.resolve(URI.file('C:/x/y.png'));
    expect(out?.registration.id).toBe('hi');
    expect(out?.input).toBeDefined();
    expect(out?.pane).toBeDefined();
  });

  it('extension match is case-insensitive', () => {
    const svc = new EditorResolverService();
    svc.registerEditor(mkReg({ id: 'png', extensions: ['.PNG'], priority: 0 }));
    expect(svc.resolve(URI.file('C:/a/img.png'))?.registration.id).toBe('png');
    svc.registerEditor(mkReg({ id: 'jpg', extensions: ['.jpg'], priority: 0 }));
    expect(svc.resolve(URI.file('C:/a/IMG.JPG'))?.registration.id).toBe('jpg');
  });

  it('uses last-dot of basename (e.g. archive.tar.gz → .gz)', () => {
    const svc = new EditorResolverService();
    svc.registerEditor(mkReg({ id: 'gz', extensions: ['.gz'], priority: 0 }));
    svc.registerEditor(mkReg({ id: 'tar', extensions: ['.tar'], priority: 100 }));
    expect(svc.resolve(URI.file('C:/x/archive.tar.gz'))?.registration.id).toBe('gz');
  });

  it("no extension → ext=''; only '.*' wildcard catches", () => {
    const svc = new EditorResolverService();
    svc.registerEditor(mkReg({ id: 'wild', extensions: ['.*'], priority: 0 }));
    svc.registerEditor(mkReg({ id: 'spec', extensions: ['.ts'], priority: 1000 }));
    expect(svc.resolve(URI.file('C:/x/README'))?.registration.id).toBe('wild');
  });

  it('returns undefined when no registration matches', () => {
    const svc = new EditorResolverService();
    svc.registerEditor(mkReg({ id: 'spec', extensions: ['.ts'], priority: 0 }));
    expect(svc.resolve(URI.file('C:/x/y.png'))).toBeUndefined();
  });

  it('createInput + createPane called exactly once per resolve; pane is a fresh instance', () => {
    let inputCount = 0;
    let paneCount = 0;
    const svc = new EditorResolverService();
    svc.registerEditor(mkReg({
      id: 'x', extensions: ['.x'], priority: 0,
      createInput: (uri) => { inputCount++; return { resource: uri } as any; },
      createPane: () => { paneCount++; return { tag: paneCount } as any; },
    }));
    const r1 = svc.resolve(URI.file('C:/a.x'));
    const r2 = svc.resolve(URI.file('C:/a.x'));
    expect(inputCount).toBe(2);
    expect(paneCount).toBe(2);
    expect(r1?.pane).not.toBe(r2?.pane);
  });
});

describe('EditorResolverService — find helpers', () => {
  it('findRegistration follows the same priority order as resolve, no factories invoked', () => {
    let inputCount = 0;
    const svc = new EditorResolverService();
    svc.registerEditor(mkReg({
      id: 'low', extensions: ['.png'], priority: 0,
      createInput: () => { inputCount++; return {} as any; },
    }));
    svc.registerEditor(mkReg({
      id: 'hi', extensions: ['.png'], priority: 999,
      createInput: () => { inputCount++; return {} as any; },
    }));
    expect(svc.findRegistration(URI.file('C:/a.png'))?.id).toBe('hi');
    expect(inputCount).toBe(0);
  });

  it('findRegistration returns undefined when nothing matches', () => {
    const svc = new EditorResolverService();
    expect(svc.findRegistration(URI.file('C:/a.png'))).toBeUndefined();
  });

  it('findById returns registration with matching id, undefined otherwise', () => {
    const svc = new EditorResolverService();
    svc.registerEditor(mkReg({ id: 'a', extensions: ['.a'], priority: 0 }));
    svc.registerEditor(mkReg({ id: 'b', extensions: ['.b'], priority: 0 }));
    expect(svc.findById('a')?.id).toBe('a');
    expect(svc.findById('missing')).toBeUndefined();
  });

  it('getRegistrations returns the LIVE sorted array (mutation order reflects in result)', () => {
    const svc = new EditorResolverService();
    svc.registerEditor(mkReg({ id: 'a', extensions: ['.a'], priority: 0 }));
    const d = svc.registerEditor(mkReg({ id: 'b', extensions: ['.b'], priority: 100 }));
    expect(svc.getRegistrations().map((r) => r.id)).toEqual(['b', 'a']);
    d.dispose();
    expect(svc.getRegistrations().map((r) => r.id)).toEqual(['a']);
  });
});
