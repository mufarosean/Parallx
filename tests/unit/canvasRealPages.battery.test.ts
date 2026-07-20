// @vitest-environment jsdom
//
// canvasRealPages.battery.test.ts — the REAL-DATA hostile battery.
//
// Loads Mufaro's actual study pages (dumped from a COPY of the workspace DB
// — see the M-canvas real-data session, 2026-07-20) through the FULL app
// extension set and asserts load fidelity + operation invariants that the
// synthetic suites can't reach: structures grown over months of real use.
//
// The fixture holds personal content, so it lives OUTSIDE the repo and this
// suite SKIPS entirely when the fixture is absent (CI, other machines).
// Point PARALLX_REAL_PAGES_FIXTURE at a dump produced by dump-pages.cjs.

import { describe, expect, it } from 'vitest';
import { existsSync, readFileSync } from 'node:fs';
import { Editor } from '@tiptap/core';
import { common, createLowlight } from 'lowlight';
import { createEditorExtensions } from '../../src/built-in/canvas/config/tiptapExtensions';

const FIXTURE_PATH = process.env.PARALLX_REAL_PAGES_FIXTURE
  ?? 'C:/Users/mchit/AppData/Local/Temp/claude/d--AI-Parallx/64ba8638-5bf3-4846-9592-6e6f8a51959e/scratchpad/exam7-pages.json';

interface RealPage {
  id: string;
  title: string;
  schemaVersion: number;
  archived: boolean;
  contentLen: number;
  doc: Record<string, unknown>;
}

const available = existsSync(FIXTURE_PATH);
const rawPages: RealPage[] = available
  ? (JSON.parse(readFileSync(FIXTURE_PATH, 'utf8')).pages as RealPage[])
  : [];

// The pages.content column stores an ENVELOPE: { schemaVersion, doc }. The
// ProseMirror document is envelope.doc. Feeding the envelope to the editor
// loads emptiness and makes every assertion vacuous — unwrap first and drop
// pages whose envelope holds no real doc.
const pages: RealPage[] = rawPages
  .map((p) => {
    const envelope = p.doc as { schemaVersion?: number; doc?: Record<string, unknown> };
    const inner = envelope && typeof envelope === 'object' && envelope.doc && typeof envelope.doc === 'object'
      ? envelope.doc
      : (p.doc as Record<string, unknown>);
    return { ...p, doc: inner };
  })
  .filter((p) => (p.doc as { type?: string }).type === 'doc');

// ── Full-schema editor (the app's real extension set) ──────────────────────
const lowlight = createLowlight(common);

function makeFullEditor(content?: Record<string, unknown>): Editor {
  return new Editor({
    element: document.createElement('div'),
    extensions: createEditorExtensions(lowlight, {}),
    content: content ?? { type: 'doc', content: [] },
  });
}

// ── Doc measurement helpers (schema-agnostic) ──────────────────────────────

/** Total text characters in a doc JSON tree. */
function textMass(node: any): number {
  if (!node || typeof node !== 'object') return 0;
  let sum = typeof node.text === 'string' ? node.text.length : 0;
  if (Array.isArray(node.content)) for (const c of node.content) sum += textMass(c);
  return sum;
}

/** Count of nodes per type in a doc JSON tree. */
function nodeCensus(node: any, out: Map<string, number> = new Map()): Map<string, number> {
  if (!node || typeof node !== 'object') return out;
  if (typeof node.type === 'string') out.set(node.type, (out.get(node.type) ?? 0) + 1);
  if (Array.isArray(node.content)) for (const c of node.content) nodeCensus(c, out);
  return out;
}

function censusDiff(before: Map<string, number>, after: Map<string, number>): string[] {
  const diffs: string[] = [];
  for (const [type, n] of before) {
    const m = after.get(type) ?? 0;
    if (m !== n) diffs.push(`${type}: ${n} → ${m}`);
  }
  for (const [type, m] of after) {
    if (!before.has(type)) diffs.push(`${type}: 0 → ${m}`);
  }
  return diffs;
}

