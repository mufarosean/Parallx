// @vitest-environment jsdom
// The slash menu mid-line: "/" after a space opens it, "/" after a letter
// does not; a block picked mid-line goes in a new line after the current one
// and the "/query" goes; an inline pick replaces the "/query" where it is.
import { describe, it, expect, afterEach } from 'vitest';
import { SlashMenuController } from '../../src/built-in/canvas/menus/slashMenu';
import { CanvasMenuRegistry } from '../../src/built-in/canvas/menus/canvasMenuRegistry';
import { mk, p } from './canvasMatrixHarness';

const open: Array<{ dispose(): void }> = [];
afterEach(() => { while (open.length) open.pop()!.dispose(); });

/** An editor with the caret at the end of the line whose text is `textOf`. */
function setup(doc: any, textOf: string) {
  const ed = mk(doc);
  // jsdom has no layout.
  (ed.view as any).coordsAtPos = () => ({ left: 0, right: 0, top: 0, bottom: 0 });
  const registry = new CanvasMenuRegistry(() => ed);
  const host = { editor: ed, container: document.body, editorContainer: null, requestSave() {}, suppressUpdate: false } as any;
  const menu = new SlashMenuController(host, registry);
  menu.create();
  open.push(menu, registry, { dispose: () => ed.destroy() });
  let at = -1;
  ed.state.doc.descendants((n: any, pos: number) => { if (at < 0 && n.isTextblock && n.textContent === textOf) at = pos + 1 + n.content.size; return at < 0; });
  ed.commands.setTextSelection(at);
  menu.onTransaction(ed);
  return { ed, menu, registry };
}

const key = (ed: any, k: string) => ed.view.dom.dispatchEvent(new KeyboardEvent('keydown', { key: k, bubbles: true, cancelable: true }));
const settle = () => new Promise((r) => setTimeout(r, 0));
const shape = (ed: any): string[] => {
  const out: string[] = [];
  ed.state.doc.forEach((n: any) => out.push(n.type.name + (n.isTextblock ? `(${n.textContent})` : '')));
  return out;
};

describe('slash menu: where "/" opens', () => {
  it('opens at the start of a line and after a space mid-line', () => {
    expect(setup({ type: 'doc', content: [p('/')] }, '/').menu.visible).toBe(true);
    expect(setup({ type: 'doc', content: [p('Some text /')] }, 'Some text /').menu.visible).toBe(true);
    expect(setup({ type: 'doc', content: [p('Some text /tod')] }, 'Some text /tod').menu.visible).toBe(true);
  });

  it('stays closed right after a non-space character', () => {
    expect(setup({ type: 'doc', content: [p('and/')] }, 'and/').menu.visible).toBe(false);
    expect(setup({ type: 'doc', content: [p('and/or')] }, 'and/or').menu.visible).toBe(false);
    expect(setup({ type: 'doc', content: [p('due 10/30')] }, 'due 10/30').menu.visible).toBe(false);
    expect(setup({ type: 'doc', content: [p('https://x.org/h1')] }, 'https://x.org/h1').menu.visible).toBe(false);
  });

  it('a space after words that find nothing closes it and keeps the text', () => {
    const { ed, menu } = setup({ type: 'doc', content: [p('Path /xyzzy and')] }, 'Path /xyzzy and');
    expect(menu.visible).toBe(false);
    expect(shape(ed)).toEqual(['paragraph(Path /xyzzy and)']);
  });

  it('Escape closes it and keeps the text; the next key does not reopen it', () => {
    const { ed, menu } = setup({ type: 'doc', content: [p('Some text /h')] }, 'Some text /h');
    expect(menu.visible).toBe(true);
    key(ed, 'Escape');
    expect(menu.visible).toBe(false);
    ed.commands.insertContent('1');
    menu.onTransaction(ed);
    expect(menu.visible).toBe(false);
    expect(shape(ed)).toEqual(['paragraph(Some text /h1)']);
  });
});

describe('slash menu: picking mid-line', () => {
  it('a block goes in a new line after the current one; the /query goes', async () => {
    const { ed, menu } = setup({ type: 'doc', content: [p('Intro words /h2'), p('next')] }, 'Intro words /h2');
    expect(menu.visible).toBe(true);
    key(ed, 'Enter');
    await settle();
    expect(shape(ed)).toEqual(['paragraph(Intro words )', 'heading()', 'paragraph(next)']);
    expect(ed.state.selection.$from.parent.type.name).toBe('heading');
    expect(menu.visible).toBe(false);
  });

  it('a list picked mid-line inside a list item nests after that line', async () => {
    const doc = { type: 'doc', content: [{ type: 'bulletList', content: [{ type: 'listItem', content: [p('Item /todo')] }] }] };
    const { ed } = setup(doc, 'Item /todo');
    key(ed, 'Enter');
    await settle();
    const item = ed.state.doc.child(0).child(0);
    expect(item.child(0).textContent).toBe('Item ');
    expect(item.child(1).type.name).toBe('taskList');
  });

  it('an inline equation replaces the /query where it stands, and its editor opens on it', async () => {
    const { ed, registry } = setup({ type: 'doc', content: [p('Area is /inline eq'), p('x', { type: 'inlineMath', attrs: { latex: 'y', display: 'no' } })] }, 'Area is /inline eq');
    const shown: number[] = [];
    registry.showInlineMathEditor = (pos: number) => { shown.push(pos); };
    key(ed, 'Enter');
    await settle();
    const line = ed.state.doc.child(0);
    expect(ed.state.doc.childCount).toBe(2);
    expect(line.textContent).toBe('Area is ');
    expect(line.lastChild?.type.name).toBe('inlineMath');
    await new Promise((r) => setTimeout(r, 120));
    // The new equation, not the last one on the page.
    expect(shown).toEqual([1 + 'Area is '.length]);
  });

  it('at the start of an empty line the block takes the line, as before', async () => {
    const { ed } = setup({ type: 'doc', content: [p('/quote'), p('next')] }, '/quote');
    key(ed, 'Enter');
    await settle();
    expect(shape(ed)).toEqual(['blockquote', 'paragraph(next)']);
  });
});
