// mediaGalleryNode.ts — Media Gallery: an album (or your newest media) in a page
//
// A grid of thumbnails from Media Organizer: one album in its own order, or
// the newest photos and videos. Click one to view it full size (the library's
// own viewer, arrows step through the rest). Edit… picks the album and how
// many to show.
//
// Reads Media Organizer through its media-organizer.embed.* commands, so the
// page works without it (it says so) and never touches its tables.

import { Node, mergeAttributes } from '@tiptap/core';
import {
  type LiveBlockOptions, openBlockPopover, popoverRow, selectControl, blockEditButton, setBlockAttrs,
  focusBlock, askTool, retrySoon,
} from './liveBlock.js';

export interface GalleryItem { readonly type: 'photo' | 'video'; readonly id: number; readonly title: string; readonly thumbUrl: string | null }
export interface GalleryAlbum { readonly id: string; readonly title: string }

export const GALLERY_SIZES = [6, 12, 24, 48] as const;
export const GALLERY_DEFAULT = 12;

export function clampGalleryLimit(value: unknown): number {
  const n = Math.round(Number(value));
  if (!Number.isFinite(n) || n < 1) return GALLERY_DEFAULT;
  return Math.min(60, n);
}

/** What the bar says the gallery shows. */
export function galleryLabel(albumId: string, albums: readonly GalleryAlbum[] | null): string {
  if (!albumId) return 'Newest photos and videos';
  return albums?.find((a) => a.id === albumId)?.title ?? 'Album';
}

