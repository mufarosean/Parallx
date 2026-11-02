import { describe, it, expect, vi, afterEach } from 'vitest';
import { ModelEngineBroker, BACKGROUND_MAX_TOKENS, LEASE_GRACE_MS, LEASE_IDLE_MS, INTERACTIVE_FIRST_OUTPUT_MS } from '../../src/services/modelEngineBroker';
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
  it('runs background tickets one at a time, highest class first (a higher class arriving pauses a lower one running), then by age', async () => {
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
    expect(order).toEqual(['s1', 's2', 'h', 'h2', 'm']) // h started first, gave way to the scheduled pair, and finished after them;
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

  it('a sized call keeps its size and sets the loaded shape; a sizeless call runs at the loaded shape', async () => {
    const b = new ModelEngineBroker();
    const log: ICallLog[] = [];
    const chat = (numCtx: number) => ({ engine: 'ollama', gated: true, modelId: 'm', options: { numCtx, engine: { runId: 'chat-1' } } });
    const bg = (numCtx?: number) => ({ engine: 'ollama', gated: true, modelId: 'm', options: { ...(numCtx ? { numCtx } : {}), engine: { priority: 'scheduled' as const, runId: 'r' } } });
    await collect(b.request(chat(65536), fakeStart(log, 'c', 1, 1)));
    expect(b.loadedShape('ollama')).toEqual({ modelId: 'm', numCtx: 65536 });
    await collect(b.request(bg(), fakeStart(log, 's', 1, 1)));                                                                      // no size: the loaded one
    await collect(b.request({ engine: 'ollama', gated: true, modelId: 'm', options: {} }, fakeStart(log, 'u', 1, 1)));              // an extension, no size: the loaded one
    await collect(b.request({ engine: 'ollama', gated: true, modelId: 'm', options: { numCtx: 131072 } }, fakeStart(log, 'x', 1, 1))); // an extension at the user's 128K: kept
    expect(log.slice(1).map((e) => e.options?.numCtx)).toEqual([65536, 65536, 131072]);
    expect(b.loadedShape('ollama')).toEqual({ modelId: 'm', numCtx: 131072 }); // and it is the shape now
    // The launch warm-up's load is the shape too, for sizeless calls to that model.
    b.noteLoadedShape('ollama', 'm2', 32768);
    await collect(b.request({ ...bg(), modelId: 'm2' }, fakeStart(log, 'w', 1, 1)));
    expect(log[4].options?.numCtx).toBe(32768);
    // A sized background call to the warm model keeps its own size.
    await collect(b.request({ ...bg(8192), modelId: 'm2' }, fakeStart(log, 'w2', 1, 1)));
    expect(log[5].options?.numCtx).toBe(8192);
  });

  it('maintenance work waits for chat to let go, and can be cancelled', async () => {
    vi.useFakeTimers();
    const b = new ModelEngineBroker();
    await b.whenIdle('ollama'); // free now
    const lease = b.beginInteractive('ollama');
    let idle = false;
    const p = b.whenIdle('ollama').then(() => { idle = true; });
    const a = new AbortController();
    const cancelled = b.whenIdle('ollama', a.signal);
    a.abort();
    await expect(cancelled).rejects.toMatchObject({ name: 'AbortError' });
    await vi.advanceTimersByTimeAsync(10_000);
    expect(idle).toBe(false);
    lease.dispose();
    await vi.advanceTimersByTimeAsync(LEASE_GRACE_MS + 50);
    await p;
    expect(idle).toBe(true);
  });

  it('a chat turn that stops using the model (waiting on your approval) lets background work run, and takes it back on its next call', async () => {
    vi.useFakeTimers();
    const b = new ModelEngineBroker();
    const log: ICallLog[] = [];
    const lease = b.beginInteractive('ollama');
    const bg = collect(b.request(req('scheduled', 'r'), fakeStart(log, 'b', 3, 1000)));
    await vi.advanceTimersByTimeAsync(LEASE_IDLE_MS - 1000);
    expect(log.length).toBe(0);
    await vi.advanceTimersByTimeAsync(1500);
    expect(log.length).toBe(1); // started after the turn went quiet
    // The turn speaks again: the background call gives way.
    const chat = collect(b.request(req('interactive', 'chat'), fakeStart(log, 'c', 1, 10)));
    await vi.advanceTimersByTimeAsync(50);
    expect(await chat).toBe('c0');
    expect(log[0].aborted).toBe(true);
    lease.dispose();
    await vi.advanceTimersByTimeAsync(LEASE_GRACE_MS + 4000);
    expect(await bg).toBe('b0b1b2');
  });
});

