// blockApi.test.ts — M60 Phase δ T3: pure helpers for property queries +
// block-level addressing.

import { describe, it, expect } from 'vitest';
import {
  decodeDocContent,
  encodeDocContent,
  filterToSubquery,
  findBlockById,
  generateBlockId,
  insertAfter,
  iterateBlocks,
  nodeToPlainText,
  paragraphFromText,
  replaceAt,
} from '../../src/built-in/chat/tools/blockApi';

function makeDoc(): { type: 'doc'; content: any[] } {
  return {
    type: 'doc',
    content: [
      { type: 'paragraph', attrs: { id: 'b1' }, content: [{ type: 'text', text: 'first' }] },
      { type: 'paragraph', attrs: { id: 'b2' }, content: [{ type: 'text', text: 'second' }] },
      {
        type: 'bulletList',
        attrs: { id: 'b3' },
        content: [
          {
            type: 'listItem',
            attrs: { id: 'b3a' },
            content: [{ type: 'paragraph', attrs: { id: 'b3a-p' }, content: [{ type: 'text', text: 'item' }] }],
          },
        ],
      },
    ],
  };
}

describe('decodeDocContent / encodeDocContent', () => {
  it('round-trips a schema-versioned envelope', () => {
    const doc = makeDoc();
    const stored = encodeDocContent(doc);
    const decoded = decodeDocContent(stored);
    expect(decoded).toEqual(doc);
  });

  it('accepts a legacy bare doc', () => {
    const doc = makeDoc();
    const decoded = decodeDocContent(JSON.stringify(doc));
    expect(decoded).toEqual(doc);
  });

  it('returns null for invalid JSON or non-doc input', () => {
    expect(decodeDocContent('not json')).toBeNull();
    expect(decodeDocContent('{"foo":1}')).toBeNull();
    expect(decodeDocContent(null)).toBeNull();
  });
});

describe('filterToSubquery', () => {
  it('emits parametrized SQL for equals', () => {
    const r = filterToSubquery({ prop: 'status', op: 'equals', value: 'Draft' });
    expect(r.subquery).toContain('SELECT page_id');
    expect(r.subquery).toContain('value = ?');
    expect(r.params).toEqual(['status', JSON.stringify('Draft')]);
  });

  it('escapes LIKE wildcards in contains', () => {
    const r = filterToSubquery({ prop: 'tags', op: 'contains', value: '50%' });
    expect(r.params[1]).toBe('%50\\%%');
  });

  it('throws on unknown op', () => {
    expect(() => filterToSubquery({ prop: 'x', op: 'bogus' as any })).toThrow();
  });
});

describe('iterateBlocks / findBlockById', () => {
  it('walks every block with attrs.id', () => {
    const doc = makeDoc();
    const ids = [...iterateBlocks(doc)].map((h) => h.node.attrs!['id']);
    expect(ids).toEqual(['b1', 'b2', 'b3', 'b3a', 'b3a-p']);
  });

  it('finds a nested block by id and reports its path', () => {
    const doc = makeDoc();
    const hit = findBlockById(doc, 'b3a-p');
    expect(hit).not.toBeNull();
    expect(hit!.path).toEqual([2, 0, 0]);
  });

  it('returns null for unknown id', () => {
    expect(findBlockById(makeDoc(), 'nope')).toBeNull();
  });
});

describe('replaceAt / insertAfter', () => {
  it('replaces the block at path without mutating input', () => {
    const doc = makeDoc();
    const replacement = paragraphFromText('rewritten', 'b2');
    const next = replaceAt(doc, [1], replacement);
    expect(next.content![1]).toEqual(replacement);
    // Original untouched.
    expect(doc.content[1].content[0].text).toBe('second');
  });

  it('inserts a new node after the target', () => {
    const doc = makeDoc();
    const newNode = paragraphFromText('inserted', 'newId');
    const next = insertAfter(doc, [0], newNode);
    expect(next.content!.length).toBe(4);
    expect(next.content![1]).toEqual(newNode);
  });

  it('rejects insertAfter on doc root', () => {
    expect(() => insertAfter(makeDoc(), [], paragraphFromText('x', 'y'))).toThrow();
  });
});

describe('nodeToPlainText', () => {
  it('extracts text across nested nodes', () => {
    const doc = makeDoc();
    expect(nodeToPlainText(doc).trim()).toContain('first');
    expect(nodeToPlainText(doc).trim()).toContain('second');
    expect(nodeToPlainText(doc).trim()).toContain('item');
  });
});

describe('generateBlockId', () => {
  it('produces unique non-empty ids', () => {
    const ids = new Set<string>();
    for (let i = 0; i < 50; i++) ids.add(generateBlockId());
    expect(ids.size).toBe(50);
    for (const id of ids) expect(id.length).toBeGreaterThan(0);
  });
});

describe('round-trip: 100 docs preserve block ids across edits (M60 §13 risk)', () => {
  it('every block id survives encode → decode → mutate → encode → decode', () => {
    for (let i = 0; i < 100; i++) {
      const doc = makeDoc();
      const stored = encodeDocContent(doc);
      const decoded = decodeDocContent(stored)!;
      // Replace one block.
      const next = replaceAt(decoded, [1], paragraphFromText(`edit-${i}`, 'b2'));
      const stored2 = encodeDocContent(next);
      const decoded2 = decodeDocContent(stored2)!;
      const ids = [...iterateBlocks(decoded2)].map((h) => h.node.attrs!['id']);
      expect(ids).toContain('b1');
      expect(ids).toContain('b2');
      expect(ids).toContain('b3');
      expect(ids).toContain('b3a');
      expect(ids).toContain('b3a-p');
      // Uniqueness preserved.
      expect(new Set(ids).size).toBe(ids.length);
    }
  });
});
