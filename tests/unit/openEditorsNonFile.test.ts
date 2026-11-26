// openEditorsNonFile.test.ts — the list of open editors holds a tab that is
// not a file. An untitled file's URI (untitled://) has no file path, and
// asking for one throws; the list asked, so one such tab made
// getOpenEditors() throw for the whole app and for every tool's
// api.editors.openEditors (found by the review of Study piece B, 2026-11-26).
import { describe, expect, it } from 'vitest';
import { EditorService } from '../../src/services/editorService';
import { UntitledEditorInput } from '../../src/editor/panes/untitledEditorInput';
import { Emitter } from '../../src/platform/events';
import { EditorGroupChangeKind } from '../../src/editor/editorTypes';

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

// The list of open editors hears a tab's name or live word change for as long
// as the tab is open anywhere. Found on the built app (study-app-probe,
// 2026-11-26): a Study session shown beside its source said "8 of 20" in the
// list long after it had moved on, because the listener was kept by the
// editor's id and went when another tab with that id closed.
describe('open editors: a tab still open is still heard', () => {
  function setup() {
    const a = UntitledEditorInput.create();
    const changes = [new Emitter<unknown>(), new Emitter<unknown>()];
    const models = [
      { id: 'g1', editors: [a] as unknown[], activeEditor: a, onDidChange: changes[0].event },
      { id: 'g2', editors: [] as unknown[], activeEditor: undefined as unknown, onDidChange: changes[1].event },
    ];
    const groups = models.map((model) => ({ model }));
    const part = { groups, activeGroup: groups[0], onDidActiveGroupChange: new Emitter<unknown>().event, onDidGroupCountChange: new Emitter<unknown>().event };
    const service = new EditorService(part as never);
    let heard = 0;
    service.onDidChangeOpenEditors(() => { heard++; });
    const open = (g: number, editor: unknown) => { models[g].editors.push(editor); changes[g].fire({ kind: EditorGroupChangeKind.EditorOpen, editor }); };
    const close = (g: number, editor: unknown) => { models[g].editors.splice(models[g].editors.indexOf(editor), 1); changes[g].fire({ kind: EditorGroupChangeKind.EditorClose, editor }); };
    return { a, service, open, close, heardSince: () => { const n = heard; heard = 0; return n; } };
  }

  it('the same editor in two groups: closed in one, its live word is still heard from the other', () => {
    const { a, service, open, close, heardSince } = setup();
    open(1, a);
    close(1, a);
    heardSince();
    a.setStatus('9 of 20');
    expect(heardSince()).toBe(1);
    expect(service.getOpenEditors()[0].status).toBe('9 of 20');
  });

  it('two editors with one id: the second is heard too, and after the first closes', () => {
    const { a, open, close, heardSince } = setup();
    const b = UntitledEditorInput.create();
    Object.defineProperty(b, 'id', { value: a.id });
    open(1, b);
    heardSince();
    b.setStatus('1 of 4');
    expect(heardSince()).toBe(1);
    close(0, a);
    heardSince();
    b.setStatus('2 of 4');
    expect(heardSince()).toBe(1);
  });

  it('an editor closed everywhere is no longer listened to', () => {
    const { a, close, heardSince } = setup();
    close(0, a);
    heardSince();
    a.setStatus('gone');
    expect(heardSince()).toBe(0);
  });
});
