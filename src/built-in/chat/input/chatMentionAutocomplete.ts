// chatMentionAutocomplete.ts — @mention autocomplete dropdown (M11 Task 3.1)
//
// Detects `@` keystroke in the chat textarea, shows a dropdown with:
//   - Special scopes: @workspace, @terminal, @file:, @folder:
//   - File names (from workspace index)
//   - Folder names
// Fuzzy search narrows results as the user types after `@`.
//
// Also detects `/` at start-of-message for slash command autocomplete (Task 3.5).
//
// VS Code reference:
//   src/vs/workbench/contrib/chat/browser/chatInputPart.ts (mention detection)
//   src/vs/workbench/contrib/chat/common/chatVariables.ts (variable resolution)

import { Disposable } from '../../../platform/lifecycle.js';
import { Emitter } from '../../../platform/events.js';
import type { Event } from '../../../platform/events.js';
import { $, addDisposableListener } from '../../../ui/dom.js';
import { chatIcons } from '../chatIcons.js';
import type { IMentionSuggestion, IMentionAcceptEvent, IMentionSuggestionProvider, ISlashCommandProvider } from '../chatTypes.js';

// Mention & autocomplete types — now defined in chatTypes.ts (M13 Phase 1)
export type { IMentionSuggestion, IMentionAcceptEvent, IMentionSuggestionProvider, ISlashCommandProvider } from '../chatTypes.js';

// ── Built-in scopes ──

const BUILTIN_SCOPES: IMentionSuggestion[] = [
  {
    label: 'workspace',
    kind: 'scope',
    description: 'Search entire workspace with RAG',
    insertText: '@workspace ',
    sortOrder: 0,
  },
  {
    label: 'terminal',
    kind: 'scope',
    description: 'Include terminal output',
    insertText: '@terminal ',
    sortOrder: 1,
  },
  {
    label: 'file:',
    kind: 'scope',
    description: 'Attach a specific file',
    insertText: '@file:',
    sortOrder: 2,
  },
  {
    label: 'folder:',
    kind: 'scope',
    description: 'Attach all files in a folder',
    insertText: '@folder:',
    sortOrder: 3,
  },
];

// ── Fuzzy matching ──

/**
 * Simple fuzzy match: all characters of the query appear in order in the target.
 * Returns a score (lower = better match), or -1 if no match.
 */
function fuzzyScore(query: string, target: string): number {
  const q = query.toLowerCase();
  const t = target.toLowerCase();
  if (q.length === 0) { return 0; }
  if (q.length > t.length) { return -1; }

  let qi = 0;
  let score = 0;
  let lastMatchIdx = -1;

  for (let ti = 0; ti < t.length && qi < q.length; ti++) {
    if (t[ti] === q[qi]) {
      // Bonus for consecutive matches
      const gap = lastMatchIdx >= 0 ? ti - lastMatchIdx - 1 : ti;
      score += gap;
      // Bonus for matching at word start
      if (ti === 0 || t[ti - 1] === '/' || t[ti - 1] === '\\' || t[ti - 1] === '.' || t[ti - 1] === '-' || t[ti - 1] === '_') {
        score -= 5; // bonus (reduce score)
      }
      lastMatchIdx = ti;
      qi++;
    }
  }

  return qi === q.length ? score : -1;
}

// ── ChatMentionAutocomplete ──

/**
 * Autocomplete overlay for @mentions and /commands in the chat textarea.
 *
 * Attach to a textarea element. Listens for `@` and `/` triggers,
 * shows a positioned dropdown, and handles keyboard navigation.
 */
export class ChatMentionAutocomplete extends Disposable {

  // ── State ──

  private _dropdown: HTMLElement | undefined;
  private _items: HTMLElement[] = [];
  private _activeIndex = -1;
  private _triggerStart = -1;
  private _triggerChar: '@' | '/' | '' = '';
  private _isOpen = false;
  private _suggestionProvider: IMentionSuggestionProvider | undefined;
  private _commandProvider: ISlashCommandProvider | undefined;

