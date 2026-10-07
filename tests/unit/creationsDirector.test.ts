// Creations AI: the director (ext/creations-ai/director.js). On request it
// reads a roleplay's scene and offers each character four short notes for
// their next turn, one of each kind, so the player picks a direction instead
// of writing one every turn. A pick becomes the chat's own "/ai @Name note".

import { describe, it, expect } from 'vitest';
// @ts-expect-error — JS module with no types
import { DIRECTION_KINDS, directorCast, buildDirectorPrompt, parseDirections, directionCommand, composeWithDirection, directionKindLabel } from '../../ext/creations-ai/director.js';

const cast = [
  { file: 'ada.json', name: 'Ada' },
  { file: 'tom.json', name: 'Tom' },
  { file: 'vera.json', name: 'Vera Quill' },
];

describe('who gets options', () => {
  it('puts the character who spoke last at the end', () => {
    expect(directorCast(cast, { lastSpeaker: 'ada.json' }).map((c: any) => c.name)).toEqual(['Tom', 'Vera Quill', 'Ada']);
  });
  it('offers only the characters the scene says are present, unless that leaves nobody', () => {
    expect(directorCast(cast, { present: ['tom', 'Ada'] }).map((c: any) => c.name)).toEqual(['Ada', 'Tom']);
    expect(directorCast(cast, { present: ['Someone Else'] }).map((c: any) => c.name)).toEqual(['Ada', 'Tom', 'Vera Quill']);
  });
  it('caps the card', () => {
    const many = Array.from({ length: 7 }, (_, i) => ({ file: `c${i}.json`, name: `C${i}` }));
    expect(directorCast(many)).toHaveLength(4);
    expect(directorCast(many, { max: 2 })).toHaveLength(2);
    expect(directorCast([])).toEqual([]);
  });
});

describe('the prompt', () => {
  const messages = buildDirectorPrompt({
    cast: [
      { name: 'Ada', tagline: 'A night-shift nurse.', drives: 'Wants the money back.', secrets: 'She took the first loan.', relationships: 'Tom: her brother.' },
      { name: 'Tom' },
    ],
    others: [{ name: 'Dana', note: 'the landlord' }],
    scene: { location: 'the kitchen', time: 'late night', mood: 'tense' },
    memory: { facts: [{ text: 'Tom owes the bank.' }], beats: [{ text: 'Ada found cash in his coat.' }], notes: 'Keep it slow.' },
    transcript: [{ name: 'Ada', content: 'Where did this come from?' }, { name: 'Tom', content: 'Leave it.' }],
    recentNotes: ['Tom deflects with a joke'],
    rules: 'People talk about what is in front of them.',
  });

  it('asks for four options of four different kinds, per character, in a format it can read back', () => {
    expect(messages).toHaveLength(2);
    const [system, user] = messages.map((m: any) => m.content);
    for (const k of DIRECTION_KINDS) expect(system).toContain(`- ${k.label}:`);
    expect(system).toContain('exactly four options, one of each kind');
    expect(system).toContain('Never decide how anyone else answers');
    expect(system).toContain('## Ada\nDeepen: <one sentence>');
    expect(user.endsWith('Write the options for: Ada, Tom.')).toBe(true);
  });

  it('gives the scene, the cast, their world, the memory and the recent turns', () => {
    const user = messages[1].content;
    expect(user).toContain('- Ada: A night-shift nurse. Wants: Wants the money back. Hides: She took the first loan. People: Tom: her brother.');
    expect(user).toContain('\n- Tom\n');
    expect(user).toContain('- Dana: the landlord');
    expect(user).toContain('Memory, what is true now:\n- Tom owes the bank.');
    expect(user).toContain('Story so far:\n- Ada found cash in his coat.');
    expect(user).toContain("The player's notes:\nKeep it slow.");
    expect(user).toContain('Now: the kitchen, late night, tense');
    expect(user).toContain('Recent turns, oldest first:\nAda: Where did this come from?\n\nTom: Leave it.');
    expect(user).toContain('Notes the last turns were written with:\n- Tom deflects with a joke');
    expect(user).toContain('How people talk in this story:');
  });

  it('leaves out what it does not have', () => {
    const user = buildDirectorPrompt({ cast: [{ name: 'Ada' }] })[1].content;
    expect(user).toBe('Cast:\n- Ada\n\nWrite the options for: Ada.');
  });

  it('keeps the newest turns when the chat is long', () => {
    const transcript = Array.from({ length: 40 }, (_, i) => ({ name: 'Ada', content: `turn ${i} ` + 'word '.repeat(80) }));
    const user = buildDirectorPrompt({ cast: [{ name: 'Ada' }], transcript })[1].content;
    expect(user).toContain('turn 39 ');
    expect(user).not.toContain('turn 0 ');
  });
});

