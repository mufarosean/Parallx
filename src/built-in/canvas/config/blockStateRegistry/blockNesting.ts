// blockNesting.ts — Block indent/outdent into containers
//
// Tab pushes a block into the nearest preceding container sibling.
// Shift+Tab lifts a block out of its current container.
//
// Container content areas vary by type:
//   • callout / blockquote — blocks are direct children
//   • details / toggleHeading — blocks go inside the `detailsContent` child
//
// Part of blockStateRegistry — the single authority for block state operations.

import type { Editor } from '@tiptap/core';
import { TextSelection } from '@tiptap/pm/state';
import { resolveBlockAncestry, PAGE_CONTAINERS } from './blockStateRegistry.js';

// ── Types ───────────────────────────────────────────────────────────────────

/** Container types that accept nested blocks via Tab indent. */
const INDENT_CONTAINERS = new Set([
  'callout',
  'blockquote',
  'details',
  'toggleHeading',
]);

/** Containers whose block content lives in a nested `detailsContent` child. */
const CONTENT_WRAPPER_CONTAINERS = new Set([
  'details',
  'toggleHeading',
]);

// ── Indent (Tab) ────────────────────────────────────────────────────────────

/**
 * Indent a block into the nearest preceding container sibling.
 *
 * Walks backward from the block's position to find the first sibling above
 * that is a container type (.callout, .blockquote, .details, .toggleHeading).
 * If found, appends the block to that container's content area.
 *
 * @returns true if the block was indented, false if no eligible container above.
 */
export function indentBlock(editor: Editor, pos: number, node: any): boolean {
  const { state } = editor;
  const $pos = state.doc.resolve(pos);
  const ancestry = resolveBlockAncestry($pos);
  const containerDepth = ancestry.containerDepth;
  const container = containerDepth === 0 ? state.doc : $pos.node(containerDepth);
  const parentPos = containerDepth === 0 ? 0 : $pos.before(containerDepth);
  const blockIndex = $pos.index(containerDepth);

  // Walk backward through siblings to find the nearest container
  for (let i = blockIndex - 1; i >= 0; i--) {
    const sibling = container.child(i);
    if (!INDENT_CONTAINERS.has(sibling.type.name)) continue;

    // Found a container — calculate its end position
    let siblingPos = parentPos + (containerDepth === 0 ? 0 : 1);
    for (let j = 0; j < i; j++) {
      siblingPos += container.child(j).nodeSize;
    }

    // Find the content area to append into
    const insertPos = findContainerContentEnd(sibling, siblingPos);
    if (insertPos === null) continue;

    const { tr } = state;

    // Delete the block from its current position first (before insert,
    // so positions in the container above don't shift).
    tr.delete(pos, pos + node.nodeSize);

    // Map the insert position through the deletion mapping
    const mappedInsert = tr.mapping.map(insertPos);

    // Insert the block at the end of the container's content area
    const clone = state.schema.nodeFromJSON(node.toJSON());
    tr.insert(mappedInsert, clone);

    // Set cursor inside the moved block
    const cursorPos = Math.min(mappedInsert + 1, tr.doc.content.size);
    tr.setSelection(TextSelection.near(tr.doc.resolve(cursorPos)));

    editor.view.dispatch(tr);
    editor.commands.focus();
    return true;
  }

  return false;
}

// ── Outdent (Shift+Tab) ─────────────────────────────────────────────────────

/**
 * Outdent (lift) a block out of its current container.
 *
 * If the block is inside a container (callout, blockquote, details,
 * toggleHeading), extracts it and places it immediately after the container
 * in the parent scope.
 *
 * Does NOT operate when:
 *   • The block is at the document root (nothing to outdent from)
 *   • The block is in a column (column is not a user-facing container)
 *
 * @returns true if the block was outdented, false if not applicable.
 */
export function outdentBlock(editor: Editor, pos: number, node: any): boolean {
  const { state } = editor;
  const $pos = state.doc.resolve(pos);
  const ancestry = resolveBlockAncestry($pos);

  // Find the enclosing container we want to escape from.
  // Walk upward from blockDepth to find a container that is:
  //   (a) in PAGE_CONTAINERS (so blocks can live inside it), AND
  //   (b) not a column (columns are spatial, not semantic containers), AND
  //   (c) not the document root (depth 0)
  let liftContainerDepth: number | null = null;
  for (let d = ancestry.blockDepth - 1; d >= 1; d--) {
    const name = $pos.node(d).type.name;
    if (name === 'column' || name === 'columnList') continue;
    // Accept PAGE_CONTAINERS OR detailsContent (wrapper inside details/toggleHeading)
    if (PAGE_CONTAINERS.has(name) || name === 'detailsContent') {
      liftContainerDepth = d;
      break;
    }
  }

  if (liftContainerDepth === null) return false;

  const containerNode = $pos.node(liftContainerDepth);
  const containerName = containerNode.type.name;

  // For detailsContent, we want to place the block after the parent
  // details/toggleHeading, not after the detailsContent itself
  let targetParentDepth: number;
  if (containerName === 'detailsContent') {
    // detailsContent's parent is details or toggleHeading
    targetParentDepth = liftContainerDepth - 1;
  } else {
    targetParentDepth = liftContainerDepth;
  }

  if (targetParentDepth < 1) return false;

  const targetContainerPos = $pos.before(targetParentDepth);
  const targetContainerNode = $pos.node(targetParentDepth);
  const afterContainerPos = targetContainerPos + targetContainerNode.nodeSize;

  const { tr } = state;

  // Delete the block from inside the container
  tr.delete(pos, pos + node.nodeSize);

  // Insert after the container (mapped position)
  const mappedAfter = tr.mapping.map(afterContainerPos);
  const clone = state.schema.nodeFromJSON(node.toJSON());
  tr.insert(mappedAfter, clone);

  // Set cursor inside the moved block
  const cursorPos = Math.min(mappedAfter + 1, tr.doc.content.size);
  tr.setSelection(TextSelection.near(tr.doc.resolve(cursorPos)));

  editor.view.dispatch(tr);
  editor.commands.focus();
  return true;
}

// ── Helpers ─────────────────────────────────────────────────────────────────

/**
 * Find the position at the end of a container's content area (before the
 * container's closing token). This is where we insert when indenting.
 *
 * For callout/blockquote: the content area IS the node itself.
 * For details/toggleHeading: the content area is the `detailsContent` child.
 */
function findContainerContentEnd(
  containerNode: any,
  containerPos: number,
): number | null {
  const name = containerNode.type.name;

  if (CONTENT_WRAPPER_CONTAINERS.has(name)) {
    // Find the detailsContent child
    let offset = containerPos + 1; // skip container open token
    for (let i = 0; i < containerNode.childCount; i++) {
      const child = containerNode.child(i);
      if (child.type.name === 'detailsContent') {
        // Insert position = end of detailsContent (before its closing token)
        return offset + child.nodeSize - 1;
      }
      offset += child.nodeSize;
    }
    return null; // No detailsContent found — malformed
  }

  // callout / blockquote: content area is the node itself
  return containerPos + containerNode.nodeSize - 1;
}
