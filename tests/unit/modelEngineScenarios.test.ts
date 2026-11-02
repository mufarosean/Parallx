// modelEngineScenarios.test.ts — every kind of model call against every
// state of the engine (src/services/modelEngineBroker.ts, its header lists
// the rules). The engine here is a local one as Ollama is: one request at a
// time, a model loaded at one shape (reloaded when a request names another),
// answers streamed on a clock, a dropped request freeing it at once.
//
// The first block is the table: for each state the engine can be in and each
// class of call that can arrive, what happens to the arrival (it starts now,
// it waits, or it starts now and the running call gives way). The rest are
// the sequences that failed in use before the rules were written: a sync
// that waited behind a routine, a chat turn that waited for a silent engine,
// a day of calls at different context sizes.
import { describe, it, expect, vi, afterEach } from 'vitest';
import { ModelEngineBroker, LEASE_GRACE_MS, LEASE_IDLE_MS, TYPING_HOLD_MS, INTERACTIVE_FIRST_OUTPUT_MS } from '../../src/services/modelEngineBroker';
import type { EngineStart, EnginePriority, IEngineRequest } from '../../src/services/modelEngineBroker';
import type { IChatResponseChunk } from '../../src/services/chatTypes';

const abortError = () => new DOMException('aborted', 'AbortError');

interface IAttempt { label: string; modelId: string; numCtx: number; startedAt: number; aborted: boolean; done: boolean }

/** A local engine: one request at a time, one loaded shape, answers on a clock. */
class FakeEngine {
  loaded: { modelId: string; numCtx: number } | undefined;
  reloads = 0;
  readonly attempts: IAttempt[] = [];
  private _busy = false;
  private readonly _line: Array<{ take: () => void; drop: () => void }> = [];
  constructor(readonly loadMs = 30_000) {}

  /** The requests whose answers began, in the order the engine took them. */
  get served(): string[] { return this.attempts.filter((a) => !a.aborted || a.done).map((a) => a.label); }

  private _acquire(signal: AbortSignal): Promise<void> {
    if (!this._busy) { this._busy = true; return Promise.resolve(); }
    return new Promise<void>((resolve, reject) => {
      const entry = { take: () => { signal.removeEventListener('abort', onAbort); resolve(); }, drop: () => reject(abortError()) };
      const onAbort = () => { const i = this._line.indexOf(entry); if (i >= 0) this._line.splice(i, 1); entry.drop(); };
      signal.addEventListener('abort', onAbort, { once: true });
      this._line.push(entry);
    });
  }
  private _release(): void {
    const next = this._line.shift();
    if (next) next.take(); else this._busy = false;
  }
  private _wait(ms: number, signal: AbortSignal): Promise<void> {
    return new Promise<void>((resolve, reject) => {
      const t = setTimeout(resolve, ms);
      signal.addEventListener('abort', () => { clearTimeout(t); reject(abortError()); }, { once: true });
      if (signal.aborted) { clearTimeout(t); reject(abortError()); }
    });
  }

  /** A call to this engine: `chunks` pieces of an answer, one every `stepMs`; `silent` never answers. */
  start(label: string, modelId: string, { chunks = 3, stepMs = 1_000, silent = false } = {}): EngineStart {
    return (options, signal) => {
      const engine = this;
      return (async function* () {
        const attempt: IAttempt = { label, modelId, numCtx: options?.numCtx ?? 0, startedAt: Date.now(), aborted: false, done: false };
        engine.attempts.push(attempt);
        try {
          await engine._acquire(signal);
        } catch (err) { attempt.aborted = true; throw err; }
        try {
          if (!engine.loaded || engine.loaded.modelId !== modelId || engine.loaded.numCtx !== attempt.numCtx) {
            await engine._wait(engine.loadMs, signal);
            engine.loaded = { modelId, numCtx: attempt.numCtx };
            engine.reloads++;
          }
          if (silent) await engine._wait(20 * INTERACTIVE_FIRST_OUTPUT_MS, signal); // past any watchdog; a longer delay overflows setTimeout
          for (let i = 0; i < chunks; i++) {
            await engine._wait(stepMs, signal);
            yield { content: `${label}${i}`, done: i === chunks - 1 } as IChatResponseChunk;
          }
          attempt.done = true;
        } catch (err) {
          attempt.aborted = true;
          throw err;
        } finally {
          engine._release();
        }
      })();
    };
  }
}

