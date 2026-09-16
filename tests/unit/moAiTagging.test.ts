/**
 * AI tagging's pure logic, extracted verbatim from the extension (the
 * @mo-tag-pure region): tag-name capitals, paths, ancestors, the reply schema,
 * the prompt, reply parsing, pick resolution and the detail-crop rectangles.
 * docs/AI_TAGGING.md.
 */

import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = dirname(fileURLToPath(import.meta.url));

function loadRegion(): string {
  const src = readFileSync(resolve(__dirname, '../../ext/media-organizer/main.js'), 'utf8');
  const a = src.indexOf('// @mo-tag-pure-begin');
  const b = src.indexOf('// @mo-tag-pure-end');
  expect(a).toBeGreaterThan(0);
  expect(b).toBeGreaterThan(a);
  return src.slice(a, b);
}

const REGION = loadRegion();
const NAMES = ['MO_TAG_PATH_SEP', 'MO_TAG_OVERVIEW_EDGE', 'MO_TAG_CROP_EDGE', 'MO_TAG_CROP_MIN_EDGE', 'moNormalizeTagName',
  'moTagParentsOf', 'moTagAncestorIds', 'moExpandWithAncestors', 'moTagPaths', 'moTagEntries', 'moTagReplySchema',
  'moTagPrompt', 'moTagRulesText', 'MO_TAG_RULES_MAX', 'moParseTagReply', 'moResolveTagPicks', 'moFitEdge', 'moQuarterRects'];
// eslint-disable-next-line @typescript-eslint/no-implied-eval
const P: Record<string, any> = new Function(REGION + `\nreturn { ${NAMES.join(', ')} };`)();

const S = ' › ';
// ANIMALS > DOG > CORGI, ANIMALS > CAT, PLACES > BEACH
const tags = [
  { id: 1, name: 'ANIMALS', description: '' },
  { id: 2, name: 'DOG', description: 'Any dog' },
  { id: 3, name: 'CORGI', description: '' },
  { id: 4, name: 'CAT', description: '' },
  { id: 5, name: 'PLACES', description: '' },
  { id: 6, name: 'BEACH', description: '  Sand   and sea  ' },
];
const rels = [
  { parent_id: 1, child_id: 2 },
  { parent_id: 2, child_id: 3 },
  { parent_id: 1, child_id: 4 },
  { parent_id: 5, child_id: 6 },
];

describe('the pure region', () => {
  it('touches no DOM, app API or database', () => {
    expect(REGION).not.toMatch(/\b(document|window|_api|db)\s*\./);
  });
  it('sends at most 1536 px, crops of 1024 px, crops only above 3072 px', () => {
    expect(P.MO_TAG_OVERVIEW_EDGE).toBe(1536);
    expect(P.MO_TAG_CROP_EDGE).toBe(1024);
    expect(P.MO_TAG_CROP_MIN_EDGE).toBe(3072);
    expect(P.MO_TAG_PATH_SEP).toBe(S);
  });
});

describe('moNormalizeTagName', () => {
  it('stores capitals, trimmed, single spaces', () => {
    expect(P.moNormalizeTagName('  golden   retriever ')).toBe('GOLDEN RETRIEVER');
    expect(P.moNormalizeTagName('été')).toBe('ÉTÉ');
    expect(P.moNormalizeTagName('BEACH')).toBe('BEACH');
  });
  it('turns nothing into an empty name', () => {
    expect(P.moNormalizeTagName(null)).toBe('');
    expect(P.moNormalizeTagName(undefined)).toBe('');
    expect(P.moNormalizeTagName(' \t\n ')).toBe('');
  });
});

