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
// See docs/ICON_REGISTRY.md for the three-registry architecture.

import { getIcon, hasIcon } from '../../ui/iconRegistry.js';

// ─── Canvas icon IDs ─────────────────────────────────────────────────────────
// These are the icon keys the canvas surface uses, all backed by the central
// Lucide registry.  Nothing here contains SVG data — it's just a list of
// valid keys so the rest of canvas can iterate.

export const ICON_IDS: string[] = [
  'page', 'page-filled', 'folder', 'chevron-right', 'star', 'star-filled',
  'plus', 'info', 'trash', 'restore', 'close', 'ellipsis', 'edit',
  'new-page', 'duplicate', 'export', 'lock', 'expand-width', 'text-size',
  'image', 'smile', 'link', 'search', 'view-table', 'view-board',
  'view-list', 'view-gallery', 'view-calendar', 'view-timeline',
  'database-link', 'db-filter', 'db-sort', 'db-group', 'db-settings',
  'db-collapse', 'db-expand', 'open', 'bookmark', 'lightbulb', 'note',
  'checklist', 'calendar', 'flag', 'heart', 'target', 'bolt', 'globe',
  'home', 'inbox', 'tag', 'code', 'rocket', 'book', 'compass', 'puzzle',
  'terminal', 'math', 'math-block', 'database', 'grid', 'layers', 'users',
  'pin', 'archive', 'music', 'coffee', 'diamond', 'key', 'bullet-list',
  'numbered-list', 'quote', 'divider', 'columns', 'toc', 'video', 'audio',
  'file-attachment', 'open-full-page', 'automations', 'arrow-up',
  'arrow-down', 'arrow-left', 'arrow-right', 'chevron-left', 'chevron-down',
  'chevron-up', 'eye', 'eye-off', 'clock', 'bell', 'comment', 'share',
  'at-sign', 'check', 'warning', 'refresh', 'upload', 'menu',
  'more-vertical', 'grip-vertical', 'sidebar-left', 'sidebar-right',
  'panel-bottom', 'fullscreen', 'exit-fullscreen', 'format-bold',
  'format-italic', 'format-underline', 'format-strikethrough', 'align-left',
  'align-center', 'align-right', 'circle', 'circle-check', 'hash', 'user',
  'sun', 'moon', 'undo', 'redo', 'filter-x', 'color', 'highlight',
];

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
