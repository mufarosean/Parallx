// @vitest-environment jsdom
//
// blockRobustness.probe.test.ts — the SAME battery of operations executed
// against EVERY headlessly-assessable block type. This is the per-type
// robustness audit: a block is "robust" when it survives resolution,
// movement (top-level + into containers), deletion, duplication, and
// undo round-trips without structural drift, ghosts, or data loss.
//
// Types with NodeViews that need app services (pageBlock, database,
// bookmark, video, audio, fileAttachment, tableOfContents, dataview,
// table) are NOT in this battery — they need in-app or Playwright
// verification. Their absence here is a documented gap, not a pass.

import { describe, expect, it } from 'vitest';
import { Editor } from '@tiptap/core';
import StarterKit from '@tiptap/starter-kit';
import TaskList from '@tiptap/extension-task-list';
import TaskItem from '@tiptap/extension-task-item';
import Image from '@tiptap/extension-image';
import { Details, DetailsSummary, DetailsContent } from '@tiptap/extension-details';
import { Fragment } from '@tiptap/pm/model';
import { TableKit } from '@tiptap/extension-table';
import { Column, ColumnList } from '../../../src/built-in/canvas/extensions/columnNodes';
import { MathBlock } from '../../../src/built-in/canvas/extensions/mathBlockNode';
import { Callout } from '../../../src/built-in/canvas/extensions/calloutNode';
import { ToggleHeading, ToggleHeadingText } from '../../../src/built-in/canvas/extensions/toggleHeadingNode';
import { PageBlock } from '../../../src/built-in/canvas/extensions/pageBlockNode';
import { Bookmark } from '../../../src/built-in/canvas/extensions/bookmarkNode';
import { Video, Audio, FileAttachment } from '../../../src/built-in/canvas/extensions/mediaNodes';
import { TableOfContents } from '../../../src/built-in/canvas/extensions/tableOfContentsNode';
import { Dataview } from '../../../src/built-in/canvas/extensions/dataviewNode';
import { moveBlockAboveBelow } from '../../../src/built-in/canvas/config/blockStateRegistry/blockMovement';
import { deleteDraggedSource, resolveMovableBlock } from '../../../src/built-in/canvas/config/blockStateRegistry/columnInvariants';
import { deleteBlockAt, duplicateBlockAt } from '../../../src/built-in/canvas/config/blockStateRegistry/blockLifecycle';
import { turnBlockWithSharedStrategy } from '../../../src/built-in/canvas/config/blockStateRegistry/blockTransforms';

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
      Image,
      TableKit.configure({ table: { resizable: false } }),
      PageBlock,
      Bookmark,
      Video, Audio, FileAttachment,
      TableOfContents,
      Dataview,
    ],
    content,
  });
}

function p(text: string) { return { type: 'paragraph', content: [{ type: 'text', text }] }; }

// ── The battery spec ────────────────────────────────────────────────────────

interface BlockSpec {
  /** Display + doc node type name. */
  readonly type: string;
  /** JSON for one instance of this block (with recognizable content). */
  readonly json: Record<string, any>;
  /** Node type the unit resolver should report when the cursor is inside/at it. */
  readonly unitType: string;
  /** Text fingerprint this block contributes (for data-loss checks). */
  readonly texts: readonly string[];
  /** Whether Turn-Into ⇄ paragraph applies (text-bearing blocks). */
  readonly turnsIntoParagraph: boolean;
  /** True for content-less/atom leaves (cursor can't sit inside). */
  readonly atom?: boolean;
}

