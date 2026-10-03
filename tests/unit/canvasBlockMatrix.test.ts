// @vitest-environment jsdom
//
// canvasBlockMatrix.test.ts — every block × every structural operation, on
// the app's own editor.
//
// Three sweeps, each asserting after every single operation that:
//   • the doc is schema-valid, no layout has fewer than 2 columns, and no two
//     blocks share an id;
//   • no content is lost or duplicated (every character, equation, image,
//     table cell and atom block is still there exactly once);
//   • undo restores the document exactly (ids included).
//
//   1. Turn into — 15 source shapes (paragraph, headings, code, quote,
//      callout, toggle, toggle heading, equation, and list rows at three
//      depths) × 14 targets × 6 places (page, column, callout, toggle, nested
//      column, inside a list row).
//   2. Drag and drop — 29 blocks dragged from 6 places (page, column, the
//      only block of a column, nested column, callout, a column beside an
//      empty table) onto 15 targets in all 4 zones, moved and Alt-copied.
//   3. Keyboard — Mod-Shift-↑/↓ pressed until the block stops, for every
//      block in 9 places, through real keydown events.
//
// Then one named test per bug the sweeps found (2026-10-03), so each failure
// says what broke.

import { describe, expect, it } from 'vitest';
import { Fragment } from '@tiptap/pm/model';
import { NodeSelection, TextSelection } from '@tiptap/pm/state';
import {
  mk, p, t, li, ti, col, cols, fixtures, tokens, diffTokens, problems, problemsDoc,
  outline, find, withIds, base, press, Sim,
} from './canvasMatrixHarness';
import { turnBlockWithSharedStrategy } from '../../src/built-in/canvas/config/blockStateRegistry/blockTransforms';
import {
  moveBlockAboveBelow,
  areAllDraggedNodesListItems,
} from '../../src/built-in/canvas/config/blockStateRegistry/blockMovement';
import {
  createColumnLayoutFromDrop,
  addColumnToLayoutFromDrop,
  draggedContentAsBlocks,
} from '../../src/built-in/canvas/config/blockStateRegistry/columnCreation';
import {
  resolveMovableBlock,
  deleteDraggedRanges,
  isColumnEffectivelyEmpty,
} from '../../src/built-in/canvas/config/blockStateRegistry/columnInvariants';
import { isDropInsideDragged } from '../../src/built-in/canvas/config/blockStateRegistry/dragSession';
import { duplicateBlockAt } from '../../src/built-in/canvas/config/blockStateRegistry/blockLifecycle';
import { outdentBlock } from '../../src/built-in/canvas/config/blockStateRegistry/blockNesting';
import { moveBlockToLinkedPage } from '../../src/built-in/canvas/config/blockStateRegistry/crossPageMovement';
import { BlockSelectionController, createBlockSelectionPlugin } from '../../src/built-in/canvas/handles/blockSelection';
import {
  setActiveCanvasDragSession,
  clearActiveCanvasDragSession,
} from '../../src/built-in/canvas/config/blockStateRegistry/dragSession';

// ── 1. Turn into ─────────────────────────────────────────────────────────────

const TURN_TARGETS: Array<[string, any]> = [
  ['paragraph', undefined], ['heading', { level: 1 }], ['heading', { level: 3 }],
  ['bulletList', undefined], ['orderedList', undefined], ['taskList', undefined],
  ['details', undefined], ['columnList', { columns: 2 }], ['columnList', { columns: 3 }],
  ['codeBlock', undefined], ['blockquote', undefined], ['callout', undefined], ['mathBlock', undefined],
  ['toggleHeading', { level: 2 }],
];
const TURN_PLACES: Record<string, (b: any) => any[]> = {
  page: (b) => [p('before'), b, p('after')],
  column: (b) => [cols(col(p('before'), b, p('after')), col(p('othercol')))],
  callout: (b) => [{ type: 'callout', attrs: { emoji: 'x' }, content: [p('before'), b, p('after')] }],
  toggle: (b) => [{ type: 'details', content: [{ type: 'detailsSummary', content: [t('ds')] }, { type: 'detailsContent', content: [p('before'), b, p('after')] }] }],
  nestedColumn: (b) => [cols(col(cols(col(p('before'), b, p('after')), col(p('in2')))), col(p('othercol')))],
  listRow: (b) => [{ type: 'bulletList', content: [li(p('before'), b, p('after'))] }],
};

