// legacySizeTokenCompliance.test.ts — one size vocabulary.
//
// The app's sizes and radii come from the --px-text-* / --px-radius-* tokens
// (src/theme/px-tokens.css). The old --parallx-fontSize-* / --parallx-radius-*
// names are kept only as deprecated aliases (ThemeService's design bridge) so
// third-party extensions written against them still render. Nothing in src/
// or ext/ reads them any more; this keeps it that way, and pins the aliases.

import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { globSync } from 'glob';

const ROOT = resolve(__dirname, '../..');
const LEGACY_USE = /var\(\s*--parallx-(?:fontSize|radius)-/g;

describe('legacy size tokens', () => {
  it('no app or extension code reads --parallx-fontSize-* or --parallx-radius-*', () => {
    const files = globSync('{src/**/*.{css,ts},ext/*/**/*.{css,js}}', {
      cwd: ROOT,
      ignore: ['**/node_modules/**', '**/*.min.js', 'src/services/themeService.ts'],
    }).sort();
    const hits: string[] = [];
    for (const file of files) {
      const n = (readFileSync(resolve(ROOT, file), 'utf8').match(LEGACY_USE) ?? []).length;
      if (n) hits.push(`${file}: ${n}`);
    }
    expect(hits, 'use the --px-text-* / --px-radius-* tokens instead').toEqual([]);
  });

  it('the deprecated aliases stay defined for third-party extensions', () => {
    const bridge = readFileSync(resolve(ROOT, 'src/services/themeService.ts'), 'utf8');
    for (const [legacy, px] of [
      ['--parallx-fontSize-xs', '--px-text-xs'],
      ['--parallx-fontSize-sm', '--px-text-sm'],
      ['--parallx-fontSize-base', '--px-text-base'],
      ['--parallx-fontSize-md', '--px-text-base'],
      ['--parallx-fontSize-lg', '--px-text-md'],
      ['--parallx-fontSize-xl', '--px-text-lg'],
      ['--parallx-radius-sm', '--px-radius-sm'],
      ['--parallx-radius-md', '--px-radius-md'],
      ['--parallx-radius-lg', '--px-radius-lg'],
      ['--parallx-radius-xl', '--px-radius-xl'],
      ['--parallx-radius-full', '--px-radius-full'],
    ]) {
      expect(bridge, `${legacy} → ${px}`).toMatch(new RegExp(`\\['${legacy}',\\s*'var\\(${px}\\)'\\]`));
    }
  });
});
