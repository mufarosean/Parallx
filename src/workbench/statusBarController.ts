// statusBarController.ts — Status bar setup, editor tracking, and notification center
//
// Extracted from workbench.ts (Fix 2.1) to reduce god-object line count.
// Owns:
//   - Right-aligned editor language indicator
//   - Extension → language display name mapping
//   - Notification center bell badge + overlay
//   - Window title updates

import { Disposable } from '../platform/lifecycle.js';
import { URI } from '../platform/uri.js';
import { ServiceCollection } from '../services/serviceCollection.js';
import { ICommandService, INotificationService } from '../services/serviceTypes.js';
import { StatusBarPart, StatusBarAlignment } from '../parts/statusBarPart.js';
import { EditorPart } from '../parts/editorPart.js';
import { ContextMenu } from '../ui/contextMenu.js';
import { $ } from '../ui/dom.js';
import type { IEditorInput } from '../editor/editorInput.js';
import type { Workspace } from '../workspace/workspace.js';
import type { WorkbenchContextManager } from '../context/workbenchContext.js';

// ─── Dependencies ────────────────────────────────────────────────────────────

export interface StatusBarControllerDeps {
  readonly statusBar: StatusBarPart;
  readonly editorPart: EditorPart;
  readonly services: ServiceCollection;
  readonly container: HTMLElement;
  readonly keybindingHint: (commandId: string) => string | undefined;
  readonly toggleStatusBar: () => void;
  readonly getWorkspace: () => Workspace;
  readonly getWorkbenchContext: () => WorkbenchContextManager | undefined;
}

// ─── Status Bar Controller ───────────────────────────────────────────────────

export class StatusBarController extends Disposable {
  private readonly _statusBar: StatusBarPart;
  private readonly _services: ServiceCollection;
  private readonly _container: HTMLElement;
  private readonly _keybindingHint: (commandId: string) => string | undefined;
  private readonly _toggleStatusBar: () => void;
  private readonly _getWorkspace: () => Workspace;
  private readonly _getWorkbenchContext: () => WorkbenchContextManager | undefined;

  constructor(deps: StatusBarControllerDeps) {
    super();
    this._statusBar = deps.statusBar;
    this._services = deps.services;
    this._container = deps.container;
    this._keybindingHint = deps.keybindingHint;
    this._toggleStatusBar = deps.toggleStatusBar;
    this._getWorkspace = deps.getWorkspace;
    this._getWorkbenchContext = deps.getWorkbenchContext;
  }

  // ── Setup ──────────────────────────────────────────────────────────────

  setupStatusBar(): void {
    const sb = this._statusBar;

    // Wire command executor so entry clicks execute commands via CommandService
    const commandService = this._services.get(ICommandService);
    if (commandService) {
      sb.setCommandExecutor((cmdId: string) => {
        commandService.executeCommand(cmdId);
      });
    }

    // Context menu on right-click
    this._register(sb.onDidContextMenu((event) => {
      const entries = sb.getEntries();
      const ctxMenu = ContextMenu.show({
        items: [
          {
            id: 'hideStatusBar',
            label: 'Hide Status Bar',
            group: '0_visibility',
            keybinding: this._keybindingHint('workbench.action.toggleStatusbarVisibility'),
          },
          ...entries.map((e) => ({
            id: e.id,
            label: e.name || e.text,
            group: '1_entries',
          })),
        ],
        anchor: { x: event.x, y: event.y },
      });
      ctxMenu.onDidSelect((e) => {
        if (e.item.id === 'hideStatusBar') {
          this._toggleStatusBar();
        }
      });
    }));

    // Notification Center Badge
    this._setupNotificationBadge(sb);
  }

  // ── Notification badge + center ────────────────────────────────────────

