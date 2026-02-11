// titlebarPart.ts — title bar (top window controls and menus)
//
// M3 Capability 1: Title bar is fully data-driven.
//   - Workspace name sourced from IWorkspaceService (Task 1.1)
//   - Menu bar items registered via MenuBarService (Task 1.2)
//   - Window controls wired to Electron IPC with state tracking (Task 1.3)
//
// VS Code reference: src/vs/workbench/browser/parts/titlebar/titlebarPart.ts

import { Part } from './part.js';
import { PartId, PartPosition, PartDescriptor } from './partTypes.js';
import { SizeConstraints } from '../layout/layoutTypes.js';
import { Emitter, Event } from '../platform/events.js';
import { IDisposable, toDisposable } from '../platform/lifecycle.js';

// ─── Constants ──────────────────────────────────────────────────────────────

/** Height constraints for the titlebar. */
const TITLEBAR_CONSTRAINTS: SizeConstraints = {
  minimumWidth: 0,
  maximumWidth: Number.POSITIVE_INFINITY,
  minimumHeight: 30,
  maximumHeight: 30,
};

// ─── Menu Bar Types ─────────────────────────────────────────────────────────

/** A single top-level menu bar item. */
export interface MenuBarItem {
  readonly id: string;
  readonly label: string;
  readonly order: number;
}

/** A command entry inside a dropdown menu. */
export interface MenuBarDropdownItem {
  readonly commandId: string;
  readonly title: string;
  readonly keybinding?: string;
  readonly group?: string;
  readonly order?: number;
}

/** Service providing keybinding display strings. */
export interface IKeybindingLookup {
  lookupKeybinding(commandId: string): string | undefined;
}

/** Service for executing commands. */
export interface ICommandExecutor {
  executeCommand(commandId: string, ...args: unknown[]): Promise<unknown>;
  hasCommand(commandId: string): boolean;
}

// ─── ElectronApi shape ──────────────────────────────────────────────────────

interface ElectronWindowApi {
  minimize(): void;
  maximize(): void;
  close(): void;
  isMaximized(): Promise<boolean>;
  onMaximizedChange(callback: (maximized: boolean) => void): void;
}

// ─── TitlebarPart ───────────────────────────────────────────────────────────

/**
 * Title bar part — occupies the top edge of the workbench.
 * Hosts menu bar, workspace name label, and window controls.
 *
 * Content is fully data-driven:
 *   - Workspace name from `setWorkspaceName()`
 *   - Menu bar from `registerMenuBarItem()` / `registerMenuBarDropdownItems()`
 *   - Window controls from Electron IPC
 */
export class TitlebarPart extends Part {

  // ── DOM refs ──

  private _dragRegion: HTMLElement | undefined;
  private _leftSlot: HTMLElement | undefined;
  private _centerSlot: HTMLElement | undefined;
  private _rightSlot: HTMLElement | undefined;

  // ── Workspace name (Task 1.1) ──

  private _workspaceLabel: HTMLElement | undefined;
  private _workspaceName = 'Parallx';

  // ── Menu bar (Task 1.2) ──

  private readonly _menuBarItems: MenuBarItem[] = [];
  private readonly _menuBarDropdownItems = new Map<string, MenuBarDropdownItem[]>();
  private _menuBarContainer: HTMLElement | undefined;
  private _activeDropdown: { menuId: string; el: HTMLElement; cleanup: IDisposable } | undefined;
  private _menuBarFocused = false;
  private _focusedMenuIndex = -1;
  private _keybindingLookup: IKeybindingLookup | undefined;
  private _commandExecutor: ICommandExecutor | undefined;

  // ── Window controls (Task 1.3) ──

  private _maximizeBtn: HTMLButtonElement | undefined;
  private _isMaximized = false;
  private _electronApi: ElectronWindowApi | undefined;

  // ── Events ──

  private readonly _onDidClickWorkspaceName = this._register(new Emitter<void>());
  readonly onDidClickWorkspaceName: Event<void> = this._onDidClickWorkspaceName.event;

