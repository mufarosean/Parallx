// embeddingWorker.test.ts — M60 Phase θ B3
//
// Asserts the worker-transport contract:
//   - `EmbeddingWorkerClient.isAvailable()` returns false when Worker is undefined
//   - `EmbeddingService.setTransport(fn)` routes `embedDocumentBatch` calls
//     through the transport instead of `fetch`
//   - Transport errors propagate (the per-chunk retry path inside
//     `embedDocumentBatch` then handles them — covered by existing tests)
//   - `setTransport(null)` reverts to the in-process fetch path

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { EmbeddingService } from '../../src/services/embeddingService.js';
import { EmbeddingWorkerClient } from '../../src/services/embeddingWorker.js';

describe('EmbeddingWorkerClient — M60 B3', () => {
  it('isAvailable() returns false when Worker is undefined in the runtime', () => {
    // vitest jsdom env doesn't expose Worker by default — this asserts the
    // safe no-op path that ships when the renderer can't construct a worker.
    const client = new EmbeddingWorkerClient();
    expect(client.isAvailable()).toBe(false);
    client.dispose();
  });

  it('embedBatch([]) shortcuts to empty array without spawning anything', async () => {
    const client = new EmbeddingWorkerClient();
    await expect(client.embedBatch('http://localhost:11434', 'nomic-embed-text', [])).resolves.toEqual([]);
    client.dispose();
  });
});

describe('EmbeddingService.setTransport — M60 B3', () => {
  let realFetch: typeof globalThis.fetch;

  beforeEach(() => {
    realFetch = globalThis.fetch;
  });

  afterEach(() => {
    globalThis.fetch = realFetch;
  });

  it('routes embedDocumentBatch through the installed transport', async () => {
    const svc = new EmbeddingService('http://localhost:11434', 'nomic-embed-text');
    // Bypass model verification (would otherwise issue a real fetch).
    (svc as unknown as { _modelVerified: boolean })._modelVerified = true;

    const transport = vi.fn(async (inputs: string[]) =>
      inputs.map(() => new Array(768).fill(0.1)),
    );
    svc.setTransport!(transport);

    // fetch must NOT be called.
    globalThis.fetch = vi.fn(() => { throw new Error('fetch should not be called when transport set'); }) as unknown as typeof fetch;

    const out = await svc.embedDocumentBatch(['a', 'b', 'c'], ['h1', 'h2', 'h3']);
    expect(out).toHaveLength(3);
    expect(out[0]).toHaveLength(768);
    expect(transport).toHaveBeenCalledTimes(1);
    // Transport receives prefixed texts (search_document: prefix added by the service).
    const passedInputs = transport.mock.calls[0][0];
    expect(passedInputs[0].startsWith('search_document: ')).toBe(true);

    svc.dispose();
  });

  it('setTransport(null) reverts to the in-process fetch path', async () => {
    const svc = new EmbeddingService('http://localhost:11434', 'nomic-embed-text');
    (svc as unknown as { _modelVerified: boolean })._modelVerified = true;

    const transport = vi.fn(async (inputs: string[]) =>
      inputs.map(() => new Array(768).fill(0.5)),
    );
    svc.setTransport!(transport);
    svc.setTransport!(null);

    const fetchMock = vi.fn(async () => new Response(
      JSON.stringify({ embeddings: [new Array(768).fill(0.2)] }),
      { status: 200, headers: { 'Content-Type': 'application/json' } },
    ));
    globalThis.fetch = fetchMock as unknown as typeof fetch;

    const out = await svc.embedDocumentBatch(['a'], ['h1']);
    expect(out).toHaveLength(1);
    expect(out[0][0]).toBeCloseTo(0.2);
    expect(transport).not.toHaveBeenCalled();
    expect(fetchMock).toHaveBeenCalledTimes(1);

    svc.dispose();
  });

  it('transport errors propagate from embedDocumentBatch (caller handles retry)', async () => {
    // Per-chunk retry on batch failure lives in IndexingPipeline._embedChunks,
    // not in EmbeddingService.embedDocumentBatch — so the throw must surface.
    const svc = new EmbeddingService('http://localhost:11434', 'nomic-embed-text');
    (svc as unknown as { _modelVerified: boolean })._modelVerified = true;

    const transport = vi.fn(async () => { throw new Error('simulated worker error'); });
    svc.setTransport!(transport);

    await expect(svc.embedDocumentBatch(['a', 'b'], ['h1', 'h2'])).rejects.toThrow('simulated worker error');
    expect(transport).toHaveBeenCalledTimes(1);

    svc.dispose();
  });
});
