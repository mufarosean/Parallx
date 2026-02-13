// findReplaceWidget.ts — inline Find & Replace overlay widget
//
// Reusable find/replace bar that overlays an editor pane.
// Mirrors VS Code's FindWidget (src/vs/editor/contrib/find/browser/findWidget.ts)
// but simplified for a <textarea>-based editor.
//
// Features:
//   • Find with match highlighting via text selection
//   • Case-sensitive, whole-word, regex toggles
//   • Previous / Next navigation (Enter / Shift+Enter)
//   • Replace / Replace All
//   • Match count badge ("3 of 12")
//   • Escape to close, Ctrl+F to re-focus
//
// Usage:
//   const widget = new FindReplaceWidget(editorPaneElement);
//   widget.show();            // opens find bar
//   widget.show(true);        // opens find+replace bar
//   widget.hide();            // closes
//   widget.dispose();         // cleanup

import { Disposable } from '../platform/lifecycle.js';
import { Emitter, type Event } from '../platform/events.js';
import { $, addDisposableListener } from './dom.js';

// ─── Types ───────────────────────────────────────────────────────────────────

export interface FindMatch {
  /** Character offset from start of text content. */
  readonly start: number;
  /** Length of the matched text. */
  readonly length: number;
}

export interface FindReplaceWidgetOptions {
  /** The textarea (or similar) whose content is searched. */
  readonly textarea: HTMLTextAreaElement;
}

// ─── FindReplaceWidget ───────────────────────────────────────────────────────

export class FindReplaceWidget extends Disposable {
  readonly element: HTMLElement;

  private readonly _textarea: HTMLTextAreaElement;

  // DOM elements
  private readonly _findInput: HTMLInputElement;
  private readonly _replaceInput: HTMLInputElement;
  private readonly _replaceRow: HTMLElement;
  private readonly _matchCountEl: HTMLElement;
  private readonly _btnCaseSensitive: HTMLButtonElement;
  private readonly _btnWholeWord: HTMLButtonElement;
  private readonly _btnRegex: HTMLButtonElement;
  private readonly _toggleReplaceBtn: HTMLButtonElement;

  // State
  private _visible = false;
  private _showReplace = false;
  private _caseSensitive = false;
  private _wholeWord = false;
  private _useRegex = false;
  private _matches: FindMatch[] = [];
  private _currentMatchIndex = -1;

  // Events
  private readonly _onDidClose = this._register(new Emitter<void>());
  readonly onDidClose: Event<void> = this._onDidClose.event;

