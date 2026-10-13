// canvasSidebarKeyboardMove.test.ts — Ctrl+Shift+arrows move the selected
// page in the sidebar tree, as a drag does. docs/ACCESSIBILITY.md, section 6.

import { describe, it, expect } from 'vitest';
import { pageMoveForKey } from '../../src/built-in/canvas/canvasSidebarKeyboardMove.js';
import type { IPageSummaryTreeNode } from '../../src/built-in/canvas/canvasTypes.js';

const node = (id: string, children: IPageSummaryTreeNode[] = []) => ({ id, title: id, parentId: null, children }) as unknown as IPageSummaryTreeNode;
const tree = [node('a'), node('b', [node('b1'), node('b2')]), node('c')];
const key = (k: string) => ({ key: k, ctrlKey: true, metaKey: false, shiftKey: true, altKey: false });

describe('pageMoveForKey', () => {
  it('moves among siblings', () => {
    expect(pageMoveForKey(tree, 'c', key('ArrowUp'))).toEqual({ newParentId: null, afterSiblingId: 'a' });
    expect(pageMoveForKey(tree, 'b', key('ArrowUp'))).toEqual({ newParentId: null, afterSiblingId: undefined });
    expect(pageMoveForKey(tree, 'a', key('ArrowDown'))).toEqual({ newParentId: null, afterSiblingId: 'b' });
    expect(pageMoveForKey(tree, 'a', key('ArrowUp'))).toBeNull();
    expect(pageMoveForKey(tree, 'c', key('ArrowDown'))).toBeNull();
  });

  it('nests under the page above, and takes a child out after its parent', () => {
    expect(pageMoveForKey(tree, 'c', key('ArrowRight'))).toEqual({ newParentId: 'b', afterSiblingId: 'b2' });
    expect(pageMoveForKey(tree, 'b', key('ArrowRight'))).toEqual({ newParentId: 'a', afterSiblingId: undefined });
    expect(pageMoveForKey(tree, 'b1', key('ArrowLeft'))).toEqual({ newParentId: null, afterSiblingId: 'b' });
    expect(pageMoveForKey(tree, 'a', key('ArrowLeft'))).toBeNull();
  });

  it('needs Ctrl+Shift', () => {
    expect(pageMoveForKey(tree, 'c', { ...key('ArrowUp'), shiftKey: false })).toBeNull();
    expect(pageMoveForKey(tree, 'c', { ...key('ArrowUp'), altKey: true })).toBeNull();
  });
});
