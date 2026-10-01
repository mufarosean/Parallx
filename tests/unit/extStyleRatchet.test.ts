// extStyleRatchet.test.ts — extensions may not drift further from the kit.
//
// The core is held to its tokens by fontCompliance / motionTokenCompliance /
// copyCompliance; those scan src/ only. This scans ext/: for each extension it
// counts the ways a surface invents its own look, and fails if any count
// rises above the committed baseline (ext-style-baseline.json). Counts may
// only fall. A new extension is not in the baseline, so it starts at zero:
// it uses api.ui (createButton, createPageHeader, createEmptyState, …) and
// the --px-* tokens from the first line.
//
// After a cleanup lowers a count, refresh the baseline so the gain is kept:
//   UPDATE_EXT_STYLE_BASELINE=1 npx vitest run tests/unit/extStyleRatchet.test.ts
import { describe, expect, it } from 'vitest';
import { readFileSync, writeFileSync, existsSync } from 'node:fs';
import { resolve, dirname, basename } from 'node:path';
import { globSync } from 'glob';

const ROOT = resolve(__dirname, '..', '..');
const BASELINE = resolve(__dirname, 'ext-style-baseline.json');

type Counts = Record<string, number>;

const RULES: Record<string, RegExp> = {
  /** Colour literals: hex or rgb(a) not inside a var() fallback. */
  rawColor: /(?<!var\(--[\w-]+,\s*)(?:#[0-9a-fA-F]{3,8}\b|rgba?\(\s*\d)/g,
  /** Font sizes in px instead of --px-text-*. */
  pxFontSize: /font-size\s*:\s*\d+(?:\.\d+)?px/gi,
  /** Uppercase labels (POLISH pass 7: sentence case, never tracked caps). */
  uppercase: /text-transform\s*:\s*uppercase|textTransform\s*=\s*['"]uppercase/g,
  /** Emoji in UI strings (the copy rule the core already enforces). */
  emoji: /[\u{1F300}-\u{1FAFF}\u{2600}-\u{26FF}\u{2700}-\u{27BF}\u{2B50}]\u{FE0F}?/gu,
  /** Chromium-drawn dialogs instead of api.window.showConfirmModal. */
  nativeConfirm: /(?<![\w.])(?:window\.)?confirm\s*\(/g,
  /** Native <select> instead of api.ui.createDropdown. */
  nativeSelect: /createElement\(\s*['"]select['"]\s*\)|<select\b/g,
  /** The retired brand purple. */
  retiredPurple: /#9333ea|139,\s*92,\s*246/gi,
};

function countsFor(extDir: string): Counts {
  const files = globSync('**/*.{js,css}', { cwd: extDir, ignore: ['**/test/**', '**/node_modules/**', '**/*.min.js'] });
  const out: Counts = Object.fromEntries(Object.keys(RULES).map((k) => [k, 0]));
  for (const f of files) {
    const text = readFileSync(resolve(extDir, f), 'utf8')
      // Comments say what the code used to do; only code counts.
      .replace(/\/\*[\s\S]*?\*\//g, '')
      .replace(/^\s*\/\/.*$/gm, '');
    for (const [k, re] of Object.entries(RULES)) out[k] += (text.match(re) ?? []).length;
  }
  return out;
}

function measure(): Record<string, Counts> {
  const dirs = globSync('ext/*/parallx-manifest.json', { cwd: ROOT }).map((m) => dirname(resolve(ROOT, m))).sort();
  return Object.fromEntries(dirs.map((d) => [basename(d), countsFor(d)]));
}

describe('extension style ratchet', () => {
  const now = measure();

  if (process.env.UPDATE_EXT_STYLE_BASELINE) {
    writeFileSync(BASELINE, JSON.stringify(now, null, 2) + '\n');
  }

  it('found the extensions', () => {
    expect(Object.keys(now).length).toBeGreaterThan(0);
  });

  const baseline: Record<string, Counts> = existsSync(BASELINE) ? JSON.parse(readFileSync(BASELINE, 'utf8')) : {};

  for (const [ext, counts] of Object.entries(now)) {
    it(`${ext}: no count rises above its baseline (new extensions start at zero)`, () => {
      const allowed = baseline[ext] ?? Object.fromEntries(Object.keys(RULES).map((k) => [k, 0]));
      const regressions = Object.entries(counts)
        .filter(([k, v]) => v > (allowed[k] ?? 0))
        .map(([k, v]) => `${k}: ${v} > ${allowed[k] ?? 0}`);
      expect(regressions, `${ext} drifted from the kit — use api.ui and --px-* tokens`).toEqual([]);
    });
  }
});