  constructor(container: HTMLElement, options: FindReplaceWidgetOptions) {
    super();
    this._textarea = options.textarea;

    // ── Root element ──
    this.element = $('div.find-replace-widget');
    this.element.style.display = 'none'; // hidden initially

    // ── Toggle replace button (left edge) ──
    this._toggleReplaceBtn = document.createElement('button');
    this._toggleReplaceBtn.className = 'find-replace-toggle-btn';
    this._toggleReplaceBtn.title = 'Toggle Replace';
    this._toggleReplaceBtn.setAttribute('aria-label', 'Toggle Replace');
    this._toggleReplaceBtn.innerHTML = '<svg width="14" height="14" viewBox="0 0 16 16"><path d="M11 3.5L7.5 0 6 1.5 8 3.5H4.5A3.5 3.5 0 001 7v1h1.5V7A2 2 0 014.5 5H8l-2 2L7.5 8.5 11 5V3.5z" fill="currentColor"/></svg>';
    this.element.appendChild(this._toggleReplaceBtn);

    // ── Main content area ──
    const mainArea = $('div.find-replace-main');

    // ── Find row ──
    const findRow = $('div.find-replace-row');

    // Find input
    this._findInput = document.createElement('input');
    this._findInput.type = 'text';
    this._findInput.className = 'find-replace-input';
    this._findInput.placeholder = 'Find';
    this._findInput.spellcheck = false;
    this._findInput.autocomplete = 'off';
    this._findInput.setAttribute('aria-label', 'Find');
    findRow.appendChild(this._findInput);

    // Option toggles
    const optionBar = $('div.find-replace-options');

    this._btnCaseSensitive = this._createToggle('Aa', 'Match Case', optionBar, () => {
      this._caseSensitive = !this._caseSensitive;
      this._btnCaseSensitive.classList.toggle('active', this._caseSensitive);
      this._runSearch();
    });

    this._btnWholeWord = this._createToggle('Ab|', 'Match Whole Word', optionBar, () => {
      this._wholeWord = !this._wholeWord;
      this._btnWholeWord.classList.toggle('active', this._wholeWord);
      this._runSearch();
    });

    this._btnRegex = this._createToggle('.*', 'Use Regular Expression', optionBar, () => {
      this._useRegex = !this._useRegex;
      this._btnRegex.classList.toggle('active', this._useRegex);
      this._runSearch();
    });

    findRow.appendChild(optionBar);

    // Match count
    this._matchCountEl = $('span.find-replace-match-count');
    this._matchCountEl.textContent = 'No results';
    findRow.appendChild(this._matchCountEl);

    // Navigation buttons
    const navBar = $('div.find-replace-nav');

    this._createActionBtn('↑', 'Previous Match (Shift+Enter)', navBar, () => this.previousMatch());
    this._createActionBtn('↓', 'Next Match (Enter)', navBar, () => this.nextMatch());
    this._createActionBtn('✕', 'Close (Escape)', navBar, () => this.hide());

    findRow.appendChild(navBar);
    mainArea.appendChild(findRow);

    // ── Replace row ──
    this._replaceRow = $('div.find-replace-row.find-replace-row--replace');
    this._replaceRow.style.display = 'none';

    this._replaceInput = document.createElement('input');
    this._replaceInput.type = 'text';
    this._replaceInput.className = 'find-replace-input';
    this._replaceInput.placeholder = 'Replace';
    this._replaceInput.spellcheck = false;
    this._replaceInput.autocomplete = 'off';
    this._replaceInput.setAttribute('aria-label', 'Replace');
    this._replaceRow.appendChild(this._replaceInput);

    // Replace action buttons
    const replaceActions = $('div.find-replace-nav');

    this._createActionBtn('⟶', 'Replace (Ctrl+Shift+1)', replaceActions, () => this.replaceCurrent());
    this._createActionBtn('⟶⟶', 'Replace All (Ctrl+Alt+Enter)', replaceActions, () => this.replaceAll());

    this._replaceRow.appendChild(replaceActions);
    mainArea.appendChild(this._replaceRow);

    this.element.appendChild(mainArea);

    // ── Insert into container ──
    container.appendChild(this.element);

    // ── Wire events ──
    this._register(addDisposableListener(this._findInput, 'input', () => {
      this._runSearch();
    }));

    this._register(addDisposableListener(this._findInput, 'keydown', (e) => {
      if (e.key === 'Enter') {
        e.preventDefault();
        if (e.shiftKey) {
          this.previousMatch();
        } else {
          this.nextMatch();
        }
      } else if (e.key === 'Escape') {
        e.preventDefault();
        this.hide();
      }
    }));

    this._register(addDisposableListener(this._replaceInput, 'keydown', (e) => {
      if (e.key === 'Enter') {
        e.preventDefault();
        if (e.ctrlKey && e.altKey) {
          this.replaceAll();
        } else {
          this.replaceCurrent();
        }
      } else if (e.key === 'Escape') {
        e.preventDefault();
        this.hide();
      }
    }));

    this._register(addDisposableListener(this._toggleReplaceBtn, 'click', () => {
      this._showReplace = !this._showReplace;
      this._toggleReplaceBtn.classList.toggle('active', this._showReplace);
      this._replaceRow.style.display = this._showReplace ? '' : 'none';
      if (this._showReplace) {
        this._replaceInput.focus();
      }
    }));
  }

