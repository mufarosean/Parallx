// duplicationRatchet.test.ts — code copied between files can only become less.
//
// An app written by a model grows by copying: the same block lands in a
// second tool, then a third, and the systems drift apart (measured across
// the industry: duplicated blocks rising year on year while moved, that is
// refactored, code falls; GitClear, 2026). This records, per file, how many
// of its lines of substance also stand in another file, and fails when that
// number rises or a new file arrives carrying a copy. The fix is to put the
// shared code in one place both import (for extensions: the kit, a core
// seam, or a shared module), never to raise the baseline.
//
// What is shared, and with which file:
//   DUPLICATION_REPORT=1 npx vitest run tests/unit/duplicationRatchet.test.ts
// After a consolidation lowers the counts, keep the gain:
//   UPDATE_DUPLICATION_BASELINE=1 npx vitest run tests/unit/duplicationRatchet.test.ts
import { describe, expect, it } from 'vitest';
import { readFileSync, writeFileSync, existsSync } from 'node:fs';
import { resolve } from 'node:path';
import { measureDuplication, substance, WINDOW } from './fixtures/duplication.js';

const ROOT = resolve(__dirname, '..', '..');
const BASELINE = resolve(__dirname, 'duplication-baseline.json');

describe('duplication (ratchet)', () => {
  const now = measureDuplication(ROOT);

  if (process.env.UPDATE_DUPLICATION_BASELINE) {
    writeFileSync(BASELINE, JSON.stringify(now.files, null, 2) + '\n');
  }
  if (process.env.DUPLICATION_REPORT) {
    const top = Object.entries(now.pairs).sort((a, b) => b[1] - a[1]).slice(0, 40);
    const total = Object.values(now.files).reduce((a, b) => a + b, 0);
    console.log(`\n[duplication] ${total} lines in ${Object.keys(now.files).length} files also stand in another file. The largest shares:\n${top.map(([pair, n]) => `  ${String(n).padStart(5)}  ${pair}`).join('\n')}\n`);
  }

  it('has a committed baseline', () => {
    expect(existsSync(BASELINE)).toBe(true);
  });

  it('no file holds more copied code than it did, and no new file arrives with a copy', () => {
    const base: Record<string, number> = existsSync(BASELINE) ? JSON.parse(readFileSync(BASELINE, 'utf8')) : {};
    const partners = (file: string): string => Object.keys(now.pairs).filter((p) => p.split(' | ').includes(file)).map((p) => p.split(' | ').find((f) => f !== file)).slice(0, 3).join(', ');
    const rises: string[] = [];
    for (const [file, n] of Object.entries(now.files)) {
      const was = base[file];
      if (was === undefined) rises.push(`${file}: new, with ${n} lines that also stand in ${partners(file)}`);
      else if (n > was) rises.push(`${file}: ${was} -> ${n} (shared with ${partners(file)})`);
    }
    expect(rises, `Code was copied between files (${WINDOW} lines of substance in a row). Put it in one place both import instead.`).toEqual([]);
  });

  it('reads a file as its lines of substance', () => {
    expect(substance(`import { a } from './a.js';\n\n// a note\nconst x = 1; /* aside */\n  });\n}\nexport function go(): void {\n  run(  x,   2 );\n}\n`)).toEqual(['const x = 1;', 'export function go(): void {', 'run( x, 2 );']);
  });
});
