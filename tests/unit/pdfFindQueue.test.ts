// pdfFindQueue.test.ts — pdf.js gets one find at a time; a find sent while
// another is in flight waits, and only the newest waiting one is sent.

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { PdfFindQueue } from '../../src/editor/panes/pdf/pdfFindQueue';

beforeEach(() => { vi.useFakeTimers(); });
afterEach(() => { vi.useRealTimers(); });

describe('PdfFindQueue', () => {
  it('sends the first find at once', () => {
    const sent: string[] = [];
    new PdfFindQueue<string>((f) => sent.push(f)).request('loss');
    expect(sent).toEqual(['loss']);
  });

  it('holds a find sent while one is in flight, and sends it when that one settles', () => {
    const sent: string[] = [];
    const q = new PdfFindQueue<string>((f) => sent.push(f));
    q.request('find: expected loss');
    q.request('again');
    expect(sent).toEqual(['find: expected loss']);
    q.settled();
    expect(sent).toEqual(['find: expected loss', 'again']);
    q.settled();
    expect(sent).toHaveLength(2);
  });

  it('sends only the newest of the finds that waited', () => {
    const sent: string[] = [];
    const q = new PdfFindQueue<string>((f) => sent.push(f));
    q.request('e');
    q.request('ex');
    q.request('exp');
    q.settled();
    expect(sent).toEqual(['e', 'exp']);
  });

  it('lets the next find through when one never settles', () => {
    const sent: string[] = [];
    const q = new PdfFindQueue<string>((f) => sent.push(f), 2000);
    q.request('first');
    q.request('second');
    vi.advanceTimersByTime(1999);
    expect(sent).toEqual(['first']);
    vi.advanceTimersByTime(1);
    expect(sent).toEqual(['first', 'second']);
  });

  it('forgets what was in flight and what waited on reset', () => {
    const sent: string[] = [];
    const q = new PdfFindQueue<string>((f) => sent.push(f));
    q.request('old document');
    q.request('still old');
    q.reset();
    vi.advanceTimersByTime(5000);
    expect(sent).toEqual(['old document']);
    q.request('new document');
    expect(sent).toEqual(['old document', 'new document']);
  });
});
