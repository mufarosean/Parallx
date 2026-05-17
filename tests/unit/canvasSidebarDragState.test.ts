/**
 * M77 Phase 7 — CanvasSidebarDragState unit tests.
 *
 * The state machine is pure (no DOM, no data service), so we exercise the
 * full surface in isolation.
 */

import { describe, it, expect, beforeEach } from 'vitest';
import { CanvasSidebarDragState, type TreeNodeShape } from '../../src/built-in/canvas/canvasSidebarDragState';

function tree(...nodes: TreeNodeShape[]): TreeNodeShape[] {
  return nodes;
}

function n(id: string, ...children: TreeNodeShape[]): TreeNodeShape {
  return { id, children };
}

describe('CanvasSidebarDragState', () => {
  let s: CanvasSidebarDragState;

  beforeEach(() => {
    s = new CanvasSidebarDragState();
  });

  // ── Lifecycle ─────────────────────────────────────────────────────

  it('starts with no drag, no drop target, and not unsafe to rebuild', () => {
    expect(s.getDraggedPageId()).toBe(null);
    expect(s.getDropTarget()).toBe(null);
    expect(s.isUnsafeToRebuild()).toBe(false);
  });

  it('start() marks drag in progress and captures snapshot', () => {
    s.start('page1', tree(n('root', n('page1'), n('page2'))));
    expect(s.getDraggedPageId()).toBe('page1');
    expect(s.isUnsafeToRebuild()).toBe(true);
    expect(s.getOldParentId('page1')).toBe('root');
  });

  it('end() clears drag state but NOT drop-in-flight', () => {
    s.start('page1', tree(n('page1')));
    s.beginDrop();
    s.end();
    expect(s.getDraggedPageId()).toBe(null);
    expect(s.getDropTarget()).toBe(null);
    expect(s.isUnsafeToRebuild()).toBe(true); // still mid-drop
    s.finishDrop();
    expect(s.isUnsafeToRebuild()).toBe(false);
  });

  // ── isUnsafeToRebuild — both phases ─────────────────────────────

  it('is unsafe during drag phase', () => {
    s.start('page1', tree(n('page1')));
    expect(s.isUnsafeToRebuild()).toBe(true);
  });

  it('is unsafe during drop async phase even if drag is end()ed', () => {
    s.start('page1', tree(n('page1')));
    s.beginDrop();
    s.end();
    expect(s.isUnsafeToRebuild()).toBe(true);
  });

  it('is safe once both drag is ended AND drop is finished', () => {
    s.start('page1', tree(n('page1')));
    s.beginDrop();
    s.end();
    s.finishDrop();
    expect(s.isUnsafeToRebuild()).toBe(false);
  });

  // ── Snapshot — ancestry & old parent ────────────────────────────

  it('captures ancestry from a multi-level tree', () => {
    s.start(
      'leaf',
      tree(
        n('root',
          n('parent',
            n('leaf'),
          ),
          n('sibling'),
        ),
      ),
    );
    expect(s.getOldParentId('leaf')).toBe('parent');
    expect(s.getOldParentId('parent')).toBe('root');
    expect(s.getOldParentId('root')).toBe(null);
    expect(s.getOldParentId('unknown')).toBe(null);
  });

  it('isDescendantInSnapshot recognises a direct child', () => {
    s.start('root', tree(n('root', n('child'))));
    expect(s.isDescendantInSnapshot('root', 'child')).toBe(true);
  });

  it('isDescendantInSnapshot recognises a transitive descendant', () => {
    s.start('root', tree(n('root', n('mid', n('leaf')))));
    expect(s.isDescendantInSnapshot('root', 'leaf')).toBe(true);
  });

  it('isDescendantInSnapshot treats a node as its own descendant', () => {
    s.start('root', tree(n('root')));
    expect(s.isDescendantInSnapshot('root', 'root')).toBe(true);
  });

  it('isDescendantInSnapshot returns false for unrelated nodes', () => {
    s.start('a', tree(n('a'), n('b')));
    expect(s.isDescendantInSnapshot('a', 'b')).toBe(false);
  });

  it('isDescendantInSnapshot returns false when not in a drag', () => {
    expect(s.isDescendantInSnapshot('a', 'b')).toBe(false);
  });

  // ── Drop target ─────────────────────────────────────────────────

  it('setDropTarget/getDropTarget round-trip correctly', () => {
    s.start('page', tree(n('page')));
    s.setDropTarget({ parentId: 'parent', afterSiblingId: 'sib' });
    expect(s.getDropTarget()).toEqual({ parentId: 'parent', afterSiblingId: 'sib' });
    s.setDropTarget(null);
    expect(s.getDropTarget()).toBe(null);
  });

  it('end() clears the drop target', () => {
    s.start('page', tree(n('page')));
    s.setDropTarget({ parentId: 'p', afterSiblingId: undefined });
    s.end();
    expect(s.getDropTarget()).toBe(null);
  });

  // ── Deferred refreshes ──────────────────────────────────────────

  it('drainSuppressedRefreshes returns false when nothing was suppressed', () => {
    expect(s.drainSuppressedRefreshes()).toBe(false);
  });

  it('coalesces any number of suppressed refreshes into one true return', () => {
    s.noteSuppressedRefresh();
    s.noteSuppressedRefresh();
    s.noteSuppressedRefresh();
    expect(s.drainSuppressedRefreshes()).toBe(true);
    // After drain, the next call returns false (counter reset).
    expect(s.drainSuppressedRefreshes()).toBe(false);
  });
});
