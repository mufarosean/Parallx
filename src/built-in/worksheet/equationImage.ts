// Equations and metafiles as pictures the sheet can show.
//
// Two things Excel puts in a Rising Fellow problem that Univer cannot draw:
// an inserted equation (Office Math in a shape) and a Windows metafile
// (EMF/WMF, which Excel writes for pasted equations and figures). Both were
// lost on import: the equation as its linear text, the metafile as a skipped
// picture. This pass, run on a sheet between reading and snapshotting it,
// turns each into a PNG through the main process (imageBridge.cjs): the
// equations' LaTeX (omml.ts) is rendered by KaTeX in an offscreen window and
// captured at 2x; the metafiles are rasterised by GDI+. The renderer cannot
// do the first itself, because an SVG with HTML inside taints any canvas it
// is drawn on. Anything that fails leaves the item as it was.
import type { RenderedEquation, XlsxSheet } from './ooxml.js';

interface MetafileResult { readonly png: Uint8Array; readonly width: number; readonly height: number; readonly scale: number }
interface EquationResult { readonly png: Uint8Array; readonly width: number; readonly height: number }
interface ElectronImages {
  rasterizeMetafile(bytes: Uint8Array, ext: 'emf' | 'wmf'): Promise<MetafileResult | null>;
  renderEquations(items: ReadonlyArray<{ latex: string; fontPx: number }>): Promise<ReadonlyArray<EquationResult | null>>;
}

function bridge(): ElectronImages | undefined {
  return typeof window !== 'undefined'
    ? (window as unknown as { parallxElectron?: { images?: ElectronImages } }).parallxElectron?.images
    : undefined;
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

/** One equation as a PNG at 2x, sized to the rendered maths at `fontPx`. */
export async function renderEquationPng(latex: string, opts: { fontPx?: number } = {}): Promise<RenderedEquation | null> {
  const images = bridge();
  if (!images?.renderEquations || !latex.trim()) return null;
  try {
    const [res] = await images.renderEquations([{ latex, fontPx: opts.fontPx ?? 15 }]);
    return res && res.png.length ? { mime: 'image/png', base64: bytesToBase64(res.png), width: res.width, height: res.height } : null;
  } catch { return null; }
}

export interface EnrichStats { equations: number; equationsFailed: number; metafiles: number; metafilesFailed: number }

/**
 * Render every equation text box and rasterise every metafile picture on a
 * sheet, in place, before it is snapshotted. Failures leave the item as it
 * was: the equation as its linear text box, the metafile as a skipped picture.
 */
export async function enrichSheetDrawings(sheet: XlsxSheet, opts: { fontPx?: number } = {}): Promise<EnrichStats> {
  const stats: EnrichStats = { equations: 0, equationsFailed: 0, metafiles: 0, metafilesFailed: 0 };
  const images = bridge();

  // Equations, one round trip for the sheet.
  const boxes = sheet.textBoxes.filter((tb) => tb.latex && !tb.rendered);
  if (boxes.length) {
    let results: ReadonlyArray<EquationResult | null> = [];
    if (images?.renderEquations) {
      try { results = await images.renderEquations(boxes.map((tb) => ({ latex: tb.latex as string, fontPx: opts.fontPx ?? fontPxOf(tb) }))); } catch { results = []; }
    }
    boxes.forEach((tb, i) => {
      const res = results[i];
      if (res && res.png.length) { tb.rendered = { mime: 'image/png', base64: bytesToBase64(res.png), width: res.width, height: res.height }; stats.equations++; }
      else stats.equationsFailed++;
    });
  }

  // Metafiles, one at a time.
  for (const img of sheet.images) {
    const ext = img.mime === 'image/x-emf' ? 'emf' : img.mime === 'image/x-wmf' ? 'wmf' : null;
    if (!ext) continue;
    if (!images?.rasterizeMetafile) { stats.metafilesFailed++; continue; }
    try {
      const res = await images.rasterizeMetafile(base64ToBytes(img.base64), ext);
      if (res && res.png.length) { img.mime = 'image/png'; img.base64 = bytesToBase64(res.png); stats.metafiles++; }
      else stats.metafilesFailed++;
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
