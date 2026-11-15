// uriNonAscii.test.ts — a path survives the trip through a URI string, whatever it is written in.
//
// Found by an independent review (2026-11-15) and reproduced in the app: a
// file named with an en dash was opened under another name, and a sheet
// named "Café" could not be made, because the string form wrote a
// character's code where its UTF-8 bytes belong.

import { describe, expect, it } from 'vitest';
import { URI } from '../../src/platform/uri';

const NAMES = [
  'plain.md',
  'Café.sheet',
  'Notes – draft.md',
  'Budget — 2026.sheet',
  'Sam’s notes.md',
  '家計簿.sheet',
  'a 😀 b.txt',
  '100% done #1 ?.md',
  'x%2013y.md',
];

describe('a path through URI.toString and URI.parse', () => {
  for (const name of NAMES) {
    it(`keeps "${name}"`, () => {
      const posix = `/home/user/Work/${name}`;
      expect(URI.parse(URI.file(posix).toString()).fsPath).toBe(posix);
      expect(URI.parse(URI.file(posix).toString()).basename).toBe(name);
      const windows = `D:/Work/${name}`;
      expect(URI.parse(URI.file(windows).toString()).fsPath).toBe(windows);
    });
  }

  it('writes a character as its UTF-8 bytes, as every other program does', () => {
    expect(URI.file('/w/Café – a.md').toString()).toBe('file:///w/Caf%C3%A9%20%E2%80%93%20a.md');
  });

  it('still reads a string written the old way for a Latin-1 letter', () => {
    expect(URI.parse('file:///w/Caf%E9.md').fsPath).toBe('/w/Café.md');
  });

  it('does not throw on a stray percent sign', () => {
    expect(() => URI.parse('file:///w/100%.md')).not.toThrow();
    expect(URI.parse('file:///w/100%.md').fsPath).toBe('/w/100%.md');
  });
});
