import type { Editor } from '@tiptap/core';
import { $ } from '../../../ui/dom.js';

type MediaKind = 'video' | 'audio' | 'fileAttachment';

const MEDIA_LABEL: Record<MediaKind, string> = {
  video: 'Video',
  audio: 'Audio',
  fileAttachment: 'File',
};

const MEDIA_ACCEPT_HINT: Record<MediaKind, string> = {
  video: 'MP4, WebM, OGG, MOV. Max 50 MB.',
  audio: 'MP3, WAV, OGG, M4A. Max 20 MB.',
  fileAttachment: 'PDF, DOCX, PPTX, XLSX, TXT, ZIP, and more. Max 50 MB.',
};

const MEDIA_MAX_BYTES: Record<MediaKind, number> = {
  video: 50 * 1024 * 1024,
  audio: 20 * 1024 * 1024,
  fileAttachment: 50 * 1024 * 1024,
};

const MEDIA_FILTERS: Record<MediaKind, { name: string; extensions: string[] }[]> = {
  video: [{ name: 'Video', extensions: ['mp4', 'webm', 'ogg', 'mov'] }],
  audio: [{ name: 'Audio', extensions: ['mp3', 'wav', 'ogg', 'm4a'] }],
  fileAttachment: [{ name: 'Files', extensions: ['pdf', 'doc', 'docx', 'ppt', 'pptx', 'xls', 'xlsx', 'txt', 'zip'] }],
};