  constructor() {
    super(
      PartId.Titlebar,
      'Title Bar',
      PartPosition.Top,
      TITLEBAR_CONSTRAINTS,
      true,
    );
  }

  // ── Slot accessors ──

  get leftSlot(): HTMLElement | undefined { return this._leftSlot; }
  get centerSlot(): HTMLElement | undefined { return this._centerSlot; }
  get rightSlot(): HTMLElement | undefined { return this._rightSlot; }

  // ════════════════════════════════════════════════════════════════════════
  // Task 1.1 — Workspace Name
  // ════════════════════════════════════════════════════════════════════════

  /**
   * Set the workspace name displayed in the title bar center.
   * Also updates `document.title`.
   */
  setWorkspaceName(name: string): void {
    this._workspaceName = name;
    if (this._workspaceLabel) {
      this._workspaceLabel.textContent = name;
    }
    this._updateDocumentTitle();
  }

  /** Update `document.title` to `{workspaceName} — Parallx` format. */
  private _updateDocumentTitle(editorTitle?: string): void {
    if (editorTitle) {
      document.title = `${editorTitle} — ${this._workspaceName} — Parallx`;
    } else {
      document.title = `${this._workspaceName} — Parallx`;
    }
  }

  /**
   * Update the active editor title portion of `document.title`.
   * Called when the active editor changes.
   */
  setActiveEditorTitle(title: string | undefined): void {
    this._updateDocumentTitle(title);
  }

  // ════════════════════════════════════════════════════════════════════════
  // Task 1.2 — Menu Bar
  // ════════════════════════════════════════════════════════════════════════

  /** Provide keybinding lookup for dropdown display. */
  setKeybindingLookup(lookup: IKeybindingLookup): void {
    this._keybindingLookup = lookup;
  }

  /** Provide command executor for dropdown item activation. */
  setCommandExecutor(executor: ICommandExecutor): void {
    this._commandExecutor = executor;
  }

  /**
   * Register a top-level menu bar item (e.g. "File", "Edit", "View").
   * Items are sorted by `order`.
   */
  registerMenuBarItem(item: MenuBarItem): IDisposable {
    this._menuBarItems.push(item);
    this._menuBarItems.sort((a, b) => a.order - b.order);
    this._renderMenuBar();
    return toDisposable(() => {
      const idx = this._menuBarItems.indexOf(item);
      if (idx >= 0) {
        this._menuBarItems.splice(idx, 1);
        this._renderMenuBar();
      }
    });
  }

  /**
   * Register dropdown items for a menu bar item.
   * Items are appended to existing items (if any).
   */
  registerMenuBarDropdownItems(menuId: string, items: MenuBarDropdownItem[]): IDisposable {
    const existing = this._menuBarDropdownItems.get(menuId) ?? [];
    const merged = [...existing, ...items];
    merged.sort((a, b) => {
      const gA = a.group ?? '';
      const gB = b.group ?? '';
      if (gA !== gB) return gA.localeCompare(gB);
      return (a.order ?? 0) - (b.order ?? 0);
    });
    this._menuBarDropdownItems.set(menuId, merged);

    return toDisposable(() => {
      const current = this._menuBarDropdownItems.get(menuId);
      if (!current) return;
      const updated = current.filter(i => !items.includes(i));
      if (updated.length > 0) {
        this._menuBarDropdownItems.set(menuId, updated);
      } else {
        this._menuBarDropdownItems.delete(menuId);
      }
    });
  }

