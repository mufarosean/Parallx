// @vitest-environment jsdom
//
// structure.probe.test.ts — HOSTILE probes for structural lifecycle:
// deep-layered documents, delete/duplicate policy, unit resolution
// round-trips, column-corruption repair, undo/redo integrity, atom
// edge cases, and Enter at converted-structure boundaries (the surface the
// 2026-07-09 rebuild memo flagged as un-rederived).

import { describe, expect, it } from 'vitest';
import { Editor } from '@tiptap/core';
import StarterKit from '@tiptap/starter-kit';
import TaskList from '@tiptap/extension-task-list';
import TaskItem from '@tiptap/extension-task-item';
import { Details, DetailsSummary, DetailsContent } from '@tiptap/extension-details';
import { TextSelection } from '@tiptap/pm/state';
import { Column, ColumnList } from '../../../src/built-in/canvas/extensions/columnNodes';
import { MathBlock } from '../../../src/built-in/canvas/extensions/mathBlockNode';
import { Callout } from '../../../src/built-in/canvas/extensions/calloutNode';
import { DetailsEnterHandler } from '../../../src/built-in/canvas/extensions/detailsEnterHandler';
import { ListKeyboardPolicy } from '../../../src/built-in/canvas/extensions/listKeyboardPolicy';
import { deleteBlockAt, duplicateBlockAt } from '../../../src/built-in/canvas/config/blockStateRegistry/blockLifecycle';
import {
  resolveBlockUnit,
  enumerateBlockUnits,
} from '../../../src/built-in/canvas/config/blockStateRegistry/blockUnit';
import { isColumnEffectivelyEmpty } from '../../../src/built-in/canvas/config/blockStateRegistry/columnInvariants';

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
      DetailsEnterHandler,
      ListKeyboardPolicy,
    ],
    content,
  });
}

function p(text: string) { return { type: 'paragraph', content: [{ type: 'text', text }] }; }
function pEmpty() { return { type: 'paragraph' }; }
function li(text: string, ...extra: any[]) { return { type: 'listItem', content: [p(text), ...extra] }; }
function bl(...items: any[]) { return { type: 'bulletList', content: items }; }
function callout(...blocks: any[]) { return { type: 'callout', content: blocks }; }
function math(latex: string) { return { type: 'mathBlock', attrs: { latex } }; }

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
    if (n.isAtom) return `${n.type.name}[${n.attrs?.latex ?? ''}]`;
    const kids: string[] = [];
    n.forEach((c: any) => kids.push(render(c)));
    return `${n.type.name}(${kids.join(',')})`;
  }
  const kids: string[] = [];
  ed.state.doc.forEach((c: any) => kids.push(render(c)));
  if (kids.length > 1 && kids[kids.length - 1] === 'paragraph""') kids.pop();
  return kids.join(',');
}

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

function expectNoGhosts(ed: Editor): void {
  ed.state.doc.descendants((n) => {
    if (n.type.name === 'listItem' || n.type.name === 'taskItem') {
      expect(n.textContent.length, 'ghost empty row').toBeGreaterThan(0);
    }
    return true;
  });
}

function press(ed: Editor, key: string, init: KeyboardEventInit = {}): void {
  ed.view.dom.dispatchEvent(new KeyboardEvent('keydown', { key, bubbles: true, cancelable: true, ...init }));
}

function cursorIn(ed: Editor, text: string, offset = 0): void {
  const pos = findNode(ed, 'paragraph', text).pos + 1 + offset;
  ed.view.dispatch(ed.state.tr.setSelection(TextSelection.create(ed.state.doc, pos)));
}

