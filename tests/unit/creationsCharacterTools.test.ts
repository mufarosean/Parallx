// creationsCharacterTools.test.ts — Creations AI: the chat's character tools.
//
// The owner asked (2026-10-08) for the chat's AI to make characters, one or
// several, from whatever is in the conversation, and wanted it perfect. Two
// halves: the pure core (character-tool-core.js: reading what a model sends,
// the checks, connections, the file, the brief) and the tools as the chat
// calls them, through the real ChatBridge, LanguageModelToolsService, tool
// policy and link resolver, against an in-memory workspace.

import { describe, it, expect, beforeEach, vi } from 'vitest';
import * as core from '../../ext/creations-ai/character-tool-core.js';
import { parseSheetStructure, DEFAULT_SHEET_STRUCTURE, sheetFromCharacter, characterFromSheet, keepSheetInStep } from '../../ext/creations-ai/studio-core.js';
import { __testables } from '../../ext/creations-ai/main.js';
import { ChatBridge } from '../../src/api/bridges/chatBridge';
import { ChatAgentService } from '../../src/services/chatAgentService';
import { LanguageModelToolsService } from '../../src/services/languageModelToolsService';
import { LinkResolverService } from '../../src/links/linkResolverService';
import { applyOpenclawToolPolicy } from '../../src/openclaw/openclawToolPolicy';
import type { IDisposable } from '../../src/platform/lifecycle';

const {
  readIncomingCharacter, checkSheet, planBatch, characterFileFor, backLinkedCard, buildCharacterBrief,
  saveResultText, characterLink, fileFromCharacterLink, dialogueExchanges, fieldText, MAX_CHARACTERS_PER_CALL,
  incomingList, mergeDraft, asDraft, searchCharacters, findResultText, findTerms, FIND_FULL_MAX,
  resolveCharacterTarget, mergeSections, mergeDrives, planEdit, applyEdit, undoLastChatEdit, pendingChatEdit,
  editResultText, undoResultText, CHAT_EDITS_KEPT, fitBrief, fitFindResult,
} = core as any;
const { registerChatCharacterTools, clearCharacterDrafts, studioPagesForTests } = __testables as any;

const STRUCTURE = parseSheetStructure(DEFAULT_SHEET_STRUCTURE);

/** A sheet that passes every check under the shipped structure. */
function goodSheet(name: string, o: Record<string, any> = {}) {
  return {
    name,
    tagline: 'Keeps the light and the gossip',
    description: `${name} keeps the last manned light on Skerry Rock and runs the island shop in the mornings.`,
    appearance: [
      'Overview: A square woman in her fifties who looks built for wind.',
      'Height and build: Five foot six, heavy in the shoulders, about twelve stone.',
      'Face: Wind-reddened cheeks, grey eyes, a nose broken once and set crooked.',
      'Clothes: A navy fisherman\'s jumper darned at both elbows, oilskin trousers.',
      'Physicality: Sits with both feet planted and leans in to listen; her hands are never still.',
    ].join('\n\n'),
    personality: 'Warm, nosy and quick to laugh; she wants company and drives it off by talking too much.',
    voice: 'Talks fast, in long run-on sentences.\nAsks questions she answers herself.\nGoes quiet only when the weather turns.\nMight say: \'Sit, the kettle is on.\'\nNever says: \'I am fine\' or \'whatever\'.',
    backstory: 'Born on the mainland in 1971, she came to the Rock at twenty to marry the keeper and stayed when he left.',
    drives: 'Wants: someone to stay the winter.\nFears: the light being automated.\nIn the way: her own mouth.',
    secrets: 'She posts letters to her husband that she never sends.',
    relationships: 'Dana Holm: her daughter, in Bergen, calls on Sundays.\nOld Tom: the boatman, the only one who listens.',
    exampleDialogue: '[USER]: Is the boat late?\n[AI]: Late is a word for people who expect things, love, sit down.\n[USER]: Who were the letters for?\n[AI]: The post goes Tuesday. Tea?\n[USER]: Nice weather.\n[AI]: Wait an hour.',
    reminder: `${name} never lets anyone leave without feeding them.`,
    ...o,
  };
}

describe('reading what a model sends', () => {
  it('takes other key names, arrays, objects and dialogue turns into the twelve fields', () => {
    const r = readIncomingCharacter({
      Name: '  Marit   Holm ', overview: 'She keeps a light.', example_dialogue: [
        { speaker: 'user', line: 'Hi' }, { speaker: 'Marit', line: 'Sit.' },
      ],
      voice: ['Fast.', 'Run-on.', 'Asks and answers.'],
      drives: { wants: 'company', fears: 'automation', inTheWay: 'her mouth' },
      relationships: [{ name: 'Dana Holm', note: 'her daughter' }, { name: 'Old Tom', relationship: 'the boatman' }],
      appearance: { Overview: 'Square.', Face: 'Red.' },
      'favourite colour': 'blue',
    });
    expect(r.sheet.name).toBe('Marit Holm');
    expect(r.sheet.description).toBe('She keeps a light.');
    expect(r.sheet.exampleDialogue).toBe('[USER]: Hi\n[AI]: Sit.');
    expect(r.sheet.voice).toBe('Fast.\nRun-on.\nAsks and answers.');
    expect(r.sheet.drives).toBe('Wants: company\nFears: automation\nIn the way: her mouth');
    expect(r.sheet.relationships).toBe('Dana Holm: her daughter\nOld Tom: the boatman');
    expect(r.sheet.appearance).toBe('Overview: Square.\n\nFace: Red.');
    expect(r.unknownKeys).toEqual(['favourite colour']);
  });

  it('strips dashes, reads a nested sheet, and takes connections as objects or "Name: how" strings', () => {
    const r = readIncomingCharacter({ sheet: { name: 'Tom Hale', description: 'A keeper — of game.' }, connections: ['Lord Ashby: his gamekeeper', { name: 'Dana', how: 'her cousin', addToTheirCard: true }], allowSameName: true, concept: 'A gamekeeper – grim' });
    expect(r.sheet.description).toBe('A keeper, of game.');
    expect(r.connections).toEqual([{ name: 'Lord Ashby', how: 'his gamekeeper', addToTheirCard: false }, { name: 'Dana', how: 'her cousin', addToTheirCard: true }]);
    expect(r.allowSameName).toBe(true);
    expect(r.concept).toBe('A gamekeeper, grim');
    expect(fieldText('voice', null)).toBe('');
  });
});

describe('what a call can look like', () => {
  it('takes an array, a JSON string of one, a bare character, and items that are JSON strings', () => {
    expect(incomingList({ characters: [{ name: 'A' }] })).toEqual([{ name: 'A' }]);
    expect(incomingList({ characters: JSON.stringify([{ name: 'A' }, { name: 'B' }]) })).toEqual([{ name: 'A' }, { name: 'B' }]);
    expect(incomingList({ characters: { name: 'A' } })).toEqual([{ name: 'A' }]);
    expect(incomingList({ name: 'A', appearance: 'x' })).toEqual([{ name: 'A', appearance: 'x' }]);
    expect(incomingList({ characters: [JSON.stringify({ name: 'C' }), 'not json', 3, null] })).toEqual([{ name: 'C' }]);
    expect(incomingList({})).toBeNull();
    expect(incomingList({ characters: 'nope' })).toBeNull();
  });
  it('reads line breaks a model escaped twice', () => {
    expect(fieldText('voice', 'Fast.\\nSlow.')).toBe('Fast.\nSlow.');
    expect(fieldText('voice', 'Real\nbreak and a \\n literal')).toBe('Real\nbreak and a \\n literal');
  });
  it('a resend carries only what changes; a whole sheet takes nothing from the draft', () => {
    const draft = asDraft({ ...goodSheet('Nell Hale', { appearance: 'Overview: Thin.' }), connections: [{ name: 'Tom Hale', how: 'his sister' }] });
    const fix = mergeDraft(draft, { name: 'Nell Hale', appearance: goodSheet('Nell Hale').appearance });
    expect(fix.raw.appearance).toBe(goodSheet('Nell Hale').appearance);
    expect(fix.raw.voice).toBe(readIncomingCharacter(goodSheet('Nell Hale')).sheet.voice);
    expect(fix.raw.connections).toEqual([{ name: 'Tom Hale', how: 'his sister', addToTheirCard: false }]);
    expect(fix.fromDraft).toEqual(['tagline', 'description', 'personality', 'voice', 'backstory', 'drives', 'secrets', 'relationships', 'exampleDialogue', 'reminder']);
    const whole = goodSheet('Nell Hale', { tagline: 'New' });
    expect(mergeDraft(draft, whole)).toEqual({ raw: whole, fromDraft: [] });
    expect(mergeDraft(null, { name: 'X' })).toEqual({ raw: { name: 'X' }, fromDraft: [] });
  });
});

