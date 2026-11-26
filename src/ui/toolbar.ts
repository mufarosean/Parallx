// toolbar.ts — the kit's toolbar: one row of a surface's controls.
//
// A toolbar is a group a screen reader hears as one ("Sheet toolbar"), whose
// controls are ordinary kit buttons. Every button stays a Tab stop, so a
// keyboard reaches each one the way it reaches any button; Left, Right, Home
// and End also walk the row, as a toolbar's arrows do. A button that is on
// (Bold, on a bold cell) says so with aria-pressed, which the style keys on.
//
// Kit components are the one place raw DOM belongs (rawDomRatchet).

import './toolbar.css';
import { createIconElement } from './iconRegistry.js';

export interface IKitToolbarOptions {
  /** What a screen reader calls the row: "Sheet toolbar". */
  readonly label: string;
  /** 'float': a lifted bar that sits over its surface (it comes to a selection). Default: a row across the top. */
  readonly kind?: 'row' | 'float';
}

export interface IKitToolbar {
  readonly element: HTMLElement;
  /** A hairline between two groups of controls. */
  separator(): void;
  /** Pushes what follows to the row's far end. */
  spacer(): void;
  dispose(): void;
}

const FOCUSABLE = 'button:not(:disabled), [role="button"]:not([aria-disabled="true"]), input:not(:disabled), select:not(:disabled)';

export function createToolbar(container: HTMLElement | null | undefined, options: IKitToolbarOptions): IKitToolbar {
  const bar = document.createElement('div');
  bar.className = options.kind === 'float' ? 'px-toolbar px-toolbar--float' : 'px-toolbar';
  bar.setAttribute('role', 'toolbar');
  bar.setAttribute('aria-label', options.label);
  bar.setAttribute('aria-orientation', 'horizontal');

  const onKey = (e: KeyboardEvent): void => {
    if (e.altKey || e.ctrlKey || e.metaKey || e.shiftKey) return;
    if (e.key !== 'ArrowLeft' && e.key !== 'ArrowRight' && e.key !== 'Home' && e.key !== 'End') return;
    const from = e.target as HTMLElement | null;
    // A text field keeps its own arrows.
    if (!from || from.matches('input, select, textarea')) return;
    const stops = Array.from(bar.querySelectorAll<HTMLElement>(FOCUSABLE)).filter((el) => el.getClientRects().length > 0);
    const at = stops.indexOf(from);
    if (at < 0 || stops.length === 0) return;
    const to = e.key === 'Home' ? 0 : e.key === 'End' ? stops.length - 1 : (at + (e.key === 'ArrowRight' ? 1 : -1) + stops.length) % stops.length;
    e.preventDefault();
    e.stopPropagation();
    stops[to].focus();
  };
  bar.addEventListener('keydown', onKey);
  container?.appendChild(bar);

  return {
    element: bar,
    separator: () => {
      const sep = document.createElement('span');
      sep.className = 'px-toolbar__sep';
      sep.setAttribute('role', 'separator');
      sep.setAttribute('aria-orientation', 'vertical');
      bar.appendChild(sep);
    },
    spacer: () => {
      const gap = document.createElement('span');
      gap.className = 'px-toolbar__spacer';
      gap.setAttribute('aria-hidden', 'true');
      bar.appendChild(gap);
    },
    dispose: () => { bar.removeEventListener('keydown', onKey); bar.remove(); },
  };
}

/**
 * The element a toolbar works on, made in the same column: the toolbar goes
 * before it (`container.insertBefore(toolbar.element, body)`), and it takes
 * the room that is left.
 */
export function createToolbarBody(container: HTMLElement, className: string): HTMLElement {
  const body = document.createElement('div');
  body.className = `px-toolbar-body ${className}`;
  container.appendChild(body);
  return body;
}

/** Marks a toolbar button as on or off (Bold on a bold cell). A screen reader says "pressed". */
export function setToolbarPressed(button: HTMLElement, on: boolean): void {
  if (button.getAttribute('aria-pressed') !== String(on)) button.setAttribute('aria-pressed', String(on));
}

/**
 * Marks a toolbar button as one that opens a menu: the menu is said to a
 * screen reader, and a small chevron follows the button. `chevron: false`
 * for a button whose icon already says so (the three dots of More).
 */
export function markToolbarMenu(button: HTMLElement, withChevron = true): void {
  button.setAttribute('aria-haspopup', 'menu');
  if (!withChevron) return;
  button.classList.add('px-toolbar__menu');
  const chevron = createIconElement('chevron-down', 12);
  chevron.classList.add('px-toolbar__chevron');
  chevron.setAttribute('aria-hidden', 'true');
  button.appendChild(chevron);
}
