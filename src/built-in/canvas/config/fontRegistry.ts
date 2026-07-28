// fontRegistry.ts — the single source of truth for canvas page fonts.
//
// Replaces the old closed `'default' | 'serif' | 'mono'` enum with an open
// registry: a curated set of built-in system-font stacks (offline — no
// bundled binaries) plus a user-uploaded custom-font library persisted in
// the workspace settings store.
//
// A page's `fontFamily` is a font *id* from this registry. Rendering resolves
// the id to a concrete font stack (via `--canvas-page-font`); export resolves
// the same stack plus, for custom fonts, an embeddable `@font-face` rule.
//
// VS Code reference: None — Parallx canvas.

import { getGlobalSettingsRegistry } from '../../../services/settingsRegistryService.js';

// ─── Keys ────────────────────────────────────────────────────────────────────

/** Workspace default font id — the font a newly created page starts with. */
export const CANVAS_DEFAULT_FONT_KEY = 'canvas.defaultFontFamily';
/** Persisted custom-font library (workspace, object). */
export const CANVAS_CUSTOM_FONTS_KEY = 'canvas.customFonts';

/** Fallback font id when a page references a font that no longer exists. */
export const FALLBACK_FONT_ID = 'default';

// ─── Types ───────────────────────────────────────────────────────────────────

export type FontFaceFormat = 'woff2' | 'woff' | 'truetype' | 'opentype';

export interface CanvasFont {
  /** Stable id stored on the page (e.g. 'serif', 'custom:<uuid>'). */
  readonly id: string;
  /** Human label shown in the picker. */
  readonly label: string;
  /** Concrete CSS font-family stack (no CSS vars — works on-screen and in export). */
  readonly stack: string;
  readonly source: 'builtin' | 'custom';
  /** For custom fonts: the embedded `data:` URL of the font file. */
  readonly dataUrl?: string;
  /** For custom fonts: the `@font-face` src format hint. */
  readonly format?: FontFaceFormat;
}

/** Persisted shape of the custom-font library setting. */
interface PersistedCustomFont {
  readonly id: string;
  readonly label: string;
  readonly dataUrl: string;
  readonly format: FontFaceFormat;
}
interface PersistedCustomFonts {
  readonly fonts: readonly PersistedCustomFont[];
}

// ─── Built-in fonts ──────────────────────────────────────────────────────────
//
// Curated, tasteful, and varied. Each is a robust stack that renders as a real
// distinct face on Windows and degrades gracefully elsewhere. `default`,
// `serif`, and `mono` keep their historical ids so existing pages resolve.

const SANS_FALLBACK = `-apple-system, BlinkMacSystemFont, 'Segoe UI', system-ui, sans-serif`;

export const BUILTIN_FONTS: readonly CanvasFont[] = [
  { id: 'default',   label: 'Default',    source: 'builtin', stack: `'Inter', ${SANS_FALLBACK}` },
  { id: 'serif',     label: 'Serif',      source: 'builtin', stack: `Georgia, 'Times New Roman', ui-serif, serif` },
  { id: 'mono',      label: 'Mono',       source: 'builtin', stack: `'Cascadia Code', 'Cascadia Mono', Consolas, 'Courier New', ui-monospace, monospace` },
  { id: 'system',    label: 'System UI',  source: 'builtin', stack: SANS_FALLBACK },
  { id: 'verdana',   label: 'Verdana',    source: 'builtin', stack: `Verdana, Geneva, ${SANS_FALLBACK}` },
  { id: 'trebuchet', label: 'Trebuchet',  source: 'builtin', stack: `'Trebuchet MS', 'Segoe UI', Tahoma, sans-serif` },
  { id: 'cambria',   label: 'Cambria',    source: 'builtin', stack: `Cambria, Constantia, Georgia, serif` },
  { id: 'times',     label: 'Times',      source: 'builtin', stack: `'Times New Roman', Times, ui-serif, serif` },
  { id: 'garamond',  label: 'Garamond',   source: 'builtin', stack: `Garamond, 'EB Garamond', 'Palatino Linotype', 'Book Antiqua', Palatino, ui-serif, serif` },
  { id: 'courier',   label: 'Typewriter', source: 'builtin', stack: `'Courier New', Courier, ui-monospace, monospace` },
  { id: 'casual',    label: 'Casual',     source: 'builtin', stack: `'Comic Sans MS', 'Comic Sans', 'Segoe Print', ui-rounded, cursive` },
];

