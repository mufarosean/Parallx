import { describe, it, expect, vi, afterEach } from 'vitest';
import { ModelEngineBroker, BACKGROUND_MAX_TOKENS, LEASE_GRACE_MS } from '../../src/services/modelEngineBroker';
import type { EngineStart, EnginePriority } from '../../src/services/modelEngineBroker';
import type { IChatRequestOptions, IChatResponseChunk } from '../../src/services/chatTypes';

// A fake provider call: yields `n` chunks, one per `step` ms, and honours
// abort the way fetch does (rejects with AbortError).
interface ICallLog { label: string; started: number; aborted: boolean; finished: boolean; options?: IChatRequestOptions }

function fakeStart(log: ICallLog[], label: string, n = 3, step = 10): EngineStart {
  return (options, signal) => (async function* () {
    const entry: ICallLog = { label, started: Date.now(), aborted: false, finished: false, options };
    log.push(entry);
    for (let i = 0; i < n; i++) {
      await new Promise<void>((resolve, reject) => {
        const t = setTimeout(resolve, step);
        signal.addEventListener('abort', () => { clearTimeout(t); entry.aborted = true; reject(new DOMException('aborted', 'AbortError')); }, { once: true });
        if (signal.aborted) { clearTimeout(t); entry.aborted = true; reject(new DOMException('aborted', 'AbortError')); }
      });
      yield { content: `${label}${i}`, done: i === n - 1 } as IChatResponseChunk;
    }
    entry.finished = true;
  })();
}

async function collect(it: AsyncIterable<IChatResponseChunk>): Promise<string> {
  let s = '';
  for await (const c of it) s += c.content;
  return s;
}

const req = (priority: EnginePriority, runId?: string, signal?: AbortSignal, gated = true) => ({
  engine: 'ollama', gated, modelId: 'm', options: { engine: { priority, runId } }, signal,
});

afterEach(() => { vi.useRealTimers(); });

