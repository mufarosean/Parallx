// pxAppearance.ts — M83 user-facing theme control (the real theming system).
//
// Replaces the old VS Code-style color registry as the user's path to
// change the look. Two axes:
//   1. Base palette  — Slate (default) / Warm / Ember (sets data-px-theme)
//   2. Accent        — a curated set, or a custom hue (sets --px-accent-*)
//
// Persisted to localStorage so it applies synchronously on boot (no flash),
// and survives relaunch. Everything flows through the --px token system, so
// changing one value re-skins the whole app + extensions via the bridge.

const STORAGE_KEY = 'px-appearance';
const PRESETS_KEY = 'px-appearance-presets';

export type PxBaseTheme = 'slate' | 'warm' | 'ember';
export type PxMode = 'light' | 'dark';

export interface PxAccent {
  readonly id: string;
  readonly label: string;
  readonly h: number;
  readonly s: number;   // percent
  readonly l: number;   // percent
  readonly rgb: string; // "r, g, b" — kept ~in sync for rgba() tokens
}

export interface PxAppearanceState {
  /** Light or dark — drives both the --px chrome and the VS Code editor base theme. */
  mode: PxMode;
  base: PxBaseTheme;     // the "mood": slate / warm / ember (applies in both modes)
  accent: string;        // accent id, or 'custom'
  customHue?: number;    // 0-360 when accent === 'custom'
  /** UI font id from PX_FONTS; 'inter' (the default stack) when absent. */
  font?: string;
}

/** The app-wide UI font. One choice, every surface: the workbench root
 *  reads `--parallx-fontFamily-ui`, and every surface token aliases it. */
export interface PxFont {
  readonly id: string;
  readonly label: string;
  readonly stack: string;
}

export const PX_FONTS: readonly PxFont[] = [
  { id: 'inter',   label: 'Inter',    stack: "'Inter', -apple-system, BlinkMacSystemFont, 'Segoe UI Variable Text', 'Segoe UI', system-ui, sans-serif" },
  { id: 'system',  label: 'System',   stack: "system-ui, -apple-system, BlinkMacSystemFont, 'Segoe UI Variable Text', 'Segoe UI', sans-serif" },
  { id: 'segoe',   label: 'Segoe UI', stack: "'Segoe UI Variable Text', 'Segoe UI', system-ui, sans-serif" },
  { id: 'verdana', label: 'Verdana',  stack: "Verdana, Geneva, 'DejaVu Sans', sans-serif" },
  { id: 'georgia', label: 'Georgia',  stack: "Georgia, 'Times New Roman', Times, serif" },
  { id: 'mono',    label: 'Mono',     stack: "'JetBrains Mono', 'Cascadia Code', Consolas, 'Courier New', monospace" },
];

export const DEFAULT_FONT_ID = 'inter';

export function resolveFontStack(id: string | undefined): string {
  return (PX_FONTS.find(f => f.id === id) ?? PX_FONTS[0]).stack;
}

export const PX_BASE_THEMES: { id: PxBaseTheme; label: string; desc: string; swatch: string }[] = [
  { id: 'slate', label: 'Slate', desc: 'Cool graphite, calm and neutral', swatch: '#16171a' },
  { id: 'warm',  label: 'Warm',  desc: 'Warm charcoal, soft and inviting', swatch: '#1b1a17' },
  { id: 'ember', label: 'Ember', desc: 'Warm graphite, the most distinctive', swatch: '#1a1815' },
];

// Curated accents — tasteful, restrained, none of them the slop purple.
export const PX_ACCENTS: PxAccent[] = [
  { id: 'steel',  label: 'Steel',  h: 205, s: 64, l: 60, rgb: '86, 156, 214' },
  { id: 'indigo', label: 'Indigo', h: 226, s: 58, l: 65, rgb: '122, 138, 230' },
  { id: 'teal',   label: 'Teal',   h: 182, s: 48, l: 52, rgb: '74, 178, 178' },
  { id: 'sage',   label: 'Sage',   h: 156, s: 42, l: 54, rgb: '95, 178, 140' },
  { id: 'amber',  label: 'Amber',  h: 34,  s: 76, l: 58, rgb: '224, 162, 78' },
  { id: 'rose',   label: 'Rose',   h: 348, s: 62, l: 66, rgb: '222, 122, 142' },
  { id: 'mono',   label: 'Graphite', h: 220, s: 8, l: 62, rgb: '150, 156, 168' },
];

