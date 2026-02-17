// toggleHeadingNode.ts — Toggle Heading block (collapsible heading)
//
// A heading (H1/H2/H3) with a toggle chevron that collapses/expands a body.
// Reuses DetailsContent from @tiptap/extension-details for the collapsible body.

import { Node, mergeAttributes } from '@tiptap/core';

// ─── ToggleHeadingText — editable heading line ──────────────────────────────

export const ToggleHeadingText = Node.create({
  name: 'toggleHeadingText',
  content: 'inline*',
  defining: true,
  selectable: false,

  parseHTML() {
    return [{ tag: 'div[data-type="toggleHeadingText"]' }];
  },

  renderHTML({ HTMLAttributes }: { HTMLAttributes: Record<string, any> }) {
    return ['div', mergeAttributes(HTMLAttributes, { 'data-type': 'toggleHeadingText' }), 0];
  },
});

// ─── ToggleHeading — collapsible heading container ──────────────────────────

export const ToggleHeading = Node.create({
  name: 'toggleHeading',
  group: 'block',
  content: 'toggleHeadingText detailsContent',
  defining: true,
  priority: 200,

  addAttributes() {
    return {
      level: {
        default: 1,
        parseHTML: (element: HTMLElement) =>
          parseInt(element.getAttribute('data-level') || '1', 10),
        renderHTML: (attributes: Record<string, any>) => ({
          'data-level': attributes.level,
        }),
      },
    };
  },

  parseHTML() {
    return [{ tag: 'div[data-type="toggleHeading"]' }];
  },

  renderHTML({ HTMLAttributes }: { HTMLAttributes: Record<string, any> }) {
    return [
      'div',
      mergeAttributes(HTMLAttributes, {
        'data-type': 'toggleHeading',
        class: 'canvas-toggle-heading',
      }),
      0,
    ];
  },

  addNodeView() {
    return ({ node }: any) => {
      const dom = document.createElement('div');
      dom.classList.add('canvas-toggle-heading', 'is-open');
      dom.setAttribute('data-type', 'toggleHeading');
      dom.dataset.level = String(node.attrs.level);

      // Chevron toggle button
      const btn = document.createElement('button');
      btn.type = 'button';
      btn.classList.add('toggle-heading-chevron');
      btn.contentEditable = 'false';
      btn.addEventListener('click', (e) => {
        e.preventDefault();
        e.stopPropagation();
        const isOpen = dom.classList.toggle('is-open');
        const body = contentDOM.querySelector(
          '[data-type="detailsContent"]',
        ) as HTMLElement;
        if (body) body.hidden = !isOpen;
      });
      dom.appendChild(btn);

      // Content wrapper — ProseMirror puts toggleHeadingText + detailsContent here
      const contentDOM = document.createElement('div');
      contentDOM.classList.add('toggle-heading-wrapper');
      dom.appendChild(contentDOM);

      return {
        dom,
        contentDOM,
        update(updatedNode: any) {
          if (updatedNode.type.name !== 'toggleHeading') return false;
          dom.dataset.level = String(updatedNode.attrs.level);
          return true;
        },
      };
    };
  },

  addKeyboardShortcuts() {
    return {
      Enter: ({ editor }) => {
        const { state } = editor;
        const { selection, schema } = state;
        const { $head, empty } = selection;

        // Only handle Enter inside toggleHeadingText
        if (!empty || !schema.nodes.toggleHeadingText) return false;
        if ($head.parent.type !== schema.nodes.toggleHeadingText) return false;

        // Find the toggleHeading wrapper
        const toggleDepth = $head.depth - 1;
        const togglePos = $head.before(toggleDepth);
        const domEl = editor.view.nodeDOM(togglePos) as HTMLElement;

        if (domEl?.classList.contains('is-open')) {
          // Expanded → move cursor into body's first block
          const afterText = $head.after();
          editor.chain().setTextSelection(afterText + 2).focus().run();
          return true;
        }

        // Collapsed → create paragraph after the toggleHeading
        const afterToggle = $head.after(toggleDepth);
        editor
          .chain()
          .insertContentAt(afterToggle, { type: 'paragraph' })
          .setTextSelection(afterToggle + 1)
          .focus()
          .run();
        return true;
      },
    };
  },
});
