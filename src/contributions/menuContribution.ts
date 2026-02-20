// menuContribution.ts — contributes.menus processor
//
// Processes the `contributes.menus` section from tool manifests.
// Manages three menu locations:
//   - commandPalette: controls command visibility in the palette

import './menuContribution.css';
//   - view/title: adds action buttons to view title bars
//   - view/context: adds items to view right-click context menus
//
// Menu items are conditional on when clauses and sorted by group + order.

import { Disposable, IDisposable, toDisposable } from '../platform/lifecycle.js';
import { Emitter, Event } from '../platform/events.js';
import type { IToolDescription } from '../tools/toolManifest.js';
import type { CommandService } from '../commands/commandRegistry.js';
import type { IContributedMenuItem, MenuLocationId, IContributionProcessor } from './contributionTypes.js';
import { $, layoutPopup } from '../ui/dom.js';

// ─── Minimal shape to avoid circular imports ─────────────────────────────────

interface IContextKeyServiceLike {
  contextMatchesRules(whenClause: string | undefined): boolean;
}

// ─── Supported Menu Locations ────────────────────────────────────────────────

const SUPPORTED_MENU_LOCATIONS: ReadonlySet<string> = new Set([
  'commandPalette',
  'view/title',
  'view/context',
]);

// ─── MenuContributionProcessor ───────────────────────────────────────────────

/**
 * Processes `contributes.menus` from tool manifests.
 *
 * Menu items control:
 * - `commandPalette`: Whether a command appears/hides in the command palette
 * - `view/title`: Action buttons rendered in view title bars
 * - `view/context`: Items in view right-click context menus
 */
export class MenuContributionProcessor extends Disposable implements IContributionProcessor {

  /** All contributed menu items, organized by menu location. */
  private readonly _menuItems = new Map<MenuLocationId, IContributedMenuItem[]>();

  /** Menu items per tool for cleanup. */
  private readonly _toolMenuItems = new Map<string, IContributedMenuItem[]>();

  /** Rendered title bar action elements for cleanup. */
  private readonly _renderedActions = new Map<string, Map<string, HTMLElement[]>>();

  /** Active context menu overlay (if any). */
  private _activeContextMenu: HTMLElement | null = null;

  /** Active context menu escape handler for cleanup. */
  private _activeEscHandler: ((e: KeyboardEvent) => void) | null = null;

  /** Optional context key service for when-clause evaluation. */
  private _contextKeyService: IContextKeyServiceLike | undefined;

  // ── Events ──

  private readonly _onDidProcessMenus = this._register(new Emitter<{ toolId: string; items: readonly IContributedMenuItem[] }>());
  readonly onDidProcessMenus: Event<{ toolId: string; items: readonly IContributedMenuItem[] }> = this._onDidProcessMenus.event;

  private readonly _onDidRemoveMenus = this._register(new Emitter<{ toolId: string }>());
  readonly onDidRemoveMenus: Event<{ toolId: string }> = this._onDidRemoveMenus.event;

  private readonly _onDidChangeMenu = this._register(new Emitter<MenuLocationId>());
  /** Fires when the items for a menu location change. */
  readonly onDidChangeMenu: Event<MenuLocationId> = this._onDidChangeMenu.event;

  constructor(
    private readonly _commandService: CommandService,
  ) {
    super();

    // Initialize menu location buckets
    for (const loc of SUPPORTED_MENU_LOCATIONS) {
      this._menuItems.set(loc as MenuLocationId, []);
    }
  }

  /**
   * Set the context key service for when-clause evaluation.
   */
  setContextKeyService(service: IContextKeyServiceLike): void {
    this._contextKeyService = service;
  }

  // ── IContributionProcessor ──

  /**
   * Process a tool's `contributes.menus` section.
   */
  processContributions(toolDescription: IToolDescription): void {
    const { manifest } = toolDescription;
    const menus = manifest.contributes?.menus;
    if (!menus) return;

    const toolId = manifest.id;
    const contributedList: IContributedMenuItem[] = [];

    for (const [location, items] of Object.entries(menus)) {
      if (!SUPPORTED_MENU_LOCATIONS.has(location)) {
        console.warn(
          `[MenuContribution] Unknown menu location "${location}" in tool "${toolId}" — skipping`,
        );
        continue;
      }

      const menuId = location as MenuLocationId;

      for (const item of items) {
        if (!item.command) {
          console.warn(
            `[MenuContribution] Menu item in "${location}" from tool "${toolId}" missing command — skipping`,
          );
          continue;
        }

        const contributed: IContributedMenuItem = {
          commandId: item.command,
          toolId,
          menuId,
          group: item.group,
          order: undefined, // M2: order from group position
          when: item.when,
        };

        const bucket = this._menuItems.get(menuId)!;
        bucket.push(contributed);
        contributedList.push(contributed);
      }
    }

    // Store per-tool for cleanup
    const existing = this._toolMenuItems.get(toolId) ?? [];
    this._toolMenuItems.set(toolId, [...existing, ...contributedList]);

    if (contributedList.length > 0) {
      this._onDidProcessMenus.fire({ toolId, items: contributedList });

      // Notify each affected menu location
      const affectedLocations = new Set(contributedList.map(i => i.menuId));
      for (const loc of affectedLocations) {
        this._onDidChangeMenu.fire(loc);
      }

      console.log(
        `[MenuContribution] Registered ${contributedList.length} menu item(s) from tool "${toolId}":`,
        contributedList.map(i => `${i.menuId}:${i.commandId}`).join(', '),
      );
    }
  }

