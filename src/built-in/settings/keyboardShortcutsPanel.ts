// keyboardShortcutsPanel.ts — view + rebind every command's keybinding.
//
// Embedded in the unified Settings hub. Lists all registered commands with
// their current shortcut, supports live rebinding (with a reserved-key +
// duplicate guard) and reset, and persists overrides across relaunch.

import { Disposable } from '../../platform/lifecycle.js';
import { $, addDisposableListener } from '../../ui/dom.js';
import { InputBox } from '../../ui/inputBox.js';
import type { IKeybindingService, ICommandService } from '../../services/serviceTypes.js';
import { reservedKeyOwner } from '../../contributions/keybindingContribution.js';
import { enterMode } from '../../ui/interactionMode.js';
import { setKbOverride, clearKbOverride } from '../../services/keybindingOverrides.js';
import './keyboardShortcuts.css';

export class KeyboardShortcutsPanel extends Disposable {
  private readonly _root: HTMLElement;
  private readonly _listEl: HTMLElement;
  private _search = '';
  /** commandId currently being captured, or null. */
  private _capturingId: string | null = null;


  constructor(
    container: HTMLElement,
    private readonly _keybindings: IKeybindingService,
    private readonly _commands: ICommandService,
  ) {
    super();

    this._root = $('div.kbs');
    container.appendChild(this._root);
    this._register({ dispose: () => this._root.remove() });

    const searchHost = $('div.kbs__search');
    const search = this._register(new InputBox(searchHost, {
      placeholder: 'Search commands…',
      ariaLabel: 'Search keyboard shortcuts',
    }));
    this._register(search.onDidChange((v) => { this._search = v.trim().toLowerCase(); this._renderList(); }));
    this._root.appendChild(searchHost);

    this._listEl = $('div.kbs__list');
    this._root.appendChild(this._listEl);

    this._renderList();
  }

  override dispose(): void {
    this._cancelCapture();
    super.dispose();
  }

  private _renderList(): void {
    this._listEl.replaceChildren();

    const commands = Array.from(this._commands.getCommands().values())
      .filter((c) => c.title && !c.title.startsWith('%')) // skip unlabeled/internal
      .sort((a, b) => (a.category ?? '').localeCompare(b.category ?? '') || a.title.localeCompare(b.title));

    const q = this._search;
    const rows = commands.filter((c) => {
      if (!q) return true;
      const kb = this._keybindings.lookupKeybinding(c.id) ?? '';
      return `${c.title} ${c.id} ${c.category ?? ''} ${kb}`.toLowerCase().includes(q);
    });

    if (rows.length === 0) {
      const empty = $('div.kbs__empty');
      empty.textContent = 'No commands match.';
      this._listEl.appendChild(empty);
      return;
    }

    // Header row
    const head = $('div.kbs__row.kbs__row--head');
    head.appendChild(this._cell('Command', 'kbs__c-cmd'));
    head.appendChild(this._cell('Keybinding', 'kbs__c-key'));
    head.appendChild(this._cell('', 'kbs__c-actions'));
    this._listEl.appendChild(head);

    for (const cmd of rows) {
      this._listEl.appendChild(this._renderRow(cmd.id, cmd.title, cmd.category));
    }
  }

  private _cell(text: string, cls: string): HTMLElement {
    const el = $(`div.${cls}`);
    el.textContent = text;
    return el;
  }

  private _renderRow(id: string, title: string, category?: string): HTMLElement {
    const row = $('div.kbs__row');
    const current = this._keybindings.lookupKeybinding(id);

    // Command column: title + muted id/category.
    const cmdCol = $('div.kbs__c-cmd');
    const titleEl = $('span.kbs__cmd-title');
    titleEl.textContent = category ? `${category}: ${title}` : title;
    cmdCol.appendChild(titleEl);
    const idEl = $('span.kbs__cmd-id');
    idEl.textContent = id;
    cmdCol.appendChild(idEl);
    row.appendChild(cmdCol);

    // Key column.
    const keyCol = $('div.kbs__c-key');
    const keyBtn = document.createElement('button');
    keyBtn.type = 'button';
    keyBtn.className = 'kbs__keybtn';
    if (this._capturingId === id) {
      keyBtn.classList.add('kbs__keybtn--capturing');
      keyBtn.textContent = 'Press keys…  (Esc to cancel)';
    } else if (current) {
      this._renderKeycaps(keyBtn, current);
    } else {
      keyBtn.classList.add('kbs__keybtn--unset');
      keyBtn.textContent = 'Add shortcut';
    }
    this._register(addDisposableListener(keyBtn, 'click', () => this._beginCapture(id)));
    keyCol.appendChild(keyBtn);
    row.appendChild(keyCol);

    // Actions: reset (only when bound).
    const actions = $('div.kbs__c-actions');
    if (current && this._capturingId !== id) {
      const reset = document.createElement('button');
      reset.type = 'button';
      reset.className = 'kbs__reset';
      reset.title = 'Reset to default';
      reset.textContent = '↺';
      this._register(addDisposableListener(reset, 'click', () => this._reset(id)));
      actions.appendChild(reset);
    }
    row.appendChild(actions);

    return row;
  }

