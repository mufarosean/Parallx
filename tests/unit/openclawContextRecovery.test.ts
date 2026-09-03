/**
 * Context recovery: the floors that used to make a session unrecoverable.
 *
 *  - One round of tool results is capped as a whole, not just per result.
 *  - Long string arguments are elided on the tool calls replayed in-turn.
 *  - The exchange compaction keeps is shrunk, so compaction can always fold.
 *  - The summarizer's transcript is capped to its share of the window.
 *  - Trimming to budget never returns an empty history when there is one.
 */

import { describe, it, expect, vi } from 'vitest';
import {
  capToolResultContent,
  capToolResultRound,
  elideLongToolCallArgs,
} from '../../src/openclaw/openclawAttempt';
import {
  OpenclawContextEngine,
  capTranscriptForSummarizer,
  shrinkForRetention,
} from '../../src/openclaw/openclawContextEngine';
import type { IChatMessage } from '../../src/services/chatTypes';

const big = (n: number, ch = 'x') => ch.repeat(n);

describe('tool results — per round', () => {
  it('keeps the head of success output and the tail of error output', () => {
    const ok = capToolResultContent(`HEAD${big(100)}TAIL`, 20, false);
    expect(ok.startsWith('HEAD')).toBe(true);
    expect(ok).toContain('truncated');
    const err = capToolResultContent(`HEAD${big(100)}TAIL`, 20, true);
    expect(err.endsWith('TAIL')).toBe(true);
    expect(err).toContain('omitted');
  });

  it('three results each under the per-result cap cannot sum past the round cap', () => {
    const results = [1, 2, 3].map((i) => ({ name: `t${i}`, content: big(9_000), isError: false }));
    const capped = capToolResultRound(results, 10_000, 10_000);
    const total = capped.reduce((s, r) => s + r.content.length, 0);
    expect(total).toBeLessThanOrEqual(10_000 + 3 * 80); // three truncation markers
    for (const r of capped) expect(r.content.length).toBeLessThanOrEqual(3_400);
  });

  it('a round that fits is untouched', () => {
    const results = [{ name: 't', content: 'small', isError: false }];
    expect(capToolResultRound(results, 10_000, 10_000)[0].content).toBe('small');
  });

  it('the split never goes below the floor, so an error keeps its tail', () => {
    const results = Array.from({ length: 50 }, (_, i) => ({ name: `t${i}`, content: `${big(5_000)}ROOT CAUSE`, isError: true }));
    const capped = capToolResultRound(results, 10_000, 10_000);
    for (const r of capped) {
      expect(r.content.length).toBeGreaterThanOrEqual(2_000);
      expect(r.content.endsWith('ROOT CAUSE')).toBe(true);
    }
  });
});

describe('tool-call arguments replayed in-turn', () => {
  it('elides a whole-file write argument but keeps short ones verbatim', () => {
    const calls = [{ function: { name: 'fs_write_file', arguments: { path: 'a.md', content: big(50_000) } } }];
    const out = elideLongToolCallArgs(calls);
    expect(out[0].function.arguments.path).toBe('a.md');
    expect((out[0].function.arguments.content as string).length).toBeLessThan(2_200);
    expect(out[0].function.arguments.content).toContain('elided');
  });

  it('returns the same array when nothing needs eliding', () => {
    const calls = [{ function: { name: 'planner.read', arguments: { day: 'today' } } }];
    expect(elideLongToolCallArgs(calls)).toBe(calls);
  });
});

describe('what compaction keeps', () => {
  it('shrinks a huge retained tool result and says how to get it back', () => {
    const msg: IChatMessage = { role: 'tool', toolName: 'fs_read_file', content: big(40_000) };
    const out = shrinkForRetention(msg);
    expect(out.content.length).toBeLessThan(1_800);
    expect(out.content).toContain('re-run fs_read_file');
  });

  it('elides long string args on a retained assistant tool call', () => {
    const msg: IChatMessage = {
      role: 'assistant',
      content: '',
      toolCalls: [{ function: { name: 'canvas_create_page', arguments: { title: 'T', markdown: big(20_000) } } }],
    };
    const out = shrinkForRetention(msg);
    expect((out.toolCalls![0].function.arguments.markdown as string).length).toBeLessThan(600);
    expect(out.toolCalls![0].function.arguments.title).toBe('T');
  });

  it('leaves ordinary messages alone', () => {
    const msg: IChatMessage = { role: 'user', content: 'hello' };
    expect(shrinkForRetention(msg)).toBe(msg);
  });

  it('compaction with a summarizer no longer keeps the last exchange verbatim', async () => {
    const summarizer = vi.fn(async function* () { yield { content: 'summary of it all', done: true }; });
    const engine = new OpenclawContextEngine({ sendSummarizationRequest: summarizer } as never);
    const history: IChatMessage[] = [
      { role: 'user', content: 'first' },
      { role: 'assistant', content: 'ok' },
      { role: 'user', content: 'read the big file' },
      { role: 'assistant', content: '', toolCalls: [{ function: { name: 'fs_read_file', arguments: { path: 'big.md' } } }] },
      { role: 'tool', toolName: 'fs_read_file', content: big(60_000) },
    ];
    await engine.assemble({ sessionId: 's', history, tokenBudget: 32_000, prompt: 'go' });
    const result = await engine.compact({ sessionId: 's', tokenBudget: 32_000 });
    expect(result.compacted).toBe(true);
    expect(result.tokensAfter).toBeLessThan(2_000);
    // The summarizer saw a capped transcript and ran with the session's window.
    const [, , options] = summarizer.mock.calls[0] as unknown as [unknown, unknown, { numCtx?: number }];
    expect(options?.numCtx).toBe(32_000);
  });
});

describe('summarizer transcript cap', () => {
  it('passes a short transcript through unchanged', () => {
    expect(capTranscriptForSummarizer('short', 8_192)).toBe('short');
  });

  it('keeps both ends of a transcript that outgrows the summarizer share', () => {
    const transcript = `BEGIN${big(200_000)}END`;
    const out = capTranscriptForSummarizer(transcript, 8_192);
    expect(out.startsWith('BEGIN')).toBe(true);
    expect(out.endsWith('END')).toBe(true);
    expect(out).toContain('omitted');
    expect(out.length).toBeLessThan(20_000);
  });

  it('no budget means no cap', () => {
    const transcript = big(100_000);
    expect(capTranscriptForSummarizer(transcript, 0)).toBe(transcript);
  });
});

describe('trimming to budget', () => {
  it('never hands the model an empty history when the newest message alone is too big', async () => {
    const engine = new OpenclawContextEngine({} as never);
    const history: IChatMessage[] = [
      { role: 'user', content: '[Context summary]\nall the earlier work' },
      { role: 'assistant', content: 'Understood, I have the conversation context.' },
      { role: 'user', content: big(400_000) },
    ];
    const assembled = await engine.assemble({ sessionId: 's', history, tokenBudget: 8_192, prompt: 'next' });
    const nonSystem = assembled.messages.filter((m) => m.role !== 'system');
    expect(nonSystem.length).toBeGreaterThan(0);
    expect(nonSystem[nonSystem.length - 1].content).toContain('truncated to fit');
  });
});
