// @vitest-environment jsdom
//
// canvasInteractionMatrix.test.ts — Conversion × nesting × colour interactions
// on a REAL headless editor.
//
// These pin the semantics that the old toggle-lift machinery broke (verified
// by probes before the rewrite): nested rows were ejected to the top level,
// list-type changes silently converted sibling rows, a converted row's
// children were detached into the sibling list, and colour-carrying rows
// no-op'd entirely.  The in-place splice engine must keep:
//   • POSITION — a nested row converts where it stands (indent retained);
//   • SIBLINGS — untouched, keeping their own list type;
//   • CHILDREN — attached (inside containers / trailing at the same depth);
//   • COLOUR   — carried to the converted block when it can hold one.

import { describe, expect, it } from 'vitest';
import { Editor } from '@tiptap/core';
import StarterKit from '@tiptap/starter-kit';
import TaskList from '@tiptap/extension-task-list';
import TaskItem from '@tiptap/extension-task-item';
import { Details, DetailsSummary, DetailsContent } from '@tiptap/extension-details';
import { Callout } from '../../src/built-in/canvas/extensions/calloutNode';
import { ToggleHeading, ToggleHeadingText } from '../../src/built-in/canvas/extensions/toggleHeadingNode';
import { MathBlock } from '../../src/built-in/canvas/extensions/mathBlockNode';
import { BlockBackgroundColor } from '../../src/built-in/canvas/extensions/blockBackground';
import { BLOCK_BG_TYPES } from '../../src/built-in/canvas/config/blockRegistry';
import { turnBlockWithSharedStrategy } from '../../src/built-in/canvas/config/blockStateRegistry/blockTransforms';

const BG = 'rgba(69,26,0,1)';

function makeEditor(content: Record<string, any>): Editor {
  return new Editor({
    element: document.createElement('div'),
    extensions: [
      StarterKit,
      TaskList,
      TaskItem.configure({ nested: true }),
      Details, DetailsSummary, DetailsContent,
      Callout,
      ToggleHeading, ToggleHeadingText,
      MathBlock,
      BlockBackgroundColor.configure({ types: [...BLOCK_BG_TYPES] }),
    ],
    content,
  });
}

function p(text: string) {
  return { type: 'paragraph', content: [{ type: 'text', text }] };
}

function allText(ed: Editor): string[] {
  const out: string[] = [];
  ed.state.doc.descendants((node) => {
    if (node.isText && node.text) out.push(node.text);
    return true;
  });
  return out;
}

/** Top-level types minus the TrailingNode artifact (see canvasTransformBehavior). */
function topLevelTypes(ed: Editor): string[] {
  const out: string[] = [];
  ed.state.doc.forEach((node) => out.push(node.type.name));
  const last = ed.state.doc.child(ed.state.doc.childCount - 1);
  if (out.length > 1 && last.type.name === 'paragraph' && last.content.size === 0) {
    out.pop();
  }
  return out;
}

function findRow(ed: Editor, text: string): { pos: number; node: any } {
  let found: { pos: number; node: any } | null = null;
  ed.state.doc.descendants((node, pos) => {
    if ((node.type.name === 'listItem' || node.type.name === 'taskItem')
        && node.child(0)?.textContent === text && !found) {
      found = { pos, node };
      return false;
    }
    return true;
  });
  if (!found) throw new Error(`row not found: ${text}`);
  return found;
}

const NESTED_DOC = () => ({ type: 'doc', content: [
  { type: 'bulletList', content: [
    { type: 'listItem', content: [
      p('level1'),
      { type: 'bulletList', content: [
        { type: 'listItem', content: [
          p('level2-target'),
          { type: 'bulletList', content: [{ type: 'listItem', content: [p('level3-child')] }] },
        ]},
        { type: 'listItem', content: [p('level2-sibling')] },
      ]},
    ]},
  ]},
]});

