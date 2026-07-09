// @vitest-environment jsdom
//
// canvasConvertedRowUnits.test.ts — units INSIDE converted rows stay targetable.
//
// In-place row conversion creates shapes that never existed under the old
// toggle-lift engine: a blockquote/heading living INSIDE a listItem.  The
// canonical resolver used to capture any position inside those at the OUTER
// row (its list-item walk ignored page-container boundaries and the row's
// non-first children), so after converting one row, Turn Into / colour /
// drag on the converted block silently operated on the parent row — "works
// on one block and then the rest don't work".

import { describe, expect, it } from 'vitest';
import { Editor } from '@tiptap/core';
import StarterKit from '@tiptap/starter-kit';
import { Callout } from '../../src/built-in/canvas/extensions/calloutNode';
import { turnBlockWithSharedStrategy } from '../../src/built-in/canvas/config/blockStateRegistry/blockTransforms';
import { resolveMovableBlock } from '../../src/built-in/canvas/config/blockStateRegistry/columnInvariants';
import { enumerateBlockUnits } from '../../src/built-in/canvas/config/blockStateRegistry/blockUnit';

function p(text: string) { return { type: 'paragraph', content: [{ type: 'text', text }] }; }

function make(content: any): Editor {
  return new Editor({
    element: document.createElement('div'),
    extensions: [StarterKit, Callout],
    content,
  });
}

const NESTED = () => ({ type: 'doc', content: [
  { type: 'bulletList', content: [
    { type: 'listItem', content: [
      p('parent'),
      { type: 'bulletList', content: [
        { type: 'listItem', content: [p('target')] },
        { type: 'listItem', content: [p('sibling')] },
      ]},
    ]},
  ]},
]});

function findText(ed: Editor, typeName: string, text: string): number {
  let found = -1;
  ed.state.doc.descendants((n, pos) => {
    if (found >= 0) return false;
    if (n.type.name === typeName && n.textContent.startsWith(text)) { found = pos; return false; }
    return true;
  });
  if (found < 0) throw new Error(`${typeName} "${text}" not found`);
  return found;
}

function convertRow(ed: Editor, rowText: string, target: string, attrs?: any): void {
  let rowPos = -1;
  ed.state.doc.descendants((n, pos) => {
    if ((n.type.name === 'listItem') && n.child(0)?.textContent === rowText && rowPos < 0) {
      rowPos = pos; return false;
    }
    return true;
  });
  turnBlockWithSharedStrategy(ed, rowPos, ed.state.doc.nodeAt(rowPos)!, target, attrs);
}

describe('units inside converted rows', () => {
  it('quote-in-row: a position inside the quote resolves to the quote paragraph, NOT the outer row', () => {
    const ed = make(NESTED());
    convertRow(ed, 'target', 'blockquote');
    const quotePos = findText(ed, 'blockquote', 'target');
    const unit = resolveMovableBlock(ed.state.doc.resolve(quotePos + 2))!;
    expect(unit.isListItem).toBe(false);
    expect(unit.node.type.name).toBe('paragraph');
    expect(unit.node.textContent).toBe('target');
  });

  it('heading-in-row (trailing block): resolves to the heading, NOT the outer row', () => {
    const ed = make(NESTED());
    convertRow(ed, 'target', 'heading', { level: 3 });
    const headingPos = findText(ed, 'heading', 'target');
    const unit = resolveMovableBlock(ed.state.doc.resolve(headingPos + 1))!;
    expect(unit.isListItem).toBe(false);
    expect(unit.node.type.name).toBe('heading');
    expect(unit.node.textContent).toBe('target');
  });

  it('the SECOND conversion works: quote-in-row → heading converts the quote in place', () => {
    const ed = make(NESTED());
    convertRow(ed, 'target', 'blockquote');
    // Simulate the handle→menu flow on the quote's paragraph: resolve the
    // unit at a position inside it, then turn THAT unit into a heading.
    const quotePos = findText(ed, 'blockquote', 'target');
    const unit = resolveMovableBlock(ed.state.doc.resolve(quotePos + 2))!;
    turnBlockWithSharedStrategy(ed, unit.pos, unit.node, 'heading', { level: 2 });

    const headingPos = findText(ed, 'heading', 'target');
    expect(headingPos).toBeGreaterThan(0);
    // Sibling row and parent line untouched
    expect(findText(ed, 'listItem', 'sibling')).toBeGreaterThan(0);
    const texts: string[] = [];
    ed.state.doc.descendants((n) => { if (n.isText && n.text) texts.push(n.text); return true; });
    expect(texts).toEqual(['parent', 'target', 'sibling']);
  });

  it('the row line itself still resolves to the row (first child rule intact)', () => {
    const ed = make(NESTED());
    const parentLiPos = 1;
    // inside the parent row's own first paragraph
    const unit = resolveMovableBlock(ed.state.doc.resolve(parentLiPos + 2))!;
    expect(unit.isListItem).toBe(true);
    expect(unit.node.type.name).toBe('listItem');
  });

  it('nested rows still resolve to the innermost row', () => {
    const ed = make(NESTED());
    let nestedPos = -1;
    ed.state.doc.descendants((n, pos) => {
      if (n.type.name === 'listItem' && n.child(0)?.textContent === 'target') { nestedPos = pos; return false; }
      return true;
    });
    const unit = resolveMovableBlock(ed.state.doc.resolve(nestedPos + 2))!;
    expect(unit.isListItem).toBe(true);
    expect(unit.node.textContent).toBe('target');
  });

  it('enumerateBlockUnits emits the converted block as a unit (marquee can select it)', () => {
    const ed = make(NESTED());
    convertRow(ed, 'target', 'blockquote');
    const types = enumerateBlockUnits(ed.state.doc).map(u => u.node.type.name);
    expect(types).toContain('blockquote');
    // and every unit position maps back to its node
    for (const u of enumerateBlockUnits(ed.state.doc)) {
      expect(ed.state.doc.nodeAt(u.pos)?.type.name).toBe(u.node.type.name);
    }
  });

  it('callout-in-row: position inside resolves to the block inside the callout', () => {
    const ed = make(NESTED());
    convertRow(ed, 'target', 'callout');
    const calloutPos = findText(ed, 'callout', 'target');
    const unit = resolveMovableBlock(ed.state.doc.resolve(calloutPos + 2))!;
    expect(unit.isListItem).toBe(false);
    expect(unit.node.type.name).toBe('paragraph');
  });
});
