// package-media-organizer.mjs — packages the media-organizer extension as a .plx file
//
// Usage: node scripts/package-media-organizer.mjs
//
// Output: ext/media-organizer/media-organizer.plx

import { createRequire } from 'module';
import path from 'path';
import { fileURLToPath } from 'url';

const require = createRequire(import.meta.url);
const AdmZip = require('adm-zip');

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const toolDir = path.resolve(__dirname, '..', 'ext', 'media-organizer');
const outputPath = path.join(toolDir, 'media-organizer.plx');

const zip = new AdmZip();

// Add required files
zip.addLocalFile(path.join(toolDir, 'parallx-manifest.json'));
zip.addLocalFile(path.join(toolDir, 'main.js'));

// Add migration files (preserving db/migrations/ directory structure)
const migrationsDir = path.join(toolDir, 'db', 'migrations');
zip.addLocalFile(path.join(migrationsDir, 'media-organizer_001_initial.sql'), 'db/migrations');
zip.addLocalFile(path.join(migrationsDir, 'media-organizer_002_iter2_schema.sql'), 'db/migrations');
zip.addLocalFile(path.join(migrationsDir, 'media-organizer_003_iter3_polish.sql'), 'db/migrations');

zip.writeZip(outputPath);

console.log(`Packaged media-organizer extension to: ${outputPath}`);
console.log(`  Files: parallx-manifest.json, main.js, db/migrations/ (3 SQL files)`);
console.log(`  Size: ${(zip.toBuffer().length / 1024).toFixed(1)} KB`);
