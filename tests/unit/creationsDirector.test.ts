// Creations AI: the director (ext/creations-ai/director.js). On request it
// reads a roleplay's scene and offers each character four short notes for
// their next turn, one of each kind, so the player picks a direction instead
// of writing one every turn. A pick becomes the chat's own "/ai @Name note".

import { describe, it, expect } from 'vitest';
// @ts-expect-error — JS module with no types
import { parseSituation, DIRECTION_KINDS, NARRATOR_KINDS, NARRATOR, DEFAULT_CHARACTER_DIRECTIONS, DEFAULT_NARRATOR_DIRECTIONS, MAX_DIRECTION_KINDS, parseDirectionKinds, directorCast, directorReplyTokens, buildDirectorPrompt, parseDirections, directionCommand, composeWithDirection, directionKindLabel } from '../../ext/creations-ai/director.js';

// The reading tests run on four kinds, the list as first shipped; the
// shipped default is now three (Deepen dropped), and the list is the user's.
const FOUR = parseDirectionKinds('Deepen: a feeling shows\nPush: they act on what they want\nComplicate: something gets in the way\nMove: they change the scene');
const kt = (opts: any[]) => opts.map(({ kind, text }: any) => ({ kind, text }));

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
  it('gives every character options, however many (the card was capped at four until 2026-10-09)', () => {
    const many = Array.from({ length: 7 }, (_, i) => ({ file: `c${i}.json`, name: `C${i}` }));
    expect(directorCast(many, { lastSpeaker: 'c0.json' }).map((c: any) => c.name)).toEqual(['C1', 'C2', 'C3', 'C4', 'C5', 'C6', 'C0']);
    expect(directorCast(many, { max: 2 })).toHaveLength(2);
    expect(directorCast([])).toEqual([]);
  });
  it('gives the reply room for every option asked for', () => {
    // The Narrator's four and three each for seven characters: 25 options.
    expect(directorReplyTokens(25)).toBe(2050);
    expect(directorReplyTokens(4 + 3 * 2)).toBe(1200);
    expect(directorReplyTokens(500)).toBe(6000);
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

  it('asks for one option of each shipped kind, per character, in a format it can read back', () => {
    expect(messages).toHaveLength(2);
    const [system, user] = messages.map((m: any) => m.content);
    expect(DIRECTION_KINDS.map((k: any) => k.label)).toEqual(['Push', 'Complicate', 'Move']);
    for (const k of DIRECTION_KINDS) expect(system).toContain(`- ${k.label}:`);
    expect(system).not.toContain('Deepen');
    expect(system).toContain('exactly 3 options, one of each kind');
    expect(system).toContain('Never decide how anyone else answers');
    expect(system).toContain('## Ada\nPush: <one sentence> || <what it could set in motion>\nComplicate: <one sentence> || <what it could set in motion>\nMove: <one sentence> || <what it could set in motion>');
    expect(user.endsWith('Write the options for the Narrator, then for: Ada, Tom.')).toBe(true);
  });

  it('gives the scene, the cast, their world, the memory and the recent turns', () => {
    const user = messages[1].content;
    expect(user).toContain('- Ada: A night-shift nurse. Wants: Wants the money back. Hides: She took the first loan. People: Tom: her brother.');
    expect(user).toContain('\n- Tom\n');
    expect(user).toContain('- Dana: the landlord');
    expect(user).toContain('Memory, what is true now:\n- Tom owes the bank.');
    expect(user).toContain('Story so far:\n- Ada found cash in his coat.');
    expect(user).toContain("The player's notes:\nKeep it slow.");
    expect(user).toContain('Now (last known; the last turn wins if it moved things): the kitchen, late night, tense');
    expect(user).toContain('Earlier turns, oldest first:\nAda: Where did this come from?');
    expect(user).toContain('What just happened (the last turn, in full; every option answers it):\nTom: Leave it.');
    expect(user).toContain('Notes the last turns were written with:\n- Tom deflects with a joke');
    expect(user).toContain('How people talk in this story:');
  });

  it('leaves out what it does not have', () => {
    const user = buildDirectorPrompt({ cast: [{ name: 'Ada' }] })[1].content;
    expect(user).toBe('Cast:\n- Ada\n\nWrite the options for the Narrator, then for: Ada.');
    const without = buildDirectorPrompt({ cast: [{ name: 'Ada' }], narrator: false });
    expect(without[1].content).toBe('Cast:\n- Ada\n\nWrite the options for: Ada.');
    expect(without[0].content).not.toContain('## Narrator');
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
    const got = parseDirections(reply, ['Ada', 'Tom'], { characterKinds: FOUR });
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
    const got = parseDirections(messy, ['Ada', 'Tom'], { characterKinds: FOUR });
    expect(kt(got[0].options)).toEqual([
      { kind: 'deepen', text: 'Folds the cash, slowly, into stacks' },
      { kind: 'push', text: 'Asks Tom straight out who he owes' },
    ]);
    expect(kt(got[1].options)).toEqual([{ kind: 'move', text: 'Says he is going for a walk.' }]);
  });

  it('gives an unlabelled line the next free kind, and ignores a fifth', () => {
    const got = parseDirections('## Ada\nLooks away\nAsks him\nDeepen: Smiles\nLeaves\nOne too many', ['Ada'], { characterKinds: FOUR });
    expect(got[0].options.map((o: any) => [o.kind, o.text])).toEqual([
      ['deepen', 'Looks away'],
      ['push', 'Asks him'],
      ['complicate', 'Smiles'],
      ['move', 'Leaves'],
    ]);
  });

  it('matches a heading by first name, and skips names it was not asked for', () => {
    const got = parseDirections('## Vera\nPush: Opens the ledger\n## Someone\nPush: Waves', ['Vera Quill', 'Tom'], { characterKinds: FOUR });
    expect(got.map((g: any) => ({ name: g.name, options: kt(g.options) }))).toEqual([{ name: 'Vera Quill', options: [{ kind: 'push', text: 'Opens the ledger' }] }]);
  });

  it('keeps an option that happens to end in a colon', () => {
    expect(parseDirections('## Ada\nPush: Tells him:', ['Ada'])[0].options).toEqual([{ kind: 'push', label: 'Push', text: 'Tells him:' }]);
  });

  it('gives a single character the options even without a heading', () => {
    expect(parseDirections('Push: Opens the ledger', ['Vera Quill'])[0].options[0].text).toBe('Opens the ledger');
  });

  it('while streaming, holds back the line still being written', () => {
    const partial = '## Ada\nDeepen: Folds the cash\nPush: Asks To';
    expect(parseDirections(partial, ['Ada'], { complete: false, characterKinds: FOUR })[0].options.map((o: any) => o.kind)).toEqual(['deepen']);
    expect(parseDirections(partial, ['Ada'], { characterKinds: FOUR })[0].options.map((o: any) => o.kind)).toEqual(['deepen', 'push']);
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
    expect(DIRECTION_KINDS.map((k: any) => directionKindLabel(k.key))).toEqual(['Push', 'Complicate', 'Move']);
    expect(directionKindLabel('nope')).toBe('');
  });
});

