// blockBackground.ts — Block-level background color extension
//
// Adds a `backgroundColor` GlobalAttribute to block-level node types.
// Applied via the block action menu's Color submenu.
//
// The type list is NOT declared here: config/blockRegistry.ts owns the single
// source (BLOCK_BG_TYPES) and tiptapExtensions.ts passes it in via
// `BlockBackgroundColor.configure({ types })`.  This file previously kept a
// duplicated copy pinned by a drift test; the configure pattern removes the
// duplication entirely.

import { Extension } from '@tiptap/core';

export interface BlockBackgroundColorOptions {
  /** Node type names that carry the backgroundColor attribute. */
  types: string[];
}

export const BlockBackgroundColor = Extension.create<BlockBackgroundColorOptions>({
  name: 'blockBackgroundColor',

  addOptions() {
    return { types: [] };
  },

  addGlobalAttributes() {
    return [
      {
        types: [...this.options.types],
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
