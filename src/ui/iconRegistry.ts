// iconRegistry.ts — Shared icon registry for the entire Parallx application
//
// Central registry: registerIcon(id, svgMarkup) / getIcon(id) / getFileTypeIcon(ext)
//
// All icon modules (canvas, chat, PDF, explorer, search) should register into
// this registry. They can still export convenience accessors but storage is
// centralised here.
//
// Dependency rules: src/ui/ depends only on src/platform/. No service imports.

// ── Registry Map ──────────────────────────────────────────────────────────────

const _icons = new Map<string, string>();

/**
 * Register an SVG icon by ID. Overwrites any previous registration.
 * @param id — Unique icon identifier (e.g. 'file-ts', 'folder', 'avatar-brain')
 * @param svgMarkup — Complete `<svg>` string
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

// ── File-Type Icon Set ────────────────────────────────────────────────────────
// Minimalist 16×16 viewBox, stroke-based, monochrome (currentColor)

const _fileTypeIcons: Record<string, string> = {
  // Generic
  file:   '<svg width="16" height="16" viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.2" stroke-linecap="round" stroke-linejoin="round"><path d="M4 1.5h5l3.5 3.5V14a.5.5 0 0 1-.5.5H4a.5.5 0 0 1-.5-.5V2a.5.5 0 0 1 .5-.5z"/><path d="M9 1.5V5h3.5"/></svg>',
  folder: '<svg width="16" height="16" viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.2" stroke-linecap="round" stroke-linejoin="round"><path d="M1.5 3a.5.5 0 0 1 .5-.5h4l1.5 1.5h6a.5.5 0 0 1 .5.5v8.5a.5.5 0 0 1-.5.5H2a.5.5 0 0 1-.5-.5V3z"/></svg>',

  // Documents
  md:   '<svg width="16" height="16" viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.2" stroke-linecap="round" stroke-linejoin="round"><path d="M4 1.5h5l3.5 3.5V14a.5.5 0 0 1-.5.5H4a.5.5 0 0 1-.5-.5V2a.5.5 0 0 1 .5-.5z"/><path d="M9 1.5V5h3.5"/><path d="M5 9l1.5-2L8 9l1.5-2L11 9" stroke-width="1"/></svg>',
  pdf:  '<svg width="16" height="16" viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.2" stroke-linecap="round" stroke-linejoin="round"><path d="M4 1.5h5l3.5 3.5V14a.5.5 0 0 1-.5.5H4a.5.5 0 0 1-.5-.5V2a.5.5 0 0 1 .5-.5z"/><path d="M9 1.5V5h3.5"/><text x="5.5" y="12" font-size="5" font-weight="bold" fill="currentColor" stroke="none" font-family="sans-serif">PDF</text></svg>',
  txt:  '<svg width="16" height="16" viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.2" stroke-linecap="round" stroke-linejoin="round"><path d="M4 1.5h5l3.5 3.5V14a.5.5 0 0 1-.5.5H4a.5.5 0 0 1-.5-.5V2a.5.5 0 0 1 .5-.5z"/><path d="M9 1.5V5h3.5"/><path d="M6 8h4M6 10h4M6 12h2"/></svg>',

  // Data / Config
  json: '<svg width="16" height="16" viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.2" stroke-linecap="round" stroke-linejoin="round"><path d="M4 1.5h5l3.5 3.5V14a.5.5 0 0 1-.5.5H4a.5.5 0 0 1-.5-.5V2a.5.5 0 0 1 .5-.5z"/><path d="M9 1.5V5h3.5"/><path d="M6 8.5c0-1 .5-1 1-1s1 0 1 1-.5 1-1 1-1 0-1 1" stroke-width="1"/><circle cx="8" cy="12.5" r="0.3" fill="currentColor"/></svg>',
  yaml: '<svg width="16" height="16" viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.2" stroke-linecap="round" stroke-linejoin="round"><path d="M4 1.5h5l3.5 3.5V14a.5.5 0 0 1-.5.5H4a.5.5 0 0 1-.5-.5V2a.5.5 0 0 1 .5-.5z"/><path d="M9 1.5V5h3.5"/><path d="M6 8h4M6 10h3M6 12h2"/></svg>',

  // Code — JavaScript / TypeScript
  js:   '<svg width="16" height="16" viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.2" stroke-linecap="round" stroke-linejoin="round"><path d="M4 1.5h5l3.5 3.5V14a.5.5 0 0 1-.5.5H4a.5.5 0 0 1-.5-.5V2a.5.5 0 0 1 .5-.5z"/><path d="M9 1.5V5h3.5"/><text x="5" y="12" font-size="5" font-weight="bold" fill="currentColor" stroke="none" font-family="sans-serif">JS</text></svg>',
  ts:   '<svg width="16" height="16" viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.2" stroke-linecap="round" stroke-linejoin="round"><path d="M4 1.5h5l3.5 3.5V14a.5.5 0 0 1-.5.5H4a.5.5 0 0 1-.5-.5V2a.5.5 0 0 1 .5-.5z"/><path d="M9 1.5V5h3.5"/><text x="5" y="12" font-size="5" font-weight="bold" fill="currentColor" stroke="none" font-family="sans-serif">TS</text></svg>',
  jsx:  '<svg width="16" height="16" viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.2" stroke-linecap="round" stroke-linejoin="round"><path d="M4 1.5h5l3.5 3.5V14a.5.5 0 0 1-.5.5H4a.5.5 0 0 1-.5-.5V2a.5.5 0 0 1 .5-.5z"/><path d="M9 1.5V5h3.5"/><text x="4.5" y="12" font-size="4.5" font-weight="bold" fill="currentColor" stroke="none" font-family="sans-serif">JSX</text></svg>',
  tsx:  '<svg width="16" height="16" viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.2" stroke-linecap="round" stroke-linejoin="round"><path d="M4 1.5h5l3.5 3.5V14a.5.5 0 0 1-.5.5H4a.5.5 0 0 1-.5-.5V2a.5.5 0 0 1 .5-.5z"/><path d="M9 1.5V5h3.5"/><text x="4.5" y="12" font-size="4.5" font-weight="bold" fill="currentColor" stroke="none" font-family="sans-serif">TSX</text></svg>',

  // Code — other
  py:   '<svg width="16" height="16" viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.2" stroke-linecap="round" stroke-linejoin="round"><path d="M4 1.5h5l3.5 3.5V14a.5.5 0 0 1-.5.5H4a.5.5 0 0 1-.5-.5V2a.5.5 0 0 1 .5-.5z"/><path d="M9 1.5V5h3.5"/><text x="5.5" y="12" font-size="5" font-weight="bold" fill="currentColor" stroke="none" font-family="sans-serif">PY</text></svg>',
  rs:   '<svg width="16" height="16" viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.2" stroke-linecap="round" stroke-linejoin="round"><path d="M4 1.5h5l3.5 3.5V14a.5.5 0 0 1-.5.5H4a.5.5 0 0 1-.5-.5V2a.5.5 0 0 1 .5-.5z"/><path d="M9 1.5V5h3.5"/><text x="5.5" y="12" font-size="5" font-weight="bold" fill="currentColor" stroke="none" font-family="sans-serif">RS</text></svg>',
  go:   '<svg width="16" height="16" viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.2" stroke-linecap="round" stroke-linejoin="round"><path d="M4 1.5h5l3.5 3.5V14a.5.5 0 0 1-.5.5H4a.5.5 0 0 1-.5-.5V2a.5.5 0 0 1 .5-.5z"/><path d="M9 1.5V5h3.5"/><text x="5.5" y="12" font-size="5" font-weight="bold" fill="currentColor" stroke="none" font-family="sans-serif">GO</text></svg>',

  // Styles
  css:  '<svg width="16" height="16" viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.2" stroke-linecap="round" stroke-linejoin="round"><path d="M4 1.5h5l3.5 3.5V14a.5.5 0 0 1-.5.5H4a.5.5 0 0 1-.5-.5V2a.5.5 0 0 1 .5-.5z"/><path d="M9 1.5V5h3.5"/><text x="4.5" y="12" font-size="5" font-weight="bold" fill="currentColor" stroke="none" font-family="sans-serif">CSS</text></svg>',
  html: '<svg width="16" height="16" viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.2" stroke-linecap="round" stroke-linejoin="round"><path d="M4 1.5h5l3.5 3.5V14a.5.5 0 0 1-.5.5H4a.5.5 0 0 1-.5-.5V2a.5.5 0 0 1 .5-.5z"/><path d="M9 1.5V5h3.5"/><path d="M6 9l-1 2 1 2M10 9l1 2-1 2" stroke-width="1"/></svg>',

  // Images
  image: '<svg width="16" height="16" viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.2" stroke-linecap="round" stroke-linejoin="round"><rect x="1.5" y="2.5" width="13" height="11" rx="1"/><circle cx="5" cy="6" r="1.2"/><path d="M1.5 11l3.5-3 2.5 2 3-3.5L14.5 11"/></svg>',

  // Page (canvas page)
  page: '<svg width="16" height="16" viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.2" stroke-linecap="round" stroke-linejoin="round"><rect x="2.5" y="1.5" width="11" height="13" rx="1"/><path d="M5 5h6M5 7.5h6M5 10h4"/></svg>',
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

// Register all built-in file-type icons at module load
for (const [id, svg] of Object.entries(_fileTypeIcons)) {
  registerIcon(`file-${id}`, svg);
}

/**
 * Get the SVG markup for a file-type icon based on file extension.
 * Handles the leading dot: `.ts` or `ts` both work.
 * Returns the generic file icon for unknown extensions.
 *
 * @param ext — file extension (e.g. '.ts', 'md', '.pdf')
 */
