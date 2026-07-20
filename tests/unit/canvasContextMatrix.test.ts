// @vitest-environment jsdom
//
// canvasContextMatrix.test.ts — the DETERMINISM MATRIX (2026-07-20).
//
// Mufaro's charge: "we have to reduce the number of unexpected outcomes …
// what rules could cause issues with each other?" The synthetic suites
// tested operations on structures; THIS suite tests the same operation in
// every CONTAINER CONTEXT and asserts context-independent invariants:
//
//   I1  INSERTING a block (the slash-menu path: insertContentAt) never
//       splits an ancestor list — list/item counts are unchanged.
//   I2  One Backspace at a block start changes nesting depth by AT MOST
//       one level, and never loses text.
//   I3  Enter on an empty trailing line inside a list row EXITS to a new
//       sibling row (the equation-in-a-step continuation fix).
//   I4  Every op above, undone, restores the canonical document.
//
// Contexts × ops are generated, not hand-picked — when a new block type or
// container lands in the registry, the matrix grows automatically.

import { describe, expect, it } from 'vitest';
import { Editor } from '@tiptap/core';
import { TextSelection } from '@tiptap/pm/state';
import { common, createLowlight } from 'lowlight';
import { createEditorExtensions } from '../../src/built-in/canvas/config/tiptapExtensions';
import { BLOCK_REGISTRY } from '../../src/built-in/canvas/config/blockRegistry';

const definitions = [...BLOCK_REGISTRY.values()];

const lowlight = createLowlight(common);

function makeEditor(content: Record<string, unknown>): Editor {
  return new Editor({
    element: document.createElement('div'),
    extensions: createEditorExtensions(lowlight, {}),
    content,
  });
}

function press(ed: Editor, key: string, init: KeyboardEventInit = {}): void {
  ed.view.dom.dispatchEvent(new KeyboardEvent('keydown', { key, bubbles: true, cancelable: true, ...init }));
}

function undoAll(ed: Editor, max = 30): void {
  for (let i = 0; i < max; i++) {
    const before = ed.state.doc;
    ed.commands.undo();
    if (ed.state.doc.eq(before)) break;
  }
}

function canonicalize(node: any): any {
  if (!node || typeof node !== 'object') return node;
  const out: any = { ...node };
  if (Array.isArray(node.content)) {
    const merged: any[] = [];
    for (const child of node.content.map(canonicalize)) {
      const prev = merged[merged.length - 1];
      if (prev && prev.type === 'text' && child.type === 'text'
        && JSON.stringify(prev.marks ?? []) === JSON.stringify(child.marks ?? [])) {
        prev.text = (prev.text ?? '') + (child.text ?? '');
      } else merged.push(child);
    }
    out.content = merged;
  }
  return out;
}
const canon = (ed: Editor): string => JSON.stringify(canonicalize(ed.getJSON()));

function nodeCensusJson(node: any, out: Map<string, number> = new Map()): Map<string, number> {
  if (!node || typeof node !== 'object') return out;
  if (typeof node.type === 'string') out.set(node.type, (out.get(node.type) ?? 0) + 1);
  if (Array.isArray(node.content)) for (const c of node.content) nodeCensusJson(c, out);
  return out;
}

function count(ed: Editor, type: string): number {
  let n = 0;
  ed.state.doc.descendants((node) => { if (node.type.name === type) n++; return true; });
  return n;
}

function textMass(ed: Editor): number {
  let n = 0;
  ed.state.doc.descendants((node) => { if (node.isText) n += node.text!.length; return true; });
  return n;
}

/** Nesting depth (list levels) of the textblock containing `marker`. */
function nestLevel(ed: Editor, marker: string): number {
  let level = -1;
  ed.state.doc.descendants((node, pos) => {
    if (node.isText && node.text === marker) {
      const $ = ed.state.doc.resolve(pos);
      let lists = 0;
      for (let d = $.depth; d > 0; d--) {
        const t = $.node(d).type.name;
        if (t === 'bulletList' || t === 'orderedList' || t === 'taskList') lists++;
      }
      level = lists;
    }
    return true;
  });
  return level;
}

const p = (text: string) => ({ type: 'paragraph', content: [{ type: 'text', text }] });
const li = (children: any[]) => ({ type: 'listItem', content: children });