describe('the checks', () => {
  it('a complete sheet passes', () => {
    const r = readIncomingCharacter(goodSheet('Marit Holm'));
    expect(checkSheet(r.sheet, { structure: STRUCTURE })).toEqual({ problems: [], notes: [] });
  });

  it('says exactly what is missing or wrong, field by field', () => {
    const bad = readIncomingCharacter(goodSheet('Unnamed', {
      secrets: '',
      appearance: 'Overview: Square.\n\nFace: Red.',
      exampleDialogue: '[USER]: Hi\n[AI]: Sit.',
      voice: 'Talks fast.',
      drives: 'Wants: company.',
      relationships: 'Her daughter lives in Bergen.',
    })).sheet;
    const { problems } = checkSheet(bad, { structure: STRUCTURE });
    const all = problems.join('\n');
    expect(all).toMatch(/name "Unnamed" is a placeholder/);
    expect(all).toMatch(/secrets \(Secrets\) is missing\. Required: "secrets": one or two sentences/);
    expect(all).toMatch(/appearance is missing the sections Height and build, Clothes, Physicality: write all 5 sections, each its own paragraph starting with its label and a colon, in this order: Overview, Height and build, Face, Clothes, Physicality\. Keep the sections already written\./);
    expect(all).toMatch(/exampleDialogue has 1 exchange: it needs three/);
    expect(all).toMatch(/voice is 1 line: write 3 to 5/);
    expect(all).toMatch(/drives is missing the lines "Fears: \.\.\.", "In the way: \.\.\."/);
    expect(all).toMatch(/relationships names 0 people/);
    // Without a structure, a one-paragraph appearance is fine.
    expect(checkSheet(readIncomingCharacter(goodSheet('Marit Holm', { appearance: 'Square and red.' })).sheet, { structure: {} }).problems).toEqual([]);
  });

  it('counts dialogue exchanges as a [USER] line answered by an [AI] line', () => {
    expect(dialogueExchanges('[USER]: a\n[AI]: b\n[AI]: c\n[USER]: d\n[AI]: e')).toBe(2);
    expect(dialogueExchanges('[AI]: hello\n[USER]: hi')).toBe(0);
  });

  it('notes what does not stop a save', () => {
    const { problems, notes } = checkSheet(readIncomingCharacter(goodSheet('Marit Holm', { tagline: 'Marit keeps the light and the gossip and the post and the weather and the boats too' })).sheet, { structure: STRUCTURE });
    expect(problems).toEqual([]);
    expect(notes.join(' ')).toMatch(/tagline is 17 words/);
    expect(notes.join(' ')).toMatch(/tagline uses the name/);
  });
});

describe('a call\'s characters together', () => {
  const roster = [
    { fileName: 'character-ashby.json', frontmatter: { name: 'Lord Ashby' }, rawData: { name: 'Lord Ashby', studio: { sheet: { name: 'Lord Ashby', tagline: 'Owns the valley', description: 'Ashby holds Harrow Court.', relationships: 'Clara Ashby: his wife.' } } } },
    { fileName: 'character-marit.json', frontmatter: { name: 'Marit Holm' }, rawData: { name: 'Marit Holm' } },
  ];

  it('refuses a roster name unless asked, and a name twice in one call', () => {
    const plans = planBatch([goodSheet('Marit Holm'), goodSheet('Ines Brask'), goodSheet('ines brask')], roster, { structure: STRUCTURE });
    expect(plans[0].problems.join(' ')).toMatch(/already a character in the roster \(character-marit\.json\)/);
    expect(plans[1].problems).toEqual([]);
    expect(plans[2].problems.join(' ')).toMatch(/used twice in this call \(character 2 has it too\)/);
    expect(planBatch([{ ...goodSheet('Marit Holm'), allowSameName: true }], roster, { structure: STRUCTURE })[0].problems).toEqual([]);
  });

  it('connects to the roster and to the same call by name; Relationships must name each', () => {
    const tom = goodSheet('Tom Hale', { relationships: 'Lord Ashby: his employer.\nNell Hale: his sister.', connections: [{ name: 'lord ashby', how: 'his gamekeeper' }, { name: 'Nell Hale', how: 'her brother' }] });
    const nell = goodSheet('Nell Hale', { relationships: 'Tom Hale: her brother.\nOld Tom: the boatman.', connections: [{ name: 'Tom Hale', how: 'his sister' }] });
    const plans = planBatch([tom, nell], roster, { structure: STRUCTURE });
    expect(plans.map((p: any) => p.problems)).toEqual([[], []]);
    expect(plans[0].connections).toEqual([
      { name: 'Lord Ashby', how: 'his gamekeeper', addToTheirCard: false, fileName: 'character-ashby.json' },
      { name: 'Nell Hale', how: 'her brother', addToTheirCard: false, batchIndex: 1 },
    ]);
    // Not named in Relationships: refused, with the line to add.
    const unnamed = planBatch([goodSheet('Tom Hale', { connections: [{ name: 'Lord Ashby', how: 'x' }] })], roster, { structure: STRUCTURE });
    expect(unnamed[0].problems.join(' ')).toMatch(/relationships must have a line for each connected person, by exact name: add "Lord Ashby: \.\.\."/);
  });

  it('an unknown connection names who is there; one connected to a character that fails fails too', () => {
    const plans = planBatch([
      goodSheet('Tom Hale', { relationships: 'Nell Hale: sister.\nThe Duke: his master.', connections: [{ name: 'Nell Hale', how: 'brother' }, { name: 'The Duke', how: 'his man' }] }),
    ], roster, { structure: STRUCTURE });
    expect(plans[0].problems.join(' ')).toMatch(/"Nell Hale", who is not in the roster or in this call\. The roster has: Lord Ashby, Marit Holm\./);
    const cascade = planBatch([
      goodSheet('Tom Hale', { relationships: 'Nell Hale: sister.\nOld Tom: boatman.', connections: [{ name: 'Nell Hale', how: 'brother' }] }),
      goodSheet('Nell Hale', { secrets: '' }),
    ], roster, { structure: STRUCTURE });
    expect(cascade[1].problems.join(' ')).toMatch(/secrets \(Secrets\) is missing/);
    expect(cascade[0].problems).toEqual(['it is connected to Nell Hale, who could not be saved: send both again together once Nell Hale is fixed.']);
  });
});

describe('the file and the back-link', () => {
  it('is the Studio\'s own shape: it opens back as the same sheet, with its connections and where it was made', () => {
    const r = readIncomingCharacter(goodSheet('Marit Holm'));
    const data = characterFileFor(r.sheet, { base: { id: 'char-1', initialMessages: '' }, concept: 'A keeper', connections: [{ name: 'Lord Ashby', how: 'x', fileName: 'character-ashby.json', batchIndex: 3 }] });
    expect(sheetFromCharacter(data)).toEqual(r.sheet);
    expect(data.name).toBe('Marit Holm');
    expect(data.roleInstruction).toContain('## Appearance\nOverview: A square woman');
    expect(data.voiceAnchor).toBe(r.sheet.voice);
    expect(data.studio).toMatchObject({ mode: 'concept', concept: 'A keeper', madeIn: 'chat', connections: [{ fileName: 'character-ashby.json', name: 'Lord Ashby', how: 'x' }] });
    expect(data.id).toBe('char-1');
  });

  it('adds one line to the other card, and nothing when it already names them', () => {
    const ashby = { name: 'Lord Ashby', studio: { sheet: { name: 'Lord Ashby', relationships: 'Clara Ashby: his wife.' } } };
    const next = backLinkedCard(ashby, 'Tom Hale', 'his gamekeeper.');
    expect(next.studio.sheet.relationships).toBe('Clara Ashby: his wife.\nTom Hale: his gamekeeper.');
    expect(next.roleInstruction).toContain('Tom Hale: his gamekeeper.');
    expect(backLinkedCard(next, 'tom hale', 'again')).toBeNull();
  });

  it('links name a character file and nothing else', () => {
    expect(characterLink('character-1a2b3c4d.json')).toBe('parallx://creations/character?file=character-1a2b3c4d.json');
    expect(fileFromCharacterLink({ params: { file: 'character-1a2b3c4d.json' } })).toBe('character-1a2b3c4d.json');
    for (const f of ['../settings.json', 'a/b.json', 'x.md', '', 'character-x.json/..']) expect(fileFromCharacterLink({ params: { file: f } })).toBe('');
  });
});