describe('ModelEngineBroker', () => {
  it('runs background tickets one at a time, highest class first, then by age', async () => {
    const b = new ModelEngineBroker();
    const log: ICallLog[] = [];
    const order: string[] = [];
    const run = (p: EnginePriority, label: string) => collect(b.request(req(p), fakeStart(log, label, 2, 5))).then((s) => { order.push(label); return s; });
    const all = Promise.all([
      run('helper', 'h'),        // starts first (engine idle)
      run('maintenance', 'm'),
      run('scheduled', 's1'),
      run('helper', 'h2'),
      run('scheduled', 's2'),
    ]);
    await all;
    expect(order).toEqual(['h', 's1', 's2', 'h2', 'm']);
    // Never two at once.
    for (let i = 1; i < log.length; i++) expect(log[i].started).toBeGreaterThanOrEqual(log[i - 1].started);
  });

  it('interactive calls stream at once and preempt a running background call, which resumes cleanly', async () => {
    const b = new ModelEngineBroker();
    const log: ICallLog[] = [];
    const bg = collect(b.request(req('scheduled', 'run-1'), fakeStart(log, 'b', 4, 15)));
    await new Promise((r) => setTimeout(r, 25)); // bg is mid-stream
    expect(b.getRunState('run-1')).toBe('working');
    const chat = await collect(b.request(req('interactive', 'chat'), fakeStart(log, 'c', 2, 5)));
    expect(chat).toBe('c0c1');
    expect(log[0].aborted).toBe(true);       // the real request was closed
    expect(b.preemptions('run-1')).toBe(1);
    // The background caller sees one clean answer, no partial text.
    expect(await bg).toBe('b0b1b2b3');
    expect(log.filter((l) => l.label === 'b').length).toBe(2);
  });

  it('a chat lease holds background work for the whole turn and the grace after it', async () => {
    vi.useFakeTimers();
    const b = new ModelEngineBroker();
    const log: ICallLog[] = [];
    const lease = b.beginInteractive('ollama');
    let done = false;
    const bg = collect(b.request(req('scheduled', 'r'), fakeStart(log, 'b', 1, 1))).then((s) => { done = true; return s; });
    await vi.advanceTimersByTimeAsync(10_000);
    expect(log.length).toBe(0);
    expect(b.getRunState('r')).toBe('waiting');
    lease.dispose();
    await vi.advanceTimersByTimeAsync(LEASE_GRACE_MS - 100);
    expect(log.length).toBe(0);
    await vi.advanceTimersByTimeAsync(200);
    expect(done).toBe(true);
    expect(await bg).toBe('b0');
    expect(b.waitingMs('r')).toBeGreaterThanOrEqual(10_000 + LEASE_GRACE_MS - 100);
  });

  it('a lease on another engine does not hold this one', async () => {
    const b = new ModelEngineBroker();
    const log: ICallLog[] = [];
    const lease = b.beginInteractive('anthropic');
    expect(await collect(b.request(req('scheduled'), fakeStart(log, 'b', 1, 1)))).toBe('b0');
    lease.dispose();
  });

  it('typing in chat keeps queued work still for a moment', async () => {
    vi.useFakeTimers();
    const b = new ModelEngineBroker();
    const log: ICallLog[] = [];
    b.noteUserActivity();
    const bg = collect(b.request(req('scheduled'), fakeStart(log, 'b', 1, 1)));
    await vi.advanceTimersByTimeAsync(1_000);
    expect(log.length).toBe(0);
    await vi.advanceTimersByTimeAsync(4_000);
    expect(await bg).toBe('b0');
  });

  it("the caller's cancel aborts a queued or running ticket and frees the engine", async () => {
    const b = new ModelEngineBroker();
    const log: ICallLog[] = [];
    const a1 = new AbortController();
    const a2 = new AbortController();
    const first = collect(b.request(req('scheduled', 'x', a1.signal), fakeStart(log, 'x', 10, 20)));
    const second = collect(b.request(req('scheduled', 'y', a2.signal), fakeStart(log, 'y', 1, 1)));
    await new Promise((r) => setTimeout(r, 30));
    a2.abort(); // still queued
    await expect(second).rejects.toMatchObject({ name: 'AbortError' });
    a1.abort(); // running
    await expect(first).rejects.toMatchObject({ name: 'AbortError' });
    expect(log.find((l) => l.label === 'x')?.aborted).toBe(true);
    expect(log.some((l) => l.label === 'y')).toBe(false);
    // Engine is free.
    expect(await collect(b.request(req('scheduled'), fakeStart(log, 'z', 1, 1)))).toBe('z0');
    expect(b.snapshot('ollama')[0].running.length).toBe(0);
  });

  it('a consumer that stops reading an interactive stream closes the request', async () => {
    const b = new ModelEngineBroker();
    const log: ICallLog[] = [];
    for await (const c of b.request(req('interactive'), fakeStart(log, 'c', 10, 5))) {
      if (c.content === 'c1') break;
    }
    // The generator's finally ran and the provider signal was aborted.
    await new Promise((r) => setTimeout(r, 10));
    expect(log[0].finished).toBe(false);
    expect(b.snapshot('ollama')[0].running.length).toBe(0);
  });

  it('a non-abort failure of a background call surfaces; the queue moves on', async () => {
    const b = new ModelEngineBroker();
    const failing: EngineStart = () => (async function* () { throw new Error('model not found'); })();
    await expect(collect(b.request(req('scheduled'), failing))).rejects.toThrow('model not found');
    const log: ICallLog[] = [];
    expect(await collect(b.request(req('scheduled'), fakeStart(log, 'ok', 1, 1)))).toBe('ok0');
  });

  it('caps background output when the caller names no cap; chat is untouched', async () => {
    const b = new ModelEngineBroker();
    const log: ICallLog[] = [];
    await collect(b.request(req('scheduled'), fakeStart(log, 'b', 1, 1)));
    await collect(b.request(req('interactive'), fakeStart(log, 'c', 1, 1)));
    await collect(b.request({ ...req('helper'), options: { maxTokens: 500, engine: { priority: 'helper' } } }, fakeStart(log, 'h', 1, 1)));
    expect(log[0].options?.maxTokens).toBe(BACKGROUND_MAX_TOKENS);
    expect(log[1].options?.maxTokens).toBeUndefined();
    expect(log[2].options?.maxTokens).toBe(500);
  });

  it('classifies from the run id; untagged calls are interactive', async () => {
    vi.useFakeTimers();
    const b = new ModelEngineBroker();
    b.setClassifier((id) => (id.startsWith('bg') ? 'scheduled' : undefined));
    const lease = b.beginInteractive('ollama');
    const log: ICallLog[] = [];
    // Untagged and chat-run calls go straight through during the lease.
    const u = collect(b.request({ engine: 'ollama', gated: true, modelId: 'm' }, fakeStart(log, 'u', 1, 1)));
    const c = collect(b.request({ engine: 'ollama', gated: true, modelId: 'm', options: { engine: { runId: 'chat-1' } } }, fakeStart(log, 'c', 1, 1)));
    const bg = collect(b.request({ engine: 'ollama', gated: true, modelId: 'm', options: { engine: { runId: 'bg-1' } } }, fakeStart(log, 'b', 1, 1)));
    await vi.advanceTimersByTimeAsync(20);
    expect(await u).toBe('u0');
    expect(await c).toBe('c0');
    expect(log.some((l) => l.label === 'b')).toBe(false);
    lease.dispose();
    await vi.advanceTimersByTimeAsync(LEASE_GRACE_MS + 50);
    expect(await bg).toBe('b0');
  });

  it('cloud engines pass through, unqueued', async () => {
    const b = new ModelEngineBroker();
    const lease = b.beginInteractive('ollama');
    const log: ICallLog[] = [];
    expect(await collect(b.request(req('scheduled', undefined, undefined, false), fakeStart(log, 'k', 1, 1)))).toBe('k0');
    lease.dispose();
  });

  it('honours a learned concurrency above one', async () => {
    const b = new ModelEngineBroker(() => 2);
    const log: ICallLog[] = [];
    await Promise.all([
      collect(b.request(req('scheduled'), fakeStart(log, 'a', 2, 20))),
      collect(b.request(req('scheduled'), fakeStart(log, 'b', 2, 20))),
    ]);
    expect(Math.abs(log[0].started - log[1].started)).toBeLessThan(15);
  });

  it('chat turns set the loaded context size; everyone else adopts it unless they need more', async () => {
    const b = new ModelEngineBroker();
    const log: ICallLog[] = [];
    const call = (options: IChatRequestOptions, label: string, modelId = 'm') =>
      collect(b.request({ engine: 'ollama', gated: true, modelId, options }, fakeStart(log, label, 1, 1)));
    await call({ numCtx: 163840, engine: { runId: 'chat' } }, 'chat');
    await call({ numCtx: 16384 }, 'ext');                                          // extension: smaller → loaded
    await call({ engine: { priority: 'scheduled' } }, 'bg-none');                  // unnamed → loaded
    await call({ numCtx: 32768, engine: { priority: 'scheduled' } }, 'bg-small');  // smaller → loaded
    await call({ numCtx: 32768, engine: { priority: 'scheduled' } }, 'other', 'm2'); // other model: its own
    expect(log.map((l) => l.options?.numCtx)).toEqual([163840, 163840, 163840, 163840, 32768]);
    // The other model is now what is loaded; the chat sets it back.
    await call({ numCtx: 65536, engine: { runId: 'chat' } }, 'chat2');
    expect(b.loadedShape('ollama')).toEqual({ modelId: 'm', numCtx: 65536 });
    await call({ numCtx: 200000, engine: { priority: 'scheduled' } }, 'bg-big');   // needs more: keeps it
    expect(log[log.length - 1].options?.numCtx).toBe(200000);
  });
});
