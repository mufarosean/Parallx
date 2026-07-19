// @vitest-environment jsdom
//
// movement.probe.test.ts — HOSTILE probes for drop/movement semantics:
// hunting "moving to one place drops to another" and "moving blocks to
// containers creates something completely different". Every probe composes
// exactly what columnDropPlugin's drop handler runs (insert at the aimed
// boundary + deleteDraggedSource), then asserts the EXACT final structure —
// content must arrive structurally identical, land exactly where aimed, and
// leave no ghosts at the source.

import { describe, expect, it } from 'vitest';
import { Editor } from '@tiptap/core';
import StarterKit from '@tiptap/starter-kit';
import TaskList from '@tiptap/extension-task-list';
import TaskItem from '@tiptap/extension-task-item';
import { Details, DetailsSummary, DetailsContent } from '@tiptap/extension-details';
import { Fragment } from '@tiptap/pm/model';
import { TextSelection } from '@tiptap/pm/state';
import { Column, ColumnList } from '../../../src/built-in/canvas/extensions/columnNodes';
import { MathBlock } from '../../../src/built-in/canvas/extensions/mathBlockNode';
import { Callout } from '../../../src/built-in/canvas/extensions/calloutNode';
import {
  moveBlockAboveBelow,
  wrapDraggedListItemsForDrop,
  moveBlockUpWithinPageFlow,
  moveBlockDownWithinPageFlow,
} from '../../../src/built-in/canvas/config/blockStateRegistry/blockMovement';
import { deleteDraggedSource } from '../../../src/built-in/canvas/config/blockStateRegistry/columnInvariants';
import { indentBlock, outdentBlock } from '../../../src/built-in/canvas/config/blockStateRegistry/blockNesting';
import { resolveMovableBlock } from '../../../src/built-in/canvas/config/blockStateRegistry/columnInvariants';

const TestColumn = Column.extend({ content: 'block+' });

function makeEditor(content: Record<string, any>): Editor {
  return new Editor({
    element: document.createElement('div'),
    extensions: [
      StarterKit.configure({ dropcursor: false }),
      TaskList,
      TaskItem.configure({ nested: true }),
      TestColumn,
      ColumnList,
      MathBlock,
      Callout,
      Details, DetailsSummary, DetailsContent,
    ],
    content,
  });
}

function p(text: string) { return { type: 'paragraph', content: [{ type: 'text', text }] }; }
function li(text: string, ...extra: any[]) { return { type: 'listItem', content: [p(text), ...extra] }; }
function bl(...items: any[]) { return { type: 'bulletList', content: items }; }
function callout(...blocks: any[]) { return { type: 'callout', content: blocks }; }

function allText(ed: Editor): string[] {
  const out: string[] = [];
  ed.state.doc.descendants((n) => {
    if (n.isText && n.text) out.push(n.text);
    if (n.type.name === 'mathBlock' && n.attrs?.latex) out.push(String(n.attrs.latex));
    return true;
  });
  return out;
}

function shape(ed: Editor): string {
  function render(n: any): string {
    if (n.isTextblock) return `${n.type.name}"${n.textContent}"`;
    if (n.isAtom) return n.type.name;
    const kids: string[] = [];
    n.forEach((c: any) => kids.push(render(c)));
    return `${n.type.name}(${kids.join(',')})`;
  }
  const kids: string[] = [];
  ed.state.doc.forEach((c: any) => kids.push(render(c)));
  if (kids.length > 1 && kids[kids.length - 1] === 'paragraph""') kids.pop();
  return kids.join(',');
}

function expectNoGhosts(ed: Editor): void {
  ed.state.doc.descendants((n) => {
    if (n.type.name === 'listItem' || n.type.name === 'taskItem') {
      expect(n.textContent.length, 'ghost empty row').toBeGreaterThan(0);
    }
    if (n.type.name === 'columnList') {
      expect(n.childCount, 'orphaned columnList').toBeGreaterThanOrEqual(2);
    }
    return true;
  });
}

/** Find a node by type (+ optional exact textContent). */
function findNode(ed: Editor, typeName: string, text?: string): { pos: number; node: any } {
  let found: { pos: number; node: any } | null = null;
  ed.state.doc.descendants((n, pos) => {
    if (found) return false;
    if (n.type.name === typeName && (text === undefined || n.textContent === text)) {
      found = { pos, node: n };
      return false;
    }
    return true;
  });
  if (!found) throw new Error(`node not found: ${typeName}${text ? ` "${text}"` : ''}`);
  return found;
}

function frag(ed: Editor, json: any): Fragment {
  return Fragment.from(ed.state.schema.nodeFromJSON(json));
}

