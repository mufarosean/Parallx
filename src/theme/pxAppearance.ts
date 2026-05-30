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

export type PxBaseTheme = 'slate' | 'warm' | 'ember';

export interface PxAccent {
  readonly id: string;
  readonly label: string;
  readonly h: number;
  readonly s: number;   // percent
  readonly l: number;   // percent
  readonly rgb: string; // "r, g, b" — kept ~in sync for rgba() tokens
}

export interface PxAppearanceState {
  base: PxBaseTheme;
  accent: string;        // accent id, or 'custom'
  customHue?: number;    // 0-360 when accent === 'custom'
}

export const PX_BASE_THEMES: { id: PxBaseTheme; label: string; desc: string; swatch: string }[] = [
  { id: 'slate', label: 'Slate', desc: 'Cool graphite — calm and neutral', swatch: '#16171a' },
  { id: 'warm',  label: 'Warm',  desc: 'Warm charcoal — soft and inviting', swatch: '#1b1a17' },
  { id: 'ember', label: 'Ember', desc: 'Warm graphite — the most distinctive', swatch: '#1a1815' },
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

const DEFAULT_STATE: PxAppearanceState = { base: 'slate', accent: 'steel' };

export function readAppearance(): PxAppearanceState {
  try {
    const raw = window.localStorage.getItem(STORAGE_KEY);
    if (raw) {
      const parsed = JSON.parse(raw) as Partial<PxAppearanceState>;
      return {
        base: (parsed.base === 'warm' || parsed.base === 'ember') ? parsed.base : 'slate',
        accent: typeof parsed.accent === 'string' ? parsed.accent : 'steel',
        customHue: typeof parsed.customHue === 'number' ? parsed.customHue : undefined,
      };
    }
  } catch { /* ignore */ }
  return { ...DEFAULT_STATE };
}

export function writeAppearance(state: PxAppearanceState): void {
  try { window.localStorage.setItem(STORAGE_KEY, JSON.stringify(state)); } catch { /* ignore */ }
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

/** Apply a state to :root (base via data-attr, accent via inline vars). */
export function applyAppearance(state: PxAppearanceState): void {
  const root = document.documentElement;

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
}

/** Apply the saved appearance. Call as early as possible at boot. */
export function applySavedAppearance(): void {
  applyAppearance(readAppearance());
}
