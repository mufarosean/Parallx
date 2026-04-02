// package-text-generator.mjs — packages the text-generator extension as a .plx file
//
// Usage: node scripts/package-text-generator.mjs
//
// Output: tools/text-generator/text-generator.plx

import { createRequire } from 'module';
import path from 'path';
import { fileURLToPath } from 'url';

const require = createRequire(import.meta.url);
const AdmZip = require('adm-zip');

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const toolDir = path.resolve(__dirname, '..', 'ext', 'text-generator');
const outputPath = path.join(toolDir, 'text-generator.plx');

const zip = new AdmZip();

// Add required files
zip.addLocalFile(path.join(toolDir, 'parallx-manifest.json'));
zip.addLocalFile(path.join(toolDir, 'main.js'));

zip.writeZip(outputPath);

console.log(`Packaged text-generator extension to: ${outputPath}`);
console.log(`  Files: parallx-manifest.json, main.js`);
console.log(`  Size: ${(zip.toBuffer().length / 1024).toFixed(1)} KB`);