describe('turn into: every source × target × place', () => {
  it('keeps every word, equation and block, stays valid, undoes exactly', { timeout: 600_000 }, () => {
    const F = fixtures();
    const sources: Array<[string, any, string | null]> = [];
    for (const k of ['paragraph', 'heading1', 'heading3', 'codeBlock', 'blockquote', 'callout', 'details', 'toggleHeading', 'mathBlock']) sources.push([k, F[k], null]);
    for (const [k, row] of [['bulletList', 'bula'], ['bulletList', 'bulnest'], ['bulletList', 'bulb'], ['orderedList', 'orda'], ['orderedList', 'ordb'], ['taskList', 'taska']] as const) {
      sources.push([`${k} row ${row}`, F[k], row]);
    }
    const fails: string[] = [];
    let runs = 0;
    for (const [place, wrap] of Object.entries(TURN_PLACES)) {
      for (const [srcName, block, row] of sources) {
        for (const [target, attrs] of TURN_TARGETS) {
          const label = `${place} | ${srcName} → ${target}${attrs ? JSON.stringify(attrs) : ''}`;
          const ed = mk({ type: 'doc', content: wrap(block) });
          try {
            const before = tokens(ed.state.doc);
            const beforeJson = JSON.stringify(ed.getJSON());
            let pos: number, node: any;
            if (row) {
              const r = find(ed, (n) => (n.type.name === 'listItem' || n.type.name === 'taskItem') && n.firstChild?.textContent === row)!;
              pos = r.pos; node = r.node;
            } else {
              const b = find(ed, (n) => n.type.name === 'paragraph' && n.textContent === 'before')!;
              pos = b.pos + b.node.nodeSize; node = ed.state.doc.nodeAt(pos);
            }
            turnBlockWithSharedStrategy(ed, pos, node, target, attrs);
            runs++;
            const issues = problems(ed);
            const d = diffTokens(before, tokens(ed.state.doc));
            if (d.lost.length) issues.push('lost ' + d.lost.join(''));
            if (d.extra.length) issues.push('extra ' + d.extra.join(''));
            if (!find(ed, (n) => n.type.name === 'paragraph' && n.textContent === 'after')) issues.push('next block gone');
            const after = outline(ed.state.doc);
            ed.commands.undo();
            if (JSON.stringify(ed.getJSON()) !== beforeJson) issues.push('undo not exact');
            if (issues.length) fails.push(`${label}: ${issues.join('; ')}\n    → ${after}`);
          } catch (e: any) {
            fails.push(`${label}: threw ${e.message}`);
          } finally {
            ed.destroy();
          }
        }
      }
    }
    expect(fails, fails.join('\n')).toEqual([]);
    expect(runs).toBe(Object.keys(TURN_PLACES).length * sources.length * TURN_TARGETS.length);
  });
});

// ── 2. Drag and drop ─────────────────────────────────────────────────────────

const DRAG_PLACES = ['page', 'column', 'aloneInColumn', 'nestedColumn', 'callout', 'besideEmptyTable'];
function dropDoc(place: string, src: any) {
  const S = (c: string) => (place === c ? [src] : []);
  return { type: 'doc', content: [
    p('t1'), ...S('page'), p('t2'),
    cols({ type: 'column', attrs: { width: 30 }, content: [p('a1'), ...S('column'), p('a2')] }, { type: 'column', attrs: { width: 30 }, content: [p('b1')] }, { type: 'column', attrs: { width: 40 }, content: [p('c1')] }),
    cols(col(...(place === 'aloneInColumn' ? [src] : [p('dd')])), col(p('e1'))),
    cols(col(cols(col(p('n1'), ...S('nestedColumn')), col(p('n2')))), col(p('n3'))),
    { type: 'callout', attrs: { emoji: 'x' }, content: [p('k1'), ...S('callout')] },
    cols(col(...S('besideEmptyTable'), { type: 'table', content: [{ type: 'tableRow', content: [{ type: 'tableCell', content: [p()] }] }] }), col(p('w2'))),
    { type: 'bulletList', content: [li(p('r1')), li(p('r2'))] },
    { type: 'orderedList', content: [li(p('o1')), li(p('o2'))] },
    p('t3'),
  ] };
}
const DROP_TARGETS = ['t1', 't2', 'a1', 'a2', 'b1', 'c1', 'e1', 'n2', 'n3', 'k1', 'r1', 'r2', 'o2', 't3', 'w2'];

function dropTarget(sim: Sim, text: string) {
  const f = sim.find((n: any) => n.type.name === 'paragraph' && n.textContent === text);
  const $p = sim.doc.resolve(f.pos + 1);
  const m = resolveMovableBlock($p)!;
  return {
    blockPos: m.pos, blockNode: m.node, isListItem: m.isListItem, listPos: m.listPos, listNode: m.listNode, listType: m.listType,
    columnPos: m.columnDepth !== null ? $p.before(m.columnDepth) : null,
    columnListPos: m.columnListDepth !== null ? $p.before(m.columnListDepth) : null,
  };
}