async function collect(it: AsyncIterable<IChatResponseChunk>): Promise<string> {
  let s = '';
  for await (const c of it) s += c.content;
  return s;
}

const MODEL = 'qwen';
const tick = (ms: number) => vi.advanceTimersByTimeAsync(ms);

/** A request of one class. A chat turn's call carries its chat's run id; a job's its attended flag. */
function requestOf(cls: EnginePriority | 'chat' | 'extension', runId?: string, numCtx?: number): IEngineRequest {
  const base = { engine: 'ollama', gated: true, modelId: MODEL };
  switch (cls) {
    case 'chat': return { ...base, options: { numCtx, engine: { runId: runId ?? 'chat-1' } } };
    case 'extension': return { ...base, options: { numCtx } };
    case 'attended': return { ...base, options: { numCtx, engine: { attended: true, label: 'Budget sync' } } };
    default: return { ...base, options: { numCtx, engine: { priority: cls, runId: runId ?? `${cls}-run` } } };
  }
}

type EngineState = 'idle' | 'chat call running' | 'chat turn between steps' | 'chat turn quiet past its idle limit' | 'typing in chat'
  | 'attended call running' | 'scheduled call running' | 'helper call running' | 'maintenance call running';
type Arrival = 'interactive' | 'attended' | 'scheduled' | 'helper' | 'maintenance';
type Outcome = 'starts now' | 'waits' | 'starts now, the running call gives way';

/**
 * The table. Rule 1: an interactive call always starts now. Rule 2: the rest
 * wait behind an interactive call, a lease or typing, and among themselves a
 * higher class pauses a lower one, a lower waits. Rule 7: a quiet lease
 * stops holding.
 */
const TABLE: Record<EngineState, Record<Arrival, Outcome>> = {
  'idle':                                 { interactive: 'starts now', attended: 'starts now', scheduled: 'starts now', helper: 'starts now', maintenance: 'starts now' },
  'chat call running':                    { interactive: 'starts now', attended: 'waits', scheduled: 'waits', helper: 'waits', maintenance: 'waits' },
  'chat turn between steps':              { interactive: 'starts now', attended: 'waits', scheduled: 'waits', helper: 'waits', maintenance: 'waits' },
  'chat turn quiet past its idle limit':  { interactive: 'starts now', attended: 'starts now', scheduled: 'starts now', helper: 'starts now', maintenance: 'starts now' },
  'typing in chat':                       { interactive: 'starts now', attended: 'waits', scheduled: 'waits', helper: 'waits', maintenance: 'waits' },
  'attended call running':                { interactive: 'starts now, the running call gives way', attended: 'waits', scheduled: 'waits', helper: 'waits', maintenance: 'waits' },
  'scheduled call running':               { interactive: 'starts now, the running call gives way', attended: 'starts now, the running call gives way', scheduled: 'waits', helper: 'waits', maintenance: 'waits' },
  'helper call running':                  { interactive: 'starts now, the running call gives way', attended: 'starts now, the running call gives way', scheduled: 'starts now, the running call gives way', helper: 'waits', maintenance: 'waits' },
  'maintenance call running':             { interactive: 'starts now, the running call gives way', attended: 'starts now, the running call gives way', scheduled: 'starts now, the running call gives way', helper: 'starts now, the running call gives way', maintenance: 'waits' },
};