const BUILTIN_BY_ID = new Map(BUILTIN_FONTS.map((f) => [f.id, f]));

// ─── Custom-font state (renderer, in-memory mirror of the setting) ────────────

const _customFonts = new Map<string, CanvasFont>();
let _loaded = false;
let _styleEl: HTMLStyleElement | null = null;

/** CSS family name for a custom font id (quoted at use sites). */
function cssFamilyForId(id: string): string {
  return `pxfont-${id.replace(/[^a-zA-Z0-9_-]/g, '-')}`;
}

/** The concrete stack for a custom font: its own face first, then sans. */
function customStack(id: string): string {
  return `"${cssFamilyForId(id)}", ${SANS_FALLBACK}`;
}

/** The `@font-face` rule for one custom font (used on-screen and in export). */
export function fontFaceRule(font: CanvasFont): string {
  if (font.source !== 'custom' || !font.dataUrl) return '';
  const fmt = font.format ?? 'woff2';
  return `@font-face { font-family: "${cssFamilyForId(font.id)}"; ` +
    `src: url("${font.dataUrl}") format("${fmt}"); font-display: swap; }`;
}

function ensureStyleEl(): HTMLStyleElement | null {
  if (typeof document === 'undefined') return null;
  if (!_styleEl) {
    _styleEl = document.getElementById('canvas-custom-fonts') as HTMLStyleElement | null;
    if (!_styleEl) {
      _styleEl = document.createElement('style');
      _styleEl.id = 'canvas-custom-fonts';
      document.head.appendChild(_styleEl);
    }
  }
  return _styleEl;
}

/** Rebuild the injected `@font-face` block from the current custom map. */
function rebuildStyleEl(): void {
  const el = ensureStyleEl();
  if (!el) return;
  el.textContent = [..._customFonts.values()].map(fontFaceRule).join('\n');
}

// ─── Persistence ─────────────────────────────────────────────────────────────

function readPersisted(): PersistedCustomFont[] {
  const reg = getGlobalSettingsRegistry();
  if (!reg?.getSchema(CANVAS_CUSTOM_FONTS_KEY)) return [];
  try {
    const raw = reg.getValue<PersistedCustomFonts>(CANVAS_CUSTOM_FONTS_KEY);
    const fonts = raw?.fonts;
    return Array.isArray(fonts) ? fonts.filter((f) => f && f.id && f.dataUrl) : [];
  } catch { return []; }
}

async function persist(): Promise<void> {
  const reg = getGlobalSettingsRegistry();
  if (!reg?.getSchema(CANVAS_CUSTOM_FONTS_KEY)) return;
  const fonts: PersistedCustomFont[] = [..._customFonts.values()].map((f) => ({
    id: f.id, label: f.label, dataUrl: f.dataUrl ?? '', format: f.format ?? 'woff2',
  }));
  try { await reg.setValue(CANVAS_CUSTOM_FONTS_KEY, { fonts }); } catch { /* best-effort */ }
}

function toCanvasFont(p: PersistedCustomFont): CanvasFont {
  return { id: p.id, label: p.label, source: 'custom', stack: customStack(p.id), dataUrl: p.dataUrl, format: p.format };
}

/**
 * Load the custom-font library from settings and inject its `@font-face`
 * rules so the fonts are available for rendering and previews app-wide.
 * Idempotent; call once on canvas activation.
 */
