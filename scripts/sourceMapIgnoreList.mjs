// sourceMapIgnoreList.mjs — sources DevTools steps over.
//
// The recent-error log for Help › Copy Diagnostics (src/platform/recentErrors.ts)
// wraps console.error and console.warn, so DevTools named that wrapper as the
// place every warning and error came from. A source map's x_google_ignoreList
// names sources DevTools skips when it shows where a console message came
// from and in stack traces; listing the wrapper there sends each message's
// link back to the code that logged it. The build runs this on the bundle's
// map: the .map file beside it, or an inline one if the build ever writes that.

import { readFileSync, writeFileSync, existsSync } from 'node:fs';

/** Sources whose frames DevTools should skip. */
export const IGNORED_SOURCES = ['src/platform/recentErrors.ts'];

/** The map with every source ending in one of `suffixes` on its ignore list. */
export function withIgnoreList(map, suffixes = IGNORED_SOURCES) {
  const sources = Array.isArray(map.sources) ? map.sources : [];
  const list = new Set(Array.isArray(map.x_google_ignoreList) ? map.x_google_ignoreList : []);
  sources.forEach((s, i) => { if (suffixes.some((suffix) => String(s).replace(/\\/g, '/').endsWith(suffix))) list.add(i); });
  return { ...map, x_google_ignoreList: [...list].sort((a, b) => a - b) };
}

const INLINE = /\/\/# sourceMappingURL=data:application\/json;base64,([A-Za-z0-9+/=]+)\s*$/;

/** Add the ignore list to `jsPath`'s source map, inline or beside it. False when it has none. */
export function addIgnoreList(jsPath, suffixes = IGNORED_SOURCES) {
  const js = readFileSync(jsPath, 'utf8');
  const inline = INLINE.exec(js);
  if (inline) {
    const map = withIgnoreList(JSON.parse(Buffer.from(inline[1], 'base64').toString('utf8')), suffixes);
    const encoded = Buffer.from(JSON.stringify(map), 'utf8').toString('base64');
    writeFileSync(jsPath, js.slice(0, inline.index) + `//# sourceMappingURL=data:application/json;base64,${encoded}\n`);
    return true;
  }
  const mapPath = `${jsPath}.map`;
  if (!existsSync(mapPath)) return false;
  writeFileSync(mapPath, JSON.stringify(withIgnoreList(JSON.parse(readFileSync(mapPath, 'utf8')), suffixes)));
  return true;
}
