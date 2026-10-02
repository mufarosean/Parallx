// kit.ts — the workbench's chrome components, one definition each.
//
// Every surface (built-in or extension, through `api.ui`) builds its buttons,
// page headers, empty states and section labels here, so there is one height
// ladder, one radius, one type scale and one hierarchy of actions. Styling is
// in px-controls.css (`.px-btn`, `.px-page-header`, `.px-section-label`) and
// ui.css (`.px-empty`); this file only assembles DOM and enforces the rules
// that CSS cannot: at most one primary action per header, the rest overflow.
//
// Before this existed the extension API offered a dropdown and a menu, so
// every extension cloned its own buttons and headers (media-organizer carried
// 22 button classes); DESIGN_UNIFICATION.md lever 3.

import { createIconElement } from './iconRegistry.js';
import { showExtensionContextMenu, type IExtensionMenuItem } from './contextMenu.js';
import { SegmentedControl } from './segmentedControl.js';

export type ButtonKind = 'primary' | 'secondary' | 'ghost' | 'danger';
export type ButtonSize = 'md' | 'sm';

export interface IKitButtonOptions {
  readonly label: string;
  /** Default 'secondary'. A view has at most one 'primary'. */
  readonly kind?: ButtonKind;
  /** 'md' 28px (default), 'sm' 24px for dense rows, panels and sidebars. */
  readonly size?: ButtonSize;
  /** Registry icon id drawn before the label. */
  readonly icon?: string;
  readonly title?: string;
  readonly disabled?: boolean;
  readonly onClick?: (e: MouseEvent) => void;
}

export interface IKitIconButtonOptions {
  /** Registry icon id. */
  readonly icon: string;
  /** Required: an icon button's only words are its tooltip and aria-label. */
  readonly title: string;
  readonly size?: ButtonSize;
  readonly disabled?: boolean;
  readonly onClick?: (e: MouseEvent) => void;
}

export interface IKitAction {
  readonly label: string;
  readonly icon?: string;
  readonly title?: string;
  readonly disabled?: boolean;
  readonly onClick: () => void;
}

export interface IKitPageHeaderOptions {
  readonly title: string;
  /** A link above the title back to the page this one belongs to ("Worksheets ›"). */
  readonly back?: IKitAction;
  /** One quiet line under the title. */
  readonly subtitle?: string;
  /** The one main action of the page. */
  readonly primary?: IKitAction;
  /** Up to two; anything beyond moves into the ⋯ menu. */
  readonly secondary?: readonly IKitAction[];
  /** Everything else, behind ⋯. */
  readonly more?: readonly IExtensionMenuItem[];
}

export interface IKitFilterChipOptions {
  readonly label: string;
  /** A count drawn after the label in a fainter tone. */
  readonly count?: number;
  readonly pressed?: boolean;
  readonly title?: string;
  /** Called with the new pressed state after a click. */
  readonly onToggle?: (pressed: boolean) => void;
}

export interface IKitFilterChip {
  readonly element: HTMLButtonElement;
  pressed: boolean;
  setCount(count: number | undefined): void;
}

export interface IKitSegmentedItem {
  readonly value: string;
  readonly label: string;
}

export interface IKitSegmentedOptions {
  readonly items: readonly IKitSegmentedItem[];
  readonly value?: string;
  /** Required: the group's name for screen readers. */
  readonly ariaLabel: string;
  readonly onChange?: (value: string) => void;
}

export interface IKitSegmented {
  readonly element: HTMLElement;
  value: string;
  dispose(): void;
}

export interface IKitEmptyStateOptions {
  readonly headline: string;
  readonly hint?: string;
  /** Registry icon id shown above the headline. */
  readonly icon?: string;
  /** The one action that gets the user out of the empty state. */
  readonly action?: IKitAction;
}

const MAX_SECONDARY = 2;

function mount<T extends HTMLElement>(container: HTMLElement | null | undefined, el: T): T {
  if (container) container.appendChild(el);
  return el;
}

export function createButton(container: HTMLElement | null | undefined, options: IKitButtonOptions): HTMLButtonElement {
  const btn = document.createElement('button');
  btn.type = 'button';
  const kind = options.kind ?? 'secondary';
  btn.className = `px-btn px-btn--${kind}${options.size === 'sm' ? ' px-btn--sm' : ''}`;
  if (options.icon) btn.appendChild(createIconElement(options.icon, options.size === 'sm' ? 14 : 16));
  const label = document.createElement('span');
  label.className = 'px-btn__label';
  label.textContent = options.label;
  btn.appendChild(label);
  if (options.title) btn.title = options.title;
  if (options.disabled) btn.disabled = true;
  if (options.onClick) btn.addEventListener('click', options.onClick);
  return mount(container, btn);
}

export function createIconButton(container: HTMLElement | null | undefined, options: IKitIconButtonOptions): HTMLButtonElement {
  const btn = document.createElement('button');
  btn.type = 'button';
  btn.className = `px-btn px-btn--ghost px-btn--icon${options.size === 'sm' ? ' px-btn--sm' : ''}`;
  btn.appendChild(createIconElement(options.icon, options.size === 'sm' ? 14 : 16));
  btn.title = options.title;
  btn.setAttribute('aria-label', options.title);
  if (options.disabled) btn.disabled = true;
  if (options.onClick) btn.addEventListener('click', options.onClick);
  return mount(container, btn);
}

/**
 * A filter chip: narrows a list, several can be on at once. Pressed state is
 * aria-pressed (the CSS keys on it), so screen readers hear on and off.
 * One of a few exclusive choices is a segmented switch instead.
 */
