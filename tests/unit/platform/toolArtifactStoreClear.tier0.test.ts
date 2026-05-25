// toolArtifactStoreClear.tier0.test.ts — Slice A30

import { describe, it, expect, beforeEach } from 'vitest';
import { InMemoryToolArtifactStore } from '../../../src/workbench/toolArtifactStore.js';
import type { ToolArtifactRecord } from '../../../src/workbench/toolArtifactStore.js';

const rec = (toolId: string, artifactId: string, workspaceId?: string): ToolArtifactRecord => ({
  toolId,
  artifactId,
  data: { v: artifactId },
  workspaceId,
});

describe('IToolArtifactStore.clear() (Slice A30)', () => {
  let store: InMemoryToolArtifactStore;
  let events: Array<{ toolId: string; artifactId: string; kind: 'put' | 'delete' }>;

  beforeEach(() => {
    store = new InMemoryToolArtifactStore();
    events = [];
    store.onDidChange(e => events.push(e));
  });

  it('returns 0 and fires no events on empty store', () => {
    expect(store.clear()).toBe(0);
    expect(events).toEqual([]);
  });

  it('removes every record and reports the count', () => {
    store.put(rec('t1', 'a'));
    store.put(rec('t1', 'b'));
    store.put(rec('t2', 'c'));
    events.length = 0;
    expect(store.clear()).toBe(3);
    expect(store.size).toBe(0);
    expect(store.list()).toEqual([]);
  });

  it('fires one delete event per record in insertion order', () => {
    store.put(rec('t1', 'a'));
    store.put(rec('t2', 'b'));
    store.put(rec('t1', 'c'));
    events.length = 0;
    store.clear();
    expect(events).toHaveLength(3);
    expect(events.map(e => `${e.toolId}/${e.artifactId}`)).toEqual(['t1/a', 't2/b', 't1/c']);
    expect(events.every(e => e.kind === 'delete')).toBe(true);
  });

  it('is idempotent', () => {
    store.put(rec('t1', 'a'));
    store.clear();
    events.length = 0;
    expect(store.clear()).toBe(0);
    expect(events).toEqual([]);
  });

  it('leaves the store usable after clear', () => {
    store.put(rec('t1', 'a'));
    store.clear();
    store.put(rec('t2', 'b'));
    expect(store.size).toBe(1);
    expect(store.has('t2', 'b')).toBe(true);
    expect(store.has('t1', 'a')).toBe(false);
  });

  it('does not leak the internal collection (snapshot semantics)', () => {
    store.put(rec('t1', 'a'));
    store.put(rec('t1', 'b'));
    store.clear();
    expect(store.list()).toEqual([]);
    store.put(rec('t1', 'a'));
    expect(store.list()).toHaveLength(1);
  });
});
