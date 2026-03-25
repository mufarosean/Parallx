import { describe, expect, it } from 'vitest';
import { existsSync, readFileSync, readdirSync, statSync } from 'fs';
import { dirname, relative, resolve } from 'path';

const SRC_DIR = resolve(__dirname, '../../src');
const OPENCLAW_DIR = resolve(SRC_DIR, 'openclaw');
const CHAT_RUNTIME_DIR = resolve(SRC_DIR, 'chatRuntime');
const LEGACY_CHAT_DIR = resolve(SRC_DIR, 'built-in/chat');

function collectTsFiles(dir: string): string[] {
  const files: string[] = [];
  for (const entry of readdirSync(dir)) {
    const fullPath = resolve(dir, entry);
    if (statSync(fullPath).isDirectory()) {
      files.push(...collectTsFiles(fullPath));
    } else if (entry.endsWith('.ts') && !entry.endsWith('.d.ts')) {
      files.push(fullPath);
    }
  }
  return files;
}

function extractRelativeImports(source: string): string[] {
  const imports: string[] = [];
  const staticRegex = /from\s+['"](\.?\.?\/.+?)['"]/g;
  const dynamicRegex = /import\(\s*['"](\.?\.?\/.+?)['"]\s*\)/g;
  let match: RegExpExecArray | null;

  while ((match = staticRegex.exec(source)) !== null) {
    imports.push(match[1]);
  }
  while ((match = dynamicRegex.exec(source)) !== null) {
    imports.push(match[1]);
  }

  return imports;
}

function resolveWorkspaceModule(importer: string, specifier: string): string | null {
  const base = resolve(dirname(importer), specifier.replace(/\.js$/, ''));
  const candidates = [base, `${base}.ts`, resolve(base, 'index.ts')];
  for (const candidate of candidates) {
    if (existsSync(candidate) && statSync(candidate).isFile()) {
      return candidate;
    }
  }
  return null;
}

describe('openclaw transitive coupling', () => {
  it('does not reach the legacy chat tree through transitive relative imports', () => {
    const roots = collectTsFiles(OPENCLAW_DIR);
    const visited = new Set<string>();
    const queue = [...roots];
    const violations: string[] = [];

    while (queue.length > 0) {
      const current = queue.shift();
      if (!current || visited.has(current)) {
        continue;
      }
      visited.add(current);

      const source = readFileSync(current, 'utf8');
      const imports = extractRelativeImports(source);
      for (const specifier of imports) {
        const resolved = resolveWorkspaceModule(current, specifier);
        if (!resolved || !resolved.startsWith(SRC_DIR)) {
          continue;
        }

        if (resolved.startsWith(LEGACY_CHAT_DIR)) {
          violations.push(`${relative(SRC_DIR, current).split('\\').join('/')} -> ${specifier} -> ${relative(SRC_DIR, resolved).split('\\').join('/')}`);
          continue;
        }

        if (!resolved.startsWith(OPENCLAW_DIR) && !resolved.startsWith(CHAT_RUNTIME_DIR)) {
          continue;
        }

        if (!visited.has(resolved)) {
          queue.push(resolved);
        }
      }
    }

    expect(violations).toEqual([]);
  });
});