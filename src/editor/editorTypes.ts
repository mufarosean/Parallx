// editorTypes.ts — editor-related types
//
// Shared types, enums, and interfaces for the editor subsystem.
// These are imported by editorInput, editorGroupModel, editorPane,
// editorGroupView, and the editor services.

import type { IDisposable } from '../platform/lifecycle.js';
import type { Event } from '../platform/events.js';

// ─── Editor Open Options ─────────────────────────────────────────────────────

/**
 * Options for opening an editor in a group.
 */
export interface EditorOpenOptions {
  /** Open as pinned rather than preview. */
  pinned?: boolean;
  /** Open as sticky (remains at start of tab bar). */
  sticky?: boolean;
  /** Insert at a specific index in the tab list. */
  index?: number;
  /** Activate the editor after opening. */
  activation?: EditorActivation;
  /** Preserve existing focus (don't move focus to editor). */
  preserveFocus?: boolean;
}

/**
 * How an editor should be activated on open.
 */
export enum EditorActivation {
  /** Activate the editor (default). */
  Activate = 'activate',
  /** Restore the editor but don't activate. */
  Restore = 'restore',
  /** Preserve current activation state. */
  Preserve = 'preserve',
}

// ─── Editor Close Options ────────────────────────────────────────────────────

export interface EditorCloseOptions {
  /** Skip the dirty check / save prompt. */
  force?: boolean;
}

// ─── Editor State ────────────────────────────────────────────────────────────

/**
 * Serializable editor state within a group (for persistence).
 */
export interface SerializedEditorEntry {
  readonly inputId: string;
  readonly typeId: string;
  readonly name: string;
  readonly description?: string;
  readonly pinned: boolean;
  readonly sticky: boolean;
  readonly data?: Record<string, unknown>;
}

/**
 * Serializable state for an entire editor group.
 */
export interface SerializedEditorGroup {
  readonly id: string;
  readonly editors: SerializedEditorEntry[];
  readonly activeEditorIndex: number;
  readonly previewEditorIndex: number;
}

// ─── Editor Group Direction ──────────────────────────────────────────────────

/**
 * Direction for splitting an editor group.
 */
export enum GroupDirection {
  Left = 'left',
  Right = 'right',
  Up = 'up',
  Down = 'down',
}

// ─── Editor Move Target ──────────────────────────────────────────────────────

/**
 * Where to move/copy an editor.
 */
interface EditorMoveTarget {
  readonly groupId: string;
  readonly index?: number;
}

// ─── Tab Drag Data ───────────────────────────────────────────────────────────

/**
 * Data transferred during editor tab drag-and-drop.
 */
export interface EditorTabDragData {
  readonly sourceGroupId: string;
  readonly editorIndex: number;
  readonly inputId: string;
}

export const EDITOR_TAB_DRAG_TYPE = 'application/parallx-editor-tab';

// ─── Editor Group Layout ─────────────────────────────────────────────────────

/**
 * Serialized layout of the editor part's nested grid.
 */
interface SerializedEditorPartLayout {
  readonly orientation: 'horizontal' | 'vertical';
  readonly groups: SerializedEditorGroupLayout[];
}

interface SerializedEditorGroupLayout {
  readonly groupId: string;
  readonly size: number;
}

// ─── Close Result ────────────────────────────────────────────────────────────

/**
 * Result of an editor close attempt.
 */
enum EditorCloseResult {
  /** Editor was closed successfully. */
  Closed = 'closed',
  /** Editor close was vetoed (e.g. unsaved changes). */
  Vetoed = 'vetoed',
}

// ─── Editor Change Events ────────────────────────────────────────────────────

export interface EditorGroupChangeEvent {
  readonly groupId: string;
  readonly kind: EditorGroupChangeKind;
}

export enum EditorGroupChangeKind {
  EditorOpen = 'editorOpen',
  EditorClose = 'editorClose',
  EditorMove = 'editorMove',
  EditorPin = 'editorPin',
  EditorUnpin = 'editorUnpin',
  EditorSticky = 'editorSticky',
  EditorUnsticky = 'editorUnsticky',
  EditorActive = 'editorActive',
  EditorDirty = 'editorDirty',
  GroupActive = 'groupActive',
}
