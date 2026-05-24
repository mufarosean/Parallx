// autonomyPatternMemoryService.test.ts — pin "approve this pattern" memory
// service for sub-agent spawn approvals (M60 ζ §8 T5.E3).

import { describe, it, expect, vi } from 'vitest';
import {
  AutonomyPatternMemoryService,
  computeArgsShape,
  patternKeyId,
  type IAutonomyPatternKey,
  type IAutonomyPatternMemoryFs,
} from '../../src/services/autonomyPatternMemoryService';

function mkFs(initial?: Record<string, string>): IAutonomyPatternMemoryFs & { _store: Map<string, string> } {
  const store = new Map<string, string>(Object.entries(initial ?? {}));
  return {
    _store: store,
    readFile: vi.fn(async (path: string) => {
      const data = store.get(path);
      return data === undefined ? { ok: false, error: 'ENOENT' } : { ok: true, data };
    }),
    writeFile: vi.fn(async (path: string, content: string) => {
      store.set(path, content);
      return { ok: true };
    }),
    exists: vi.fn(async (path: string) => ({ ok: true, exists: store.has(path) })),
    mkdir: vi.fn(async () => ({ ok: true })),
  };
}

const KEY: IAutonomyPatternKey = {
  toolName: 'sessions_spawn',
  parentSessionPattern: 'sess-1',
  argsShape: 'label,model,task',
};

describe('computeArgsShape', () => {
  it('null and undefined collapse to "null"', () => {
    expect(computeArgsShape(null)).toBe('null');
    expect(computeArgsShape(undefined)).toBe('null');
  });

  it('primitives collapse to their typeof', () => {
    expect(computeArgsShape('hi')).toBe('string');
    expect(computeArgsShape(7)).toBe('number');
    expect(computeArgsShape(true)).toBe('boolean');
  });

  it('arrays collapse to length-only signature', () => {
    expect(computeArgsShape([])).toBe('array(0)');
    expect(computeArgsShape([1, 2, 3])).toBe('array(3)');
  });

  it('objects collapse to sorted-keys joined by comma; values never leak', () => {
    expect(computeArgsShape({ b: 'secret', a: 42, c: { nested: true } })).toBe('a,b,c');
    expect(computeArgsShape({})).toBe('');
  });

  it('different value tail with identical keys yields identical shape', () => {
    expect(computeArgsShape({ a: 1, b: 2 })).toBe(computeArgsShape({ a: 'x', b: 'y' }));
  });
});

describe('patternKeyId', () => {
  it('is deterministic for identical key tuples', () => {
    expect(patternKeyId(KEY)).toBe(patternKeyId({ ...KEY }));
  });

  it('changes when any tuple component changes', () => {
    const base = patternKeyId(KEY);
    expect(patternKeyId({ ...KEY, toolName: 'other' })).not.toBe(base);
    expect(patternKeyId({ ...KEY, parentSessionPattern: 'sess-2' })).not.toBe(base);
    expect(patternKeyId({ ...KEY, argsShape: 'a,b' })).not.toBe(base);
  });

  it('returns "pat-" prefixed base36 string', () => {
    expect(patternKeyId(KEY)).toMatch(/^pat-[0-9a-z]+$/);
  });
});

describe('AutonomyPatternMemoryService — in-memory (no fs)', () => {
  it('without fs: remember stores, isApproved hits, save is a no-op', async () => {
    const svc = new AutonomyPatternMemoryService({ dataDir: '/d' });
    await svc.initialize();
    expect(svc.isApproved(KEY)).toBe(false);
    const rec = await svc.remember(KEY, 'spawn writer');
    expect(rec.label).toBe('spawn writer');
    expect(rec.matchCount).toBe(0);
    expect(svc.isApproved(KEY)).toBe(true);
    expect(svc.list()).toHaveLength(1);
  });

  it('remember is idempotent — second call returns same record without firing change', async () => {
    const svc = new AutonomyPatternMemoryService({ dataDir: '/d' });
    const heard: number[] = [];
    svc.onDidChange(() => heard.push(1));
    const a = await svc.remember(KEY, 'first');
    const b = await svc.remember(KEY, 'second-ignored');
    expect(b).toBe(a);
    expect(b.label).toBe('first');
    expect(heard.length).toBe(1);
  });

  it('noteMatch bumps matchCount and stamps lastMatchedAt; returns undefined when not approved', async () => {
    const t = vi.fn().mockReturnValueOnce(1_000).mockReturnValueOnce(2_000).mockReturnValueOnce(3_000);
    const svc = new AutonomyPatternMemoryService({ dataDir: '/d', now: t });
    expect(await svc.noteMatch(KEY)).toBeUndefined();
    await svc.remember(KEY);
    const r1 = await svc.noteMatch(KEY);
    expect(r1?.matchCount).toBe(1);
    expect(r1?.lastMatchedAt).toBe(new Date(2_000).toISOString());
    const r2 = await svc.noteMatch(KEY);
    expect(r2?.matchCount).toBe(2);
    expect(r2?.lastMatchedAt).toBe(new Date(3_000).toISOString());
  });

  it('revoke removes and reports prior-existence; second revoke is false', async () => {
    const svc = new AutonomyPatternMemoryService({ dataDir: '/d' });
    const rec = await svc.remember(KEY);
    expect(await svc.revoke(rec.id)).toBe(true);
    expect(svc.isApproved(KEY)).toBe(false);
    expect(await svc.revoke(rec.id)).toBe(false);
    expect(await svc.revoke('pat-unknown')).toBe(false);
  });

  it('clear empties memory and fires change once; no-op when already empty (no event)', async () => {
    const svc = new AutonomyPatternMemoryService({ dataDir: '/d' });
    const heard: number[] = [];
    svc.onDidChange(() => heard.push(1));
    await svc.clear();
    expect(heard.length).toBe(0);
    await svc.remember(KEY);
    expect(heard.length).toBe(1);
    await svc.clear();
    expect(svc.list()).toHaveLength(0);
    expect(heard.length).toBe(2);
  });

  it('list returns newest-first by approvedAt', async () => {
    const t = vi.fn().mockReturnValueOnce(1000).mockReturnValueOnce(2000).mockReturnValueOnce(3000);
    const svc = new AutonomyPatternMemoryService({ dataDir: '/d', now: t });
    const k1 = { ...KEY, parentSessionPattern: 's-1' };
    const k2 = { ...KEY, parentSessionPattern: 's-2' };
    const k3 = { ...KEY, parentSessionPattern: 's-3' };
    await svc.remember(k1);
    await svc.remember(k2);
    await svc.remember(k3);
    const ordered = svc.list().map(r => r.parentSessionPattern);
    expect(ordered).toEqual(['s-3', 's-2', 's-1']);
  });
});

