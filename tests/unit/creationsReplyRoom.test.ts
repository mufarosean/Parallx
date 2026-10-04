// Creations AI: a roleplay reply always has room in the context window.
// The prompt's lanes split the whole window and left the reply whatever they
// did not use; the history floor, the voice anchor, memory and late notes
// could use it all, and Ollama then stopped the reply part way, at the same
// place on every retry.

import { describe, it, expect } from 'vitest';
// @ts-expect-error — JS module with no types
import { __testables } from '../../ext/creations-ai/main.js';

const { fitPromptToWindow, replyReserveFor, assembleContext } = __testables;
const tok = (n: number) => 'word '.repeat(n); // ~1.25 tokens a word at chars/4

describe('keeping room for the reply', () => {
  it('drops the oldest history until the prompt leaves the reserve free, never the system prompt or the turn', () => {
    const msgs = [
      { role: 'system', content: tok(800) },
      ...Array.from({ length: 20 }, (_, i) => ({ role: i % 2 ? 'assistant' : 'user', content: `m${i} ` + tok(400) })),
      { role: 'system', content: 'late note' },
      { role: 'user', content: 'the turn' },
    ];
    const fit = fitPromptToWindow(msgs, 8192, 3072);
    expect(fit.dropped).toBeGreaterThan(0);
    expect(fit.tokens).toBeLessThanOrEqual(Math.floor((8192 - 3072) * 0.95));
    expect(fit.messages[0]).toBe(msgs[0]);
    expect(fit.messages.slice(-2)).toEqual(msgs.slice(-2));
    // The newest history survives; the oldest went first.
    expect(fit.messages.some((m: any) => m.content.startsWith('m19 '))).toBe(true);
    expect(fit.messages.some((m: any) => m.content.startsWith('m0 '))).toBe(false);
  });

  it('leaves a prompt that already fits alone', () => {
    const msgs = [{ role: 'system', content: 'sys' }, { role: 'user', content: 'hi' }, { role: 'user', content: 'turn' }];
    expect(fitPromptToWindow(msgs, 8192, 3072)).toMatchObject({ dropped: 0, messages: msgs });
  });

  it('reserves the reply\'s own limit, or room for a long reply with thinking, never most of the window', () => {
    expect(replyReserveFor(8192, 0)).toBe(3072);
    expect(replyReserveFor(32768, 6000)).toBe(6000);
    expect(replyReserveFor(4096, 0)).toBe(1638);
  });

  it('a long chat with a long card and memory in an 8k window: the reply keeps its room', () => {
    const history = Array.from({ length: 80 }, (_, i) => ({ id: `x${i}`, author: i % 2 ? 'ai' : 'user', name: i % 2 ? 'Ada' : 'Alex', content: tok(180) }));
    const character = { fileName: 'ada.json', frontmatter: { name: 'Ada' }, sections: { roleInstruction: tok(1500), exampleDialogue: tok(300) } };
    const args = { characters: [character], history, userMessage: 'What now?', contextWindow: 8192, userName: 'Alex', respondAs: 'ada.json', memoryContent: tok(1200) };
    // Before: the prompt left the reply ~2.2k tokens of an 8k window, less
    // than a thinking model spends before it writes a word.
    const before = assembleContext({ ...args, replyReserve: 0 });
    expect(8192 - before.estimatedTokens).toBeLessThan(2500);
    const after = assembleContext({ ...args, replyReserve: 3072 });
    expect(8192 - after.estimatedTokens).toBeGreaterThanOrEqual(3072);
    expect(after.warnings.some((w: string) => /older messages? to keep 3072t free/.test(w))).toBe(true);
    expect(after.messages.at(-1).content).toContain('What now?');
  });

});
