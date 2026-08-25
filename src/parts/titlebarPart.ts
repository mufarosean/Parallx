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
import { IWindowService } from '../services/serviceTypes.js';
import { ContextMenu, type IContextMenuItem } from '../ui/contextMenu.js';
import { $ } from '../ui/dom.js';

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
  /** When-clause expression — item is disabled (grayed out) when the clause evaluates to false. */
  readonly when?: string;
}

/** Service providing keybinding display strings. */
export interface IKeybindingLookup {
  lookupKeybinding(commandId: string): string | undefined;
}

/** Service for executing commands. */
export interface ICommandExecutor {
  executeCommand(commandId: string, ...args: unknown[]): Promise<unknown>;
  executeCommandFrom(origin: 'menu' | 'ui', commandId: string, ...args: unknown[]): Promise<unknown>;
  hasCommand(commandId: string): boolean;
}

/** Service for evaluating when-clause expressions against context keys. */
export interface IContextKeyEvaluator {
  contextMatchesRules(whenClause: string | undefined): boolean;
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
  private _activeDropdown: { menuId: string; menu: ContextMenu; cleanup: IDisposable } | undefined;
  private _menuBarFocused = false;
  private _focusedMenuIndex = -1;
  private _keybindingLookup: IKeybindingLookup | undefined;
  private _commandExecutor: ICommandExecutor | undefined;
  private _contextKeyEvaluator: IContextKeyEvaluator | undefined;

  // ── Window controls (Task 1.3) ──

  private _maximizeBtn: HTMLButtonElement | undefined;
  private _isMaximized = false;
  private _windowService: IWindowService | undefined;

  // ── Events ──

  private readonly _onDidClickWorkspaceName = this._register(new Emitter<void>());
  readonly onDidClickWorkspaceName: Event<void> = this._onDidClickWorkspaceName.event;

