// selectionToolActions.test.ts — editors offer a tool's selection action
// (Flashcards' "Create Flashcard…") only while that tool runs.

import { describe, it, expect } from 'vitest';
import { SelectionActionDispatcher, getToolSelectionActions } from '../../src/services/selectionActionDispatcher';
import { createBuiltInActionHandlers } from '../../src/services/selectionActionHandlers';

describe('selection actions from tools', () => {
  it('lists only what running tools added, not the core actions, and drops a tool turned off', () => {
    const d = new SelectionActionDispatcher();
    for (const h of createBuiltInActionHandlers()) d.registerHandler(h);
    expect(getToolSelectionActions()).toEqual([]);
    const reg = d.registerHandler({ actionId: 'create-flashcard', label: 'Create Flashcard…', icon: 'px-flashcards', execute: async () => {} });
    expect(getToolSelectionActions()).toEqual([{ actionId: 'create-flashcard', label: 'Create Flashcard…', icon: 'px-flashcards' }]);
    reg.dispose(); // Flashcards turned off
    expect(getToolSelectionActions()).toEqual([]);
    d.dispose();
    expect(getToolSelectionActions()).toEqual([]);
  });
  it('no editor hardcodes a tool\'s action', async () => {
    const { readFileSync } = await import('node:fs');
    for (const f of ['src/editor/panes/pdfEditorPane.ts', 'src/editor/panes/markdownEditorPane.ts', 'src/editor/panes/textEditorPane.ts', 'src/built-in/canvas/menus/bubbleMenu.ts']) {
      expect(readFileSync(f, 'utf8'), f).not.toMatch(/create-flashcard|Flashcard/);
    }
  });
});
