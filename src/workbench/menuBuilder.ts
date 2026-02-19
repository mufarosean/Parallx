// menuBuilder.ts — Menu bar registration and manage gear icon
//
// Extracted from workbench.ts (Fix 2.1) to reduce god-object line count.
// Owns:
//   - Default menu bar item registration (File, Edit, View, Go, Tools, Help)
//   - Manage gear icon in activity bar
//   - Manage menu (Settings, Themes, Keyboard Shortcuts, etc.)

import { Disposable } from '../platform/lifecycle.js';
import { ServiceCollection } from '../services/serviceCollection.js';
import { ICommandService, IKeybindingService } from '../services/serviceTypes.js';
import { CommandService } from '../commands/commandRegistry.js';
import { formatKeybindingForDisplay } from '../contributions/keybindingContribution.js';
import { ContextMenu } from '../ui/contextMenu.js';
import { $ } from '../ui/dom.js';
import type { TitlebarPart } from '../parts/titlebarPart.js';
import type { ActivityBarPart } from '../parts/activityBarPart.js';
import type { KeybindingService } from '../services/keybindingService.js';

// ─── Dependencies ────────────────────────────────────────────────────────────

export interface MenuBuilderDeps {
  readonly titlebar: TitlebarPart;
  readonly activityBarPart: ActivityBarPart;
  readonly services: ServiceCollection;
  readonly selectColorTheme: () => void;
}

// ─── Menu Builder ────────────────────────────────────────────────────────────

export class MenuBuilder extends Disposable {
  /** Tracks the currently-open manage menu so we can toggle it. */
  private _manageMenu: ContextMenu | null = null;
  /** Timestamp of the last manage-menu dismiss (defeats mousedown/click race). */
  private _manageMenuDismissedAt = 0;

  private readonly _titlebar: TitlebarPart;
  private readonly _activityBarPart: ActivityBarPart;
  private readonly _services: ServiceCollection;
  private readonly _selectColorTheme: () => void;

  constructor(deps: MenuBuilderDeps) {
    super();
    this._titlebar = deps.titlebar;
    this._activityBarPart = deps.activityBarPart;
    this._services = deps.services;
    this._selectColorTheme = deps.selectColorTheme;
  }

  // ── Keybinding hint helper ─────────────────────────────────────────────

  /**
   * Look up the keybinding for a commandId and return a display-formatted
   * string, or undefined if no keybinding is registered.
   */
  keybindingHint(commandId: string): string | undefined {
    const kbService = this._services.has(IKeybindingService)
      ? (this._services.get(IKeybindingService) as unknown as KeybindingService)
      : undefined;
    if (!kbService) return undefined;
    const raw = kbService.lookupKeybinding(commandId);
    if (!raw) return undefined;
    return formatKeybindingForDisplay(raw);
  }

  // ── Default menu bar items ─────────────────────────────────────────────

