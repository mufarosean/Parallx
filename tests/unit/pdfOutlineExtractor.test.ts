// pdfOutlineExtractor.test.ts — extractText gives a PDF's bookmarks as a flat
// outline: [{ title, page, level }], page 1-based, level 0 at the top, in
// document order; [] when the file has none. Explicit destinations
// ([pageRef /XYZ …]) and named ones (/Names /Dests) both resolve.

import { afterEach, describe, expect, it } from 'vitest';
import { createRequire } from 'node:module';
import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';

const require = createRequire(import.meta.url);
const { extractText } = require('../../electron/documentExtractor.cjs');

/**
 * A hand-built three-page PDF. With `withOutline`, the catalog carries an
 * outline: Intro (p1), Methods (p2) with the child Details (p3, a named
 * destination), Results (p3).
 */
function buildPdf(withOutline: boolean): Buffer {
  const objs: string[] = [];
  const add = (s: string) => { objs.push(s); return objs.length; };
  const content = (t: string) => {
    const s = `BT /F1 24 Tf 72 700 Td (${t}) Tj ET`;
    return `<< /Length ${s.length} >>\nstream\n${s}\nendstream`;
  };
  add(withOutline
    ? '<< /Type /Catalog /Pages 2 0 R /Outlines 10 0 R /PageMode /UseOutlines /Names << /Dests 15 0 R >> >>'
    : '<< /Type /Catalog /Pages 2 0 R >>');
  add('<< /Type /Pages /Kids [4 0 R 5 0 R 6 0 R] /Count 3 >>');
  add('<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>');
  for (let i = 0; i < 3; i++) {
    add(`<< /Type /Page /Parent 2 0 R /MediaBox [0 0 612 792] /Resources << /Font << /F1 3 0 R >> >> /Contents ${7 + i} 0 R >>`);
  }
  add(content('Page one'));
  add(content('Page two'));
  add(content('Page three'));
  if (withOutline) {
    add('<< /Type /Outlines /First 11 0 R /Last 14 0 R /Count 4 >>');
    add('<< /Title (Intro) /Parent 10 0 R /Next 12 0 R /Dest [4 0 R /XYZ 0 792 0] >>');
    add('<< /Title (Methods) /Parent 10 0 R /Prev 11 0 R /Next 14 0 R /First 13 0 R /Last 13 0 R /Count 1 /Dest [5 0 R /Fit] >>');
    add('<< /Title (Details) /Parent 12 0 R /Dest (details) >>');
    add('<< /Title (Results) /Parent 10 0 R /Prev 12 0 R /Dest [6 0 R /XYZ 0 792 0] >>');
    add('<< /Names [(details) [6 0 R /XYZ 0 700 0]] >>');
  }
  let out = '%PDF-1.4\n';
  const offsets: number[] = [];
  objs.forEach((o, i) => { offsets.push(out.length); out += `${i + 1} 0 obj\n${o}\nendobj\n`; });
  const xref = out.length;
  out += `xref\n0 ${objs.length + 1}\n0000000000 65535 f \n`;
  for (const off of offsets) out += `${String(off).padStart(10, '0')} 00000 n \n`;
  out += `trailer\n<< /Size ${objs.length + 1} /Root 1 0 R >>\nstartxref\n${xref}\n%%EOF\n`;
  return Buffer.from(out, 'latin1');
}

describe('PDF outline extraction', () => {
  let dir: string | undefined;

  afterEach(async () => {
    if (dir) await rm(dir, { recursive: true, force: true });
    dir = undefined;
  });

  it('lists the bookmarks flat, in order, with 1-based pages and levels', async () => {
    dir = await mkdtemp(path.join(tmpdir(), 'px-pdf-outline-'));
    const file = path.join(dir, 'outline.pdf');
    await writeFile(file, buildPdf(true));
    const result = await extractText(file);
    expect(result.format).toBe('pdf');
    expect(result.pageTexts).toEqual(['Page one', 'Page two', 'Page three']);
    expect(result.outline).toEqual([
      { title: 'Intro', page: 1, level: 0 },
      { title: 'Methods', page: 2, level: 0 },
      { title: 'Details', page: 3, level: 1 },
      { title: 'Results', page: 3, level: 0 },
    ]);
  });

  it('is [] for a PDF without bookmarks', async () => {
    dir = await mkdtemp(path.join(tmpdir(), 'px-pdf-outline-'));
    const file = path.join(dir, 'plain.pdf');
    await writeFile(file, buildPdf(false));
    const result = await extractText(file);
    expect(result.metadata).toEqual({ pageCount: 3 });
    expect(result.outline).toEqual([]);
  });
});
