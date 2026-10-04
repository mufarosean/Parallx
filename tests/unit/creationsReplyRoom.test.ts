// Creations AI: a long roleplay keeps its recent turns in the prompt.
// A change on 2026-10-04 kept a fixed 3072 tokens free for the reply by
// dropping the oldest history after assembly; with a long character card
// in an 8k window that left only the last message or two, and turn-to-turn
// continuity broke. It was reverted. This pins the history the lanes give.

import { describe, it, expect } from 'vitest';
// @ts-expect-error — JS module with no types
import { __testables } from '../../ext/creations-ai/main.js';

const { assembleContext } = __testables;
const tok = (n: number) => 'word '.repeat(n);

describe('continuity in a long roleplay', () => {
  it('a long chat with a long card and memory in an 8k window keeps its recent turns', () => {
    const history = Array.from({ length: 80 }, (_, i) => ({ id: `x${i}`, author: i % 2 ? 'ai' : 'user', name: i % 2 ? 'Ada' : 'Alex', content: `turn ${i}: ` + tok(120) }));
    const character = { fileName: 'ada.json', frontmatter: { name: 'Ada' }, sections: { roleInstruction: tok(1500), exampleDialogue: tok(300) } };
    const out = assembleContext({ characters: [character], history, userMessage: 'What now?', contextWindow: 8192, userName: 'Alex', respondAs: 'ada.json', memoryContent: tok(1200) });
    const kept = out.messages.map((m: any) => m.content).join('\n');
    // The lanes keep the last 7 here; the reverted change kept one or two.
    for (let i = 74; i < 80; i++) expect(kept).toContain(`turn ${i}:`);
    expect(out.messages.at(-1).content).toContain('What now?');
  });
});
