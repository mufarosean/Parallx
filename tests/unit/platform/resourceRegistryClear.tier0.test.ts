// resourceRegistryClear.tier0.test.ts — Slice A35

import { describe, it, expect, beforeEach } from 'vitest';
import { ResourceRegistry } from '../../../src/workbench/resources/resourceRegistry.js';
import type { ResourceResolver } from '../../../src/workbench/resources/resourceRegistry.js';
import type { ResourceType } from '../../../src/workbench/resources/resource.js';

const stub = (type: ResourceType): ResourceResolver =>
  ({ type, resolve: async () => null } as ResourceResolver);

describe('IResourceRegistry.clear() (Slice A35)', () => {
  let reg: ResourceRegistry;
  beforeEach(() => {
    reg = new ResourceRegistry();
  });

  it('returns empty array on empty registry, fires no events', () => {
    const events: unknown[] = [];
    reg.onDidChange(e => events.push(e));
    expect(reg.clear()).toEqual([]);
    expect(events).toEqual([]);
  });

  it('removes every resolver and fires one unregister event per type in insertion order', () => {
    reg.register(stub('file'));
    reg.register(stub('canvas-page'));
    reg.register(stub('chat-session'));
    const fired: { type: string; kind: string }[] = [];
    reg.onDidChange(e => fired.push({ type: e.type, kind: e.kind }));
    const out = reg.clear();
    expect(out).toEqual(['file', 'canvas-page', 'chat-session']);
    expect(fired).toEqual([
      { type: 'file', kind: 'unregister' },
      { type: 'canvas-page', kind: 'unregister' },
      { type: 'chat-session', kind: 'unregister' },
    ]);
    expect(reg.types()).toEqual([]);
    expect(reg.has('file')).toBe(false);
  });

  it('is idempotent (second call is a no-op)', () => {
    reg.register(stub('file'));
    expect(reg.clear()).toEqual(['file']);
    const events: unknown[] = [];
    reg.onDidChange(e => events.push(e));
    expect(reg.clear()).toEqual([]);
    expect(events).toEqual([]);
  });

  it('lets the same type be re-registered after clear', () => {
    reg.register(stub('file'));
    reg.clear();
    expect(() => reg.register(stub('file'))).not.toThrow();
    expect(reg.has('file')).toBe(true);
  });

  it('returns a fresh snapshot (callers may mutate without affecting the registry)', () => {
    reg.register(stub('file'));
    const out = reg.clear() as ResourceType[];
    // mutating the result must not affect the next call
    out.push('canvas-page' as ResourceType);
    expect(reg.types()).toEqual([]);
  });
});