const SPECS: readonly BlockSpec[] = [
  { type: 'paragraph', json: p('subject'), unitType: 'paragraph', texts: ['subject'], turnsIntoParagraph: false },
  { type: 'heading', json: { type: 'heading', attrs: { level: 2 }, content: [{ type: 'text', text: 'subject' }] }, unitType: 'heading', texts: ['subject'], turnsIntoParagraph: true },
  { type: 'bulletList', json: { type: 'bulletList', content: [{ type: 'listItem', content: [p('subject')] }, { type: 'listItem', content: [p('subject2')] }] }, unitType: 'listItem', texts: ['subject', 'subject2'], turnsIntoParagraph: true },
  { type: 'orderedList', json: { type: 'orderedList', content: [{ type: 'listItem', content: [p('subject')] }] }, unitType: 'listItem', texts: ['subject'], turnsIntoParagraph: true },
  { type: 'taskList', json: { type: 'taskList', content: [{ type: 'taskItem', attrs: { checked: true }, content: [p('subject')] }] }, unitType: 'taskItem', texts: ['subject'], turnsIntoParagraph: true },
  { type: 'blockquote', json: { type: 'blockquote', content: [p('subject')] }, unitType: 'paragraph', texts: ['subject'], turnsIntoParagraph: true },
  { type: 'codeBlock', json: { type: 'codeBlock', content: [{ type: 'text', text: 'subject' }] }, unitType: 'codeBlock', texts: ['subject'], turnsIntoParagraph: true },
  { type: 'callout', json: { type: 'callout', content: [p('subject'), p('subject2')] }, unitType: 'paragraph', texts: ['subject', 'subject2'], turnsIntoParagraph: true },
  { type: 'details', json: { type: 'details', content: [{ type: 'detailsSummary', content: [{ type: 'text', text: 'subject' }] }, { type: 'detailsContent', content: [p('subject2')] }] }, unitType: 'details', texts: ['subject', 'subject2'], turnsIntoParagraph: true },
  { type: 'toggleHeading', json: { type: 'toggleHeading', attrs: { level: 2 }, content: [{ type: 'toggleHeadingText', content: [{ type: 'text', text: 'subject' }] }, { type: 'detailsContent', content: [p('subject2')] }] }, unitType: 'toggleHeading', texts: ['subject', 'subject2'], turnsIntoParagraph: true },
  { type: 'mathBlock', json: { type: 'mathBlock', attrs: { latex: 'subject' } }, unitType: 'mathBlock', texts: ['subject'], turnsIntoParagraph: true, atom: true },
  { type: 'horizontalRule', json: { type: 'horizontalRule' }, unitType: 'horizontalRule', texts: [], turnsIntoParagraph: false, atom: true },
  { type: 'image', json: { type: 'image', attrs: { src: 'data:image/gif;base64,R0lGODlhAQABAAAAACw=', alt: 'subject' } }, unitType: 'image', texts: [], turnsIntoParagraph: false, atom: true },
  // ── Service-backed blocks: schema + NodeView construction under jsdom ──
  { type: 'table', json: { type: 'table', content: [
      { type: 'tableRow', content: [
        { type: 'tableCell', content: [p('subject')] },
        { type: 'tableCell', content: [p('subject2')] },
      ]},
    ]}, unitType: 'table', texts: ['subject', 'subject2'], turnsIntoParagraph: false },
  { type: 'pageBlock', json: { type: 'pageBlock' }, unitType: 'pageBlock', texts: [], turnsIntoParagraph: false, atom: true },
  { type: 'bookmark', json: { type: 'bookmark' }, unitType: 'bookmark', texts: [], turnsIntoParagraph: false, atom: true },
  { type: 'video', json: { type: 'video' }, unitType: 'video', texts: [], turnsIntoParagraph: false, atom: true },
  { type: 'audio', json: { type: 'audio' }, unitType: 'audio', texts: [], turnsIntoParagraph: false, atom: true },
  { type: 'fileAttachment', json: { type: 'fileAttachment' }, unitType: 'fileAttachment', texts: [], turnsIntoParagraph: false, atom: true },
  { type: 'tableOfContents', json: { type: 'tableOfContents' }, unitType: 'tableOfContents', texts: [], turnsIntoParagraph: false, atom: true },
  { type: 'dataview', json: { type: 'dataview' }, unitType: 'dataview', texts: [], turnsIntoParagraph: false, atom: true },
];

// ── Shared helpers ──────────────────────────────────────────────────────────

/** Standard arena: subject sits between two paragraphs; containers wait
 *  below; a trailing anchor paragraph keeps TrailingNode inert so undo
 *  byte-compares stay clean. */
function arena(spec: BlockSpec): Editor {
  return makeEditor({ type: 'doc', content: [
    p('top'),
    spec.json,
    p('bottom'),
    { type: 'callout', content: [p('c1'), p('c2')] },
    { type: 'columnList', content: [
      { type: 'column', content: [p('a1')] },
      { type: 'column', content: [p('b1')] },
    ]},
    p('tail-anchor'),
  ]});
}

function subjectAt(ed: Editor): { pos: number; node: any } {
  const pos = ed.state.doc.child(0).nodeSize;
  return { pos, node: ed.state.doc.child(1) };
}

/** Canonical JSON of the subject as the schema normalized it. */
function subjectJson(ed: Editor): string {
  return JSON.stringify(subjectAt(ed).node.toJSON());
}

/** All positions of nodes that are byte-identical to the subject JSON. */
function findByJson(ed: Editor, json: string): number[] {
  const hits: number[] = [];
  ed.state.doc.descendants((node, pos) => {
    if (JSON.stringify(node.toJSON()) === json) { hits.push(pos); return false; }
    return true;
  });
  return hits;
}

/** First textblock position INSIDE the subject (for unit resolution). */
function firstTextblockInSubject(ed: Editor): number {
  const { pos, node } = subjectAt(ed);
  let found = -1;
  node.descendants((child: any, offset: number) => {
    if (found >= 0) return false;
    if (child.isTextblock) { found = pos + 1 + offset; return false; }
    return true;
  });
  return found >= 0 ? found : pos;
}