export function createFilterChip(container: HTMLElement | null | undefined, options: IKitFilterChipOptions): IKitFilterChip {
  const btn = document.createElement('button');
  btn.type = 'button';
  btn.className = 'px-chip';
  const tick = createIconElement('check', 12);
  tick.classList.add('px-chip__tick');
  btn.appendChild(tick);
  const label = document.createElement('span');
  label.className = 'px-chip__label';
  label.textContent = options.label;
  btn.appendChild(label);
  const count = document.createElement('span');
  count.className = 'px-chip__count';
  btn.appendChild(count);
  if (options.title) btn.title = options.title;
  const chip: IKitFilterChip = {
    element: btn,
    get pressed() { return btn.getAttribute('aria-pressed') === 'true'; },
    // The icon helper sets display inline, so the tick is shown and hidden here.
    set pressed(on: boolean) { btn.setAttribute('aria-pressed', String(on)); tick.style.display = on ? 'inline-flex' : 'none'; },
    setCount(n) { count.textContent = n === undefined ? '' : String(n); count.hidden = n === undefined; },
  };
  chip.pressed = !!options.pressed;
  chip.setCount(options.count);
  btn.addEventListener('click', () => {
    chip.pressed = !chip.pressed;
    options.onToggle?.(chip.pressed);
  });
  mount(container, btn);
  return chip;
}

/** A segmented switch: one choice of a few (a setting, a rating, Any / Starred). */
export function createSegmented(container: HTMLElement | null | undefined, options: IKitSegmentedOptions): IKitSegmented {
  const host = document.createElement('div');
  const control = new SegmentedControl(host, {
    segments: options.items,
    selected: options.value ?? options.items[0]?.value,
    ariaLabel: options.ariaLabel,
  });
  const element = control.element;
  element.remove();
  if (options.onChange) control.onDidChange(options.onChange);
  mount(container, element);
  return {
    element,
    get value() { return control.value; },
    set value(v: string) { control.value = v; },
    dispose() { control.dispose(); element.remove(); },
  };
}

export function createSectionLabel(container: HTMLElement | null | undefined, text: string): HTMLElement {
  const el = document.createElement('div');
  el.className = 'px-section-label';
  el.textContent = text;
  return mount(container, el);
}

export function createEmptyState(container: HTMLElement | null | undefined, options: IKitEmptyStateOptions): HTMLElement {
  const root = document.createElement('div');
  root.className = 'px-empty';
  if (options.icon) {
    const icon = createIconElement(options.icon, 32);
    icon.classList.add('px-empty__icon');
    root.appendChild(icon);
  }
  const headline = document.createElement('div');
  headline.className = 'px-empty__headline';
  headline.textContent = options.headline;
  root.appendChild(headline);
  if (options.hint) {
    const hint = document.createElement('div');
    hint.className = 'px-empty__hint';
    hint.textContent = options.hint;
    root.appendChild(hint);
  }
  if (options.action) {
    const a = options.action;
    const btn = createButton(root, { label: a.label, icon: a.icon, title: a.title, disabled: a.disabled, kind: 'primary', onClick: () => a.onClick() });
    btn.classList.add('px-empty__action');
  }
  return mount(container, root);
}

/**
 * The page header every tab uses: title (and an optional subtitle) on the
 * left; on the right one primary, at most two secondary, and ⋯ for the rest.
 * Extra secondary actions are not an error — they move into ⋯, so a header
 * can never become a wall of buttons.
 */
export function createPageHeader(container: HTMLElement | null | undefined, options: IKitPageHeaderOptions): HTMLElement {
  const header = document.createElement('header');
  header.className = 'px-page-header';

  const titles = document.createElement('div');
  titles.className = 'px-page-header__titles';
  if (options.back) {
    const back = options.back;
    const a = document.createElement('button');
    a.type = 'button';
    a.className = 'px-page-header__back';
    a.textContent = back.label;
    a.appendChild(createIconElement('chevron-right', 12));
    if (back.title) a.title = back.title;
    a.addEventListener('click', () => back.onClick());
    titles.appendChild(a);
  }
  const h = document.createElement('h1');
  h.className = 'px-page-header__title';
  h.textContent = options.title;
  titles.appendChild(h);
  if (options.subtitle) {
    const sub = document.createElement('div');
    sub.className = 'px-page-header__subtitle';
    sub.textContent = options.subtitle;
    titles.appendChild(sub);
  }
  header.appendChild(titles);

  const actions = document.createElement('div');
  actions.className = 'px-page-header__actions';
  const secondary = options.secondary ?? [];
  const visible = secondary.slice(0, MAX_SECONDARY);
  const overflow: IExtensionMenuItem[] = secondary.slice(MAX_SECONDARY).map((a) => ({
    label: a.label, icon: a.icon, disabled: a.disabled, tooltip: a.title, onSelect: a.onClick,
  }));
  const more = [...overflow, ...(overflow.length && options.more?.length ? [{ separator: true }] : []), ...(options.more ?? [])];

  for (const a of visible) {
    createButton(actions, { label: a.label, icon: a.icon, title: a.title, disabled: a.disabled, kind: 'secondary', onClick: () => a.onClick() });
  }
  if (options.primary) {
    const a = options.primary;
    createButton(actions, { label: a.label, icon: a.icon, title: a.title, disabled: a.disabled, kind: 'primary', onClick: () => a.onClick() });
  }
  if (more.length) {
    const btn = createIconButton(actions, { icon: 'ellipsis', title: 'More Actions' });
    btn.addEventListener('click', () => {
      showExtensionContextMenu(btn, more, { anchorPosition: 'below' }, (icon, c) => c.appendChild(createIconElement(icon, 14)));
    });
  }
  if (actions.childElementCount) header.appendChild(actions);
  return mount(container, header);
}
