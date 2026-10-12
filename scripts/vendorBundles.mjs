// scripts/vendorBundles.mjs — the libraries that load on first use, not at boot.
//
// Each entry in src/vendor/ builds as its own ESM bundle,
// dist/renderer/vendor-<name>.js. In the main bundle an import that resolves
// to one of them stays a dynamic import of that file. A script's import()
// resolves against the script's own URL (dist/renderer/main.js), not the
// page, so the request names the sibling file. The page parses the library
// when something needs it (src/vendor/lazy.ts holds the loaders). Under vitest the same import loads the package.

import * as path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = fileURLToPath(new URL('..', import.meta.url));

export const VENDOR_BUNDLES = [
  { name: 'pdfjs', entry: 'src/vendor/pdfjs.ts' },
  { name: 'hljs', entry: 'src/vendor/hljs.ts' },
  { name: 'jszip', entry: 'src/vendor/jszip.ts' },
];

/** The esbuild plugin for the main bundle: an import of a vendor entry stays a run-time request. */
export function lazyVendorPlugin() {
  const byPath = new Map(VENDOR_BUNDLES.map((b) => [path.resolve(ROOT, b.entry).replace(/\.ts$/, ''), b.name]));
  return {
    name: 'lazy-vendor',
    setup(build) {
      build.onResolve({ filter: /\.js$/ }, (args) => {
        if (args.kind === 'entry-point') return null;
        const name = byPath.get(path.resolve(args.resolveDir, args.path).replace(/\.js$/, ''));
        return name ? { path: `./vendor-${name}.js`, external: true } : null;
      });
    },
  };
}