export function showMediaInsertPopup(
  editor: Editor,
  range: { from: number; to: number },
  kind: MediaKind,
): void {
  const coords = editor.view.coordsAtPos(editor.state.selection.from);
  const container = editor.view.dom.closest('.canvas-editor-wrapper')
    ?? editor.view.dom.parentElement!;

  const popup = $('div.canvas-media-insert-popup');
  popup.style.left = `${coords.left}px`;
  popup.style.top = `${coords.bottom + 4}px`;

  const tabBar = $('div.canvas-media-insert-tabs');
  const tabUpload = $('button.canvas-media-insert-tab');
  tabUpload.textContent = 'Upload';
  const tabLink = $('button.canvas-media-insert-tab');
  tabLink.textContent = 'Embed link';
  tabBar.appendChild(tabUpload);
  tabBar.appendChild(tabLink);
  popup.appendChild(tabBar);

  const content = $('div.canvas-media-insert-content');
  popup.appendChild(content);

  let inputPasteMenu: HTMLElement | null = null;
  let inputPasteMenuOutsideHandler: ((event: MouseEvent) => void) | null = null;

  const dismissInputPasteMenu = () => {
    if (inputPasteMenu) {
      inputPasteMenu.remove();
      inputPasteMenu = null;
    }
    if (inputPasteMenuOutsideHandler) {
      document.removeEventListener('mousedown', inputPasteMenuOutsideHandler, true);
      inputPasteMenuOutsideHandler = null;
    }
  };

  const dismiss = () => {
    dismissInputPasteMenu();
    popup.remove();
    document.removeEventListener('mousedown', outsideClick, true);
    document.removeEventListener('keydown', escapeKey, true);
  };

  const cancel = () => {
    editor.chain().insertContentAt(range, { type: 'paragraph' }).focus().run();
    dismiss();
  };

  const renderError = (msg: string) => {
    let errEl = content.querySelector('.canvas-media-insert-error') as HTMLElement | null;
    if (!errEl) {
      errEl = $('div.canvas-media-insert-error');
      content.appendChild(errEl);
    }
    errEl.textContent = msg;
  };

  const extFromPath = (path: string): string => {
    const name = path.split(/[\\/]/).pop() || '';
    const idx = name.lastIndexOf('.');
    return idx >= 0 ? name.slice(idx + 1).toLowerCase() : '';
  };

  const fileNameFromPath = (path: string): string => path.split(/[\\/]/).pop() || 'Untitled file';

  const mimeFromExt = (ext: string): string => {
    const map: Record<string, string> = {
      mp4: 'video/mp4',
      webm: 'video/webm',
      ogg: 'video/ogg',
      mov: 'video/quicktime',
      mp3: 'audio/mpeg',
      wav: 'audio/wav',
      m4a: 'audio/mp4',
      pdf: 'application/pdf',
      doc: 'application/msword',
      docx: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
      ppt: 'application/vnd.ms-powerpoint',
      pptx: 'application/vnd.openxmlformats-officedocument.presentationml.presentation',
      xls: 'application/vnd.ms-excel',
      xlsx: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
      txt: 'text/plain',
      zip: 'application/zip',
    };
    return map[ext] || 'application/octet-stream';
  };

  const humanSize = (bytes: number): string => {
    if (bytes < 1024) return `${bytes} B`;
    if (bytes < 1024 * 1024) return `${Math.round(bytes / 102.4) / 10} KB`;
    return `${Math.round(bytes / (1024 * 102.4)) / 10} MB`;
  };

  const insertFromAttrs = (attrs: Record<string, string>) => {
    editor.chain().insertContentAt(range, { type: kind, attrs }).focus().run();
    dismiss();
  };

  const insertFromLink = (link: string) => {
    if (kind === 'fileAttachment') {
      const name = link.split('/').pop() || 'Untitled file';
      insertFromAttrs({ src: link, filename: name, size: '' });
      return;
    }
    insertFromAttrs({ src: link, title: '' });
  };

  const insertFromUploadedFile = (filePath: string, base64: string) => {
    const ext = extFromPath(filePath);
    const mime = mimeFromExt(ext);
    const bytes = Math.floor((base64.length * 3) / 4);

    if (bytes > MEDIA_MAX_BYTES[kind]) {
      renderError(`${MEDIA_LABEL[kind]} is too large.`);
      return;
    }

    const dataUrl = `data:${mime};base64,${base64}`;

    if (kind === 'fileAttachment') {
      insertFromAttrs({
        src: dataUrl,
        filename: fileNameFromPath(filePath),
        size: humanSize(bytes),
      });
      return;
    }

    insertFromAttrs({ src: dataUrl, title: fileNameFromPath(filePath) });
  };

  const renderUpload = () => {
    content.innerHTML = '';
    const uploadBtn = $('button.canvas-media-insert-upload-btn');
    uploadBtn.textContent = `Choose ${MEDIA_LABEL[kind].toLowerCase()}`;
    uploadBtn.addEventListener('click', async () => {
      try {
        const electron = (window as any).parallxElectron;
        if (!electron?.dialog?.openFile || !electron?.fs?.readFile) {
          renderError('File dialog is not available.');
          return;
        }
        const filePaths = await electron.dialog.openFile({
          filters: MEDIA_FILTERS[kind],
          properties: ['openFile'],
        });
        if (!filePaths?.[0]) return;
        const filePath = filePaths[0];
        const result = await electron.fs.readFile(filePath);
        if (!result?.content || result.encoding !== 'base64') {
          renderError('Could not read selected file.');
          return;
        }
        insertFromUploadedFile(filePath, result.content);
      } catch (err) {
        console.error('[mediaInsertPopup] Upload failed:', err);
        renderError('Upload failed — see console.');
      }
    });
    content.appendChild(uploadBtn);

    const hint = $('div.canvas-media-insert-hint');
    hint.textContent = MEDIA_ACCEPT_HINT[kind];
    content.appendChild(hint);
  };

  const renderLink = () => {
    content.innerHTML = '';
    const row = $('div.canvas-media-insert-link-row');

    const input = $('input.canvas-media-insert-link-input') as HTMLInputElement;
    input.type = 'url';
    input.placeholder = `Paste ${MEDIA_LABEL[kind].toLowerCase()} link…`;

    const applyBtn = $('button.canvas-media-insert-link-apply');
    applyBtn.textContent = kind === 'fileAttachment' ? 'Attach file' : 'Embed';

    const submit = () => {
      const url = input.value.trim();
      if (!url) return;
      insertFromLink(url);
    };

    const insertClipboardAtCaret = async () => {
      const fromBridge = (() => {
        const api = (window as any).parallxElectron?.clipboard;
        if (!api?.readText) return '';
        try { return String(api.readText() || ''); } catch { return ''; }
      })();

      const text = fromBridge || await navigator.clipboard.readText().catch(() => '');
      if (!text) return;

      const start = input.selectionStart ?? input.value.length;
      const end = input.selectionEnd ?? input.value.length;
      input.setRangeText(text, start, end, 'end');
      input.dispatchEvent(new Event('input', { bubbles: true }));
    };

    applyBtn.addEventListener('click', submit);
    input.addEventListener('keydown', (event) => {
      if (event.key === 'Enter') {
        event.preventDefault();
        submit();
      }
      if (event.key === 'Escape') {
        event.preventDefault();
        cancel();
      }
      event.stopPropagation();
    });
    input.addEventListener('keyup', (event) => event.stopPropagation());
    input.addEventListener('keypress', (event) => event.stopPropagation());
    input.addEventListener('input', (event) => event.stopPropagation());
    input.addEventListener('paste', (event) => event.stopPropagation());
    input.addEventListener('copy', (event) => event.stopPropagation());
    input.addEventListener('cut', (event) => event.stopPropagation());
    input.addEventListener('contextmenu', (event) => {
      event.preventDefault();
      event.stopPropagation();

      dismissInputPasteMenu();

      const menu = $('div.canvas-input-paste-menu');
      const popupRect = popup.getBoundingClientRect();
      menu.style.left = `${event.clientX - popupRect.left}px`;
      menu.style.top = `${event.clientY - popupRect.top}px`;
      menu.style.position = 'absolute';

      const pasteItem = $('button.canvas-input-paste-menu-item');
      pasteItem.textContent = 'Paste';
      pasteItem.addEventListener('mousedown', (ev) => {
        ev.preventDefault();
        ev.stopPropagation();
      });
      pasteItem.addEventListener('click', async (ev) => {
        ev.preventDefault();
        ev.stopPropagation();
        await insertClipboardAtCaret();
        dismissInputPasteMenu();
      });

      menu.appendChild(pasteItem);
      popup.appendChild(menu);
      inputPasteMenu = menu;

      inputPasteMenuOutsideHandler = (ev: MouseEvent) => {
        if (!menu.contains(ev.target as Node)) {
          dismissInputPasteMenu();
        }
      };
      requestAnimationFrame(() => {
        if (inputPasteMenuOutsideHandler) {
          document.addEventListener('mousedown', inputPasteMenuOutsideHandler, true);
        }
      });
    });

    row.appendChild(input);
    row.appendChild(applyBtn);
    content.appendChild(row);

    requestAnimationFrame(() => input.focus());
  };

  const activate = (tab: 'upload' | 'link') => {
    tabUpload.classList.toggle('canvas-media-insert-tab--active', tab === 'upload');
    tabLink.classList.toggle('canvas-media-insert-tab--active', tab === 'link');
    if (tab === 'upload') renderUpload();
    else renderLink();
  };

  tabUpload.addEventListener('click', () => activate('upload'));
  tabLink.addEventListener('click', () => activate('link'));

  const outsideClick = (event: MouseEvent) => {
    if (inputPasteMenu) return;
    const target = event.target as Node;
    if (popup.contains(target)) return;
    cancel();
  };

  const escapeKey = (event: KeyboardEvent) => {
    if (event.key === 'Escape') {
      event.preventDefault();
      event.stopPropagation();
      cancel();
    }
  };

  requestAnimationFrame(() => {
    document.addEventListener('mousedown', outsideClick, true);
    document.addEventListener('keydown', escapeKey, true);
  });

  activate('upload');
  container.appendChild(popup);
}