describe('the Narrator: moves for the story, not a character', () => {
  it('is asked for a new scene, a time skip, an arrival and an event, first in the format', () => {
    const [system] = buildDirectorPrompt({ cast: [{ name: 'Ada' }], others: [{ name: 'Dana', note: 'the landlord' }] }).map((m: any) => m.content);
    for (const k of NARRATOR_KINDS) expect(system).toContain(`- ${k.label}:`);
    expect(system).toContain('never what anyone says or feels');
    expect(system).toContain('a scene that has run its course needs moving on');
    expect(system.indexOf('## Narrator\nNew Scene: <one sentence>')).toBeGreaterThan(-1);
    expect(system.indexOf('## Narrator\nNew Scene: <one sentence>')).toBeLessThan(system.indexOf('## Ada\nPush: <one sentence>'));
    expect(system.indexOf('## Situation\n<one sentence>')).toBeLessThan(system.indexOf('## Narrator\nNew Scene'));
  });

  it('reads its group with its own kinds, two-word labels included, beside the characters', () => {
    const reply = [
      '## Narrator',
      'New Scene: Cut to the harbour at dawn, where the buyer is already waiting',
      '**Time Skip** - Three weeks pass and the shop has a new lock',
      'Arrival: Dana knocks, asking for the rent',
      'Event: The power fails across the whole street',
      '',
      '## Ada',
      'Push: Asks Tom straight out who he owes',
    ].join('\n');
    const got = parseDirections(reply, [NARRATOR, 'Ada']);
    expect(got.map((g: any) => g.name)).toEqual(['Narrator', 'Ada']);
    expect(got[0].options.map((o: any) => [o.kind, o.text])).toEqual([
      ['new scene', 'Cut to the harbour at dawn, where the buyer is already waiting'],
      ['time skip', 'Three weeks pass and the shop has a new lock'],
      ['arrival', 'Dana knocks, asking for the rent'],
      ['event', 'The power fails across the whole street'],
    ]);
    expect(kt(got[1].options)).toEqual([{ kind: 'push', text: 'Asks Tom straight out who he owes' }]);
  });

  it('a character label under the Narrator counts as no label; unlabelled lines take the next free kind', () => {
    const got = parseDirections('## Narrator\nPush: The rain starts\nA stranger arrives', [NARRATOR]);
    expect(got[0].options.map((o: any) => o.kind)).toEqual(['new scene', 'time skip']);
    expect(got[0].options.map((o: any) => o.label)).toEqual(['New Scene', 'Time Skip']);
    expect(got[0].options[0].text).toBe('The rain starts');
  });

  it('a pick becomes the chat\'s own /nar, and replaces an earlier pick under typed words', () => {
    expect(directionCommand(NARRATOR, 'Three weeks pass')).toBe('/nar Three weeks pass');
    expect(composeWithDirection('I lock the door.\n/ai @Ada X', '/nar Three weeks pass')).toBe('I lock the door.\n/nar Three weeks pass');
    expect(composeWithDirection('I lock the door.\n/nar Y', '/ai @Ada X')).toBe('I lock the door.\n/ai @Ada X');
    expect(NARRATOR_KINDS.map((k: any) => directionKindLabel(k.key))).toEqual(['New Scene', 'Time Skip', 'Arrival', 'Event']);
  });
});

