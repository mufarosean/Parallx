// editorGroupService.test.ts — pin EditorGroupService.
//
// Service is a thin facade over EditorPart. Pins:
//   - all getter/method calls delegate 1:1 to EditorPart with identical args.
//   - onDidActiveGroupChange / onDidGroupCountChange re-fire EditorPart's events.
//   - dispose() unsubscribes (firing on EditorPart after dispose does NOT reach listener).

import { describe, it, expect, vi } from 'vitest';
import { Emitter } from '../../src/platform/events';
import { EditorGroupService } from '../../src/services/editorGroupService';
import { GroupDirection } from '../../src/editor/editorTypes';

function mkPartStub() {
  const activeEmitter = new Emitter<any>();
  const countEmitter = new Emitter<number>();
  const state = {
    activeGroup: { id: 'g-active' } as any,
    groups: [{ id: 'g1' }, { id: 'g2' }] as any[],
    groupCount: 2,
  };
  const part: any = {
    onDidActiveGroupChange: activeEmitter.event,
    onDidGroupCountChange: countEmitter.event,
    get activeGroup() { return state.activeGroup; },
    get groups() { return state.groups; },
    get groupCount() { return state.groupCount; },
    getGroup: vi.fn((id: string) => state.groups.find((g) => g.id === id)),
    splitGroup: vi.fn((id: string, _dir) => ({ id: `${id}-split` })),
    addGroup: vi.fn((id: string, _dir) => ({ id: `${id}-added` })),
    removeGroup: vi.fn(),
    mergeGroup: vi.fn(),
    findGroup: vi.fn((_dir, _src) => ({ id: 'g-found' })),
    activateGroup: vi.fn(),
  };
  return { part, activeEmitter, countEmitter, state };
}

describe('EditorGroupService — facade delegation', () => {
  it('getters proxy directly to EditorPart', () => {
    const { part, state } = mkPartStub();
    const svc = new EditorGroupService(part);
    expect(svc.activeGroup).toBe(state.activeGroup);
    expect(svc.groups).toBe(state.groups);
    expect(svc.groupCount).toBe(state.groupCount);
  });

  it('getGroup forwards id', () => {
    const { part } = mkPartStub();
    const svc = new EditorGroupService(part);
    const out = svc.getGroup('g2');
    expect(part.getGroup).toHaveBeenCalledWith('g2');
    expect(out?.id).toBe('g2');
  });

  it('splitGroup / addGroup forward (id, direction) and return EditorPart result', () => {
    const { part } = mkPartStub();
    const svc = new EditorGroupService(part);
    expect(svc.splitGroup('g1', GroupDirection.Right)?.id).toBe('g1-split');
    expect(part.splitGroup).toHaveBeenCalledWith('g1', GroupDirection.Right);
    expect(svc.addGroup('g2', GroupDirection.Down)?.id).toBe('g2-added');
    expect(part.addGroup).toHaveBeenCalledWith('g2', GroupDirection.Down);
  });

  it('removeGroup / mergeGroup / activateGroup forward without return', () => {
    const { part } = mkPartStub();
    const svc = new EditorGroupService(part);
    svc.removeGroup('g1');
    svc.mergeGroup('g1', 'g2');
    svc.activateGroup('g2');
    expect(part.removeGroup).toHaveBeenCalledWith('g1');
    expect(part.mergeGroup).toHaveBeenCalledWith('g1', 'g2');
    expect(part.activateGroup).toHaveBeenCalledWith('g2');
  });

  it('findGroup forwards (direction, sourceGroupId)', () => {
    const { part } = mkPartStub();
    const svc = new EditorGroupService(part);
    expect(svc.findGroup(GroupDirection.Up, 'g1')?.id).toBe('g-found');
    expect(part.findGroup).toHaveBeenCalledWith(GroupDirection.Up, 'g1');
    svc.findGroup(GroupDirection.Down);
    expect(part.findGroup).toHaveBeenLastCalledWith(GroupDirection.Down, undefined);
  });
});

describe('EditorGroupService — event refire', () => {
  it('onDidActiveGroupChange re-fires EditorPart events with the same payload', () => {
    const { part, activeEmitter } = mkPartStub();
    const svc = new EditorGroupService(part);
    const seen: any[] = [];
    svc.onDidActiveGroupChange((g) => seen.push(g));
    const payload = { id: 'g-new' } as any;
    activeEmitter.fire(payload);
    expect(seen).toEqual([payload]);
  });

  it('onDidGroupCountChange re-fires count payloads', () => {
    const { part, countEmitter } = mkPartStub();
    const svc = new EditorGroupService(part);
    const seen: number[] = [];
    svc.onDidGroupCountChange((n) => seen.push(n));
    countEmitter.fire(3);
    countEmitter.fire(7);
    expect(seen).toEqual([3, 7]);
  });

  it('dispose unsubscribes from EditorPart events', () => {
    const { part, activeEmitter, countEmitter } = mkPartStub();
    const svc = new EditorGroupService(part);
    const seen: any[] = [];
    svc.onDidActiveGroupChange((g) => seen.push(['a', g]));
    svc.onDidGroupCountChange((n) => seen.push(['c', n]));
    svc.dispose();
    activeEmitter.fire({ id: 'after' } as any);
    countEmitter.fire(99);
    expect(seen).toEqual([]);
  });
});
