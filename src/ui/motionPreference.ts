// motionPreference.ts — should motion play? One answer for every animation in code.
//
// No when the computer asks for reduced motion, and no when the user turned
// on Settings › Appearance › Reduce Motion (pxAppearance sets
// data-px-motion="reduced" on the root; px-motion.css stills every CSS
// animation and transition for either). Code that animates by hand (panel
// slides, tab glides, selection glides, the canvas's AI edit review) asks
// here instead of reading the media query itself.

export function motionReduced(): boolean {
  if (typeof document !== 'undefined' && document.documentElement?.getAttribute('data-px-motion') === 'reduced') return true;
  try { return window.matchMedia('(prefers-reduced-motion: reduce)').matches; } catch { return false; }
}