describe('the kinds are the user\'s (Creations Settings)', () => {
  it('reads one kind per line as "Label: what it means"; blanks, # lines and repeats skipped; capped', () => {
    const kinds = parseDirectionKinds('# mine\n\n- Confess: they admit something\nFlirt\nconfess: again\nA line that is far too long to be a label');
    expect(kinds).toEqual([
      { key: 'confess', label: 'Confess', rule: 'they admit something' },
      { key: 'flirt', label: 'Flirt', rule: '' },
    ]);
    expect(parseDirectionKinds('')).toEqual([]);
    const many = Array.from({ length: 12 }, (_, i) => `K${i}: rule ${i}`).join('\n');
    expect(parseDirectionKinds(many)).toHaveLength(MAX_DIRECTION_KINDS);
    expect(parseDirectionKinds(DEFAULT_CHARACTER_DIRECTIONS)).toEqual(DIRECTION_KINDS);
    expect(parseDirectionKinds(DEFAULT_NARRATOR_DIRECTIONS)).toEqual(NARRATOR_KINDS);
  });

  it('asks for as many options as there are kinds, and reads them back with their labels', () => {
    const characterKinds = parseDirectionKinds('Confess: they admit something\nLeave: they go');
    const narratorKinds = parseDirectionKinds('Cut: a new scene');
    const [system, user] = buildDirectorPrompt({ cast: [{ name: 'Ada' }], characterKinds, narratorKinds }).map((m: any) => m.content);
    expect(system).toContain('write exactly 2 options, one of each kind:\n- Confess: they admit something.\n- Leave: they go.');
    expect(system).toContain('write one option, of this kind, for the story itself:\n- Cut: a new scene.');
    expect(system).toContain('## Narrator\nCut: <one sentence> || <what it could set in motion>\n\n## Ada\nConfess: <one sentence> || <what it could set in motion>\nLeave: <one sentence> || <what it could set in motion>');
    expect(user.endsWith('Write the options for the Narrator, then for: Ada.')).toBe(true);
    const got = parseDirections('## Narrator\nCut: To the docks\n## Ada\nLeave: Walks out\nConfess: Says she took it', [NARRATOR, 'Ada'], { characterKinds, narratorKinds });
    expect(got).toEqual([
      { name: 'Narrator', options: [{ kind: 'cut', label: 'Cut', text: 'To the docks' }] },
      { name: 'Ada', options: [{ kind: 'confess', label: 'Confess', text: 'Says she took it' }, { kind: 'leave', label: 'Leave', text: 'Walks out' }] },
    ]);
  });

  it('an empty list asks for none of that sort: Narrator only, or characters only', () => {
    const narratorOnly = buildDirectorPrompt({ cast: [{ name: 'Ada' }], characterKinds: [] }).map((m: any) => m.content);
    expect(narratorOnly[0]).not.toContain('For each character');
    expect(narratorOnly[0]).toContain('Under "## Narrator"');
    expect(narratorOnly[1]).toContain('Cast:\n- Ada');
    expect(narratorOnly[1].endsWith('Write the options for the Narrator.')).toBe(true);
    const charactersOnly = buildDirectorPrompt({ cast: [{ name: 'Ada' }], narratorKinds: [] }).map((m: any) => m.content);
    expect(charactersOnly[0]).not.toContain('## Narrator');
    expect(charactersOnly[1].endsWith('Write the options for: Ada.')).toBe(true);
  });
});

