// @vitest-environment jsdom
// editorStart.test.ts — the empty editor is Start: New Page (while the canvas
// is up), Open File…, the last pages and files opened, then the shortcuts.
// The recent rows run one command with the item's key; that command opens
// a page through the canvas and a file through the editor resolver.
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { Emitter } from '../../src/platform/events';
import { installEditorStart, setupEditorWatermark } from '../../src/workbench/workbenchWatermark';
import { openRecentItem } from '../../src/commands/startCommands';
import { setFileEditorResolver } from '../../src/api/bridges/editorsBridge';
import type { RecentOpenedItem } from '../../src/services/recentsService';
import type { IEditorInput } from '../../src/editor/editorInput';

const item = (kind: 'page' | 'file', title: string, target: string): RecentOpenedItem =>
  ({ key: `${kind}:${target}`, kind, title, target, ts: Date.now() - 60_000 });

function setup(opens: RecentOpenedItem[], commands = new Set(['canvas.newPage'])) {
  document.body.innerHTML = '<div id="editor"><div class="editor-watermark"></div></div>';
  const editor = document.getElementById('editor')!;
  setupEditorWatermark(editor);
  const recents = new Emitter<void>();
  const cmd = new Emitter<{ commandId: string }>();
  const list = { opens };
  const start = installEditorStart(editor, {
    recentOpens: () => list.opens, hasCommand: (id) => commands.has(id),
    onDidChange: recents.event, onDidChangeCommand: cmd.event,
  });
  return { editor, recents, cmd, list, commands, start };
}

const labels = (root: HTMLElement, sel: string) =>
  Array.from(root.querySelectorAll(`${sel} .px-btn__label`)).map((e) => e.textContent);

describe('Start on the empty editor', () => {
  beforeEach(() => { document.body.innerHTML = ''; });

  it('offers New Page and Open File…, then the recent pages and files, newest first', () => {
    const { editor } = setup([item('page', 'Clark notes', 'p1'), item('file', 'readme.md', 'file:///w/readme.md')]);
    expect(labels(editor, '.editor-start-actions')).toEqual(['New Page', 'Open File…']);
    expect(editor.querySelector('.editor-start-list .px-section-label')?.textContent).toBe('Recent');
    expect(labels(editor, '.editor-start-list')).toEqual(['Clark notes', 'readme.md']);
    const row = editor.querySelector('.editor-start-list .px-btn') as HTMLButtonElement;
    expect(row.tagName).toBe('BUTTON');
    expect(row.title).toMatch(/^Page, opened /);
    // The shortcut hints are still there, below.
    expect(editor.querySelectorAll('.editor-watermark-entry').length).toBeGreaterThan(0);
  });

  it('shows no Recent section with nothing opened yet, and at most six rows', () => {
    const { editor, list, recents } = setup([]);
    expect(editor.querySelector('.editor-start-list')).toBeNull();
    list.opens = Array.from({ length: 9 }, (_, i) => item('page', `Page ${i}`, `p${i}`));
    recents.fire();
    expect(labels(editor, '.editor-start-list')).toHaveLength(6);
  });

  it('shows New Page only while the canvas command is there, and follows it coming and going', () => {
    const { editor, commands, cmd } = setup([], new Set());
    expect(labels(editor, '.editor-start-actions')).toEqual(['Open File…']);
    commands.add('canvas.newPage');
    cmd.fire({ commandId: 'canvas.newPage' });
    expect(labels(editor, '.editor-start-actions')).toEqual(['New Page', 'Open File…']);
  });

  it('stops following the lists once disposed', () => {
    const { editor, list, recents, start } = setup([]);
    start.dispose();
    list.opens = [item('page', 'Late', 'p9')];
    recents.fire();
    expect(editor.querySelector('.editor-start-list')).toBeNull();
  });
});

describe('workbench.action.openRecentItem', () => {
  const opens = [item('page', 'Clark notes', 'p1'), item('file', 'readme.md', 'file:///w/readme.md')];
  const ctx = (services: Record<string, unknown>) => ({ getService: <T>(id: string) => services[id] as T, workbench: undefined }) as never;

  it('opens a page through the canvas command', async () => {
    const executeCommand = vi.fn(async () => undefined);
    await openRecentItem.handler(ctx({ IRecentsService: { getRecentOpens: () => opens }, ICommandService: { executeCommand } }), 'page:p1');
    expect(executeCommand).toHaveBeenCalledWith('canvas.openPage', 'p1');
  });

  it('opens a file through the editor resolver, as a preview', async () => {
    const input = { id: 'x' } as unknown as IEditorInput;
    setFileEditorResolver(async (uri) => (uri === 'file:///w/readme.md' ? input : undefined));
    const openEditor = vi.fn(async () => undefined);
    await openRecentItem.handler(ctx({ IRecentsService: { getRecentOpens: () => opens }, IEditorService: { openEditor } }), 'file:file:///w/readme.md');
    expect(openEditor).toHaveBeenCalledWith(input, { pinned: false });
  });

  it('does nothing for a key no longer in the list', async () => {
    const executeCommand = vi.fn(async () => undefined);
    await openRecentItem.handler(ctx({ IRecentsService: { getRecentOpens: () => opens }, ICommandService: { executeCommand } }), 'page:gone');
    expect(executeCommand).not.toHaveBeenCalled();
  });
});
