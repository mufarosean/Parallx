// @vitest-environment jsdom
//
// canvasSelectionNormalize.test.ts — the selection model never holds a block
// AND its ancestor.
//
// The marquee can hit a parent row's line AND its nested rows' lines in one
// drag; keeping both painted the translucent .block-selected background twice
// over the nested rows (the parent's box spans its subtree) — the "overlap
// colour" artifact.  selectMultiple normalizes to top-most units, and
// owningSelectedBlock lets the handle-click guard resolve a click on a nested
// row to its selected parent instead of collapsing the selection.

import { describe, expect, it } from 'vitest';
import { Editor } from '@tiptap/core';
import StarterKit from '@tiptap/starter-kit';
import { BlockSelectionController } from '../../src/built-in/canvas/handles/blockSelection';
import { enumerateBlockUnits } from '../../src/built-in/canvas/config/blockStateRegistry/blockUnit';

function p(text: string) { return { type: 'paragraph', content: [{ type: 'text', text }] }; }
function li(text: string) { return { type: 'listItem', content: [p(text)] }; }

function makeController(content: any): { ed: Editor; sel: BlockSelectionController } {
  const ed = new Editor({
    element: document.createElement('div'),
    extensions: [StarterKit],
    content,
  });
  const host: any = {
    editor: ed,
    container: document.createElement('div'),
    editorContainer: document.createElement('div'),
    pageId: 'test',
  };
  const sel = new BlockSelectionController(host);
  return { ed, sel };
}

const NESTED = () => ({ type: 'doc', content: [
  { type: 'bulletList', content: [
    { type: 'listItem', content: [
      p('parent'),
      { type: 'bulletList', content: [li('childA'), li('childB')] },
    ]},
    { type: 'listItem', content: [p('sibling')] },
  ]},
]});

function unitPos(ed: Editor, text: string): number {
  const u = enumerateBlockUnits(ed.state.doc).find(
    (x) => x.node.child?.(0)?.textContent === text || x.node.textContent === text,
  );
  if (!u) throw new Error(`unit not found: ${text}`);
  return u.pos;
}

describe('selectMultiple normalizes to top-most units', () => {
  it('parent + its nested rows → parent only (children absorbed)', () => {
    const { ed, sel } = makeController(NESTED());
    const parent = unitPos(ed, 'parent');
    const childA = unitPos(ed, 'childA');
    const childB = unitPos(ed, 'childB');
    const sibling = unitPos(ed, 'sibling');

    sel.selectMultiple([parent, childA, childB, sibling]);
    expect(sel.positions).toEqual([parent, sibling]);
  });

  it('nested rows WITHOUT their parent stay individually selected', () => {
    const { ed, sel } = makeController(NESTED());
    const childA = unitPos(ed, 'childA');
    const childB = unitPos(ed, 'childB');

    sel.selectMultiple([childA, childB]);
    expect(sel.positions).toEqual([childA, childB]);
  });

  it('flat sibling rows are untouched by normalization', () => {
    const { ed, sel } = makeController({ type: 'doc', content: [
      { type: 'bulletList', content: [li('one'), li('two'), li('three')] },
    ]});
    const positions = ['one', 'two', 'three'].map((t) => unitPos(ed, t));
    sel.selectMultiple(positions);
    expect(sel.positions).toEqual(positions);
  });
});

describe('owningSelectedBlock (containment-aware handle-click guard)', () => {
  it('click on a nested row inside a selected parent resolves to the parent', () => {
    const { ed, sel } = makeController(NESTED());
    const parent = unitPos(ed, 'parent');
    const childA = unitPos(ed, 'childA');
    sel.selectMultiple([parent, unitPos(ed, 'sibling')]);

    expect(sel.owningSelectedBlock(childA)).toBe(parent);
    expect(sel.owningSelectedBlock(parent)).toBe(parent);
  });

  it('click on an unselected block returns null', () => {
    const { ed, sel } = makeController(NESTED());
    sel.selectMultiple([unitPos(ed, 'sibling')]);
    expect(sel.owningSelectedBlock(unitPos(ed, 'childA'))).toBeNull();
  });
});
