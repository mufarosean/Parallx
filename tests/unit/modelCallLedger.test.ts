/**
 * The model-call ledger (src/services/modelCallLedger.ts): every call that
 * passes the engine broker is recorded with who asked, the model, tokens,
 * timings and outcome; the ledger keeps a bounded number; no prompt, answer
 * or thinking text ever lands in it.
 */

import { describe, it, expect } from 'vitest';
import { ModelEngineBroker } from '../../src/services/modelEngineBroker';
import type { EngineStart } from '../../src/services/modelEngineBroker';
import { ModelCallLedger, MAX_ERROR_CHARS, callerOf, shortError } from '../../src/services/modelCallLedger';
import { LanguageModelsService } from '../../src/services/languageModelsService';
import { LanguageModelBridge } from '../../src/api/bridges/languageModelBridge';
import { callerText, formatCallRow, formatDuration, formatTotalsRow } from '../../src/commands/modelCallsView';
import type { IChatMessage, IChatRequestOptions, IChatResponseChunk } from '../../src/services/chatTypes';

const SECRET = 'the-user-secret-prompt-and-answer';

/** A clock the test moves by hand. */
function clock(start = 1_000_000) {
  let t = start;
  return { now: () => t, advance: (ms: number) => { t += ms; } };
}

/** A provider call that yields the given chunks, moving the clock before each. */
function script(chunks: readonly (IChatResponseChunk & { after?: number })[], c?: ReturnType<typeof clock>, fail?: Error): EngineStart {
  return () => (async function* () {
    for (const { after, ...chunk } of chunks) {
      if (after) c?.advance(after);
      yield chunk as IChatResponseChunk;
    }
    if (fail) throw fail;
  })();
}

async function drain(it: AsyncIterable<IChatResponseChunk>): Promise<string> {
  let s = '';
  for await (const ch of it) s += ch.content;
  return s;
}

function setup(max?: number) {
  const c = clock();
  const ledger = new ModelCallLedger(c.now, max);
  const broker = new ModelEngineBroker(() => 1, c.now, ledger);
  return { c, ledger, broker };
}

const ANSWER: (IChatResponseChunk & { after?: number })[] = [
  { content: '', thinking: SECRET, done: false, after: 300 },
  { content: SECRET, done: false, after: 200 },
  { content: '', done: true, promptEvalCount: 120, evalCount: 45, doneReason: 'stop', after: 500 },
];

