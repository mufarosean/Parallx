// @vitest-environment jsdom
//
// canvasDropBehavior.test.ts — drag-drop mutation semantics on a REAL editor.
//
// These exercise the same primitive sequences columnDropPlugin's drop handler
// runs (insert at the aimed row boundary + deleteDraggedSource), pinning the
// two rules that were probe-verified broken:
//   • a drop between rows lands AT that gap — different-type content splits
//     the target list there (the old handler teleported to the list's edge);
//   • dragging the only row(s) out of a list dissolves the emptied wrapper —
//     no ghost rows at the source (emptied-wrapper policy, range form).

import { describe, expect, it } from 'vitest';
import { Editor } from '@tiptap/core';
import StarterKit from '@tiptap/starter-kit';
import TaskList from '@tiptap/extension-task-list';
import TaskItem from '@tiptap/extension-task-item';
import { Fragment } from '@tiptap/pm/model';
import {
  moveBlockAboveBelow,
  wrapDraggedListItemsForDrop,
} from '../../src/built-in/canvas/config/blockStateRegistry/blockMovement';
import { deleteDraggedSource } from '../../src/built-in/canvas/config/blockStateRegistry/columnInvariants';
import { growEmptiedAncestorRange } from '../../src/built-in/canvas/config/blockStateRegistry/blockLifecycle';

function p(text: string) { return { type: 'paragraph', content: [{ type: 'text', text }] }; }
function li(text: string) { return { type: 'listItem', content: [p(text)] }; }

function make(content: any): Editor {
  return new Editor({
    element: document.createElement('div'),
    extensions: [StarterKit, TaskList, TaskItem.configure({ nested: true })],
    content,
  });
}

function rowAt(ed: Editor, text: string): { pos: number; node: any } {
  let found: { pos: number; node: any } | null = null;
  ed.state.doc.descendants((n, pos) => {
    if ((n.type.name === 'listItem' || n.type.name === 'taskItem')
        && n.child(0)?.textContent === text && !found) {
      found = { pos, node: n };
      return false;
    }
    return true;
  });
  if (!found) throw new Error(`row not found: ${text}`);
  return found;
}

function topTypes(ed: Editor): string[] {
  const out: string[] = [];
  ed.state.doc.forEach((n) => out.push(n.type.name));
  const last = ed.state.doc.child(ed.state.doc.childCount - 1);
  if (out.length > 1 && last.type.name === 'paragraph' && last.content.size === 0) out.pop();
  return out;
}

function allText(ed: Editor): string[] {
  const out: string[] = [];
  ed.state.doc.descendants((n) => { if (n.isText && n.text) out.push(n.text); return true; });
  return out;
}

/** No empty ghost rows anywhere in the doc. */
function expectNoGhostRows(ed: Editor): void {
  ed.state.doc.descendants((n) => {
    if (n.type.name === 'listItem' || n.type.name === 'taskItem') {
      expect(n.textContent.length, 'ghost empty row found').toBeGreaterThan(0);
    }
    return true;
  });
}

describe('drop between rows lands at the aimed gap', () => {
  it('paragraph dropped above row "three" splits the list there', () => {
    const ed = make({ type: 'doc', content: [
      p('dragme'),
      { type: 'bulletList', content: [li('one'), li('two'), li('three')] },
    ]});
    const dragFrom = 0;
    const dragTo = ed.state.doc.child(0).nodeSize;
    const target = rowAt(ed, 'three');
    const content = Fragment.from(ed.state.schema.nodeFromJSON(p('dragme')));
    const { tr } = ed.state;
    moveBlockAboveBelow(tr, content, target.pos, dragFrom, dragTo, false);
    ed.view.dispatch(tr);

    expect(topTypes(ed)).toEqual(['bulletList', 'paragraph', 'bulletList']);
    expect(allText(ed)).toEqual(['one', 'two', 'dragme', 'three']);
    expectNoGhostRows(ed);
  });

  it('task row dropped above bullet row "two" splits the bullet list at that gap', () => {
    const ed = make({ type: 'doc', content: [
      { type: 'bulletList', content: [li('one'), li('two'), li('three')] },
      { type: 'taskList', content: [{ type: 'taskItem', attrs: { checked: false }, content: [p('task')] }] },
    ]});
    const src = rowAt(ed, 'task');
    const dragFrom = src.pos;
    const dragTo = src.pos + src.node.nodeSize;
    const target = rowAt(ed, 'two');
    const content = Fragment.from(ed.state.schema.nodeFromJSON(src.node.toJSON()));
    const { tr } = ed.state;
    // Handler's different-type branch: wrap in own list, insert AT the row
    // boundary (no jump to the list edge), delete source.
    const wrapped = wrapDraggedListItemsForDrop(ed.state.schema, content, 'taskList');
    tr.insert(target.pos, wrapped);
    deleteDraggedSource(tr, dragFrom, dragTo);
    ed.view.dispatch(tr);

    expect(topTypes(ed)).toEqual(['bulletList', 'taskList', 'bulletList']);
    expect(allText(ed)).toEqual(['one', 'task', 'two', 'three']);
    expectNoGhostRows(ed); // source task list dissolved, no ghost
  });
});

