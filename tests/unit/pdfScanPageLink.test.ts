// @vitest-environment jsdom
// pdfScanPageLink.test.ts — the PDF view's half of a page made from its
// document: a press points at the block made from that spot, a scroll is
// followed, and what the page points at is framed.
import { afterEach, describe, expect, it, vi } from 'vitest';
import { PdfScanPageLink, type IPdfScanPageLinkHost } from '../../src/editor/panes/pdf/pdfScanPageLink';
import { PdfLinkReveal } from '../../src/editor/panes/pdf/pdfLinkReveal';
import { scanPageLinks, type IPageSpot, type IScanPageSource, type IScanSpot } from '../../src/services/scanPageLinks';

const FILE = 'D:/Work/Scans/exam.pdf';
const SOURCE: IScanPageSource = {
  pageId: 'page-1', fsPath: FILE,
  anchors: { heading: [1, 60, 60, 400, 90], cell: [1, 300, 226, 540, 260], later: [2, 60, 100, 540, 140] },
  pageSizes: { 1: [600, 800], 2: [600, 800] },
};

/** A PDF view: a scrolling container 400 tall holding two pages, each drawn 300 wide and 400 tall (half the reading's size). */
function view(o: { file?: string; rotation?: number } = {}) {
  const container = document.createElement('div');
  container.className = 'pdf-viewer-container';
  container.getBoundingClientRect = () => ({ left: 100, top: 50, right: 500, bottom: 450, width: 400, height: 400 }) as DOMRect;
  Object.defineProperty(container, 'clientHeight', { value: 400 });
  const pages = [1, 2].map((n) => {
    const page = document.createElement('div');
    page.className = 'page';
    page.dataset.pageNumber = String(n);
    container.appendChild(page);
    return page;
  });
  /** Where the pages sit in the window: they move up as the container scrolls. */
  const place = (): void => pages.forEach((page, i) => { const top = 50 + i * 410 - container.scrollTop; page.getBoundingClientRect = () => ({ left: 150, top, right: 450, bottom: top + 400, width: 300, height: 400 }) as DOMRect; });
  place();
  document.body.appendChild(container);
  const state = { file: o.file ?? FILE };
  const host: IPdfScanPageLinkHost = {
    viewer: () => ({ pagesRotation: o.rotation ?? 0 }) as never,
    fsPath: () => state.file,
    pageView: (n) => ({ div: pages[n - 1] }),
    viewerContainer: () => container,
  };
  const frame = vi.fn();
  const link = new PdfScanPageLink(host, frame);
  return { container, pages, place, host, frame, link, state };
}

let opened: Array<{ dispose(): void }> = [];
const heard = () => { const blocks: IPageSpot[] = []; opened.push(scanPageLinks.onDidPointAtPage((b) => blocks.push(b))); return blocks; };
const openPage = (source: IScanPageSource = SOURCE) => { const d = scanPageLinks.open(source); opened.push(d); return d; };
const press = (el: Element, x: number, y: number, more: MouseEventInit = {}) => el.dispatchEvent(new MouseEvent('click', { bubbles: true, clientX: x, clientY: y, button: 0, ...more }));

afterEach(() => { for (const o of opened) o.dispose(); opened = []; document.body.innerHTML = ''; document.getSelection()?.removeAllRanges(); });

describe('a press on the document', () => {
  it('points at the block made from that spot, and frames it here', () => {
    const v = view();
    opened.push(v.link);
    const blocks = heard();
    openPage();
    // (150 + 200, 50 + 120) on a page drawn at half size: (400, 240) in the reading's units, inside the cell.
    press(v.pages[0], 350, 170);
    expect(blocks).toEqual([{ pageId: 'page-1', blockId: 'cell', how: 'show' }]);
    expect(v.frame).toHaveBeenCalledWith(expect.objectContaining({ page: 1, box: [300, 226, 540, 260], pageWidth: 600, pageHeight: 800 }));
  });

  it('says nothing where no block was made from, with text selected, or for another button', () => {
    const v = view();
    opened.push(v.link);
    const blocks = heard();
    openPage();
    press(v.pages[0], 350, 300); // (400, 500): nothing was read there
    press(v.pages[0], 350, 170, { button: 2 });
    const text = document.createElement('span');
    text.textContent = 'selected words';
    v.pages[0].appendChild(text);
    const range = document.createRange();
    range.selectNodeContents(text);
    document.getSelection()!.addRange(range);
    press(v.pages[0], 350, 170);
    expect(blocks).toEqual([]);
    expect(v.frame).not.toHaveBeenCalled();
  });

  it('is not listened for until a page made from this document is open, nor after it has closed', () => {
    const v = view();
    opened.push(v.link);
    const blocks = heard();
    const added = vi.spyOn(v.container, 'addEventListener');
    v.link.sync();
    expect(added).not.toHaveBeenCalled();
    const other = openPage({ ...SOURCE, pageId: 'page-9', fsPath: 'D:/Work/Scans/other.pdf' });
    expect(added).not.toHaveBeenCalled(); // a page made from another document
    const page = openPage();
    expect(added.mock.calls.map((c) => c[0]).sort()).toEqual(['click', 'scroll']);
    page.dispose();
    other.dispose();
    press(v.pages[0], 350, 170);
    expect(blocks).toEqual([]);
    added.mockRestore();
  });

  it('leaves a turned view alone: the reading measured the pages upright', () => {
    const v = view({ rotation: 90 });
    opened.push(v.link);
    const blocks = heard();
    openPage();
    press(v.pages[0], 350, 170);
    expect(blocks).toEqual([]);
  });
});

