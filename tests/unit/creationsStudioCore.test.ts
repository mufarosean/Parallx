// Creations AI: the Character Studio's pure half (ext/creations-ai/studio-core.js).
// Prompts, streaming field extraction, the canon and its Twist, and the round
// trip between a sheet and the character file the chat reads.

import { describe, it, expect } from 'vitest';
// @ts-expect-error — JS module with no types
import * as core from '../../ext/creations-ai/studio-core.js';

const {
  STUDIO_FIELDS, STUDIO_KEYS, stripDashes, normalizeDialogue, cleanSheet, condenseText,
  buildCanonMessages, buildTwistMessages, buildSheetMessages, buildFieldMessages, buildTryLineMessages,
  parseJsonLoose, extractCompletedFields, parseTwistedCanon, parseCanonFacts, canonCounts,
  composeRoleInstruction, splitRoleInstruction, sheetFromCharacter, characterFromSheet, lineageOf,
  parseSheetStructure, fieldRequirements, structureRequirement, DEFAULT_SHEET_STRUCTURE,
  connectionDigest, connectionsBlock, backLinkLine, withRelationshipLine,
  sectionsPresent, completionDirection, structureSystemLine,
} = core;

describe('the sheet', () => {
  it('has twelve fields, name first, the two chat fields last, every label in Title Case', () => {
    expect(STUDIO_KEYS[0]).toBe('name');
    expect(STUDIO_KEYS.slice(-2)).toEqual(['exampleDialogue', 'reminder']);
    expect(STUDIO_KEYS).toHaveLength(12);
    for (const f of STUDIO_FIELDS) expect(f.label).toMatch(/^[A-Z][A-Za-z]*( [A-Z][A-Za-z]*)*$/);
  });
  it('strips dashes and normalises dialogue tags on the way in', () => {
    expect(stripDashes('She paused — then left')).toBe('She paused, then left');
    expect(stripDashes('1990–1995')).toBe('1990-1995');
    expect(normalizeDialogue('[Sofia]: hi\n[user]: hey')).toBe('[AI]: hi\n[USER]: hey');
    const s = cleanSheet({ name: 'Ada', exampleDialogue: '[ADA]: Yes — always.', extra: 'ignored' });
    expect(s.exampleDialogue).toBe('[AI]: Yes, always.');
    expect((s as Record<string, string>).extra).toBeUndefined();
    expect(s.tagline).toBe('');
  });
  it('gives back the line breaks a model ran together', () => {
    const s = cleanSheet({
      exampleDialogue: '[USER]: Hi. [Ada]: No. [USER]: Why? [AI]: Because.',
      drives: 'Wants: rest. Fears: the dark. In the way: her sister.',
      relationships: 'Elena: the clerk; she brings coffee. Mr. Henderson: a guest in 402. Dana: her sister.',
    });
    expect(s.exampleDialogue).toBe('[USER]: Hi.\n[AI]: No.\n[USER]: Why?\n[AI]: Because.');
    expect(s.drives.split('\n')).toEqual(['Wants: rest.', 'Fears: the dark.', 'In the way: her sister.']);
    expect(s.relationships.split('\n')).toHaveLength(3);
    expect(cleanSheet({ drives: 'a\nb\nc' }).drives).toBe('a\nb\nc');
  });
});

describe('sources', () => {
  it('condenses to the cap and cuts back to a sentence end', () => {
    const text = Array.from({ length: 60 }, (_, i) => `Sentence number ${i} ends here.`).join(' ');
    const c = condenseText(text, 100);
    expect(c.condensed).toBe(true);
    expect(c.words).toBeLessThanOrEqual(100);
    expect(c.text.endsWith('.')).toBe(true);
    expect(c.totalWords).toBe(300);
    expect(condenseText('short text', 100)).toMatchObject({ condensed: false, words: 2 });
  });
});

