// dom.ts — DOM helper utilities for UI components
//
// Lightweight DOM creation and event management utilities.
// Mirrors the subset of VS Code's `src/vs/base/browser/dom.ts` needed
// by the component library.

import './ui.css';

import { IDisposable, toDisposable } from '../platform/lifecycle.js';

// ─── Element Creation ────────────────────────────────────────────────────────

/**
 * Create an HTML element with optional CSS classes and children.
 *
 * Usage:
 *   $('div.my-class.another-class')          → <div class="my-class another-class">
 *   $('span.label', 'Hello')                 → <span class="label">Hello</span>
 *   $('div.parent', childElement, 'text')     → <div class="parent"><child/>text</div>
 *
 * VS Code reference: `src/vs/base/browser/dom.ts` → `$()` helper.
 */
export function $<K extends keyof HTMLElementTagNameMap>(
  descriptor: K,
  ...children: (HTMLElement | string)[]
): HTMLElementTagNameMap[K];
export function $(
  descriptor: string,
  ...children: (HTMLElement | string)[]
): HTMLElement;
export function $(
  descriptor: string,
  ...children: (HTMLElement | string)[]
): HTMLElement {
  const parts = descriptor.split('.');
  const tag = parts[0] || 'div';
  const el = document.createElement(tag);

  for (let i = 1; i < parts.length; i++) {
    if (parts[i]) {
      el.classList.add(parts[i]);
    }
  }

  for (const child of children) {
    if (typeof child === 'string') {
      el.appendChild(document.createTextNode(child));
    } else {
      el.appendChild(child);
    }
  }

  return el;
}

// ─── Tree Manipulation ───────────────────────────────────────────────────────

/**
 * Append one or more child elements to a parent. Returns the parent.
 */
export function append(parent: HTMLElement, ...children: HTMLElement[]): HTMLElement {
  for (const child of children) {
    parent.appendChild(child);
  }
  return parent;
}

/**
 * Remove all children from an element.
 */
export function clearNode(element: HTMLElement): void {
  while (element.firstChild) {
    element.removeChild(element.firstChild);
  }
}

// ─── Disposable Event Listeners ──────────────────────────────────────────────

/**
 * Add a DOM event listener that returns an IDisposable for cleanup.
 *
 * VS Code reference: `src/vs/base/browser/dom.ts` → `addDisposableListener()`.
 */
export function addDisposableListener<K extends keyof HTMLElementEventMap>(
  element: HTMLElement | Window | Document,
  type: K,
  handler: (event: HTMLElementEventMap[K]) => void,
  options?: boolean | AddEventListenerOptions,
): IDisposable {
  element.addEventListener(type, handler as EventListener, options);
  return toDisposable(() => {
    element.removeEventListener(type, handler as EventListener, options);
  });
}

// ─── Visibility ──────────────────────────────────────────────────────────────

/**
 * Hide an element via `display: none`.
 */
export function hide(element: HTMLElement): void {
  element.style.display = 'none';
}

/**
 * Show an element (removes inline `display: none`).
 * @param displayValue The CSS display value to restore (default: '').
 */
export function show(element: HTMLElement, displayValue = ''): void {
  element.style.display = displayValue;
}

// ─── Class Toggling ──────────────────────────────────────────────────────────

/**
 * Conditionally toggle a CSS class on an element.
 */
export function toggleClass(element: HTMLElement, className: string, condition: boolean): void {
  element.classList.toggle(className, condition);
}

// ─── Focus ───────────────────────────────────────────────────────────────────

/**
 * Check if the given element or any descendant has focus.
 */
export function isAncestorOfActiveElement(element: HTMLElement): boolean {
  return element.contains(document.activeElement);
}
// ─── Drag Guard ──────────────────────────────────────────────────────────

/**
 * Set `document.body.style.cursor` and disable text selection while dragging.
 * Call `endDrag()` on mouseup to restore.
 *
 * This prevents cursor flicker and accidental text selection during
 * mouse-driven resize/drag operations (sashes, splitters, etc.).
 */
export function startDrag(cursor: string): void {
  document.body.style.cursor = cursor;
  document.body.style.userSelect = 'none';
}

/**
 * Restore cursor and text selection after a drag operation.
 */
export function endDrag(): void {
  document.body.style.cursor = '';
  document.body.style.userSelect = '';
}

// ─── Popup Viewport Layout ──────────────────────────────────────────────

/**
 * Options for {@link layoutPopup}.
 */
