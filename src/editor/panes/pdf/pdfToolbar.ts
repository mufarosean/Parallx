// pdfToolbar.ts — the PDF pane's toolbar.
//
// Page navigation (previous, the page field over the total and the printed
// page label, next), zoom (out, the editable percentage with its presets,
// in, and one fit button that alternates fit width and fit page), and on
// the right Find, the side panel, night reading and the ⋯ menu. The pane
// moves the viewer; the toolbar shows where it is.

import { $, hide, show } from '../../../ui/dom.js';
import { setupTooltip } from '../../../ui/tooltip.js';
import { ICON } from './pdfIcons.js';
import { pdfButton, labelButton } from './pdfButtons.js';

/** What the toolbar asks of the pane. */
export interface PdfToolbarHost {
  previousPage(): void;
  nextPage(): void;
  goToPage(pageNum: number): void;
  currentPage(): number | undefined;
  zoomOut(): void;
  zoomIn(): void;
  /** Apply and remember a scale: a number as text ("1.25") or a fit mode. */
  applyScale(value: string): void;
  /** The viewer's scale (1 = 100%) and its named mode ('page-width', ...), when a document is open. */
  scale(): { scale: number; value: string } | null;
  toggleFind(): void;
  togglePanel(): void;
  toggleNight(): void;
  showZoomPresets(x: number, y: number): void;
  showMore(anchor: HTMLElement): void;
}

export class PdfToolbar {
  private readonly _pageInput: HTMLInputElement;
  private readonly _pageTotal: HTMLElement;
  private readonly _pageLabel: HTMLElement;
  private readonly _zoomInput: HTMLInputElement;
  private readonly _fitBtn: HTMLButtonElement;
  private readonly _panelBtn: HTMLButtonElement;
  private readonly _nightBtn: HTMLButtonElement;

  constructor(el: HTMLElement, private readonly _host: PdfToolbarHost) {
    // ── Left: page navigation ──
    const nav = $('div');
    nav.classList.add('pdf-toolbar-cluster');

    const prev = pdfButton(ICON.chevronLeft, 'Previous Page');
    prev.addEventListener('click', () => _host.previousPage());

    const pagePill = $('div');
    pagePill.classList.add('pdf-toolbar-pill');

    this._pageInput = document.createElement('input');
    this._pageInput.type = 'text';
    this._pageInput.classList.add('pdf-toolbar-page-input', 'px-input-bare');
    this._pageInput.setAttribute('aria-label', 'Page number');
    this._pageInput.value = '1';
    this._pageInput.addEventListener('keydown', (e) => {
      if (e.key !== 'Enter') return;
      const n = parseInt(this._pageInput.value, 10);
      if (!isNaN(n)) _host.goToPage(n);
    });
    this._pageInput.addEventListener('blur', () => {
      const page = _host.currentPage();
      if (page !== undefined) this._pageInput.value = String(page);
    });

    const sep = $('span');
    sep.classList.add('pdf-toolbar-page-sep');
    sep.textContent = '/';

    this._pageTotal = $('span');
    this._pageTotal.classList.add('pdf-toolbar-page-total');
    this._pageTotal.textContent = '0';

    // The printed page label (i, ii, iii...), when the document has them.
    this._pageLabel = $('span');
    this._pageLabel.classList.add('pdf-toolbar-page-label');
    hide(this._pageLabel);

    pagePill.append(this._pageInput, sep, this._pageTotal, this._pageLabel);

    const next = pdfButton(ICON.chevronRight, 'Next Page');
    next.addEventListener('click', () => _host.nextPage());

    nav.append(prev, pagePill, next);

    // ── Zoom ──
    const zoom = $('div');
    zoom.classList.add('pdf-toolbar-cluster');

    const zoomOut = pdfButton(ICON.zoomOut, 'Zoom Out');
    zoomOut.addEventListener('click', () => _host.zoomOut());

    // One pill: the editable percentage and the presets chevron.
    const zoomPill = $('div');
    zoomPill.classList.add('pdf-toolbar-pill');

    this._zoomInput = document.createElement('input');
    this._zoomInput.type = 'text';
    this._zoomInput.classList.add('px-input-bare', 'pdf-toolbar-zoom-input');
    this._zoomInput.value = '100%';
    this._zoomInput.setAttribute('aria-label', 'Zoom level');
    setupTooltip(this._zoomInput, 'Zoom level (type a % and press Enter)');
    this._zoomInput.addEventListener('focus', () => this._zoomInput.select());
    this._zoomInput.addEventListener('keydown', (e) => {
      if (e.key === 'Enter') { this._applyZoomInput(); this._zoomInput.blur(); e.preventDefault(); }
      if (e.key === 'Escape') { this.syncScale(); this._zoomInput.blur(); e.preventDefault(); }
    });
    this._zoomInput.addEventListener('blur', () => this.syncScale());

    const zoomPreset = pdfButton(ICON.chevronDownSm, 'Zoom Presets');
    zoomPreset.classList.add('pdf-toolbar-zoom-preset');
    zoomPreset.addEventListener('click', (e) => {
      const r = (e.currentTarget as HTMLElement).getBoundingClientRect();
      _host.showZoomPresets(r.left, r.bottom + 4);
    });

    zoomPill.append(this._zoomInput, zoomPreset);

    const zoomIn = pdfButton(ICON.zoomIn, 'Zoom In');
    zoomIn.addEventListener('click', () => _host.zoomIn());

    // One fit button that alternates between the two fit modes.
    this._fitBtn = pdfButton(ICON.fitWidth, 'Fit Width');
    this._fitBtn.addEventListener('click', () => this._toggleFit());

    zoom.append(zoomOut, zoomPill, zoomIn, this._fitBtn);

    const spacer = $('span');
    spacer.classList.add('pdf-toolbar-spacer');

    // ── Right: find, the side panel, night reading, the ⋯ menu ──
    const right = $('div');
    right.classList.add('pdf-toolbar-cluster');

    const searchBtn = pdfButton(ICON.search, 'Find (Ctrl+F)');
    searchBtn.addEventListener('click', () => _host.toggleFind());

    this._panelBtn = pdfButton(ICON.panelLeft, 'Outline And Pages');
    this._panelBtn.setAttribute('aria-pressed', 'false');
    this._panelBtn.addEventListener('click', () => _host.togglePanel());

    this._nightBtn = pdfButton(ICON.moon, 'Night Reading');
    this._nightBtn.addEventListener('click', () => _host.toggleNight());

    // Rarely used actions live in the ⋯ menu (rotate, spread, scroll, print, open).
    const moreBtn = pdfButton(ICON.more, 'More Actions');
    moreBtn.addEventListener('click', (e) => _host.showMore(e.currentTarget as HTMLElement));

    right.append(searchBtn, this._panelBtn, this._nightBtn, moreBtn);

    el.append(nav, zoom, spacer, right);
  }

