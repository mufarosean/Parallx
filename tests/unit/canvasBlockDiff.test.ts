import { describe, expect, it } from 'vitest';
import { Schema } from '@tiptap/pm/model';
import { EditorState, TextSelection } from '@tiptap/pm/state';
import { diffTopLevel, computeReplaceRange, deepEqual } from '../../src/built-in/canvas/canvasDocDiff';

// Minimal schema: top-level paragraphs carrying a stable `id` attr (mirrors the
// canvas UniqueID model) — enough to exercise diff + transaction application
// without an editor view.
const schema = new Schema({
  nodes: {
    doc: { content: 'block+' },
    paragraph: {
      group: 'block',
      attrs: { id: { default: null } },
      content: 'text*',
      toDOM: () => ['p', 0],
      parseDOM: [{ tag: 'p' }],
    },
    text: {},
  },
});

const para = (id: string, text: string) => schema.node('paragraph', { id }, text ? [schema.text(text)] : []);
const doc = (...ps: ReturnType<typeof para>[]) => schema.node('doc', null, ps);
const children = (d: ReturnType<typeof doc>) => d.toJSON().content as unknown[];

describe('diffTopLevel — localizing the changed span', () => {
  it('returns null for identical docs', () => {
    const d = doc(para('a', 'A'), para('b', 'B'));
    expect(diffTopLevel(children(d), children(d))).toBeNull();
  });

  it('localizes a single changed middle block', () => {
    const oldD = children(doc(para('a', 'A'), para('b', 'B'), para('c', 'C')));
    const newD = children(doc(para('a', 'A'), para('b', 'B-edited'), para('c', 'C')));
    expect(diffTopLevel(oldD, newD)).toEqual({ start: 1, oldEnd: 2, newEnd: 2 });
  });

  it('localizes an append (common prefix = whole old doc)', () => {
    const oldD = children(doc(para('a', 'A'), para('b', 'B')));
    const newD = children(doc(para('a', 'A'), para('b', 'B'), para('c', 'C')));
    expect(diffTopLevel(oldD, newD)).toEqual({ start: 2, oldEnd: 2, newEnd: 3 });
  });

  it('localizes an insert in the middle', () => {
    const oldD = children(doc(para('a', 'A'), para('c', 'C')));
    const newD = children(doc(para('a', 'A'), para('b', 'B'), para('c', 'C')));
    expect(diffTopLevel(oldD, newD)).toEqual({ start: 1, oldEnd: 1, newEnd: 2 });
  });

  it('localizes a deletion', () => {
    const oldD = children(doc(para('a', 'A'), para('b', 'B'), para('c', 'C')));
    const newD = children(doc(para('a', 'A'), para('c', 'C')));
    expect(diffTopLevel(oldD, newD)).toEqual({ start: 1, oldEnd: 2, newEnd: 1 });
  });

  it('handles a full replacement (no common prefix/suffix)', () => {
    const oldD = children(doc(para('a', 'A'), para('b', 'B')));
    const newD = children(doc(para('x', 'X'), para('y', 'Y')));
    expect(diffTopLevel(oldD, newD)).toEqual({ start: 0, oldEnd: 2, newEnd: 2 });
  });
});

describe('surgical transaction application (replaceWith over the changed span)', () => {
  function apply(oldDoc: ReturnType<typeof doc>, newDoc: ReturnType<typeof doc>, cursorPos?: number) {
    const oldNodes = children(oldDoc);
    const newNodes = children(newDoc);
    const diff = diffTopLevel(oldNodes, newNodes)!;
    const { from, to } = computeReplaceRange(oldDoc, diff);
    const newMiddle = newNodes.slice(diff.start, diff.newEnd).map((j) => schema.nodeFromJSON(j as any));
    let state = EditorState.create({ doc: oldDoc });
    if (cursorPos != null) state = state.apply(state.tr.setSelection(TextSelection.create(state.doc, cursorPos)));
    const tr = state.tr.replaceWith(from, to, newMiddle);
    const mapped = state.selection.map(tr.doc, tr.mapping);
    tr.setSelection(mapped);
    return state.apply(tr);
  }

  it('a middle edit yields exactly the new doc', () => {
    const oldDoc = doc(para('a', 'A'), para('b', 'B'), para('c', 'C'));
    const newDoc = doc(para('a', 'A'), para('b', 'B-edited'), para('c', 'C'));
    expect(apply(oldDoc, newDoc).doc.toJSON()).toEqual(newDoc.toJSON());
  });

  it('preserves the cursor when the edit is in a DIFFERENT block', () => {
    const oldDoc = doc(para('a', 'Hello'), para('b', 'B'), para('c', 'C'));
    const newDoc = doc(para('a', 'Hello'), para('b', 'B-edited'), para('c', 'C'));
    // cursor inside block A (pos 3 = between 'He' and 'llo')
    const after = apply(oldDoc, newDoc, 3);
    expect(after.doc.toJSON()).toEqual(newDoc.toJSON());
    expect(after.selection.from).toBe(3); // untouched — surgical, not a rebuild
  });

  it('an append leaves earlier blocks (and a cursor in them) untouched', () => {
    const oldDoc = doc(para('a', 'A'), para('b', 'B'));
    const newDoc = doc(para('a', 'A'), para('b', 'B'), para('c', 'C'));
    const after = apply(oldDoc, newDoc, 2);
    expect(after.doc.toJSON()).toEqual(newDoc.toJSON());
    expect(after.selection.from).toBe(2);
  });
});

describe('deepEqual', () => {
  it('distinguishes content + attrs, ignores key order', () => {
    expect(deepEqual({ a: 1, b: 2 }, { b: 2, a: 1 })).toBe(true);
    expect(deepEqual({ a: 1 }, { a: 2 })).toBe(false);
    expect(deepEqual([1, 2], [1, 2])).toBe(true);
    expect(deepEqual([1, 2], [2, 1])).toBe(false);
  });
});
