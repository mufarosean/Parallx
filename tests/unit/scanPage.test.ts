// @vitest-environment jsdom
// scanPage.test.ts — Open As Page: a document the reader read is made into a
// page, the record of where its blocks came from is kept, and the page speaks
// to the document's view while it is open.
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const pictureOfRegion = vi.fn();
vi.mock('../../src/services/pagePicture', () => ({ pictureOfRegion: (...args: unknown[]) => pictureOfRegion(...args) }));

import { ScanPages, parseStoredSource, resolveStoredFile, storedFileFor, PAGE_SOURCES_DIR, type IScanPageHost } from '../../src/built-in/canvas/scanPage';
import { scanPageLinks, type IScanSpot } from '../../src/services/scanPageLinks';
import type { TipTapNode } from '../../src/built-in/canvas/markdownImport';
import type { IDocumentReading } from '../../src/services/documentReading';

const READING: IDocumentReading = {
  version: 1, ocr: true,
  pages: [{ page: 1, width: 595, height: 842, lines: [] }],
  blocks: [
    { label: 'title', page: 1, box: [60, 60, 400, 90], text: 'Appendix C' },
    { label: 'table', page: 1, box: [60, 190, 540, 260] },
    { label: 'picture', page: 1, box: [60, 300, 540, 500] },
  ],
  tables: [{ page: 1, box: [60, 190, 540, 260], rows: 2, cols: 2, cells: [
    { r: 0, c: 0, rs: 1, cs: 1, text: 'Age', header: true, box: [60, 190, 300, 224] }, { r: 0, c: 1, rs: 1, cs: 1, text: 'Paid', header: true, box: [300, 190, 540, 224] },
    { r: 1, c: 0, rs: 1, cs: 1, text: '120', box: [60, 226, 300, 260] }, { r: 1, c: 1, rs: 1, cs: 1, text: '1.05', box: [300, 226, 540, 260] },
  ] }],
};

/** The main process as the preload shows it: the reader's kept reading, and the workspace's files. */
function fakeElectron(reading: IDocumentReading | null = READING) {
  const disk = new Map<string, string>();
  (globalThis as { parallxElectron?: unknown }).parallxElectron = {
    docling: { reading: vi.fn(async () => reading) },
    fs: {
      writeFile: vi.fn(async (path: string, content: string) => { disk.set(path, content); return { error: null }; }),
      readFile: vi.fn(async (path: string) => (disk.has(path) ? { content: disk.get(path) } : { error: { code: 'ENOENT' } })),
    },
  };
  return disk;
}

function fakeHost(over: Partial<IScanPageHost> = {}) {
  const pages = new Map<string, TipTapNode | null>();
  const open = new Set<string>();
  let made: Record<string, string> = {};
  let next = 0;
  const host: IScanPageHost = {
    workspaceRoot: () => 'D:/Work',
    activeFile: () => undefined,
    createPage: vi.fn(async (_title: string) => { const id = `page-${++next}`; pages.set(id, null); return id; }),
    writePage: vi.fn(async (pageId: string, doc: TipTapNode) => { pages.set(pageId, doc); }),
    pageExists: vi.fn(async (pageId: string) => pages.has(pageId)),
    openPage: vi.fn(async (pageId: string) => { open.add(pageId); }),
    isPageOpen: (pageId) => open.has(pageId),
    made: { get: () => made, set: (value) => { made = value; } },
    notify: vi.fn(),
    ...over,
  };
  return { host, pages, open, made: () => made };
}

const FILE = 'D:/Work/Scans/exam.pdf';
const settle = async () => { for (let i = 0; i < 30; i++) await Promise.resolve(); await new Promise((r) => setTimeout(r, 0)); };
const types = (doc: TipTapNode | null | undefined) => (doc?.content ?? []).map((n) => n.type);

let live: ScanPages[] = [];
let cleanups: Array<() => void> = [];
const make = (host: IScanPageHost) => { const pages = new ScanPages(host); live.push(pages); return pages; };

