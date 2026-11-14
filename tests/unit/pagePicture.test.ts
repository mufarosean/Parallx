// pagePicture.test.ts — what a citation's card shows of a page: where the
// quote is, how much of the page round it, and how large. (The drawing
// itself is checked in the hidden app: tests/probes/chat-citation-probe.mjs.)
import { describe, expect, it } from 'vitest';
import { pieceBands, pieceOfPage, pieceRegion, planPiece, quoteItemRects, type ITextItem } from '../../src/services/pagePicture';

const PAGE = { width: 600, height: 800 };
/** A page shown upright at scale 1: page space has its origin bottom-left. */
const toView = (x: number, y: number) => [x, PAGE.height - y];
/** A line of text 10 points tall whose baseline is `fromTop` points down the page. */
const line = (str: string, fromTop: number, x = 60, width = 300): ITextItem => ({ str, transform: [10, 0, 0, 10, x, PAGE.height - fromTop], width, height: 10 });

describe('quoteItemRects', () => {
  const items = [line('Chapter 7: Reserving', 100), line('The selected tail factor is 1.05,', 200), line('from the inverse power curve.', 214, 60, 260), line('Nothing else.', 300)];

  it('gives the rectangles of the text items that hold the quote, on the page as shown', () => {
    const rects = quoteItemRects(items, 'tail factor is 1.05, from the inverse', toView);
    expect(rects).toHaveLength(2);
    // The first line: from its top (10 above the baseline) to a little under the baseline.
    expect(rects[0]).toEqual({ x: 60, y: 190, w: 300, h: 12.5 });
    expect(rects[1]).toMatchObject({ x: 60, w: 260 });
  });

  it('gives nothing for words that are not on the page, or a scrap', () => {
    expect(quoteItemRects(items, 'Bornhuetter and Ferguson', toView)).toEqual([]);
    expect(quoteItemRects(items, 'is', toView)).toEqual([]);
    expect(quoteItemRects([], 'tail factor', toView)).toEqual([]);
  });
});

describe('pieceRegion', () => {
  it('shows a block whole, with a little of the page round it, inside the page', () => {
    expect(pieceRegion(PAGE, [], { x: 60, y: 200, w: 480, h: 120 })).toEqual({ x: 48, y: 188, w: 504, h: 144 });
    expect(pieceRegion(PAGE, [], { x: 0, y: 0, w: 600, h: 100 })).toEqual({ x: 0, y: 0, w: 600, h: 112 });
  });

  it('shows the quote\'s lines with lines of the page above and below, at least half the page wide', () => {
    const region = pieceRegion(PAGE, [{ x: 60, y: 190, w: 120, h: 12 }])!;
    expect(region.w).toBeCloseTo(330);            // 55% of the page, not the 120 the line is wide
    expect(region.x).toBeCloseTo(0);              // centred on the line, kept inside the page
    expect(region.y).toBeCloseTo(190 - 12 * 2.4);
    expect(region.y + region.h).toBeCloseTo(202 + 12 * 2.4);
  });

  it('takes a line that spans the page whole, with a margin, and stops at the page\'s edges', () => {
    const top = pieceRegion(PAGE, [{ x: 20, y: 4, w: 560, h: 12 }])!;
    expect(top).toMatchObject({ x: 8, y: 0, w: 584 });
    expect(pieceRegion(PAGE, [{ x: 0, y: 4, w: 600, h: 12 }])).toMatchObject({ x: 0, w: 600 });
    const bottom = pieceRegion(PAGE, [{ x: 20, y: 790, w: 560, h: 10 }])!;
    expect(bottom.y + bottom.h).toBe(800);
  });

  it('has nothing to show when the quote was not found and sits in no block', () => {
    expect(pieceRegion(PAGE, [])).toBeNull();
  });
});

