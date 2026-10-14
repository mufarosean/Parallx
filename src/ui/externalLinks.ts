// externalLinks.ts — a web or mail link never navigates the app's window.
//
// A plain <a href> (no target) navigates the window it sits in. In Parallx
// that window is the app: the navigation starts its shutdown (beforeunload,
// src/main.ts) before the main process can refuse it, and the app inside
// the window is gone. A link that nothing else handled (its click not
// prevented) opens where window.open's links do: the browser extension when
// it claims links, else the system browser (electron/main.cjs). Enter on a
// focused link is the same click, so the keyboard is covered too.

import type { IDisposable } from '../platform/lifecycle.js';

export function installExternalLinks(win: Window = window): IDisposable {
  const onClick = (e: MouseEvent): void => {
    if (e.defaultPrevented || e.button > 1) return;
    const a = (e.target as Element | null)?.closest?.('a[href]') as HTMLAnchorElement | null;
    if (!a || a.hasAttribute('download')) return;
    let url: URL;
    try { url = new URL(a.href, win.location.href); } catch { return; }
    if (!/^(https?:|mailto:)$/.test(url.protocol) || url.origin === win.location.origin) return;
    e.preventDefault();
    win.open(url.href, '_blank', 'noopener');
  };
  // Last, at the window, in the bubble phase: whatever handles its own links (an editor, a viewer) goes first.
  win.addEventListener('click', onClick);
  win.addEventListener('auxclick', onClick);
  return { dispose: () => { win.removeEventListener('click', onClick); win.removeEventListener('auxclick', onClick); } };
}