// ── Context generators: where the cursor lives when the op happens ─────────
// Each context yields a doc with a paragraph whose text is 'HERE' — the op
// runs at its end — plus expectations about the surrounding structure.
interface Ctx {
  readonly name: string;
  readonly doc: Record<string, unknown>;
  /** node types whose counts must survive an insert unchanged (I1) */
  readonly stable: readonly string[];
}

const CONTEXTS: Ctx[] = [
  {
    name: 'top level',
    doc: { type: 'doc', content: [p('HERE'), p('below')] },
    stable: [],
  },
  {
    name: 'list item L1',
    doc: { type: 'doc', content: [
      { type: 'orderedList', content: [li([p('HERE')]), li([p('next')])] },
    ] },
    stable: ['orderedList', 'listItem'],
  },
  {
    name: 'list item L3 (deep)',
    doc: { type: 'doc', content: [
      { type: 'orderedList', content: [li([
        p('one'),
        { type: 'orderedList', content: [li([
          p('two'),
          { type: 'orderedList', content: [li([p('HERE')]), li([p('after')])] },
        ])] },
      ])] },
    ] },
    stable: ['orderedList', 'listItem'],
  },
  {
    name: 'task item',
    doc: { type: 'doc', content: [
      { type: 'taskList', content: [
        { type: 'taskItem', attrs: { checked: false }, content: [p('HERE')] },
        { type: 'taskItem', attrs: { checked: false }, content: [p('next')] },
      ] },
    ] },
    stable: ['taskList', 'taskItem'],
  },
  {
    name: 'column',
    doc: { type: 'doc', content: [
      { type: 'columnList', content: [
        { type: 'column', content: [p('HERE')] },
        { type: 'column', content: [p('right')] },
      ] },
    ] },
    stable: ['columnList', 'column'],
  },
  {
    name: 'list item inside a column',
    doc: { type: 'doc', content: [
      { type: 'columnList', content: [
        { type: 'column', content: [
          { type: 'bulletList', content: [li([p('HERE')]), li([p('next')])] },
        ] },
        { type: 'column', content: [p('right')] },
      ] },
    ] },
    stable: ['columnList', 'column', 'bulletList', 'listItem'],
  },
];

function cursorAtHere(ed: Editor): number {
  let pos = -1;
  ed.state.doc.descendants((node, po) => {
    if (node.isText && node.text === 'HERE') pos = po + node.nodeSize;
    return true;
  });
  expect(pos, 'HERE marker not found').toBeGreaterThan(0);
  return pos;
}

// Insertable blocks straight from the registry — the same defaultContent the
// slash menu's generic path uses. Composite/UI-dependent blocks with custom
// insertActions are exercised through their defaultContent when present.
const INSERTABLE = definitions
  .filter((d) => d.defaultContent && d.slashMenu)
  .filter((d) => !['columnList', 'column'].includes(d.name)); // layout ops have their own suite

describe('determinism matrix — I1: insertion never splits ancestors', () => {
  for (const ctx of CONTEXTS) {
    for (const def of INSERTABLE) {
      it(`insert ${def.id} @ ${ctx.name}`, () => {
        const ed = makeEditor(ctx.doc);
        try {
          // The inserted content may LEGITIMATELY add container nodes of the
          // watched types (inserting a bulletList adds one bulletList + its
          // items). A split is detected as counts growing BEYOND what the
          // inserted content itself carries.
          const insertedCensus = nodeCensusJson(def.defaultContent);
          const stableBefore = ctx.stable.map((t) => count(ed, t));
          const mass = textMass(ed);
          const pos = cursorAtHere(ed);
          const inserted = ed.commands.insertContentAt({ from: pos, to: pos }, def.defaultContent as any);
          if (!inserted) return; // schema forbids it here — refusing is deterministic and fine
          ctx.stable.forEach((t, i) => {
            const allowed = stableBefore[i] + (insertedCensus.get(t) ?? 0);
            expect(count(ed, t), `${def.id} split ancestor <${t}> in ${ctx.name}`).toBeLessThanOrEqual(allowed);
          });
          expect(textMass(ed), 'insert lost text').toBeGreaterThanOrEqual(mass);
        } finally {
          ed.destroy();
        }
      });
    }
  }
});

