// menuBuilder.ts — Menu bar registration and manage gear icon
//
// Extracted from workbench.ts (Fix 2.1) to reduce god-object line count.
// Owns:
//   - Default menu bar item registration (File, Edit, View, Go, Tools, Help)
//   - Manage gear icon in activity bar
//   - Manage menu (Settings, Themes, Keyboard Shortcuts, etc.)

import { Disposable, type IDisposable } from '../platform/lifecycle.js';
import { ServiceCollection } from '../services/serviceCollection.js';
import { IKeybindingService } from '../services/serviceTypes.js';
import { formatKeybindingForDisplay } from '../services/keybindingUtils.js';
import { declareControl } from '../ui/kit.js';
import { $ } from '../ui/dom.js';
import type { TitlebarPart } from '../parts/titlebarPart.js';
import type { ActivityBarPart } from '../parts/activityBarPart.js';
import type { NotificationCenter } from './notificationCenter.js';
import type { KeybindingService } from '../services/keybindingService.js';
import { getIcon } from '../ui/iconRegistry.js';

// ─── Dependencies ────────────────────────────────────────────────────────────

export interface MenuBuilderDeps {
  readonly titlebar: TitlebarPart;
  readonly activityBarPart: ActivityBarPart;
  readonly services: ServiceCollection;
}

// ─── Menu Builder ────────────────────────────────────────────────────────────

export class MenuBuilder extends Disposable {
  private readonly _titlebar: TitlebarPart;
  private readonly _activityBarPart: ActivityBarPart;
  private readonly _services: ServiceCollection;

  constructor(deps: MenuBuilderDeps) {
    super();
    this._titlebar = deps.titlebar;
    this._activityBarPart = deps.activityBarPart;
    this._services = deps.services;
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
      // Selection and Go were code-editor menus: Selection had no items at
      // all and Go repeated the command palette. Their one useful entry
      // (Go to File…) lives in File.
      { id: 'file', label: 'File', order: 10 },
      { id: 'edit', label: 'Edit', order: 20 },
      { id: 'view', label: 'View', order: 40 },
      { id: 'tools', label: 'Tools', order: 60 },
      { id: 'help', label: 'Help', order: 70 },
    ];

    for (const menu of defaultMenus) {
      this._register(this._titlebar.registerMenuBarItem(menu));
    }

    // Register dropdown items for View menu — delegates to structural commands
    this._register(this._titlebar.registerMenuBarDropdownItems('view', [
      { commandId: 'workbench.action.showCommands', title: 'Command Palette…', group: '1_nav', order: 1 },
      { commandId: 'settings.open', title: 'Settings', group: '1_settings', order: 1 },
      { commandId: 'workbench.action.openKeybindings', title: 'Keyboard Shortcuts', group: '1_settings', order: 2 },
      { commandId: 'settings.openAppearance', title: 'Appearance…', group: '1_settings', order: 3 },
      // Same names as the commands and the title-bar buttons: the toggles act
      // on screen AREAS (parts are movable), see viewCommands.ts.
      { commandId: 'workbench.action.toggleSidebar', title: 'Toggle Left Area', group: '2_appearance', order: 1 },
      { commandId: 'workbench.action.togglePanel', title: 'Toggle Bottom Area', group: '2_appearance', order: 2 },
      { commandId: 'workbench.action.toggleMaximizedPanel', title: 'Maximize Bottom Area', group: '2_appearance', order: 2.5 },
      { commandId: 'workbench.action.toggleAuxiliaryBar', title: 'Toggle Right Area', group: '2_appearance', order: 3 },
      { commandId: 'workbench.action.toggleStatusbarVisibility', title: 'Toggle Status Bar', group: '2_appearance', order: 4 },
      { commandId: 'workbench.action.toggleZenMode', title: 'Zen Mode', group: '2_appearance', order: 5 },
      { commandId: 'workbench.action.increaseTextSize', title: 'Increase Text Size', group: '2_textsize', order: 1 },
      { commandId: 'workbench.action.decreaseTextSize', title: 'Decrease Text Size', group: '2_textsize', order: 2 },
      { commandId: 'workbench.action.resetTextSize', title: 'Reset Text Size', group: '2_textsize', order: 3 },
      { commandId: 'editor.toggleWordWrap', title: 'Word Wrap', group: '3_editor', order: 1, when: 'activeEditor' },
    ]));

