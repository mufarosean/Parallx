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
  console.log(`Patched tiptap-extension-global-drag-handle selectors (${patched} file(s))`);
} else {
  console.log('tiptap-extension-global-drag-handle selectors: already patched or not found');
}

// ── Patch 2: Store resolved block node on drag handle element ──
// The library resolves the correct DOM node in its mousemove handler but never
// exposes it. Our blockHandles.ts code runs a second independent resolution
// that can disagree — causing handle clicks/drags to target the wrong block
// (especially for atom node views inside columns).
//
// Fix: store the resolved node as `dragHandleElement._resolvedBlockNode` so
// blockHandles.ts can read the library's own answer as the primary source.
let patched2 = 0;
for (const filePath of files) {
  if (!existsSync(filePath)) continue;
  let content = readFileSync(filePath, 'utf-8');
  if (content.includes('_resolvedBlockNode')) continue; // already patched

  let changed = false;

  // 2a: Store node reference right before showDragHandle() in mousemove handler
  if (content.includes('showDragHandle();')) {
    content = content.replace(
      'showDragHandle();',
      'dragHandleElement._resolvedBlockNode = node; showDragHandle();'
    );
    changed = true;
  }

  // 2b: Clear reference when handle is hidden
  if (content.includes("classList.add('hide');")) {
    content = content.replace(
      "dragHandleElement.classList.add('hide');",
      "dragHandleElement.classList.add('hide'); dragHandleElement._resolvedBlockNode = null;"
    );
    changed = true;
  }

  if (changed) {
    writeFileSync(filePath, content);
    patched2++;
  }
}

if (patched2 > 0) {
  console.log(`Patched tiptap-extension-global-drag-handle node bridge (${patched2} file(s))`);
} else {
  console.log('tiptap-extension-global-drag-handle node bridge: already patched or not found');
}
