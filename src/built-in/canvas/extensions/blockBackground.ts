// blockBackground.ts — Block-level background color extension
//
// Adds a `backgroundColor` GlobalAttribute to all block-level node types.
// Applied via the block action menu's Color submenu.

import { Extension } from '@tiptap/core';

// NOTE: blockLifecycle.ts (in the BSR) keeps a sibling copy of this list
// (BG_CAPABLE_TYPES) for its canTakeBackgroundColor() predicate, because
// gate rules forbid blockLifecycle from importing `extensions/`.
// `tests/unit/canvasCapabilityDrift.test.ts` pins the two lists together
// so they cannot drift.  Exported only for that test — canvas-internal
// code MUST go through canTakeBackgroundColor() instead.
export const BLOCK_BG_TYPES: readonly string[] = [
  'paragraph', 'heading', 'blockquote', 'codeBlock',
  'callout', 'details', 'bulletList', 'orderedList', 'taskList',
  // List ITEMS carry the colour on their own <li>, which already contains the
  // item's line AND its nested sub-list in the DOM — so the fill wraps the
  // whole subtree as ONE region (Notion-style), never per-child stripes.
  'listItem', 'taskItem',
];

export const BlockBackgroundColor = Extension.create({
  name: 'blockBackgroundColor',

  addGlobalAttributes() {
    return [
      {
        types: [...BLOCK_BG_TYPES],
        attributes: {
          backgroundColor: {
            default: null,
            parseHTML: (element: HTMLElement) => element.style.backgroundColor || null,
            renderHTML: (attributes: Record<string, any>) => {
              if (!attributes.backgroundColor) return {};
              // The class is a stable CSS hook for the rounded single-region
              // styling (padding, border-radius, marker inclusion) — see
              // canvas.css `.canvas-block-bg`.
              return { style: `background-color: ${attributes.backgroundColor}`, class: 'canvas-block-bg' };
            },
          },
        },
      },
    ];
  },
});
