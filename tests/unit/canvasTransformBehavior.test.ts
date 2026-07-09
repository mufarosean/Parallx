// @vitest-environment jsdom
//
// canvasTransformBehavior.test.ts — Behavioral pin for the generic transform
// engine (blockTransforms.ts) against a REAL headless tiptap editor.
//
// The engine's core invariant: A TRANSFORM NEVER DESTROYS CHILD BLOCKS.
// Content either moves into the new block or lands as trailing siblings.
// These tests exercise the decompose → build matrix on real documents so a
// regression in any per-shape path fails loudly here, not in the user's notes.

import { describe, expect, it } from 'vitest';
import { Editor } from '@tiptap/core';
import StarterKit from '@tiptap/starter-kit';
import TaskList from '@tiptap/extension-task-list';
import TaskItem from '@tiptap/extension-task-item';
import { Details, DetailsSummary, DetailsContent } from '@tiptap/extension-details';
import { Callout } from '../../src/built-in/canvas/extensions/calloutNode';
import { ToggleHeading, ToggleHeadingText } from '../../src/built-in/canvas/extensions/toggleHeadingNode';
import { MathBlock } from '../../src/built-in/canvas/extensions/mathBlockNode';
import { turnBlockWithSharedStrategy } from '../../src/built-in/canvas/config/blockStateRegistry/blockTransforms';

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
    ],
    content,
  });
}

function p(text: string) {
  return { type: 'paragraph', content: [{ type: 'text', text }] };
}

/** All text runs in the doc, in order — the data-preservation fingerprint. */
function allText(ed: Editor): string[] {
  const out: string[] = [];
  ed.state.doc.descendants((node) => {
    if (node.isText && node.text) out.push(node.text);
    if (node.type.name === 'mathBlock' && node.attrs?.latex) out.push(String(node.attrs.latex));
    return true;
  });
  return out;
}

/**
 * Top-level node types, with the trailing-node artifact removed: StarterKit v3
 * bundles the TrailingNode extension (the real canvas editor has it too), which
 * appends one empty paragraph whenever the doc ends in a non-textblock. That
 * paragraph is editor chrome, not transform output.
 */
function topLevelTypes(ed: Editor): string[] {
  const out: string[] = [];
  ed.state.doc.forEach((node) => out.push(node.type.name));
  const last = ed.state.doc.child(ed.state.doc.childCount - 1);
  if (out.length > 1 && last.type.name === 'paragraph' && last.content.size === 0) {
    out.pop();
  }
  return out;
}

function turnFirstBlock(ed: Editor, targetType: string, attrs?: any): void {
  turnBlockWithSharedStrategy(ed, 0, ed.state.doc.child(0), targetType, attrs);
}

describe('generic transform engine — no data loss', () => {
  it('callout with 3 paragraphs → heading keeps every paragraph (trailing siblings)', () => {
    const ed = makeEditor({ type: 'doc', content: [
      { type: 'callout', content: [p('first'), p('second'), p('third')] },
    ]});
    turnFirstBlock(ed, 'heading', { level: 2 });
    expect(allText(ed)).toEqual(['first', 'second', 'third']);
    expect(topLevelTypes(ed)).toEqual(['heading', 'paragraph', 'paragraph']);
    expect(ed.state.doc.child(0).attrs.level).toBe(2);
  });

  it('whole bulleted list (3 rows) → paragraph keeps the remaining rows as a list', () => {
    const ed = makeEditor({ type: 'doc', content: [
      { type: 'bulletList', content: [
        { type: 'listItem', content: [p('one')] },
        { type: 'listItem', content: [p('two')] },
        { type: 'listItem', content: [p('three')] },
      ]},
    ]});
    turnFirstBlock(ed, 'paragraph');
    expect(allText(ed)).toEqual(['one', 'two', 'three']);
    expect(topLevelTypes(ed)).toEqual(['paragraph', 'bulletList']);
  });

  it('callout body → codeBlock: text becomes code, body blocks survive as siblings', () => {
    const ed = makeEditor({ type: 'doc', content: [
      { type: 'callout', content: [p('title line'), p('body')] },
    ]});
    turnFirstBlock(ed, 'codeBlock');
    expect(topLevelTypes(ed)).toEqual(['codeBlock', 'paragraph']);
    expect(allText(ed).join('|')).toContain('body');
  });

  it('populated callout → mathBlock keeps body blocks as siblings', () => {
    const ed = makeEditor({ type: 'doc', content: [
      { type: 'callout', content: [p('E = mc^2'), p('derivation note')] },
    ]});
    turnFirstBlock(ed, 'mathBlock');
    expect(topLevelTypes(ed)).toEqual(['mathBlock', 'paragraph']);
    expect(allText(ed)).toContain('derivation note');
  });
});

