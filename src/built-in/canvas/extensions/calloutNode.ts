// calloutNode.ts — Notion-style Callout block node
//
// A colored info box with an SVG icon and rich content.
// Rendered as <div data-type="callout"> with a non-editable icon and editable content area.

import { Node, mergeAttributes } from '@tiptap/core';
import { resolvePageIcon, svgIcon } from '../canvasIcons.js';

// ─── TipTap Command Augmentation ────────────────────────────────────────────
declare module '@tiptap/core' {
  interface Commands<ReturnType> {
    callout: {
      setCallout: (attrs?: { emoji?: string }) => ReturnType;
      toggleCallout: (attrs?: { emoji?: string }) => ReturnType;
      unsetCallout: () => ReturnType;
    };
  }
}

export const Callout = Node.create({
  name: 'callout',
  group: 'block',
  content: 'block+',
  defining: true,

  addAttributes() {
    return {
      emoji: {
        default: 'lightbulb',
        parseHTML: (element: HTMLElement) => element.getAttribute('data-emoji') || 'lightbulb',
        renderHTML: (attributes: Record<string, any>) => ({ 'data-emoji': attributes.emoji }),
      },
    };
  },

  parseHTML() {
    return [{ tag: 'div[data-type="callout"]' }];
  },

  renderHTML({ HTMLAttributes }: { HTMLAttributes: Record<string, any> }) {
    return [
      'div',
      mergeAttributes(HTMLAttributes, {
        'data-type': 'callout',
        class: 'canvas-callout',
      }),
      [
        'span',
        {
          class: 'canvas-callout-emoji',
          contenteditable: 'false',
          'data-icon': HTMLAttributes['data-emoji'] || 'lightbulb',
        },
        '',
      ],
      ['div', { class: 'canvas-callout-content' }, 0],
    ];
  },

  addNodeView() {
    return ({ node }: any) => {
      const dom = document.createElement('div');
      dom.classList.add('canvas-callout');
      dom.setAttribute('data-type', 'callout');

      const applyBg = (attrs: any) => {
        if (attrs.backgroundColor) {
          dom.style.backgroundColor = attrs.backgroundColor;
        } else {
          dom.style.backgroundColor = '';
        }
      };

      applyBg(node.attrs);

      const iconSpan = document.createElement('span');
      iconSpan.classList.add('canvas-callout-emoji');
      iconSpan.contentEditable = 'false';

      const renderIcon = (emoji: string) => {
        const iconId = resolvePageIcon(emoji);
        iconSpan.innerHTML = svgIcon(iconId);
        const svg = iconSpan.querySelector('svg');
        if (svg) { svg.setAttribute('width', '20'); svg.setAttribute('height', '20'); }
      };

      renderIcon(node.attrs.emoji);
      dom.appendChild(iconSpan);

      const contentDOM = document.createElement('div');
      contentDOM.classList.add('canvas-callout-content');
      dom.appendChild(contentDOM);

      return {
        dom,
        contentDOM,
        update(updatedNode: any) {
          if (updatedNode.type.name !== 'callout') return false;
          renderIcon(updatedNode.attrs.emoji);
          applyBg(updatedNode.attrs);
          return true;
        },
      };
    };
  },

  addCommands() {
    return {
      setCallout:
        (attrs?: { emoji?: string }) =>
        ({ commands }: any) =>
          commands.wrapIn(this.name, attrs),
      toggleCallout:
        (attrs?: { emoji?: string }) =>
        ({ commands }: any) =>
          commands.toggleWrap(this.name, attrs),
      unsetCallout:
        () =>
        ({ commands }: any) =>
          commands.lift(this.name),
    };
  },
});