/** columnDropPlugin's drop handler, minus the DOM (same primitives, same branches). */
function drop(sim: Sim, ranges: Array<{ from: number; to: number }>, nodes: any[], listType: string | null, raw: any, zone: string, copy: boolean): 'ok' | 'skip' | 'refused' {
  const state = sim.state;
  const schema = state.schema;
  const content = Fragment.from(nodes);
  const rowsOnly = areAllDraggedNodesListItems(content);
  let target = { ...raw };
  if (!rowsOnly && target.isListItem && (zone === 'left' || zone === 'right')) {
    target = { ...target, blockPos: target.listPos, blockNode: target.listNode, isListItem: false, listPos: null, listNode: null, listType: null };
  } else if (target.isListItem && (zone === 'left' || zone === 'right')) return 'skip';
  if (target.blockNode.type.name === 'table' && (zone === 'left' || zone === 'right')) return 'skip';
  const inDragged = (pos: number) => ranges.some((r) => pos >= r.from && pos < r.to);
  if (inDragged(target.blockPos)) return 'skip';
  const $t = state.doc.resolve(target.blockPos);
  for (let d = $t.depth; d >= 1; d--) if (inDragged($t.before(d))) return 'skip';
  const from = ranges[0].from, to = ranges[ranges.length - 1].to;
  const tr = state.tr;
  if (zone === 'above' || zone === 'below') {
    const insertPos = zone === 'above' ? target.blockPos : target.blockPos + target.blockNode.nodeSize;
    if (!copy && isDropInsideDragged(insertPos, ranges)) return 'skip';
    if (rowsOnly && target.isListItem && target.listType === listType) {
      moveBlockAboveBelow(tr, content, insertPos, from, to, copy, ranges);
    } else if (rowsOnly) {
      tr.insert(insertPos, draggedContentAsBlocks(schema, state.doc, content, ranges));
      if (!copy) deleteDraggedRanges(tr, ranges);
    } else {
      moveBlockAboveBelow(tr, draggedContentAsBlocks(schema, state.doc, content, ranges), insertPos, from, to, copy, ranges);
    }
  } else if (target.columnPos === null) {
    if (!createColumnLayoutFromDrop(tr, schema, content, target.blockPos, target.blockNode, zone as any, from, to, copy, ranges)) return 'refused';
  } else if (!addColumnToLayoutFromDrop(tr, state.doc, schema, content, target.columnPos, target.columnListPos, zone as any, from, to, copy, ranges)) {
    return 'refused';
  }
  sim.dispatch(tr);
  return 'ok';
}

describe('drag and drop: every block × source place × target × zone', () => {
  it('moves and copies without loss, stays valid, undoes exactly', { timeout: 600_000 }, () => {
    const F = fixtures();
    const sources: Array<[string, any, string | null]> = Object.keys(F).map((k) => [k, F[k], null] as [string, any, string | null]);
    sources.push(['bullet row', F.bulletList, 'bulb'], ['numbered row', F.orderedList, 'orda'], ['to-do row', F.taskList, 'taskb'], ['nested row', F.bulletList, 'bulnest']);
    const fails: string[] = [];
    let runs = 0;
    for (const place of DRAG_PLACES) for (const [name, block, row] of sources) for (const tgt of DROP_TARGETS) for (const zone of ['above', 'below', 'left', 'right']) for (const copy of [false, true]) {
      if (copy && zone !== 'right' && zone !== 'below') continue;
      const label = `${place}:${name} → ${zone} of ${tgt}${copy ? ' (copy)' : ''}`;
      try {
        const sim = new Sim(dropDoc(place, block));
        const before = tokens(sim.doc);
        const beforeJson = sim.json();
        let pos: number, node: any, listType: string | null = null;
        if (row) {
          const r = sim.find((n: any) => (n.type.name === 'listItem' || n.type.name === 'taskItem') && n.firstChild?.textContent === row);
          pos = r.pos; node = r.node; listType = sim.doc.resolve(pos).parent.type.name;
        } else if (place === 'aloneInColumn') {
          const e1 = sim.find((n: any) => n.type.name === 'paragraph' && n.textContent === 'e1');
          const $e = sim.doc.resolve(e1.pos);
          const end = $e.before($e.depth) - 1;
          node = sim.doc.resolve(end).nodeBefore; pos = end - node.nodeSize;
        } else if (place === 'besideEmptyTable') {
          const w2 = sim.find((n: any) => n.type.name === 'paragraph' && n.textContent === 'w2');
          const $w = sim.doc.resolve(w2.pos);
          const layout = $w.before($w.depth - 1);
          pos = layout + 2; node = sim.doc.nodeAt(pos);
        } else {
          const prev = ({ page: 't1', column: 'a1', nestedColumn: 'n1', callout: 'k1' } as any)[place];
          const a = sim.find((n: any) => n.type.name === 'paragraph' && n.textContent === prev);
          pos = a.pos + a.node.nodeSize; node = sim.doc.nodeAt(pos);
        }
        const res = drop(sim, [{ from: pos, to: pos + node.nodeSize }], [node], listType, dropTarget(sim, tgt), zone, copy);
        if (res === 'skip') continue;
        if (res === 'refused') { fails.push(`${label}: refused`); continue; }
        runs++;
        const issues = problemsDoc(sim.doc);
        // A copied page card is dropped (a page has one card): nothing is added.
        const copied = copy && node.type.name !== 'pageBlock';
        const d = diffTokens(copied ? [...before, ...tokens(node)].sort() : before, tokens(sim.doc));
        if (d.lost.length) issues.push('lost ' + d.lost.join(''));
        if (d.extra.length) issues.push('extra ' + d.extra.join(''));
        const after = outline(sim.doc);
        sim.undo();
        if (sim.json() !== beforeJson) issues.push('undo not exact');
        if (issues.length) fails.push(`${label}: ${issues.join('; ')}\n    → ${after}`);
      } catch (e: any) {
        fails.push(`${label}: threw ${e.message}`);
      }
    }
    expect(fails, fails.join('\n')).toEqual([]);
    expect(runs).toBeGreaterThan(14_000);
  });
});

