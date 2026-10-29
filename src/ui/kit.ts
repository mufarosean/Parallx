// kit.ts — the workbench's chrome components, one definition each.
//
// Every surface (built-in or extension, through `api.ui`) builds its buttons,
// page headers, empty states and section labels here, so there is one height
// ladder, one radius, one type scale and one hierarchy of actions. Styling is
// in px-controls.css (`.px-btn`, `.px-page-header`, `.px-section-label`) and
// ui.css (`.px-empty`); this file only assembles DOM and enforces the rules
// that CSS cannot: at most one primary action per header, the rest overflow.
//
// Every control made here is also a declaration: an id, a label, and the
// command it runs or the handler it calls. The kit writes `data-px-id`, the
// role and the label into the DOM and registers the control in the scene
// (scene.ts) while it is mounted, so a screen reader, a probe, the
// introspection service and the model read the same thing. A control's DOM
// is otherwise exactly what it was before it declared itself.
// docs/SELF_DESCRIBING_UI_DESIGN.md section 5 is the contract.
//
// Before this existed the extension API offered a dropdown and a menu, so
// every extension cloned its own buttons and headers (media-organizer carried
// 22 button classes); DESIGN_UNIFICATION.md lever 3.

import { createIconElement } from './iconRegistry.js';
import { showExtensionContextMenu, type IExtensionMenuItem, type IExtensionMenuOptions, type IExtensionMenuHandle, type ExtensionMenuAnchor } from './contextMenu.js';
import { SegmentedControl } from './segmentedControl.js';
import { Toggle } from './toggle.js';
import { InputBox } from './inputBox.js';
import { createSelect as createSelectControl, type SelectOption } from './dropdown.js';
import { Slider } from './slider.js';
import { DateField, TimeField } from './dateTimeField.js';
import { TabBar, type ITabBarItem, type ITabBarOptions } from './tabBar.js';
import { scene, type SceneKind, type SceneState, type ISceneEntry } from './scene.js';
import type { IDisposable } from '../platform/lifecycle.js';

export type ButtonKind = 'primary' | 'secondary' | 'ghost' | 'danger';
export type ButtonSize = 'md' | 'sm';

// ── Declarations ─────────────────────────────────────────────────────────────

/** What every control declares. `id` is optional until every caller has one. */
export interface IKitControlDeclaration {
  /** Stable within its surface: 'planner.addTask'. docs/SELF_DESCRIBING_UI_DESIGN.md section 4.3. Null: a row's control, which the scene never holds. */
  readonly id?: string | null;
  readonly hint?: string;
  /** Recorded for the docs. Not evaluated. */
  readonly when?: string;
}

/** A control runs a command or calls a handler, never both. */
export interface IKitCommandAction {
  readonly command: string;
  readonly args?: readonly unknown[];
}

export interface IKitSurfaceDeclaration {
  readonly id: string;
  /** The tool that owns it: 'core', or the last segment of the manifest id. */
  readonly owner: string;
  readonly label: string;
  /** Tells two open copies apart (an editor input's id). */
  readonly instance?: string;
  readonly state?: () => SceneState;
}

export interface IKitSurface {
  readonly element: HTMLElement;
  setInstance(instance: string | undefined): void;
  dispose(): void;
}

// ── Commands ─────────────────────────────────────────────────────────────────

type CommandRunner = (id: string, ...args: unknown[]) => Promise<unknown>;
let _runCommand: CommandRunner | undefined;

/** Called once at boot with the command service, so a control can run a command by id. */
export function installKitCommands(service: { executeCommand(id: string, ...args: unknown[]): Promise<unknown> }): void {
  _runCommand = (id, ...args) => service.executeCommand(id, ...args);
}

/** Run a command by id from a surface that is not a kit control (a menu item, say). */
export function runKitCommand(command: string, ...args: unknown[]): void { runCommand({ command, args }); }

function runCommand(action: IKitCommandAction): void {
  if (!_runCommand) { console.warn(`[kit] no command service yet; "${action.command}" not run`); return; }
  void _runCommand(action.command, ...(action.args ?? [])).catch((err) => console.warn(`[kit] command "${action.command}" failed:`, err));
}

/**
 * The click handler a control gets from its options. A command alone runs
 * through the command service; a handler alone runs itself; both together
 * run the handler and record the command in the scene (a header action
 * that calls a command through its own code says which).
 */