describe('the brief', () => {
  it('carries the user\'s structure, the rules, the roster, and the shape to send', () => {
    const roster = [{ fileName: 'character-ashby.json', frontmatter: { name: 'Lord Ashby' }, rawData: { name: 'Lord Ashby', studio: { sheet: { name: 'Lord Ashby', tagline: 'Owns the valley', description: 'Ashby holds Harrow Court, a grey house above the river.' } } } }];
    const b = buildCharacterBrief({ structure: STRUCTURE, roster, connectTo: ['lord ashby', 'Nobody'] });
    expect(b).toMatch(/"appearance" \(5 sections: Overview, Height and build, Face, Clothes, Physicality\)/);
    expect(b).toMatch(/"appearance": written as 5 separate paragraphs/);
    expect(b).toContain('"name": their name. The name the user gave, exactly, when they gave one.');
    expect(b).not.toContain('NAME given above');
    expect(b).toMatch(/Photos: when photos of the person are attached, write the appearance from what you see/);
    expect(b).toMatch(/Several characters: send them all in one save call \(up to 8\)/);
    expect(b).toContain('Craft rules:');
    expect(b).toContain('Write all twelve fields for every character.');
    expect(b).toContain('- Lord Ashby: Owns the valley');
    expect(b).toContain('CONNECTED PEOPLE');
    expect(b).toContain('Ashby holds Harrow Court, a grey house above the river.');
    expect(b).toContain('Send to creations_save_characters:');
    expect(buildCharacterBrief({ structure: {}, roster: [] })).toContain('- (empty)');
    expect(buildCharacterBrief({ structure: {}, roster: [] })).toMatch(/"appearance": one vivid paragraph/);
    // The shape to send comes before the roster: a result cut short loses the roster's tail, not the shape.
    expect(b.indexOf('Send to creations_save_characters:')).toBeLessThan(b.indexOf('Roster ('));
    expect(b).toContain('To fix a character, send its name and only the fields that change');
  });
});

