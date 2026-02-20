// iconMenu.ts — Icon picker menu registered in CanvasMenuRegistry
//
// Wraps the generic `IconPicker` UI component into an ICanvasMenu surface
// so it participates in mutual exclusion, outside-click dismissal, and
// interaction arbitration managed by the centralized menu registry.
//
// Consumers never import `IconPicker` directly — they call
// `menuRegistry.showIconMenu(options)` or receive a `showIconPicker`
// callback threaded through their entry point.

import type { IDisposable } from '../../../platform/lifecycle.js';
import { IconPicker } from '../../../ui/iconPicker.js';
import { PAGE_SELECTABLE_ICONS, svgIcon } from './canvasMenuRegistry.js';
import type { ICanvasMenu, CanvasMenuRegistry } from './canvasMenuRegistry.js';

// ── Options ─────────────────────────────────────────────────────────────────

export interface IconMenuOptions {
  /** Anchor element used for positioning the picker popup. */
  readonly anchor: HTMLElement;
  /** Whether to show the search input. Default: `true`. */
  readonly showSearch?: boolean;
  /** Whether to show the "Remove icon" button. Default: `false`. */
  readonly showRemove?: boolean;
  /** Icon button size in pixels. Default: `22`. */
  readonly iconSize?: number;
  /** Called when the user selects an icon. */
  readonly onSelect: (iconId: string) => void;
  /** Called when the user clicks "Remove icon". */
  readonly onRemove?: () => void;
}

// ── Host ────────────────────────────────────────────────────────────────────

export interface IconMenuHost {
  /** Container element in which the picker popup is mounted. */
  readonly container: HTMLElement;
}

// ── Controller ──────────────────────────────────────────────────────────────

export class IconMenuController implements ICanvasMenu {
  readonly id = 'icon-menu';

  private _picker: IconPicker | null = null;
  private _visible = false;
  private _registration: IDisposable | null = null;

  constructor(
    private readonly _host: IconMenuHost,
    private readonly _registry: CanvasMenuRegistry,
  ) {}

  // ── ICanvasMenu ─────────────────────────────────────────────────────────

  get visible(): boolean { return this._visible; }

  containsTarget(target: Node): boolean {
    return this._picker?.element.contains(target) ?? false;
  }

  hide(): void {
    if (this._picker) {
      this._picker.dismiss();
      this._picker = null;
    }
    this._visible = false;
  }

  dispose(): void {
    this.hide();
    this._registration?.dispose();
    this._registration = null;
  }

  // ── Lifecycle ───────────────────────────────────────────────────────────

  /** Register with the menu registry. Call once during setup. */
  create(): void {
    this._registration = this._registry.register(this);
  }

  // ── Public API ──────────────────────────────────────────────────────────

  /**
   * Show the icon picker popup.
   *
   * Hides any previously-open picker instance and notifies the registry
   * so all other menus (slash, bubble, block-action, cover) are dismissed.
   */
  show(options: IconMenuOptions): void {
    this.hide();
    this._registry.notifyShow(this.id);

    this._picker = new IconPicker(this._host.container, {
      anchor: options.anchor,
      icons: PAGE_SELECTABLE_ICONS as string[],
      renderIcon: (id, _size) => svgIcon(id),
      showSearch: options.showSearch ?? true,
      showRemove: options.showRemove ?? false,
      iconSize: options.iconSize ?? 22,
    });

    this._visible = true;

    this._picker.onDidSelectIcon((iconId) => {
      options.onSelect(iconId);
    });

    if (options.onRemove) {
      this._picker.onDidRemoveIcon(() => {
        options.onRemove!();
      });
    }

    this._picker.onDidDismiss(() => {
      this._visible = false;
      this._picker = null;
    });
  }
}
