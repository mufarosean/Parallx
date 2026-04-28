import type { Editor } from '@tiptap/core';
import { $, layoutPopup, attachPopupDismiss } from '../../../ui/dom.js';
import { attachInputPasteContextMenu } from './inputPasteContextMenu.js';
import { isolateInputFromEditor } from './inputIsolation.js';

export function showBookmarkInsertPopup(
  editor: Editor,
  range: { from: number; to: number },
): void {
  const coords = editor.view.coordsAtPos(editor.state.selection.from);

  const popup = $('div.canvas-bookmark-insert-popup');

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

  let detachDismiss: (() => void) | null = null;
  const pasteMenu = attachInputPasteContextMenu(input, popup);

  const dismiss = () => {
    pasteMenu.dismiss();
    popup.remove();
    detachDismiss?.();
    detachDismiss = null;
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

  createBtn.addEventListener('click', submit);
  isolateInputFromEditor(input, {
    onSubmit: submit,
    onCancel: cancel,
    onInput: () => { errorEl.textContent = ''; },
  });

  detachDismiss = attachPopupDismiss(popup, cancel, {
    isDismissable: () => !pasteMenu.isOpen(),
  });

  requestAnimationFrame(() => {
    input.focus();
  });

  document.body.appendChild(popup);
  layoutPopup(popup, { x: coords.left, y: coords.bottom }, { gap: 4 });
}