describe('prompts', () => {
  const sources = [{ kind: 'link', title: 'Wikipedia', ref: 'https://en.wikipedia.org/wiki/X', text: 'X was born in 1954.' }];
  it('asks for canon as JSON facts, with the sources numbered and cited', () => {
    const [system, user] = buildCanonMessages(sources, 'the person, not the films');
    expect(system.content).toContain('"facts"');
    expect(user.content).toContain('[1] Wikipedia (https://en.wikipedia.org/wiki/X)');
    expect(user.content).toContain('the person, not the films');
  });
  it('asks the Twist to keep, change and add with the old text kept', () => {
    const [system, user] = buildTwistMessages(['X is an actor.', 'X was born in 1954.'], 'X never became an actor and works as a security guard');
    expect(system.content).toContain('"kept"');
    expect(system.content).toContain('"was"');
    expect(user.content).toContain('1. X is an actor.');
    expect(user.content).toContain('works as a security guard');
  });
  it('writes the sheet from the canon, tells the writer the world has moved, and only mentions the dials when touched', () => {
    const [system, user] = buildSheetMessages({ concept: '', canon: ['X is a guard.'], twist: 'X is a guard now' });
    expect(system.content).toContain('"reminder"');
    expect(user.content).toContain('- X is a guard.');
    expect(user.content).toContain('already includes this change');
    expect(user.content).not.toContain('ATTRIBUTES');
    const [, withSpec] = buildSheetMessages({ concept: 'A guard', spec: '- Gender: Male' });
    expect(withSpec.content).toContain('ATTRIBUTES');
    expect(withSpec.content).toContain('CHARACTER CONCEPT');
    expect(withSpec.content).not.toContain('NAME:');
  });
  it('tells the writer the name the user chose, and the rewrite of a field too', () => {
    const [, user] = buildSheetMessages({ concept: 'A guard', name: 'Barnaby Quill' });
    expect(user.content).toContain('NAME: Barnaby Quill. The user chose this name.');
    expect(user.content.indexOf('NAME:')).toBeLessThan(user.content.indexOf('CHARACTER CONCEPT'));
    const [, field] = buildFieldMessages({ concept: 'A guard', name: 'Barnaby Quill' }, { name: 'Barnaby Quill' }, 'voice');
    expect(field.content).toContain('NAME: Barnaby Quill');
  });
  it('rewrites one field with the sheet in view and the field\'s own requirement', () => {
    const [system, user] = buildFieldMessages({ concept: 'A guard' }, { name: 'X', backstory: 'old' }, 'backstory');
    expect(system.content).toContain('"backstory"');
    expect(user.content).toContain('"backstory": "old"');
    expect(user.content).toContain('turning point');
  });
  it('a rewrite with a direction follows it and lets it set the length', () => {
    const [, plain] = buildFieldMessages({ concept: 'A guard' }, { name: 'X', backstory: 'old' }, 'backstory');
    expect(plain.content).not.toContain('DIRECTION');
    expect(plain.content).toContain('same length as the current one or shorter');
    for (const blank of ['', '   ']) expect(buildFieldMessages({}, { backstory: 'old' }, 'backstory', blank)[1].content).toBe(buildFieldMessages({}, { backstory: 'old' }, 'backstory')[1].content);
    const [, steered] = buildFieldMessages({ concept: 'A guard' }, { name: 'X', backstory: 'old' }, 'backstory', '  More about the war years and her brother.  ');
    expect(steered.content).toContain('DIRECTION: More about the war years and her brother.');
    expect(steered.content).toContain('The direction leads');
    expect(steered.content).not.toContain('same length as the current one or shorter');
    expect(steered.content).toContain('turning point'); // the field's own requirement still frames it
    expect(steered.content).not.toMatch(/[—–]/);
  });
  it('lets you try a line against the composed portrait', () => {
    const [system, user] = buildTryLineMessages({ name: 'Ada', description: 'Ada counts.', voice: 'Dry.', exampleDialogue: '[USER]: hi\n[AI]: no', reminder: 'Never lies.' }, 'Hello?');
    expect(system.content).toContain('You are Ada');
    expect(system.content).toContain('## Voice\nDry.');
    expect(system.content).toContain('Never lies.');
    expect(user.content).toBe('Hello?');
  });
  it('never puts an em dash into a prompt', () => {
    const all = [buildCanonMessages(sources), buildTwistMessages(['a'], 'b'), buildSheetMessages({ concept: 'c' }), buildFieldMessages({}, {}, 'voice')].flat().map((m) => m.content).join('');
    expect(all).not.toMatch(/[—–]/);
  });
});

