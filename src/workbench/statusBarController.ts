// statusBarController.ts — Status bar setup, editor tracking, and notification center
//
// Extracted from workbench.ts (Fix 2.1) to reduce god-object line count.
// Owns:
//   - Right-aligned editor indicators (cursor, indent, encoding, eol, language)
//   - Extension → language display name mapping
//   - Live editor status bar tracking (cursor position, language mode)
//   - Notification center bell badge + overlay
//   - Window title updates

import { Disposable, IDisposable, toDisposable } from '../platform/lifecycle.js';
import { URI } from '../platform/uri.js';
import { ServiceCollection } from '../services/serviceCollection.js';
import { ICommandService, IEditorService, INotificationService, IDocumentExtractionService } from '../services/serviceTypes.js';
import { StatusBarPart, StatusBarAlignment, StatusBarEntryAccessor } from '../parts/statusBarPart.js';
import { getLanguageForFileName } from '../services/languageDetection.js';
import { EditorPart } from '../parts/editorPart.js';
import { TextEditorPane } from '../built-in/editor/textEditorPane.js';
import { ContextMenu } from '../ui/contextMenu.js';
import { $ } from '../ui/dom.js';
import type { IEditorInput } from '../editor/editorInput.js';
import type { Workspace } from '../workspace/workspace.js';
import type { WorkbenchContextManager } from '../context/workbenchContext.js';
import type { EditorPane } from '../editor/editorPane.js';

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
  /** Tracked status bar entry accessors for dynamic updates. */
  private _accessors: {
    cursor?: StatusBarEntryAccessor;
    indent?: StatusBarEntryAccessor;
    encoding?: StatusBarEntryAccessor;
    eol?: StatusBarEntryAccessor;
    language?: StatusBarEntryAccessor;
  } = {};

  private readonly _statusBar: StatusBarPart;
  private readonly _editorPart: EditorPart;
  private readonly _services: ServiceCollection;
  private readonly _container: HTMLElement;
  private readonly _keybindingHint: (commandId: string) => string | undefined;
  private readonly _toggleStatusBar: () => void;
  private readonly _getWorkspace: () => Workspace;
  private readonly _getWorkbenchContext: () => WorkbenchContextManager | undefined;

  constructor(deps: StatusBarControllerDeps) {
    super();
    this._statusBar = deps.statusBar;
    this._editorPart = deps.editorPart;
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

    // ── Right-aligned editor indicators (VS Code parity) ──
    const cursorAccessor = sb.addEntry({
      id: 'status.editor.selection',
      text: 'Ln 1, Col 1',
      alignment: StatusBarAlignment.Right,
      priority: 100,
      tooltip: 'Go to Line/Column (Ctrl+G)',
      command: 'workbench.action.gotoLine',
      name: 'Cursor Position',
    });

    const indentAccessor = sb.addEntry({
      id: 'status.editor.indentation',
      text: 'Spaces: 2',
      alignment: StatusBarAlignment.Right,
      priority: 80,
      tooltip: 'Indentation Settings',
      name: 'Indentation',
    });

    const encodingAccessor = sb.addEntry({
      id: 'status.editor.encoding',
      text: 'UTF-8',
      alignment: StatusBarAlignment.Right,
      priority: 70,
      tooltip: 'Select Encoding',
      name: 'Encoding',
    });

    const eolAccessor = sb.addEntry({
      id: 'status.editor.eol',
      text: 'LF',
      alignment: StatusBarAlignment.Right,
      priority: 60,
      tooltip: 'End of Line Sequence',
      name: 'End of Line',
    });

    const languageAccessor = sb.addEntry({
      id: 'status.editor.language',
      text: 'Plain Text',
      alignment: StatusBarAlignment.Right,
      priority: 50,
      tooltip: 'Select Language Mode',
      name: 'Language',
    });

    this._accessors = {
      cursor: cursorAccessor,
      indent: indentAccessor,
      encoding: encodingAccessor,
      eol: eolAccessor,
      language: languageAccessor,
    };

    // Wire active editor → status bar indicators
    this._wireEditorStatusBarTracking();

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

    // M21 F.2: Docling status indicator
    this._setupDoclingStatusIndicator(sb);
  }

  // ── Editor status tracking ─────────────────────────────────────────────

  private _wireEditorStatusBarTracking(): void {
    const editorService = this._services.has(IEditorService)
      ? this._services.get(IEditorService) as import('../services/editorService.js').EditorService
      : undefined;
    if (!editorService) return;

    const editorPart = this._editorPart;
    const acc = this._accessors;
    let cursorSub: IDisposable | undefined;

    // Language indicator updates
    const updateLanguage = (editor: IEditorInput | undefined) => {
      if (!editor) {
        acc.language?.update({ text: '' });
        return;
      }
      const lang = getLanguageForFileName(editor.name ?? '');
      acc.language?.update({ text: lang, tooltip: `${lang} — Select Language Mode` });
    };

    updateLanguage(editorService.activeEditor);
    this._register(editorService.onDidActiveEditorChange(updateLanguage));

    // Pane-dependent indicators (cursor, encoding, eol, indent)
    const updatePaneIndicators = (pane: EditorPane | undefined) => {
      cursorSub?.dispose();
      cursorSub = undefined;

      if (pane instanceof TextEditorPane) {
        acc.encoding?.update({ text: 'UTF-8' });
        acc.indent?.update({ text: 'Spaces: 2' });
        acc.cursor?.update({
          text: `Ln ${pane.cursorLine}, Col ${pane.cursorCol}`,
        });
        acc.eol?.update({ text: pane.eolLabel });

        cursorSub = pane.onDidChangeCursorPosition(({ line, col }) => {
          acc.cursor?.update({ text: `Ln ${line}, Col ${col}` });
        });
      } else {
        acc.cursor?.update({ text: '' });
        acc.eol?.update({ text: '' });
        acc.indent?.update({ text: '' });
        acc.encoding?.update({ text: '' });
      }
    };

    this._register(editorPart.onDidActivePaneChange(updatePaneIndicators));
    updatePaneIndicators(editorPart.activeGroup?.activePane);
    this._register(toDisposable(() => cursorSub?.dispose()));
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

  // ── M21 F.2: Docling status indicator ──────────────────────────────────

  private _setupDoclingStatusIndicator(sb: StatusBarPart): void {
    const extractionService = this._services.has(IDocumentExtractionService)
      ? this._services.get(IDocumentExtractionService) as import('../services/documentExtractionService.js').DocumentExtractionService
      : undefined;
    if (!extractionService) return;

    const docSvg = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M15 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V7z"/><path d="M14 2v6h6"/><path d="M8 13h8M8 17h8M8 9h2"/></svg>';

    const accessor = sb.addEntry({
      id: 'status.docling',
      text: 'Docling',
      iconSvg: docSvg,
      alignment: StatusBarAlignment.Right,
      priority: 50,
      tooltip: 'Docling: Checking…',
      name: 'Docling Status',
      command: 'parallx.installDocling',
    });

    const makeLabel = (text: string, color?: string): HTMLElement => {
      const span = $('span');
      span.textContent = text;
      if (color) span.style.color = color;
      return span;
    };

    const updateStatus = (): void => {
      const status = extractionService.bridgeStatus;
      const available = extractionService.isDoclingAvailable;

      let text: string;
      let tooltip: string;
      let color: string | undefined;

      switch (status) {
        case 'available':
          text = 'Docling';
          tooltip = 'Docling: Available and healthy';
          color = '#4ec9b0'; // green
          break;
        case 'starting':
          text = 'Docling…';
          tooltip = 'Docling: Starting bridge service…';
          color = '#dcdcaa'; // yellow
          break;
        case 'downloading-models':
          text = 'Docling ↓';
          tooltip = 'Docling: Downloading models…';
          color = '#dcdcaa'; // yellow
          break;
        case 'error':
          text = 'Docling ✗';
          tooltip = 'Docling: Service error — click for diagnostics';
          color = '#f44747'; // red
          break;
        case 'unavailable':
        default:
          text = available ? 'Docling' : 'Docling —';
          tooltip = 'Docling: Not installed — run: pip install docling';
          color = undefined; // default/gray
          break;
      }

      accessor.update({ text: '', tooltip, htmlElement: makeLabel(text, color) });
    };

    // Initial update
    updateStatus();

    // Subscribe to changes
    this._register(extractionService.onDidChangeBridgeStatus(() => updateStatus()));
    this._register(extractionService.onDidChangeAvailability(() => updateStatus()));
  }
}