beforeEach(() => { pictureOfRegion.mockReset(); pictureOfRegion.mockResolvedValue('data:image/jpeg;base64,AAAA'); (globalThis as { CSS?: unknown }).CSS ??= { escape: (s: string) => s }; });
afterEach(() => { for (const p of live) p.dispose(); live = []; for (const c of cleanups) c(); cleanups = []; vi.useRealTimers(); delete (globalThis as { parallxElectron?: unknown }).parallxElectron; document.body.innerHTML = ''; });

describe('the record of where a page came from', () => {
  it('names a document inside the workspace by its path there, and one outside by its full path', () => {
    expect(storedFileFor('D:\\Work\\Scans\\exam.pdf', 'D:/Work')).toBe('Scans/exam.pdf');
    expect(storedFileFor('d:/work/Scans/exam.pdf', 'D:/Work/')).toBe('Scans/exam.pdf');
    expect(storedFileFor('E:/Papers/clark.pdf', 'D:/Work')).toBe('E:/Papers/clark.pdf');
    expect(storedFileFor('D:/Workshop/a.pdf', 'D:/Work')).toBe('D:/Workshop/a.pdf'); // a folder that only starts the same
    expect(resolveStoredFile('Scans/exam.pdf', 'D:\\Moved\\Work')).toBe('D:/Moved/Work/Scans/exam.pdf'); // a moved workspace keeps its links
    expect(resolveStoredFile('E:/Papers/clark.pdf', 'D:/Work')).toBe('E:/Papers/clark.pdf');
  });

  it('reads a record back checked: what is not a place or a size is dropped', () => {
    const source = parseStoredSource('page-1', { version: 1, file: 'Scans/exam.pdf', anchors: { a: [1, 60, 60, 400, 90], bad: [1, 2, 3], worse: 'x' }, pageSizes: { 1: [595, 842], 2: [0, 5], 3: 'x' } }, 'D:/Work');
    expect(source).toEqual({ pageId: 'page-1', fsPath: 'D:/Work/Scans/exam.pdf', anchors: { a: [1, 60, 60, 400, 90] }, pageSizes: { 1: [595, 842] } });
    expect(parseStoredSource('page-1', null, 'D:/Work')).toBeNull();
    expect(parseStoredSource('page-1', { anchors: {} }, 'D:/Work')).toBeNull();
    expect(parseStoredSource('page-1', { file: 'a.pdf' }, 'D:/Work')).toBeNull();
  });
});

