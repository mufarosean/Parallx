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

// ─── Activation ──────────────────────────────────────────────────────────────

export function activate(api: ParallxApi, context: ToolContext): void {

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
 * Find the active TextEditorPane instance and call its toggleWordWrap() method.
 *
 * Approach: The active editor group is marked with `.editor-group--active`.
 * Its textarea stores a back-reference to the TextEditorPane instance.
 * Calling toggleWordWrap() properly updates internal state, CSS, the
 * minimap, and fires the onDidToggleWordWrap event.
 */
function toggleWordWrapOnActivePane(): void {
  // Target the active group's textarea so multi-group layouts work correctly
  const textarea = document.querySelector(
    '.editor-group--active .editor-pane .text-editor-textarea',
  ) as (HTMLTextAreaElement & { __textEditorPane?: TextEditorPane }) | null;

  if (!textarea) {
    console.warn('[FileEditorTool] No active text editor to toggle word wrap on.');
    return;
  }

  const pane = textarea.__textEditorPane;
  if (pane) {
    pane.toggleWordWrap();
  } else {
    // Fallback: direct CSS toggle (should not happen)
    textarea.classList.toggle('text-editor-textarea--wrap');
  }
}
