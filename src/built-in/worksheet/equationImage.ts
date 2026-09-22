// Equations and metafiles as pictures the sheet can show.
//
// Two things Excel puts in a Rising Fellow problem that Univer cannot draw:
// an inserted equation (Office Math in a shape) and a Windows metafile
// (EMF/WMF, which Excel writes for pasted equations and figures). Both were
// lost on import: the equation as its linear text, the metafile as a skipped
// picture. This pass, run on a sheet between reading and snapshotting it,
// turns each into a PNG.
//
// Equation: KaTeX renders the LaTeX (omml.ts) to HTML; the HTML goes into an
// SVG foreignObject with KaTeX's stylesheet and fonts embedded, because an
// SVG drawn onto a canvas may load nothing from outside itself; the SVG is
// drawn at 2x and read back as PNG. The stored picture is small; the fonts
// live only in the throwaway SVG.
//
// Metafile: the bytes go to the main process (imageBridge.cjs), where GDI+
// rasterises them. Anything that fails leaves the sheet as it was.
import katex from 'katex';
import type { RenderedEquation, XlsxSheet } from './ooxml.js';

interface MetafileResult { readonly png: Uint8Array; readonly width: number; readonly height: number; readonly scale: number }
interface ElectronImages { rasterizeMetafile(bytes: Uint8Array, ext: 'emf' | 'wmf'): Promise<MetafileResult | null> }

let cssPromise: Promise<string | null> | null = null;

/** KaTeX's stylesheet as the page carries it, with its woff2 fonts inlined. */
function katexCssWithFonts(): Promise<string | null> {
  if (!cssPromise) {
    cssPromise = (async () => {
      let css = '';
      for (const sheet of Array.from(document.styleSheets)) {
        let rules: CSSRuleList;
        try { rules = sheet.cssRules; } catch { continue; }
        for (const rule of Array.from(rules)) {
          const text = rule.cssText;
          if (text.includes('.katex') || text.includes('KaTeX_')) css += `${text}\n`;
        }
      }
      if (!css.includes('.katex')) return null;
      const fonts = new Map<string, string>();
      const urls = new Set<string>();
      for (const m of css.matchAll(/url\(["']?([^"')]+\.woff2)["']?\)/g)) urls.add(m[1]);
      await Promise.all([...urls].map(async (u) => {
        try {
          const res = await fetch(new URL(u, document.baseURI).href);
          if (!res.ok) return;
          const buf = new Uint8Array(await res.arrayBuffer());
          let bin = '';
          for (let i = 0; i < buf.length; i += 0x8000) bin += String.fromCharCode(...buf.subarray(i, i + 0x8000));
          fonts.set(u, `data:font/woff2;base64,${btoa(bin)}`);
        } catch { /* the glyphs fall back to the page's fonts */ }
      }));
      // Keep only the woff2 sources, inlined where fetched.
      css = css.replace(/src:\s*([^;]+);/g, (whole, srcs: string) => {
        const parts = srcs.split(',').map((p) => p.trim()).filter((p) => p.includes('.woff2'));
        if (!parts.length) return whole;
        const mapped = parts.map((p) => p.replace(/url\(["']?([^"')]+)["']?\)/, (mm, u: string) => (fonts.has(u) ? `url(${fonts.get(u)})` : mm)));
        return `src: ${mapped.join(', ')};`;
      });
      return css;
    })();
  }
  return cssPromise;
}

function loadImage(url: string): Promise<HTMLImageElement> {
  return new Promise((resolve, reject) => {
    const img = new Image();
    img.onload = () => resolve(img);
    img.onerror = () => reject(new Error('image failed to load'));
    img.src = url;
  });
}

