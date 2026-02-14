// dom.ts — DOM helper utilities for UI components
//
// Lightweight DOM creation and event management utilities.
// Mirrors the subset of VS Code's `src/vs/base/browser/dom.ts` needed
// by the component library.

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
  descriptor: K | string,
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