  /** Render/re-render the menu bar from registered items. */
  private _renderMenuBar(): void {
    if (!this._menuBarContainer) return;
    // Clear existing menu items (keep app icon)
    const appIcon = this._menuBarContainer.querySelector('.titlebar-app-icon');
    this._menuBarContainer.innerHTML = '';
    if (appIcon) {
      this._menuBarContainer.appendChild(appIcon);
    }

    for (const item of this._menuBarItems) {
      const el = document.createElement('span');
      el.textContent = item.label;
      el.classList.add('titlebar-menu-item');
      el.setAttribute('role', 'menuitem');
      el.setAttribute('tabindex', '-1');
      el.setAttribute('data-menu-id', item.id);

      el.addEventListener('click', (e) => {
        e.stopPropagation();
        this._toggleDropdown(item.id, el);
      });

      el.addEventListener('mouseenter', () => {
        // If another dropdown is open, switch to this one on hover
        if (this._activeDropdown && this._activeDropdown.menuId !== item.id) {
          this._toggleDropdown(item.id, el);
        }
      });

      this._menuBarContainer.appendChild(el);
    }
  }

  /** Toggle a dropdown menu below a menu bar item. */
  private _toggleDropdown(menuId: string, anchor: HTMLElement): void {
    // Close current dropdown if same menu
    if (this._activeDropdown) {
      const wasActive = this._activeDropdown.menuId === menuId;
      this._closeActiveDropdown();
      if (wasActive) return;
    }

    const items = this._menuBarDropdownItems.get(menuId);
    if (!items || items.length === 0) return;

    // Build dropdown element
    const dropdown = document.createElement('div');
    dropdown.classList.add('titlebar-dropdown');
    dropdown.setAttribute('role', 'menu');

    let highlightIndex = -1;
    const itemEls: HTMLElement[] = [];

    let lastGroup: string | undefined;
    for (const item of items) {
      // Group separator
      if (lastGroup !== undefined && item.group !== lastGroup) {
        const sep = document.createElement('div');
        sep.classList.add('titlebar-dropdown-separator');
        dropdown.appendChild(sep);
      }
      lastGroup = item.group;

      const row = document.createElement('div');
      row.classList.add('titlebar-dropdown-item');
      row.setAttribute('role', 'menuitem');

      const label = document.createElement('span');
      label.classList.add('titlebar-dropdown-item-label');
      label.textContent = item.title;
      row.appendChild(label);

      // Keybinding display
      const kb = item.keybinding ?? this._keybindingLookup?.lookupKeybinding(item.commandId);
      if (kb) {
        const kbEl = document.createElement('span');
        kbEl.classList.add('titlebar-dropdown-item-keybinding');
        kbEl.textContent = this._formatKeybinding(kb);
        row.appendChild(kbEl);
      }

      row.addEventListener('click', (e) => {
        e.stopPropagation();
        this._closeActiveDropdown();
        this._commandExecutor?.executeCommand(item.commandId);
      });

      row.addEventListener('mouseenter', () => {
        this._highlightDropdownItem(itemEls, items.indexOf(item));
        highlightIndex = items.indexOf(item);
      });

      itemEls.push(row);
      dropdown.appendChild(row);
    }

    // Position below anchor
    const rect = anchor.getBoundingClientRect();
    dropdown.style.position = 'fixed';
    dropdown.style.top = `${rect.bottom}px`;
    dropdown.style.left = `${rect.left}px`;

    document.body.appendChild(dropdown);

    // Keyboard navigation inside dropdown
    const onKeydown = (e: KeyboardEvent) => {
      switch (e.key) {
        case 'ArrowDown':
          e.preventDefault();
          highlightIndex = Math.min(highlightIndex + 1, itemEls.length - 1);
          this._highlightDropdownItem(itemEls, highlightIndex);
          break;
        case 'ArrowUp':
          e.preventDefault();
          highlightIndex = Math.max(highlightIndex - 1, 0);
          this._highlightDropdownItem(itemEls, highlightIndex);
          break;
        case 'Enter':
          e.preventDefault();
          if (highlightIndex >= 0 && highlightIndex < items.length) {
            this._closeActiveDropdown();
            this._commandExecutor?.executeCommand(items[highlightIndex].commandId);
          }
          break;
        case 'Escape':
          e.preventDefault();
          this._closeActiveDropdown();
          anchor.focus();
          break;
        case 'ArrowRight': {
          e.preventDefault();
          const idx = this._menuBarItems.findIndex(m => m.id === menuId);
          if (idx >= 0 && idx < this._menuBarItems.length - 1) {
            const nextItem = this._menuBarItems[idx + 1];
            const nextEl = this._menuBarContainer?.querySelector(`[data-menu-id="${nextItem.id}"]`) as HTMLElement;
            if (nextEl) this._toggleDropdown(nextItem.id, nextEl);
          }
          break;
        }
        case 'ArrowLeft': {
          e.preventDefault();
          const idx2 = this._menuBarItems.findIndex(m => m.id === menuId);
          if (idx2 > 0) {
            const prevItem = this._menuBarItems[idx2 - 1];
            const prevEl = this._menuBarContainer?.querySelector(`[data-menu-id="${prevItem.id}"]`) as HTMLElement;
            if (prevEl) this._toggleDropdown(prevItem.id, prevEl);
          }
          break;
        }
      }
    };

    document.addEventListener('keydown', onKeydown, true);

    // Click outside to close
    const onClickOutside = (e: MouseEvent) => {
      if (!dropdown.contains(e.target as Node) && !anchor.contains(e.target as Node)) {
        this._closeActiveDropdown();
      }
    };
    // Defer the outside-click listener to avoid immediate dismissal
    setTimeout(() => document.addEventListener('click', onClickOutside), 0);

    // Mark anchor as active
    anchor.classList.add('titlebar-menu-item--active');

    this._activeDropdown = {
      menuId,
      el: dropdown,
      cleanup: toDisposable(() => {
        document.removeEventListener('keydown', onKeydown, true);
        document.removeEventListener('click', onClickOutside);
        anchor.classList.remove('titlebar-menu-item--active');
        if (dropdown.parentNode) dropdown.remove();
      }),
    };
  }