describe('scrolling', () => {
  it('the view scrolls: the page is told which block is at the line both keep in step', async () => {
    const v = view();
    opened.push(v.link);
    const blocks = heard();
    openPage();
    v.container.scrollTop = 410; // the second page at the top of the view
    v.place();
    document.elementFromPoint = vi.fn(() => v.pages[1]);
    v.container.dispatchEvent(new Event('scroll'));
    await new Promise((r) => setTimeout(r, 60));
    // The line is a quarter of the way down the view: (300, 150) in the window, 100 down the page as drawn, 200 in the reading's units.
    expect((document.elementFromPoint as ReturnType<typeof vi.fn>).mock.calls[0]).toEqual([300, 150]);
    expect(blocks).toEqual([{ pageId: 'page-1', blockId: 'later', how: 'scroll' }]);
    expect(v.frame).not.toHaveBeenCalled(); // followed quietly
  });

  it('the page scrolls: the same place comes to the same height here, and the move is not sent back', async () => {
    const v = view();
    opened.push(v.link);
    const blocks = heard();
    openPage();
    document.elementFromPoint = vi.fn(() => v.pages[1]);
    scanPageLinks.pointFromPage('page-1', 'later', 'scroll');
    // The block's top is 100 of 800 down the second page: 50 px as drawn, at 460 + 50 in the window; the line is at 150.
    expect(v.container.scrollTop).toBe(360);
    expect(v.frame).not.toHaveBeenCalled();
    v.container.dispatchEvent(new Event('scroll'));
    await new Promise((r) => setTimeout(r, 60));
    expect(blocks).toEqual([]);
  });

  it('the page points at a block: its place is framed here', () => {
    const v = view();
    opened.push(v.link);
    openPage();
    scanPageLinks.pointFromPage('page-1', 'heading', 'show');
    expect(v.frame).toHaveBeenCalledWith(expect.objectContaining({ page: 1, box: [60, 60, 400, 90], how: 'show' }));
  });

  it('a view showing another document hears nothing', () => {
    const v = view({ file: 'D:/Work/Scans/other.pdf' });
    opened.push(v.link);
    openPage();
    scanPageLinks.pointFromPage('page-1', 'heading', 'show');
    expect(v.frame).not.toHaveBeenCalled();
  });
});

describe('the frame for a place a block came from', () => {
  /** The view's link reveal over two pages, each 600 by 800 as the reading measured them. */
  function reveal() {
    const container = document.createElement('div');
    container.getBoundingClientRect = () => ({ left: 0, top: 0, right: 600, bottom: 500, width: 600, height: 500 }) as DOMRect;
    const pages = [1, 2].map(() => { const p = document.createElement('div'); p.className = 'page'; container.appendChild(p); return p; });
    document.body.appendChild(container);
    Element.prototype.scrollIntoView = vi.fn();
    const linkReveal = new PdfLinkReveal({ viewer: () => ({ pagesRotation: 0 }) as never, pageCount: () => 2, fsPath: () => FILE, find: vi.fn(), showPage: vi.fn(), pageView: (n) => ({ div: pages[n - 1] }), viewerContainer: () => container });
    opened.push(linkReveal);
    return { linkReveal, container, pages };
  }
  const spot = (page: number): IScanSpot => ({ fsPath: FILE, page, box: [60, 80, 300, 160], pageWidth: 600, pageHeight: 800, how: 'show' });

  it('is drawn on the page at the block\'s place, with no name on it, and says what it is', () => {
    const r = reveal();
    r.linkReveal.showSpot(spot(1));
    const frame = r.pages[0].querySelector('.pdf-cited-block') as HTMLElement;
    expect([frame.style.left, frame.style.top, frame.style.width, frame.style.height]).toEqual(['10%', '10%', '40%', '10%']);
    expect(frame.querySelector('.pdf-cited-block__name')).toBeNull();
    expect(frame.getAttribute('aria-label')).toBe('Where this part of the page came from');
  });

  it('brings the view to the place only when it is out of sight', () => {
    const r = reveal();
    const inSight = vi.fn(), outOfSight = vi.fn();
    const frameRect = (top: number) => (function (this: Element) { return (this.classList.contains('pdf-cited-block') ? { top, bottom: top + 40 } : { top: 0, bottom: 500 }) as DOMRect; });
    Element.prototype.scrollIntoView = inSight;
    const original = Element.prototype.getBoundingClientRect;
    Element.prototype.getBoundingClientRect = frameRect(200);
    r.container.getBoundingClientRect = () => ({ left: 0, top: 0, right: 600, bottom: 500, width: 600, height: 500 }) as DOMRect;
    r.linkReveal.showSpot(spot(1));
    expect(inSight).not.toHaveBeenCalled();
    Element.prototype.scrollIntoView = outOfSight;
    Element.prototype.getBoundingClientRect = frameRect(900);
    r.container.getBoundingClientRect = () => ({ left: 0, top: 0, right: 600, bottom: 500, width: 600, height: 500 }) as DOMRect;
    r.linkReveal.showSpot(spot(2));
    expect(outOfSight).toHaveBeenCalledOnce();
    Element.prototype.getBoundingClientRect = original;
  });

  it('gives way to the next one, and goes at a press in the view', () => {
    const r = reveal();
    r.linkReveal.showSpot(spot(1));
    r.linkReveal.showSpot(spot(2));
    expect(r.pages[0].querySelector('.pdf-cited-block')).toBeNull();
    expect(r.pages[1].querySelector('.pdf-cited-block')).not.toBeNull();
    r.container.dispatchEvent(new Event('pointerdown'));
    expect(r.pages[1].querySelector('.pdf-cited-block')).toBeNull();
  });
});
