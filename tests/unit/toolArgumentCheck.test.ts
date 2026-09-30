// A tool call may carry only the arguments its tool declares.
//
// Regression for 2026-09-28: `flashcards_query` was called with `matchAny`
// beside `query`; the handler read `where.matchAny` only, the search required
// every word, found nothing, and the chat reported a coverage gap that did
// not exist.

import { describe, it, expect } from 'vitest';
import { describeUndeclaredArguments, findUndeclaredArguments } from '../../src/services/toolArgumentCheck';

const QUERY_SCHEMA = {
  type: 'object',
  properties: {
    action: { type: 'string' },
    query: { type: 'string' },
    deckName: { type: 'string' },
    where: {
      type: 'object',
      properties: { query: { type: 'string' }, matchAny: { type: 'boolean' }, tag: { type: 'string' } },
    },
    changes: {
      type: 'array',
      items: { type: 'object', properties: { op: { type: 'string' }, keepId: { type: 'string' } } },
    },
  },
  required: ['action'],
};

describe('findUndeclaredArguments', () => {
  it('passes a call whose arguments are all declared', () => {
    expect(findUndeclaredArguments(QUERY_SCHEMA, { action: 'find', query: 'expert opinion', where: { matchAny: true } })).toEqual([]);
  });

  it('names the arguments the tool does not declare', () => {
    expect(findUndeclaredArguments(QUERY_SCHEMA, { action: 'find', query: 'x', matchAny: true, fuzzy: 1 })).toEqual(['matchAny', 'fuzzy']);
  });

  it('has nothing to check against when the schema declares no properties', () => {
    expect(findUndeclaredArguments({ type: 'object', properties: {} }, { anything: 1 })).toEqual([]);
    expect(findUndeclaredArguments({ type: 'object' }, { anything: 1 })).toEqual([]);
    expect(findUndeclaredArguments(undefined, { anything: 1 })).toEqual([]);
  });

  it('leaves a tool that takes free-form arguments alone', () => {
    const open = { type: 'object', properties: { a: { type: 'string' } }, additionalProperties: true };
    expect(findUndeclaredArguments(open, { a: 'x', b: 'y' })).toEqual([]);
    const typed = { type: 'object', properties: { a: { type: 'string' } }, additionalProperties: { type: 'string' } };
    expect(findUndeclaredArguments(typed, { a: 'x', b: 'y' })).toEqual([]);
  });

  it('treats a call with no arguments as clean', () => {
    expect(findUndeclaredArguments(QUERY_SCHEMA, undefined)).toEqual([]);
    expect(findUndeclaredArguments(QUERY_SCHEMA, {})).toEqual([]);
  });
});

describe('describeUndeclaredArguments', () => {
  it('says nothing when every argument is declared', () => {
    expect(describeUndeclaredArguments('flashcards_query', QUERY_SCHEMA, { action: 'find' })).toBeUndefined();
  });

  it('tells the model the call did not run, where the argument belongs and what the tool accepts', () => {
    const message = describeUndeclaredArguments('flashcards_query', QUERY_SCHEMA, { action: 'find', query: 'x', matchAny: true })!;
    expect(message).toContain('Tool "flashcards_query" was not run');
    expect(message).toContain('no argument "matchAny"');
    expect(message).toContain('"matchAny" goes inside "where"');
    expect(message).toContain('It accepts: action, query, deckName, where, changes.');
  });

  it('finds the owner inside an array of objects', () => {
    const message = describeUndeclaredArguments('flashcards_edit', QUERY_SCHEMA, { action: 'apply', keepId: '#4' })!;
    expect(message).toContain('"keepId" goes inside "changes"');
  });

  it('recognises the same name written another way', () => {
    const message = describeUndeclaredArguments('flashcards_query', QUERY_SCHEMA, { action: 'find', deck_name: 'Meyers' })!;
    expect(message).toContain('Did you mean "deckName"?');
  });

  it('offers no guess for a name that belongs nowhere', () => {
    const message = describeUndeclaredArguments('flashcards_query', QUERY_SCHEMA, { action: 'find', fuzzy: true })!;
    expect(message).toContain('no argument "fuzzy"');
    expect(message).not.toContain('goes inside');
    expect(message).not.toContain('Did you mean');
  });
});