export function loadCustomFonts(): void {
  _customFonts.clear();
  for (const p of readPersisted()) _customFonts.set(p.id, toCanvasFont(p));
  _loaded = true;
  rebuildStyleEl();
}

function ensureLoaded(): void {
  if (!_loaded) loadCustomFonts();
}

// ─── Public API ──────────────────────────────────────────────────────────────

/** All fonts (built-ins first, then custom) for the picker. */
export function listFonts(): CanvasFont[] {
  ensureLoaded();
  return [...BUILTIN_FONTS, ..._customFonts.values()];
}

export function getBuiltinFonts(): readonly CanvasFont[] { return BUILTIN_FONTS; }

export function getCustomFonts(): CanvasFont[] {
  ensureLoaded();
  return [..._customFonts.values()];
}

export function getFont(id: string | null | undefined): CanvasFont {
  ensureLoaded();
  if (id) {
    const found = BUILTIN_BY_ID.get(id) ?? _customFonts.get(id);
    if (found) return found;
  }
  return BUILTIN_BY_ID.get(FALLBACK_FONT_ID)!;
}

/** Concrete CSS font-family stack for a font id (falls back to default). */
export function resolveFontStack(id: string | null | undefined): string {
  return getFont(id).stack;
}

/** `@font-face` CSS for a font id if it is a custom font, else '' (for export). */
export function getFontFaceCss(id: string | null | undefined): string {
  const font = getFont(id);
  return fontFaceRule(font);
}

/** The workspace default font id used to seed newly created pages. */
export function getWorkspaceDefaultFontId(): string {
  const reg = getGlobalSettingsRegistry();
  if (reg?.getSchema(CANVAS_DEFAULT_FONT_KEY)) {
    try {
      const id = reg.getValue<string>(CANVAS_DEFAULT_FONT_KEY);
      if (typeof id === 'string' && id) return id;
    } catch { /* fall through */ }
  }
  return FALLBACK_FONT_ID;
}

/** Persist the workspace default font id (affects future new pages only). */
export async function setWorkspaceDefaultFontId(id: string): Promise<void> {
  const reg = getGlobalSettingsRegistry();
  if (!reg?.getSchema(CANVAS_DEFAULT_FONT_KEY)) return;
  try { await reg.setValue(CANVAS_DEFAULT_FONT_KEY, id); } catch { /* best-effort */ }
}

/** Map a font file extension to its mime + `@font-face` format hint. */
export function fontFormatFromExtension(ext: string): { mime: string; format: FontFaceFormat } | null {
  switch (ext.replace(/^\./, '').toLowerCase()) {
    case 'woff2': return { mime: 'font/woff2', format: 'woff2' };
    case 'woff':  return { mime: 'font/woff',  format: 'woff' };
    case 'ttf':   return { mime: 'font/ttf',   format: 'truetype' };
    case 'otf':   return { mime: 'font/otf',   format: 'opentype' };
    default:      return null;
  }
}

/**
 * Register a user-uploaded custom font. Injects its `@font-face`, adds it to
 * the registry, and persists the library. Returns the new font.
 */
export async function registerCustomFont(label: string, dataUrl: string, format: FontFaceFormat): Promise<CanvasFont> {
  ensureLoaded();
  const id = `custom:${crypto.randomUUID()}`;
  const font: CanvasFont = { id, label: label || 'Custom font', source: 'custom', stack: customStack(id), dataUrl, format };
  _customFonts.set(id, font);
  rebuildStyleEl();
  await persist();
  return font;
}

/** Remove a custom font from the registry and persist. */
export async function removeCustomFont(id: string): Promise<void> {
  ensureLoaded();
  if (_customFonts.delete(id)) {
    rebuildStyleEl();
    await persist();
  }
}

export function isCustomFontId(id: string | null | undefined): boolean {
  return !!id && id.startsWith('custom:');
}