describe('pieceBands', () => {
  /** A table from 100 to 700 down the page; its heading rows end at 140. */
  const TABLE = { x: 50, y: 100, w: 500, h: 600 };
  const row = (y: number) => ({ x: 60, y, w: 200, h: 12 });

  it('shows a piece whole when it fits the room', () => {
    expect(pieceBands(TABLE, [row(400)], 600, 140)).toEqual([TABLE]);
  });

  it('shows a tall table as its heading and the rows round the quote, filling the room', () => {
    const [head, rows] = pieceBands(TABLE, [row(400)], 300, 140);
    expect(head).toEqual({ x: 50, y: 100, w: 500, h: 40 });          // down to the heading's end
    expect(rows.h).toBeCloseTo(260);                                 // the rest of the room
    expect(rows.y + rows.h / 2).toBeCloseTo(406);                    // centred on the quoted row
    expect(rows).toMatchObject({ x: 50, w: 500 });
  });

  it('cuts between rows, never through one, when it knows where the rows part', () => {
    // Rows 20 tall from the heading's end at 140 to the table's end.
    const edges = Array.from({ length: 28 }, (_, i) => 140 + 20 * i);
    const [head, rows] = pieceBands(TABLE, [{ x: 60, y: 409, w: 200, h: 12 }], 300, 140, edges);
    expect(head).toEqual({ x: 50, y: 100, w: 500, h: 40 });
    expect(rows.y).toBe(300);                                        // the first parting under where the room would start (285)
    expect(rows.y + rows.h).toBe(540);                               // the last one above where it would end (545)
    // One part: its end falls between rows too.
    expect(pieceBands(TABLE, [{ x: 60, y: 165, w: 200, h: 12 }], 290, 140, edges)).toEqual([{ x: 50, y: 100, w: 500, h: 280 }]);
    // A heading taller than its share stops at a parting inside the share.
    expect(pieceBands(TABLE, [{ x: 60, y: 609, w: 200, h: 12 }], 300, 400, edges)[0].h).toBe(120);
  });

  it('keeps the rows inside the table when the quote is in its last row', () => {
    const [, rows] = pieceBands(TABLE, [row(686)], 300, 140);
    expect(rows.y + rows.h).toBeCloseTo(700);
  });

  it('is one part from the top when the quote sits under the heading, or in it', () => {
    expect(pieceBands(TABLE, [row(150)], 300, 140)).toEqual([{ x: 50, y: 100, w: 500, h: 300 }]);
    expect(pieceBands(TABLE, [row(110)], 300, 140)).toEqual([{ x: 50, y: 100, w: 500, h: 300 }]);
  });

  it('gives a tall heading two fifths of the room at most', () => {
    const [head, rows] = pieceBands(TABLE, [row(600)], 300, 400);
    expect(head.h).toBeCloseTo(120);
    expect(rows.h).toBeCloseTo(180);
  });

  it('with no heading to keep, shows the part round the quote; with no quote found, the top', () => {
    const [only] = pieceBands(TABLE, [row(400)], 300);
    expect(only.h).toBe(300);
    expect(only.y + only.h / 2).toBeCloseTo(406);
    expect(pieceBands(TABLE, [], 300, 140)).toEqual([{ x: 50, y: 100, w: 500, h: 300 }]);
  });
});

describe('planPiece', () => {
  const ROOM = { maxWidth: 540, maxHeight: 420 };

  it('shows a line of the page about as tall as a line of the chat', () => {
    // A 12-unit line box is shown 18 pixels tall: 1.5 shown pixels to a unit.
    const plan = planPiece(PAGE, [{ x: 60, y: 190, w: 120, h: 12 }], ROOM)!;
    expect(plan.scale).toBeCloseTo(1.5);
    expect(plan.bands).toHaveLength(1);
    expect(plan.bands[0].w * plan.scale).toBeCloseTo(495);            // 55% of the page, shown to be read
  });

  it('makes small print larger, as far as the room is wide', () => {
    const wide = planPiece(PAGE, [{ x: 20, y: 300, w: 560, h: 6 }], ROOM)!;
    expect(wide.bands[0].w * wide.scale).toBeCloseTo(540);
    expect(wide.scale).toBeLessThan(18 / 6);
  });

  it('measures by the lines whatever the units: a photo of a page in its own pixels', () => {
    const photo = { width: 3000, height: 4000 };
    const plan = planPiece(photo, [{ x: 300, y: 1000, w: 1200, h: 60 }], ROOM)!;
    expect(plan.scale).toBeCloseTo(0.3);
    expect(plan.bands[0].w * plan.scale).toBeCloseTo(495);
  });

  it('shows a figure whole, smaller when it is tall', () => {
    const plan = planPiece(PAGE, [], ROOM, { kind: 'figure', box: { x: 100, y: 50, w: 400, h: 700 } })!;
    expect(plan.bands).toHaveLength(1);
    expect(plan.bands[0].h * plan.scale).toBeCloseTo(420);
  });

  it('cuts a table too tall for the room to its heading and the quoted rows, at a size to be read', () => {
    const plan = planPiece(PAGE, [{ x: 60, y: 600, w: 200, h: 12 }], ROOM, { kind: 'table', box: { x: 50, y: 100, w: 500, h: 600 }, headBottom: 140 })!;
    expect(plan.bands).toHaveLength(2);
    expect(plan.bands[0].y).toBe(88);                                 // the table's top, with the page round it
    const shown = plan.bands.reduce((h, b) => h + b.h * plan.scale, 0);
    expect(shown).toBeCloseTo(420);
    expect(plan.scale).toBeCloseTo(540 / 524);                        // as wide as the room; the line would allow more
  });

  it('has no plan when there is nothing to show', () => {
    expect(planPiece(PAGE, [], ROOM)).toBeNull();
  });
});

describe('pieceOfPage', () => {
  it('makes nothing for a link with no quote, or a file that is neither a PDF nor a picture', async () => {
    expect(await pieceOfPage('D:/papers/clark.pdf', { page: 3 })).toBeNull();
    expect(await pieceOfPage('D:/papers/clark.pdf', { page: 3, quote: '   ' })).toBeNull();
    expect(await pieceOfPage('D:/notes/plan.docx', { quote: 'the opening words of a block' })).toBeNull();
  });
});