/** The deep-layered monster the user asked for. */
function monsterDoc(): Record<string, any> {
  return { type: 'doc', content: [
    { type: 'columnList', content: [
      { type: 'column', content: [
        callout(p('c-title'), bl(li('row1', bl(li('nested1'), li('nested2'))))),
        math('\\alpha+\\beta'),
      ]},
      { type: 'column', content: [
        { type: 'details', content: [
          { type: 'detailsSummary', content: [{ type: 'text', text: 'sum' }] },
          { type: 'detailsContent', content: [
            { type: 'taskList', content: [
              { type: 'taskItem', attrs: { checked: true }, content: [p('todo')] },
            ]},
            p('deep-tail'),
          ]},
        ]},
      ]},
    ]},
    p('bottom'),
  ]};
}

// ═══════════════════════════════════════════════════════════════════════════
// Unit resolution on the monster
// ═══════════════════════════════════════════════════════════════════════════

describe('unit resolution on a deep-layered document', () => {
  it('enumerator yields containers as OPAQUE units at valid positions (marquee altitude)', () => {
    const ed = makeEditor(monsterDoc());
    const units = enumerateBlockUnits(ed.state.doc);
    // Containers are single marquee units (callout, details) — the walk
    // descends through columns but NOT into container bodies.
    expect(units.map((u) => u.node.type.name)).toEqual(['callout', 'mathBlock', 'details', 'paragraph']);
    for (const unit of units) {
      expect(ed.state.doc.nodeAt(unit.pos), `position drift at ${unit.pos}`).toBe(unit.node);
    }
  });

  it('every textblock in the monster resolves to a unit that contains it', () => {
    const ed = makeEditor(monsterDoc());
    const failures: string[] = [];
    ed.state.doc.descendants((n, pos) => {
      if (!n.isTextblock) return true;
      const unit = resolveBlockUnit(ed.state.doc.resolve(pos + 1));
      if (!unit) {
        failures.push(`no unit for "${n.textContent}" @${pos}`);
        return true;
      }
      const inside = unit.pos <= pos && pos + n.nodeSize <= unit.pos + unit.node.nodeSize;
      if (!inside) failures.push(`unit for "${n.textContent}" does not contain it`);
      return true;
    });
    expect(failures).toEqual([]);
  });

  it('inside a quote-in-row, the unit is the paragraph SCOPED to the quote — never the outer row', () => {
    const ed = makeEditor({ type: 'doc', content: [
      bl({ type: 'listItem', content: [p('row'), { type: 'blockquote', content: [p('quoted')] }] }),
    ]});
    const quoted = findNode(ed, 'paragraph', 'quoted');
    const unit = resolveBlockUnit(ed.state.doc.resolve(quoted.pos + 1))!;
    // Page-container stop rule: the quote is the unit SCOPE, so the block
    // under the cursor resolves inside it — and must NOT leak to the row.
    expect(unit.node.type.name).toBe('paragraph');
    expect(unit.parentNode.type.name).toBe('blockquote');
    expect(unit.isListItem).toBe(false);
  });
});

// ═══════════════════════════════════════════════════════════════════════════
// Delete policy
// ═══════════════════════════════════════════════════════════════════════════