describe('generic transform engine — shape matrix', () => {
  it('paragraph → callout wraps the text', () => {
    const ed = makeEditor({ type: 'doc', content: [p('note')] });
    turnFirstBlock(ed, 'callout');
    expect(topLevelTypes(ed)).toEqual(['callout']);
    expect(allText(ed)).toEqual(['note']);
  });

  it('callout ⇄ details: body blocks move into the details body, summary keeps first line', () => {
    const ed = makeEditor({ type: 'doc', content: [
      { type: 'callout', content: [p('summary line'), p('body A'), p('body B')] },
    ]});
    turnFirstBlock(ed, 'details');
    expect(topLevelTypes(ed)).toEqual(['details']);
    const details = ed.state.doc.child(0);
    expect(details.child(0).type.name).toBe('detailsSummary');
    expect(details.child(0).textContent).toBe('summary line');
    expect(details.child(1).type.name).toBe('detailsContent');
    expect(details.child(1).childCount).toBe(2);
    expect(allText(ed)).toEqual(['summary line', 'body A', 'body B']);
  });

  it('details → callout: summary becomes first paragraph, body follows', () => {
    const ed = makeEditor({ type: 'doc', content: [
      { type: 'details', content: [
        { type: 'detailsSummary', content: [{ type: 'text', text: 'the summary' }] },
        { type: 'detailsContent', content: [p('inner one'), p('inner two')] },
      ]},
    ]});
    turnFirstBlock(ed, 'callout');
    expect(topLevelTypes(ed)).toEqual(['callout']);
    expect(allText(ed)).toEqual(['the summary', 'inner one', 'inner two']);
  });

  it('details → paragraph unwraps: summary line + body blocks keep their own types', () => {
    const ed = makeEditor({ type: 'doc', content: [
      { type: 'details', content: [
        { type: 'detailsSummary', content: [{ type: 'text', text: 'sum' }] },
        { type: 'detailsContent', content: [
          { type: 'heading', attrs: { level: 3 }, content: [{ type: 'text', text: 'kept heading' }] },
          p('kept para'),
        ]},
      ]},
    ]});
    turnFirstBlock(ed, 'paragraph');
    expect(topLevelTypes(ed)).toEqual(['paragraph', 'heading', 'paragraph']);
    expect(allText(ed)).toEqual(['sum', 'kept heading', 'kept para']);
  });

  it('callout → paragraph unwraps preserving inner block types', () => {
    const ed = makeEditor({ type: 'doc', content: [
      { type: 'callout', content: [
        { type: 'heading', attrs: { level: 2 }, content: [{ type: 'text', text: 'head' }] },
        p('tail'),
      ]},
    ]});
    turnFirstBlock(ed, 'paragraph');
    expect(topLevelTypes(ed)).toEqual(['heading', 'paragraph']);
    expect(allText(ed)).toEqual(['head', 'tail']);
  });

  it('paragraph → toggleHeading builds title + empty body', () => {
    const ed = makeEditor({ type: 'doc', content: [p('toggle title')] });
    turnFirstBlock(ed, 'toggleHeading', { level: 2 });
    const th = ed.state.doc.child(0);
    expect(th.type.name).toBe('toggleHeading');
    expect(th.attrs.level).toBe(2);
    expect(th.child(0).type.name).toBe('toggleHeadingText');
    expect(th.child(0).textContent).toBe('toggle title');
    expect(th.child(1).type.name).toBe('detailsContent');
  });

  it('callout → bulletList nests body blocks under the new row', () => {
    const ed = makeEditor({ type: 'doc', content: [
      { type: 'callout', content: [p('row text'), p('nested body')] },
    ]});
    turnFirstBlock(ed, 'bulletList');
    expect(topLevelTypes(ed)).toEqual(['bulletList']);
    const item = ed.state.doc.child(0).child(0);
    expect(item.type.name).toBe('listItem');
    expect(item.childCount).toBe(2); // paragraph + adopted body block
    expect(allText(ed)).toEqual(['row text', 'nested body']);
  });

  it('mathBlock → paragraph carries the latex out as text', () => {
    const ed = makeEditor({ type: 'doc', content: [
      { type: 'mathBlock', attrs: { latex: '\\alpha + \\beta' } },
    ]});
    turnFirstBlock(ed, 'paragraph');
    expect(topLevelTypes(ed)).toEqual(['paragraph']);
    expect(allText(ed)).toEqual(['\\alpha + \\beta']);
  });

  it('taskList target builds an unchecked task row', () => {
    const ed = makeEditor({ type: 'doc', content: [
      { type: 'callout', content: [p('todo text'), p('detail')] },
    ]});
    turnFirstBlock(ed, 'taskList');
    expect(topLevelTypes(ed)).toEqual(['taskList']);
    const item = ed.state.doc.child(0).child(0);
    expect(item.type.name).toBe('taskItem');
    expect(item.attrs.checked).toBe(false);
    expect(allText(ed)).toEqual(['todo text', 'detail']);
  });
});

