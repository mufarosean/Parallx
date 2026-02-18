// blockMutations.ts — shared mutation helpers for canvas block operations
//
// Centralizes core block mutations so menu actions, keyboard shortcuts,
// and future interaction surfaces reuse the same transaction behavior.

import type { Editor } from '@tiptap/core';
import { TextSelection } from '@tiptap/pm/state';

export interface BlockMoveResult {
  handled: boolean;
  moved: boolean;
}

const PAGE_SURFACE_NODES = new Set([
  'column', 'callout', 'detailsContent', 'blockquote',
]);

export function isColumnEffectivelyEmpty(columnNode: any): boolean {
  if (!columnNode || columnNode.type?.name !== 'column') {
    return false;
  }

  return !nodeHasMeaningfulContent(columnNode);
}

function nodeHasMeaningfulContent(node: any): boolean {
  if (!node) return false;

  if (node.isText) {
    const text = String(node.text ?? '');
    return text.replace(/[\s\u200B-\u200D\uFEFF]/g, '').length > 0;
  }

  if (node.type?.name === 'hardBreak') {
    return false;
  }

  if (node.childCount === 0) {
    return !!node.isAtom;
  }

  let meaningful = false;
  node.forEach((child: any) => {
    if (!meaningful && nodeHasMeaningfulContent(child)) {
      meaningful = true;
    }
  });
  return meaningful;
}

export function normalizeColumnListAfterMutation(tr: any, columnListPos: number): void {
  let targetPos = columnListPos;
  let columnListNode = tr.doc.nodeAt(targetPos);

  if (!columnListNode || columnListNode.type.name !== 'columnList') {
    targetPos = tr.mapping.map(columnListPos, -1);
    columnListNode = tr.doc.nodeAt(targetPos);
  }

  if (!columnListNode || columnListNode.type.name !== 'columnList') return;

  const allColumns: any[] = [];
  columnListNode.forEach((child: any) => {
    if (child.type.name === 'column') {
      allColumns.push(child);
    }
  });

  if (allColumns.length === 0) {
    tr.delete(targetPos, targetPos + columnListNode.nodeSize);
    return;
  }

  if (allColumns.length === 1) {
    tr.replaceWith(targetPos, targetPos + columnListNode.nodeSize, allColumns[0].content);
    return;
  }

  resetColumnListWidthsInTransaction(tr, targetPos);
}

function normalizeAllColumnListsAfterMutation(tr: any): void {
  const columnListPositions: number[] = [];
  tr.doc.descendants((node: any, pos: number) => {
    if (node.type?.name === 'columnList') {
      columnListPositions.push(pos);
    }
  });

  for (let i = columnListPositions.length - 1; i >= 0; i--) {
    normalizeColumnListAfterMutation(tr, columnListPositions[i]);
  }
}

export function duplicateBlockAt(
  editor: Editor,
  pos: number,
  node: any,
  options?: { setSelectionInsideDuplicate?: boolean },
): number {
  const insertPos = pos + node.nodeSize;
  const { tr } = editor.state;
  const clone = editor.state.schema.nodeFromJSON(node.toJSON());
  tr.insert(insertPos, clone);

  if (options?.setSelectionInsideDuplicate) {
    tr.setSelection(TextSelection.near(tr.doc.resolve(insertPos + 1)));
  }

  editor.view.dispatch(tr);
  return insertPos;
}

export function moveBlockUpWithinPageFlow(editor: Editor): BlockMoveResult {
  const { state } = editor;
  const { $head } = state.selection;
  const { containerDepth, blockDepth } = findBlockContext($head);

  if ($head.depth < blockDepth) return { handled: false, moved: false };

  const blockPos = $head.before(blockDepth);
  const node = state.doc.nodeAt(blockPos);
  if (!node) return { handled: false, moved: false };

  const container = containerDepth === 0 ? state.doc : $head.node(containerDepth);
  const $blockStart = state.doc.resolve(blockPos);
  const index = $blockStart.index(containerDepth);

  if (index <= 0) return { handled: true, moved: false };

  const parentPos = containerDepth === 0 ? 0 : $head.before(containerDepth);
  let offset = 0;
  for (let i = 0; i < index - 1; i++) {
    const child = container.child(i);
    offset += child.nodeSize;
  }
  const targetPos = parentPos + (containerDepth === 0 ? 0 : 1) + offset;

  const { tr } = state;
  const nodeJson = node.toJSON();
  tr.delete(blockPos, blockPos + node.nodeSize);
  tr.insert(targetPos, state.schema.nodeFromJSON(nodeJson));
  tr.setSelection(TextSelection.near(tr.doc.resolve(targetPos + 1)));
  editor.view.dispatch(tr);
  return { handled: true, moved: true };
}