describe('deleteBlockAt policy', () => {
  it('deleting the only nested row dissolves the nested wrapper, parent keeps its line', () => {
    const ed = makeEditor({ type: 'doc', content: [
      bl(li('parent', bl(li('only-nested'))), li('sib')),
    ]});
    const row = findNode(ed, 'listItem', 'only-nested');
    deleteBlockAt(ed as any, row.pos, row.node);

    expect(shape(ed)).toBe('bulletList(listItem(paragraph"parent"),listItem(paragraph"sib"))');
    expectNoGhosts(ed);
  });

  it('deleting the last block of a column backfills a paragraph (layout survives)', () => {
    const ed = makeEditor({ type: 'doc', content: [
      { type: 'columnList', content: [
        { type: 'column', content: [p('a1')] },
        { type: 'column', content: [p('b1')] },
      ]},
    ]});
    const a1 = findNode(ed, 'paragraph', 'a1');
    deleteBlockAt(ed as any, a1.pos, a1.node);

    const cl = findNode(ed, 'columnList');
    expect(cl.node.childCount).toBe(2);
    expect(allText(ed)).toEqual(['b1']);
  });

  it('deleting a row WITH children removes the whole subtree, siblings untouched', () => {
    const ed = makeEditor({ type: 'doc', content: [
      bl(li('a'), li('victim', bl(li('kid1'), li('kid2'))), li('c')),
    ]});
    const victim = findNode(ed, 'listItem', 'victimkid1kid2');
    deleteBlockAt(ed as any, victim.pos, victim.node);

    expect(shape(ed)).toBe('bulletList(listItem(paragraph"a"),listItem(paragraph"c"))');
    expectNoGhosts(ed);
  });

  it('deleting a mathBlock between two lists leaves both lists intact and separate', () => {
    const ed = makeEditor({ type: 'doc', content: [
      bl(li('one')),
      math('x'),
      bl(li('two')),
    ]});
    const m = findNode(ed, 'mathBlock');
    deleteBlockAt(ed as any, m.pos, m.node);

    expect(allText(ed)).toEqual(['one', 'two']);
    expectNoGhosts(ed);
  });

  it('deleting the callout in the monster keeps every other structure standing', () => {
    const ed = makeEditor(monsterDoc());
    const c = findNode(ed, 'callout');
    deleteBlockAt(ed as any, c.pos, c.node);

    expect(allText(ed)).toEqual(['\\alpha+\\beta', 'sum', 'todo', 'deep-tail', 'bottom']);
    const cl = findNode(ed, 'columnList');
    expect(cl.node.childCount).toBe(2);
    expectNoGhosts(ed);
  });
});

// ═══════════════════════════════════════════════════════════════════════════
// Duplication
// ═══════════════════════════════════════════════════════════════════════════

describe('duplicateBlockAt', () => {
  it('duplicating a row with children copies the whole subtree, original intact', () => {
    const ed = makeEditor({ type: 'doc', content: [
      bl(li('parent', bl(li('kid'))), li('after')),
    ]});
    const row = findNode(ed, 'listItem', 'parentkid');
    duplicateBlockAt(ed as any, row.pos, row.node);

    expect(allText(ed)).toEqual(['parent', 'kid', 'parent', 'kid', 'after']);
    expectNoGhosts(ed);
  });

  it('duplicating a callout with a list copies it deeply', () => {
    const ed = makeEditor({ type: 'doc', content: [
      callout(p('t'), bl(li('r'))),
      p('tail'),
    ]});
    const c = findNode(ed, 'callout');
    duplicateBlockAt(ed as any, c.pos, c.node);

    expect(shape(ed)).toBe(
      'callout(paragraph"t",bulletList(listItem(paragraph"r"))),callout(paragraph"t",bulletList(listItem(paragraph"r"))),paragraph"tail"',
    );
  });

  it('duplicating a mathBlock copies the latex', () => {
    const ed = makeEditor({ type: 'doc', content: [math('\\int'), p('tail')] });
    const m = findNode(ed, 'mathBlock');
    duplicateBlockAt(ed as any, m.pos, m.node);
    expect(allText(ed)).toEqual(['\\int', '\\int', 'tail']);
  });
});

// ═══════════════════════════════════════════════════════════════════════════
// Column corruption repair (auto-dissolve safety net)
// ═══════════════════════════════════════════════════════════════════════════

