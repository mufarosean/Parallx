// fileTypeIcons.ts — Curated file-type icon set with baked-in colors
//
// These are NOT themeable. Each icon has its own recognizable color, matching
// the universally-expected file-type associations (PDF = red, Excel = green,
// Word = blue, etc.). They are simple, clean shapes with fill colors — consistent
// with the minimalist Lucide aesthetic but instantly distinguishable.
//
// Icons use a 24×24 viewBox to match the Lucide spec. Colors are inline fills
// so they render correctly regardless of the parent element's CSS `color`.

// ── Helper ────────────────────────────────────────────────────────────────────

/** Wrap a colored inner shape in the standard 24×24 SVG container. */
function svg(inner: string): string {
  return `<svg viewBox="0 0 24 24" fill="none" xmlns="http://www.w3.org/2000/svg">${inner}</svg>`;
}

/** Document base shape — rounded-corner page with folded corner. */
function docBase(fillColor: string, label: string, labelColor = '#fff'): string {
  return svg(
    // Page body
    `<path d="M6 2a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8l-6-6H6z" fill="${fillColor}" opacity="0.15"/>` +
    `<path d="M6 2a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8l-6-6H6z" stroke="${fillColor}" stroke-width="1.5" fill="none"/>` +
    // Folded corner
    `<path d="M14 2v4a2 2 0 0 0 2 2h4" stroke="${fillColor}" stroke-width="1.5" fill="none"/>` +
    // Label text
    `<text x="12" y="17" text-anchor="middle" font-size="6" font-weight="700" font-family="system-ui,sans-serif" fill="${labelColor}">${label}</text>`
  );
}

/** Media base shape — rounded rectangle with centered symbol. */
function mediaBase(fillColor: string, innerSvg: string): string {
  return svg(
    `<rect x="3" y="3" width="18" height="18" rx="3" fill="${fillColor}" opacity="0.15"/>` +
    `<rect x="3" y="3" width="18" height="18" rx="3" stroke="${fillColor}" stroke-width="1.5" fill="none"/>` +
    innerSvg
  );
}

// ── File-Type Icons ───────────────────────────────────────────────────────────

/** Map of filetype icon IDs → colored SVG markup. */
export const FILE_TYPE_ICONS: Record<string, string> = {
  // ── Documents ─────────────────────────────────────────────────────────
  'filetype-pdf':   docBase('#e53e3e', 'PDF'),
  'filetype-doc':   docBase('#2b6cb0', 'DOC'),
  'filetype-docx':  docBase('#2b6cb0', 'DOCX'),
  'filetype-rtf':   docBase('#4a7fb5', 'RTF'),
  'filetype-odt':   docBase('#3182ce', 'ODT'),
  'filetype-epub':  docBase('#6b46c1', 'EPUB'),
  'filetype-txt':   docBase('#718096', 'TXT'),
  'filetype-md':    docBase('#4299e1', 'MD'),

  // ── Spreadsheets ──────────────────────────────────────────────────────
  'filetype-xlsx':  docBase('#38a169', 'XLS'),
  'filetype-xls':   docBase('#38a169', 'XLS'),
  'filetype-csv':   docBase('#48bb78', 'CSV'),
  'filetype-tsv':   docBase('#48bb78', 'TSV'),
  'filetype-ods':   docBase('#2f855a', 'ODS'),
  'filetype-numbers': docBase('#38a169', 'NUM'),

  // ── Presentations ─────────────────────────────────────────────────────
  'filetype-pptx':  docBase('#dd6b20', 'PPT'),
  'filetype-ppt':   docBase('#dd6b20', 'PPT'),
  'filetype-odp':   docBase('#ed8936', 'ODP'),
  'filetype-key':   docBase('#ed8936', 'KEY'),

  // ── Images ────────────────────────────────────────────────────────────
  'filetype-image': mediaBase('#9f7aea',
    // Mountain + sun symbol
    `<path d="M7 15l3-3 2 2 3-4 4 5H5z" fill="#9f7aea" opacity="0.6"/>` +
    `<circle cx="8.5" cy="9.5" r="1.5" fill="#9f7aea"/>`
  ),

  // ── Video ─────────────────────────────────────────────────────────────
  'filetype-video': mediaBase('#e53e3e',
    // Play triangle
    `<path d="M10 8l6 4-6 4V8z" fill="#e53e3e"/>`
  ),

  // ── Audio ─────────────────────────────────────────────────────────────
  'filetype-audio': mediaBase('#ed8936',
    // Music note
    `<path d="M9 18V6l8-2v12" stroke="#ed8936" stroke-width="1.5" fill="none"/>` +
    `<circle cx="7" cy="18" r="2" fill="#ed8936"/>` +
    `<circle cx="15" cy="16" r="2" fill="#ed8936"/>`
  ),

  // ── Archives ──────────────────────────────────────────────────────────
  'filetype-archive': mediaBase('#a0aec0',
    // Zipper lines
    `<path d="M11 6h2v2h-2zm0 4h2v2h-2zm0 4h2v2h-2z" fill="#a0aec0"/>` +
    `<path d="M10 17h4v2h-4z" fill="#a0aec0" opacity="0.6"/>`
  ),

  // ── Code ──────────────────────────────────────────────────────────────
  'filetype-ts':    docBase('#3178c6', 'TS'),
  'filetype-js':    docBase('#f0db4f', 'JS', '#333'),
  'filetype-jsx':   docBase('#61dafb', 'JSX', '#333'),
  'filetype-tsx':   docBase('#3178c6', 'TSX'),
  'filetype-py':    docBase('#3776ab', 'PY'),
  'filetype-rs':    docBase('#dea584', 'RS', '#333'),
  'filetype-go':    docBase('#00add8', 'GO', '#333'),
  'filetype-html':  docBase('#e34c26', 'HTM'),
  'filetype-css':   docBase('#264de4', 'CSS'),
  'filetype-json':  docBase('#cbcb41', 'JSON', '#333'),
  'filetype-yaml':  docBase('#cb171e', 'YML'),
  'filetype-xml':   docBase('#e37933', 'XML'),
  'filetype-sql':   docBase('#336791', 'SQL'),

  // ── Data / Config ─────────────────────────────────────────────────────
  'filetype-db':    docBase('#336791', 'DB'),
  'filetype-sqlite': docBase('#336791', 'DB'),
  'filetype-log':   docBase('#a0aec0', 'LOG'),
  'filetype-env':   docBase('#ecc94b', 'ENV', '#333'),

  // ── Folder (clean white with grey accents) ──────────────────────────
  'filetype-folder': svg(
    `<path d="M2 6a2 2 0 0 1 2-2h4l2 2h8a2 2 0 0 1 2 2v10a2 2 0 0 1-2 2H4a2 2 0 0 1-2-2V6z" fill="#ffffff" stroke="#ffffff" stroke-width="1.5"/>`
  ),
  'filetype-folder-open': svg(
    `<path d="M2 6a2 2 0 0 1 2-2h4l2 2h8a2 2 0 0 1 2 2v1H6.5a2 2 0 0 0-1.9 1.4L2 18V6z" fill="#ffffff" stroke="#ffffff" stroke-width="1.5"/>` +
    `<path d="M4.6 11H20l-2.4 8H2.2l2.4-8z" fill="#d1d5db" stroke="#d1d5db" stroke-width="1.5"/>`
  ),
};

