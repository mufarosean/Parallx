// imageInsertPopup.ts — Image insert popup for slash menu
//
// Shows a popup with two tabs: Upload (Electron file dialog) and
// Embed link (URL input). Replaces the broken `window.prompt()` that
// Electron doesn't support.
//
// Popup uses `position: fixed` and cursor coords, same pattern as the
// slash menu and cover picker.

import type { Editor } from '@tiptap/core';
import { $, layoutPopup, attachPopupDismiss } from '../../../ui/dom.js';
import { isolateInputFromEditor } from './inputIsolation.js';
import { looksLikeLocalPath, readLocalImageAsDataUrl } from './imagePathResolver.js';
import { trackInsertTarget } from './insertTarget.js';

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

  // ── Build popup DOM ─────────────────────────────────────────────────────

  const popup = $('div.canvas-image-insert-popup');

  // Tabs
  const tabBar  = $('div.canvas-image-insert-tabs');
  const tabUpload = $('button.canvas-image-insert-tab');
  tabUpload.textContent = 'Upload';
  const tabLink = $('button.canvas-image-insert-tab');
  tabLink.textContent = 'Embed Link';
  tabBar.appendChild(tabUpload);
  tabBar.appendChild(tabLink);
  const cancelBtn = $('button.canvas-insert-popup-cancel');
  cancelBtn.textContent = 'Cancel';
  cancelBtn.title = 'Close without adding (Esc)';
  tabBar.appendChild(cancelBtn);
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

  let detachDismiss: (() => void) | null = null;
  // Follows the "/image" paragraph through any edit while the popup is open
  // (C11: inserting at the range captured on open ate the next block).
  const target = trackInsertTarget(editor, range);
  let closed = false;
  // True while the OS file dialog is open: it blurs the window, which must
  // not cancel the popup the dialog belongs to.
  let picking = false;
  // The OS file dialog blurs the window, which ends the popup's dismiss mode
  // (Escape, outside click); `cancel` ignores that while picking, so the
  // mode is armed again once the dialog closes. Without that the popup
  // stayed up with no way to close it after a cancelled pick.
  let dismissLost = false;
  const armDismiss = () => { detachDismiss = attachPopupDismiss(popup, cancel); };
  const pickFinished = () => {
    picking = false;
    if (!closed && dismissLost) { dismissLost = false; armDismiss(); }
  };

  const dismiss = () => {
    closed = true;
    popup.remove();
    detachDismiss?.();
    detachDismiss = null;
    target.dispose();
  };

  const insertImage = (src: string) => {
    if (closed) return;
    target.insert({ type: 'image', attrs: { src } });
    dismiss();
  };

  const cancel = () => {
    if (picking) { dismissLost = true; return; }
    // Replace the `/image` paragraph with an empty paragraph
    target.clear();
    dismiss();
  };

  // ── Upload tab ──────────────────────────────────────────────────────────

  const renderUpload = () => {
    content.innerHTML = '';

    const uploadBtn = $('button.canvas-image-insert-upload-btn');
    uploadBtn.textContent = 'Choose an Image';
    uploadBtn.addEventListener('click', async () => {
      try {
        const electron = (window as any).parallxElectron;
        if (!electron?.dialog?.openFile) {
          renderError('File picker is unavailable in this environment.');
          return;
        }
        let filePaths: string[] | undefined;
        picking = true;
        try {
          filePaths = await electron.dialog.openFile({
            filters: [{ name: 'Images', extensions: ['png', 'jpg', 'jpeg', 'gif', 'webp', 'svg'] }],
            properties: ['openFile'],
          });
        } finally {
          pickFinished();
        }
        if (closed || !filePaths?.[0]) return; // popup gone, or user cancelled
        const filePath = filePaths[0];
        const result = await electron.fs.readFile(filePath);
        if (result?.error) {
          renderError(`Could not read file: ${result.error.message || result.error.code || 'unknown error'}.`);
          return;
        }
        if (!result?.content || result.encoding !== 'base64') {
          renderError('Could not read the selected file.');
          return;
        }
        if (result.content.length > 5 * 1024 * 1024 * 1.37) {
          renderError('Image is too large (max 5 MB).');
          return;
        }
        const ext = filePath.split('.').pop()?.toLowerCase() || 'png';
        const mime = ext === 'jpg' ? 'image/jpeg'
          : ext === 'svg' ? 'image/svg+xml'
          : `image/${ext}`;
        insertImage(`data:${mime};base64,${result.content}`);
      } catch (err) {
        console.error('[imageInsertPopup] Upload failed:', err);
        renderError('Upload failed. See the console.');
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
    input.type = 'text';
    input.placeholder = 'Paste image URL or local path…';

    const embedBtn = $('button.canvas-image-insert-link-apply');
    embedBtn.textContent = 'Embed';

    const submit = async () => {
      const value = input.value.trim();
      if (!value) return;
      if (looksLikeLocalPath(value)) {
        embedBtn.setAttribute('disabled', 'true');
        const result = await readLocalImageAsDataUrl(value);
        embedBtn.removeAttribute('disabled');
        if (result.error) { renderError(result.error); return; }
        if (result.dataUrl) insertImage(result.dataUrl);
        return;
      }
      insertImage(value);
    };

    embedBtn.addEventListener('click', submit);
    isolateInputFromEditor(input, { onSubmit: submit, onCancel: cancel });

    row.appendChild(input);
    row.appendChild(embedBtn);
    content.appendChild(row);

    const hint = $('div.canvas-image-insert-hint');
    hint.textContent = 'Paste a web URL (http/https) or a local file path.';
    content.appendChild(hint);

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

  armDismiss();
  cancelBtn.addEventListener('click', () => cancel());

  // ── Mount ─────────────────────────────────────────────────────────────

  activate('upload');
  document.body.appendChild(popup);
  layoutPopup(popup, { x: coords.left, y: coords.bottom }, { gap: 4 });
}
