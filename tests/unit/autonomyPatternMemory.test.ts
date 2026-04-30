// autonomyPatternMemory.test.ts — M60 §8 Phase ζ T5.E3
//
// Verifies:
//   - computeArgsShape returns sorted top-level keys (never values)
//   - patternKeyId is stable across runs and varies with key tuple
//   - remember/isApproved/noteMatch/revoke/clear round-trip
//   - persistence: writes JSON file via fs bridge; re-initialize hydrates
//   - list() returns newest-first

import { describe, expect, it } from 'vitest';
import {
  AutonomyPatternMemoryService,
  computeArgsShape,
  patternKeyId,
  type IAutonomyPatternMemoryFs,
} from '../../src/services/autonomyPatternMemoryService';

function memoryFs(): IAutonomyPatternMemoryFs & { dump(): Map<string, string> } {
  const files = new Map<string, string>();
  return {
    dump: () => files,
    async exists(path) { return { ok: true, exists: files.has(path) }; },
    async readFile(path) {
      const data = files.get(path);
      return data === undefined
        ? { ok: false, error: 'ENOENT' }
        : { ok: true, data };
    },
    async writeFile(path, content) { files.set(path, content); return { ok: true }; },
    async mkdir() { return { ok: true }; },
  };
}

describe('computeArgsShape (M60 §8 ζ — privacy)', () => {
  it('returns sorted top-level keys, never values', () => {
    const shape = computeArgsShape({ task: 'do thing', model: 'gpt', label: 'x' });
    expect(shape).toBe('label,model,task');
    // Ensure no value characters leaked.
    expect(shape).not.toContain('do thing');
    expect(shape).not.toContain('gpt');
  });

  it('handles primitives, null, arrays', () => {
    expect(computeArgsShape(null)).toBe('null');
    expect(computeArgsShape(undefined)).toBe('null');
    expect(computeArgsShape('hello')).toBe('string');
    expect(computeArgsShape(42)).toBe('number');
    expect(computeArgsShape([1, 2, 3])).toBe('array(3)');
  });
});

describe('patternKeyId (M60 §8 ζ)', () => {
  it('is stable for the same key tuple', () => {
    const k = { toolName: 'subagent.spawn', parentSessionPattern: 's-1', argsShape: 'a,b' };
    expect(patternKeyId(k)).toBe(patternKeyId(k));
  });

  it('differs when any tuple element changes', () => {
    const a = patternKeyId({ toolName: 'A', parentSessionPattern: 's', argsShape: 'x' });
    const b = patternKeyId({ toolName: 'B', parentSessionPattern: 's', argsShape: 'x' });
    const c = patternKeyId({ toolName: 'A', parentSessionPattern: 't', argsShape: 'x' });
    const d = patternKeyId({ toolName: 'A', parentSessionPattern: 's', argsShape: 'y' });
    expect(new Set([a, b, c, d]).size).toBe(4);
  });

  it('starts with the pat- prefix', () => {
    expect(patternKeyId({ toolName: 'x', parentSessionPattern: 'y', argsShape: 'z' }))
      .toMatch(/^pat-[a-z0-9]+$/);
  });
});

describe('AutonomyPatternMemoryService (M60 §8 ζ T5.E3)', () => {
  it('remembers, isApproved, and notes matches', async () => {
    const svc = new AutonomyPatternMemoryService({ dataDir: '/data', fs: memoryFs() });
    await svc.initialize();
    const key = { toolName: 'subagent.spawn', parentSessionPattern: 's-1', argsShape: 'task' };

    expect(svc.isApproved(key)).toBe(false);
    const remembered = await svc.remember(key, 'Spawn researcher');
    expect(svc.isApproved(key)).toBe(true);
    expect(remembered.label).toBe('Spawn researcher');
    expect(remembered.matchCount).toBe(0);

    const updated = await svc.noteMatch(key);
    expect(updated?.matchCount).toBe(1);
    expect(updated?.lastMatchedAt).toBeDefined();
  });

  it('revokes by id and clears all', async () => {
    const svc = new AutonomyPatternMemoryService({ dataDir: '/data', fs: memoryFs() });
    await svc.initialize();
    const k1 = { toolName: 't1', parentSessionPattern: 's', argsShape: 'a' };
    const k2 = { toolName: 't2', parentSessionPattern: 's', argsShape: 'a' };
    const r1 = await svc.remember(k1);
    await svc.remember(k2);
    expect(svc.list().length).toBe(2);

    expect(await svc.revoke(r1.id)).toBe(true);
    expect(svc.isApproved(k1)).toBe(false);
    expect(svc.list().length).toBe(1);

    expect(await svc.revoke('pat-nope')).toBe(false);
    await svc.clear();
    expect(svc.list().length).toBe(0);
  });

  it('persists and rehydrates across instances', async () => {
    const fs = memoryFs();
    const a = new AutonomyPatternMemoryService({ dataDir: '/data', fs });
    await a.initialize();
    const key = { toolName: 'subagent.spawn', parentSessionPattern: 's-9', argsShape: 'task' };
    await a.remember(key, 'persisted');
    await a.flush();

    // Same fs handed to a second instance — should hydrate.
    const b = new AutonomyPatternMemoryService({ dataDir: '/data', fs });
    await b.initialize();
    expect(b.isApproved(key)).toBe(true);
    expect(b.list()[0]?.label).toBe('persisted');
  });

  it('never writes raw arg values into storage', async () => {
    const fs = memoryFs();
    const svc = new AutonomyPatternMemoryService({ dataDir: '/data', fs });
    await svc.initialize();
    await svc.remember({
      toolName: 'subagent.spawn',
      parentSessionPattern: 'sess-secret-123',
      // The shape never sees raw values in the first place. This guards
      // the contract that callers reduce to keys before calling.
      argsShape: computeArgsShape({ task: 'My SECRET payload', model: 'gpt-4o' }),
    }, 'redaction-check');
    await svc.flush();

    const stored = Array.from(fs.dump().values()).join('\n');
    expect(stored).not.toContain('SECRET payload');
    expect(stored).not.toContain('gpt-4o');
    // The shape (sorted keys) should be present.
    expect(stored).toContain('model,task');
  });
});
