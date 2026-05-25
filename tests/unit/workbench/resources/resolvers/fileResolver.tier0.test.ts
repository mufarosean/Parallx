// fileResolver.tier0.test.ts — Slice A6 verification

import { describe, it, expect, vi } from 'vitest';
import { URI } from '../../../../../src/platform/uri.js';
import { ResourceRegistry } from '../../../../../src/workbench/resources/resourceRegistry.js';
import { fileResource } from '../../../../../src/workbench/resources/resource.js';
import {
  FileResourceResolver,
  fileResourceResolver,
} from '../../../../../src/workbench/resources/resolvers/fileResolver.js';

class FakeFiles {
  readonly readFile = vi.fn(async (uri: URI) => ({ content: `READ:${uri.fsPath}` }));
}

describe('FileResourceResolver', () => {
  it('has type "file"', () => {
    expect(new FileResourceResolver(new FakeFiles()).type).toBe('file');
  });

  it('reads content via IFileService and wraps it', async () => {
    const files = new FakeFiles();
    const r = new FileResourceResolver(files);
    const res = fileResource('/tmp/a.md');
    const out = await r.resolve(res);
    expect(out.resource).toBe(res);
    expect(out.content).toBe('READ:/tmp/a.md');
    expect(files.readFile).toHaveBeenCalledTimes(1);
  });

  it('factory returns an equivalent resolver', () => {
    const r = fileResourceResolver(new FakeFiles());
    expect(r).toBeInstanceOf(FileResourceResolver);
  });

  it('rejects when path is empty', async () => {
    const r = new FileResourceResolver(new FakeFiles());
    await expect(r.resolve(fileResource(''))).rejects.toThrow(/empty/);
  });
});

describe('FileResourceResolver — registered in ResourceRegistry', () => {
  it('resolveUri parses parallx://file/... and returns content', async () => {
    const registry = new ResourceRegistry();
    const files = new FakeFiles();
    registry.register(fileResourceResolver(files));

    const out = await registry.resolveUri<{ content: string }>('parallx://file:' + encodeURIComponent('/tmp/a.md'));
    expect(out?.content).toBe('READ:/tmp/a.md');
  });

  it('rejects when no resolver is registered for the parsed type', async () => {
    const registry = new ResourceRegistry();
    await expect(registry.resolveUri('parallx://file:' + encodeURIComponent('/x.md'))).rejects.toThrow();
  });

  it('returns null for malformed URI', async () => {
    const registry = new ResourceRegistry();
    registry.register(fileResourceResolver(new FakeFiles()));
    const out = await registry.resolveUri('not-a-uri');
    expect(out).toBeNull();
  });
});
