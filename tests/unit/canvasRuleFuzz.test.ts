// @vitest-environment jsdom
//
// canvasRuleFuzz.test.ts — SEEDED RULE FUZZING (2026-07-20).
//
// The determinism matrix tests chosen contexts; this suite generates
// documents from the registry's own vocabulary (lists nested to 3, columns
// holding lists, equations inside task rows, code/quote/toggle mixtures)
// and drives long random keystroke sequences over them. After EVERY op:
//   F1  the editor never throws;
//   F2  the document stays schema-valid (PM doc.check());
//   F3  an empty-selection destructive key loses at most 1 character.
// And after the whole sequence:
//   F4  UNDOING EVERYTHING restores the initial document canonically —
//       the strongest aggregate statement of "rules don't leave residue"
//       (the UniqueID and TrailingNode undo bugs both violate exactly this).
//
// Failures print the seed + full op log — paste the seed into
// PARALLX_FUZZ_SEEDS to replay one case; raise PARALLX_FUZZ_OPS locally
// for deeper runs than CI pays for.

import { describe, expect, it } from 'vitest';
import { Editor } from '@tiptap/core';
import { TextSelection, NodeSelection } from '@tiptap/pm/state';
import { common, createLowlight } from 'lowlight';
import { createEditorExtensions } from '../../src/built-in/canvas/config/tiptapExtensions';

const lowlight = createLowlight(common);
const OPS_PER_SEED = Number(process.env.PARALLX_FUZZ_OPS ?? 50);
const SEEDS: number[] = process.env.PARALLX_FUZZ_SEEDS
  ? process.env.PARALLX_FUZZ_SEEDS.split(',').map(Number)
  : Array.from({ length: 24 }, (_, i) => i + 1);

