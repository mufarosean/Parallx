// shell.ts — service interfaces for the window and its shell: lifecycle, layout, the window, status bar, sessions, theme, notifications, surfaces, keybindings.
//
// One file of services/types/; serviceTypes.ts re-exports them all, so import
// from '../serviceTypes.js' as before.

import { createServiceIdentifier } from '../../platform/types.js';
import { IDisposable } from '../../platform/lifecycle.js';
import { Event } from '../../platform/events.js';
import type { NotificationAction, NotificationSeverity as NotifSeverity, INotification } from '../../api/notificationService.js';
import type { ISurfaceRouterService as ISurfaceRouterServiceType } from '../surfaceRouterService.js';
import type { URI } from '../../platform/uri.js';
import type { IWorkspaceSessionContext } from '../../workspace/workspaceSessionContext.js';

// ─── ILifecycleService ───────────────────────────────────────────────────────

/**
 * Provides workbench lifecycle phase tracking and hooks.
 */
export interface ILifecycleService extends IDisposable {
  readonly phase: number | undefined;
  hasReachedPhase(phase: number): boolean;
  onStartup(phase: number, hook: () => void | Promise<void>): IDisposable;
  onTeardown(phase: number, hook: () => void | Promise<void>): IDisposable;
  startup(): Promise<void>;
  teardown(): Promise<void>;
}

export const ILifecycleService = createServiceIdentifier<ILifecycleService>('ILifecycleService');

// ─── ILayoutService ──────────────────────────────────────────────────────────

/**
 * Event fired when a part's visibility changes.
 * VS Code reference: IPartVisibilityChangeEvent in layoutService.ts
 */
export interface PartVisibilityChangeEvent {
  readonly partId: string;
  readonly visible: boolean;
}

/**
 * Manages overall workbench layout.
 * VS Code reference: IWorkbenchLayoutService (src/vs/workbench/services/layout/browser/layoutService.ts)
 */
export interface ILayoutService extends IDisposable {
  readonly container: HTMLElement | undefined;
  layout(): void;

  /**
   * Returns whether the given part is currently visible.
   * VS Code reference: isVisible(part: Parts): boolean
   */
  isVisible(partId: string): boolean;

  /**
   * Show or hide a workbench part.
   * VS Code reference: setPartHidden(hidden: boolean, part: Parts): void
   */
  setPartHidden(hidden: boolean, partId: string): void;

  /**
   * Fires when any part's visibility changes.
   * VS Code reference: onDidChangePartVisibility
   */
  readonly onDidChangePartVisibility: Event<PartVisibilityChangeEvent>;
}

export const ILayoutService = createServiceIdentifier<ILayoutService>('ILayoutService');

// ─── INotificationService ────────────────────────────────────────────────────

/**
 * Service interface for the notification/toast system.
 */
export interface INotificationService extends IDisposable {
  /** Attach the notification container to a parent element. */
  attach(parent: HTMLElement): void;
  /** Show a notification. */
  notify(severity: NotifSeverity, message: string, actions?: readonly NotificationAction[], source?: string, timeoutMs?: number): Promise<NotificationAction | undefined>;
  /** Show an information message. */
  info(message: string, ...actions: NotificationAction[]): Promise<NotificationAction | undefined>;
  /** Show a warning message. */
  warn(message: string, ...actions: NotificationAction[]): Promise<NotificationAction | undefined>;
  /** Show an error message. */
  error(message: string, ...actions: NotificationAction[]): Promise<NotificationAction | undefined>;
  /** Dismiss all notifications. */
  dismissAll(): void;
  /** Number of currently visible (active) notifications. */
  readonly activeCount: number;
  /** Recent notification history (newest first). */
  readonly history: readonly INotification[];
  /** Clear notification history. */
  clearHistory(): void;
  /** Fires when a notification is shown. */
  readonly onDidShowNotification: Event<INotification>;
  /** Fires when a notification is closed. */
  readonly onDidCloseNotification: Event<string>;
  /** Fires when the active notification count changes. */
  readonly onDidChangeCount: Event<number>;
}

