// resourceRegistryEndToEnd.tier0.test.ts — Slice A11
//
// Proves resolveUri('parallx://<type>:...') works end-to-end through a
// production-shaped registry for every ResourceType currently wired by
// workbenchFacadeFactory (file, external, tool-artifact). The factory
// itself imports too many services to instantiate in a tier-0 test, so
// this assembles the same resolvers against minimal fakes — exactly the
// composition the factory performs.

import { describe, it, expect } from 'vitest';
import { URI } from '../../../src/platform/uri.js';
import { ResourceRegistry } from '../../../src/workbench/resources/resourceRegistry.js';
import { fileResourceResolver } from '../../../src/workbench/resources/resolvers/fileResolver.js';
import { externalResourceResolver } from '../../../src/workbench/resources/resolvers/externalResolver.js';
import { toolArtifactResourceResolver } from '../../../src/workbench/resources/resolvers/toolArtifactResolver.js';
import { InMemoryToolArtifactStore } from '../../../src/workbench/toolArtifactStore.js';

function makeRegistry() {
  const files = {
    async readFile(uri: URI) {
      return { content: `<contents of ${uri.fsPath}>` };
    },
  };
  const store = new InMemoryToolArtifactStore();
  store.put({ toolId: 'web-research', artifactId: 'r1', data: { title: 'Page' }, createdAt: 1 });

  const reg = new ResourceRegistry();
  reg.register(fileResourceResolver(files));
  reg.register(externalResourceResolver());
  reg.register(
    toolArtifactResourceResolver({
      getArtifact: (toolId: string, artifactId: string) => store.get(toolId, artifactId),
    }),
  );
  return { reg, store };
}

describe('ResourceRegistry end-to-end (factory-shaped composition)', () => {
  it('resolves parallx://file:<path>', async () => {
    const { reg } = makeRegistry();
    const out = await reg.resolveUri<{ content: string }>('parallx://file:' + encodeURIComponent('/tmp/note.md'));
    expect(out?.content).toBe('<contents of /tmp/note.md>');
  });

  it('resolves http(s):// as external pass-through', async () => {
    const { reg } = makeRegistry();
    const out = await reg.resolveUri<{ uri: string }>('https://example.com/x');
    expect(out?.uri).toBe('https://example.com/x');
  });

  it('resolves mailto: as external pass-through', async () => {
    const { reg } = makeRegistry();
    const out = await reg.resolveUri<{ uri: string }>('mailto:a@b.c');
    expect(out?.uri).toBe('mailto:a@b.c');
  });

  it('resolves parallx://tool-artifact:<tool>/<id>', async () => {
    const { reg } = makeRegistry();
    const out = await reg.resolveUri<{ artifact: { data: unknown } }>(
      'parallx://tool-artifact:' + encodeURIComponent('web-research') + '/' + encodeURIComponent('r1'),
    );
    expect(out?.artifact.data).toEqual({ title: 'Page' });
  });

  it('rejects tool-artifact lookup for unknown id', async () => {
    const { reg } = makeRegistry();
    await expect(
      reg.resolveUri('parallx://tool-artifact:' + encodeURIComponent('web-research') + '/' + encodeURIComponent('missing')),
    ).rejects.toThrow();
  });

  it('returns null for malformed URI', async () => {
    const { reg } = makeRegistry();
    expect(await reg.resolveUri('not-a-uri')).toBeNull();
  });
});
