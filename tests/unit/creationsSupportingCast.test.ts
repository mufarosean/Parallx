// Creations AI: the supporting cast. People in the world of a chat who never
// take a turn: the bartender, a sister. Before, a person was a full character
// (a third seat to manage) or did not exist, and the Turn Contract forbade
// the model from writing anyone else's words, so the leads could not order
// a drink. Now they are one line each; whoever is speaking may voice them
// briefly inside their own turn.

import { describe, it, expect } from 'vitest';
// @ts-expect-error — JS module with no types
import { __testables } from '../../ext/creations-ai/main.js';

const { assembleContext, buildSystemPrompt, parseSupportingPerson, supportingCastCards } = __testables;
const ada = { fileName: 'ada.json', frontmatter: { name: 'Ada' }, sections: { roleInstruction: 'Ada is a mathematician.' } };

describe('a typed person', () => {
  it('splits name from note on a colon or comma', () => {
    expect(parseSupportingPerson("Dana: the bartender, Ada's ex. Talks fast.")).toEqual({ name: 'Dana', note: "the bartender, Ada's ex. Talks fast." });
    expect(parseSupportingPerson('Old Tom, the landlord')).toEqual({ name: 'Old Tom', note: 'the landlord' });
    expect(parseSupportingPerson('Dana')).toEqual({ name: 'Dana', note: '' });
    expect(parseSupportingPerson('   ')).toBeNull();
  });
});

describe('cards for the prompt', () => {
  const roster = [
    { fileName: 'tom.json', frontmatter: { name: 'Tom' }, rawData: { name: 'Tom', roleInstruction: 'Tom runs the bar on the corner. He was married to Ada once.\n\n## Voice\nSpeaks: short sentences, never a question.\nNever says sorry.' } },
  ];

  it('reads a roster entry fresh: who they are, then how they speak', () => {
    const [card] = supportingCastCards([{ id: '1', file: 'tom.json' }], roster);
    expect(card.name).toBe('Tom');
    expect(card.note).toBe('Tom runs the bar on the corner. Speaks: short sentences, never a question.');
  });

  it('keeps a typed person as typed, and drops a roster entry whose character is gone', () => {
    const cards = supportingCastCards([{ id: '1', name: 'Dana', note: 'the bartender' }, { id: '2', file: 'gone.json' }], roster);
    expect(cards).toEqual([{ name: 'Dana', note: 'the bartender' }]);
  });

  it('clips a long note at a sentence', () => {
    const [card] = supportingCastCards([{ id: '1', name: 'Dana', note: 'word '.repeat(50) + 'first sentence ends here. ' + 'word '.repeat(80) + 'end.' }], []);
    expect(card.note.length).toBeLessThanOrEqual(320);
    expect(card.note.endsWith('first sentence ends here.')).toBe(true);
    const [words] = supportingCastCards([{ id: '2', name: 'Dana', note: 'word '.repeat(120) }], []);
    expect(words.note.length).toBeLessThanOrEqual(320);
    expect(words.note.endsWith('word...')).toBe(true);
  });
});

describe('in the prompt', () => {
  it('lists the supporting cast and makes the one exception to the Turn Contract', () => {
    const { prompt } = buildSystemPrompt({ characters: [ada], respondAs: 'ada.json', supportingCast: [{ name: 'Dana', note: 'the bartender, {{char}}\'s ex' }] });
    expect(prompt).toContain('## Supporting Cast\n');
    expect(prompt).toContain("- Dana: the bartender, Dana's ex");
    expect(prompt).toContain('never take a turn of their own');
    expect(prompt).toContain('The one exception: the Supporting Cast listed below');
    // After the Cast, before the Turn Contract.
    expect(prompt.indexOf('## Cast')).toBeLessThan(prompt.indexOf('## Supporting Cast'));
    expect(prompt.indexOf('## Supporting Cast')).toBeLessThan(prompt.indexOf('## Turn Contract'));
  });

  it('says nothing about it when there is none', () => {
    const { prompt } = buildSystemPrompt({ characters: [ada], respondAs: 'ada.json' });
    expect(prompt).not.toContain('Supporting Cast');
    expect(prompt).not.toContain('one exception');
  });

  it('reaches the system prompt through assembleContext', () => {
    const out = assembleContext({ characters: [ada], history: [], userMessage: 'Hi', contextWindow: 8192, respondAs: 'ada.json', supportingCast: [{ name: 'Dana', note: 'the bartender' }] });
    expect(out.messages[0].content).toContain('- Dana: the bartender');
  });
});
