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

import './access.css';
import type { IDisposable } from '../platform/lifecycle.js';
import { installInputModality } from './inputModality.js';
import { installExternalLinks } from './externalLinks.js';

/** The document's pointer and keyboard access: drag and drop by finger, focus rings by modality, links that never leave the app. */
export function installInputAccess(doc: Document = document): IDisposable {
  const a = installTouchDragAndDrop(doc);
  const b = installInputModality(doc);
  const c = installExternalLinks(doc.defaultView ?? window);
  return { dispose: () => { a.dispose(); b.dispose(); c.dispose(); } };
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

export interface IDragPressOptions {
  /** The element also scrolls by finger (a root that delegates to its
   *  handles): it keeps the browser's panning, and the handles set
   *  touch-action: none themselves. */
  readonly scrolls?: boolean;
  /** On a surface a finger scrolls (a page, a list): the finger holds still
   *  for TOUCH_HOLD_MS before the drag starts, and moving sooner scrolls,
   *  as on a phone. Implies `scrolls`. */
  readonly hold?: boolean;
  /** Listen in the capture phase, as the mousedown listener it replaces did. */
  readonly capture?: boolean;
  /** The handler works with pointer events (capture, pointermove) rather
   *  than the mouse's: every press arrives as its pointerdown and no mouse
   *  events are made for it. With `hold`, a finger still holds first. */
  readonly pointerEvents?: boolean;
}

/** Fingers carrying a drag that began by holding: the document's touchmove keeps them from scrolling. */
let claimed = 0;
/** A drag and drop is in flight (installTouchDragAndDrop): as with a mouse, no mouse moves are made meanwhile. */
let dndInFlight = false;

/**
 * A press that starts a drag, for every kind of pointer. `handler` is what
 * the element's mousedown listener was: it runs for a mouse press as before,
 * and for a finger or pen press with the pointer event (a MouseEvent too).
 * While that finger stays down its moves and its lift are sent as mousemove
 * and mouseup where the finger is, so a drag that listens to the document's
 * mouse moves follows it. The element claims the finger from scrolling
 * (touch-action: none) unless `scrolls` or `hold`.
 */
export function onDragPress(el: HTMLElement, handler: (e: MouseEvent) => void, opts: IDragPressOptions = {}): IDisposable {
  const capture = !!opts.capture;
  const onMouse = (e: MouseEvent): void => { if (!fromTouch(e)) handler(e); };
  const onPointer = (e: PointerEvent): void => {
    if (!e.isPrimary) return;
    // One press, one drag: an inner handle that took it wins over the surface around it,
    // and an item the browser's drag and drop owns is never also a held press on its surface.
    const marked = e as PointerEvent & { __pxDragPress?: boolean };
    if (marked.__pxDragPress) return;
    const owned = (e.target as Element | null)?.closest?.('[draggable="true"]');
    if (opts.hold && owned && owned !== el && el.contains(owned)) return; // an item inside this surface (not a draggable wrapper around it)
    marked.__pxDragPress = true;
    if (e.pointerType === 'mouse') { if (opts.pointerEvents) handler(e); return; }
    const id = e.pointerId;
    const x0 = e.clientX, y0 = e.clientY;
    let started = false;
    let timer = 0;
    const target = (p: PointerEvent): EventTarget => document.elementFromPoint(p.clientX, p.clientY) ?? document;
    const stop = (): void => {
      clearTimeout(timer);
      document.removeEventListener('pointermove', move, true);
      document.removeEventListener('pointerup', up, true);
      document.removeEventListener('pointercancel', up, true);
    };
    const begin = (): void => { started = true; if (opts.hold) claimed++; handler(e); };
    const move = (p: PointerEvent): void => {
      if (p.pointerId !== id) return;
      if (!started) {
        // Moving before the hold is up: the finger is scrolling.
        if (Math.hypot(p.clientX - x0, p.clientY - y0) > TOUCH_SLOP_PX) stop();
        return;
      }
      if (!opts.pointerEvents && !dndInFlight) target(p).dispatchEvent(mouseFrom('mousemove', p, 1));
    };
    const up = (p: PointerEvent): void => {
      if (p.pointerId !== id) return;
      stop();
      if (!started) {
        // Lifted before the hold was up, without moving: a tap, which is a
        // press and a release to the handler, as a mouse click is.
        if (!opts.hold || p.type === 'pointercancel') return;
        // (In pointer mode the real release, still on its way, reaches the handler's listeners.)
        begin();
      }
      if (opts.hold) claimed = Math.max(0, claimed - 1);
      // A mouse that drags and drops makes no mouseup (dragend ends it): neither does a finger that did.
      if (!opts.pointerEvents && !dndInFlight) target(p).dispatchEvent(mouseFrom('mouseup', p, 0));
    };
    document.addEventListener('pointermove', move, true);
    document.addEventListener('pointerup', up, true);
    document.addEventListener('pointercancel', up, true);
    if (opts.hold) timer = window.setTimeout(begin, TOUCH_HOLD_MS);
    else begin();
  };
  if (!opts.pointerEvents) el.addEventListener('mousedown', onMouse, capture);
  el.addEventListener('pointerdown', onPointer, capture);
  const claims = !opts.scrolls && !opts.hold;
  const prevTouchAction = el.style.touchAction;
  if (claims) el.style.touchAction = 'none';
  return {
    dispose: () => {
      if (!opts.pointerEvents) el.removeEventListener('mousedown', onMouse, capture);
      el.removeEventListener('pointerdown', onPointer, capture);
      if (claims) el.style.touchAction = prevTouchAction;
    },
  };
}

/**
 * The browser's drag and drop from a finger or pen: hold a draggable item
 * still for TOUCH_HOLD_MS, then move. Installed once for the document.
 */
export function installTouchDragAndDrop(doc: Document = document): IDisposable {
  let pending: { src: HTMLElement; x: number; y: number; timer: number; lifted: boolean } | null = null;
  let drag: { src: HTMLElement; dt: DataTransfer; ghost: HTMLElement; over: Element | null; accepted: boolean; dx: number; dy: number; at: { clientX: number; clientY: number }; beat: number } | null = null;
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
    drag = { src, dt, ghost, over: null, accepted: false, dx: t.clientX - r.left, dy: t.clientY - r.top, at: { clientX: t.clientX, clientY: t.clientY }, beat: 0 };
    dndInFlight = true;
    // As the browser does, dragover repeats while the finger rests: drop targets that time out their guides keep them.
    drag.beat = window.setInterval(() => { if (drag) move(drag.at as Touch); }, 50);
    swallowMenu = true;
    placeGhost(t.clientX, t.clientY);
    move(t);
  };

  const move = (t: Touch): void => {
    if (!drag) return;
    drag.at = { clientX: t.clientX, clientY: t.clientY };
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
    clearInterval(d.beat);
    const at = t ? { clientX: t.clientX, clientY: t.clientY } : d.at;
    const end = (): void => {
      if (drag !== d) return; // already ended (Escape in the frame before the drop)
      drag = null;
      dndInFlight = false;
      d.ghost.remove();
      if (!canceled && d.over && d.accepted) fire('drop', d.over, at, d.dt);
      else { if (d.over) fire('dragleave', d.over, at, d.dt); d.dt.dropEffect = 'none'; }
      fire('dragend', d.src, at, d.dt);
    };
    if (canceled) { end(); return; }
    // The drop comes after a last dragover where the finger lifted, a couple of frames later, as with a mouse:
    // a drop target that settles its guide on the next frame has settled it (a timer: a frame callback can stall).
    move(at as Touch);
    window.setTimeout(end, 40);
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
    if (claimed > 0 && !drag) { e.preventDefault(); return; } // a held press is dragging (onDragPress)
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
