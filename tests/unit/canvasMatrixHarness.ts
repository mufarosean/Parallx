// canvasMatrixHarness.ts — shared fixtures and checks for the canvas
// block-operation matrices (canvasBlockMatrix.test.ts).
//
// The editor is the app's own (createEditorExtensions), not a reduced set,
// so every plugin that reacts to a change (id repair, card guard, column
// dissolve, join, trailing node) runs as it does in the app.  `Sim` is the
// same schema and plugins on a bare EditorState, for the large drop matrix
// (thousands of cases) where building a view per case is too slow.

import { Editor } from '@tiptap/core';
import { EditorState } from '@tiptap/pm/state';
import { undo as pmUndo, redo as pmRedo } from '@tiptap/pm/history';
import { common, createLowlight } from 'lowlight';
import { createEditorExtensions } from '../../src/built-in/canvas/config/tiptapExtensions';
const lowlight = createLowlight(common);
export const mk = (content: any) => new Editor({ element: document.createElement('div'), extensions: createEditorExtensions(lowlight, {}), content });
export const t = (s: string, marks?: any[]) => ({ type: 'text', text: s, ...(marks ? { marks } : {}) });
export const p = (...c: any[]) => ({ type: 'paragraph', content: c.map((x) => typeof x === 'string' ? t(x) : x) });
export const li = (...c: any[]) => ({ type: 'listItem', content: c });
export const ti = (checked: boolean, ...c: any[]) => ({ type: 'taskItem', attrs: { checked }, content: c });
export const col = (...c: any[]) => ({ type: 'column', content: c });
export const cols = (...c: any[]) => ({ type: 'columnList', content: c });

/** Fixture blocks: each with unique words. */
export function fixtures(): Record<string, any> {
  return {
    paragraph: p('para1', t(' boldword', [{ type: 'bold' }]), { type: 'hardBreak' }, 'brk2', { type: 'inlineMath', attrs: { latex: 'xinline' } }),
    heading1: { type: 'heading', attrs: { level: 1 }, content: [t('headone')] },
    heading3: { type: 'heading', attrs: { level: 3 }, content: [t('headthree')] },
    codeBlock: { type: 'codeBlock', attrs: { language: 'js' }, content: [t('codea\ncodeb')] },
    blockquote: { type: 'blockquote', content: [p('quotea'), p('quoteb')] },
    callout: { type: 'callout', attrs: { emoji: 'warning', backgroundColor: 'red' }, content: [p('callouta'), { type: 'image', attrs: { src: 'img://c' } }, p('calloutb')] },
    details: { type: 'details', content: [{ type: 'detailsSummary', content: [t('summ')] }, { type: 'detailsContent', content: [p('detbody'), { type: 'bulletList', content: [li(p('detrow'))] }] }] },
    toggleHeading: { type: 'toggleHeading', attrs: { level: 2 }, content: [{ type: 'toggleHeadingText', content: [t('tgh')] }, { type: 'detailsContent', content: [p('tghbody')] }] },
    bulletList: { type: 'bulletList', content: [li(p('bula'), { type: 'bulletList', content: [li(p('bulnest'))] }), li(p('bulb'))] },
    orderedList: { type: 'orderedList', attrs: { start: 3 }, content: [li(p('orda')), li(p('ordb'))] },
    taskList: { type: 'taskList', content: [ti(true, p('taska')), ti(false, p('taskb'))] },
    mathBlock: { type: 'mathBlock', attrs: { latex: 'emc2' } },
    horizontalRule: { type: 'horizontalRule' },
    image: { type: 'image', attrs: { src: 'img://x' } },
    table: { type: 'table', content: [{ type: 'tableRow', content: [{ type: 'tableCell', content: [p('cella')] }, { type: 'tableCell', content: [p('cellb')] }] }] },
    emptyTable: { type: 'table', content: [{ type: 'tableRow', content: [{ type: 'tableCell', content: [p()] }, { type: 'tableCell', content: [p()] }] }] },
    emptyCallout: { type: 'callout', attrs: { emoji: 'lightbulb' }, content: [p()] },
    bookmark: { type: 'bookmark', attrs: { url: 'https://bm.example' } },
    conceptMap: { type: 'conceptMap', attrs: { src: 'cmsrc' } },
    pageBlock: { type: 'pageBlock', attrs: { pageId: 'page-1', title: 'Child' } },
    tableOfContents: { type: 'tableOfContents' },
    video: { type: 'video', attrs: { src: 'vid://x' } },
    audio: { type: 'audio', attrs: { src: 'aud://x' } },
    fileAttachment: { type: 'fileAttachment', attrs: { src: 'file://x', filename: 'f.txt' } },
    nestedCols: cols(col(p('ncola')), col(p('ncolb'))),
  };
}

const ATOM_KEY_ATTRS = ['latex', 'src', 'url', 'pageId', 'filename'];
/** Content tokens: every character of text and identifying atom attrs, plus atom node types. */
export function tokens(node: any): string[] {
  const out: string[] = [];
  const visit = (n: any) => {
    if (n.isText) { for (const ch of n.text.replace(/[\s$]/g, '')) out.push(ch); return true; }
    if (n.isAtom || n.isLeaf) {
      if (n.type.name === 'hardBreak') return true;
      for (const k of ATOM_KEY_ATTRS) if (n.attrs?.[k]) for (const ch of String(n.attrs[k]).replace(/\s/g, '')) out.push(ch);
      if (!['mathBlock', 'inlineMath'].includes(n.type.name)) out.push('<' + n.type.name + '>');
    }
    if (n.type.name === 'table' || n.type.name === 'tableCell') out.push('<' + n.type.name + '>');
    return true;
  };
  if (node.type.name !== 'doc') visit(node);
  node.descendants(visit);
  return out.sort();
}

