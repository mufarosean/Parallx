// pdfReadingTextLayer.test.ts — a scanned page reports the document reader's
// lines as its text, placed where they are on the picture; a page with text
// of its own keeps it.

import { describe, it, expect } from 'vitest';
import { applyReadingTextLayer, readingTextContent } from '../../src/editor/panes/pdf/pdfReadingTextLayer';
import type { IDocumentReading, IReadingPage } from '../../src/services/documentReading';

/** A page shown upright at scale 1: page space has its origin bottom-left. */
const upright = (width: number, height: number) => ({
  width, height, convertToPdfPoint: (x: number, y: number) => [x, height - y],
});
/** The same page turned a quarter turn clockwise for display. */
const quarterTurn = (width: number, height: number) => ({
  // Shown width is the page's height and the other way round.
  width: height, height: width, convertToPdfPoint: (x: number, y: number) => [y, x],
});

const page: IReadingPage = {
  page: 1, width: 1200, height: 1600,
  lines: [{ text: 'The ultimate loss', box: [100, 200, 700, 240] }, { text: '', box: [0, 0, 0, 0] } as never],
};

describe('readingTextContent', () => {
  it('places a line by its box, scaled from the picture to the page', () => {
    // The picture is 1200 x 1600; the PDF page is 600 x 800 points.
    const content = readingTextContent(page, upright(600, 800));
    expect(content.items).toHaveLength(1);
    const [item] = content.items;
    expect(item.str).toBe('The ultimate loss');
    expect(item.hasEOL).toBe(true);
    expect(item.width).toBeCloseTo(300);
    expect(item.height).toBeCloseTo(20);
    // Text runs along +x, upright, 20 points tall; its baseline is 0.8 of the
    // way down the box: 800 - (100 + 16) = 684.
    const [a, b, c, d, e, f] = item.transform;
    expect([a, b, c, d].map((n) => Math.round(n))).toEqual([20, 0, 0, 20]);
    expect(e).toBeCloseTo(50);
    expect(f).toBeCloseTo(684);
    expect(content.styles[item.fontName].ascent).toBeCloseTo(0.8);
  });

  it('follows a turned page: the text matrix turns with it', () => {
    const turned: IReadingPage = { page: 1, width: 800, height: 600, lines: [{ text: 'sideways', box: [80, 60, 480, 100] }] };
    const [item] = readingTextContent(turned, quarterTurn(600, 800)).items;
    const [a, b, c, d] = item.transform.map((n) => Math.round(n));
    // Along the line is +y in page space; up from the line is -x.
    expect([a, b, c, d]).toEqual([0, 40, -40, 0]);
  });

  it('skips a line whose box has no size', () => {
    const flat: IReadingPage = { page: 1, width: 100, height: 100, lines: [{ text: 'x', box: [10, 10, 10, 20] }] };
    expect(readingTextContent(flat, upright(100, 100)).items).toEqual([]);
  });
});

function fakeDoc(ownText: Record<number, string>) {
  const pages = new Map<number, unknown>();
  const calls: number[] = [];
  const doc = {
    getPage: async (n: number) => {
      calls.push(n);
      if (!pages.has(n)) {
        pages.set(n, {
          getViewport: () => upright(600, 800),
          getTextContent: async () => ({ items: ownText[n] ? [{ str: ownText[n] }] : [], styles: {}, own: true }),
          streamTextContent: () => new ReadableStream({ start(c) { c.enqueue({ items: ownText[n] ? [{ str: ownText[n] }] : [], own: true }); c.close(); } }),
        });
      }
      return pages.get(n);
    },
  };
  return { doc, calls };
}

async function drain(stream: ReadableStream<unknown>): Promise<unknown[]> {
  const out: unknown[] = [];
  const reader = stream.getReader();
  for (;;) { const { done, value } = await reader.read(); if (done) break; out.push(value); }
  return out;
}

const reading: IDocumentReading = {
  version: 1, ocr: true, blocks: [], tables: [],
  pages: [
    { page: 1, width: 600, height: 800, lines: [{ text: 'read from the scan', box: [50, 50, 300, 70] }] },
    { page: 2, width: 600, height: 800, lines: [{ text: 'the reader also read this', box: [50, 50, 300, 70] }] },
    { page: 3, width: 600, height: 800, lines: [] },
  ],
};

describe('applyReadingTextLayer', () => {
  it('gives a page with no text the reader\'s lines, through both ways pdf.js asks', async () => {
    const { doc } = fakeDoc({});
    expect(applyReadingTextLayer(doc as never, reading)).toBe(2);
    const p1 = await doc.getPage(1) as { getTextContent(): Promise<{ items: { str: string }[] }>; streamTextContent(): ReadableStream<unknown> };
    expect((await p1.getTextContent()).items.map((i) => i.str)).toEqual(['read from the scan']);
    const chunks = await drain(p1.streamTextContent()) as { items: { str: string }[] }[];
    expect(chunks).toHaveLength(1);
    expect(chunks[0].items.map((i) => i.str)).toEqual(['read from the scan']);
  });

  it('leaves a page that has its own text alone', async () => {
    const { doc } = fakeDoc({ 2: 'This page has its own text.' });
    applyReadingTextLayer(doc as never, reading);
    const p2 = await doc.getPage(2) as { getTextContent(): Promise<{ items: { str: string }[]; own?: boolean }>; streamTextContent(): ReadableStream<unknown> };
    const content = await p2.getTextContent();
    expect(content.own).toBe(true);
    expect(content.items[0].str).toBe('This page has its own text.');
    const chunks = await drain(p2.streamTextContent()) as { own?: boolean }[];
    expect(chunks[0].own).toBe(true);
  });

  it('touches no page the reading has no lines for, and nothing at all without a reading', async () => {
    const { doc } = fakeDoc({});
    const before = doc.getPage;
    expect(applyReadingTextLayer(doc as never, null)).toBe(0);
    expect(applyReadingTextLayer(doc as never, { ...reading, pages: [reading.pages[2]] })).toBe(0);
    expect(doc.getPage).toBe(before);
    applyReadingTextLayer(doc as never, reading);
    const p3 = await doc.getPage(3) as { getTextContent(): Promise<{ own?: boolean }> };
    expect((await p3.getTextContent()).own).toBe(true);
  });

  it('patches a page once however often it is asked for', async () => {
    const { doc } = fakeDoc({});
    applyReadingTextLayer(doc as never, reading);
    const a = await doc.getPage(1) as { getTextContent: unknown };
    const first = a.getTextContent;
    const b = await doc.getPage(1) as { getTextContent: unknown };
    expect(b).toBe(a);
    expect(b.getTextContent).toBe(first);
  });
});
