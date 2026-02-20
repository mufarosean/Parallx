// iconRegistry.ts — Single gate for all icon access in the canvas system
//
// This is the ONLY file that imports from canvasIcons.ts.
// All icon consumers (blocks, menus, chrome, sidebar) import from here.
//
// The icon registry centralises three concerns:
//   1. Rendering — svgIcon(), createIconElement()
//   2. Resolution — resolvePageIcon() validates stored icon IDs
//   3. Catalogs — which icons are user-selectable for pages/callouts
//
// Block definitions declare their icon ID in the block registry.
// Menus, extensions, and chrome consume icons exclusively through this
// module — they never import canvasIcons.ts directly.
//
// See docs/ICON_REGISTRY.md for architecture rationale.

import {
  svgIcon as _svgIcon,
  createIconElement as _createIconElement,
  resolvePageIcon as _resolvePageIcon,
  PAGE_ICON_IDS as _PAGE_ICON_IDS,
  ICON_IDS as _ICON_IDS,
} from '../canvasIcons.js';

// ── Icon Rendering ──────────────────────────────────────────────────────────

/**
 * Get the raw SVG string for an icon ID.
 * Returns the 'page' icon if the ID is unknown.
 */
export function svgIcon(id: string): string {
  return _svgIcon(id);
}

/**
 * Create a sized `<span>` element containing an SVG icon.
 * The span uses `display: inline-flex` and sets width/height.
 *
 * @param id — icon identifier
 * @param size — pixel size (both width and height), default 16
 */
export function createIconElement(id: string, size = 16): HTMLElement {
  return _createIconElement(id, size);
}

// ── Icon Resolution ─────────────────────────────────────────────────────────

/**
 * Resolve a page's icon field to the appropriate icon ID.
 * If the icon is null/empty, returns 'page' (default).
 * If the icon is an emoji (legacy data), returns 'page' (fallback).
 * If the icon is a known ID, returns it.
 */
export function resolvePageIcon(icon: string | null | undefined): string {
  return _resolvePageIcon(icon);
}

// ── Icon Catalogs ───────────────────────────────────────────────────────────

/**
 * Icon IDs that users can select for pages and callouts via the icon picker.
 * This is the single source of truth for the picker grid contents.
 */
export const PAGE_SELECTABLE_ICONS: readonly string[] = _PAGE_ICON_IDS;

/** All available icon IDs in the system. */
export const ALL_ICON_IDS: readonly string[] = _ICON_IDS;

// ── Block Icon Metadata ─────────────────────────────────────────────────────

/**
 * Block types whose icon can be changed by the user via the icon picker.
 *
 * This set is authoritative — if a block name is NOT here, its icon is
 * fixed and the icon picker should never be offered for it.
 *
 * Matches the `iconSelectable` flag on BlockDefinition entries.
 */
const _userSelectableBlocks = new Set<string>(['callout', 'pageBlock']);

/**
 * Whether a block type's icon is user-selectable (via the icon picker).
 *
 * @param blockName — ProseMirror node type name
 */
export function isBlockIconSelectable(blockName: string): boolean {
  return _userSelectableBlocks.has(blockName);
}