  private _closeActiveDropdown(): void {
    if (this._activeDropdown) {
      this._activeDropdown.cleanup.dispose();
      this._activeDropdown = undefined;
    }
  }

  private _highlightDropdownItem(els: HTMLElement[], index: number): void {
    for (let i = 0; i < els.length; i++) {
      els[i].classList.toggle('titlebar-dropdown-item--selected', i === index);
    }
  }

  private _formatKeybinding(key: string): string {
    // Convert normalized key to display format (Ctrl → ⌃ on Mac)
    const isMac = navigator.platform?.startsWith('Mac') ?? false;
    let display = key;
    if (isMac) {
      display = display.replace(/\bctrl\b/gi, '⌃').replace(/\balt\b/gi, '⌥')
        .replace(/\bshift\b/gi, '⇧').replace(/\bmeta\b/gi, '⌘');
    } else {
      display = display.replace(/\bctrl\b/gi, 'Ctrl').replace(/\balt\b/gi, 'Alt')
        .replace(/\bshift\b/gi, 'Shift').replace(/\bmeta\b/gi, 'Win');
    }
    // Capitalize key portions and replace + with delimiter
    return display.split('+').map(p => p.trim())
      .map(p => p.length === 1 ? p.toUpperCase() : p)
      .join(isMac ? '' : '+');
  }

  /** Handle Alt key to focus/unfocus menu bar (Windows/Linux convention). */
  private _setupAltKeyHandler(): void {
    let altPressed = false;
    const handler = (e: KeyboardEvent) => {
      if (e.key === 'Alt' && e.type === 'keyup' && altPressed && !e.ctrlKey && !e.shiftKey && !e.metaKey) {
        // Toggle menu bar focus
        if (this._menuBarFocused) {
          this._unfocusMenuBar();
        } else {
          this._focusMenuBar();
        }
      }
      altPressed = e.key === 'Alt' && e.type === 'keydown' && !e.ctrlKey && !e.shiftKey && !e.metaKey;
      // Any other key cancels the alt press
      if (e.type === 'keydown' && e.key !== 'Alt') {
        altPressed = false;
      }
    };
    document.addEventListener('keydown', handler);
    document.addEventListener('keyup', handler);
    this._register(toDisposable(() => {
      document.removeEventListener('keydown', handler);
      document.removeEventListener('keyup', handler);
    }));
  }