export function moveBlockDownWithinPageFlow(editor: Editor): BlockMoveResult {
  const { state } = editor;
  const { $head } = state.selection;
  const { containerDepth, blockDepth } = findBlockContext($head);

  if ($head.depth < blockDepth) return { handled: false, moved: false };

  const blockPos = $head.before(blockDepth);
  const node = state.doc.nodeAt(blockPos);
  if (!node) return { handled: false, moved: false };

  const container = containerDepth === 0 ? state.doc : $head.node(containerDepth);
  const $blockStart = state.doc.resolve(blockPos);
  const index = $blockStart.index(containerDepth);

  if (index >= container.childCount - 1) return { handled: true, moved: false };

  const nextSibling = container.child(index + 1);
  const afterNextPos = blockPos + node.nodeSize + nextSibling.nodeSize;

  const { tr } = state;
  const nodeJson = node.toJSON();
  tr.insert(afterNextPos, state.schema.nodeFromJSON(nodeJson));
  tr.delete(blockPos, blockPos + node.nodeSize);

  const newBlockPos = blockPos + nextSibling.nodeSize;
  tr.setSelection(TextSelection.near(tr.doc.resolve(newBlockPos + 1)));
  editor.view.dispatch(tr);
  return { handled: true, moved: true };
}

export function moveBlockAcrossColumnBoundary(
  editor: Editor,
  direction: 'up' | 'down',
): boolean {
  const { $from } = editor.state.selection;

  let colDepth = -1;
  for (let d = $from.depth; d >= 1; d--) {
    if ($from.node(d).type.name === 'column') {
      colDepth = d;
      break;
    }
  }
  if (colDepth < 0) return false;

  const blockDepth = colDepth + 1;
  if (blockDepth > $from.depth) return false;

  const blockPos = $from.before(blockDepth);
  const blockNode = editor.state.doc.nodeAt(blockPos);
  if (!blockNode) return false;

  const colPos = $from.before(colDepth);
  const clDepth = colDepth - 1;
  const clPos = $from.before(clDepth);
  const clNode = $from.node(clDepth);
  const clEnd = clPos + clNode.nodeSize;
  const { tr } = editor.state;

  const probe = editor.state.tr;
  probe.delete(blockPos, blockPos + blockNode.nodeSize);
  const probeColPos = probe.mapping.map(colPos, -1);
  const probeColNode = probe.doc.nodeAt(probeColPos);
  const sourceWillBeEmptyAfterMove = !probeColNode
    || (probeColNode.type.name === 'column' && isColumnEffectivelyEmpty(probeColNode));

  if (sourceWillBeEmptyAfterMove && clNode.childCount === 2) {
    let sourceIndex = -1;
    let scanPos = clPos + 1;
    for (let i = 0; i < clNode.childCount; i++) {
      if (scanPos === colPos) {
        sourceIndex = i;
        break;
      }
      scanPos += clNode.child(i).nodeSize;
    }

    const otherIndex = sourceIndex === 0 ? 1 : sourceIndex === 1 ? 0 : -1;
    if (otherIndex >= 0) {
      const nodes: any[] = [];
      if (direction === 'up') {
        nodes.push(blockNode);
      }
      clNode.child(otherIndex).forEach((child: any) => {
        nodes.push(child);
      });
      if (direction === 'down') {
        nodes.push(blockNode);
      }
      tr.replaceWith(clPos, clPos + clNode.nodeSize, nodes);
      editor.view.dispatch(tr);
      return true;
    }
  }

  tr.delete(blockPos, blockPos + blockNode.nodeSize);

  const mappedColPos = tr.mapping.map(colPos, 1);
  const mappedColNode = tr.doc.nodeAt(mappedColPos);
  if (mappedColNode && mappedColNode.type.name === 'column' && isColumnEffectivelyEmpty(mappedColNode)) {
    tr.delete(mappedColPos, mappedColPos + mappedColNode.nodeSize);
  }

  normalizeColumnListAfterMutation(tr, clPos);

  const mapped = tr.mapping.map(direction === 'up' ? clPos : clEnd);
  tr.insert(mapped, blockNode);
  normalizeAllColumnListsAfterMutation(tr);
  editor.view.dispatch(tr);
  return true;

  return false;
}