describe('column corruption repair', () => {
  it('a 1-column columnList dissolves on the next doc change', () => {
    const ed = makeEditor({ type: 'doc', content: [
      { type: 'columnList', content: [
        { type: 'column', content: [p('lonely')] },
      ]},
      p('tail'),
    ]});
    // Trigger a doc-changing transaction — the appendTransaction net runs.
    cursorIn(ed, 'tail');
    ed.commands.insertContent('!');

    expect(shape(ed)).toBe('paragraph"lonely",paragraph"!tail"');
  });

  it('a healthy 2-column layout with custom widths is untouched by the net', () => {
    const ed = makeEditor({ type: 'doc', content: [
      { type: 'columnList', content: [
        { type: 'column', attrs: { width: 30 }, content: [p('a')] },
        { type: 'column', attrs: { width: 70 }, content: [p('b')] },
      ]},
      p('tail'),
    ]});
    cursorIn(ed, 'tail');
    ed.commands.insertContent('!');

    const cl = findNode(ed, 'columnList');
    expect(cl.node.childCount).toBe(2);
    expect(cl.node.child(0).attrs.width).toBe(30);
    expect(cl.node.child(1).attrs.width).toBe(70);
  });
});

// ═══════════════════════════════════════════════════════════════════════════
// Undo/redo round-trips
// ═══════════════════════════════════════════════════════════════════════════

describe('undo/redo integrity', () => {
  it('deleteBlockAt → undo restores the exact structure → redo re-applies', () => {
    const ed = makeEditor({ type: 'doc', content: [
      bl(li('parent', bl(li('only-nested'))), li('sib')),
    ]});
    const before = shape(ed);
    const row = findNode(ed, 'listItem', 'only-nested');
    deleteBlockAt(ed as any, row.pos, row.node);
    const after = shape(ed);

    ed.commands.undo();
    expect(shape(ed)).toBe(before);
    ed.commands.redo();
    expect(shape(ed)).toBe(after);
  });

  it('Backspace row-outdent → undo restores the nested shape', () => {
    const ed = makeEditor({ type: 'doc', content: [
      bl(li('parent', bl(li('child1'), li('child2')))),
    ]});
    const before = shape(ed);
    cursorIn(ed, 'child2');
    press(ed, 'Backspace');
    expect(shape(ed)).not.toBe(before);

    ed.commands.undo();
    expect(shape(ed)).toBe(before);
  });

  it('monster: delete callout → undo → byte-identical doc JSON', () => {
    const ed = makeEditor(monsterDoc());
    const before = JSON.stringify(ed.state.doc.toJSON());
    const c = findNode(ed, 'callout');
    deleteBlockAt(ed as any, c.pos, c.node);
    ed.commands.undo();
    expect(JSON.stringify(ed.state.doc.toJSON())).toBe(before);
  });
});

// ═══════════════════════════════════════════════════════════════════════════
// Emptiness semantics
// ═══════════════════════════════════════════════════════════════════════════

describe('isColumnEffectivelyEmpty', () => {
  function columnOf(ed: Editor): any {
    return findNode(ed, 'column').node;
  }

  it('a column holding ONLY a mathBlock is NOT empty (atoms are content)', () => {
    const ed = makeEditor({ type: 'doc', content: [
      { type: 'columnList', content: [
        { type: 'column', content: [math('x')] },
        { type: 'column', content: [p('b')] },
      ]},
    ]});
    expect(isColumnEffectivelyEmpty(columnOf(ed))).toBe(false);
  });

  it('a column holding a whitespace-only paragraph IS empty', () => {
    const ed = makeEditor({ type: 'doc', content: [
      { type: 'columnList', content: [
        { type: 'column', content: [{ type: 'paragraph', content: [{ type: 'text', text: '   ' }] }] },
        { type: 'column', content: [p('b')] },
      ]},
    ]});
    expect(isColumnEffectivelyEmpty(columnOf(ed))).toBe(true);
  });

  it('a column holding an empty paragraph IS empty', () => {
    const ed = makeEditor({ type: 'doc', content: [
      { type: 'columnList', content: [
        { type: 'column', content: [pEmpty()] },
        { type: 'column', content: [p('b')] },
      ]},
    ]});
    expect(isColumnEffectivelyEmpty(columnOf(ed))).toBe(true);
  });
});

// ═══════════════════════════════════════════════════════════════════════════
// Enter at converted-structure boundaries (un-rederived surface)
// ═══════════════════════════════════════════════════════════════════════════

