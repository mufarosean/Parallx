// @vitest-environment jsdom
// pdfReadingPanel.test.ts — the Reading side of the PDF view's panel: how the
// document reader read the open document, what it found, and Read Again.
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { PdfReadingPanel, findingHref, readingFacts, READ_AGAIN_COMMAND } from '../../src/editor/panes/pdf/pdfReadingPanel';
import { documentReaderEngine } from '../../src/services/documentReaderEngine';
import { installKitCommands } from '../../src/ui/kitCommands';
import type { IDocumentReading } from '../../src/services/documentReading';

const NOW = Date.UTC(2026, 10, 13, 18, 0, 0);
const READING: IDocumentReading = {
  version: 1, ocr: true, readAt: NOW - 3 * 60 * 60_000,
  pages: [{ page: 1, width: 600, height: 800, lines: [{ text: 'Appendix C', box: [60, 40, 300, 60] }] }, { page: 2, width: 600, height: 800, lines: [] }],
  blocks: [
    { label: 'caption', page: 1, box: [60, 180, 400, 196], text: 'Table 3: Selected development factors' },
    { label: 'formula', page: 2, box: [60, 100, 300, 130] },
  ],
  tables: [{ page: 1, box: [60, 200, 540, 320], rows: 2, cols: 2, cells: [{ r: 0, c: 0, rs: 1, cs: 1, text: 'Age' }, { r: 0, c: 1, rs: 1, cs: 1, text: 'Paid' }, { r: 1, c: 0, rs: 1, cs: 1, text: '120' }, { r: 1, c: 1, rs: 1, cs: 1, text: '1.05' }] }],
};

/** The reader as the preload shows it: its state, and the reading it keeps once it has read the file. */
function fakeReader(o: { status?: string; installed?: boolean; kept?: unknown; convert?: () => Promise<{ ok: boolean; error?: string }> } = {}) {
  const world = { kept: o.kept as unknown, status: o.status ?? 'available' };
  const docling = {
    status: vi.fn(async () => ({ status: world.status, doclingInstalled: o.installed ?? world.status === 'available', engine: 'managed' })),
    engineStatus: vi.fn(async () => ({ state: (o.installed ?? world.status === 'available') ? 'ready' : 'absent', installing: false, machine: { ok: true } })),
    start: vi.fn(async () => { world.status = 'available'; return { ok: true }; }),
    convert: vi.fn(async (_p: string, _o?: { ocr?: boolean }) => { const r = await (o.convert?.() ?? Promise.resolve({ ok: true })); if (r.ok) world.kept = READING; return r; }),
    reading: vi.fn(async () => world.kept ?? null),
  };
  (globalThis as { parallxElectron?: unknown }).parallxElectron = { docling };
  return { docling, world };
}

function setup(o: { fsPath?: string; scan?: boolean } = {}) {
  const container = document.createElement('div');
  document.body.appendChild(container);
  const state = { fsPath: 'fsPath' in o ? o.fsPath : 'D:/Work/Scans/exam.pdf' };
  const host = { fsPath: () => state.fsPath, isScan: vi.fn(async () => o.scan ?? false), readingArrived: vi.fn() };
  const panel = new PdfReadingPanel(container, host);
  const text = () => (container.textContent ?? '').replace(/\s+/g, ' ');
  return { container, panel, host, state, text, button: () => container.querySelector('button'), facts: () => Array.from(container.querySelectorAll('th')).map((th) => [th.textContent, th.nextElementSibling?.textContent]) };
}

const settle = async () => { for (let i = 0; i < 30; i++) await Promise.resolve(); await new Promise((r) => setTimeout(r, 0)); };

beforeEach(() => { documentReaderEngine.reset(); });
afterEach(() => { documentReaderEngine.reset(); delete (globalThis as { parallxElectron?: unknown }).parallxElectron; document.body.innerHTML = ''; });