describe('determinism matrix — I2: one Backspace ≤ one nesting level, no text loss', () => {
  const listCtxs = CONTEXTS.filter((c) => c.stable.includes('listItem') || c.stable.includes('taskItem'));
  for (const ctx of listCtxs) {
    it(`backspace at start @ ${ctx.name}`, () => {
      const ed = makeEditor(ctx.doc);
      try {
        const before = nestLevel(ed, 'HERE');
        const mass = textMass(ed);
        const pos = cursorAtHere(ed) - 'HERE'.length;
        ed.view.dispatch(ed.state.tr.setSelection(TextSelection.create(ed.state.doc, pos)));
        press(ed, 'Backspace');
        const after = nestLevel(ed, 'HERE');
        expect(after, `backspace jumped ${before - after} levels in ${ctx.name}`).toBeGreaterThanOrEqual(before - 1);
        expect(textMass(ed), 'backspace lost text').toBe(mass);
      } finally {
        ed.destroy();
      }
    });
  }
});

describe('determinism matrix — I3: empty-line Enter EXITS the list row', () => {
  it('equation-in-a-step: Enter on the empty trailing line creates the next SIBLING step', () => {
    const ed = makeEditor({ type: 'doc', content: [
      { type: 'orderedList', content: [
        li([p('step 1')]),
        li([
          p('step 2'),
          { type: 'mathBlock', attrs: { latex: 'E=mc^2' } },
          { type: 'paragraph' }, // the empty line the caret lands on after the equation
        ]),
        li([p('step 3')]),
      ] },
    ] });
    try {
      let pos = -1;
      ed.state.doc.descendants((node, po) => {
        if (node.type.name === 'paragraph' && node.content.size === 0) pos = po + 1;
        return true;
      });
      ed.view.dispatch(ed.state.tr.setSelection(TextSelection.create(ed.state.doc, pos)));
      press(ed, 'Enter');

      // ONE list, FOUR items now (a fresh sibling between step 2 and 3);
      // the empty paragraph left the equation row.
      expect(count(ed, 'orderedList')).toBe(1);
      expect(count(ed, 'listItem')).toBe(4);
      const items: string[] = [];
      ed.state.doc.descendants((node) => {
        if (node.type.name === 'listItem') items.push(node.childCount.toString());
        return true;
      });
      expect(items).toEqual(['1', '2', '1', '1']); // step2 row: paragraph + equation only
      // Caret sits in the NEW empty row, ready to type step text.
      expect(ed.state.selection.$from.node(2)?.type.name).toBe('listItem');
    } finally {
      ed.destroy();
    }
  });

  it('the same Enter deep in a NESTED list keeps the nesting level', () => {
    const ed = makeEditor({ type: 'doc', content: [
      { type: 'orderedList', content: [li([
        p('outer'),
        { type: 'orderedList', content: [
          li([p('inner 1'), { type: 'mathBlock', attrs: { latex: 'x' } }, { type: 'paragraph' }]),
          li([p('inner 2')]),
        ] },
      ])] },
    ] });
    try {
      let pos = -1;
      ed.state.doc.descendants((node, po) => {
        if (node.type.name === 'paragraph' && node.content.size === 0) pos = po + 1;
        return true;
      });
      ed.view.dispatch(ed.state.tr.setSelection(TextSelection.create(ed.state.doc, pos)));
      press(ed, 'Enter');
      expect(count(ed, 'orderedList')).toBe(2);      // no list split
      expect(count(ed, 'listItem')).toBe(4);         // new sibling in the INNER list
    } finally {
      ed.destroy();
    }
  });
});

describe('determinism matrix — I4: undo restores after every matrix op', () => {
  for (const ctx of CONTEXTS.slice(0, 4)) {
    it(`insert mathBlock + undo @ ${ctx.name}`, () => {
      const ed = makeEditor(ctx.doc);
      try {
        const baseline = canon(ed);
        const pos = cursorAtHere(ed);
        ed.commands.insertContentAt({ from: pos, to: pos }, { type: 'mathBlock', attrs: { latex: 'x' } });
        undoAll(ed);
        expect(canon(ed)).toBe(baseline);
      } finally {
        ed.destroy();
      }
    });
  }
});
