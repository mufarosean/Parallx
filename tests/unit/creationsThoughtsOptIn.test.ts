// Creations AI: a character's thoughts are opt-in, by director's note.
//
// Every reply used to carry a line of italic thoughts: the formatting rules,
// the writing presets, the late style reminder, the point-of-view lines and
// the Narrator's turn all said "thoughts in *italics*", and the standing
// director's note came before the style reminder, so a note asking for no
// thoughts lost to it. Now nothing in the prompt asks for thoughts, the
// rules say a director's note may turn them on, and the standing note is
// the last standing instruction the model reads.

import { describe, it, expect } from 'vitest';
// @ts-expect-error — JS module with no types
import { __testables } from '../../ext/creations-ai/main.js';

const { assembleContext } = __testables;
const ada = { fileName: 'ada.json', frontmatter: { name: 'Ada' }, sections: { roleInstruction: 'Ada counts.' } };
const base = { characters: [ada], history: [], userMessage: 'Hi', contextWindow: 8192 };
const PRESETS = ['immersive-rp', 'immersive-rp-unfiltered', 'casual-rp', 'natural-rp'];
const POVS = ['', 'first-person', 'close-third', 'omniscient-third', 'second-person'];
const ASKS_FOR_THOUGHTS = /thoughts in \*italics\*|inner thoughts in|inner experience|and thoughts into/i;

function allText(out: { messages: { content: string }[] }): string {
  return out.messages.map((m) => m.content).join('\n');
}

describe('nothing in the prompt asks for thoughts', () => {
  it('for every preset and point of view, as a character', () => {
    for (const writingPreset of PRESETS) {
      for (const pov of POVS) {
        const text = allText(assembleContext({ ...base, respondAs: 'ada.json', writingPreset, pov }));
        expect(text, `${writingPreset} / ${pov || 'inherit'}`).not.toMatch(ASKS_FOR_THOUGHTS);
      }
    }
  });

  it('nor as the Narrator', () => {
    const text = allText(assembleContext({ ...base, respondAs: '__narrator__' }));
    expect(text).not.toMatch(ASKS_FOR_THOUGHTS);
    expect(text).toContain('Weave character actions and speech into natural flowing paragraphs.');
  });

  it('the formatting rules say thoughts come only by director\'s note, in italics', () => {
    const system = assembleContext({ ...base, respondAs: 'ada.json' }).messages[0].content;
    expect(system).toContain('**No inner thoughts unless asked**');
    expect(system).toContain("Write a character's thoughts only when a director's note asks for them; then set them in *italics*.");
    expect(system).toContain("Write only the active character's words and actions.");
  });
});

describe('the standing director\'s note is the last standing word', () => {
  it('comes after the style reminder in the late block and says it overrides it', () => {
    const out = assembleContext({ ...base, respondAs: 'ada.json', standingNote: "Write Ada's thoughts in italics." });
    const late = out.messages.find((m: any) => m.role === 'system' && m.content.startsWith('[Active turn:'))!;
    expect(late).toBeTruthy();
    const style = late.content.indexOf('Style:');
    const note = late.content.indexOf("Standing director's note (applies to every turn, and overrides the style above where they differ): Write Ada's thoughts in italics.");
    expect(style).toBeGreaterThan(-1);
    expect(note).toBeGreaterThan(style);
  });

  it('a one-shot note still comes last of all', () => {
    const out = assembleContext({ ...base, respondAs: 'ada.json', standingNote: 'Slow down.', ephemeralInstruction: 'Have Ada leave.' });
    const late = out.messages.find((m: any) => m.role === 'system' && m.content.startsWith('[Active turn:'))!;
    expect(late.content.indexOf('Slow down.')).toBeLessThan(late.content.indexOf("DIRECTOR'S NOTE FOR THIS TURN"));
  });
});
