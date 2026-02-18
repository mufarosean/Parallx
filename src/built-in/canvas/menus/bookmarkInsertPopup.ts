import type { Editor } from '@tiptap/core';
import { $ } from '../../../ui/dom.js';

export function showBookmarkInsertPopup(
  editor: Editor,
  range: { from: number; to: number },
): void {
  const coords = editor.view.coordsAtPos(editor.state.selection.from);
  const container = editor.view.dom.closest('.canvas-editor-wrapper')
    ?? editor.view.dom.parentElement!;

  const popup = $('div.canvas-bookmark-insert-popup');
  popup.style.left = `${coords.left}px`;
  popup.style.top = `${coords.bottom + 4}px`;

  const title = $('div.canvas-bookmark-insert-title');
  title.textContent = 'Create bookmark';
  popup.appendChild(title);

  const row = $('div.canvas-bookmark-insert-row');
  const input = $('input.canvas-bookmark-insert-input') as HTMLInputElement;
  input.type = 'url';
  input.placeholder = 'Paste link to bookmark…';

  const createBtn = $('button.canvas-bookmark-insert-create');
  createBtn.textContent = 'Create bookmark';

  row.appendChild(input);
  row.appendChild(createBtn);
  popup.appendChild(row);

  const errorEl = $('div.canvas-bookmark-insert-error');
  popup.appendChild(errorEl);

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

  const validUrl = (value: string): string | null => {
    const text = value.trim();
    if (!text) return null;
    try {
      const parsed = new URL(text);
      return parsed.toString();
    } catch {
      return null;
    }
  };

  const submit = () => {
    const url = validUrl(input.value);
    if (!url) {
      errorEl.textContent = 'Enter a valid URL.';
      return;
    }

    const hostname = (() => {
      try {
        return new URL(url).hostname;
      } catch {
        return '';
      }
    })();

    editor.chain().insertContentAt(range, {
      type: 'bookmark',
      attrs: {
        url,
        title: hostname || url,
        description: '',
        favicon: '',
        image: '',
      },
    }).focus().run();
    dismiss();
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

  createBtn.addEventListener('click', submit);
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
  input.addEventListener('input', (event) => {
    event.stopPropagation();
    errorEl.textContent = '';
  });
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
    input.focus();
  });

  container.appendChild(popup);
}