function actionOf(options: { readonly command?: IKitCommandAction['command']; readonly args?: readonly unknown[]; readonly onClick?: (e: MouseEvent) => void }): ((e: MouseEvent) => void) | undefined {
  if (options.onClick) return options.onClick;
  if (options.command) return () => runCommand({ command: options.command!, args: options.args });
  return undefined;
}

// ── Registration ─────────────────────────────────────────────────────────────

/**
 * Registers a control in the scene when it has an id. Without one nothing is
 * registered (the scene sweep lists such controls); from step 4 of the
 * design the id is required and this branch goes.
 */
function declare(element: HTMLElement, kind: SceneKind, options: IKitControlDeclaration, label: string, extra: { command?: string; state?: () => SceneState } = {}): IDisposable {
  if (!options.id) return { dispose: () => { /* nothing registered */ } };
  const entry: ISceneEntry = {
    id: options.id,
    kind,
    owner: '',
    label,
    ...(options.hint ? { hint: options.hint } : {}),
    ...(options.when ? { when: options.when } : {}),
    ...(extra.command ? { command: extra.command } : {}),
    element,
    ...(extra.state ? { state: extra.state } : {}),
  };
  return scene.register(entry);
}

/** The role a kind implies; a native <button> needs none. */
function setRole(element: HTMLElement, role: string | undefined): void {
  if (role && !element.hasAttribute('role')) element.setAttribute('role', role);
}

// ── Buttons ──────────────────────────────────────────────────────────────────

export interface IKitButtonOptions extends IKitControlDeclaration {
  readonly id: string | null;
  readonly label: string;
  /** Default 'secondary'. A view has at most one 'primary'. */
  readonly kind?: ButtonKind;
  /** 'md' 28px (default), 'sm' 24px for dense rows, panels and sidebars. */
  readonly size?: ButtonSize;
  /** Registry icon id drawn before the label. */
  readonly icon?: string;
  readonly title?: string;
  readonly disabled?: boolean;
  /** The command this button runs; with `onClick` too, the handler runs and the command is recorded. */
  readonly command?: string;
  readonly args?: readonly unknown[];
  readonly onClick?: (e: MouseEvent) => void;
}

export interface IKitIconButtonOptions extends IKitControlDeclaration {
  readonly id: string | null;
  /** Registry icon id. */
  readonly icon: string;
  /** Required: an icon button's only words are its tooltip and aria-label. */
  readonly title: string;
  readonly size?: ButtonSize;
  readonly disabled?: boolean;
  readonly command?: string;
  readonly args?: readonly unknown[];
  readonly onClick?: (e: MouseEvent) => void;
}

