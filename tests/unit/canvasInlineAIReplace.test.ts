// @vitest-environment jsdom
// canvasInlineAIReplace.test.ts — Replace in the inline AI chat puts the reply
// where the selection is NOW (not where it was when the chat opened), refuses
// when the selected text was edited, and reads the reply as markdown.

import { describe, expect, it, vi } from 'vitest';
import { Editor } from '@tiptap/core';
import { TextSelection } from '@tiptap/pm/state';
import { common, createLowlight } from 'lowlight';
import { createEditorExtensions } from '../../src/built-in/canvas/config/tiptapExtensions';
import { InlineAIChatController } from '../../src/built-in/canvas/menus/inlineAIChat';
import { selectionToMarkdown } from '../../src/built-in/canvas/menus/inlineAIReplace';
import type { IChatMessage } from '../../src/services/chatTypes';

const lowlight = createLowlight(common);
const p = (t: string) => ({ type: 'paragraph', content: [{ type: 'text', text: t }] });

function make(content: unknown[]): Editor {
  const ed = new Editor({
    element: document.createElement('div'),
    extensions: createEditorExtensions(lowlight, {}),
    content: { type: 'doc', content },
  });
  // jsdom has no layout.
  ed.view.coordsAtPos = () => ({ left: 0, right: 0, top: 0, bottom: 0 });
  return ed;
}

/** Position of `text` inside the doc. */
function find(ed: Editor, text: string): { from: number; to: number } {
  let at = -1;
  ed.state.doc.descendants((node, pos) => {
    if (at < 0 && node.isText && node.text!.includes(text)) at = pos + node.text!.indexOf(text);
  });
  if (at < 0) throw new Error(`not found: ${text}`);
  return { from: at, to: at + text.length };
}

function select(ed: Editor, from: number, to: number): void {
  ed.view.dispatch(ed.state.tr.setSelection(TextSelection.create(ed.state.doc, from, to)));
}

function controller(ed: Editor, reply: string) {
  const seen: IChatMessage[][] = [];
  const registry = { register: () => ({ dispose() {} }) } as any;
  const send = async function* (messages: readonly IChatMessage[]) {
    seen.push([...messages]);
    yield { content: reply } as any;
  };
  const host = { editor: ed, container: document.body, editorContainer: null };
  const ctl = new InlineAIChatController(host, registry, send as any);
  ctl.create();
  return { ctl, seen };
}

async function ask(ctl: InlineAIChatController, text: string): Promise<void> {
  const input = document.querySelector('.canvas-ai-chat-input') as HTMLTextAreaElement;
  input.value = text;
  await (ctl as any)._onSend();
}

function clickReplace(): void {
  const btns = document.querySelectorAll('.canvas-ai-chat-replace');
  btns[btns.length - 1]!.dispatchEvent(new MouseEvent('mousedown', { bubbles: true }));
}

function texts(ed: Editor): string[] {
  const out: string[] = [];
  ed.state.doc.forEach((n) => out.push(n.textContent));
  return out;
}