export function turnBlockWithSharedStrategy(
  editor: Editor,
  pos: number,
  node: any,
  targetType: string,
  attrs?: any,
): void {
  if (targetType === 'columnList') {
    const columnCount = Number(attrs?.columns ?? attrs?.count ?? 2);
    const converted = turnBlockIntoColumns(editor, pos, node, columnCount);
    if (converted) {
      return;
    }
  }

  const srcType = node.type.name;
  const simpleTextBlock = ['paragraph', 'heading'].includes(srcType);
  const simpleTarget = ['paragraph', 'heading', 'bulletList', 'orderedList', 'taskList', 'blockquote', 'codeBlock'].includes(targetType);

  if (simpleTextBlock && simpleTarget) {
    let transformed = false;
    switch (targetType) {
      case 'paragraph':
        transformed = editor.chain().setTextSelection(pos + 1).setParagraph().focus().run();
        break;
      case 'heading':
        transformed = editor.chain().setTextSelection(pos + 1).setHeading(attrs).focus().run();
        break;
      case 'bulletList':
        transformed = editor.chain().setTextSelection(pos + 1).toggleBulletList().focus().run();
        break;
      case 'orderedList':
        transformed = editor.chain().setTextSelection(pos + 1).toggleOrderedList().focus().run();
        break;
      case 'taskList':
        transformed = editor.chain().setTextSelection(pos + 1).toggleTaskList().focus().run();
        break;
      case 'blockquote':
        transformed = editor.chain().setTextSelection(pos + 1).toggleBlockquote().focus().run();
        break;
      case 'codeBlock':
        transformed = editor.chain().setTextSelection(pos + 1).toggleCodeBlock().focus().run();
        break;
      default:
        transformed = false;
    }

    if (transformed) {
      return;
    }
  }

  turnBlockViaReplace(editor, pos, node, targetType, attrs);
}

export function turnBlockIntoColumns(
  editor: Editor,
  pos: number,
  node: any,
  columnCount: number,
): boolean {
  if (!Number.isFinite(columnCount) || columnCount < 2) {
    return false;
  }

  if (node.type.name === 'columnList') {
    return false;
  }

  const { schema } = editor.state;
  const columnNodeType = schema.nodes.column;
  const columnListNodeType = schema.nodes.columnList;
  const paragraphNodeType = schema.nodes.paragraph;

  if (!columnNodeType || !columnListNodeType || !paragraphNodeType) {
    return false;
  }

  const sourceBlock = schema.nodeFromJSON(node.toJSON());
  const fallbackParagraph = paragraphNodeType.createAndFill();
  if (!fallbackParagraph) {
    return false;
  }

  const columns: any[] = [];
  for (let i = 0; i < columnCount; i++) {
    const content = i === 0 ? [sourceBlock] : [fallbackParagraph];
    columns.push(columnNodeType.create({ width: null }, content));
  }

  const columnList = columnListNodeType.create(null, columns);

  const { tr } = editor.state;
  tr.replaceWith(pos, pos + node.nodeSize, columnList);

  const selectionAnchor = Math.min(pos + 3, tr.doc.content.size);
  tr.setSelection(TextSelection.near(tr.doc.resolve(selectionAnchor), 1));

  editor.view.dispatch(tr);
  editor.commands.focus();
  return true;
}