describe('finding characters', () => {
  const entry = (fileName: string, sheet: Record<string, string>, extra: Record<string, any> = {}) => ({ fileName, frontmatter: { name: sheet.name }, rawData: { name: sheet.name, updatedAt: extra.updatedAt || 0, studio: { sheet, ...(extra.studio || {}) }, ...(extra.data || {}) } });
  const roster = [
    entry('character-tom.json', { name: 'Tom Hale', tagline: 'Keeps the estate\'s game', description: 'Tom keeps the game at Harrow Court.', secrets: 'He knows where the north wood money went.', appearance: 'Tall, in a waxed jacket.' }, { updatedAt: 3, studio: { connections: [{ name: 'Lord Ashby', how: 'his gamekeeper', fileName: 'character-ashby.json' }] } }),
    entry('character-nell.json', { name: 'Nell Hale', tagline: 'Runs the Hare and Hounds', description: 'Nell runs the pub below Harrow Court.' }, { updatedAt: 5 }),
    entry('character-ines.json', { name: 'Ines Brask', tagline: 'The new vet', description: 'Ines treats the valley\'s dogs.' }, { updatedAt: 1, data: { lorebookFiles: ['valley.md'] } }),
  ];
  it('matches every word somewhere, in any order; a quoted phrase whole; the name weighs most', () => {
    expect(findTerms('north "harrow court" -')).toEqual(['north', 'harrow court']);
    expect(searchCharacters(roster, { query: 'harrow court' }).map((h: any) => h.name)).toEqual(['Nell Hale', 'Tom Hale']);
    expect(searchCharacters(roster, { query: '"court harrow"' })).toEqual([]);
    expect(searchCharacters(roster, { query: 'north wood' }).map((h: any) => h.name)).toEqual(['Tom Hale']);
    expect(searchCharacters(roster, { query: 'hale' }).map((h: any) => h.name)).toEqual(['Nell Hale', 'Tom Hale']);
    expect(searchCharacters(roster, { query: 'tom harrow' })[0].matched).toEqual(expect.arrayContaining(['name', 'description']));
    // Nothing asked: the whole roster, newest first. Names: exact, any case.
    expect(searchCharacters(roster, {}).map((h: any) => h.name)).toEqual(['Nell Hale', 'Tom Hale', 'Ines Brask']);
    expect(searchCharacters(roster, { names: ['tom hale', 'Nobody'] }).map((h: any) => h.name)).toEqual(['Tom Hale']);
  });
  it('a list has each one\'s link, who they are, connections and chats; names give whole sheets', () => {
    const chatsOf = (f: string) => (f === 'character-tom.json' ? 3 : 0);
    const list = findResultText(searchCharacters(roster, { query: 'harrow' }), { query: 'harrow', chatsOf, total: 3 });
    expect(list).toContain('2 characters matching "harrow", of 3 in the roster.');
    expect(list).toContain('- Tom Hale: parallx://creations/character?file=character-tom.json | Keeps the estate\'s game (connected to Lord Ashby; 3 chats)');
    expect(list).toContain('- Nell Hale: parallx://creations/character?file=character-nell.json | Runs the Hare and Hounds (0 chats)');
    expect(list).toContain('For whole sheets, call again with "names"');
    const full = findResultText(searchCharacters(roster, { names: ['Tom Hale'] }), { names: ['Tom Hale'], chatsOf, total: 3 });
    expect(full).toContain('## Tom Hale\nLink: parallx://creations/character?file=character-tom.json');
    expect(full).toContain('Secrets:\nHe knows where the north wood money went.');
    expect(full).toContain('Appearance:\nTall, in a waxed jacket.');
    expect(full).toContain('Connected to:\n- Lord Ashby: his gamekeeper');
    expect(full).toContain('Chats: 3.');
    expect(full).not.toContain('For whole sheets');
    const ines = findResultText(searchCharacters(roster, { names: ['Ines Brask'] }), { names: ['Ines Brask'], total: 3 });
    expect(ines).toContain('Lorebooks: valley.md');
    expect(findResultText([], { query: 'dragon', total: 3 })).toBe('No character matching "dragon".\nThe roster has 3 characters; try fewer or other words.');
    expect(findResultText(searchCharacters(roster, { query: '"harrow court"' }), { query: '"harrow court"', total: 3 })).toMatch(/^2 characters matching "harrow court", of 3/);
    expect(findResultText([], { names: ['Bob'], total: 3 })).toMatch(/^No character named Bob\.\nNames are matched exactly/);
    expect(findResultText([], { total: 0 })).toBe('No character in the roster yet.');
  });
  it('whole sheets stop at the limit; the rest are list lines', () => {
    const many = Array.from({ length: FIND_FULL_MAX + 2 }, (_, i) => entry(`character-${i}.json`, { name: `P${i} Holm`, tagline: 'x' }));
    const t = findResultText(searchCharacters(many, {}), { full: true, total: many.length });
    expect((t.match(/^## /gm) || []).length).toBe(FIND_FULL_MAX);
    expect(t).toContain('Also:');
    expect((t.match(/^- P\d Holm: /gm) || []).length).toBe(2);
  });
});

describe('the result', () => {
  it('lists links for what was saved and the fixes for the rest', () => {
    const t = saveResultText({
      saved: [{ name: 'Tom Hale', link: characterLink('character-a.json'), connectedTo: ['Lord Ashby'], backLinked: ['Lord Ashby'], notes: ['tagline is 16 words (ten is the aim).'] }],
      failed: [{ index: 1, name: 'Nell Hale', problems: ['secrets (Secrets) is missing.'] }, { index: 2, name: '', problems: ['name is empty: give the character a name.'] }],
      extra: 2, total: 5,
    });
    expect(t).toContain('Saved 1 of 5 characters.');
    expect(t).toContain('- Tom Hale: parallx://creations/character?file=character-a.json (connected to Lord Ashby; a line added to Lord Ashby\'s card)');
    expect(t).toContain('  note: tagline is 16 words (ten is the aim).');
    expect(t).toContain('Not saved. Fix these and call creations_save_characters again with only them');
    expect(t).toContain('- Nell Hale:\n  - secrets (Secrets) is missing.');
    expect(t).toContain('- Character 3 (no name):');
    expect(t).toContain(`2 more characters were sent than one call takes (${MAX_CHARACTERS_PER_CALL})`);
    expect(t).toContain('Give the user each saved character with its link exactly as written above');
  });
});

// ── The tools as the chat calls them ─────────────────────────────────────────

const WS = 'file:///ws';
const CHARS = `${WS}/.parallx/extensions/text-generator/characters`;
const SETTINGS = `${WS}/.parallx/extensions/text-generator/settings.json`;

function memoryFs() {
  const files = new Map<string, string>();
  const dirs = new Set<string>([WS]);
  return {
    files,
    async readFile(uri: string) { if (!files.has(uri)) throw new Error(`ENOENT ${uri}`); return { content: files.get(uri)! }; },
    async writeFile(uri: string, content: string) { const dir = uri.slice(0, uri.lastIndexOf('/')); if (!dirs.has(dir)) throw new Error(`no dir ${dir}`); files.set(uri, content); },
    async exists(uri: string) { return files.has(uri) || dirs.has(uri); },
    async mkdir(uri: string) { dirs.add(uri); },
    async readdir(uri: string) {
      if (!dirs.has(uri)) throw new Error(`ENOENT ${uri}`);
      const child = (k: string) => k.startsWith(uri + '/') && !k.slice(uri.length + 1).includes('/');
      return [
        ...[...dirs].filter(child).map((k) => ({ name: k.slice(uri.length + 1), type: 2 })),
        ...[...files.keys()].filter(child).map((k) => ({ name: k.slice(uri.length + 1), type: 1 })),
      ];
    },
    saved(): Map<string, any> {
      const out = new Map<string, any>();
      for (const [k, v] of files) if (k.startsWith(CHARS + '/') && k.endsWith('.json')) out.set(k.slice(CHARS.length + 1), JSON.parse(v));
      return out;
    },
  };
}

const token = (turnId = 't1') => ({ isCancellationRequested: false, onCancellationRequested: () => ({ dispose() {} }), turnId }) as any;

function world({ workspace = true } = {}) {
  const fs = memoryFs();
  const tools = new LanguageModelToolsService();
  const subscriptions: IDisposable[] = [];
  const bridge = new ChatBridge('parallx.creations-ai', new ChatAgentService(), tools, subscriptions);
  const links = new LinkResolverService();
  const openEditor = vi.fn(async () => {});
  const parallx = {
    chat: { registerTool: (name: string, tool: any) => bridge.registerTool(name, tool) },
    links: { register: (c: any) => links.register({ ...c, extensionId: 'parallx.creations-ai' }) },
    editors: { openEditor },
    workspace: workspace ? { fs, workspaceFolders: [{ uri: WS }] } : { fs: null, workspaceFolders: [] },
  };
  const context = { subscriptions: [] as IDisposable[] };
  registerChatCharacterTools(parallx, context);
  const call = async (name: string, args: Record<string, unknown>) => tools.invokeTool(name, args, token());
  const seed = async (fileName: string, data: any) => { await fs.mkdir(`${WS}/.parallx`); await fs.mkdir(`${WS}/.parallx/extensions`); await fs.mkdir(`${WS}/.parallx/extensions/text-generator`); await fs.mkdir(CHARS); fs.files.set(`${CHARS}/${fileName}`, JSON.stringify(data)); };
  return { fs, tools, links, openEditor, context, call, seed };
}

describe('the tools, through the chat', () => {
  let w: ReturnType<typeof world>;
  beforeEach(() => { clearCharacterDrafts(); w = world(); });

  it('are registered under their names, visible to every profile a turn can use, and go when Creations does', () => {
    const defs = w.tools.getToolDefinitions().map((d) => d.name).sort();
    expect(defs).toEqual(['creations_character_brief', 'creations_edit_character', 'creations_find_characters', 'creations_save_characters']);
    const all = w.tools.getToolDefinitions();
    expect(applyOpenclawToolPolicy({ tools: all, mode: 'full' }).map((d) => d.name).sort()).toEqual(defs);
    // A small model runs with `standard`: all stay. Read-only keeps the two that only read.
    // (The edit tool is `standard` too: changing a card is what a small model is asked as often as making one.)
    expect(applyOpenclawToolPolicy({ tools: all, mode: 'standard' }).map((d) => d.name).sort()).toEqual(defs);
    expect(applyOpenclawToolPolicy({ tools: all, mode: 'readonly' }).map((d) => d.name).sort()).toEqual(['creations_character_brief', 'creations_find_characters']);
    expect(w.links.allContracts().some((c) => c.segment === 'creations')).toBe(true);
    for (const d of w.context.subscriptions) d.dispose();
    expect(w.tools.getToolDefinitions()).toEqual([]);
    expect(w.links.allContracts().some((c) => c.segment === 'creations')).toBe(false);
  });

  it('cost little in every chat message: the four go with each request, so their descriptions stay short', () => {
    // The rules live in the brief and in the results, which come only when needed (2026-10-09: about 770 tokens, from 1,550).
    const sizes = w.tools.getToolDefinitions().map((d) => JSON.stringify({ description: d.description, parameters: d.parameters }).length);
    expect(sizes).toHaveLength(4);
    expect(sizes.reduce((a, b) => a + b, 0)).toBeLessThanOrEqual(3300);
  });

  it('the brief reads the user\'s own Sheet structure and roster at the moment of the call', async () => {
    await w.seed('character-ashby.json', { name: 'Lord Ashby', studio: { sheet: { name: 'Lord Ashby', tagline: 'Owns the valley' } } });
    w.fs.files.set(SETTINGS, JSON.stringify({ sheetStructure: 'Personality\n- Temper: quick or slow\n- With people: strangers and friends\n- Under it: the need' }));
    const r = await w.call('creations_character_brief', {});
    expect(r.isError).toBeFalsy();
    expect(r.content).toMatch(/"personality" \(3 sections: Temper, With people, Under it\)/);
    expect(r.content).toMatch(/"appearance": one vivid paragraph/);
    expect(r.content).toContain('- Lord Ashby: Owns the valley');
  });

  it('saves one character, returns a link that checks out and opens the Studio on it', async () => {
    const r = await w.call('creations_save_characters', { characters: [{ ...goodSheet('Marit Holm'), concept: 'A lighthouse keeper who gossips' }] });
    expect(r.isError).toBeFalsy();
    expect(r.content).toMatch(/^Saved 1 of 1 character\.\n- Marit Holm: parallx:\/\/creations\/character\?file=character-[0-9a-f]{8}\.json/);
    const [[file, data]] = [...w.fs.saved()];
    expect(sheetFromCharacter(data).appearance).toBe(goodSheet('Marit Holm').appearance);
    expect(data.studio).toMatchObject({ concept: 'A lighthouse keeper who gossips', madeIn: 'chat' });
    expect(data.initialMessages).toBe('');
    const link = r.content.match(/parallx:\/\/creations\/character\?file=[^\s)]+/)![0];
    expect(link).toBe(core.characterLink(file));
    const check = await w.links.verify(link, { thorough: true });
    expect(check).toMatchObject({ ok: true, uri: link, location: 'Marit Holm' });
    expect(await w.links.resolveMetadata(link)).toEqual({ title: 'Marit Holm', icon: 'user' });
    expect(await w.links.open(link)).toBe(true);
    expect(w.openEditor).toHaveBeenCalledWith({ typeId: 'text-generator-character-editor', title: 'Marit Holm', icon: 'user', instanceId: file });
    const dead = await w.links.verify('parallx://creations/character?file=character-00000000.json', {});
    expect(dead).toMatchObject({ ok: false });
    expect((dead as any).error).toMatch(/No Creations character has the file character-00000000\.json/);
  });

  it('saves several in one call, connected to each other and to the roster, with a line on the existing card when asked', async () => {
    await w.seed('character-ashby.json', { name: 'Lord Ashby', studio: { sheet: { name: 'Lord Ashby', relationships: 'Clara Ashby: his wife.' } } });
    const r = await w.call('creations_save_characters', { characters: [
      goodSheet('Tom Hale', { relationships: 'Lord Ashby: his employer.\nNell Hale: his sister.', connections: [{ name: 'Lord Ashby', how: 'works for him at Harrow Court as his gamekeeper', addToTheirCard: true }, { name: 'Nell Hale', how: 'her brother' }] }),
      goodSheet('Nell Hale', { relationships: 'Tom Hale: her brother.\nLord Ashby: her brother\'s employer.', connections: [{ name: 'Tom Hale', how: 'his sister' }] }),
      goodSheet('Ines Brask'),
    ] });
    expect(r.isError).toBeFalsy();
    expect(r.content).toMatch(/^Saved 3 of 3 characters\./);
    expect(r.content).toMatch(/- Tom Hale: parallx:\/\/creations\/character\?file=character-\w{8}\.json \(connected to Lord Ashby, Nell Hale; a line added to Lord Ashby's card\)/);
    const saved = w.fs.saved();
    expect(saved.size).toBe(4);
    const byName = new Map([...saved].map(([f, d]) => [d.name, { f, d }]));
    const tom = byName.get('Tom Hale')!;
    const nell = byName.get('Nell Hale')!;
    expect(new Set([tom.f, nell.f, byName.get('Ines Brask')!.f]).size).toBe(3);
    expect(tom.d.studio.connections).toEqual([
      { fileName: 'character-ashby.json', name: 'Lord Ashby', how: 'works for him at Harrow Court as his gamekeeper' },
      { fileName: nell.f, name: 'Nell Hale', how: 'her brother' },
    ]);
    expect(nell.d.studio.connections).toEqual([{ fileName: tom.f, name: 'Tom Hale', how: 'his sister' }]);
    expect(byName.get('Lord Ashby')!.d.studio.sheet.relationships).toBe('Clara Ashby: his wife.\nTom Hale: works for him at Harrow Court as his gamekeeper.');
  });

  it('saves the good ones, says what to fix in the rest, and takes the fixed one on the next call', async () => {
    const short = goodSheet('Nell Hale', { appearance: 'Overview: Thin.\n\nFace: Freckled.' });
    const first = await w.call('creations_save_characters', { characters: [goodSheet('Tom Hale'), short] });
    expect(first.isError).toBeFalsy();
    expect(first.content).toMatch(/^Saved 1 of 2 characters\./);
    expect(first.content).toMatch(/- Nell Hale:\n  - appearance is missing the sections Height and build, Clothes, Physicality/);
    expect([...w.fs.saved().values()].map((d) => d.name)).toEqual(['Tom Hale']);
    // The fix is the name and the one field: the rest is kept from the first call, and the result says so.
    const second = await w.call('creations_save_characters', { characters: [{ name: 'Nell Hale', appearance: goodSheet('Nell Hale').appearance }] });
    expect(second.content).toMatch(/^Saved 1 of 1 character\./);
    expect(second.content).toMatch(/note: kept from the earlier call: tagline, description, personality, voice, backstory, drives, secrets, relationships, exampleDialogue, reminder\./);
    const nell = [...w.fs.saved().values()].find((d) => d.name === 'Nell Hale');
    expect(sheetFromCharacter(nell)).toEqual(readIncomingCharacter(goodSheet('Nell Hale')).sheet);
    // Sent once more by mistake: refused, nothing overwritten.
    const third = await w.call('creations_save_characters', { characters: [goodSheet('Tom Hale')] });
    expect(third.isError).toBe(true);
    expect(third.content).toMatch(/name "Tom Hale" is already a character in the roster/);
    expect(w.fs.saved().size).toBe(2);
  });

  it('a character connected to one that was refused is held too, and both go through once the fix arrives with just their names', async () => {
    const first = await w.call('creations_save_characters', { characters: [
      goodSheet('Tom Hale', { relationships: 'Nell Hale: his sister.\nOld Tom: the boatman.', connections: [{ name: 'Nell Hale', how: 'her brother' }] }),
      goodSheet('Nell Hale', { secrets: '' }),
    ] });
    expect(first.isError).toBe(true);
    expect(first.content).toMatch(/^Saved 0 of 2 characters\./);
    const fix = await w.call('creations_save_characters', { characters: [{ name: 'Tom Hale' }, { name: 'Nell Hale', secrets: 'She reads his letters.' }] });
    expect(fix.content).toMatch(/^Saved 2 of 2 characters\./);
    const saved = new Map([...w.fs.saved()].map(([f, d]) => [d.name, { f, d }]));
    expect(saved.get('Tom Hale')!.d.studio.connections).toEqual([{ fileName: saved.get('Nell Hale')!.f, name: 'Nell Hale', how: 'her brother' }]);
  });

  it('accepts the characters as a JSON string, as some local models send them', async () => {
    const r = await w.call('creations_save_characters', { characters: JSON.stringify([goodSheet('Marit Holm')]) });
    expect(r.content).toMatch(/^Saved 1 of 1 character\./);
  });

  it('two calls at once never take the same name twice', async () => {
    const [a, b] = await Promise.all([
      w.call('creations_save_characters', { characters: [goodSheet('Marit Holm')] }),
      w.call('creations_save_characters', { characters: [goodSheet('Marit Holm')] }),
    ]);
    expect([a.isError, b.isError].filter(Boolean)).toHaveLength(1);
    expect(w.fs.saved().size).toBe(1);
  });

  it('takes at most the per-call limit and says how many more to send; a bare character is taken too', async () => {
    const many = Array.from({ length: MAX_CHARACTERS_PER_CALL + 2 }, (_, i) => goodSheet(`Person ${String.fromCharCode(65 + i)} Holm`));
    const r = await w.call('creations_save_characters', { characters: many });
    expect(r.content).toMatch(new RegExp(`^Saved ${MAX_CHARACTERS_PER_CALL} of ${MAX_CHARACTERS_PER_CALL + 2} characters\\.`));
    expect(r.content).toMatch(/2 more characters were sent than one call takes/);
    expect(w.fs.saved().size).toBe(MAX_CHARACTERS_PER_CALL);
    const bare = await w.call('creations_save_characters', goodSheet('Solo Brask'));
    expect(bare.content).toMatch(/^Saved 1 of 1 character\./);
  });

  it('finds what was saved, with chats counted from the threads', async () => {
    await w.call('creations_save_characters', { characters: [goodSheet('Marit Holm'), goodSheet('Tom Hale')] });
    const tomFile = [...w.fs.saved()].find(([, d]) => d.name === 'Tom Hale')![0];
    const threads = `${WS}/.parallx/extensions/text-generator/threads`;
    await w.fs.mkdir(threads); await w.fs.mkdir(`${threads}/t1`);
    w.fs.files.set(`${threads}/t1/thread.json`, JSON.stringify({ id: 't1', title: 'Weir', characters: [{ file: tomFile }], updatedAt: 1 }));
    const list = await w.call('creations_find_characters', { query: 'skerry' });
    expect(list.isError).toBeFalsy();
    expect(list.content).toMatch(/^2 characters matching "skerry", of 2 in the roster\./);
    const full = await w.call('creations_find_characters', { names: ['tom hale'] });
    expect(full.content).toContain(`## Tom Hale\nLink: parallx://creations/character?file=${tomFile}`);
    expect(full.content).toContain('Appearance:\nOverview: A square woman');
    expect(full.content).toMatch(/Chats: 1\./);
    expect((await w.call('creations_find_characters', { names: 'Marit Holm' })).content).toContain('## Marit Holm');
  });

  it('says what to send when nothing was sent, and needs a workspace', async () => {
    const r = await w.call('creations_save_characters', { characters: [] });
    expect(r).toMatchObject({ isError: true });
    expect(r.content).toMatch(/Nothing to save: send \{"characters"/);
    const n = world({ workspace: false });
    expect((await n.call('creations_save_characters', { characters: [goodSheet('X Y')] })).content).toMatch(/Open a workspace first/);
    expect((await n.call('creations_character_brief', {})).content).toMatch(/Open a workspace first/);
    expect((await n.call('creations_find_characters', {})).content).toMatch(/Open a workspace first/);
  });
});

// ── Editing a character ──────────────────────────────────────────────────────

const ROSTER_STRUCTURE = STRUCTURE;
const card = (fileName: string, sheet: any, studio: any = {}) => ({ fileName, rawData: characterFromSheet(readIncomingCharacter(sheet).sheet, { id: fileName }, studio) });

describe('editing a character', () => {
  const marit = () => card('character-marit.json', goodSheet('Marit Holm'), { locks: ['secrets'] });
  const tom = () => card('character-tom.json', goodSheet('Tom Hale'));

  it('finds the card by exact name, link or file, and says how to name it otherwise', () => {
    const roster = [marit(), tom(), card('character-tom2.json', goodSheet('Tom Hale'))];
    expect(resolveCharacterTarget(roster, 'marit holm').entry.fileName).toBe('character-marit.json');
    expect(resolveCharacterTarget(roster, 'parallx://creations/character?file=character-marit.json').entry.fileName).toBe('character-marit.json');
    expect(resolveCharacterTarget(roster, 'character-tom2.json').entry.fileName).toBe('character-tom2.json');
    expect(resolveCharacterTarget(roster, 'Tom Hale').problem).toMatch(/2 characters are named Tom Hale: send the link of the one to change \(parallx:\/\/creations\/character\?file=character-tom\.json, parallx:\/\/creations\/character\?file=character-tom2\.json\)/);
    expect(resolveCharacterTarget(roster, 'Marit').problem).toMatch(/no character is named "Marit"\. Close: Marit Holm\./);
    expect(resolveCharacterTarget(roster, 'character-none.json').problem).toMatch(/no character has the file character-none\.json/);
    expect(resolveCharacterTarget(roster, '').problem).toMatch(/name the character to change/);
  });

  it('puts sections and drives lines sent alone in their place, and the rest stays word for word', () => {
    const entry = STRUCTURE.appearance;
    const was = goodSheet('X').appearance;
    const m = mergeSections(was, 'Face: Lined now, grey eyes gone pale.\n\nClothes: Oilskins, always.', entry);
    expect(m.sections).toEqual(['Face', 'Clothes']);
    const paras = m.text.split('\n\n');
    expect(paras).toHaveLength(5);
    expect(paras[0]).toBe(was.split('\n\n')[0]);
    expect(paras[2]).toBe('Face: Lined now, grey eyes gone pale.');
    expect(paras[3]).toBe('Clothes: Oilskins, always.');
    expect(paras[4]).toBe(was.split('\n\n')[4]);
    // A section the card lacks goes in at its place in the structure.
    expect(mergeSections('Overview: Square.\n\nClothes: Navy.', 'Face: Red.', entry).text).toBe('Overview: Square.\n\nFace: Red.\n\nClothes: Navy.');
    // Every section, or paragraphs without labels: the whole field.
    expect(mergeSections(was, was, entry)).toBeNull();
    expect(mergeSections(was, 'Just older now.', entry)).toBeNull();
    // A card written before the structure: the sections have nowhere to go.
    expect(mergeSections('A square woman, red-faced.', 'Face: Red.', entry).problem).toMatch(/not written in sections yet/);
    expect(mergeDrives('Wants: company.\nFears: automation.\nIn the way: her mouth.', 'Fears: the sea.')).toEqual({ text: 'Wants: company.\nFears: the sea.\nIn the way: her mouth.', lines: ['Fears'] });
    expect(mergeDrives('Wants: company.\nIn the way: her mouth.', 'Fears: the sea.').text).toBe('Wants: company.\nFears: the sea.\nIn the way: her mouth.');
    expect(mergeDrives('Wants: a.', 'Wants: b.\nFears: c.\nIn the way: d.')).toBeNull();
  });

  it('changes only what was sent, refuses locked fields and taken names, and wants a Relationships line for a new connection', () => {
    const m = marit();
    const roster = [m, tom()];
    const ok = planEdit(m, roster, { changes: { appearance: 'Face: Lined, grey.', drives: 'Fears: the sea.' }, structure: ROSTER_STRUCTURE });
    expect(ok.problems).toEqual([]);
    expect(ok.changed).toEqual([
      { key: 'appearance', how: 'the Face section (the rest kept)' },
      { key: 'drives', how: 'the Fears line (the rest kept)' },
    ]);
    const before = sheetFromCharacter(m.rawData);
    for (const k of ['tagline', 'voice', 'backstory', 'exampleDialogue']) expect(ok.sheet[k]).toBe(before[k]);
    const locked = planEdit(m, roster, { changes: { secrets: 'Another secret.' }, structure: ROSTER_STRUCTURE });
    expect(locked.problems.join('\n')).toMatch(/secrets \(Secrets\) is locked in the Studio/);
    const rename = planEdit(m, roster, { changes: { name: 'Tom Hale' }, structure: ROSTER_STRUCTURE });
    expect(rename.problems.join('\n')).toMatch(/name "Tom Hale" is already a character in the roster \(character-tom\.json\)/);
    expect(planEdit(m, roster, { changes: { name: 'Tom Hale' }, allowSameName: true, structure: ROSTER_STRUCTURE }).problems).toEqual([]);
    const conn = planEdit(m, roster, { connect: [{ name: 'Tom Hale', how: 'her oldest friend' }], structure: ROSTER_STRUCTURE });
    expect(conn.problems.join('\n')).toMatch(/relationships must have a line for each connected person, by exact name: send relationships with "Tom Hale: \.\.\." added/);
    const conn2 = planEdit(m, roster, { connect: [{ name: 'Tom Hale', how: 'her oldest friend', addToTheirCard: true }], changes: { relationships: `${before.relationships}\nTom Hale: her oldest friend.` }, structure: ROSTER_STRUCTURE });
    expect(conn2.problems).toEqual([]);
    expect(conn2.connections).toEqual([{ fileName: 'character-tom.json', name: 'Tom Hale', how: 'her oldest friend' }]);
    expect(conn2.backLinks).toEqual([{ fileName: 'character-tom.json', name: 'Tom Hale', how: 'her oldest friend' }]);
    expect(planEdit(m, roster, { disconnect: ['Nobody'], structure: ROSTER_STRUCTURE }).problems.join('\n')).toMatch(/disconnect names "Nobody", who this card is not connected to/);
    expect(planEdit(m, roster, { connect: [{ name: 'Marit Holm' }], structure: ROSTER_STRUCTURE }).problems.join('\n')).toMatch(/the character itself/);
    // What it breaks in what it touched stops it.
    expect(planEdit(m, roster, { changes: { voice: 'Fast.' }, structure: ROSTER_STRUCTURE }).problems.join('\n')).toMatch(/voice is 1 line/);
  });

  it('a gap the card already had in a field the edit leaves alone is noted, not a reason to refuse', () => {
    const old = card('character-old.json', goodSheet('Old Card', { exampleDialogue: '[USER]: Hi\n[AI]: Sit.', secrets: '' }));
    const p = planEdit(old, [old], { changes: { tagline: 'Keeps the light, and the peace' }, structure: ROSTER_STRUCTURE });
    expect(p.problems).toEqual([]);
    expect(p.notes.join('\n')).toMatch(/the card already had gaps this edit does not touch \(offer to fix them if it fits\): secrets \(Secrets\) is missing; exampleDialogue has 1 exchange/);
  });

  it('remembers what it replaced; Undo puts back what still says what the chat wrote, and keeps what was changed since', () => {
    const m = marit();
    const roster = [m, tom()];
    const plan = planEdit(m, roster, { changes: { appearance: 'Face: Lined, grey.', voice: 'Slow now.\nFew words.\nNo questions.' }, structure: ROSTER_STRUCTURE });
    const after = applyEdit(m.rawData, plan, { request: 'make her older', at: 5 });
    expect(after.studio.chatEdits).toHaveLength(1);
    expect(after.studio.chatEdits[0]).toMatchObject({ at: 5, by: 'chat', request: 'make her older' });
    expect(after.studio.chatEdits[0].fields.voice).toEqual({ before: sheetFromCharacter(m.rawData).voice, after: 'Slow now.\nFew words.\nNo questions.' });
    expect(after.studio.locks).toEqual(['secrets']);
    expect(after.voiceAnchor).toBe('Slow now.\nFew words.\nNo questions.');
    expect(pendingChatEdit(after)).toMatchObject({ keys: ['appearance', 'voice'], connections: false });
    // The user rewrote the voice by hand since: Undo leaves it and says so.
    const handEdited = characterFromSheet({ ...sheetFromCharacter(after), voice: 'Mine.\nAll mine.\nHands off.' }, after, after.studio);
    const u = undoLastChatEdit(handEdited);
    expect(u.restored).toEqual(['appearance']);
    expect(u.kept).toEqual(['voice']);
    expect(sheetFromCharacter(u.data).appearance).toBe(sheetFromCharacter(m.rawData).appearance);
    expect(sheetFromCharacter(u.data).voice).toBe('Mine.\nAll mine.\nHands off.');
    expect(u.data.studio.chatEdits).toEqual([]);
    expect(undoLastChatEdit(u.data)).toBeNull();
    expect(undoResultText({ name: 'Marit Holm', link: 'L', result: u })).toBe('Undid the chat\'s last change to Marit Holm: Appearance is back as before. L\nKept as they are now (changed since, or locked in the Studio): Voice.\nThat change was: make her older');
    // Kept in the Studio: nothing to offer.
    expect(pendingChatEdit({ ...after, studio: { ...after.studio, chatEdits: [{ ...after.studio.chatEdits[0], kept: true }] } })).toBeNull();
    // A card remembers the last ten.
    let d = m.rawData;
    for (let i = 0; i < CHAT_EDITS_KEPT + 3; i++) d = applyEdit(d, planEdit({ ...m, rawData: d }, roster, { changes: { tagline: `Take ${i}` }, structure: ROSTER_STRUCTURE }), { at: i });
    expect(d.studio.chatEdits).toHaveLength(CHAT_EDITS_KEPT);
    expect(d.studio.chatEdits[0].at).toBe(3);
  });

  it('says what changed, or that nothing did and why', () => {
    const m = marit();
    const plan = planEdit(m, [m], { changes: { appearance: 'Face: Lined, grey.' }, structure: ROSTER_STRUCTURE });
    const t = editResultText({ name: 'Marit Holm', link: 'parallx://creations/character?file=character-marit.json', plan, backLinked: ['Tom Hale'] });
    expect(t).toBe([
      'Changed Marit Holm: parallx://creations/character?file=character-marit.json',
      '- appearance: the Face section (the rest kept)',
      '- a line added to Tom Hale\'s card',
      '',
      'What it said before is kept: the user can undo it in the Studio, or you can, with "undo": true. Give the user the link exactly as written above.',
    ].join('\n'));
    const bad = planEdit(m, [m], { changes: { secrets: 'x' }, structure: ROSTER_STRUCTURE });
    expect(editResultText({ name: 'Marit Holm', link: 'L', plan: bad, failed: true })).toMatch(/^Nothing was changed on Marit Holm\. Fix these and call creations_edit_character again with every change you meant \(nothing from this call was kept\):\n- secrets/);
  });
});

describe('the edit tool, through the chat', () => {
  let w: ReturnType<typeof world>;
  beforeEach(() => { clearCharacterDrafts(); studioPagesForTests.clear(); w = world(); });

  const fileOf = (name: string) => [...w.fs.saved()].find(([, d]) => d.name === name)![0];
  const dataOf = (name: string) => [...w.fs.saved()].find(([, d]) => d.name === name)![1];

  it('the writes ask first in a scheduled or background turn and in Careful Mode, and run at once in a turn the user started', () => {
    const pdp = w.tools.policyDecisionPoint;
    let initiator = 'interactive';
    let careful = false;
    pdp.setPermissionService({
      isManagedSessionBlocked: () => false,
      checkPermission: (_n: string, level: string) => ({ level, autoApproved: level === 'always-allowed', source: 'default' }),
      isCarefulMode: () => careful,
      getSessionInitiator: () => initiator,
      isCommandAllowed: () => false,
    } as any);
    const decide = (name: string) => pdp.decide({ caller: { kind: 'built-in', id: 'chat' }, tool: { name, defaultLevel: w.tools.getTool(name)!.requiresConfirmation ? 'requires-approval' : 'always-allowed' }, args: {}, sessionId: 's' }).outcome;
    for (const n of ['creations_save_characters', 'creations_edit_character']) expect(decide(n)).toBe('allow');
    initiator = 'autonomous';
    for (const n of ['creations_save_characters', 'creations_edit_character']) expect(decide(n)).toBe('require-approval');
    for (const n of ['creations_character_brief', 'creations_find_characters']) expect(decide(n)).toBe('allow');
    initiator = 'interactive'; careful = true;
    for (const n of ['creations_save_characters', 'creations_edit_character']) expect(decide(n)).toBe('require-approval');
  });

  it('changes a card the chat made, by its link, only where asked; then undoes it', async () => {
    await w.call('creations_save_characters', { characters: [goodSheet('Marit Holm')] });
    const file = fileOf('Marit Holm');
    const before = sheetFromCharacter(dataOf('Marit Holm'));
    const r = await w.call('creations_edit_character', { character: core.characterLink(file), changes: { appearance: 'Face: Lined, grey eyes gone pale.', drives: 'Fears: the sea taking her.' }, request: 'make her older and more afraid' });
    expect(r.isError).toBeFalsy();
    expect(r.content).toMatch(new RegExp(`^Changed Marit Holm: parallx://creations/character\\?file=${file}\\n- appearance: the Face section \\(the rest kept\\)\\n- drives: the Fears line \\(the rest kept\\)`));
    const after = dataOf('Marit Holm');
    const sheet = sheetFromCharacter(after);
    expect(sheet.appearance.split('\n\n')[2]).toBe('Face: Lined, grey eyes gone pale.');
    expect(sheet.appearance.split('\n\n')[0]).toBe(before.appearance.split('\n\n')[0]);
    expect(sheet.drives).toBe('Wants: someone to stay the winter.\nFears: the sea taking her.\nIn the way: her own mouth.');
    expect(sheet.voice).toBe(before.voice);
    expect(after.studio).toMatchObject({ madeIn: 'chat' });
    expect(after.studio.chatEdits[0].request).toBe('make her older and more afraid');
    expect(after.roleInstruction).toContain('Lined, grey eyes gone pale.');
    expect(w.fs.saved().size).toBe(1);
    const undo = await w.call('creations_edit_character', { character: 'Marit Holm', undo: true });
    expect(undo.content).toMatch(/^Undid the chat's last change to Marit Holm: Appearance and Drives are back as before\./);
    expect(sheetFromCharacter(dataOf('Marit Holm'))).toEqual(before);
    expect((await w.call('creations_edit_character', { character: 'Marit Holm', undo: true })).content).toMatch(/has no change from the chat to undo/);
  });

  it('connects to a roster character with a line on their card, renames, and refuses what it cannot do without writing anything', async () => {
    await w.seed('character-ashby.json', { name: 'Lord Ashby', studio: { sheet: { name: 'Lord Ashby', relationships: 'Clara Ashby: his wife.' } } });
    await w.call('creations_save_characters', { characters: [goodSheet('Tom Hale')] });
    const file = fileOf('Tom Hale');
    const rel = `${goodSheet('Tom Hale').relationships}\nLord Ashby: his employer.`;
    const r = await w.call('creations_edit_character', { character: 'Tom Hale', changes: JSON.stringify({ relationships: rel, name: 'Tom Hale-Wick' }), connect: [{ name: 'Lord Ashby', how: 'his gamekeeper', addToTheirCard: true }] });
    expect(r.isError).toBeFalsy();
    expect(r.content).toContain('- name: was Tom Hale');
    expect(r.content).toContain('- connected to Lord Ashby');
    expect(r.content).toContain('- a line added to Lord Ashby\'s card');
    expect(dataOf('Tom Hale-Wick').studio.connections).toEqual([{ fileName: 'character-ashby.json', name: 'Lord Ashby', how: 'his gamekeeper' }]);
    expect(fileOf('Tom Hale-Wick')).toBe(file);
    expect(dataOf('Lord Ashby').studio.sheet.relationships).toBe('Clara Ashby: his wife.\nTom Hale-Wick: his gamekeeper.');
    const snapshot = JSON.stringify([...w.fs.saved()]);
    const bad = await w.call('creations_edit_character', { character: 'Tom Hale-Wick', changes: { voice: 'Gruff.' } });
    expect(bad.isError).toBe(true);
    expect(bad.content).toMatch(/^Nothing was changed on Tom Hale-Wick\./);
    expect(JSON.stringify([...w.fs.saved()])).toBe(snapshot);
    expect((await w.call('creations_edit_character', { character: 'Nobody Here', changes: { tagline: 'x' } })).content).toMatch(/^Nothing was changed: no character is named "Nobody Here"/);
    const same = await w.call('creations_edit_character', { character: 'Tom Hale-Wick', changes: { tagline: dataOf('Tom Hale-Wick').studio.sheet.tagline } });
    expect(same).toMatchObject({ content: expect.stringMatching(/^Nothing to change on Tom Hale-Wick: the card already says that\./) });
    expect(JSON.stringify([...w.fs.saved()])).toBe(snapshot);
  });

  it('a Studio open on the card saves its typing first and opens the card again after; while it is writing, the chat waits', async () => {
    await w.call('creations_save_characters', { characters: [goodSheet('Marit Holm')] });
    const file = fileOf('Marit Holm');
    const order: string[] = [];
    let busy = false;
    const studio = {
      isBusy: () => busy,
      flush: vi.fn(async () => {
        order.push('flush');
        // The user's last typing, saved by the Studio before the chat reads the card.
        const d = dataOf('Marit Holm');
        d.studio.sheet.reminder = 'Typed in the Studio.';
        w.fs.files.set(`${CHARS}/${file}`, JSON.stringify(d));
      }),
      abandon: vi.fn(() => order.push('abandon')),
    };
    const page = { studioOn: (f: string) => (f === file ? studio : null), reopen: vi.fn(() => order.push('reopen')) };
    studioPagesForTests.add(page);
    const r = await w.call('creations_edit_character', { character: 'Marit Holm', changes: { tagline: 'Keeps the light, and the peace' } });
    expect(r.isError).toBeFalsy();
    expect(order).toEqual(['flush', 'abandon', 'reopen']);
    expect(page.reopen).toHaveBeenCalledWith(file);
    const sheet = sheetFromCharacter(dataOf('Marit Holm'));
    expect(sheet.reminder).toBe('Typed in the Studio.');
    expect(sheet.tagline).toBe('Keeps the light, and the peace');
    busy = true;
    const held = await w.call('creations_edit_character', { character: 'Marit Holm', changes: { tagline: 'Another take' } });
    expect(held).toMatchObject({ isError: true });
    expect(held.content).toMatch(/Nothing was changed on Marit Holm: the Character Studio is writing this character right now/);
    expect(sheetFromCharacter(dataOf('Marit Holm')).tagline).toBe('Keeps the light, and the peace');
  });

  it('needs a workspace', async () => {
    expect((await world({ workspace: false }).call('creations_edit_character', { character: 'X' })).content).toMatch(/Open a workspace first/);
  });
});

// ── The gaps closed on 2026-10-09 ────────────────────────────────────────────

describe('the Chat Behaviour page keeps the Studio sheet in step', () => {
  const base = () => characterFromSheet(readIncomingCharacter(goodSheet('Marit Holm')).sheet, { id: 'm' }, {});
  it('carries what that page changed into the sheet, and keeps what the role instruction cannot hold', () => {
    const before = base();
    const role = before.roleInstruction.replace('## Secrets\nShe posts letters to her husband that she never sends.', '## Secrets\nShe reads the keeper\'s log at night.');
    const next = keepSheetInStep(before, { ...before, roleInstruction: role, reminder: 'Marit never sits with her back to the sea.' });
    expect(next.studio.sheet.secrets).toBe('She reads the keeper\'s log at night.');
    expect(next.studio.sheet.reminder).toBe('Marit never sits with her back to the sea.');
    expect(next.studio.sheet.tagline).toBe(before.studio.sheet.tagline);
    expect(next.studio.sheet.appearance).toBe(before.studio.sheet.appearance);
    // So the sheet the Studio and the chat read says what the page saved.
    expect(sheetFromCharacter(next).secrets).toBe('She reads the keeper\'s log at night.');
    const voice = keepSheetInStep(before, { ...before, voiceAnchor: 'Slow.\nFew words.\nNo questions.' });
    expect(voice.studio.sheet.voice).toBe('Slow.\nFew words.\nNo questions.');
    expect(keepSheetInStep(before, { ...before })).toEqual(before);
    const legacy = { name: 'Old', roleInstruction: 'x' };
    expect(keepSheetInStep(legacy, { ...legacy, roleInstruction: 'y' })).toEqual({ ...legacy, roleInstruction: 'y' });
  });
});

describe('results fit the room the chat gives them', () => {
  const roster = Array.from({ length: 40 }, (_, i) => card(`character-${i}.json`, goodSheet(`Person ${i} Holm`)));
  it('the brief drops roster lines first, never the rules', () => {
    const whole = fitBrief({ structure: STRUCTURE, roster }, 0);
    expect(whole).toContain('- Person 39 Holm');
    const small = fitBrief({ structure: STRUCTURE, roster }, whole.length - 1500);
    expect(small.length).toBeLessThanOrEqual(whole.length - 1500);
    expect(small).toContain('Field requirements:');
    expect(small).toMatch(/- and \d+ more \(creations_find_characters lists them\)/);
  });
  it('a find drops whole sheets first, then list lines, and says how to get the rest', () => {
    const hits = searchCharacters(roster, { query: 'skerry' });
    const whole = fitFindResult(hits, { query: 'skerry', full: true, total: 40 }, 0);
    expect(whole.match(/^## /gm)).toHaveLength(4);
    const two = fitFindResult(hits, { query: 'skerry', full: true, total: 40 }, Math.ceil(whole.length * 0.6));
    expect(two.length).toBeLessThanOrEqual(Math.ceil(whole.length * 0.6));
    expect((two.match(/^## /gm) || []).length).toBeLessThan(4);
    expect(two).toMatch(/whole sheets? fits? in this reply: ask for the others by name, one at a time\./);
    const tiny = fitFindResult(hits, { query: 'skerry', total: 40 }, 600);
    expect(tiny.length).toBeLessThanOrEqual(600);
    expect(tiny).toMatch(/- and more that did not fit this reply: narrow the search\.$/);
  });
  it('through the chat, a find honours the budget the loop passes', async () => {
    const w = world();
    for (const r of roster.slice(0, 6)) await w.seed(r.fileName, r.rawData);
    const r = await w.tools.invokeToolWithRuntimeControl('creations_find_characters', { query: 'skerry', full: true }, token(), undefined, undefined, { resultCharBudget: 5000 });
    expect(r.content.length).toBeLessThanOrEqual(5000);
    expect(r.content).toMatch(/^6 characters matching "skerry"/);
  });
});

describe('Stop, and turning Creations off', () => {
  beforeEach(() => { clearCharacterDrafts(); studioPagesForTests.clear(); });

  it('Stop during a save keeps what is saved and writes nothing more', async () => {
    const w = world();
    let stop = false;
    const write = w.fs.writeFile.bind(w.fs);
    w.fs.writeFile = async (uri: string, content: string) => { await write(uri, content); if (uri.startsWith(CHARS)) stop = true; };
    const t = { isCancellationRequested: false, onCancellationRequested: () => ({ dispose() {} }) } as any;
    Object.defineProperty(t, 'isCancellationRequested', { get: () => stop });
    const r = await w.tools.invokeTool('creations_save_characters', { characters: [goodSheet('Marit Holm'), goodSheet('Tom Hale'), goodSheet('Nell Hale')] }, t);
    expect(r.content).toMatch(/^Saved 1 of 3 characters\./);
    expect(r.content).toContain('Stopped by the user before Tom Hale, Nell Hale were saved. Do not save them again unless the user asks.');
    expect([...w.fs.saved().values()].map((d) => d.name)).toEqual(['Marit Holm']);
  });

  it('Stop before an edit writes changes nothing', async () => {
    const w = world();
    await w.call('creations_save_characters', { characters: [goodSheet('Marit Holm')] });
    const snapshot = JSON.stringify([...w.fs.saved()]);
    let n = 0;
    const t = { onCancellationRequested: () => ({ dispose() {} }) } as any;
    // Not stopped when the call starts (the loop checks first), stopped by the time it would write.
    Object.defineProperty(t, 'isCancellationRequested', { get: () => ++n > 1 });
    const r = await w.tools.invokeTool('creations_edit_character', { character: 'Marit Holm', changes: { tagline: 'Another' } }, t);
    expect(r).toMatchObject({ isError: true, content: 'Stopped by the user: nothing was changed.' });
    expect(JSON.stringify([...w.fs.saved()])).toBe(snapshot);
  });

  it('turned off, the half-finished characters are forgotten', async () => {
    const w = world();
    await w.call('creations_save_characters', { characters: [goodSheet('Nell Hale', { secrets: '' })] });
    for (const d of w.context.subscriptions) d.dispose();
    const again = world();
    const fix = await again.call('creations_save_characters', { characters: [{ name: 'Nell Hale', secrets: 'She reads his letters.' }] });
    expect(fix.isError).toBe(true);
    expect(fix.content).not.toMatch(/kept from the earlier call/);
    expect(fix.content).toMatch(/tagline \(Tagline\) is missing/);
  });
});
