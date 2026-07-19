// scrollbarReveal.ts — ONE visibility mechanism for every scrollbar in the app
//
// THE RULE (design decision, 2026-07-19): any scrollable surface shows its
// scrollbar thumb while the user is HOVERING it or actively SCROLLING it —
// and at no other time.
//
// Why JS classes instead of pure CSS `:hover`: Chromium's repaint of
// `::-webkit-scrollbar-*` pseudo-elements on dynamic pseudo-class changes is
// unreliable (the old `.part-… :hover::-webkit-scrollbar-thumb` rules in
// workbench.css never fired on some surfaces — the PDF viewer most visibly),
// which is why half the app grew per-surface always-on scrollbar CSS. Class
// toggles on the scroll element itself trigger a full style recalc, which
// repaints scrollbars dependably. The classes:
//
//   .px-scrollbar-hover     — pointer is over this scrollable element
//                             (nearest scrollable ancestor of the pointer)
//   .px-scrollbar-scrolling — element scrolled within the last 700ms
//
// workbench.css keys thumb visibility off these two classes GLOBALLY; surface
// stylesheets may size their scrollbars (width/height) but must never set
// thumb colors or `scrollbar-width` (the latter flips Chromium to CSS
// Scrollbars mode and disables ::-webkit-scrollbar styling entirely).
//
// Installed once by the workbench on `document` — delegation covers every
// surface including popups appended to <body>. Sandboxed iframes (dashboard
// HTML widgets) are separate documents and style their own scrollbars.

import { rafThrottle } from '../platform/rafThrottle.js';
import type { IDisposable } from '../platform/lifecycle.js';

const HOVER_CLASS = 'px-scrollbar-hover';
const SCROLLING_CLASS = 'px-scrollbar-scrolling';
/** How long the thumb lingers after the last scroll event. */
const SCROLL_LINGER_MS = 700;

function isScrollableElement(el: Element): el is HTMLElement {
  if (!(el instanceof HTMLElement)) return false;
  // Fast reject: no overflow means no scrollbar to reveal.
  if (el.scrollHeight <= el.clientHeight && el.scrollWidth <= el.clientWidth) return false;
  const style = getComputedStyle(el);
  return /(auto|scroll|overlay)/.test(style.overflowY + ' ' + style.overflowX);
}

/** Nearest self-or-ancestor that can actually scroll. */
function nearestScrollable(start: Element | null, boundary: Node): HTMLElement | null {
  let cur: Element | null = start;
  while (cur && cur !== boundary) {
    if (isScrollableElement(cur)) return cur;
    cur = cur.parentElement;
  }
  return null;
}

/**
 * Install the app-wide scrollbar reveal controller. Idempotent per document
 * (a second install returns a no-op disposable).
 */
export function installScrollbarReveal(doc: Document): IDisposable {
  const marker = '__pxScrollbarReveal';
  const docAny = doc as unknown as Record<string, unknown>;
  if (docAny[marker]) {
    return { dispose: () => { /* second install is a no-op */ } };
  }
  docAny[marker] = true;

  let hovered: HTMLElement | null = null;
  const scrollTimers = new Map<HTMLElement, ReturnType<typeof setTimeout>>();

  // ── Hover: pointerover fires on target changes (not per-move) ──
  const onPointerOver = rafThrottle((target: Element | null) => {
    const next = nearestScrollable(target, doc);
    if (next === hovered) return;
    hovered?.classList.remove(HOVER_CLASS);
    hovered = next;
    hovered?.classList.add(HOVER_CLASS);
  });

  const pointerOverListener = (e: Event): void => {
    onPointerOver(e.target instanceof Element ? e.target : null);
  };
  const pointerLeaveListener = (): void => {
    onPointerOver(null);
    onPointerOver.flush();
  };

  // ── Scrolling: capture phase sees scroll on every element ──
  const scrollListener = (e: Event): void => {
    const el = e.target;
    if (!(el instanceof HTMLElement)) return; // window/document scroll
    if (!el.classList.contains(SCROLLING_CLASS)) {
      el.classList.add(SCROLLING_CLASS);
    }
    const existing = scrollTimers.get(el);
    if (existing !== undefined) clearTimeout(existing);
    scrollTimers.set(el, setTimeout(() => {
      el.classList.remove(SCROLLING_CLASS);
      scrollTimers.delete(el);
    }, SCROLL_LINGER_MS));
  };

  doc.addEventListener('pointerover', pointerOverListener, { passive: true });
  doc.documentElement.addEventListener('pointerleave', pointerLeaveListener, { passive: true });
  doc.addEventListener('scroll', scrollListener, { capture: true, passive: true });

  return {
    dispose(): void {
      doc.removeEventListener('pointerover', pointerOverListener);
      doc.documentElement.removeEventListener('pointerleave', pointerLeaveListener);
      doc.removeEventListener('scroll', scrollListener, { capture: true } as EventListenerOptions);
      onPointerOver.dispose();
      hovered?.classList.remove(HOVER_CLASS);
      hovered = null;
      for (const [el, timer] of scrollTimers) {
        clearTimeout(timer);
        el.classList.remove(SCROLLING_CLASS);
      }
      scrollTimers.clear();
      delete docAny[marker];
    },
  };
}
