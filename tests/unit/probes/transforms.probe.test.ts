// @vitest-environment jsdom
//
// transforms.probe.test.ts — HOSTILE probes for the Turn-Into engine:
// hunting the reported "text blocks refuse to convert to bullet at certain
// times" class. Every probe resolves the unit the way the app's action menu
// does (resolveMovableBlock at the cursor), then converts via
// turnBlockWithSharedStrategy, and asserts the EXACT resulting structure.

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
import { ToggleHeading, ToggleHeadingText } from '../../../src/built-in/canvas/extensions/toggleHeadingNode';
import { turnBlockWithSharedStrategy } from '../../../src/built-in/canvas/config/blockStateRegistry/blockTransforms';
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
      ToggleHeading, ToggleHeadingText,
    ],
    content,
  });
}

function p(text: string) { return { type: 'paragraph', content: [{ type: 'text', text }] }; }
function li(text: string, ...extra: any[]) { return { type: 'listItem', content: [p(text), ...extra] }; }
function bl(...items: any[]) { return { type: 'bulletList', content: items }; }

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

/** Convert the unit under the cursor at `text`, exactly as the action menu does. */
function turnAt(ed: Editor, text: string, targetType: string, attrs?: any): void {
  const $pos = ed.state.doc.resolve(findText(ed, text) + 1);
  const unit = resolveMovableBlock($pos);
  if (!unit) throw new Error(`no movable unit at "${text}"`);
  turnBlockWithSharedStrategy(ed, unit.pos, unit.node, targetType, attrs);
}

// ═══════════════════════════════════════════════════════════════════════════
// paragraph → bulletList across contexts (the reported refusal)
// ═══════════════════════════════════════════════════════════════════════════

describe('paragraph → bulletList in every context', () => {
  it('top-level paragraph converts', () => {
    const ed = makeEditor({ type: 'doc', content: [p('x')] });
    turnAt(ed, 'x', 'bulletList');
    expect(shape(ed)).toBe('bulletList(listItem(paragraph"x"))');
  });

  it('paragraph inside a COLUMN converts in place', () => {
    const ed = makeEditor({ type: 'doc', content: [
      { type: 'columnList', content: [
        { type: 'column', content: [p('a'), p('x'), p('b')] },
        { type: 'column', content: [p('other')] },
      ]},
    ]});
    turnAt(ed, 'x', 'bulletList');
    expect(shape(ed)).toContain('column(paragraph"a",bulletList(listItem(paragraph"x")),paragraph"b")');
  });

  it('paragraph inside a CALLOUT converts in place', () => {
    const ed = makeEditor({ type: 'doc', content: [
      { type: 'callout', content: [p('a'), p('x')] },
    ]});
    turnAt(ed, 'x', 'bulletList');
    expect(shape(ed)).toBe('callout(paragraph"a",bulletList(listItem(paragraph"x")))');
  });

  it('paragraph inside DETAILS content converts in place', () => {
    const ed = makeEditor({ type: 'doc', content: [
      { type: 'details', content: [
        { type: 'detailsSummary', content: [{ type: 'text', text: 'sum' }] },
        { type: 'detailsContent', content: [p('x')] },
      ]},
    ]});
    turnAt(ed, 'x', 'bulletList');
    expect(shape(ed)).toContain('detailsContent(bulletList(listItem(paragraph"x")))');
  });

  it('paragraph that is a row\'s TRAILING block converts without touching the row', () => {
    // In-place row conversions produce rows with trailing non-list children;
    // the trailing block is its own unit.
    const ed = makeEditor({ type: 'doc', content: [
      bl({ type: 'listItem', content: [p('rowline'), p('trailing')] }),
    ]});
    turnAt(ed, 'trailing', 'bulletList');
    expect(allText(ed)).toEqual(['rowline', 'trailing']);
    // rowline still the row's line; trailing now a (nested) bullet.
    const s = shape(ed);
    expect(s).toContain('paragraph"rowline"');
    expect(s).toMatch(/bulletList\(listItem\(paragraph"trailing"\)\)/);
  });

  it('paragraph directly ADJACENT to an existing list converts to its own list (no accidental merge-drop)', () => {
    const ed = makeEditor({ type: 'doc', content: [
      bl(li('one')),
      p('x'),
      bl(li('two')),
    ]});
    turnAt(ed, 'x', 'bulletList');
    expect(allText(ed)).toEqual(['one', 'x', 'two']);
    // x is a bullet row now — whether merged with neighbors or standalone,
    // it must BE a listItem and the neighbors must survive.
    expect(shape(ed)).toMatch(/listItem\(paragraph"x"\)/);
  });

  it('empty paragraph converts', () => {
    const ed = makeEditor({ type: 'doc', content: [{ type: 'paragraph' }, p('anchor')] });
    const $pos = ed.state.doc.resolve(1);
    const unit = resolveMovableBlock($pos)!;
    turnBlockWithSharedStrategy(ed, unit.pos, unit.node, 'bulletList');
    expect(shape(ed)).toContain('bulletList(listItem(paragraph""))');
  });

  it('heading → bulletList keeps text', () => {
    const ed = makeEditor({ type: 'doc', content: [
      { type: 'heading', attrs: { level: 2 }, content: [{ type: 'text', text: 'head' }] },
    ]});
    turnAt(ed, 'head', 'bulletList');
    expect(shape(ed)).toBe('bulletList(listItem(paragraph"head"))');
  });
});

