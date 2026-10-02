// partMotion.ts — how a workbench area arrives and leaves.
//
// The grid adds and removes an area in one step; these move its content so
// the change reads as one motion instead of a jump. They use the motion
// tokens (--px-dur-*, --px-ease*), so reduced motion and the theme's tempo
// apply, and every path ends on a timeout too: a transition that never
// fires (reduced motion, a hidden window) still finishes.

export type PartEdge = 'left' | 'right' | 'bottom';

const SETTLE_MS = 260;

/** Slide an area's content in from its edge. The area is already in place. */
export function animatePartIn(el: HTMLElement, edge: PartEdge): void {
  el.classList.add('part-animating', 'part-collapsed', `part-collapsed--${edge}`);
  void el.offsetWidth;
  el.classList.remove('part-collapsed', `part-collapsed--${edge}`);
  let done = false;
  const finish = (): void => {
    if (done) return;
    done = true;
    el.classList.remove('part-animating');
  };
  el.addEventListener('transitionend', finish, { once: true });
  setTimeout(finish, SETTLE_MS);
}

/** Slide an area's content out toward its edge, then call `then` to remove it. */
export function animatePartOut(el: HTMLElement, edge: PartEdge, then: () => void): void {
  el.classList.add('part-animating', 'part-collapsed', `part-collapsed--${edge}`);
  let done = false;
  const finish = (): void => {
    if (done) return;
    done = true;
    el.classList.remove('part-animating', 'part-collapsed', `part-collapsed--${edge}`);
    then();
  };
  el.addEventListener('transitionend', finish, { once: true });
  setTimeout(finish, SETTLE_MS);
}

function prefersReducedMotion(): boolean {
  try { return window.matchMedia('(prefers-reduced-motion: reduce)').matches; } catch { return false; }
}

/**
 * Move a number from `from` to `to` over a short, settling curve, calling
 * `step` once per frame and always once with `to` at the end. Reduced motion
 * and unseen windows jump straight to `to`. Returns a cancel function; a
 * timer lands the end value even when frames stall (a throttled window).
 */
export function tween(from: number, to: number, step: (v: number) => void, ms = 240): () => void {
  // Nothing to watch (reduced motion, a hidden window, a test DOM): land at once.
  const unseen = typeof document === 'undefined' || document.visibilityState !== 'visible' || typeof window.matchMedia !== 'function';
  if (prefersReducedMotion() || unseen || Math.abs(to - from) < 1 || typeof requestAnimationFrame !== 'function') { step(to); return () => { /* done */ }; }
  const t0 = performance.now();
  let live = true;
  // The settle curve (--px-ease, 0.22 1 0.36 1) approximated by an ease-out quint.
  const ease = (t: number): number => 1 - Math.pow(1 - t, 5);
  const land = (): void => { if (!live) return; live = false; step(to); };
  const frame = (now: number): void => {
    if (!live) return;
    const t = Math.min(1, (now - t0) / ms);
    if (t >= 1) { land(); return; }
    step(from + (to - from) * ease(t));
    requestAnimationFrame(frame);
  };
  requestAnimationFrame(frame);
  const timer = setTimeout(land, ms + 120);
  return () => { live = false; clearTimeout(timer); };
}
