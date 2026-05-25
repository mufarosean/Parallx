// copyActiveFilePathCommand.tier0.test.ts — §86 / Slice B7
//
// Second when-clause consumer of the §86 context keys. Distinct from B5:
// gated on `activeResourceType == 'file'` (equality, not just truthiness)
// and returns the absolute fsPath rather than the parallx:// URI.

import { describe, it, expect } from 'vitest';
import { ALL_BUILTIN_COMMANDS } from '../../../src/commands/structuralCommands.js';
import type { CommandDescriptor } from '../../../src/commands/commandTypes.js';
import { fileResource, canvasPageResource } from '../../../src/workbench/resources/resource.js';

const cmd = ALL_BUILTIN_COMMANDS.find(
  c => c.id === 'workbench.action.copyActiveFilePath',
) as CommandDescriptor;

function stubClipboard(captured: string[]): void {
  Object.defineProperty(globalThis, 'navigator', {
    value: { clipboard: { writeText: async (s: string) => { captured.push(s); } } },
    configurable: true,
    writable: true,
  });
}

function makeCtx(opts: {
  resource?: unknown;
  contextService?: 'missing' | 'present';
}): { getService: <T,>(id: string) => T | undefined } {
  if (opts.contextService === 'missing') {
    return { getService: <T,>(_id: string): T | undefined => undefined };
  }
  return {
    getService: <T,>(id: string): T | undefined => {
      if (id !== 'IContextService') return undefined;
      const svc = {
        getContext: () => ({ activeResource: opts.resource }),
      };
      return svc as unknown as T;
    },
  };
}

describe('copyActiveFilePath command (Slice B7)', () => {
  it('is registered with the correct when-clause and metadata', () => {
    expect(cmd).toBeDefined();
    expect(cmd.title).toBe('Copy Active File Path');
    expect(cmd.category).toBe('File');
    expect(cmd.when).toBe(
      "activeResourceType == 'file' && activeSurfaceKind == 'editor'"
    );
    expect(cmd.aiInvocable).toBe(true);
    expect(typeof cmd.aiDescription).toBe('string');
  });

  it('copies the fsPath of an active file resource and returns it', async () => {
    const captured: string[] = [];
    stubClipboard(captured);
    const r = fileResource('/tmp/notes.md');
    const result = await cmd.handler!(makeCtx({ resource: r }));
    expect(result).toBe('/tmp/notes.md');
    expect(captured).toEqual(['/tmp/notes.md']);
  });

  it('returns undefined when activeResource is not a file', async () => {
    const captured: string[] = [];
    stubClipboard(captured);
    const r = canvasPageResource('p1');
    const result = await cmd.handler!(makeCtx({ resource: r }));
    expect(result).toBeUndefined();
    expect(captured).toEqual([]);
  });

  it('returns undefined when no resource is active', async () => {
    const captured: string[] = [];
    stubClipboard(captured);
    const result = await cmd.handler!(makeCtx({ resource: undefined }));
    expect(result).toBeUndefined();
    expect(captured).toEqual([]);
  });

  it('returns undefined when IContextService is missing', async () => {
    const result = await cmd.handler!(makeCtx({ contextService: 'missing' }));
    expect(result).toBeUndefined();
  });

  it('does not throw when clipboard write fails', async () => {
    Object.defineProperty(globalThis, 'navigator', {
      value: { clipboard: { writeText: async () => { throw new Error('denied'); } } },
      configurable: true,
      writable: true,
    });
    const r = fileResource('/x.md');
    const result = await cmd.handler!(makeCtx({ resource: r }));
    expect(result).toBe('/x.md');
  });
});
