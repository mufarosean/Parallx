// ollamaContextFit.ts: the context that fits, from Ollama's own numbers.
import { describe, it, expect } from 'vitest';
import { fitContext, watchContextFit, FIT_FLOOR } from '../../src/built-in/chat/providers/ollamaContextFit.js';

const GiB = 1024 ** 3;

describe('fitContext', () => {
  it('a load that sits on the card fits at its size', () => {
    expect(fitContext({ contextLength: 65536, totalBytes: 30 * GiB, onCardBytes: 30 * GiB })).toBe(65536);
    expect(fitContext({ contextLength: 65536, totalBytes: 30 * GiB, onCardBytes: 29.8 * GiB })).toBe(65536);
  });

  it('a spilled load shrinks the context in proportion to what the card held, weights kept whole', () => {
    // 20 GiB of weights, 20 GiB of context cache at 128K; the card held 30 GiB of the 40.
    const fit = fitContext({ contextLength: 131072, totalBytes: 40 * GiB, onCardBytes: 30 * GiB, weightBytes: 20 * GiB });
    // room = 30 * 0.9 - 20 = 7 GiB; per token = 20 GiB / 131072; 7/20 * 131072 = 45875 -> rounded down to 1024
    expect(fit).toBe(44 * 1024);
    expect(fit).toBeLessThan(131072);
  });

  it('without the weights it scales the whole load by the share on the card', () => {
    const fit = fitContext({ contextLength: 131072, totalBytes: 40 * GiB, onCardBytes: 30 * GiB });
    // 30*0.9/40 * 131072 = 88473 -> 86 * 1024
    expect(fit).toBe(86 * 1024);
  });

  it('never goes below the floor, and leaves nonsense alone', () => {
    expect(fitContext({ contextLength: 8192, totalBytes: 40 * GiB, onCardBytes: 1 * GiB, weightBytes: 20 * GiB })).toBe(FIT_FLOOR);
    expect(fitContext({ contextLength: 0, totalBytes: 1, onCardBytes: 1 })).toBe(0);
  });
});

describe('watchContextFit', () => {
  const tick = (ms: number) => new Promise((r) => setTimeout(r, ms));

  it('reports the fit and aborts the attempt when the model loads spilled at the watched size', async () => {
    const fits: number[] = [];
    let calls = 0;
    const w = watchContextFit({
      modelId: 'm', contextLength: 131072, weightBytes: 20 * GiB, pollMs: 5, maxMs: 1000,
      ps: async () => { calls++; return { models: calls < 3 ? [] : [{ name: 'm', size: 40 * GiB, size_vram: 30 * GiB, context_length: 131072 }] }; },
      onFit: (n) => fits.push(n),
    });
    await tick(80);
    expect(fits).toEqual([44 * 1024]);
    expect(w.refit).toBe(44 * 1024);
    expect(w.signal.aborted).toBe(true);
  });

  it('a load on the card is reported as fitting at its size, and nothing is aborted', async () => {
    const fits: number[] = [];
    const w = watchContextFit({
      modelId: 'm', contextLength: 65536, pollMs: 5, maxMs: 1000,
      ps: async () => ({ models: [{ name: 'm', size: 30 * GiB, size_vram: 30 * GiB, context_length: 65536 }] }),
      onFit: (n) => fits.push(n),
    });
    await tick(40);
    expect(fits).toEqual([65536]);
    expect(w.refit).toBe(0);
    expect(w.signal.aborted).toBe(false);
  });

  it('another model, or the same model at another size, is not this load; it gives up after maxMs', async () => {
    const fits: number[] = [];
    const w = watchContextFit({
      modelId: 'm', contextLength: 65536, pollMs: 5, maxMs: 40,
      ps: async () => ({ models: [{ name: 'other', size: 1, size_vram: 0 }, { name: 'm', size: 40 * GiB, size_vram: 10 * GiB, context_length: 131072 }] }),
      onFit: (n) => fits.push(n),
    });
    await tick(120);
    expect(fits).toEqual([]);
    expect(w.signal.aborted).toBe(false);
  });

  it('stopped early (first output came), it reports nothing', async () => {
    const fits: number[] = [];
    const w = watchContextFit({
      modelId: 'm', contextLength: 131072, pollMs: 5, maxMs: 1000,
      ps: async () => ({ models: [{ name: 'm', size: 40 * GiB, size_vram: 30 * GiB, context_length: 131072 }] }),
      onFit: (n) => fits.push(n),
    });
    w.stop();
    await tick(40);
    expect(fits).toEqual([]);
  });
});