  private _focusMenuBar(): void {
    this._menuBarFocused = true;
    const firstItem = this._menuBarContainer?.querySelector('.titlebar-menu-item') as HTMLElement | null;
    if (firstItem) {
      firstItem.focus();
      this._focusedMenuIndex = 0;
    }
    this._setupMenuBarKeyNav();
  }

  private _unfocusMenuBar(): void {
    this._menuBarFocused = false;
    this._focusedMenuIndex = -1;
    this._closeActiveDropdown();
    // Return focus to document
    (document.activeElement as HTMLElement | null)?.blur?.();
  }

  private _menuBarKeyNavCleanup: IDisposable | undefined;

  private _setupMenuBarKeyNav(): void {
    this._menuBarKeyNavCleanup?.dispose();

    const handler = (e: KeyboardEvent) => {
      if (!this._menuBarFocused) return;
      const menuEls = Array.from(
        this._menuBarContainer?.querySelectorAll('.titlebar-menu-item') ?? [],
      ) as HTMLElement[];

      switch (e.key) {
        case 'ArrowRight':
          e.preventDefault();
          this._focusedMenuIndex = Math.min(this._focusedMenuIndex + 1, menuEls.length - 1);
          menuEls[this._focusedMenuIndex]?.focus();
          break;
        case 'ArrowLeft':
          e.preventDefault();
          this._focusedMenuIndex = Math.max(this._focusedMenuIndex - 1, 0);
          menuEls[this._focusedMenuIndex]?.focus();
          break;
        case 'Enter':
        case 'ArrowDown':
          e.preventDefault();
          if (this._focusedMenuIndex >= 0 && this._focusedMenuIndex < this._menuBarItems.length) {
            const item = this._menuBarItems[this._focusedMenuIndex];
            const el = menuEls[this._focusedMenuIndex];
            if (el) this._toggleDropdown(item.id, el);
          }
          break;
        case 'Escape':
          e.preventDefault();
          this._unfocusMenuBar();
          break;
      }
    };

    document.addEventListener('keydown', handler);
    this._menuBarKeyNavCleanup = toDisposable(() => {
      document.removeEventListener('keydown', handler);
    });
  }

  // ════════════════════════════════════════════════════════════════════════
  // Task 1.3 — Window Controls
  // ════════════════════════════════════════════════════════════════════════

  /** Wire window controls to Electron IPC. */
  private _setupWindowControls(container: HTMLElement): void {
    const api = (window as any).parallxElectron as ElectronWindowApi | undefined;
    this._electronApi = api;

    if (!api) {
      // Not running in Electron — hide window controls
      container.classList.add('hidden');
      return;
    }

    const controls = document.createElement('div');
    controls.classList.add('window-controls');

    // Minimize
    const minimizeBtn = document.createElement('button');
    minimizeBtn.classList.add('window-control-btn');
    minimizeBtn.setAttribute('aria-label', 'Minimize');
    minimizeBtn.textContent = '─';
    minimizeBtn.addEventListener('click', () => api.minimize());
    controls.appendChild(minimizeBtn);

    // Maximize / Restore
    this._maximizeBtn = document.createElement('button');
    this._maximizeBtn.classList.add('window-control-btn');
    this._maximizeBtn.setAttribute('aria-label', 'Maximize');
    this._maximizeBtn.textContent = '□';
    this._maximizeBtn.addEventListener('click', () => api.maximize());
    controls.appendChild(this._maximizeBtn);

    // Close
    const closeBtn = document.createElement('button');
    closeBtn.classList.add('window-control-btn', 'window-control-btn--close');
    closeBtn.setAttribute('aria-label', 'Close');
    closeBtn.textContent = '✕';
    closeBtn.addEventListener('click', () => api.close());
    controls.appendChild(closeBtn);

    container.appendChild(controls);

    // Track maximized state and update icon
    api.isMaximized().then((maximized) => {
      this._isMaximized = maximized;
      this._updateMaximizeIcon();
    });

    api.onMaximizedChange((maximized) => {
      this._isMaximized = maximized;
      this._updateMaximizeIcon();
    });
  }

