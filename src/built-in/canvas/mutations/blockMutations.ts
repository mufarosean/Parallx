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

  const colNode = $from.node(colDepth);
  const colPos = $from.before(colDepth);
  const clDepth = colDepth - 1;
  const clPos = $from.before(clDepth);
  const clNode = $from.node(clDepth);
  const clEnd = clPos + clNode.nodeSize;
  const { tr } = editor.state;

  if (colNode.childCount <= 1 && clNode.childCount === 2) {
    let otherIdx = -1;
    let pos = clPos + 1;
    for (let i = 0; i < clNode.childCount; i++) {
      if (pos !== colPos) otherIdx = i;
      pos += clNode.child(i).nodeSize;
    }
    if (otherIdx >= 0) {
      const nodes: any[] = [];
      if (direction === 'up') {
        nodes.push(blockNode);
      }
      clNode.child(otherIdx).forEach((ch: any) => nodes.push(ch));
      if (direction === 'down') {
        nodes.push(blockNode);
      }
      tr.replaceWith(clPos, clPos + clNode.nodeSize, nodes);
      editor.view.dispatch(tr);
      return true;
    }
  } else if (colNode.childCount <= 1 && clNode.childCount > 2) {
    tr.delete(colPos, colPos + colNode.nodeSize);
    const mapped = tr.mapping.map(direction === 'up' ? clPos : clEnd);
    tr.insert(mapped, blockNode);
    resetColumnListWidthsInTransaction(tr, clPos);
    editor.view.dispatch(tr);
    return true;
  } else {
    tr.delete(blockPos, blockPos + blockNode.nodeSize);
    const mapped = tr.mapping.map(direction === 'up' ? clPos : clEnd);
    tr.insert(mapped, blockNode);
    editor.view.dispatch(tr);
    return true;
  }

  return false;
}

export function turnBlockWithSharedStrategy(
  editor: Editor,
  pos: number,
  node: any,
  targetType: string,
  attrs?: any,
): void {
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

export function deleteDraggedSourceFromTransaction(
  tr: any,
  dragFrom: number,
  dragTo: number,
): void {
  const mFrom = tr.mapping.map(dragFrom);
  const mTo = tr.mapping.map(dragTo);
  const $src = tr.doc.resolve(mFrom);

  let colD = -1;
  for (let d = $src.depth; d >= 1; d--) {
    if ($src.node(d).type.name === 'column') { colD = d; break; }
  }

  if (colD >= 0) {
    const colNode = $src.node(colD);
    if (colNode.childCount <= 1) {
      const colStart = $src.before(colD);
      const clPos = $src.before(colD - 1);
      tr.delete(colStart, colStart + colNode.nodeSize);

      const clNow = tr.doc.nodeAt(clPos);
      if (clNow && clNow.type.name === 'columnList') {
        let off = clPos + 1;
        for (let i = 0; i < clNow.childCount; i++) {
          const ch = clNow.child(i);
          if (ch.type.name === 'column' && ch.attrs.width !== null) {
            tr.setNodeMarkup(off, undefined, { ...ch.attrs, width: null });
          }
          off += ch.nodeSize;
        }
      }
      return;
    }
  }

  if (mTo > mFrom) tr.delete(mFrom, mTo);
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
