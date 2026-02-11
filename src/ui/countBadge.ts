// countBadge.ts — CountBadge UI component
//
// A small badge that displays a numeric count. Collapses to a dot
// when count is zero (if configured). Used for notification counts,
// unread indicators, and similar.
//
// VS Code reference: `src/vs/base/browser/ui/countBadge/countBadge.ts`

import { Disposable } from '../platform/lifecycle.js';
import { $, toggleClass } from './dom.js';

// ─── Options ─────────────────────────────────────────────────────────────────

export interface ICountBadgeOptions {
  /** Initial count. Default: 0. */
  readonly count?: number;
  /** Format string for the tooltip. `{0}` is replaced with the count. */
  readonly titleFormat?: string;
}

// ─── CountBadge ──────────────────────────────────────────────────────────────

/**
 * A numeric badge element.
 *
 * CSS classes:
 * - `.ui-count-badge` — the badge element
 * - `.ui-count-badge--hidden` — count is 0 and badge should be invisible
 */
export class CountBadge extends Disposable {

  readonly element: HTMLElement;

  private _count: number;
  private readonly _titleFormat: string;

  constructor(container: HTMLElement, options?: ICountBadgeOptions) {
    super();

    this._count = options?.count ?? 0;
    this._titleFormat = options?.titleFormat ?? '{0}';

    this.element = $('span.ui-count-badge');
    this._render();

    container.appendChild(this.element);
  }

  // ─── Public API ────────────────────────────────────────────────────────

  get count(): number {
    return this._count;
  }

  setCount(count: number): void {
    if (this._count === count) return;
    this._count = count;
    this._render();
  }

  // ─── Internal ──────────────────────────────────────────────────────────

  private _render(): void {
    this.element.textContent = this._count > 0 ? String(this._count) : '';
    this.element.title = this._titleFormat.replace('{0}', String(this._count));
    toggleClass(this.element, 'ui-count-badge--hidden', this._count === 0);
  }
}
