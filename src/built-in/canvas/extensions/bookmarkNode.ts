// bookmarkNode.ts — URL Bookmark preview card
//
// A leaf block that displays a URL as a preview card with title, description,
// favicon, and optional image — like Notion's bookmark block.

import { Node, mergeAttributes } from '@tiptap/core';
import { svgIcon } from '../canvasIcons.js';

export const Bookmark = Node.create({
  name: 'bookmark',
  group: 'block',
  atom: true,
  selectable: true,
  draggable: true,

  addAttributes() {
    return {
      url: { default: '' },
      title: { default: '' },
      description: { default: '' },
      favicon: { default: '' },
      image: { default: '' },
    };
  },

  parseHTML() {
    return [{ tag: 'div[data-type="bookmark"]' }];
  },

  renderHTML({ HTMLAttributes }: { HTMLAttributes: Record<string, any> }) {
    return [
      'div',
      mergeAttributes(HTMLAttributes, {
        'data-type': 'bookmark',
        class: 'canvas-bookmark',
      }),
    ];
  },

  addNodeView() {
    return ({ node }: any) => {
      const dom = document.createElement('div');
      dom.classList.add('canvas-bookmark');
      dom.setAttribute('data-type', 'bookmark');
      dom.contentEditable = 'false';

      const render = (attrs: any) => {
        dom.innerHTML = '';

        // Info section
        const info = document.createElement('div');
        info.classList.add('canvas-bookmark-info');

        const title = document.createElement('div');
        title.classList.add('canvas-bookmark-title');
        title.textContent = attrs.title || attrs.url || 'Untitled';
        info.appendChild(title);

        if (attrs.description) {
          const desc = document.createElement('div');
          desc.classList.add('canvas-bookmark-description');
          desc.textContent = attrs.description;
          info.appendChild(desc);
        }

        const urlRow = document.createElement('div');
        urlRow.classList.add('canvas-bookmark-url');

        if (attrs.favicon) {
          const fav = document.createElement('img');
          fav.classList.add('canvas-bookmark-favicon');
          fav.src = attrs.favicon;
          fav.alt = '';
          urlRow.appendChild(fav);
        } else {
          const globeEl = document.createElement('span');
          globeEl.innerHTML = svgIcon('globe');
          const svg = globeEl.querySelector('svg');
          if (svg) {
            svg.setAttribute('width', '14');
            svg.setAttribute('height', '14');
          }
          urlRow.appendChild(globeEl);
        }

        const urlText = document.createElement('span');
        urlText.textContent = attrs.url;
        urlRow.appendChild(urlText);
        info.appendChild(urlRow);

        dom.appendChild(info);

        // Image section (optional)
        if (attrs.image) {
          const img = document.createElement('img');
          img.classList.add('canvas-bookmark-image');
          img.src = attrs.image;
          img.alt = '';
          dom.appendChild(img);
        }

        // Click to open URL
        dom.onclick = () => {
          if (attrs.url) window.open(attrs.url, '_blank');
        };
      };

      render(node.attrs);

      return {
        dom,
        update(updatedNode: any) {
          if (updatedNode.type.name !== 'bookmark') return false;
          render(updatedNode.attrs);
          return true;
        },
      };
    };
  },
});
