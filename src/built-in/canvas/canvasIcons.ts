// canvasIcons.ts — SVG icon system for the Canvas tool
//
// Thin wrapper over the central Lucide icon registry (src/ui/iconRegistry.ts).
// All actual SVG data lives in iconRegistry.generated.ts — this file only
// provides canvas-specific lookup, resolution, and element creation.
//
// ⚠️  DO NOT import this file directly.
// Only config/iconRegistry.ts imports here (single gate).
// All other code gets icons through blockRegistry or canvasMenuRegistry.
//
// See docs/canvas/ICON_REGISTRY.md for the three-registry architecture.

import { getIcon, hasIcon, getAllLucideIconIds } from '../../ui/iconRegistry.js';
/** Icon IDs specifically for the page icon picker. */
export const PAGE_ICON_IDS: string[] = [
  'page', 'page-filled', 'note', 'bookmark', 'folder',
  'checklist', 'calendar', 'flag', 'heart', 'target',
  'bolt', 'star', 'lightbulb', 'globe', 'home',
  'inbox', 'tag', 'code', 'rocket', 'book',
  'compass', 'puzzle', 'terminal', 'database', 'grid',
  'layers', 'users', 'pin', 'archive', 'music',
  'coffee', 'diamond', 'key', 'image', 'link',
  'smile', 'search',
];

/**
 * Full Lucide catalog for page-icon search.
 * The picker shows the curated `PAGE_ICON_IDS` set in the default grid for
 * fast initial render, but searches across this broader pool so users can
 * find any Lucide icon by name.
 */
export const ALL_PAGE_ICON_IDS: readonly string[] = getAllLucideIconIds();

// ─── Public API ──────────────────────────────────────────────────────────────

/**
 * Get the raw SVG string for an icon ID.
 * Returns the 'page' icon if the ID is unknown.
 */
export function svgIcon(id: string): string {
  return getIcon(id) || getIcon('page')!;
}

/**
 * Create a sized <span> element containing an SVG icon.
 * The span uses `display: inline-flex` and sets width/height.
 *
 * @param id — icon identifier
 * @param size — pixel size (both width and height), default 16
 * @returns HTMLElement span with the SVG inside
 */
export function createIconElement(id: string, size = 16): HTMLElement {
  const span = document.createElement('span');
  span.className = 'canvas-svg-icon';
  span.innerHTML = svgIcon(id);
  const svg = span.querySelector('svg');
  if (svg) {
    svg.setAttribute('width', String(size));
    svg.setAttribute('height', String(size));
  }
  span.style.width = `${size}px`;
  span.style.height = `${size}px`;
  return span;
}

/**
 * Resolve a page's icon field to the appropriate icon ID.
 * If the icon is null/empty, returns 'page' (default).
 * If the icon is an emoji (legacy data), returns 'page' (fallback).
 * If the icon is a known ID, returns it.
 */
export function resolvePageIcon(icon: string | null | undefined): string {
  if (!icon) return 'page';
  if (hasIcon(icon)) return icon;
  return 'page';
}
