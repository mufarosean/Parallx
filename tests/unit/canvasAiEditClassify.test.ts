import { describe, expect, it } from 'vitest';
import { classifySpan, blockText } from '../../src/built-in/canvas/canvasDocDiff';

const p = (id: string, text: string) => ({ type: 'paragraph', attrs: { id }, content: [{ type: 'text', text }] });
const h = (id: string, text: string) => ({ type: 'heading', attrs: { id, level: 2 }, content: [{ type: 'text', text }] });

describe('classifySpan (margin marks for an AI edit)', () => {
  it('marks new blocks as added and missing ones as removed', () => {
    const r = classifySpan([p('a', 'Old line')], [h('x', 'New heading'), p('a', 'Old line'), p('y', 'More')]);
    expect(r.kinds).toEqual(['added', null, 'added']);
    expect(r.removed).toEqual([]);
  });

  it('a block with the same id and new text is rewritten, with its old text', () => {
    const r = classifySpan([p('a', 'Two evenings lost.')], [p('a', 'Two evenings lost. Next week: a walk.')]);
    expect(r.kinds).toEqual(['changed']);
    expect(r.before[0]).toBe('Two evenings lost.');
  });

  it('a markdown rewrite with fresh ids still pairs blocks by place and type', () => {
    const r = classifySpan(
      [h('a', 'Title'), p('b', 'First'), p('c', 'Gone soon')],
      [h('n1', 'Title'), p('n2', 'First, rewritten')],
    );
    // Same content under a new id is untouched; the rewritten paragraph pairs
    // with its old self; the leftover old paragraph is removed.
    expect(r.kinds).toEqual([null, 'changed']);
    expect(r.before[1]).toBe('First');
    expect(r.removed).toEqual([2]);
  });

  it('does not pair blocks of different types', () => {
    const r = classifySpan([p('a', 'Text')], [h('n', 'Heading')]);
    expect(r.kinds).toEqual(['added']);
    expect(r.removed).toEqual([0]);
  });

  it('blockText flattens and trims', () => {
    expect(blockText({ type: 'bulletList', content: [{ type: 'listItem', content: [p('a', 'one')] }, { type: 'listItem', content: [p('b', 'two')] }] })).toBe('one two');
    expect(blockText(p('a', 'x'.repeat(300)), 20)).toHaveLength(20);
  });
});