// ── Deterministic PRNG (mulberry32) ─────────────────────────────────────────
function rng(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a |= 0; a = (a + 0x6D2B79F5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}
const pick = <T,>(r: () => number, xs: readonly T[]): T => xs[Math.floor(r() * xs.length)];

// ── Document generator: registry vocabulary, structurally adventurous ───────
const p = (t: string) => ({ type: 'paragraph', content: [{ type: 'text', text: t }] });
function genList(r: () => number, depth: number, label: string): any {
  const listType = pick(r, ['bulletList', 'orderedList'] as const);
  const items = Array.from({ length: 1 + Math.floor(r() * 3) }, (_, i) => {
    const kids: any[] = [p(`${label}.${i}`)];
    if (r() < 0.4) kids.push({ type: 'mathBlock', attrs: { latex: 'x^2' } });
    if (depth < 3 && r() < 0.5) kids.push(genList(r, depth + 1, `${label}.${i}`));
    if (r() < 0.2) kids.push(p(`${label}.${i}t`));
    return { type: 'listItem', content: kids };
  });
  return { type: listType, content: items };
}
function genBlock(r: () => number, i: number): any {
  const roll = r();
  if (roll < 0.30) return genList(r, 1, `L${i}`);
  if (roll < 0.42) return { type: 'taskList', content: [
    { type: 'taskItem', attrs: { checked: r() < 0.5 }, content: [p(`T${i}`)] },
    { type: 'taskItem', attrs: { checked: false }, content: [p(`T${i}b`), ...(r() < 0.4 ? [genList(r, 2, `T${i}`)] : [])] },
  ] };
  if (roll < 0.54) return { type: 'columnList', content: [
    { type: 'column', content: [r() < 0.5 ? genList(r, 1, `C${i}a`) : p(`C${i}a`)] },
    { type: 'column', content: [r() < 0.3 ? { type: 'mathBlock', attrs: { latex: 'y' } } : p(`C${i}b`)] },
  ] };
  if (roll < 0.62) return { type: 'blockquote', content: [p(`Q${i}`)] };
  if (roll < 0.70) return { type: 'codeBlock', attrs: { language: 'js' }, content: [{ type: 'text', text: `code${i}()` }] };
  if (roll < 0.78) return { type: 'heading', attrs: { level: 1 + Math.floor(r() * 3) }, content: [{ type: 'text', text: `H${i}` }] };
  if (roll < 0.86) return { type: 'mathBlock', attrs: { latex: `a_${i}` } };
  return p(`P${i}`);
}
function genDoc(seed: number): Record<string, unknown> {
  const r = rng(seed * 7919);
  return { type: 'doc', content: Array.from({ length: 2 + Math.floor(r() * 4) }, (_, i) => genBlock(r, i)) };
}

// ── Op vocabulary ───────────────────────────────────────────────────────────
type OpName = 'type' | 'enter' | 'backspace' | 'delete' | 'tab' | 'shift-tab' | 'select-node-backspace' | 'undo' | 'redo';
const OP_WEIGHTS: Array<[OpName, number]> = [
  ['type', 0.22], ['enter', 0.18], ['backspace', 0.22], ['delete', 0.08],
  ['tab', 0.08], ['shift-tab', 0.08], ['select-node-backspace', 0.06],
  ['undo', 0.05], ['redo', 0.03],
];
function pickOp(r: () => number): OpName {
  let x = r();
  for (const [name, w] of OP_WEIGHTS) { if ((x -= w) <= 0) return name; }
  return 'type';
}

function press(ed: Editor, key: string, init: KeyboardEventInit = {}): void {
  ed.view.dom.dispatchEvent(new KeyboardEvent('keydown', { key, bubbles: true, cancelable: true, ...init }));
}

function textPositions(ed: Editor): number[] {
  const out: number[] = [];
  ed.state.doc.descendants((node, pos) => {
    if (node.isTextblock) { out.push(pos + 1); if (node.content.size > 0) out.push(pos + 1 + Math.floor(node.content.size / 2), pos + 1 + node.content.size); }
    return true;
  });
  return out;
}
function atomPositions(ed: Editor): number[] {
  const out: number[] = [];
  ed.state.doc.descendants((node, pos) => {
    if (node.isBlock && node.isAtom) out.push(pos);
    return true;
  });
  return out;
}
function textMass(ed: Editor): number {
  // hardBreak counts as one char: block joins legally convert a code
  // block's newlines to hardBreaks and back — conversion, not loss.
  let n = 0;
  ed.state.doc.descendants((node) => {
    if (node.isText) n += node.text!.length;
    else if (node.type.name === 'hardBreak') n += 1;
    return true;
  });
  return n;
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

describe('canvas rule fuzzing (seeded)', () => {
  for (const seed of SEEDS) {
    it(`seed ${seed}: ${OPS_PER_SEED} ops, invariants F1–F4`, () => {
      const r = rng(seed);
      const ed = new Editor({
        element: document.createElement('div'),
        extensions: createEditorExtensions(lowlight, {}),
        content: genDoc(seed),
      });
      const log: string[] = [];
      try {
        const initial = canon(ed);
        for (let i = 0; i < OPS_PER_SEED; i++) {
          const op = pickOp(r);
          const massBefore = textMass(ed);
          try {
            switch (op) {
              case 'type': {
                const pos = pick(r, textPositions(ed));
                ed.view.dispatch(ed.state.tr.setSelection(TextSelection.near(ed.state.doc.resolve(Math.min(pos, ed.state.doc.content.size)))));
                ed.commands.insertContent('z');
                log.push(`${op}@${pos}`);
                break;
              }
              case 'enter': case 'backspace': case 'delete': case 'tab': case 'shift-tab': {
                const pos = pick(r, textPositions(ed));
                ed.view.dispatch(ed.state.tr.setSelection(TextSelection.near(ed.state.doc.resolve(Math.min(pos, ed.state.doc.content.size)))));
                const key = op === 'enter' ? 'Enter' : op === 'backspace' ? 'Backspace' : op === 'delete' ? 'Delete' : 'Tab';
                press(ed, key, { shiftKey: op === 'shift-tab' });
                log.push(`${op}@${pos}`);
                break;
              }
              case 'select-node-backspace': {
                const atoms = atomPositions(ed);
                if (atoms.length === 0) { log.push('skip'); break; }
                const pos = pick(r, atoms);
                ed.view.dispatch(ed.state.tr.setSelection(NodeSelection.create(ed.state.doc, pos)));
                press(ed, 'Backspace');
                ed.commands.deleteSelection();
                log.push(`${op}@${pos}`);
                break;
              }
              case 'undo': ed.commands.undo(); log.push('undo'); break;
              case 'redo': ed.commands.redo(); log.push('redo'); break;
            }
          } catch (err) {
            throw new Error(`F1 THREW on op ${i} (${op}) — seed ${seed}\nlog: ${log.join(' ')}\n${err instanceof Error ? err.stack : err}`);
          }
          // F2 — schema validity after every op.
          try { ed.state.doc.check(); } catch (err) {
            throw new Error(`F2 INVALID DOC after op ${i} (${op}) — seed ${seed}\nlog: ${log.join(' ')}\n${err}`);
          }
          // F3 — empty-selection destructive keys lose ≤ 1 char.
          if ((op === 'backspace' || op === 'delete') && ed.state.selection.empty) {
            const lost = massBefore - textMass(ed);
            if (lost > 1) {
              throw new Error(`F3 LOST ${lost} chars on one ${op} — seed ${seed}\nlog: ${log.join(' ')}`);
            }
          }
        }
        // F4 — the aggregate: undo everything ⇒ initial document, canonically.
        // Drain by can().undo(), NOT by doc-changed: selection-only history
        // events pause the doc without emptying the stack.
        for (let i = 0; i < (OPS_PER_SEED + 20) * 2; i++) {
          if (!ed.can().undo()) break;
          ed.commands.undo();
        }
        expect(canon(ed), `F4 residue after full undo — seed ${seed}\nlog: ${log.join(' ')}`).toBe(initial);
      } finally {
        ed.destroy();
      }
    });
  }
});