// ── 3. Keyboard moves ────────────────────────────────────────────────────────

const KEY_PLACES: Record<string, (s: any) => any[]> = {
  page: (s) => [p('t1'), s, p('t2')],
  column: (s) => [p('t1'), cols({ type: 'column', attrs: { width: 30 }, content: [p('a1'), s, p('a2')] }, { type: 'column', attrs: { width: 70 }, content: [p('b1')] }), cols({ type: 'column', attrs: { width: 20 }, content: [p('x1')] }, { type: 'column', attrs: { width: 80 }, content: [p('x2')] }), p('t2')],
  aloneOf2: (s) => [p('t1'), cols(col(s), col(p('b1'))), p('t2')],
  aloneOf3: (s) => [p('t1'), cols(col(s), col(p('b1')), col(p('c1'))), p('t2')],
  besideEmptyTable: (s) => [p('t1'), cols(col(s, { type: 'table', content: [{ type: 'tableRow', content: [{ type: 'tableCell', content: [p()] }] }] }), col(p('b1'))), p('t2')],
  besideEmptyCallout: (s) => [p('t1'), cols(col({ type: 'callout', attrs: { emoji: 'x' }, content: [p()] }, s), col(p('b1'))), p('t2')],
  nestedColumn: (s) => [p('t1'), cols(col(p('n0'), cols(col(s), col(p('n2')))), col(p('n3'))), p('t2')],
  callout: (s) => [p('t1'), { type: 'callout', attrs: { emoji: 'x' }, content: [p('k1'), s, p('k2')] }, p('t2')],
  calloutInColumn: (s) => [p('t1'), cols(col({ type: 'callout', attrs: { emoji: 'x' }, content: [s] }), col(p('b1'))), p('t2')],
};
const CONTEXT_TEXT = new Set(['t1', 't2', 'a1', 'a2', 'b1', 'c1', 'x1', 'x2', 'n0', 'n2', 'n3', 'k1', 'k2', '']);

function selectSource(ed: any, name: string, row: string | null): void {
  const doc = ed.state.doc;
  if (row) {
    const r = find(ed, (n) => n.type.name === 'paragraph' && n.textContent === row)!;
    ed.view.dispatch(ed.state.tr.setSelection(TextSelection.create(doc, r.pos + 1)));
    return;
  }
  const type = fixtures()[name].type;
  const r = find(ed, (n) => n.type.name === type
    && !(n.type.name === 'paragraph' && CONTEXT_TEXT.has(n.textContent))
    && !(type === 'callout' && n.textContent === '' && name !== 'emptyCallout')
    && !(type === 'table' && name === 'table' && n.textContent === ''))!;
  if (r.node.isAtom || ['horizontalRule', 'image', 'table', 'columnList'].includes(r.node.type.name)) {
    ed.view.dispatch(ed.state.tr.setSelection(NodeSelection.create(doc, r.pos)));
    return;
  }
  let tb = r.node.isTextblock ? r.pos + 1 : -1;
  if (tb < 0) r.node.descendants((n: any, pos: number) => { if (tb >= 0) return false; if (n.isTextblock) { tb = r.pos + 1 + pos + 1; return false; } return true; });
  ed.view.dispatch(ed.state.tr.setSelection(TextSelection.create(doc, tb)));
}

describe('keyboard: Mod-Shift-↑/↓ for every block in every place', () => {
  it('moves until it stops, without loss, stays valid, undoes exactly', { timeout: 600_000 }, () => {
    const F = fixtures();
    const sources: Array<[string, string | null]> = Object.keys(F).map((k) => [k, null] as [string, string | null]);
    sources.push(['bulletList', 'bulb'], ['bulletList', 'bulnest'], ['orderedList', 'orda'], ['taskList', 'taskb']);
    const fails: string[] = [];
    const stuck: string[] = [];
    for (const [place, wrap] of Object.entries(KEY_PLACES)) for (const [name, row] of sources) for (const dir of ['Up', 'Down']) {
      const label = `${place}:${name}${row ? ' row ' + row : ''} ${dir}`;
      const ed = mk(withIds({ type: 'doc', content: wrap(F[name]) }, base().schema));
      try {
        const startJson = JSON.stringify(ed.getJSON());
        const before = tokens(ed.state.doc);
        selectSource(ed, name, row);
        let presses = 0;
        for (let i = 0; i < 10; i++) {
          const prev = JSON.stringify(ed.getJSON());
          press(ed, `Arrow${dir}`, { ctrl: true, shift: true });
          if (JSON.stringify(ed.getJSON()) === prev) break;
          presses++;
          const issues = problems(ed);
          const d = diffTokens(before, tokens(ed.state.doc));
          if (d.lost.length) issues.push('lost ' + d.lost.join(''));
          if (d.extra.length) issues.push('extra ' + d.extra.join(''));
          if (issues.length) { fails.push(`${label}, press ${i + 1}: ${issues.join('; ')}\n    → ${outline(ed.state.doc)}`); break; }
        }
        if (presses === 0) stuck.push(label);
        for (let i = 0; i < presses + 2; i++) ed.commands.undo();
        if (JSON.stringify(ed.getJSON()) !== startJson) fails.push(`${label}: undo not exact`);
      } catch (e: any) {
        fails.push(`${label}: threw ${e.message}`);
      } finally {
        ed.destroy();
      }
    }
    expect(fails, fails.join('\n')).toEqual([]);
    // Every block moves from every place except a row of a list that fills a
    // callout inside a column, pressed toward the list's outer edge (it would
    // have to leave the list and the callout at once).
    expect(stuck).toEqual([
      'calloutInColumn:bulletList Up', 'calloutInColumn:orderedList Up', 'calloutInColumn:taskList Up',
      'calloutInColumn:bulletList row bulb Down', 'calloutInColumn:orderedList row orda Up', 'calloutInColumn:taskList row taskb Down',
    ]);
  });
});

