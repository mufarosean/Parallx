// slider.ts — Slider UI component
//
// Range slider with optional labeled stops. Wraps <input type="range">
// with custom styling and stop labels beneath the track.
//
// VS Code reference: `src/vs/base/browser/ui/slider/slider.ts` (conceptual)

import { Disposable } from '../platform/lifecycle.js';
import { Emitter, Event } from '../platform/events.js';
import { $, addDisposableListener } from './dom.js';
import './slider.css';

// ─── Options ─────────────────────────────────────────────────────────────────

export interface ISliderLabeledStop {
  readonly value: number;
  readonly label: string;
}

export interface ISliderOptions {
  /** Minimum value. Default: `0`. */
  readonly min?: number;
  /** Maximum value. Default: `100`. */
  readonly max?: number;
  /** Step increment. Default: `1`. */
  readonly step?: number;
  /** Initial value. Default: `min`. */
  readonly value?: number;
  /** Labeled stops shown beneath the track. */
  readonly labeledStops?: readonly ISliderLabeledStop[];
  /** Accessible label for screen readers. */
  readonly ariaLabel?: string;
  /** Whether the slider is disabled. */
  readonly disabled?: boolean;
}

// ─── Slider ──────────────────────────────────────────────────────────────────

/**
 * A styled range slider with optional labeled stops.
 *
 * CSS classes (co-located in `slider.css`):
 * - `.ui-slider` — wrapper
 * - `.ui-slider__input` — the `<input type="range">` element
 * - `.ui-slider__stops` — container for labeled stop markers
 * - `.ui-slider__stop` — individual stop label
 * - `.ui-slider--disabled` — added when disabled
 *
 * Events:
 * - `onDidChange` — fired on every `input` event with current numeric value
 */
export class Slider extends Disposable {

  readonly element: HTMLElement;
  private readonly _input: HTMLInputElement;
  private readonly _stopsEl: HTMLElement | undefined;

  private readonly _onDidChange = this._register(new Emitter<number>());
  readonly onDidChange: Event<number> = this._onDidChange.event;

  constructor(container: HTMLElement, options?: ISliderOptions) {
    super();

    const min = options?.min ?? 0;
    const max = options?.max ?? 100;
    const step = options?.step ?? 1;
    const value = options?.value ?? min;

    // Wrapper
    this.element = $('div.ui-slider');

    if (options?.disabled) {
      this.element.classList.add('ui-slider--disabled');
    }

    // Range input
    this._input = document.createElement('input');
    this._input.type = 'range';
    this._input.className = 'ui-slider__input';
    this._input.min = String(min);
    this._input.max = String(max);
    this._input.step = String(step);
    this._input.value = String(value);
    if (options?.ariaLabel) {
      this._input.setAttribute('aria-label', options.ariaLabel);
    }
    if (options?.disabled) {
      this._input.disabled = true;
    }
    this.element.appendChild(this._input);

    // Labeled stops — positioned via flexbox space-between
    if (options?.labeledStops && options.labeledStops.length > 0) {
      this._stopsEl = $('div.ui-slider__stops');
      // Sort stops by value so order matches visual position
      const sorted = [...options.labeledStops].sort((a, b) => a.value - b.value);
      for (const stop of sorted) {
        const stopEl = $('span.ui-slider__stop', stop.label);
        this._stopsEl.appendChild(stopEl);
      }
      this.element.appendChild(this._stopsEl);
    }

    // Set initial fill
    this._syncFill();

    // Events — sync fill on every input
    this._register(addDisposableListener(this._input, 'input', () => {
      this._syncFill();
      this._onDidChange.fire(this.value);
    }));

    container.appendChild(this.element);
  }

  // ─── Properties ──────────────────────────────────────────────────────

  get value(): number {
    return parseFloat(this._input.value);
  }

  set value(v: number) {
    this._input.value = String(v);
    this._syncFill();
  }

  get disabled(): boolean {
    return this._input.disabled;
  }

  set disabled(v: boolean) {
    this._input.disabled = v;
    this.element.classList.toggle('ui-slider--disabled', v);
  }

  // ─── Methods ─────────────────────────────────────────────────────────

  focus(): void {
    this._input.focus();
  }

  // ─── Private ─────────────────────────────────────────────────────────

  /** Keep `--slider-fill` in sync with the current value. */
  private _syncFill(): void {
    const min = parseFloat(this._input.min);
    const max = parseFloat(this._input.max);
    const val = parseFloat(this._input.value);
    const pct = ((val - min) / (max - min)) * 100;
    this.element.style.setProperty('--slider-fill', `${pct}%`);
  }
}
