// partMotion.ts — the motion curve the workbench moves its areas on.
//
// A side bar or the panel glides open and shut by moving its real size in
// the grid, frame by frame (Layout._glidePart), so the editor gives and
// takes the space on the same frames. Reduced motion, from the system or the
// Appearance switch, lands at once.

import { motionReduced } from '../ui/motionPreference.js';

/**
 * Move a number from `from` to `to` over a short, settling curve, calling
 * `step` once per frame and always once with `to` at the end. Reduced motion
 * and unseen windows jump straight to `to`. Returns a cancel function; a
 * timer lands the end value even when frames stall (a throttled window).
 */
export function tween(from: number, to: number, step: (v: number) => void, ms = 240): () => void {
  // Nothing to watch (reduced motion, a hidden window, a test DOM): land at once.
  const unseen = typeof document === 'undefined' || document.visibilityState !== 'visible' || typeof window.matchMedia !== 'function';
  if (motionReduced() || unseen || Math.abs(to - from) < 1 || typeof requestAnimationFrame !== 'function') { step(to); return () => { /* done */ }; }
  const t0 = performance.now();
  let live = true;
  // The settle curve (--px-ease, 0.22 1 0.36 1) approximated by an ease-out quint.
  const ease = (t: number): number => 1 - Math.pow(1 - t, 5);
  const land = (): void => { if (!live) return; live = false; step(to); };
  const frame = (now: number): void => {
    if (!live) return;
    // A frame's timestamp is when the frame began, which can be a moment
    // before the tween did: below 0 the curve runs backwards, past `from`.
    const t = Math.max(0, Math.min(1, (now - t0) / ms));
    if (t >= 1) { land(); return; }
    step(from + (to - from) * ease(t));
    requestAnimationFrame(frame);
  };
  requestAnimationFrame(frame);
  const timer = setTimeout(land, ms + 120);
  return () => { live = false; clearTimeout(timer); };
}