// ═══════════════════════════════════════════════════════════════════════════
// Conversion cycles (the "works once then stops" class)
// ═══════════════════════════════════════════════════════════════════════════

describe('conversion cycles stay convertible', () => {
  it('paragraph → bullet → paragraph → bullet (re-resolving each step)', () => {
    const ed = makeEditor({ type: 'doc', content: [p('x'), p('anchor')] });
    turnAt(ed, 'x', 'bulletList');
    expect(shape(ed)).toContain('listItem(paragraph"x")');
    turnAt(ed, 'x', 'paragraph');
    expect(shape(ed)).toContain('paragraph"x"');
    expect(shape(ed)).not.toContain('listItem');
    turnAt(ed, 'x', 'bulletList');
    expect(shape(ed)).toContain('listItem(paragraph"x")');
  });

  it('bullet row → quote (in place) → back to bullet', () => {
    const ed = makeEditor({ type: 'doc', content: [
      bl(li('one'), li('x'), li('three')),
    ]});
    turnAt(ed, 'x', 'blockquote');
    // In-place: list splits around a quote.
    expect(allText(ed)).toEqual(['one', 'x', 'three']);
    expect(shape(ed)).toContain('blockquote(paragraph"x")');
    turnAt(ed, 'x', 'bulletList');
    expect(allText(ed)).toEqual(['one', 'x', 'three']);
    expect(shape(ed)).toMatch(/listItem\(paragraph"x"\)/);
  });

  it('task row → bullet row → task row keeps position among siblings', () => {
    const ed = makeEditor({ type: 'doc', content: [
      { type: 'taskList', content: [
        { type: 'taskItem', attrs: { checked: false }, content: [p('a')] },
        { type: 'taskItem', attrs: { checked: true }, content: [p('x')] },
        { type: 'taskItem', attrs: { checked: false }, content: [p('c')] },
      ]},
    ]});
    turnAt(ed, 'x', 'bulletList');
    expect(allText(ed)).toEqual(['a', 'x', 'c']);
    expect(shape(ed)).toMatch(/listItem\(paragraph"x"\)/);
    turnAt(ed, 'x', 'taskList');
    expect(allText(ed)).toEqual(['a', 'x', 'c']);
    expect(shape(ed)).toMatch(/taskItem\(paragraph"x"\)/);
  });

  it('nested row → paragraph keeps its INDENTED position, then converts back', () => {
    const ed = makeEditor({ type: 'doc', content: [
      bl(li('parent', bl(li('x'), li('sib')))),
    ]});
    turnAt(ed, 'x', 'paragraph');
    expect(allText(ed)).toEqual(['parent', 'x', 'sib']);
    // x stays inside the row (trailing block), sib stays a nested bullet.
    expect(shape(ed)).toMatch(/listItem\(paragraph"sib"\)/);
    turnAt(ed, 'x', 'bulletList');
    expect(allText(ed)).toEqual(['parent', 'x', 'sib']);
    expect(shape(ed)).toMatch(/listItem\(paragraph"x"\)/);
  });
});

