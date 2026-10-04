// toggleHeadingNode.ts — Toggle Heading block (collapsible heading)
//
// A heading (H1/H2/H3) with a toggle chevron that collapses/expands a body.
// Reuses DetailsContent from @tiptap/extension-details for the collapsible body.

import { Node, mergeAttributes } from '@tiptap/core';
import { Fragment } from '@tiptap/pm/model';
import { Plugin, PluginKey, TextSelection } from '@tiptap/pm/state';

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
      // Saved with the page; a toggle heading opens or closes where it was
      // left.  Pages from before this attribute load open.
      open: {
        default: true,
        parseHTML: (element: HTMLElement) => element.getAttribute('data-open') !== 'false',
        renderHTML: (attributes: Record<string, any>) => ({
          'data-open': attributes.open === false ? 'false' : 'true',
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
    return ({ node, getPos, editor }: any) => {
      let current = node;
      const dom = document.createElement('div');
      dom.classList.add('canvas-toggle-heading');
      dom.setAttribute('data-type', 'toggleHeading');

      // Chevron toggle button
      const btn = document.createElement('button');
      btn.type = 'button';
      btn.classList.add('toggle-heading-chevron');
      btn.contentEditable = 'false';
      btn.addEventListener('mousedown', (e) => e.preventDefault());
      btn.addEventListener('click', (e) => {
        e.preventDefault();
        e.stopPropagation();
        const pos = typeof getPos === 'function' ? getPos() : undefined;
        if (typeof pos !== 'number' || !editor.isEditable) {
          // Read-only page: open and close for viewing, without saving.
          render(!dom.classList.contains('is-open'));
          return;
        }
        const tr = editor.state.tr.setNodeMarkup(pos, undefined, { ...current.attrs, open: current.attrs.open === false });
        tr.setMeta('addToHistory', false);
        editor.view.dispatch(tr);
      });
      dom.appendChild(btn);

      // Content wrapper — ProseMirror puts toggleHeadingText + detailsContent here
      const contentDOM = document.createElement('div');
      contentDOM.classList.add('toggle-heading-wrapper');
      dom.appendChild(contentDOM);

      // The body's view (DetailsContent's) starts hidden and only listens to
      // a <details> parent; the open state here decides it.
      const render = (open: boolean) => {
        dom.classList.toggle('is-open', open);
        btn.setAttribute('aria-expanded', String(open));
        btn.setAttribute('aria-label', open ? 'Collapse' : 'Expand');
        const body = contentDOM.querySelector(':scope > [data-type="detailsContent"]') as HTMLElement | null;
        if (body) body.hidden = !open;
      };
      const sync = () => {
        dom.dataset.level = String(current.attrs.level);
        render(current.attrs.open !== false);
      };
      sync();
      // The body is rendered into contentDOM after this view is built.
      queueMicrotask(sync);

      return {
        dom,
        contentDOM,
        update(updatedNode: any) {
          if (updatedNode.type.name !== 'toggleHeading') return false;
          current = updatedNode;
          sync();
          return true;
        },
        ignoreMutation(mutation: any) {
          // Our own class and hidden toggles are not content changes.
          return mutation.type === 'attributes' && (mutation.target === dom || mutation.target === btn
            || (mutation.target as HTMLElement).parentElement === contentDOM && mutation.attributeName === 'hidden');
        },
      };
    };
  },

  addProseMirrorPlugins() {
    // The caret never rests inside a closed body: forward moves go past the
    // toggle heading, backward moves to the end of its title.
    return [
      new Plugin({
        key: new PluginKey('toggleHeadingClosedBody'),
        appendTransaction: (transactions, oldState, newState) => {
          if (!transactions.some((tr) => tr.selectionSet || tr.docChanged)) return null;
          const sel = newState.selection;
          if (!(sel instanceof TextSelection) || !sel.empty) return null;
          const $from = sel.$from;
          for (let d = $from.depth; d > 0; d--) {
            const n = $from.node(d);
            if (n.type.name !== 'toggleHeading' || n.attrs.open !== false) continue;
            if ($from.index(d) === 0) return null; // in the title
            const togglePos = $from.before(d);
            const forward = oldState.selection.from <= sel.from;
            const tr = newState.tr;
            if (forward) {
              const after = togglePos + n.nodeSize;
              if (after >= tr.doc.content.size || !tr.doc.resolve(after).nodeAfter?.isTextblock) {
                tr.insert(after, newState.schema.nodes.paragraph.create());
              }
              tr.setSelection(TextSelection.create(tr.doc, after + 1));
            } else {
              tr.setSelection(TextSelection.create(tr.doc, togglePos + 1 + n.child(0).nodeSize - 1));
            }
            return tr;
          }
          return null;
        },
      }),
    ];
  },

  addKeyboardShortcuts() {
    return {
      // Backspace at the start of the title turns the toggle heading into a
      // plain heading, its body blocks following it (Notion).  Without this,
      // ProseMirror could not join the title backward and node-selected the
      // block above instead; the next Backspace deleted that block.
      Backspace: ({ editor }) => {
        const { state } = editor;
        const { selection, schema } = state;
        const { $head, empty } = selection;
        if (!empty || $head.parent.type.name !== 'toggleHeadingText' || $head.parentOffset !== 0) return false;
        const toggleDepth = $head.depth - 1;
        const toggle = $head.node(toggleDepth);
        if (toggle.type.name !== 'toggleHeading' || !schema.nodes.heading) return false;
        const togglePos = $head.before(toggleDepth);
        const title = toggle.child(0);
        const body = toggle.childCount > 1 ? toggle.child(1) : null;
        const heading = schema.nodes.heading.create({ level: toggle.attrs.level ?? 1 }, title.content);
        const blocks: any[] = [heading];
        body?.forEach((child: any) => {
          // An empty body paragraph is the toggle's placeholder, not content.
          if (body.childCount === 1 && child.type.name === 'paragraph' && child.content.size === 0) return;
          blocks.push(child);
        });
        const tr = state.tr.replaceWith(togglePos, togglePos + toggle.nodeSize, Fragment.from(blocks));
        tr.setSelection(TextSelection.create(tr.doc, togglePos + 1));
        editor.view.dispatch(tr.scrollIntoView());
        return true;
      },

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
        const toggleNode = state.doc.nodeAt(togglePos);

        if (toggleNode?.attrs.open !== false) {
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
