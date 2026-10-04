// @vitest-environment jsdom
// Canvas assessment 2026-10-03, broken features: block shortcuts (Delete,
// Mod-d, Shift+Arrow) did nothing after a handle click or a marquee, because
// keyboard focus was outside the editor.
import { describe, it, expect } from 'vitest';
import { BlockSelectionController } from '../../src/built-in/canvas/handles/blockSelection';
import { mk, p, press } from './canvasMatrixHarness';

function setup(content: any[]) {
  const ed = mk({ type: 'doc', content });
  document.body.appendChild(ed.view.dom.parentElement ?? ed.view.dom);
  const sel = new BlockSelectionController({ editor: ed, editorContainer: null } as any);
  sel.setup();
  return { ed, sel };
}
const posOf = (ed: any, text: string) => { let at = -1; ed.state.doc.forEach((n: any, off: number) => { if (n.textContent === text) at = off; }); return at; };

describe('block selection keeps the keyboard', () => {
  it('focusEditor puts the editor caret in the selected block and focuses it', () => {
    const { ed, sel } = setup([p('one'), p('two'), p('three')]);
    (document.activeElement as HTMLElement | null)?.blur?.();
    sel.select(posOf(ed, 'two'));
    sel.focusEditor();
    expect(ed.view.hasFocus()).toBe(true);
    const { from } = ed.state.selection;
    expect(from).toBeGreaterThan(posOf(ed, 'two'));
    expect(from).toBeLessThan(posOf(ed, 'three'));
    expect(sel.hasSelection).toBe(true);
  });

  it('an atom block gets a node selection', () => {
    const { ed, sel } = setup([p('one'), { type: 'horizontalRule' }, p('three')]);
    sel.select(5); // the rule, after 'one' (0..5)
    sel.focusEditor();
    expect(ed.state.selection.from).toBe(5);
    expect(ed.state.selection.to).toBe(6);
    expect(sel.hasSelection).toBe(true);
  });

  it('Delete then removes the selected blocks', () => {
    const { ed, sel } = setup([p('one'), p('two'), p('three')]);
    ed.storage.blockKeyboardShortcuts.hasSelection = () => sel.hasSelection;
    ed.storage.blockKeyboardShortcuts.deleteSelected = () => sel.deleteSelected();
    sel.selectMultiple([posOf(ed, 'two'), posOf(ed, 'three')]);
    sel.focusEditor();
    press(ed, 'Delete');
    expect(ed.state.doc.textContent).toBe('one');
  });
});
