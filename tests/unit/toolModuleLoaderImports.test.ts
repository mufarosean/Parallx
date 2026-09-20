// External tools load through blob URLs, and a blob URL cannot resolve a
// relative import. The loader rewrites `./x.js` imports to blob URLs of
// their own, recursively, so an extension can be more than one file
// (Creations AI: main.js, studio.js, story.js, tables.js and their cores).

import { describe, it, expect } from 'vitest';
import { collectRelativeImports, rewriteRelativeImports, resolveRelativeModulePath } from '../../src/tools/toolModuleLoader.js';

const SOURCE = `// header mentions './not-an-import.js' in prose
import { a, b } from './core.js';
import * as ns from "../shared/util.js";
import './side-effect.js';
import lodash from 'lodash';
export { x } from './re-export.js';
export * from './all.js';
const later = () => import('./lazy.js');
export function f() { return 'from ./inside-a-string.js'; }
/* import './in-a-comment.js' */
`;

describe('relative imports in an external tool', () => {
  it('collects every relative specifier once, and nothing from strings, comments or packages', () => {
    expect(collectRelativeImports(SOURCE)).toEqual(['./core.js', '../shared/util.js', './side-effect.js', './re-export.js', './all.js', './lazy.js']);
  });
  it('rewrites each specifier to what the resolver returns, static and dynamic alike', () => {
    const out = rewriteRelativeImports(SOURCE, (spec) => `blob:${spec}`);
    expect(out).toContain(`import { a, b } from 'blob:./core.js';`);
    expect(out).toContain(`import * as ns from "blob:../shared/util.js";`);
    expect(out).toContain(`import 'blob:./side-effect.js';`);
    expect(out).toContain(`export { x } from 'blob:./re-export.js';`);
    expect(out).toContain(`export * from 'blob:./all.js';`);
    expect(out).toContain(`import('blob:./lazy.js')`);
    expect(out).toContain(`from 'lodash'`);
    expect(out).toContain(`'from ./inside-a-string.js'`);
  });
  it('resolves a specifier against the importing file, on either kind of path', () => {
    expect(resolveRelativeModulePath('D:\\AI\\Parallx\\ext\\creations-ai\\main.js', './studio.js')).toBe('D:\\AI\\Parallx\\ext\\creations-ai\\studio.js');
    expect(resolveRelativeModulePath('D:\\AI\\Parallx\\ext\\creations-ai\\main.js', '../shared/util.js')).toBe('D:\\AI\\Parallx\\ext\\shared\\util.js');
    expect(resolveRelativeModulePath('/home/m/ext/tool/main.js', './lib/core.js')).toBe('/home/m/ext/tool/lib/core.js');
  });
});
