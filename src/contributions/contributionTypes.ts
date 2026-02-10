// contributionTypes.ts — shared types for contribution point processors
//
// Defines common types used across command, keybinding, and menu
// contribution processors. These types bridge tool manifest declarations
// and the shell's internal registration systems.

import type { IDisposable } from '../platform/lifecycle.js';
import type { IToolDescription } from '../tools/toolManifest.js';

// ─── Contributed Command ─────────────────────────────────────────────────────

/**
 * A command contributed by a tool via its manifest's `contributes.commands`.
 * Extends manifest metadata with runtime state.
 */
export interface IContributedCommand {
  /** The command ID (from manifest). */
  readonly commandId: string;
  /** The tool that contributed this command. */
  readonly toolId: string;
  /** Human-readable title for command palette display. */
  readonly title: string;
  /** Optional category for grouping in the palette. */
  readonly category?: string;
  /** Optional icon identifier. */
  readonly icon?: string;
  /** Optional default keybinding string. */
  readonly keybinding?: string;
  /** When-clause controlling availability. */
  readonly when?: string;
  /** Whether the real handler has been wired (vs proxy). */
  handlerWired: boolean;
}

// ─── Contributed Keybinding ──────────────────────────────────────────────────

/**
 * A keybinding contributed by a tool via its manifest's `contributes.keybindings`.
 */
export interface IContributedKeybinding {
  /** The command this keybinding triggers. */
  readonly commandId: string;
  /** The tool that contributed this keybinding. */
  readonly toolId: string;
  /** The keybinding string (e.g. 'Ctrl+Shift+T'). */
  readonly key: string;
  /** Normalized key for matching against keyboard events. */
  readonly normalizedKey: string;
  /** When-clause controlling when the keybinding is active. */
  readonly when?: string;
}

// ─── Menu Location IDs ───────────────────────────────────────────────────────

/**
 * Supported menu contribution locations in M2.
 */
export type MenuLocationId = 'commandPalette' | 'view/title' | 'view/context';

// ─── Contributed Menu Item ───────────────────────────────────────────────────

/**
 * A menu item contributed by a tool via its manifest's `contributes.menus`.
 */
export interface IContributedMenuItem {
  /** The command this menu item invokes. */
  readonly commandId: string;
  /** The tool that contributed this menu item. */
  readonly toolId: string;
  /** The menu location this item belongs to. */
  readonly menuId: MenuLocationId;
  /** Group name for ordering (e.g. 'navigation'). */
  readonly group?: string;
  /** Numeric order within the group. */
  readonly order?: number;
  /** When-clause controlling visibility. */
  readonly when?: string;
}

// ─── Contribution Processor Interface ────────────────────────────────────────

/**
 * Common interface for contribution processors.
 * Each processor handles one section of `contributes`.
 */
export interface IContributionProcessor extends IDisposable {
  /**
   * Process a tool's manifest contributions.
   * Called when a tool is registered.
   */
  processContributions(toolDescription: IToolDescription): void;

  /**
   * Remove all contributions from a specific tool.
   * Called when a tool is deactivated or unregistered.
   */
  removeContributions(toolId: string): void;
}
