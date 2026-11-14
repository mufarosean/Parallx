// scanPageLinks.test.ts — what a page made from a document and the document's
// view say to each other: this block, this spot.
import { describe, expect, it, vi } from 'vitest';
import { ScanPageLinks, blockAt, blockNear, type IScanPageSource } from '../../src/services/scanPageLinks';

const SOURCE: IScanPageSource = {
  pageId: 'page-1',
  fsPath: 'D:/Work/Scans/exam.pdf',
  anchors: {
    heading: [1, 60, 60, 400, 90],
    para: [1, 60, 110, 540, 150],
    table: [1, 60, 190, 540, 260],
    cell: [1, 220, 238, 380, 260],
    later: [2, 60, 60, 300, 80],
    last: [2, 60, 400, 540, 440],
  },
  pageSizes: { 1: [595, 842], 2: [595, 842] },
};

describe('which block a spot of the document became', () => {
  it('is the one whose box holds the spot; inside a table, the cell before the table', () => {
    expect(blockAt(SOURCE, 1, 100, 75)).toBe('heading');
    expect(blockAt(SOURCE, 1, 300, 250)).toBe('cell');
    expect(blockAt(SOURCE, 1, 100, 200)).toBe('table');
  });

  it('is none where nothing was read, or on another page', () => {
    expect(blockAt(SOURCE, 1, 100, 170)).toBeUndefined(); // between the paragraph and the table
    expect(blockAt(SOURCE, 2, 100, 75)).toBe('later');
    expect(blockAt(SOURCE, 3, 100, 75)).toBeUndefined();
  });
});

describe('which block to keep in step with a scrolled document', () => {
  it('is the one at that height; in a gap, the next one down; past the last, the last', () => {
    expect(blockNear(SOURCE, 1, 120)).toBe('para');
    expect(blockNear(SOURCE, 1, 170)).toBe('table');
    expect(blockNear(SOURCE, 1, 250)).toBe('cell'); // the innermost at that height
    expect(blockNear(SOURCE, 2, 200)).toBe('last');
    expect(blockNear(SOURCE, 2, 800)).toBe('last');
    expect(blockNear(SOURCE, 5, 100)).toBeUndefined();
  });
});

describe('the two sides', () => {
  it('know a page is linked only while it is open', () => {
    const links = new ScanPageLinks();
    const changed = vi.fn();
    links.onDidChange(changed);
    expect(links.forFile('D:/Work/Scans/exam.pdf')).toBeUndefined();
    const open = links.open(SOURCE);
    expect(links.forFile('d:\\work\\scans\\EXAM.pdf')).toBe(SOURCE); // whatever the path's form
    expect(links.forPage('page-1')).toBe(SOURCE);
    open.dispose();
    open.dispose();
    expect(links.forFile('D:/Work/Scans/exam.pdf')).toBeUndefined();
    expect(changed).toHaveBeenCalledTimes(2);
  });

  it('take the page opened last when a document was made into two', () => {
    const links = new ScanPageLinks();
    links.open(SOURCE);
    const second = { ...SOURCE, pageId: 'page-2' };
    links.open(second);
    expect(links.forFile(SOURCE.fsPath)).toBe(second);
  });

  it('the page points at where a block came from', () => {
    const links = new ScanPageLinks();
    links.open(SOURCE);
    const spots = vi.fn();
    links.onDidPointAtScan(spots);
    expect(links.pointFromPage('page-1', 'cell', 'show')).toBe(true);
    expect(spots).toHaveBeenCalledWith({ fsPath: SOURCE.fsPath, page: 1, box: [220, 238, 380, 260], pageWidth: 595, pageHeight: 842, how: 'show' });
    expect(links.pointFromPage('page-1', 'a block typed in later', 'show')).toBe(false);
    expect(links.pointFromPage('another page', 'cell', 'show')).toBe(false);
    expect(spots).toHaveBeenCalledOnce();
  });

  it('the document points at the block made from a spot, and gets back the place to light up', () => {
    const links = new ScanPageLinks();
    links.open(SOURCE);
    const blocks = vi.fn();
    links.onDidPointAtPage(blocks);
    expect(links.pointFromScan('D:/Work/Scans/exam.pdf', 1, 300, 250, 'show')).toMatchObject({ page: 1, box: [220, 238, 380, 260] });
    expect(blocks).toHaveBeenLastCalledWith({ pageId: 'page-1', blockId: 'cell', how: 'show' });
    // A scroll keeps in step with the block at that height, not only one under a point.
    expect(links.pointFromScan('D:/Work/Scans/exam.pdf', 1, 0, 170, 'scroll')).toMatchObject({ box: [60, 190, 540, 260] });
    expect(blocks).toHaveBeenLastCalledWith({ pageId: 'page-1', blockId: 'table', how: 'scroll' });
    // A press where nothing was read, or on a document no open page was made from, says nothing.
    expect(links.pointFromScan('D:/Work/Scans/exam.pdf', 1, 100, 170, 'show')).toBeUndefined();
    expect(links.pointFromScan('D:/Work/Scans/other.pdf', 1, 300, 250, 'show')).toBeUndefined();
    expect(blocks).toHaveBeenCalledTimes(2);
  });

  it('say when a page is being made from a document', () => {
    const links = new ScanPageLinks();
    const changed = vi.fn();
    links.onDidChange(changed);
    links.setMaking('D:\\Work\\Scans\\exam.pdf', true);
    links.setMaking('D:/Work/Scans/exam.pdf', true); // said once
    expect(links.isMaking('d:/work/scans/exam.pdf')).toBe(true);
    links.setMaking('D:/Work/Scans/exam.pdf', false);
    expect(links.isMaking('D:/Work/Scans/exam.pdf')).toBe(false);
    expect(links.isMaking(undefined)).toBe(false);
    expect(changed).toHaveBeenCalledTimes(2);
  });
});
