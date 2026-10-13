// @vitest-environment jsdom
//
// An editor tab to another group without a drag: the tab menu's Move to
// Previous/Next Group (Shift+F10 on a focused tab) and the two palette
// commands. Neighbours go by the screen, not by the order the groups were
// made in. docs/ACCESSIBILITY.md, section 6.
import { describe, it, expect, afterEach } from 'vitest';
import { EditorPart } from '../../src/parts/editorPart';
import { GroupDirection } from '../../src/editor/editorTypes';
import { Orientation } from '../../src/layout/layoutTypes';
import type { IEditorInput } from '../../src/editor/editorInput';

Element.prototype.scrollIntoView = Element.prototype.scrollIntoView ?? (() => { /* noop */ });

const mounted: { part: EditorPart; host: HTMLElement }[] = [];
function mountPart(): EditorPart {
  const host = document.createElement('div');
  document.body.appendChild(host);
  const part = new EditorPart();
  part.create(host);
  part.layout(1200, 800, Orientation.Horizontal);
  mounted.push({ part, host });
  return part;
}
afterEach(() => {
  for (const { part, host } of mounted.splice(0)) { part.dispose(); host.remove(); }
});

let n = 0;
function input(name: string): IEditorInput {
  const id = `test-${++n}`;
  return {
    id, typeId: 'test', name, description: '', isDirty: false, uri: undefined,
    onDidChangeDirty: () => ({ dispose() {} }), onDidChangeLabel: () => ({ dispose() {} }), onWillDispose: () => ({ dispose() {} }),
    matches: (other: IEditorInput) => other.id === id,
    serialize: () => ({ typeId: 'test', id }),
    dispose() {},
  } as unknown as IEditorInput;
}

describe('moving an editor to another group', () => {
  it('next with no group after splits one off and the tab moves there', () => {
    const part = mountPart();
    const group = part.groups[0];
    const a = input('a'); const b = input('b');
    group.openEditor(a, { pinned: true });
    group.openEditor(b, { pinned: true });
    expect(group.tabMenuMoves!.neighbors!()).toEqual({ previous: false, next: false });

    const target = part.moveEditorToGroup(group.id, a.id, 'next')!;
    expect(part.groupCount).toBe(2);
    expect(target.model.editors.map((e) => e.id)).toEqual([a.id]);
    expect(group.model.editors.map((e) => e.id)).toEqual([b.id]);
    expect(part.activeGroup?.id).toBe(target.id);
  });

  it('a lone tab with no group after stays put; previous with none does nothing', () => {
    const part = mountPart();
    const group = part.groups[0];
    const a = input('a');
    group.openEditor(a, { pinned: true });
    expect(part.moveEditorToGroup(group.id, a.id, 'next')).toBeUndefined();
    expect(part.moveEditorToGroup(group.id, a.id, 'previous')).toBeUndefined();
    expect(part.groupCount).toBe(1);
  });

  it('goes by the screen: a group split off to the left is the previous one', () => {
    const part = mountPart();
    const right = part.groups[0];
    const a = input('a'); const b = input('b');
    right.openEditor(a, { pinned: true });
    const left = part.splitGroup(right.id, GroupDirection.Left)!; // made second, shown first
    right.openEditor(b, { pinned: true });
    expect(right.tabMenuMoves!.neighbors!()).toEqual({ previous: true, next: false });
    expect(left.tabMenuMoves!.neighbors!()).toEqual({ previous: false, next: true });

    const landed = part.moveEditorToGroup(right.id, b.id, 'previous');
    expect(landed?.id).toBe(left.id);
    expect(left.model.editors.map((e) => e.id)).toContain(b.id);
    expect(right.model.editors.map((e) => e.id)).not.toContain(b.id);
  });

  it('a source left empty closes', () => {
    const part = mountPart();
    const first = part.groups[0];
    const a = input('a'); const b = input('b');
    first.openEditor(a, { pinned: true });
    first.openEditor(b, { pinned: true });
    const second = part.moveEditorToGroup(first.id, a.id, 'next')!;
    part.moveEditorToGroup(first.id, b.id, 'next');
    expect(part.groupCount).toBe(1);
    expect(part.groups[0].id).toBe(second.id);
    expect(second.model.editors.map((e) => e.id)).toEqual([a.id, b.id]);
  });
});