describe('Inline AI Replace', () => {
  it('replaces the selection where it is now after text was typed above it', async () => {
    const ed = make([p('first line'), p('make this better please')]);
    const { ctl } = controller(ed, 'improved');
    try {
      const r = find(ed, 'this better');
      select(ed, r.from, r.to);
      ctl.toggle();
      await ask(ctl, 'improve');

      // While the chat was open, text is added above the selection.
      ed.view.dispatch(ed.state.tr.insertText('NEW ', 1));

      clickReplace();
      expect(texts(ed)).toEqual(['NEW first line', 'make improved please']);
    } finally {
      ctl.dispose();
      ed.destroy();
    }
  });

  it('refuses when the selected text itself was edited, and says so', async () => {
    const ed = make([p('keep the selected words here')]);
    const { ctl } = controller(ed, 'replacement');
    try {
      const r = find(ed, 'selected words');
      select(ed, r.from, r.to);
      ctl.toggle();
      await ask(ctl, 'rewrite');

      ed.view.dispatch(ed.state.tr.insertText('X', r.from + 3));
      const before = ed.getJSON();
      clickReplace();

      expect(ed.getJSON()).toEqual(before);
      expect(document.querySelector('.canvas-ai-chat-note')?.textContent).toMatch(/changed/);
    } finally {
      ctl.dispose();
      ed.destroy();
    }
  });

  it('refuses when the selected text was deleted', async () => {
    const ed = make([p('one'), p('gone soon'), p('three')]);
    const { ctl } = controller(ed, 'replacement');
    try {
      const r = find(ed, 'gone soon');
      select(ed, r.from, r.to);
      ctl.toggle();
      await ask(ctl, 'rewrite');

      ed.view.dispatch(ed.state.tr.delete(r.from - 1, r.to + 1));
      clickReplace();
      expect(texts(ed)).toEqual(['one', 'three']);
    } finally {
      ctl.dispose();
      ed.destroy();
    }
  });

  it('reads the reply as markdown: bold is bold, not asterisks, and the paragraph is not split', async () => {
    const ed = make([p('a plain sentence here')]);
    const { ctl } = controller(ed, 'a **bold** word');
    try {
      const r = find(ed, 'plain');
      select(ed, r.from, r.to);
      ctl.toggle();
      await ask(ctl, 'make bold');
      clickReplace();

      expect(texts(ed)).toEqual(['a a bold word sentence here']);
      const para = ed.state.doc.child(0);
      let boldText = '';
      para.forEach((n) => { if (n.marks.some((m) => m.type.name === 'bold')) boldText += n.text; });
      expect(boldText).toBe('bold');
      expect(ed.state.doc.textContent).not.toContain('**');
    } finally {
      ctl.dispose();
      ed.destroy();
    }
  });

  it('a multi-paragraph reply becomes blocks, each with its own id', async () => {
    const ed = make([p('alpha'), p('beta'), p('gamma')]);
    const { ctl } = controller(ed, 'one\n\ntwo\n\n- three');
    try {
      const a = find(ed, 'alpha');
      const b = find(ed, 'beta');
      select(ed, a.from, b.to);
      ctl.toggle();
      await ask(ctl, 'rewrite');
      clickReplace();

      const types: string[] = [];
      const ids = new Set<string>();
      ed.state.doc.forEach((n) => { types.push(n.type.name); if (n.attrs.id) ids.add(n.attrs.id); });
      expect(ed.state.doc.textContent).toBe('onetwothreegamma');
      expect(types).toContain('bulletList');
      // The three new blocks each got their own id (the fixture's "gamma" has none).
      expect(ids.size).toBe(3);
    } finally {
      ctl.dispose();
      ed.destroy();
    }
  });

  it('sends the selection to the AI as markdown, with its formatting', async () => {
    const ed = make([{ type: 'paragraph', content: [
      { type: 'text', text: 'see ' },
      { type: 'text', text: 'this', marks: [{ type: 'italic' }] },
      { type: 'text', text: ' now' },
    ] }]);
    const { ctl, seen } = controller(ed, 'ok');
    try {
      select(ed, 1, ed.state.doc.content.size - 1);
      expect(selectionToMarkdown(ed.state.doc, 1, ed.state.doc.content.size - 1)).toBe('see *this* now');
      ctl.toggle();
      await ask(ctl, 'what');
      expect(seen[0]![0]!.content).toContain('see *this* now');
    } finally {
      ctl.dispose();
      ed.destroy();
    }
  });

  it('stops following the editor once the chat closes', async () => {
    const ed = make([p('some text')]);
    const { ctl } = controller(ed, 'x');
    try {
      const off = vi.spyOn(ed, 'off');
      select(ed, 1, 5);
      ctl.toggle();
      ctl.hide();
      expect(off).toHaveBeenCalledWith('transaction', expect.any(Function));
    } finally {
      ctl.dispose();
      ed.destroy();
    }
  });
});