const DEFAULT_STATE: PxAppearanceState = { mode: 'dark', base: 'slate', accent: 'steel' };

function normalizeAppearance(parsed: Partial<PxAppearanceState> | null | undefined): PxAppearanceState {
  if (!parsed || typeof parsed !== 'object') return { ...DEFAULT_STATE };
  return {
    mode: parsed.mode === 'light' ? 'light' : 'dark',
    base: (parsed.base === 'warm' || parsed.base === 'ember') ? parsed.base : 'slate',
    accent: typeof parsed.accent === 'string' ? parsed.accent : 'steel',
    customHue: typeof parsed.customHue === 'number' ? parsed.customHue : undefined,
    font: PX_FONTS.some(f => f.id === parsed.font) ? parsed.font : undefined,
  };
}

export function readAppearance(): PxAppearanceState {
  try {
    const raw = window.localStorage.getItem(STORAGE_KEY);
    if (raw) return normalizeAppearance(JSON.parse(raw) as Partial<PxAppearanceState>);
  } catch { /* ignore */ }
  return { ...DEFAULT_STATE };
}

// ── Durable persistence ─────────────────────────────────────────────────────
// localStorage is the FAST layer: synchronous, applied before first paint so
// launch never flashes the default accent. But Chromium flushes localStorage
// to disk LAZILY — quit or kill the app shortly after picking an accent and
// the write is silently lost, which is the "sometimes my accent doesn't
// stick" bug. The appearance file under data/ is the DURABLE layer (a
// main-process fs write that completes in milliseconds). Every write goes to
// both, stamped; boot applies the fast layer instantly, then heals whichever
// layer is older once the durable read returns.

type StorageBridgeShape = {
  readJson(p: string): Promise<{ data?: unknown }>;
  writeJson(p: string, d: unknown): Promise<unknown>;
};

function durableTarget(): { bridge: StorageBridgeShape; file: string } | null {
  const w = window as unknown as {
    parallxElectron?: { storage?: StorageBridgeShape; dataRoot?: string; appPath?: string };
  };
  const bridge = w.parallxElectron?.storage;
  const dataRoot = w.parallxElectron?.dataRoot ?? w.parallxElectron?.appPath;
  if (!bridge || !dataRoot) return null;
  return { bridge, file: `${dataRoot}/data/appearance.json` };
}

export function writeAppearance(state: PxAppearanceState): void {
  const stamped = { ...state, savedAt: Date.now() };
  try { window.localStorage.setItem(STORAGE_KEY, JSON.stringify(stamped)); } catch { /* ignore */ }
  const t = durableTarget();
  if (t) { void t.bridge.writeJson(t.file, stamped).catch(() => { /* fast layer still holds */ }); }
}

/**
 * Reconcile the two persistence layers after boot: newer `savedAt` wins,
 * the loser is overwritten, and the applied appearance is corrected when
 * the fast layer turned out to be stale. Call once, after
 * `applySavedAppearance()` — it is async and repaints at most once.
 */
