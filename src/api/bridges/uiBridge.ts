// uiBridge.ts — the `parallx.ui` namespace: the app's own widgets and formatters, for extensions.
//
// An extension never styles its own button, dropdown or menu and never
// writes its own escaper or "5m ago": it calls what the workbench draws
// with, so every surface looks and reads the same. The object is one
// frozen bag built once per tool.

import {
  createButton as kitCreateButton,
  createEmptyState as kitCreateEmptyState,
  createFilterChip as kitCreateFilterChip,
  createIconButton as kitCreateIconButton,
  createPageHeader as kitCreatePageHeader,
  createSectionLabel as kitCreateSectionLabel,
  createSegmented as kitCreateSegmented,
  createSurface as kitCreateSurface,
  declareControl as kitDeclareControl,
  createToggle as kitCreateToggle,
  createInput as kitCreateInput,
  createSelect as kitCreateSelect,
  createSlider as kitCreateSlider,
  createTabs as kitCreateTabs,
  createMenu as kitCreateMenu,
  createList as kitCreateList,
  createTree as kitCreateTree,
  type IKitButtonOptions,
  type IKitInPlaceDeclaration,
  type IKitInputOptions,
  type IKitListOptions,
  type IKitSelectOptions,
  type IKitSliderOptions,
  type IKitSurfaceDeclaration,
  type IKitTabsOptions,
  type IKitToggleOptions,
  type IKitEmptyStateOptions,
  type IKitFilterChipOptions,
  type IKitIconButtonOptions,
  type IKitPageHeaderOptions,
  type IKitSegmentedOptions,
} from '../../ui/kit.js';
import { rafThrottle } from '../../platform/rafThrottle.js';
import { debounce } from '../../platform/timing.js';
import { escapeHtml, formatBytes, titleCase } from '../../ui/format.js';
import { formatRelativeTime } from '../../ui/relativeTime.js';
import { createDropdownHandle, type IDropdownItem } from '../../ui/dropdown.js';
import { renderMarkdown } from '../../ui/renderMarkdown.js';
import { createAiButton } from '../../ui/aiButton.js';
import { showExtensionContextMenu, type ExtensionMenuAnchor, type IExtensionMenuHandle, type IExtensionMenuItem, type IExtensionMenuOptions } from '../../ui/contextMenu.js';
import { createIconElement } from '../../ui/iconRegistry.js';

/** What `api.ui` is: the object `createUiApi` builds, typed once here. */
export type UiApi = ReturnType<typeof createUiApi>;