describe('parsing', () => {
  it('shows fields as their string literal closes while the JSON is still streaming', () => {
    const partial = '{"name": "Ada Lovelace", "tagline": "Counts what others \\"feel\\"", "description": "She was born in';
    const done = extractCompletedFields(partial);
    expect(done).toEqual({ name: 'Ada Lovelace', tagline: 'Counts what others "feel"' });
    expect(extractCompletedFields('{"name": "A', ['name'])).toEqual({});
  });
  it('does not take a key mentioned inside another value for the field itself', () => {
    const raw = '{"description": "Her \\"name\\": is unknown", "name": "Ada"}';
    expect(extractCompletedFields(raw, ['name'])).toEqual({ name: 'Ada' });
  });
  it('parses fenced or padded JSON', () => {
    expect(parseJsonLoose('```json\n{"a":1}\n```')).toEqual({ a: 1 });
    expect(parseJsonLoose('Sure: {"a":1} done')).toEqual({ a: 1 });
    expect(parseJsonLoose('nope')).toBeNull();
  });
  it('reads the twisted canon with statuses, and keeps the base when the model returns nothing', () => {
    const twisted = parseTwistedCanon({ facts: [
      { text: 'X was born in 1954.', status: 'kept' },
      { text: 'X works as a hotel security guard.', status: 'changed', was: 'X is an actor.' },
      { text: 'X works nights.', status: 'added' },
      { text: 'X likes tea.', status: 'weird' },
      'X is tall.',
    ] }, ['base']);
    expect(twisted.map((f) => f.status)).toEqual(['kept', 'changed', 'added', 'kept', 'kept']);
    expect(twisted[1].was).toBe('X is an actor.');
    expect(canonCounts(twisted)).toEqual({ total: 5, kept: 3, changed: 1, added: 1 });
    expect(parseTwistedCanon({ facts: [] }, ['base'])).toEqual([{ text: 'base', status: 'kept', was: '' }]);
    expect(parseCanonFacts({ facts: ['a — b', '', 3] })).toEqual(['a, b']);
  });
});

describe('sheet <-> character file', () => {
  const sheet = {
    name: 'Ada', tagline: 'Counts', description: 'Ada counts.', appearance: 'Tall.', personality: 'Dry.', voice: 'Short lines.',
    backstory: 'Born 1815.', drives: 'Wants order.', secrets: 'Hates numbers.', relationships: 'Babbage: strained.',
    exampleDialogue: '[USER]: hi\n[AI]: Counted.', reminder: 'Never lies.',
  };
  it('composes the role instruction the chat reads, and splits it back into the same fields', () => {
    const role = composeRoleInstruction(sheet);
    expect(role.startsWith('Ada counts.\n\n## Appearance\nTall.')).toBe(true);
    expect(role).toContain('## Background\nBorn 1815.');
    const back = splitRoleInstruction(role);
    expect(back).toEqual({ description: 'Ada counts.', appearance: 'Tall.', personality: 'Dry.', voice: 'Short lines.', backstory: 'Born 1815.', drives: 'Wants order.', secrets: 'Hates numbers.', relationships: 'Babbage: strained.' });
  });
  it('reads a Forge-made or hand-written character into the sheet, and a Studio-made one from its own block', () => {
    const legacy = { name: 'Ada', roleInstruction: 'Ada counts.\n\n## Appearance\nTall.\n\n## Voice\nShort lines.', exampleDialogue: '[USER]: hi\n[AI]: no', reminder: 'R', voiceAnchor: 'ignored when Voice exists' };
    const s = sheetFromCharacter(legacy);
    expect(s).toMatchObject({ name: 'Ada', description: 'Ada counts.', appearance: 'Tall.', voice: 'Short lines.', reminder: 'R', tagline: '' });
    const anchored = sheetFromCharacter({ name: 'B', roleInstruction: 'Plain.', voiceAnchor: 'Gruff.' });
    expect(anchored.voice).toBe('Gruff.');
    const own = sheetFromCharacter({ name: 'C', roleInstruction: 'ignored', studio: { sheet: { ...sheet, name: 'C' } } });
    expect(own.backstory).toBe('Born 1815.');
  });
  it('writes the file fields from the sheet and keeps everything else on the character', () => {
    const base = { id: 'char-1', name: 'Old', writingPreset: 'immersive-rp', lorebookFiles: ['x.md'], studio: { parentId: 'char-0' } };
    const data = characterFromSheet(sheet, base, { twist: 't' });
    expect(data).toMatchObject({ id: 'char-1', name: 'Ada', writingPreset: 'immersive-rp', lorebookFiles: ['x.md'], voiceAnchor: 'Short lines.', reminder: 'Never lies.' });
    expect(data.roleInstruction).toContain('## Secrets\nHates numbers.');
    expect(data.studio).toMatchObject({ parentId: 'char-0', twist: 't', sheet: { name: 'Ada' } });
    expect(sheetFromCharacter(data)).toEqual(sheet);
  });
  it('walks a lineage root first and survives a missing parent or a cycle', () => {
    const byId = new Map<string, { id: string; studio?: { parentId?: string } }>([
      ['a', { id: 'a' }], ['b', { id: 'b', studio: { parentId: 'a' } }], ['c', { id: 'c', studio: { parentId: 'b' } }],
      ['x', { id: 'x', studio: { parentId: 'y' } }], ['y', { id: 'y', studio: { parentId: 'x' } }],
      ['lost', { id: 'lost', studio: { parentId: 'gone' } }],
    ]);
    expect(lineageOf(byId, 'c').map((c) => c.id)).toEqual(['a', 'b', 'c']);
    expect(lineageOf(byId, 'x').map((c) => c.id)).toEqual(['y', 'x']);
    expect(lineageOf(byId, 'lost').map((c) => c.id)).toEqual(['lost']);
  });
});

