// creationsActBeatsPrompt.test.ts — what the model is told on each beat when
// an act runs. Run turns the beat sheet into one generation per beat, through
// the same prompt the chat builds for "/ai @Name note": the beat's speaker
// is the one who answers, and the beat is a mandatory director's note on the
// last thing the model reads. The runner's own tests stub the generation;
// this one builds the real prompt for a Narrator beat and a character beat.
import { describe, it, expect } from 'vitest';
// @ts-expect-error — JS module with no types
import { __testables } from '../../ext/creations-ai/main.js';
// @ts-expect-error — JS module with no types
import { beatTurn, parseBeats } from '../../ext/creations-ai/acts.js';

const { assembleContext } = __testables;
const ada = { fileName: 'ada.json', frontmatter: { name: 'Ada Lovelace' }, sections: { roleInstruction: 'Ada counts everything.' } };
const tom = { fileName: 'tom.json', frontmatter: { name: 'Tom Price' }, sections: { roleInstruction: 'Tom laughs things off.' } };
const sheet = '1. Narrator: Cut to the harbour at dawn || the ships are late\n2. Ada: Counts the crates twice || she finds one missing\n3. Tom: Laughs it off';

function promptFor(index: number) {
  const beats = parseBeats(sheet, { names: ['Ada Lovelace', 'Tom Price'], player: { name: 'Alex', plays: '' } });
  const turn = beatTurn(beats[index], index, beats.length, 'The missing crate', { narratorSpeaker: '__narrator__', fileFor: (n: string) => (n.startsWith('Ada') ? 'ada.json' : 'tom.json') });
  const { messages } = assembleContext({ characters: [ada, tom], history: [], userMessage: '', contextWindow: 16384, userName: 'Alex', respondAs: turn.speaker, ephemeralInstruction: turn.instruction });
  return { turn, last: messages[messages.length - 1], all: messages.map((m: { content: string }) => m.content).join('\n') };
}

describe('an act beat, as the model receives it', () => {
  it('a character beat: that character answers, told what to do on this beat', () => {
    const { turn, last } = promptFor(1);
    expect(turn.speaker).toBe('ada.json');
    expect(last.role).toBe('user');
    expect(last.content).toContain('Now write the next reply as Ada Lovelace, and only Ada Lovelace');
    expect(last.content).toContain("DIRECTOR'S NOTE (mandatory, apply to this very turn): Counts the crates twice (she finds one missing). Beat 2 of 3 of this act (The missing crate).");
  });

  it('a Narrator beat: the narrator answers, with the beat as its note', () => {
    const { turn, last, all } = promptFor(0);
    expect(turn.speaker).toBe('__narrator__');
    expect(last.content).toContain('Cut to the harbour at dawn (the ships are late). Beat 1 of 3');
    expect(all).not.toContain('Now write the next reply as Ada Lovelace');
    expect(all.toLowerCase()).toContain('narrat');
  });

  it('the next beat moves to the next speaker', () => {
    expect(promptFor(2).last.content).toContain('Now write the next reply as Tom Price, and only Tom Price');
  });
});
