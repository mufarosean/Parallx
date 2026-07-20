// motionTokenCompliance.test.ts — M89 S1 canary.
//
// ONE motion vocabulary (px-tokens.css: --px-dur-instant/fast/base/slow +
// --px-ease/--px-ease-out/--px-ease-spring). Built-in CSS must not
// improvise durations or named easings in `transition:` declarations —
// that's how the app drifted to ~30 ad-hoc timing combos before the M89
// sweep. Same canary pattern as chatGateCompliance: adding a raw timing
// fails here until it's tokenized (or consciously added to the exemptions).

import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { resolve, relative } from 'node:path';
import { globSync } from 'glob';

const ROOT = resolve(__dirname, '../..');

/** Files allowed to carry raw times in transitions (token definitions). */
const EXEMPT_FILES = new Set<string>([
  'src/theme/px-tokens.css', // defines the vocabulary itself
]);

/** Strip var(...) groups (fallback literals inside var() are fine). */
function stripVarGroups(s: string): string {
  let out = '';
  let depth = 0;
  for (let i = 0; i < s.length; i++) {
    if (s.startsWith('var(', i) && depth === 0) {
      depth = 1; i += 3; continue;
    }
    if (depth > 0) {
      if (s[i] === '(') depth++;
      else if (s[i] === ')') depth--;
      continue;
    }
    out += s[i];
  }
  return out;
}

describe('motion token compliance (M89 S1)', () => {
  const cssFiles = globSync('src/**/*.css', { cwd: ROOT }).map((f) => f.replace(/\\/g, '/'));

  it('found the built-in stylesheet set', () => {
    expect(cssFiles.length).toBeGreaterThan(15);
  });

  it('every transition uses motion tokens — no raw durations or named easings', () => {
    const violations: string[] = [];
    for (const file of cssFiles) {
      if (EXEMPT_FILES.has(file)) continue;
      const css = readFileSync(resolve(ROOT, file), 'utf8');
      const declRe = /transition\s*:\s*([^;}]+)/g;
      let m: RegExpExecArray | null;
      while ((m = declRe.exec(css)) !== null) {
        const body = m[1].trim();
        if (body === 'none') continue;
        const bare = stripVarGroups(body);
        const rawTime = /(?<![\w-])\d*\.?\d+m?s\b/.exec(bare);
        const rawEase = /(?<![\w-])(ease(-in|-out|-in-out)?|cubic-bezier\()/.exec(bare);
        if (rawTime || rawEase) {
          violations.push(`${relative(ROOT, resolve(ROOT, file))}: "transition: ${body.slice(0, 80)}" — raw ${rawTime ? `time ${rawTime[0]}` : `easing ${rawEase?.[0]}`}`);
        }
      }
    }
    expect(violations, violations.join('\n')).toEqual([]);
  });

  it('the vocabulary itself stays defined', () => {
    const tokens = readFileSync(resolve(ROOT, 'src/theme/px-tokens.css'), 'utf8');
    for (const t of ['--px-dur-instant', '--px-dur-fast', '--px-dur-base', '--px-dur-slow', '--px-ease:', '--px-ease-out', '--px-ease-spring', '--px-press']) {
      expect(tokens, `${t} missing from px-tokens.css`).toContain(t);
    }
  });
});
