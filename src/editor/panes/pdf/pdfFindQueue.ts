// pdfFindQueue.ts — one find at a time into pdf.js.
//
// pdf.js's find controller can hold one find while it is still reading a
// document's text. A second one sent in that window (Enter straight after
// typing, on the first find in a document) makes it log "There can only be
// one pending page" and lose its place. So a find sent while the last one has
// not settled waits, and only the newest waiting find is sent: the ones it
// replaced were for text the user has typed past.

export class PdfFindQueue<T> {
  private _busy = false;
  private _waiting: T | null = null;
  private _timer: ReturnType<typeof setTimeout> | null = null;

  /**
   * @param _send     hands one find to pdf.js
   * @param _settleMs how long a find may go without settling before the next is let through
   */
  constructor(private readonly _send: (find: T) => void, private readonly _settleMs = 2000) {}

  /** Send `find` now, or as soon as the one in flight settles. */
  request(find: T): void {
    if (this._busy) { this._waiting = find; return; }
    this._go(find);
  }

  /** pdf.js reported the find in flight as found, not found or wrapped. */
  settled(): void {
    this._clearTimer();
    this._busy = false;
    const next = this._waiting;
    this._waiting = null;
    if (next !== null) this._go(next);
  }

  /** A new document, or the bar closed: nothing is in flight and nothing waits. */
  reset(): void {
    this._clearTimer();
    this._busy = false;
    this._waiting = null;
  }

  private _go(find: T): void {
    this._busy = true;
    this._clearTimer();
    this._timer = setTimeout(() => this.settled(), this._settleMs);
    this._send(find);
  }

  private _clearTimer(): void {
    if (this._timer !== null) { clearTimeout(this._timer); this._timer = null; }
  }
}
