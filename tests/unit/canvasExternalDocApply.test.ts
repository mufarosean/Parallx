// @vitest-environment jsdom
// canvasExternalDocApply.test.ts — another writer's doc into an open editor.
// The block holding the caret is kept while the incoming doc still has it; a
// block the other writer removed goes, even with the caret in it (it used to
// stay on screen and be saved back).

import { describe, expect, it } from 'vitest';
import { Editor } from '@tiptap/core';
import { TextSelection } from '@tiptap/pm/state';
import { common, createLowlight } from 'lowlight';
import { createEditorExtensions } from '../../src/built-in/canvas/config/tiptapExtensions';
import { applyExternalDoc } from '../../src/built-in/canvas/externalDocApply';

const lowlight = createLowlight(common);
const p = (id: string, text: string) => ({ type: 'paragraph', attrs: { id }, content: [{ type: 'text', text }] });
const h = (id: string, text: string) => ({ type: 'heading', attrs: { id, level: 1 }, content: [{ type: 'text', text }] });

function make(content: unknown[], focused = true): Editor {
  const ed = new Editor({
    element: document.createElement('div'),
    extensions: createEditorExtensions(lowlight, {}),
    content: { type: 'doc', content },
  });
  ed.view.hasFocus = () => focused;
  return ed;
}

function caretIn(ed: Editor, text: string): void {
  let at = -1;
  ed.state.doc.descendants((n, pos) => { if (at < 0 && n.isTextblock && n.textContent === text) at = pos + 1; return at < 0; });
  ed.view.dispatch(ed.state.tr.setSelection(TextSelection.create(ed.state.doc, at + 2)));
}

const texts = (ed: Editor) => { const out: string[] = []; ed.state.doc.forEach((n) => out.push(n.textContent)); return out; };

describe('applyExternalDoc', () => {
  it('a block the other writer replaced goes, even with the caret in it', () => {
    const ed = make([p('a', 'intro plus typing'), p('b', 'second')]);
    try {
      caretIn(ed, 'intro plus typing');
      expect(applyExternalDoc(ed.view, { type: 'doc', content: [h('x', 'Rewritten'), p('y', 'by the AI')] })).toBe(true);
      expect(texts(ed)).toEqual(['Rewritten', 'by the AI']);
    } finally { ed.destroy(); }
  });

  it('the caret block stays verbatim while the incoming doc still has it; its neighbours update', () => {
    const ed = make([p('a', 'one'), p('b', 'mine, being typed'), p('c', 'three')]);
    try {
      caretIn(ed, 'mine, being typed');
      applyExternalDoc(ed.view, { type: 'doc', content: [p('a', 'ONE'), p('b', 'older stored version'), p('c', 'THREE')] });
      expect(texts(ed)).toEqual(['ONE', 'mine, being typed', 'THREE']);
      expect(ed.state.selection.$from.parent.textContent).toBe('mine, being typed');
    } finally { ed.destroy(); }
  });

  it('with the caret elsewhere the changed span is simply replaced, and the caret keeps its place', () => {
    const ed = make([p('a', 'keep me'), p('b', 'old'), p('c', 'tail')]);
    try {
      caretIn(ed, 'keep me');
      applyExternalDoc(ed.view, { type: 'doc', content: [p('a', 'keep me'), p('n', 'new'), p('c', 'tail')] });
      expect(texts(ed)).toEqual(['keep me', 'new', 'tail']);
      expect(ed.state.selection.$from.parent.textContent).toBe('keep me');
    } finally { ed.destroy(); }
  });

  it('an unfocused editor takes the incoming doc as is', () => {
    const ed = make([p('a', 'x'), p('b', 'y')], false);
    try {
      caretIn(ed, 'y');
      applyExternalDoc(ed.view, { type: 'doc', content: [p('a', 'x')] });
      expect(texts(ed)).toEqual(['x']);
    } finally { ed.destroy(); }
  });
});

describe('applyExternalDoc: where the caret goes when its block is removed', () => {
  it('into text, not onto a block like a divider or sub-page card', () => {
    const ed = make([p('a', 'intro plus typing'), { type: 'horizontalRule', attrs: { id: 'r' } }]);
    try {
      caretIn(ed, 'intro plus typing');
      applyExternalDoc(ed.view, { type: 'doc', content: [h('x', 'Rewritten'), p('y', 'by the AI'), { type: 'horizontalRule', attrs: { id: 'r' } }] });
      const types = () => { const out: string[] = []; ed.state.doc.forEach((n) => out.push(n.type.name)); return out; };
      const before = types();
      expect(before.slice(0, 3)).toEqual(['heading', 'paragraph', 'horizontalRule']);
      const sel = ed.state.selection;
      expect(sel.constructor.name).toMatch(/TextSelection/);
      expect(sel.empty).toBe(true);
      // Typing now cannot replace the divider.
      ed.commands.insertContent('x');
      expect(types()).toEqual(before);
    } finally { ed.destroy(); }
  });
});