export const MediaGallery = Node.create<LiveBlockOptions>({
  name: 'mediaGallery',
  group: 'block',
  atom: true,
  selectable: true,
  draggable: true,

  addOptions() { return { live: undefined }; },

  addAttributes() {
    return {
      albumId: { default: '' },
      limit: { default: GALLERY_DEFAULT },
    };
  },

  parseHTML() { return [{ tag: 'div[data-type="mediaGallery"]' }]; },

  renderHTML({ HTMLAttributes }) {
    return ['div', mergeAttributes(HTMLAttributes, { 'data-type': 'mediaGallery', class: 'canvas-gallery' })];
  },

  addNodeView() {
    const live = this.options.live;
    return ({ node, editor, getPos }: any) => {
      let current = node;
      const dom = document.createElement('div');
      dom.className = 'canvas-gallery';
      dom.setAttribute('data-type', 'mediaGallery');
      dom.contentEditable = 'false';
      const bar = document.createElement('div');
      bar.className = 'canvas-gallery__bar';
      const title = document.createElement('span');
      title.className = 'canvas-gallery__title';
      const open = blockEditButton('Open in Media');
      open.addEventListener('click', () => void askTool(live, 'media-organizer.embed.openAlbum', String(current.attrs.albumId ?? '')));
      const edit = blockEditButton('Edit…');
      bar.append(title, open, edit);
      const grid = document.createElement('div');
      grid.className = 'canvas-gallery__grid';
      dom.append(bar, grid);

      let seq = 0;
      let destroyed = false;
      let stopRetry = (): void => {};
      let albums: GalleryAlbum[] | null = null;

      const note = (text: string): void => {
        grid.innerHTML = '';
        const n = document.createElement('div');
        n.className = 'canvas-gallery__note';
        n.textContent = text;
        grid.appendChild(n);
      };

      const render = async (attempt = 0): Promise<void> => {
        const mine = ++seq;
        stopRetry();
        const albumId = String(current.attrs.albumId ?? '');
        const [list, items] = await Promise.all([
          askTool<GalleryAlbum[]>(live, 'media-organizer.embed.listAlbums'),
          askTool<GalleryItem[]>(live, 'media-organizer.embed.listItems', { albumId: albumId || null, limit: clampGalleryLimit(current.attrs.limit) }),
        ]);
        if (destroyed || mine !== seq) return;
        if (!items.ok || !Array.isArray(items.value)) {
          title.textContent = 'Media gallery';
          note('Media Organizer is not available.');
          stopRetry = retrySoon(() => void render(attempt + 1), attempt);
          return;
        }
        albums = list.ok && Array.isArray(list.value) ? list.value : null;
        const missing = !!albumId && !!albums && !albums.some((a) => a.id === albumId);
        title.textContent = missing ? 'Album not found' : galleryLabel(albumId, albums);
        if (missing) { note('This album was deleted: pick another with Edit.'); return; }
        if (!items.value.length) { note(albumId ? 'This album is empty.' : 'No photos or videos yet.'); return; }
        grid.innerHTML = '';
        const all = items.value;
        all.forEach((it, index) => {
          const tile = document.createElement('button');
          tile.type = 'button';
          tile.className = `canvas-gallery__tile canvas-gallery__tile--${it.type}`;
          tile.setAttribute('aria-label', `${it.type === 'video' ? 'Video' : 'Photo'}: ${it.title || 'Untitled'}`);
          tile.title = it.title || '';
          if (it.thumbUrl) {
            const img = document.createElement('img');
            img.className = 'canvas-gallery__img';
            img.alt = '';
            img.loading = 'lazy';
            img.draggable = false;
            img.src = it.thumbUrl;
            tile.appendChild(img);
          } else {
            const ph = document.createElement('span');
            ph.className = 'canvas-gallery__placeholder';
            ph.textContent = it.title || (it.type === 'video' ? 'Video' : 'Photo');
            tile.appendChild(ph);
          }
          if (it.type === 'video') {
            const badge = document.createElement('span');
            badge.className = 'canvas-gallery__badge';
            badge.textContent = 'Video';
            tile.appendChild(badge);
          }
          tile.addEventListener('click', () => void askTool(live, 'media-organizer.embed.open', { items: all.map((x) => ({ type: x.type, id: x.id })), index }));
          grid.appendChild(tile);
        });
      };
      void render();
      // Media Organizer has no change signal for others: look again when the
      // window comes back (after adding photos there, say).
      const onFocus = (): void => void render();
      window.addEventListener('focus', onFocus);

      edit.addEventListener('click', () => {
        if (!editor.isEditable) return;
        void askTool<GalleryAlbum[]>(live, 'media-organizer.embed.listAlbums').then((res) => {
          const list = res.ok && Array.isArray(res.value) ? res.value : [];
          openBlockPopover(edit, 'Media gallery', (pop, close) => {
            const album = selectControl(
              [{ value: '', label: 'Newest photos and videos' }, ...list.map((a) => ({ value: a.id, label: a.title }))],
              String(current.attrs.albumId ?? ''),
            );
            album.setAttribute('aria-label', 'Album');
            popoverRow(pop, 'Show', album);
            const size = selectControl(GALLERY_SIZES.map((n) => ({ value: String(n), label: `Up to ${n}` })), String(clampGalleryLimit(current.attrs.limit)));
            size.setAttribute('aria-label', 'How many');
            popoverRow(pop, 'How many', size);
            const done = document.createElement('button');
            done.type = 'button';
            done.className = 'canvas-live-popover__primary';
            done.textContent = 'Done';
            done.addEventListener('click', () => { setBlockAttrs(editor, getPos, { albumId: album.value, limit: Number(size.value) }); close(); });
            pop.appendChild(done);
          }, () => focusBlock(editor, getPos));
        });
      });

      return {
        dom,
        update(updated: any) {
          if (updated.type.name !== 'mediaGallery') return false;
          const changed = updated.attrs.albumId !== current.attrs.albumId || updated.attrs.limit !== current.attrs.limit;
          current = updated;
          if (changed) void render();
          return true;
        },
        stopEvent: (e: Event) => !!(e.target as HTMLElement | null)?.closest?.('button'),
        ignoreMutation: () => true,
        destroy() { destroyed = true; stopRetry(); window.removeEventListener('focus', onFocus); },
      };
    };
  },
});
