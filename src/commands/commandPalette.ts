// commandPalette.ts — minimal command palette overlay
//
// A lightweight overlay that lists all registered commands with fuzzy
// search filtering, keyboard navigation, and keybinding display.
// Opens via Ctrl+Shift+P (or programmatic call). Recent commands float
// to the top of the list.
//
// Implementation uses a simple overlay div as specified in the milestone doc.
// No external dependencies — all filtering and rendering is vanilla DOM.

import { Disposable, IDisposable } from '../platform/lifecycle.js';
import { Emitter, Event } from '../platform/events.js';
import type { CommandDescriptor } from './commandTypes.js';
import type { CommandService } from './commandRegistry.js';

// ─── Constants ───────────────────────────────────────────────────────────────

const MAX_VISIBLE_ITEMS = 15;
const MAX_RECENT = 5;
const PALETTE_WIDTH = 600;
const RECENT_STORAGE_KEY = 'parallx:commandPalette:recent';

// ─── Fuzzy match ─────────────────────────────────────────────────────────────

/**
 * Simple fuzzy match: every character in the query must appear in order
 * within the target (case-insensitive). Returns a score (lower is better)
 * or -1 if no match.
 */
function fuzzyScore(query: string, target: string): number {
  const q = query.toLowerCase();
  const t = target.toLowerCase();
  let qi = 0;
  let score = 0;
  let lastMatchIndex = -1;

  for (let ti = 0; ti < t.length && qi < q.length; ti++) {
    if (t[ti] === q[qi]) {
      // Bonus for consecutive matches
      const gap = lastMatchIndex >= 0 ? ti - lastMatchIndex - 1 : ti;
      score += gap;
      lastMatchIndex = ti;
      qi++;
    }
  }

  return qi === q.length ? score : -1;
}

// ─── Palette Item ────────────────────────────────────────────────────────────

interface PaletteItem {
  descriptor: Readonly<CommandDescriptor>;
  score: number;
  isRecent: boolean;
}

// ─── CommandPalette ──────────────────────────────────────────────────────────

/** Minimal shape to avoid circular import. */
interface IContextKeyServiceLike {
  contextMatchesRules(whenClause: string | undefined): boolean;
}

export class CommandPalette extends Disposable {
  private _overlay: HTMLElement | null = null;
  private _input: HTMLInputElement | null = null;
  private _listEl: HTMLElement | null = null;
  private _items: PaletteItem[] = [];
  private _selectedIndex = 0;
  private _visible = false;
  private _recentCommandIds: string[] = [];
  private _contextKeyService: IContextKeyServiceLike | undefined;

  private readonly _onDidExecute = this._register(new Emitter<string>());
  readonly onDidExecute: Event<string> = this._onDidExecute.event;

  private readonly _onDidHide = this._register(new Emitter<void>());
  readonly onDidHide: Event<void> = this._onDidHide.event;

  constructor(
    private readonly _commandService: CommandService,
    private readonly _container: HTMLElement,
  ) {
    super();
    this._loadRecent();
    this._registerGlobalKeybinding();

    // Track executed commands for recents
    this._register(this._commandService.onDidExecuteCommand((e) => {
      this._pushRecent(e.commandId);
    }));
  }

  /**
   * Set the context key service for when-clause filtering in the palette.
   * Commands whose when-clause is not satisfied will be hidden.
   */
  setContextKeyService(service: IContextKeyServiceLike): void {
    this._contextKeyService = service;
  }

  // ─── Public API ──────────────────────────────────────────────────────────

  get visible(): boolean {
    return this._visible;
  }

  show(): void {
    if (this._visible) return;
    this._visible = true;
    this._createDOM();
    this._updateList('');
    this._input?.focus();
  }

  hide(): void {
    if (!this._visible) return;
    this._visible = false;
    this._destroyDOM();
    this._onDidHide.fire();
  }

  toggle(): void {
    if (this._visible) {
      this.hide();
    } else {
      this.show();
    }
  }

  // ─── Recent commands ─────────────────────────────────────────────────────

  private _loadRecent(): void {
    try {
      const raw = localStorage.getItem(RECENT_STORAGE_KEY);
      this._recentCommandIds = raw ? JSON.parse(raw) : [];
    } catch {
      this._recentCommandIds = [];
    }
  }