// ── File Extension → Icon ID Mapping ──────────────────────────────────────────

/**
 * Complete mapping from file extension (lowercase, no dot) to filetype icon ID.
 * Used by getFileTypeIcon() in iconRegistry.ts.
 */
export const FILE_TYPE_MAP: Record<string, string> = {
  // Documents
  pdf:      'filetype-pdf',
  doc:      'filetype-doc',
  docx:     'filetype-docx',
  rtf:      'filetype-rtf',
  odt:      'filetype-odt',
  epub:     'filetype-epub',
  txt:      'filetype-txt',
  md:       'filetype-md',
  markdown: 'filetype-md',

  // Spreadsheets
  xlsx:     'filetype-xlsx',
  xls:      'filetype-xls',
  xlsm:     'filetype-xlsx',
  xlsb:     'filetype-xlsx',
  csv:      'filetype-csv',
  tsv:      'filetype-tsv',
  ods:      'filetype-ods',
  numbers:  'filetype-numbers',

  // Presentations
  pptx:     'filetype-pptx',
  ppt:      'filetype-ppt',
  odp:      'filetype-odp',
  key:      'filetype-key',

  // Images
  jpg:      'filetype-image',
  jpeg:     'filetype-image',
  png:      'filetype-image',
  gif:      'filetype-image',
  webp:     'filetype-image',
  svg:      'filetype-image',
  ico:      'filetype-image',
  bmp:      'filetype-image',
  tiff:     'filetype-image',
  tif:      'filetype-image',
  heic:     'filetype-image',
  avif:     'filetype-image',

  // Video
  mp4:      'filetype-video',
  mov:      'filetype-video',
  avi:      'filetype-video',
  mkv:      'filetype-video',
  webm:     'filetype-video',
  wmv:      'filetype-video',
  flv:      'filetype-video',
  m4v:      'filetype-video',

  // Audio
  mp3:      'filetype-audio',
  wav:      'filetype-audio',
  flac:     'filetype-audio',
  ogg:      'filetype-audio',
  aac:      'filetype-audio',
  wma:      'filetype-audio',
  m4a:      'filetype-audio',
  opus:     'filetype-audio',

  // Archives
  zip:      'filetype-archive',
  rar:      'filetype-archive',
  '7z':     'filetype-archive',
  tar:      'filetype-archive',
  gz:       'filetype-archive',
  bz2:      'filetype-archive',
  xz:       'filetype-archive',

  // Code
  ts:       'filetype-ts',
  mts:      'filetype-ts',
  cts:      'filetype-ts',
  tsx:      'filetype-tsx',
  js:       'filetype-js',
  mjs:      'filetype-js',
  cjs:      'filetype-js',
  jsx:      'filetype-jsx',
  py:       'filetype-py',
  rs:       'filetype-rs',
  go:       'filetype-go',
  html:     'filetype-html',
  htm:      'filetype-html',
  xhtml:    'filetype-html',
  css:      'filetype-css',
  scss:     'filetype-css',
  sass:     'filetype-css',
  less:     'filetype-css',

  // Data / Config
  json:     'filetype-json',
  jsonc:    'filetype-json',
  yaml:     'filetype-yaml',
  yml:      'filetype-yaml',
  toml:     'filetype-yaml',
  xml:      'filetype-xml',
  sql:      'filetype-sql',
  db:       'filetype-db',
  sqlite:   'filetype-sqlite',
  sqlite3:  'filetype-sqlite',
  log:      'filetype-log',
  env:      'filetype-env',
};