export function diffTokens(a: string[], b: string[]): { lost: string[]; extra: string[] } {
  const m = new Map<string, number>();
  for (const x of a) m.set(x, (m.get(x) ?? 0) + 1);
  const extra: string[] = [];
  for (const x of b) { const c = m.get(x) ?? 0; if (c > 0) m.set(x, c - 1); else extra.push(x); }
  const lost: string[] = [];
  for (const [k, v] of m) for (let i = 0; i < v; i++) lost.push(k);
  return { lost, extra };
}

/** Structural problems in the doc. */
export function problems(ed: Editor): string[] {
  const out: string[] = [];
  try { ed.state.doc.check(); } catch (e: any) { out.push('schema: ' + e.message); }
  const ids = new Map<string, number>();
  ed.state.doc.descendants((n: any, pos: number) => {
    if (n.type.name === 'columnList' && n.childCount < 2) out.push(`columnList@${pos} has ${n.childCount} column(s)`);
    if (n.type.name === 'column' && n.childCount === 0) out.push(`empty column @${pos}`);
    const id = n.attrs?.id;
    if (id) ids.set(id, (ids.get(id) ?? 0) + 1);
    return true;
  });
  for (const [id, c] of ids) if (c > 1) out.push(`duplicate id ${id} x${c}`);
  return out;
}

export const strip = (j: any): any => { if (Array.isArray(j)) return j.map(strip); if (j && typeof j === 'object') { const o: any = {}; for (const k of Object.keys(j)) { if (k === 'attrs') { const a: any = {}; for (const [ak, av] of Object.entries(j.attrs)) if (av !== null && ak !== 'id') a[ak] = av; if (Object.keys(a).length) o.attrs = a; } else o[k] = strip(j[k]); } return o; } return j; };

/** Short outline of a doc for reports. */
export function outline(node: any, depth = 0): string {
  const parts: string[] = [];
  node.forEach((c: any) => {
    if (c.isTextblock) parts.push(`${c.type.name}${c.attrs?.level ? c.attrs.level : ''}("${c.textContent}")`);
    else if (c.isLeaf) parts.push(`${c.type.name}${c.attrs?.latex ? '(' + c.attrs.latex + ')' : ''}`);
    else parts.push(`${c.type.name}[${outline(c, depth + 1)}]`);
  });
  return parts.join(', ');
}

/** Find the first node matching pred; returns pos+node. */
export function find(ed: Editor, pred: (n: any) => boolean): { pos: number; node: any } | null {
  let r: any = null;
  ed.state.doc.descendants((n: any, pos: number) => { if (r) return false; if (pred(n)) { r = { pos, node: n }; return false; } return true; });
  return r;
}

let _base: Editor | null = null;
export function base(): Editor { return _base ??= mk({ type: 'doc', content: [{ type: 'paragraph' }] }); }
/** Give every id-carrying node a fixed id, as a saved page has. */
export function withIds(json: any, schema: any, counter = { n: 0 }): any {
  if (Array.isArray(json)) return json.map((j) => withIds(j, schema, counter));
  if (!json || typeof json !== 'object') return json;
  const out: any = { ...json };
  const t = schema.nodes[json.type];
  if (t && 'id' in t.attrs) out.attrs = { ...(json.attrs ?? {}), id: 'id' + (++counter.n) };
  if (Array.isArray(json.content)) out.content = json.content.map((c: any) => withIds(c, schema, counter));
  return out;
}
export class Sim {
  state: EditorState;
  constructor(docJson: any) {
    const b = base();
    this.state = EditorState.create({ schema: b.schema, doc: b.schema.nodeFromJSON(withIds(docJson, b.schema)), plugins: b.state.plugins });
  }
  get doc() { return this.state.doc; }
  get schema() { return this.state.schema; }
  dispatch = (tr: any) => { this.state = this.state.apply(tr); };
  undo() { pmUndo(this.state, this.dispatch); }
  redo() { pmRedo(this.state, this.dispatch); }
  json() { return JSON.stringify(this.state.doc.toJSON()); }
  find(pred: (n: any) => boolean) { let r: any = null; this.state.doc.descendants((n: any, pos: number) => { if (r) return false; if (pred(n)) { r = { pos, node: n }; return false; } return true; }); return r; }
}
export function problemsDoc(doc: any): string[] {
  const out: string[] = [];
  try { doc.check(); } catch (e: any) { out.push('schema: ' + e.message.slice(0, 160)); }
  const ids = new Map<string, number>();
  doc.descendants((n: any, pos: number) => {
    if (n.type.name === 'columnList' && n.childCount < 2) out.push(`columnList@${pos} has ${n.childCount} column(s)`);
    const id = n.attrs?.id; if (id) ids.set(id, (ids.get(id) ?? 0) + 1);
    return true;
  });
  for (const [id, c] of ids) if (c > 1) out.push(`duplicate id ${id} x${c}`);
  return out;
}
/** A real keydown through ProseMirror's handleKeyDown props (what the app gets). */
export function press(ed: any, key: string, mods: { ctrl?: boolean; shift?: boolean; alt?: boolean } = {}): boolean {
  const ev = new KeyboardEvent('keydown', { key, ctrlKey: !!mods.ctrl, shiftKey: !!mods.shift, altKey: !!mods.alt, bubbles: true, cancelable: true });
  return !!ed.view.someProp('handleKeyDown', (f: any) => f(ed.view, ev));
}
