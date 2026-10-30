// creationsModelRoute.test.ts — Creations AI's one way to the model: no token
// cap of its own (only the user's length setting), the caller's thinking and
// format kept, and one rule for a reply with no answer in it.
import { describe, it, expect } from 'vitest';
// @ts-expect-error — JS module with no types
import { answerText, createModelRoute, routeOptions } from '../../ext/creations-ai/model-route.js';

describe('the Creations model route', () => {
  it("sets no cap of its own; the user's limit is the only one", () => {
    expect(routeOptions({ temperature: 0.9, think: true, maxTokens: 1800, numCtx: 0 })).toEqual({ temperature: 0.9, think: true });
    expect(routeOptions({ think: true, userLimit: 400, numCtx: 32768, format: 'json' })).toEqual({ think: true, maxTokens: 400, numCtx: 32768, format: 'json' });
  });

  it('reads an answer with any <think> block taken out', () => {
    expect(answerText('<think>planning</think>\n1. Ada: Counts')).toBe('1. Ada: Counts');
    expect(answerText('<think>still thinking')).toBe('');
  });

  it('streams chunks through as they come', async () => {
    const seen: string[] = [];
    const route = createModelRoute({ sendChatRequest: () => (async function* () { yield { content: 'a' }; yield { content: 'b' }; })() });
    for await (const c of route.stream('m', [], {})) seen.push(c.content);
    expect(seen).toEqual(['a', 'b']);
  });

  it('asks once more with thinking off only when the reply had no answer and thinking was on', async () => {
    const calls: any[] = [];
    const lm = { sendChatRequest: (_m: string, _x: any[], o: any) => { calls.push(o); return (async function* () { yield { content: o.think ? '<think>hmm' : 'answer' }; })(); } };
    expect(await createModelRoute(lm).ask('m', [], { think: true })).toBe('answer');
    expect(calls.map((c) => c.think)).toEqual([true, false]);
    calls.length = 0;
    const empty = { sendChatRequest: (_m: string, _x: any[], o: any) => { calls.push(o); return (async function* () { yield { content: '' }; })(); } };
    expect(await createModelRoute(empty).ask('m', [], { think: false })).toBe('');
    expect(calls).toHaveLength(1);
  });
});