describe('Open As Page', () => {
  it('makes a page from what the reader read, keeps where its blocks came from, and opens it beside the document', async () => {
    const disk = fakeElectron();
    const h = fakeHost();
    const making: boolean[] = [];
    const watching = scanPageLinks.onDidChange(() => making.push(scanPageLinks.isMaking(FILE)));
    const pageId = await make(h.host).openAsPage(FILE);
    watching.dispose();
    expect(pageId).toBe('page-1');
    expect(h.host.createPage).toHaveBeenCalledWith('exam'); // titled after the file
    const doc = h.pages.get('page-1')!;
    expect(types(doc)).toEqual(['paragraph', 'heading', 'table', 'image']);
    expect(doc.content![0].content![1]).toMatchObject({ text: 'exam.pdf', marks: [{ type: 'link', attrs: { href: 'parallx://explorer/file?path=Scans%2Fexam.pdf' } }] });
    expect(doc.content![3].attrs).toMatchObject({ src: 'data:image/jpeg;base64,AAAA' }); // the figure, cut from the document
    expect(pictureOfRegion).toHaveBeenCalledWith(FILE, 1, [60, 300, 540, 500], [595, 842]);
    const record = JSON.parse(disk.get(`D:/Work/${PAGE_SOURCES_DIR}/page-1.json`)!);
    expect(record.file).toBe('Scans/exam.pdf');
    expect(record.anchors[doc.content![1].attrs!.id as string]).toEqual([1, 60, 60, 400, 90]);
    expect(Object.keys(record.anchors)).toHaveLength(7); // heading, table, four cells, figure
    expect(h.made()).toEqual({ 'scans/exam.pdf': 'page-1' });
    expect(h.host.openPage).toHaveBeenCalledWith('page-1');
    expect(making[0]).toBe(true); // it said it was being made
    expect(scanPageLinks.isMaking(FILE)).toBe(false);
    await settle();
    expect(scanPageLinks.forFile(FILE)?.pageId).toBe('page-1'); // and the two are linked
  });

  it('a document is made into a page once: asking again opens the page it became', async () => {
    fakeElectron();
    const h = fakeHost();
    const pages = make(h.host);
    await pages.openAsPage(FILE);
    expect(await pages.openAsPage('d:\\work\\scans\\EXAM.pdf')).toBe('page-1');
    expect(h.host.createPage).toHaveBeenCalledOnce();
    expect(h.host.openPage).toHaveBeenCalledTimes(2);
    // The page was deleted since: a new one is made.
    h.pages.delete('page-1');
    expect(await pages.openAsPage(FILE)).toBe('page-2');
    expect(h.made()).toEqual({ 'scans/exam.pdf': 'page-2' });
  });

  it('uses the document that is showing when none is named, and says so when there is none', async () => {
    fakeElectron();
    const none = fakeHost();
    expect(await make(none.host).openAsPage()).toBeNull();
    expect(none.host.notify).toHaveBeenCalledWith(expect.stringMatching(/Open a PDF first/));
    const showing = fakeHost({ activeFile: () => FILE });
    expect(await make(showing.host).openAsPage()).toBe('page-1');
  });

  it('says what to do when the reader has not read the document, and makes nothing', async () => {
    fakeElectron(null);
    const h = fakeHost();
    expect(await make(h.host).openAsPage(FILE)).toBeNull();
    expect(h.host.notify).toHaveBeenCalledWith(expect.stringMatching(/has not read this document yet/));
    expect(h.host.createPage).not.toHaveBeenCalled();
  });

  it('leaves out a figure that could not be cut, and still makes the page', async () => {
    fakeElectron();
    pictureOfRegion.mockResolvedValue(null);
    const h = fakeHost();
    await make(h.host).openAsPage(FILE);
    expect(types(h.pages.get('page-1'))).toEqual(['paragraph', 'heading', 'table']);
  });

  it('says so when the page could not be made, and is ready to try again', async () => {
    fakeElectron();
    const h = fakeHost({ createPage: vi.fn(async () => { throw new Error('The workspace is read-only.'); }) });
    expect(await make(h.host).openAsPage(FILE)).toBeNull();
    expect(h.host.notify).toHaveBeenCalledWith('The page could not be made. The workspace is read-only.');
    expect(scanPageLinks.isMaking(FILE)).toBe(false);
  });
});

/** A page as the window shows it: its surface, the element that scrolls, and blocks carrying their ids. */
function pageInWindow(pageId: string, html: string) {
  const surface = document.createElement('div');
  surface.setAttribute('data-px-surface', 'canvas');
  surface.setAttribute('data-px-instance', `parallx.canvas:canvas:${pageId}`);
  surface.getClientRects = () => [{}] as unknown as DOMRectList;
  const scroller = document.createElement('div');
  scroller.className = 'canvas-editor-wrapper';
  scroller.style.overflowY = 'auto';
  Object.defineProperty(scroller, 'scrollHeight', { value: 4000 });
  Object.defineProperty(scroller, 'clientHeight', { value: 800 });
  scroller.getBoundingClientRect = () => ({ left: 100, top: 50, right: 700, bottom: 850, width: 600, height: 800 }) as DOMRect;
  const editor = document.createElement('div');
  editor.className = 'ProseMirror';
  editor.tabIndex = 0;
  editor.innerHTML = html;
  scroller.appendChild(editor);
  surface.appendChild(scroller);
  document.body.appendChild(surface);
  return { surface, scroller, editor, block: (id: string) => editor.querySelector(`[data-id="${id}"]`) as HTMLElement };
}