  private _saveRecent(): void {
    try {
      localStorage.setItem(RECENT_STORAGE_KEY, JSON.stringify(this._recentCommandIds));
    } catch {
      // storage full — ignore
    }
  }

  private _pushRecent(commandId: string): void {
    this._recentCommandIds = [
      commandId,
      ...this._recentCommandIds.filter((id) => id !== commandId),
    ].slice(0, MAX_RECENT);
    this._saveRecent();
  }

  // ─── Global keybinding ───────────────────────────────────────────────────

  private _registerGlobalKeybinding(): void {
    const handler = (e: KeyboardEvent) => {
      // Ctrl+Shift+P or Cmd+Shift+P
      if ((e.ctrlKey || e.metaKey) && e.shiftKey && e.key === 'P') {
        e.preventDefault();
        e.stopPropagation();
        this.toggle();
      }
      // F1 as alternative
      if (e.key === 'F1') {
        e.preventDefault();
        e.stopPropagation();
        this.toggle();
      }
    };
    document.addEventListener('keydown', handler, true);
    this._register({ dispose: () => document.removeEventListener('keydown', handler, true) });
  }

  // ─── DOM creation ────────────────────────────────────────────────────────

  private _createDOM(): void {
    // Overlay backdrop
    const overlay = document.createElement('div');
    overlay.className = 'command-palette-overlay';
    overlay.addEventListener('mousedown', (e) => {
      if (e.target === overlay) this.hide();
    });

    // Palette container
    const palette = document.createElement('div');
    palette.className = 'command-palette';

    // Input
    const input = document.createElement('input');
    input.className = 'command-palette-input';
    input.type = 'text';
    input.placeholder = 'Type a command name…';
    input.spellcheck = false;
    input.autocomplete = 'off';
    input.addEventListener('input', () => this._onInputChanged());
    input.addEventListener('keydown', (e) => this._onInputKeydown(e));

    // List
    const list = document.createElement('div');
    list.className = 'command-palette-list';
    list.setAttribute('role', 'listbox');

    palette.appendChild(input);
    palette.appendChild(list);
    overlay.appendChild(palette);
    this._container.appendChild(overlay);

    this._overlay = overlay;
    this._input = input;
    this._listEl = list;
  }

  private _destroyDOM(): void {
    if (this._overlay) {
      this._overlay.remove();
      this._overlay = null;
      this._input = null;
      this._listEl = null;
    }
  }

  // ─── Input handling ──────────────────────────────────────────────────────

  private _onInputChanged(): void {
    const query = this._input?.value ?? '';
    this._updateList(query);
  }

  private _onInputKeydown(e: KeyboardEvent): void {
    switch (e.key) {
      case 'ArrowDown':
        e.preventDefault();
        this._moveSelection(1);
        break;
      case 'ArrowUp':
        e.preventDefault();
        this._moveSelection(-1);
        break;
      case 'Enter':
        e.preventDefault();
        this._executeSelected();
        break;
      case 'Escape':
        e.preventDefault();
        this.hide();
        break;
    }
  }

  // ─── List rendering ──────────────────────────────────────────────────────

  private _updateList(query: string): void {
    const commands = this._commandService.getCommands();
    const recentSet = new Set(this._recentCommandIds);

    const items: PaletteItem[] = [];

    for (const [, desc] of commands) {
      // Filter by when-clause: commands whose precondition is not met are hidden
      if (desc.when && this._contextKeyService) {
        if (!this._contextKeyService.contextMatchesRules(desc.when)) {
          continue;
        }
      }

      const searchText = desc.category
        ? `${desc.category}: ${desc.title}`
        : desc.title;

      if (query.length === 0) {
        items.push({ descriptor: desc, score: 0, isRecent: recentSet.has(desc.id) });
      } else {
        const score = fuzzyScore(query, searchText);
        if (score >= 0) {
          items.push({ descriptor: desc, score, isRecent: recentSet.has(desc.id) });
        }
      }
    }

    // Sort: recents first (when no active query), then by score, then alphabetically
    items.sort((a, b) => {
      if (query.length === 0) {
        // Recently used float to top
        if (a.isRecent && !b.isRecent) return -1;
        if (!a.isRecent && b.isRecent) return 1;
        if (a.isRecent && b.isRecent) {
          // Preserve recent order
          return this._recentCommandIds.indexOf(a.descriptor.id) -
                 this._recentCommandIds.indexOf(b.descriptor.id);
        }
      }
      if (a.score !== b.score) return a.score - b.score;
      return a.descriptor.title.localeCompare(b.descriptor.title);
    });

    this._items = items;
    this._selectedIndex = items.length > 0 ? 0 : -1;
    this._renderItems();
  }