describe('nested row conversion happens IN PLACE', () => {
  it('depth-2 row → blockquote keeps its indent, its children, and its sibling', () => {
    const ed = makeEditor(NESTED_DOC());
    const row = findRow(ed, 'level2-target');
    turnBlockWithSharedStrategy(ed, row.pos, row.node, 'blockquote');

    // Still exactly one top-level list; the quote lives INSIDE the level1 row.
    expect(topLevelTypes(ed)).toEqual(['bulletList']);
    const level1 = ed.state.doc.child(0).child(0);
    expect(level1.type.name).toBe('listItem');
    expect(level1.child(0).textContent).toBe('level1');
    const quote = level1.child(1);
    expect(quote.type.name).toBe('blockquote');
    expect(quote.textContent).toContain('level2-target');
    expect(quote.textContent).toContain('level3-child'); // children stay attached
    const siblingList = level1.child(2);
    expect(siblingList.type.name).toBe('bulletList');
    expect(siblingList.textContent).toBe('level2-sibling'); // sibling untouched
    expect(allText(ed)).toEqual(['level1', 'level2-target', 'level3-child', 'level2-sibling']);
  });

  it('depth-2 row → heading stays nested; children follow at the same depth', () => {
    const ed = makeEditor(NESTED_DOC());
    const row = findRow(ed, 'level2-target');
    turnBlockWithSharedStrategy(ed, row.pos, row.node, 'heading', { level: 3 });

    const level1 = ed.state.doc.child(0).child(0);
    const heading = level1.child(1);
    expect(heading.type.name).toBe('heading');
    expect(heading.textContent).toBe('level2-target');
    expect(level1.textContent).toContain('level3-child'); // still nested in level1 row
    expect(allText(ed)).toEqual(['level1', 'level2-target', 'level3-child', 'level2-sibling']);
  });

  it('middle row of a 3-row list → orderedList splits the list; siblings keep their type', () => {
    const ed = makeEditor({ type: 'doc', content: [
      { type: 'bulletList', content: [
        { type: 'listItem', content: [p('one')] },
        { type: 'listItem', content: [p('two')] },
        { type: 'listItem', content: [p('three')] },
      ]},
    ]});
    const row = findRow(ed, 'two');
    turnBlockWithSharedStrategy(ed, row.pos, row.node, 'orderedList');
    expect(topLevelTypes(ed)).toEqual(['bulletList', 'orderedList', 'bulletList']);
    expect(allText(ed)).toEqual(['one', 'two', 'three']);
  });

  it('row → same list type is a no-op', () => {
    const ed = makeEditor({ type: 'doc', content: [
      { type: 'bulletList', content: [{ type: 'listItem', content: [p('stay')] }] },
    ]});
    const before = JSON.stringify(ed.state.doc.toJSON());
    const row = findRow(ed, 'stay');
    turnBlockWithSharedStrategy(ed, row.pos, row.node, 'bulletList');
    expect(JSON.stringify(ed.state.doc.toJSON())).toBe(before);
  });

  it('nested row → callout wraps in place with children inside', () => {
    const ed = makeEditor(NESTED_DOC());
    const row = findRow(ed, 'level2-target');
    turnBlockWithSharedStrategy(ed, row.pos, row.node, 'callout');
    const level1 = ed.state.doc.child(0).child(0);
    const callout = level1.child(1);
    expect(callout.type.name).toBe('callout');
    expect(callout.textContent).toContain('level2-target');
    expect(callout.textContent).toContain('level3-child');
    expect(allText(ed)).toEqual(['level1', 'level2-target', 'level3-child', 'level2-sibling']);
  });

  it('bullet row → task row: single-row list converts whole (no stray wrappers)', () => {
    const ed = makeEditor({ type: 'doc', content: [
      { type: 'bulletList', content: [{ type: 'listItem', content: [p('todo')] }] },
    ]});
    const row = findRow(ed, 'todo');
    turnBlockWithSharedStrategy(ed, row.pos, row.node, 'taskList');
    expect(topLevelTypes(ed)).toEqual(['taskList']);
    const item = ed.state.doc.child(0).child(0);
    expect(item.type.name).toBe('taskItem');
    expect(item.attrs.checked).toBe(false);
    expect(allText(ed)).toEqual(['todo']);
  });
});