async function observe(state: EngineState, arrival: Arrival): Promise<Outcome> {
  const b = new ModelEngineBroker();
  const e = new FakeEngine(0);
  e.loaded = { modelId: MODEL, numCtx: 0 };
  const pending: Promise<unknown>[] = [];
  let lease: { dispose(): void } | undefined;
  const running = (cls: EnginePriority | 'chat') => {
    const p = collect(b.request(requestOf(cls), e.start('running', MODEL, { chunks: 2, stepMs: 60_000 })));
    p.catch(() => undefined);
    pending.push(p);
  };
  switch (state) {
    case 'chat call running': running('chat'); break;
    case 'chat turn between steps': lease = b.beginInteractive('ollama'); break;
    case 'chat turn quiet past its idle limit': lease = b.beginInteractive('ollama'); await tick(LEASE_IDLE_MS + 1_000); break;
    case 'typing in chat': b.noteUserActivity(); break;
    case 'attended call running': running('attended'); break;
    case 'scheduled call running': running('scheduled'); break;
    case 'helper call running': running('helper'); break;
    case 'maintenance call running': running('maintenance'); break;
    default: break;
  }
  await tick(100);
  const wasRunning = e.attempts.find((a) => a.label === 'running');
  const p = collect(b.request(requestOf(arrival === 'interactive' ? 'extension' : arrival), e.start('arrival', MODEL, { chunks: 1, stepMs: 10 })));
  p.catch(() => undefined);
  pending.push(p);
  await tick(500);
  // What the broker decided: a call it holds makes no request to the engine
  // at all; one it lets through makes its request now (two interactive calls
  // are then ordered by the engine itself, as rule 1 says).
  const started = e.attempts.find((a) => a.label === 'arrival');
  let outcome: Outcome;
  if (!started) outcome = 'waits';
  else if (wasRunning?.aborted) outcome = 'starts now, the running call gives way';
  else outcome = 'starts now';
  lease?.dispose();
  await tick(LEASE_GRACE_MS + TYPING_HOLD_MS + 200_000);
  await Promise.allSettled(pending);
  return outcome;
}

afterEach(() => { vi.useRealTimers(); });

describe('every class of call against every state of the engine', () => {
  for (const state of Object.keys(TABLE) as EngineState[]) {
    for (const arrival of Object.keys(TABLE[state]) as Arrival[]) {
      it(`${arrival} arriving while ${state}: ${TABLE[state][arrival]}`, async () => {
        vi.useFakeTimers();
        expect(await observe(state, arrival)).toBe(TABLE[state][arrival]);
      });
    }
  }
});

