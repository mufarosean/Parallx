/**
 * migrate-createElement.mjs
 *
 * Replaces `document.createElement('tag')` with `$('tag')` across all .ts
 * files outside src/ui/. Adds `$` to existing ui/dom.js import or inserts
 * a new import line.
 *
 * Run: node scripts/migrate-createElement.mjs
 */

import fs from 'fs';
import path from 'path';

const SRC = path.resolve('src');
const UI_DIR = path.join(SRC, 'ui');

// Collect all .ts files outside src/ui/
function walk(dir) {
  const results = [];
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) {
      if (full === UI_DIR) continue; // skip src/ui/
      results.push(...walk(full));
    } else if (entry.name.endsWith('.ts')) {
      results.push(full);
    }
  }
  return results;
}

const files = walk(SRC);
let totalReplacements = 0;
let filesModified = 0;

for (const file of files) {
  let code = fs.readFileSync(file, 'utf-8');

  // Count createElement occurrences
  const matches = code.match(/document\.createElement\(\s*['"`](\w+)['"`]\s*\)/g);
  if (!matches) continue;

  const count = matches.length;

  // Replace document.createElement('tag') → $('tag')
  code = code.replace(
    /document\.createElement\(\s*(['"`])(\w+)\1\s*\)/g,
    (_, quote, tag) => `$('${tag}')`
  );

  // Handle import of $
  // Check if file already imports from ui/dom.js
  const uiDomImportRe = /(import\s*\{[^}]*\}\s*from\s*['"][^'"]*ui\/dom\.js['"];?)/;
  const uiDomMatch = code.match(uiDomImportRe);

  if (uiDomMatch) {
    const importLine = uiDomMatch[1];
    // Check if $ is already imported
    if (!/\b\$\b/.test(importLine)) {
      // Add $ to the import
      const newImport = importLine.replace(/\{/, '{ $, ');
      code = code.replace(importLine, newImport);
    }
  } else {
    // Need to add a new import line
    // Calculate relative path from file to src/ui/dom.js
    const fileDir = path.dirname(file);
    let relPath = path.relative(fileDir, path.join(SRC, 'ui', 'dom.js')).replace(/\\/g, '/');
    if (!relPath.startsWith('.')) relPath = './' + relPath;

    // Insert after last import
    const lines = code.split('\n');
    let lastImportIdx = -1;
    for (let i = 0; i < lines.length; i++) {
      if (/^\s*import\s/.test(lines[i])) {
        // Find the end of this import (could be multi-line)
        let j = i;
        while (j < lines.length && !lines[j].includes(';') && !lines[j + 1]?.match(/^\s*import\s|^[^'"\s]/)) {
          j++;
        }
        lastImportIdx = j;
      }
    }

    if (lastImportIdx >= 0) {
      lines.splice(lastImportIdx + 1, 0, `import { $ } from '${relPath}';`);
    } else {
      // No imports at all — add at top
      lines.unshift(`import { $ } from '${relPath}';`);
    }
    code = lines.join('\n');
  }

  fs.writeFileSync(file, code, 'utf-8');
  totalReplacements += count;
  filesModified++;
  console.log(`  ${path.relative(SRC, file)}: ${count} replacements`);
}

console.log(`\nDone: ${totalReplacements} replacements across ${filesModified} files.`);
