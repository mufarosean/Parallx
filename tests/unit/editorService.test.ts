// editorService.test.ts — pin EditorService facade + event wiring.
//
// Pins:
//   - activeEditor returns activeGroup.model.activeEditor, or undefined when no active group.
//   - getOpenEditors: descriptor per editor; isActive true only for activeGroup.model.activeEditor.
//   - openEditor delegates to EditorPart.openEditor(input, options, groupId).
//   - closeEditor with unknown input returns false.
//   - closeEditor with unknown groupId returns false.
//   - closeEditor with input found: closes via group.closeEditor(idx, force).
//   - closeEditor without input: closes activeIndex; returns false when activeIndex < 0.
//   - onDidActiveGroupChange refires activeEditor + onDidChangeOpenEditors.
//   - group model EditorActive fires onDidActiveEditorChange ONLY when group is active.
//   - EditorOpen/EditorMove/EditorActive/EditorDirty/EditorPin/EditorUnpin/EditorClose all fire onDidChangeOpenEditors.
//   - editor's onDidChangeLabel fires onDidChangeOpenEditors (attached on EditorOpen, detached on EditorClose).
//   - onDidGroupCountChange re-wires group listeners and fires onDidChangeOpenEditors.

import { describe, it, expect, vi } from 'vitest';
import { Emitter } from '../../src/platform/events';
import { EditorService } from '../../src/services/editorService';
import { EditorGroupChangeKind } from '../../src/editor/editorTypes';

let nextId = 0;
function mkEditor(name = 'a.txt') {
  const labelEmitter = new Emitter<void>();
  const ed: any = {
    id: `e${++nextId}`,
    name,
    description: '',
    isDirty: false,
    iconHtml: '',
    onDidChangeLabel: labelEmitter.event,
    _fireLabel: () => labelEmitter.fire(),
  };
  return ed;
}

function mkGroup(id: string, editors: any[] = []) {
  const modelChange = new Emitter<any>();
  const state = {
    editors,
    activeEditor: editors[0],
    activeIndex: editors.length ? 0 : -1,
  };
  const closeEditor = vi.fn(async (idx: number, _force: boolean) => {
    const ed = state.editors[idx];
    if (!ed) return false;
    state.editors.splice(idx, 1);
    modelChange.fire({ kind: EditorGroupChangeKind.EditorClose, editor: ed });
    state.activeEditor = state.editors[0];
    state.activeIndex = state.editors.length ? 0 : -1;
    modelChange.fire({ kind: EditorGroupChangeKind.EditorActive, editor: state.activeEditor });
    return true;
  });
  const group: any = {
    model: {
      id,
      get editors() { return state.editors; },
      get activeEditor() { return state.activeEditor; },
      get activeIndex() { return state.activeIndex; },
      onDidChange: modelChange.event,
    },
    closeEditor,
    _fire: (e: any) => modelChange.fire(e),
    _setActive: (idx: number) => { state.activeIndex = idx; state.activeEditor = state.editors[idx]; },
    _setEditors: (eds: any[]) => { state.editors = eds; state.activeEditor = eds[0]; state.activeIndex = eds.length ? 0 : -1; },
  };
  return group;
}

function mkPart(groups: any[] = []) {
  const activeChange = new Emitter<any>();
  const countChange = new Emitter<number>();
  const state = { groups, activeGroup: groups[0] };
  const openEditor = vi.fn(async (_input, _opts, _gid) => {});
  const getGroup = vi.fn((id: string) => state.groups.find((g) => g.model.id === id));
  const part: any = {
    onDidActiveGroupChange: activeChange.event,
    onDidGroupCountChange: countChange.event,
    get activeGroup() { return state.activeGroup; },
    get groups() { return state.groups; },
    openEditor,
    getGroup,
    _fireActive: (g: any) => { state.activeGroup = g; activeChange.fire(g); },
    _fireCount: (n: number) => countChange.fire(n),
    _setActiveGroup: (g: any) => { state.activeGroup = g; },
    _setGroups: (gs: any[]) => { state.groups = gs; },
  };
  return part;
}

