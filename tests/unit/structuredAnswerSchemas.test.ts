// structuredAnswerSchemas.test.ts — the structured calls send a JSON schema,
// not `format: 'json'`. Each schema must accept the answer its parser reads
// (the shape the prompt shows) and name every field the parser needs, so a
// provider that holds the model to the schema can only produce something the
// parser takes.
import { describe, it, expect } from 'vitest';
// @ts-expect-error — plain JS extension module
import { NEXT_ACT_SCHEMA, SITUATIONS_SCHEMA, STORY_MEMORY_SCHEMA, MEMORY_EXTRACT_SCHEMA, MEMORY_CATEGORY_ORDER, sinceThenSchema } from '../../ext/creations-ai/schemas.js';
// @ts-expect-error — plain JS extension module
import { budgetStageSchema } from '../../ext/budget/ai-schemas.js';
// @ts-expect-error — plain JS extension module
import { parseNextAct } from '../../ext/creations-ai/acts.js';
// @ts-expect-error — plain JS extension module
import { parseSituations } from '../../ext/creations-ai/drive.js';
// @ts-expect-error — plain JS extension module
import { parseSinceThen } from '../../ext/creations-ai/since-then.js';
// @ts-expect-error — plain JS extension module
import { parseExtractionReply } from '../../ext/creations-ai/chat-memory.js';

type Schema = { type?: string | string[]; properties?: Record<string, Schema>; required?: string[]; items?: Schema; enum?: unknown[] };

/** A small validator for the subset these schemas use: object, array, string, number, null, enum, required. */
function valid(schema: Schema, value: unknown): boolean {
  if (schema.enum && !schema.enum.includes(value)) return false;
  const types = Array.isArray(schema.type) ? schema.type : schema.type ? [schema.type] : [];
  const is = (t: string) => (t === 'null' ? value === null
    : t === 'array' ? Array.isArray(value)
    : t === 'object' ? !!value && typeof value === 'object' && !Array.isArray(value)
    : typeof value === t);
  if (types.length && !types.some(is)) return false;
  if (Array.isArray(value) && schema.items) return value.every((v) => valid(schema.items!, v));
  if (value && typeof value === 'object' && !Array.isArray(value) && schema.properties) {
    const obj = value as Record<string, unknown>;
    if ((schema.required ?? []).some((k) => !(k in obj))) return false;
    return Object.entries(schema.properties).every(([k, s]) => !(k in obj) || valid(s, obj[k]));
  }
  return true;
}

describe('Creations answer schemas', () => {
  it('Act: the brief the parser reads, and nothing else', () => {
    const answer = { brief: 'They reach the harbour by night.' };
    expect(valid(NEXT_ACT_SCHEMA, answer)).toBe(true);
    expect(parseNextAct(JSON.stringify(answer))).toBe('They reach the harbour by night.');
    expect(valid(NEXT_ACT_SCHEMA, { text: 'x' })).toBe(false);
  });

  it('Test drive: the three situation kinds', () => {
    const answer = { situations: [{ kind: 'work', line: 'a' }, { kind: 'pressure', line: 'b' }, { kind: 'idle', line: 'c' }] };
    expect(valid(SITUATIONS_SCHEMA, answer)).toBe(true);
    expect(parseSituations(JSON.stringify(answer)).map((s: { line: string }) => s.line)).toEqual(['a', 'b', 'c']);
    expect(valid(SITUATIONS_SCHEMA, { situations: [{ kind: 'nap', line: 'z' }] })).toBe(false);
  });

  it('Story memory and chat memory', () => {
    expect(valid(STORY_MEMORY_SCHEMA, { memory: 'So far…' })).toBe(true);
    const extract = { facts: [{ text: 'Ada is left-handed.', category: 'trait', confidence: 0.6 }], beats: [{ summary: 'They fled.', importance: 0.8 }] };
    expect(valid(MEMORY_EXTRACT_SCHEMA, extract)).toBe(true);
    expect(parseExtractionReply(JSON.stringify(extract))).toEqual(extract);
    expect(valid(MEMORY_EXTRACT_SCHEMA, { facts: [{ text: 'x', category: 'mood', confidence: 1 }], beats: [] })).toBe(false);
    expect(MEMORY_CATEGORY_ORDER).toContain('other');
  });

  it('Since then: only the characters asked about', () => {
    const schema = sinceThenSchema(['Ada', 'Bo']);
    const answer = { since: [{ name: 'Ada', line: 'kept watch' }] };
    expect(valid(schema, answer)).toBe(true);
    expect(parseSinceThen(JSON.stringify(answer), ['Ada', 'Bo'])).toEqual([{ name: 'Ada', text: 'kept watch' }]);
    expect(valid(schema, { since: [{ name: 'Cy', line: 'x' }] })).toBe(false);
  });
});

describe('Budget stage schemas', () => {
  it('classify: the event types the stage accepts', () => {
    const schema = budgetStageSchema('classify', { eventTypes: ['purchase', 'deposit', 'transfer', 'fee', 'balance_summary', 'other'] });
    expect(valid(schema, { event_type: 'purchase', account_kind_hint: 'credit_card' })).toBe(true);
    expect(valid(schema, { event_type: 'spending', account_kind_hint: 'credit_card' })).toBe(false);
  });

  it('extract: items with a merchant or null', () => {
    const schema = budgetStageSchema('extract');
    const item = { merchant: null, amount: 12.5, card_last_four: '1234', account_kind_hint: 'checking', transaction_date: '2026-10-01', confidence: 'high' };
    expect(valid(schema, { items: [item] })).toBe(true);
    expect(valid(schema, { items: [{ ...item, amount: '12.50' }] })).toBe(false);
  });

  it('categorize: one of your categories, or Other', () => {
    const schema = budgetStageSchema('categorize', { categoryNames: ['Groceries', 'Fuel'] });
    expect(schema.properties.category.enum).toEqual(['Groceries', 'Fuel', 'Other']);
    expect(valid(schema, { category: 'Fuel' })).toBe(true);
    expect(valid(schema, { category: 'Fun' })).toBe(false);
  });

  it('snapshot: accounts with balances; an unknown stage has none', () => {
    const schema = budgetStageSchema('snapshot');
    expect(valid(schema, { snapshot_date: '2026-10-01', accounts: [{ account_kind: 'savings', account_last_four: null, balance: 100 }] })).toBe(true);
    expect(budgetStageSchema('default')).toBeUndefined();
  });
});