describe('drag source leaves no ghosts (emptied-wrapper policy)', () => {
  it('dragging the ONLY row of a nested list out dissolves the nested list', () => {
    const ed = make({ type: 'doc', content: [
      { type: 'bulletList', content: [
        { type: 'listItem', content: [
          p('parent'),
          { type: 'bulletList', content: [li('only-nested')] },
        ]},
      ]},
      p('landing'),
    ]});
    const src = rowAt(ed, 'only-nested');
    const dragFrom = src.pos;
    const dragTo = src.pos + src.node.nodeSize;
    const content = Fragment.from(ed.state.schema.nodeFromJSON(src.node.toJSON()));
    const landingEnd = ed.state.doc.child(0).nodeSize + ed.state.doc.child(1).nodeSize;
    const { tr } = ed.state;
    const wrapped = wrapDraggedListItemsForDrop(ed.state.schema, content, 'bulletList');
    tr.insert(landingEnd, wrapped);
    deleteDraggedSource(tr, dragFrom, dragTo);
    ed.view.dispatch(tr);

    expect(allText(ed)).toEqual(['parent', 'landing', 'only-nested']);
    expectNoGhostRows(ed);
    // parent row keeps only its own line — nested list wrapper gone
    const parentRow = rowAt(ed, 'parent');
    expect(parentRow.node.childCount).toBe(1);
  });

  it('dragging a single-row list into another list leaves no ghost list behind', () => {
    const ed = make({ type: 'doc', content: [
      { type: 'bulletList', content: [li('one'), li('two'), li('three')] },
      { type: 'bulletList', content: [li('dragme')] },
    ]});
    const src = rowAt(ed, 'dragme');
    const dragFrom = src.pos;
    const dragTo = src.pos + src.node.nodeSize;
    const target = rowAt(ed, 'two');
    const content = Fragment.from(ed.state.schema.nodeFromJSON(src.node.toJSON()));
    const { tr } = ed.state;
    moveBlockAboveBelow(tr, content, target.pos, dragFrom, dragTo, false);
    ed.view.dispatch(tr);

    expect(allText(ed)).toEqual(['one', 'dragme', 'two', 'three']);
    expect(topTypes(ed)).toEqual(['bulletList']);
    expectNoGhostRows(ed);
  });
});

describe('growEmptiedAncestorRange (range form)', () => {
  it('a range covering ALL rows of a list grows to the list', () => {
    const ed = make({ type: 'doc', content: [
      p('before'),
      { type: 'bulletList', content: [li('a'), li('b')] },
    ]});
    const a = rowAt(ed, 'a');
    const b = rowAt(ed, 'b');
    const grown = growEmptiedAncestorRange(ed.state.doc, a.pos, b.pos + b.node.nodeSize);
    // grew to cover the whole bulletList node
    const listPos = ed.state.doc.child(0).nodeSize;
    expect(grown.from).toBe(listPos);
    expect(grown.to).toBe(listPos + ed.state.doc.child(1).nodeSize);
  });

  it('a range covering SOME rows does not grow', () => {
    const ed = make({ type: 'doc', content: [
      { type: 'bulletList', content: [li('a'), li('b'), li('c')] },
    ]});
    const a = rowAt(ed, 'a');
    const b = rowAt(ed, 'b');
    const grown = growEmptiedAncestorRange(ed.state.doc, a.pos, b.pos + b.node.nodeSize);
    expect(grown.from).toBe(a.pos);
    expect(grown.to).toBe(b.pos + b.node.nodeSize);
  });
});