describe('reading the reply', () => {
  const reply = [
    '## Ada',
    'Deepen: Folds the cash into neat stacks while he talks',
    'Push: Asks Tom straight out who he owes',
    'Complicate: Mentions the loan she never told him about',
    'Move: Grabs her keys and heads for the car',
    '',
    '## Tom',
    'Deepen: Stares at the photo of their father on the fridge',
    'Push: Snatches the money back off the table',
    'Complicate: Dana knocks, asking for the rent',
    'Move: Says he is going for a walk',
  ].join('\n');

  it('reads one option of each kind per character, in the order asked', () => {
    const got = parseDirections(reply, ['Ada', 'Tom']);
    expect(got.map((g: any) => g.name)).toEqual(['Ada', 'Tom']);
    expect(got[0].options.map((o: any) => o.kind)).toEqual(['deepen', 'push', 'complicate', 'move']);
    expect(got[0].options[1].text).toBe('Asks Tom straight out who he owes');
    expect(got[1].options[2].text).toBe('Dana knocks, asking for the rent');
  });

  it('takes bold, bullets, numbers, "Name:" headings, a thinking block, em dashes and quotes', () => {
    const messy = [
      '<think>let me consider the scene</think>',
      '**Ada:**',
      '1. **Push** - "Asks Tom straight out who he owes"',
      '- *Deepen*: Folds the cash — slowly — into stacks',
      '### Tom',
      '* Move: Says he is going for a walk.',
    ].join('\n');
    const got = parseDirections(messy, ['Ada', 'Tom']);
    expect(got[0].options).toEqual([
      { kind: 'deepen', text: 'Folds the cash, slowly, into stacks' },
      { kind: 'push', text: 'Asks Tom straight out who he owes' },
    ]);
    expect(got[1].options).toEqual([{ kind: 'move', text: 'Says he is going for a walk.' }]);
  });

  it('gives an unlabelled line the next free kind, and ignores a fifth', () => {
    const got = parseDirections('## Ada\nLooks away\nAsks him\nDeepen: Smiles\nLeaves\nOne too many', ['Ada']);
    expect(got[0].options.map((o: any) => [o.kind, o.text])).toEqual([
      ['deepen', 'Looks away'],
      ['push', 'Asks him'],
      ['complicate', 'Smiles'],
      ['move', 'Leaves'],
    ]);
  });

  it('matches a heading by first name, and skips names it was not asked for', () => {
    const got = parseDirections('## Vera\nPush: Opens the ledger\n## Someone\nPush: Waves', ['Vera Quill', 'Tom']);
    expect(got).toEqual([{ name: 'Vera Quill', options: [{ kind: 'push', text: 'Opens the ledger' }] }]);
  });

  it('keeps an option that happens to end in a colon', () => {
    expect(parseDirections('## Ada\nPush: Tells him:', ['Ada'])[0].options).toEqual([{ kind: 'push', text: 'Tells him:' }]);
  });

  it('gives a single character the options even without a heading', () => {
    expect(parseDirections('Push: Opens the ledger', ['Vera Quill'])[0].options[0].text).toBe('Opens the ledger');
  });

  it('while streaming, holds back the line still being written', () => {
    const partial = '## Ada\nDeepen: Folds the cash\nPush: Asks To';
    expect(parseDirections(partial, ['Ada'], { complete: false })[0].options.map((o: any) => o.kind)).toEqual(['deepen']);
    expect(parseDirections(partial, ['Ada'])[0].options.map((o: any) => o.kind)).toEqual(['deepen', 'push']);
  });

  it('returns nothing for a reply with no options', () => {
    expect(parseDirections('I cannot help with that.', ['Ada', 'Tom'])).toEqual([]);
    expect(parseDirections('', ['Ada'])).toEqual([]);
  });
});

describe('a pick in the composer', () => {
  it('is the chat\'s own command, quoting a name with a space', () => {
    expect(directionCommand('Ada', 'Asks who he owes')).toBe('/ai @Ada Asks who he owes');
    expect(directionCommand('Vera Quill', 'Opens the ledger')).toBe('/ai @"Vera Quill" Opens the ledger');
  });
  it('replaces an empty composer, a turn chip or an earlier pick', () => {
    expect(composeWithDirection('', '/ai @Ada X')).toBe('/ai @Ada X');
    expect(composeWithDirection('/ai @Tom <optional writing instruction>', '/ai @Ada X')).toBe('/ai @Ada X');
  });
  it('keeps what the player typed and goes on the last line, replacing an earlier pick there', () => {
    expect(composeWithDirection('I put the kettle on.', '/ai @Ada X')).toBe('I put the kettle on.\n/ai @Ada X');
    expect(composeWithDirection('I put the kettle on.\n/ai @Tom Y\n', '/ai @Ada X')).toBe('I put the kettle on.\n/ai @Ada X');
  });
  it('labels each kind', () => {
    expect(DIRECTION_KINDS.map((k: any) => directionKindLabel(k.key))).toEqual(['Deepen', 'Push', 'Complicate', 'Move']);
    expect(directionKindLabel('nope')).toBe('');
  });
});