  /**
   * Register the default (shell) menu bar items via TitlebarPart's
   * registration API.  These are not hardcoded DOM — they go through
   * the same registration path that tools can use.
   */
  registerDefaultMenuBarItems(): void {
    const defaultMenus = [
      { id: 'file', label: 'File', order: 10 },
      { id: 'edit', label: 'Edit', order: 20 },
      { id: 'selection', label: 'Selection', order: 30 },
      { id: 'view', label: 'View', order: 40 },
      { id: 'go', label: 'Go', order: 50 },
      { id: 'tools', label: 'Tools', order: 60 },
      { id: 'help', label: 'Help', order: 70 },
    ];

    for (const menu of defaultMenus) {
      this._register(this._titlebar.registerMenuBarItem(menu));
    }

    // Register dropdown items for View menu — delegates to structural commands
    this._register(this._titlebar.registerMenuBarDropdownItems('view', [
      { commandId: 'workbench.action.showCommands', title: 'Command Palette…', group: '1_nav', order: 1 },
      { commandId: 'workbench.action.toggleSidebar', title: 'Toggle Sidebar', group: '2_appearance', order: 1 },
      { commandId: 'workbench.action.togglePanel', title: 'Toggle Panel', group: '2_appearance', order: 2 },
      { commandId: 'workbench.action.toggleMaximizedPanel', title: 'Maximize Panel', group: '2_appearance', order: 2.5 },
      { commandId: 'workbench.action.toggleAuxiliaryBar', title: 'Toggle Auxiliary Bar', group: '2_appearance', order: 3 },
      { commandId: 'workbench.action.toggleStatusbarVisibility', title: 'Toggle Status Bar', group: '2_appearance', order: 4 },
      { commandId: 'workbench.action.toggleZenMode', title: 'Zen Mode', group: '2_appearance', order: 5 },
      { commandId: 'editor.toggleWordWrap', title: 'Word Wrap', group: '3_editor', order: 1, when: 'activeEditor' },
    ]));

    // Register dropdown items for File menu
    this._register(this._titlebar.registerMenuBarDropdownItems('file', [
      { commandId: 'file.newTextFile', title: 'New Text File', group: '1_new', order: 1 },
      { commandId: 'file.openFile', title: 'Open File…', group: '2_open', order: 1 },
      { commandId: 'workspace.openFolder', title: 'Open Folder…', group: '2_open', order: 2 },
      { commandId: 'workspace.openRecent', title: 'Open Recent…', group: '2_open', order: 3 },
      { commandId: 'workspace.addFolderToWorkspace', title: 'Add Folder to Workspace…', group: '3_workspace', order: 1 },
      { commandId: 'workspace.saveAs', title: 'Save Workspace As…', group: '3_workspace', order: 2 },
      { commandId: 'workspace.rename', title: 'Rename Workspace…', group: '3_workspace', order: 3 },
      { commandId: 'workspace.duplicateWorkspace', title: 'Duplicate Workspace', group: '3_workspace', order: 4 },
      { commandId: 'file.save', title: 'Save', group: '4_save', order: 1, when: 'activeEditor' },
      { commandId: 'file.saveAs', title: 'Save As…', group: '4_save', order: 2, when: 'activeEditor' },
      { commandId: 'file.saveAll', title: 'Save All', group: '4_save', order: 3, when: 'activeEditor' },
      { commandId: 'file.revert', title: 'Revert File', group: '5_close', order: 1, when: 'activeEditorIsDirty' },
      { commandId: 'workbench.action.closeActiveEditor', title: 'Close Editor', group: '5_close', order: 2, when: 'activeEditor' },
      { commandId: 'workspace.closeFolder', title: 'Close Folder', group: '5_close', order: 3, when: 'workspaceFolderCount > 0' },
      { commandId: 'workspace.closeWindow', title: 'Close Window', group: '5_close', order: 4 },
    ]));

    // Register dropdown items for Edit menu
    this._register(this._titlebar.registerMenuBarDropdownItems('edit', [
      { commandId: 'edit.undo', title: 'Undo', group: '1_undo', order: 1, when: 'activeEditor' },
      { commandId: 'edit.redo', title: 'Redo', group: '1_undo', order: 2, when: 'activeEditor' },
      { commandId: 'edit.cut', title: 'Cut', group: '2_clipboard', order: 1, when: 'activeEditor' },
      { commandId: 'edit.copy', title: 'Copy', group: '2_clipboard', order: 2, when: 'activeEditor' },
      { commandId: 'edit.paste', title: 'Paste', group: '2_clipboard', order: 3, when: 'activeEditor' },
      { commandId: 'edit.find', title: 'Find', group: '3_find', order: 1, when: 'activeEditor' },
      { commandId: 'edit.replace', title: 'Replace', group: '3_find', order: 2, when: 'activeEditor' },
    ]));

    // Register dropdown items for Go menu
    this._register(this._titlebar.registerMenuBarDropdownItems('go', [
      { commandId: 'workbench.action.quickOpen', title: 'Go to File…', group: '1_go', order: 1 },
      { commandId: 'workbench.action.showCommands', title: 'Go to Command…', group: '1_go', order: 2 },
    ]));

    // Register dropdown items for Tools menu
    this._register(this._titlebar.registerMenuBarDropdownItems('tools', [
      { commandId: 'tools.showInstalled', title: 'Tool Gallery', group: '1_tools', order: 1 },
    ]));

    // Register dropdown items for Help menu
    this._register(this._titlebar.registerMenuBarDropdownItems('help', [
      { commandId: 'welcome.openWelcome', title: 'Welcome', group: '1_welcome', order: 1 },
      { commandId: 'workbench.action.showCommands', title: 'Show All Commands', group: '2_commands', order: 1 },
    ]));

    console.log('[MenuBuilder] Default menu bar items registered (%d menus)', defaultMenus.length);
  }

  // ── Manage gear icon ───────────────────────────────────────────────────

