// embedNode.ts — Embed: any https page shown in the page
//
// Paste a link; the page shows in a sandboxed frame of the height you set.
// Common share links are turned into the address the site serves for
// embedding (a YouTube watch page into its player, a Google Doc into its
// preview, a Figma file into Figma's embed). Only https: the app's CSP allows
// no other frames, and a frame never gets the app's own origin.
//
// Some sites refuse to be framed; the bar under the frame always has
// "Open in Browser", so the link is never a dead end.

import { Node, mergeAttributes } from '@tiptap/core';
import {
  type LiveBlockOptions, openBlockPopover, popoverRow, textControl, blockEditButton, setBlockAttrs, focusBlock,
} from './liveBlock.js';

export const EMBED_MIN_HEIGHT = 120;
export const EMBED_MAX_HEIGHT = 1200;
export const EMBED_DEFAULT_HEIGHT = 420;

/** The frame address for a pasted link, or null when it cannot be embedded. */
export function toEmbedUrl(input: string): string | null {
  let url: URL;
  try { url = new URL(input.trim()); } catch { return null; }
  if (url.protocol !== 'https:') return null;
  const host = url.hostname.replace(/^www\./, '');
  const path = url.pathname;

  // YouTube: watch?v=, youtu.be/, shorts/
  if (host === 'youtube.com' || host === 'm.youtube.com' || host === 'youtu.be') {
    const id = host === 'youtu.be' ? path.slice(1).split('/')[0]
      : url.searchParams.get('v') ?? path.match(/^\/(?:shorts|embed|live)\/([\w-]+)/)?.[1];
    if (id && /^[\w-]{6,20}$/.test(id)) return `https://www.youtube-nocookie.com/embed/${id}`;
  }
  // Vimeo
  const vimeo = host === 'vimeo.com' ? path.match(/^\/(\d+)/)?.[1] : undefined;
  if (vimeo) return `https://player.vimeo.com/video/${vimeo}`;
  // Loom
  const loom = host === 'loom.com' ? path.match(/^\/share\/([\w-]+)/)?.[1] : undefined;
  if (loom) return `https://www.loom.com/embed/${loom}`;
  // Google Docs, Sheets, Slides: the preview view frames, the editor does not.
  if (host === 'docs.google.com' && /^\/(document|spreadsheets|presentation)\/d\/[\w-]+/.test(path)) {
    const base = path.match(/^\/(?:document|spreadsheets|presentation)\/d\/[\w-]+/)![0];
    return `https://docs.google.com${base}/preview`;
  }
  // Figma files and prototypes
  if (host === 'figma.com' && /^\/(file|design|proto|board)\//.test(path)) {
    return `https://www.figma.com/embed?embed_host=parallx&url=${encodeURIComponent(url.href)}`;
  }
  // CodePen
  const pen = host === 'codepen.io' ? path.match(/^\/([\w-]+)\/pen\/([\w-]+)/) : null;
  if (pen) return `https://codepen.io/${pen[1]}/embed/${pen[2]}?default-tab=result`;
  // Spotify
  const spotify = host === 'open.spotify.com' ? path.match(/^\/(track|album|playlist|episode|show)\/([\w]+)/) : null;
  if (spotify) return `https://open.spotify.com/embed/${spotify[1]}/${spotify[2]}`;
  // Google Maps place / directions links have an embed form only with an API
  // key; anything else is framed as it is.
  return url.href;
}

export function clampEmbedHeight(value: unknown): number {
  const n = Math.round(Number(value));
  if (!Number.isFinite(n)) return EMBED_DEFAULT_HEIGHT;
  return Math.min(EMBED_MAX_HEIGHT, Math.max(EMBED_MIN_HEIGHT, n));
}

function editEmbed(anchor: HTMLElement, src: string, height: number, onSave: (src: string, height: number) => void, returnFocus?: () => void): void {
  openBlockPopover(anchor, 'Embed', (body, close) => {
    const link = textControl(src, 'https://…');
    link.setAttribute('aria-label', 'Link');
    popoverRow(body, 'Link', link);
    const h = textControl(String(height));
    h.type = 'number';
    h.min = String(EMBED_MIN_HEIGHT);
    h.max = String(EMBED_MAX_HEIGHT);
    h.setAttribute('aria-label', 'Height in pixels');
    popoverRow(body, 'Height', h);
    const error = document.createElement('div');
    error.className = 'canvas-live-popover__hint';
    body.appendChild(error);
    const done = document.createElement('button');
    done.type = 'button';
    done.className = 'canvas-live-popover__primary';
    done.textContent = 'Done';
    const save = (): void => {
      const value = link.value.trim();
      if (value && !toEmbedUrl(value)) { error.textContent = 'Use a link that starts with https://.'; return; }
      onSave(value, clampEmbedHeight(h.value));
      close();
    };
    done.addEventListener('click', save);
    link.addEventListener('keydown', (e) => { if (e.key === 'Enter') { e.preventDefault(); save(); } });
    body.appendChild(done);
  }, returnFocus);
}