export interface IPopupLayoutOptions {
  /**
   * Preferred placement relative to a rect anchor. Ignored for point anchors.
   * - `'below'`  — below anchor, left-aligned  (dropdown / menu default)
   * - `'above'`  — above anchor, left-aligned
   * - `'right'`  — to the right, top-aligned    (submenu default)
   * - `'left'`   — to the left, top-aligned
   *
   * Default: `'below'`
   */
  readonly position?: 'below' | 'above' | 'right' | 'left';

  /** Gap between anchor edge and popup edge (px). Default: 4 */
  readonly gap?: number;

  /** Minimum margin from every viewport edge (px). Default: 8 */
  readonly margin?: number;
}

/**
 * Position a `position: fixed` popup element within the viewport.
 *
 * Handles:
 * 1. **Smart flipping** — if the popup overflows in the preferred direction
 *    and there is more room on the opposite side, it flips.
 * 2. **Edge clamping** — the popup is nudged inward so at least `margin` px
 *    remain on every side.
 * 3. **Dynamic max-height** — when the popup is taller than the available
 *    vertical space, `max-height` and `overflow-y: auto` are set so the
 *    content scrolls instead of getting cut off.
 *
 * The element **must already be in the DOM** and visible (`display` not `none`)
 * so its dimensions can be measured.
 *
 * Sets `style.left`, `style.top`, and (when necessary) `style.maxHeight`.
 *
 * @param el      The popup element (`position: fixed` expected).
 * @param anchor  A point `{x, y}` or a `DOMRect` to position relative to.
 * @param options Placement preferences and margins.
 *
 * @example
 * // Context menu at cursor
 * layoutPopup(menuEl, { x: e.clientX, y: e.clientY });
 *
 * // Submenu to the right of a parent menu row
 * layoutPopup(subEl, parentRow.getBoundingClientRect(), { position: 'right', gap: 2 });
 *
 * // Dropdown below a button
 * layoutPopup(dropdown, btn.getBoundingClientRect(), { position: 'below' });
 */
export function layoutPopup(
  el: HTMLElement,
  anchor: { x: number; y: number } | DOMRect,
  options?: IPopupLayoutOptions,
): void {
  const margin = options?.margin ?? 8;
  const gap    = options?.gap ?? 4;
  const pos    = options?.position ?? 'below';

  const vw = window.innerWidth;
  const vh = window.innerHeight;

  const elW = el.offsetWidth;
  const elH = el.offsetHeight;

  let left: number;
  let top: number;

  const isRect = 'width' in anchor;

  if (isRect) {
    const r = anchor as DOMRect;
    switch (pos) {
      case 'below':
        left = r.left;
        top  = r.bottom + gap;
        // Flip above if not enough space below AND more room above
        if (top + elH > vh - margin && r.top - gap - elH >= margin) {
          top = r.top - gap - elH;
        }
        break;

      case 'above':
        left = r.left;
        top  = r.top - gap - elH;
        // Flip below if not enough space above AND more room below
        if (top < margin && r.bottom + gap + elH <= vh - margin) {
          top = r.bottom + gap;
        }
        break;

      case 'right':
        left = r.right + gap;
        top  = r.top;
        // Flip left if not enough space right AND more room left
        if (left + elW > vw - margin && r.left - gap - elW >= margin) {
          left = r.left - gap - elW;
        }
        break;

      case 'left':
        left = r.left - gap - elW;
        top  = r.top;
        // Flip right if not enough space left AND more room right
        if (left < margin && r.right + gap + elW <= vw - margin) {
          left = r.right + gap;
        }
        break;
    }
  } else {
    // Point anchor — place top-left at that point
    left = (anchor as { x: number; y: number }).x;
    top  = (anchor as { x: number; y: number }).y;
  }

  // ── Clamp horizontally ──
  if (left + elW > vw - margin) {
    left = Math.max(margin, vw - elW - margin);
  }
  if (left < margin) {
    left = margin;
  }

  // ── Clamp vertically ──
  if (top + elH > vh - margin) {
    top = Math.max(margin, vh - elH - margin);
  }
  if (top < margin) {
    top = margin;
  }

  // ── Dynamic max-height ──
  // If the popup is taller than the space from `top` to the viewport bottom,
  // constrain it so the content scrolls instead of getting clipped.
  const availableH = vh - top - margin;
  if (elH > availableH) {
    el.style.maxHeight = `${availableH}px`;
    el.style.overflowY = 'auto';
  }

  el.style.left = `${left}px`;
  el.style.top  = `${top}px`;
}