describe('model call ledger', () => {
  it('records who asked, the model, tokens, first token and total time', async () => {
    const { c, ledger, broker } = setup();
    const options: IChatRequestOptions = { engine: { priority: 'helper', label: 'Naming a chat' } };
    await drain(broker.request({ engine: 'cloud', gated: false, modelId: 'm1', options }, script(ANSWER, c)));
    const [rec] = ledger.entries();
    expect(rec).toMatchObject({
      caller: 'Naming a chat', priority: 'helper', modelId: 'm1', engine: 'cloud',
      promptTokens: 120, answerTokens: 45, firstTokenMs: 300, totalMs: 1000, outcome: 'done',
    });
    expect(rec.cutOff).toBeUndefined();
    expect(ledger.totals()).toEqual([{ caller: 'Naming a chat', calls: 1, promptTokens: 120, answerTokens: 45, totalMs: 1000, errors: 0 }]);
  });

  it('records a gated background call once, after it waited its turn', async () => {
    const { ledger, broker } = setup();
    const out = await drain(broker.request({ engine: 'ollama', gated: true, modelId: 'm1', options: { engine: { priority: 'maintenance', label: 'Linking pages' } } }, script(ANSWER)));
    expect(out).toBe(SECRET);
    expect(ledger.entries()).toHaveLength(1);
    expect(ledger.entries()[0]).toMatchObject({ caller: 'Linking pages', priority: 'maintenance', outcome: 'done', answerTokens: 45 });
  });

  it('names a chat turn, a background run and an untagged call', () => {
    expect(callerOf({ runId: 's1' }, 'interactive')).toBe('Chat');
    expect(callerOf({ runId: 's1' }, 'scheduled')).toBe('Background run');
    expect(callerOf(undefined, 'interactive')).toBe('Unlabelled call');
    expect(callerOf({ source: 'acme.tool' }, 'interactive')).toBe('acme.tool');
    expect(callerOf({ source: 'acme.tool', label: 'Summing up' }, 'interactive')).toBe('Summing up');
  });

  it('marks a reply cut off at the limit', async () => {
    const { ledger, broker } = setup();
    await drain(broker.request({ engine: 'e', gated: false, modelId: 'm' }, script([{ content: 'x', done: true, doneReason: 'length' }])));
    expect(ledger.entries()[0]).toMatchObject({ outcome: 'done', cutOff: true });
  });

  it('keeps only the newest calls, newest first, while the totals count all', async () => {
    const { ledger, broker } = setup(3);
    for (let i = 0; i < 5; i++) {
      await drain(broker.request({ engine: 'e', gated: false, modelId: `m${i}` }, script([{ content: 'x', done: true, evalCount: 1 }])));
    }
    expect(ledger.entries().map((r) => r.modelId)).toEqual(['m4', 'm3', 'm2']);
    expect(ledger.totals()[0]).toMatchObject({ caller: 'Unlabelled call', calls: 5, answerTokens: 5 });
  });

  it('records an error with its first line, cut short', async () => {
    const { ledger, broker } = setup();
    const long = `Model exploded ${'x'.repeat(300)}\nstack line`;
    await expect(drain(broker.request({ engine: 'e', gated: false, modelId: 'm' }, script([{ content: 'a', done: false }], undefined, new Error(long))))).rejects.toThrow();
    const [rec] = ledger.entries();
    expect(rec.outcome).toBe('error');
    expect(rec.error!.length).toBeLessThanOrEqual(MAX_ERROR_CHARS);
    expect(rec.error!.startsWith('Model exploded')).toBe(true);
    expect(rec.error).not.toContain('stack line');
    expect(ledger.totals()[0].errors).toBe(1);
    expect(shortError('one\ntwo')).toBe('one');
  });

  it('records a call the caller cancelled as stopped', async () => {
    const { ledger, broker } = setup();
    const ac = new AbortController();
    const start: EngineStart = (_o, signal) => (async function* () {
      yield { content: 'a', done: false } as IChatResponseChunk;
      ac.abort();
      if (signal.aborted) throw new DOMException('aborted', 'AbortError');
    })();
    await expect(drain(broker.request({ engine: 'e', gated: false, modelId: 'm', signal: ac.signal }, start))).rejects.toThrow();
    expect(ledger.entries()[0].outcome).toBe('stopped');
    expect(ledger.totals()[0].errors).toBe(0);
  });

  it('a reader that stops before the end stops the call; one that stops on the final chunk finished it', async () => {
    const { ledger, broker } = setup();
    for await (const ch of broker.request({ engine: 'e', gated: false, modelId: 'early' }, script(ANSWER))) { if (ch.content) break; }
    for await (const ch of broker.request({ engine: 'e', gated: false, modelId: 'late' }, script(ANSWER))) { if (ch.done) break; }
    const byModel = Object.fromEntries(ledger.entries().map((r) => [r.modelId, r.outcome]));
    expect(byModel).toEqual({ early: 'stopped', late: 'done' });
  });

  it('shows a call as running until it ends, and Clear keeps the running one', async () => {
    const { ledger, broker } = setup();
    await drain(broker.request({ engine: 'e', gated: false, modelId: 'old' }, script([{ content: 'x', done: true }])));
    const it = broker.request({ engine: 'e', gated: false, modelId: 'now' }, script(ANSWER))[Symbol.asyncIterator]();
    await it.next();
    expect(ledger.entries()[0]).toMatchObject({ modelId: 'now', outcome: 'running' });
    ledger.clear();
    expect(ledger.entries().map((r) => r.modelId)).toEqual(['now']);
    expect(ledger.totals()).toEqual([]);
    while (!(await it.next()).done) { /* drain */ }
    expect(ledger.entries()[0].outcome).toBe('done');
    expect(ledger.totals()[0].calls).toBe(1);
  });

  it('stores no prompt, answer, thinking or tool call text', async () => {
    const { ledger, broker } = setup();
    const chunks = [...ANSWER.slice(0, 2), { content: '', toolCalls: [{ function: { name: 'x', arguments: { q: SECRET } } }], done: false } as never, ANSWER[2]];
    await drain(broker.request({ engine: 'e', gated: false, modelId: 'm' }, script(chunks)));
    await expect(drain(broker.request({ engine: 'e', gated: false, modelId: 'm' }, script([{ content: SECRET, done: false }], undefined, new Error('Bad request'))))).rejects.toThrow();
    const stored = JSON.stringify([ledger.entries(), ledger.totals()]);
    expect(stored).not.toContain(SECRET);
    // The record's fields are the fixed set: nothing that could hold text.
    for (const rec of ledger.entries()) {
      for (const key of Object.keys(rec)) {
        expect(['id', 'startedAt', 'caller', 'source', 'priority', 'modelId', 'engine', 'promptTokens', 'answerTokens', 'firstTokenMs', 'totalMs', 'outcome', 'cutOff', 'error']).toContain(key);
      }
    }
  });
});

