// mathBlockNode.ts — Block-level equation rendered via KaTeX in display mode
//
// Notion calls this "Block equation" — full-width, standalone math.
// Click-to-edit: shows raw LaTeX input, live KaTeX preview, Enter to confirm.

import { Node, mergeAttributes } from '@tiptap/core';
import katex from 'katex';

export const MathBlock = Node.create({
  name: 'mathBlock',
  group: 'block',
  atom: true,      // non-editable via ProseMirror — uses NodeView
  selectable: true,
  draggable: true,

  addAttributes() {
    return {
      latex: {
        default: '',
        parseHTML: (element: HTMLElement) => element.getAttribute('data-latex') || '',
        renderHTML: (attributes: Record<string, any>) => ({ 'data-latex': attributes.latex }),
      },
    };
  },

  parseHTML() {
    return [{ tag: 'div[data-type="mathBlock"]' }];
  },

  renderHTML({ HTMLAttributes }: { HTMLAttributes: Record<string, any> }) {
    return [
      'div',
      mergeAttributes(HTMLAttributes, { 'data-type': 'mathBlock', class: 'canvas-math-block' }),
      // No content hole (0) — atom nodes are leaf nodes with no PM-managed content.
      // The NodeView handles all rendering via its own DOM.
    ];
  },

  addNodeView() {
    return ({ node, getPos, editor }: any) => {
      // ── Container ──
      const dom = document.createElement('div');
      dom.classList.add('canvas-math-block');
      dom.setAttribute('data-type', 'mathBlock');
      // Explicit policy: block movement is owned by the drag handle, not by
      // implicit native dragging from block body interactions.
      dom.draggable = false;

      // ── Rendered KaTeX output (always visible) ──
      const renderArea = document.createElement('div');
      renderArea.classList.add('canvas-math-block-render');
      dom.appendChild(renderArea);

      // ── Floating editor popup (hidden by default) ──
      const editorArea = document.createElement('div');
      editorArea.classList.add('canvas-math-block-editor');
      editorArea.style.display = 'none';

      const input = document.createElement('textarea');
      input.classList.add('canvas-math-block-input');
      input.placeholder = 'Type LaTeX…';
      input.spellcheck = false;
      input.rows = 1;

      const doneBtn = document.createElement('button');
      doneBtn.classList.add('canvas-math-block-done');
      doneBtn.innerHTML = 'Done <span class="canvas-math-block-done-key">↵</span>';

      editorArea.appendChild(input);
      editorArea.appendChild(doneBtn);
      dom.appendChild(editorArea);

      let editing = false;
      let currentLatex = node.attrs.latex || '';

      const renderKatex = (latex: string, target: HTMLElement, displayMode = true) => {
        if (!latex) {
          target.innerHTML = '<span class="canvas-math-block-empty">Click to add equation</span>';
          return;
        }
        try {
          katex.render(latex, target, { displayMode, throwOnError: false });
        } catch {
          target.textContent = latex;
        }
      };

      const updateLatex = (newLatex: string) => {
        if (typeof getPos === 'function') {
          currentLatex = newLatex;
          editor.chain()
            .command(({ tr }: any) => {
              tr.setNodeAttribute(getPos(), 'latex', newLatex);
              return true;
            })
            .run();
        }
        renderKatex(newLatex, renderArea);
      };

      const commitEdit = () => {
        if (!editing) return;
        editing = false;
        const newLatex = input.value.trim();
        editorArea.style.display = 'none';
        dom.classList.remove('canvas-math-block--editing');

        if (newLatex !== currentLatex) {
          updateLatex(newLatex);
        }
      };

      const startEdit = () => {
        if (editing || !editor.isEditable) return;
        editing = true;
        input.value = currentLatex;
        dom.classList.add('canvas-math-block--editing');
        editorArea.style.display = 'flex';
        autoResize();
        setTimeout(() => { input.focus(); input.select(); }, 0);
      };

      const autoResize = () => {
        input.style.height = 'auto';
        input.style.height = input.scrollHeight + 'px';
      };

      // ── Events ──
      dom.addEventListener('dragstart', (e) => {
        e.preventDefault();
        e.stopPropagation();
      });

      dom.addEventListener('click', (e) => {
        if (editorArea.contains(e.target as HTMLElement)) return;
        e.stopPropagation();
        if (!editing) startEdit();
      });

      input.addEventListener('input', () => {
        // Live-update the rendered equation above
        renderKatex(input.value || '', renderArea);
        autoResize();
      });

      doneBtn.addEventListener('mousedown', (e) => {
        e.preventDefault();
        commitEdit();
        // Move cursor after the math block
        if (typeof getPos === 'function') {
          const pos = getPos() + 1;
          editor.chain().setTextSelection(pos).focus().run();
        }
      });

      input.addEventListener('keydown', (e) => {
        if (e.key === 'Enter') {
          e.preventDefault();
          commitEdit();
          if (typeof getPos === 'function') {
            const pos = getPos() + 1;
            editor.chain().setTextSelection(pos).focus().run();
          }
        } else if (e.key === 'Escape') {
          e.preventDefault();
          input.value = currentLatex;
          renderKatex(currentLatex, renderArea);
          editing = false;
          editorArea.style.display = 'none';
          dom.classList.remove('canvas-math-block--editing');
        }
        e.stopPropagation();
      });

      input.addEventListener('blur', () => {
        setTimeout(() => {
          if (!editorArea.contains(document.activeElement)) {
            commitEdit();
          }
        }, 100);
      });

      // Initial render
      renderKatex(currentLatex, renderArea);

      // If empty, start in edit mode
      if (!currentLatex) {
        setTimeout(() => startEdit(), 50);
      }

      return {
        dom,
        update(updatedNode: any) {
          if (updatedNode.type.name !== 'mathBlock') return false;
          currentLatex = updatedNode.attrs.latex || '';
          if (!editing) {
            renderKatex(currentLatex, renderArea);
          }
          return true;
        },
        stopEvent(_event: Event) {
          // Let all events inside the math block be handled by our NodeView
          if (editing) return true;
          return false;
        },
        ignoreMutation() {
          return true;
        },
      };
    };
  },
});
