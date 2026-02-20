// editableContextMenu.ts — Universal right-click context menu for editable surfaces
//
// Intercepts the native `contextmenu` event on any editable surface
// (input, textarea, contenteditable) and shows a rich-text-editing menu:
//   Undo · Redo · Cut · Copy · Paste · Paste as plain text · Select All
//
// Works for:
//   - TipTap/ProseMirror editors (via beforeinput → historyUndo/historyRedo)
//   - Plain <input> / <textarea> elements
//   - Any [contenteditable] surface
//
// Uses capture-phase listener on `document` so it runs before any
// component-specific contextmenu handlers (e.g. canvas sidebar, popups).
// When the target IS an editable surface, this handler suppresses the native
// Electron/Chromium context menu and shows our ContextMenu instead.
//
// VS Code reference: VS Code uses Electron's `Menu.buildFromTemplate()`
// for the native input context menu. Parallx uses its own ContextMenu widget
// for consistency with the rest of the UI.

import { Disposable, toDisposable } from '../platform/lifecycle.js';
import { ContextMenu, type IContextMenuItem } from '../ui/contextMenu.js';

// ── Platform detection ──────────────────────────────────────────────────────

const isMac = (window as any).parallxElectron?.platform === 'darwin';
const mod = isMac ? '⌘' : 'Ctrl';

// ── Editable-surface detection ──────────────────────────────────────────────

const EDITABLE_SELECTOR = [
  'input:not([type="checkbox"]):not([type="radio"]):not([type="range"]):not([type="file"]):not([type="color"]):not([type="hidden"]):not([readonly]):not([disabled])',
  'textarea:not([readonly]):not([disabled])',
  '[contenteditable=""]',
  '[contenteditable="true"]',
  '[contenteditable="plaintext-only"]',
].join(', ');

function findEditableAncestor(target: Element): HTMLElement | null {
  const el = target.closest(EDITABLE_SELECTOR) as HTMLElement | null;
  if (!el) return null;

  if (el instanceof HTMLInputElement) {
    const type = (el.type || 'text').toLowerCase();
    const nonText = new Set(['button', 'submit', 'reset', 'image']);
    return nonText.has(type) ? null : el;
  }

  if (el instanceof HTMLTextAreaElement) return el;

  return el.isContentEditable ? el : null;
}

// ── Selection helpers ───────────────────────────────────────────────────────

interface SavedSelection {
  readonly type: 'input' | 'contenteditable';
  readonly target: HTMLElement;
  readonly start?: number;
  readonly end?: number;
}

function hasTextSelection(target: HTMLElement): boolean {
  if (target instanceof HTMLInputElement || target instanceof HTMLTextAreaElement) {
    return (target.selectionStart ?? 0) !== (target.selectionEnd ?? 0);
  }
  const sel = window.getSelection();
  return !!sel && !sel.isCollapsed;
}

function saveSelection(target: HTMLElement): SavedSelection {
  if (target instanceof HTMLInputElement || target instanceof HTMLTextAreaElement) {
    return {
      type: 'input',
      target,
      start: target.selectionStart ?? 0,
      end: target.selectionEnd ?? 0,
    };
  }
  return { type: 'contenteditable', target };
}

function restoreAndFocus(saved: SavedSelection): void {
  saved.target.focus();
  if (saved.type === 'input') {
    const el = saved.target as HTMLInputElement | HTMLTextAreaElement;
    el.setSelectionRange(saved.start ?? 0, saved.end ?? 0);
  }
  // For contenteditable, ProseMirror restores the selection on focus.
}

// ── Clipboard helpers ───────────────────────────────────────────────────────

function readClipboardText(): string {
  try {
    const api = (window as any).parallxElectron?.clipboard;
    if (api?.readText) return String(api.readText() || '');
  } catch { /* fall through */ }
  return '';
}

function clipboardHasText(): boolean {
  return readClipboardText().length > 0;
}

// ── Command execution ───────────────────────────────────────────────────────

function execUndo(): void {
  document.execCommand('undo');
}

function execRedo(): void {
  document.execCommand('redo');
}

function execCut(): void {
  document.execCommand('cut');
}

