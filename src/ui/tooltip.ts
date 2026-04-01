// tooltip.ts — Custom themed tooltip widget
//
// Replaces browser-native `title` attribute tooltips with a styled overlay
// that matches the Parallx/VS Code dark theme.
//
// VS Code reference:
//   src/vs/base/browser/ui/hover/hoverWidget.ts
//   src/vs/base/browser/ui/hover/updatableHoverWidget.ts
//
// Usage:
//   import { setupTooltip } from '../ui/tooltip.js';
//   setupTooltip(element, 'My tooltip text');
//   setupTooltip(element, 'Label (Ctrl+Shift+F)', { placement: 'right' });
//
// The tooltip appears after a short delay and positions itself relative to
// the target element. It auto-dismisses on mouseleave, scroll, or click.

import { $, addDisposableListener } from './dom.js';
import type { IDisposable } from '../platform/lifecycle.js';

// ─── Configuration ───────────────────────────────────────────────────────────

const SHOW_DELAY = 500;     // ms before tooltip appears
const HIDE_DELAY = 0;       // ms before tooltip disappears
const OFFSET = 6;           // px gap between target and tooltip
const VIEWPORT_PADDING = 8; // px margin from viewport edges

export type TooltipPlacement = 'top' | 'bottom' | 'left' | 'right';

export interface TooltipOptions {
  placement?: TooltipPlacement;
}

// ─── Singleton Tooltip Element ───────────────────────────────────────────────
// One tooltip DOM element is shared across the entire app to avoid bloat.

let _tooltipEl: HTMLElement | null = null;
let _showTimer: ReturnType<typeof setTimeout> | null = null;
let _hideTimer: ReturnType<typeof setTimeout> | null = null;
let _currentTarget: HTMLElement | null = null;

function ensureTooltipElement(): HTMLElement {
  if (!_tooltipEl) {
    _tooltipEl = $('div.parallx-tooltip');
    _tooltipEl.setAttribute('role', 'tooltip');
    _tooltipEl.style.display = 'none';
    document.body.appendChild(_tooltipEl);
  }
  return _tooltipEl;
}

function showTooltip(target: HTMLElement, text: string, placement: TooltipPlacement): void {
  clearTimers();
  _currentTarget = target;

  _showTimer = setTimeout(() => {
    const el = ensureTooltipElement();
    el.textContent = text;
    el.style.display = 'block';
    positionTooltip(el, target, placement);
  }, SHOW_DELAY);
}

function hideTooltip(): void {
  clearTimers();
  _hideTimer = setTimeout(() => {
    if (_tooltipEl) {
      _tooltipEl.style.display = 'none';
    }
    _currentTarget = null;
  }, HIDE_DELAY);
}

function clearTimers(): void {
  if (_showTimer) { clearTimeout(_showTimer); _showTimer = null; }
  if (_hideTimer) { clearTimeout(_hideTimer); _hideTimer = null; }
}

function positionTooltip(el: HTMLElement, target: HTMLElement, placement: TooltipPlacement): void {
  const rect = target.getBoundingClientRect();
  const vw = window.innerWidth;
  const vh = window.innerHeight;

  // Reset to get natural dimensions
  el.style.left = '0';
  el.style.top = '0';
  const tipRect = el.getBoundingClientRect();

  let top = 0;
  let left = 0;

  switch (placement) {
    case 'right':
      top = rect.top + (rect.height - tipRect.height) / 2;
      left = rect.right + OFFSET;
      break;
    case 'left':
      top = rect.top + (rect.height - tipRect.height) / 2;
      left = rect.left - tipRect.width - OFFSET;
      break;
    case 'bottom':
      top = rect.bottom + OFFSET;
      left = rect.left + (rect.width - tipRect.width) / 2;
      break;
    case 'top':
    default:
      top = rect.top - tipRect.height - OFFSET;
      left = rect.left + (rect.width - tipRect.width) / 2;
      break;
  }

  // Clamp to viewport
  if (left < VIEWPORT_PADDING) left = VIEWPORT_PADDING;
  if (left + tipRect.width > vw - VIEWPORT_PADDING) left = vw - VIEWPORT_PADDING - tipRect.width;
  if (top < VIEWPORT_PADDING) {
    // Flip to bottom if overflows top
    top = rect.bottom + OFFSET;
  }
  if (top + tipRect.height > vh - VIEWPORT_PADDING) {
    // Flip to top if overflows bottom
    top = rect.top - tipRect.height - OFFSET;
  }

  el.style.left = `${Math.round(left)}px`;
  el.style.top = `${Math.round(top)}px`;
}

