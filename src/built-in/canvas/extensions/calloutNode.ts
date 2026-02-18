// calloutNode.ts — Notion-style Callout block node
//
// A colored info box with an SVG icon and rich content.
// Rendered as <div data-type="callout"> with a non-editable icon and editable content area.

import { Node, mergeAttributes } from '@tiptap/core';
import { PAGE_ICON_IDS, resolvePageIcon, svgIcon } from '../canvasIcons.js';

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
    return ({ node, getPos, editor }: any) => {
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
      iconSpan.title = 'Change icon';

      const renderIcon = (emoji: string) => {
        const iconId = resolvePageIcon(emoji);
        iconSpan.innerHTML = svgIcon(iconId);
        const svg = iconSpan.querySelector('svg');
        if (svg) { svg.setAttribute('width', '20'); svg.setAttribute('height', '20'); }
      };

      let iconPicker: HTMLElement | null = null;

      const closeIconPicker = () => {
        if (!iconPicker) return;
        iconPicker.remove();
        iconPicker = null;
        document.removeEventListener('mousedown', handleOutsideClick, true);
        document.removeEventListener('keydown', handleEscape, true);
      };

      const setEmoji = (emoji: string) => {
        if (typeof getPos !== 'function') return;
        const pos = getPos();
        const tr = editor.state.tr;
        tr.setNodeAttribute(pos, 'emoji', emoji);
        editor.view.dispatch(tr);
      };

      const renderPickerIcons = (contentArea: HTMLElement, filter?: string) => {
        contentArea.innerHTML = '';
        const grid = document.createElement('div');
        grid.classList.add('canvas-icon-grid');
        const ids = filter
          ? PAGE_ICON_IDS.filter(id => id.includes(filter.toLowerCase()))
          : PAGE_ICON_IDS;

        for (const id of ids) {
          const btn = document.createElement('button');
          btn.type = 'button';
          btn.classList.add('canvas-icon-btn');
          btn.title = id;
          btn.innerHTML = svgIcon(id);
          const svg = btn.querySelector('svg');
          if (svg) {
            svg.setAttribute('width', '22');
            svg.setAttribute('height', '22');
          }
          btn.addEventListener('click', (event) => {
            event.preventDefault();
            event.stopPropagation();
            setEmoji(id);
            closeIconPicker();
          });
          grid.appendChild(btn);
        }

        if (ids.length === 0) {
          const empty = document.createElement('div');
          empty.classList.add('canvas-icon-empty');
          empty.textContent = 'No matching icons';
          grid.appendChild(empty);
        }

        contentArea.appendChild(grid);
      };

      const openIconPicker = () => {
        if (!editor.isEditable) return;
        if (iconPicker) {
          closeIconPicker();
          return;
        }

        iconPicker = document.createElement('div');
        iconPicker.classList.add('canvas-icon-picker');

        const searchInput = document.createElement('input');
        searchInput.type = 'text';
        searchInput.placeholder = 'Search icons…';
        searchInput.classList.add('canvas-icon-search');
        iconPicker.appendChild(searchInput);

        const contentArea = document.createElement('div');
        contentArea.classList.add('canvas-icon-content');
        renderPickerIcons(contentArea);
        iconPicker.appendChild(contentArea);

        document.body.appendChild(iconPicker);

        const rect = iconSpan.getBoundingClientRect();
        let left = rect.left;
        let top = rect.bottom + 4;
        const pickerRect = iconPicker.getBoundingClientRect();
        left = Math.min(left, window.innerWidth - pickerRect.width - 8);
        top = Math.min(top, window.innerHeight - pickerRect.height - 8);
        iconPicker.style.left = `${Math.max(8, left)}px`;
        iconPicker.style.top = `${Math.max(8, top)}px`;

        searchInput.addEventListener('input', () => {
          const q = searchInput.value.trim();
          renderPickerIcons(contentArea, q || undefined);
        });

        setTimeout(() => searchInput.focus(), 0);
        setTimeout(() => {
          document.addEventListener('mousedown', handleOutsideClick, true);
        }, 0);
        document.addEventListener('keydown', handleEscape, true);
      };

      const handleOutsideClick = (event: MouseEvent) => {
        if (!iconPicker) return;
        const target = event.target as HTMLElement | null;
        if (!target) return;
        if (iconPicker.contains(target) || iconSpan.contains(target)) return;
        closeIconPicker();
      };

      const handleEscape = (event: KeyboardEvent) => {
        if (event.key !== 'Escape') return;
        closeIconPicker();
      };

      renderIcon(node.attrs.emoji);
      dom.appendChild(iconSpan);

      iconSpan.addEventListener('mousedown', (event) => {
        event.preventDefault();
      });
      iconSpan.addEventListener('click', (event) => {
        event.preventDefault();
        event.stopPropagation();
        openIconPicker();
      });

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
        destroy() {
          closeIconPicker();
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
