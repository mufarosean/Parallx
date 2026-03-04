// segmentedControl.ts — SegmentedControl UI component
//
// Horizontal button bar where exactly one segment is active.
// Used for mutually exclusive choices like Concise / Balanced / Detailed.
//
// VS Code reference: Toggle bar pattern in settings editor.

import { Disposable } from '../platform/lifecycle.js';
import { Emitter, Event } from '../platform/events.js';
import { $, addDisposableListener } from './dom.js';
import './segmentedControl.css';

// ─── Options ─────────────────────────────────────────────────────────────────

export interface ISegment {
  readonly value: string;
  readonly label: string;
}

export interface ISegmentedControlOptions {
  /** Segment definitions. Must have at least 2. */
  readonly segments?: readonly ISegment[];
  /** Initially selected value. Default: first segment. */
  readonly selected?: string;
  /** Accessible label for screen readers. */
  readonly ariaLabel?: string;
  /** Whether the control is disabled. */
  readonly disabled?: boolean;
}

// ─── SegmentedControl ────────────────────────────────────────────────────────

/**
 * A horizontal segmented button bar.
 *
 * CSS classes (co-located in `segmentedControl.css`):
 * - `.ui-segmented-control` — wrapper (with role="radiogroup")
 * - `.ui-segmented-control__segment` — individual button segment
 * - `.ui-segmented-control__segment--active` — the selected segment
 * - `.ui-segmented-control--disabled` — added when disabled
 *
 * Events:
 * - `onDidChange` — fired when the selected value changes (payload: value string)
 */
export class SegmentedControl extends Disposable {

  readonly element: HTMLElement;
  private _segments: ISegment[];
  private _selectedValue: string;
  private _disabled: boolean;
  private readonly _segmentEls: HTMLButtonElement[] = [];

  private readonly _onDidChange = this._register(new Emitter<string>());
  readonly onDidChange: Event<string> = this._onDidChange.event;

  constructor(container: HTMLElement, options?: ISegmentedControlOptions) {
    super();

    this._segments = options?.segments ? [...options.segments] : [];
    this._selectedValue = options?.selected ?? (this._segments[0]?.value ?? '');
    this._disabled = options?.disabled ?? false;

    // Wrapper
    this.element = $('div.ui-segmented-control');
    this.element.setAttribute('role', 'radiogroup');
    if (options?.ariaLabel) {
      this.element.setAttribute('aria-label', options.ariaLabel);
    }
    if (this._disabled) {
      this.element.classList.add('ui-segmented-control--disabled');
    }

    this._renderSegments();

    // Keyboard navigation: left/right arrows
    this._register(addDisposableListener(this.element, 'keydown', (e) => {
      if (this._disabled) return;
      this._handleKeydown(e);
    }));

    container.appendChild(this.element);
  }

  // ─── Properties ──────────────────────────────────────────────────────

  get value(): string {
    return this._selectedValue;
  }

  set value(v: string) {
    if (this._selectedValue === v) return;
    this._selectedValue = v;
    this._updateActiveClass();
  }

  get disabled(): boolean {
    return this._disabled;
  }

  set disabled(v: boolean) {
    this._disabled = v;
    this.element.classList.toggle('ui-segmented-control--disabled', v);
    for (const btn of this._segmentEls) {
      btn.disabled = v;
    }
  }

  // ─── Methods ─────────────────────────────────────────────────────────

  focus(): void {
    const activeIdx = this._segments.findIndex(s => s.value === this._selectedValue);
    if (activeIdx >= 0 && this._segmentEls[activeIdx]) {
      this._segmentEls[activeIdx].focus();
    }
  }

  // ─── Internal ────────────────────────────────────────────────────────

  private _renderSegments(): void {
    this._segmentEls.length = 0;
    for (const seg of this._segments) {
      const btn = document.createElement('button');
      btn.type = 'button';
      btn.className = 'ui-segmented-control__segment';
      btn.textContent = seg.label;
      btn.setAttribute('role', 'radio');
      btn.setAttribute('aria-checked', String(seg.value === this._selectedValue));
      btn.setAttribute('tabindex', seg.value === this._selectedValue ? '0' : '-1');

      if (seg.value === this._selectedValue) {
        btn.classList.add('ui-segmented-control__segment--active');
      }
      if (this._disabled) {
        btn.disabled = true;
      }

      this._register(addDisposableListener(btn, 'click', () => {
        if (this._disabled) return;
        this._select(seg.value);
      }));

      this.element.appendChild(btn);
      this._segmentEls.push(btn);
    }
  }

  private _select(value: string): void {
    if (this._selectedValue === value) return;
    this._selectedValue = value;
    this._updateActiveClass();
    this._onDidChange.fire(value);
  }

  private _updateActiveClass(): void {
    this._segmentEls.forEach((btn, idx) => {
      const isActive = this._segments[idx].value === this._selectedValue;
      btn.classList.toggle('ui-segmented-control__segment--active', isActive);
      btn.setAttribute('aria-checked', String(isActive));
      btn.setAttribute('tabindex', isActive ? '0' : '-1');
    });
  }

  private _handleKeydown(e: KeyboardEvent): void {
    const currentIdx = this._segments.findIndex(s => s.value === this._selectedValue);
    let nextIdx = currentIdx;

    switch (e.key) {
      case 'ArrowRight':
      case 'ArrowDown':
        e.preventDefault();
        nextIdx = Math.min(currentIdx + 1, this._segments.length - 1);
        break;
      case 'ArrowLeft':
      case 'ArrowUp':
        e.preventDefault();
        nextIdx = Math.max(currentIdx - 1, 0);
        break;
      default:
        return;
    }

    if (nextIdx !== currentIdx) {
      this._select(this._segments[nextIdx].value);
      this._segmentEls[nextIdx]?.focus();
    }
  }
}
