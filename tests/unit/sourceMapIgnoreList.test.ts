// sourceMapIgnoreList.test.ts — the build lists the recent-error log's
// console wrapper on the bundle's source-map ignore list, so DevTools links
// each warning and error to the code that logged it.
import { describe, it, expect } from 'vitest';
import { mkdtempSync, readFileSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
// @ts-expect-error — plain ESM build script
import { withIgnoreList, addIgnoreList, IGNORED_SOURCES } from '../../scripts/sourceMapIgnoreList.mjs';

const map = { version: 3, sources: ['../../src/main.ts', '../../src/platform/recentErrors.ts', '..\\..\\src\\ui\\kit.ts'], mappings: 'AAAA' };

describe('source map ignore list', () => {
  it('lists the console wrapper, and keeps what was already listed', () => {
    expect(IGNORED_SOURCES).toContain('src/platform/recentErrors.ts');
    expect(withIgnoreList(map).x_google_ignoreList).toEqual([1]);
    expect(withIgnoreList({ ...map, x_google_ignoreList: [0] }).x_google_ignoreList).toEqual([0, 1]);
    expect(withIgnoreList(map, ['src/ui/kit.ts']).x_google_ignoreList).toEqual([2]);
  });

  it('writes it into a .map file beside the bundle, or into an inline map', () => {
    const dir = mkdtempSync(join(tmpdir(), 'px-map-'));
    const linked = join(dir, 'linked.js');
    writeFileSync(linked, 'x;\n//# sourceMappingURL=linked.js.map\n');
    writeFileSync(`${linked}.map`, JSON.stringify(map));
    expect(addIgnoreList(linked)).toBe(true);
    expect(JSON.parse(readFileSync(`${linked}.map`, 'utf8')).x_google_ignoreList).toEqual([1]);

    const inline = join(dir, 'inline.js');
    writeFileSync(inline, `x;\n//# sourceMappingURL=data:application/json;base64,${Buffer.from(JSON.stringify(map)).toString('base64')}\n`);
    expect(addIgnoreList(inline)).toBe(true);
    const out = /base64,([A-Za-z0-9+/=]+)\s*$/.exec(readFileSync(inline, 'utf8'))!;
    expect(JSON.parse(Buffer.from(out[1], 'base64').toString('utf8')).x_google_ignoreList).toEqual([1]);

    const none = join(dir, 'none.js');
    writeFileSync(none, 'x;\n');
    expect(addIgnoreList(none)).toBe(false);
  });
});
