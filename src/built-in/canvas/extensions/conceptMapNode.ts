// conceptMapNode.ts — the concept map as a canvas block.
//
// The chat pattern, kept and made savable: the model writes an indented
// OUTLINE, the shared renderer (ui/conceptMap) draws it, and editing
// means editing the outline text — never dragging boxes. The outline is
// the source of truth; layout is deterministic and always correct.
//
// Attrs: { src: string (the outline), dir: 'right' | 'down' }.

import { Node, mergeAttributes } from '@tiptap/core';
import katex from 'katex';
import { renderMindMapSvg, type MindMapDirection } from '../../../ui/conceptMap.js';

const renderMath = (tex: string): string =>
  katex.renderToString(tex, { throwOnError: false });

export const DEFAULT_CONCEPT_MAP_SRC = [
  'Central idea',
  '  First branch',
  '    A detail',
  '  Second branch',
].join('\n');

export const ConceptMap = Node.create({
  name: 'conceptMap',
  group: 'block',
  atom: true,
  selectable: true,
  draggable: true,

  addAttributes() {
    return {
      src: { default: DEFAULT_CONCEPT_MAP_SRC },
      dir: { default: 'right' },
    };
  },

  parseHTML() {
    return [{ tag: 'div[data-type="concept-map"]' }];
  },

  renderHTML({ HTMLAttributes }: { HTMLAttributes: Record<string, unknown> }) {
    return [
      'div',
      mergeAttributes(HTMLAttributes, {
        'data-type': 'concept-map',
        class: 'canvas-conceptmap',
      }),
    ];
  },

  addNodeView() {
    // Loosely typed like the other custom node views (bookmarkNode) — the
    // tiptap prop types fight hand-rolled narrowing.
    return ({ node, editor, getPos }: any) => {
      const dom = document.createElement('div');
      dom.classList.add('canvas-conceptmap');
      dom.setAttribute('data-type', 'concept-map');
      dom.contentEditable = 'false';
      dom.draggable = false;

      let attrs = { src: String(node.attrs.src ?? ''), dir: (node.attrs.dir === 'down' ? 'down' : 'right') as MindMapDirection };
      let editing = false;

      const commit = (patch: Partial<{ src: string; dir: MindMapDirection }>): void => {
        const pos = getPos();
        if (typeof pos !== 'number') return;
        const next = { ...attrs, ...patch };
        editor.view.dispatch(editor.view.state.tr.setNodeMarkup(pos, undefined, next));
      };

      const render = (): void => {
        dom.classList.toggle('is-editing', editing);
        dom.innerHTML = '';

        const tools = document.createElement('div');
        tools.classList.add('canvas-conceptmap__tools');
        tools.setAttribute('data-nc-no-drag', '1');

        const dirBtn = document.createElement('button');
        dirBtn.classList.add('canvas-conceptmap__tool');
        dirBtn.type = 'button';
        dirBtn.textContent = attrs.dir === 'right' ? 'Vertical' : 'Horizontal';
        dirBtn.addEventListener('click', (e) => {
          e.stopPropagation();
          commit({ dir: attrs.dir === 'right' ? 'down' : 'right' });
        });
        tools.appendChild(dirBtn);

        const editBtn = document.createElement('button');
        editBtn.classList.add('canvas-conceptmap__tool');
        editBtn.type = 'button';
        editBtn.textContent = editing ? 'Done' : 'Edit Outline';
        tools.appendChild(editBtn);
        dom.appendChild(tools);

        if (editing) {
          const ta = document.createElement('textarea');
          ta.classList.add('canvas-conceptmap__editor');
          ta.value = attrs.src;
          ta.addEventListener('keydown', (e) => e.stopPropagation());
          dom.appendChild(ta);
          const hint = document.createElement('div');
          hint.classList.add('canvas-conceptmap__hint');
          hint.textContent = 'One idea per line; indent to nest. **bold**, *italic*, `code`, and $x^2$ all render.';
          dom.appendChild(hint);
          editBtn.addEventListener('click', (e) => {
            e.stopPropagation();
            editing = false;
            if (ta.value !== attrs.src) commit({ src: ta.value });
            else render();
          });
          ta.focus();
        } else {
          const startEdit = (e: Event): void => {
            e.stopPropagation();
            editing = true;
            render();
          };
          editBtn.addEventListener('click', startEdit);
          const body = document.createElement('div');
          body.innerHTML = renderMindMapSvg(attrs.src, { dir: attrs.dir, renderMath });
          // Clicking any node opens the outline right at the source of
          // truth — the map invites touch, so touching it must do something.
          body.addEventListener('click', (e) => {
            if ((e.target as HTMLElement | null)?.closest?.('.parallx-mindmap__node')) startEdit(e);
          });
          dom.appendChild(body);
        }
      };

      render();

      return {
        dom,
        update: (updated: { type: { name: string }; attrs: Record<string, unknown> }) => {
          if (updated.type.name !== 'conceptMap') return false;
          attrs = { src: String(updated.attrs.src ?? ''), dir: (updated.attrs.dir === 'down' ? 'down' : 'right') as MindMapDirection };
          render();
          return true;
        },
        // Without these, the block is DEAD to the pointer: ProseMirror
        // turns a mousedown on the tools into a node SELECTION, and every
        // innerHTML rewrite triggers a reconciliation that clobbers the
        // NodeView's DOM (the mathBlock precedent returns both).
        stopEvent: (event: Event) => {
          if (editing) return true;
          const t = event.target as HTMLElement | null;
          return !!t?.closest?.('.canvas-conceptmap__tool, .canvas-conceptmap__editor, .parallx-mindmap__node');
        },
        ignoreMutation: () => true,
      };
    };
  },
});
