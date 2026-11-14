// chatResponseTiming.test.ts — an answer's speed is the engine's own figures,
// summed over its model calls; the app's clock gives the times and nothing else.
import { describe, expect, it } from 'vitest';
import { noteCompleted, noteFirstWord, noteModelCall, parseTiming, serializeTiming, tokensPerSecond } from '../../src/services/chatResponseTiming';
import type { IChatResponseTiming } from '../../src/services/chatResponseTiming';

// The final object of a streamed /api/chat answer, as Ollama's API reference
// gives it (durations in nanoseconds).
const OLLAMA_FINAL = { total_duration: 4883583458, load_duration: 1334875, prompt_eval_count: 26, prompt_eval_duration: 342546000, eval_count: 282, eval_duration: 4535599000 };
const asCall = (o: typeof OLLAMA_FINAL) => ({ promptEvalCount: o.prompt_eval_count, promptEvalDuration: o.prompt_eval_duration, evalCount: o.eval_count, evalDuration: o.eval_duration, loadDuration: o.load_duration });

describe('noteModelCall', () => {
  it('keeps what one call reported, in tokens and milliseconds', () => {
    const r: { timing?: IChatResponseTiming } = {};
    noteModelCall(r, asCall(OLLAMA_FINAL));
    expect(r.timing).toEqual({ calls: 1, writtenTokens: 282, timedTokens: 282, writingMs: 4536, readTokens: 26, readingMs: 343, loadingMs: 1 });
    // 282 tokens in 4.536 s
    expect(tokensPerSecond(r.timing)!).toBeCloseTo(62.17, 1);
  });

  it('sums an answer that took several calls: the speed is all tokens over all writing time', () => {
    const r: { timing?: IChatResponseTiming } = {};
    noteModelCall(r, { evalCount: 100, evalDuration: 2e9, promptEvalCount: 9000, promptEvalDuration: 3e9, loadDuration: 40e9 });
    noteModelCall(r, { evalCount: 300, evalDuration: 3e9, promptEvalCount: 500, promptEvalDuration: 0.5e9 });
    expect(r.timing).toMatchObject({ calls: 2, writtenTokens: 400, writingMs: 5000, readTokens: 9500, readingMs: 3500, loadingMs: 40000 });
    expect(tokensPerSecond(r.timing)).toBe(80);
  });

  it('gives no speed when the engine reports tokens and no writing time', () => {
    const r: { timing?: IChatResponseTiming } = {};
    noteModelCall(r, { promptEvalCount: 1200, evalCount: 640 }); // a cloud provider: counts only
    expect(r.timing).toEqual({ calls: 1, writtenTokens: 640, readTokens: 1200 });
    expect(tokensPerSecond(r.timing)).toBeUndefined();
  });

  it('never mixes a timed call with an untimed one into a wrong speed', () => {
    const r: { timing?: IChatResponseTiming } = {};
    noteModelCall(r, { evalCount: 100, evalDuration: 2e9 });
    noteModelCall(r, { evalCount: 900 });
    expect(r.timing).toMatchObject({ writtenTokens: 1000, timedTokens: 100, writingMs: 2000 });
    expect(tokensPerSecond(r.timing)).toBe(50);
  });

  it('adds nothing for a call that reported nothing (a dropped connection, a stopped answer)', () => {
    const r: { timing?: IChatResponseTiming } = {};
    noteModelCall(r, {});
    noteModelCall(r, { evalCount: 0, evalDuration: 0, promptEvalCount: undefined });
    expect(r.timing).toBeUndefined();
    expect(tokensPerSecond(undefined)).toBeUndefined();
  });
});

describe('the app\'s clock', () => {
  it('stamps the first word once and the finish when told', () => {
    const r: { timing?: IChatResponseTiming } = {};
    noteFirstWord(r, 1000);
    noteFirstWord(r, 5000);
    noteCompleted(r, 9000);
    expect(r.timing).toEqual({ firstWordAt: 1000, completedAt: 9000 });
  });
});

describe('kept with the answer', () => {
  it('round-trips', () => {
    const timing: IChatResponseTiming = { firstWordAt: 1731550447000, completedAt: 1731550467300, calls: 2, writtenTokens: 1040, timedTokens: 1040, writingMs: 19900, readTokens: 21400, readingMs: 6100, loadingMs: 38200 };
    expect(parseTiming(serializeTiming(timing))).toEqual(timing);
  });

  it('keeps nothing when there is nothing, and drops what is not a positive number', () => {
    expect(serializeTiming(undefined)).toBeNull();
    expect(serializeTiming({})).toBeNull();
    expect(parseTiming(null)).toBeUndefined();
    expect(parseTiming('')).toBeUndefined();
    expect(parseTiming('not json')).toBeUndefined();
    expect(parseTiming('[1,2]')).toBeUndefined();
    expect(parseTiming(JSON.stringify({ completedAt: 'soon', writtenTokens: -4, writingMs: 250, extra: 7 }))).toEqual({ writingMs: 250 });
  });
});