  /** Cached workspace file list — loaded lazily on first trigger. */
  private _fileCache: Array<{ name: string; relativePath: string; isDirectory: boolean }> | undefined;
  private _fileCachePromise: Promise<void> | undefined;

  // ── Events ──

  private readonly _onDidAccept = this._register(new Emitter<IMentionAcceptEvent>());
  readonly onDidAccept: Event<IMentionAcceptEvent> = this._onDidAccept.event;

  // ── DOM references ──

  private readonly _textarea: HTMLTextAreaElement;
  private readonly _anchor: HTMLElement;

  constructor(textarea: HTMLTextAreaElement, anchor: HTMLElement) {
    super();
    this._textarea = textarea;
    this._anchor = anchor;

    // Listen for input changes to detect triggers
    this._register(addDisposableListener(this._textarea, 'input', () => {
      this._onInput();
    }));

    // Intercept keydown for navigation when dropdown is open
    this._register(addDisposableListener(this._textarea, 'keydown', (e) => {
      if (!this._isOpen) { return; }
      this._onKeydown(e);
    }));

    // Close on blur (with slight delay so click on dropdown item registers)
    this._register(addDisposableListener(this._textarea, 'blur', () => {
      setTimeout(() => this.close(), 150);
    }));
  }

  // ── Public API ──

  /** Wire the workspace file provider. */
  setSuggestionProvider(provider: IMentionSuggestionProvider): void {
    this._suggestionProvider = provider;
    this._fileCache = undefined;
    this._fileCachePromise = undefined;
  }

  /** Wire the slash command provider. */
  setCommandProvider(provider: ISlashCommandProvider): void {
    this._commandProvider = provider;
  }

  /** Whether the dropdown is currently visible. */
  get isOpen(): boolean {
    return this._isOpen;
  }

  /** Close the dropdown. */
  close(): void {
    if (this._dropdown) {
      this._dropdown.remove();
      this._dropdown = undefined;
    }
    this._items = [];
    this._activeIndex = -1;
    this._triggerStart = -1;
    this._triggerChar = '';
    this._isOpen = false;
  }

  // ── Internal: Input Handling ──

  private _onInput(): void {
    const value = this._textarea.value;
    const cursor = this._textarea.selectionStart;

    // If the dropdown is open, update filtering
    if (this._isOpen) {
      this._updateSuggestions();
      return;
    }

    // Check for @ trigger
    if (cursor > 0 && value[cursor - 1] === '@') {
      // Only trigger if @ is at start or preceded by whitespace
      if (cursor === 1 || /\s/.test(value[cursor - 2])) {
        this._triggerStart = cursor - 1;
        this._triggerChar = '@';
        this._openMentionDropdown();
        return;
      }
    }

    // Check for / command trigger — only at very start of input
    if (cursor === 1 && value[0] === '/') {
      this._triggerStart = 0;
      this._triggerChar = '/';
      this._openCommandDropdown();
      return;
    }
  }

  /** Get the current query text (everything after the trigger character). */
  private _getQuery(): string {
    if (this._triggerStart < 0) { return ''; }
    const cursor = this._textarea.selectionStart;
    return this._textarea.value.substring(this._triggerStart + 1, cursor);
  }

  // ── @Mention Dropdown ──

  private _openMentionDropdown(): void {
    this.close();
    this._triggerChar = '@';
    this._isOpen = true;

    // Ensure file cache is loading
    this._ensureFileCache();

    this._createDropdown();
    this._renderMentionSuggestions('');
  }