  private _updateMaximizeIcon(): void {
    if (!this._maximizeBtn) return;
    if (this._isMaximized) {
      this._maximizeBtn.textContent = '❐'; // restore icon
      this._maximizeBtn.setAttribute('aria-label', 'Restore');
    } else {
      this._maximizeBtn.textContent = '□'; // maximize icon
      this._maximizeBtn.setAttribute('aria-label', 'Maximize');
    }
  }

  /** Double-click on drag region toggles maximize (platform convention). */
  private _setupDragRegionDoubleClick(): void {
    if (!this._dragRegion || !this._electronApi) return;
    this._dragRegion.addEventListener('dblclick', () => {
      this._electronApi?.maximize(); // maximize() toggles in Electron IPC handler
    });
  }

  // ════════════════════════════════════════════════════════════════════════
  // Part lifecycle
  // ════════════════════════════════════════════════════════════════════════

  protected override createContent(container: HTMLElement): void {
    container.classList.add('titlebar-content');

    // Drag region (for custom titlebars with -webkit-app-region)
    this._dragRegion = document.createElement('div');
    this._dragRegion.classList.add('titlebar-drag-region');
    container.appendChild(this._dragRegion);

    // Left slot: app icon + menu bar
    this._leftSlot = document.createElement('div');
    this._leftSlot.classList.add('titlebar-left', 'titlebar-menubar');
    this._leftSlot.setAttribute('role', 'menubar');
    container.appendChild(this._leftSlot);

    // App icon
    const appIcon = document.createElement('span');
    appIcon.textContent = '⊞';
    appIcon.classList.add('titlebar-app-icon');
    this._leftSlot.appendChild(appIcon);

    this._menuBarContainer = this._leftSlot;

    // Center slot: workspace name label
    this._centerSlot = document.createElement('div');
    this._centerSlot.classList.add('titlebar-center');
    container.appendChild(this._centerSlot);

    this._workspaceLabel = document.createElement('span');
    this._workspaceLabel.classList.add('titlebar-workspace-label');
    this._workspaceLabel.textContent = this._workspaceName;
    this._workspaceLabel.setAttribute('role', 'button');
    this._workspaceLabel.setAttribute('tabindex', '0');
    this._workspaceLabel.addEventListener('click', () => {
      this._onDidClickWorkspaceName.fire();
    });
    this._workspaceLabel.addEventListener('keydown', (e) => {
      if (e.key === 'Enter' || e.key === ' ') {
        e.preventDefault();
        this._onDidClickWorkspaceName.fire();
      }
    });
    this._centerSlot.appendChild(this._workspaceLabel);

    // Right slot: window controls
    this._rightSlot = document.createElement('div');
    this._rightSlot.classList.add('titlebar-right');
    container.appendChild(this._rightSlot);

    // Window controls (Task 1.3)
    this._setupWindowControls(this._rightSlot);

    // Double-click drag region to toggle maximize (Task 1.3)
    this._setupDragRegionDoubleClick();

    // Alt key handler for menu bar focus (Task 1.2)
    this._setupAltKeyHandler();

    // Render registered menu items (if any were registered before DOM creation)
    this._renderMenuBar();

    // Set initial document title
    this._updateDocumentTitle();
  }

  override dispose(): void {
    this._closeActiveDropdown();
    this._menuBarKeyNavCleanup?.dispose();
    super.dispose();
  }
}

/** Descriptor for registry registration. */
export const titlebarPartDescriptor: PartDescriptor = {
  id: PartId.Titlebar,
  name: 'Title Bar',
  position: PartPosition.Top,
  defaultVisible: true,
  constraints: TITLEBAR_CONSTRAINTS,
  factory: () => new TitlebarPart(),
};