export function getFileTypeIcon(ext: string): string {
  const clean = ext.replace(/^\./, '').toLowerCase();
  const mapped = _extensionAliases[clean] ?? clean;
  return _icons.get(`file-${mapped}`) ?? _icons.get('file-file') ?? '';
}

/**
 * Get the SVG markup for a folder icon.
 */
export function getFolderIcon(): string {
  return _icons.get('file-folder') ?? '';
}

/**
 * Get the SVG markup for a canvas page icon.
 */
export function getPageIcon(): string {
  return _icons.get('file-page') ?? '';
}

// ── Avatar Icon Set ───────────────────────────────────────────────────────────
// 12 minimalist 20×20 SVG avatars, stroke-based, monochrome (currentColor)
// Mapped to the same order as the previous emoji set:
//   🧠 💼 ✍️ 💰 🔬 📊 🎯 🤖 🦊 🌊 ⚡ 🧩

const _avatarIcons: Record<string, string> = {
  brain:      '<svg width="20" height="20" viewBox="0 0 20 20" fill="none" stroke="currentColor" stroke-width="1.3" stroke-linecap="round" stroke-linejoin="round"><path d="M10 17V10"/><path d="M7 3.5C5.5 3.5 4 4.8 4 6.5c0 1-.2 1.8-.8 2.5C2.5 10 3 12 4.5 12.5c.5 1.5 2 2.5 3.5 2.5"/><path d="M13 3.5c1.5 0 3 1.3 3 3 0 1 .2 1.8.8 2.5.7 1 .2 3-1.3 3.5-.5 1.5-2 2.5-3.5 2.5"/><path d="M7 3.5C7 2.5 8.3 1.5 10 1.5s3 1 3 2"/></svg>',
  briefcase:  '<svg width="20" height="20" viewBox="0 0 20 20" fill="none" stroke="currentColor" stroke-width="1.3" stroke-linecap="round" stroke-linejoin="round"><rect x="2" y="6" width="16" height="11" rx="1.5"/><path d="M7 6V4.5A1.5 1.5 0 0 1 8.5 3h3A1.5 1.5 0 0 1 13 4.5V6"/><path d="M2 10h16"/></svg>',
  pen:        '<svg width="20" height="20" viewBox="0 0 20 20" fill="none" stroke="currentColor" stroke-width="1.3" stroke-linecap="round" stroke-linejoin="round"><path d="M14.5 2.5l3 3L7 16l-4 1 1-4L14.5 2.5z"/><path d="M12 5l3 3"/></svg>',
  coins:      '<svg width="20" height="20" viewBox="0 0 20 20" fill="none" stroke="currentColor" stroke-width="1.3" stroke-linecap="round" stroke-linejoin="round"><ellipse cx="8" cy="7" rx="5" ry="2.5"/><path d="M3 7v4c0 1.4 2.2 2.5 5 2.5"/><path d="M13 7v0"/><ellipse cx="12" cy="11" rx="5" ry="2.5"/><path d="M7 11v4c0 1.4 2.2 2.5 5 2.5s5-1.1 5-2.5v-4"/></svg>',
  microscope: '<svg width="20" height="20" viewBox="0 0 20 20" fill="none" stroke="currentColor" stroke-width="1.3" stroke-linecap="round" stroke-linejoin="round"><path d="M8 2.5l4 9"/><path d="M7 2.5h2"/><circle cx="11" cy="12.5" r="3"/><path d="M4 17h12"/><path d="M8 14.5v2.5"/><path d="M14 12.5h2"/></svg>',
  chart:      '<svg width="20" height="20" viewBox="0 0 20 20" fill="none" stroke="currentColor" stroke-width="1.3" stroke-linecap="round" stroke-linejoin="round"><path d="M3 17V5"/><path d="M3 17h14"/><path d="M6 13V9"/><path d="M10 13V6"/><path d="M14 13V3"/></svg>',
  target:     '<svg width="20" height="20" viewBox="0 0 20 20" fill="none" stroke="currentColor" stroke-width="1.3" stroke-linecap="round" stroke-linejoin="round"><circle cx="10" cy="10" r="7.5"/><circle cx="10" cy="10" r="4"/><circle cx="10" cy="10" r="1"/></svg>',
  robot:      '<svg width="20" height="20" viewBox="0 0 20 20" fill="none" stroke="currentColor" stroke-width="1.3" stroke-linecap="round" stroke-linejoin="round"><rect x="4" y="6" width="12" height="10" rx="2"/><path d="M10 3v3"/><circle cx="10" cy="2.5" r="1"/><circle cx="7.5" cy="10" r="1.2"/><circle cx="12.5" cy="10" r="1.2"/><path d="M7.5 13.5h5"/><path d="M1 10h3M16 10h3"/></svg>',
  fox:        '<svg width="20" height="20" viewBox="0 0 20 20" fill="none" stroke="currentColor" stroke-width="1.3" stroke-linecap="round" stroke-linejoin="round"><path d="M4 3l2 6h8l2-6"/><path d="M6 9c-2 1-3 3-3 5 3 3 7 3 7 3s4 0 7-3c0-2-1-4-3-5"/><circle cx="8" cy="11" r="0.8" fill="currentColor"/><circle cx="12" cy="11" r="0.8" fill="currentColor"/><path d="M9 13.5l1 1 1-1"/></svg>',
  wave:       '<svg width="20" height="20" viewBox="0 0 20 20" fill="none" stroke="currentColor" stroke-width="1.3" stroke-linecap="round" stroke-linejoin="round"><path d="M2 12c1.5-2 3-4 4.5 0s3 2 4.5 0 3-4 4.5 0 1.5 2 1.5 2"/><path d="M2 8c1.5-2 3-4 4.5 0s3 2 4.5 0 3-4 4.5 0 1.5 2 1.5 2"/></svg>',
  lightning:  '<svg width="20" height="20" viewBox="0 0 20 20" fill="none" stroke="currentColor" stroke-width="1.3" stroke-linecap="round" stroke-linejoin="round"><path d="M11.5 1.5L5 11h4.5l-1 7.5L15 9h-4.5l1-7.5z"/></svg>',
  puzzle:     '<svg width="20" height="20" viewBox="0 0 20 20" fill="none" stroke="currentColor" stroke-width="1.3" stroke-linecap="round" stroke-linejoin="round"><path d="M9 2.5h5v4.5h.5a1.5 1.5 0 0 1 0 3H14V14.5H9.5V14a1.5 1.5 0 0 0-3 0v.5H2V10h.5a1.5 1.5 0 0 0 0-3H2V2.5h4v.5a1.5 1.5 0 0 0 3 0V2.5z"/></svg>',
};

// Register all avatar icons at module load
for (const [id, svg] of Object.entries(_avatarIcons)) {
  registerIcon(`avatar-${id}`, svg);
}

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

// ── Gear / Settings Icon ──────────────────────────────────────────────────────

const _gearSvg = '<svg width="16" height="16" viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.2" stroke-linecap="round" stroke-linejoin="round"><circle cx="8" cy="8" r="2.5"/><path d="M8 1.5v1.3M8 13.2v1.3M1.5 8h1.3M13.2 8h1.3M3.4 3.4l.9.9M11.7 11.7l.9.9M12.6 3.4l-.9.9M4.3 11.7l-.9.9"/></svg>';
registerIcon('gear', _gearSvg);
