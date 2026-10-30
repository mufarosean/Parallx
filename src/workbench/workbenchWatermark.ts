/**
 * Editor watermark — extracted from workbench.ts.
 *
 * The empty editor is Start: New Page and Open File…, the pages and files
 * opened last (the one recency list, recentsService.ts), then the keyboard
 * shortcut hints. It used to show only the hints, so with every tab closed
 * the way back to what you were doing was the sidebar. Start's controls are
 * kit buttons running commands; the hints resolve their keys from the
 * keybinding service once it is up.
 */

import { getIcon } from '../ui/iconRegistry.js';
import { formatKeybindingForDisplay } from '../services/keybindingUtils.js';
import { createButton, createSection } from '../ui/kit.js';
import { formatRelativeTime } from '../ui/relativeTime.js';
import './editorStart.css';
import type { RecentOpenedItem } from '../services/recentsService.js';
import type { IDisposable } from '../platform/lifecycle.js';
import type { Event } from '../platform/events.js';

// ── Types ────────────────────────────────────────────────────────────────

interface KeybindingLookup {
  lookupKeybinding(commandId: string): string | undefined;
}

// ── Default shortcut entries ─────────────────────────────────────────────

const WATERMARK_SHORTCUTS: { commandId: string; label: string; fallback: string }[] = [
  { commandId: 'workbench.action.showCommands', label: 'Command Palette', fallback: 'Ctrl+Shift+P' },
  { commandId: 'workbench.action.quickOpen', label: 'Go to File', fallback: 'Ctrl+P' },
  { commandId: 'workbench.action.toggleSidebar', label: 'Toggle Left Area', fallback: 'Ctrl+B' },
  { commandId: 'workbench.action.togglePanel', label: 'Toggle Bottom Area', fallback: 'Ctrl+J' },
];

/** How many recent pages and files Start lists. */
const START_RECENT = 6;

/** Start's commands that come from a tool, and so may come and go. */
const START_TOOL_COMMANDS = new Set(['canvas.newPage']);

/** What Start reads: the recent opens, and whether a command is there to run. */
export interface EditorStartSource {
  recentOpens(): readonly RecentOpenedItem[];
  hasCommand(commandId: string): boolean;
  readonly onDidChange: Event<void>;
  /** Commands registered or removed, so New Page shows once its tool is up. */
  readonly onDidChangeCommand?: Event<{ readonly commandId: string }>;
}

let _start: EditorStartSource | undefined;

// ── Public API ───────────────────────────────────────────────────────────

/** Fill Start from `source` now and whenever the recent list changes. */
export function installEditorStart(editorElement: HTMLElement, source: EditorStartSource): IDisposable {
  _start = source;
  const refresh = () => {
    const watermark = editorElement.querySelector('.editor-watermark') as HTMLElement | null;
    if (watermark) fillStart(watermark);
  };
  refresh();
  const subs = [source.onDidChange(refresh)];
  if (source.onDidChangeCommand) subs.push(source.onDidChangeCommand((e) => { if (START_TOOL_COMMANDS.has(e.commandId)) refresh(); }));
  return { dispose: () => { subs.forEach((d) => d.dispose()); if (_start === source) _start = undefined; } };
}

/**
 * Initialise the watermark on first render (before keybinding service is
 * available).
 *
 * @param editorElement  The editor part's root DOM element that contains
 *   an `.editor-watermark` child.
 */
export function setupEditorWatermark(editorElement: HTMLElement): void {
  const watermark = editorElement.querySelector('.editor-watermark') as HTMLElement;
  if (watermark) {
    renderWatermarkContent(watermark);
  }
}

/**
 * Re-render the watermark using the live keybinding service so that
 * shortcut labels reflect any user customisations.
 */
export function updateWatermarkKeybindings(
  editorElement: HTMLElement,
  keybindingService: KeybindingLookup,
): void {
  const watermark = editorElement.querySelector('.editor-watermark') as HTMLElement;
  if (!watermark) return;
  renderWatermarkContent(watermark, keybindingService);
}

// ── Internals ────────────────────────────────────────────────────────────

function renderWatermarkContent(
  watermark: HTMLElement,
  keybindingService?: KeybindingLookup,
): void {
  const entries = WATERMARK_SHORTCUTS.map(({ commandId, label, fallback }) => {
    let key = fallback;
    if (keybindingService) {
      const resolved = keybindingService.lookupKeybinding(commandId);
      if (resolved) key = formatKeybindingForDisplay(resolved);
    }
    return `<div class="editor-watermark-entry"><kbd>${key}</kbd> <span>${label}</span></div>`;
  }).join('\n            ');

  watermark.innerHTML = `
        <div class="editor-watermark-content">
          <div class="editor-watermark-icon">${getIcon('px-mark')}</div>
          <div class="editor-watermark-title">Parallx</div>
          <div class="editor-start">
            <div class="editor-start-actions"></div>
            <div class="editor-start-recent"></div>
          </div>
          <div class="editor-watermark-shortcuts">
            ${entries}
          </div>
        </div>
      `;
  fillStart(watermark);
}

/** Start's actions and recent list, rebuilt from the source. */
function fillStart(watermark: HTMLElement): void {
  const actions = watermark.querySelector('.editor-start-actions') as HTMLElement | null;
  const recent = watermark.querySelector('.editor-start-recent') as HTMLElement | null;
  if (!actions || !recent) return;
  actions.replaceChildren();
  recent.replaceChildren();
  const source = _start;
  if (!source) return;
  if (source.hasCommand('canvas.newPage')) {
    createButton(actions, { id: 'workbench.start.newPage', command: 'canvas.newPage', label: 'New Page', icon: 'file-plus', kind: 'primary' });
  }
  createButton(actions, { id: 'workbench.start.openFile', command: 'file.openFile', label: 'Open File…', icon: 'folder-open' });
  const items = source.recentOpens().slice(0, START_RECENT);
  if (!items.length) return;
  const list = createSection(recent, 'Recent', 'editor-start-list');
  items.forEach((item, i) => {
    const kind = item.kind === 'page' ? 'Page' : 'File';
    createButton(list, {
      id: `workbench.start.recent.${i + 1}`, command: 'workbench.action.openRecentItem', args: [item.key],
      label: item.title || 'Untitled', icon: item.kind === 'page' ? 'page' : 'file', kind: 'ghost',
      title: `${kind}, opened ${formatRelativeTime(item.ts)}`,
    });
  });
}
