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
  });
  it('rewrites one field with the sheet in view and the field\'s own requirement', () => {
    const [system, user] = buildFieldMessages({ concept: 'A guard' }, { name: 'X', backstory: 'old' }, 'backstory');
    expect(system.content).toContain('"backstory"');
    expect(user.content).toContain('"backstory": "old"');
    expect(user.content).toContain('turning point');
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
