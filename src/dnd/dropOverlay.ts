// dropOverlay.ts — visual drop feedback overlay

import { Disposable } from '../platform/lifecycle.js';
import { DropPosition } from './dndTypes.js';

/**
 * CSS class name for the overlay container.
 */
const OVERLAY_CLASS = 'parallx-drop-overlay';

/**
 * CSS class prefix for position highlights.
 */
const HIGHLIGHT_CLASS = 'drop-highlight';

/**
 * Visual overlay that renders drop zone feedback on a target element.
 *
 * When shown, it divides the target into five regions (center + four edges)
 * and highlights the region the cursor is over.
 */
export class DropOverlay extends Disposable {

  private readonly _container: HTMLElement;
  private readonly _centerZone: HTMLElement;
  private readonly _topZone: HTMLElement;
  private readonly _bottomZone: HTMLElement;
  private readonly _leftZone: HTMLElement;
  private readonly _rightZone: HTMLElement;

  private _currentPosition: DropPosition | undefined;
  private _visible = false;

  constructor() {
    super();

    this._container = document.createElement('div');
    this._container.classList.add(OVERLAY_CLASS);

    // Build five zone indicators
    this._centerZone = this._createZone('center');
    this._topZone = this._createZone('top');
    this._bottomZone = this._createZone('bottom');
    this._leftZone = this._createZone('left');
    this._rightZone = this._createZone('right');

    this._container.append(
      this._topZone,
      this._bottomZone,
      this._leftZone,
      this._rightZone,
      this._centerZone, // center on top so it’s the visual default
    );
  }

  /** The overlay DOM element. Attach to target’s parent. */
  get element(): HTMLElement { return this._container; }

  /** Currently highlighted position. */
  get currentPosition(): DropPosition | undefined { return this._currentPosition; }

  // ── Show / Hide ──

  show(parent: HTMLElement): void {
    if (!this._visible) {
      parent.style.position = 'relative'; // ensure overlay positioning works
      parent.appendChild(this._container);
      this._container.style.display = '';
      this._visible = true;
    }
  }

  hide(): void {
    if (this._visible) {
      this._clearHighlight();
      this._container.style.display = 'none';
      this._container.remove();
      this._visible = false;
      this._currentPosition = undefined;
    }
  }

  // ── Position Detection ──

  /**
   * Given a mouse position relative to the target, compute which
   * drop position the cursor is nearest to.
   */
  computePosition(clientX: number, clientY: number, targetRect: DOMRect): DropPosition {
    const relX = clientX - targetRect.left;
    const relY = clientY - targetRect.top;
    const w = targetRect.width;
    const h = targetRect.height;

    // Edge threshold: 25% from each edge
    const edgeThreshold = 0.25;

    const fracX = w > 0 ? relX / w : 0.5;
    const fracY = h > 0 ? relY / h : 0.5;

    if (fracY < edgeThreshold) return DropPosition.Top;
    if (fracY > 1 - edgeThreshold) return DropPosition.Bottom;
    if (fracX < edgeThreshold) return DropPosition.Left;
    if (fracX > 1 - edgeThreshold) return DropPosition.Right;
    return DropPosition.Center;
  }

  /**
   * Highlight the given drop position. Clears any previous highlight.
   */
  highlight(position: DropPosition): void {
    if (this._currentPosition === position) return;
    this._clearHighlight();

    this._currentPosition = position;
    const zone = this._zoneFor(position);
    zone.classList.add(HIGHLIGHT_CLASS, `${HIGHLIGHT_CLASS}-${position}`);
  }

  /**
   * Highlight as invalid (target doesn’t accept the payload).
   */
  highlightInvalid(): void {
    this._clearHighlight();
    this._currentPosition = undefined;
    this._container.classList.add('parallx-drop-overlay--invalid');
  }

  // ── Internals ──

  private _createZone(name: string): HTMLElement {
    const el = document.createElement('div');
    el.classList.add('drop-zone', `drop-zone-${name}`);
    return el;
  }

  private _zoneFor(position: DropPosition): HTMLElement {
    switch (position) {
      case DropPosition.Center: return this._centerZone;
      case DropPosition.Top: return this._topZone;
      case DropPosition.Bottom: return this._bottomZone;
      case DropPosition.Left: return this._leftZone;
      case DropPosition.Right: return this._rightZone;
    }
  }

  private _clearHighlight(): void {
    for (const zone of [this._centerZone, this._topZone, this._bottomZone, this._leftZone, this._rightZone]) {
      zone.className = zone.className.replace(/\bdrop-highlight\S*/g, '').trim();
    }
    this._container.classList.remove('parallx-drop-overlay--invalid');
  }
}
