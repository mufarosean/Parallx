// menuBuilder.ts — Menu bar registration and manage gear icon
//
// Extracted from workbench.ts (Fix 2.1) to reduce god-object line count.
// Owns:
//   - Default menu bar item registration (File, Edit, View, Go, Tools, Help)
//   - The bell in the title bar

import { Disposable, type IDisposable } from '../platform/lifecycle.js';
import { ServiceCollection } from '../services/serviceCollection.js';
import { IKeybindingService } from '../services/serviceTypes.js';
import { formatKeybindingForDisplay } from '../services/keybindingUtils.js';
import { declareControl } from '../ui/kit.js';
import { $ } from '../ui/dom.js';
import type { TitlebarPart } from '../parts/titlebarPart.js';
import type { NotificationCenter } from './notificationCenter.js';
import type { KeybindingService } from '../services/keybindingService.js';
import { getIcon, hasIcon } from '../ui/iconRegistry.js';

/** The parts of a tool's manifest that name its icon. */
export interface ToolIconSource {
  readonly viewContainers?: readonly { readonly icon?: string }[];
  readonly views?: readonly { readonly icon?: string }[];
}

/**
 * The icon a running tool's entry takes in the Tools menu: the one its own
 * sidebar row shows (its container's, else its view's), else the mark for
 * any tool.
 */
export function toolMenuIcon(contributes: ToolIconSource | undefined): string {
  const ids = [...(contributes?.viewContainers ?? []), ...(contributes?.views ?? [])].map((v) => v.icon);
  return ids.find((id): id is string => !!id && hasIcon(id)) ?? 'puzzle';
}

// ─── Dependencies ────────────────────────────────────────────────────────────

export interface MenuBuilderDeps {
  readonly titlebar: TitlebarPart;
  readonly services: ServiceCollection;
}

// ─── Menu Builder ────────────────────────────────────────────────────────────

export class MenuBuilder extends Disposable {
  private readonly _titlebar: TitlebarPart;
  private readonly _services: ServiceCollection;

