/**
 * bundle-character-three.mjs
 *
 * ext/character-studio/vendor/three.min.js is generated: three.js (MIT, the
 * version pinned in package.json) and the add-ons Character Studio uses
 * (GLTFExporter, RoomEnvironment, GLTFLoader) and @pixiv/three-vrm (MIT), bundled into one ES module, since an extension cannot
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
  "export { RoomEnvironment } from 'three/examples/jsm/environments/RoomEnvironment.js';",
  "export { GLTFLoader } from 'three/examples/jsm/loaders/GLTFLoader.js';",
  "export { VRMLoaderPlugin, VRMUtils, MToonMaterial } from '@pixiv/three-vrm';",
].join('\n');

const version = JSON.parse(readFileSync(join(ROOT, 'node_modules', 'three', 'package.json'), 'utf8')).version;
const vrm = JSON.parse(readFileSync(join(ROOT, 'node_modules', '@pixiv', 'three-vrm', 'package.json'), 'utf8')).version;
mkdirSync(OUT_DIR, { recursive: true });
const result = await build({
  stdin: { contents: entry, resolveDir: ROOT, loader: 'js' },
  bundle: true, format: 'esm', minify: true, write: false, target: 'es2022', legalComments: 'none',
});
const banner = `// three.js ${version} (MIT, Copyright 2010-2026 three.js authors) with GLTFExporter, RoomEnvironment, GLTFLoader and @pixiv/three-vrm ${vrm} (MIT), bundled by scripts/bundle-character-three.mjs. Do not edit.\n`;
writeFileSync(join(OUT_DIR, 'three.min.js'), banner + result.outputFiles[0].text);
console.log(`three ${version}: ${(result.outputFiles[0].text.length / 1024).toFixed(0)} KB`);