describe('the sequences that failed in use', () => {
  it('a sync of many emails runs them back to back ahead of a routine, which runs after the sync', async () => {
    vi.useFakeTimers();
    const b = new ModelEngineBroker();
    const e = new FakeEngine(0);
    const routine = collect(b.request(requestOf('scheduled', 'routine'), e.start('routine', MODEL, { chunks: 3, stepMs: 30_000 })));
    await tick(1_000); // the routine is a minute and a half of generation; the sync starts now
    const answers: string[] = [];
    const waits: number[] = [];
    for (let i = 0; i < 5; i++) {
      const asked = Date.now();
      const first = e.attempts.length;
      const p = collect(b.request(requestOf('attended'), e.start(`email${i}`, MODEL, { chunks: 2, stepMs: 5_000 })));
      await tick(50);
      waits.push(e.attempts[first] && e.attempts[first].label === `email${i}` ? e.attempts[first].startedAt - asked : Infinity);
      answers.push(await (async () => { await tick(11_000); return p; })());
      await tick(1_000); // Budget's own work between emails: under the grace
    }
    expect(answers).toEqual(['email00email01', 'email10email11', 'email20email21', 'email30email31', 'email40email41']);
    expect(Math.max(...waits)).toBeLessThan(100); // none of the sync's calls waited
    expect(b.preemptions('routine')).toBe(1); // the routine gave way once, at the start
    await tick(LEASE_GRACE_MS + 100_000);
    expect(await routine).toBe('routine0routine1routine2'); // and finished afterwards, whole
    expect(e.attempts.filter((a) => a.label === 'routine').length).toBe(2);
  });

  it('a chat turn during a sync starts now; the email it interrupted is answered afterwards, once, whole', async () => {
    vi.useFakeTimers();
    const b = new ModelEngineBroker();
    const e = new FakeEngine(0);
    const email = collect(b.request(requestOf('attended'), e.start('email', MODEL, { chunks: 4, stepMs: 5_000 })));
    await tick(7_000); // one chunk in
    const chat = collect(b.request(requestOf('chat'), e.start('chat', MODEL, { chunks: 2, stepMs: 1_000 })));
    await tick(50);
    expect(e.attempts.map((a) => a.label)).toEqual(['email', 'chat']);
    expect(e.attempts[0].aborted).toBe(true);
    await tick(3_000);
    expect(await chat).toBe('chat0chat1');
    await tick(LEASE_GRACE_MS + 30_000);
    expect(await email).toBe('email0email1email2email3');
    expect(e.attempts.filter((a) => a.label === 'email' && a.done).length).toBe(1);
  });

  it('a refresh you click runs like a chat turn: it is never delayed by routines; a scheduled refresh waits its turn', async () => {
    vi.useFakeTimers();
    const b = new ModelEngineBroker();
    const e = new FakeEngine(0);
    const routine = collect(b.request(requestOf('scheduled', 'routine'), e.start('routine', MODEL, { chunks: 3, stepMs: 30_000 })));
    await tick(1_000);
    // Clicked: the chat service classes the run interactive and holds a lease for its turn.
    const lease = b.beginInteractive('ollama');
    const clicked = collect(b.request(requestOf('chat', 'clicked-refresh'), e.start('clicked', MODEL, { chunks: 1, stepMs: 1_000 })));
    await tick(1_500);
    expect(await clicked).toBe('clicked0');
    lease.dispose();
    const scheduled = collect(b.request(requestOf('scheduled', 'scheduled-refresh'), e.start('scheduled', MODEL, { chunks: 1, stepMs: 1_000 })));
    await tick(LEASE_GRACE_MS + 200_000);
    expect(await routine).toBe('routine0routine1routine2'); // the older scheduled work first
    expect(await scheduled).toBe('scheduled0');
    expect(e.served.indexOf('routine')).toBeLessThan(e.served.indexOf('scheduled'));
  });

  it('after a burst of chat turns, every waiting class runs, in class order, and nothing is left behind', async () => {
    vi.useFakeTimers();
    const b = new ModelEngineBroker();
    const e = new FakeEngine(0);
    const waiting = {
      maintenance: collect(b.request(requestOf('maintenance', 'link'), e.start('link', MODEL, { chunks: 1, stepMs: 1_000 }))),
      helper: collect(b.request(requestOf('helper', 'help'), e.start('help', MODEL, { chunks: 1, stepMs: 1_000 }))),
      scheduled: collect(b.request(requestOf('scheduled', 'heartbeat'), e.start('heartbeat', MODEL, { chunks: 1, stepMs: 1_000 }))),
      attended: collect(b.request(requestOf('attended'), e.start('sync', MODEL, { chunks: 1, stepMs: 1_000 }))),
    };
    for (let turn = 0; turn < 3; turn++) {
      const lease = b.beginInteractive('ollama');
      const t = collect(b.request(requestOf('chat'), e.start(`turn${turn}`, MODEL, { chunks: 2, stepMs: 1_000 })));
      await tick(2_500);
      expect(await t).toBe(`turn${turn}0turn${turn}1`);
      lease.dispose();
      await tick(1_000); // you reply within the grace: nothing else got in
    }
    expect(e.served.filter((l) => !l.startsWith('turn'))).toEqual([]);
    await tick(LEASE_GRACE_MS + 60_000);
    expect(await Promise.all(Object.values(waiting))).toEqual(['link0', 'help0', 'heartbeat0', 'sync0']);
    expect(e.served.filter((l) => !l.startsWith('turn'))).toEqual(['sync', 'heartbeat', 'help', 'link']);
    expect(b.snapshot('ollama')[0]?.queued ?? []).toEqual([]);
  });

  it('a day of sizeless calls loads the model once at the shape the chat set; a call that names its size is run at it', async () => {
    vi.useFakeTimers();
    const b = new ModelEngineBroker();
    const e = new FakeEngine(30_000);
    b.noteLoadedShape('ollama', MODEL, 131_072); // the launch warm-up, at the chat's last size
    e.loaded = { modelId: MODEL, numCtx: 131_072 };
    const run = async (req: IEngineRequest, label: string) => { const p = collect(b.request(req, e.start(label, MODEL, { chunks: 1, stepMs: 1_000 }))); await tick(LEASE_GRACE_MS + 40_000); return p; };
    await run(requestOf('chat', 'chat-1', 131_072), 'chat');
    await run(requestOf('scheduled', 'routine'), 'routine');            // a routine with no size of its own
    await run(requestOf('attended'), 'budget');                        // a sync with none
    await run(requestOf('extension'), 'inline');                        // inline AI, none
    await run(requestOf('helper', 'helper'), 'helper');
    await run(requestOf('chat', 'chat-2', 131_072), 'chat-again');
    expect(e.reloads).toBe(0);
    expect(new Set(e.attempts.map((a) => a.numCtx))).toEqual(new Set([131_072]));
    // An extension thread the user set to 64K runs at 64K (one reload, the user's), and sizeless calls follow it.
    await run(requestOf('extension', undefined, 65_536), 'creations-thread');
    await run(requestOf('extension'), 'inline-again');
    expect(e.reloads).toBe(1);
    expect(e.attempts.slice(-2).map((a) => a.numCtx)).toEqual([65_536, 65_536]);
  });

  it('a silent engine: a chat turn and a sync each fail with a message after five minutes, and the engine is free again', async () => {
    vi.useFakeTimers();
    const b = new ModelEngineBroker();
    const e = new FakeEngine(0);
    const chat = collect(b.request(requestOf('chat'), e.start('chat', MODEL, { silent: true })));
    chat.catch(() => undefined);
    const routine = collect(b.request(requestOf('scheduled', 'routine'), e.start('routine', MODEL, { chunks: 1, stepMs: 1_000 })));
    await tick(INTERACTIVE_FIRST_OUTPUT_MS + 1_000);
    await expect(chat).rejects.toThrow(/gave no answer for 5 minutes/);
    await tick(LEASE_GRACE_MS + 5_000);
    expect(await routine).toBe('routine0');
    const sync = collect(b.request(requestOf('attended'), e.start('sync', MODEL, { silent: true })));
    sync.catch(() => undefined);
    await tick(INTERACTIVE_FIRST_OUTPUT_MS + 1_000);
    await expect(sync).rejects.toThrow(/gave no answer for 5 minutes/);
    expect(b.snapshot('ollama')[0]?.running ?? []).toEqual([]);
  });

  it('a turn that waits on a maintenance call of its own engine is not stuck for ever: the quiet lease lets it through', async () => {
    vi.useFakeTimers();
    const b = new ModelEngineBroker();
    const e = new FakeEngine(0);
    const lease = b.beginInteractive('ollama'); // the turn holds the engine, then awaits this call
    const awaited = collect(b.request(requestOf('maintenance', 'summary'), e.start('summary', MODEL, { chunks: 1, stepMs: 1_000 })));
    await tick(LEASE_IDLE_MS - 5_000);
    expect(e.attempts.length).toBe(0);
    await tick(10_000);
    expect(await awaited).toBe('summary0');
    lease.dispose();
  });
});