  constructor(deps: MenuBuilderDeps) {
    super();
    this._titlebar = deps.titlebar;
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
      { commandId: 'workbench.action.showCommands', title: 'Command Palette…', icon: 'search', group: '1_nav', order: 1 },
      { commandId: 'settings.open', title: 'Settings', icon: 'settings', group: '1_settings', order: 1 },
      { commandId: 'tools.showInstalled', title: 'Tools and Extensions', icon: 'blocks', group: '1_settings', order: 1.5 },
      { commandId: 'workbench.action.openKeybindings', title: 'Keyboard Shortcuts', icon: 'keyboard', group: '1_settings', order: 2 },
      { commandId: 'settings.openAppearance', title: 'Appearance…', icon: 'palette', group: '1_settings', order: 3 },
      // Same names as the commands and the title-bar buttons: the toggles act
      // on screen AREAS (parts are movable), see viewCommands.ts.
      { commandId: 'workbench.action.toggleSidebar', title: 'Toggle Left Area', icon: 'panel-left', group: '2_appearance', order: 1 },
      { commandId: 'workbench.action.togglePanel', title: 'Toggle Bottom Area', icon: 'panel-bottom', group: '2_appearance', order: 2 },
      { commandId: 'workbench.action.toggleMaximizedPanel', title: 'Maximize Bottom Area', icon: 'maximize-2', group: '2_appearance', order: 2.5 },
      { commandId: 'workbench.action.toggleAuxiliaryBar', title: 'Toggle Right Area', icon: 'panel-right', group: '2_appearance', order: 3 },
      { commandId: 'workbench.action.toggleStatusbarVisibility', title: 'Toggle Status Bar', icon: 'rectangle-horizontal', group: '2_appearance', order: 4 },
      { commandId: 'workbench.action.toggleZenMode', title: 'Zen Mode', icon: 'focus', group: '2_appearance', order: 5 },
      { commandId: 'workbench.action.increaseTextSize', title: 'Increase Text Size', icon: 'a-arrow-up', group: '2_textsize', order: 1 },
      { commandId: 'workbench.action.decreaseTextSize', title: 'Decrease Text Size', icon: 'a-arrow-down', group: '2_textsize', order: 2 },
      { commandId: 'workbench.action.resetTextSize', title: 'Reset Text Size', icon: 'rotate-ccw', group: '2_textsize', order: 3 },
      { commandId: 'editor.toggleWordWrap', title: 'Word Wrap', icon: 'wrap-text', group: '3_editor', order: 1, when: 'activeEditor' },
    ]));

    // Register dropdown items for File menu
    this._register(this._titlebar.registerMenuBarDropdownItems('file', [
      // A page is the app's own document, so it leads; a text file is second.
      // Its Ctrl+N only applies with the pages sidebar focused; the global
      // Ctrl+N is New Text File, so no hint here rather than a wrong one.
      { commandId: 'canvas.newPage', title: 'New Page', icon: 'file-plus', group: '1_new', order: 0, keybinding: '' },
      { commandId: 'file.newTextFile', title: 'New Text File', icon: 'file-text', group: '1_new', order: 1 },
      { commandId: 'workbench.action.quickOpen', title: 'Go to File…', icon: 'search', group: '2_open', order: 0 },
      { commandId: 'file.openFile', title: 'Open File…', icon: 'file', group: '2_open', order: 1 },
      { commandId: 'workspace.openFolder', title: 'Open Folder…', icon: 'folder-open', group: '2_open', order: 2 },
      { commandId: 'workspace.openRecent', title: 'Open Recent…', icon: 'history', group: '2_open', order: 3 },
      { commandId: 'workspace.addFolderToWorkspace', title: 'Add Folder to Workspace…', icon: 'folder-plus', group: '3_workspace', order: 1 },
      { commandId: 'workspace.saveAs', title: 'Save Workspace As…', icon: 'folder-pen', group: '3_workspace', order: 2 },
      { commandId: 'workspace.rename', title: 'Rename Workspace…', icon: 'pencil', group: '3_workspace', order: 3 },
      { commandId: 'workspace.duplicateWorkspace', title: 'Duplicate Workspace', icon: 'copy', group: '3_workspace', order: 4 },
      { commandId: 'file.save', title: 'Save', icon: 'save', group: '4_save', order: 1, when: 'activeEditor' },
      { commandId: 'file.saveAs', title: 'Save As…', icon: 'file-pen', group: '4_save', order: 2, when: 'activeEditor' },
      { commandId: 'file.saveAll', title: 'Save All', icon: 'save-all', group: '4_save', order: 3, when: 'activeEditor' },
      { commandId: 'file.revert', title: 'Revert File', icon: 'rotate-ccw', group: '5_close', order: 1, when: 'activeEditorIsDirty' },
      { commandId: 'workbench.action.closeActiveEditor', title: 'Close Editor', icon: 'x', group: '5_close', order: 2, when: 'activeEditor' },
      { commandId: 'workspace.closeFolder', title: 'Close Folder', icon: 'folder-x', group: '5_close', order: 3, when: 'workspaceFolderCount > 0' },
      { commandId: 'workspace.closeWindow', title: 'Close Window', icon: 'square-x', group: '5_close', order: 4 },
    ]));

    // Register dropdown items for Edit menu
    this._register(this._titlebar.registerMenuBarDropdownItems('edit', [
      { commandId: 'edit.undo', title: 'Undo', icon: 'undo-2', group: '1_undo', order: 1, when: 'activeEditor' },
      { commandId: 'edit.redo', title: 'Redo', icon: 'redo-2', group: '1_undo', order: 2, when: 'activeEditor' },
      { commandId: 'edit.cut', title: 'Cut', icon: 'scissors', group: '2_clipboard', order: 1, when: 'activeEditor' },
      { commandId: 'edit.copy', title: 'Copy', icon: 'copy', group: '2_clipboard', order: 2, when: 'activeEditor' },
      { commandId: 'edit.paste', title: 'Paste', icon: 'clipboard', group: '2_clipboard', order: 3, when: 'activeEditor' },
      { commandId: 'edit.find', title: 'Find', icon: 'search', group: '3_find', order: 1, when: 'activeEditor' },
      { commandId: 'edit.replace', title: 'Replace', icon: 'replace', group: '3_find', order: 2, when: 'activeEditor' },
    ]));

    // Register dropdown items for Tools menu
    this._register(this._titlebar.registerMenuBarDropdownItems('tools', [
      // A launcher for the tools, then the place to manage them. Optional
      // tools add themselves while they run (contributes.menus
      // "menubar/tools", setToolsMenuItems): none is listed here.
      { commandId: 'dashboard.open', title: 'Dashboard', icon: 'layout-dashboard', group: '1_open', order: 0 },
      { commandId: 'tools.showInstalled', title: 'Tools and Extensions', icon: 'blocks', group: '9_manage', order: 1 },
    ]));

    // Register dropdown items for Help menu
    this._register(this._titlebar.registerMenuBarDropdownItems('help', [
      { commandId: 'welcome.openWelcome', title: 'Welcome', icon: 'home', group: '1_welcome', order: 1 },
      { commandId: 'workbench.action.showCommands', title: 'Command Palette…', icon: 'search', group: '2_commands', order: 1 },
      { commandId: 'workbench.action.openKeybindings', title: 'Keyboard Shortcuts', icon: 'keyboard', group: '2_commands', order: 2 },
      // Versions, tools on, the model and recent errors, scrubbed of paths and keys.
      { commandId: 'workbench.action.copyDiagnostics', title: 'Copy Diagnostics', icon: 'clipboard-list', group: '3_report', order: 1 },
    ]));

    console.log('[MenuBuilder] Default menu bar items registered (%d menus)', defaultMenus.length);
  }

  /** The Tools menu entries running tools contributed; replaces the last set. */
  setToolsMenuItems(items: readonly { commandId: string; title?: string; manifest?: { readonly name: string; readonly contributes?: ToolIconSource } }[]): void {
    this._toolsMenuItems?.dispose();
    const named = items.map((it) => ({ commandId: it.commandId, title: it.title ?? it.manifest?.name ?? it.commandId, icon: toolMenuIcon(it.manifest?.contributes) }));
    named.sort((a, b) => a.title.localeCompare(b.title));
    this._toolsMenuItems = this._titlebar.registerMenuBarDropdownItems('tools',
      named.map((it, i) => ({ ...it, group: '1_open', order: i + 1 })));
  }
  private _toolsMenuItems: IDisposable | undefined;

  // ── Notifications bell ─────────────────────────────────────────────────

  /**
   * The bell in the title bar, after the three area buttons: it opens the
   * notifications panel under it, and its badge counts what arrived since
   * it was last opened. (It keeps the scene id it had on the old icon rail,
   * so everything that finds it still does.)
   */
  addNotificationsButton(center: NotificationCenter): void {
    const bell = $('button');
    bell.type = 'button';
    bell.classList.add('titlebar-layout-btn', 'titlebar-bell', 'activity-bar-notifications');
    bell.dataset.iconId = 'notifications';
    bell.title = 'Notifications';
    bell.innerHTML = getIcon('bell');
    const badge = $('span');
    badge.className = 'titlebar-bell-badge badge-hidden';
    badge.setAttribute('aria-hidden', 'true');
    bell.appendChild(badge);
    this._register(declareControl(bell, { id: 'activitybar.notifications', label: 'Notifications', kind: 'iconButton', hint: 'Opens what the app and your tools have told you.', command: 'workbench.action.toggleNotificationCenter' }));

    const paint = (unread: number): void => {
      badge.classList.toggle('badge-hidden', unread === 0);
      badge.textContent = unread > 99 ? '99+' : String(unread);
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

    // The title bar's right slot can be built after this runs: wait for it,
    // then sit just left of the window's own buttons, after the area buttons.
    const seat = (attempt = 0): void => {
      const slot = this._titlebar.rightSlot;
      if (!slot) {
        if (attempt < 60) requestAnimationFrame(() => seat(attempt + 1));
        return;
      }
      slot.insertBefore(bell, slot.querySelector('.window-controls'));
    };
    seat();
  }
}