function allText(ed: Editor): string[] {
  const out: string[] = [];
  ed.state.doc.descendants((n) => {
    if (n.isText && n.text) out.push(n.text);
    if (n.type.name === 'mathBlock' && n.attrs?.latex) out.push(String(n.attrs.latex));
    return true;
  });
  return out;
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

function drop(ed: Editor, insertPos: number): void {
  const { pos, node } = subjectAt(ed);
  const content = Fragment.from(ed.state.schema.nodeFromJSON(node.toJSON()));
  const { tr } = ed.state;
  moveBlockAboveBelow(tr, content, insertPos, pos, pos + node.nodeSize, false);
  ed.view.dispatch(tr);
}

function textblockPos(ed: Editor, text: string): number {
  let found = -1;
  ed.state.doc.descendants((n, pos) => {
    if (found >= 0) return false;
    if (n.isTextblock && n.textContent === text) { found = pos; return false; }
    return true;
  });
  if (found < 0) throw new Error(`textblock not found: ${text}`);
  return found;
}

// ── The battery ─────────────────────────────────────────────────────────────

describe.each(SPECS)('block robustness: $type', (spec) => {
  it('resolves to the expected unit', () => {
    const ed = arena(spec);
    const { pos, node } = subjectAt(ed);
    expect(node.type.name).toBe(spec.type);
    if (spec.atom) {
      // Atoms have no interior — the boundary position must report them.
      expect(ed.state.doc.nodeAt(pos)?.type.name).toBe(spec.type);
      return;
    }
    const inside = firstTextblockInSubject(ed);
    const unit = resolveMovableBlock(ed.state.doc.resolve(inside + 1));
    expect(unit, 'no unit resolved').not.toBeNull();
    expect(unit!.node.type.name).toBe(spec.unitType);
  });

  it('moves below "bottom" structurally identical, no ghosts', () => {
    const ed = arena(spec);
    const json = subjectJson(ed);
    const insertPos = ed.state.doc.child(0).nodeSize
      + ed.state.doc.child(1).nodeSize
      + ed.state.doc.child(2).nodeSize;
    drop(ed, insertPos);

    expect(findByJson(ed, json)).toHaveLength(1);
    for (const t of spec.texts) expect(allText(ed)).toContain(t);
    expectNoGhosts(ed);
  });

  it('moves INTO the callout structurally identical', () => {
    if (spec.type === 'callout') return; // same-type nesting — covered by movement probes
    const ed = arena(spec);
    const json = subjectJson(ed);
    drop(ed, textblockPos(ed, 'c2'));

    const hits = findByJson(ed, json);
    expect(hits).toHaveLength(1);
    // And it actually lives inside the callout now.
    const $p = ed.state.doc.resolve(hits[0]);
    let insideCallout = false;
    for (let d = $p.depth; d > 0; d--) if ($p.node(d).type.name === 'callout') insideCallout = true;
    expect(insideCallout).toBe(true);
    expectNoGhosts(ed);
  });

  it('moves INTO a column structurally identical', () => {
    const ed = arena(spec);
    const json = subjectJson(ed);
    drop(ed, textblockPos(ed, 'b1'));

    const hits = findByJson(ed, json);
    expect(hits).toHaveLength(1);
    const $p = ed.state.doc.resolve(hits[0]);
    let insideColumn = false;
    for (let d = $p.depth; d > 0; d--) if ($p.node(d).type.name === 'column') insideColumn = true;
    expect(insideColumn).toBe(true);
    expectNoGhosts(ed);
  });

  it('deleteBlockAt removes it cleanly (siblings + containers intact)', () => {
    const ed = arena(spec);
    const json = subjectJson(ed);
    const { pos, node } = subjectAt(ed);
    deleteBlockAt(ed as any, pos, node);

    expect(findByJson(ed, json)).toHaveLength(0);
    for (const t of ['top', 'bottom', 'c1', 'c2', 'a1', 'b1', 'tail-anchor']) {
      expect(allText(ed)).toContain(t);
    }
    expectNoGhosts(ed);
  });

  it('duplicates as a deep-equal copy', () => {
    const ed = arena(spec);
    const json = subjectJson(ed);
    const { pos, node } = subjectAt(ed);
    duplicateBlockAt(ed as any, pos, node);

    expect(findByJson(ed, json)).toHaveLength(2);
  });

  it('delete → undo restores the byte-identical document', () => {
    const ed = arena(spec);
    const before = JSON.stringify(ed.state.doc.toJSON());
    const { pos, node } = subjectAt(ed);
    deleteBlockAt(ed as any, pos, node);
    ed.commands.undo();
    expect(JSON.stringify(ed.state.doc.toJSON())).toBe(before);
  });

  it('turn-into paragraph and back preserves text (where applicable)', () => {
    if (!spec.turnsIntoParagraph) return;
    const ed = arena(spec);
    const { pos, node } = subjectAt(ed);
    turnBlockWithSharedStrategy(ed as any, pos, node, 'paragraph');
    for (const t of spec.texts) expect(allText(ed)).toContain(t);

    // Back: convert the block that now holds the subject text.
    const holderPos = textblockPos(ed, spec.texts[0]);
    const unit = resolveMovableBlock(ed.state.doc.resolve(holderPos + 1));
    expect(unit).not.toBeNull();
    turnBlockWithSharedStrategy(ed as any, unit!.pos, unit!.node, spec.type);
    for (const t of spec.texts) expect(allText(ed)).toContain(t);
    let present = false;
    ed.state.doc.descendants((n) => { if (n.type.name === spec.type) present = true; return true; });
    expect(present).toBe(true);
    expectNoGhosts(ed);
  });
});
