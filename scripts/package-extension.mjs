// package-extension.mjs — packages one extension in ext/ as a .plx file.
//
// Usage: node scripts/package-extension.mjs <folder>     (e.g. creations-ai)
//
// Output: ext/<folder>/<folder>.plx
//
// An extension is every file its main.js can reach, so the package holds the
// manifest and every top-level .js file (an extension's modules sit beside
// main.js and import each other by relative path), plus its database
// migrations and bundled binaries. Tests, packages and generated sources are
// left out.

import { createRequire } from 'module';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const require = createRequire(import.meta.url);

/** Folders inside an extension that are never part of the package. */
const SKIPPED_DIRS = new Set(['test', 'tests', 'src', 'node_modules']);

/**
 * The files an extension ships, as `{ file, zipDir }` pairs relative to its
 * folder (`zipDir` is '' for the root). Pure: reads the folder, writes nothing.
 */
export function collectExtensionFiles(toolDir) {
  const files = [];
  const manifestPath = path.join(toolDir, 'parallx-manifest.json');
  if (!fs.existsSync(manifestPath)) throw new Error(`No parallx-manifest.json in ${toolDir}`);
  files.push({ file: 'parallx-manifest.json', zipDir: '' });

  for (const name of fs.readdirSync(toolDir).sort()) {
    if (name.endsWith('.js') && name !== 'parallx-manifest.json') files.push({ file: name, zipDir: '' });
  }
  if (!files.some((f) => f.file === 'main.js')) throw new Error(`No main.js in ${toolDir}`);

  const migrationsDir = path.join(toolDir, 'db', 'migrations');
  if (fs.existsSync(migrationsDir)) {
    for (const name of fs.readdirSync(migrationsDir).sort()) {
      if (name.endsWith('.sql')) files.push({ file: path.join('db', 'migrations', name), zipDir: 'db/migrations' });
    }
  }
  const binDir = path.join(toolDir, 'bin');
  if (fs.existsSync(binDir)) {
    for (const name of fs.readdirSync(binDir).sort()) {
      if (fs.statSync(path.join(binDir, name)).isFile()) files.push({ file: path.join('bin', name), zipDir: 'bin' });
    }
  }
  return files.filter((f) => !SKIPPED_DIRS.has(f.file.split(path.sep)[0]));
}

export function packageExtension(folder) {
  const AdmZip = require('adm-zip');
  const __dirname = path.dirname(fileURLToPath(import.meta.url));
  const toolDir = path.resolve(__dirname, '..', 'ext', folder);
  const outputPath = path.join(toolDir, `${folder}.plx`);
  const files = collectExtensionFiles(toolDir);

  const zip = new AdmZip();
  for (const { file, zipDir } of files) zip.addLocalFile(path.join(toolDir, file), zipDir);
  zip.writeZip(outputPath);

  console.log(`Packaged ${folder} to: ${outputPath}`);
  console.log(`  Files: ${files.map((f) => f.file).join(', ')}`);
  console.log(`  Size: ${(zip.toBuffer().length / 1024).toFixed(1)} KB`);
  return outputPath;
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const folder = process.argv[2];
  if (!folder) { console.error('Usage: node scripts/package-extension.mjs <folder in ext/>'); process.exit(1); }
  packageExtension(folder);
}