// ── Named regressions ────────────────────────────────────────────────────────

/** Outline without the empty paragraph the editor keeps at the end of a page. */
function body(doc: any): string {
  return outline(doc).replace(/, paragraph\(""\)$/, '');
}

function textOf(ed: any): string[] {
  const out: string[] = [];
  ed.state.doc.descendants((n: any) => { if (n.isText) out.push(n.text); return true; });
  return out;
}

describe('turn into: regressions', () => {
  it('callout → code takes the first line only; the rest stays as blocks (no doubled text)', () => {
    const ed = mk({ type: 'doc', content: [{ type: 'callout', content: [p('title line'), p('body')] }] });
    turnBlockWithSharedStrategy(ed, 0, ed.state.doc.child(0), 'codeBlock');
    expect(ed.state.doc.child(0).type.name).toBe('codeBlock');
    expect(ed.state.doc.child(0).textContent).toBe('title line');
    expect(textOf(ed)).toEqual(['title line', 'body']);
  });

  it('text → code keeps line breaks and inline equations; → equation keeps the LaTeX bare', () => {
    const para = p('a', { type: 'hardBreak' }, 'b ', { type: 'inlineMath', attrs: { latex: 'x^2' } });
    const ed = mk({ type: 'doc', content: [para] });
    turnBlockWithSharedStrategy(ed, 0, ed.state.doc.child(0), 'codeBlock');
    expect(ed.state.doc.child(0).textContent).toBe('a\nb $x^2$');
    const ed2 = mk({ type: 'doc', content: [para] });
    turnBlockWithSharedStrategy(ed2, 0, ed2.state.doc.child(0), 'mathBlock');
    expect(ed2.state.doc.child(0).attrs.latex).toBe('a\nb x^2');
  });

  it('code → text turns lines into line breaks', () => {
    const ed = mk({ type: 'doc', content: [{ type: 'codeBlock', content: [t('one\ntwo')] }] });
    turnBlockWithSharedStrategy(ed, 0, ed.state.doc.child(0), 'paragraph');
    const json = ed.getJSON().content![0];
    expect(json.content!.map((n: any) => n.type)).toEqual(['text', 'hardBreak', 'text']);
  });

  it('text with a line break or equation → toggle does not throw', () => {
    const ed = mk({ type: 'doc', content: [p('a', { type: 'hardBreak' }, 'b', { type: 'inlineMath', attrs: { latex: 'y' } })] });
    turnBlockWithSharedStrategy(ed, 0, ed.state.doc.child(0), 'details');
    expect(ed.state.doc.child(0).type.name).toBe('details');
    expect(ed.state.doc.child(0).child(0).textContent).toBe('a b$y$');
  });

  it('a list row → columns puts the row, with its list type, in the first column', () => {
    const ed = mk({ type: 'doc', content: [{ type: 'orderedList', attrs: { start: 4 }, content: [li(p('one')), li(p('two')), li(p('three'))] }] });
    const r = find(ed, (n) => n.type.name === 'listItem' && n.textContent === 'two')!;
    turnBlockWithSharedStrategy(ed, r.pos, r.node, 'columnList', { columns: 2 });
    expect(problems(ed)).toEqual([]);
    expect(body(ed.state.doc)).toBe('orderedList[listItem[paragraph("one")]], columnList[column[orderedList[listItem[paragraph("two")]]], column[paragraph("")]], orderedList[listItem[paragraph("three")]]');
  });
});

describe('ids and page cards', () => {
  it('Alt-drag copy and Duplicate give the copy its own id', () => {
    const ed = mk(withIds({ type: 'doc', content: [p('a'), p('b')] }, base().schema));
    const a = ed.state.doc.child(0);
    const tr = ed.state.tr;
    moveBlockAboveBelow(tr, Fragment.from(a), a.nodeSize + ed.state.doc.child(1).nodeSize, 0, a.nodeSize, true);
    ed.view.dispatch(tr);
    duplicateBlockAt(ed, 0, ed.state.doc.child(0));
    expect(problems(ed)).toEqual([]);
    expect(ed.state.doc.child(0).attrs.id).toBe('id1');
  });

  it('a copied page card is dropped: a page has one card', () => {
    const ed = mk(withIds({ type: 'doc', content: [{ type: 'pageBlock', attrs: { pageId: 'child-1', title: 'Child' } }, p('x')] }, base().schema));
    duplicateBlockAt(ed, 0, ed.state.doc.child(0));
    let cards = 0;
    ed.state.doc.descendants((n: any) => { if (n.type.name === 'pageBlock') cards++; return true; });
    expect(cards).toBe(1);
    expect(ed.state.doc.child(0).attrs.id).toBe('id1');
  });
});

