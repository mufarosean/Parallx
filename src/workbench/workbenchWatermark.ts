/**
 * Editor watermark — extracted from workbench.ts.
 *
 * Renders keyboard-shortcut hints on the empty editor background.
 * Optionally resolves shortcut labels from the keybinding service.
 */

import { getIcon } from '../ui/iconRegistry.js';
import { formatKeybindingForDisplay } from '../services/keybindingUtils.js';

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

// ── Public API ───────────────────────────────────────────────────────────

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
          <div class="editor-watermark-shortcuts">
            ${entries}
          </div>
        </div>
      `;
}