describe('what it says of a reading', () => {
  it('gives when, how, and what was found; figures and formulas only when there are any', () => {
    expect(readingFacts(READING, [{ kind: 'table', page: 1, label: 'Table 3', quote: 'Table 3' }], NOW)).toEqual([
      ['Read', '3 hours ago'], ['How', 'From its pixels'], ['Pages', '2'], ['Tables', '1'], ['Formulas', '1'],
    ]);
    const plain: IDocumentReading = { version: 1, ocr: false, pages: [{ page: 1, width: 600, height: 800, lines: [] }], blocks: [], tables: [] };
    expect(readingFacts(plain, [{ kind: 'figure', page: 1, label: 'Figure 1', quote: 'Figure 1' }], NOW)).toEqual([
      ['How', 'From its own text'], ['Pages', '1'], ['Tables', '0'], ['Figures', '1'],
    ]);
  });

  it('links a found table to its page and the words that find it there', () => {
    const href = findingHref('D:\\Work\\Scans\\exam.pdf', { kind: 'table', page: 3, label: 'Table 3', quote: 'Table 3: Selected development factors' });
    expect(href.startsWith('parallx://explorer/file?')).toBe(true);
    const params = new URLSearchParams(href.slice(href.indexOf('?') + 1));
    expect([params.get('path'), params.get('page'), params.get('quote')]).toEqual(['D:/Work/Scans/exam.pdf', '3', 'Table 3: Selected development factors']);
    expect(new URLSearchParams(findingHref('D:/a.pdf', { kind: 'table', page: 1, label: 'Table', quote: '' }).split('?')[1]).has('quote')).toBe(false);
  });
});

describe('the Reading side', () => {
  it('asks nothing until it is shown', async () => {
    const reader = fakeReader({ kept: READING });
    const s = setup();
    await settle();
    expect(reader.docling.reading).not.toHaveBeenCalled();
    expect(reader.docling.status).not.toHaveBeenCalled();
    expect(s.container.textContent).toBe('');
  });

  it('shows how the document was read, Read Again, and what was found as links to their places', async () => {
    fakeReader({ kept: READING });
    const s = setup();
    s.panel.setShowing(true);
    await settle();
    expect(s.facts().map((f) => f[0])).toEqual(['Read', 'How', 'Pages', 'Tables', 'Formulas']);
    expect(s.facts()[1][1]).toBe('From its pixels');
    expect(s.button()!.textContent).toBe('Read Again');
    const link = s.container.querySelector('.pdf-reading__finding a') as HTMLAnchorElement;
    expect(link.textContent).toBe('Table 3: Selected development factors');
    expect(link.getAttribute('href')).toContain('page=1');
    expect(link.target).toBe(''); // a place in the app, not a page in the browser
    expect(s.container.querySelector('.pdf-reading__page')!.textContent).toBe('Page 1');
  });

  it('offers Read Now for a document the reader has not read', async () => {
    fakeReader();
    const s = setup();
    s.panel.setShowing(true);
    await settle();
    expect(s.text()).toContain('has not read this document yet');
    expect(s.button()!.textContent).toBe('Read Now');
    expect(s.container.querySelector('table')).toBeNull();
  });

  it('with no reader set up, says what that means and offers the way to set it up', async () => {
    fakeReader({ status: 'unavailable', installed: false });
    const s = setup();
    s.panel.setShowing(true);
    await settle();
    expect(s.text()).toContain('The document reader is not set up.');
    expect(s.button()!.textContent).toBe('Set Up Document Reader…');
  });

  it('keeps what a removed reader had read on show, with the way to set it up again', async () => {
    fakeReader({ status: 'unavailable', installed: false, kept: READING });
    const s = setup();
    s.panel.setShowing(true);
    await settle();
    expect(s.facts().length).toBeGreaterThan(0);
    expect(s.button()!.textContent).toBe('Set Up Document Reader…');
  });

  it('says nothing with no document on screen', async () => {
    const reader = fakeReader({ kept: READING });
    const s = setup({ fsPath: undefined });
    s.panel.setShowing(true);
    await settle();
    expect(s.container.textContent).toBe('');
    expect(reader.docling.reading).not.toHaveBeenCalled();
  });
});

