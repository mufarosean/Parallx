// pdfSearchBar.ts — the PDF pane's find widget (Ctrl+F).
//
// A field with match-case and whole-word toggles, the match count, previous,
// next and close. Queries go to pdf.js's find controller through the
// viewer's event bus; its count and not-found state come back the same way.

import { PdfFindQueue } from './pdfFindQueue.js';
import { declareControl } from '../../../ui/kit.js';
import type { FindCount, FindOptions, IFindTarget } from '../../../ui/findTargets.js';
import type { EventBus } from 'pdfjs-dist/web/pdf_viewer.mjs';
import { $, hide, show } from '../../../ui/dom.js';
import { setupTooltip } from '../../../ui/tooltip.js';
import { ICON } from './pdfIcons.js';
import { pdfButton } from './pdfButtons.js';

/** What the search bar needs from the pane. */
export interface PdfSearchBarHost {
  /** The open document's event bus, or null between documents. */
  eventBus(): EventBus | null;
  /** Who the find events come from (pdf.js passes it back). */
  readonly source: unknown;
}

interface MatchesCount { current: number; total: number }

export class PdfSearchBar {
  private readonly _countListeners = new Set<(count: FindCount) => void>();
  private readonly _input: HTMLInputElement;
  private readonly _count: HTMLElement;
  private _open = false;
  private _caseSensitive = false;
  private _wholeWord = false;
  /** Finds go to pdf.js one at a time (pdfFindQueue.ts). */
  private readonly _finds = new PdfFindQueue<Record<string, unknown>>((find) => this._host.eventBus()?.dispatch('find', find));

  constructor(
    private readonly _bar: HTMLElement,
    private readonly _host: PdfSearchBarHost,
  ) {
    // The field: input plus the match-case / whole-word toggles, in one
    // bordered box (the app's find widget layout, without Replace: a PDF is
    // read-only).
    const field = $('div');
    field.classList.add('pdf-find-field');

    this._input = document.createElement('input');
    this._input.type = 'text';
    this._input.classList.add('pdf-find-input', 'px-input-bare');
    this._input.placeholder = 'Find';
    declareControl(this._input, { id: 'pdf.search.query', label: 'Find', kind: 'input', state: () => ({ kind: 'value', value: this._input?.value ?? '' }) });
    this._input.spellcheck = false;
    this._input.setAttribute('aria-label', 'Find in document');
    this._input.addEventListener('input', () => this._dispatch('find'));
    this._input.addEventListener('keydown', (e) => {
      if (e.key === 'Enter') {
        this._dispatch('again', e.shiftKey);
        e.preventDefault();
      }
      if (e.key === 'Escape') {
        this.toggle(false);
        e.preventDefault();
      }
    });

    const toggle = (text: string, label: string, get: () => boolean, set: (v: boolean) => void): HTMLButtonElement => {
      const b = document.createElement('button');
      b.classList.add('pdf-find-toggle');
      b.textContent = text;
      b.setAttribute('aria-label', label);
      b.setAttribute('aria-pressed', 'false');
      setupTooltip(b, label);
      declareControl(b, { id: `pdf.search.${label.toLowerCase().replace(/[^a-z0-9]+/g, '-')}`, label, kind: 'toggle', state: () => ({ kind: 'pressed', value: get() }) });
      b.addEventListener('click', () => {
        set(!get());
        b.classList.toggle('active', get());
        b.setAttribute('aria-pressed', String(get()));
        this._dispatch('find');
        this._input.focus();
      });
      return b;
    };
    const caseBtn = toggle('Aa', 'Match Case', () => this._caseSensitive, (v) => { this._caseSensitive = v; });
    const wordBtn = toggle('Ab|', 'Match Whole Word', () => this._wholeWord, (v) => { this._wholeWord = v; });
    field.append(this._input, caseBtn, wordBtn);

    this._count = $('span');
    this._count.classList.add('pdf-find-count');
    this._count.setAttribute('aria-live', 'polite');

    const prevMatch = pdfButton(ICON.chevronUp, 'Previous Match (Shift+Enter)', 'pdf.search.previous');
    prevMatch.addEventListener('click', () => this._dispatch('again', true));

    const nextMatch = pdfButton(ICON.chevronDown, 'Next Match (Enter)', 'pdf.search.next');
    nextMatch.addEventListener('click', () => this._dispatch('again', false));

    const closeBtn = pdfButton(ICON.close, 'Close (Escape)', 'pdf.search.close');
    closeBtn.addEventListener('click', () => this.toggle(false));

    this._bar.append(field, this._count, prevMatch, nextMatch, closeBtn);
  }