export function deleteDraggedSourceFromTransaction(
  tr: any,
  dragFrom: number,
  dragTo: number,
): void {
  const initialDoc = Array.isArray(tr.docs) && tr.docs.length > 0 ? tr.docs[0] : tr.doc;
  const safeFrom = Math.max(0, Math.min(dragFrom, initialDoc.content.size));
  const $src = initialDoc.resolve(safeFrom);
  let sourceColumnStartPos: number | null = null;
  let sourceColumnListPos: number | null = null;

  let colD = -1;
  for (let d = $src.depth; d >= 1; d--) {
    if ($src.node(d).type.name === 'column') { colD = d; break; }
  }

  if (colD >= 0) {
    sourceColumnStartPos = $src.before(colD);
    sourceColumnListPos = $src.before(colD - 1);
  }

  const mFrom = tr.mapping.map(dragFrom);
  const mTo = tr.mapping.map(dragTo);

  if (mTo > mFrom) tr.delete(mFrom, mTo);

  if (sourceColumnStartPos == null || sourceColumnListPos == null) {
    return;
  }

  const mappedColumnStart = tr.mapping.map(sourceColumnStartPos, 1);
  const maybeColumn = tr.doc.nodeAt(mappedColumnStart);
  if (!maybeColumn || maybeColumn.type.name !== 'column') {
    return;
  }

  if (isColumnEffectivelyEmpty(maybeColumn)) {
    tr.delete(mappedColumnStart, mappedColumnStart + maybeColumn.nodeSize);
    normalizeColumnListAfterMutation(tr, sourceColumnListPos);
    return;
  }

  // Fallback for extraction flows where mapping cannot re-resolve the original
  // source column start precisely after prior tr steps. Keep this structural and
  // conservative: only remove one empty column from a 2-column list.
  const mappedColumnListPos = tr.mapping.map(sourceColumnListPos, -1);
  const columnListNode = tr.doc.nodeAt(mappedColumnListPos);
  if (!columnListNode || columnListNode.type.name !== 'columnList') {
    return;
  }

  if (columnListNode.childCount !== 2) {
    return;
  }

  const emptyColumns: Array<{ pos: number; nodeSize: number }> = [];
  let scanPos = mappedColumnListPos + 1;
  columnListNode.forEach((child: any) => {
    if (child.type?.name === 'column' && isColumnEffectivelyEmpty(child)) {
      emptyColumns.push({ pos: scanPos, nodeSize: child.nodeSize });
    }
    scanPos += child.nodeSize;
  });

  if (emptyColumns.length !== 1) {
    return;
  }

  tr.delete(emptyColumns[0].pos, emptyColumns[0].pos + emptyColumns[0].nodeSize);
  normalizeColumnListAfterMutation(tr, mappedColumnListPos);
}

export function resetColumnListWidthsInTransaction(tr: any, columnListPos: number): void {
  const mPos = tr.mapping.map(columnListPos);
  const cl = tr.doc.nodeAt(mPos);
  if (!cl || cl.type.name !== 'columnList') return;

  let off = mPos + 1;
  for (let i = 0; i < cl.childCount; i++) {
    const ch = cl.child(i);
    if (ch.type.name === 'column' && ch.attrs.width !== null) {
      tr.setNodeMarkup(off, undefined, { ...ch.attrs, width: null });
    }
    off += ch.nodeSize;
  }
}

export function deleteBlockAt(editor: Editor, pos: number, node: any): void {
  editor.chain().deleteRange({ from: pos, to: pos + node.nodeSize }).focus().run();
}

export function applyTextColorToBlock(
  editor: Editor,
  pos: number,
  node: any,
  color: string | null,
): boolean {
  const from = pos + 1;
  const to = pos + node.nodeSize - 1;

  if (from >= to) {
    return false;
  }

  if (color) {
    editor.chain().setTextSelection({ from, to }).setColor(color).focus().run();
  } else {
    editor.chain().setTextSelection({ from, to }).unsetColor().focus().run();
  }

  return true;
}