export const INotificationService = createServiceIdentifier<INotificationService>('INotificationService');

// ─── ISurfaceRouterService ──────────────────────────────────────────

/**
 * Multi-surface output router — wires agent output to non-chat surfaces
 * (notifications, status bar, filesystem, canvas) via registered plugins.
 *
 * Upstream parity: ChannelPlugin registry (github.com/openclaw/openclaw
 * src/channels/). Full interface lives in `surfaceRouterService.ts`; this
 * file only exposes the DI identifier so the workbench can bind it without
 * importing the openclaw module directly.
 */
export const ISurfaceRouterService =
  createServiceIdentifier<ISurfaceRouterServiceType>('ISurfaceRouterService');

// ─── IKeybindingService ──────────────────────────────────────────────────────

/**
 * Centralized keybinding dispatch service.
 * Owns a single document-level keydown listener (capture phase) and resolves
 * keyboard events to command executions via the keybinding table.
 *
 * Replaces the ad-hoc dispatch in KeybindingContributionProcessor and the
 * hardcoded listeners in CommandPalette.
 *
 * VS Code reference: src/vs/workbench/services/keybinding/browser/keybindingService.ts
 */
export interface IKeybindingService extends IDisposable {
  /**
   * Register a keybinding that maps a key combination to a command.
   * Returns a disposable that removes the registration.
   *
   * @param key — Normalized keybinding string, e.g. 'Ctrl+B', 'Ctrl+K Ctrl+F'
   * @param commandId — Command to execute when the keybinding fires
   * @param when — Optional when-clause expression for conditional activation
   * @param source — Origin of the keybinding (e.g. 'builtin', 'tool:<toolId>')
   */
  registerKeybinding(key: string, commandId: string, when?: string, source?: string): IDisposable;

  /**
   * Register multiple keybindings at once. Returns a single disposable.
   */
  registerKeybindings(bindings: readonly { key: string; commandId: string; when?: string; source?: string }[]): IDisposable;

  /**
   * Remove all keybindings contributed by a specific source.
   */
  removeKeybindingsBySource(source: string): void;

  /**
   * Look up the keybinding string for a command (first match).
   * Returns undefined if no keybinding is registered for the command.
   */
  lookupKeybinding(commandId: string): string | undefined;

  /**
   * Get all registered keybindings.
   */
  getAllKeybindings(): readonly { key: string; commandId: string; when?: string; source?: string }[];

  /** Command ids currently triggered by `key` (single-key, normalized). */
  getCommandsForKey(key: string): string[];

  /** User rebind: make `commandId` respond to `key` only (source 'user'). */
  setUserKeybinding(commandId: string, key: string): void;

  /** Clear a command's bindings; optionally restore `defaultKey`. */
  clearUserKeybinding(commandId: string, defaultKey?: string): void;

  /** Fires when a keybinding is successfully dispatched. */
  readonly onDidDispatch: Event<{ key: string; commandId: string }>;

  /** Fires when a chord prefix is entered (status bar hint). */
  readonly onDidEnterChordPrefix: Event<string>;

  /** Fires when a chord is cancelled (timeout or non-matching second key). */
  readonly onDidCancelChord: Event<void>;
}

export const IKeybindingService = createServiceIdentifier<IKeybindingService>('IKeybindingService');

// ─── IWindowService ──────────────────────────────────────────────────────────

/**
 * Abstraction over native window operations (minimize, maximize, close, etc.).
 * In Electron, delegates to `window.parallxElectron` IPC bridge.
 * In browser-only mode, methods are no-ops.
 *
 * VS Code reference: INativeHostService (src/vs/platform/native/common/native.ts)
 * — our scope is narrower: only window-chrome operations.
 */
export interface IWindowService extends IDisposable {
  /** Whether the host supports native window controls (Electron). */
  readonly isNativeWindow: boolean;
  /** Minimize the window. */
  minimize(): void;
  /** Toggle maximize / restore. */
  maximize(): void;
  /** Close the window. */
  close(): void;
  /** Query current maximized state. */
  isMaximized(): Promise<boolean>;
  /** Fires when the maximized state changes. */
  readonly onDidChangeMaximized: Event<boolean>;
}