  private _renderKeycaps(host: HTMLElement, key: string): void {
    host.replaceChildren();
    // Split chord on space, combo on '+'.
    for (const part of key.split(/\s+/)) {
      for (const k of part.split('+')) {
        const cap = document.createElement('kbd');
        cap.className = 'kbs__cap';
        cap.textContent = this._prettyKey(k);
        host.appendChild(cap);
      }
    }
  }

  private _prettyKey(k: string): string {
    const map: Record<string, string> = {
      ctrl: 'Ctrl', meta: '⌘', alt: 'Alt', shift: 'Shift',
      arrowup: '↑', arrowdown: '↓', arrowleft: '←', arrowright: '→',
    };
    const low = k.toLowerCase();
    return map[low] ?? (k.length === 1 ? k.toUpperCase() : k.charAt(0).toUpperCase() + k.slice(1));
  }

  // ── Capture ──────────────────────────────────────────────────────────

  private _beginCapture(id: string): void {
    this._cancelCapture();
    this._capturingId = id;
    this._renderList();

    // Key capture is an INTERACTION MODE (interactionMode.ts) — the
    // audit's worst single instance of the stale-mode class: capture
    // used to exit only on Escape or a captured combo, so arming a
    // keycap and clicking into the editor meant the FIRST CHARACTER
    // TYPED was silently bound as a global shortcut and persisted. The
    // mode now dies on any outside press, on focus leaving the panel,
    // and on window blur — and refuses to bind once it is no longer
    // the topmost mode.
    this._captureMode = enterMode({
      id: 'keybinding-capture',
      ownedRoots: () => [this._root],
      exitOnFocusLoss: true,
      onExit: () => {
        this._captureMode = undefined;
        this._capturingId = null;
        this._renderList();
      },
      onKeydown: (e) => {
        // Lone modifiers: wait for a real key (consumed — they are part
        // of the combo being formed).
        if (['Control', 'Shift', 'Alt', 'Meta'].includes(e.key)) return true;
        const combo = this._comboFromEvent(e);
        if (!combo) return true;
        this._applyRebind(id, combo);
        return true;
      },
    });
  }

  private _captureMode: import('../../ui/interactionMode.js').ModeHandle | undefined;

  private _cancelCapture(): void {
    this._captureMode?.exit();
    this._captureMode = undefined;
    this._capturingId = null;
  }

  private _comboFromEvent(e: KeyboardEvent): string | null {
    const parts: string[] = [];
    if (e.ctrlKey) parts.push('Ctrl');
    if (e.shiftKey) parts.push('Shift');
    if (e.altKey) parts.push('Alt');
    if (e.metaKey) parts.push('Meta');
    let main = e.key;
    if (main === ' ') main = 'Space';
    else if (main.length === 1) main = main.toUpperCase();
    // Need at least one non-modifier key.
    if (!main || ['Control', 'Shift', 'Alt', 'Meta'].includes(main)) return null;
    parts.push(main);
    return parts.join('+');
  }

  private _applyRebind(id: string, combo: string): void {
    // Reserved-key guard.
    const owner = reservedKeyOwner(combo);
    if (owner && owner !== id) {
      this._cancelCapture();
      this._flash(`${combo} is reserved for "${owner}".`, true);
      this._renderList();
      return;
    }

    const defaultKey = this._keybindings.lookupKeybinding(id);
    const others = this._keybindings.getCommandsForKey(combo).filter((c) => c !== id);

    this._keybindings.setUserKeybinding(id, combo);
    setKbOverride(id, combo, defaultKey);
    this._cancelCapture();
    this._renderList();

    if (others.length > 0) {
      this._flash(`${combo} also used by ${others.length} other command(s); newest wins.`, false);
    } else {
      this._flash(`Bound to ${combo}.`, false);
    }
  }

  private _reset(id: string): void {
    const prev = clearKbOverride(id);
    this._keybindings.clearUserKeybinding(id, prev?.default);
    this._renderList();
    this._flash('Reset to default.', false);
  }

  private _flash(message: string, isError: boolean): void {
    let toast = this._root.querySelector('.kbs__toast') as HTMLElement | null;
    if (!toast) {
      toast = $('div.kbs__toast');
      this._root.appendChild(toast);
    }
    toast.textContent = message;
    toast.classList.toggle('kbs__toast--error', isError);
    toast.classList.add('kbs__toast--show');
    window.setTimeout(() => toast?.classList.remove('kbs__toast--show'), 2200);
  }
}
