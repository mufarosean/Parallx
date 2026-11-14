// openclawModelStream.test.ts — an answer that ran out of room says so.
//
// Ollama ends a reply that hit the output limit or the context window with
// done_reason "length". Nothing read it, so a cut-off answer (a routine's
// report capped at the background output limit, a long reply) read as
// finished.
import { describe, expect, it, vi } from 'vitest';
import type { IChatResponseChunk, IChatResponseStream, ICancellationToken } from '../../src/services/chatTypes';
import { executeModelStream } from '../../src/openclaw/openclawModelStream';

function response(): IChatResponseStream {
  return { markdown: vi.fn(), thinking: vi.fn(), progress: vi.fn(), warning: vi.fn() } as unknown as IChatResponseStream;
}
const token = { isCancellationRequested: false, onCancellationRequested: () => ({ dispose() {} }) } as unknown as ICancellationToken;
const send = (chunks: IChatResponseChunk[]) => async function* () { yield* chunks; };

describe('executeModelStream', () => {
  it('marks an answer that stopped for length as cut off', async () => {
    const r = response();
    const out = await executeModelStream(send([{ content: 'The tail factor is', done: false }, { content: '', done: true, doneReason: 'length' }]), [], {}, r, token);
    expect(out.doneReason).toBe('length');
    expect(r.warning).toHaveBeenCalledWith(expect.stringContaining('cut off'));
  });

  it('says nothing for an answer that finished, or for reasoning alone (that gets a retry)', async () => {
    const done = response();
    await executeModelStream(send([{ content: 'Done.', done: true, doneReason: 'stop' }]), [], {}, done, token);
    const thinkingOnly = response();
    await executeModelStream(send([{ content: '', thinking: 'Let me think', done: true, doneReason: 'length' }]), [], {}, thinkingOnly, token);
    expect(done.warning).not.toHaveBeenCalled();
    expect(thinkingOnly.warning).not.toHaveBeenCalled();
  });
});

describe('executeModelStream and the speed of an answer', () => {
  it('hands the response the figures the engine reported for the call, once, from its final chunk', async () => {
    const calls: unknown[] = [];
    const r = { ...response(), reportModelCall: (c: unknown) => calls.push(c) } as unknown as IChatResponseStream;
    await executeModelStream(send([
      { content: 'Fifty', done: false },
      { content: ' two.', done: true, doneReason: 'stop', promptEvalCount: 26, promptEvalDuration: 342546000, evalCount: 282, evalDuration: 4535599000, loadDuration: 1334875 },
    ]), [], {}, r, token);
    expect(calls).toHaveLength(1);
    expect(calls[0]).toMatchObject({ promptEvalCount: 26, promptEvalDuration: 342546000, evalCount: 282, evalDuration: 4535599000, loadDuration: 1334875 });
  });

  it('reports nothing for a call that never finished, and works with a response that takes no report', async () => {
    const calls: unknown[] = [];
    const r = { ...response(), reportModelCall: (c: unknown) => calls.push(c) } as unknown as IChatResponseStream;
    await executeModelStream(send([{ content: 'Cut', done: false }]), [], {}, r, token);
    expect(calls).toEqual([]);
    await expect(executeModelStream(send([{ content: 'Done.', done: true, evalCount: 3 }]), [], {}, response(), token)).resolves.toMatchObject({ completionTokens: 3 });
  });
});
