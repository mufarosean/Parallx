// selectionActionTypes.ts — Unified Selection → AI Action System (M48)
//
// Core contracts for the three-layer architecture:
//   Layer 1: Surface Adapters  — per-editor selection capture
//   Layer 2: Dispatcher        — routes payloads to handlers
//   Layer 3: Action Handlers   — shared actions (Explain, Summarize, etc.)
//
// Any editor surface implements ISurfaceSelectionAdapter.
// The SelectionActionDispatcher receives ISelectionActionPayload and routes
// it to the registered ISelectionActionHandler.

import type { IDisposable } from '../platform/lifecycle.js';

// Re-export the canonical IChatSelectionAttachment from chatTypes
// so consumers of this module can import from a single source.
export type { IChatSelectionAttachment } from './chatTypes.js';
export { isChatSelectionAttachment } from './chatTypes.js';

// Import locally for use in interfaces below
import type { IChatSelectionAttachment } from './chatTypes.js';

// ── Layer 1: Surface Adapter Contracts ───────────────────────────────────────

/**
 * Source metadata for a text selection — where it came from.
 */
export interface ISelectionSource {
  /** Display filename (e.g. "Auto Insurance Policy.md"). */
  readonly fileName: string;
  /** Full workspace-relative path or URI. */
  readonly filePath: string;
  /** 1-based start line (text/markdown editors). */
  readonly startLine?: number;
  /** 1-based end line (text/markdown editors). */
  readonly endLine?: number;
  /** PDF page number (1-based). */
  readonly pageNumber?: number;
}

/**
 * Contract that each editor surface implements to expose text selection.
 */
export interface ISurfaceSelectionAdapter {
  /** Surface identifier — must match the surface field in payloads. */
  readonly surfaceId: string;

  /** Get the current text selection, or undefined if nothing is selected. */
  getSelectedText(): string | undefined;

  /** Get source metadata for the current selection. */
  getSelectionSource(): ISelectionSource | undefined;
}

// ── Layer 2: Dispatcher Contracts ────────────────────────────────────────────

/** Well-known action IDs. Extensible — any string is valid. */
export type SelectionActionId = 'add-to-chat' | 'send-to-canvas' | string;

/**
 * The standard payload produced by any surface adapter and consumed by
 * the dispatcher. This is the lingua franca between surfaces and handlers.
 */
export interface ISelectionActionPayload {
  /** The selected text content. */
  readonly selectedText: string;

  /** Source surface identifier. */
  readonly surface: string;

  /** Source file metadata (when available). */
  readonly source: ISelectionSource;

  /** The action to perform. */
  readonly actionId: SelectionActionId;
}

/**
 * Programmatic access to the chat panel from outside the chat component.
 * Used by action handlers to drive the chat input.
 */
export interface IChatProgrammaticAccess {
  /** Add a selection attachment to the chat input. */
  addSelectionAttachment(attachment: IChatSelectionAttachment): void;

  /** Set the text input contents. */
  setInputValue(text: string): void;

  /** Focus the chat input. */
  focus(): void;

  /** Submit the current input (as if the user pressed Enter). */
  submit(): void;

  /** Ensure the chat panel is visible. */
  reveal(): void;
}

// ── Layer 3: Action Handler Contracts ────────────────────────────────────────

/**
 * Services available to action handlers during execution.
 */
export interface IActionHandlerServices {
  /** Programmatic access to the chat panel. */
  readonly chatAccess: IChatProgrammaticAccess;

  /** Execute a command by ID. */
  readonly executeCommand: <T = unknown>(id: string, ...args: unknown[]) => Promise<T>;
}

/**
 * A handler for a specific selection action (e.g. Explain, Summarize).
 */
export interface ISelectionActionHandler {
  /** Action identifier. */
  readonly actionId: string;

  /** Display label for context menus. */
  readonly label: string;

  /** Optional icon hint (codicon name or emoji). */
  readonly icon?: string;

  /** Execute the action given a payload. */
  execute(payload: ISelectionActionPayload, services: IActionHandlerServices): Promise<void>;
}

/**
 * The dispatcher — registers handlers, receives payloads, routes to handlers.
 */
export interface ISelectionActionDispatcher extends IDisposable {
  /** Register an action handler. Returns a disposable to unregister. */
  registerHandler(handler: ISelectionActionHandler): IDisposable;

  /** Get all registered handlers (for context menu building). */
  getHandlers(): readonly ISelectionActionHandler[];

  /** Dispatch a payload to its matching handler. */
  dispatch(payload: ISelectionActionPayload): Promise<void>;
}