describe('EditorService — facade reads', () => {
  it('activeEditor returns activeGroup.model.activeEditor', () => {
    const ed = mkEditor();
    const g = mkGroup('g1', [ed]);
    const part = mkPart([g]);
    const svc = new EditorService(part);
    expect(svc.activeEditor).toBe(ed);
  });

  it('activeEditor undefined when no active group', () => {
    const part = mkPart([]);
    const svc = new EditorService(part);
    expect(svc.activeEditor).toBeUndefined();
  });

  it("getOpenEditors lists all editors across groups; isActive true only for activeGroup's activeEditor", () => {
    const e1 = mkEditor('e1');
    const e2 = mkEditor('e2');
    const e3 = mkEditor('e3');
    const g1 = mkGroup('g1', [e1, e2]);
    const g2 = mkGroup('g2', [e3]);
    const part = mkPart([g1, g2]); // activeGroup = g1, activeEditor = e1
    const svc = new EditorService(part);
    const out = svc.getOpenEditors();
    expect(out.map((o) => o.id)).toEqual([e1.id, e2.id, e3.id]);
    expect(out.find((o) => o.id === e1.id)?.isActive).toBe(true);
    expect(out.find((o) => o.id === e2.id)?.isActive).toBe(false);
    expect(out.find((o) => o.id === e3.id)?.isActive).toBe(false);
    expect(out[0].groupId).toBe('g1');
    expect(out[2].groupId).toBe('g2');
  });
});

describe('EditorService — openEditor / closeEditor', () => {
  it('openEditor delegates to EditorPart with the same (input, options, groupId)', async () => {
    const part = mkPart([mkGroup('g1', [mkEditor()])]);
    const svc = new EditorService(part);
    const input = mkEditor('x');
    await svc.openEditor(input, { pinned: true } as any, 'g1');
    expect(part.openEditor).toHaveBeenCalledWith(input, { pinned: true }, 'g1');
  });

  it('closeEditor with unknown groupId returns false', async () => {
    const part = mkPart([mkGroup('g1', [mkEditor()])]);
    const svc = new EditorService(part);
    expect(await svc.closeEditor(undefined, 'no-such-group')).toBe(false);
  });

  it('closeEditor with input not in group returns false', async () => {
    const g1 = mkGroup('g1', [mkEditor('a')]);
    const part = mkPart([g1]);
    const svc = new EditorService(part);
    const ghost = mkEditor('ghost');
    expect(await svc.closeEditor(ghost, 'g1')).toBe(false);
    expect(g1.closeEditor).not.toHaveBeenCalled();
  });

  it('closeEditor with matching input → group.closeEditor(idx, force)', async () => {
    const a = mkEditor('a');
    const b = mkEditor('b');
    const g1 = mkGroup('g1', [a, b]);
    const part = mkPart([g1]);
    const svc = new EditorService(part);
    expect(await svc.closeEditor(b, 'g1', true)).toBe(true);
    expect(g1.closeEditor).toHaveBeenCalledWith(1, true);
  });

  it('closeEditor with no input closes activeIndex', async () => {
    const a = mkEditor('a');
    const g1 = mkGroup('g1', [a]);
    g1._setActive(0);
    const part = mkPart([g1]);
    const svc = new EditorService(part);
    expect(await svc.closeEditor()).toBe(true);
    expect(g1.closeEditor).toHaveBeenCalledWith(0, false);
  });

  it('closeEditor with no input and empty group returns false', async () => {
    const g1 = mkGroup('g1', []);
    const part = mkPart([g1]);
    const svc = new EditorService(part);
    expect(await svc.closeEditor()).toBe(false);
    expect(g1.closeEditor).not.toHaveBeenCalled();
  });
});