    // Register dropdown items for File menu
    this._register(this._titlebar.registerMenuBarDropdownItems('file', [
      // A page is the app's own document, so it leads; a text file is second.
      // Its Ctrl+N only applies with the pages sidebar focused; the global
      // Ctrl+N is New Text File, so no hint here rather than a wrong one.
      { commandId: 'canvas.newPage', title: 'New Page', group: '1_new', order: 0, keybinding: '' },
      { commandId: 'file.newTextFile', title: 'New Text File', group: '1_new', order: 1 },
      { commandId: 'workbench.action.quickOpen', title: 'Go to File…', group: '2_open', order: 0 },
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

    // Register dropdown items for Tools menu
    this._register(this._titlebar.registerMenuBarDropdownItems('tools', [
      // A launcher for the tools, then the place to manage them. Optional
      // tools add themselves while they run (contributes.menus
      // "menubar/tools", setToolsMenuItems): none is listed here.
      { commandId: 'dashboard.open', title: 'Dashboard', group: '1_open', order: 0 },
      { commandId: 'tools.showInstalled', title: 'Manage Tools…', group: '9_manage', order: 1 },
    ]));

    // Register dropdown items for Help menu
    this._register(this._titlebar.registerMenuBarDropdownItems('help', [
      { commandId: 'welcome.openWelcome', title: 'Welcome', group: '1_welcome', order: 1 },
      { commandId: 'workbench.action.showCommands', title: 'Command Palette…', group: '2_commands', order: 1 },
      { commandId: 'workbench.action.openKeybindings', title: 'Keyboard Shortcuts', group: '2_commands', order: 2 },
    ]));

    console.log('[MenuBuilder] Default menu bar items registered (%d menus)', defaultMenus.length);
  }

  /** The Tools menu entries running tools contributed; replaces the last set. */
  setToolsMenuItems(items: readonly { commandId: string; title: string }[]): void {
    this._toolsMenuItems?.dispose();
    const sorted = [...items].sort((a, b) => a.title.localeCompare(b.title));
    this._toolsMenuItems = this._titlebar.registerMenuBarDropdownItems('tools',
      sorted.map((it, i) => ({ commandId: it.commandId, title: it.title, group: '1_open', order: i + 1 })));
  }
  private _toolsMenuItems: IDisposable | undefined;

  // ── Notifications bell ─────────────────────────────────────────────────

  /**
   * The bell at the foot of the activity bar: it opens the notifications
   * panel beside it, and its badge counts what arrived since it was last
   * opened. (Settings and Keyboard Shortcuts are in the View menu.)
   */
  addNotificationsButton(center: NotificationCenter): void {
    const bottomSection = this._activityBarPart.contentElement.querySelector('.activity-bar-bottom');
    if (!bottomSection) return;

    const bell = $('button');
    bell.classList.add('activity-bar-item', 'activity-bar-notifications');
    bell.dataset.iconId = 'notifications';
    bell.title = 'Notifications';
    const iconLabel = $('span');
    iconLabel.classList.add('activity-bar-icon-label');
    iconLabel.innerHTML = getIcon('bell');
    const badge = $('span');
    badge.className = 'activity-bar-badge activity-bar-badge--count badge-hidden';
    const badgeContent = $('span');
    badgeContent.className = 'activity-bar-badge-content';
    badge.appendChild(badgeContent);
    bell.append(iconLabel, badge);
    declareControl(bell, { id: 'activitybar.notifications', label: 'Notifications', kind: 'iconButton', hint: 'Opens what the app and your tools have told you.', command: 'workbench.action.toggleNotificationCenter' });

    const paint = (unread: number): void => {
      badge.classList.toggle('badge-hidden', unread === 0);
      badgeContent.textContent = unread > 99 ? '99+' : String(unread);
      const name = unread ? `Notifications, ${unread} new` : 'Notifications';
      bell.setAttribute('aria-label', name);
      bell.title = name;
    };
    this._register(center.onDidChangeUnread(paint));
    paint(center.unread);

    // The bell is part of the open panel for its outside-press check, so a
    // second press reaches here and closes it.
    bell.addEventListener('click', (e) => {
      e.stopPropagation();
      center.toggle(bell);
    });

    bottomSection.appendChild(bell);
  }
}