describe('columns: regressions', () => {
  it('an empty table, callout or list in a column is content, not an empty column', () => {
    const ed = mk({ type: 'doc', content: [cols(
      col({ type: 'table', content: [{ type: 'tableRow', content: [{ type: 'tableCell', content: [p()] }] }] }),
      col({ type: 'callout', content: [p()] }),
      col({ type: 'bulletList', content: [li(p())] }),
      col(p(), p()),
    )] });
    const columns: boolean[] = [];
    ed.state.doc.child(0).forEach((c: any) => columns.push(isColumnEffectivelyEmpty(c)));
    expect(columns).toEqual([false, false, false, true]);
  });

  it('dragging a block out of a column that keeps content leaves the other empty column alone', () => {
    const sim = new Sim({ type: 'doc', content: [p('top'), cols(col(p('keep'), p('drag me')), col(p()))] });
    const src = sim.find((n: any) => n.textContent === 'drag me' && n.type.name === 'paragraph');
    const tr = sim.state.tr;
    moveBlockAboveBelow(tr, Fragment.from(src.node), 0, src.pos, src.pos + src.node.nodeSize, false);
    sim.dispatch(tr);
    expect(body(sim.doc)).toBe('paragraph("drag me"), paragraph("top"), columnList[column[paragraph("keep")], column[paragraph("")]]');
  });

  it('dragging list rows beside a block makes a column of rows that keep their list type', () => {
    const sim = new Sim({ type: 'doc', content: [p('target'), { type: 'taskList', content: [ti(true, p('done')), ti(false, p('todo'))] }] });
    const row = sim.find((n: any) => n.type.name === 'taskItem' && n.textContent === 'done');
    const target = sim.doc.child(0);
    const tr = sim.state.tr;
    expect(createColumnLayoutFromDrop(tr, sim.schema, Fragment.from(row.node), 0, target, 'right', row.pos, row.pos + row.node.nodeSize, false)).toBe(true);
    sim.dispatch(tr);
    expect(problemsDoc(sim.doc)).toEqual([]);
    expect(body(sim.doc)).toBe('columnList[column[paragraph("target")], column[taskList[taskItem[paragraph("done")]]]], taskList[taskItem[paragraph("todo")]]');
  });

  it('a non-contiguous multi-block drag moves only the dragged blocks', () => {
    const sim = new Sim({ type: 'doc', content: [p('one'), p('keep'), p('two'), p('end')] });
    const one = sim.find((n: any) => n.textContent === 'one');
    const two = sim.find((n: any) => n.textContent === 'two');
    const ranges = [{ from: one.pos, to: one.pos + one.node.nodeSize }, { from: two.pos, to: two.pos + two.node.nodeSize }];
    const end = sim.find((n: any) => n.textContent === 'end');
    expect(isDropInsideDragged(end.pos + end.node.nodeSize, ranges)).toBe(false);
    expect(isDropInsideDragged(one.pos + one.node.nodeSize, ranges)).toBe(false); // between them: a real move
    const tr = sim.state.tr;
    moveBlockAboveBelow(tr, Fragment.from([one.node, two.node]), end.pos + end.node.nodeSize, ranges[0].from, ranges[1].to, false, ranges);
    sim.dispatch(tr);
    expect(body(sim.doc)).toBe('paragraph("keep"), paragraph("end"), paragraph("one"), paragraph("two")');
  });

  it('moving a block out of one layout leaves every other layout\'s widths alone', () => {
    const ed = mk({ type: 'doc', content: [
      cols(col(p('src')), col(p('b')), col(p('c'))),
      cols({ type: 'column', attrs: { width: 25 }, content: [p('x')] }, { type: 'column', attrs: { width: 75 }, content: [p('y')] }),
    ] });
    const r = find(ed, (n) => n.textContent === 'src' && n.type.name === 'paragraph')!;
    ed.view.dispatch(ed.state.tr.setSelection(TextSelection.create(ed.state.doc, r.pos + 1)));
    press(ed, 'ArrowUp', { ctrl: true, shift: true });
    expect(ed.state.doc.child(0).textContent).toBe('src');
    const widths: any[] = [];
    ed.state.doc.child(2).forEach((c: any) => widths.push(c.attrs.width));
    expect(widths).toEqual([25, 75]);
  });

  it('Shift-Tab on a block directly in a column inside a callout does nothing', () => {
    const ed = mk({ type: 'doc', content: [{ type: 'callout', content: [cols(col(p('inner')), col(p('other')))] }] });
    const r = find(ed, (n) => n.textContent === 'inner' && n.type.name === 'paragraph')!;
    expect(outdentBlock(ed, r.pos, r.node)).toBe(false);
    expect(outline(ed.state.doc)).toContain('callout[columnList[column[paragraph("inner")]');
  });
});