  // ── Public API ──────────────────────────────────────────────────────────

  get visible(): boolean {
    return this._visible;
  }

  /**
   * Show the find widget. If `withReplace` is true, also expand the replace row.
   * Populates the find input with the current selection if available.
   */
  show(withReplace = false): void {
    this._visible = true;
    this.element.style.display = '';

    // If the textarea has a selection, seed the find input with it
    const sel = this._textarea.value.substring(
      this._textarea.selectionStart,
      this._textarea.selectionEnd,
    );
    if (sel && !sel.includes('\n')) {
      this._findInput.value = sel;
    }

    // Show/hide replace
    this._showReplace = withReplace;
    this._toggleReplaceBtn.classList.toggle('active', withReplace);
    this._replaceRow.style.display = withReplace ? '' : 'none';

    this._findInput.focus();
    this._findInput.select();
    this._runSearch();
  }

  /** Hide the find widget and clear highlighting. */
  hide(): void {
    if (!this._visible) return;
    this._visible = false;
    this.element.style.display = 'none';
    this._matches = [];
    this._currentMatchIndex = -1;
    this._updateMatchCount();

    // Restore focus to editor
    this._textarea.focus();
    this._onDidClose.fire();
  }

  /** Focus the find input (for re-triggering Ctrl+F when already open). */
  focusFind(): void {
    this._findInput.focus();
    this._findInput.select();
  }

  /** Focus the replace input. */
  focusReplace(): void {
    this._replaceInput.focus();
    this._replaceInput.select();
  }

  /** Navigate to the next match. */
  nextMatch(): void {
    if (this._matches.length === 0) return;
    this._currentMatchIndex = (this._currentMatchIndex + 1) % this._matches.length;
    this._selectCurrentMatch();
    this._updateMatchCount();
  }

  /** Navigate to the previous match. */
  previousMatch(): void {
    if (this._matches.length === 0) return;
    this._currentMatchIndex = (this._currentMatchIndex - 1 + this._matches.length) % this._matches.length;
    this._selectCurrentMatch();
    this._updateMatchCount();
  }

  /** Replace the current match with the replace text. */
  replaceCurrent(): void {
    if (this._matches.length === 0 || this._currentMatchIndex < 0) return;

    const match = this._matches[this._currentMatchIndex];
    const text = this._textarea.value;
    const replacement = this._replaceInput.value;

    this._textarea.value =
      text.substring(0, match.start) +
      replacement +
      text.substring(match.start + match.length);

    // Fire input event so the editor model syncs
    this._textarea.dispatchEvent(new Event('input', { bubbles: true }));

    // Re-run search (matches shifted)
    this._runSearch();

    // Keep current index in range
    if (this._currentMatchIndex >= this._matches.length) {
      this._currentMatchIndex = 0;
    }
    if (this._matches.length > 0) {
      this._selectCurrentMatch();
    }
  }

  /** Replace all matches with the replace text. */
  replaceAll(): void {
    const query = this._findInput.value;
    if (!query) return;

    const regex = this._buildRegex(query);
    if (!regex) return;

    const replacement = this._replaceInput.value;
    this._textarea.value = this._textarea.value.replace(regex, replacement);

    // Fire input event so the editor model syncs
    this._textarea.dispatchEvent(new Event('input', { bubbles: true }));

    this._runSearch();
  }

  // ── Internal ────────────────────────────────────────────────────────────

