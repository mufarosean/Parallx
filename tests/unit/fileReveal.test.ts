// fileReveal.test.ts — "open this file at this spot" requests.
//
// A citation link files a reveal before the editor opens; the pane takes it
// once it is shown and settled. It must survive a slow load (the old 100 ms
// timer dropped a fresh PDF's page) and must not fire on a later, unrelated
// open of the same file.

import { describe, it, expect, beforeEach } from 'vitest';
import {
  requestFileReveal,
  takeFileReveal,
  fileRevealKey,
  hasRevealTarget,
  _clearFileRevealsForTest,
} from '../../src/editor/fileReveal';

describe('file reveal requests', () => {
  beforeEach(() => _clearFileRevealsForTest());

  it('is taken once by the file it was filed for', () => {
    requestFileReveal('C:\\Exams\\Clark.pdf', { page: 13, quote: 'the expected loss' }, 1000);
    expect(takeFileReveal('c:/exams/clark.pdf', 1500)).toEqual({ page: 13, quote: 'the expected loss' });
    expect(takeFileReveal('c:/exams/clark.pdf', 1500)).toBeUndefined();
  });

  it('matches a URI path with a leading slash before the drive', () => {
    expect(fileRevealKey('/C:/Exams/Clark.pdf')).toBe(fileRevealKey('C:\\Exams\\Clark.pdf'));
  });

  it('is not taken by another file', () => {
    requestFileReveal('/ws/a.pdf', { page: 2 }, 0);
    expect(takeFileReveal('/ws/b.pdf', 0)).toBeUndefined();
    expect(takeFileReveal('/ws/a.pdf', 0)).toEqual({ page: 2 });
  });

  it('expires after a minute, so a later plain open does not jump', () => {
    requestFileReveal('/ws/a.txt', { line: 12 }, 0);
    expect(takeFileReveal('/ws/a.txt', 60_001)).toBeUndefined();
  });

  it('ignores a request that asks for nothing', () => {
    expect(hasRevealTarget({})).toBe(false);
    expect(hasRevealTarget({ quote: '   ' })).toBe(false);
    requestFileReveal('/ws/a.txt', {}, 0);
    expect(takeFileReveal('/ws/a.txt', 0)).toBeUndefined();
    expect(hasRevealTarget({ cell: 'B206' })).toBe(true);
  });
});
