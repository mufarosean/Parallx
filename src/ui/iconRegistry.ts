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

// ── UI Icons ──────────────────────────────────────────────────────────────────
// 24×24 viewBox, stroke-width 1.5, stroke-based, currentColor

const _uiIcons: Record<string, string> = {
  // Documents / Files
  'file-text':    '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"><path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"/><polyline points="14 2 14 8 20 8"/><line x1="16" y1="13" x2="8" y2="13"/><line x1="16" y1="17" x2="8" y2="17"/><polyline points="10 9 9 9 8 9"/></svg>',
  'folder-open':  '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"><path d="M22 19a2 2 0 0 1-2 2H4a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h5l2 3h9a2 2 0 0 1 2 2z"/></svg>',
  'book-open':    '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"><path d="M2 3h6a4 4 0 0 1 4 4v14a3 3 0 0 0-3-3H2z"/><path d="M22 3h-6a4 4 0 0 0-4 4v14a3 3 0 0 1 3-3h7z"/></svg>',
  'notebook':     '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"><path d="M2 3h6a4 4 0 0 1 4 4v14a3 3 0 0 0-3-3H2z"/><path d="M22 3h-6a4 4 0 0 0-4 4v14a3 3 0 0 1 3-3h7z"/><line x1="6" y1="8" x2="6" y2="8"/><line x1="6" y1="12" x2="6" y2="12"/></svg>',

  // Communication
  'message':      '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"><path d="M21 15a2 2 0 0 1-2 2H7l-4 4V5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2z"/></svg>',

  // Actions / Indicators
  'sparkle':      '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"><path d="M12 2l2.4 7.2L22 12l-7.6 2.8L12 22l-2.4-7.2L2 12l7.6-2.8z"/></svg>',
  'wand':         '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"><path d="M15 4l-8.5 8.5a2.12 2.12 0 1 0 3 3L18 7"/><path d="M18 4l2 2"/><path d="M9 2v2"/><path d="M5 6h2"/><path d="M2 9h2"/></svg>',
  'palette':      '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"><circle cx="13.5" cy="6.5" r="0.5" fill="currentColor"/><circle cx="17.5" cy="10.5" r="0.5" fill="currentColor"/><circle cx="8.5" cy="7.5" r="0.5" fill="currentColor"/><circle cx="6.5" cy="12" r="0.5" fill="currentColor"/><path d="M12 2C6.5 2 2 6.5 2 12s4.5 10 10 10c.926 0 1.648-.746 1.648-1.688 0-.437-.18-.835-.437-1.125-.29-.289-.438-.652-.438-1.125a1.64 1.64 0 0 1 1.668-1.668h1.996c3.051 0 5.555-2.503 5.555-5.554C21.965 6.012 17.461 2 12 2z"/></svg>',
  'search':       '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"><circle cx="11" cy="11" r="8"/><line x1="21" y1="21" x2="16.65" y2="16.65"/></svg>',
  'keyboard':     '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"><rect x="2" y="4" width="20" height="16" rx="2" ry="2"/><line x1="6" y1="8" x2="6.01" y2="8"/><line x1="10" y1="8" x2="10.01" y2="8"/><line x1="14" y1="8" x2="14.01" y2="8"/><line x1="18" y1="8" x2="18.01" y2="8"/><line x1="8" y1="12" x2="8.01" y2="12"/><line x1="12" y1="12" x2="12.01" y2="12"/><line x1="16" y1="12" x2="16.01" y2="12"/><line x1="7" y1="16" x2="17" y2="16"/></svg>',
  'bar-chart':    '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"><line x1="12" y1="20" x2="12" y2="10"/><line x1="18" y1="20" x2="18" y2="4"/><line x1="6" y1="20" x2="6" y2="16"/></svg>',
  'pin':          '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"><line x1="12" y1="17" x2="12" y2="22"/><path d="M5 17h14v-1.76a2 2 0 0 0-1.11-1.79l-1.78-.9A2 2 0 0 1 15 10.76V6h1a2 2 0 0 0 0-4H8a2 2 0 0 0 0 4h1v4.76a2 2 0 0 1-1.11 1.79l-1.78.9A2 2 0 0 0 5 15.24z"/></svg>',

  // Status
  'check':        '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"><polyline points="20 6 9 17 4 12"/></svg>',
  'check-circle': '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"><path d="M22 11.08V12a10 10 0 1 1-5.93-9.14"/><polyline points="22 4 12 14.01 9 11.01"/></svg>',
  'x-circle':     '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="12" r="10"/><line x1="15" y1="9" x2="9" y2="15"/><line x1="9" y1="9" x2="15" y2="15"/></svg>',
  'alert-triangle':'<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"><path d="M10.29 3.86L1.82 18a2 2 0 0 0 1.71 3h16.94a2 2 0 0 0 1.71-3L13.71 3.86a2 2 0 0 0-3.42 0z"/><line x1="12" y1="9" x2="12" y2="13"/><line x1="12" y1="17" x2="12.01" y2="17"/></svg>',
  'refresh':      '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"><polyline points="23 4 23 10 17 10"/><polyline points="1 20 1 14 7 14"/><path d="M3.51 9a9 9 0 0 1 14.85-3.36L23 10M1 14l4.64 4.36A9 9 0 0 0 20.49 15"/></svg>',
  'lock':         '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"><rect x="3" y="11" width="18" height="11" rx="2" ry="2"/><path d="M7 11V7a5 5 0 0 1 10 0v4"/></svg>',
  'slash-circle': '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="12" r="10"/><line x1="4.93" y1="4.93" x2="19.07" y2="19.07"/></svg>',
  'puzzle':       '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"><path d="M12 2v4a1 1 0 0 0 1.5.87A2.5 2.5 0 1 1 10.5 9.5 1 1 0 0 0 10 8.63V2h8a2 2 0 0 1 2 2v6a1 1 0 0 0 .87 1A2.5 2.5 0 1 1 18.37 14 1 1 0 0 0 16 14h-2a2 2 0 0 1 2 2v6H4a2 2 0 0 1-2-2V8a2 2 0 0 1 2-2h6"/></svg>',
  'terminal':     '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"><polyline points="4 17 10 11 4 5"/><line x1="12" y1="19" x2="20" y2="19"/></svg>',
};

for (const [id, svg] of Object.entries(_uiIcons)) {
  registerIcon(`ui-${id}`, svg);
}

// ── Icon Rendering Helper ─────────────────────────────────────────────────────

/**
 * Create an HTMLElement rendering the given icon at the specified CSS size.
 * Uses the global registry — works with any prefix (file-*, avatar-*, ui-*, canvas-*, chat-*).
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
