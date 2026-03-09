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
// Uses a capture-phase listener on `document` only to remember which editable
// surface initiated the right-click and to keep other app-level context-menu
// handlers from racing it. The authoritative spellcheck payload comes from the
// Electron main-process `webContents` context-menu event.
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

interface IEditableMenuState {
  readonly x: number;
  readonly y: number;
  readonly editFlags: {
    readonly canUndo: boolean;
    readonly canRedo: boolean;
    readonly canCut: boolean;
    readonly canCopy: boolean;
    readonly canPaste: boolean;
    readonly canSelectAll: boolean;
  };
  readonly dictionarySuggestions: readonly string[];
  readonly misspelledWord: string;
}

async function replaceMisspelling(suggestion: string): Promise<boolean> {
  try {
    const api = (window as any).parallxElectron?.editableMenu;
    if (!api?.replaceMisspelling) return false;
    return await api.replaceMisspelling(suggestion);
  } catch {
    return false;
  }
}

async function addWordToDictionary(word: string): Promise<boolean> {
  try {
    const api = (window as any).parallxElectron?.editableMenu;
    if (!api?.addToDictionary) return false;
    return await api.addToDictionary(word);
  } catch {
    return false;
  }
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

  private _pendingContextTarget: {
    readonly target: HTMLElement;
    readonly savedSelection: SavedSelection;
    readonly x: number;
    readonly y: number;
    readonly timestamp: number;
  } | null = null;

  constructor() {
    super();
    this._installGlobalListener();
    this._installMainProcessBridge();
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

      this._pendingContextTarget = {
        target: editable,
        savedSelection: saveSelection(editable),
        x: e.clientX,
        y: e.clientY,
        timestamp: Date.now(),
      };

      e.stopPropagation();
    };

    document.addEventListener('contextmenu', handler, true);
    this._register(toDisposable(() => {
      document.removeEventListener('contextmenu', handler, true);
    }));
  }

  private _installMainProcessBridge(): void {
    const api = (window as any).parallxElectron?.editableMenu;
    if (!api?.onOpen) {
      return;
    }

    api.onOpen((menuState: IEditableMenuState) => {
      const pending = this._consumePendingTarget(menuState.x, menuState.y);
      const target = pending?.target ?? this._resolveEditableTargetAt(menuState.x, menuState.y);
      if (!target) {
        return;
      }

      this._showMenu(
        menuState.x,
        menuState.y,
        target,
        menuState,
        pending?.savedSelection ?? saveSelection(target),
      );
    });
  }

  private _consumePendingTarget(x: number, y: number): { target: HTMLElement; savedSelection: SavedSelection } | null {
    const pending = this._pendingContextTarget;
    this._pendingContextTarget = null;
    if (!pending) {
      return null;
    }

    const ageMs = Date.now() - pending.timestamp;
    const isNearby = Math.abs(pending.x - x) <= 6 && Math.abs(pending.y - y) <= 6;
    if (ageMs > 1000 || !isNearby) {
      return null;
    }

    return {
      target: pending.target,
      savedSelection: pending.savedSelection,
    };
  }

  private _resolveEditableTargetAt(x: number, y: number): HTMLElement | null {
    const directTarget = document.elementFromPoint(x, y);
    if (directTarget) {
      const editable = findEditableAncestor(directTarget);
      if (editable) {
        return editable;
      }
    }

    const active = document.activeElement;
    return active instanceof HTMLElement ? findEditableAncestor(active) : null;
  }

  // ── Menu ────────────────────────────────────────────────────────────────

  private _showMenu(
    x: number,
    y: number,
    target: HTMLElement,
    menuState: IEditableMenuState,
    saved: SavedSelection,
  ): void {
    const hasSel = hasTextSelection(target);
    const hasClip = clipboardHasText();
    const spellcheckItems: IContextMenuItem[] = [];

    if (menuState.dictionarySuggestions.length > 0) {
      for (const suggestion of menuState.dictionarySuggestions.slice(0, 6)) {
        spellcheckItems.push({
          id: `replace:${suggestion}`,
          label: suggestion,
          group: '0_spellcheck',
        });
      }
    }

    if (menuState.misspelledWord) {
      spellcheckItems.push({
        id: 'add-to-dictionary',
        label: 'Add to Dictionary',
        group: '0_spellcheck',
      });
    }

    const items: IContextMenuItem[] = [
      ...spellcheckItems,
      { id: 'undo',        label: 'Undo',                keybinding: `${mod}+Z`,        group: '1_history',   disabled: !menuState.editFlags.canUndo },
      { id: 'redo',        label: 'Redo',                keybinding: `${mod}+Shift+Z`,  group: '1_history',   disabled: !menuState.editFlags.canRedo },
      { id: 'cut',         label: 'Cut',                 keybinding: `${mod}+X`,        group: '2_clipboard', disabled: !menuState.editFlags.canCut && !hasSel },
      { id: 'copy',        label: 'Copy',                keybinding: `${mod}+C`,        group: '2_clipboard', disabled: !menuState.editFlags.canCopy && !hasSel },
      { id: 'paste',       label: 'Paste',               keybinding: `${mod}+V`,        group: '2_clipboard', disabled: !menuState.editFlags.canPaste && !hasClip },
      { id: 'paste-plain', label: 'Paste as plain text', keybinding: `${mod}+Shift+V`, group: '2_clipboard', disabled: !menuState.editFlags.canPaste && !hasClip },
      { id: 'select-all',  label: 'Select all',          keybinding: `${mod}+A`,        group: '3_selection', disabled: !menuState.editFlags.canSelectAll },
    ];

    const menu = ContextMenu.show({
      items,
      anchor: { x, y },
      className: 'editable-context-menu',
    });

    menu.onDidSelect(({ item }) => {
      // Restore focus + selection before executing the command
      restoreAndFocus(saved);

      if (item.id.startsWith('replace:')) {
        void replaceMisspelling(item.id.slice('replace:'.length));
        return;
      }

      switch (item.id) {
        case 'add-to-dictionary': void addWordToDictionary(menuState.misspelledWord); break;
        case 'undo': execUndo(); break;
        case 'redo': execRedo(); break;
        case 'cut': execCut(); break;
        case 'copy': execCopy(); break;
        case 'paste': execPaste(); break;
        case 'paste-plain': execPastePlain(saved); break;
        case 'select-all': execSelectAll(target); break;
      }
    });
  }
}
