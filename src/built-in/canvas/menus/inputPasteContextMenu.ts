// inputPasteContextMenu.ts — right-click "Paste" sub-menu for popup inputs
//
// Several canvas insert popups (bookmark, media link tab) host a URL <input>
// that needs the standard browser-style right-click → Paste affordance.
// ProseMirror swallows the native context menu, so we render our own.  This
// helper owns:
//
//   • the `contextmenu` listener on the input,
//   • the menu DOM element and its outside-click handler,
//   • the clipboard read (Electron bridge with navigator.clipboard fallback)
//     and the `setRangeText` insertion at the caret,
//   • lifecycle cleanup via the returned controller.
//
// The parent popup forwards `isOpen()` to `attachPopupDismiss` so an open
// sub-menu won't dismiss the host popup, and calls `dismiss()` from its
// own teardown so the sub-menu never outlives its host.

import { $ } from '../../../ui/dom.js';

export interface InputPasteMenuController {
  /** True while the paste sub-menu is mounted. */
  isOpen(): boolean;
  /** Close the sub-menu (no-op if not open) and detach its outside handler. */
  dismiss(): void;
}

interface ClipboardBridge {
  readText?: () => string;
}

async function readClipboardText(): Promise<string> {
  const bridge: ClipboardBridge | undefined =
    (window as unknown as { parallxElectron?: { clipboard?: ClipboardBridge } })
      .parallxElectron?.clipboard;

  if (bridge?.readText) {
    try {
      const text = bridge.readText();
      if (text) return String(text);
    } catch {
      // fall through to navigator.clipboard
    }
  }

  return navigator.clipboard.readText().catch(() => '');
}

/**
 * Wire a right-click → Paste context menu onto a popup-hosted URL input.
 *
 * The menu element is appended to `popup` (so it inherits the popup's
 * stacking context) and is positioned with `position: absolute` inside
 * the popup using coordinates derived from the contextmenu event.
 */
export function attachInputPasteContextMenu(
  input: HTMLInputElement,
  popup: HTMLElement,
): InputPasteMenuController {
  let menu: HTMLElement | null = null;
  let outsideHandler: ((event: MouseEvent) => void) | null = null;

  const dismiss = () => {
    if (menu) {
      menu.remove();
      menu = null;
    }
    if (outsideHandler) {
      document.removeEventListener('mousedown', outsideHandler, true);
      outsideHandler = null;
    }
  };

  const insertClipboardAtCaret = async () => {
    const text = await readClipboardText();
    if (!text) return;

    const start = input.selectionStart ?? input.value.length;
    const end   = input.selectionEnd   ?? input.value.length;
    input.setRangeText(text, start, end, 'end');
    input.dispatchEvent(new Event('input', { bubbles: true }));
  };

  input.addEventListener('contextmenu', (event) => {
    event.preventDefault();
    event.stopPropagation();

    dismiss();

    const next = $('div.canvas-input-paste-menu');
    const popupRect = popup.getBoundingClientRect();
    next.style.position = 'absolute';
    next.style.left = `${event.clientX - popupRect.left}px`;
    next.style.top  = `${event.clientY - popupRect.top}px`;

    const pasteItem = $('button.canvas-input-paste-menu-item');
    pasteItem.textContent = 'Paste';
    // Swallow mousedown so the input doesn't lose focus before click fires.
    pasteItem.addEventListener('mousedown', (ev) => {
      ev.preventDefault();
      ev.stopPropagation();
    });
    pasteItem.addEventListener('click', async (ev) => {
      ev.preventDefault();
      ev.stopPropagation();
      await insertClipboardAtCaret();
      dismiss();
    });

    next.appendChild(pasteItem);
    popup.appendChild(next);
    menu = next;

    const handler = (ev: MouseEvent) => {
      if (!next.contains(ev.target as Node)) dismiss();
    };
    outsideHandler = handler;

    // Defer attach so the originating contextmenu click doesn't dismiss us.
    requestAnimationFrame(() => {
      if (outsideHandler === handler) {
        document.addEventListener('mousedown', handler, true);
      }
    });
  });

  return {
    isOpen: () => menu !== null,
    dismiss,
  };
}