  /**
   * Remove all menu contributions from a tool.
   */
  removeContributions(toolId: string): void {
    const toolItems = this._toolMenuItems.get(toolId);
    if (!toolItems || toolItems.length === 0) return;

    const affectedLocations = new Set<MenuLocationId>();

    for (const [menuId, items] of this._menuItems) {
      const filtered = items.filter(i => i.toolId !== toolId);
      this._menuItems.set(menuId, filtered);
      if (filtered.length !== items.length) {
        affectedLocations.add(menuId);
      }
    }

    // Clean up rendered title bar actions
    const renderedForTool = this._renderedActions.get(toolId);
    if (renderedForTool) {
      for (const elements of renderedForTool.values()) {
        for (const el of elements) {
          el.remove();
        }
      }
      this._renderedActions.delete(toolId);
    }

    this._toolMenuItems.delete(toolId);
    this._onDidRemoveMenus.fire({ toolId });

    for (const loc of affectedLocations) {
      this._onDidChangeMenu.fire(loc);
    }

    console.log(`[MenuContribution] Removed menu items from tool "${toolId}"`);
  }

  // ── Command Palette Integration ──

  /**
   * Check if a command should be visible in the command palette.
   * If a `commandPalette` menu entry has a when clause that evaluates
   * to false, the command should be hidden.
   *
   * Returns true if the command should be shown (default).
   */
  isCommandVisibleInPalette(commandId: string): boolean {
    const paletteItems = this._menuItems.get('commandPalette') ?? [];
    const matching = paletteItems.filter(i => i.commandId === commandId);

    if (matching.length === 0) {
      return true; // No restrictions — visible by default
    }

    // If any matching item's when clause evaluates to true, show it
    for (const item of matching) {
      if (!item.when) {
        return true; // No when clause — always visible
      }
      if (this._contextKeyService) {
        if (this._contextKeyService.contextMatchesRules(item.when)) {
          return true;
        }
      } else {
        return true; // No context service — assume visible
      }
    }

    return false; // All when clauses evaluated to false
  }

  // ── View Title Bar Actions ──

  /**
   * Get the menu items for a view's title bar.
   * Only returns items whose when clause is satisfied.
   */
  getViewTitleActions(_viewId: string): readonly IContributedMenuItem[] {
    const items = this._menuItems.get('view/title') ?? [];

    return items
      .filter(item => {
        // Check when clause
        if (item.when && this._contextKeyService) {
          if (!this._contextKeyService.contextMatchesRules(item.when)) {
            return false;
          }
        }
        return true;
      })
      .sort((a, b) => {
        // Sort by group, then by order within group
        const groupA = a.group ?? '';
        const groupB = b.group ?? '';
        if (groupA !== groupB) return groupA.localeCompare(groupB);
        return (a.order ?? 0) - (b.order ?? 0);
      });
  }

  /**
   * Render action buttons for view/title menu items into a container.
   * Returns a disposable to remove them.
   */
  renderViewTitleActions(viewId: string, container: HTMLElement): IDisposable {
    const actions = this.getViewTitleActions(viewId);
    const elements: HTMLElement[] = [];

    for (const action of actions) {
      const cmd = this._commandService.getCommand(action.commandId);
      if (!cmd) continue;

      const button = $('button');
      button.className = 'view-title-action';
      button.title = cmd.title;
      button.setAttribute('aria-label', cmd.title);

      // Icon or text
      if (cmd.icon) {
        button.textContent = cmd.icon;
      } else {
        // Use first letter of title as fallback
        button.textContent = cmd.title.charAt(0);
      }

      // Styling
      button.classList.add('menu-action-btn');

      button.addEventListener('click', (e) => {
        e.stopPropagation();
        this._commandService.executeCommand(action.commandId).catch(err => {
          console.error(`[MenuContribution] Error executing view title action "${action.commandId}":`, err);
        });
      });

      container.appendChild(button);
      elements.push(button);
    }

    // Track for cleanup
    const toolId = actions[0]?.toolId;
    if (toolId) {
      const toolRendered = this._renderedActions.get(toolId) ?? new Map();
      const existing = toolRendered.get(viewId) ?? [];
      toolRendered.set(viewId, [...existing, ...elements]);
      this._renderedActions.set(toolId, toolRendered);
    }

    return toDisposable(() => {
      for (const el of elements) {
        el.remove();
      }
    });
  }

