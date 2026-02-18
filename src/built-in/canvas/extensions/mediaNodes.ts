// mediaNodes.ts — Video, Audio, and File Attachment blocks
//
// Leaf blocks for embedding media content. Each renders with an HTML5 media
// element or a file card with download affordance.

import { Node, mergeAttributes } from '@tiptap/core';
import { svgIcon } from '../canvasIcons.js';

function toUrl(input: string): URL | null {
  try {
    const url = new URL(input);
    if (url.protocol !== 'http:' && url.protocol !== 'https:') {
      return null;
    }
    return url;
  } catch {
    return null;
  }
}

function isDirectVideoFile(url: URL): boolean {
  const pathname = url.pathname.toLowerCase();
  return ['.mp4', '.webm', '.ogg', '.ogv', '.mov', '.m4v'].some(ext => pathname.endsWith(ext));
}

function resolveVideoEmbedSource(rawSrc: string): { mode: 'file' | 'iframe'; src: string } | null {
  const url = toUrl(rawSrc);
  if (!url) return null;

  const host = url.hostname.toLowerCase();
  const path = url.pathname;

  if (isDirectVideoFile(url)) {
    return { mode: 'file', src: url.toString() };
  }

  const ytMatch = (() => {
    if (host === 'youtu.be') {
      const id = path.split('/').filter(Boolean)[0];
      return id || null;
    }
    if (host.includes('youtube.com')) {
      if (path.startsWith('/watch')) {
        return url.searchParams.get('v');
      }
      if (path.startsWith('/shorts/') || path.startsWith('/embed/')) {
        const seg = path.split('/').filter(Boolean)[1];
        return seg || null;
      }
    }
    return null;
  })();
  if (ytMatch) {
    return { mode: 'iframe', src: `https://www.youtube-nocookie.com/embed/${ytMatch}` };
  }

  const vimeoMatch = (() => {
    if (host === 'vimeo.com') {
      const id = path.split('/').filter(Boolean)[0];
      return id || null;
    }
    if (host === 'player.vimeo.com' && path.startsWith('/video/')) {
      const id = path.split('/').filter(Boolean)[1];
      return id || null;
    }
    return null;
  })();
  if (vimeoMatch) {
    return { mode: 'iframe', src: `https://player.vimeo.com/video/${vimeoMatch}` };
  }

  const dailymotionMatch = (() => {
    if (host === 'dai.ly') {
      const id = path.split('/').filter(Boolean)[0];
      return id || null;
    }
    if (host.includes('dailymotion.com')) {
      const idx = path.split('/').findIndex(seg => seg === 'video');
      if (idx >= 0) {
        const id = path.split('/').filter(Boolean)[idx + 1];
        return id || null;
      }
    }
    return null;
  })();
  if (dailymotionMatch) {
    return { mode: 'iframe', src: `https://www.dailymotion.com/embed/video/${dailymotionMatch}` };
  }

  const loomMatch = (() => {
    if (host.includes('loom.com') && path.startsWith('/share/')) {
      const id = path.split('/').filter(Boolean)[1];
      return id || null;
    }
    if (host.includes('loom.com') && path.startsWith('/embed/')) {
      return path.split('/').filter(Boolean)[1] || null;
    }
    return null;
  })();
  if (loomMatch) {
    return { mode: 'iframe', src: `https://www.loom.com/embed/${loomMatch}` };
  }

  const wistiaMatch = (() => {
    if (host.includes('wistia.com') && path.startsWith('/medias/')) {
      const id = path.split('/').filter(Boolean)[1];
      return id || null;
    }
    if (host.includes('fast.wistia.com') && path.includes('/embed/iframe/')) {
      const id = path.split('/').filter(Boolean).pop();
      return id || null;
    }
    return null;
  })();
  if (wistiaMatch) {
    return { mode: 'iframe', src: `https://fast.wistia.net/embed/iframe/${wistiaMatch}` };
  }

  return { mode: 'iframe', src: url.toString() };
}

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
      dom.draggable = false;

      const render = (attrs: any) => {
        dom.innerHTML = '';
        if (attrs.src) {
          const resolved = resolveVideoEmbedSource(attrs.src);
          if (resolved?.mode === 'file') {
            const video = document.createElement('video');
            video.src = resolved.src;
            video.controls = true;
            video.preload = 'metadata';
            dom.appendChild(video);
          } else if (resolved?.mode === 'iframe') {
            const frameWrap = document.createElement('div');
            frameWrap.classList.add('canvas-video-embed');

            const iframe = document.createElement('iframe');
            iframe.classList.add('canvas-video-embed-frame');
            iframe.src = resolved.src;
            iframe.setAttribute('allowfullscreen', 'true');
            iframe.setAttribute('loading', 'lazy');
            iframe.setAttribute('referrerpolicy', 'strict-origin-when-cross-origin');
            iframe.setAttribute('allow', 'accelerometer; autoplay; clipboard-write; encrypted-media; gyroscope; picture-in-picture; web-share');

            frameWrap.appendChild(iframe);
            dom.appendChild(frameWrap);
          }
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

      dom.addEventListener('dragstart', (event) => {
        event.preventDefault();
        event.stopPropagation();
      });

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
      dom.draggable = false;

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

      dom.addEventListener('dragstart', (event) => {
        event.preventDefault();
        event.stopPropagation();
      });

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
      dom.draggable = false;

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

      dom.addEventListener('dragstart', (event) => {
        event.preventDefault();
        event.stopPropagation();
      });

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
