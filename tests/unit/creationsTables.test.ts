// Creations AI: Tables (ext/creations-ai/tables-core.js), the Perchance
// list grammar run locally. Deterministic through an injected rng.

import { describe, it, expect } from 'vitest';
// @ts-expect-error — JS module with no types
import { parseTables, evaluate, roll, listNames, pluralForm, singularForm, fixArticles, STARTER_TABLE } from '../../ext/creations-ai/tables-core.js';

/** A tiny seeded generator, so a test can say what the dice will do. */
function seeded(seed: number) {
  let s = seed >>> 0;
  return () => { s = (s * 1664525 + 1013904223) >>> 0; return s / 4294967296; };
}
/** Replay exact values, then fall back to zeros. */
function sequence(values: number[]) { let i = 0; return () => (i < values.length ? values[i++] : 0); }

const SOURCE = `
// a pasted Perchance generator
output
  [name] the [title]
  {A} [animal.titleCase] named [name]

name
  Ada^3
  Bram
  Cyra

title
  {brave|wise^2} one
  keeper of {1-3} keys

animal
  cat
  bird
    owl
    hawk
  ox

extra = {import:other-table}
`;

describe('parsing', () => {
  it('reads lists, weights, nesting, comments and imports', () => {
    const gen = parseTables(SOURCE);
    expect(gen.errors).toEqual([]);
    expect(listNames(gen)).toEqual(['output', 'name', 'title', 'animal']);
    expect(gen.lists.get('name').items.map((i: any) => [i.text, i.weight])).toEqual([['Ada', 3], ['Bram', 1], ['Cyra', 1]]);
    const bird = gen.lists.get('animal').items[1];
    expect(bird.text).toBe('bird');
    expect(bird.children.items.map((i: any) => i.text)).toEqual(['owl', 'hawk']);
    expect(gen.imports.get('extra')).toBe('other-table');
  });
  it('reports what it cannot read without giving up', () => {
    const gen = parseTables('  orphan item\nlist\n  ok\n bad indent after\n');
    expect(gen.errors.some((e: string) => e.includes('before any list'))).toBe(true);
    expect(gen.lists.get('list').items.map((i: any) => i.text)).toEqual(['ok', 'bad indent after']);
  });
});

describe('rolling', () => {
  const gen = parseTables(SOURCE);
  it('picks by weight', () => {
    // name: Ada^3 Bram Cyra: total 5. 0.5*5 = 2.5 falls inside Ada's 3.
    expect(evaluate(gen, 'name', { rng: sequence([0.5]) }).text).toBe('Ada');
    expect(evaluate(gen, 'name', { rng: sequence([0.7]) }).text).toBe('Bram');
    expect(evaluate(gen, 'name', { rng: sequence([0.95]) }).text).toBe('Cyra');
  });
  it('resolves references, inline choices with weights, and ranges', () => {
    // output item 1 (0.1), name Ada (0.1), title item 1 (0.1), inline: brave|wise^2 total 3, 0.9*3=2.7 -> wise
    expect(evaluate(gen, 'output', { rng: sequence([0.1, 0.1, 0.1, 0.9]) }).text).toBe('Ada the wise one');
    // title item 2 (0.9), range 1-3 with 0.99 -> 3
    expect(evaluate(gen, 'title', { rng: sequence([0.9, 0.99]) }).text).toBe('keeper of 3 keys');
  });
  it('picks through a nested list, cases the pick, and resolves the article after the word', () => {
    // output item 2 (0.9); animal: cat|bird|ox equal, 0.5 -> bird; bird children owl|hawk, 0.1 -> owl; name 0.1 -> Ada
    expect(evaluate(gen, 'output', { rng: sequence([0.9, 0.5, 0.1, 0.1]) }).text).toBe('An Owl named Ada');
    expect(evaluate(gen, 'output', { rng: sequence([0.9, 0.1, 0.1]) }).text).toBe('A Cat named Ada');
  });
  it('supports methods and modifiers by name', () => {
    const g = parseTables('x\n  [name.upperCase]\n  [name.selectUnique(3)]\n  [name.selectMany(2)]\n  [name.pluralForm]\nname\n  ada\n  bram\n  cyra\n');
    expect(evaluate(g, 'x', { rng: sequence([0, 0]) }).text).toBe('ADA');
    const unique = evaluate(g, 'x', { rng: seeded(7) });
    if (unique.text.includes(',')) expect(new Set(unique.text.split(', ')).size).toBe(unique.text.split(', ').length);
    expect(evaluate(g, 'x', { rng: sequence([0.6, 0, 0.99]) }).text).toBe('ada, cyra');
    expect(evaluate(g, 'x', { rng: sequence([0.9, 0]) }).text).toBe('adas');
  });
  it('keeps a variable for the rest of the roll', () => {
    const g = parseTables('output\n  [n = name] met [n] again\nname\n  Ada\n  Bram\n');
    expect(evaluate(g, 'output', { rng: sequence([0, 0.9]) }).text).toBe('Ada met Ada again');
  });
  it('leaves escaped brackets and unknown references as text, and says so', () => {
    const g = parseTables('output\n  \\[not a ref\\] and [nothing]\n');
    const r = evaluate(g, 'output', { rng: sequence([0]) });
    expect(r.text).toBe('[not a ref] and [nothing]');
    expect(r.errors).toEqual(['No list named "nothing"']);
  });
  it('resolves an imported table through the loader', () => {
    const other = parseTables('output\n  from the other table\nplace\n  Skerry Rock\n');
    const g = parseTables('output\n  [x] at [x.place]\nx = {import:other}\n');
    const r = evaluate(g, 'output', { rng: sequence([0, 0, 0]), imports: (name: string) => (name === 'other' ? other : null) });
    expect(r.text).toBe('from the other table at Skerry Rock');
    const missing = evaluate(g, 'output', { rng: sequence([0]), imports: () => null });
    expect(missing.errors[0]).toContain('could not be found');
  });
  it('never hangs on a list that refers to itself', () => {
    const g = parseTables('loop\n  again [loop]\n');
    const r = evaluate(g, 'loop', { rng: sequence([]) });
    expect(r.errors.length).toBeGreaterThan(0);
    expect(r.text.length).toBeLessThan(2000);
  });
  it('rolls several at once and dedupes the errors', () => {
    const r = roll(parseTables(STARTER_TABLE), 5, 'output', { rng: seeded(3) });
    expect(r.results).toHaveLength(5);
    expect(r.errors).toEqual([]);
    for (const line of r.results) expect(line).not.toMatch(/[[\]{}]/);
  });
});

describe('words', () => {
  it('pluralises and singularises the common shapes', () => {
    expect(['cat', 'fox', 'baby', 'knife', 'man', 'sheep', 'hero', 'Wolf'].map(pluralForm)).toEqual(['cats', 'foxes', 'babies', 'knives', 'men', 'sheep', 'heroes', 'Wolves']);
    expect(['cats', 'foxes', 'babies', 'men', 'wolves'].map(singularForm)).toEqual(['cat', 'fox', 'baby', 'man', 'wolf']);
  });
  it('chooses the article by sound, not by letter', () => {
    expect(fixArticles('\u0001a owl, \u0001a cat, \u0001a hour, \u0001a unicorn, \u0001A apple')).toBe('an owl, a cat, an hour, a unicorn, An apple');
  });
});