  /** Fires when the title-bar command center (the search box) is activated. */
  private readonly _onDidClickCommandCenter = this._register(new Emitter<void>());
  readonly onDidClickCommandCenter: Event<void> = this._onDidClickCommandCenter.event;

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
      document.title = `${editorTitle} · ${this._workspaceName} · Parallx`;
    } else {
      document.title = `${this._workspaceName} · Parallx`;
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

  /** Provide context key evaluator for when-clause graying. */
  setContextKeyEvaluator(evaluator: IContextKeyEvaluator): void {
    this._contextKeyEvaluator = evaluator;
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
      const el = $('span');
      el.textContent = item.label;
      el.classList.add('titlebar-menu-item');
      el.setAttribute('role', 'menuitem');
      el.setAttribute('tabindex', '-1');
      el.setAttribute('data-menu-id', item.id);

      // Mouse interaction must never park DOM focus in the ribbon — a
      // focused menu span was a keyboard dead zone (typing went nowhere,
      // "focus stuck on the top ribbon"). Keyboard mode focuses items
      // explicitly; the mouse path stays focus-neutral.
      el.addEventListener('mousedown', (e) => e.preventDefault());
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
  private _toggleDropdown(menuId: string, anchor: HTMLElement, viaKeyboard = false): void {
    // Close current dropdown if same menu
    if (this._activeDropdown) {
      const wasActive = this._activeDropdown.menuId === menuId;
      this._closeActiveDropdown();
      if (wasActive) return;
    }

    const items = this._menuBarDropdownItems.get(menuId);
    if (!items || items.length === 0) return;

    // Build IContextMenuItem[] from MenuBarDropdownItem[]
    const menuItems: IContextMenuItem[] = items.map(item => {
      // Determine disabled state:
      // 1. When-clause evaluates to false → disabled
      // 2. Command not registered → disabled
      let disabled = false;
      if (item.when && this._contextKeyEvaluator) {
        disabled = !this._contextKeyEvaluator.contextMatchesRules(item.when);
      }
      if (!disabled && this._commandExecutor && !this._commandExecutor.hasCommand(item.commandId)) {
        disabled = true;
      }

      return {
        id: item.commandId,
        label: item.title,
        keybinding: this._formatKeybinding(
          item.keybinding ?? this._keybindingLookup?.lookupKeybinding(item.commandId) ?? '',
        ) || undefined,
        group: item.group,
        order: item.order,
        disabled,
      };
    });

    // Position below anchor
    const rect = anchor.getBoundingClientRect();
    const ctxMenu = ContextMenu.show({
      items: menuItems,
      anchor: { x: rect.left, y: rect.bottom },
      autoSelectFirst: viaKeyboard,
      className: 'titlebar-dropdown',
    });

    // Item selected → execute command
    ctxMenu.onDidSelect(({ item }) => {
      this._commandExecutor?.executeCommandFrom('menu', item.id);
    });

    // When dismissed (Escape, click outside, or selection), clean up.
    // CRITICAL: remove the document-level capture keydown listener here too.
    // The old code only cleared `_activeDropdown` and left `onLateralNav`
    // attached — so after opening a titlebar menu once, its capture-phase
    // ArrowLeft/ArrowRight `stopImmediatePropagation` leaked and swallowed
    // those arrows GLOBALLY (e.g. the text editor's cursor stopped moving).
    ctxMenu.onDidDismiss(() => {
      document.removeEventListener('keydown', onLateralNav, true);
      this._activeDropdown = undefined;
      anchor.classList.remove('titlebar-menu-item--active');
      // The ribbon never keeps focus after a menu closes — a lingering
      // focused span made the next Enter re-open the menu.
      const active = document.activeElement as HTMLElement | null;
      if (active?.classList.contains('titlebar-menu-item')) active.blur();
    });

    // Selecting a command ENDS the menu interaction entirely: keyboard
    // mode exits so a later Enter in the editor can never re-arm it.
    ctxMenu.onDidSelect(() => {
      if (this._menuBarFocused) this._unfocusMenuBar();
    });

    // ArrowLeft / ArrowRight — navigate between menu bar items
    const onLateralNav = (e: KeyboardEvent) => {
      if (e.key === 'ArrowRight') {
        e.preventDefault();
        e.stopImmediatePropagation();
        const idx = this._menuBarItems.findIndex(m => m.id === menuId);
        if (idx >= 0 && idx < this._menuBarItems.length - 1) {
          const nextItem = this._menuBarItems[idx + 1];
          const nextEl = this._menuBarContainer?.querySelector(`[data-menu-id="${nextItem.id}"]`) as HTMLElement;
          if (nextEl) this._toggleDropdown(nextItem.id, nextEl, true);
        }
      } else if (e.key === 'ArrowLeft') {
        e.preventDefault();
        e.stopImmediatePropagation();
        const idx = this._menuBarItems.findIndex(m => m.id === menuId);
        if (idx > 0) {
          const prevItem = this._menuBarItems[idx - 1];
          const prevEl = this._menuBarContainer?.querySelector(`[data-menu-id="${prevItem.id}"]`) as HTMLElement;
          if (prevEl) this._toggleDropdown(prevItem.id, prevEl, true);
        }
      }
    };
    document.addEventListener('keydown', onLateralNav, true);

    // Mark anchor as active
    anchor.classList.add('titlebar-menu-item--active');

    this._activeDropdown = {
      menuId,
      menu: ctxMenu,
      cleanup: toDisposable(() => {
        document.removeEventListener('keydown', onLateralNav, true);
        anchor.classList.remove('titlebar-menu-item--active');
        ctxMenu.dismiss();
      }),
    };
  }

  private _closeActiveDropdown(): void {
    if (this._activeDropdown) {
      this._activeDropdown.cleanup.dispose();
      this._activeDropdown = undefined;
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

    // THE FOCUS CONTRACT (the field bug this encodes against): menu-bar
    // keyboard mode is a MODE, and a mode needs exits. It used to exit
    // only on Escape or another Alt — so after an accidental Alt tap,
    // clicking back into the editor left the mode armed, and the next
    // Enter mid-typing opened the File dropdown with auto-select-first
    // primed: one more Enter created a text file over the user's work.
    // Exits now: Escape, Alt, selecting a command, ANY pointer press
    // outside the ribbon, DOM focus leaving the ribbon, and any
    // non-navigation key. The mode can never outlive the user's
    // attention.

    const handler = (e: KeyboardEvent) => {
      if (!this._menuBarFocused) return;

      // Focus has left the ribbon (a click, a command, a view reveal):
      // the mode is stale. Exit and let the key flow to its real target.
      const active = document.activeElement as HTMLElement | null;
      if (!active?.classList.contains('titlebar-menu-item')) {
        this._unfocusMenuBar();
        return;
      }

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
            if (el) this._toggleDropdown(item.id, el, true);
          }
          break;
        case 'Escape':
          e.preventDefault();
          this._unfocusMenuBar();
          break;
        default:
          // Typing is never menu navigation — abandon the mode rather
          // than swallowing or shadowing the user's keys.
          if (e.key !== 'Alt' && e.key !== 'Shift' && e.key !== 'Control' && e.key !== 'Meta' && e.key !== 'Tab') {
            this._unfocusMenuBar();
          }
          break;
      }
    };

    // A pointer press anywhere outside the ribbon ends the mode.
    const onPointerDown = (e: PointerEvent) => {
      if (this._menuBarFocused && !this._menuBarContainer?.contains(e.target as Node)) {
        this._unfocusMenuBar();
      }
    };

    document.addEventListener('keydown', handler);
    document.addEventListener('pointerdown', onPointerDown, true);
    this._menuBarKeyNavCleanup = toDisposable(() => {
      document.removeEventListener('keydown', handler);
      document.removeEventListener('pointerdown', onPointerDown, true);
    });
  }

  // ════════════════════════════════════════════════════════════════════════
  // Task 1.3 — Window Controls
  // ════════════════════════════════════════════════════════════════════════

  /**
   * Provide the window service for window-control operations.
   * Must be called before (or immediately after) `create()`.
   */
  setWindowService(svc: IWindowService): void {
    this._windowService = svc;
  }

  /** Wire window controls via IWindowService (no direct Electron access). */
  private _setupWindowControls(container: HTMLElement): void {
    const svc = this._windowService;

    if (!svc || !svc.isNativeWindow) {
      // Not running in Electron — hide window controls
      container.classList.add('hidden');
      return;
    }

    const controls = $('div');
    controls.classList.add('window-controls');

    // Minimize
    const minimizeBtn = $('button');
    minimizeBtn.classList.add('window-control-btn');
    minimizeBtn.setAttribute('aria-label', 'Minimize');
    minimizeBtn.innerHTML = '<svg width="10" height="10" viewBox="0 0 10 1"><path d="M0 0h10v1H0z" fill="currentColor"/></svg>';
    minimizeBtn.addEventListener('click', () => svc.minimize());
    controls.appendChild(minimizeBtn);

    // Maximize / Restore
    this._maximizeBtn = $('button');
    this._maximizeBtn.classList.add('window-control-btn');
    this._maximizeBtn.setAttribute('aria-label', 'Maximize');
    this._maximizeBtn.innerHTML = '<svg width="10" height="10" viewBox="0 0 10 10"><path d="M0 0v10h10V0H0zm1 1h8v8H1V1z" fill="currentColor"/></svg>';
    this._maximizeBtn.addEventListener('click', () => svc.maximize());
    controls.appendChild(this._maximizeBtn);

    // Close
    const closeBtn = $('button');
    closeBtn.classList.add('window-control-btn', 'window-control-btn--close');
    closeBtn.setAttribute('aria-label', 'Close');
    closeBtn.innerHTML = '<svg width="10" height="10" viewBox="0 0 10 10"><path d="M1.41 0L5 3.59 8.59 0 10 1.41 6.41 5 10 8.59 8.59 10 5 6.41 1.41 10 0 8.59 3.59 5 0 1.41z" fill="currentColor"/></svg>';
    closeBtn.addEventListener('click', () => svc.close());
    controls.appendChild(closeBtn);

    container.appendChild(controls);

    // Track maximized state and update icon
    svc.isMaximized().then((maximized) => {
      this._isMaximized = maximized;
      this._updateMaximizeIcon();
    });

    this._register(svc.onDidChangeMaximized((maximized) => {
      this._isMaximized = maximized;
      this._updateMaximizeIcon();
    }));
  }

  private _updateMaximizeIcon(): void {
    if (!this._maximizeBtn) return;
    if (this._isMaximized) {
      // Restore icon (two overlapping rectangles)
      this._maximizeBtn.innerHTML = '<svg width="10" height="10" viewBox="0 0 10 10"><path d="M2 0v2H0v8h8V8h2V0H2zm1 3h5v4H1V3h2zm6-2v6H9V1H3V1h6z" fill="currentColor"/></svg>';
      this._maximizeBtn.setAttribute('aria-label', 'Restore');
    } else {
      // Maximize icon (single rectangle)
      this._maximizeBtn.innerHTML = '<svg width="10" height="10" viewBox="0 0 10 10"><path d="M0 0v10h10V0H0zm1 1h8v8H1V1z" fill="currentColor"/></svg>';
      this._maximizeBtn.setAttribute('aria-label', 'Maximize');
    }
  }

  /** Double-click on drag region toggles maximize (platform convention). */
  private _setupDragRegionDoubleClick(): void {
    if (!this._dragRegion || !this._windowService?.isNativeWindow) return;
    this._dragRegion.addEventListener('dblclick', () => {
      this._windowService?.maximize(); // maximize() toggles in Electron IPC handler
    });
  }

  // ════════════════════════════════════════════════════════════════════════
  // Part lifecycle
  // ════════════════════════════════════════════════════════════════════════

  protected override createContent(container: HTMLElement): void {
    // Root container wrapper (VS Code: .titlebar-container)
    const rootContainer = $('div');
    rootContainer.classList.add('titlebar-container');
    container.appendChild(rootContainer);

    // Drag region — prepend so it's first child (behind siblings by DOM order, no z-index needed)
    // VS Code: src/vs/workbench/browser/parts/titlebar/titlebarPart.ts BrowserTitlebarPart.createContentArea()
    this._dragRegion = $('div');
    this._dragRegion.classList.add('titlebar-drag-region');
    rootContainer.prepend(this._dragRegion);

    // Left slot: app icon + menu bar
    this._leftSlot = $('div');
    this._leftSlot.classList.add('titlebar-left', 'titlebar-menubar');
    this._leftSlot.setAttribute('role', 'menubar');
    rootContainer.appendChild(this._leftSlot);

    // App icon — Layered Planes logo
    const appIcon = $('span');
    appIcon.classList.add('titlebar-app-icon');
    appIcon.innerHTML = `<svg width="20" height="20" viewBox="0 0 32 32" fill="none" xmlns="http://www.w3.org/2000/svg">
      <rect x="6" y="8" width="16" height="16" rx="1.5" transform="skewX(-8)" fill="currentColor" opacity="0.4"/>
      <rect x="10" y="6" width="16" height="16" rx="1.5" transform="skewX(-8)" fill="currentColor"/>
    </svg>`;
    this._leftSlot.appendChild(appIcon);

    this._menuBarContainer = this._leftSlot;

    // Center slot: command center (search box). The workspace name moved to the
    // status bar; this top-center space is now a quick command/search affordance
    // (VS Code's command center), always at hand.
    this._centerSlot = $('div');
    this._centerSlot.classList.add('titlebar-center');
    rootContainer.appendChild(this._centerSlot);

    const commandCenter = $('div');
    // `px-bare` opts out of the global control press/focus chrome — it's a text
    // surface, not a button to depress, so it must never shift on click.
    commandCenter.classList.add('titlebar-command-center', 'px-bare');
    commandCenter.setAttribute('role', 'button');
    commandCenter.setAttribute('tabindex', '0');
    commandCenter.title = 'Search & run commands';
    commandCenter.innerHTML = `<span class="titlebar-command-center-icon" aria-hidden="true"><svg width="13" height="13" viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.4"><circle cx="7" cy="7" r="4.2"/><line x1="10.3" y1="10.3" x2="14" y2="14" stroke-linecap="round"/></svg></span><span class="titlebar-command-center-label">Search commands</span><span class="titlebar-command-center-kbd" aria-hidden="true"><kbd>Ctrl</kbd><kbd>⇧</kbd><kbd>P</kbd></span>`;
    commandCenter.addEventListener('click', () => {
      this._onDidClickCommandCenter.fire();
    });
    commandCenter.addEventListener('keydown', (e) => {
      if (e.key === 'Enter' || e.key === ' ') {
        e.preventDefault();
        this._onDidClickCommandCenter.fire();
      }
    });
    this._centerSlot.appendChild(commandCenter);

    // Right slot: window controls
    this._rightSlot = $('div');
    this._rightSlot.classList.add('titlebar-right');
    rootContainer.appendChild(this._rightSlot);

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
