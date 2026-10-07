// editorTitleMenu.test.ts — an editor pane's More Actions menu names no tool.
//
// A tool puts its entry there (contributes.menus "editor/title", when:
// activeEditor == '<typeId>'). The pane lists the active editor's entries
// through getEditorTitleActions(), with the tool's name as a tag; a tool
// turned off takes its entries.

import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { MenuContributionProcessor, getEditorTitleActions } from '../../src/contributions/menuContribution';
import { ContextKeyService } from '../../src/context/contextKey';
import type { IToolDescription, IToolManifest } from '../../src/tools/toolManifest';

const root = resolve(__dirname, '../..');

const QUIZ_MANIFEST = {
  id: 'parallx-community.quiz',
  name: 'Quiz',
  version: '1.0.0',
  main: 'main.js',
  contributes: {
    commands: [{ command: 'quiz.document', title: 'Quiz This Document…' }],
    menus: {
      'editor/title': [
        { command: 'quiz.document', group: '1_quiz', when: "activeEditor == 'parallx.editor.pdf'" },
        { command: 'quiz.sheet', title: 'Quiz This Sheet', group: '1_quiz', when: "activeEditor == 'parallx.editor.spreadsheet'" },
        { command: 'quiz.unregistered', group: '9_more', when: "activeEditor == 'parallx.editor.pdf'" },
      ],
    },
  },
} as unknown as IToolManifest;

const desc = (manifest: IToolManifest): IToolDescription => ({ manifest, toolPath: '/t', isBuiltin: false } as IToolDescription);

/** Only the commands the manifest registers resolve; 'quiz.unregistered' does not. */
const commands = {
  getCommand: (id: string) =>
    id === 'quiz.document' ? { id, title: 'Quiz This Document…' }
    : id === 'quiz.sheet' ? { id, title: 'Sheet (registered title)' }
    : undefined,
};

function setup() {
  const menus = new MenuContributionProcessor(commands as never);
  const keys = new ContextKeyService();
  const active = keys.createKey<string | undefined>('activeEditor', undefined);
  menus.setContextKeyService(keys);
  return { menus, active };
}

const ids = (menus: MenuContributionProcessor) => menus.getEditorTitleItems().map((m) => m.commandId);

describe('editor More Actions (editor/title)', () => {
  it('lists the active editor\'s items only', () => {
    const { menus, active } = setup();
    menus.processContributions(desc(QUIZ_MANIFEST));
    expect(ids(menus)).toEqual([]);
    active.set('parallx.editor.pdf');
    expect(ids(menus)).toEqual(['quiz.document', 'quiz.unregistered']);
    active.set('parallx.editor.spreadsheet');
    expect(ids(menus)).toEqual(['quiz.sheet']);
    active.set('parallx.editor.file');
    expect(ids(menus)).toEqual([]);
  });

  it('getEditorTitleActions gives a pane the label, tool id and tool name, and skips an unregistered command', () => {
    const { menus, active } = setup();
    menus.processContributions(desc(QUIZ_MANIFEST));
    active.set('parallx.editor.pdf');
    expect(getEditorTitleActions()).toEqual([
      { commandId: 'quiz.document', label: 'Quiz This Document…', toolId: 'parallx-community.quiz', toolName: 'Quiz' },
    ]);
    // The item's own title wins over the command's registered title.
    active.set('parallx.editor.spreadsheet');
    expect(getEditorTitleActions()).toEqual([
      { commandId: 'quiz.sheet', label: 'Quiz This Sheet', toolId: 'parallx-community.quiz', toolName: 'Quiz' },
    ]);
  });

  it('a tool turned off takes its items', () => {
    const { menus, active } = setup();
    menus.processContributions(desc(QUIZ_MANIFEST));
    active.set('parallx.editor.pdf');
    expect(getEditorTitleActions()).toHaveLength(1);
    menus.removeContributions(QUIZ_MANIFEST.id);
    expect(ids(menus)).toEqual([]);
    expect(getEditorTitleActions()).toEqual([]);
  });

  it('with no processor there are no actions', () => {
    const { menus } = setup();
    menus.dispose();
    expect(getEditorTitleActions()).toEqual([]);
  });

  it('the PDF pane names no tool', () => {
    // "study" as a plain word ("a study note") is fine; the tool's id, its
    // commands and its menu label are not.
    const src = readFileSync(resolve(root, 'src/editor/panes/pdfEditorPane.ts'), 'utf8');
    expect(src).not.toMatch(/parallx-community\.study|['"`]study\.[a-zA-Z]+|Study This Document|flashcards\./);
    expect(src).toMatch(/getEditorTitleActions\(\)/);
  });
});