export const IWindowService = createServiceIdentifier<IWindowService>('IWindowService');

// ─── IThemeService ────────────────────────────────────────────────────────

/**
 * Manages color themes — loading, resolving, and injecting CSS custom properties.
 *
 * VS Code reference: IThemeService (src/vs/platform/theme/common/themeService.ts)
 */
export interface IThemeService extends IDisposable {
  /** The currently applied color theme. */
  readonly activeTheme: import('../../theme/themeData.js').IColorTheme;

  /** Fired when the active theme changes. */
  readonly onDidChangeTheme: Event<import('../../theme/themeData.js').IColorTheme>;

  /** Resolve a color from the active theme, with registry default fallback. */
  getColor(colorId: string): string;

  /** Apply a parsed theme. */
  applyTheme(theme: import('../../theme/themeData.js').ColorThemeData): void;
}

export const IThemeService = createServiceIdentifier<IThemeService>('IThemeService');

// ─── Status Bar Types ────────────────────────────────────────────────────────

/**
 * Status bar alignment for items.
 * VS Code reference: StatusbarAlignment (src/vs/workbench/services/statusbar/browser/statusbar.ts)
 */
export enum StatusBarAlignment {
  Left = 'left',
  Right = 'right',
}

/**
 * Descriptor for a status bar entry.
 * VS Code reference: IStatusbarEntry
 */
export interface StatusBarEntry {
  readonly id: string;
  /** Display text. Supports `$(icon-name)` codicon placeholders. */
  readonly text: string;
  readonly alignment: StatusBarAlignment;
  /** Sort order: higher priority = closer to the edge. */
  readonly priority?: number;
  readonly tooltip?: string;
  /** Command ID to execute on click. */
  readonly command?: string;
  /** Human-readable name for context-menu toggling. */
  readonly name?: string;
  /** Optional SVG icon string rendered before the text. */
  readonly iconSvg?: string;
  /**
   * Optional custom DOM element to render instead of text/iconSvg.
   * When set, `text` and `iconSvg` are ignored for rendering.
   * The element is appended directly into the label container.
   */
  readonly htmlElement?: HTMLElement;
}

/**
 * Accessor returned when adding an entry — allows updating or removing it.
 * VS Code reference: IStatusbarEntryAccessor
 */
export interface StatusBarEntryAccessor extends IDisposable {
  /** Update the entry's mutable properties. */
  update(entry: Partial<Pick<StatusBarEntry, 'text' | 'tooltip' | 'command' | 'iconSvg' | 'htmlElement'>>): void;
}

/**
 * Minimal interface for status bar part operations needed by API consumers.
 * VS Code reference: IStatusbarService
 */
export interface IStatusBarPart {
  addEntry(entry: StatusBarEntry): StatusBarEntryAccessor;
}

// ─── Session Manager ─────────────────────────────────────────────────────────

/**
 * Manages workspace session identity.
 *
 * A "session" starts when a workspace is opened (or the page loads)
 * and ends when the user switches workspace (or the page unloads).
 * Each session gets a unique `sessionId`.
 *
 * VS Code reference: implicit — VS Code uses per-window process isolation.
 * Parallx models the same guarantee explicitly via WorkspaceSessionContext.
 */
export interface ISessionManager {
  /** The currently active session context, or `undefined` before first open. */
  readonly activeContext: IWorkspaceSessionContext | undefined;

  /**
   * Create a new session for the given workspace.
   * Invalidates any previous session (abort + isActive → false).
   */
  beginSession(workspaceId: string, roots: readonly URI[]): IWorkspaceSessionContext;

  /** End the current session (abort + invalidate). No-op if no active session. */
  endSession(): void;

  /** Fired when the active session changes (begin or end). */
  readonly onDidChangeSession: Event<IWorkspaceSessionContext | undefined>;
}
export const ISessionManager = createServiceIdentifier<ISessionManager>('ISessionManager');