describe('Enter at converted-structure boundaries', () => {
  it('Enter mid-text in a quote-in-row splits INSIDE the quote; the row survives', () => {
    const ed = makeEditor({ type: 'doc', content: [
      bl({ type: 'listItem', content: [p('row'), { type: 'blockquote', content: [p('aabb')] }] }, li('sib')),
    ]});
    const quoted = findNode(ed, 'paragraph', 'aabb');
    ed.view.dispatch(ed.state.tr.setSelection(TextSelection.create(ed.state.doc, quoted.pos + 1 + 2)));
    press(ed, 'Enter');

    expect(allText(ed)).toEqual(['row', 'aa', 'bb', 'sib']);
    // Still exactly one blockquote, still inside the row.
    let quoteCount = 0;
    ed.state.doc.descendants((n) => { if (n.type.name === 'blockquote') quoteCount++; return true; });
    expect(quoteCount).toBe(1);
    expect(shape(ed)).toContain('listItem(paragraph"row",blockquote(paragraph"aa",paragraph"bb"))');
  });

  it('Enter on a COLLAPSED toggle summary creates a new EMPTY toggle below (Notion)', () => {
    // jsdom has no layout, so offsetParent is always null and every toggle
    // reads as collapsed — this pins DetailsEnterHandler's collapsed branch.
    // (The OPEN-toggle Enter path is visibility-dependent and cannot be
    // verified headlessly.)
    const ed = makeEditor({ type: 'doc', content: [
      { type: 'details', content: [
        { type: 'detailsSummary', content: [{ type: 'text', text: 'sum' }] },
        { type: 'detailsContent', content: [p('body')] },
      ]},
    ]});
    const summary = findNode(ed, 'detailsSummary');
    ed.view.dispatch(ed.state.tr.setSelection(TextSelection.create(ed.state.doc, summary.pos + 1 + 'sum'.length)));
    press(ed, 'Enter');

    // Original toggle untouched; ONE new empty toggle after it; cursor in
    // the new toggle's summary.
    expect(allText(ed)).toEqual(['sum', 'body']);
    const detailsNodes: Array<{ pos: number; node: any }> = [];
    ed.state.doc.descendants((n, pos) => {
      if (n.type.name === 'details') detailsNodes.push({ pos, node: n });
      return true;
    });
    expect(detailsNodes).toHaveLength(2);
    expect(detailsNodes[0].node.textContent).toBe('sumbody');
    expect(detailsNodes[1].node.textContent).toBe('');
    expect(ed.state.selection.head).toBeGreaterThan(detailsNodes[1].pos);
    expect(ed.state.selection.head).toBeLessThan(detailsNodes[1].pos + detailsNodes[1].node.nodeSize);
  });

  it('Enter at the end of the LAST block of a callout stays inside the callout', () => {
    const ed = makeEditor({ type: 'doc', content: [
      callout(p('only')),
      p('tail'),
    ]});
    const only = findNode(ed, 'paragraph', 'only');
    ed.view.dispatch(ed.state.tr.setSelection(TextSelection.create(ed.state.doc, only.pos + 1 + 'only'.length)));
    press(ed, 'Enter');

    expect(shape(ed)).toBe('callout(paragraph"only",paragraph""),paragraph"tail"');
  });

  it('Enter mid-text of a column paragraph splits within the column', () => {
    const ed = makeEditor({ type: 'doc', content: [
      { type: 'columnList', content: [
        { type: 'column', content: [p('aabb')] },
        { type: 'column', content: [p('b1')] },
      ]},
    ]});
    const target = findNode(ed, 'paragraph', 'aabb');
    ed.view.dispatch(ed.state.tr.setSelection(TextSelection.create(ed.state.doc, target.pos + 1 + 2)));
    press(ed, 'Enter');

    expect(shape(ed)).toBe('columnList(column(paragraph"aa",paragraph"bb"),column(paragraph"b1"))');
  });
});
