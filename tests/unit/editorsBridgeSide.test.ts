// editorsBridgeSide.test.ts — openFileEditor(uri, { side: true }) opens the
// file beside the active editor: in the group to its right, in a new split
// when there is none, or where the file is already open. The reveal is filed
// either way.

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { EditorsBridge, setFileEditorResolver } from '../../src/api/bridges/editorsBridge';
import { GroupDirection } from '../../src/editor/editorTypes';
import { takeFileReveal, _clearFileRevealsForTest } from '../../src/editor/fileReveal';

const FILE = 'file:///notes/clark.pdf';

function fakeGroup(id: string, count = 0) {
  return { id, model: { count, closeEditor: vi.fn() } };
}

function setup(opts: { open?: { id: string; groupId: string }[]; right?: ReturnType<typeof fakeGroup> } = {}) {
  const editorService = {
    openEditor: vi.fn(async () => {}),
    getOpenEditors: vi.fn(() => (opts.open ?? []).map((o) => ({ ...o, name: '', description: '', isDirty: false, isActive: false }))),
    focusEditor: vi.fn(async () => true),
  };
  const active = fakeGroup('g1', 1);
  const split = fakeGroup('g2', 1);
  const groupService = {
    activeGroup: active,
    findGroup: vi.fn((direction: GroupDirection, source?: string) =>
      direction === GroupDirection.Right && source === 'g1' ? opts.right : undefined),
    splitGroup: vi.fn(() => split),
    activateGroup: vi.fn(),
  };
  const bridge = new EditorsBridge('test.tool', editorService as never, [], groupService as never);
  return { bridge, editorService, groupService, split };
}

describe('openFileEditor to the side', () => {
  beforeEach(() => {
    _clearFileRevealsForTest();
    setFileEditorResolver(async (uri) => ({ id: uri.toLowerCase(), typeId: 'parallx.editor.pdf' } as never));
  });
  afterEach(() => _clearFileRevealsForTest());

  it('without side, opens in the active group as before', async () => {
    const { bridge, editorService, groupService } = setup();
    await bridge.openFileEditor(FILE);
    expect(editorService.openEditor).toHaveBeenCalledWith(expect.objectContaining({ id: FILE }), { pinned: true });
    expect(editorService.openEditor.mock.calls[0]).toHaveLength(2);
    expect(groupService.splitGroup).not.toHaveBeenCalled();
  });

  it('splits the active group to the right when nothing is there, dropping the copied editor', async () => {
    const { bridge, editorService, groupService, split } = setup();
    await bridge.openFileEditor(FILE, { side: true, reveal: { page: 17, quote: 'Fewer parameters' } });
    expect(groupService.splitGroup).toHaveBeenCalledWith('g1', GroupDirection.Right);
    expect(split.model.closeEditor).toHaveBeenCalledWith(0, true);
    expect(editorService.openEditor).toHaveBeenCalledWith(expect.objectContaining({ id: FILE }), { pinned: true }, 'g2');
    expect(groupService.activateGroup).toHaveBeenCalledWith('g2');
    // The reveal is filed for the pane to take once shown.
    expect(takeFileReveal('/notes/clark.pdf')).toEqual({ page: 17, quote: 'Fewer parameters' });
  });

  it('uses the group already to the right instead of splitting', async () => {
    const right = fakeGroup('g9');
    const { bridge, editorService, groupService } = setup({ right });
    await bridge.openFileEditor(FILE, { side: true });
    expect(groupService.splitGroup).not.toHaveBeenCalled();
    expect(editorService.openEditor).toHaveBeenCalledWith(expect.anything(), { pinned: true }, 'g9');
    expect(groupService.activateGroup).toHaveBeenCalledWith('g9');
  });

  it('a file already open is shown where it is, not opened twice', async () => {
    const { bridge, editorService, groupService } = setup({ open: [{ id: FILE, groupId: 'g1' }] });
    await bridge.openFileEditor(FILE, { side: true, reveal: { page: 3 } });
    expect(groupService.splitGroup).not.toHaveBeenCalled();
    expect(groupService.findGroup).not.toHaveBeenCalled();
    expect(editorService.openEditor).toHaveBeenCalledTimes(1);
    expect(editorService.openEditor).toHaveBeenCalledWith(expect.anything(), { pinned: true }, 'g1');
    expect(takeFileReveal('/notes/clark.pdf')).toEqual({ page: 3 });
  });

  it('without a group service, side falls back to the active group', async () => {
    const editorService = { openEditor: vi.fn(async () => {}), getOpenEditors: vi.fn(() => []), focusEditor: vi.fn() };
    const bridge = new EditorsBridge('test.tool', editorService as never, []);
    await bridge.openFileEditor(FILE, { side: true });
    expect(editorService.openEditor).toHaveBeenCalledWith(expect.anything(), { pinned: true });
    expect(editorService.openEditor.mock.calls[0]).toHaveLength(2);
  });
});