describe('generic transform engine — list rows (Tiptap-native path)', () => {
  it('nested parent row → heading lifts the row and PRESERVES its children and siblings', () => {
    const ed = makeEditor({ type: 'doc', content: [
      { type: 'bulletList', content: [
        { type: 'listItem', content: [
          p('parent'),
          { type: 'bulletList', content: [
            { type: 'listItem', content: [p('child A')] },
            { type: 'listItem', content: [p('child B')] },
          ]},
        ]},
        { type: 'listItem', content: [p('sibling')] },
      ]},
    ]});
    const li = ed.state.doc.nodeAt(1)!;
    expect(li.type.name).toBe('listItem');
    turnBlockWithSharedStrategy(ed, 1, li, 'heading', { level: 2 });
    expect(allText(ed).sort()).toEqual(['child A', 'child B', 'parent', 'sibling'].sort());
    expect(topLevelTypes(ed)[0]).toBe('heading');
  });

  it('bullet row → task row converts the list type', () => {
    const ed = makeEditor({ type: 'doc', content: [
      { type: 'bulletList', content: [{ type: 'listItem', content: [p('row')] }] },
    ]});
    const li = ed.state.doc.nodeAt(1)!;
    turnBlockWithSharedStrategy(ed, 1, li, 'taskList');
    expect(topLevelTypes(ed)).toEqual(['taskList']);
    expect(allText(ed)).toEqual(['row']);
  });
});

describe('generic transform engine — simple textblock conversions still work', () => {
  it('paragraph → heading → blockquote round trip', () => {
    const ed = makeEditor({ type: 'doc', content: [p('text')] });
    turnFirstBlock(ed, 'heading', { level: 1 });
    expect(ed.state.doc.child(0).type.name).toBe('heading');
    turnFirstBlock(ed, 'blockquote');
    expect(ed.state.doc.child(0).type.name).toBe('blockquote');
    expect(allText(ed)).toEqual(['text']);
  });

  it('paragraph → bulletList via Tiptap command', () => {
    const ed = makeEditor({ type: 'doc', content: [p('bullet me')] });
    turnFirstBlock(ed, 'bulletList');
    expect(ed.state.doc.child(0).type.name).toBe('bulletList');
    expect(allText(ed)).toEqual(['bullet me']);
  });
});
