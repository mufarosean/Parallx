// main.ts — File Editor built-in tool
//
// Companion tool for the workbench-level file editor.
// The core resolver (FileEditorInput → TextEditorPane) is wired at the
// workbench level in _initFileEditorResolver(). This tool contributes:
//   - editor.toggleWordWrap command
//   - editor.changeEncoding command (stub for M4)
//
// VS Code reference:
//   src/vs/workbench/contrib/files/browser/editors/fileEditorInput.ts
//   src/vs/editor/browser/editorExtensions.ts

import type { IDisposable } from '../../platform/lifecycle.js';
import { TextEditorPane } from './textEditorPane.js';

// ─── Types (avoid direct dependency on apiFactory) ───────────────────────────

interface ParallxApi {
  commands: {
    registerCommand(id: string, handler: (...args: unknown[]) => unknown | Promise<unknown>): IDisposable;
    executeCommand<T = unknown>(id: string, ...args: unknown[]): Promise<T>;
  };
  editors: {
    openFileEditor(uri: string, options?: { pinned?: boolean }): Promise<void>;
  };
  window: {
    showInformationMessage(message: string, ...actions: { title: string; isCloseAffordance?: boolean }[]): Promise<{ title: string } | undefined>;
  };
}

interface ToolContext {
  subscriptions: IDisposable[];
  workspaceState: { get<T>(key: string, defaultValue: T): T; update(key: string, value: unknown): void };
}

// ─── State ───────────────────────────────────────────────────────────────────

let _api: ParallxApi;

// ─── Activation ──────────────────────────────────────────────────────────────

export function activate(api: ParallxApi, context: ToolContext): void {
  _api = api;

  // ── editor.toggleWordWrap ──
  context.subscriptions.push(
    api.commands.registerCommand('editor.toggleWordWrap', () => {
      // Find the active TextEditorPane in the DOM and toggle wrap
      // We use a DOM query because the command system doesn't have
      // direct access to the active pane instance.
      toggleWordWrapOnActivePane();
    }),
  );

  // ── editor.changeEncoding (stub) ──
  context.subscriptions.push(
    api.commands.registerCommand('editor.changeEncoding', () => {
      api.window.showInformationMessage('Encoding selection is not yet implemented.');
    }),
  );

  console.log('[FileEditorTool] Activated');
}

export function deactivate(): void {
  console.log('[FileEditorTool] Deactivated');
}

// ─── Helpers ─────────────────────────────────────────────────────────────────

/**
 * Find the active TextEditorPane's textarea in the DOM and toggle word wrap.
 *
 * Approach: The workbench has at most one `.editor-pane .text-editor-textarea`
 * that's visible. We toggle the `--wrap` modifier on it.
 */
function toggleWordWrapOnActivePane(): void {
  const textarea = document.querySelector(
    '.editor-pane .text-editor-textarea',
  ) as HTMLTextAreaElement | null;

  if (!textarea) {
    console.warn('[FileEditorTool] No active text editor to toggle word wrap on.');
    return;
  }

  textarea.classList.toggle('text-editor-textarea--wrap');
}