describe('pitches', () => {
  const { buildPitchMessages, parsePitches, pitchAsConcept, PITCH_COUNT } = core;

  it('asks for several different takes on the concept, the chosen name kept', () => {
    const [system, user] = buildPitchMessages({ concept: 'A lighthouse keeper who collects secrets', spec: '- Gender: Female', name: 'Marit Holm' });
    expect(system.content).toContain(`exactly ${PITCH_COUNT} pitches`);
    expect(system.content).toContain('never the obvious one twice');
    expect(user.content).toContain('NAME: Marit Holm');
    expect(user.content).toContain('A lighthouse keeper who collects secrets');
    expect(user.content).toContain('ATTRIBUTES');
    expect(system.content + user.content).not.toMatch(/[—–]/);
  });

  it('reads the pitches, cleans dashes, drops empties, keeps at most six', () => {
    const parsed = { pitches: [
      { name: 'Marit Holm', tagline: 'Keeps the light — and the gossip', hook: 'She runs the last manned light on the coast.', contradiction: 'Wants company, drives it off.', line: 'Sit. Or do not, I have the kettle on either way.' },
      { name: '', tagline: '', hook: '', contradiction: 'x', line: '' },
      ...Array.from({ length: 7 }, (_, i) => ({ name: `P${i}`, tagline: `take ${i}`, hook: `hook ${i}` })),
    ] };
    const out = parsePitches(parsed);
    expect(out).toHaveLength(6);
    expect(out[0].tagline).toBe('Keeps the light, and the gossip');
    expect(out[1].name).toBe('P0');
    expect(parsePitches({})).toEqual([]);
  });

  it('folds the chosen pitch into the concept the sheet is written from', () => {
    const text = pitchAsConcept('A lighthouse keeper', { name: 'Marit Holm', tagline: 'Keeps the light', hook: 'Runs the last light.', contradiction: 'Wants company, drives it off.', line: 'Sit.' });
    expect(text.startsWith('A lighthouse keeper\n\nThe take to write')).toBe(true);
    expect(text).toContain('Name: Marit Holm');
    expect(text).toContain('Contradiction: Wants company, drives it off.');
    expect(pitchAsConcept('A lighthouse keeper', null)).toBe('A lighthouse keeper');
  });
});

describe('the example dialogue requirement', () => {
  it('draws the situations from the character\'s own sheet and shows a value by behaviour, never by naming it', () => {
    const [, user] = buildSheetMessages({ concept: 'A ferry captain' });
    const line = user.content.split('\n').find((l: string) => l.startsWith('- "exampleDialogue"'))!;
    expect(line).toContain("chosen from THIS character's own sheet, not from a template");
    expect(line).toContain('never by naming the value or the feeling');
    expect(line).toContain('No abstract nouns in their mouth');
    expect(line).toContain('never a quip that would fit anyone');
    // The reroll of that one field carries the same requirement.
    const [, reroll] = buildFieldMessages({ concept: 'A ferry captain' }, { exampleDialogue: '[USER]: hi\n[AI]: no' }, 'exampleDialogue');
    expect(reroll.content).toContain('never by naming the value or the feeling');
  });
});