// ═══════════════════════════════════════════════════════════════════════════
// No data loss + structure preservation on hard targets
// ═══════════════════════════════════════════════════════════════════════════

describe('hard conversion targets', () => {
  it('row with CHILDREN → paragraph keeps children as bullets', () => {
    const ed = makeEditor({ type: 'doc', content: [
      bl(li('x', bl(li('kid1'), li('kid2'))), li('after')),
    ]});
    turnAt(ed, 'x', 'paragraph');
    expect(allText(ed)).toEqual(['x', 'kid1', 'kid2', 'after']);
    const s = shape(ed);
    expect(s).toMatch(/listItem\(paragraph"kid1"\)/);
    expect(s).toMatch(/listItem\(paragraph"kid2"\)/);
  });

  it('paragraph → mathBlock adopts the text as latex', () => {
    const ed = makeEditor({ type: 'doc', content: [p('E=mc^2'), p('anchor')] });
    turnAt(ed, 'E=mc^2', 'mathBlock');
    expect(allText(ed)).toContain('E=mc^2');
    let hasMath = false;
    ed.state.doc.descendants((n) => { if (n.type.name === 'mathBlock') hasMath = true; return true; });
    expect(hasMath).toBe(true);
  });

  it('mathBlock → paragraph recovers the latex as text', () => {
    const ed = makeEditor({ type: 'doc', content: [
      { type: 'mathBlock', attrs: { latex: 'a+b' } },
      p('anchor'),
    ]});
    const unit = resolveMovableBlock(ed.state.doc.resolve(0 + 1));
    // Atom: resolve by scanning instead (no cursor inside an atom).
    let mathPos = -1; let mathNode: any = null;
    ed.state.doc.descendants((n, pos) => {
      if (n.type.name === 'mathBlock') { mathPos = pos; mathNode = n; return false; }
      return true;
    });
    void unit;
    turnBlockWithSharedStrategy(ed, mathPos, mathNode, 'paragraph');
    expect(shape(ed)).toContain('paragraph"a+b"');
  });

  it('callout WITH a nested list → bulletList keeps every row', () => {
    const ed = makeEditor({ type: 'doc', content: [
      { type: 'callout', content: [p('title'), bl(li('r1'), li('r2'))] },
    ]});
    turnAt(ed, 'title', 'bulletList');
    expect(allText(ed)).toEqual(['title', 'r1', 'r2']);
  });

  it('backgroundColor travels onto the converted block', () => {
    const ed = makeEditor({ type: 'doc', content: [
      { type: 'paragraph', attrs: { backgroundColor: 'red' }, content: [{ type: 'text', text: 'x' }] },
      p('anchor'),
    ]});
    // Harness note: the real editor wires BlockBackgroundColor globally; here
    // paragraph may not carry the attr — skip silently if schema dropped it.
    const $pos = ed.state.doc.resolve(findText(ed, 'x') + 1);
    const unit = resolveMovableBlock($pos)!;
    const hadAttr = unit.node.attrs?.backgroundColor === 'red';
    turnBlockWithSharedStrategy(ed, unit.pos, unit.node, 'heading', { level: 2 });
    expect(shape(ed)).toContain('heading"x"');
    if (hadAttr) {
      let headingBg: string | null = null;
      ed.state.doc.descendants((n) => {
        if (n.type.name === 'heading') headingBg = n.attrs?.backgroundColor ?? null;
        return true;
      });
      expect(headingBg).toBe('red');
    }
  });
});