export async function healAppearanceFromDurable(): Promise<void> {
  const t = durableTarget();
  if (!t) return;
  try {
    let localStamp = 0;
    try {
      const raw = window.localStorage.getItem(STORAGE_KEY);
      const parsed = raw ? JSON.parse(raw) as { savedAt?: number } : null;
      localStamp = typeof parsed?.savedAt === 'number' ? parsed.savedAt : 0;
    } catch { /* treat as unstamped */ }

    const res = await t.bridge.readJson(t.file);
    const durableRaw = (res?.data ?? null) as (Partial<PxAppearanceState> & { savedAt?: number }) | null;
    if (!durableRaw) {
      // First run with the durable layer: seed it from the current state.
      void t.bridge.writeJson(t.file, { ...readAppearance(), savedAt: localStamp || Date.now() }).catch(() => {});
      return;
    }
    const durableStamp = typeof durableRaw.savedAt === 'number' ? durableRaw.savedAt : 0;

    if (durableStamp > localStamp) {
      // The fs write survived a kill the localStorage flush didn't.
      const durable = normalizeAppearance(durableRaw);
      try { window.localStorage.setItem(STORAGE_KEY, JSON.stringify({ ...durable, savedAt: durableStamp })); } catch { /* ignore */ }
      applyAppearance(durable);
    } else if (localStamp > durableStamp) {
      // Rarer inverse (kill mid-IPC): re-seed the file from the fast layer.
      void t.bridge.writeJson(t.file, { ...readAppearance(), savedAt: localStamp }).catch(() => {});
    }
  } catch { /* stay on the fast-layer value */ }
}

// ── Saved looks (user-created themes) ───────────────────────────────────────
// A "custom theme" at this layer is a named bookmark of base + accent. Users
// craft a look with the controls, then save it to recall later.

export interface PxThemePreset extends PxAppearanceState {
  id: string;
  name: string;
}

function presetsFile(): { bridge: StorageBridgeShape; file: string } | null {
  const t = durableTarget();
  return t ? { bridge: t.bridge, file: t.file.replace(/appearance\.json$/, 'appearance-presets.json') } : null;
}

function sanitizePresets(value: unknown): PxThemePreset[] {
  return Array.isArray(value)
    ? value.filter(p => p && typeof p.id === 'string' && typeof p.name === 'string')
    : [];
}

/** Parse either the stamped envelope or the legacy bare array (stamp 0). */
function parsePresetsRaw(raw: unknown): { savedAt: number; presets: PxThemePreset[] } {
  if (raw && typeof raw === 'object' && !Array.isArray(raw)) {
    const env = raw as { savedAt?: number; presets?: unknown };
    return { savedAt: typeof env.savedAt === 'number' ? env.savedAt : 0, presets: sanitizePresets(env.presets) };
  }
  return { savedAt: 0, presets: sanitizePresets(raw) };
}

export function readPresets(): PxThemePreset[] {
  try {
    const raw = window.localStorage.getItem(PRESETS_KEY);
    if (raw) return parsePresetsRaw(JSON.parse(raw)).presets;
  } catch { /* ignore */ }
  return [];
}

// Same two-layer contract as the appearance state: localStorage is the sync
// read layer the panel uses, the data/ file is the durable one — saved looks
// must not die with a lazy localStorage flush or cleared site data.
function writePresets(presets: PxThemePreset[]): void {
  const stamped = { savedAt: Date.now(), presets };
  try { window.localStorage.setItem(PRESETS_KEY, JSON.stringify(stamped)); } catch { /* ignore */ }
  const t = presetsFile();
  if (t) { void t.bridge.writeJson(t.file, stamped).catch(() => { /* fast layer still holds */ }); }
}

/** Reconcile the preset layers after boot — newer stamp wins, loser healed. */
export async function healPresetsFromDurable(): Promise<void> {
  const t = presetsFile();
  if (!t) return;
  try {
    let local = { savedAt: 0, presets: [] as PxThemePreset[] };
    try {
      const raw = window.localStorage.getItem(PRESETS_KEY);
      if (raw) local = parsePresetsRaw(JSON.parse(raw));
    } catch { /* treat as unstamped */ }

    const res = await t.bridge.readJson(t.file);
    if (res?.data == null) {
      if (local.presets.length > 0) {
        void t.bridge.writeJson(t.file, { savedAt: local.savedAt || Date.now(), presets: local.presets }).catch(() => {});
      }
      return;
    }
    const durable = parsePresetsRaw(res.data);

    if (durable.savedAt > local.savedAt || (local.presets.length === 0 && durable.presets.length > 0)) {
      try { window.localStorage.setItem(PRESETS_KEY, JSON.stringify({ savedAt: durable.savedAt, presets: durable.presets })); } catch { /* ignore */ }
    } else if (local.savedAt > durable.savedAt) {
      void t.bridge.writeJson(t.file, { savedAt: local.savedAt, presets: local.presets }).catch(() => {});
    }
  } catch { /* stay on the fast-layer value */ }
}