// ─── Public API ──────────────────────────────────────────────────────────────

/**
 * Attach a custom themed tooltip to an element.
 * Removes any existing native `title` attribute.
 * Returns a disposable to detach the tooltip.
 */
export function setupTooltip(
  target: HTMLElement,
  text: string,
  options?: TooltipOptions,
): IDisposable {
  const placement = options?.placement ?? 'top';

  // Remove native tooltip so it doesn't double-show
  target.removeAttribute('title');
  target.removeAttribute(TITLE_DATA_ATTR);
  // Mark as managed so the global delegate skips this element
  target.setAttribute('data-parallx-tooltip-managed', '');

  const onEnter = () => showTooltip(target, text, placement);
  const onLeave = () => hideTooltip();

  const d1 = addDisposableListener(target, 'mouseenter', onEnter);
  const d2 = addDisposableListener(target, 'mouseleave', onLeave);
  const d3 = addDisposableListener(target, 'mousedown', onLeave);

  return {
    dispose() {
      d1.dispose();
      d2.dispose();
      d3.dispose();
      if (_currentTarget === target) {
        hideTooltip();
      }
    },
  };
}

/**
 * Update the text of an existing tooltip.
 * This re-attaches the tooltip with the new text.
 */
export function updateTooltip(
  target: HTMLElement,
  text: string,
  options?: TooltipOptions,
): IDisposable {
  return setupTooltip(target, text, options);
}

// ─── Global Delegate ─────────────────────────────────────────────────────────
// Intercepts every element with a `title` attribute and shows the custom
// tooltip instead of the browser-native one. This ensures a single tooltip
// style across ALL surfaces without modifying individual call sites.

const TITLE_DATA_ATTR = 'data-parallx-title';
let _delegateInstalled = false;
let _delegateTarget: HTMLElement | null = null;
let _delegateLeaveHandler: (() => void) | null = null;
let _delegateDownHandler: (() => void) | null = null;

/**
 * Install a global tooltip delegate on `document`.
 *
 * After this call, any element with a `title` attribute will automatically
 * use the custom themed tooltip. The native `title` is stripped on first
 * hover and stored in `data-parallx-title` so it's not lost.
 *
 * Call once at app startup.
 */
export function installGlobalTooltipDelegate(): void {
  if (_delegateInstalled) return;
  _delegateInstalled = true;

  document.addEventListener('mouseover', (e) => {
    const target = (e.target as HTMLElement)?.closest?.<HTMLElement>('[title], [data-parallx-title]');
    if (!target || target === _delegateTarget) return;

    // Skip elements that already have setupTooltip wired (they handle themselves)
    if (target.hasAttribute('data-parallx-tooltip-managed')) return;

    // Get the tooltip text: prefer the stashed data attribute, fall back to title
    let text = target.getAttribute(TITLE_DATA_ATTR) || target.getAttribute('title') || '';
    if (!text.trim()) return;

    // Strip the native title to prevent the browser's built-in tooltip
    if (target.hasAttribute('title')) {
      target.setAttribute(TITLE_DATA_ATTR, text);
      target.removeAttribute('title');
    }

    // Clean up previous delegate listeners
    _cleanupDelegateTarget();

    _delegateTarget = target;
    showTooltip(target, text, 'top');

    _delegateLeaveHandler = () => {
      hideTooltip();
      _cleanupDelegateTarget();
    };
    _delegateDownHandler = _delegateLeaveHandler;

    target.addEventListener('mouseleave', _delegateLeaveHandler);
    target.addEventListener('mousedown', _delegateDownHandler);
  });
}

function _cleanupDelegateTarget(): void {
  if (_delegateTarget && _delegateLeaveHandler) {
    _delegateTarget.removeEventListener('mouseleave', _delegateLeaveHandler);
    _delegateTarget.removeEventListener('mousedown', _delegateDownHandler!);
  }
  _delegateTarget = null;
  _delegateLeaveHandler = null;
  _delegateDownHandler = null;
}
