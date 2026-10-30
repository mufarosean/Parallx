// undoToast.ts — the Undo toast: one short line at the bottom of the window
// saying what just happened ("Page moved to Trash"), with Undo beside it.
//
// It is the kit's answer to "something was removed and there is a way
// back": the action happens at once, and the toast offers the way back for
// a few seconds instead of a question before. Rules it keeps:
//   - one at a time: a new toast replaces the old, whose Undo is gone;
//   - it never takes focus; a screen reader hears it through a polite live
//     region (role="status"), and Tab reaches its buttons while it shows;
//   - it waits while a pointer (mouse, pen or finger) is on it or focus is
//     in it, and closes on Escape from inside, giving focus back to where
//     it came from;
//   - its controls are in the scene ('toast.undo', 'toast.dismiss').
// Styling is `.px-toast` in px-controls.css. The kit re-exports it as
// `showUndoToast`, and extensions get it as `api.ui.showUndoToast`.

import { createIconElement } from './iconRegistry.js';
import { scene } from './scene.js';
import type { IDisposable } from '../platform/lifecycle.js';

export interface IUndoToastOptions {
  /** What happened, in a few words: "Page moved to Trash". */
  readonly message: string;
  /** The way back. Runs once, when Undo is pressed. */
  readonly undo: () => Promise<void> | void;
  /** How long it shows, in ms, not counting time paused. Default 8000. */
  readonly timeoutMs?: number;
  /** Told when the undo throws or rejects. Default: a console warning. */
  readonly onError?: (err: unknown) => void;
}

export interface IUndoToast {
  readonly element: HTMLElement;
  /** Closes it without undoing. Safe to call twice. */
  dismiss(): void;
}

export const UNDO_TOAST_TIMEOUT_MS = 8000;
/** After a pause ends, at least this long is left to reach Undo. */
export const UNDO_TOAST_RESUME_MS = 2000;

let current: IUndoToast | null = null;
let region: HTMLElement | null = null;

/** The live region the toasts sit in: made once and kept, so the first toast is announced too. */
function liveRegion(): HTMLElement {
  if (region?.isConnected) return region;
  region = document.createElement('div');
  region.className = 'px-toast-region';
  region.setAttribute('role', 'status');
  region.setAttribute('aria-live', 'polite');
  document.body.appendChild(region);
  return region;
}

function toastButton(icon: string, label: string, iconOnly: boolean): HTMLButtonElement {
  const btn = document.createElement('button');
  btn.type = 'button';
  btn.className = `px-btn px-btn--ghost px-btn--sm${iconOnly ? ' px-btn--icon' : ' px-toast__undo'}`;
  btn.appendChild(createIconElement(icon, 14));
  if (iconOnly) {
    btn.setAttribute('aria-label', label);
    btn.title = label;
  } else {
    const text = document.createElement('span');
    text.className = 'px-btn__label';
    text.textContent = label;
    btn.appendChild(text);
  }
  return btn;
}

/** Shows the Undo toast, replacing any other. */
export function showUndoToast(options: IUndoToastOptions): IUndoToast {
  current?.dismiss();
  const host = liveRegion();
  const toast = document.createElement('div');
  toast.className = 'px-toast';
  const text = document.createElement('span');
  text.className = 'px-toast__message';
  text.textContent = options.message;
  toast.appendChild(text);
  const undoBtn = toastButton('undo', 'Undo', false);
  const closeBtn = toastButton('close', 'Dismiss', true);
  toast.append(undoBtn, closeBtn);
  host.appendChild(toast);

  const regs: IDisposable[] = [
    scene.register({ id: 'toast.undo', kind: 'button', owner: '', label: 'Undo', hint: options.message, element: undoBtn }),
    scene.register({ id: 'toast.dismiss', kind: 'iconButton', owner: '', label: 'Dismiss', element: closeBtn }),
  ];

  let closed = false;
  let remaining = options.timeoutMs ?? UNDO_TOAST_TIMEOUT_MS;
  let deadline = 0;
  let timer: ReturnType<typeof setTimeout> | undefined;
  let hovered = false;
  let focused = false;
  let returnFocus: HTMLElement | null = null;

  const dismiss = (): void => {
    if (closed) return;
    closed = true;
    if (timer !== undefined) clearTimeout(timer);
    const hadFocus = toast.contains(document.activeElement);
    for (const r of regs) r.dispose();
    toast.remove();
    if (current === handle) current = null;
    if (hadFocus && returnFocus?.isConnected) returnFocus.focus();
  };
  const run = (): void => {
    if (closed || hovered || focused || timer !== undefined) return;
    deadline = Date.now() + remaining;
    timer = setTimeout(dismiss, remaining);
  };
  const sync = (): void => {
    if (hovered || focused) {
      if (timer === undefined) return;
      clearTimeout(timer);
      timer = undefined;
      remaining = Math.max(deadline - Date.now(), UNDO_TOAST_RESUME_MS);
    } else {
      run();
    }
  };

  toast.addEventListener('pointerenter', () => { hovered = true; sync(); });
  toast.addEventListener('pointerleave', () => { hovered = false; sync(); });
  toast.addEventListener('focusin', (e) => {
    const from = e.relatedTarget;
    if (from instanceof HTMLElement && !toast.contains(from)) returnFocus = from;
    focused = true;
    sync();
  });
  toast.addEventListener('focusout', (e) => {
    if (e.relatedTarget instanceof Node && toast.contains(e.relatedTarget)) return;
    focused = false;
    sync();
  });
  toast.addEventListener('keydown', (e) => {
    if (e.key !== 'Escape') return;
    e.preventDefault();
    e.stopPropagation();
    dismiss();
  });
  undoBtn.addEventListener('click', () => {
    if (closed) return;
    dismiss();
    const fail = options.onError ?? ((err: unknown) => console.warn('[toast] Undo failed:', err));
    try { void Promise.resolve(options.undo()).catch(fail); } catch (err) { fail(err); }
  });
  closeBtn.addEventListener('click', dismiss);

  const handle: IUndoToast = { element: toast, dismiss };
  current = handle;
  run();
  return handle;
}