function execCopy(): void {
  document.execCommand('copy');
}

function execPaste(): void {
  document.execCommand('paste');
}

/**
 * Paste clipboard content as unformatted text.
 *
 * For contenteditable (TipTap), this bypasses ProseMirror's HTML paste
 * handling. For <input>/<textarea> it's identical to normal paste.
 */
function execPastePlain(saved: SavedSelection): void {
  const text = readClipboardText();
  if (!text) return;

  if (saved.type === 'input') {
    const el = saved.target as HTMLInputElement | HTMLTextAreaElement;
    const start = el.selectionStart ?? 0;
    const end = el.selectionEnd ?? 0;
    el.setRangeText(text, start, end, 'end');
    el.dispatchEvent(new Event('input', { bubbles: true }));
  } else {
    // Insert as plain text in contenteditable — fires beforeinput(insertText)
    // which ProseMirror handles without HTML conversion.
    document.execCommand('insertText', false, text);
  }
}

function execSelectAll(target: HTMLElement): void {
  if (target instanceof HTMLInputElement || target instanceof HTMLTextAreaElement) {
    target.select();
  } else {
    document.execCommand('selectAll');
  }
}

// ═════════════════════════════════════════════════════════════════════════════
// EditableContextMenu
// ═════════════════════════════════════════════════════════════════════════════

/**
 * Universal right-click context menu for all editable text surfaces.
 *
 * Install once at workbench level. Capture-phase handler ensures it runs
 * before any component-specific contextmenu handlers.
 */
export class EditableContextMenu extends Disposable {

  constructor() {
    super();
    this._installGlobalListener();
  }

  // ── Event listener ──────────────────────────────────────────────────────

  private _installGlobalListener(): void {
    const handler = (e: MouseEvent) => {
      const target = e.target as Element | null;
      if (!target) return;

      // Don't intercept right-clicks inside an existing context menu
      if (target.closest('.context-menu')) return;

      const editable = findEditableAncestor(target);
      if (!editable) return;

      e.preventDefault();
      e.stopPropagation();

      this._showMenu(e.clientX, e.clientY, editable);
    };

    document.addEventListener('contextmenu', handler, true);
    this._register(toDisposable(() => {
      document.removeEventListener('contextmenu', handler, true);
    }));
  }

  // ── Menu ────────────────────────────────────────────────────────────────

  private _showMenu(x: number, y: number, target: HTMLElement): void {
    const hasSel = hasTextSelection(target);
    const hasClip = clipboardHasText();
    const saved = saveSelection(target);

    const items: IContextMenuItem[] = [
      { id: 'undo',        label: 'Undo',               keybinding: `${mod}+Z`,             group: '1_history' },
      { id: 'redo',        label: 'Redo',               keybinding: `${mod}+Shift+Z`,       group: '1_history' },
      { id: 'cut',         label: 'Cut',                keybinding: `${mod}+X`,             group: '2_clipboard', disabled: !hasSel },
      { id: 'copy',        label: 'Copy',               keybinding: `${mod}+C`,             group: '2_clipboard', disabled: !hasSel },
      { id: 'paste',       label: 'Paste',              keybinding: `${mod}+V`,             group: '2_clipboard', disabled: !hasClip },
      { id: 'paste-plain', label: 'Paste as plain text', keybinding: `${mod}+Shift+V`,      group: '2_clipboard', disabled: !hasClip },
      { id: 'select-all',  label: 'Select all',         keybinding: `${mod}+A`,             group: '3_selection' },
    ];

    const menu = ContextMenu.show({
      items,
      anchor: { x, y },
      className: 'editable-context-menu',
    });

    menu.onDidSelect(({ item }) => {
      // Restore focus + selection before executing the command
      restoreAndFocus(saved);

      switch (item.id) {
        case 'undo':        execUndo(); break;
        case 'redo':        execRedo(); break;
        case 'cut':         execCut(); break;
        case 'copy':        execCopy(); break;
        case 'paste':       execPaste(); break;
        case 'paste-plain': execPastePlain(saved); break;
        case 'select-all':  execSelectAll(target); break;
      }
    });
  }
}
