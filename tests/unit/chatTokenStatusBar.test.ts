// @vitest-environment jsdom
/**
 * The chat's context meter (src/built-in/chat/widgets/chatTokenStatusBar.ts).
 * After a compaction the chat still shows its whole history, but the model is
 * sent the compacted one. The meter follows the model's latest reported
 * count, estimates only what is newer, and never adds earlier answers twice.
 */
import { describe, expect, it } from 'vitest';
import { ChatTokenStatusBar } from '../../src/built-in/chat/widgets/chatTokenStatusBar';

const CONTEXT = 160_000;

const pair = (text: string, answer: string, reported?: { prompt: number; completion: number }) => ({
  request: { text, requestId: 'r', attempt: 0, timestamp: 0 },
  response: {
    parts: answer ? [{ kind: 'markdown', content: answer }] : [] as { kind: string; content: string }[],
    isComplete: !!reported,
    modelId: 'm',
    timestamp: 0,
    ...(reported ? { promptTokens: reported.prompt, completionTokens: reported.completion } : {}),
  } as { parts: { kind: string; content: string }[]; isComplete: boolean; promptTokens?: number; completionTokens?: number },
});

function meter(messages: ReturnType<typeof pair>[]) {
  const bar = new ChatTokenStatusBar({
    getActiveSession: () => ({ messages }),
    getContextLength: async () => CONTEXT,
  } as never);
  const label = () => bar.element.querySelector('.parallx-token-statusbar-label')?.textContent;
  return {
    pct: async () => { await bar.update(); return label(); },
    title: () => bar.element.title,
  };
}

describe('the context meter', () => {
  it('stays on the compacted count when a message is sent, instead of jumping to 100%', async () => {
    // A long chat: 40 turns of 20K characters (about 200K tokens as chars / 4),
    // compacted by the context engine: the model was last sent 30K.
    const messages = Array.from({ length: 40 }, (_, i) => pair(`question ${i}`, 'x'.repeat(20_000), { prompt: 1000 + i, completion: 900 }));
    Object.assign(messages[39].response, { promptTokens: 30_000, completionTokens: 500 });
    const m = meter(messages);
    expect(await m.pct()).toBe('19%'); // 30,500 of 160K
    // Sent: the new request has no count yet.
    messages.push(pair('And one more question?', ''));
    expect(await m.pct()).toBe('19%');
    expect(m.title()).toContain('plus estimated');
    // Its answer streams in: estimated on top of the compacted count.
    messages[40].response.parts.push({ kind: 'markdown', content: 'y'.repeat(4000) });
    expect(await m.pct()).toBe('20%'); // about 31.5K
    // The answer reports its own count.
    Object.assign(messages[40].response, { promptTokens: 31_000, completionTokens: 1_000, isComplete: true });
    expect(await m.pct()).toBe('20%'); // 32,000
    expect(m.title()).toContain('Model-reported token usage');
  });

  it('does not add up earlier answers: they are already inside the reported prompt', async () => {
    const messages = Array.from({ length: 10 }, (_, i) => pair(`q${i}`, 'a', { prompt: 2000 * (i + 1), completion: 1000 }));
    // 20,000 + 1,000 of 160K; adding every answer would have said 30,000 (19%).
    expect(await meter(messages).pct()).toBe('13%');
  });

  it('estimates from the chat itself when nothing has reported yet (right after /compact)', async () => {
    const m = meter([pair('[Compacted conversation history]', 's'.repeat(8000)), pair('Next?', '')]);
    expect(await m.pct()).toBe('1%'); // about 2K of 160K
    expect(m.title()).toContain('Estimated');
  });

  it('counts history only up to the share the model is sent when nothing has reported (a chat saved before counts were kept)', async () => {
    // 40 turns of 20K characters, about 200K tokens as chars / 4, and no
    // counts: the engine never sends more than 30% of the window as history.
    const messages = Array.from({ length: 40 }, (_, i) => pair(`question ${i}`, 'x'.repeat(20_000)));
    expect(await meter(messages).pct()).toBe('30%');
  });
});