/** A page made from the file and open: its record in memory, its surface in the window. */
async function linkedPage() {
  fakeElectron();
  const h = fakeHost();
  const pages = make(h.host);
  await pages.openAsPage(FILE);
  const doc = h.pages.get('page-1')!;
  const [, heading, table] = doc.content!;
  const cell = table.content![1].content![1];
  const ids = { heading: heading.attrs!.id as string, table: table.attrs!.id as string, cell: cell.attrs!.id as string, inCell: cell.content![0].attrs!.id as string };
  const dom = pageInWindow('page-1', `<h1 data-id="${ids.heading}">Appendix C</h1><table data-id="${ids.table}"><tr><td data-id="${ids.cell}"><p data-id="${ids.inCell}">1.05</p></td></tr></table><p data-id="typed-later">A line typed in afterwards.</p>`);
  await pages.sync();
  const spots: IScanSpot[] = [];
  const hearing = scanPageLinks.onDidPointAtScan((s) => spots.push(s));
  cleanups.push(() => hearing.dispose());
  return { h, pages, ids, dom, spots };
}

describe('the page, while it is open', () => {
  it('a press in a block says where it came from: a cell before its table', async () => {
    const s = await linkedPage();
    s.dom.block(s.ids.heading).dispatchEvent(new MouseEvent('click', { bubbles: true }));
    expect(s.spots.at(-1)).toMatchObject({ fsPath: FILE, page: 1, box: [60, 60, 400, 90], how: 'show' });
    s.dom.block(s.ids.inCell).dispatchEvent(new MouseEvent('click', { bubbles: true }));
    expect(s.spots.at(-1)).toMatchObject({ box: [300, 226, 540, 260], how: 'show' }); // the cell's own place
    // A block typed in afterwards came from nowhere: it says nothing.
    const before = s.spots.length;
    s.dom.block('typed-later').dispatchEvent(new MouseEvent('click', { bubbles: true }));
    expect(s.spots).toHaveLength(before);
  });

  it('the caret moved by the keyboard says it too, once for a block, and only while the page has the focus', async () => {
    const s = await linkedPage();
    const caretIn = (el: HTMLElement) => { const range = document.createRange(); range.selectNodeContents(el); range.collapse(true); const sel = document.getSelection()!; sel.removeAllRanges(); sel.addRange(range); document.dispatchEvent(new Event('selectionchange')); };
    s.dom.editor.focus();
    caretIn(s.dom.block(s.ids.heading));
    caretIn(s.dom.block(s.ids.heading));
    expect(s.spots).toHaveLength(1);
    caretIn(s.dom.block(s.ids.inCell));
    expect(s.spots).toHaveLength(2);
    // The focus is elsewhere (the document's view was pressed): a selection left behind says nothing.
    const elsewhere = document.createElement('button');
    document.body.appendChild(elsewhere);
    elsewhere.focus();
    caretIn(s.dom.block(s.ids.heading));
    expect(s.spots).toHaveLength(2);
  });

  it('a scroll says which block is at the line both sides keep in step', async () => {
    const s = await linkedPage();
    document.elementFromPoint = vi.fn(() => s.dom.block(s.ids.inCell));
    s.dom.scroller.dispatchEvent(new Event('scroll'));
    await new Promise((r) => setTimeout(r, 60));
    expect(s.spots.at(-1)).toMatchObject({ box: [300, 226, 540, 260], how: 'scroll' });
    expect((document.elementFromPoint as ReturnType<typeof vi.fn>).mock.calls[0]).toEqual([400, 250]); // the middle of the view, a quarter of the way down
  });

  it('marks the block the document\'s view points at, over the block and not on it, for a moment', async () => {
    const s = await linkedPage();
    vi.useFakeTimers();
    const heading = s.dom.block(s.ids.heading);
    heading.getBoundingClientRect = () => ({ left: 160, top: 300, right: 660, bottom: 340, width: 500, height: 40 }) as DOMRect;
    scanPageLinks.pointFromScan(FILE, 1, 100, 75, 'show');
    const mark = s.dom.scroller.querySelector('.canvas-scan-mark') as HTMLElement;
    expect(mark.parentElement).toBe(s.dom.scroller); // in the element that scrolls, outside the editor's own content
    expect([mark.style.left, mark.style.top, mark.style.width, mark.style.height]).toEqual(['60px', '250px', '500px', '40px']);
    expect(mark.getAttribute('aria-hidden')).toBe('true');
    expect(heading.className).toBe('');
    vi.advanceTimersByTime(1700);
    expect(s.dom.scroller.querySelector('.canvas-scan-mark')).toBeNull();
  });

  it('follows the document\'s scroll: the block made from that height comes to the line, and the move is not sent back', async () => {
    const s = await linkedPage();
    const heading = s.dom.block(s.ids.heading);
    heading.getBoundingClientRect = () => ({ left: 160, top: 650, right: 660, bottom: 690, width: 500, height: 40 }) as DOMRect;
    document.elementFromPoint = vi.fn(() => heading);
    scanPageLinks.pointFromScan(FILE, 1, 0, 70, 'scroll');
    expect(s.dom.scroller.scrollTop).toBe(400); // 650, less the line at 50 + 800 / 4
    expect(s.dom.scroller.querySelector('.canvas-scan-mark')).toBeNull(); // followed quietly
    s.dom.scroller.dispatchEvent(new Event('scroll'));
    await new Promise((r) => setTimeout(r, 60));
    expect(s.spots.filter((x) => x.how === 'scroll')).toHaveLength(0);
  });

  it('listens on the window only while a page made from a document is open', async () => {
    fakeElectron();
    const added = vi.spyOn(document, 'addEventListener');
    const removed = vi.spyOn(document, 'removeEventListener');
    const h = fakeHost();
    const pages = make(h.host);
    await pages.sync();
    expect(added).not.toHaveBeenCalled();
    await pages.openAsPage(FILE);
    await pages.sync();
    expect(added.mock.calls.map((c) => c[0]).sort()).toEqual(['click', 'scroll', 'selectionchange']);
    h.open.delete('page-1');
    await pages.sync();
    expect(removed.mock.calls.map((c) => c[0]).sort()).toEqual(['click', 'scroll', 'selectionchange']);
    expect(scanPageLinks.forPage('page-1')).toBeUndefined();
    added.mockRestore(); removed.mockRestore();
  });

  it('links a page left open from before by the record kept for it, and leaves ordinary pages alone', async () => {
    const disk = fakeElectron();
    disk.set(`D:/Work/${PAGE_SOURCES_DIR}/kept-page.json`, JSON.stringify({ version: 1, file: 'Scans/exam.pdf', anchors: { a: [1, 60, 60, 400, 90] }, pageSizes: { 1: [595, 842] } }));
    const h = fakeHost();
    h.open.add('kept-page');
    h.open.add('plain-page');
    pageInWindow('kept-page', '<p data-id="a">A block</p>');
    pageInWindow('plain-page', '<p data-id="b">Another</p>');
    const pages = make(h.host);
    await pages.sync();
    expect(scanPageLinks.forPage('kept-page')).toMatchObject({ fsPath: 'D:/Work/Scans/exam.pdf' });
    expect(scanPageLinks.forPage('plain-page')).toBeUndefined();
    // An ordinary page is asked about once.
    const reads = (globalThis as unknown as { parallxElectron: { fs: { readFile: ReturnType<typeof vi.fn> } } }).parallxElectron.fs.readFile;
    const asked = reads.mock.calls.length;
    await pages.sync();
    expect(reads.mock.calls.length).toBe(asked);
  });
});


describe('turned off', () => {
  it('links nothing afterwards, even for a look that was already waiting', async () => {
    fakeElectron();
    const added = vi.spyOn(document, 'addEventListener');
    const h = fakeHost();
    const pages = make(h.host);
    await pages.openAsPage(FILE);
    await pages.sync();
    expect(scanPageLinks.forPage('page-1')).toBeDefined();
    pages.editorsChanged(); // looks now, and twice more shortly
    pages.dispose();
    expect(scanPageLinks.forPage('page-1')).toBeUndefined();
    added.mockClear();
    await new Promise((r) => setTimeout(r, 450));
    expect(scanPageLinks.forPage('page-1')).toBeUndefined();
    expect(added).not.toHaveBeenCalled();
    added.mockRestore();
  });
});