  private _renderItems(): void {
    const list = this._listEl;
    if (!list) return;

    list.innerHTML = '';

    if (this._items.length === 0) {
      const empty = document.createElement('div');
      empty.className = 'command-palette-empty';
      empty.textContent = 'No matching commands';
      list.appendChild(empty);
      return;
    }

    const visibleItems = this._items.slice(0, MAX_VISIBLE_ITEMS);
    let lastWasRecent = false;

    for (let i = 0; i < visibleItems.length; i++) {
      const item = visibleItems[i];

      // Separator between recents and other commands
      if (lastWasRecent && !item.isRecent && this._input?.value === '') {
        const sep = document.createElement('div');
        sep.className = 'command-palette-separator';
        list.appendChild(sep);
      }
      lastWasRecent = item.isRecent;

      const row = document.createElement('div');
      row.className = 'command-palette-item';
      if (i === this._selectedIndex) {
        row.classList.add('selected');
      }
      row.setAttribute('role', 'option');
      row.setAttribute('aria-selected', i === this._selectedIndex ? 'true' : 'false');

      // Label
      const label = document.createElement('span');
      label.className = 'command-palette-item-label';
      if (item.descriptor.category) {
        const cat = document.createElement('span');
        cat.className = 'command-palette-item-category';
        cat.textContent = `${item.descriptor.category}: `;
        label.appendChild(cat);
      }
      const title = document.createTextNode(item.descriptor.title);
      label.appendChild(title);

      // Recently used badge
      if (item.isRecent && this._input?.value === '') {
        const badge = document.createElement('span');
        badge.className = 'command-palette-recent-badge';
        badge.textContent = 'recently used';
        label.appendChild(badge);
      }

      row.appendChild(label);

      // Keybinding
      if (item.descriptor.keybinding) {
        const kbd = document.createElement('span');
        kbd.className = 'command-palette-item-keybinding';
        kbd.textContent = item.descriptor.keybinding;
        row.appendChild(kbd);
      }

      // Mouse events
      row.addEventListener('mouseenter', () => {
        this._selectedIndex = i;
        this._updateSelection();
      });

      row.addEventListener('click', (e) => {
        e.preventDefault();
        this._selectedIndex = i;
        this._executeSelected();
      });

      list.appendChild(row);
    }

    // Show count if truncated
    if (this._items.length > MAX_VISIBLE_ITEMS) {
      const more = document.createElement('div');
      more.className = 'command-palette-more';
      more.textContent = `${this._items.length - MAX_VISIBLE_ITEMS} more…`;
      list.appendChild(more);
    }
  }

  // ─── Selection management ────────────────────────────────────────────────

  private _moveSelection(delta: number): void {
    if (this._items.length === 0) return;
    const maxIdx = Math.min(this._items.length, MAX_VISIBLE_ITEMS) - 1;
    this._selectedIndex = Math.max(0, Math.min(maxIdx, this._selectedIndex + delta));
    this._updateSelection();
  }

  private _updateSelection(): void {
    if (!this._listEl) return;
    const rows = this._listEl.querySelectorAll('.command-palette-item');
    rows.forEach((row, i) => {
      row.classList.toggle('selected', i === this._selectedIndex);
      row.setAttribute('aria-selected', i === this._selectedIndex ? 'true' : 'false');
    });
  }

  // ─── Execution ───────────────────────────────────────────────────────────

  private _executeSelected(): void {
    const item = this._items[this._selectedIndex];
    if (!item) return;

    const commandId = item.descriptor.id;
    this.hide();

    // Execute async — fire-and-forget; errors are logged by CommandService
    this._commandService.executeCommand(commandId).catch((err) => {
      console.error('[CommandPalette] Failed to execute command:', commandId, err);
    });

    this._onDidExecute.fire(commandId);
  }

  // ─── Dispose ─────────────────────────────────────────────────────────────

  override dispose(): void {
    this._destroyDOM();
    super.dispose();
  }
}