/** The drop handler's above/below path for non-list dragged content. */
function drop(ed: Editor, content: Fragment, insertPos: number, dragFrom: number, dragTo: number, dup = false): void {
  const { tr } = ed.state;
  moveBlockAboveBelow(tr, content, insertPos, dragFrom, dragTo, dup);
  ed.view.dispatch(tr);
}

// ═══════════════════════════════════════════════════════════════════════════
// Drops INTO containers arrive structurally identical
// ═══════════════════════════════════════════════════════════════════════════

describe('drops into containers keep the dragged structure', () => {
  it('paragraph dropped between two callout blocks lands exactly there as a paragraph', () => {
    const ed = makeEditor({ type: 'doc', content: [
      p('drag'),
      callout(p('c1'), p('c2')),
    ]});
    const src = findNode(ed, 'paragraph', 'drag');
    const target = findNode(ed, 'paragraph', 'c2');
    drop(ed, frag(ed, p('drag')), target.pos, src.pos, src.pos + src.node.nodeSize);

    expect(shape(ed)).toBe('callout(paragraph"c1",paragraph"drag",paragraph"c2")');
    expectNoGhosts(ed);
  });

  it('a CALLOUT with children dropped into details content survives as a callout', () => {
    const ed = makeEditor({ type: 'doc', content: [
      callout(p('inner1'), bl(li('innerrow'))),
      { type: 'details', content: [
        { type: 'detailsSummary', content: [{ type: 'text', text: 'sum' }] },
        { type: 'detailsContent', content: [p('d1'), p('d2')] },
      ]},
    ]});
    const src = findNode(ed, 'callout');
    const target = findNode(ed, 'paragraph', 'd2');
    drop(ed, frag(ed, callout(p('inner1'), bl(li('innerrow')))), target.pos, src.pos, src.pos + src.node.nodeSize);

    expect(shape(ed)).toContain(
      'detailsContent(paragraph"d1",callout(paragraph"inner1",bulletList(listItem(paragraph"innerrow"))),paragraph"d2")',
    );
    expectNoGhosts(ed);
  });

  it('a whole bulletList dropped into a callout stays ONE list with all rows', () => {
    const ed = makeEditor({ type: 'doc', content: [
      bl(li('r1'), li('r2')),
      callout(p('c1')),
    ]});
    const src = findNode(ed, 'bulletList');
    const target = findNode(ed, 'paragraph', 'c1');
    drop(ed, frag(ed, bl(li('r1'), li('r2'))), target.pos, src.pos, src.pos + src.node.nodeSize);

    expect(shape(ed)).toBe('callout(bulletList(listItem(paragraph"r1"),listItem(paragraph"r2")),paragraph"c1")');
    expectNoGhosts(ed);
  });

  it('a mathBlock dropped into a COLUMN stays an atom with its latex', () => {
    const ed = makeEditor({ type: 'doc', content: [
      { type: 'mathBlock', attrs: { latex: '\\sum' } },
      { type: 'columnList', content: [
        { type: 'column', content: [p('a1')] },
        { type: 'column', content: [p('b1')] },
      ]},
    ]});
    const src = findNode(ed, 'mathBlock');
    const target = findNode(ed, 'paragraph', 'b1');
    drop(ed, frag(ed, { type: 'mathBlock', attrs: { latex: '\\sum' } }), target.pos, src.pos, src.pos + src.node.nodeSize);

    expect(allText(ed)).toEqual(['a1', '\\sum', 'b1']);
    let mathInColumn = false;
    ed.state.doc.descendants((n, pos) => {
      if (n.type.name === 'mathBlock') {
        const $p = ed.state.doc.resolve(pos);
        for (let d = $p.depth; d > 0; d--) if ($p.node(d).type.name === 'column') mathInColumn = true;
      }
      return true;
    });
    expect(mathInColumn).toBe(true);
    expectNoGhosts(ed);
  });

  it('a single row dropped into a DIFFERENT-type list gap inside a callout splits that list there', () => {
    const ed = makeEditor({ type: 'doc', content: [
      { type: 'taskList', content: [
        { type: 'taskItem', attrs: { checked: true }, content: [p('task')] },
      ]},
      callout(bl(li('one'), li('two'))),
    ]});
    const src = findNode(ed, 'taskItem');
    const target = findNode(ed, 'listItem', 'two');
    const wrapped = wrapDraggedListItemsForDrop(
      ed.state.schema,
      frag(ed, { type: 'taskItem', attrs: { checked: true }, content: [p('task')] }),
      'taskList',
    );
    const { tr } = ed.state;
    tr.insert(target.pos, wrapped);
    deleteDraggedSource(tr, src.pos, src.pos + src.node.nodeSize);
    ed.view.dispatch(tr);

    expect(allText(ed)).toEqual(['one', 'task', 'two']);
    expect(shape(ed)).toContain('taskItem(paragraph"task")');
    expectNoGhosts(ed);
  });
});