describe.skipIf(!available)('real-page battery — load fidelity (full schema)', () => {
  it('fixture is present and non-trivial', () => {
    expect(pages.length).toBeGreaterThan(10);
  });

  it('EVERY page loads with zero text loss and zero node-type loss', () => {
    const failures: string[] = [];
    for (const page of pages) {
      let editor: Editor | undefined;
      try {
        editor = makeFullEditor(page.doc);
        const loaded = editor.getJSON();
        const massBefore = textMass(page.doc);
        const massAfter = textMass(loaded);
        if (massAfter !== massBefore) {
          failures.push(`"${page.title}": text ${massBefore} → ${massAfter} (${massAfter - massBefore})`);
          continue;
        }
        const diffs = censusDiff(nodeCensus(page.doc), nodeCensus(loaded));
        if (diffs.length > 0) {
          failures.push(`"${page.title}": nodes changed — ${diffs.join(', ')}`);
        }
      } catch (err) {
        failures.push(`"${page.title}": THREW ${err instanceof Error ? err.message : String(err)}`);
      } finally {
        editor?.destroy();
      }
    }
    expect(failures, failures.join('\n')).toEqual([]);
  });

  it('load → serialize → load is a fixed point (no normalization churn)', () => {
    const failures: string[] = [];
    for (const page of pages) {
      let e1: Editor | undefined; let e2: Editor | undefined;
      try {
        e1 = makeFullEditor(page.doc);
        const once = e1.getJSON();
        e2 = makeFullEditor(once);
        const twice = e2.getJSON();
        if (JSON.stringify(once) !== JSON.stringify(twice)) {
          failures.push(`"${page.title}": second load differs from first`);
        }
      } catch (err) {
        failures.push(`"${page.title}": THREW ${err instanceof Error ? err.message : String(err)}`);
      } finally {
        e1?.destroy(); e2?.destroy();
      }
    }
    expect(failures, failures.join('\n')).toEqual([]);
  });
});

// ═══════════════════════════════════════════════════════════════════════════
// Phase 2 — OPERATION SWEEP on real pages. Every operation is followed by
// undo and a byte-compare against the post-load baseline: any divergence is
// a data-corrupting edit path on a structure the user actually built.
// ═══════════════════════════════════════════════════════════════════════════

import { TextSelection, NodeSelection, AllSelection } from '@tiptap/pm/state';
import { Fragment } from '@tiptap/pm/model';
import { moveBlockAboveBelow } from '../../src/built-in/canvas/config/blockStateRegistry/blockMovement';

function press(ed: Editor, key: string, init: KeyboardEventInit = {}): void {
  ed.view.dom.dispatchEvent(new KeyboardEvent('keydown', { key, bubbles: true, cancelable: true, ...init }));
}

function undoAll(ed: Editor, max = 40): void {
  for (let i = 0; i < max; i++) {
    const before = ed.state.doc;
    ed.commands.undo();
    if (ed.state.doc.eq(before)) break;
  }
}

/** Positions of every direct child of the doc (top-level blocks). */
function topLevelPositions(ed: Editor): number[] {
  const out: number[] = [];
  ed.state.doc.forEach((_node, offset) => { out.push(offset); });
  return out;
}

/** Start-of-textblock positions across the doc (capped). */
function textblockStarts(ed: Editor, cap: number): number[] {
  const out: number[] = [];
  ed.state.doc.descendants((node, pos) => {
    if (out.length >= cap) return false;
    if (node.isTextblock) out.push(pos + 1);
    return true;
  });
  return out;
}

const POSITION_CAP = 30;

/**
 * Canonical doc form for comparison: adjacent text nodes with identical
 * marks are MERGED. Stored pages contain fragmented text runs (an AI-writer
 * artifact — see the data-hygiene note in the session report); ProseMirror
 * normalizes runs during edits near them, so both byte-compare AND doc.eq
 * (which compares child-by-child) false-positive on a semantically
 * identical document. Everything else — structure, attrs, mark sets, text
 * content, ordering — still compares exactly.
 */
function canonicalize(node: any): any {
  if (!node || typeof node !== 'object') return node;
  const out: any = { ...node };
  if (Array.isArray(node.content)) {
    const merged: any[] = [];
    for (const child of node.content.map(canonicalize)) {
      const prev = merged[merged.length - 1];
      if (
        prev && prev.type === 'text' && child.type === 'text'
        && JSON.stringify(prev.marks ?? []) === JSON.stringify(child.marks ?? [])
      ) {
        prev.text = (prev.text ?? '') + (child.text ?? '');
      } else {
        merged.push(child);
      }
    }
    out.content = merged;
  }
  return out;
}

