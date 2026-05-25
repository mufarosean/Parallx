// getToolArtifactCommand.tier0.test.ts — Slice B17
//
// Verifies `workbench.action.getToolArtifact` reads a single
// artifact's data payload from IToolArtifactStore given a
// "toolId/artifactId" key.

import { describe, it, expect } from 'vitest';
import { ALL_BUILTIN_COMMANDS } from '../../../src/commands/structuralCommands.js';
import type { ToolArtifactRecord } from '../../../src/workbench/toolArtifactStore.js';

const COMMAND_ID = 'workbench.action.getToolArtifact';

function find() {
  const d = ALL_BUILTIN_COMMANDS.find((c) => c.id === COMMAND_ID);
  if (!d) throw new Error(`${COMMAND_ID} not registered`);
  return d;
}

function makeStore(records: ToolArtifactRecord[]) {
  const map = new Map<string, ToolArtifactRecord>();
  for (const r of records) map.set(`${r.toolId}|${r.artifactId}`, r);
  return {
    get: (toolId: string, artifactId: string) => map.get(`${toolId}|${artifactId}`),
  };
}

function makeCtx(records: ToolArtifactRecord[], opts: { missingService?: boolean } = {}) {
  const store = makeStore(records);
  return {
    getService<T>(id: string): T | undefined {
      if (id !== 'IToolArtifactStore' || opts.missingService) return undefined;
      return store as unknown as T;
    },
  };
}

describe('getToolArtifact command (Slice B17)', () => {
  it('is registered with the right metadata', () => {
    const d = find();
    expect(d.title).toBe('Get Tool Artifact');
    expect(d.category).toBe('View');
    expect(d.aiInvocable).toBe(true);
    expect(d.when).toBeUndefined();
  });

  it('returns the data payload for a stored artifact', async () => {
    const records: ToolArtifactRecord[] = [
      { toolId: 'research', artifactId: 'p1', data: { html: '<b>hi</b>' }, createdAt: 1 },
    ];
    const ctx = makeCtx(records);
    expect(await find().handler(ctx, 'research/p1')).toEqual({ html: '<b>hi</b>' });
  });

  it('returns undefined for an unknown artifact id', async () => {
    const ctx = makeCtx([
      { toolId: 'a', artifactId: '1', data: 'x', createdAt: 1 },
    ]);
    expect(await find().handler(ctx, 'a/missing')).toBeUndefined();
    expect(await find().handler(ctx, 'unknown/1')).toBeUndefined();
  });

  it('returns undefined when no service is available', async () => {
    const ctx = makeCtx([], { missingService: true });
    expect(await find().handler(ctx, 'a/1')).toBeUndefined();
  });

  it('returns undefined for malformed keys', async () => {
    const ctx = makeCtx([
      { toolId: 'a', artifactId: '1', data: 1, createdAt: 1 },
    ]);
    expect(await find().handler(ctx, undefined)).toBeUndefined();
    expect(await find().handler(ctx, '')).toBeUndefined();
    expect(await find().handler(ctx, 'noslash')).toBeUndefined();
    expect(await find().handler(ctx, '/leadingslash')).toBeUndefined();
    expect(await find().handler(ctx, 'trailingslash/')).toBeUndefined();
    expect(await find().handler(ctx, 42)).toBeUndefined();
  });

  it('correctly handles artifact ids that themselves contain slashes', async () => {
    // The split point is the FIRST slash, so an artifactId like "sub/dir/file"
    // is preserved as one piece.
    const records: ToolArtifactRecord[] = [
      { toolId: 'render', artifactId: 'sub/dir/file.png', data: 'PAYLOAD', createdAt: 1 },
    ];
    const ctx = makeCtx(records);
    expect(await find().handler(ctx, 'render/sub/dir/file.png')).toBe('PAYLOAD');
  });

  it('returns whatever data shape was stored — including Uint8Array, null, etc.', async () => {
    const bytes = new Uint8Array([1, 2, 3]);
    const records: ToolArtifactRecord[] = [
      { toolId: 't', artifactId: 'bin', data: bytes, createdAt: 1 },
      { toolId: 't', artifactId: 'nullish', data: null, createdAt: 2 },
      { toolId: 't', artifactId: 'num', data: 42, createdAt: 3 },
    ];
    const ctx = makeCtx(records);
    expect(await find().handler(ctx, 't/bin')).toBe(bytes);
    expect(await find().handler(ctx, 't/nullish')).toBeNull();
    expect(await find().handler(ctx, 't/num')).toBe(42);
  });
});