describe('colour travels with the block', () => {
  it('coloured paragraph → heading keeps the background', () => {
    const ed = makeEditor({ type: 'doc', content: [
      { type: 'paragraph', attrs: { backgroundColor: BG }, content: [{ type: 'text', text: 'colored' }] },
    ]});
    turnBlockWithSharedStrategy(ed, 0, ed.state.doc.child(0), 'heading', { level: 2 });
    expect(ed.state.doc.child(0).type.name).toBe('heading');
    expect(ed.state.doc.child(0).attrs.backgroundColor).toBe(BG);
  });

  it('coloured callout → heading carries the background out', () => {
    const ed = makeEditor({ type: 'doc', content: [
      { type: 'callout', attrs: { backgroundColor: BG }, content: [p('title'), p('body')] },
    ]});
    turnBlockWithSharedStrategy(ed, 0, ed.state.doc.child(0), 'heading', { level: 2 });
    expect(ed.state.doc.child(0).attrs.backgroundColor).toBe(BG);
    expect(allText(ed)).toEqual(['title', 'body']);
  });

  it('coloured nested row → paragraph converts in place and keeps the colour', () => {
    const ed = makeEditor(NESTED_DOC());
    const row = findRow(ed, 'level2-target');
    const tr = ed.state.tr;
    tr.setNodeMarkup(row.pos, undefined, { ...row.node.attrs, backgroundColor: BG });
    ed.view.dispatch(tr);

    const colored = findRow(ed, 'level2-target');
    expect(colored.node.attrs.backgroundColor).toBe(BG);
    turnBlockWithSharedStrategy(ed, colored.pos, colored.node, 'paragraph');

    const level1 = ed.state.doc.child(0).child(0);
    const para = level1.child(1);
    expect(para.type.name).toBe('paragraph');
    expect(para.textContent).toBe('level2-target');
    expect(para.attrs.backgroundColor).toBe(BG); // colour survived
    expect(level1.textContent).toContain('level3-child'); // children survived, nested
    expect(allText(ed)).toEqual(['level1', 'level2-target', 'level3-child', 'level2-sibling']);
  });

  it('coloured paragraph → bulletList puts the colour on the ROW (the colourable unit)', () => {
    const ed = makeEditor({ type: 'doc', content: [
      { type: 'paragraph', attrs: { backgroundColor: BG }, content: [{ type: 'text', text: 'bullet me' }] },
    ]});
    turnBlockWithSharedStrategy(ed, 0, ed.state.doc.child(0), 'bulletList');
    const list = ed.state.doc.child(0);
    expect(list.type.name).toBe('bulletList');
    expect(list.child(0).attrs.backgroundColor).toBe(BG);
  });

  it('coloured paragraph → mathBlock drops the background silently (atoms cannot hold one)', () => {
    const ed = makeEditor({ type: 'doc', content: [
      { type: 'paragraph', attrs: { backgroundColor: BG }, content: [{ type: 'text', text: 'x^2' }] },
    ]});
    turnBlockWithSharedStrategy(ed, 0, ed.state.doc.child(0), 'mathBlock');
    expect(ed.state.doc.child(0).type.name).toBe('mathBlock');
    expect(ed.state.doc.child(0).attrs.latex).toBe('x^2');
  });

  it('coloured row → quote carries the row colour onto the quote', () => {
    const ed = makeEditor(NESTED_DOC());
    const row = findRow(ed, 'level2-target');
    const tr = ed.state.tr;
    tr.setNodeMarkup(row.pos, undefined, { ...row.node.attrs, backgroundColor: BG });
    ed.view.dispatch(tr);

    const colored = findRow(ed, 'level2-target');
    turnBlockWithSharedStrategy(ed, colored.pos, colored.node, 'blockquote');
    const level1 = ed.state.doc.child(0).child(0);
    const quote = level1.child(1);
    expect(quote.type.name).toBe('blockquote');
    expect(quote.attrs.backgroundColor).toBe(BG);
  });
});