export function applyBackgroundColorToBlock(
  editor: Editor,
  pos: number,
  node: any,
  color: string | null,
): void {
  const tr = editor.view.state.tr;
  tr.setNodeMarkup(pos, undefined, { ...node.attrs, backgroundColor: color });
  editor.view.dispatch(tr);
  editor.commands.focus();
}

export function turnBlockViaReplace(
  editor: Editor,
  pos: number,
  node: any,
  targetType: string,
  attrs?: any,
): void {
  const content = extractBlockContent(node);
  const textContent = node.textContent || '';

  const containerTypes = new Set(['callout', 'details', 'blockquote', 'toggleHeading']);
  const isSourceContainer = containerTypes.has(node.type.name);
  const isTargetContainer = containerTypes.has(targetType);

  if (isSourceContainer) {
    const innerBlocks = extractContainerBlocks(node);

    if (targetType === 'paragraph') {
      unwrapContainer(editor, pos, node, innerBlocks);
      return;
    }

    if (isTargetContainer) {
      swapContainer(editor, pos, node, targetType, innerBlocks, attrs);
      return;
    }

    const firstBlockContent = innerBlocks.length > 0 ? innerBlocks[0] : content;
    const leafContent = extractInlineContent(firstBlockContent);
    const newBlock = buildLeafBlock(targetType, leafContent, textContent, attrs);
    if (!newBlock) return;
    editor.chain().insertContentAt({ from: pos, to: pos + node.nodeSize }, newBlock).focus().run();
    return;
  }

  if (isTargetContainer) {
    const newBlock = buildContainerBlock(targetType, content, attrs);
    if (!newBlock) return;
    editor.chain().insertContentAt({ from: pos, to: pos + node.nodeSize }, newBlock).focus().run();
    return;
  }

  const newBlock = buildLeafBlock(targetType, content, textContent, attrs);
  if (!newBlock) return;
  editor.chain()
    .insertContentAt({ from: pos, to: pos + node.nodeSize }, newBlock)
    .focus()
    .run();
}

function extractContainerBlocks(node: any): any[] {
  const blocks: any[] = [];
  if (node.type.name === 'details') {
    node.forEach((child: any) => {
      if (child.type.name === 'detailsSummary') {
        const summaryContent = child.content.toJSON() || [];
        blocks.push({ type: 'paragraph', content: summaryContent });
      } else if (child.type.name === 'detailsContent') {
        child.forEach((inner: any) => blocks.push(inner.toJSON()));
      }
    });
  } else if (node.type.name === 'toggleHeading') {
    node.forEach((child: any) => {
      if (child.type.name === 'toggleHeadingText') {
        const textContent = child.content.toJSON() || [];
        blocks.push({ type: 'heading', attrs: { level: node.attrs.level }, content: textContent });
      } else if (child.type.name === 'detailsContent') {
        child.forEach((inner: any) => blocks.push(inner.toJSON()));
      }
    });
  } else {
    node.forEach((child: any) => blocks.push(child.toJSON()));
  }
  return blocks;
}

function unwrapContainer(editor: Editor, pos: number, node: any, innerBlocks: any[]): void {
  if (innerBlocks.length === 0) {
    innerBlocks = [{ type: 'paragraph' }];
  }
  editor.chain()
    .insertContentAt({ from: pos, to: pos + node.nodeSize }, innerBlocks)
    .focus()
    .run();
}

