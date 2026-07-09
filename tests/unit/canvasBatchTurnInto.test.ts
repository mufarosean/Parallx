// @vitest-environment jsdom
//
// canvasBatchTurnInto.test.ts — box-select N blocks → Turn Into converts
// EVERY selected block.
//
// This drives the REAL BlockActionMenuController batch path (show() on an
// anchor that is part of a multi-selection, then _turnBlockInto) — not a
// re-simulation of its loop — with selections built from the same unit
// positions the marquee produces (enumerateBlockUnits).  Pins the
// descending-order + re-resolve-from-live-doc semantics against the in-place
// splice engine.

import { describe, expect, it } from 'vitest';
import { Editor } from '@tiptap/core';
import StarterKit from '@tiptap/starter-kit';
import TaskList from '@tiptap/extension-task-list';
import TaskItem from '@tiptap/extension-task-item';
// AutoJoiner runs in the real editor and merges adjacent same-type lists
// after every dispatch — included so the batch loop is exercised against the
// same position-shifting append-transactions the app has.
import AutoJoiner from 'tiptap-extension-auto-joiner';
import { Callout } from '../../src/built-in/canvas/extensions/calloutNode';
import { BlockActionMenuController } from '../../src/built-in/canvas/menus/blockActionMenu';
import { enumerateBlockUnits } from '../../src/built-in/canvas/config/blockStateRegistry/blockUnit';

function p(text: string) { return { type: 'paragraph', content: [{ type: 'text', text }] }; }
function li(text: string) { return { type: 'listItem', content: [p(text)] }; }

function makeEditor(content: any): Editor {
  return new Editor({
    element: document.createElement('div'),
    extensions: [StarterKit, TaskList, TaskItem.configure({ nested: true }), Callout, AutoJoiner],
    content,
  });
}

/** Minimal registry stub — only what the menu render path touches. */
const registryStub: any = {
  register: () => ({ dispose: () => {} }),
  notifyShow: () => {},
  labelForBlockType: (n: string) => n,
  getTurnIntoBlocks: () => [],
};

/** Real-shape selection backing (the marquee feeds positions the same way). */
function makeSelection(positions: number[]) {
  return {
    hasSelection: positions.length > 0,
    positions: [...positions].sort((a, b) => a - b),
    clear() { this.positions = []; (this as any).hasSelection = false; },
    deleteSelected() {},
    duplicateSelected() {},
  };
}

/**
 * Box-select the units matching `texts`, open the menu on the FIRST of them
 * (as clicking its handle would), and run Turn Into via the real batch path.
 */
function batchTurnInto(ed: Editor, texts: string[], target: string, attrs?: any): void {
  const units = enumerateBlockUnits(ed.state.doc)
    .filter(u => texts.some(t => u.node.child?.(0)?.textContent === t || u.node.textContent === t));
  expect(units.length, `selected units for ${texts.join(',')}`).toBe(texts.length);

  const selection = makeSelection(units.map(u => u.pos));
  const menu = new BlockActionMenuController(
    { editor: ed, pageId: 'test-page', blockSelection: selection as any },
    registryStub,
  );
  menu.create();

  const anchor = units[0];
  menu.show(anchor.pos, anchor.node, new DOMRect(0, 0, 10, 10));
  (menu as any)._turnBlockInto(target, attrs);
}

function allText(ed: Editor): string[] {
  const out: string[] = [];
  ed.state.doc.descendants((n) => { if (n.isText && n.text) out.push(n.text); return true; });
  return out;
}

function countType(ed: Editor, typeName: string): number {
  let c = 0;
  ed.state.doc.descendants((n) => { if (n.type.name === typeName) c++; return true; });
  return c;
}

describe('box-select + Turn Into converts EVERY selected block', () => {
  it('3 flat bullet rows → quote: all three convert', () => {
    const ed = makeEditor({ type: 'doc', content: [
      { type: 'bulletList', content: [li('one'), li('two'), li('three')] },
    ]});
    batchTurnInto(ed, ['one', 'two', 'three'], 'blockquote');
    expect(countType(ed, 'blockquote')).toBe(3);
    expect(countType(ed, 'listItem')).toBe(0);
    expect(allText(ed)).toEqual(['one', 'two', 'three']);
  });

  it('parent row + its nested rows → quote: all four convert', () => {
    const ed = makeEditor({ type: 'doc', content: [
      { type: 'bulletList', content: [
        { type: 'listItem', content: [
          p('parent'),
          { type: 'bulletList', content: [li('childA'), li('childB')] },
        ]},
        { type: 'listItem', content: [p('sibling')] },
      ]},
    ]});
    batchTurnInto(ed, ['parent', 'childA', 'childB', 'sibling'], 'blockquote');
    expect(countType(ed, 'blockquote')).toBe(4);
    expect(countType(ed, 'listItem')).toBe(0);
    expect(allText(ed).sort()).toEqual(['childA', 'childB', 'parent', 'sibling'].sort());
  });

  it('3 bullet rows → numbered list: every row becomes an ordered row', () => {
    const ed = makeEditor({ type: 'doc', content: [
      { type: 'bulletList', content: [li('one'), li('two'), li('three')] },
    ]});
    batchTurnInto(ed, ['one', 'two', 'three'], 'orderedList');
    expect(countType(ed, 'bulletList')).toBe(0);
    // AutoJoiner merges the per-splice single-row lists into ONE ordered list.
    expect(countType(ed, 'orderedList')).toBe(1);
    expect(countType(ed, 'listItem')).toBe(3);
    expect(allText(ed)).toEqual(['one', 'two', 'three']);
  });

  it('mixed selection (paragraph + row + callout) → heading: every block converts', () => {
    const ed = makeEditor({ type: 'doc', content: [
      p('plain'),
      { type: 'bulletList', content: [li('row')] },
      { type: 'callout', content: [p('boxed'), p('body')] },
    ]});
    batchTurnInto(ed, ['plain', 'row', 'boxedbody'], 'heading', { level: 2 });
    expect(countType(ed, 'heading')).toBe(3);
    expect(countType(ed, 'callout')).toBe(0);
    expect(countType(ed, 'listItem')).toBe(0);
    // callout body block survives as trailing sibling (no-data-loss invariant)
    expect(allText(ed)).toEqual(['plain', 'row', 'boxed', 'body']);
  });

  it('task rows → bullet rows: every row converts, checked state dropped', () => {
    const ed = makeEditor({ type: 'doc', content: [
      { type: 'taskList', content: [
        { type: 'taskItem', attrs: { checked: true }, content: [p('t1')] },
        { type: 'taskItem', attrs: { checked: false }, content: [p('t2')] },
      ]},
    ]});
    batchTurnInto(ed, ['t1', 't2'], 'bulletList');
    expect(countType(ed, 'taskItem')).toBe(0);
    expect(countType(ed, 'listItem')).toBe(2);
    expect(allText(ed)).toEqual(['t1', 't2']);
  });

  it('same-type no-op members are skipped silently, rest convert (Notion parity)', () => {
    const ed = makeEditor({ type: 'doc', content: [
      { type: 'blockquote', content: [p('already-quote')] },
      p('make-me-quote'),
    ]});
    batchTurnInto(ed, ['already-quote', 'make-me-quote'], 'blockquote');
    expect(countType(ed, 'blockquote')).toBe(2);
    expect(allText(ed)).toEqual(['already-quote', 'make-me-quote']);
  });
});