  /** The page field shows `pageNum`. */
  setPage(pageNum: number): void {
    this._pageInput.value = String(pageNum);
  }

  setPageCount(count: number): void {
    this._pageTotal.textContent = String(count);
  }

  /** The printed label beside the page number; none hides it. */
  setPageLabel(label: string | null | undefined): void {
    if (label) {
      this._pageLabel.textContent = `(${label})`;
      show(this._pageLabel);
    } else {
      hide(this._pageLabel);
    }
  }

  /** The zoom field and the fit button follow the viewer's scale. */
  showScale(scale: number, scaleValue: string | undefined): void {
    this._zoomInput.value = `${Math.round(scale * 100)}%`;
    const isWidth = scaleValue === 'page-width';
    // The fit button shows the mode it switches to.
    this._fitBtn.innerHTML = isWidth ? ICON.fitPage : ICON.fitWidth;
    labelButton(this._fitBtn, isWidth ? 'Fit Page' : 'Fit Width');
  }

  /** Show the viewer's current scale again (after an edit is abandoned). */
  syncScale(): void {
    const s = this._host.scale();
    if (s) this.showScale(s.scale, s.value);
  }

  setPanelOpen(open: boolean): void {
    this._panelBtn.classList.toggle('active', open);
    this._panelBtn.setAttribute('aria-pressed', String(open));
  }

  setNight(on: boolean): void {
    this._nightBtn.classList.toggle('active', on);
    this._nightBtn.innerHTML = on ? ICON.sun : ICON.moon;
    labelButton(this._nightBtn, on ? 'Day Reading' : 'Night Reading');
    this._nightBtn.setAttribute('aria-pressed', String(on));
  }

  /** Put the cursor in the page field (Ctrl+G). */
  focusPage(): void {
    this._pageInput.focus();
    this._pageInput.select();
  }

  /** Whether the page field has the keyboard (the pane's shortcuts stand aside). */
  ownsFocus(): boolean {
    return document.activeElement === this._pageInput;
  }

  /** Parse the zoom field and apply it as a scale between 25% and 1000%. */
  private _applyZoomInput(): void {
    if (!this._host.scale()) return;
    const pct = parseInt(this._zoomInput.value.replace(/[^0-9.]/g, ''), 10);
    if (!isNaN(pct) && pct > 0) {
      const clamped = Math.max(25, Math.min(1000, pct));
      this._host.applyScale(String(clamped / 100));
    }
    this.syncScale();
  }

  /** Fit width becomes fit page and back. */
  private _toggleFit(): void {
    const value = this._host.scale()?.value;
    this._host.applyScale(value === 'page-width' ? 'page-fit' : 'page-width');
    this.syncScale();
  }
}
