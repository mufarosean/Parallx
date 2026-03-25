import { describe, expect, it } from 'vitest';
import { readFileSync, readdirSync, statSync } from 'fs';
import { relative, resolve } from 'path';

const OPENCLAW_DIR = resolve(__dirname, '../../src/openclaw');
const LEGACY_CHAT_DIR = resolve(__dirname, '../../src/built-in/chat');

function collectTsFiles(dir: string, base: string = ''): string[] {
  const entries = readdirSync(dir);
  const files: string[] = [];
  for (const entry of entries) {
    const full = resolve(dir, entry);
    const rel = base ? `${base}/${entry}` : entry;
    if (statSync(full).isDirectory()) {
      files.push(...collectTsFiles(full, rel));
    } else if (entry.endsWith('.ts') && !entry.endsWith('.d.ts')) {
      files.push(rel);
    }
  }
  return files;
}

function extractRelativeImports(source: string): string[] {
  const matches: string[] = [];
  const staticRegex = /from\s+['"](\.\.?\/.+?)['"]/g;
  const dynamicRegex = /import\(\s*['"](\.\.?\/.+?)['"]\s*\)/g;
  let match: RegExpExecArray | null;

  while ((match = staticRegex.exec(source)) !== null) {
    matches.push(match[1]);
  }
  while ((match = dynamicRegex.exec(source)) !== null) {
    matches.push(match[1]);
  }

  return matches;
}

function resolvesIntoLegacyChat(childFile: string, importPath: string): string | null {
  const childDir = resolve(OPENCLAW_DIR, childFile, '..');
  const absTarget = resolve(childDir, importPath.replace(/\.js$/, ''));
  const rel = relative(LEGACY_CHAT_DIR, absTarget);
  if (rel.startsWith('..')) {
    return null;
  }
  return rel.split('\\').join('/');
}

describe('openclaw gate compliance', () => {
  it('does not allow src/openclaw files to import from src/built-in/chat', () => {
    const files = collectTsFiles(OPENCLAW_DIR);
    const violations: string[] = [];

    for (const file of files) {
      const source = readFileSync(resolve(OPENCLAW_DIR, file), 'utf8');
      const imports = extractRelativeImports(source);
      for (const importPath of imports) {
        const legacyTarget = resolvesIntoLegacyChat(file, importPath);
        if (legacyTarget) {
          violations.push(`${file} -> ${importPath} (${legacyTarget})`);
        }
      }
    }

    expect(violations).toEqual([]);
  });
});