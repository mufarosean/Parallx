// mindmapSvg.ts — a mindmap document as a standalone SVG string.
//
// The snapshot half of the MINDMAP_BRIEF print contract: the inline canvas
// card, PDF export, and "Copy As SVG" all consume this. Standalone means the
// SVG leaves the app, so no CSS custom properties — a fixed print-friendly
// light palette, the same standalone-theme philosophy as export/printHtml.
//
// Pure string building over mindmapModel geometry; no DOM.

import {
  estimateNodeSize,
  MAX_LABEL_WIDTH,
  type MindmapColor,
  type MindmapDoc,
} from './mindmapModel.js';

/** Print-friendly fills/strokes per named color (light, like printHtml). */
const SVG_PALETTE: Record<MindmapColor, { fill: string; stroke: string }> = {
  neutral: { fill: 'rgb(245,245,243)', stroke: 'rgb(203,203,198)' },
  red:     { fill: 'rgb(250,229,227)', stroke: 'rgb(224,150,144)' },
  yellow:  { fill: 'rgb(250,242,219)', stroke: 'rgb(219,190,110)' },
  green:   { fill: 'rgb(226,243,232)', stroke: 'rgb(140,199,163)' },
  blue:    { fill: 'rgb(226,236,250)', stroke: 'rgb(140,172,219)' },
  accent:  { fill: 'rgb(226,238,247)', stroke: 'rgb(96,148,192)' },
};
const TEXT_COLOR = 'rgb(38,38,36)';
const EDGE_COLOR = 'rgb(168,168,162)';
const LABEL_COLOR = 'rgb(120,120,114)';
const FONT = "13px 'Segoe UI', system-ui, sans-serif";

function esc(s: string): string {
  return s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
}

/** Greedy word wrap mirroring estimateNodeSize's per-line budget. */
function wrapLabel(label: string): string[] {
  const perLine = Math.max(4, Math.floor((MAX_LABEL_WIDTH - 26) / 7.4));
  const out: string[] = [];
  for (const raw of (label || ' ').split('\n')) {
    let line = '';
    for (const word of raw.split(/\s+/)) {
      const candidate = line ? `${line} ${word}` : word;
      if (candidate.length <= perLine || !line) line = candidate;
      else { out.push(line); line = word; }
    }
    out.push(line);
  }
  return out;
}

/** Render the document to a standalone `<svg>` string. */
export function renderMindmapSvg(doc: MindmapDoc): string {
  if (doc.nodes.length === 0) return '<svg xmlns="http://www.w3.org/2000/svg" width="10" height="10"></svg>';

  const boxes = new Map(doc.nodes.map((n) => [n.id, { ...estimateNodeSize(n.label), x: n.x, y: n.y }]));
  const PAD = 40;
  let minX = Infinity; let minY = Infinity; let maxX = -Infinity; let maxY = -Infinity;
  for (const b of boxes.values()) {
    minX = Math.min(minX, b.x);
    minY = Math.min(minY, b.y);
    maxX = Math.max(maxX, b.x + b.w);
    maxY = Math.max(maxY, b.y + b.h);
  }
  const width = Math.ceil(maxX - minX + 2 * PAD);
  const height = Math.ceil(maxY - minY + 2 * PAD);
  const ox = PAD - minX;
  const oy = PAD - minY;

  const parts: string[] = [];
  parts.push(
    `<svg xmlns="http://www.w3.org/2000/svg" width="${width}" height="${height}" viewBox="0 0 ${width} ${height}" font-family="Segoe UI, system-ui, sans-serif">`,
  );

  for (const e of doc.edges) {
    const a = boxes.get(e.from);
    const b = boxes.get(e.to);
    if (!a || !b) continue;
    const acx = a.x + ox + a.w / 2; const acy = a.y + oy + a.h / 2;
    const bcx = b.x + ox + b.w / 2; const bcy = b.y + oy + b.h / 2;
    const horizontal = Math.abs(bcx - acx) * a.h >= Math.abs(bcy - acy) * a.w;
    const start = horizontal
      ? { x: bcx >= acx ? a.x + ox + a.w : a.x + ox, y: acy }
      : { x: acx, y: bcy >= acy ? a.y + oy + a.h : a.y + oy };
    const bHorizontal = Math.abs(acx - bcx) * b.h >= Math.abs(acy - bcy) * b.w;
    const end = bHorizontal
      ? { x: acx >= bcx ? b.x + ox + b.w : b.x + ox, y: bcy }
      : { x: bcx, y: acy >= bcy ? b.y + oy + b.h : b.y + oy };
    const bend = Math.min(120, Math.max(24, Math.hypot(end.x - start.x, end.y - start.y) / 2.6));
    const c1 = horizontal ? `${start.x + Math.sign(end.x - start.x || 1) * bend} ${start.y}` : `${start.x} ${start.y + Math.sign(end.y - start.y || 1) * bend}`;
    const c2 = bHorizontal ? `${end.x + Math.sign(start.x - end.x || 1) * bend} ${end.y}` : `${end.x} ${end.y + Math.sign(start.y - end.y || 1) * bend}`;
    parts.push(`<path d="M ${start.x} ${start.y} C ${c1}, ${c2}, ${end.x} ${end.y}" fill="none" stroke="${EDGE_COLOR}" stroke-width="1.5"/>`);
    if (e.label) {
      parts.push(`<text x="${(acx + bcx) / 2}" y="${(acy + bcy) / 2 - 4}" text-anchor="middle" font-size="10" fill="${LABEL_COLOR}" style="font:${FONT}">${esc(e.label)}</text>`);
    }
  }

  for (const n of doc.nodes) {
    const b = boxes.get(n.id)!;
    const pal = SVG_PALETTE[n.color] ?? SVG_PALETTE.neutral;
    const x = b.x + ox; const y = b.y + oy;
    parts.push(`<rect x="${x}" y="${y}" width="${b.w}" height="${b.h}" rx="10" fill="${pal.fill}" stroke="${pal.stroke}" stroke-width="1"/>`);
    const lines = wrapLabel(n.label);
    lines.forEach((line, i) => {
      parts.push(`<text x="${x + b.w / 2}" y="${y + 13 + i * 19 + (b.h - lines.length * 19) / 2}" text-anchor="middle" font-size="13" fill="${TEXT_COLOR}">${esc(line)}</text>`);
    });
  }

  parts.push('</svg>');
  return parts.join('');
}
