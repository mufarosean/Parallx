// normalize-icons.mjs — Deep normalization of SVG icon attributes
//
// For each complete SVG string in icon definition files:
//   1. SVG tag: ensure stroke="currentColor", stroke-width, stroke-linecap="round",
//      stroke-linejoin="round". Remove explicit width/height and xmlns.
//   2. Child elements: normalize stroke-width in the 1.0–2.0 range to the
//      Lucide-equivalent; normalize linecap/linejoin to "round".
//
// Lucide-equivalent stroke-width = 2 × (viewBoxSize / 24)
//   16×16 viewBox → sw 1.33   |   20×20 → sw 1.67   |   24×24 → sw 2
//
// Run: node scripts/normalize-icons.mjs

import fs from 'fs';

function fmtSw(sw) {
  return Number.isInteger(sw) ? String(sw) : sw.toFixed(2).replace(/0+$/, '');
}

function processFile(filePath) {
  let content = fs.readFileSync(filePath, 'utf8');
  let svgCount = 0;

  // Match each complete <svg ...> ... </svg> string
  content = content.replace(/<svg\b([^>]*?)>([\s\S]*?)<\/svg>/g, (_full, svgAttrs, body) => {
    svgCount++;
    let a = svgAttrs;

    // Determine viewBox size
    const vbMatch = a.match(/viewBox="0 0 ([\d.]+) ([\d.]+)"/);
    const size = vbMatch ? parseFloat(vbMatch[1]) : 24;
    const swStr = fmtSw(2 * size / 24);

    // ── SVG tag cleanup ──
    a = a.replace(/ width="[\d.]+"/g, '');
    a = a.replace(/ height="[\d.]+"/g, '');
    a = a.replace(/ xmlns="[^"]*"/g, '');

    // Ensure standard attributes on <svg>
    if (!a.includes('stroke="'))        a += ' stroke="currentColor"';
    if (!a.includes('stroke-width="'))  a += ` stroke-width="${swStr}"`;
    else a = a.replace(/stroke-width="[\d.]+"/g, `stroke-width="${swStr}"`);
    if (!a.includes('stroke-linecap="'))  a += ' stroke-linecap="round"';
    else a = a.replace(/stroke-linecap="[^"]+"/g, 'stroke-linecap="round"');
    if (!a.includes('stroke-linejoin="')) a += ' stroke-linejoin="round"';
    else a = a.replace(/stroke-linejoin="[^"]+"/g, 'stroke-linejoin="round"');

    // ── Child element normalization ──
    let newBody = body;

    // Normalize child stroke-widths in the 1.0–2.0 "primary" range
    newBody = newBody.replace(/stroke-width="([\d.]+)"/g, (_m, val) => {
      const v = parseFloat(val);
      if (v >= 1.0 && v <= 2.0) return `stroke-width="${swStr}"`;
      return _m; // leave outliers (< 1 or > 2) untouched
    });

    // Normalize child linecap/linejoin (only where attribute already exists)
    newBody = newBody.replace(/stroke-linecap="[^"]+"/g, 'stroke-linecap="round"');
    newBody = newBody.replace(/stroke-linejoin="[^"]+"/g, 'stroke-linejoin="round"');

    return `<svg${a}>${newBody}</svg>`;
  });

  fs.writeFileSync(filePath, content, 'utf8');
  console.log(`  ${filePath}: ${svgCount} SVGs deep-normalized`);
}

console.log('Deep-normalizing icon SVG attributes to Lucide-equivalent weight...\n');

const root = 'd:/AI/Parallx/src';
processFile(`${root}/built-in/canvas/canvasIcons.ts`);
processFile(`${root}/built-in/chat/chatIcons.ts`);
processFile(`${root}/ui/iconRegistry.ts`);

console.log('\nDone.');
