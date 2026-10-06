// Creations AI: the supporting cast. People in the world of a chat who never
// take a turn: the bartender, a sister. Before, a person was a full character
// (a third seat to manage) or did not exist, and the Turn Contract forbade
// the model from writing anyone else's words, so the leads could not order
// a drink. Now they are one line each; whoever is speaking may voice them
// briefly inside their own turn.

import { describe, it, expect } from 'vitest';
// @ts-expect-error — JS module with no types
import { __testables } from '../../ext/creations-ai/main.js';

const { assembleContext, buildSystemPrompt, parseSupportingPerson, supportingCastCards, connectedPeopleCards } = __testables;
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
    expect(prompt).toContain('The one exception: the Supporting Cast listed above');
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

describe('people in their lives (connected cards, 2026-10-06)', () => {
  const ashbyCard = { fileName: 'ashby.json', frontmatter: { name: 'Lord Ashby' }, rawData: { name: 'Lord Ashby', roleInstruction: '', studio: { sheet: { name: 'Lord Ashby', tagline: 'Owns the valley and knows it', appearance: 'Overview: a tall man gone soft at the middle. He stoops.', description: 'Ashby holds Harrow Court.' } } } };
  const tom = { fileName: 'tom.json', frontmatter: { name: 'Tom Hale' }, sections: { roleInstruction: 'Tom keeps the game at Harrow Court.' }, rawData: { name: 'Tom Hale', studio: { connections: [{ fileName: 'ashby.json', name: 'Lord Ashby', how: 'works for Lord Ashby at Harrow Court as his gamekeeper' }, { fileName: 'gone.json', name: 'Nobody', how: 'x' }] } } };

  it('reads each cast character\'s connections from the roster, fresh, skipping anyone already in the scene', () => {
    const [card] = connectedPeopleCards([tom], [], [ashbyCard]);
    expect(card.name).toBe('Lord Ashby');
    expect(card.file).toBe('ashby.json');
    expect(card.note).toBe('Tom Hale, to them: works for Lord Ashby at Harrow Court as his gamekeeper. Owns the valley and knows it a tall man gone soft at the middle.');
    expect(connectedPeopleCards([tom], [], [ashbyCard])).toHaveLength(1); // the gone card is left out
    expect(connectedPeopleCards([tom, ashbyCard], [], [ashbyCard])).toEqual([]); // at the table already
    expect(connectedPeopleCards([tom], [{ id: '1', file: 'ashby.json' }], [ashbyCard])).toEqual([]); // in the scene already
    expect(connectedPeopleCards([ada], [], [ashbyCard])).toEqual([]); // no connections
  });

  it('lists them in the prompt after the Supporting Cast, before the Turn Contract, with the exception worded for them', () => {
    const { prompt } = buildSystemPrompt({ characters: [tom], respondAs: 'tom.json', connectedPeople: [{ name: 'Lord Ashby', note: 'Tom Hale, to them: his gamekeeper. Owns the valley.' }] });
    expect(prompt).toContain('## People In Their Lives\n');
    expect(prompt).toContain('- Lord Ashby: Tom Hale, to them: his gamekeeper. Owns the valley.');
    expect(prompt).toContain('Supporting Cast from then on');
    expect(prompt).toContain('The one exception: the People In Their Lives listed above, once in the scene,');
    expect(prompt.indexOf('## People In Their Lives')).toBeLessThan(prompt.indexOf('## Turn Contract'));
    const both = buildSystemPrompt({ characters: [tom], respondAs: 'tom.json', supportingCast: [{ name: 'Dana', note: 'the bartender' }], connectedPeople: [{ name: 'Lord Ashby', note: 'x' }] }).prompt;
    expect(both.indexOf('## Supporting Cast')).toBeLessThan(both.indexOf('## People In Their Lives'));
    expect(both).toContain('The one exception: the Supporting Cast listed above');
    expect(buildSystemPrompt({ characters: [tom], respondAs: 'tom.json' }).prompt).not.toContain('People In Their Lives');
  });

  it('reaches the system prompt through assembleContext', () => {
    const out = assembleContext({ characters: [tom], history: [], userMessage: 'Hi', contextWindow: 8192, respondAs: 'tom.json', connectedPeople: [{ name: 'Lord Ashby', note: 'his employer' }] });
    expect(out.messages[0].content).toContain('- Lord Ashby: his employer');
  });
});