function canonicalJson(ed: Editor): string {
  return JSON.stringify(canonicalize(ed.getJSON()));
}

describe.skipIf(!available)('real-page battery — operation sweep', () => {
  it('DRAG-MOVE each top-level block above/below its neighbors + undo restores every page', () => {
    // Drives the REAL drop path: moveBlockAboveBelow(tr, content, insertPos,
    // dragFrom, dragTo, false) — the same call the columnDropPlugin makes —
    // for every (block, neighbor-gap) pair, then undo + byte-compare.
    const failures: string[] = [];
    for (const page of pages) {
      const editor = makeFullEditor(page.doc);
      try {
        const baseline = canonicalJson(editor);
        const positions = topLevelPositions(editor).slice(0, POSITION_CAP);
        for (let i = 0; i < positions.length; i++) {
          const from = positions[i];
          const node = editor.state.doc.nodeAt(from);
          if (!node) continue;
          const to = from + node.nodeSize;
          // Drop above the previous block and below the next block.
          const targets: number[] = [];
          if (i > 0) targets.push(positions[i - 1]);
          if (i < positions.length - 1) {
            const nb = editor.state.doc.nodeAt(positions[i + 1]);
            if (nb) targets.push(positions[i + 1] + nb.nodeSize);
          }
          for (const insertPos of targets) {
            try {
              const { tr } = editor.state;
              moveBlockAboveBelow(tr, Fragment.from(node), insertPos, from, to, false);
              editor.view.dispatch(tr);
            } catch (err) {
              failures.push(`"${page.title}" drag-move @${from}->${insertPos}: THREW ${err instanceof Error ? err.message : err}`);
            }
            undoAll(editor);
            // PM semantic equality — stored pages may hold FRAGMENTED text
            // runs (adjacent same-mark text nodes, an AI-writer artifact);
            // editing near them normalizes the runs, so byte-comparing JSON
            // false-positives while the document is genuinely identical.
            if (canonicalJson(editor) !== baseline) {
              failures.push(`"${page.title}" drag-move @${from}->${insertPos}: undo did NOT restore the page`);
              editor.commands.setContent(page.doc);
            }
          }
        }
      } finally {
        editor.destroy();
      }
    }
    expect(failures, failures.join('\n')).toEqual([]);
  });

  it('BACKSPACE at every textblock start + undo restores every page', () => {
    const failures: string[] = [];
    for (const page of pages) {
      const editor = makeFullEditor(page.doc);
      try {
        const baseline = canonicalJson(editor);
        for (const pos of textblockStarts(editor, POSITION_CAP)) {
          try {
            const $pos = editor.state.doc.resolve(Math.min(pos, editor.state.doc.content.size));
            editor.view.dispatch(editor.state.tr.setSelection(TextSelection.near($pos)));
            press(editor, 'Backspace');
            // Some handlers act via commands instead of the keydown default —
            // exercise the command path too so both routes are swept.
            editor.commands.joinBackward?.();
          } catch (err) {
            failures.push(`"${page.title}" backspace @${pos}: THREW ${err instanceof Error ? err.message : err}`);
          }
          undoAll(editor);
          if (canonicalJson(editor) !== baseline) {
            failures.push(`"${page.title}" backspace @${pos}: undo did NOT restore the page`);
            editor.commands.setContent(page.doc);
          }
        }
      } finally {
        editor.destroy();
      }
    }
    expect(failures, failures.join('\n')).toEqual([]);
  });

  it('NODE-DELETE every atom/wrapper block + undo restores every page', () => {
    const failures: string[] = [];
    for (const page of pages) {
      const editor = makeFullEditor(page.doc);
      try {
        const baseline = canonicalJson(editor);
        const targets: number[] = [];
        editor.state.doc.descendants((node, pos) => {
          if (targets.length >= POSITION_CAP) return false;
          if (!node.isTextblock && !node.isText && node.type.name !== 'doc') targets.push(pos);
          return true;
        });
        for (const pos of targets) {
          try {
            const node = editor.state.doc.nodeAt(pos);
            if (!node) continue;
            editor.view.dispatch(editor.state.tr.setSelection(NodeSelection.create(editor.state.doc, pos)));
            press(editor, 'Backspace');
            editor.commands.deleteSelection?.();
          } catch (err) {
            failures.push(`"${page.title}" node-delete @${pos}: THREW ${err instanceof Error ? err.message : err}`);
          }
          undoAll(editor);
          if (canonicalJson(editor) !== baseline) {
            failures.push(`"${page.title}" node-delete @${pos}: undo did NOT restore the page`);
            editor.commands.setContent(page.doc);
          }
        }
      } finally {
        editor.destroy();
      }
    }
    expect(failures, failures.join('\n')).toEqual([]);
  });

  it('SELECT-ALL delete + undo restores every page', () => {
    const failures: string[] = [];
    for (const page of pages) {
      const editor = makeFullEditor(page.doc);
      try {
        const baseline = canonicalJson(editor);
        editor.view.dispatch(editor.state.tr.setSelection(new AllSelection(editor.state.doc)));
        editor.commands.deleteSelection();
        undoAll(editor);
        if (canonicalJson(editor) !== baseline) {
          failures.push(`"${page.title}": select-all delete + undo did not restore`);
        }
      } catch (err) {
        failures.push(`"${page.title}": THREW ${err instanceof Error ? err.message : err}`);
      } finally {
        editor.destroy();
      }
    }
    expect(failures, failures.join('\n')).toEqual([]);
  });
});

