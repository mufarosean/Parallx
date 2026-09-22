// Every `--vscode-*` name the app or an extension references must resolve: it
// is bridged to a `--px-*` token in THEME_VSCODE_BRIDGE (themeService) or
// aliased in px-tokens.css. A name that is neither silently renders its
// hardcoded fallback, which is how the budget's charts drew VS Code's palette
// on every theme and the JSON viewers kept VS Code's syntax colours until the
// alpha-unification pass. New names go in the bridge, not in a fallback.
import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { globSync } from 'glob';

const ROOT = resolve(__dirname, '../..');

describe('theme bridge compliance — every --vscode-* name resolves', () => {
  it('names referenced by src/ and ext/ are bridged or aliased', () => {
    const bridge = readFileSync(resolve(ROOT, 'src/services/themeService.ts'), 'utf8');
    const tokens = readFileSync(resolve(ROOT, 'src/theme/px-tokens.css'), 'utf8');
    const defined = new Set<string>();
    for (const m of bridge.matchAll(/\['(--vscode-[a-zA-Z-]+)'/g)) defined.add(m[1]);
    for (const m of tokens.matchAll(/^\s*(--vscode-[a-zA-Z-]+)\s*:/gm)) defined.add(m[1]);
    expect(defined.size).toBeGreaterThan(100);

    const files = [
      ...globSync('src/**/*.{css,ts}', { cwd: ROOT }),
      ...globSync('ext/*/*.{js,css}', { cwd: ROOT }),
    ].filter((f) => !f.includes('node_modules') && !/\.test\.ts$/.test(f));
    const missing = new Map<string, Set<string>>();
    for (const file of files) {
      const text = readFileSync(resolve(ROOT, file), 'utf8');
      for (const m of text.matchAll(/var\((--vscode-[a-zA-Z-]+)/g)) {
        if (defined.has(m[1])) continue;
        const set = missing.get(m[1]) ?? new Set<string>();
        set.add(file.replace(/\\/g, '/'));
        missing.set(m[1], set);
      }
    }
    const report = [...missing].map(([name, where]) => `${name} <- ${[...where].join(', ')}`).sort();
    expect(report, `unbridged --vscode-* names (add a bridge row in themeService):\n${report.join('\n')}`).toEqual([]);
  });

  it('every bridge target is a token the theme defines', () => {
    const bridge = readFileSync(resolve(ROOT, 'src/services/themeService.ts'), 'utf8');
    const tokens = readFileSync(resolve(ROOT, 'src/theme/px-tokens.css'), 'utf8');
    const defined = new Set<string>();
    for (const m of tokens.matchAll(/^\s*(--px-[a-zA-Z0-9-]+)\s*:/gm)) defined.add(m[1]);
    const bad: string[] = [];
    for (const m of bridge.matchAll(/\['(--vscode-[a-zA-Z-]+)',\s*'([^']+)'\]/g)) {
      for (const v of m[2].matchAll(/var\((--px-[a-zA-Z0-9-]+)/g)) {
        if (!defined.has(v[1])) bad.push(`${m[1]} -> ${v[1]}`);
      }
    }
    expect(bad, bad.join('\n')).toEqual([]);
  });
});
