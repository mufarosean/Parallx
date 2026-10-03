// glide.ts — a selection highlight that slides from the old row to the new.
//
// Lists that move a selection by swapping classes (the command palette, the
// explorer) jump from row to row. glideHighlight lays a copy of the highlight
// over the OLD row, moves it to the NEW row, and only then lets the new row
// show its own highlight: the eye follows one thing instead of a blink.
// Styling comes from the caller's class (e.g. .command-palette-glide);
// .px-glide-target hides the target row's own highlight while it travels.
// Lands at once with reduced motion, in an unseen window, or under jsdom.

import { motionReduced } from './motionPreference.js';

const DURATION_MS = 140;

function stillMotion(): boolean {
  if (typeof window === 'undefined' || typeof window.matchMedia !== 'function') return true;
  if (document.visibilityState !== 'visible') return true;
  return motionReduced();
}

export function glideHighlight(container: HTMLElement, from: HTMLElement | null, to: HTMLElement | null, overlayClass: string): void {
  if (!from || !to || from === to || stillMotion()) return;
  if (!container.contains(from) || !container.contains(to)) return;
  const cRect = container.getBoundingClientRect();
  const a = from.getBoundingClientRect();
  const b = to.getBoundingClientRect();
  if (!a.height || !b.height) return;
  // Far jumps (Home/End, a long scroll) just land.
  if (Math.abs(b.top - a.top) > 8 * b.height) return;

  if (getComputedStyle(container).position === 'static') container.style.position = 'relative';
  container.querySelectorAll(`:scope > .${overlayClass}`).forEach((n) => n.remove());

  const top = (r: DOMRect): number => r.top - cRect.top + container.scrollTop;
  const left = (r: DOMRect): number => r.left - cRect.left + container.scrollLeft;
  const glide = document.createElement('div');
  glide.className = `px-glide ${overlayClass}`;
  glide.setAttribute('aria-hidden', 'true');
  Object.assign(glide.style, {
    top: `${top(a)}px`,
    left: `${left(b)}px`,
    width: `${b.width}px`,
    height: `${a.height}px`,
  });
  container.appendChild(glide);
  to.classList.add('px-glide-target');

  let done = false;
  const land = (): void => {
    if (done) return;
    done = true;
    glide.remove();
    to.classList.remove('px-glide-target');
  };
  requestAnimationFrame(() => {
    glide.style.transform = `translateY(${top(b) - top(a)}px)`;
    glide.style.height = `${b.height}px`;
  });
  glide.addEventListener('transitionend', land, { once: true });
  setTimeout(land, DURATION_MS + 120);
}