describe('EditorService — event wiring', () => {
  it('onDidActiveGroupChange refires activeEditor + onDidChangeOpenEditors', () => {
    const e1 = mkEditor();
    const e2 = mkEditor();
    const g1 = mkGroup('g1', [e1]);
    const g2 = mkGroup('g2', [e2]);
    const part = mkPart([g1, g2]);
    const svc = new EditorService(part);
    const active: any[] = [];
    const open: number[] = [];
    svc.onDidActiveEditorChange((e) => active.push(e));
    svc.onDidChangeOpenEditors(() => open.push(1));
    part._fireActive(g2);
    expect(active).toEqual([e2]);
    expect(open.length).toBeGreaterThanOrEqual(1);
  });

  it('group EditorActive fires onDidActiveEditorChange ONLY for the active group', () => {
    const e1 = mkEditor();
    const e2 = mkEditor();
    const g1 = mkGroup('g1', [e1]);
    const g2 = mkGroup('g2', [e2]);
    const part = mkPart([g1, g2]); // active = g1
    const svc = new EditorService(part);
    const active: any[] = [];
    svc.onDidActiveEditorChange((e) => active.push(e));
    g2._fire({ kind: EditorGroupChangeKind.EditorActive, editor: e2 });
    expect(active).toEqual([]);
    g1._fire({ kind: EditorGroupChangeKind.EditorActive, editor: e1 });
    expect(active).toEqual([e1]);
  });

  it('structural events fire onDidChangeOpenEditors', () => {
    const e1 = mkEditor();
    const g1 = mkGroup('g1', [e1]);
    const part = mkPart([g1]);
    const svc = new EditorService(part);
    let count = 0;
    svc.onDidChangeOpenEditors(() => count++);
    for (const kind of [
      EditorGroupChangeKind.EditorOpen,
      EditorGroupChangeKind.EditorClose,
      EditorGroupChangeKind.EditorMove,
      EditorGroupChangeKind.EditorActive,
      EditorGroupChangeKind.EditorDirty,
      EditorGroupChangeKind.EditorPin,
      EditorGroupChangeKind.EditorUnpin,
    ]) {
      g1._fire({ kind, editor: e1 });
    }
    expect(count).toBe(7);
  });

  it('attaches label listener on EditorOpen; label change fires onDidChangeOpenEditors', () => {
    const g1 = mkGroup('g1', []);
    const part = mkPart([g1]);
    const svc = new EditorService(part);
    let count = 0;
    svc.onDidChangeOpenEditors(() => count++);
    const ed = mkEditor('new');
    g1._fire({ kind: EditorGroupChangeKind.EditorOpen, editor: ed });
    const baseline = count;
    ed._fireLabel();
    expect(count).toBe(baseline + 1);
  });

  it('detaches label listener on EditorClose; later label fire does NOT propagate', () => {
    const ed = mkEditor('x');
    const g1 = mkGroup('g1', [ed]);
    const part = mkPart([g1]);
    const svc = new EditorService(part);
    let count = 0;
    svc.onDidChangeOpenEditors(() => count++);
    // Constructor attaches label listener for existing editors.
    g1._fire({ kind: EditorGroupChangeKind.EditorClose, editor: ed });
    const baseline = count;
    ed._fireLabel();
    expect(count).toBe(baseline); // no extra fire
  });

  it('onDidGroupCountChange fires onDidChangeOpenEditors and re-wires listeners for new groups', () => {
    const g1 = mkGroup('g1', []);
    const part = mkPart([g1]);
    const svc = new EditorService(part);
    let count = 0;
    svc.onDidChangeOpenEditors(() => count++);
    const g2 = mkGroup('g2', []);
    part._setGroups([g1, g2]);
    part._fireCount(2);
    expect(count).toBeGreaterThanOrEqual(1);
    // After re-wire, g2 events flow through
    const before = count;
    g2._fire({ kind: EditorGroupChangeKind.EditorOpen, editor: mkEditor() });
    expect(count).toBeGreaterThan(before);
  });
});