  private _runSearch(): void {
    const query = this._findInput.value;
    this._matches = [];
    this._currentMatchIndex = -1;

    if (!query) {
      this._updateMatchCount();
      return;
    }

    const regex = this._buildRegex(query);
    if (!regex) {
      this._matchCountEl.textContent = 'Invalid regex';
      this._matchCountEl.classList.add('find-replace-match-count--no-results');
      return;
    }

    const text = this._textarea.value;
    let m: RegExpExecArray | null;

    // eslint-disable-next-line no-cond-assign
    while ((m = regex.exec(text)) !== null) {
      this._matches.push({ start: m.index, length: m[0].length });
      // Safety: prevent infinite loop with zero-length matches
      if (m[0].length === 0) regex.lastIndex++;
      if (this._matches.length > 50_000) break; // hard cap
    }

    if (this._matches.length > 0) {
      // Find the match closest to the current cursor position
      const cursor = this._textarea.selectionStart;
      let best = 0;
      for (let i = 0; i < this._matches.length; i++) {
        if (this._matches[i].start >= cursor) { best = i; break; }
        best = i;
      }
      this._currentMatchIndex = best;
      this._selectCurrentMatch();
    }

    this._updateMatchCount();
  }

  private _buildRegex(query: string): RegExp | null {
    try {
      let pattern: string;
      if (this._useRegex) {
        pattern = query;
      } else {
        pattern = query.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
      }

      if (this._wholeWord) {
        pattern = `\\b${pattern}\\b`;
      }

      const flags = this._caseSensitive ? 'g' : 'gi';
      return new RegExp(pattern, flags);
    } catch {
      return null;
    }
  }

  private _selectCurrentMatch(): void {
    if (this._currentMatchIndex < 0 || this._currentMatchIndex >= this._matches.length) return;

    const match = this._matches[this._currentMatchIndex];
    this._textarea.focus();
    this._textarea.setSelectionRange(match.start, match.start + match.length);

    // Scroll into view: set selectionStart briefly to force scroll
    // The native textarea will auto-scroll to show the selection
    this._scrollToSelection(match.start);
  }

  private _scrollToSelection(offset: number): void {
    // Trick: briefly set value to force scroll position update
    // The browser scrolls textarea to keep the caret visible
    const ta = this._textarea;
    const origScrollTop = ta.scrollTop;

    // Estimate line height and line position
    const textBefore = ta.value.substring(0, offset);
    const lineNumber = textBefore.split('\n').length;
    const lineHeight = parseFloat(getComputedStyle(ta).lineHeight) || 18;
    const desiredScrollTop = (lineNumber - 3) * lineHeight;

    if (desiredScrollTop < origScrollTop || desiredScrollTop > origScrollTop + ta.clientHeight) {
      ta.scrollTop = Math.max(0, desiredScrollTop);
    }
  }

  private _updateMatchCount(): void {
    if (this._matches.length === 0) {
      const hasQuery = this._findInput.value.length > 0;
      this._matchCountEl.textContent = hasQuery ? 'No results' : '';
      this._matchCountEl.classList.toggle('find-replace-match-count--no-results', hasQuery);
    } else {
      this._matchCountEl.textContent = `${this._currentMatchIndex + 1} of ${this._matches.length}`;
      this._matchCountEl.classList.remove('find-replace-match-count--no-results');
    }
  }

  private _createToggle(
    label: string,
    title: string,
    parent: HTMLElement,
    onClick: () => void,
  ): HTMLButtonElement {
    const btn = document.createElement('button');
    btn.className = 'find-replace-option-btn';
    btn.textContent = label;
    btn.title = title;
    btn.setAttribute('aria-label', title);
    this._register(addDisposableListener(btn, 'click', onClick));
    parent.appendChild(btn);
    return btn;
  }

  private _createActionBtn(
    label: string,
    title: string,
    parent: HTMLElement,
    onClick: () => void,
  ): HTMLButtonElement {
    const btn = document.createElement('button');
    btn.className = 'find-replace-action-btn';
    btn.textContent = label;
    btn.title = title;
    btn.setAttribute('aria-label', title);
    this._register(addDisposableListener(btn, 'click', onClick));
    parent.appendChild(btn);
    return btn;
  }

  override dispose(): void {
    this.element.remove();
    super.dispose();
  }
}
