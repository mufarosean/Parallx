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
import { IPythonEnvService } from '../services/pythonEnvService.js';
import { StatusBarPart, StatusBarAlignment } from '../parts/statusBarPart.js';
import type { StatusBarEntryAccessor } from '../services/serviceTypes.js';
import { EditorPart } from '../parts/editorPart.js';
import { ContextMenu } from '../ui/contextMenu.js';
import { $ } from '../ui/dom.js';
import { getIcon } from '../ui/iconRegistry.js';
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
  private _workspaceAccessor: StatusBarEntryAccessor | undefined;

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
        commandService.executeCommandFrom('ui', cmdId);
      });
    }

    // Context menu on right-click
    this._register(sb.onDidContextMenu((event) => {
      const entries = sb.getEntries();
      // The hide row's id IS the command id (Phase B menu contract).
      const ctxMenu = ContextMenu.show({
        items: [
          {
            id: 'workbench.action.toggleStatusBar',
            label: 'Hide Status Bar',
            group: '0_visibility',
            keybinding: this._keybindingHint('workbench.action.toggleStatusBar'),
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
        if (e.item.id === 'workbench.action.toggleStatusBar') {
          const commandService = this._services.get(ICommandService);
          if (commandService) {
            void commandService.executeCommandFrom('menu', e.item.id);
          } else {
            this._toggleStatusBar();
          }
        }
      });
    }));

    // Workspace name — moved here from the title bar (which now hosts the
    // command center). Left-aligned, leftmost; click opens Quick Open.
    const folderSvg = '<svg viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.2"><path d="M1.5 3.5h4l1.4 1.6h7.6v7.4a1 1 0 0 1-1 1h-12a1 1 0 0 1-1-1z" stroke-linejoin="round"/></svg>';
    this._workspaceAccessor = sb.addEntry({
      id: 'status.workspace',
      text: this._getWorkspace()?.displayName ?? 'Parallx',
      iconSvg: folderSvg,
      alignment: StatusBarAlignment.Left,
      priority: 1100,
      tooltip: 'Current workspace. Click to search files.',
      command: 'workbench.action.quickOpen',
      name: 'Workspace',
    });

    // Notification Center Badge
    this._setupNotificationBadge(sb);

    // Python environment presence
    this._setupPythonEntry(sb);
  }

  // ── Python environment entry ───────────────────────────────────────────

  /**
   * Ambient presence for the workspace Python environment.
   *
   * Before this, Python existed nowhere outside Settings and the terminal
   * prompt — you could not tell whether a workspace had an environment, or that
   * an install was running, without going looking. The entry shows the steady
   * state ("Python 3.12 · .venv"), switches to the active phase while the
   * bridge streams ("Python · installing…"), and clicks through to Settings.
   *
   * Hidden entirely when Python is off for the workspace: a status bar item
   * for a feature the user declined would be an advertisement, not a status.
   */
  private _setupPythonEntry(sb: StatusBarPart): void {
    if (!this._services.has(IPythonEnvService)) return;
    const python = this._services.get(IPythonEnvService) as IPythonEnvService;
    if (!python.isAvailable) return;

    let accessor: StatusBarEntryAccessor | undefined;

    const show = (text: string, tooltip: string) => {
      if (!accessor) {
        accessor = sb.addEntry({
          id: 'status.python',
          text,
          alignment: StatusBarAlignment.Right,
          priority: 90,
          tooltip,
          command: 'workbench.action.openSettings',
          name: 'Python',
        });
      } else {
        accessor.update({ text, tooltip });
      }
    };
    const hide = () => { accessor?.dispose(); accessor = undefined; };

    const paintSteady = async () => {
      try {
        if (!python.isEnabled) { hide(); return; }
        const status = await python.getStatus();
        if (status.envExists) {
          const version = status.createdWith ?? status.interpreterVersion;
          show(
            version ? `Python ${version} · .venv` : 'Python · .venv',
            'Workspace Python environment. Click to open Settings.',
          );
        } else {
          show('Python · no environment', 'Python is on, but no environment exists yet. Click to set one up in Settings.');
        }
      } catch { hide(); }
    };

    // Phase text while the bridge works, steady text when it settles. Progress
    // chunks arrive far faster than a status repaint is worth, so only the
    // PHASE transition repaints — not every pip line.
    let lastPhase: string | null = null;
    this._register(python.onDidProgress((p) => {
      if (p.phase === lastPhase) return;
      lastPhase = p.phase;
      const verb = p.phase === 'create' ? 'creating environment…'
        : p.phase === 'uninstall' ? 'removing packages…'
          : 'installing…';
      show(`Python · ${verb}`, 'Working. Live output is in the Terminal panel.');
    }));
    this._register(python.onDidChangeStatus(() => {
      lastPhase = null;
      void paintSteady();
    }));

    void paintSteady();
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

      const history = notifService.history;

      // Header — bell + title + live count, and a ghost "Clear all".
      const header = $('div');
      header.className = 'parallx-notification-center-header';

      const titleWrap = $('div');
      titleWrap.className = 'parallx-notification-center-title';
      const titleIcon = $('span');
      titleIcon.className = 'parallx-notification-center-title-icon';
      titleIcon.innerHTML = getIcon('bell');
      titleWrap.appendChild(titleIcon);
      const title = $('span');
      title.textContent = 'Notifications';
      titleWrap.appendChild(title);
      if (history.length > 0) {
        const count = $('span');
        count.className = 'parallx-notification-center-count';
        count.textContent = String(history.length);
        titleWrap.appendChild(count);
      }
      header.appendChild(titleWrap);

      if (history.length > 0) {
        const clearBtn = $('button');
        clearBtn.className = 'parallx-notification-center-clear';
        clearBtn.textContent = 'Clear all';
        clearBtn.title = 'Clear all notifications';
        clearBtn.addEventListener('click', () => {
          notifService.dismissAll();
          notifService.clearHistory();
          hideCenter();
        });
        header.appendChild(clearBtn);
      }
      panel.appendChild(header);

      // List
      const list = $('div');
      list.className = 'parallx-notification-center-list';

      if (history.length === 0) {
        const empty = $('div');
        empty.className = 'parallx-notification-center-empty';
        const emptyIcon = $('span');
        emptyIcon.className = 'parallx-notification-center-empty-icon';
        emptyIcon.innerHTML = getIcon('check-circle');
        empty.appendChild(emptyIcon);
        const emptyText = $('span');
        emptyText.className = 'parallx-notification-center-empty-text';
        emptyText.textContent = "You're all caught up";
        empty.appendChild(emptyText);
        const emptySub = $('span');
        emptySub.className = 'parallx-notification-center-empty-sub';
        emptySub.textContent = 'No notifications right now';
        empty.appendChild(emptySub);
        list.appendChild(empty);
      } else {
        for (const notif of history) {
          const row = $('div');
          row.className = `parallx-notification-center-item parallx-notification-center-item-${notif.severity}`;

          const icon = $('span');
          icon.className = `parallx-notification-center-icon parallx-notification-center-icon-${notif.severity}`;
          icon.innerHTML = getIcon(
            notif.severity === 'information' ? 'info'
              : notif.severity === 'warning' ? 'triangle-alert'
                : 'octagon-alert',
          );
          row.appendChild(icon);

          const body = $('div');
          body.className = 'parallx-notification-center-body';
          const msg = $('span');
          msg.className = 'parallx-notification-center-message';
          msg.textContent = notif.message;
          body.appendChild(msg);

          if (notif.source) {
            const src = $('span');
            src.className = 'parallx-notification-center-source';
            src.textContent = notif.source;
            body.appendChild(src);
          }
          row.appendChild(body);

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
        aiInvocable: true,
        aiDescription: 'Show or hide the notification center.',
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
      // Keep the status-bar workspace entry in sync with renames/switches.
      this._workspaceAccessor?.update({ text: workspace.displayName });
    }

    parts.push('Parallx');
    document.title = parts.join(' · ');

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
