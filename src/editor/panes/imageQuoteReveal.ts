// imageQuoteReveal.ts — a link's quote, lit up on a picture of a page.
//
// A photo or a scan of a page saved as a picture has no text, so a citation
// that opened it had nothing to light up. The document reader has read the
// picture (that is how it was cited): its reading has every line with its
// box. The lines that hold the link's quote get the warm wash a quote gets in
// a PDF, laid over the picture where they are. The wash stays until the next
// press in the view.
//
// The picture is zoomed with a CSS transform, so the wash sits in a layer
// laid over the picture's own box and given the same transform.

import { createBlock } from '../../ui/kit.js';
import { takeFileReveal } from '../fileReveal.js';
import { fetchDocumentReading } from '../../services/documentReading.js';
import { locateQuoteLines } from '../../services/readingLocate.js';
import type { ReadingBox } from '../../services/documentReading.js';

export interface IImageQuoteRevealHost {
  image(): HTMLImageElement;
  /** The element the picture is centred in: the wash layer is placed in it. */
  wrapper(): HTMLElement;
  /** The scrolling element: a press in it takes the wash away. */
  scroller(): HTMLElement;
}

const LAYER = 'image-quote-layer';

export class ImageQuoteReveal {
  private _lines: { readonly boxes: readonly ReadingBox[]; readonly width: number; readonly height: number } | null = null;
  private _turn = 0;
  private _stopWatching: (() => void) | null = null;

  constructor(private readonly _host: IImageQuoteRevealHost) {}

  /** Take the link's quote for the picture at `fsPath`, if one is waiting, and wash the lines that hold it. */
  async apply(fsPath: string | undefined): Promise<void> {
    const quote = fsPath ? takeFileReveal(fsPath)?.quote : undefined;
    if (!fsPath || !quote) return;
    this.clear();
    const turn = this._turn;
    const page = (await fetchDocumentReading(fsPath))?.pages[0];
    const boxes = locateQuoteLines(page, quote);
    if (turn !== this._turn || !page || boxes.length === 0) return;
    this._lines = { boxes, width: page.width, height: page.height };
    this.layout();
    this._host.wrapper().querySelector(`.${LAYER} > *`)?.scrollIntoView({ block: 'center' });
    const scroller = this._host.scroller();
    const onPress = (): void => this.clear();
    scroller.addEventListener('pointerdown', onPress, { capture: true, once: true });
    this._stopWatching = () => scroller.removeEventListener('pointerdown', onPress, { capture: true });
  }

  /** Lay the wash over the picture as it is now (after it loaded, or a zoom). */
  layout(): void {
    const wrapper = this._host.wrapper();
    wrapper.querySelector(`.${LAYER}`)?.remove();
    const lines = this._lines;
    const img = this._host.image();
    if (!lines || !img.offsetWidth || !img.offsetHeight) return;
    const layer = createBlock(wrapper, 'div', { className: LAYER, attrs: { 'aria-hidden': 'true' } });
    Object.assign(layer.style, {
      left: `${img.offsetLeft}px`, top: `${img.offsetTop}px`, width: `${img.offsetWidth}px`, height: `${img.offsetHeight}px`,
      transform: img.style.transform, transformOrigin: img.style.transformOrigin,
    });
    const pct = (v: number, of: number): string => `${Math.max(0, Math.min(100, (v / of) * 100))}%`;
    for (const [left, top, right, bottom] of lines.boxes) {
      const wash = createBlock(layer, 'div', { className: 'image-quote-wash' });
      Object.assign(wash.style, { left: pct(left, lines.width), top: pct(top, lines.height), width: pct(right - left, lines.width), height: pct(bottom - top, lines.height) });
    }
  }

  /** Take the wash away: a press in the view, another link, another picture. */
  clear(): void {
    this._turn++;
    this._stopWatching?.();
    this._stopWatching = null;
    this._lines = null;
    this._host.wrapper().querySelector(`.${LAYER}`)?.remove();
  }
}