describe('keyboard: regressions', () => {
  function caretIn(ed: any, text: string) {
    const r = find(ed, (n) => n.isTextblock && n.textContent === text)!;
    ed.view.dispatch(ed.state.tr.setSelection(TextSelection.create(ed.state.doc, r.pos + 1)));
  }
  const down = (ed: any) => press(ed, 'ArrowDown', { ctrl: true, shift: true });
  const up = (ed: any) => press(ed, 'ArrowUp', { ctrl: true, shift: true });

  it('the caret stays in the moved block, so pressing again moves the same block', () => {
    const ed = mk({ type: 'doc', content: [p('a'), p('b'), p('c'), p('d')] });
    caretIn(ed, 'a');
    down(ed); down(ed); down(ed);
    expect(body(ed.state.doc)).toBe('paragraph("b"), paragraph("c"), paragraph("d"), paragraph("a")');
    expect(() => down(ed)).not.toThrow();
  });

  it('an equation, image or divider moves when selected', () => {
    const ed = mk({ type: 'doc', content: [p('a'), { type: 'mathBlock', attrs: { latex: 'E' } }, p('b')] });
    ed.view.dispatch(ed.state.tr.setSelection(NodeSelection.create(ed.state.doc, ed.state.doc.child(0).nodeSize)));
    down(ed);
    expect(body(ed.state.doc)).toBe('paragraph("a"), paragraph("b"), mathBlock(E)');
    expect(ed.state.selection).toBeInstanceOf(NodeSelection);
  });

  it('the last row of a list moves below the next block; the first row above the previous', () => {
    const ed = mk({ type: 'doc', content: [p('top'), { type: 'orderedList', content: [li(p('one')), li(p('two'))] }, p('after')] });
    caretIn(ed, 'two');
    down(ed);
    expect(body(ed.state.doc)).toBe('paragraph("top"), orderedList[listItem[paragraph("one")]], paragraph("after"), orderedList[listItem[paragraph("two")]]');
    caretIn(ed, 'one');
    up(ed);
    expect(body(ed.state.doc)).toBe('orderedList[listItem[paragraph("one")]], paragraph("top"), paragraph("after"), orderedList[listItem[paragraph("two")]]');
  });

  it('a nested row at the edge of its sub-list steps out to the parent level', () => {
    const ed = mk({ type: 'doc', content: [{ type: 'bulletList', content: [li(p('parent'), { type: 'bulletList', content: [li(p('child'))] }), li(p('next'))] }] });
    caretIn(ed, 'child');
    down(ed);
    expect(body(ed.state.doc)).toBe('bulletList[listItem[paragraph("parent")], listItem[paragraph("child")], listItem[paragraph("next")]]');
  });

  it('a block at the top of a callout steps out above it; the callout keeps a paragraph', () => {
    const ed = mk({ type: 'doc', content: [p('top'), { type: 'callout', content: [p('only')] }] });
    caretIn(ed, 'only');
    up(ed);
    expect(body(ed.state.doc)).toBe('paragraph("top"), paragraph("only"), callout[paragraph("")]');
  });

  it('moving a block out of a column beside an empty table keeps the table', () => {
    const ed = mk({ type: 'doc', content: [p('t1'), cols(col(p('src'), { type: 'table', content: [{ type: 'tableRow', content: [{ type: 'tableCell', content: [p()] }] }] }), col(p('b1')))] });
    caretIn(ed, 'src');
    up(ed);
    expect(outline(ed.state.doc)).toContain('columnList[column[table');
  });
});

