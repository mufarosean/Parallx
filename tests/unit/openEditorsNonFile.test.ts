// openEditorsNonFile.test.ts — the list of open editors holds a tab that is
// not a file. An untitled file's URI (untitled://) has no file path, and
// asking for one throws; the list asked, so one such tab made
// getOpenEditors() throw for the whole app and for every tool's
// api.editors.openEditors (found by the review of Study piece B, 2026-11-26).
import { describe, expect, it } from 'vitest';
import { EditorService } from '../../src/services/editorService';
import { UntitledEditorInput } from '../../src/editor/panes/untitledEditorInput';
import { Emitter } from '../../src/platform/events';

describe('open editors with a tab that is not a file', () => {
  it('lists an untitled file, with no file path, and does not throw', () => {
    const input = UntitledEditorInput.create();
    const model = { id: 'g1', editors: [input], activeEditor: input, onDidChange: new Emitter<unknown>().event };
    const group = { model };
    const part = { groups: [group], activeGroup: group, onDidActiveGroupChange: new Emitter<unknown>().event, onDidGroupCountChange: new Emitter<unknown>().event };
    const service = new EditorService(part as never);
    const open = service.getOpenEditors();
    expect(open).toHaveLength(1);
    expect(open[0].name).toBe(input.name);
    expect(open[0].filePath).toBeUndefined();
    expect(open[0].isShowing).toBe(true);
  });
});
