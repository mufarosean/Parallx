// @vitest-environment jsdom
//
// keyboard.probe.test.ts — HOSTILE probes: Backspace/Delete/Enter/Tab at every
// structural boundary, on a real editor with real keydown dispatch.
//
// Two tiers of assertion:
//   • INVARIANT probes — hard bugs if they fail: no text loss, no mutation of
//     rows OTHER than the one under the cursor, no node-selecting containers
//     that a next keystroke would destroy.
//   • PARITY probes — Notion-expected semantics; where ProseMirror's default
//     differs destructively, the probe documents it with it.fails + comments.
//
// Written 2026-07-18 while hunting the reported "backspace removes bullets
// from the parent bullet" / "every block has its own quirks" class.

import { describe, expect, it } from 'vitest';
import { Editor } from '@tiptap/core';
import StarterKit from '@tiptap/starter-kit';
import TaskList from '@tiptap/extension-task-list';
import TaskItem from '@tiptap/extension-task-item';
import { Details, DetailsSummary, DetailsContent } from '@tiptap/extension-details';
import { NodeSelection, TextSelection } from '@tiptap/pm/state';
import { Column, ColumnList } from '../../../src/built-in/canvas/extensions/columnNodes';
import { MathBlock } from '../../../src/built-in/canvas/extensions/mathBlockNode';
import { Callout } from '../../../src/built-in/canvas/extensions/calloutNode';
import { ListKeyboardPolicy } from '../../../src/built-in/canvas/extensions/listKeyboardPolicy';

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
      ListKeyboardPolicy,
    ],
    content,
  });
}

function p(text: string) { return { type: 'paragraph', content: [{ type: 'text', text }] }; }
function pEmpty() { return { type: 'paragraph' }; }
function li(text: string, ...extra: any[]) { return { type: 'listItem', content: [p(text), ...extra] }; }
function bl(...items: any[]) { return { type: 'bulletList', content: items }; }
function task(text: string, checked = false) { return { type: 'taskItem', attrs: { checked }, content: [p(text)] }; }

function allText(ed: Editor): string[] {
  const out: string[] = [];
  ed.state.doc.descendants((n) => {
    if (n.isText && n.text) out.push(n.text);
    if (n.type.name === 'mathBlock' && n.attrs?.latex) out.push(String(n.attrs.latex));
    return true;
  });
  return out;
}

/** Compact structural fingerprint: type(child,…) with textblock text inline. */
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
  // Strip the TrailingNode artifact for stable comparisons.
  if (kids.length > 1 && kids[kids.length - 1] === 'paragraph""') kids.pop();
  return kids.join(',');
}

function findText(ed: Editor, text: string): number {
  let found = -1;
  ed.state.doc.descendants((n, pos) => {
    if (found >= 0) return false;
    if (n.isTextblock && n.textContent === text) { found = pos; return false; }
    return true;
  });
  if (found < 0) throw new Error(`textblock not found: ${text}`);
  return found;
}

/** Cursor at START of the textblock containing exactly `text`. */
function cursorAtStart(ed: Editor, text: string): void {
  const pos = findText(ed, text) + 1;
  ed.view.dispatch(ed.state.tr.setSelection(TextSelection.create(ed.state.doc, pos)));
}

function cursorAtEnd(ed: Editor, text: string): void {
  const pos = findText(ed, text) + 1 + text.length;
  ed.view.dispatch(ed.state.tr.setSelection(TextSelection.create(ed.state.doc, pos)));
}

function press(ed: Editor, key: string, init: KeyboardEventInit = {}): void {
  ed.view.dom.dispatchEvent(new KeyboardEvent('keydown', { key, bubbles: true, cancelable: true, ...init }));
}

// ═══════════════════════════════════════════════════════════════════════════
// BACKSPACE — nested lists (the reported symptom)
// ═══════════════════════════════════════════════════════════════════════════