describe('grounded in the moment, with consequences (2026-10-08)', () => {
  // The owner: the options ignored what had just happened (a Narrator beat
  // included) and read like suggestions for the sake of suggesting, with no
  // consequences, unlike the choices of a story game.
  const msgs = buildDirectorPrompt({
    cast: [{ name: 'Ada', drives: 'Wants the money back.' }],
    transcript: [
      { name: 'Ada', content: 'Where did this come from?' },
      { name: 'Narrator', content: 'Boots on the stair. ' + 'The door gives under a shoulder. '.repeat(60) + 'Two clerks stand in the doorway with the harbourmaster.' },
    ],
  }).map((m: any) => m.content);

  it('the last turn, a Narrator beat included, stands alone and in full, nearest the ask, and outranks the scene line', () => {
    const [system, user] = msgs;
    const lastAt = user.indexOf('What just happened (the last turn, in full; every option answers it):\nNarrator: Boots on the stair.');
    expect(lastAt).toBeGreaterThan(-1);
    expect(user).toContain('Two clerks stand in the doorway with the harbourmaster.');
    expect(user).not.toContain('[...]');
    expect(lastAt).toBeGreaterThan(user.indexOf('Earlier turns, oldest first:\nAda: Where did this come from?'));
    expect(lastAt).toBeLessThan(user.indexOf('Write the options'));
    expect(system).toContain('It is the newest truth: where it differs from the Now line or the memory, it wins.');
  });

  it('every option answers the last turn, fits only this moment, and says what it could set in motion', () => {
    const system = msgs[0];
    expect(system).toContain('Answers the last turn.');
    expect(system).toContain('they never replace the answer');
    expect(system).toContain('If it would fit any other moment of the story, it is wrong.');
    expect(system).toContain('what it could set in motion, at most 12 words');
    expect(system).toContain('Each Narrator option follows from the last turn');
    expect(system).toContain('First, under "## Situation", write one sentence');
  });

  it('reads what an option could set in motion, whatever separator the model used, and keeps it out of the note', () => {
    const reply = [
      '## Situation',
      'The harbourmaster has walked in on the money, and nobody has explained it.',
      '',
      '## Ada',
      'Push: Hands the harbourmaster the ledger || he sees whose name is on page one',
      'Complicate: Says the cash is Tom\'s -> Tom has to answer for it',
      'Move: Walks out past the clerks → the clerks follow her, not him',
    ].join('\n');
    const [ada] = parseDirections(reply, ['Ada']);
    expect(ada.options.map((o: any) => [o.text, o.then])).toEqual([
      ['Hands the harbourmaster the ledger', 'he sees whose name is on page one'],
      ['Says the cash is Tom\'s', 'Tom has to answer for it'],
      ['Walks out past the clerks', 'the clerks follow her, not him'],
    ]);
    expect(directionCommand('Ada', ada.options[0].text)).toBe('/ai @Ada Hands the harbourmaster the ledger');
    expect(parseSituation(reply)).toBe('The harbourmaster has walked in on the money, and nobody has explained it.');
  });

  it('reads the situation inline or under a bold heading; none, or one still streaming, is empty', () => {
    expect(parseSituation('Situation: The door is open.\n## Ada\nPush: X')).toBe('The door is open.');
    expect(parseSituation('**Situation**\n\nThe door is open.')).toBe('The door is open.');
    expect(parseSituation('## Ada\nPush: X')).toBe('');
    expect(parseSituation('## Situation\nThe door is', { complete: false })).toBe('');
  });
});