describe('cross-page move', () => {
  function fakeData() {
    const calls: any = { atomic: null as any, appended: null as any };
    return {
      calls,
      service: {
        appendBlocksToPage: async (_id: string, nodes: any[]) => { calls.appended = nodes; },
        moveBlocksBetweenPagesAtomic: async (params: any) => { calls.atomic = params; return { sourcePage: null, targetPage: null }; },
        movePageWithBlocks: async () => {},
        fireContentReload: () => {},
      },
    };
  }

  it('stores a schema-valid source when the moved block was the only one in its column', async () => {
    const ed = mk(withIds({ type: 'doc', content: [cols(col(p('mover')), col(p('stay'))), p('end')] }, base().schema));
    const r = find(ed, (n) => n.textContent === 'mover' && n.type.name === 'paragraph')!;
    setActiveCanvasDragSession({ sourcePageId: 'src', from: r.pos, to: r.pos + r.node.nodeSize, nodes: [r.node.toJSON()], startedAt: Date.now() });
    const { calls, service } = fakeData();
    await moveBlockToLinkedPage({ editor: ed, event: { altKey: false, dataTransfer: null } as any, targetPageId: 'dst', currentPageId: 'src', dataService: service });
    clearActiveCanvasDragSession();
    const stored = base().schema.nodeFromJSON(calls.atomic.sourceDoc);
    expect(() => stored.check()).not.toThrow();
    expect(body(stored)).toBe('paragraph("stay"), paragraph("end")');
    expect(body(ed.state.doc)).toBe('paragraph("stay"), paragraph("end")');
  });

  it('keeps the source when the copy to the other page fails', async () => {
    const ed = mk({ type: 'doc', content: [p('mover'), p('end')] });
    const r = find(ed, (n) => n.textContent === 'mover')!;
    setActiveCanvasDragSession({ sourcePageId: 'src', from: r.pos, to: r.pos + r.node.nodeSize, nodes: [r.node.toJSON()], startedAt: Date.now() });
    const { service } = fakeData();
    service.appendBlocksToPage = async () => { throw new Error('disk full'); };
    // No ids → the non-atomic path.
    const json = { ...r.node.toJSON(), attrs: { ...r.node.attrs, id: null } };
    setActiveCanvasDragSession({ sourcePageId: 'src', from: r.pos, to: r.pos + r.node.nodeSize, nodes: [json], startedAt: Date.now() });
    await moveBlockToLinkedPage({ editor: ed, event: { altKey: false, dataTransfer: null } as any, targetPageId: 'dst', currentPageId: 'src', dataService: service });
    clearActiveCanvasDragSession();
    expect(textOf(ed)).toEqual(['mover', 'end']);
  });

  it('list rows moved to another page arrive in a list of their type', async () => {
    const ed = mk(withIds({ type: 'doc', content: [{ type: 'orderedList', content: [li(p('one')), li(p('two'))] }] }, base().schema));
    const r = find(ed, (n) => n.type.name === 'listItem' && n.textContent === 'two')!;
    setActiveCanvasDragSession({ sourcePageId: 'src', from: r.pos, to: r.pos + r.node.nodeSize, nodes: [r.node.toJSON()], startedAt: Date.now() });
    const { calls, service } = fakeData();
    await moveBlockToLinkedPage({ editor: ed, event: { altKey: false, dataTransfer: null } as any, targetPageId: 'dst', currentPageId: 'src', dataService: service });
    clearActiveCanvasDragSession();
    expect(calls.atomic.appendedNodes.map((n: any) => n.type)).toEqual(['orderedList']);
    expect(body(ed.state.doc)).toBe('orderedList[listItem[paragraph("one")]]');
  });
});

describe('block selection', () => {
  function controller(ed: any) {
    const div = document.createElement('div');
    const sel = new BlockSelectionController({ editor: ed, container: div, editorContainer: div });
    sel.setup();
    return sel;
  }

  it('a selected block moves like the caret path (out of its column) and stays selected', () => {
    const ed = mk({ type: 'doc', content: [p('top'), cols(col(p('X')), col(p('Z')))] });
    ed.registerPlugin(createBlockSelectionPlugin());
    const sel = controller(ed);
    const x = find(ed, (n) => n.type.name === 'paragraph' && n.textContent === 'X')!;
    sel.select(x.pos);
    expect(sel.moveSelectedUp()).toBe(true);
    expect(body(ed.state.doc)).toBe('paragraph("top"), paragraph("X"), paragraph("Z")');
    expect(sel.positions).toEqual([find(ed, (n) => n.type.name === 'paragraph' && n.textContent === 'X')!.pos]);
  });

  it('with only a caret, the selection mover stands aside for the caret path', () => {
    const ed = mk({ type: 'doc', content: [p('a'), p('b')] });
    const sel = controller(ed);
    expect(sel.moveSelectedDown()).toBe(false);
    expect(sel.hasSelection).toBe(false);
  });

  it('the caret leaving the selected block ends the block selection', () => {
    const ed = mk({ type: 'doc', content: [p('a'), p('b')] });
    ed.registerPlugin(createBlockSelectionPlugin());
    const sel = controller(ed);
    ed.view.dispatch(ed.state.tr.setSelection(TextSelection.create(ed.state.doc, 1)));
    sel.select(0);
    ed.view.dispatch(ed.state.tr.setSelection(TextSelection.create(ed.state.doc, 2)));
    expect(sel.hasSelection).toBe(true); // still inside "a"
    ed.view.dispatch(ed.state.tr.setSelection(TextSelection.create(ed.state.doc, 4)));
    expect(sel.hasSelection).toBe(false);
  });

  it('Duplicate on a row and its own nested row copies the row once', () => {
    const ed = mk({ type: 'doc', content: [{ type: 'bulletList', content: [li(p('parent'), { type: 'bulletList', content: [li(p('child'))] })] }] });
    ed.registerPlugin(createBlockSelectionPlugin());
    const sel = controller(ed);
    const parent = find(ed, (n) => n.type.name === 'listItem' && n.firstChild?.textContent === 'parent')!;
    const child = find(ed, (n) => n.type.name === 'listItem' && n.firstChild?.textContent === 'child')!;
    (sel as any)._selected = new Set([parent.pos, child.pos]);
    sel.duplicateSelected();
    expect(textOf(ed)).toEqual(['parent', 'child', 'parent', 'child']);
  });
});
