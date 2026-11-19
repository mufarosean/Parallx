// stackedBar.ts — one bar of counts in four states (good, middling, poor, and
// the rest not worked yet): a paper's questions, a deck's cards, a unit's
// work. The kit's stacked bar, re-exported by kit.ts as createStackedBar.
//
// What it holds for every caller: the parts keep one order (good, middling,
// poor, rest) whatever order they are given in; a part with nothing in it is
// not drawn; the whole bar has a name a screen reader speaks in full; a part
// given an action is a button with its own name, in the Tab order, wide
// enough for a finger; a bar with no action is one picture. It is never read
// by colour alone: a gap of the surface separates the parts, each state has
// its own texture (good solid, middling hatched, poor ticked) and the rest is
// an outline (stackedBar.css). A part's words ("Wrong: 2") are its tooltip,
// and not for the mouse only: they show when the keyboard's focus arrives on
// a part, on a tap or click of a part that does nothing else, and on a long
// press of one that acts (a tap there runs its action).

import { declareControl, type IKitControlDeclaration } from './kit.js';
import { runCommand } from './kitCommands.js';
import { dismissTooltipNow, showTooltipNow } from './tooltip.js';
import type { IDisposable } from '../platform/lifecycle.js';
import './stackedBar.css';

export type StackedBarState = 'good' | 'middling' | 'poor' | 'rest';
const ORDER: readonly StackedBarState[] = ['good', 'middling', 'poor', 'rest'];
/** How long a finger rests on a part that acts before its words show in place of its action. */
const LONG_PRESS_MS = 500;

export interface IKitStackedBarPart extends IKitControlDeclaration {
  readonly state: StackedBarState;
  /** How many items are in this state; the part is as wide as its share. */
  readonly count: number;
  /** The part's own name: what a screen reader speaks when it is a button ("Mack, Questions, wrong: 2. Study these"), and its tooltip unless `title` gives a shorter one. The tooltip is shown to the mouse, to the keyboard's focus and to a finger. */
  readonly label: string;
  /** The tooltip, when the row it sits in already says whose bar it is ("Wrong: 2"). */
  readonly title?: string;
  /** With a command or a handler the part is a button. */
  readonly command?: string;
  readonly args?: readonly unknown[];
  readonly onClick?: (e: MouseEvent) => void;
}

export interface IKitStackedBarOptions {
  /** The whole bar, spoken in full: "Mack, Questions: 12 right, 3 partly, 2 wrong, 5 not yet". */
  readonly label: string;
  readonly parts: readonly IKitStackedBarPart[];
  /** 'md' (default) on a page; 'sm' a thin line in a list row, which is never pressable. */
  readonly size?: 'md' | 'sm';
}

export interface IKitStackedBar {
  readonly element: HTMLElement;
  /** Draw new counts in the same element; the focus stays on the part it was on. */
  update(options: IKitStackedBarOptions): void;
  dispose(): void;
}

export function createStackedBar(container: HTMLElement | null | undefined, options: IKitStackedBarOptions): IKitStackedBar {
  const root = document.createElement('div');
  let declared: IDisposable[] = [];
  // A part's words for whoever has no hover (tooltip.ts, showTooltipNow).
  const words = new WeakMap<Element, string>();
  let said = false;
  const say = (part: HTMLElement | null | undefined): void => {
    const text = part ? words.get(part) : '';
    if (!part || !text) return;
    said = true;
    showTooltipNow(part, text);
  };
  const unsay = (): void => { if (said) { said = false; dismissTooltipNow(); } };
  const partOf = (e: Event): HTMLElement | null => (e.target as HTMLElement | null)?.closest?.<HTMLElement>('.px-stacked-bar__part') ?? null;
  // The keyboard's focus arriving on a part (a press that focuses one is about to run its action instead).
  root.addEventListener('focusin', (e) => { if (root.ownerDocument.documentElement.dataset.inputModality === 'keyboard') say(partOf(e)); });
  // A tap or a click on a part that does nothing else.
  root.addEventListener('click', (e) => { const part = partOf(e); if (part && part.tagName !== 'BUTTON') say(part); });
  // A long press by finger or pen on a part that acts: its words. The press then ends without running the part,
  // and without the menu a long press asks the system for.
  let hold: ReturnType<typeof setTimeout> | undefined;
  let held = false;
  const letGo = (): void => { clearTimeout(hold); hold = undefined; };
  root.addEventListener('pointerdown', (e) => {
    letGo();
    held = false;
    const part = partOf(e);
    if (!part || part.tagName !== 'BUTTON' || (e.pointerType !== 'touch' && e.pointerType !== 'pen')) return;
    hold = setTimeout(() => { hold = undefined; if (!part.isConnected) return; held = true; say(part); }, LONG_PRESS_MS);
  });
  for (const type of ['pointerup', 'pointercancel', 'pointerleave'] as const) root.addEventListener(type, letGo);
  // The click that ends a long press is not the part's; the words stay up after the finger lifts, until the next press.
  root.addEventListener('click', (e) => { if (!held) return; held = false; e.preventDefault(); e.stopPropagation(); say(partOf(e)); }, true);
  root.addEventListener('contextmenu', (e) => {
    const by = (e as PointerEvent).pointerType;
    if (partOf(e) && (by === 'touch' || by === 'pen')) e.preventDefault();
  });

  function draw(o: IKitStackedBarOptions): void {
    const focused = root.contains(document.activeElement) ? (document.activeElement as HTMLElement).dataset.state : undefined;
    for (const d of declared) d.dispose();
    declared = [];
    unsay();
    root.replaceChildren();
    const small = o.size === 'sm';
    root.className = `px-stacked-bar${small ? ' px-stacked-bar--sm' : ''}`;
    root.setAttribute('aria-label', o.label);
    let pressable = false;
    for (const state of ORDER) {
      const part = o.parts.find((p) => p.state === state);
      const count = part ? Math.floor(Number(part.count)) : 0;
      if (!part || !(count > 0)) continue;
      const acts = !small && (!!part.command || !!part.onClick);
      const el = document.createElement(acts ? 'button' : 'span');
      el.className = 'px-stacked-bar__part';
      el.dataset.state = state;
      el.style.flexGrow = String(count);
      el.title = part.title ?? part.label;
      words.set(el, el.title);
      root.appendChild(el);
      if (!acts) continue;
      pressable = true;
      (el as HTMLButtonElement).type = 'button';
      el.setAttribute('aria-label', part.label);
      const command = part.command;
      const onClick = part.onClick;
      el.addEventListener('click', onClick ? (e) => onClick(e as MouseEvent) : () => runCommand({ command: command!, args: part.args }));
      if (part.id) declared.push(declareControl(el, { id: part.id, label: part.label, command, hint: part.hint, when: part.when }));
      if (focused === state) el.focus();
    }
    // Buttons inside are met one by one, so the bar is their group; with none it is one picture with a name.
    root.setAttribute('role', pressable ? 'group' : 'img');
    root.hidden = !root.firstChild;
  }

  // Mounted first: a part with an id joins the scene of the surface it is in.
  if (container) container.appendChild(root);
  draw(options);
  return {
    element: root,
    update: draw,
    dispose() {
      for (const d of declared) d.dispose();
      declared = [];
      letGo();
      unsay();
      root.remove();
    },
  };
}