export interface IKitAction {
  /** The action's id in the scene (docs/SELF_DESCRIBING_UI_DESIGN.md section 4.3). */
  readonly id?: string;
  readonly label: string;
  readonly icon?: string;
  readonly title?: string;
  readonly disabled?: boolean;
  /** The command the action runs, recorded in the scene; `onClick` still runs it. */
  readonly command?: string;
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

export interface IKitFilterChipOptions extends IKitControlDeclaration {
  readonly id: string | null;
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

export interface IKitSegmentedOptions extends IKitControlDeclaration {
  readonly id: string | null;
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

const enabledState = (el: HTMLButtonElement) => (): SceneState => ({ kind: 'enabled', value: !el.disabled });

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
  const onClick = actionOf(options);
  if (onClick) btn.addEventListener('click', onClick);
  mount(container, btn);
  declare(btn, 'button', options, options.label, { command: options.command, state: enabledState(btn) });
  return btn;
}

export function createIconButton(container: HTMLElement | null | undefined, options: IKitIconButtonOptions): HTMLButtonElement {
  const btn = document.createElement('button');
  btn.type = 'button';
  btn.className = `px-btn px-btn--ghost px-btn--icon${options.size === 'sm' ? ' px-btn--sm' : ''}`;
  btn.appendChild(createIconElement(options.icon, options.size === 'sm' ? 14 : 16));
  btn.title = options.title;
  btn.setAttribute('aria-label', options.title);
  if (options.disabled) btn.disabled = true;
  const onClick = actionOf(options);
  if (onClick) btn.addEventListener('click', onClick);
  mount(container, btn);
  declare(btn, 'iconButton', options, options.title, { command: options.command, state: enabledState(btn) });
  return btn;
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
  declare(btn, 'chip', options, options.label, { state: () => ({ kind: 'pressed', value: chip.pressed }) });
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
  const reg = declare(element, 'segmented', options, options.ariaLabel, { state: () => ({ kind: 'value', value: control.value }) });
  return {
    element,
    get value() { return control.value; },
    set value(v: string) { control.value = v; },
    dispose() { reg.dispose(); control.dispose(); element.remove(); },
  };
}

export function createSectionLabel(container: HTMLElement | null | undefined, text: string): HTMLElement {
  const el = document.createElement('div');
  el.className = 'px-section-label';
  el.textContent = text;
  return mount(container, el);
}

/** A section: its label, then what is put in it (the returned element). */
export function createSection(container: HTMLElement | null | undefined, label: string, className?: string): HTMLElement {
  const sec = document.createElement('section');
  sec.className = className ? `px-section ${className}` : 'px-section';
  createSectionLabel(sec, label);
  return mount(container, sec);
}

/** A row of a list: a name over a quieter detail line; buttons added to it sit at its end. */
export function createRow(container: HTMLElement | null | undefined, options: { readonly name: string; readonly detail?: string; readonly detailTitle?: string }): HTMLElement {
  const row = document.createElement('div');
  row.className = 'px-row';
  const text = document.createElement('span');
  text.className = 'px-row__text';
  const name = document.createElement('span');
  name.className = 'px-row__name';
  name.textContent = options.name;
  text.appendChild(name);
  if (options.detail) {
    const detail = document.createElement('span');
    detail.className = 'px-row__detail';
    detail.textContent = options.detail;
    if (options.detailTitle) detail.title = options.detailTitle;
    text.appendChild(detail);
  }
  row.appendChild(text);
  return mount(container, row);
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
    const btn = createButton(root, { id: a.id ?? null, command: a.command, label: a.label, icon: a.icon, title: a.title, disabled: a.disabled, kind: 'primary', onClick: () => a.onClick() });
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
    if (back.id) declareControl(a, { id: back.id, label: back.label, hint: back.title, command: back.command });
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
    createButton(actions, { id: a.id ?? null, command: a.command, label: a.label, icon: a.icon, title: a.title, disabled: a.disabled, kind: 'secondary', onClick: () => a.onClick() });
  }
  if (options.primary) {
    const a = options.primary;
    createButton(actions, { id: a.id ?? null, command: a.command, label: a.label, icon: a.icon, title: a.title, disabled: a.disabled, kind: 'primary', onClick: () => a.onClick() });
  }
  if (more.length) {
    const btn = createIconButton(actions, { id: 'pageHeader.more', icon: 'ellipsis', title: 'More Actions' });
    btn.addEventListener('click', () => {
      showExtensionContextMenu(btn, more, { anchorPosition: 'below' }, (icon, c) => c.appendChild(createIconElement(icon, 14)));
    });
  }
  if (actions.childElementCount) header.appendChild(actions);
  return mount(container, header);
}

// ── Declaring in place ───────────────────────────────────────────────────────

export interface IKitInPlaceDeclaration extends IKitControlDeclaration {
  readonly id: string;
  readonly label: string;
  /** Default 'button'. */
  readonly kind?: Exclude<SceneKind, 'surface'>;
  /** The command the element's own listener runs, recorded for the scene. */
  readonly command?: string;
  readonly state?: () => SceneState;
}

/**
 * Declares a control the kit did not build: a window button, a menu bar
 * item, a tab. The element keeps its DOM and its listeners; this only
 * writes data-px-id, the role and the label and registers it in the
 * scene. For a control whose look the kit has, use the kit function
 * instead so its raw DOM goes.
 */
export function declareControl(element: HTMLElement, declaration: IKitInPlaceDeclaration): IDisposable {
  const kind = declaration.kind ?? 'button';
  // A select, field or slider declared on its wrapper (a dropdown's host, an input box's
  // frame): the control inside is what a screen reader meets, so it carries the
  // name, and the wrapper takes no role of its own.
  const inner = (kind === 'select' || kind === 'input' || kind === 'slider') && !element.matches(NATIVE_FOCUS) ? element.querySelector<HTMLElement>('button, input, select, textarea') : null;
  if (inner) { if (!inner.getAttribute('aria-label')) inner.setAttribute('aria-label', declaration.label); }
  else if (element.tagName !== 'BUTTON') setRole(element, ROLE_OF[kind]);
  makeKeyboardReachable(element, kind);
  if (!element.hasAttribute('aria-label') && !element.textContent?.trim()) element.setAttribute('aria-label', declaration.label);
  return declare(element, kind, declaration, declaration.label, { command: declaration.command, state: declaration.state });
}

const NATIVE_FOCUS = 'button, input, select, textarea, a[href], [contenteditable="true"], [tabindex]';

/**
 * A pressable control the keyboard cannot reach is not a control to a
 * keyboard user. An element that is not natively focusable, has no
 * tabindex of its own and holds nothing focusable (a div or span with a
 * click listener) joins the Tab order and answers Enter and Space with a
 * click: the WAI-ARIA button pattern. An element that already set a
 * tabindex handles its own keys and is left alone. docs/ACCESSIBILITY.md.
 */
function makeKeyboardReachable(element: HTMLElement, kind: SceneKind): void {
  if (kind !== 'button' && kind !== 'iconButton' && kind !== 'chip' && kind !== 'toggle') return;
  if (element.matches(NATIVE_FOCUS) || element.querySelector(NATIVE_FOCUS)) return;
  element.tabIndex = 0;
  element.addEventListener('keydown', (e) => {
    if ((e.key === 'Enter' || e.key === ' ') && e.target === element) { e.preventDefault(); element.click(); }
  });
}

const ROLE_OF: Record<Exclude<SceneKind, 'surface'>, string | undefined> = {
  button: 'button', iconButton: 'button', chip: 'button', segmented: 'radiogroup', toggle: 'switch',
  input: undefined, select: 'combobox', slider: 'slider', list: 'listbox', tree: 'tree', tabs: 'tablist', menu: 'menu',
};

// ── Surfaces ─────────────────────────────────────────────────────────────────

/**
 * Declares `element` as a surface: a region that holds controls. Adds no
 * DOM. The three base classes (parts, editor panes, views) call it for
 * every subclass, so a feature never does.
 */
export function createSurface(element: HTMLElement, declaration: IKitSurfaceDeclaration): IKitSurface {
  let instance = declaration.instance;
  let reg: IDisposable | undefined;
  const register = (): void => {
    reg?.dispose();
    reg = scene.register({
      id: declaration.id,
      kind: 'surface',
      owner: declaration.owner,
      ...(instance !== undefined ? { instance } : {}),
      label: declaration.label,
      element,
      ...(declaration.state ? { state: declaration.state } : {}),
    });
  };
  register();
  return {
    element,
    setInstance(next) {
      if (next === instance) return;
      instance = next;
      if (next === undefined) element.removeAttribute('data-px-instance');
      register();
    },
    dispose() { reg?.dispose(); reg = undefined; },
  };
}

// ── Wrapped components ───────────────────────────────────────────────────────

export interface IKitToggleOptions extends IKitControlDeclaration {
  readonly label: string;
  readonly checked?: boolean;
  readonly disabled?: boolean;
  readonly onChange?: (checked: boolean) => void;
}

export interface IKitToggle {
  readonly element: HTMLElement;
  checked: boolean;
  dispose(): void;
}

/** An on/off switch, the `Toggle` component declared. */
export function createToggle(container: HTMLElement | null | undefined, options: IKitToggleOptions): IKitToggle {
  const host = container ?? document.createElement('div');
  const toggle = new Toggle(host, { checked: options.checked, ariaLabel: options.label, disabled: options.disabled });
  if (options.onChange) toggle.onDidChange(options.onChange);
  setRole(toggle.element, 'switch');
  const reg = declare(toggle.element, 'toggle', options, options.label, { state: () => ({ kind: 'pressed', value: toggle.checked }) });
  return {
    element: toggle.element,
    get checked() { return toggle.checked; },
    set checked(v: boolean) { toggle.checked = v; },
    dispose() { reg.dispose(); toggle.dispose(); toggle.element.remove(); },
  };
}

export interface IKitInputOptions extends IKitControlDeclaration {
  readonly label: string;
  readonly placeholder?: string;
  readonly value?: string;
  readonly type?: 'text' | 'password';
  readonly validationFn?: (value: string) => string | null | undefined | Promise<string | null | undefined>;
}

export interface IKitInput {
  readonly element: HTMLElement;
  value: string;
  dispose(): void;
}

/** A single-line text field, the `InputBox` component declared. */
export function createInput(container: HTMLElement | null | undefined, options: IKitInputOptions): IKitInput {
  const host = container ?? document.createElement('div');
  const box = new InputBox(host, { placeholder: options.placeholder, value: options.value, type: options.type, ariaLabel: options.label, validationFn: options.validationFn });
  const reg = declare(box.element, 'input', options, options.label, { state: () => ({ kind: 'value', value: box.value }) });
  return {
    element: box.element,
    get value() { return box.value; },
    set value(v: string) { box.value = v; },
    dispose() { reg.dispose(); box.dispose(); box.element.remove(); },
  };
}

export interface IKitPickerFieldOptions extends IKitControlDeclaration {
  readonly label: string;
  /** YYYY-MM-DD for a date, HH:MM for a time. */
  readonly value: string;
  readonly onChange?: (value: string) => void;
}

export interface IKitPickerField {
  readonly element: HTMLButtonElement;
  value: string;
  disabled: boolean;
  dispose(): void;
}

function pickerField(field: DateField | TimeField, container: HTMLElement | null | undefined, options: IKitPickerFieldOptions): IKitPickerField {
  if (options.onChange) field.onDidChange(options.onChange);
  mount(container, field.element);
  const reg = declare(field.element, 'input', options, options.label, { state: () => ({ kind: 'value', value: field.value }) });
  return {
    element: field.element,
    get value() { return field.value; },
    set value(v: string) { field.value = v; },
    get disabled() { return field.disabled; },
    set disabled(v: boolean) { field.disabled = v; },
    dispose() { reg.dispose(); field.dispose(); },
  };
}

/** A date: shows it in words, opens the app's month grid (dateTimeField.ts). */
export function createDateField(container: HTMLElement | null | undefined, options: IKitPickerFieldOptions): IKitPickerField {
  return pickerField(new DateField(null, { value: options.value, ariaLabel: options.label }), container, options);
}

/** A time of day: shows it in words, opens a typed field over a 15-minute list. */
export function createTimeField(container: HTMLElement | null | undefined, options: IKitPickerFieldOptions): IKitPickerField {
  return pickerField(new TimeField(null, { value: options.value, ariaLabel: options.label }), container, options);
}

export interface IKitSelectOptions extends IKitControlDeclaration {
  readonly label: string;
  readonly items: readonly SelectOption[];
  readonly value: string;
  readonly onChange: (value: string) => void;
}

export interface IKitSelect {
  readonly element: HTMLElement;
  value: string;
  /** The choices can change while it is open to view (a label that follows another field). */
  setItems(items: readonly SelectOption[]): void;
  dispose(): void;
}

/** One choice of many, the dropdown's `createSelect` declared. */
export function createSelect(container: HTMLElement | null | undefined, options: IKitSelectOptions): IKitSelect {
  const select = createSelectControl([...options.items], options.value, options.onChange);
  select.el.setAttribute('aria-label', options.label);
  setRole(select.el, 'combobox');
  mount(container, select.el);
  const reg = declare(select.el, 'select', options, options.label, { state: () => ({ kind: 'value', value: select.getValue() }) });
  return {
    element: select.el,
    get value() { return select.getValue(); },
    set value(v: string) { select.setValue(v); },
    setItems(items) { select.setItems([...items]); },
    dispose() { reg.dispose(); select.dispose(); select.el.remove(); },
  };
}

export interface IKitSliderOptions extends IKitControlDeclaration {
  readonly label: string;
  readonly min?: number;
  readonly max?: number;
  readonly step?: number;
  readonly value?: number;
  readonly disabled?: boolean;
  readonly onChange?: (value: number) => void;
}

export interface IKitSlider {
  readonly element: HTMLElement;
  readonly value: number;
  dispose(): void;
}

/** A number on a range, the `Slider` component declared. */
export function createSlider(container: HTMLElement | null | undefined, options: IKitSliderOptions): IKitSlider {
  const host = container ?? document.createElement('div');
  const slider = new Slider(host, { min: options.min, max: options.max, step: options.step, value: options.value, ariaLabel: options.label, disabled: options.disabled });
  if (options.onChange) slider.onDidChange(options.onChange);
  setRole(slider.element, 'slider');
  const reg = declare(slider.element, 'slider', options, options.label, { state: () => ({ kind: 'number', value: slider.value }) });
  return {
    element: slider.element,
    get value() { return slider.value; },
    dispose() { reg.dispose(); slider.dispose(); slider.element.remove(); },
  };
}

export interface IKitTabsOptions extends IKitControlDeclaration, ITabBarOptions {
  readonly label: string;
  readonly items?: readonly ITabBarItem[];
  readonly active?: string;
  readonly onSelect?: (id: string) => void;
}

export interface IKitTabs {
  readonly element: HTMLElement;
  readonly bar: TabBar;
  readonly selected: string | undefined;
  dispose(): void;
}

/** A row of tabs, the `TabBar` component declared. The bar is exposed for what it does beyond selection. */
export function createTabs(container: HTMLElement | null | undefined, options: IKitTabsOptions): IKitTabs {
  const host = container ?? document.createElement('div');
  const { label, items, active, onSelect, id: _id, hint: _hint, when: _when, ...barOptions } = options;
  const bar = new TabBar(host, barOptions);
  if (items) bar.setItems([...items]);
  if (active) bar.setActive(active);
  if (onSelect) bar.onDidSelect(onSelect);
  bar.element.setAttribute('aria-label', label);
  setRole(bar.element, 'tablist');
  const reg = declare(bar.element, 'tabs', options, label, { state: () => { const a = bar.getActive(); return { kind: 'selection', value: a ? [a] : [], count: bar.element.querySelectorAll('.ui-tab').length }; } });
  return {
    element: bar.element,
    bar,
    get selected() { return bar.getActive(); },
    dispose() { reg.dispose(); bar.dispose(); bar.element.remove(); },
  };
}

/** A context menu opened now, declared while it is open. */
export function createMenu(anchor: ExtensionMenuAnchor, options: IKitControlDeclaration & { readonly label: string; readonly items: ReadonlyArray<IExtensionMenuItem>; readonly menu?: IExtensionMenuOptions }): IExtensionMenuHandle {
  const handle = showExtensionContextMenu(anchor, options.items, options.menu, (icon, c) => c.appendChild(createIconElement(icon, 14)));
  const menus = document.querySelectorAll<HTMLElement>('.context-menu');
  const menuEl = menus.length ? menus[menus.length - 1] : undefined;
  const reg = menuEl ? declare(menuEl, 'menu', options, options.label) : undefined;
  return {
    update: (items) => handle.update(items),
    dispose: () => { reg?.dispose(); handle.dispose(); },
  };
}

export interface IKitListOptions extends IKitControlDeclaration {
  readonly label: string;
  /** The row elements, read when the state is asked for. */
  readonly rows: () => readonly HTMLElement[];
  /** The selected rows' ids, read when the state is asked for. */
  readonly selected: () => readonly string[];
}

export interface IKitList {
  readonly element: HTMLElement;
  readonly selected: readonly string[];
  dispose(): void;
}

/**
 * A list the caller renders itself, declared as one entry with a selection.
 * Rows are never entries; a tree of 400 notes is one entry.
 */
export function createList(element: HTMLElement, options: IKitListOptions): IKitList {
  return declareCollection(element, 'list', 'listbox', options);
}

/** A tree the caller renders itself; the same declaration as a list with kind `tree`. */
export function createTree(element: HTMLElement, options: IKitListOptions): IKitList {
  return declareCollection(element, 'tree', 'tree', options);
}

function declareCollection(element: HTMLElement, kind: 'list' | 'tree', role: string, options: IKitListOptions): IKitList {
  setRole(element, role);
  if (!element.hasAttribute('aria-label')) element.setAttribute('aria-label', options.label);
  const reg = declare(element, kind, options, options.label, { state: () => ({ kind: 'selection', value: [...options.selected()], count: options.rows().length }) });
  return {
    element,
    get selected() { return options.selected(); },
    dispose() { reg.dispose(); },
  };
}

/** A dynamic value as a scene id segment: lower case, words joined by dashes ('Match Case' is 'match-case'; empty is 'none'). Section 4.3. */
export function sceneSlug(value: string): string {
  return value.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '') || 'none';
}