export const Embed = Node.create<LiveBlockOptions>({
  name: 'embed',
  group: 'block',
  atom: true,
  selectable: true,
  draggable: true,

  addOptions() { return { live: undefined }; },

  addAttributes() {
    return {
      src: { default: '' },
      height: { default: EMBED_DEFAULT_HEIGHT },
    };
  },

  parseHTML() { return [{ tag: 'div[data-type="embed"]' }]; },

  renderHTML({ HTMLAttributes }) {
    return ['div', mergeAttributes(HTMLAttributes, { 'data-type': 'embed', class: 'canvas-embed' })];
  },

  addNodeView() {
    return ({ node, editor, getPos }: any) => {
      let current = node;
      const dom = document.createElement('div');
      dom.className = 'canvas-embed';
      dom.setAttribute('data-type', 'embed');
      dom.contentEditable = 'false';

      const render = (): void => {
        dom.innerHTML = '';
        const src = String(current.attrs.src ?? '');
        const frameSrc = src ? toEmbedUrl(src) : null;
        if (!frameSrc) {
          // Empty (or a link that cannot be framed): ask for one.
          const empty = document.createElement('div');
          empty.className = 'canvas-embed__empty';
          const input = document.createElement('input');
          input.className = 'canvas-live-popover__input';
          input.placeholder = 'Paste a link to embed (https://…)';
          input.value = src;
          input.setAttribute('aria-label', 'Link to embed');
          const go = document.createElement('button');
          go.type = 'button';
          go.className = 'canvas-live-popover__primary';
          go.textContent = 'Embed Link';
          const hint = document.createElement('div');
          hint.className = 'canvas-embed__hint';
          hint.textContent = src ? 'That link cannot be embedded. Use one that starts with https://.' : '';
          const submit = (): void => {
            if (!editor.isEditable) return;
            const value = input.value.trim();
            if (!toEmbedUrl(value)) { hint.textContent = 'Use a link that starts with https://.'; return; }
            setBlockAttrs(editor, getPos, { src: value });
          };
          go.addEventListener('click', submit);
          input.addEventListener('keydown', (e) => { if (e.key === 'Enter') { e.preventDefault(); submit(); } });
          empty.append(input, go, hint);
          dom.appendChild(empty);
          return;
        }
        const frame = document.createElement('iframe');
        frame.className = 'canvas-embed__frame';
        frame.src = frameSrc;
        frame.height = String(clampEmbedHeight(current.attrs.height));
        frame.loading = 'lazy';
        frame.referrerPolicy = 'strict-origin-when-cross-origin';
        frame.setAttribute('sandbox', 'allow-scripts allow-same-origin allow-popups allow-forms allow-presentation');
        frame.setAttribute('allow', 'fullscreen; clipboard-write; encrypted-media; picture-in-picture');
        frame.title = `Embedded page: ${new URL(frameSrc).hostname}`;
        dom.appendChild(frame);

        const bar = document.createElement('div');
        bar.className = 'canvas-embed__bar';
        const host = document.createElement('span');
        host.className = 'canvas-embed__host';
        host.textContent = new URL(src).hostname.replace(/^www\./, '');
        const open = document.createElement('button');
        open.type = 'button';
        open.className = 'canvas-live-edit canvas-embed__open';
        open.textContent = 'Open in Browser';
        open.addEventListener('mousedown', (e) => e.preventDefault());
        open.addEventListener('click', () => window.open(src, '_blank', 'noopener,noreferrer'));
        const edit = blockEditButton('Edit…');
        edit.addEventListener('click', () => {
          if (!editor.isEditable) return;
          editEmbed(edit, src, clampEmbedHeight(current.attrs.height), (nextSrc, h) => setBlockAttrs(editor, getPos, { src: nextSrc, height: h }), () => focusBlock(editor, getPos));
        });
        bar.append(host, open, edit);
        dom.appendChild(bar);
      };
      render();

      return {
        dom,
        update(updated: any) {
          if (updated.type.name !== 'embed') return false;
          const changed = updated.attrs.src !== current.attrs.src || updated.attrs.height !== current.attrs.height;
          current = updated;
          if (changed) render();
          return true;
        },
        stopEvent: (e: Event) => {
          const t = e.target as HTMLElement | null;
          return !!t && (t.tagName === 'INPUT' || t.tagName === 'IFRAME' || !!t.closest?.('button'));
        },
        ignoreMutation: () => true,
      };
    };
  },
});
