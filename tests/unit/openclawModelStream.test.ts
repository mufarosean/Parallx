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