function swapContainer(
  editor: Editor,
  pos: number,
  node: any,
  targetType: string,
  innerBlocks: any[],
  attrs?: any,
): void {
  let newBlock: any;

  if (targetType === 'details') {
    const summaryContent = innerBlocks.length > 0
      ? (innerBlocks[0].content || [])
      : [];
    const bodyBlocks = innerBlocks.length > 1
      ? innerBlocks.slice(1)
      : [{ type: 'paragraph' }];
    newBlock = {
      type: 'details',
      content: [
        { type: 'detailsSummary', content: summaryContent },
        { type: 'detailsContent', content: bodyBlocks },
      ],
    };
  } else if (targetType === 'toggleHeading') {
    const headingContent = innerBlocks.length > 0
      ? (innerBlocks[0].content || [])
      : [];
    const bodyBlocks = innerBlocks.length > 1
      ? innerBlocks.slice(1)
      : [{ type: 'paragraph' }];
    newBlock = {
      type: 'toggleHeading',
      attrs: { level: attrs?.level || 1 },
      content: [
        { type: 'toggleHeadingText', content: headingContent },
        { type: 'detailsContent', content: bodyBlocks },
      ],
    };
  } else if (targetType === 'callout') {
    newBlock = {
      type: 'callout',
      attrs: { emoji: attrs?.emoji || 'lightbulb' },
      content: innerBlocks.length > 0 ? innerBlocks : [{ type: 'paragraph' }],
    };
  } else if (targetType === 'blockquote') {
    newBlock = {
      type: 'blockquote',
      content: innerBlocks.length > 0 ? innerBlocks : [{ type: 'paragraph' }],
    };
  } else {
    return;
  }

  editor.chain()
    .insertContentAt({ from: pos, to: pos + node.nodeSize }, newBlock)
    .focus()
    .run();
}

function buildContainerBlock(targetType: string, inlineContent: any[], attrs?: any): any | null {
  switch (targetType) {
    case 'callout':
      return { type: 'callout', attrs: { emoji: attrs?.emoji || 'lightbulb' }, content: [{ type: 'paragraph', content: inlineContent }] };
    case 'details':
      return {
        type: 'details',
        content: [
          { type: 'detailsSummary', content: inlineContent },
          { type: 'detailsContent', content: [{ type: 'paragraph' }] },
        ],
      };
    case 'toggleHeading':
      return {
        type: 'toggleHeading',
        attrs: { level: attrs?.level || 1 },
        content: [
          { type: 'toggleHeadingText', content: inlineContent },
          { type: 'detailsContent', content: [{ type: 'paragraph' }] },
        ],
      };
    case 'blockquote':
      return { type: 'blockquote', content: [{ type: 'paragraph', content: inlineContent }] };
    default:
      return null;
  }
}

function buildLeafBlock(targetType: string, inlineContent: any[], textContent: string, attrs?: any): any | null {
  switch (targetType) {
    case 'paragraph':
      return { type: 'paragraph', content: inlineContent };
    case 'heading':
      return { type: 'heading', attrs, content: inlineContent };
    case 'bulletList':
      return { type: 'bulletList', content: [{ type: 'listItem', content: [{ type: 'paragraph', content: inlineContent }] }] };
    case 'orderedList':
      return { type: 'orderedList', content: [{ type: 'listItem', content: [{ type: 'paragraph', content: inlineContent }] }] };
    case 'taskList':
      return { type: 'taskList', content: [{ type: 'taskItem', attrs: { checked: false }, content: [{ type: 'paragraph', content: inlineContent }] }] };
    case 'codeBlock':
      return { type: 'codeBlock', content: textContent ? [{ type: 'text', text: textContent }] : [] };
    case 'mathBlock':
      return { type: 'mathBlock', attrs: { latex: textContent } };
    default:
      return null;
  }
}

function extractInlineContent(blockJson: any): any[] {
  if (blockJson.content && Array.isArray(blockJson.content)) {
    if (blockJson.content.length > 0 && blockJson.content[0].type === 'text') {
      return blockJson.content;
    }
    if (blockJson.content.length > 0) {
      return extractInlineContent(blockJson.content[0]);
    }
  }
  return [];
}

function extractBlockContent(node: any): any[] {
  if (node.isTextblock) return node.content.toJSON() || [];
  let result: any[] = [];
  node.descendants((child: any) => {
    if (child.isTextblock && result.length === 0) {
      result = child.content.toJSON() || [];
      return false;
    }
    return true;
  });
  if (result.length === 0 && node.textContent) {
    result = [{ type: 'text', text: node.textContent }];
  }
  return result;
}

function findBlockContext($pos: any): { containerDepth: number; blockDepth: number } {
  let containerDepth = 0;
  for (let d = 1; d <= $pos.depth; d++) {
    if (PAGE_SURFACE_NODES.has($pos.node(d).type.name)) {
      containerDepth = d;
    }
  }
  return { containerDepth, blockDepth: containerDepth + 1 };
}