describe('model call ledger, wired into the app', () => {
  function service() {
    const svc = new LanguageModelsService();
    svc.registerProvider({
      id: 'cloud', displayName: 'cloud', local: false,
      listModels: async () => [{ id: 'm1', displayName: 'm1', family: 'x', parameterSize: '', quantization: '', contextLength: 0, capabilities: ['completion'] }],
      getModelInfo: async () => ({ id: 'm1', displayName: 'm1', family: 'x', parameterSize: '', quantization: '', contextLength: 0, capabilities: ['completion'] }),
      checkAvailability: async () => ({ available: true }),
      sendChatRequest: (_m: string, msgs: readonly IChatMessage[]) => (async function* () {
        yield { content: `echo ${msgs.map((m) => m.content).join(' ')}`, done: true, promptEvalCount: 7, evalCount: 3 } as IChatResponseChunk;
      })(),
    } as never);
    return svc;
  }

  it('records a tool call through parallx.lm under the tool, and a chat turn as Chat', async () => {
    const svc = service();
    await svc.getModels();
    const bridge = new LanguageModelBridge('acme.notes', svc, []);
    await drain(bridge.sendChatRequest('m1', [{ role: 'user', content: SECRET }]));
    await drain(bridge.sendChatRequest('m1', [{ role: 'user', content: SECRET }], { engine: { source: 'someone.else', label: 'Tidying' } }));
    svc.setActiveModel('m1');
    await drain(svc.sendChatRequest([{ role: 'user', content: SECRET }], { engine: { runId: 'session-1' } }));
    const recs = svc.getCallLedger().entries();
    expect(recs.map((r) => [r.caller, r.source ?? null])).toEqual([['Chat', null], ['Tidying', 'acme.notes'], ['acme.notes', 'acme.notes']]);
    expect(recs.every((r) => r.outcome === 'done' && r.promptTokens === 7 && r.answerTokens === 3)).toBe(true);
    expect(JSON.stringify(recs)).not.toContain(SECRET);
    svc.dispose();
  });
});

describe('model calls view text', () => {
  it('formats durations', () => {
    expect(formatDuration(850)).toBe('850 ms');
    expect(formatDuration(3240)).toBe('3.2 s');
    expect(formatDuration(125_000)).toBe('2 min 5 s');
  });

  it('names a tool by its registry name and keeps a call label first', () => {
    const nameOf = (id: string) => (id === 'acme.notes' ? 'Notes' : undefined);
    expect(callerText({ caller: 'acme.notes', source: 'acme.notes' }, nameOf)).toBe('Notes');
    expect(callerText({ caller: 'Tidying', source: 'acme.notes' }, nameOf)).toBe('Tidying (Notes)');
    expect(callerText({ caller: 'x.y', source: 'x.y' }, nameOf)).toBe('x.y');
    expect(callerText({ caller: 'Chat' }, nameOf)).toBe('Chat');
  });

  it('writes a call row and a totals row', () => {
    const at = Date.UTC(2026, 0, 2, 3, 4, 5);
    const row = formatCallRow({ id: 1, startedAt: at, caller: 'Chat', priority: 'interactive', modelId: 'm1', engine: 'e', promptTokens: 1200, answerTokens: 45, firstTokenMs: 800, totalMs: 3200, outcome: 'done' }, () => undefined, 'UTC');
    expect(row).toEqual({ name: 'Chat', detail: '03:04:05 · m1 · 1,200 in, 45 out · first token 800 ms · total 3.2 s · Done' });
    const failed = formatCallRow({ id: 2, startedAt: at, caller: 'Chat', priority: 'interactive', modelId: 'm1', engine: 'e', outcome: 'error', error: 'Bad request', totalMs: 10 }, () => undefined, 'UTC');
    expect(failed.detail).toBe('03:04:05 · m1 · tokens not reported · first token - · total 10 ms · Error: Bad request');
    expect(formatTotalsRow({ caller: 'Chat', calls: 2, promptTokens: 10, answerTokens: 4, totalMs: 1500, errors: 1 }))
      .toEqual({ name: 'Chat', detail: '2 calls · 10 in, 4 out · 1.5 s in all · 1 error' });
  });

describe('totals keep tools apart', () => {
  it('a tool calling itself "Chat" gets its own row, named with the tool', async () => {
    const { ModelCallLedger } = await import('../../src/services/modelCallLedger');
    const { formatTotalsRow } = await import('../../src/commands/modelCallsView');
    let t = 0;
    const ledger = new ModelCallLedger(() => (t += 10));
    const run = async (tag: { label?: string; source?: string; runId?: string }) => {
      const rec = ledger.begin({ engine: 'ollama', modelId: 'm', priority: 'interactive', tag });
      for await (const _ of rec.track((async function* () { yield { content: 'x', done: true }; })())) { /* drain */ }
    };
    await run({ runId: 'r1' });
    await run({ label: 'Chat', source: 'acme.tool' });
    const sums = ledger.totals();
    expect(sums).toHaveLength(2);
    const names = sums.map((s) => formatTotalsRow(s, (id) => (id === 'acme.tool' ? 'Acme' : undefined)).name).sort();
    expect(names).toEqual(['Chat', 'Chat (Acme)']);
  });
});

});