export function savePreset(name: string, state: PxAppearanceState): PxThemePreset {
  const preset: PxThemePreset = {
    id: `t_${Date.now().toString(36)}_${Math.floor(Math.random() * 1e4).toString(36)}`,
    name: name.trim() || 'Custom',
    mode: state.mode,
    base: state.base,
    accent: state.accent,
    customHue: state.customHue,
  };
  const presets = readPresets();
  presets.push(preset);
  writePresets(presets);
  return preset;
}

export function deletePreset(id: string): void {
  writePresets(readPresets().filter(p => p.id !== id));
}

function hslToRgbString(h: number, s: number, l: number): string {
  const sN = s / 100, lN = l / 100;
  const c = (1 - Math.abs(2 * lN - 1)) * sN;
  const x = c * (1 - Math.abs(((h / 60) % 2) - 1));
  const m = lN - c / 2;
  let r = 0, g = 0, b = 0;
  if (h < 60) { r = c; g = x; }
  else if (h < 120) { r = x; g = c; }
  else if (h < 180) { g = c; b = x; }
  else if (h < 240) { g = x; b = c; }
  else if (h < 300) { r = x; b = c; }
  else { r = c; b = x; }
  return `${Math.round((r + m) * 255)}, ${Math.round((g + m) * 255)}, ${Math.round((b + m) * 255)}`;
}

/** Apply a state to :root (mode + base via data-attrs, accent via inline vars). */
export function applyAppearance(state: PxAppearanceState): void {
  const root = document.documentElement;

  // Mode — dark is the bare-:root default (no attribute), so existing dark
  // themes are untouched; light is opt-in via data-px-mode. Also set
  // color-scheme so native scrollbars / inputs / controls match.
  if (state.mode === 'light') root.setAttribute('data-px-mode', 'light');
  else root.removeAttribute('data-px-mode');
  root.style.colorScheme = state.mode;

  // Base palette — slate is the :root default (no attribute).
  if (state.base === 'slate') root.removeAttribute('data-px-theme');
  else root.setAttribute('data-px-theme', state.base);

  // Accent — clear prior inline overrides first, then set the chosen one.
  // Inline on :root wins over both the default and the base-theme blocks.
  root.style.removeProperty('--px-accent-h');
  root.style.removeProperty('--px-accent-s');
  root.style.removeProperty('--px-accent-l');
  root.style.removeProperty('--px-accent-rgb');

  if (state.accent === 'custom' && typeof state.customHue === 'number') {
    const h = state.customHue, s = 58, l = 62;
    root.style.setProperty('--px-accent-h', String(h));
    root.style.setProperty('--px-accent-s', `${s}%`);
    root.style.setProperty('--px-accent-l', `${l}%`);
    root.style.setProperty('--px-accent-rgb', hslToRgbString(h, s, l));
  } else {
    const a = PX_ACCENTS.find(x => x.id === state.accent);
    // For the base theme's own accent, leave it to the theme block; only set
    // inline when the user picked a specific accent that differs.
    if (a) {
      root.style.setProperty('--px-accent-h', String(a.h));
      root.style.setProperty('--px-accent-s', `${a.s}%`);
      root.style.setProperty('--px-accent-l', `${a.l}%`);
      root.style.setProperty('--px-accent-rgb', a.rgb);
    }
  }

  // UI font — inline on :root beats the theme bridge's stylesheet rule, so
  // every surface that reads --parallx-fontFamily-ui (or its --px-font-ui
  // alias) follows. The default clears the override rather than restating it.
  if (state.font && state.font !== DEFAULT_FONT_ID) {
    root.style.setProperty('--parallx-fontFamily-ui', resolveFontStack(state.font));
  } else {
    root.style.removeProperty('--parallx-fontFamily-ui');
  }
}

/** Apply the saved appearance. Call as early as possible at boot. */
export function applySavedAppearance(): void {
  applyAppearance(readAppearance());
}