describe.skipIf(!available)('real-page battery — typing-shape sweep', () => {
  it('ENTER at every textblock start + undo restores every page', () => {
    const failures: string[] = [];
    for (const page of pages) {
      const editor = makeFullEditor(page.doc);
      try {
        const baseline = canonicalJson(editor);
        for (const pos of textblockStarts(editor, POSITION_CAP)) {
          try {
            const $pos = editor.state.doc.resolve(Math.min(pos, editor.state.doc.content.size));
            editor.view.dispatch(editor.state.tr.setSelection(TextSelection.near($pos)));
            press(editor, 'Enter');
            editor.commands.splitBlock?.();
          } catch (err) {
            failures.push(`"${page.title}" enter @${pos}: THREW ${err instanceof Error ? err.message : err}`);
          }
          undoAll(editor);
          if (canonicalJson(editor) !== baseline) {
            failures.push(`"${page.title}" enter @${pos}: undo did NOT restore the page`);
            editor.commands.setContent(page.doc);
          }
        }
      } finally {
        editor.destroy();
      }
    }
    expect(failures, failures.join('\n')).toEqual([]);
  });

  it('TAB and SHIFT-TAB in every list item + undo restores every page', () => {
    const failures: string[] = [];
    for (const page of pages) {
      const editor = makeFullEditor(page.doc);
      try {
        const baseline = canonicalJson(editor);
        const listTextStarts: number[] = [];
        editor.state.doc.descendants((node, pos) => {
          if (listTextStarts.length >= POSITION_CAP) return false;
          if (node.type.name === 'listItem' || node.type.name === 'taskItem') {
            listTextStarts.push(pos + 2); // inside the item's first textblock
          }
          return true;
        });
        for (const pos of listTextStarts) {
          for (const shift of [false, true]) {
            try {
              const $pos = editor.state.doc.resolve(Math.min(pos, editor.state.doc.content.size));
              editor.view.dispatch(editor.state.tr.setSelection(TextSelection.near($pos)));
              press(editor, 'Tab', { shiftKey: shift });
            } catch (err) {
              failures.push(`"${page.title}" ${shift ? 'shift-tab' : 'tab'} @${pos}: THREW ${err instanceof Error ? err.message : err}`);
            }
            undoAll(editor);
            if (canonicalJson(editor) !== baseline) {
              failures.push(`"${page.title}" ${shift ? 'shift-tab' : 'tab'} @${pos}: undo did NOT restore the page`);
              editor.commands.setContent(page.doc);
            }
          }
        }
      } finally {
        editor.destroy();
      }
    }
    expect(failures, failures.join('\n')).toEqual([]);
  });
});