// ═══════════════════════════════════════════════════════════════════════════
// Drop precision: lands exactly at the aimed gap
// ═══════════════════════════════════════════════════════════════════════════

describe('drop precision on a mixed document', () => {
  function mixedDoc(): Editor {
    return makeEditor({ type: 'doc', content: [
      p('drag'),
      p('A'),
      bl(li('L1'), li('L2')),
      callout(p('C')),
      { type: 'mathBlock', attrs: { latex: 'M' } },
      p('B'),
    ]});
  }

  it('above paragraph A', () => {
    const ed = mixedDoc();
    const src = findNode(ed, 'paragraph', 'drag');
    const t = findNode(ed, 'paragraph', 'A');
    drop(ed, frag(ed, p('drag')), t.pos, src.pos, src.pos + src.node.nodeSize);
    expect(allText(ed)).toEqual(['drag', 'A', 'L1', 'L2', 'C', 'M', 'B']);
  });

  it('below the whole list (aimed below row L2 = list end)', () => {
    const ed = mixedDoc();
    const src = findNode(ed, 'paragraph', 'drag');
    const t = findNode(ed, 'listItem', 'L2');
    drop(ed, frag(ed, p('drag')), t.pos + t.node.nodeSize, src.pos, src.pos + src.node.nodeSize);
    expect(allText(ed)).toEqual(['A', 'L1', 'L2', 'drag', 'C', 'M', 'B']);
  });

  it('between the rows (aimed above L2)', () => {
    const ed = mixedDoc();
    const src = findNode(ed, 'paragraph', 'drag');
    const t = findNode(ed, 'listItem', 'L2');
    drop(ed, frag(ed, p('drag')), t.pos, src.pos, src.pos + src.node.nodeSize);
    expect(allText(ed)).toEqual(['A', 'L1', 'drag', 'L2', 'C', 'M', 'B']);
  });

  it('above the callout', () => {
    const ed = mixedDoc();
    const src = findNode(ed, 'paragraph', 'drag');
    const t = findNode(ed, 'callout');
    drop(ed, frag(ed, p('drag')), t.pos, src.pos, src.pos + src.node.nodeSize);
    expect(allText(ed)).toEqual(['A', 'L1', 'L2', 'drag', 'C', 'M', 'B']);
  });

  it('below the mathBlock', () => {
    const ed = mixedDoc();
    const src = findNode(ed, 'paragraph', 'drag');
    const t = findNode(ed, 'mathBlock');
    drop(ed, frag(ed, p('drag')), t.pos + t.node.nodeSize, src.pos, src.pos + src.node.nodeSize);
    expect(allText(ed)).toEqual(['A', 'L1', 'L2', 'C', 'M', 'drag', 'B']);
  });
});

// ═══════════════════════════════════════════════════════════════════════════
// Multi-row drags + duplicates
// ═══════════════════════════════════════════════════════════════════════════

describe('multi-row drags and duplicates', () => {
  it('two contiguous rows dragged to top level leave the remaining list intact', () => {
    const ed = makeEditor({ type: 'doc', content: [
      bl(li('r1'), li('r2'), li('r3')),
      p('landing'),
    ]});
    const r1 = findNode(ed, 'listItem', 'r1');
    const r2 = findNode(ed, 'listItem', 'r2');
    const landing = findNode(ed, 'paragraph', 'landing');
    const wrapped = wrapDraggedListItemsForDrop(
      ed.state.schema,
      Fragment.from([ed.state.schema.nodeFromJSON(li('r1')), ed.state.schema.nodeFromJSON(li('r2'))]),
      'bulletList',
    );
    const { tr } = ed.state;
    tr.insert(landing.pos + landing.node.nodeSize, wrapped);
    deleteDraggedSource(tr, r1.pos, r2.pos + r2.node.nodeSize);
    ed.view.dispatch(tr);

    expect(allText(ed)).toEqual(['r3', 'landing', 'r1', 'r2']);
    expectNoGhosts(ed);
  });

  it('ALL rows dragged out dissolve the source list entirely', () => {
    const ed = makeEditor({ type: 'doc', content: [
      bl(li('r1'), li('r2')),
      p('landing'),
    ]});
    const r1 = findNode(ed, 'listItem', 'r1');
    const r2 = findNode(ed, 'listItem', 'r2');
    const landing = findNode(ed, 'paragraph', 'landing');
    const wrapped = wrapDraggedListItemsForDrop(
      ed.state.schema,
      Fragment.from([ed.state.schema.nodeFromJSON(li('r1')), ed.state.schema.nodeFromJSON(li('r2'))]),
      'bulletList',
    );
    const { tr } = ed.state;
    tr.insert(landing.pos + landing.node.nodeSize, wrapped);
    deleteDraggedSource(tr, r1.pos, r2.pos + r2.node.nodeSize);
    ed.view.dispatch(tr);

    expect(shape(ed)).toBe('paragraph"landing",bulletList(listItem(paragraph"r1"),listItem(paragraph"r2"))');
    expectNoGhosts(ed);
  });

  it('Alt-drag duplicate leaves the source untouched', () => {
    const ed = makeEditor({ type: 'doc', content: [
      callout(p('inner')),
      p('landing'),
    ]});
    const src = findNode(ed, 'callout');
    const landing = findNode(ed, 'paragraph', 'landing');
    drop(ed, frag(ed, callout(p('inner'))), landing.pos + landing.node.nodeSize,
      src.pos, src.pos + src.node.nodeSize, /* dup */ true);

    expect(shape(ed)).toBe('callout(paragraph"inner"),paragraph"landing",callout(paragraph"inner")');
  });
});