export function createUiApi() {
  return Object.freeze({
    // Hot-path handlers (mousemove, scroll, resize) coalesce to one run per
    // frame through the same throttle the workbench uses.
    rafThrottle,
    // The same text formatters and debounce the workbench uses.
    debounce,
    escapeHtml,
    formatBytes,
    titleCase,
    formatRelativeTime,
    // The themed dropdown (.ui-dropdown): native <select> popups are
    // Chromium-drawn and cannot be themed. Delegates to createDropdownHandle
    // so the extension-facing surface has one definition, with the component.
    createDropdown(container: HTMLElement, options?: {
      readonly items?: readonly { value: string; label: string; color?: string }[];
      readonly selected?: string;
      readonly placeholder?: string;
      readonly ariaLabel?: string;
      readonly disabled?: boolean;
      /** With an id, the dropdown is in the scene as a select whose value is the chosen item. */
      readonly id?: string;
      readonly hint?: string;
    }) {
      const handle = createDropdownHandle(container, {
        items: options?.items as readonly IDropdownItem[] | undefined,
        selected: options?.selected,
        placeholder: options?.placeholder,
        ariaLabel: options?.ariaLabel,
        disabled: options?.disabled,
      });
      if (options?.id) {
        const reg = kitDeclareControl(handle.element, { id: options.id, label: options.ariaLabel ?? options.placeholder ?? 'Choice', kind: 'select', hint: options.hint, state: () => ({ kind: 'value', value: handle.value }) });
        const dispose = handle.dispose.bind(handle);
        handle.dispose = () => { reg.dispose(); dispose(); };
      }
      return handle;
    },
    // The shared compact Markdown + KaTeX renderer (.px-markdown). Safe for
    // model-generated content: raw HTML is never interpreted.
    renderMarkdown(markdown: string): HTMLElement {
      return renderMarkdown(markdown);
    },
    // The AI button (.px-ai-btn): the brand mark in an accent pill. Every
    // "the assistant acts here" affordance uses this, nothing else.
    createAiButton(container: HTMLElement, options: {
      readonly label: string;
      readonly compact?: boolean;
      readonly ariaLabel?: string;
      readonly title?: string;
      /** With an id, the button is in the scene; `command` records what it runs. */
      readonly id?: string;
      readonly command?: string;
      readonly hint?: string;
    }): HTMLButtonElement {
      const btn = createAiButton(container, options);
      if (options.id) kitDeclareControl(btn, { id: options.id, label: options.ariaLabel ?? options.label, command: options.command, hint: options.hint ?? options.title });
      return btn;
    },
    // The same `.context-menu` the workbench uses (keyboard nav, submenu,
    // viewport clamp, click-outside dismiss).
    showContextMenu(anchor: ExtensionMenuAnchor, items: ReadonlyArray<IExtensionMenuItem>, options?: IExtensionMenuOptions): IExtensionMenuHandle {
      return showExtensionContextMenu(anchor, items, options, (icon, c) => c.appendChild(createIconElement(icon, 14)));
    },
    // The chrome kit (src/ui/kit.ts): the same buttons, page header, empty
    // state and section label the workbench draws.
    createButton: (container: HTMLElement | null, options: IKitButtonOptions) => kitCreateButton(container, options),
    createIconButton: (container: HTMLElement | null, options: IKitIconButtonOptions) => kitCreateIconButton(container, options),
    createPageHeader: (container: HTMLElement | null, options: IKitPageHeaderOptions) => kitCreatePageHeader(container, options),
    createEmptyState: (container: HTMLElement | null, options: IKitEmptyStateOptions) => kitCreateEmptyState(container, options),
    createSectionLabel: (container: HTMLElement | null, text: string) => kitCreateSectionLabel(container, text),
    createFilterChip: (container: HTMLElement | null, options: IKitFilterChipOptions) => kitCreateFilterChip(container, options),
    createSegmented: (container: HTMLElement | null, options: IKitSegmentedOptions) => kitCreateSegmented(container, options),
    // The scene (docs/SELF_DESCRIBING_UI_DESIGN.md): a region of the
    // extension's own (a card, a popover) and the controls the kit does not
    // draw. The owner is inherited from the view or pane the bridge
    // registered, so an extension never names itself.
    createSurface: (element: HTMLElement, declaration: IKitSurfaceDeclaration) => kitCreateSurface(element, declaration),
    declareControl: (element: HTMLElement, declaration: IKitInPlaceDeclaration) => kitDeclareControl(element, declaration),
    createToggle: (container: HTMLElement | null, options: IKitToggleOptions) => kitCreateToggle(container, options),
    createInput: (container: HTMLElement | null, options: IKitInputOptions) => kitCreateInput(container, options),
    createSelect: (container: HTMLElement | null, options: IKitSelectOptions) => kitCreateSelect(container, options),
    createSlider: (container: HTMLElement | null, options: IKitSliderOptions) => kitCreateSlider(container, options),
    createTabs: (container: HTMLElement | null, options: IKitTabsOptions) => kitCreateTabs(container, options),
    createMenu: (anchor: ExtensionMenuAnchor, options: Parameters<typeof kitCreateMenu>[1]) => kitCreateMenu(anchor, options),
    createList: (element: HTMLElement, options: IKitListOptions) => kitCreateList(element, options),
    createTree: (element: HTMLElement, options: IKitListOptions) => kitCreateTree(element, options),
  });
}