  private _setupNotificationBadge(sb: StatusBarPart): void {
    const notifService = this._services.has(INotificationService)
      ? this._services.get(INotificationService) as import('../api/notificationService.js').NotificationService
      : undefined;
    if (!notifService) return;

    const bellSvg = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M18 8A6 6 0 0 0 6 8c0 7-3 9-3 9h18s-3-2-3-9"/><path d="M13.73 21a2 2 0 0 1-3.46 0"/></svg>';

    const bellAccessor = sb.addEntry({
      id: 'status.notifications',
      text: '',
      iconSvg: bellSvg,
      alignment: StatusBarAlignment.Left,
      priority: 1000,
      tooltip: 'No new notifications',
      command: 'workbench.action.toggleNotificationCenter',
      name: 'Notifications',
    });

    const updateBadge = (count: number) => {
      bellAccessor.update({
        text: count > 0 ? `${count}` : '',
        tooltip: count > 0 ? `${count} notification${count > 1 ? 's' : ''}` : 'No new notifications',
      });
    };
    this._register(notifService.onDidChangeCount(updateBadge));

    // Notification center overlay state
    let centerOverlay: HTMLElement | null = null;
    let centerKeyHandler: ((e: KeyboardEvent) => void) | null = null;
    const hideCenter = () => {
      if (centerKeyHandler) {
        document.removeEventListener('keydown', centerKeyHandler);
        centerKeyHandler = null;
      }
      if (centerOverlay) {
        centerOverlay.remove();
        centerOverlay = null;
      }
    };

    const container = this._container;
    const showCenter = () => {
      if (centerOverlay) { hideCenter(); return; }

      const overlay = $('div');
      overlay.className = 'parallx-notification-center-overlay';
      overlay.addEventListener('mousedown', (e) => {
        if (e.target === overlay) hideCenter();
      });

      const panel = $('div');
      panel.className = 'parallx-notification-center';

      // Header
      const header = $('div');
      header.className = 'parallx-notification-center-header';
      const title = $('span');
      title.textContent = 'Notifications';
      header.appendChild(title);

      const clearBtn = $('button');
      clearBtn.className = 'parallx-notification-center-clear';
      clearBtn.textContent = 'Clear All';
      clearBtn.title = 'Clear all notifications';
      clearBtn.addEventListener('click', () => {
        notifService.dismissAll();
        notifService.clearHistory();
        hideCenter();
      });
      header.appendChild(clearBtn);
      panel.appendChild(header);

      // List
      const list = $('div');
      list.className = 'parallx-notification-center-list';

      const history = notifService.history;
      if (history.length === 0) {
        const empty = $('div');
        empty.className = 'parallx-notification-center-empty';
        empty.textContent = 'No notifications';
        list.appendChild(empty);
      } else {
        for (const notif of history) {
          const row = $('div');
          row.className = `parallx-notification-center-item parallx-notification-center-item-${notif.severity}`;

          const icon = $('span');
          icon.className = 'parallx-notification-center-icon';
          icon.textContent = notif.severity === 'information' ? 'ℹ' : notif.severity === 'warning' ? '⚠' : '✕';
          row.appendChild(icon);

          const msg = $('span');
          msg.className = 'parallx-notification-center-message';
          msg.textContent = notif.message;
          row.appendChild(msg);

          if (notif.source) {
            const src = $('span');
            src.className = 'parallx-notification-center-source';
            src.textContent = notif.source;
            row.appendChild(src);
          }

          list.appendChild(row);
        }
      }
      panel.appendChild(list);

      overlay.appendChild(panel);
      container.appendChild(overlay);
      centerOverlay = overlay;

      // Close on Escape
      centerKeyHandler = (e: KeyboardEvent) => {
        if (e.key === 'Escape') {
          hideCenter();
        }
      };
      document.addEventListener('keydown', centerKeyHandler);
    };

    // Register the toggle command
    const commandService = this._services.get(ICommandService);
    if (commandService?.registerCommand) {
      commandService.registerCommand({
        id: 'workbench.action.toggleNotificationCenter',
        title: 'Toggle Notification Center',
        handler: () => showCenter(),
      });
    }
  }

  // ── Window title ───────────────────────────────────────────────────────

  updateWindowTitle(editor?: IEditorInput): void {
    const parts: string[] = [];

    if (editor) {
      parts.push(editor.isDirty ? `● ${editor.name}` : editor.name);
    }

    const workspace = this._getWorkspace();
    if (workspace) {
      parts.push(workspace.displayName);
    }

    parts.push('Parallx');
    document.title = parts.join(' — ');

    // Update resource context keys from active editor
    const wbCtx = this._getWorkbenchContext();
    if (wbCtx && editor) {
      const editorUri = editor.uri?.toString();
      if (editorUri) {
        try {
          const uri = URI.parse(editorUri);
          wbCtx.setResourceScheme(uri.scheme);
          wbCtx.setResourceExtname(uri.extname);
          wbCtx.setResourceFilename(uri.basename);
        } catch {
          wbCtx.setResourceScheme('');
          wbCtx.setResourceExtname('');
          wbCtx.setResourceFilename('');
        }
      } else {
        wbCtx.setResourceScheme('');
        wbCtx.setResourceExtname('');
        wbCtx.setResourceFilename('');
      }
    } else if (wbCtx) {
      wbCtx.setResourceScheme('');
      wbCtx.setResourceExtname('');
      wbCtx.setResourceFilename('');
    }
  }
}