// ═══════════════════════════════════════════════════════════════════════════
// Keyboard movement + indent/outdent
// ═══════════════════════════════════════════════════════════════════════════

describe('keyboard movement and nesting', () => {
  function setCursorIn(ed: Editor, text: string): void {
    let pos = -1;
    ed.state.doc.descendants((n, np) => {
      if (pos >= 0) return false;
      if (n.isTextblock && n.textContent === text) { pos = np; return false; }
      return true;
    });
    ed.view.dispatch(ed.state.tr.setSelection(TextSelection.create(ed.state.doc, pos + 1)));
  }

  it('Mod-Shift-Down over a columnList jumps past the whole layout, not into it', () => {
    const ed = makeEditor({ type: 'doc', content: [
      p('mover'),
      { type: 'columnList', content: [
        { type: 'column', content: [p('a1')] },
        { type: 'column', content: [p('b1')] },
      ]},
      p('tail'),
    ]});
    setCursorIn(ed, 'mover');
    const r = moveBlockDownWithinPageFlow(ed as any);
    expect(r.moved).toBe(true);

    expect(allText(ed)).toEqual(['a1', 'b1', 'mover', 'tail']);
    // Layout untouched.
    const cl = findNode(ed, 'columnList');
    expect(cl.node.childCount).toBe(2);
  });

  it('Mod-Shift-Up back over the layout is a clean round-trip', () => {
    const ed = makeEditor({ type: 'doc', content: [
      { type: 'columnList', content: [
        { type: 'column', content: [p('a1')] },
        { type: 'column', content: [p('b1')] },
      ]},
      p('mover'),
    ]});
    setCursorIn(ed, 'mover');
    const r = moveBlockUpWithinPageFlow(ed as any);
    expect(r.moved).toBe(true);
    expect(allText(ed)).toEqual(['mover', 'a1', 'b1']);
  });

  it('indent after a callout tucks the block INSIDE; outdent brings it back out', () => {
    const ed = makeEditor({ type: 'doc', content: [
      callout(p('c1')),
      p('x'),
      p('tail'),
    ]});
    const before = shape(ed);
    {
      const unit = resolveMovableBlock(ed.state.doc.resolve(findNode(ed, 'paragraph', 'x').pos + 1))!;
      expect(indentBlock(ed as any, unit.pos, unit.node)).toBe(true);
    }
    expect(shape(ed)).toBe('callout(paragraph"c1",paragraph"x"),paragraph"tail"');
    {
      const unit = resolveMovableBlock(ed.state.doc.resolve(findNode(ed, 'paragraph', 'x').pos + 1))!;
      expect(outdentBlock(ed as any, unit.pos, unit.node)).toBe(true);
    }
    expect(shape(ed)).toBe(before);
  });

  it('indent when the previous sibling is a columnList does NOT nest into the columns', () => {
    const ed = makeEditor({ type: 'doc', content: [
      { type: 'columnList', content: [
        { type: 'column', content: [p('a1')] },
        { type: 'column', content: [p('b1')] },
      ]},
      p('x'),
    ]});
    const unit = resolveMovableBlock(ed.state.doc.resolve(findNode(ed, 'paragraph', 'x').pos + 1))!;
    const before = shape(ed);
    const result = indentBlock(ed as any, unit.pos, unit.node);
    if (result) {
      // If it indented, it must NOT have gone inside a column.
      const xNow = findNode(ed, 'paragraph', 'x');
      const $p = ed.state.doc.resolve(xNow.pos);
      for (let d = $p.depth; d > 0; d--) {
        expect($p.node(d).type.name).not.toBe('column');
        expect($p.node(d).type.name).not.toBe('columnList');
      }
    } else {
      expect(shape(ed)).toBe(before);
    }
  });
});
