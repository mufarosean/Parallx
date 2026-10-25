// statusBarController.ts — Status bar setup, editor tracking, and notification center
//
// Extracted from workbench.ts (Fix 2.1) to reduce god-object line count.
// Owns:
//   - Right-aligned editor language indicator
//   - Extension → language display name mapping
//   - The notification center (its bell is in the activity bar)
//   - Window title updates

import { Disposable } from '../platform/lifecycle.js';
import { URI } from '../platform/uri.js';
import { ServiceCollection } from '../services/serviceCollection.js';
import { ICommandService, INotificationService } from '../services/serviceTypes.js';
import { IToolRegistryService } from '../services/types/tools.js';
import { NotificationCenter } from './notificationCenter.js';
import { IPythonEnvService } from '../services/pythonEnvService.js';
import { StatusBarPart, StatusBarAlignment } from '../parts/statusBarPart.js';
import type { StatusBarEntryAccessor } from '../services/serviceTypes.js';
import { EditorPart } from '../parts/editorPart.js';
import { ContextMenu } from '../ui/contextMenu.js';
import type { IEditorInput } from '../editor/editorInput.js';
import type { Workspace } from '../workspace/workspace.js';
import type { WorkbenchContextManager } from '../context/workbenchContext.js';

// ─── Dependencies ────────────────────────────────────────────────────────────

export interface StatusBarControllerDeps {
  readonly statusBar: StatusBarPart;
  readonly editorPart: EditorPart;
  readonly services: ServiceCollection;
  readonly keybindingHint: (commandId: string) => string | undefined;
  readonly toggleStatusBar: () => void;
  readonly getWorkspace: () => Workspace;
  readonly getWorkbenchContext: () => WorkbenchContextManager | undefined;
}

// ─── Status Bar Controller ───────────────────────────────────────────────────

export class StatusBarController extends Disposable {
  private readonly _statusBar: StatusBarPart;
  private readonly _services: ServiceCollection;
  private readonly _keybindingHint: (commandId: string) => string | undefined;
  private readonly _toggleStatusBar: () => void;
  private readonly _getWorkspace: () => Workspace;
  private readonly _getWorkbenchContext: () => WorkbenchContextManager | undefined;
  private _workspaceAccessor: StatusBarEntryAccessor | undefined;

  constructor(deps: StatusBarControllerDeps) {
    super();
    this._statusBar = deps.statusBar;
    this._services = deps.services;
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

    // Notifications open from the activity bar's bell (menuBuilder).
    this._setupNotificationCenter();

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

  // ── Notification center ────────────────────────────────────────────────

  private _notificationCenter: NotificationCenter | undefined;
  /** The notifications panel, opened from the activity bar's bell. */
  get notificationCenter(): NotificationCenter | undefined { return this._notificationCenter; }

  private _setupNotificationCenter(): void {
    const notifService = this._services.has(INotificationService)
      ? this._services.get(INotificationService) as import('../api/notificationService.js').NotificationService
      : undefined;
    if (!notifService) return;
    const tools = this._services.has(IToolRegistryService) ? this._services.get(IToolRegistryService) : undefined;
    const center = this._register(new NotificationCenter(notifService, (id) => tools?.getById(id)?.description.manifest.name));
    this._notificationCenter = center;
    this._services.get(ICommandService)?.registerCommand?.({
      id: 'workbench.action.toggleNotificationCenter',
      title: 'Toggle Notification Center',
      aiInvocable: true,
      aiDescription: 'Show or hide the notification center.',
      handler: () => center.toggle(document.querySelector<HTMLElement>('[data-icon-id="notifications"]')),
    });
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