  private _renderMentionSuggestions(query: string): void {
    if (!this._dropdown) { return; }

    const listContainer = this._dropdown.querySelector('.parallx-mention-list') as HTMLElement;
    if (!listContainer) { return; }
    listContainer.innerHTML = '';
    this._items = [];
    this._activeIndex = -1;

    // Gather all suggestions
    const suggestions: (IMentionSuggestion & { score: number })[] = [];

    // Built-in scopes
    for (const scope of BUILTIN_SCOPES) {
      const score = query ? fuzzyScore(query, scope.label) : (scope.sortOrder ?? 0);
      if (score >= 0 || !query) {
        suggestions.push({ ...scope, score: query ? score : (scope.sortOrder ?? 0) });
      }
    }

    // File/folder suggestions (from cache)
    if (this._fileCache) {
      // If query starts with "file:" or "folder:", filter accordingly
      let fileQuery = query;
      let filterDirs: boolean | undefined;
      if (query.startsWith('file:')) {
        fileQuery = query.substring(5);
        filterDirs = false;
      } else if (query.startsWith('folder:')) {
        fileQuery = query.substring(7);
        filterDirs = true;
      }

      for (const entry of this._fileCache) {
        if (filterDirs !== undefined && entry.isDirectory !== filterDirs) { continue; }
        const score = fileQuery ? fuzzyScore(fileQuery, entry.relativePath) : 100;
        if (score >= 0 || !fileQuery) {
          suggestions.push({
            label: entry.name,
            kind: entry.isDirectory ? 'folder' : 'file',
            description: entry.relativePath,
            insertText: entry.isDirectory
              ? `@folder:${entry.relativePath} `
              : `@file:${entry.relativePath} `,
            score: query ? score + 10 : 100, // scopes rank above files
          });
        }
      }
    }

    // Sort by score
    suggestions.sort((a, b) => a.score - b.score);

    // Limit to 20 items
    const shown = suggestions.slice(0, 20);

    if (shown.length === 0) {
      const empty = $('div.parallx-mention-empty', 'No matches');
      listContainer.appendChild(empty);
      return;
    }

    for (const suggestion of shown) {
      const item = this._createSuggestionItem(suggestion);
      listContainer.appendChild(item);
      this._items.push(item);
    }

    // Activate first item
    if (this._items.length > 0) {
      this._setActive(0);
    }
  }

  // ── /Command Dropdown ──

  private _openCommandDropdown(): void {
    this.close();
    this._triggerChar = '/';
    this._isOpen = true;

    this._createDropdown();
    this._renderCommandSuggestions('');
  }

  private _renderCommandSuggestions(query: string): void {
    if (!this._dropdown) { return; }

    const listContainer = this._dropdown.querySelector('.parallx-mention-list') as HTMLElement;
    if (!listContainer) { return; }
    listContainer.innerHTML = '';
    this._items = [];
    this._activeIndex = -1;

    const commands = this._commandProvider?.getCommands() ?? [];
    const scored: Array<{ name: string; description: string; score: number }> = [];

    for (const cmd of commands) {
      const score = query ? fuzzyScore(query, cmd.name) : 0;
      if (score >= 0 || !query) {
        scored.push({ ...cmd, score: query ? score : 0 });
      }
    }

    scored.sort((a, b) => a.score - b.score);

    if (scored.length === 0) {
      const empty = $('div.parallx-mention-empty', 'No commands');
      listContainer.appendChild(empty);
      return;
    }

    for (const cmd of scored) {
      const suggestion: IMentionSuggestion = {
        label: `/${cmd.name}`,
        kind: 'command',
        description: cmd.description,
        insertText: `/${cmd.name} `,
      };
      const item = this._createSuggestionItem(suggestion);
      listContainer.appendChild(item);
      this._items.push(item);
    }

    if (this._items.length > 0) {
      this._setActive(0);
    }
  }

  // ── Update on typing ──

  private _updateSuggestions(): void {
    const query = this._getQuery();
    if (this._triggerChar === '@') {
      this._renderMentionSuggestions(query);
    } else if (this._triggerChar === '/') {
      this._renderCommandSuggestions(query);
    }

    // Close if user backspaced past the trigger character
    const cursor = this._textarea.selectionStart;
    if (cursor <= this._triggerStart) {
      this.close();
    }
  }

  // ── Keyboard Navigation ──