describe('AutonomyPatternMemoryService — fs-backed persistence', () => {
  it('initialize reads existing patterns file', async () => {
    const id = patternKeyId(KEY);
    const initial = JSON.stringify({
      patterns: [{ id, ...KEY, approvedAt: new Date(0).toISOString(), matchCount: 0 }],
    });
    const fs = mkFs({ '/d/autonomy-patterns.json': initial });
    const svc = new AutonomyPatternMemoryService({ dataDir: '/d', fs });
    await svc.initialize();
    expect(svc.isApproved(KEY)).toBe(true);
    expect(svc.list()).toHaveLength(1);
  });

  it('initialize tolerates missing file, corrupt JSON, and non-array patterns', async () => {
    // missing
    let fs = mkFs();
    let svc = new AutonomyPatternMemoryService({ dataDir: '/d', fs });
    await svc.initialize();
    expect(svc.list()).toHaveLength(0);
    // corrupt
    fs = mkFs({ '/d/autonomy-patterns.json': '<<<not json>>>' });
    svc = new AutonomyPatternMemoryService({ dataDir: '/d', fs });
    await svc.initialize();
    expect(svc.list()).toHaveLength(0);
    // non-array
    fs = mkFs({ '/d/autonomy-patterns.json': JSON.stringify({ patterns: 'nope' }) });
    svc = new AutonomyPatternMemoryService({ dataDir: '/d', fs });
    await svc.initialize();
    expect(svc.list()).toHaveLength(0);
  });

  it('initialize is idempotent — second call does not re-read', async () => {
    const fs = mkFs({ '/d/autonomy-patterns.json': JSON.stringify({ patterns: [] }) });
    const svc = new AutonomyPatternMemoryService({ dataDir: '/d', fs });
    await svc.initialize();
    await svc.initialize();
    expect(fs.readFile).toHaveBeenCalledTimes(1);
  });

  it('remember serializes patterns to JSON file', async () => {
    const fs = mkFs();
    const svc = new AutonomyPatternMemoryService({ dataDir: '/d', fs, now: () => 5_000 });
    await svc.initialize();
    await svc.remember(KEY, 'lab');
    await svc.flush();
    const written = fs._store.get('/d/autonomy-patterns.json')!;
    const parsed = JSON.parse(written);
    expect(parsed.patterns).toHaveLength(1);
    expect(parsed.patterns[0].toolName).toBe('sessions_spawn');
    expect(parsed.patterns[0].argsShape).toBe('label,model,task');
    expect(parsed.patterns[0].label).toBe('lab');
    expect(parsed.patterns[0].approvedAt).toBe(new Date(5_000).toISOString());
  });

  it('save creates dataDir via mkdir before writing', async () => {
    const fs = mkFs();
    const svc = new AutonomyPatternMemoryService({ dataDir: '/d/sub', fs });
    await svc.initialize();
    await svc.remember(KEY);
    await svc.flush();
    expect(fs.mkdir).toHaveBeenCalled();
    expect(fs.writeFile).toHaveBeenCalled();
  });

  it('writeFile failure is swallowed; in-memory state remains truth', async () => {
    const fs = mkFs();
    (fs.writeFile as any).mockImplementation(async () => { throw new Error('disk full'); });
    const svc = new AutonomyPatternMemoryService({ dataDir: '/d', fs });
    await svc.initialize();
    const rec = await svc.remember(KEY);
    await expect(svc.flush()).resolves.toBeUndefined();
    expect(svc.isApproved(KEY)).toBe(true);
    expect(svc.list()[0].id).toBe(rec.id);
  });

  it('writes are serialized — concurrent mutations queue on _saveChain', async () => {
    const fs = mkFs();
    let inFlight = 0;
    let maxConcurrent = 0;
    (fs.writeFile as any).mockImplementation(async (p: string, c: string) => {
      inFlight++;
      maxConcurrent = Math.max(maxConcurrent, inFlight);
      await Promise.resolve();
      fs._store.set(p, c);
      inFlight--;
      return { ok: true };
    });
    const svc = new AutonomyPatternMemoryService({ dataDir: '/d', fs });
    await svc.initialize();
    await Promise.all([
      svc.remember({ ...KEY, parentSessionPattern: 'a' }),
      svc.remember({ ...KEY, parentSessionPattern: 'b' }),
      svc.remember({ ...KEY, parentSessionPattern: 'c' }),
    ]);
    await svc.flush();
    expect(maxConcurrent).toBe(1);
    const parsed = JSON.parse(fs._store.get('/d/autonomy-patterns.json')!);
    expect(parsed.patterns).toHaveLength(3);
  });
});