  /**
   * Adds a gear icon to the activity bar bottom section that opens a
   * settings/manage menu — mirrors VS Code's "Manage" gear icon.
   */
  addManageGearIcon(): void {
    const bottomSection = this._activityBarPart.contentElement.querySelector('.activity-bar-bottom');
    if (!bottomSection) return;

    const gearBtn = $('button');
    gearBtn.classList.add('activity-bar-item', 'activity-bar-manage-gear');
    gearBtn.dataset.iconId = 'manage-gear';
    gearBtn.title = 'Manage';

    // Use VS Code's codicon gear SVG (16×16 viewBox for proper sizing)
    const iconLabel = $('span');
    iconLabel.classList.add('activity-bar-icon-label');
    iconLabel.innerHTML =
      '<svg width="24" height="24" viewBox="0 0 16 16" xmlns="http://www.w3.org/2000/svg">' +
      '<path fill-rule="evenodd" clip-rule="evenodd" d="M14.54 11.81L13.12 ' +
      '11.03L13.56 10.05L15.18 9.72L15.18 7.28L13.56 6.95L13.12 5.97L14.54 ' +
      '4.19L12.81 2.46L11.03 3.88L10.05 3.44L9.72 1.82L7.28 1.82L6.95 ' +
      '3.44L5.97 3.88L4.19 2.46L2.46 4.19L3.88 5.97L3.44 6.95L1.82 7.28' +
      'L1.82 9.72L3.44 10.05L3.88 11.03L2.46 12.81L4.19 14.54L5.97 13.12' +
      'L6.95 13.56L7.28 15.18L9.72 15.18L10.05 13.56L11.03 13.12L12.81 ' +
      '14.54L14.54 11.81ZM8.5 11C9.88 11 11 9.88 11 8.5C11 7.12 9.88 6 ' +
      '8.5 6C7.12 6 6 7.12 6 8.5C6 9.88 7.12 11 8.5 11Z" fill="currentColor"/></svg>';
    gearBtn.appendChild(iconLabel);

    // Toggle: click opens menu, click again closes it
    gearBtn.addEventListener('click', (e) => {
      e.stopPropagation();
      if (this._manageMenu) {
        // Menu is open — dismiss it
        this._manageMenu.dismiss();
        return;
      }
      // Guard: if the menu was *just* dismissed (by the outside-click mousedown
      // hitting this same button), skip re-opening.
      const MENU_DISMISS_GUARD_MS = 300;
      if (Date.now() - this._manageMenuDismissedAt < MENU_DISMISS_GUARD_MS) {
        return;
      }
      this._showManageMenu(gearBtn);
    });

    bottomSection.appendChild(gearBtn);
  }

  // ── Manage menu ────────────────────────────────────────────────────────

  /**
   * Show the Manage menu anchored above the gear icon (opens upward like VS Code).
   */
  private _showManageMenu(anchor: HTMLElement): void {
    const cmdService = this._services.get(ICommandService) as CommandService;
    const rect = anchor.getBoundingClientRect();

    const items: import('../ui/contextMenu.js').IContextMenuItem[] = [
      {
        id: 'workbench.action.showCommands',
        label: 'Command Palette...',
        keybinding: this.keybindingHint('workbench.action.showCommands'),
        group: '1_commands',
      },
      {
        id: 'manage.profiles',
        label: 'Profiles',
        group: '2_preferences',
        disabled: true,
      },
      {
        id: 'workbench.action.openSettings',
        label: 'Settings',
        keybinding: this.keybindingHint('workbench.action.openSettings'),
        group: '2_preferences',
      },
      {
        id: 'manage.extensions',
        label: 'Extensions',
        keybinding: 'Ctrl+Shift+X',
        group: '2_preferences',
        disabled: true,
      },
      {
        id: 'workbench.action.openKeybindings',
        label: 'Keyboard Shortcuts',
        keybinding: this.keybindingHint('workbench.action.openKeybindings'),
        group: '2_preferences',
      },
      {
        id: 'manage.tasks',
        label: 'Tasks',
        group: '2_preferences',
        disabled: true,
      },
      {
        id: 'manage.themes',
        label: 'Themes',
        group: '3_themes',
        submenu: [
          { id: 'workbench.action.selectTheme', label: 'Color Theme', keybinding: 'Ctrl+T', group: '1_themes' },
          { id: 'workbench.action.selectIconTheme', label: 'File Icon Theme', group: '1_themes', disabled: true },
          { id: 'workbench.action.selectProductIconTheme', label: 'Product Icon Theme', group: '1_themes', disabled: true },
        ],
      },
      {
        id: 'manage.checkUpdates',
        label: 'Check for Updates...',
        group: '4_updates',
        disabled: true,
      },
    ];

    // Anchor above the gear icon (VS Code pattern: menu opens upward)
    const estimatedMenuHeight = items.length * 28 + 24;
    const y = Math.max(8, rect.top - estimatedMenuHeight);

    const ctxMenu = ContextMenu.show({
      items,
      anchor: { x: rect.right + 4, y },
    });

    // Track the menu for toggle behavior
    this._manageMenu = ctxMenu;
    anchor.classList.add('active');
    ctxMenu.onDidDismiss(() => {
      this._manageMenuDismissedAt = Date.now();
      this._manageMenu = null;
      anchor.classList.remove('active');
    });

    ctxMenu.onDidSelect(({ item }) => {
      if (item.disabled) return;

      // Handle theme commands specially
      if (item.id === 'workbench.action.selectTheme') {
        this._selectColorTheme();
        return;
      }

      // Execute via command service for registered commands
      cmdService.executeCommand(item.id).catch(err => {
        console.error(`[MenuBuilder] Manage menu action error:`, err);
      });
    });
  }
}