describe('untagged calls', () => {
  it('an untagged call (an extension, inline AI) starts now and pauses background work; one tagged background waits its turn', async () => {
    const b = new ModelEngineBroker();
    const log: ICallLog[] = [];
    const untagged = { engine: 'ollama', gated: true, modelId: 'm' };
    const bg = collect(b.request(req('scheduled', 'run-1'), fakeStart(log, 'b', 4, 15)));
    await new Promise((r) => setTimeout(r, 20));
    await collect(b.request(untagged, fakeStart(log, 'x', 1, 5)));
    expect(b.preemptions('run-1')).toBe(1);
    expect(log[1].label).toBe('x'); // it ran at once; the run resumed after
    expect(await bg).toBe('b0b1b2b3');
    const quiet = { engine: 'ollama', gated: true, modelId: 'm', options: { engine: { priority: 'helper' as const, label: 'Memory' } } };
    const bg2 = collect(b.request(req('scheduled', 'run-2'), fakeStart(log, 'c', 2, 15)));
    await new Promise((r) => setTimeout(r, 20));
    const q = collect(b.request(quiet, fakeStart(log, 'q', 1, 5)));
    expect(await bg2).toBe('c0c1');
    expect(b.preemptions('run-2')).toBe(0);
    expect(await q).toBe('q0');
  });

  it('a call you wait on that gets no output fails with a message after five minutes, and frees the engine', async () => {
    vi.useFakeTimers();
    const b = new ModelEngineBroker();
    const log: ICallLog[] = [];
    // An engine that never answers: the request hangs until aborted.
    const silent: EngineStart = (_o, signal) => (async function* () {
      await new Promise<void>((_, reject) => signal.addEventListener('abort', () => reject(new DOMException('aborted', 'AbortError')), { once: true }));
      yield { content: 'never', done: true } as IChatResponseChunk;
    })();
    const chat = collect(b.request(req('interactive', 'chat'), silent));
    chat.catch(() => undefined);
    const bg = collect(b.request(req('scheduled', 'run-1'), fakeStart(log, 'b', 1, 5)));
    await vi.advanceTimersByTimeAsync(INTERACTIVE_FIRST_OUTPUT_MS - 1000);
    expect(log.length).toBe(0); // the chat's call still holds the engine
    await vi.advanceTimersByTimeAsync(2000);
    await expect(chat).rejects.toThrow(/gave no answer for 5 minutes.*ollama ps/);
    await vi.advanceTimersByTimeAsync(LEASE_GRACE_MS + 1000);
    expect(await bg).toBe('b0'); // background work goes on once the stuck call is failed
  });

  it('more urgent background work pauses a running call of a lower class, which resumes after', async () => {
    const b = new ModelEngineBroker();
    const log: ICallLog[] = [];
    const linking = collect(b.request(req('maintenance', 'link'), fakeStart(log, 'm', 4, 15)));
    await new Promise((r) => setTimeout(r, 20));
    const refresh = collect(b.request(req('scheduled', 'widget'), fakeStart(log, 's', 1, 5)));
    expect(await refresh).toBe('s0');
    expect(b.preemptions('link')).toBe(1);
    expect(await linking).toBe('m0m1m2m3');
    // The lower class never pauses a higher one.
    const run = collect(b.request(req('scheduled', 'run'), fakeStart(log, 'r', 3, 15)));
    await new Promise((r) => setTimeout(r, 20));
    const later = collect(b.request(req('maintenance', 'late'), fakeStart(log, 'l', 1, 5)));
    expect(await run).toBe('r0r1r2');
    expect(b.preemptions('run')).toBe(0);
    expect(await later).toBe('l0');
  });

  it('an attended call (a job you started and watch, like a sync) goes ahead of background work, and keeps the engine between its calls', async () => {
    vi.useFakeTimers();
    const b = new ModelEngineBroker();
    const log: ICallLog[] = [];
    const attended = { engine: 'ollama', gated: true, modelId: 'm', options: { engine: { attended: true, label: 'Budget sync' } } };
    const bg = collect(b.request(req('scheduled', 'run-1'), fakeStart(log, 'b', 4, 1000)));
    await vi.advanceTimersByTimeAsync(500);
    expect(log.length).toBe(1);
    // You are away (no key for minutes), yet the sync's call does not wait behind the run.
    const first = collect(b.request(attended, fakeStart(log, 's', 1, 10)));
    await vi.advanceTimersByTimeAsync(20);
    expect(await first).toBe('s0');
    expect(log[0].aborted).toBe(true);
    expect(b.preemptions('run-1')).toBe(1);
    // Between the job's calls the run waits: the next call finds the engine free.
    await vi.advanceTimersByTimeAsync(LEASE_GRACE_MS - 1000);
    expect(log.length).toBe(2);
    const second = collect(b.request(attended, fakeStart(log, 't', 1, 10)));
    await vi.advanceTimersByTimeAsync(20);
    expect(await second).toBe('t0');
    expect(b.preemptions('run-1')).toBe(1);
    // After the job, the run resumes and finishes.
    await vi.advanceTimersByTimeAsync(LEASE_GRACE_MS + 5000);
    expect(await bg).toBe('b0b1b2b3');
  });

  it('the time a preempted call had run counts as waiting, not as the run\'s work', async () => {
    const b = new ModelEngineBroker();
    const log: ICallLog[] = [];
    // Warm the model so loading credit stays out of the sum.
    await collect(b.request(req('scheduled', 'warm'), fakeStart(log, 'w', 1, 1)));
    const bg = collect(b.request(req('scheduled', 'run-1'), fakeStart(log, 'b', 4, 15)));
    await new Promise((r) => setTimeout(r, 40)); // ran ~40ms, then thrown away
    await collect(b.request(req('interactive', 'chat'), fakeStart(log, 'c', 1, 5)));
    await bg;
    expect(b.waitingMs('run-1')).toBeGreaterThanOrEqual(35);
  });

  it('a model the engine has not served counts its load as waiting, once', async () => {
    const b = new ModelEngineBroker();
    const log: ICallLog[] = [];
    await collect(b.request(req('scheduled', 'cold'), fakeStart(log, 'a', 2, 30)));
    expect(b.waitingMs('cold')).toBeGreaterThanOrEqual(25); // the wait for its first output
    await collect(b.request(req('scheduled', 'warm'), fakeStart(log, 'a', 2, 30)));
    expect(b.waitingMs('warm')).toBeLessThan(25);
  });
});
