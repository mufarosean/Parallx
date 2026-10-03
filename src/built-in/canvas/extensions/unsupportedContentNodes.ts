// unsupportedContentNodes.ts — placeholders for content this build can't show
//
// See unknownContent.ts: a stored node or mark the schema doesn't define is
// wrapped in one of these on load and unwrapped on save, so the page loads
// and keeps it.  `raw` is the original JSON; `label` its type, shown.

import { Node, mergeAttributes } from '@tiptap/core';

const placeholderAttrs = () => ({
  raw: { default: '', rendered: false },
  label: { default: '', rendered: false },
});

export const UnsupportedBlock = Node.create({
  name: 'unsupportedBlock',
  group: 'block',
  atom: true,
  selectable: true,
  draggable: false,

  addAttributes() {
    return placeholderAttrs();
  },

  parseHTML() {
    return [{ tag: 'div[data-type="unsupportedBlock"]' }];
  },

  renderHTML({ node, HTMLAttributes }) {
    return [
      'div',
      mergeAttributes(HTMLAttributes, {
        'data-type': 'unsupportedBlock',
        class: 'canvas-unsupported-block',
        contenteditable: 'false',
      }),
      `Unsupported block (${node.attrs.label || 'unknown'}), kept as it is`,
    ];
  },
});

export const UnsupportedInline = Node.create({
  name: 'unsupportedInline',
  group: 'inline',
  inline: true,
  atom: true,
  selectable: true,

  addAttributes() {
    return placeholderAttrs();
  },

  parseHTML() {
    return [{ tag: 'span[data-type="unsupportedInline"]' }];
  },

  renderHTML({ node, HTMLAttributes }) {
    return [
      'span',
      mergeAttributes(HTMLAttributes, {
        'data-type': 'unsupportedInline',
        class: 'canvas-unsupported-inline',
        contenteditable: 'false',
        title: `Unsupported content (${node.attrs.label || 'unknown'}), kept as it is`,
      }),
      `[${node.attrs.label || 'unsupported'}]`,
    ];
  },
});