describe('Read Again', () => {
  it('its button runs the command the pane answers', async () => {
    const run = vi.fn(async () => undefined);
    installKitCommands({ executeCommand: run });
    fakeReader({ kept: READING });
    const s = setup();
    s.panel.setShowing(true);
    await settle();
    s.button()!.click();
    expect(run).toHaveBeenCalledWith(READ_AGAIN_COMMAND);
  });

  it('reads the document the way it was read before, says so meanwhile, then gives the view the new reading', async () => {
    let finish: (r: { ok: boolean }) => void = () => {};
    const reader = fakeReader({ kept: READING, convert: () => new Promise((resolve) => { finish = resolve; }) });
    const s = setup({ scan: false });
    s.panel.setShowing(true);
    await settle();
    const done = s.panel.readAgain();
    await settle();
    expect(reader.docling.convert).toHaveBeenCalledWith('D:/Work/Scans/exam.pdf', { ocr: true }); // it was read from its pixels
    expect(s.host.isScan).not.toHaveBeenCalled(); // its pages have the reader's text now: they cannot be asked
    const busy = s.container.querySelector('[role="status"]')!;
    expect(busy.textContent).toBe('Reading this document…');
    expect(s.button()).toBeNull();
    finish({ ok: true });
    await done;
    await settle();
    expect(s.host.readingArrived).toHaveBeenCalledWith(expect.objectContaining({ ocr: true }));
    expect(s.button()!.textContent).toBe('Read Again');
  });

  it('reads a document never read from its pixels when it is a scan, from its own text when it is not', async () => {
    const scan = fakeReader();
    const a = setup({ scan: true });
    await a.panel.readAgain();
    expect(scan.docling.convert).toHaveBeenCalledWith('D:/Work/Scans/exam.pdf', { ocr: true });
    const digital = fakeReader();
    const b = setup({ scan: false, fsPath: 'D:/Work/Papers/clark.pdf' });
    await b.panel.readAgain();
    expect(digital.docling.convert).toHaveBeenCalledWith('D:/Work/Papers/clark.pdf', { ocr: false });
  });

  it('says what went wrong, and keeps Read Again', async () => {
    fakeReader({ kept: READING, convert: async () => ({ ok: false, error: 'The file is damaged.' }) });
    const s = setup();
    s.panel.setShowing(true);
    await settle();
    await s.panel.readAgain();
    await settle();
    expect(s.container.querySelector('[role="alert"]')!.textContent).toBe('The file is damaged.');
    expect(s.button()!.textContent).toBe('Read Again');
    expect(s.host.readingArrived).not.toHaveBeenCalled();
  });

  it('shows a reading someone else asked for (a scan read as it opened), and the result when it lands', async () => {
    let finish: (r: { ok: boolean }) => void = () => {};
    fakeReader({ convert: () => new Promise((resolve) => { finish = resolve; }) });
    const s = setup();
    s.panel.setShowing(true);
    await settle();
    expect(s.button()!.textContent).toBe('Read Now');
    void documentReaderEngine.read('D:/Work/Scans/exam.pdf', true, false);
    await settle();
    expect(s.container.querySelector('[role="status"]')!.textContent).toBe('Reading this document…');
    expect(s.button()).toBeNull();
    finish({ ok: true });
    await settle();
    expect(s.facts().length).toBeGreaterThan(0);
    expect(s.button()!.textContent).toBe('Read Again');
  });

  it('a reading that lands after the view moved on is not given to the new document', async () => {
    let finish: (r: { ok: boolean }) => void = () => {};
    fakeReader({ kept: READING, convert: () => new Promise((resolve) => { finish = resolve; }) });
    const s = setup();
    const done = s.panel.readAgain();
    await settle();
    s.state.fsPath = 'D:/Work/Papers/other.pdf';
    s.panel.documentChanged();
    finish({ ok: true });
    await done;
    expect(s.host.readingArrived).not.toHaveBeenCalled();
  });
});