/** One equation as a PNG at 2x, sized to the rendered maths at `fontPx`. */
export async function renderEquationPng(latex: string, opts: { fontPx?: number; scale?: number } = {}): Promise<RenderedEquation | null> {
  if (typeof document === 'undefined' || !latex.trim()) return null;
  try {
    const fontPx = opts.fontPx ?? 15;
    const scale = opts.scale ?? 2;
    const html = katex.renderToString(latex, { throwOnError: false, displayMode: false, output: 'html', strict: 'ignore' });
    const css = await katexCssWithFonts();
    if (!css) return null;
    const style = `font-size:${fontPx}px;line-height:1.2;white-space:nowrap;display:inline-block;padding:2px 4px;color:#000;`;
    // Size from the live document, where the same fonts are loaded.
    const probe = document.createElement('div');
    probe.style.cssText = `position:absolute;left:-10000px;top:0;${style}`;
    probe.innerHTML = html;
    document.body.appendChild(probe);
    const box = probe.getBoundingClientRect();
    probe.remove();
    const width = Math.ceil(box.width);
    const height = Math.ceil(box.height);
    if (!width || !height) return null;
    const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="${width}" height="${height}"><foreignObject width="100%" height="100%"><div xmlns="http://www.w3.org/1999/xhtml" style="${style}"><style>${css}</style>${html}</div></foreignObject></svg>`;
    const url = URL.createObjectURL(new Blob([svg], { type: 'image/svg+xml;charset=utf-8' }));
    try {
      const img = await loadImage(url);
      const canvas = document.createElement('canvas');
      canvas.width = width * scale;
      canvas.height = height * scale;
      const ctx = canvas.getContext('2d');
      if (!ctx) return null;
      ctx.scale(scale, scale);
      ctx.drawImage(img, 0, 0);
      const dataUrl = canvas.toDataURL('image/png');
      return { mime: 'image/png', base64: dataUrl.slice(dataUrl.indexOf(',') + 1), width, height };
    } finally {
      URL.revokeObjectURL(url);
    }
  } catch {
    return null;
  }
}

function base64ToBytes(b64: string): Uint8Array {
  const bin = atob(b64);
  const out = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i);
  return out;
}
function bytesToBase64(bytes: Uint8Array): string {
  let bin = '';
  for (let i = 0; i < bytes.length; i += 0x8000) bin += String.fromCharCode(...bytes.subarray(i, i + 0x8000));
  return btoa(bin);
}

export interface EnrichStats { equations: number; equationsFailed: number; metafiles: number; metafilesFailed: number }

/**
 * Render every equation text box and rasterise every metafile picture on a
 * sheet, in place, before it is snapshotted. Failures leave the item as it
 * was: the equation as its linear text box, the metafile as a skipped picture.
 */
export async function enrichSheetDrawings(sheet: XlsxSheet, opts: { fontPx?: number } = {}): Promise<EnrichStats> {
  const stats: EnrichStats = { equations: 0, equationsFailed: 0, metafiles: 0, metafilesFailed: 0 };
  for (const tb of sheet.textBoxes) {
    if (!tb.latex || tb.rendered) continue;
    const rendered = await renderEquationPng(tb.latex, { fontPx: opts.fontPx ?? fontPxOf(tb) });
    if (rendered) { tb.rendered = rendered; stats.equations++; } else stats.equationsFailed++;
  }
  const images = typeof window !== 'undefined'
    ? (window as unknown as { parallxElectron?: { images?: ElectronImages } }).parallxElectron?.images
    : undefined;
  for (const img of sheet.images) {
    const ext = img.mime === 'image/x-emf' ? 'emf' : img.mime === 'image/x-wmf' ? 'wmf' : null;
    if (!ext) continue;
    if (!images?.rasterizeMetafile) { stats.metafilesFailed++; continue; }
    try {
      const res = await images.rasterizeMetafile(base64ToBytes(img.base64), ext);
      if (res && res.png.length) {
        img.mime = 'image/png';
        img.base64 = bytesToBase64(res.png);
        stats.metafiles++;
      } else stats.metafilesFailed++;
    } catch { stats.metafilesFailed++; }
  }
  return stats;
}

/** The equation's size follows the largest run size Excel gave the box, at the sheet's 96 dpi. */
function fontPxOf(tb: XlsxSheet['textBoxes'][number]): number {
  let pt = 0;
  for (const p of tb.paragraphs) for (const r of p.runs) if (r.size && r.size > pt) pt = r.size;
  return pt ? Math.round(pt * 96 / 72) : 15;
}
