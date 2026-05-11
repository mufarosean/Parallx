// tableOfContentsNode.ts — Auto-generated Table of Contents
//
// A leaf block that scans the document for heading nodes (and toggle headings)
// and renders a clickable TOC list. Updates live as the document changes.

import { Node, mergeAttributes } from '@tiptap/core';

export const TableOfContents = Node.create({
  name: 'tableOfContents',
  group: 'block',
  atom: true,
  selectable: true,
  draggable: true,

  parseHTML() {
    return [{ tag: 'div[data-type="tableOfContents"]' }];
  },

  renderHTML({ HTMLAttributes }: { HTMLAttributes: Record<string, any> }) {
    return [
      'div',
      mergeAttributes(HTMLAttributes, {
        'data-type': 'tableOfContents',
        class: 'canvas-toc',
      }),
    ];
  },

  addNodeView() {
    return ({ editor }: any) => {
      const dom = document.createElement('div');
      dom.classList.add('canvas-toc');
      dom.setAttribute('data-type', 'tableOfContents');
      dom.contentEditable = 'false';

      const renderToc = () => {
        dom.innerHTML = '';

        // Title
        const title = document.createElement('div');
        title.classList.add('canvas-toc-title');
        title.textContent = 'Table of Contents';
        dom.appendChild(title);

        // Scan headings from the document
        const list = document.createElement('div');
        list.classList.add('canvas-toc-list');

        editor.state.doc.descendants((node: any, pos: number) => {
          let level = 0;
          let text = '';

          if (node.type.name === 'heading') {
            level = node.attrs.level;
            text = node.textContent;
          } else if (node.type.name === 'toggleHeading') {
            level = node.attrs.level;
            // First child is toggleHeadingText
            node.forEach((child: any) => {
              if (child.type.name === 'toggleHeadingText' && !text) {
                text = child.textContent;
              }
            });
          }

          if (level > 0 && text) {
            const item = document.createElement('div');
            item.classList.add(
              'canvas-toc-item',
              `canvas-toc-level-${level}`,
            );
            item.textContent = text;
            item.addEventListener('click', () => {
              // Move selection to the heading first so the editor records intent.
              editor.chain().setTextSelection(pos + 1).focus().run();

              // Walk up the DOM from the resolved position and open any collapsed
              // ancestors (details, toggleHeading). Their open state lives in DOM
              // classes / `hidden` attrs \u2014 not the document model \u2014 so we cannot
              // do this with a ProseMirror transaction.
              try {
                const view = editor.view;
                const domAtPos = view.domAtPos(pos + 1);
                let el: HTMLElement | null = (domAtPos?.node as HTMLElement | null) ?? null;
                while (el && el !== view.dom) {
                  if (el.matches?.('[data-type=\"details\"]') && !el.classList.contains('is-open')) {
                    el.classList.add('is-open');
                  }
                  if (el.matches?.('[data-type=\"toggleHeading\"]') && !el.classList.contains('is-open')) {
                    el.classList.add('is-open');
                    const body = el.querySelector(':scope > [data-type=\"detailsContent\"]') as HTMLElement | null;
                    if (body) body.hidden = false;
                  }
                  el = el.parentElement;
                }

                // Scroll the heading into view after layout settles.
                requestAnimationFrame(() => {
                  const target = view.domAtPos(pos + 1)?.node as HTMLElement | null;
                  const scrollEl =
                    target && (target as any).scrollIntoView
                      ? (target as HTMLElement)
                      : (target?.parentElement ?? null);
                  scrollEl?.scrollIntoView({ behavior: 'smooth', block: 'start' });
                });
              } catch {
                /* best-effort scroll; selection move already happened */
              }
            });
            list.appendChild(item);
          }

          return true;
        });

        if (list.children.length === 0) {
          const empty = document.createElement('div');
          empty.classList.add('canvas-toc-empty');
          empty.textContent =
            'Add headings to create a table of contents.';
          list.appendChild(empty);
        }

        dom.appendChild(list);
      };

      renderToc();

      // Re-render on document changes, but coalesce via rAF so we don't run a
      // full `doc.descendants` scan on every keystroke. On long docs this saved
      // ~tens of ms per keystroke when a TOC block was visible.
      let rafHandle: number | null = null;
      const onUpdate = () => {
        if (rafHandle !== null) return;
        rafHandle = requestAnimationFrame(() => {
          rafHandle = null;
          renderToc();
        });
      };
      editor.on('update', onUpdate);

      return {
        dom,
        ignoreMutation: () => true,
        destroy() {
          editor.off('update', onUpdate);
          if (rafHandle !== null) {
            cancelAnimationFrame(rafHandle);
            rafHandle = null;
          }
        },
      };
    };
  },
});
