// @vitest-environment jsdom
// Canvas assessment 2026-10-03, broken features: the slash menu opened inside
// code blocks ("// todo" + Enter turned the code block into a to-do list).
import { describe, it, expect } from 'vitest';
import { SlashMenuController } from '../../src/built-in/canvas/menus/slashMenu';
import { mk, p, t } from './canvasMatrixHarness';
import { getSlashMenuBlocks } from '../../src/built-in/canvas/config/blockRegistry';

function menuOn(doc: any, textOf: string) {
  const ed = mk(doc);
  // jsdom has no layout.
  (ed.view as any).coordsAtPos = () => ({ left: 0, right: 0, top: 0, bottom: 0 });
  const registry = { isInteractionLocked: () => false, notifyShow() {}, notifyHide() {}, register: () => ({ dispose() {} }), getSlashMenuBlocks } as any;
  const host = { editor: ed, container: document.body, editorContainer: null, requestSave() {}, suppressUpdate: false } as any;
  const menu = new SlashMenuController(host, registry);
  menu.create();
  let at = -1;
  ed.state.doc.descendants((n: any, pos: number) => { if (at < 0 && n.isTextblock && n.textContent === textOf) at = pos + 1 + n.content.size; return at < 0; });
  ed.commands.setTextSelection(at);
  menu.onTransaction(ed);
  return menu.visible;
}

describe('slash menu places', () => {
  it('opens in a paragraph', () => {
    expect(menuOn({ type: 'doc', content: [p('/to')] }, '/to')).toBe(true);
  });
  it('does not open in a code block', () => {
    expect(menuOn({ type: 'doc', content: [{ type: 'codeBlock', content: [t('/to')] }] }, '/to')).toBe(false);
  });
  it('does not open in a toggle summary or a toggle heading title (text only)', () => {
    expect(menuOn({ type: 'doc', content: [{ type: 'details', content: [{ type: 'detailsSummary', content: [t('/to')] }, { type: 'detailsContent', content: [p()] }] }] }, '/to')).toBe(false);
    expect(menuOn({ type: 'doc', content: [{ type: 'toggleHeading', content: [{ type: 'toggleHeadingText', content: [t('/to')] }, { type: 'detailsContent', content: [p()] }] }] }, '/to')).toBe(false);
  });
});
