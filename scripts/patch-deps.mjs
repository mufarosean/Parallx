// scripts/patch-deps.mjs — Patch third-party dependencies after install
import { readFileSync, writeFileSync, existsSync } from 'fs';

// ── Patch tiptap-extension-global-drag-handle ──
// Add `.canvas-column > p:first-child` to the selector so the first paragraph
// in every column also gets a drag handle (normally excluded by the library's
// `p:not(:first-child)` rule).  We also add common custom block types that
// should always show handles inside columns.
//
// The approach: replace the single 'p:not(:first-child)' entry with two entries
// that together cover all paragraphs:
//   'p:not(:first-child)' — non-first paragraphs anywhere (original)
//   '.canvas-column > p'  — ALL paragraphs that are direct children of a column
const files = [
  'node_modules/tiptap-extension-global-drag-handle/dist/index.js',
  'node_modules/tiptap-extension-global-drag-handle/dist/index.umd.js',
  'node_modules/tiptap-extension-global-drag-handle/dist/index.cjs',
];

let patched = 0;
for (const filePath of files) {
  if (!existsSync(filePath)) continue;
  let content = readFileSync(filePath, 'utf-8');
  // Only patch if not already patched
  if (content.includes("'p:not(:first-child)'") && !content.includes('.canvas-column')) {
    content = content.replace(
      "'p:not(:first-child)'",
      "'p:not(:first-child)', '.canvas-column > p'"
    );
    writeFileSync(filePath, content);
    patched++;
  }
}

if (patched > 0) {
  console.log(`Patched tiptap-extension-global-drag-handle (${patched} file(s))`);
} else {
  console.log('tiptap-extension-global-drag-handle: already patched or not found');
}