describe('Backspace in nested lists', () => {
  // THE SYMPTOM: "hitting backspace removes bullets from the parent bullet".
  // Notion: Backspace at the start of a nested row OUTDENTS it one level.
  // The parent row must remain a bullet and its text must not change.
  it('INVARIANT: backspace at start of first nested row never merges its text into the parent bullet', () => {
    const ed = makeEditor({ type: 'doc', content: [
      bl(li('parent', bl(li('child1'), li('child2'))), li('sibling')),
    ]});
    cursorAtStart(ed, 'child1');
    press(ed, 'Backspace');

    expect(allText(ed)).toEqual(['parent', 'child1', 'child2', 'sibling']);
    // The parent row's own line is still exactly "parent" — child1 did NOT
    // glue onto it (the classic PM joinBackward merge).
    const s = shape(ed);
    expect(s).not.toContain('"parentchild1"');
    // And "parent" is still a list row.
    expect(s).toMatch(/listItem\(paragraph"parent"/);
  });

  it('INVARIANT: backspace at start of a MIDDLE nested row does not merge it into the previous row', () => {
    const ed = makeEditor({ type: 'doc', content: [
      bl(li('parent', bl(li('child1'), li('child2'), li('child3')))),
    ]});
    cursorAtStart(ed, 'child2');
    press(ed, 'Backspace');

    expect(allText(ed)).toEqual(['parent', 'child1', 'child2', 'child3']);
    expect(shape(ed)).not.toContain('"child1child2"');
  });

  it('INVARIANT: backspace at start of the FIRST top-level row does not merge it into the block above', () => {
    const ed = makeEditor({ type: 'doc', content: [
      p('above'),
      bl(li('one'), li('two')),
    ]});
    cursorAtStart(ed, 'one');
    press(ed, 'Backspace');

    expect(allText(ed)).toEqual(['above', 'one', 'two']);
    expect(shape(ed)).not.toContain('"aboveone"');
  });

  it('INVARIANT: backspace at start of a parent row keeps its children attached and typed', () => {
    const ed = makeEditor({ type: 'doc', content: [
      p('above'),
      bl(li('parent', bl(li('kid1'), li('kid2'))), li('after')),
    ]});
    cursorAtStart(ed, 'parent');
    press(ed, 'Backspace');

    expect(allText(ed)).toEqual(['above', 'parent', 'kid1', 'kid2', 'after']);
    // kids still list rows, still nested under SOMETHING (not ejected to top level)
    const s = shape(ed);
    expect(s).toMatch(/listItem\(paragraph"kid1"\)/);
    expect(s).toMatch(/listItem\(paragraph"kid2"\)/);
  });

  it('INVARIANT: backspace on nested taskItem keeps sibling checked states', () => {
    const ed = makeEditor({ type: 'doc', content: [
      { type: 'taskList', content: [
        { type: 'taskItem', attrs: { checked: true }, content: [p('done-parent'),
          { type: 'taskList', content: [task('child-a'), task('child-b', true)] },
        ]},
      ]},
    ]});
    cursorAtStart(ed, 'child-a');
    press(ed, 'Backspace');

    expect(allText(ed)).toEqual(['done-parent', 'child-a', 'child-b']);
    // child-b keeps checked=true wherever it landed
    let childBChecked: boolean | null = null;
    ed.state.doc.descendants((n) => {
      if (n.type.name === 'taskItem' && n.textContent === 'child-b') childBChecked = n.attrs.checked;
      return true;
    });
    expect(childBChecked).toBe(true);
  });

  it('PARITY: backspace at start of a nested row outdents it one level (Notion)', () => {
    const ed = makeEditor({ type: 'doc', content: [
      bl(li('parent', bl(li('only-child')))),
    ]});
    cursorAtStart(ed, 'only-child');
    press(ed, 'Backspace');

    // Notion: only-child becomes a row at the parent's level.
    expect(shape(ed)).toBe('bulletList(listItem(paragraph"parent"),listItem(paragraph"only-child"))');
  });

  it('PARITY: backspace at start of a top-level row converts it to a paragraph in place (Notion)', () => {
    const ed = makeEditor({ type: 'doc', content: [
      bl(li('one'), li('two'), li('three')),
    ]});
    cursorAtStart(ed, 'two');
    press(ed, 'Backspace');

    // Notion: "two" leaves the list as a paragraph; list splits around it.
    expect(shape(ed)).toBe('bulletList(listItem(paragraph"one")),paragraph"two",bulletList(listItem(paragraph"three"))');
  });
});

// ═══════════════════════════════════════════════════════════════════════════
// BACKSPACE — container boundaries
// ═══════════════════════════════════════════════════════════════════════════

describe('Backspace at container boundaries', () => {
  it('INVARIANT: backspace at start of paragraph after a bulletList merges into the LAST row only', () => {
    const ed = makeEditor({ type: 'doc', content: [
      bl(li('one'), li('two')),
      p('tail'),
    ]});
    cursorAtStart(ed, 'tail');
    press(ed, 'Backspace');

    // Notion parity: the paragraph merges INTO the last bullet ("twotail"
    // in one row); the first row is untouched and no characters are lost.
    const s = shape(ed);
    expect(s).toMatch(/listItem\(paragraph"one"\)/);
    expect(s).toMatch(/listItem\(paragraph"twotail"\)/);
    expect(allText(ed).join('')).toBe('onetwotail');
  });

  it('INVARIANT: backspace at start of paragraph after a mathBlock selects the atom (does not silently delete it)', () => {
    const ed = makeEditor({ type: 'doc', content: [
      { type: 'mathBlock', attrs: { latex: 'E=mc^2' } },
      p('tail'),
    ]});
    cursorAtStart(ed, 'tail');
    press(ed, 'Backspace');

    expect(allText(ed)).toContain('E=mc^2');
    expect(allText(ed)).toContain('tail');
    expect(ed.state.selection).toBeInstanceOf(NodeSelection);
  });

  it('INVARIANT: backspace at start of the first block INSIDE a callout does not destroy the callout or its content', () => {
    const ed = makeEditor({ type: 'doc', content: [
      p('above'),
      { type: 'callout', content: [p('callout-first'), p('callout-rest')] },
    ]});
    cursorAtStart(ed, 'callout-first');
    press(ed, 'Backspace');

    expect(allText(ed)).toEqual(['above', 'callout-first', 'callout-rest']);
    expect(ed.state.selection).not.toBeInstanceOf(NodeSelection);
  });

  it('INVARIANT: backspace at start of paragraph after a CALLOUT never node-selects the whole callout', () => {
    const ed = makeEditor({ type: 'doc', content: [
      { type: 'callout', content: [p('inside')] },
      p('tail'),
    ]});
    cursorAtStart(ed, 'tail');
    press(ed, 'Backspace');

    expect(allText(ed)).toEqual(['inside', 'tail']);
    expect(ed.state.selection).not.toBeInstanceOf(NodeSelection);
  });

  it('INVARIANT: backspace at start of paragraph after a columnList nested INSIDE a callout enters the columns', () => {
    const ed = makeEditor({ type: 'doc', content: [
      { type: 'callout', content: [
        { type: 'columnList', content: [
          { type: 'column', content: [p('a1')] },
          { type: 'column', content: [p('b1')] },
        ]},
        p('tail-in-callout'),
      ]},
    ]});
    cursorAtStart(ed, 'tail-in-callout');
    press(ed, 'Backspace');

    expect(allText(ed)).toEqual(['a1', 'b1', 'tail-in-callout']);
    expect(ed.state.selection).not.toBeInstanceOf(NodeSelection);
    expect(ed.state.selection.head).toBe(findText(ed, 'b1') + 1 + 'b1'.length);
  });

  it('INVARIANT: backspace at the very start of the document is a safe no-op', () => {
    const ed = makeEditor({ type: 'doc', content: [p('first'), p('second')] });
    cursorAtStart(ed, 'first');
    const before = shape(ed);
    press(ed, 'Backspace');
    expect(shape(ed)).toBe(before);
  });

  it('INVARIANT: backspace at start of first LIST row inside a column does not corrupt the layout', () => {
    const ed = makeEditor({ type: 'doc', content: [
      { type: 'columnList', content: [
        { type: 'column', content: [bl(li('row1'), li('row2'))] },
        { type: 'column', content: [p('b1')] },
      ]},
    ]});
    cursorAtStart(ed, 'row1');
    press(ed, 'Backspace');

    expect(allText(ed)).toEqual(['row1', 'row2', 'b1']);
    // Layout survives: still a 2-column list.
    let columnCount = 0;
    ed.state.doc.descendants((n) => {
      if (n.type.name === 'columnList') columnCount = n.childCount;
      return true;
    });
    expect(columnCount).toBe(2);
    expect(ed.state.selection).not.toBeInstanceOf(NodeSelection);
  });
});

// ═══════════════════════════════════════════════════════════════════════════
// DELETE (forward) mirrors
// ═══════════════════════════════════════════════════════════════════════════

describe('Delete at boundaries', () => {
  it('INVARIANT: delete at end of paragraph before a bulletList pulls in only the FIRST row text', () => {
    const ed = makeEditor({ type: 'doc', content: [
      p('head'),
      bl(li('one'), li('two')),
    ]});
    cursorAtEnd(ed, 'head');
    press(ed, 'Delete');

    expect(allText(ed)).toEqual(['head', 'one', 'two']);
    expect(shape(ed)).toMatch(/listItem\(paragraph"two"\)/);
  });

  it('INVARIANT: delete at end of paragraph before a CALLOUT never node-selects the callout', () => {
    const ed = makeEditor({ type: 'doc', content: [
      p('head'),
      { type: 'callout', content: [p('inside')] },
    ]});
    cursorAtEnd(ed, 'head');
    press(ed, 'Delete');

    expect(allText(ed)).toEqual(['head', 'inside']);
    expect(ed.state.selection).not.toBeInstanceOf(NodeSelection);
  });

  it('INVARIANT: delete at end of last row before a nested child list keeps children intact', () => {
    const ed = makeEditor({ type: 'doc', content: [
      bl(li('parent', bl(li('kid')))),
      p('tail'),
    ]});
    cursorAtEnd(ed, 'parent');
    press(ed, 'Delete');

    expect(allText(ed)).toEqual(['parent', 'kid', 'tail']);
  });
});

// ═══════════════════════════════════════════════════════════════════════════
// ENTER
// ═══════════════════════════════════════════════════════════════════════════

describe('Enter in lists', () => {
  it('PARITY: Enter on an empty nested row outdents one level (Notion)', () => {
    const ed = makeEditor({ type: 'doc', content: [
      bl(li('parent', bl({ type: 'listItem', content: [pEmpty()] }))),
    ]});
    // Cursor inside the empty nested paragraph.
    let emptyPos = -1;
    ed.state.doc.descendants((n, pos) => {
      if (n.isTextblock && n.content.size === 0 && emptyPos < 0) { emptyPos = pos; return false; }
      return true;
    });
    ed.view.dispatch(ed.state.tr.setSelection(TextSelection.create(ed.state.doc, emptyPos + 1)));
    press(ed, 'Enter');

    // The empty row becomes a row at the parent's level.
    expect(shape(ed)).toBe('bulletList(listItem(paragraph"parent"),listItem(paragraph""))');
  });

  it('INVARIANT: Enter mid-text splits a row into two rows with no text loss', () => {
    const ed = makeEditor({ type: 'doc', content: [
      bl(li('aabb'), li('next')),
    ]});
    const pos = findText(ed, 'aabb') + 1 + 2; // between aa and bb
    ed.view.dispatch(ed.state.tr.setSelection(TextSelection.create(ed.state.doc, pos)));
    press(ed, 'Enter');

    expect(shape(ed)).toBe('bulletList(listItem(paragraph"aa"),listItem(paragraph"bb"),listItem(paragraph"next"))');
  });

  it('INVARIANT: Enter mid-text on a row with children keeps the children exactly once', () => {
    const ed = makeEditor({ type: 'doc', content: [
      bl(li('aabb', bl(li('kid')))),
    ]});
    const pos = findText(ed, 'aabb') + 1 + 2;
    ed.view.dispatch(ed.state.tr.setSelection(TextSelection.create(ed.state.doc, pos)));
    press(ed, 'Enter');

    expect(allText(ed)).toEqual(['aa', 'bb', 'kid']);
  });

  it('INVARIANT: Enter on an empty MIDDLE top-level row exits the list there, splitting it', () => {
    const ed = makeEditor({ type: 'doc', content: [
      bl(li('one'), { type: 'listItem', content: [pEmpty()] }, li('three')),
    ]});
    let emptyPos = -1;
    ed.state.doc.descendants((n, pos) => {
      if (n.isTextblock && n.content.size === 0 && emptyPos < 0) { emptyPos = pos; return false; }
      return true;
    });
    ed.view.dispatch(ed.state.tr.setSelection(TextSelection.create(ed.state.doc, emptyPos + 1)));
    press(ed, 'Enter');

    expect(allText(ed)).toEqual(['one', 'three']);
    // Rows one and three both still bullets.
    const s = shape(ed);
    expect(s).toMatch(/listItem\(paragraph"one"\)/);
    expect(s).toMatch(/listItem\(paragraph"three"\)/);
  });
});

// ═══════════════════════════════════════════════════════════════════════════
// TAB / SHIFT-TAB
// ═══════════════════════════════════════════════════════════════════════════

describe('deep-cut boundaries (cursor climbs out of nested structures)', () => {
  it('INVARIANT: Delete at end of paragraph before a mathBlock SELECTS the atom (no silent delete)', () => {
    const ed = makeEditor({ type: 'doc', content: [
      p('head'),
      { type: 'mathBlock', attrs: { latex: 'E=mc^2' } },
      p('tail'),
    ]});
    cursorAtEnd(ed, 'head');
    press(ed, 'Delete');

    expect(allText(ed)).toContain('E=mc^2');
    expect(ed.state.selection).toBeInstanceOf(NodeSelection);
  });

  it('INVARIANT: Delete at end of the LAST list row before a columnList never node-selects the layout', () => {
    const ed = makeEditor({ type: 'doc', content: [
      bl(li('row1'), li('row2')),
      { type: 'columnList', content: [
        { type: 'column', content: [p('a1')] },
        { type: 'column', content: [p('b1')] },
      ]},
    ]});
    cursorAtEnd(ed, 'row2');
    const before = shape(ed);
    press(ed, 'Delete');

    expect(shape(ed)).toBe(before);
    expect(ed.state.selection).not.toBeInstanceOf(NodeSelection);
    // Cursor entered the first column.
    expect(ed.state.selection.head).toBe(findText(ed, 'a1') + 1);
  });

  it('INVARIANT: Backspace at start of a CALLOUT first block after a columnList never node-selects the layout', () => {
    const ed = makeEditor({ type: 'doc', content: [
      { type: 'columnList', content: [
        { type: 'column', content: [p('a1')] },
        { type: 'column', content: [p('b1')] },
      ]},
      { type: 'callout', content: [p('callout-first')] },
    ]});
    cursorAtStart(ed, 'callout-first');
    const before = shape(ed);
    press(ed, 'Backspace');

    expect(shape(ed)).toBe(before);
    expect(ed.state.selection).not.toBeInstanceOf(NodeSelection);
  });
});

describe('Tab / Shift-Tab in lists', () => {
  it('INVARIANT: Tab on the first row is a no-op (nothing to nest under)', () => {
    const ed = makeEditor({ type: 'doc', content: [bl(li('one'), li('two'))] });
    cursorAtStart(ed, 'one');
    const before = shape(ed);
    press(ed, 'Tab');
    expect(shape(ed)).toBe(before);
  });

  it('INVARIANT: Tab indents a row together with its children', () => {
    const ed = makeEditor({ type: 'doc', content: [
      bl(li('one'), li('two', bl(li('kid')))),
    ]});
    cursorAtStart(ed, 'two');
    press(ed, 'Tab');

    expect(allText(ed)).toEqual(['one', 'two', 'kid']);
    // "two" is now nested under "one", and "kid" still under "two".
    expect(shape(ed)).toBe('bulletList(listItem(paragraph"one",bulletList(listItem(paragraph"two",bulletList(listItem(paragraph"kid"))))))');
  });

  it('INVARIANT: Tab/Shift-Tab round-trip is identity', () => {
    const ed = makeEditor({ type: 'doc', content: [
      bl(li('one'), li('two'), li('three')),
    ]});
    const before = shape(ed);
    cursorAtStart(ed, 'two');
    press(ed, 'Tab');
    press(ed, 'Tab', { shiftKey: true });
    expect(shape(ed)).toBe(before);
  });
});
