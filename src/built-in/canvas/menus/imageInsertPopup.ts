// imageInsertPopup.ts — Image insert popup for slash menu
//
// Shows a popup with two tabs: Upload (Electron file dialog) and
// Embed link (URL input). Replaces the broken `window.prompt()` that
// Electron doesn't support.
//
// Popup uses `position: fixed` and cursor coords, same pattern as the
// slash menu and cover picker.

import type { Editor } from '@tiptap/core';
import { $ } from '../../../ui/dom.js';

// ── Public API ──────────────────────────────────────────────────────────────

/**
 * Show a popup near the cursor letting the user upload an image or
 * paste a URL.  On confirm the image node is inserted at `range`;
 * on cancel the `/image` paragraph is replaced with an empty paragraph.
 */
export function showImageInsertPopup(
  editor: Editor,
  range: { from: number; to: number },
): void {
  // Position at cursor
  const coords = editor.view.coordsAtPos(editor.state.selection.from);

  // Container = the scroll wrapper that holds the slash menu too
  const container = editor.view.dom.closest('.canvas-editor-wrapper')
    ?? editor.view.dom.parentElement!;

  // ── Build popup DOM ─────────────────────────────────────────────────────

  const popup = $('div.canvas-image-insert-popup');
  popup.style.left = `${coords.left}px`;
  popup.style.top  = `${coords.bottom + 4}px`;

  // Tabs
  const tabBar  = $('div.canvas-image-insert-tabs');
  const tabUpload = $('button.canvas-image-insert-tab');
  tabUpload.textContent = 'Upload';
  const tabLink = $('button.canvas-image-insert-tab');
  tabLink.textContent = 'Embed link';
  tabBar.appendChild(tabUpload);
  tabBar.appendChild(tabLink);
  popup.appendChild(tabBar);

  // Content area
  const content = $('div.canvas-image-insert-content');
  popup.appendChild(content);

  // ── Tab state ───────────────────────────────────────────────────────────

  const activate = (tab: 'upload' | 'link') => {
    tabUpload.classList.toggle('canvas-image-insert-tab--active', tab === 'upload');
    tabLink.classList.toggle('canvas-image-insert-tab--active', tab === 'link');
    if (tab === 'upload') renderUpload();
    else renderLink();
  };

  tabUpload.addEventListener('click', () => activate('upload'));
  tabLink.addEventListener('click', () => activate('link'));

  // ── Helpers ─────────────────────────────────────────────────────────────

  const dismiss = () => {
    popup.remove();
    document.removeEventListener('mousedown', outsideClick, true);
    document.removeEventListener('keydown', escapeKey, true);
  };

  const insertImage = (src: string) => {
    editor.chain()
      .insertContentAt(range, { type: 'image', attrs: { src } })
      .focus()
      .run();
    dismiss();
  };

  const cancel = () => {
    // Replace the `/image` paragraph with an empty paragraph
    editor.chain()
      .insertContentAt(range, { type: 'paragraph' })
      .focus()
      .run();
    dismiss();
  };

  // ── Upload tab ──────────────────────────────────────────────────────────

  const renderUpload = () => {
    content.innerHTML = '';

    const uploadBtn = $('button.canvas-image-insert-upload-btn');
    uploadBtn.textContent = 'Choose an image';
    uploadBtn.addEventListener('click', async () => {
      try {
        const electron = (window as any).parallxElectron;
        if (!electron?.dialog?.openFile) {
          console.warn('[imageInsertPopup] Electron dialog not available');
          return;
        }
        const filePaths = await electron.dialog.openFile({
          filters: [{ name: 'Images', extensions: ['png', 'jpg', 'jpeg', 'gif', 'webp', 'svg'] }],
          properties: ['openFile'],
        });
        if (filePaths?.[0]) {
          const filePath = filePaths[0];
          const result = await electron.fs.readFile(filePath);
          if (result?.content && result?.encoding === 'base64') {
            const ext = filePath.split('.').pop()?.toLowerCase() || 'png';
            const mime = ext === 'jpg' ? 'image/jpeg'
              : ext === 'svg' ? 'image/svg+xml'
              : `image/${ext}`;
            const dataUrl = `data:${mime};base64,${result.content}`;
            // Guard: ~5 MB raw (base64 is ~37% larger)
            if (result.content.length > 5 * 1024 * 1024 * 1.37) {
              renderError('Image is too large (max 5 MB).');
              return;
            }
            insertImage(dataUrl);
          }
        }
      } catch (err) {
        console.error('[imageInsertPopup] Upload failed:', err);
        renderError('Upload failed — see console.');
      }
    });
    content.appendChild(uploadBtn);

    const hint = $('div.canvas-image-insert-hint');
    hint.textContent = 'PNG, JPG, GIF, WebP, or SVG. Max 5 MB.';
    content.appendChild(hint);
  };

  // ── Link tab ────────────────────────────────────────────────────────────

  const renderLink = () => {
    content.innerHTML = '';

    const row = $('div.canvas-image-insert-link-row');
    const input = $('input.canvas-image-insert-link-input') as HTMLInputElement;
    input.type = 'url';
    input.placeholder = 'Paste image URL…';

    const embedBtn = $('button.canvas-image-insert-link-apply');
    embedBtn.textContent = 'Embed';

    const submit = () => {
      const url = input.value.trim();
      if (url) insertImage(url);
    };

    embedBtn.addEventListener('click', submit);
    input.addEventListener('keydown', (e) => {
      if (e.key === 'Enter') { e.preventDefault(); submit(); }
      if (e.key === 'Escape') { e.preventDefault(); cancel(); }
      e.stopPropagation(); // don't let ProseMirror steal keys
    });
    // Prevent ProseMirror from capturing typed characters
    input.addEventListener('keypress', (e) => e.stopPropagation());
    input.addEventListener('input', (e) => e.stopPropagation());

    row.appendChild(input);
    row.appendChild(embedBtn);
    content.appendChild(row);

    // Auto-focus
    requestAnimationFrame(() => input.focus());
  };

  // ── Error helper ────────────────────────────────────────────────────────

  const renderError = (msg: string) => {
    let errEl = content.querySelector('.canvas-image-insert-error') as HTMLElement | null;
    if (!errEl) {
      errEl = $('div.canvas-image-insert-error');
      content.appendChild(errEl);
    }
    errEl.textContent = msg;
  };

  // ── Dismiss on click outside / Escape ─────────────────────────────────

  const outsideClick = (e: MouseEvent) => {
    if (!popup.contains(e.target as Node)) cancel();
  };

  const escapeKey = (e: KeyboardEvent) => {
    if (e.key === 'Escape') {
      e.preventDefault();
      e.stopPropagation();
      cancel();
    }
  };

  // Delay listener attachment so the current click doesn't dismiss
  requestAnimationFrame(() => {
    document.addEventListener('mousedown', outsideClick, true);
    document.addEventListener('keydown', escapeKey, true);
  });

  // ── Mount ─────────────────────────────────────────────────────────────

  activate('upload');
  container.appendChild(popup);
}
