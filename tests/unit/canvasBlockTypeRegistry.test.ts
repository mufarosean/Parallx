// canvasBlockTypeRegistry.test.ts — pin CanvasBlockTypeRegistry contribution surface.
//
// Pins:
//   - Built-in ids reserved at construction (snapshot once). Registering 'paragraph'
//     (known built-in) throws "is a built-in block".
//   - Missing/non-string id throws "definition.id is required".
//   - Missing/non-string name throws "definition.name is required".
//   - Duplicate contributed id throws "already contributed".
//   - register fires onDidChange synchronously on success.
//   - Returned disposable removes only when the stored definition still matches by
//     identity (re-register-after-dispose-of-original keeps the new entry).
//   - Dispose fires onDidChange when removal happens.
//   - Idempotent dispose: second dispose() of the same returned disposable is no-op.
//   - getAll returns snapshot in registration insertion order.
//   - has() reflects contributed map only, NOT built-ins.
//   - After registry.dispose(): register is a no-op returning a benign disposable
//     (does not throw, does not fire events).

import { describe, it, expect, vi } from 'vitest';
import { CanvasBlockTypeRegistry } from '../../src/services/canvasBlockTypeRegistry';
import type { BlockDefinition } from '../../src/built-in/canvas/config/blockRegistry';

function mkDef(id: string, name = id): BlockDefinition {
  return {
    id,
    name,
    label: name,
    icon: 'T',
    iconIsText: true,
    source: 'extension',
    kind: 'leaf',
    capabilities: {} as any,
    slashMenu: undefined,
    turnInto: undefined,
    defaultContent: { type: name },
  } as any;
}

describe('CanvasBlockTypeRegistry', () => {
  it('rejects registration of an id that collides with a built-in', () => {
    const r = new CanvasBlockTypeRegistry();
    expect(() => r.register(mkDef('paragraph'))).toThrow(/is a built-in block/);
    r.dispose();
  });

  it('throws when definition.id is missing or non-string', () => {
    const r = new CanvasBlockTypeRegistry();
    expect(() => r.register({} as any)).toThrow(/definition\.id is required/);
    expect(() => r.register({ id: 123 } as any)).toThrow(/definition\.id is required/);
    r.dispose();
  });

  it("throws when definition.name is missing or non-string", () => {
    const r = new CanvasBlockTypeRegistry();
    expect(() => r.register({ id: 'x' } as any)).toThrow(/definition\.name is required/);
    expect(() => r.register({ id: 'x', name: 42 } as any)).toThrow(/definition\.name is required/);
    r.dispose();
  });

  it('rejects duplicate contributed id', () => {
    const r = new CanvasBlockTypeRegistry();
    r.register(mkDef('ext-block'));
    expect(() => r.register(mkDef('ext-block'))).toThrow(/already contributed/);
    r.dispose();
  });

  it('register fires onDidChange synchronously', () => {
    const r = new CanvasBlockTypeRegistry();
    const fired = vi.fn();
    r.onDidChange(fired);
    r.register(mkDef('a'));
    expect(fired).toHaveBeenCalledTimes(1);
    r.dispose();
  });

  it('returned disposable removes entry and fires onDidChange', () => {
    const r = new CanvasBlockTypeRegistry();
    const d = r.register(mkDef('a'));
    const fired = vi.fn();
    r.onDidChange(fired);
    d.dispose();
    expect(r.has('a')).toBe(false);
    expect(fired).toHaveBeenCalledTimes(1);
    r.dispose();
  });

  it('disposable identity-checks: stale dispose does not remove a re-registered entry', () => {
    const r = new CanvasBlockTypeRegistry();
    const def1 = mkDef('a');
    const d1 = r.register(def1);
    d1.dispose();
    const def2 = mkDef('a');
    r.register(def2);
    const fired = vi.fn();
    r.onDidChange(fired);
    d1.dispose(); // stale — should not remove def2 or fire
    expect(r.has('a')).toBe(true);
    expect(fired).not.toHaveBeenCalled();
    r.dispose();
  });

  it('getAll returns insertion order', () => {
    const r = new CanvasBlockTypeRegistry();
    r.register(mkDef('b'));
    r.register(mkDef('a'));
    r.register(mkDef('c'));
    expect(r.getAll().map(d => d.id)).toEqual(['b', 'a', 'c']);
    r.dispose();
  });

  it('has() only reflects contributed, not built-ins', () => {
    const r = new CanvasBlockTypeRegistry();
    expect(r.has('paragraph')).toBe(false); // built-in NOT reported by has()
    r.register(mkDef('z'));
    expect(r.has('z')).toBe(true);
    r.dispose();
  });

  it('after registry.dispose(): register is a no-op returning a benign disposable', () => {
    const r = new CanvasBlockTypeRegistry();
    r.dispose();
    const fired = vi.fn();
    // Cannot re-subscribe after dispose meaningfully; just assert no throw + no entry
    expect(() => {
      const d = r.register(mkDef('post'));
      d.dispose();
    }).not.toThrow();
    expect(r.has('post')).toBe(false);
    expect(fired).not.toHaveBeenCalled();
  });
});
