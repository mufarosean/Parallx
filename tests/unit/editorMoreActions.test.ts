/**
 * The More Actions button of the text and code panes: tools' editor/title
 * entries for the file the pane shows. Hidden while there are none; the menu
 * lists each with its tool's name; choosing one runs its command with the
 * file; a tool turned off takes its entries and the button hides again.
 *
 * @vitest-environment jsdom
 */

import { describe, it, expect, afterEach } from 'vitest';
import { MenuContributionProcessor } from '../../src/contributions/menuContribution';
import { ContextKeyService } from '../../src/context/contextKey';
import { URI } from '../../src/platform/uri';
import {
  mountEditorMoreActions, showEditorMoreActions, editorTitleTargetOf,
  ALL_EDITOR_MORE_ACTIONS_COMMANDS, EDITOR_MORE_ACTIONS_COMMAND,
} from '../../src/editor/editorMoreActions';
import type { IToolDescription, IToolManifest } from '../../src/tools/toolManifest';

const MANIFEST = {
  id: 'parallx-community.notes',
  name: 'Notes Tool',
  version: '1.0.0',
  main: 'main.js',
  contributes: {
    commands: [{ command: 'notes.study', title: 'Study These Notes…' }],
    menus: { 'editor/title': [{ command: 'notes.study', when: "activeEditor == 'parallx.editor.file' && resourceExtname == '.md'" }] },
  },
} as unknown as IToolManifest;

function setup() {
  const ran: { id: string; args: unknown[] }[] = [];
  const commands = {
    getCommand: (id: string) => (id === 'notes.study' ? { id, title: 'Study These Notes…' } : undefined),
    async executeCommand(id: string, ...args: unknown[]) { ran.push({ id, args }); },
  };
  const menus = new MenuContributionProcessor(commands as never);
  menus.setContextKeyService(new ContextKeyService());
  return { menus, commands, ran };
}

afterEach(() => {
  document.querySelectorAll('.context-menu').forEach((el) => el.remove());
  document.body.replaceChildren();
});

describe('editor More Actions in the text and code panes', () => {
  it('is hidden with nothing to list, shows for a file a tool names, and hides when the tool goes', () => {
    const { menus } = setup();
    const host = document.body.appendChild(document.createElement('div'));
    let uri = URI.file('/ws/notes.md');
    const more = mountEditorMoreActions(host, () => editorTitleTargetOf('parallx.editor.file', uri));
    expect(more.element.hidden).toBe(true);
    expect(more.element.getAttribute('aria-label')).toBe('More Actions');
    menus.processContributions({ manifest: MANIFEST, toolPath: '/t', isBuiltin: false } as IToolDescription);
    expect(more.element.hidden).toBe(false);
    // The same pane given a file the tool does not name.
    uri = URI.file('/ws/script.py');
    more.refresh();
    expect(more.element.hidden).toBe(true);
    uri = URI.file('/ws/notes.md');
    more.refresh();
    menus.removeContributions(MANIFEST.id);
    expect(more.element.hidden).toBe(true);
    more.dispose();
    expect(host.contains(more.element)).toBe(false);
    menus.dispose();
  });

  it('lists the entries with their tool, and runs the chosen one with the file', () => {
    const { menus, commands, ran } = setup();
    menus.processContributions({ manifest: MANIFEST, toolPath: '/t', isBuiltin: false } as IToolDescription);
    const anchor = document.body.appendChild(document.createElement('button'));
    const target = editorTitleTargetOf('parallx.editor.file', URI.file('/ws/notes.md'))!;
    const menu = showEditorMoreActions(commands, { anchor, target: () => target });
    expect(menu).not.toBeNull();
    const items = [...document.querySelectorAll<HTMLElement>('.context-menu-item')];
    expect(items.map((i) => i.textContent)).toEqual([expect.stringContaining('Study These Notes…')]);
    expect(items[0].textContent).toContain('Notes Tool');
    items[0].click();
    expect(ran).toEqual([{ id: 'notes.study', args: [{ uri: target.uri, fsPath: target.fsPath }] }]);
    menus.dispose();
  });

  it('opens nothing for a file no tool names, and a file-less editor has no target', () => {
    const { menus, commands } = setup();
    menus.processContributions({ manifest: MANIFEST, toolPath: '/t', isBuiltin: false } as IToolDescription);
    const t = editorTitleTargetOf('parallx.editor.file', URI.file('/ws/run.py'))!;
    expect(showEditorMoreActions(commands, { anchor: undefined, target: () => t })).toBeNull();
    expect(editorTitleTargetOf('parallx.editor.untitled', undefined)).toBeUndefined();
    menus.dispose();
  });

  it('is a command, so the palette opens the same menu for the active editor', () => {
    expect(ALL_EDITOR_MORE_ACTIONS_COMMANDS.map((c) => c.id)).toEqual([EDITOR_MORE_ACTIONS_COMMAND]);
    const { menus, commands } = setup();
    menus.processContributions({ manifest: MANIFEST, toolPath: '/t', isBuiltin: false } as IToolDescription);
    const services: Record<string, unknown> = {
      ICommandService: commands,
      IEditorService: { activeEditor: { typeId: 'parallx.editor.file', uri: URI.file('/ws/notes.md') } },
    };
    void ALL_EDITOR_MORE_ACTIONS_COMMANDS[0].handler({ getService: (id: string) => services[id], workbench: undefined } as never);
    expect([...document.querySelectorAll('.context-menu-item')].map((i) => i.textContent)).toEqual([expect.stringContaining('Study These Notes…')]);
    menus.dispose();
  });
});
