/**
 * bundle-character-three.mjs
 *
 * ext/character-studio/vendor/three.min.js is generated: three.js (MIT, the
 * version pinned in package.json) and the one add-on Character Studio uses
 * (GLTFExporter), bundled into one ES module, since an extension cannot
 * import packages. Edit nothing in vendor/; bump three, then run this.
 *
 * Run: node scripts/bundle-character-three.mjs
 */

import { build } from 'esbuild';
import { readFileSync, writeFileSync, mkdirSync } from 'node:fs';
import { join, resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const OUT_DIR = join(ROOT, 'ext', 'character-studio', 'vendor');

const entry = [
  "export * from 'three';",
  "export { GLTFExporter } from 'three/examples/jsm/exporters/GLTFExporter.js';",
].join('\n');

const version = JSON.parse(readFileSync(join(ROOT, 'node_modules', 'three', 'package.json'), 'utf8')).version;
mkdirSync(OUT_DIR, { recursive: true });
const result = await build({
  stdin: { contents: entry, resolveDir: ROOT, loader: 'js' },
  bundle: true, format: 'esm', minify: true, write: false, target: 'es2022', legalComments: 'none',
});
const banner = `// three.js ${version} (MIT, Copyright 2010-2026 three.js authors) and its GLTFExporter, bundled by scripts/bundle-character-three.mjs. Do not edit.\n`;
writeFileSync(join(OUT_DIR, 'three.min.js'), banner + result.outputFiles[0].text);
console.log(`three ${version}: ${(result.outputFiles[0].text.length / 1024).toFixed(0)} KB`);