  // ── View Context Menu ──

  /**
   * Get the context menu items for a view.
   * Only returns items whose when clause is satisfied.
   */
  getViewContextMenuItems(_viewId: string): readonly IContributedMenuItem[] {
    const items = this._menuItems.get('view/context') ?? [];

    return items
      .filter(item => {
        if (item.when && this._contextKeyService) {
          if (!this._contextKeyService.contextMatchesRules(item.when)) {
            return false;
          }
        }
        return true;
      })
      .sort((a, b) => {
        const groupA = a.group ?? '';
        const groupB = b.group ?? '';
        if (groupA !== groupB) return groupA.localeCompare(groupB);
        return (a.order ?? 0) - (b.order ?? 0);
      });
  }

  /**
   * Show a context menu for a view at the given position.
   * Returns a disposable to close it.
   */
  showViewContextMenu(viewId: string, x: number, y: number): IDisposable {
    // Close any existing context menu
    this.dismissContextMenu();

    const items = this.getViewContextMenuItems(viewId);
    if (items.length === 0) {
      return { dispose: () => {} };
    }

    // Create context menu overlay
    const overlay = $('div');
    overlay.className = 'context-menu-overlay';

    const menu = $('div');
    menu.className = 'context-menu';

    let lastGroup: string | undefined;

    for (const item of items) {
      const cmd = this._commandService.getCommand(item.commandId);
      if (!cmd) continue;

      // Add separator between groups
      if (lastGroup !== undefined && item.group !== lastGroup) {
        const sep = $('div');
        sep.className = 'context-menu-separator';
        menu.appendChild(sep);
      }
      lastGroup = item.group;

      const menuItem = $('div');
      menuItem.className = 'context-menu-item';

      const label = $('span');
      if (cmd.category) {
        label.textContent = `${cmd.category}: ${cmd.title}`;
      } else {
        label.textContent = cmd.title;
      }
      menuItem.appendChild(label);

      // Keybinding display
      if (cmd.keybinding) {
        const kbd = $('span');
        kbd.className = 'context-menu-kbd';
        kbd.textContent = cmd.keybinding;
        menuItem.appendChild(kbd);
      }

      menuItem.addEventListener('click', (e) => {
        e.stopPropagation();
        this.dismissContextMenu();
        this._commandService.executeCommand(item.commandId).catch(err => {
          console.error(`[MenuContribution] Error executing context menu item "${item.commandId}":`, err);
        });
      });

      menu.appendChild(menuItem);
    }

    overlay.addEventListener('mousedown', (e) => {
      if (e.target === overlay) {
        this.dismissContextMenu();
      }
    });

    // Escape to close
    const escHandler = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        this.dismissContextMenu();
      }
    };
    document.addEventListener('keydown', escHandler, true);
    this._activeEscHandler = escHandler;

    overlay.appendChild(menu);
    document.body.appendChild(overlay);
    layoutPopup(menu, { x, y });
    this._activeContextMenu = overlay;

    return toDisposable(() => {
      document.removeEventListener('keydown', escHandler, true);
      overlay.remove();
      if (this._activeContextMenu === overlay) {
        this._activeContextMenu = null;
      }
    });
  }

  /**
   * Dismiss the currently active context menu.
   */
  dismissContextMenu(): void {
    if (this._activeEscHandler) {
      document.removeEventListener('keydown', this._activeEscHandler, true);
      this._activeEscHandler = null;
    }
    if (this._activeContextMenu) {
      this._activeContextMenu.remove();
      this._activeContextMenu = null;
    }
  }

  // ── Queries ──

  /**
   * Get all contributed menu items for a location.
   */
  getMenuItems(location: MenuLocationId): readonly IContributedMenuItem[] {
    return this._menuItems.get(location) ?? [];
  }

  /**
   * Get all contributed menu items for a tool.
   */
  getMenuItemsForTool(toolId: string): readonly IContributedMenuItem[] {
    return this._toolMenuItems.get(toolId) ?? [];
  }

  // ── Disposal ──

  override dispose(): void {
    this.dismissContextMenu();
    this._menuItems.clear();
    this._toolMenuItems.clear();

    for (const toolRendered of this._renderedActions.values()) {
      for (const elements of toolRendered.values()) {
        for (const el of elements) {
          el.remove();
        }
      }
    }
    this._renderedActions.clear();

    super.dispose();
  }
}
