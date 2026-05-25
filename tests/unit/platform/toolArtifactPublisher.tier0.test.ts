// toolArtifactPublisher.tier0.test.ts — Slice A12

import { describe, it, expect } from 'vitest';
import { InMemoryToolArtifactStore } from '../../../src/workbench/toolArtifactStore.js';
import { publishToolArtifact } from '../../../src/workbench/toolArtifactPublisher.js';
import { ResourceRegistry } from '../../../src/workbench/resources/resourceRegistry.js';
import { toolArtifactResourceResolver } from '../../../src/workbench/resources/resolvers/toolArtifactResolver.js';

describe('publishToolArtifact', () => {
  it('stores the record in the given store', () => {
    const store = new InMemoryToolArtifactStore();
    const { record } = publishToolArtifact(store, {
      toolId: 'web-research',
      artifactId: 'r1',
      data: { title: 'Page' },
    });
    expect(store.get('web-research', 'r1')).toBe(record);
  });

  it('returns a canonical parallx://tool-artifact URI', () => {
    const store = new InMemoryToolArtifactStore();
    const { uri } = publishToolArtifact(store, { toolId: 'web-research', artifactId: 'r1', data: 1 });
    expect(uri).toBe('parallx://tool-artifact:web-research/r1');
  });

  it('URI encodes ids that need encoding', () => {
    const store = new InMemoryToolArtifactStore();
    const { uri } = publishToolArtifact(store, { toolId: 'web research', artifactId: 'a/b', data: 1 });
    expect(uri).toBe('parallx://tool-artifact:web%20research/a%2Fb');
  });

  it('includes workspace query when provided', () => {
    const store = new InMemoryToolArtifactStore();
    const { uri } = publishToolArtifact(store, { toolId: 't', artifactId: 'a', data: 1, workspaceId: 'ws-1' });
    expect(uri).toBe('parallx://tool-artifact:t/a?workspace=ws-1');
  });

  it('rejects empty ids', () => {
    const store = new InMemoryToolArtifactStore();
    expect(() => publishToolArtifact(store, { toolId: '', artifactId: 'a', data: 1 })).toThrow(/required/);
    expect(() => publishToolArtifact(store, { toolId: 't', artifactId: '', data: 1 })).toThrow(/required/);
  });

  it('round-trips via ResourceRegistry.resolveUri', async () => {
    const store = new InMemoryToolArtifactStore();
    const reg = new ResourceRegistry();
    reg.register(
      toolArtifactResourceResolver({
        getArtifact: (toolId: string, artifactId: string) => store.get(toolId, artifactId),
      }),
    );
    const { uri } = publishToolArtifact(store, { toolId: 'web-research', artifactId: 'r1', data: { x: 42 } });
    const out = await reg.resolveUri<{ artifact: { data: { x: number } } }>(uri);
    expect(out?.artifact.data).toEqual({ x: 42 });
  });

  it('overwrites existing entry for same (toolId, artifactId)', () => {
    const store = new InMemoryToolArtifactStore();
    publishToolArtifact(store, { toolId: 't', artifactId: 'a', data: 'old' });
    publishToolArtifact(store, { toolId: 't', artifactId: 'a', data: 'new' });
    expect(store.get('t', 'a')?.data).toBe('new');
    expect(store.size).toBe(1);
  });

  it('uses provided createdAt when supplied', () => {
    const store = new InMemoryToolArtifactStore();
    const { record } = publishToolArtifact(store, { toolId: 't', artifactId: 'a', data: 1, createdAt: 12345 });
    expect(record.createdAt).toBe(12345);
  });
});
