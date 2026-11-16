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
  revealLinesIn,
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

// A text or code pane shows a reveal by its lines: the ones it names, else the
// ones its quote sits on (Study's Show Source and a chat citation send a quote).
describe('the lines a text pane reveals', () => {
  const text = ['# Notes', '', 'Margin note 1.', 'The Bornhuetter-Ferguson method adds the expected', 'unreported loss to the actual reported loss.', 'Last line.'].join('\n');

  it('takes the line range when one is named, over any quote', () => {
    expect(revealLinesIn(text, { line: 2, endLine: 3, quote: 'Last line.' })).toEqual({ first: 2, last: 3 });
    expect(revealLinesIn(text, { line: 5 })).toEqual({ first: 5, last: 5 });
  });

  it('finds a quote across line breaks, spacing and case', () => {
    expect(revealLinesIn(text, { quote: 'the bornhuetter-ferguson method adds the expected unreported   loss to the actual reported loss.' })).toEqual({ first: 4, last: 5 });
  });

  it('falls back to the quote\'s first eight words when the whole is not there', () => {
    expect(revealLinesIn(text, { quote: 'The Bornhuetter-Ferguson method adds the expected unreported loss, as the model put it' })).toEqual({ first: 4, last: 5 });
  });

  it('places nothing for a quote that is not in the file, a page alone, or no target', () => {
    expect(revealLinesIn(text, { quote: 'Benktander credibility weights' })).toBeUndefined();
    expect(revealLinesIn(text, { page: 3 })).toBeUndefined();
    expect(revealLinesIn(text, undefined)).toBeUndefined();
  });
});
