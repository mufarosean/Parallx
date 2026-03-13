import { describe, expect, it } from 'vitest';
import {
  resolveMovableBlock,
  type MovableBlockContext,
} from '../../src/built-in/canvas/config/blockStateRegistry/columnInvariants';

type MockNode = {
  type: { name: string };
};

type MockResolvedPos = {
  depth: number;
  doc: MockNode;
  node: (depth: number) => MockNode;
  before: (depth: number) => number;
};

function namedNode(name: string): MockNode {
  return { type: { name } };
}

function makeResolvedPos(names: string[], positions: number[]): MockResolvedPos {
  const nodes = names.map(namedNode);

  return {
    depth: nodes.length - 1,
    doc: nodes[0],
    node(depth: number) {
      return nodes[depth];
    },
    before(depth: number) {
      return positions[depth];
    },
  };
}

function expectMovableContext(actual: MovableBlockContext | null): asserts actual is MovableBlockContext {
  expect(actual).not.toBeNull();
}

describe('resolveMovableBlock', () => {
  it('resolves a top-level paragraph as a normal movable block', () => {
    const $pos = makeResolvedPos(
      ['doc', 'paragraph', 'text'],
      [0, 0, 1],
    );

    const movable = resolveMovableBlock($pos as any);

    expectMovableContext(movable);
    expect(movable.node.type.name).toBe('paragraph');
    expect(movable.isListItem).toBe(false);
    expect(movable.pos).toBe(0);
    expect(movable.parentNode.type.name).toBe('doc');
    expect(movable.columnDepth).toBeNull();
    expect(movable.columnListDepth).toBeNull();
    expect(movable.listType).toBeNull();
  });

  it('resolves a bulleted list selection to the list item rather than the list wrapper', () => {
    const $pos = makeResolvedPos(
      ['doc', 'bulletList', 'listItem', 'paragraph', 'text'],
      [0, 3, 4, 5, 6],
    );

    const movable = resolveMovableBlock($pos as any);

    expectMovableContext(movable);
    expect(movable.node.type.name).toBe('listItem');
    expect(movable.isListItem).toBe(true);
    expect(movable.pos).toBe(4);
    expect(movable.parentNode.type.name).toBe('bulletList');
    expect(movable.listPos).toBe(3);
    expect(movable.listNode?.type.name).toBe('bulletList');
    expect(movable.listType).toBe('bulletList');
  });

  it('preserves column ancestry while resolving task items as movable blocks', () => {
    const $pos = makeResolvedPos(
      ['doc', 'columnList', 'column', 'taskList', 'taskItem', 'paragraph', 'text'],
      [0, 2, 3, 4, 5, 6, 7],
    );

    const movable = resolveMovableBlock($pos as any);

    expectMovableContext(movable);
    expect(movable.node.type.name).toBe('taskItem');
    expect(movable.isListItem).toBe(true);
    expect(movable.listType).toBe('taskList');
    expect(movable.columnListDepth).toBe(1);
    expect(movable.columnDepth).toBe(2);
    expect(movable.parentNode.type.name).toBe('taskList');
  });
});