  get isOpen(): boolean {
    return this._open;
  }

  /** Whether the find field has the keyboard. */
  ownsFocus(): boolean {
    return document.activeElement === this._input;
  }

  /** Open (focused, the current query found again) or close (highlights cleared). */
  toggle(forceState?: boolean): void {
    this._open = forceState ?? !this._open;
    if (this._open) {
      show(this._bar);
      this._input.focus();
      this._input.select();
      if (this._input.value) this._dispatch('find');
    } else {
      hide(this._bar);
      this._host.eventBus()?.dispatch('findbarclose', { source: this._host.source });
      this._count.textContent = '';
    }
  }

  /** Open on `query` and find it. */
  find(query: string): void {
    this.toggle(true);
    this._input.value = query;
    this._dispatch('find');
  }

  /**
   * Find and wash a link's quote without opening the bar. It goes through the
   * same queue as a typed find: sent straight to pdf.js while another find was
   * still pending, it made pdf.js log "There can only be one pending page"
   * and wash nothing.
   */
  findQuote(query: string): void {
    this._finds.request({ source: this._host.source, type: 'find', query, caseSensitive: false, entireWord: false, highlightAll: true, findPrevious: false });
  }

  /**
   * The document as Find's target (Ctrl+F, workbench/findSurface.ts): the
   * viewer finds and counts across every page, the surface shows the count.
   */
  findTarget(): IFindTarget {
    let query = '';
    let options: FindOptions = { caseSensitive: false, wholeWord: false, useRegex: false };
    const send = (type: string, findPrevious = false): void => {
      this._finds.request({ source: this._host.source, type, query, caseSensitive: options.caseSensitive, entireWord: options.wholeWord, highlightAll: true, findPrevious });
    };
    const clear = (): void => { this._host.eventBus()?.dispatch('findbarclose', { source: this._host.source }); };
    return {
      find: (q, o) => {
        if (this._open) this.toggle(false);
        query = q; options = o;
        if (!q) { clear(); return { current: 0, total: 0 }; }
        send('find');
        return undefined;
      },
      step: (delta) => { if (query) send('again', delta < 0); return undefined; },
      clear,
      onDidChangeCount: (listener) => {
        this._countListeners.add(listener);
        return { dispose: () => { this._countListeners.delete(listener); } };
      },
    };
  }

  /** A new document's event bus: show its match count and not-found state. */
  attach(eventBus: EventBus, notFoundState: number, pendingState: number): void {
    this._finds.reset();
    eventBus.on('updatefindmatchescount', (evt: { matchesCount: MatchesCount }) => {
      const { current, total } = evt.matchesCount;
      for (const l of this._countListeners) l({ current, total });
      this._count.textContent = total > 0 ? `${current} of ${total}` : '';
    });
    eventBus.on('updatefindcontrolstate', (evt: { state: number; matchesCount?: MatchesCount }) => {
      if (evt.state !== pendingState) this._finds.settled();
      if (evt.state === notFoundState) {
        for (const l of this._countListeners) l({ current: 0, total: 0 });
        this._count.textContent = 'No matches';
        this._bar.classList.add('is-not-found');
      } else {
        this._bar.classList.remove('is-not-found');
        if (evt.matchesCount) {
          const { current, total } = evt.matchesCount;
          this._count.textContent = total > 0 ? `${current} of ${total}` : '';
        }
      }
    });
  }

  /** A new document: the bar counts as closed. */
  reset(): void {
    this._open = false;
    this._finds.reset();
  }

  private _dispatch(type: string, findPrevious = false): void {
    this._finds.request({
      source: this._host.source,
      type,
      query: this._input.value,
      caseSensitive: this._caseSensitive,
      entireWord: this._wholeWord,
      highlightAll: true,
      findPrevious,
    });
  }
}
