// iconRegistry.ts — Shared icon registry for the entire Parallx application
//
// Single source of truth for ALL icons. Every icon in the app is a real Lucide
// icon sourced from iconRegistry.generated.ts (auto-generated from lucide-static).
//
// Public API:
//   registerIcon(id, svg) / getIcon(id) / hasIcon(id)
//   getFileTypeIcon(ext) / getFolderIcon() / getPageIcon()
//   getAvatarIcon(id) / AVATAR_ICON_IDS
//   createIconElement(iconId, size)
//
// Dependency rules: src/ui/ depends only on src/platform/. No service imports.

import { LUCIDE_ICONS } from './iconRegistry.generated.js';

// ── Registry Map ──────────────────────────────────────────────────────────────

const _icons = new Map<string, string>();

// Seed registry with every Lucide icon from the generated file
for (const [id, svg] of Object.entries(LUCIDE_ICONS)) {
  _icons.set(id, svg);
}

/**
 * Register an SVG icon by ID. Overwrites any previous registration.
 * @param id — Unique icon identifier (e.g. 'file-ts', 'folder', 'avatar-brain')
 * @param svgMarkup — Complete SVG element string
 */
export function registerIcon(id: string, svgMarkup: string): void {
  _icons.set(id, svgMarkup);
}

/**
 * Retrieve registered SVG markup for an icon ID.
 * Returns an empty string if the ID is unknown.
 */
export function getIcon(id: string): string {
  return _icons.get(id) ?? '';
}

/**
 * Check whether an icon ID has been registered.
 */
export function hasIcon(id: string): boolean {
  return _icons.has(id);
}

// ── File-Type Icon Aliases ────────────────────────────────────────────────────
// Map file extensions → icon IDs already present in LUCIDE_ICONS.
// The generated registry contains: file, file-text, file-code, file-json,
// file-type, file-spreadsheet, file-image, file-plus, file-minus,
// file-attachment, folder, folder-open, folder-tree, page, etc.

const _fileTypeMap: Record<string, string> = {
  file:   'file',
  folder: 'folder',
  md:     'file-text',
  pdf:    'file-text',
  txt:    'file-text',
  json:   'file-json',
  yaml:   'file-text',
  js:     'file-code',
  ts:     'file-code',
  jsx:    'file-code',
  tsx:    'file-code',
  py:     'file-code',
  rs:     'file-code',
  go:     'file-code',
  css:    'file-type',
  html:   'file-code',
  image:  'file-image',
  page:   'page',
};

// Extension alias mapping
const _extensionAliases: Record<string, string> = {
  // Markdown
  markdown: 'md',
  // Images
  jpg: 'image', jpeg: 'image', png: 'image', gif: 'image', webp: 'image',
  svg: 'image', ico: 'image', bmp: 'image',
  // Config
  yml: 'yaml', toml: 'yaml',
  // Code aliases
  mjs: 'js', cjs: 'js', mts: 'ts', cts: 'ts',
  // Styles
  scss: 'css', sass: 'css', less: 'css',
  // Web
  htm: 'html', xhtml: 'html', xml: 'html',
  // Text
  log: 'txt', csv: 'txt', tsv: 'txt',
};

/**
 * Get the SVG markup for a file-type icon based on file extension.
 * Handles the leading dot: `.ts` or `ts` both work.
 * Returns the generic file icon for unknown extensions.
 */
export function getFileTypeIcon(ext: string): string {
  const clean = ext.replace(/^\./, '').toLowerCase();
  const mapped = _extensionAliases[clean] ?? clean;
  const iconId = _fileTypeMap[mapped];
  if (iconId) return _icons.get(iconId) ?? _icons.get('file') ?? '';
  return _icons.get('file') ?? '';
}

/**
 * Get the SVG markup for a folder icon.
 */
export function getFolderIcon(): string {
  return _icons.get('folder') ?? '';
}

/**
 * Get the SVG markup for a canvas page icon.
 */
export function getPageIcon(): string {
  return _icons.get('page') ?? '';
}

// ── Avatar Icons ──────────────────────────────────────────────────────────────
// All sourced from LUCIDE_ICONS via the generated registry.

/**
 * Ordered array of avatar icon IDs, matching the persona picker's display order.
 */
export const AVATAR_ICON_IDS: readonly string[] = [
  'avatar-brain', 'avatar-briefcase', 'avatar-pen', 'avatar-coins',
  'avatar-microscope', 'avatar-chart', 'avatar-target', 'avatar-robot',
  'avatar-fox', 'avatar-wave', 'avatar-lightning', 'avatar-puzzle',
];

/**
 * Get the SVG markup for an avatar icon by its registry ID.
 * Returns an empty string if the ID is unknown.
 */
export function getAvatarIcon(id: string): string {
  return _icons.get(id) ?? '';
}

// ── Icon Rendering Helper ─────────────────────────────────────────────────────

/**
 * Create an HTMLElement rendering the given icon at the specified CSS size.
 * Uses the global registry — works with any icon ID.
 */
export function createIconElement(iconId: string, size = 16): HTMLElement {
  const span = document.createElement('span');
  span.className = 'svg-icon';
  span.innerHTML = getIcon(iconId);
  const svg = span.querySelector('svg');
  if (svg) {
    svg.setAttribute('width', String(size));
    svg.setAttribute('height', String(size));
  }
  span.style.width = `${size}px`;
  span.style.height = `${size}px`;
  span.style.display = 'inline-flex';
  span.style.alignItems = 'center';
  span.style.justifyContent = 'center';
  span.style.flexShrink = '0';
  return span;
}
