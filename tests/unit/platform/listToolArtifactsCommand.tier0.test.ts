// listToolArtifactsCommand.tier0.test.ts — Slice B16
//
// Verifies `workbench.action.listToolArtifacts` reads `IToolArtifactStore`
// and returns a JSON array summary suitable for AI tool consumption.

import { describe, it, expect } from 'vitest';
import { ALL_BUILTIN_COMMANDS } from '../../../src/commands/structuralCommands.js';
import type { ToolArtifactRecord } from '../../../src/workbench/toolArtifactStore.js';

const COMMAND_ID = 'workbench.action.listToolArtifacts';

function find() {
  const d = ALL_BUILTIN_COMMANDS.find((c) => c.id === COMMAND_ID);
  if (!d) throw new Error(`${COMMAND_ID} not registered`);
  return d;
}

function makeCtx(records: ToolArtifactRecord[] | undefined, opts: { missingService?: boolean } = {}) {
  return {
    getService<T>(id: string): T | undefined {
      if (id !== 'IToolArtifactStore' || opts.missingService) return undefined;
      return {
        list: () => records ?? [],
      } as unknown as T;
    },
  };
}

describe('listToolArtifacts command (Slice B16)', () => {
  it('is registered with the right metadata', () => {
    const d = find();
    expect(d.title).toBe('List Tool Artifacts');
    expect(d.category).toBe('View');
    expect(d.aiInvocable).toBe(true);
    expect(d.when).toBeUndefined();
  });

  it('returns "[]" when no service is available', async () => {
    const ctx = makeCtx(undefined, { missingService: true });
    expect(await find().handler(ctx)).toBe('[]');
  });

  it('returns "[]" for an empty store', async () => {
    const ctx = makeCtx([]);
    expect(await find().handler(ctx)).toBe('[]');
  });

  it('returns summaries omitting the `data` payload', async () => {
    const records: ToolArtifactRecord[] = [
      {
        toolId: 'research',
        artifactId: 'page-1',
        mimeType: 'text/html',
        data: { huge: 'payload', should: 'be omitted' },
        createdAt: 1000,
        workspaceId: 'ws-1',
      },
      {
        toolId: 'render',
        artifactId: 'img-7',
        mimeType: 'image/png',
        data: new Uint8Array(1024),
        createdAt: 2000,
        workspaceId: 'ws-2',
      },
    ];
    const ctx = makeCtx(records);
    const out = await find().handler(ctx);
    expect(typeof out).toBe('string');
    const parsed = JSON.parse(out as string);
    expect(parsed).toEqual([
      { toolId: 'research', artifactId: 'page-1', mimeType: 'text/html', workspaceId: 'ws-1', createdAt: 1000 },
      { toolId: 'render', artifactId: 'img-7', mimeType: 'image/png', workspaceId: 'ws-2', createdAt: 2000 },
    ]);
    expect(out).not.toContain('huge');
    expect(out).not.toContain('Uint8Array');
  });

  it('preserves insertion order from store.list()', async () => {
    const records: ToolArtifactRecord[] = [
      { toolId: 'a', artifactId: '1', data: null, createdAt: 1 },
      { toolId: 'b', artifactId: '2', data: null, createdAt: 2 },
      { toolId: 'a', artifactId: '3', data: null, createdAt: 3 },
    ];
    const ctx = makeCtx(records);
    const parsed = JSON.parse((await find().handler(ctx)) as string);
    expect(parsed.map((r: { artifactId: string }) => r.artifactId)).toEqual(['1', '2', '3']);
  });

  it('handles records with no mimeType / workspaceId', async () => {
    const records: ToolArtifactRecord[] = [
      { toolId: 't', artifactId: 'x', data: 'plain', createdAt: 5 },
    ];
    const ctx = makeCtx(records);
    const parsed = JSON.parse((await find().handler(ctx)) as string);
    expect(parsed).toEqual([
      { toolId: 't', artifactId: 'x', mimeType: undefined, workspaceId: undefined, createdAt: 5 },
    ]);
  });
});
