// blockTransforms.ts — Block type conversion ("turn into") operations
//
// Functions that change a block's type without changing its position.
// Part of the blockStateRegistry — the single authority for block state
// operations.

import type { Editor } from '@tiptap/core';
import { isContainerBlockType, turnBlockIntoColumns } from './blockStateRegistry.js';

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

// turnBlockIntoColumns lives in columnCreation.ts — re-exported through
// the facade above.  blockTransforms consumes it for "Turn Into → Columns".

// ── Private helpers ─────────────────────────────────────────────────────────

function turnBlockViaReplace(
  editor: Editor,
  pos: number,
  node: any,
  targetType: string,
  attrs?: any,
): void {
  const content = extractBlockContent(node);
  const textContent = node.textContent || '';

  const isSourceContainer = isContainerBlockType(node.type.name);
  const isTargetContainer = isContainerBlockType(targetType);

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
