// pxTokenDefinedCompliance.test.ts — every --px-* token a surface reads exists.
//
// A var(--px-x) that nothing defines is not an error to the browser: the
// property silently falls back to its initial value (transparent, inherit) or
// to whatever literal sits after the comma. That is how the code editor's
// toolbar buttons and the title-bar seal lost their fill (--px-surface), how a
// chat bubble stayed #2a2a2a in light mode, and how flashcards drew "disabled"
// numbers in the inherited colour (--px-text-disabled). Same canary as
// fontCompliance: a reference to a token no stylesheet or script defines fails
// here until the token is added to px-tokens.css or the reference is fixed.

import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { globSync } from 'glob';

const ROOT = resolve(__dirname, '../..');

/** Optional hooks: read with a fallback on purpose, set only when wanted. */
const OPTIONAL = new Set<string>([
  '--px-accent-text-l', // per-accent override of the accent-text lightness
  '--px-code-size',     // code editor size, a user override over 13px
]);

describe('px token compliance — every referenced token is defined', () => {
  const files = globSync('{src,ext}/**/*.{css,ts,js}', {
    cwd: ROOT,
    ignore: ['**/node_modules/**', '**/*.generated.ts', 'ext/**/test/**'],
  }).sort();
  const texts = files.map((f) => ({ file: f, text: readFileSync(resolve(ROOT, f), 'utf8') }));

  const defined = new Set<string>();
  for (const { text } of texts) {
    // `--px-x:` in a rule, `'--px-x'` / `"--px-x"` handed to setProperty or a
    // token table (the theme registry writes many of them from TS).
    for (const m of text.matchAll(/(--px-[a-z0-9-]+)\s*:/g)) defined.add(m[1]);
    for (const m of text.matchAll(/['"`](--px-[a-z0-9-]+)['"`]/g)) defined.add(m[1]);
  }

  it('no var(--px-*) names a token that nothing defines', () => {
    const missing: string[] = [];
    for (const { file, text } of texts) {
      text.split('\n').forEach((line, i) => {
        for (const m of line.matchAll(/var\(\s*(--px-[a-z0-9-]+)/g)) {
          const name = m[1];
          if (defined.has(name) || OPTIONAL.has(name)) continue;
          // A family defined by prefix in code (`--px-base-${n}`) counts.
          if ([...defined].some((d) => d.endsWith('-') && name.startsWith(d))) continue;
          missing.push(`${file}:${i + 1} ${name}`);
        }
      });
    }
    expect(missing).toEqual([]);
  });
});
