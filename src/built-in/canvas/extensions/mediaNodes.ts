// mediaNodes.ts — Video, Audio, and File Attachment blocks
//
// Leaf blocks for embedding media content. Each renders with an HTML5 media
// element or a file card with download affordance.

import { Node, mergeAttributes } from '@tiptap/core';
import { svgIcon } from '../canvasIcons.js';

// ─── Video ──────────────────────────────────────────────────────────────────

export const Video = Node.create({
  name: 'video',
  group: 'block',
  atom: true,
  selectable: true,
  draggable: true,

  addAttributes() {
    return {
      src: { default: '' },
      title: { default: '' },
    };
  },

  parseHTML() {
    return [{ tag: 'div[data-type="video"]' }];
  },

  renderHTML({ HTMLAttributes }: { HTMLAttributes: Record<string, any> }) {
    return [
      'div',
      mergeAttributes(HTMLAttributes, {
        'data-type': 'video',
        class: 'canvas-media canvas-video',
      }),
    ];
  },

  addNodeView() {
    return ({ node }: any) => {
      const dom = document.createElement('div');
      dom.classList.add('canvas-media', 'canvas-video');
      dom.setAttribute('data-type', 'video');
      dom.contentEditable = 'false';

      const render = (attrs: any) => {
        dom.innerHTML = '';
        if (attrs.src) {
          const video = document.createElement('video');
          video.src = attrs.src;
          video.controls = true;
          video.preload = 'metadata';
          dom.appendChild(video);
        } else {
          const ph = document.createElement('div');
          ph.classList.add('canvas-media-placeholder');
          ph.innerHTML = `${svgIcon('video')}<span>Embed a video</span>`;
          const svg = ph.querySelector('svg');
          if (svg) {
            svg.setAttribute('width', '24');
            svg.setAttribute('height', '24');
          }
          dom.appendChild(ph);
        }
      };

      render(node.attrs);

      return {
        dom,
        update(updatedNode: any) {
          if (updatedNode.type.name !== 'video') return false;
          render(updatedNode.attrs);
          return true;
        },
      };
    };
  },
});

// ─── Audio ──────────────────────────────────────────────────────────────────

export const Audio = Node.create({
  name: 'audio',
  group: 'block',
  atom: true,
  selectable: true,
  draggable: true,

  addAttributes() {
    return {
      src: { default: '' },
      title: { default: '' },
    };
  },

  parseHTML() {
    return [{ tag: 'div[data-type="audio"]' }];
  },

  renderHTML({ HTMLAttributes }: { HTMLAttributes: Record<string, any> }) {
    return [
      'div',
      mergeAttributes(HTMLAttributes, {
        'data-type': 'audio',
        class: 'canvas-media canvas-audio',
      }),
    ];
  },

  addNodeView() {
    return ({ node }: any) => {
      const dom = document.createElement('div');
      dom.classList.add('canvas-media', 'canvas-audio');
      dom.setAttribute('data-type', 'audio');
      dom.contentEditable = 'false';

      const render = (attrs: any) => {
        dom.innerHTML = '';
        if (attrs.src) {
          const audio = document.createElement('audio');
          audio.src = attrs.src;
          audio.controls = true;
          dom.appendChild(audio);
        } else {
          const ph = document.createElement('div');
          ph.classList.add('canvas-media-placeholder');
          ph.innerHTML = `${svgIcon('audio')}<span>Embed audio</span>`;
          const svg = ph.querySelector('svg');
          if (svg) {
            svg.setAttribute('width', '24');
            svg.setAttribute('height', '24');
          }
          dom.appendChild(ph);
        }
      };

      render(node.attrs);

      return {
        dom,
        update(updatedNode: any) {
          if (updatedNode.type.name !== 'audio') return false;
          render(updatedNode.attrs);
          return true;
        },
      };
    };
  },
});

// ─── File Attachment ────────────────────────────────────────────────────────

export const FileAttachment = Node.create({
  name: 'fileAttachment',
  group: 'block',
  atom: true,
  selectable: true,
  draggable: true,

  addAttributes() {
    return {
      src: { default: '' },
      filename: { default: '' },
      size: { default: '' },
    };
  },

  parseHTML() {
    return [{ tag: 'div[data-type="fileAttachment"]' }];
  },

  renderHTML({ HTMLAttributes }: { HTMLAttributes: Record<string, any> }) {
    return [
      'div',
      mergeAttributes(HTMLAttributes, {
        'data-type': 'fileAttachment',
        class: 'canvas-file-attachment',
      }),
    ];
  },

  addNodeView() {
    return ({ node }: any) => {
      const dom = document.createElement('div');
      dom.classList.add('canvas-file-attachment');
      dom.setAttribute('data-type', 'fileAttachment');
      dom.contentEditable = 'false';

      const render = (attrs: any) => {
        dom.innerHTML = '';

        // File icon
        const iconEl = document.createElement('span');
        iconEl.classList.add('canvas-file-icon');
        iconEl.innerHTML = svgIcon('file-attachment');
        const svg = iconEl.querySelector('svg');
        if (svg) {
          svg.setAttribute('width', '32');
          svg.setAttribute('height', '32');
        }
        dom.appendChild(iconEl);

        // File info
        const info = document.createElement('div');
        info.classList.add('canvas-file-info');

        const name = document.createElement('div');
        name.classList.add('canvas-file-name');
        name.textContent = attrs.filename || 'Untitled file';
        info.appendChild(name);

        if (attrs.size) {
          const size = document.createElement('div');
          size.classList.add('canvas-file-size');
          size.textContent = attrs.size;
          info.appendChild(size);
        }

        dom.appendChild(info);

        // Click to open/download
        if (attrs.src) {
          dom.style.cursor = 'pointer';
          dom.onclick = () => window.open(attrs.src, '_blank');
        }
      };

      render(node.attrs);

      return {
        dom,
        update(updatedNode: any) {
          if (updatedNode.type.name !== 'fileAttachment') return false;
          render(updatedNode.attrs);
          return true;
        },
      };
    };
  },
});
