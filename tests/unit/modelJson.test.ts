// modelJson.test.ts — the JSON inside a model's reply, found the same way everywhere.
//
// Eleven copies of "find the JSON in the reply" differed: a greedy
// /\{[\s\S]*\}/ swallowed two objects into one failed parse and broke on a
// brace in the prose; think-tag and fence stripping varied. platform/modelJson
// walks the text string by string and returns the first candidate that
// parses; the core and api.lm.parseJson use it.

import { describe, it, expect } from 'vitest';
import { findJsonArray, findJsonObject, matchingClose, parseModelJson, stripModelNoise } from '../../src/platform/modelJson';

describe('stripModelNoise', () => {
  it('drops think blocks, an unterminated think head and code fences', () => {
    expect(stripModelNoise('<think>hmm {not json}</think>```json\n{"a":1}\n```')).toBe('{"a":1}');
    expect(stripModelNoise('leaked reasoning {x} </think> {"a":1}')).toBe('{"a":1}');
    expect(stripModelNoise(null as unknown as string)).toBe('');
  });
});

describe('matchingClose', () => {
  it('ignores brackets inside strings and escaped quotes', () => {
    const t = '{"a":"}","b":"\\"}","c":{"d":1}} tail';
    expect(t.slice(0, matchingClose(t, 0, '{', '}') + 1)).toBe('{"a":"}","b":"\\"}","c":{"d":1}}');
    expect(matchingClose('{"open":1', 0, '{', '}')).toBe(-1);
  });
});

describe('findJsonObject', () => {
  it('takes the object out of prose before and after it', () => {
    expect(findJsonObject('Sure! Here it is: {"relationship":"extends","confidence":0.65}. Hope that helps.'))
      .toEqual({ relationship: 'extends', confidence: 0.65 });
  });

  it('returns the first object when the reply holds two (a greedy match failed here)', () => {
    expect(findJsonObject('{"a":1} and also {"b":2}')).toEqual({ a: 1 });
  });

  it('skips a brace in the prose and finds the object after it', () => {
    expect(findJsonObject('Note: {this is not json}. Answer: {"a":1}')).toEqual({ a: 1 });
  });

  it('is null for an array, for no object, and for one that never closes', () => {
    expect(findJsonObject('[1,2]')).toBeNull();
    expect(findJsonObject('nothing here')).toBeNull();
    expect(findJsonObject('{"a": [1, 2')).toBeNull();
  });

  it('tries a repair before the strict parse', () => {
    const repair = (s: string) => s.replace(/\\frac/g, '\\\\frac');
    expect(findJsonObject('{"tex":"\\frac{1}{2}"}', { repair })).toEqual({ tex: '\\frac{1}{2}' });
    expect(findJsonObject('{"tex":"\\frac{1}{2}"}')).toEqual({ tex: '\frac{1}{2}' });
  });
});

describe('findJsonArray', () => {
  it('takes the first array, or the first the caller accepts (a citation "[1]" is an array too)', () => {
    const reply = 'As shown in [1], the items are: [{"t":"a"},{"t":"b"}]';
    expect(findJsonArray(reply)).toEqual({ value: [1], truncated: false });
    const objects = (arr: unknown[]) => arr.every((x) => !!x && typeof x === 'object');
    expect(findJsonArray(reply, { accept: objects })).toEqual({ value: [{ t: 'a' }, { t: 'b' }], truncated: false });
  });

  it('keeps the complete items of a reply cut off mid-array', () => {
    expect(findJsonArray('[{"t":"a"},{"t":"b"},{"t":"c'))
      .toEqual({ value: [{ t: 'a' }, { t: 'b' }], truncated: true });
    expect(findJsonArray('[{"t":"a')).toEqual({ value: null, truncated: true });
  });

  it('is null when there is no array', () => {
    expect(findJsonArray('{"a":1}')).toEqual({ value: null, truncated: false });
  });
});

describe('parseModelJson', () => {
  it('parses a whole-JSON reply, else whichever of object or array opens first', () => {
    expect(parseModelJson('```json\n[1,2,3]\n```')).toEqual([1, 2, 3]);
    expect(parseModelJson('Result: {"items":[1]} done')).toEqual({ items: [1] });
    expect(parseModelJson('Result: [1] then {"a":1}')).toEqual([1]);
    expect(parseModelJson('no json')).toBeNull();
  });
});
