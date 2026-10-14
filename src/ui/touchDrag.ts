// touchDrag.ts — every drag works with a finger or a pen, not only a mouse
// (docs/ACCESSIBILITY.md, section 8).
//
// Two shapes of drag live in the app, and a touchscreen reaches neither on
// its own: the browser turns a finger into mouse events only for a tap,
// never for a drag, and it keeps a moving finger for scrolling.
//
// - The browser's drag and drop (draggable="true": tabs, tree rows, cards).
//   Chromium starts none from a finger. installTouchDragAndDrop gives it
//   the phone's gesture: hold a moment, then move. The same events a mouse
//   drag fires (dragstart, dragenter, dragover, dragleave, drop, dragend)
//   go to the same handlers, with a ghost of the item under the finger.
// - Drags the app tracks itself (dividers, grips, frames). onDragPress
//   starts one from a mouse, pen or finger alike: the mouse path is the
//   plain mousedown it always was; a finger or pen press runs the same
//   handler and its moves and lift reach the drag as mouse moves and a
//   mouseup. The handle claims the finger (touch-action: none) unless it
//   also scrolls.

import type { IDisposable } from '../platform/lifecycle.js';
import { installInputModality } from './inputModality.js';

/** The document's pointer and keyboard access: drag and drop by finger, focus rings by modality. */
export function installInputAccess(doc: Document = document): IDisposable {
  const a = installTouchDragAndDrop(doc);
  const b = installInputModality(doc);
  return { dispose: () => { a.dispose(); b.dispose(); } };
}

/** How long a finger holds still before a draggable item lifts (ms). */
export const TOUCH_HOLD_MS = 350;
/** How far a finger may wander during the hold before it is a scroll instead (px). */
const TOUCH_SLOP_PX = 10;

/** A compatibility mouse event the browser made from a touch (a tap). */
function fromTouch(e: MouseEvent): boolean {
  return !!(e as MouseEvent & { sourceCapabilities?: { firesTouchEvents?: boolean } }).sourceCapabilities?.firesTouchEvents;
}

function mouseFrom(type: string, p: PointerEvent, buttons: number): MouseEvent {
  return new MouseEvent(type, {
    bubbles: true, cancelable: true, composed: true, view: window,
    clientX: p.clientX, clientY: p.clientY, screenX: p.screenX, screenY: p.screenY,
    button: 0, buttons, detail: 1,
    ctrlKey: p.ctrlKey, shiftKey: p.shiftKey, altKey: p.altKey, metaKey: p.metaKey,
  });
}

/**
 * A press that starts a drag, for every kind of pointer. `handler` is what
 * the element's mousedown listener was: it runs for a mouse press as before,
 * and for a finger or pen press with the pointer event (a MouseEvent too).
 * While that finger stays down its moves and its lift are sent as mousemove
 * and mouseup where the finger is, so a drag that listens to the document's
 * mouse moves follows it. `scrolls`: the element also scrolls by finger
 * (a delegating root), so it keeps the browser's panning and its handles
 * set touch-action themselves.
 */
export function onDragPress(el: HTMLElement, handler: (e: MouseEvent) => void, opts: { scrolls?: boolean } = {}): IDisposable {
  const onMouse = (e: MouseEvent): void => { if (!fromTouch(e)) handler(e); };
  const onPointer = (e: PointerEvent): void => {
    if (e.pointerType === 'mouse' || !e.isPrimary) return;
    handler(e);
    const id = e.pointerId;
    const target = (p: PointerEvent): EventTarget => document.elementFromPoint(p.clientX, p.clientY) ?? document;
    const move = (p: PointerEvent): void => { if (p.pointerId === id) target(p).dispatchEvent(mouseFrom('mousemove', p, 1)); };
    const up = (p: PointerEvent): void => {
      if (p.pointerId !== id) return;
      document.removeEventListener('pointermove', move, true);
      document.removeEventListener('pointerup', up, true);
      document.removeEventListener('pointercancel', up, true);
      target(p).dispatchEvent(mouseFrom('mouseup', p, 0));
    };
    document.addEventListener('pointermove', move, true);
    document.addEventListener('pointerup', up, true);
    document.addEventListener('pointercancel', up, true);
  };
  el.addEventListener('mousedown', onMouse);
  el.addEventListener('pointerdown', onPointer);
  const prevTouchAction = el.style.touchAction;
  if (!opts.scrolls) el.style.touchAction = 'none';
  return {
    dispose: () => {
      el.removeEventListener('mousedown', onMouse);
      el.removeEventListener('pointerdown', onPointer);
      if (!opts.scrolls) el.style.touchAction = prevTouchAction;
    },
  };
}

/**
 * The browser's drag and drop from a finger or pen: hold a draggable item
 * still for TOUCH_HOLD_MS, then move. Installed once for the document.
 */