describe('the tag tree', () => {
  const parentsOf = P.moTagParentsOf(rels);

  it('finds every ancestor', () => {
    expect([...P.moTagAncestorIds(3, parentsOf)].sort()).toEqual([1, 2]);
    expect([...P.moTagAncestorIds(1, parentsOf)]).toEqual([]);
  });

  it('adds parents once each, after the picks', () => {
    expect(P.moExpandWithAncestors([3, 6], parentsOf)).toEqual([3, 6, 2, 1, 5]);
    expect(P.moExpandWithAncestors([3, 2, 3], parentsOf)).toEqual([3, 2, 1]);
    expect(P.moExpandWithAncestors([], parentsOf)).toEqual([]);
  });

  it('builds the full path of every tag', () => {
    const paths = P.moTagPaths(tags, rels);
    expect(paths.get(3)).toEqual([`ANIMALS${S}DOG${S}CORGI`]);
    expect(paths.get(6)).toEqual([`PLACES${S}BEACH`]);
    expect(paths.get(1)).toEqual(['ANIMALS']);
  });

  it('gives a tag filed under two parents (older data) one path each, and both ancestor chains', () => {
    const legacy = [...rels, { parent_id: 5, child_id: 3 }];
    expect(P.moTagPaths(tags, legacy).get(3).sort()).toEqual([`ANIMALS${S}DOG${S}CORGI`, `PLACES${S}CORGI`].sort());
    expect([...P.moTagAncestorIds(3, P.moTagParentsOf(legacy))].sort()).toEqual([1, 2, 5]);
  });

  it('stops at a loop in damaged data', () => {
    const loopRels = [{ parent_id: 1, child_id: 2 }, { parent_id: 2, child_id: 1 }];
    expect([...P.moTagAncestorIds(1, P.moTagParentsOf(loopRels))]).toEqual([2]);
    const paths = P.moTagPaths([{ id: 1, name: 'A' }, { id: 2, name: 'B' }], loopRels);
    expect(paths.get(1).length).toBeGreaterThan(0);
    expect(paths.get(2).length).toBeGreaterThan(0);
  });
});

describe('what the model is given', () => {
  it('lists every path, sorted, without the tags the photo already has', () => {
    const e = P.moTagEntries(tags, rels, new Set([4]));
    expect(e.map((x: any) => x.path)).toEqual(['ANIMALS', `ANIMALS${S}DOG`, `ANIMALS${S}DOG${S}CORGI`, 'PLACES', `PLACES${S}BEACH`]);
    expect(e.find((x: any) => x.id === 6).description).toBe('Sand and sea');
    expect(e.find((x: any) => x.id === 2).description).toBe('Any dog');
  });

  it('allows only the listed paths in the reply', () => {
    const s = P.moTagReplySchema(['A', 'B', 'A']);
    expect(s.type).toBe('object');
    expect(s.required).toEqual(['tags']);
    expect(s.properties.tags.type).toBe('array');
    expect(s.properties.tags.items.enum).toEqual(['A', 'B']);
  });

  it('writes a prompt with every tag, its description, what the photo has, and the crop layout', () => {
    const entries = P.moTagEntries(tags, rels, new Set());
    const plain = P.moTagPrompt({ entries, existing: ['CAT'], crops: false });
    expect(plain).toContain(`ANIMALS${S}DOG : Any dog`);
    expect(plain).toContain(`PLACES${S}BEACH : Sand and sea`);
    expect(plain).toContain(`ANIMALS${S}DOG${S}CORGI\n`);
    expect(plain).toContain('already has these tags, so do not pick them: CAT.');
    expect(plain).toContain('The image is the photo.');
    expect(plain).not.toContain('Images 2 to 5');
    const crops = P.moTagPrompt({ entries, existing: [], crops: true });
    expect(crops).toContain('Images 2 to 5 are its four quarters');
    expect(crops).not.toContain('already has these tags');
  });

  it('puts the library rules in their own section, after the instructions and before the tags, and leaves no section when there are none', () => {
    const entries = P.moTagEntries(tags, rels, new Set());
    const rules = 'Use CORGI only when the breed is unmistakable; otherwise DOG.\nNever tag people by name.';
    const withRules = P.moTagPrompt({ entries, existing: [], crops: false, rules });
    const head = withRules.indexOf('Rules for this library');
    expect(head).toBeGreaterThan(withRules.indexOf('If no tag fits'));
    expect(head).toBeLessThan(withRules.indexOf('Tags (text after'));
    expect(withRules).toContain(rules);
    for (const none of [undefined, '', '   \n ']) {
      expect(P.moTagPrompt({ entries, existing: [], crops: false, rules: none })).not.toContain('Rules for this library');
    }
  });

  it('trims and caps the rules text and keeps its lines', () => {
    expect(P.moTagRulesText('  a rule \r\n\r\n another  ')).toBe('a rule\n\nanother');
    expect(P.moTagRulesText(null)).toBe('');
    expect(P.moTagRulesText('x'.repeat(P.MO_TAG_RULES_MAX + 50)).length).toBe(P.MO_TAG_RULES_MAX);
  });
});