describe('making one of their people', () => {
  const { parseRelationshipLines, relationConcept } = core;
  it('reads the Name: note lines and writes a concept that stands on its own', () => {
    const people = parseRelationshipLines('Dana: her sister, lives upstairs, not speaking since the funeral.\n- Tom Reyes: the landlord. Owed two months.\nno colon here');
    expect(people).toEqual([
      { name: 'Dana', note: 'her sister, lives upstairs, not speaking since the funeral.' },
      { name: 'Tom Reyes', note: 'the landlord. Owed two months.' },
    ]);
    const concept = relationConcept(people[0], { name: 'Ada Lovelace', tagline: 'Counts what others feel.' });
    expect(concept.startsWith('Dana: her sister, lives upstairs')).toBe(true);
    expect(concept).toContain('in relation to Ada Lovelace (Counts what others feel)');
    expect(concept).toContain("seen from Dana's side");
    expect(concept).toContain('not an extension of Ada Lovelace');
  });
});

describe('the voice requirement', () => {
  it('asks for one example of the register, never a catchphrase, and Try A Line says the same', () => {
    const [, user] = buildSheetMessages({ concept: 'A ferry captain' });
    const line = user.content.split('\n').find((l: string) => l.startsWith('- "voice"'))!;
    expect(line).toContain('"Might say:');
    expect(line).toContain('never a catchphrase they would repeat');
    expect(line).not.toContain('two signature phrases');
    const [system] = buildTryLineMessages({ name: 'Ada', voice: "Says: 'noted'." }, 'hello');
    expect(system.content).toContain('examples of the register, not lines to say');
  });
});

