// @vitest-environment jsdom
// pdfLinkReveal.test.ts — a link's page and quote applied to an open PDF: the
// page, the find that washes the quote, and a frame with its name round a
// table or figure the quote points at.
import { afterEach, describe, expect, it, vi } from 'vitest';
import { PdfLinkReveal, type IPdfLinkRevealHost } from '../../src/editor/panes/pdf/pdfLinkReveal';

const cells = (rows: string[][]) => rows.flatMap((row, r) => row.map((text, c) => ({ r, c, rs: 1, cs: 1, text })));
const READING = {
  version: 1, ocr: false,
  pages: [{ page: 1, width: 600, height: 800, lines: [] }, { page: 2, width: 600, height: 800, lines: [] }],
  blocks: [{ label: 'caption', page: 2, box: [60, 180, 400, 196], text: 'Table 3: Selected development factors' }, { label: 'table', page: 2, box: [60, 200, 540, 320] }],
  tables: [{ page: 2, box: [60, 200, 540, 320], rows: 2, cols: 3, cells: cells([['Age', 'Paid', 'Incurred'], ['120', '1.05', '1.02']]) }],
};

function setup(o: { reading?: unknown; rotation?: number } = {}) {
  (globalThis as { parallxElectron?: unknown }).parallxElectron = { docling: { reading: vi.fn(async () => (o.reading === undefined ? READING : o.reading)) } };
  const container = document.createElement('div');
  const pages = [1, 2].map(() => container.appendChild(document.createElement('div')));
  document.body.appendChild(container);
  Element.prototype.scrollIntoView = vi.fn(); // jsdom lays nothing out, so it has none
  const viewer = { currentPageNumber: 1, pagesRotation: o.rotation ?? 0 };
  const find = vi.fn();
  const shown: number[] = [];
  const state = { path: 'D:/papers/friedland.pdf' as string | undefined };
  const host: IPdfLinkRevealHost = {
    viewer: () => viewer as never, pageCount: () => 2, fsPath: () => state.path, find,
    showPage: (p) => shown.push(p), pageView: (p) => ({ div: pages[p - 1] }), viewerContainer: () => container,
  };
  return { reveal: new PdfLinkReveal(host), viewer, find, shown, pages, container, state, frame: () => container.querySelector('.pdf-cited-block') as HTMLElement | null };
}

const settle = async () => { for (let i = 0; i < 10; i++) await Promise.resolve(); await new Promise((r) => setTimeout(r, 0)); };

afterEach(() => { delete (globalThis as { parallxElectron?: unknown }).parallxElectron; document.body.innerHTML = ''; });

describe('a link\'s page and quote', () => {
  it('go to the page and send the quote to find, white space collapsed', async () => {
    const s = setup();
    s.reveal.apply(2, 'The  selected\n tail factor');
    expect(s.viewer.currentPageNumber).toBe(2);
    expect(s.shown).toEqual([2]);
    expect(s.find).toHaveBeenCalledWith('The selected tail factor');
    await settle();
    expect(s.frame()).toBeNull(); // ordinary text: the wash is all it gets
  });

  it('ignore a page that is not in the document, and a link with no quote finds nothing', () => {
    const s = setup();
    s.reveal.apply(9, undefined);
    expect(s.viewer.currentPageNumber).toBe(1);
    expect(s.find).not.toHaveBeenCalled();
    s.reveal.apply(undefined, '   ');
    expect(s.find).not.toHaveBeenCalled();
  });
});

describe('a quote that sits in a table', () => {
  it('frames the table where it is on the page, with its name, and brings it into view', async () => {
    const s = setup();
    s.reveal.apply(2, '120 1.05 1.02');
    await settle();
    const frame = s.frame()!;
    expect(frame.parentElement).toBe(s.pages[1]);
    expect([frame.style.left, frame.style.top, frame.style.width, frame.style.height]).toEqual(['10%', '22.5%', '80%', '17.5%']); // the table and its caption
    expect(frame.querySelector('.pdf-cited-block__name')!.textContent).toBe('Table 3');
    expect(frame.getAttribute('aria-label')).toContain('Table 3');
    expect(Element.prototype.scrollIntoView).toHaveBeenCalledWith({ block: 'center' });
  });

  it('is drawn again when pdf.js draws the page again, and only on its own page', async () => {
    const s = setup();
    s.reveal.apply(2, '120 1.05 1.02');
    await settle();
    s.pages[1].replaceChildren(); // what a zoom does to the page's element
    expect(s.frame()).toBeNull();
    s.reveal.renderPage(1);
    expect(s.frame()).toBeNull();
    s.reveal.renderPage(2);
    expect(s.frame()).not.toBeNull();
    s.reveal.renderPage(2);
    expect(s.container.querySelectorAll('.pdf-cited-block')).toHaveLength(1);
  });

  it('stays until the next press in the view', async () => {
    const s = setup();
    s.reveal.apply(2, '120 1.05 1.02');
    await settle();
    s.container.dispatchEvent(new Event('pointerdown', { bubbles: true }));
    expect(s.frame()).toBeNull();
    s.reveal.renderPage(2);
    expect(s.frame()).toBeNull(); // gone for good, not until the next redraw
  });

  it('gives way to the next link, and to a document that was closed meanwhile', async () => {
    const s = setup();
    s.reveal.apply(2, '120 1.05 1.02');
    s.reveal.apply(1, 'ordinary words here'); // before the first reading arrived
    await settle();
    expect(s.frame()).toBeNull();
    s.reveal.apply(2, '120 1.05 1.02');
    s.state.path = 'D:/papers/another.pdf';
    await settle();
    expect(s.frame()).toBeNull();
  });

  it('is left out on a page the reader has turned, and when the file has no reading', async () => {
    const turned = setup({ rotation: 90 });
    turned.reveal.apply(2, '120 1.05 1.02');
    await settle();
    expect(turned.frame()).toBeNull();
    const unread = setup({ reading: null });
    unread.reveal.apply(2, '120 1.05 1.02');
    await settle();
    expect(unread.frame()).toBeNull();
    expect(unread.find).toHaveBeenCalledOnce(); // the find still runs
  });

  it('clear takes it away', async () => {
    const s = setup();
    s.reveal.apply(2, '120 1.05 1.02');
    await settle();
    s.reveal.clear();
    expect(s.frame()).toBeNull();
  });
});
