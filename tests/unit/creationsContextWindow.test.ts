// Creations AI: the chat's context window. "Auto" used to fall back to a
// hidden settings default of 8192, so a long card left ~700 tokens for the
// reply and replies were cut off. Auto now means the model's own length;
// a size the user picks (in the chat or in Settings) still wins.

import { describe, it, expect } from 'vitest';
// @ts-expect-error — JS module with no types
import { __testables } from '../../ext/creations-ai/main.js';

const { resolveContextWindow, migrateContextDefault, assembleContext } = __testables;
const tok = (n: number) => 'word '.repeat(n);

describe('chat context window', () => {
  it('Auto uses the model length', () => {
    expect(resolveContextWindow({ override: null, settingsDefault: 0, modelLength: 40960 })).toBe(40960);
  });

  it('a size picked in the chat wins, then one set in Settings', () => {
    expect(resolveContextWindow({ override: 16384, settingsDefault: 32768, modelLength: 40960 })).toBe(16384);
    expect(resolveContextWindow({ override: null, settingsDefault: 32768, modelLength: 40960 })).toBe(32768);
  });

  it('falls back to 8192 only when the model length is unknown', () => {
    expect(resolveContextWindow({ override: null, settingsDefault: 0, modelLength: 0 })).toBe(8192);
  });

  it('reads the old shipped 8192 as Auto, but keeps one the user chose', () => {
    expect(migrateContextDefault({ defaultContextWindow: 8192 }).defaultContextWindow).toBe(0);
    expect(migrateContextDefault({ defaultContextWindow: 8192, defaultContextWindowChosen: true }).defaultContextWindow).toBe(8192);
    expect(migrateContextDefault({ defaultContextWindow: 16384 }).defaultContextWindow).toBe(16384);
  });

  it('a larger window keeps more of a long chat and leaves room for the reply', () => {
    const history = Array.from({ length: 80 }, (_, i) => ({ id: `x${i}`, author: i % 2 ? 'ai' : 'user', name: i % 2 ? 'Ada' : 'Alex', content: `turn ${i}: ` + tok(120) }));
    const character = { fileName: 'ada.json', frontmatter: { name: 'Ada' }, sections: { roleInstruction: tok(1500), exampleDialogue: tok(300) } };
    const run = (contextWindow: number) => assembleContext({ characters: [character], history, userMessage: 'What now?', contextWindow, userName: 'Alex', respondAs: 'ada.json', memoryContent: tok(1200) });
    const small = run(8192);
    const large = run(40960);
    expect(large.messages.length).toBeGreaterThan(small.messages.length);
    const kept = large.messages.map((m: any) => m.content).join('\n');
    expect(kept).toContain('turn 79:');
    expect(large.estimatedTokens).toBeLessThan(40960 - 4096);
  });
});