describe('moParseTagReply', () => {
  it('reads the schema object', () => {
    expect(P.moParseTagReply('{"tags": ["A", "B"]}')).toEqual({ ok: true, tags: ['A', 'B'] });
    expect(P.moParseTagReply('{"tags": []}')).toEqual({ ok: true, tags: [] });
  });
  it('reads a bare array, fenced JSON, JSON inside prose, and drops a think block', () => {
    expect(P.moParseTagReply('["A"]')).toEqual({ ok: true, tags: ['A'] });
    expect(P.moParseTagReply('```json\n{"tags":["A"]}\n```')).toEqual({ ok: true, tags: ['A'] });
    expect(P.moParseTagReply('Sure! {"tags":["A"]} Hope that helps.')).toEqual({ ok: true, tags: ['A'] });
    expect(P.moParseTagReply('<think>hmm {"tags":["X"]}</think>{"tags":["A"]}')).toEqual({ ok: true, tags: ['A'] });
  });
  it('keeps only strings and rejects anything that is not a tag list', () => {
    expect(P.moParseTagReply('{"tags": ["A", 3, null]}')).toEqual({ ok: true, tags: ['A'] });
    expect(P.moParseTagReply('I see a dog.')).toEqual({ ok: false, tags: [] });
    expect(P.moParseTagReply('')).toEqual({ ok: false, tags: [] });
    expect(P.moParseTagReply('{"labels": ["A"]}')).toEqual({ ok: false, tags: [] });
  });
});

describe('moResolveTagPicks', () => {
  const entries = P.moTagEntries(tags, rels, new Set());

  it('maps exact paths to tag ids', () => {
    expect(P.moResolveTagPicks([`ANIMALS${S}DOG${S}CORGI`, `PLACES${S}BEACH`], entries)).toEqual({ ids: [3, 6], unknown: [] });
  });

  it('forgives case, other separators and a bare tag name, without duplicates', () => {
    const r = P.moResolveTagPicks(['animals › dog › corgi', 'ANIMALS > DOG', 'beach', 'PLACES/BEACH'], entries);
    expect(r).toEqual({ ids: [3, 2, 6], unknown: [] });
  });

  it('never invents a tag', () => {
    const r = P.moResolveTagPicks(['UNICORN', `ANIMALS${S}UNICORN`, '', '  '], entries);
    expect(r.ids).toEqual([]);
    expect(r.unknown).toEqual(['UNICORN', `ANIMALS${S}UNICORN`]);
  });

  it('only resolves to the entries it was given (a tag the photo has is not offered)', () => {
    const withoutCorgi = P.moTagEntries(tags, rels, new Set([3]));
    expect(P.moResolveTagPicks(['CORGI'], withoutCorgi).ids).toEqual([]);
  });
});

describe('the image sizes', () => {
  it('fits the long edge and never enlarges', () => {
    expect(P.moFitEdge(6000, 4000, 1536)).toEqual({ w: 1536, h: 1024 });
    expect(P.moFitEdge(4000, 6000, 1536)).toEqual({ w: 1024, h: 1536 });
    expect(P.moFitEdge(800, 600, 1536)).toEqual({ w: 800, h: 600 });
  });

  it('cuts four overlapping quarters that stay inside the photo', () => {
    const q = P.moQuarterRects(6000, 4000);
    expect(q).toHaveLength(4);
    expect(q[0]).toEqual({ x: 0, y: 0, w: 3300, h: 2200 });
    expect(q[3]).toEqual({ x: 2700, y: 1800, w: 3300, h: 2200 });
    for (const r of q) {
      expect(r.x).toBeGreaterThanOrEqual(0);
      expect(r.y).toBeGreaterThanOrEqual(0);
      expect(r.x + r.w).toBeLessThanOrEqual(6000);
      expect(r.y + r.h).toBeLessThanOrEqual(4000);
    }
  });
});
