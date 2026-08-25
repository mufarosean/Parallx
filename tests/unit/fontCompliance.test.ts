// fontCompliance.test.ts — standardization canary (STANDARDIZATION.md P3).
//
// ONE font vocabulary. The real tokens are --parallx-fontFamily-ui/-mono
// (design-token registry); px-tokens.css aliases the legacy namespaces
// (--px-font-*, --vscode-font-family, --vscode-editor-font-family) onto
// them, because 65 declarations across 21 files referenced vars that were
// DEFINED NOWHERE and silently rendered their hardcoded fallbacks — the
// terminal and every log pane drew Courier New while the canvas drew
// Cascadia Code. Same canary pattern as motionTokenCompliance: a literal
// font stack in CSS fails here until it is tokenized (or consciously
// added to the exemptions).

import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { resolve, relative } from 'node:path';
import { globSync } from 'glob';

const ROOT = resolve(__dirname, '../..');

/** Files allowed to declare literal font stacks. */
const EXEMPT_FILES = new Set<string>([
  'src/theme/px-tokens.css',            // defines the vocabulary itself
  'src/built-in/editor/epubEditorPane.css', // book serif — deliberate reading face
]);

describe('font compliance — one font vocabulary', () => {
  const files = globSync('src/**/*.css', { cwd: ROOT }).sort();

  it('every CSS font-family declaration goes through a token (or inherits)', () => {
    const violations: string[] = [];
    for (const file of files) {
      const rel = relative(ROOT, resolve(ROOT, file)).replace(/\\/g, '/');
      if (EXEMPT_FILES.has(rel)) continue;
      const lines = readFileSync(resolve(ROOT, file), 'utf8').split('\n');
      lines.forEach((line, i) => {
        const m = line.match(/font-family\s*:\s*([^;]+)/);
        if (!m) return;
        const value = m[1].trim();
        if (value === 'inherit' || value.includes('var(')) return;
        violations.push(`${rel}:${i + 1} → ${value}`);
      });
    }
    expect(violations, violations.join('\n')).toEqual([]);
  });

  it('the legacy font-var namespaces stay aliased in px-tokens.css', () => {
    // The aliases are what keep 65 legacy declarations rendering the real
    // fonts. Removing one silently reverts those surfaces to their
    // hardcoded fallbacks — this pin makes that removal loud.
    const tokens = readFileSync(resolve(ROOT, 'src/theme/px-tokens.css'), 'utf8');
    for (const name of [
      '--px-font-ui:', '--px-font-mono:',
      '--vscode-font-family:', '--vscode-editor-font-family:',
    ]) {
      expect(tokens, `missing alias ${name}`).toContain(name);
    }
  });
});