  private _onKeydown(e: KeyboardEvent): void {
    switch (e.key) {
      case 'ArrowDown':
        e.preventDefault();
        e.stopPropagation();
        this._setActive(Math.min(this._activeIndex + 1, this._items.length - 1));
        break;
      case 'ArrowUp':
        e.preventDefault();
        e.stopPropagation();
        this._setActive(Math.max(this._activeIndex - 1, 0));
        break;
      case 'Enter':
      case 'Tab':
        if (this._activeIndex >= 0) {
          e.preventDefault();
          e.stopPropagation();
          this._acceptActive();
        }
        break;
      case 'Escape':
        e.preventDefault();
        e.stopPropagation();
        this.close();
        this._textarea.focus();
        break;
    }
  }

  private _setActive(index: number): void {
    // Remove old active class
    if (this._activeIndex >= 0 && this._activeIndex < this._items.length) {
      this._items[this._activeIndex].classList.remove('parallx-mention-item--active');
    }
    this._activeIndex = index;
    if (index >= 0 && index < this._items.length) {
      this._items[index].classList.add('parallx-mention-item--active');
      this._items[index].scrollIntoView({ block: 'nearest' });
    }
  }

  private _acceptActive(): void {
    if (this._activeIndex < 0 || this._activeIndex >= this._items.length) { return; }
    const insertText = this._items[this._activeIndex].dataset.insertText;
    if (!insertText) { return; }

    const cursor = this._textarea.selectionStart;
    this._onDidAccept.fire({
      insertText,
      triggerStart: this._triggerStart,
      triggerEnd: cursor,
    });

    this.close();
  }

  // ── DOM ──

  private _createDropdown(): void {
    this._dropdown = $('div.parallx-mention-dropdown');

    const list = $('div.parallx-mention-list');
    this._dropdown.appendChild(list);

    // Position above the textarea (opening upward)
    const anchorRect = this._anchor.getBoundingClientRect();
    this._dropdown.style.position = 'absolute';
    this._dropdown.style.left = `${anchorRect.left}px`;
    this._dropdown.style.bottom = `${window.innerHeight - anchorRect.top + 4}px`;
    this._dropdown.style.zIndex = '200';

    document.body.appendChild(this._dropdown);
  }

  private _createSuggestionItem(suggestion: IMentionSuggestion): HTMLElement {
    const item = $('div.parallx-mention-item');
    item.dataset.insertText = suggestion.insertText;

    // Icon
    const icon = $('span.parallx-mention-item-icon');
    icon.innerHTML = this._iconForKind(suggestion.kind);
    item.appendChild(icon);

    // Text
    const textWrap = $('div.parallx-mention-item-text');

    const label = $('span.parallx-mention-item-label', suggestion.label);
    textWrap.appendChild(label);

    if (suggestion.description) {
      const desc = $('span.parallx-mention-item-desc', suggestion.description);
      textWrap.appendChild(desc);
    }

    item.appendChild(textWrap);

    // Click handler
    item.addEventListener('mousedown', (e) => {
      e.preventDefault(); // Prevent blur
      this._onDidAccept.fire({
        insertText: suggestion.insertText,
        triggerStart: this._triggerStart,
        triggerEnd: this._textarea.selectionStart,
      });
      this.close();
      this._textarea.focus();
    });

    return item;
  }

  private _iconForKind(kind: IMentionSuggestion['kind']): string {
    switch (kind) {
      case 'scope': return chatIcons.atSign;
      case 'file': return chatIcons.file;
      case 'folder': return chatIcons.folder;
      case 'command': return chatIcons.sparkleSmall;
    }
  }

  // ── File Cache ──

  private _ensureFileCache(): void {
    if (this._fileCache || this._fileCachePromise || !this._suggestionProvider) { return; }
    this._fileCachePromise = this._suggestionProvider.listFiles().then((files) => {
      this._fileCache = files;
      // Re-render if still open
      if (this._isOpen && this._triggerChar === '@') {
        this._renderMentionSuggestions(this._getQuery());
      }
    }).catch(() => {
      this._fileCache = [];
    });
  }

  /** Invalidate cached files (call when workspace changes). */
  invalidateCache(): void {
    this._fileCache = undefined;
    this._fileCachePromise = undefined;
  }

  override dispose(): void {
    this.close();
    super.dispose();
  }
}