export function installTouchDragAndDrop(doc: Document = document): IDisposable {
  let pending: { src: HTMLElement; x: number; y: number; timer: number; lifted: boolean } | null = null;
  let drag: { src: HTMLElement; dt: DataTransfer; ghost: HTMLElement; over: Element | null; accepted: boolean; dx: number; dy: number } | null = null;
  let swallowMenu = false;

  const fire = (type: string, target: EventTarget, t: Touch | { clientX: number; clientY: number }, dt: DataTransfer, related?: Element | null): DragEvent => {
    const ev = new DragEvent(type, {
      bubbles: true, cancelable: type !== 'dragleave' && type !== 'dragend', composed: true, view: window,
      clientX: t.clientX, clientY: t.clientY, dataTransfer: dt, relatedTarget: related ?? null,
    });
    target.dispatchEvent(ev);
    return ev;
  };

  const placeGhost = (x: number, y: number): void => {
    if (!drag) return;
    drag.ghost.style.left = `${x - drag.dx}px`;
    drag.ghost.style.top = `${y - drag.dy}px`;
  };

  const lift = (t: Touch): void => {
    if (!pending) return;
    const src = pending.src;
    pending = null;
    const dt = new DataTransfer();
    const start = fire('dragstart', src, t, dt);
    if (start.defaultPrevented) return;
    const r = src.getBoundingClientRect();
    const ghost = src.cloneNode(true) as HTMLElement;
    ghost.removeAttribute('id');
    ghost.classList.add('px-touch-drag-ghost');
    ghost.setAttribute('aria-hidden', 'true');
    ghost.style.width = `${r.width}px`;
    ghost.style.height = `${r.height}px`;
    doc.body.appendChild(ghost);
    drag = { src, dt, ghost, over: null, accepted: false, dx: t.clientX - r.left, dy: t.clientY - r.top };
    swallowMenu = true;
    placeGhost(t.clientX, t.clientY);
    move(t);
  };

  const move = (t: Touch): void => {
    if (!drag) return;
    placeGhost(t.clientX, t.clientY);
    const over = doc.elementFromPoint(t.clientX, t.clientY);
    if (over !== drag.over) {
      if (drag.over) fire('dragleave', drag.over, t, drag.dt, over);
      if (over) fire('dragenter', over, t, drag.dt, drag.over);
      drag.over = over;
    }
    drag.accepted = over ? fire('dragover', over, t, drag.dt).defaultPrevented : false;
  };

  const finish = (t: Touch | null, canceled: boolean): void => {
    if (pending) { clearTimeout(pending.timer); pending = null; }
    if (!drag) return;
    const d = drag;
    drag = null;
    d.ghost.remove();
    const at = t ?? { clientX: 0, clientY: 0 };
    if (!canceled && d.over && d.accepted) fire('drop', d.over, at, d.dt);
    else { if (d.over) fire('dragleave', d.over, at, d.dt); d.dt.dropEffect = 'none'; }
    fire('dragend', d.src, at, d.dt);
  };

  const onStart = (e: TouchEvent): void => {
    if (e.touches.length !== 1) { finish(null, true); return; }
    const src = (e.target as Element | null)?.closest?.('[draggable="true"]') as HTMLElement | null;
    if (!src) return;
    const t = e.touches[0];
    pending = { src, x: t.clientX, y: t.clientY, lifted: false, timer: window.setTimeout(() => { if (pending) pending.lifted = true; }, TOUCH_HOLD_MS) };
  };

  const onMove = (e: TouchEvent): void => {
    const t = e.touches[0];
    if (!t) return;
    if (drag) { e.preventDefault(); move(t); return; }
    if (!pending) return;
    if (!pending.lifted) {
      // Moving before the hold is up: a scroll or a swipe, not a drag.
      if (Math.hypot(t.clientX - pending.x, t.clientY - pending.y) > TOUCH_SLOP_PX) { clearTimeout(pending.timer); pending = null; }
      return;
    }
    e.preventDefault();
    lift(t);
  };

  const onEnd = (e: TouchEvent): void => {
    if (drag) e.preventDefault(); // no click on the item that was dropped
    finish(e.changedTouches[0] ?? null, e.type === 'touchcancel');
  };

  // A held finger also asks for the context menu; not while it carries an item.
  const onMenu = (e: Event): void => { if (swallowMenu || drag) { e.preventDefault(); e.stopPropagation(); } swallowMenu = false; };
  const onKey = (e: KeyboardEvent): void => { if (drag && e.key === 'Escape') { e.preventDefault(); finish(null, true); } };

  doc.addEventListener('touchstart', onStart, { passive: true, capture: true });
  doc.addEventListener('touchmove', onMove, { passive: false, capture: true });
  doc.addEventListener('touchend', onEnd, { passive: false, capture: true });
  doc.addEventListener('touchcancel', onEnd, { passive: false, capture: true });
  doc.addEventListener('contextmenu', onMenu, true);
  doc.addEventListener('keydown', onKey, true);
  return {
    dispose: () => {
      finish(null, true);
      doc.removeEventListener('touchstart', onStart, { capture: true });
      doc.removeEventListener('touchmove', onMove, { capture: true });
      doc.removeEventListener('touchend', onEnd, { capture: true });
      doc.removeEventListener('touchcancel', onEnd, { capture: true });
      doc.removeEventListener('contextmenu', onMenu, true);
      doc.removeEventListener('keydown', onKey, true);
    },
  };
}