describe('the sheet structure (2026-10-06)', () => {
  it('ships with Appearance in five sections, physicality among them, and notes the user can read', () => {
    const st = parseSheetStructure(DEFAULT_SHEET_STRUCTURE);
    expect(Object.keys(st)).toEqual(['appearance']);
    expect(st.appearance.labels).toBe(true);
    expect(st.appearance.sections.map((x: { name: string }) => x.name)).toEqual(['Overview', 'Height and build', 'Face', 'Clothes', 'Physicality']);
    expect(st.appearance.sections[4].hint).toMatch(/how they move, sit, stand/);
    expect(DEFAULT_SHEET_STRUCTURE).toMatch(/^# /m);
  });

  it('reads headings by label or key, any case, with or without a colon; notes, blank lines and unknown headings are skipped', () => {
    const st = parseSheetStructure([
      '# a note', '', 'APPEARANCE:', '- Overview', '* Face: eyes and hair', '1. Hands', '',
      'backstory', '- Childhood: where, with whom', '- The turning point',
      'Not A Field', '- Ignored: never lands', 'Personality (no labels)', '- Temper: quick or slow', '- Under it',
      'Secrets', '# a heading with no sections is nothing',
    ].join('\n'));
    expect(Object.keys(st).sort()).toEqual(['appearance', 'backstory', 'personality']);
    expect(st.appearance.sections).toEqual([{ name: 'Overview', hint: '' }, { name: 'Face', hint: 'eyes and hair' }, { name: 'Hands', hint: '' }]);
    expect(st.backstory.sections[1]).toEqual({ name: 'The turning point', hint: '' });
    expect(st.personality.labels).toBe(false);
    expect(parseSheetStructure('')).toEqual({});
    expect(parseSheetStructure('- Face: orphan bullets before any heading')).toEqual({});
  });

  it('writes a structured field as one detailed paragraph per section, in order, labelled unless told not to', () => {
    const st = parseSheetStructure(DEFAULT_SHEET_STRUCTURE);
    const line = fieldRequirements(st).split('\n').find((l) => l.startsWith('- "appearance"'))!;
    expect(line).toMatch(/5 separate paragraphs, one per section, in this order/);
    expect(line).toMatch(/begins with its section's label and a colon, like "Overview: \.\.\."/);
    expect(line).toMatch(/none is skipped, merged or padded out/);
    expect(line).toContain('Physicality (how they move, sit, stand and gesture; the habits of their body; what their hands do)');
    // Every other field keeps its usual line.
    expect(fieldRequirements(st).split('\n').find((l) => l.startsWith('- "voice"'))).toBe(fieldRequirements(null).split('\n').find((l) => l.startsWith('- "voice"')));
    const plain = structureRequirement('personality', { labels: false, sections: [{ name: 'Temper', hint: '' }, { name: 'Under it', hint: 'the need' }] });
    expect(plain).toMatch(/2 separate paragraphs/);
    expect(plain).toMatch(/each paragraph is plain, with no label/);
    expect(plain).toContain('Temper; Under it (the need)');
  });

  it('the whole sheet and a single field\'s rewrite follow it; without a structure the usual shape stands', () => {
    const st = parseSheetStructure(DEFAULT_SHEET_STRUCTURE);
    const [, user] = buildSheetMessages({ concept: 'A ferry captain', structure: st });
    expect(user.content).toContain('Height and build');
    expect(user.content).not.toMatch(/"appearance": one vivid paragraph/);
    const [, usual] = buildSheetMessages({ concept: 'A ferry captain' });
    expect(usual.content).toMatch(/"appearance": one vivid paragraph/);
    const [, reroll] = buildFieldMessages({ concept: 'A ferry captain', structure: st }, { appearance: 'Tall.' }, 'appearance');
    expect(reroll.content).toContain('5 separate paragraphs');
    const [, steered] = buildFieldMessages({ concept: 'A ferry captain', structure: st }, { appearance: 'Tall.' }, 'appearance', 'more about her hands');
    expect(steered.content).toMatch(/a shape given as sections is kept/);
    expect(steered.content).toContain('Physicality');
    const [, other] = buildFieldMessages({ concept: 'A ferry captain', structure: st }, { voice: 'Short.' }, 'voice');
    expect(other.content).not.toContain('separate paragraphs');
  });
});

describe('connected people (2026-10-06)', () => {
  const ashby = {
    name: 'Lord Ashby',
    roleInstruction: '',
    studio: { sheet: {
      name: 'Lord Ashby', tagline: 'Owns the valley and knows it', description: 'Ashby holds Harrow Court, a grey stone house above the river, and three farms. He walks the estate every morning.',
      appearance: 'Overview: a tall man gone soft at the middle.\n\nFace: a red face, pale eyes.', backstory: 'Born at Harrow Court in 1962.', secrets: 'He sold the north wood to pay a debt.',
      relationships: 'Clara Ashby: his wife, in London most of the year.',
    } },
  };

  it('digests a card as its own sheet has it, shortened, never its secrets', () => {
    const d = connectionDigest(ashby);
    expect(d.name).toBe('Lord Ashby');
    expect(d.lines.join('\n')).toContain('Tagline: Owns the valley and knows it');
    expect(d.lines.join('\n')).toContain('Overview: Ashby holds Harrow Court, a grey stone house above the river');
    expect(d.lines.join('\n')).toContain('Appearance: Overview: a tall man gone soft');
    expect(d.lines.join('\n')).toContain('Background: Born at Harrow Court in 1962.');
    expect(d.lines.join('\n')).toContain('Their relationships: Clara Ashby');
    expect(d.lines.join('\n')).not.toContain('north wood');
    const long = connectionDigest({ name: 'X', studio: { sheet: { name: 'X', description: 'word '.repeat(300) } } });
    expect(long.lines[0].split(' ').length).toBeLessThan(170);
    expect(long.lines[0].endsWith('...')).toBe(true);
  });

  it('writes the block for the prompt: the card as fact, the line from the new character\'s side; nothing for none', () => {
    const block = connectionsBlock([{ name: 'Lord Ashby', how: 'works for Lord Ashby at Harrow Court as his gamekeeper', data: ashby }], 'Tom Hale');
    expect(block[0]).toMatch(/^CONNECTED PEOPLE/);
    expect(block[0]).toMatch(/must not be contradicted or renamed/);
    expect(block).toContain('### Lord Ashby');
    expect(block).toContain("Tom Hale to them, from Tom Hale's side: works for Lord Ashby at Harrow Court as his gamekeeper");
    expect(block.some((l) => l.startsWith('Overview: Ashby holds Harrow Court'))).toBe(true);
    expect(connectionsBlock([], 'Tom')).toEqual([]);
    // A card that is gone is still named.
    expect(connectionsBlock([{ name: 'Gone Person', how: 'her brother', data: null }], 'Tom')).toContain('### Gone Person');
  });

  it('the whole sheet and a field rewrite carry the connections and the relationships requirement', () => {
    const conns = [{ name: 'Lord Ashby', how: 'works for Lord Ashby at Harrow Court as his gamekeeper', data: ashby }];
    const [, user] = buildSheetMessages({ concept: 'A gamekeeper', name: 'Tom Hale', connections: conns });
    expect(user.content).toContain('CONNECTED PEOPLE');
    expect(user.content).toContain('Harrow Court');
    expect(user.content).toMatch(/"relationships" field includes one line for each connected person \("Lord Ashby"\)/);
    expect(user.content).toMatch(/place the character in the connected people's world/);
    const [, plain] = buildSheetMessages({ concept: 'A gamekeeper' });
    expect(plain.content).not.toContain('CONNECTED PEOPLE');
    const [, rel] = buildFieldMessages({ concept: 'A gamekeeper', connections: conns }, { name: 'Tom Hale', relationships: 'Nobody.' }, 'relationships');
    expect(rel.content).toContain('### Lord Ashby');
    expect(rel.content).toMatch(/includes one line for each connected person/);
    const [, voice] = buildFieldMessages({ concept: 'A gamekeeper', connections: conns }, { name: 'Tom Hale', voice: 'Short.' }, 'voice');
    expect(voice.content).toContain('### Lord Ashby');
    expect(voice.content).not.toMatch(/includes one line for each connected person/);
  });

  it('the back-link: one line onto the other card, never twice for the same name', () => {
    expect(backLinkLine('Tom Hale', 'works for Lord Ashby at Harrow Court as his gamekeeper.')).toBe('Tom Hale: works for Lord Ashby at Harrow Court as his gamekeeper.');
    expect(backLinkLine('Tom Hale', '')).toBe('Tom Hale: connected to them.');
    expect(backLinkLine('', 'x')).toBe('');
    const sheet = { relationships: 'Clara Ashby: his wife, in London most of the year.' };
    const once = withRelationshipLine(sheet, backLinkLine('Tom Hale', 'his gamekeeper'));
    expect(once.relationships).toBe('Clara Ashby: his wife, in London most of the year.\nTom Hale: his gamekeeper.');
    expect(withRelationshipLine(once, backLinkLine('tom hale', 'his gamekeeper, again'))).toBe(once);
    expect(withRelationshipLine({ relationships: '' }, 'Tom Hale: his gamekeeper.').relationships).toBe('Tom Hale: his gamekeeper.');
  });
});

describe('a structured field, checked (2026-10-06)', () => {
  const entry = parseSheetStructure(DEFAULT_SHEET_STRUCTURE).appearance;
  it('knows which sections a text has, by label at a paragraph or line start, bold or dashed', () => {
    expect(sectionsPresent('Overview: tall.\n\n**Face**: red.\nClothes - tweed.\n\nphysicality: stoops', entry)).toEqual({ present: ['Overview', 'Face', 'Clothes', 'Physicality'], missing: ['Height and build'] });
    expect(sectionsPresent('', entry).missing).toHaveLength(5);
    expect(sectionsPresent('A tall man in tweed who stoops.', entry).present).toEqual([]);
    const plain = { labels: false, sections: [{ name: 'A', hint: '' }, { name: 'B', hint: '' }, { name: 'C', hint: '' }] };
    expect(sectionsPresent('one.\n\ntwo.', plain)).toEqual({ present: ['A', 'B'], missing: ['C'] });
  });
  it('asks for exactly what is missing, with its hints, and nothing else changed', () => {
    const d = completionDirection(entry, ['Height and build', 'Physicality']);
    expect(d).toMatch(/^Keep every paragraph that is already there, word for word, and ADD the missing sections: Height and build \(height, weight/);
    expect(d).toContain('Physicality (how they move');
    expect(d).not.toContain('Face (');
    expect(d).toMatch(/all 5 sections, in this order: Overview, Height and build, Face, Clothes, Physicality/);
    expect(d).toContain('starting with its label and a colon');
  });
  it('puts the rule in the system message and a skeleton in the requirement', () => {
    const st = parseSheetStructure(DEFAULT_SHEET_STRUCTURE);
    expect(structureSystemLine(st)).toMatch(/"appearance" \(5 sections: Overview, Height and build, Face, Clothes, Physicality\)/);
    expect(structureSystemLine(st)).toContain('fewer paragraphs than its sections is incomplete and wrong');
    expect(structureSystemLine({})).toBe('');
    const [system, user] = buildSheetMessages({ concept: 'x', structure: st });
    expect(system.content).toContain('Some fields have a required structure');
    expect(user.content).toContain('Written like: "Overview: ...\\n\\nHeight and build: ...\\n\\nFace: ...\\n\\nClothes: ...\\n\\nPhysicality: ..."');
    expect(buildSheetMessages({ concept: 'x' })[0].content).not.toContain('required structure');
  });
});
